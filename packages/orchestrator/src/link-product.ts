import { z } from "zod";
import { activeDna, audit, bizSettings, byId, q, update, type Row } from "@dotaka/db";
import { slugify, trackedUrlFor } from "./tracking.ts";

/**
 * Sản phẩm ↔ link dưới bình luận. KHÔNG có thực thể "sản phẩm affiliate": sản phẩm là mục `products[]` của DNA
 * (trang "Mục tiêu & DNA": `link`, tuỳ chọn `shortLink` / `commentText`). Bài nào thuộc sản phẩm nào được xác định theo thứ tự:
 *   1. goal.params.product        — Sếp chọn "Sản phẩm của chiến dịch" trên trang Kế hoạch
 *   2. goal.params.autopilot.product — chiến dịch do Lái tự động tạo
 *   3. creative_job của bài/video  — input.product (tên) của việc làm video
 *   4. (chỉ khi bật autoGuess)  tên / tên gọi khác của sản phẩm xuất hiện trong chữ của bài
 *   5. (chỉ khi bật fallbackMain) link chính (dna.cta.link)
 * Mặc định tự gắn chỉ khi có tín hiệu rõ (1–3) — đoán sai sản phẩm = link sai dưới bài công khai.
 */
export type LinkWhy = "campaign" | "autopilot" | "video" | "guess" | "main" | "manual";
export interface LinkProduct {
  key: string; name: string;
  /** Link sẽ gắn: shortLink > link (đã thêm https:// nếu thiếu); null = sản phẩm chưa có link. */
  url: string | null; link: string; shortLink: string; commentText: string; why: LinkWhy;
}

