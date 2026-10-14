import type { ReviewResult } from "@dotaka/contracts";
import { insert, q, type Row } from "@dotaka/db";
import { REVIEW_CRITERIA, forbiddenHits, judge, norm, recordDecision, reviewContentHeuristic, reviewContentQuestions, vn } from "@dotaka/jev";
import type { Dna } from "@dotaka/agents";
import { effectiveProvider, generate } from "@dotaka/llm-gateway";
import { agentPlaybook } from "@dotaka/skills";
import { logger } from "@dotaka/shared";
import { z } from "zod";

/** Output of the Marketing QA reviewer (persona mkt-kiem-duyet + its scoring skills). */
const MktJudge = z.object({
  score: z.number().min(0).max(100),
  verdict: z.enum(["dat", "sua"]),
  issues: z.array(z.string()).max(5),
  dnaViolations: z.array(z.string()),
  aiTraces: z.array(z.string()),
  fix: z.string(),
});

/**
 * Review Agent (spec §12): three layers.
 *  1. Deterministic checks (free): schema already passed; length, hashtags, forbidden claims,
 *     prices vs DNA, source refs, duplicates, video timing, SEO meta.
 *  2. Jev judge: one request scoring rubric criteria + two hard-risk Nouls.
 *  3. Escalation: low Jev confidence on a borderline total -> CEO sees it flagged.
 * Rubrics are data (RUBRICS below) with a version; fatal findings block regardless of total.
 */
export const RUBRICS: Record<string, { version: number; pass: number; block: number; jev: boolean }> = {
  content_social: { version: 3, pass: 72, block: 40, jev: true },
  video_script: { version: 2, pass: 70, block: 40, jev: true },
  seo_article: { version: 2, pass: 70, block: 40, jev: true },
  video_final: { version: 1, pass: 70, block: 40, jev: true },
  brief: { version: 1, pass: 60, block: 30, jev: false },
  research: { version: 1, pass: 60, block: 30, jev: false },
  strategy: { version: 1, pass: 60, block: 30, jev: false },
};

type Check = ReviewResult["deterministic"][number];

/** Mọi số tiền xuất hiện trong 1 đoạn chữ (ưu đãi / chính sách): "50.000đ", "1,2 triệu", "30k" → "50000", "1200000", "30000". */
export function amountsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(/(\d+(?:[.,]\d+)*)\s*(k|nghìn|ngàn|tr|triệu)?/gi)) {
    const unit = (m[2] ?? "").toLowerCase();
    const raw = m[1];
    // "1,2 triệu" = 1.2 triệu; "50.000" = 50000 (dấu phân cách nghìn).
    const thousands = /^\d{1,3}([.,]\d{3})+$/.test(raw);
    let n = thousands ? Number(raw.replace(/[.,]/g, "")) : Number(raw.replace(",", "."));
    if (unit === "k" || unit === "nghìn" || unit === "ngàn") n *= 1000;
    else if (unit === "tr" || unit === "triệu") n *= 1_000_000;
    if (Number.isFinite(n) && n > 0) out.push(String(Math.round(n)));
  }
  return out;
}

/**
 * Giá trong bài phải có thật: giá niêm yết DNA, HOẶC số tiền nằm trong ưu đãi/chính sách đang công bố
 * (DNA offers, ưu đãi của sản phẩm, chính sách sản phẩm của chiến dịch — vd "giảm 50.000đ", "freeship đơn từ 300k").
 */
function productPriceFails(text: string, dna: Dna, allowedFacts: string[] = []): string[] {
  const fails: string[] = [];
  const known = new Set(dna.products.filter((p) => p.price != null).map((p) => String(p.price)));
  const factTexts = [...(dna.offers ?? []), ...dna.products.map((p) => String((p as { offer?: unknown }).offer ?? "")), ...allowedFacts];
  for (const t of factTexts) for (const a of amountsIn(t)) known.add(a);
  for (const m of text.matchAll(/(\d{1,3}(?:[.,]\d{3})+)\s*(đ|vnđ|vnd)/gi)) {
    const v = m[1].replace(/[.,]/g, "");
    if (!known.has(v)) fails.push(`Giá ${m[0]} không có trong DNA`);
  }
  return fails;
}

