import { z } from "zod";
import { activeDna, audit, emit, insert, q, type Row } from "@dotaka/db";
import type { Dna } from "@dotaka/agents";
import { AppError, formatVnd, nowIso } from "@dotaka/shared";
import { enqueue } from "./queue.ts";
import { latestDaily, startAdsReport, sumMetrics, today } from "./ads.ts";
import { learnDaily } from "./learning.ts";
import { reviewOutput } from "./review.ts";

/**
 * GIAO VIỆC RIÊNG cho từng AI Agent (ngoài chuỗi tự động): Sếp giao 1 việc → đúng agent đó làm → xong là DỪNG,
 * không tự mở khâu tiếp theo (task.input.standalone — runtime.ts stopsHere). Muốn đi tiếp thì giao việc kế tiếp
 * "dựa trên kết quả" việc trước (basedOn), vd: Nghiên cứu → (Sếp xem) → Lập kế hoạch dựa trên nghiên cứu đó.
 * Agent không chạy bằng 1 lần gọi AI (dựng video, đăng bài, chat…) có trang làm việc riêng → trả đường dẫn tới trang đó.
 */
export type AssignKind = "task" | "action" | "page";
export const ASSIGNABLE: Record<string, { kind: AssignKind; does: string; href?: string; needsText: boolean; example?: string }> = {
  brief: { kind: "task", does: "Chuẩn hóa 1 yêu cầu thành brief: KPI đo được, đối tượng, ràng buộc, đánh giá khả thi", needsText: true, example: "Tuyển 120 học viên khóa CEO Vận Hành Tự Động trong tháng 11, ngân sách 150 triệu" },
  market_research: { kind: "task", does: "Nghiên cứu thị trường, đối thủ, insight khách hàng cho 1 chủ đề / sản phẩm", needsText: true, example: "Nghiên cứu đối thủ FUNIX và các khóa đào tạo CEO online: giá, thông điệp, kênh, điểm yếu" },
  strategy: { kind: "task", does: "Lập kế hoạch marketing: định vị, phễu, phân bổ kênh & ngân sách, kế hoạch nội dung (không tự viết bài)", needsText: true, example: "Lập kế hoạch 4 tuần cho khóa AI Business System, ngân sách ads 80 triệu, kênh Facebook + TikTok" },
  content: { kind: "task", does: "Viết 1 bài mạng xã hội (kèm biến thể A/B), qua Review chấm điểm", needsText: true, example: "Bài Facebook kể case học viên chủ spa tự động hoá chăm khách sau 6 tuần" },
  video_script: { kind: "task", does: "Viết 1 kịch bản video ngắn (hook, cảnh, lời đọc, CTA)", needsText: true, example: "Kịch bản TikTok 45s: 3 việc CEO nên giao cho AI ngay tuần này" },
  seo_web: { kind: "task", does: "Viết 1 bài blog chuẩn SEO cho website", needsText: true, example: "Bài SEO từ khoá 'tự động hoá vận hành doanh nghiệp nhỏ'" },
  ads: { kind: "action", does: "Phân tích quảng cáo 7 ngày từ số liệu thật, đề xuất tăng/giảm/tắt (đề xuất chờ Sếp duyệt)", needsText: false },
  analytics: { kind: "action", does: "Báo cáo nhanh: chi ads, lead, doanh thu, việc chờ duyệt — từ số liệu thật trong hệ thống", needsText: false },
  feedback: { kind: "action", does: "Rút bài học từ phản hồi & kết quả 14 ngày, tạo đề xuất thay đổi (chờ Sếp duyệt)", needsText: false },
  review: { kind: "action", does: "Chấm 1 bài Sếp dán vào theo DNA + tiêu chí Review (không đăng, không lưu thành nội dung)", needsText: true, example: "Dán nguyên văn bài viết cần chấm vào đây" },
  dna_intake: { kind: "page", does: "Nạp / chỉnh DNA thương hiệu từ tài liệu", href: "/dna", needsText: false },
  creative: { kind: "page", does: "Dựng video (tự động, Flow, nhân hiệu, edit từ video gốc)", href: "/video-flow", needsText: false },
  publishing: { kind: "page", does: "Đăng / lên lịch / thử lại bài đã duyệt", href: "/publish", needsText: false },
  post_scanner: { kind: "page", does: "Quét bài đã đăng, chấm điểm bài, phân loại bình luận (tự chạy sau khi đăng)", href: "/publish", needsText: false },
  chat: { kind: "page", does: "Trả lời khách, chấm lead, chuyển tư vấn viên", href: "/chat", needsText: false },
  follow_up: { kind: "page", does: "Chăm sóc lại khách theo mốc (Zalo / Messenger)", href: "/zalo", needsText: false },
};
const TASK_LABEL: Record<string, string> = { brief: "Brief", market_research: "Nghiên cứu", strategy: "Kế hoạch", content: "Bài", video_script: "Kịch bản", seo_web: "Bài SEO" };

