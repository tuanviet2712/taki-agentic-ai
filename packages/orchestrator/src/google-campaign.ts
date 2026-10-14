import { z } from "zod";
import { activeDna, audit, bizSettings, byId, emit, insert, isKilled, q, tx, type Row } from "@dotaka/db";
import {
  GOOGLE_AD_LIMITS, GOOGLE_OBJECTIVES, ConnectorError, resolveGoogleBidding, validateGoogleSearchSpec,
  type GoogleMatch, type GoogleObjective, type GoogleSearchCampaignSpec,
} from "@dotaka/connectors";
import { generate } from "@dotaka/llm-gateway";
import { AppError } from "@dotaka/shared";
import { activeAdBudget, today } from "./ads.ts";
import { dnaProducts } from "./autopilot.ts";
import { connectorForAccount } from "./connections.ts";

/**
 * Tạo chiến dịch Google Ads (Search) theo MỤC TIÊU: Sếp chọn mục tiêu + sản phẩm/URL + ngân sách, hệ thống tự soạn từ khóa,
 * tiêu đề, mô tả từ DNA rồi tạo chiến dịch (mặc định ở trạng thái tạm dừng). Cùng hàng rào như tạo quảng cáo Facebook:
 * whitelist tài khoản, dừng khẩn cấp, trần ngân sách ngày, giới hạn lượt tạo/ngày, nhật ký.
 */
const Kw = z.object({ text: z.string().trim().min(1), match: z.enum(["PHRASE", "EXACT", "BROAD"]).default("PHRASE") });
const Objective = z.enum(["traffic", "leads", "sales"]);

export const GoogleCampaignInput = z.object({
  adAccountId: z.string(), objective: Objective, dailyBudget: z.number().positive(),
  name: z.string().trim().max(128).optional(), startPaused: z.boolean().default(true),
  finalUrl: z.string().trim().min(1, "Thiếu URL trang đích"),
  keywords: z.array(Kw).min(1, "Cần ít nhất 1 từ khóa").max(GOOGLE_AD_LIMITS.maxKeywords),
  headlines: z.array(z.string()).min(3, "Cần ít nhất 3 tiêu đề").max(GOOGLE_AD_LIMITS.maxHeadlines),
  descriptions: z.array(z.string()).min(2, "Cần ít nhất 2 mô tả").max(GOOGLE_AD_LIMITS.maxDescriptions),
  path1: z.string().trim().optional(), path2: z.string().trim().optional(),
  maxCpc: z.number().positive().nullable().optional(),
});
export type GoogleCampaignInput = z.infer<typeof GoogleCampaignInput>;

/** Chế độ tự động: chỉ cần mục tiêu + ngân sách (+ sản phẩm hoặc URL); phần chữ do hệ thống soạn. */
export const GooglePlanInput = z.object({
  objective: Objective, productKey: z.string().optional(), url: z.string().trim().optional(), topic: z.string().trim().max(200).optional(), note: z.string().trim().max(500).optional(),
});
export const GoogleAutoInput = GooglePlanInput.extend({ adAccountId: z.string(), dailyBudget: z.number().positive(), startPaused: z.boolean().default(true), name: z.string().trim().max(128).optional() });

// ---------------- Soạn nội dung ----------------
const BANNED_FALLBACK: string[] = [];
/** Cắt theo từ để vừa `max` ký tự, bỏ dấu câu / từ nối thừa ở cuối. */
export function fitText(text: string, max: number): string {
  const t = text.normalize("NFC").replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  if (chars.length <= max) return t;
  const cut = chars.slice(0, max).join("");
  const sp = cut.lastIndexOf(" ");
  const base = sp >= Math.floor(max * 0.5) ? cut.slice(0, sp) : cut;
  return base.replace(/[\s,.;:\-–—·|/&]+$/u, "").replace(/\s+(và|của|cho|với|để|là|the|and|of)$/iu, "").trim();
}
const stripEmoji = (t: string) => t.replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, "");
const letters = (w: string) => w.replace(/[^\p{L}]/gu, "");
const isCaps = (w: string) => { const l = letters(w); return l.length >= 2 && l === l.toUpperCase() && l !== l.toLowerCase(); };
/**
 * Google từ chối chữ "gào" (IN HOA cả từ): hạ chữ hoa của cụm từ gồm từ in hoa ≥ 4 chữ cái và các từ in hoa ngắn sát nó
 * ("MIỄN PHÍ" → "Miễn phí"). Viết tắt đứng riêng ("AI", "CEO") và tên thương hiệu trong DNA (`keep`, vd "TAKI") được giữ nguyên.
 */