const vn = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();
export function fixUrl(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
const dnaProductRows = (bizId: string) => ((activeDna(bizId)?.data?.products ?? []) as Row[]).filter((p) => p?.name);
const keyOf = (p: Row) => String(p.key || slugify(String(p.name)));

function toLinkProduct(p: Row, why: LinkWhy): LinkProduct {
  const link = fixUrl(p.link);
  const shortLink = fixUrl(p.shortLink);
  return { key: keyOf(p), name: String(p.name), url: shortLink || link || null, link, shortLink, commentText: String(p.commentText ?? "").trim(), why };
}

/** Khớp 1 chuỗi (key / tên / tên gọi khác, không phân biệt dấu & hoa thường) với sản phẩm trong DNA. */
export function findLinkProduct(bizId: string, token: string | null | undefined, why: LinkWhy = "manual"): LinkProduct | null {
  const t = vn(String(token ?? ""));
  if (!t) return null;
  const hit = dnaProductRows(bizId).find((p) => keyOf(p) === t || vn(String(p.key ?? "")) === t || vn(String(p.name)) === t || slugify(String(p.name)) === t
    || ((p.aliases ?? []) as string[]).some((a) => vn(String(a)) === t));
  return hit ? toLinkProduct(hit, why) : null;
}

// ---------------- Cài đặt (không thuộc DNA) ----------------
export const LinkCommentSettings = z.object({
  /** Tự gắn link dưới bình luận sau khi đăng Facebook (khi biết sản phẩm). Gắn tay luôn dùng được. */
  auto: z.boolean().default(true),
  /** Đoán sản phẩm theo tên trong bài khi không có tín hiệu rõ (dễ gắn nhầm — mặc định TẮT). */
  autoGuess: z.boolean().default(false),
  /** Không biết sản phẩm: gắn link chính (CTA) của DNA (mặc định TẮT). */
  fallbackMain: z.boolean().default(false),
  /** Câu bình luận theo nền tảng (dùng {link} / {san_pham} / {shop}); trống = câu mặc định. */
  facebook: z.string().max(500).default(""),
  instagram: z.string().max(500).default(""),
  tiktok: z.string().max(500).default(""),
});
export type LinkCommentSettingsT = z.infer<typeof LinkCommentSettings>;
export function linkCommentSettings(bizId: string): LinkCommentSettingsT {
  const raw = (bizSettings(bizId) as unknown as Row).linkComment;
  const p = LinkCommentSettings.safeParse(raw && typeof raw === "object" ? raw : {});
  return p.success ? p.data : LinkCommentSettings.parse({});
}
export function saveLinkCommentSettings(bizId: string, patch: unknown, actor: string): LinkCommentSettingsT {
  const next = LinkCommentSettings.parse({ ...linkCommentSettings(bizId), ...(patch as object) });
  const raw = (q.get<Row>("SELECT settings FROM biz WHERE id = ?", bizId)?.settings ?? {}) as Row;
  update("biz", bizId, { settings: { ...raw, linkComment: next } });
  audit(bizId, actor, "settings.link_comment", { type: "biz", id: bizId }, { auto: next.auto, autoGuess: next.autoGuess, fallbackMain: next.fallbackMain });
  return next;
}

// ---------------- Chữ bình luận ----------------
/** Câu mặc định: Facebook có link bấm được; Instagram KHÔNG (link trong bình luận không bấm được, và không hứa nhắn tin); TikTok không có. */
const DEFAULT_TEXT: Record<string, string> = {
  facebook: "Link {san_pham} & ưu đãi: {link}",
  instagram: "Link sản phẩm ở bio của {shop} 👆",
  tiktok: "Link sản phẩm: {link}",
};
export function linkCommentText(bizId: string, platform: string | undefined, vars: { link: string; product?: string; shop?: string }, productText?: string): string {
  const custom = (productText || String(linkCommentSettings(bizId)[(platform ?? "facebook") as "facebook"] ?? "")).trim();
  const tpl = custom || DEFAULT_TEXT[platform ?? "facebook"] || DEFAULT_TEXT.facebook;
  const fill = (s: string) => s.replaceAll("{link}", vars.link).replaceAll("{san_pham}", vars.product ?? "sản phẩm").replaceAll("{shop}", vars.shop || "Trang");
  const out = fill(tpl);
  // Câu tuỳ chỉnh không có {link} → thêm link cuối (trừ Instagram: link không bấm được, chữ mặc định không cần link).
  return custom && !tpl.includes("{link}") && platform !== "instagram" ? `${out} ${vars.link}`.trim() : out;
}

// ---------------- Sản phẩm của 1 nội dung / bài ----------------
function goalOf(ci: Row): Row | undefined {
  if (ci.goal_id) return byId<Row>("goal", ci.goal_id);
  // Video làm từ 1 kịch bản: chiến dịch của kịch bản gốc.
  const job = q.get<Row>("SELECT source_content_id FROM creative_job WHERE content_item_id = ? ORDER BY created_at DESC LIMIT 1", ci.id);
  const src = job?.source_content_id ? byId<Row>("content_item", job.source_content_id) : undefined;
  return src?.goal_id ? byId<Row>("goal", src.goal_id) : undefined;
}

/**
 * Sản phẩm của 1 nội dung (content_item) theo thứ tự ở đầu file. `opts.explicitOnly` = chỉ tín hiệu rõ (1–3) — dùng cho tự gắn.
 * Trả null khi không biết sản phẩm.
 */
export function productForContent(ci: Row | undefined, opts: { explicitOnly?: boolean } = {}): LinkProduct | null {
  if (!ci) return null;
  const bizId = ci.biz_id as string;
  const goal = goalOf(ci);
  const params = (goal?.params ?? {}) as Row;
  const fromCampaign = findLinkProduct(bizId, params.product, "campaign");
  if (fromCampaign) return fromCampaign;
  const fromAuto = findLinkProduct(bizId, params.autopilot?.product, "autopilot");
  if (fromAuto) return fromAuto;
  const job = q.get<Row>("SELECT input FROM creative_job WHERE content_item_id = ? OR source_content_id = ? ORDER BY created_at DESC LIMIT 1", ci.id, ci.id);
  const fromVideo = findLinkProduct(bizId, job?.input?.product, "video");
  if (fromVideo) return fromVideo;
  if (opts.explicitOnly) return null;
  const st = linkCommentSettings(bizId);
  if (st.autoGuess) {
    const hay = vn(`${ci.title ?? ""} ${ci.body ?? ""}`);
    const hit = dnaProductRows(bizId).find((p) => [p.name, ...((p.aliases ?? []) as string[])].some((a) => a && hay.includes(vn(String(a)))));
    if (hit) return toLinkProduct(hit, "guess");
  }
  if (st.fallbackMain) {
    const cta = fixUrl(activeDna(bizId)?.data?.cta?.link);
    if (cta) return { key: "main", name: String(activeDna(bizId)?.data?.company?.brand || activeDna(bizId)?.data?.company?.name || "sản phẩm"), url: cta, link: cta, shortLink: "", commentText: "", why: "main" };
  }
  return null;
}
export function productForPost(post: Row, opts: { explicitOnly?: boolean } = {}): LinkProduct | null {
  const ci = post.content_item_id ? byId<Row>("content_item", post.content_item_id) : undefined;
  return productForContent(ci, opts);
}

/** Link (có UTM / mã đo) sẽ nằm trong bình luận của 1 sản phẩm dưới 1 bài / nội dung. */
export function productCommentUrl(o: { bizId: string; product: Pick<LinkProduct, "key" | "url">; platform: string; postId?: string | null; contentItemId?: string | null; goalId?: string | null; urlOverride?: string }): string {
  const url = o.urlOverride ?? o.product.url ?? "";
  return trackedUrlFor({ bizId: o.bizId, url, postId: o.postId, contentItemId: o.contentItemId, goalId: o.goalId, productKey: o.product.key, channel: o.platform });
}

/** Bình luận hoàn chỉnh (chữ + link) của 1 sản phẩm cho kênh — dùng cho gắn tự động / xem trước. */
export function commentFor(o: { bizId: string; product: LinkProduct; channel: Row; post?: Row; ci?: Row; urlOverride?: string; textOverride?: string }): { text: string; url: string } {
  const url = productCommentUrl({ bizId: o.bizId, product: o.product, platform: o.channel.platform, postId: o.post?.id, contentItemId: o.ci?.id ?? o.post?.content_item_id, goalId: o.ci?.goal_id, urlOverride: o.urlOverride });
  const text = o.textOverride?.trim()
    ? (o.textOverride.includes("{link}") ? o.textOverride.replaceAll("{link}", url) : `${o.textOverride.trim()} ${url}`)
    : linkCommentText(o.bizId, o.channel.platform, { link: url, product: o.product.name, shop: String(o.channel.name ?? "") }, o.product.commentText);
  return { text, url };
}