/**
 * Only the copy a customer actually sees. Internal fields (facts, openQuestions, scene directions…) often
 * restate DNA rules — "không hứa làm giàu nhanh" — and must not trip the forbidden-claim/price checks.
 */
export function customerText(rubricKey: string, output: any): string {
  const o = output ?? {};
  const parts: unknown[] = (() => {
    switch (rubricKey) {
      case "content_social": return [o.title, ...(o.variants ?? []).flatMap((v: any) => [v.hook, v.body, v.cta, ...(v.hashtags ?? [])])];
      case "video_script": return [o.title, ...(o.hooks ?? []), ...(o.scenes ?? []).flatMap((s: any) => [s.voiceover, s.onScreenText]), o.cta, o.caption];
      case "seo_article": return [o.title, o.metaDescription, ...(o.outline ?? []), o.bodyMarkdown];
      case "video_final": return [o.caption, ...(o.script ?? []).map((s: any) => s.loi_thoai)];
      default: return [JSON.stringify(o)];
    }
  })();
  return parts.filter((x) => typeof x === "string" && x).join("\n");
}

/** Bản CEO tự sửa (trước khi duyệt): câu cấm, giá không có trong DNA, ký tự cấm — trả danh sách lỗi còn lại. */
export function editedTextIssues(text: string, dna: Dna): string[] {
  const out: string[] = [];
  const forbidden = forbiddenHits(text, dna.forbiddenClaims ?? []);
  if (forbidden.length) out.push(`Còn tuyên bố cấm: ${forbidden.join(", ")}`);
  out.push(...productPriceFails(text, dna));
  const left = (dna.bannedChars ?? []).filter((c) => text.includes(c));
  if (left.length) out.push(`Còn ký tự cấm: ${left.join(" ")}`);
  return out;
}