export function deshout(text: string, keep: string[] = []): string {
  const kept = new Set(keep.map((k) => letters(k).toUpperCase()).filter(Boolean));
  const words = text.split(" ");
  const caps = words.map((w) => isCaps(w) && !kept.has(letters(w)));
  // Cụm = các từ in hoa liên tiếp; cụm có từ ≥ 4 chữ cái là chữ "gào" → hạ cả cụm.
  const lower = words.map(() => false);
  for (let i = 0; i < words.length; ) {
    if (!caps[i]) { i++; continue; }
    let j = i;
    while (j < words.length && caps[j]) j++;
    if (words.slice(i, j).some((w) => letters(w).length >= 4)) for (let k = i; k < j; k++) lower[k] = true;
    i = j;
  }
  if (!lower.some(Boolean)) return text;
  const out = words.map((w, i) => (lower[i] ? w.toLowerCase() : w)).join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}
/** Làm sạch 1 câu quảng cáo cho đúng chính sách chữ của Google: không emoji, không "!" ở tiêu đề, không IN HOA cả cụm, không ký tự cấm của DNA. */
export function cleanAdText(text: string, kind: "headline" | "description", banned: string[] = BANNED_FALLBACK, keep: string[] = []): string {
  let t = banned.reduce((x, c) => (c ? x.split(c).join(",") : x), stripEmoji(String(text ?? "")));
  if (kind === "headline") t = t.replace(/!/g, "");
  t = deshout(t.replace(/([!?.,])\1+/g, "$1").replace(/\s+/g, " ").trim(), keep);
  return fitText(t, kind === "headline" ? GOOGLE_AD_LIMITS.headline : GOOGLE_AD_LIMITS.description);
}
/** Từ viết hoa sẵn trong tên thương hiệu / sản phẩm của DNA (TAKI, AI, CEO…) — giữ nguyên khi làm sạch. */
const keepCaps = (dna: Row, ...names: string[]): string[] => uniqCaps([dna.company?.brand, dna.company?.name, ...(dna.products ?? []).map((p: Row) => p.name), ...names].filter(Boolean).join(" ").split(/\s+/));
const uniqCaps = (ws: string[]) => [...new Set(ws.filter(isCaps).map((w) => letters(w).toUpperCase()))];
const uniq = <T>(xs: T[], key: (x: T) => string = (x) => String(x)) => { const s = new Set<string>(); return xs.filter((x) => { const k = key(x).toLowerCase(); if (!k || s.has(k)) return false; s.add(k); return true; }); };

function normalizeUrl(raw: string | undefined | null): string {
  let t = String(raw ?? "").trim();
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  try { return new URL(t).href; } catch { return ""; }
}