export const AssignInput = z.object({
  agent: z.string(),
  instruction: z.string().trim().max(8000).default(""),
  /** Việc đã xong làm đầu vào (kết quả brief / nghiên cứu / kế hoạch trước đó). */
  basedOn: z.array(z.string()).max(5).default([]),
  channel: z.enum(["facebook", "instagram", "tiktok", "youtube", "zalo", "website"]).optional(),
  format: z.enum(["text", "image", "video", "reel", "article"]).optional(),
  funnel: z.enum(["tofu", "mofu", "bofu"]).optional(),
  keyword: z.string().max(200).optional(),
  budgetAds: z.number().int().min(0).optional(),
  /** Bài / kịch bản: Sếp duyệt xong thì lên lịch đăng (mặc định KHÔNG — chỉ viết rồi dừng). */
  publishAfterApproval: z.boolean().default(false),
  threadId: z.string().nullable().optional(),
});
export type AssignInput = z.infer<typeof AssignInput>;

/** Giao 1 việc cho 1 agent. Trả về việc vừa tạo (task) hoặc kết quả làm ngay (action) hoặc trang cần mở (page). */
export async function assignAgentTask(bizId: string, raw: unknown, actor: string) {
  const p = AssignInput.parse(raw);
  const spec = ASSIGNABLE[p.agent];
  if (!spec) throw new AppError("NO_AGENT", `Không có agent "${p.agent}"`);
  if (spec.kind === "page") return { kind: "page" as const, href: spec.href };
  const cfg = q.get<Row>("SELECT enabled FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, p.agent);
  if (cfg && !cfg.enabled) throw new AppError("AGENT_DISABLED", `Agent đang tắt — bật ở Agent & Tác vụ trước khi giao việc`);
  if (spec.needsText && p.instruction.length < 5) throw new AppError("NO_INSTRUCTION", "Sếp ghi yêu cầu cụ thể (ít nhất 5 ký tự)");

  if (spec.kind === "task") {
    const basedOn = p.basedOn.length
      ? q.all<Row>(`SELECT id FROM task WHERE biz_id = ? AND status = 'done' AND output IS NOT NULL AND id IN (${p.basedOn.map(() => "?").join(",")})`, bizId, ...p.basedOn).map((r) => r.id as string)
      : [];
    const isPiece = ["content", "video_script", "seo_web"].includes(p.agent);
    const channel = p.channel ?? (p.agent === "seo_web" ? "website" : p.agent === "video_script" ? "tiktok" : "facebook");
    const format = p.format ?? (p.agent === "video_script" ? "reel" : p.agent === "seo_web" ? "article" : "text");
    const input: Row = {
      standalone: true, instruction: p.instruction, basedOn, dispatchedBy: actor,
      ...(p.budgetAds != null ? { budgetAds: p.budgetAds } : {}),
      ...(isPiece ? {
        item: { channel, format, topic: p.instruction.slice(0, 300), angle: p.instruction, funnel: p.funnel ?? "tofu", yeuCauCuaCeo: p.instruction },
        keyword: p.keyword ?? p.instruction.slice(0, 120), noPublish: !p.publishAfterApproval,
      } : {}),
      ...(p.agent === "strategy" ? { contentCount: 4 } : {}),
    };
    const title = `Việc riêng · ${TASK_LABEL[p.agent]}${isPiece ? ` ${channel}` : ""}: ${p.instruction.replace(/\s+/g, " ").slice(0, 70)}`;
    const task = insert("task", { biz_id: bizId, goal_id: null, agent_key: p.agent, title, status: "ready", input, depends_on: [] });
    enqueue("agent", "agent.run", { taskId: task.id }, { bizId, idempotencyKey: `run:${task.id}:0` });
    audit(bizId, actor, "agent.assigned", { type: "task", id: task.id }, { agent: p.agent, instruction: p.instruction.slice(0, 500), basedOn });
    emit(bizId, "task.updated", { taskId: task.id, status: "ready", agent: p.agent });
    return { kind: "task" as const, taskId: task.id, title, agent: p.agent, status: "ready" };
  }

  // Làm ngay (không qua hàng đợi agent)
  if (p.agent === "ads") {
    const task = startAdsReport(bizId, actor);
    return { kind: "task" as const, taskId: task.id, title: task.title, agent: "ads", status: "ready" };
  }
  if (p.agent === "analytics") return { kind: "action" as const, agent: "analytics", text: quickReport(bizId), at: nowIso() };
  if (p.agent === "feedback") {
    const r = learnDaily(bizId);
    audit(bizId, actor, "agent.assigned", undefined, { agent: "feedback" });
    return { kind: "action" as const, agent: "feedback", text: r.proposals ? `Đã tạo ${r.proposals} đề xuất thay đổi mới — xem ở Kế hoạch → Đề xuất thay đổi (chờ Sếp duyệt).` : "Chưa đủ dữ liệu mới để rút thêm bài học (cần phản hồi / kết quả bài trong 14 ngày).", at: nowIso() };
  }
  if (p.agent === "review") return { kind: "action" as const, agent: "review", ...(await reviewText(bizId, p.instruction, p.channel ?? "facebook")), at: nowIso() };
  throw new AppError("NO_AGENT", "Agent này chưa nhận việc riêng");
}

/** Báo cáo nhanh từ số liệu thật trong hệ thống (cũng dùng cho báo cáo sáng gửi Telegram). */
export function quickReport(bizId: string): string {
  const ads = q.all<Row>("SELECT id FROM ad WHERE biz_id = ?", bizId);
  const d = today();
  const weekAgo = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
  const mToday = sumMetrics(ads.flatMap((a) => latestDaily(bizId, a.id, d)));
  const m7 = sumMetrics(ads.flatMap((a) => latestDaily(bizId, a.id, weekAgo)));
  const since = (iso: string) => ({
    leads: q.scalar<number>("SELECT COUNT(*) FROM lead WHERE biz_id = ? AND created_at >= ?", bizId, iso) ?? 0,
    hot: q.scalar<number>("SELECT COUNT(*) FROM lead WHERE biz_id = ? AND grade = 'hot' AND updated_at >= ?", bizId, iso) ?? 0,
    revenue: q.scalar<number>("SELECT COALESCE(SUM(total),0) FROM orders WHERE biz_id = ? AND created_at >= ? AND status NOT IN ('cancelled','refunded','returned')", bizId, iso) ?? 0,
    posts: q.scalar<number>("SELECT COUNT(*) FROM post WHERE biz_id = ? AND published_at >= ? AND COALESCE(simulated, 0) = 0", bizId, iso) ?? 0,
  });
  const t = since(`${d}T00:00:00`);
  const w = since(`${weekAgo}T00:00:00`);
  const pending = q.scalar<number>("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'pending'", bizId) ?? 0;
  const name = q.get<Row>("SELECT name FROM biz WHERE id = ?", bizId)?.name ?? "";
  return [
    `Báo cáo nhanh ${name}, ${d}`,
    `HÔM NAY · Chi ads: ${formatVnd(mToday.spend)} · ${mToday.results} kết quả · Lead mới: ${t.leads} (nóng: ${t.hot}) · Doanh thu: ${formatVnd(t.revenue)} · Bài đăng thật: ${t.posts}`,
    `7 NGÀY · Chi ads: ${formatVnd(m7.spend)} · ${m7.results} kết quả${m7.results ? ` (CPA ${formatVnd(Math.round(m7.spend / m7.results))})` : ""} · Lead: ${w.leads} · Doanh thu: ${formatVnd(w.revenue)} · Bài đăng thật: ${w.posts}`,
    `${pending} mục chờ Sếp duyệt`,
  ].join("\n");
}

/** Review Agent chấm 1 đoạn Sếp dán vào (không tạo nội dung, không đăng). */
async function reviewText(bizId: string, text: string, channel: string) {
  const dna = activeDna(bizId)?.data as Dna | undefined;
  if (!dna) throw new AppError("NO_DNA", "Chưa có DNA đang hiệu lực");
  const lines = text.trim().split(/\n+/);
  const hook = lines[0] ?? "";
  const cta = lines.length > 1 ? lines[lines.length - 1] : "";
  const r = await reviewOutput({
    bizId, subjectType: "manual_check", subjectId: `manual-${Date.now()}`, rubricKey: "content_social", dna,
    output: { title: hook.slice(0, 120), variants: [{ key: "A", hook, body: text, cta }] },
    contentView: { title: hook.slice(0, 120), hook, body: text, cta, channel },
  });
  const verdict = { pass: "ĐẠT", revise: "CẦN SỬA", block: "CHẶN", escalate: "CẦN NGƯỜI XEM" }[r.verdict] ?? r.verdict;
  const fixes = [
    ...r.fatalFindings,
    ...r.deterministic.filter((c) => !c.passed).map((c) => `${c.check}${c.detail ? `: ${c.detail}` : ""}`),
    ...r.criteria.filter((c) => c.score < 0.6).map((c) => `${c.label} (${Math.round(c.score * 100)}/100)${c.fix ? ` → ${c.fix}` : ""}`),
  ];
  return {
    text: [`Kết quả: ${verdict} · ${Math.round(r.total)}/100`, ...(fixes.length ? ["Cần sửa:", ...fixes.map((f) => `• ${f}`)] : ["Không có điểm nào cần sửa."])].join("\n"),
    verdict: r.verdict, total: r.total, criteria: r.criteria.map((c) => ({ label: c.label, score: c.score, fix: c.fix ?? null })),
  };
}

/** Việc giao riêng gần đây + kết quả nền có thể dùng làm đầu vào ("dựa trên"). */
export function assignedOverview(bizId: string) {
  const tasks = q.all<Row>(`SELECT id, agent_key, title, status, step, progress, created_at, updated_at, error FROM task
    WHERE biz_id = ? AND goal_id IS NULL ORDER BY created_at DESC LIMIT 40`, bizId);
  const sources = q.all<Row>(`SELECT t.id, t.agent_key, t.title, t.updated_at, g.title goal_title FROM task t LEFT JOIN goal g ON g.id = t.goal_id
    WHERE t.biz_id = ? AND t.status = 'done' AND t.output IS NOT NULL AND t.agent_key IN ('brief','market_research','strategy')
    ORDER BY t.updated_at DESC LIMIT 30`, bizId);
  return { agents: ASSIGNABLE, tasks, sources };
}