export function deterministicChecks(rubricKey: string, output: any, dna: Dna, existingTexts: string[], autoFixed = 0, allowedFacts: string[] = []): Check[] {
  const checks: Check[] = [];
  const add = (check: string, passed: boolean, severity: Check["severity"], detail?: string) => checks.push({ check, passed, severity, detail });
  const text = customerText(rubricKey, output);

  const customerFacing = ["content_social", "video_script", "seo_article", "video_final"].includes(rubricKey);
  // Internal artefacts (brief, strategy) legitimately list forbidden claims as constraints.
  const forbidden = customerFacing ? forbiddenHits(text, dna.forbiddenClaims) : [];
  add("Không có tuyên bố cấm", forbidden.length === 0, "fatal", forbidden.length ? `Có: ${forbidden.join(", ")}` : undefined);
  if (["content_social", "video_script", "seo_article", "video_final"].includes(rubricKey) && dna.bannedChars?.length) {
    const left = dna.bannedChars.filter((c) => text.includes(c));
    add(`Không dùng ký tự cấm (${dna.bannedChars.join(" ")})`, left.length === 0, "major", autoFixed ? `đã tự sửa ${autoFixed} chỗ` : undefined);
  }
  if (["content_social", "video_script", "seo_article"].includes(rubricKey)) {
    // Customer-facing copy only: internal artefacts legitimately contain thresholds (e.g. "CPL > 250.000đ").
    const priceFails = productPriceFails(text, dna, allowedFacts);
    add("Giá khớp DNA", priceFails.length === 0, "fatal", priceFails.join("; ") || undefined);
  }

  if (rubricKey === "content_social") {
    const v = output.variants?.[0] ?? {};
    const len = `${v.hook} ${v.body} ${v.cta}`.length;
    const max = output.channel === "tiktok" ? 2200 : output.channel === "zalo" ? 2000 : 3000;
    add(`Độ dài phù hợp kênh (${len}/${max})`, len >= 150 && len <= max, "major");
    add("Tối đa 5 hashtag", (output.variants ?? []).every((x: any) => x.hashtags.length <= 5), "minor");
    add("Có ít nhất 2 biến thể A/B", (output.variants ?? []).length >= 2, "minor");
    const refsOk = (output.facts ?? []).every((f: any) => /^(dna:|kb:)/.test(f.sourceRef));
    add("Mọi dữ kiện có sourceRef", refsOk, "major");
    const tokens = new Set(vn(v.body ?? "").split(/\s+/));
    const dup = existingTexts.some((t) => {
      const o = new Set(vn(t).split(/\s+/));
      const inter = [...tokens].filter((x) => o.has(x)).length;
      return inter / Math.max(1, Math.min(tokens.size, o.size)) > 0.92;
    });
    add("Không trùng lặp nội dung đã có", !dup, "major");
  }
  if (rubricKey === "video_script") {
    const total = (output.scenes ?? []).reduce((a: number, s: any) => a + (s.to - s.from), 0);
    add(`Tổng thời lượng cảnh khớp ${output.durationSec}s`, Math.abs(total - output.durationSec) <= 2, "major", `Tổng cảnh ${total}s`);
    add("Có ít nhất 2 hook", (output.hooks ?? []).length >= 2, "major");
  }
  if (rubricKey === "seo_article") {
    add("Tiêu đề ≤ 65 ký tự", (output.title ?? "").length <= 65, "minor", `${(output.title ?? "").length} ký tự`);
    const ml = (output.metaDescription ?? "").length;
    add("Meta 120-160 ký tự", ml >= 120 && ml <= 160, "minor", `${ml} ký tự`);
    add("Liên kết nội bộ hợp lệ", (output.internalLinks ?? []).every((l: string) => l.startsWith("/")), "minor");
  }
  if (rubricKey === "brief") {
    add("KPI có đơn vị và hạn", (output.kpis ?? []).every((k: any) => k.unit && k.by), "major");
  }
  if (rubricKey === "strategy") {
    const opts = (output.options ?? []).length;
    add("Có 2-3 phương án", opts >= 2 && opts <= 3, "major");
    const share = (output.channelPlan ?? []).reduce((a: number, c: any) => a + c.share, 0);
    add("Tỷ trọng kênh ≈ 100%", Math.abs(share - 1) < 0.05 || Math.abs(share - 100) < 5, "minor", `Tổng ${share}`);
  }
  return checks;
}