type PlanContext = { brand: string; keep: string[]; subject: string; url: string; product: Row | undefined; dna: Row; banned: string[]; forbidden: string[] };
function planContext(bizId: string, p: { productKey?: string; url?: string; topic?: string }): PlanContext {
  const dna = (activeDna(bizId)?.data ?? {}) as Row;
  const product = p.productKey ? dnaProducts(bizId).find((x) => x.key === p.productKey) : undefined;
  if (p.productKey && !product) throw new AppError("NOT_FOUND", "Không thấy sản phẩm này trong DNA", 404);
  const brand = String(dna.company?.brand || dna.company?.name || "").trim();
  const url = normalizeUrl(p.url) || normalizeUrl(product?.link) || normalizeUrl(dna.company?.website);
  let host = "";
  try { host = url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { /* no host */ }
  const subject = (p.topic || product?.name || brand || host).trim();
  if (!subject) throw new AppError("NEED_INFO", "Chưa biết quảng cáo gì: chọn sản phẩm trong DNA hoặc nhập tên sản phẩm / URL trang đích");
  return { brand, keep: keepCaps(dna, subject), subject, url, product, dna, banned: (dna.bannedChars ?? []) as string[], forbidden: ((dna.forbiddenClaims ?? []) as string[]).map((x) => String(x).toLowerCase()).filter(Boolean) };
}

export type GooglePlan = {
  objective: GoogleObjective; name: string; finalUrl: string;
  keywords: { text: string; match: GoogleMatch }[]; headlines: string[]; descriptions: string[]; path1: string; path2: string;
  rationale: string; source: "ai" | "template"; model: string;
};

const slug = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const defaultName = (c: PlanContext, objective: GoogleObjective) => `${today().replace(/-/g, "")}_${slug(c.brand || c.subject).slice(0, 20)}_${slug(c.subject).slice(0, 24)}_${objective}_search`.replace(/_+/g, "_");

/** Mẫu chuẩn (không cần AI): dùng khi chưa nối model, và để bù chỗ thiếu của bản AI. Chỉ dùng dữ kiện thật trong DNA / sản phẩm. */
export function templatePlan(c: PlanContext, objective: GoogleObjective): Omit<GooglePlan, "source" | "model" | "rationale" | "name" | "finalUrl"> {
  const obj = GOOGLE_OBJECTIVES[objective];
  const p = c.product ?? {};
  const subject = fitText(c.subject, GOOGLE_AD_LIMITS.keyword);
  const kw = uniq([subject, ...obj.modifiers.map((m) => `${subject} ${m}`), ...(c.brand && c.brand.toLowerCase() !== subject.toLowerCase() ? [`${c.brand} ${subject}`] : [])]);
  const keywords = kw.slice(0, 12).flatMap((text, i): { text: string; match: GoogleMatch }[] => (i < 2 ? [{ text, match: "PHRASE" }, { text, match: "EXACT" }] : [{ text, match: "PHRASE" }]));
  const price = Number(String(p.price ?? "").replace(/\D/g, ""));
  const heads = uniq([
    cleanAdText(c.subject, "headline", c.banned, c.keep), c.brand ? cleanAdText(c.brand, "headline", c.banned, c.keep) : "", obj.cta,
    p.offer ? cleanAdText(String(p.offer), "headline", c.banned, c.keep) : "", price >= 1000 ? `Giá từ ${price.toLocaleString("vi-VN")}đ` : "",
    c.brand ? cleanAdText(`${c.subject} - ${c.brand}`, "headline", c.banned, c.keep) : "", "Thông tin chi tiết", "Liên hệ nhận tư vấn",
  ].filter(Boolean) as string[]);
  const points = (Array.isArray(p.sellingPoints) ? p.sellingPoints : []).map(String);
  const descs = uniq([
    p.summary ? cleanAdText(String(p.summary), "description", c.banned, c.keep) : "", points.length ? cleanAdText(points.slice(0, 2).join(". "), "description", c.banned, c.keep) : "",
    cleanAdText(`${obj.cta}${c.brand ? ` cùng ${c.brand}` : ""}. Xem chi tiết trên website.`, "description", c.banned, c.keep),
    cleanAdText(`${c.subject}${c.brand ? ` từ ${c.brand}` : ""}. Liên hệ để được hỗ trợ nhanh.`, "description", c.banned, c.keep),
  ].filter(Boolean) as string[]);
  return { objective, keywords, headlines: heads.slice(0, 8), descriptions: descs.slice(0, 4), path1: "", path2: "" };
}

const PlanOut = z.object({
  campaignName: z.string(), keywords: z.array(z.string()).min(3).max(20), headlines: z.array(z.string()).min(3).max(15),
  descriptions: z.array(z.string()).min(2).max(4), path1: z.string(), path2: z.string(), rationale: z.string(),
});
const OBJECTIVE_NOTE: Record<GoogleObjective, string> = {
  traffic: "TRUY CẬP: từ khóa rộng gồm cả khách đang tìm hiểu thông tin; tiêu đề nêu giá trị / nội dung hữu ích để người ta bấm vào xem.",
  leads: "KHÁCH TIỀM NĂNG: từ khóa có ý định tìm hiểu và đăng ký (tư vấn, báo giá, đăng ký, học thử…); mô tả kêu gọi để lại thông tin.",
  sales: "BÁN HÀNG: từ khóa có ý định MUA (mua, giá, đặt hàng, khuyến mãi, ở đâu bán…); tiêu đề nêu ưu đãi / giá NẾU có trong dữ liệu; kêu gọi mua ngay.",
};

/** Soạn bộ chiến dịch theo mục tiêu từ DNA + sản phẩm. Không có model → mẫu chuẩn. Luôn trả bản đã làm sạch & đủ điều kiện của Google. */
export async function planGoogleCampaign(bizId: string, input: z.infer<typeof GooglePlanInput>): Promise<GooglePlan> {
  const p = GooglePlanInput.parse(input);
  const c = planContext(bizId, p);
  const base = templatePlan(c, p.objective);
  const fallbackOut = { campaignName: defaultName(c, p.objective), keywords: base.keywords.map((k) => k.text), headlines: base.headlines, descriptions: base.descriptions, path1: "", path2: "", rationale: "Mẫu chuẩn theo mục tiêu (chưa nối model AI hoặc AI không trả lời)." };
  const pad = (xs: string[], by: string[], n: number) => uniq([...xs, ...by]).slice(0, n);
  if (fallbackOut.keywords.length < 3) fallbackOut.keywords = pad(fallbackOut.keywords, [`${c.subject} giá`, `${c.subject} tư vấn`, `${c.subject} đăng ký`], 3);
  if (fallbackOut.headlines.length < 3) fallbackOut.headlines = pad(fallbackOut.headlines, ["Thông tin chi tiết", "Liên hệ nhận tư vấn", GOOGLE_OBJECTIVES[p.objective].cta], 3);
  if (fallbackOut.descriptions.length < 2) fallbackOut.descriptions = pad(fallbackOut.descriptions, ["Xem chi tiết trên website.", "Liên hệ để được hỗ trợ nhanh."], 2);

  const pr = c.product ?? {};
  const facts = [
    `Sản phẩm / dịch vụ: ${c.subject}`, c.brand ? `Thương hiệu: ${c.brand}` : "", c.dna.company?.industry ? `Ngành: ${c.dna.company.industry}` : "",
    pr.summary ? `Điểm bán: ${pr.summary}` : "", Array.isArray(pr.sellingPoints) && pr.sellingPoints.length ? `Điểm nổi bật: ${pr.sellingPoints.join("; ")}` : "",
    pr.price ? `Giá: ${pr.price}` : "Giá: (không có — không được tự đưa giá)", pr.offer ? `Ưu đãi: ${pr.offer}` : "", pr.audience ? `Khách hàng mục tiêu: ${pr.audience}` : "",
    c.url ? `Trang đích: ${c.url}` : "",
  ].filter(Boolean);
  const res = await generate({
    bizId, agentKey: "ads", tier: "medium", schema: PlanOut,
    system: [
      "Bạn là chuyên viên Google Ads (mạng tìm kiếm) tại Việt Nam. Soạn 1 chiến dịch Search gồm 1 nhóm quảng cáo + 1 quảng cáo tìm kiếm thích ứng.",
      `MỤC TIÊU: ${OBJECTIVE_NOTE[p.objective]}`,
      `Quy tắc cứng: tiêu đề tối đa ${GOOGLE_AD_LIMITS.headline} ký tự, 6–10 tiêu đề KHÁC NHAU; mô tả tối đa ${GOOGLE_AD_LIMITS.description} ký tự, 3–4 mô tả; 8–15 từ khóa tiếng Việt có dấu mà khách thật sự gõ (2–5 từ, không dấu phẩy, không ký tự đặc biệt); path1/path2 tối đa ${GOOGLE_AD_LIMITS.path} ký tự, không dấu cách (có thể để trống).`,
      "Không dấu \"!\" trong tiêu đề, không emoji, không viết IN HOA cả từ. CHỈ dùng dữ kiện trong DỮ LIỆU: không bịa giá, số liệu, đánh giá, khuyến mãi, chứng nhận; không có giá thì không đưa giá. campaignName ngắn gọn, không dấu phẩy.",
      `Giọng thương hiệu: ${(c.dna.voice?.style ?? []).join(", ") || "rõ ràng, chuyên nghiệp"}. TUYỆT ĐỐI không nói: ${(c.dna.forbiddenClaims ?? []).join("; ") || "cam kết kết quả"}. Không dùng ký tự: ${c.banned.join(" ") || "—"}.`,
      "rationale: 1–2 câu giải thích vì sao bộ từ khóa / thông điệp này hợp với mục tiêu.",
    ].join("\n"),
    user: `DỮ LIỆU:\n${facts.join("\n")}${p.note ? `\n\nSẾP DẶN THÊM: ${p.note}` : ""}\n\nSoạn chiến dịch.`,
    sandbox: () => fallbackOut,
  });
  const o = res.output;
  const clean = (kind: "headline" | "description") => (t: string) => cleanAdText(t, kind, c.banned, c.keep);
  const notForbidden = (t: string) => !c.forbidden.some((f) => t.toLowerCase().includes(f));
  const headlines = uniq([...o.headlines.map(clean("headline")), ...base.headlines]).filter((t) => t.length >= 2 && notForbidden(t)).slice(0, 10);
  const descriptions = uniq([...o.descriptions.map(clean("description")), ...base.descriptions]).filter((t) => t.length >= 10 && notForbidden(t)).slice(0, 4);
  const aiKeywords = uniq(o.keywords.map((k) => fitText(k.replace(/[!@%,*^()={};~`<>?\\|"]/g, " "), GOOGLE_AD_LIMITS.keyword))).filter((k) => k.length >= 2 && notForbidden(k));
  const kwTexts = uniq([...aiKeywords, ...base.keywords.map((k) => k.text)]).slice(0, 15);
  const path = (t: string) => slug(t).slice(0, GOOGLE_AD_LIMITS.path);
  const path1 = path(o.path1);
  return {
    objective: p.objective, name: cleanAdText(o.campaignName, "description", c.banned, c.keep).replace(/,/g, " ").slice(0, 120) || defaultName(c, p.objective),
    finalUrl: c.url, keywords: kwTexts.flatMap((text, i): { text: string; match: GoogleMatch }[] => (i < 3 ? [{ text, match: "PHRASE" }, { text, match: "EXACT" }] : [{ text, match: "PHRASE" }])),
    headlines: headlines.length >= 3 ? headlines : fallbackOut.headlines, descriptions: descriptions.length >= 2 ? descriptions : fallbackOut.descriptions,
    path1, path2: path1 ? path(o.path2) : "", rationale: o.rationale.trim() || fallbackOut.rationale,
    source: res.model === "sandbox" ? "template" : "ai", model: res.model,
  };
}

// ---------------- Kiểm tra & tạo ----------------
function mustAccount(bizId: string, id: string): Row {
  const acc = byId<Row>("ad_account", id);
  if (!acc || acc.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy tài khoản quảng cáo", 404);
  if (acc.platform !== "google_ads") throw new AppError("NOT_SUPPORTED", "Đây không phải tài khoản Google Ads");
  if (acc.status !== "active") throw new AppError("INACTIVE", `Tài khoản "${acc.name}" đang không hoạt động`);
  if (!acc.whitelisted) throw new AppError("NOT_WHITELISTED", `Tài khoản "${acc.name}" không nằm trong whitelist`);
  return acc;
}
const sinceToday = () => `${today()}T00:00:00`;
function createdToday(bizId: string): number {
  return q.scalar<number>("SELECT COUNT(*) FROM ad_candidate WHERE biz_id = ? AND created_at >= ? AND status != 'rejected'", bizId, sinceToday())
    + q.scalar<number>("SELECT COUNT(*) FROM action WHERE biz_id = ? AND type = 'create_campaign' AND status = 'done' AND created_at >= ?", bizId, sinceToday());
}

/** Trần giá nhấp mặc định: 20% ngân sách ngày (làm tròn nghìn) — 1 lượt nhấp không ăn hết ngân sách nhỏ. */
export function defaultMaxCpc(dailyBudget: number): number {
  const r = Math.round((dailyBudget * 0.2) / 1000) * 1000;
  return r > 0 ? r : Math.round(dailyBudget * 0.2 * 100) / 100;
}

async function buildSpec(bizId: string, input: GoogleCampaignInput) {
  const acc = mustAccount(bizId, input.adAccountId);
  const { c } = connectorForAccount(acc.id, "google_ads");
  if (!c.createSearchCampaign || !c.validateSearchCampaign) throw new AppError("NOT_SUPPORTED", "Kết nối Google Ads này chưa hỗ trợ tạo chiến dịch");
  const tracking = c.hasConversionTracking ? await c.hasConversionTracking(acc.external_id) : false;
  const { bidding, note } = resolveGoogleBidding(input.objective, tracking);
  const finalUrl = normalizeUrl(input.finalUrl);
  const dna = (activeDna(bizId)?.data ?? {}) as Row;
  const banned = (dna.bannedChars ?? []) as string[];
  const spec: GoogleSearchCampaignSpec = {
    name: input.name?.trim() || `${today().replace(/-/g, "")}_${input.objective}_search`,
    accountExternalId: acc.external_id, dailyBudget: input.dailyBudget, startPaused: input.startPaused, objective: input.objective, bidding,
    // Trần giá nhấp: 20% ngân sách ngày (đủ cho vài lượt nhấp, không để 1 lượt nhấp ăn hết ngân sách nhỏ).
    maxCpc: bidding === "maximize_clicks" ? (input.maxCpc ?? defaultMaxCpc(input.dailyBudget)) : null,
    finalUrl: finalUrl || input.finalUrl,
    keywords: input.keywords.map((k) => ({ text: k.text.trim(), match: k.match as GoogleMatch })),
    headlines: input.headlines.map((t) => cleanAdText(t, "headline", banned, keepCaps(dna))), descriptions: input.descriptions.map((t) => cleanAdText(t, "description", banned, keepCaps(dna))),
    path1: input.path1 || undefined, path2: input.path2 || undefined,
  };
  return { acc, c, spec, bidding, biddingNote: note };
}

const asAppError = (e: unknown): AppError => {
  if (e instanceof AppError) return e;
  if (e instanceof ConnectorError) return new AppError(`GOOGLE_${e.kind.toUpperCase()}`, e.message, e.kind === "Transient" || e.kind === "RateLimited" ? 502 : e.kind === "AuthError" ? 401 : 400);
  return new AppError("GOOGLE_FAILED", e instanceof Error ? e.message : String(e), 400);
};

/** "Kiểm tra trước": Google kiểm toàn bộ chuỗi tạo chiến dịch mà KHÔNG tạo gì. Tài khoản demo → bỏ qua. */
export async function checkGoogleCampaign(bizId: string, raw: unknown) {
  const input = GoogleCampaignInput.parse(raw);
  const { acc, c, spec, bidding, biddingNote } = await buildSpec(bizId, input).catch((e) => { throw asAppError(e); });
  try { validateGoogleSearchSpec(spec); } catch (e) { return { ok: false, live: c.mode === "live", error: (e as Error).message, bidding }; }
  if (c.mode !== "live") return { ok: true, live: false, bidding, note: "Tài khoản demo: đã kiểm tra nội dung, không gọi Google." };
  try {
    await c.validateSearchCampaign!(spec);
    return { ok: true, live: true, bidding, note: `Google đã kiểm tra toàn bộ chiến dịch "${acc.name}": hợp lệ — chưa tạo gì.${biddingNote ? ` ${biddingNote}` : ""}` };
  } catch (e) {
    return { ok: false, live: true, bidding, error: asAppError(e).message };
  }
}

export async function createGoogleCampaign(bizId: string, raw: unknown, actor: string) {
  const input = GoogleCampaignInput.parse(raw);
  const acc0 = mustAccount(bizId, input.adAccountId);
  if (isKilled(bizId, "ads")) throw new AppError("KILLED", "Đang bật dừng khẩn cấp quảng cáo");
  const s = bizSettings(bizId);
  if (!input.startPaused && activeAdBudget(bizId) + input.dailyBudget > s.caps.maxTotalDailyAdBudget) throw new AppError("CAP_EXCEEDED", `Vượt trần tổng ngân sách ngày ${s.caps.maxTotalDailyAdBudget.toLocaleString("vi-VN")}đ`);
  if (createdToday(bizId) >= s.caps.maxAdsCreatedPerDay) throw new AppError("CAP_EXCEEDED", `Đã đạt giới hạn ${s.caps.maxAdsCreatedPerDay} lượt tạo quảng cáo/ngày (Cài đặt → Giới hạn)`);

  const { c, spec, bidding, biddingNote } = await buildSpec(bizId, input).catch((e) => { throw asAppError(e); });
  const key = `gcreate:${acc0.id}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const params = { platform: "google_ads", accountId: acc0.id, name: spec.name, objective: spec.objective, bidding, dailyBudget: spec.dailyBudget, startPaused: spec.startPaused, finalUrl: spec.finalUrl, keywords: spec.keywords.length, headlines: spec.headlines.length, descriptions: spec.descriptions.length, account: acc0.name, mode: c.mode };
  const res = await c.createSearchCampaign!(spec, key).catch((e) => {
    const err = asAppError(e);
    insert("action", { biz_id: bizId, actor, type: "create_campaign", target_type: "ad_account", target_id: acc0.id, params, before: {}, after: {}, status: "failed", reason: err.message, reversible: 0, idempotency_key: key });
    audit(bizId, actor, "ad.google_campaign_failed", { type: "ad_account", id: acc0.id }, { name: spec.name, error: err.message });
    throw err;
  });
  const status = res.status;
  const out = tx(() => {
    const campaign = q.get<Row>("SELECT id FROM campaign WHERE ad_account_id = ? AND external_id = ?", acc0.id, res.campaignExternalId)
      ?? insert("campaign", { biz_id: bizId, ad_account_id: acc0.id, platform: "google_ads", external_id: res.campaignExternalId, name: spec.name, objective: spec.objective, status, daily_budget: spec.dailyBudget, target_cpa: null });
    // Chiến dịch Google = 1 "quảng cáo" trong hệ thống (trạng thái, ngân sách ngày và số liệu đều nằm ở cấp chiến dịch).
    const ad = q.get<Row>("SELECT id FROM ad WHERE ad_account_id = ? AND external_id = ?", acc0.id, res.campaignExternalId)
      ?? insert("ad", { biz_id: bizId, ad_account_id: acc0.id, platform: "google_ads", external_id: res.campaignExternalId, campaign_id: campaign.id, name: spec.name, status, daily_budget: spec.dailyBudget, post_id: null, currency: acc0.currency,
        meta: { budgetOwnerId: res.campaignExternalId, channelType: "SEARCH", budgetResource: res.budgetResource, sharedBudget: false, objective: spec.objective, bidding, source: "taki_create", adGroupId: res.adGroupExternalId, adId: res.adExternalId } });
    const act = insert("action", { biz_id: bizId, actor, type: "create_campaign", target_type: "campaign", target_id: campaign.id, params: { ...params, campaignExternalId: res.campaignExternalId }, before: {}, after: { status, daily_budget: spec.dailyBudget }, status: "done", reason: `Chiến dịch Search · ${GOOGLE_OBJECTIVES[spec.objective].label}`, reversible: 0, idempotency_key: key });
    return { campaignId: campaign.id, adId: ad.id, actionId: act.id };
  });
  audit(bizId, actor, "ad.google_campaign_created", { type: "campaign", id: out.campaignId }, { name: spec.name, objective: spec.objective, bidding, budget: spec.dailyBudget, status, external: res.campaignExternalId });
  emit(bizId, "action.executed", { type: "create_campaign", target: spec.name });
  return { ...out, externalId: res.campaignExternalId, name: spec.name, status, bidding, mode: c.mode, note: biddingNote, account: acc0.name };
}

/** Một lệnh: soạn theo mục tiêu rồi tạo luôn (mặc định tạm dừng để Sếp xem lại trước khi bật). */
export async function autoCreateGoogleCampaign(bizId: string, raw: unknown, actor: string) {
  const p = GoogleAutoInput.parse(raw);
  mustAccount(bizId, p.adAccountId);
  const plan = await planGoogleCampaign(bizId, p);
  if (!plan.finalUrl) throw new AppError("NEED_INFO", "Chưa có URL trang đích: nhập URL, hoặc điền link sản phẩm / website trong DNA");
  const created = await createGoogleCampaign(bizId, {
    adAccountId: p.adAccountId, objective: p.objective, dailyBudget: p.dailyBudget, startPaused: p.startPaused, name: p.name || plan.name,
    finalUrl: plan.finalUrl, keywords: plan.keywords, headlines: plan.headlines, descriptions: plan.descriptions, path1: plan.path1 || undefined, path2: plan.path2 || undefined,
  }, actor);
  return { ...created, plan };
}

/** Lịch sử tạo chiến dịch Google (thành công và lỗi), mới nhất trước. */
export function recentGoogleCampaigns(bizId: string, limit = 20) {
  return q.all<Row>(
    `SELECT a.id, a.status, a.reason, a.params, a.created_at, ad.status ad_status, ad.daily_budget
       FROM action a LEFT JOIN ad ON ad.ad_account_id = json_extract(a.params, '$.accountId') AND ad.external_id = json_extract(a.params, '$.campaignExternalId')
      WHERE a.biz_id = ? AND a.type = 'create_campaign' AND json_extract(a.params, '$.platform') = 'google_ads'
      ORDER BY a.created_at DESC LIMIT ?`, bizId, limit);
}

/** Dữ liệu cho form: mục tiêu, sản phẩm trong DNA, website. */
export function googleCampaignOptions(bizId: string) {
  const dna = (activeDna(bizId)?.data ?? {}) as Row;
  return {
    objectives: (Object.keys(GOOGLE_OBJECTIVES) as GoogleObjective[]).map((key) => ({ key, ...GOOGLE_OBJECTIVES[key] })),
    products: dnaProducts(bizId).map((p) => ({ key: p.key, name: p.name, link: p.link ?? "", price: p.price ?? "" })),
    website: String(dna.company?.website ?? ""), brand: String(dna.company?.brand || dna.company?.name || ""),
    limits: { headline: GOOGLE_AD_LIMITS.headline, description: GOOGLE_AD_LIMITS.description, path: GOOGLE_AD_LIMITS.path },
  };
}