export async function reviewOutput(opts: {
  bizId: string; subjectType: string; subjectId: string; rubricKey: string; output: any; dna: Dna; autoFixed?: number;
  /** Checks computed by the caller (e.g. ffprobe results for a finished video). */
  extraChecks?: Check[];
  /** Dữ kiện được phép ngoài DNA (ưu đãi/chính sách sản phẩm của chiến dịch) — số tiền trong đó coi là đúng. */
  allowedFacts?: string[];
  contentView?: { title: string; hook: string; body: string; cta: string; channel: string | null };
}): Promise<ReviewResult & { id: string; judgmentId?: string; fixable: boolean }> {
  const rubric = RUBRICS[opts.rubricKey] ?? { version: 1, pass: 60, block: 30, jev: false };
  const existing = q.all<Row>("SELECT body FROM content_item WHERE biz_id = ? AND id != ? ORDER BY created_at DESC LIMIT 40", opts.bizId, opts.subjectId).map((r) => r.body);
  const det = [...deterministicChecks(opts.rubricKey, opts.output, opts.dna, existing, opts.autoFixed ?? 0, opts.allowedFacts ?? []), ...(opts.extraChecks ?? [])];

  const criteria: ReviewResult["criteria"] = [];
  const fatal = det.filter((c) => !c.passed && c.severity === "fatal").map((c) => `${c.check}: ${c.detail ?? ""}`);
  let judgmentId: string | undefined;
  let lowConfidence = false;

  if (rubric.jev && opts.contentView) {
    const j = await judge({
      bizId: opts.bizId, purpose: "review.content", subject: { type: opts.subjectType, id: opts.subjectId },
      state: {
        brand: { name: opts.dna.company.name, voice: opts.dna.voice.style.join(", "), audience: opts.dna.audience.map((a) => `${a.name}: ${a.pains.join(", ")}`).join(" | ") },
        channel: opts.contentView.channel,
        content: { title: opts.contentView.title, hook: opts.contentView.hook, body: opts.contentView.body, cta: opts.contentView.cta },
        facts: (opts.output.facts ?? []).map((f: any) => f.statement),
      },
      questions: reviewContentQuestions,
      heuristic: reviewContentHeuristic,
    });
    judgmentId = j.id;
    const a = j.answers as any;
    for (const c of REVIEW_CRITERIA) {
      const ans = a[c.key];
      const s = norm(ans);
      if (ans.confidence < 0.3) lowConfidence = true;
      criteria.push({ key: c.key, label: c.label, score: s, confidence: ans.confidence, evidence: [`Jev: mức ${ans.score.toFixed(2)} / ${Object.keys(ans.probabilities).length - 1}`], source: j.source, fix: s < 0.6 ? c.fix : undefined });
    }
    if (a.outcome_guarantee.noul > 0.5) fatal.push(`Jev: hứa hẹn kết quả tài chính (p=${a.outcome_guarantee.noul.toFixed(2)})`);
    if (a.ad_policy_risk.noul > 0.6) fatal.push(`Jev: rủi ro chính sách quảng cáo (p=${a.ad_policy_risk.noul.toFixed(2)})`);
    criteria.push({ key: "outcome_guarantee", label: "Không hứa hẹn kết quả", score: 1 - a.outcome_guarantee.noul, confidence: null, evidence: [`p(có hứa hẹn)=${a.outcome_guarantee.noul.toFixed(2)}`], source: j.source });
    criteria.push({ key: "ad_policy_risk", label: "An toàn chính sách QC", score: 1 - a.ad_policy_risk.noul, confidence: null, evidence: [`p(vi phạm)=${a.ad_policy_risk.noul.toFixed(2)}`], source: j.source });
  }

  // Total: 60% rubric criteria (weights) + 40% deterministic pass rate (majors count double).
  const weightSum = REVIEW_CRITERIA.reduce((s, c) => s + c.weight, 0);
  const critScore = criteria.length
    ? REVIEW_CRITERIA.reduce((s, c) => s + (criteria.find((x) => x.key === c.key)?.score ?? 0) * c.weight, 0) / weightSum
    : 1;
  const detW = det.reduce((s, c) => s + (c.severity === "minor" ? 1 : 2), 0) || 1;
  const detScore = det.reduce((s, c) => s + (c.passed ? (c.severity === "minor" ? 1 : 2) : 0), 0) / detW;
  let total = Math.round((criteria.length ? critScore * 60 + detScore * 40 : detScore * 100) * 10) / 10;

  // Layer 3: Marketing QA (Claude + mkt-kiem-duyet persona and scoring skills). Only on customer-facing copy,
  // only when a real model is configured, never blocks on its own failure.
  let mkt: z.infer<typeof MktJudge> | null = null;
  if (rubric.jev && opts.contentView && effectiveProvider(opts.bizId).provider !== "sandbox" && !fatal.length) {
    mkt = await mktReview(opts.bizId, opts.rubricKey, opts.contentView, rubric.pass);
    if (mkt) {
      criteria.push({ key: "mkt_qa", label: "Kiểm duyệt phòng MKT (skill)", score: mkt.score / 100, confidence: null, evidence: [...mkt.issues, ...mkt.aiTraces.map((x) => `Dấu vết AI: ${x}`)], source: "llm", fix: mkt.verdict === "sua" ? mkt.fix : undefined });
      total = Math.round((total * 0.5 + mkt.score * 0.5) * 10) / 10;
    }
  }

  let verdict: ReviewResult["verdict"] = total >= rubric.pass ? "pass" : total < rubric.block ? "block" : "revise";
  // Department rule: DNA guardrail violation => automatic revise; MKT score below the rubric's pass mark => revise
  // (cùng ngưỡng với rubric — trước đây cứng 80 trong khi rubric đạt ở 70-72 → vòng sửa thừa, tốn model).
  verdict = applyMktRule(verdict, mkt, rubric.pass);
  if (mkt?.dnaViolations.length) det.push({ check: "Soát DNA (Kiểm duyệt MKT)", passed: false, severity: "major", detail: mkt.dnaViolations.join("; ") });
  if (fatal.length) verdict = "block";
  else if (det.some((c) => !c.passed && c.severity === "major") && verdict === "pass") verdict = "revise";
  else if (verdict === "pass" && lowConfidence && total < rubric.pass + 8) verdict = "escalate";

  const result: ReviewResult = {
    subjectType: opts.subjectType, subjectId: opts.subjectId, rubricKey: opts.rubricKey, rubricVersion: rubric.version,
    deterministic: det, criteria, total, verdict, fatalFindings: fatal,
  };
  const row = insert("review_score", {
    biz_id: opts.bizId, subject_type: opts.subjectType, subject_id: opts.subjectId, rubric_key: opts.rubricKey,
    rubric_version: rubric.version, total, verdict, result,
  });
  if (judgmentId) recordDecision(judgmentId, { total, verdict, fatal });
  // Lỗi nghiêm trọng "sửa được" = chỉ nằm ở CHỮ (giá lệch, câu cấm, hứa hẹn…) → agent viết lại được; lỗi kỹ thuật do
  // người gọi đưa vào (file video hỏng…) thì không.
  const extraFatal = (opts.extraChecks ?? []).some((c) => !c.passed && c.severity === "fatal");
  return { ...result, id: row.id, judgmentId, fixable: fatal.length > 0 && !extraFatal };
}

/** Luật phòng MKT: vi phạm DNA hoặc điểm MKT dưới ngưỡng ĐẠT của rubric → "revise" (chỉ hạ bậc một bản đang "pass"). */
export function applyMktRule(verdict: ReviewResult["verdict"], mkt: { score: number; dnaViolations: string[] } | null, passMark: number): ReviewResult["verdict"] {
  if (mkt && verdict === "pass" && (mkt.dnaViolations.length || mkt.score < passMark)) return "revise";
  return verdict;
}

/** Findings to send back to the producing agent on a revise verdict. */
export function findingsOf(r: ReviewResult): string[] {
  return [
    ...r.deterministic.filter((c) => !c.passed).map((c) => `${c.check}${c.detail ? ` (${c.detail})` : ""}`),
    ...r.criteria.filter((c) => c.fix).map((c) => `${c.label}: ${c.fix}`),
    ...r.fatalFindings,
  ];
}

async function mktReview(bizId: string, rubricKey: string, v: { title: string; hook: string; body: string; cta: string; channel: string | null }, passMark: number) {
  const pb = agentPlaybook(bizId, "review");
  if (!pb.text) return null;
  const kind = rubricKey === "video_script" ? "kịch bản video ngắn" : rubricKey === "seo_article" ? "bài SEO" : "bài đăng mạng xã hội";
  try {
    const r = await generate({
      bizId, agentKey: "review", tier: "medium", schema: MktJudge,
      system: `Bạn là Trưởng nhóm Kiểm duyệt của Phòng Marketing AI. Chấm thật, không nể. Trả JSON theo schema: score /100, verdict dat (>=${passMark}) hoặc sua, tối đa 3 lỗi cụ thể nhất, vi phạm DNA (claim cấm, số liệu không có trong DNA, ký tự cấm, sai lớp brand/xưng hô, rủi ro chính sách Meta), dấu vết văn AI, và 1 đoạn gợi ý sửa.`,
      systemSuffix: pb.text,
      user: `LOẠI: ${kind} · KÊNH: ${v.channel ?? "?"}\nTIÊU ĐỀ: ${v.title}\nHOOK: ${v.hook}\n\nNỘI DUNG:\n${v.body}\n\nCTA: ${v.cta}`,
      sandbox: () => ({ score: 0, verdict: "sua" as const, issues: [], dnaViolations: [], aiTraces: [], fix: "" }),
    });
    return r.output;
  } catch (e) {
    logger.warn("review.mkt_failed", { error: String(e).slice(0, 300) });
    return null;
  }
}
