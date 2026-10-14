import { audit, byId, emit, insert, isKilled, q, update, type Row } from "@dotaka/db";
import { ConnectorError } from "@dotaka/connectors";
import { AppError, nowIso } from "@dotaka/shared";
import { browserPublish, browserReady, publishChannelFor } from "./browser-publish.ts";
import { connectorForChannel } from "./connections.ts";
import { commentFor, fixUrl, linkCommentSettings, linkCommentText, productForContent, productForPost, findLinkProduct, type LinkProduct } from "./link-product.ts";
import { browserFailedBeforePosting, permanentIfFinal } from "./publishing.ts";
import { PermanentError, enqueue } from "./queue.ts";

/**
 * "Gắn link dưới bình luận": bình luận đầu tiên dưới bài, chứa link sản phẩm (DNA `products[]`).
 *  - Tự động: sau khi đăng Facebook, khi biết sản phẩm của bài (job posts.comment_link, chạy sau 30–60 giây).
 *  - Thủ công: trang Đăng bài → "Gắn link / Gắn lại" cho mọi bài, kể cả bài CÓ SẴN trên Fanpage.
 * Chống bình luận trùng (công khai, không thu hồi): trước khi gửi ghi post.meta.linkComment = {state:"sending"}; gửi xong mới
 * ghi "done" + dòng post_comment. Job gặp "sending" quá 2 phút (máy sập giữa chừng) KHÔNG gửi lại mà báo "cần kiểm tra".
 * Facebook không cho ghim bình luận qua API — Sếp ghim tay nếu muốn. Instagram: link trong bình luận không bấm được → chữ
 * mặc định hướng về link ở bio (không hứa nhắn tin). TikTok: không có API bình luận → chỉ Chrome, mặc định không tự gắn.
 */
export type LinkCommentState = "attached" | "pending" | "failed" | "needs_check" | "skipped" | "none";
type Meta = { state: "sending" | "done" | "failed" | "needs_check" | "skipped"; at: string; text?: string; error?: string; via?: string };
const SENDING_STALE_MS = 2 * 60_000;
export const LINK_LABEL = "product_link";

const metaOf = (post: Row): Meta | null => (post.meta?.linkComment ?? null) as Meta | null;
function setMeta(postId: string, m: Meta | null) {
  const p = byId<Row>("post", postId);
  update("post", postId, { meta: { ...(p?.meta ?? {}), linkComment: m } });
}
const isApiPostId = (id: unknown) => Boolean(id) && !/^(https?:|chrome:|browser:)/i.test(String(id));

/** Kênh này bình luận được bằng cách nào: API của kênh, Chrome đã đăng nhập, hay không có. */
export function commentRoute(channel: Row, post: Row): "api" | "browser" | "none" {
  const c = connectorForChannel(channel);
  if (c.mode === "live" && c.postComment && isApiPostId(post.external_id)) return "api";
  if (browserReady(channel).ok && post.permalink) return "browser";
  return "none";
}
/** Nền tảng nào được TỰ gắn link sau khi đăng (gắn tay: mọi nền tảng). */
export const autoLinkPlatform = (platform: string) => platform === "facebook";

// ---------------- Trạng thái (cho giao diện) ----------------
export function linkCommentStatus(post: Row) {
  const fresh = byId<Row>("post", post.id) ?? post;
  const ci = fresh.content_item_id ? byId<Row>("content_item", fresh.content_item_id) : undefined;
  const channel = byId<Row>("channel", fresh.channel_id);
  const settings = linkCommentSettings(fresh.biz_id);
  const product = productForPost(fresh);
  const auto = Boolean(product?.url) && settings.auto && autoLinkPlatform(channel?.platform ?? "");
  const base = {
    auto, product: product ? { key: product.key, name: product.name, url: product.url, why: product.why, hasLink: Boolean(product.url) } : null,
    route: channel ? commentRoute(channel, fresh) : "none",
  };
  const done = q.get<Row>("SELECT text, created_at FROM post_comment WHERE post_id = ? AND label = ? ORDER BY created_at DESC LIMIT 1", fresh.id, LINK_LABEL);
  const m = metaOf(fresh);
  if (m?.state === "sending") {
    const age = Date.now() - Date.parse(m.at);
    return age > SENDING_STALE_MS
      ? { ...base, state: "needs_check" as LinkCommentState, error: "Lần gắn trước bị gián đoạn — có thể đã có bình luận. Mở bài kiểm tra rồi bấm Gắn lại nếu chưa có.", at: m.at }
      : { ...base, state: "pending" as LinkCommentState };
  }
  if (m?.state === "needs_check") return { ...base, state: "needs_check" as LinkCommentState, error: m.error ?? "Có thể đã có bình luận — kiểm tra trên kênh.", at: m.at };
  if (done && m?.state !== "failed") return { ...base, state: "attached" as LinkCommentState, text: done.text as string, at: done.created_at as string };
  const job = q.get<Row>("SELECT status FROM job WHERE idempotency_key = ?", `cmtlink:${fresh.id}`);
  if (job && ["queued", "running"].includes(job.status)) return { ...base, state: "pending" as LinkCommentState };
  if (m?.state === "failed") return { ...base, state: "failed" as LinkCommentState, error: m.error ?? "Không rõ lỗi", at: m.at, ...(done ? { text: done.text as string } : {}) };
  if (m?.state === "skipped") return { ...base, state: "skipped" as LinkCommentState, error: m.error, at: m.at };
  return { ...base, state: "none" as LinkCommentState };
}

// ---------------- Gửi 1 bình luận ----------------
async function sendComment(post: Row, channel: Row, text: string, idemKey: string): Promise<{ via: "api" | "browser"; externalId?: string; permalink?: string }> {
  const route = commentRoute(channel, post);
  if (route === "api") {
    const r = await connectorForChannel(channel).postComment!({ postExternalId: post.external_id, text }, idemKey);
    return { via: "api", externalId: r.externalId, permalink: r.permalink };
  }
  if (route === "browser") {
    const r = await browserPublish(channel, { text: "", mode: "comment", comment: text, postUrl: post.permalink, tag: `cmt-${post.id}-${Date.now().toString(36)}` });
    return { via: "browser", permalink: r.permalink };
  }
  throw new AppError("NO_COMMENT_ROUTE", `${channel.platform} không có API bình luận — thiết lập "Đăng qua Chrome" ở trang Kênh đăng để gắn link`);
}

/** Đã có lần gắn đang chạy / có thể đã gửi mà chưa ghi nhận? → lý do chặn tự động (null = được gửi). */
function inFlightBlock(post: Row, manual: boolean): string | null {
  const m = metaOf(post);
  if (m?.state === "sending") {
    if (Date.now() - Date.parse(m.at) <= SENDING_STALE_MS) return "Đang gắn link dưới bài này — chờ vài giây";
    setMeta(post.id, { state: "needs_check", at: nowIso(), text: m.text, error: "Lần gắn trước bị gián đoạn giữa chừng — có thể đã có bình luận" });
    emit(post.biz_id, "alert.raised", { level: "warning", text: `Bài "${post.title}": lần gắn link trước bị gián đoạn — có thể đã có bình luận. Kiểm tra bài rồi bấm Gắn lại nếu chưa có.`, category: "publish", key: `cmtlink:${post.id}`, href: "/publish" });
    audit(post.biz_id, "publishing", "post.comment_link.needs_check", { type: "post", id: post.id }, { reason: "interrupted" });
    return manual ? null : "Lần gắn trước bị gián đoạn — cần Sếp kiểm tra";
  }
  if (m?.state === "needs_check" && !manual) return "Có thể đã có bình luận — cần Sếp kiểm tra";
  return null;
}

async function deliver(post: Row, channel: Row, text: string, o: { manual: boolean; actor: string; idemKey: string; url: string; productKey?: string | null }) {
  setMeta(post.id, { state: "sending", at: nowIso(), text });
  let r: { via: "api" | "browser"; externalId?: string; permalink?: string };
  try {
    r = await sendComment(post, channel, text, o.idemKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const unknown = e instanceof ConnectorError ? (e.kind === "Transient" || Boolean((e as { outcomeUnknown?: boolean }).outcomeUnknown))
      : e instanceof AppError && e.code !== "NO_COMMENT_ROUTE" && !browserFailedBeforePosting(e);
    if (unknown) {
      // Có thể ĐÃ bình luận (mạng / agent dừng giữa chừng): không bao giờ gửi lại tự động.
      setMeta(post.id, { state: "needs_check", at: nowIso(), text, error: `Có thể đã có bình luận — kiểm tra trên kênh (${msg})` });
      audit(post.biz_id, o.actor, "post.comment_link.needs_check", { type: "post", id: post.id }, { error: msg, manual: o.manual });
      emit(post.biz_id, "alert.raised", { level: "warning", text: `Bài "${post.title}": không rõ link đã được gắn chưa — kiểm tra bài trên ${channel.name}.`, category: "publish", key: `cmtlink:${post.id}`, href: "/publish" });
      throw o.manual ? new AppError("COMMENT_UNKNOWN", `Không rõ link đã được gắn chưa — kiểm tra bài trên kênh trước khi gắn lại (${msg})`, 502) : new PermanentError(msg);
    }
    setMeta(post.id, { state: "failed", at: nowIso(), text, error: msg });
    audit(post.biz_id, o.actor, "post.comment_link.failed", { type: "post", id: post.id }, { error: msg, manual: o.manual });
    // Hết hạn token / thiếu quyền → đánh dấu kết nối + báo khẩn (cùng cách với đăng bài).
    const final = permanentIfFinal(e, channel);
    if (e instanceof AppError && e.code === "NO_COMMENT_ROUTE") {
      if (!o.manual) emit(post.biz_id, "alert.raised", { level: "warning", text: `Chưa gắn được link dưới bài "${post.title}" (${channel.platform}). Thiết lập Đăng qua Chrome ở trang Kênh đăng, hoặc bấm Gắn link ở trang Đăng bài.`, category: "publish", key: `cmtlink:${post.id}`, href: "/publish" });
      throw e;
    }
    if (final instanceof PermanentError && !o.manual) emit(post.biz_id, "alert.raised", { level: "warning", text: `Gắn link dưới bài "${post.title}" lỗi: ${final.message} — xem trang Đăng bài để gắn lại.`, category: "publish", key: `cmtlink:${post.id}`, href: "/publish" });
    if (o.manual) throw e instanceof AppError ? e : new AppError("COMMENT_FAILED", `Không gắn được link: ${msg}`);
    // Yêu cầu CHẮC CHẮN chưa tới máy chủ (ECONNREFUSED…) → hàng đợi được thử lại; còn lại là lỗi cố định.
    if (e instanceof ConnectorError && (e as { requestNotSent?: boolean }).requestNotSent) throw e;
    throw final;
  }
  insert("post_comment", { biz_id: post.biz_id, post_id: post.id, author: channel.name, text, label: LINK_LABEL, label_source: "system", label_confidence: 1, hidden: 0 });
  setMeta(post.id, { state: "done", at: nowIso(), text, via: r.via });
  audit(post.biz_id, o.actor, "post.comment_link", { type: "post", id: post.id }, { manual: o.manual, url: o.url, productKey: o.productKey ?? null, via: r.via, commentExternalId: r.externalId ?? null, permalink: r.permalink ?? null });
  emit(post.biz_id, "post.comment_linked", { postId: post.id, url: o.url });
  return r;
}

// ---------------- Tự động (job posts.comment_link) ----------------
function skip(post: Row, reason: string) {
  setMeta(post.id, { state: "skipped", at: nowIso(), error: reason });
  audit(post.biz_id, "publishing", "post.comment_link.skipped", { type: "post", id: post.id }, { reason });
}

/** Job: gắn link sản phẩm của bài vừa đăng. Chỉ khi biết sản phẩm; không bao giờ bình luận 2 lần. */
export async function attachProductLinkComment(postId: string) {
  const post = byId<Row>("post", postId);
  if (!post) return;
  if (q.get("SELECT id FROM post_comment WHERE post_id = ? AND label = ?", postId, LINK_LABEL)) return; // đã gắn
  if (isKilled(post.biz_id, "publish")) return skip(post, "Kill switch đăng bài đang bật");
  const blocked = inFlightBlock(post, false);
  if (blocked) return;
  const channel = byId<Row>("channel", post.channel_id);
  if (!channel) return;
  const ci = post.content_item_id ? byId<Row>("content_item", post.content_item_id) : undefined;
  const product = productForContent(ci);
  if (!ci || !product) return skip(post, "Chưa biết bài thuộc sản phẩm nào — chọn sản phẩm của chiến dịch hoặc bấm Gắn link");
  if (!product.url) return skip(post, `Sản phẩm "${product.name}" chưa có link — thêm ở Mục tiêu & DNA`);
  const { text, url } = commentFor({ bizId: post.biz_id, product, channel, post, ci });
  await deliver(post, channel, text, { manual: false, actor: "publishing", idemKey: `cmtlink:${postId}`, url, productKey: product.key });
}

/** Có nên xếp job gắn link tự động cho bài vừa đăng không (và cho sản phẩm nào). */
export function autoLinkPlan(ci: Row | undefined, channel: Row): { product: LinkProduct } | null {
  if (!ci || !autoLinkPlatform(channel.platform)) return null;
  if (!linkCommentSettings(ci.biz_id).auto) return null;
  const product = productForContent(ci);
  return product?.url ? { product } : null;
}
/**
 * Xem trước (cho hộp Duyệt): nội dung này, sau khi đăng, sẽ được TỰ gắn bình luận gì — để Sếp thấy trước khi duyệt.
 * Không tạo mã đo / không ghi gì. null = sẽ không tự gắn (không biết sản phẩm, tắt tự gắn, kênh không phải Facebook).
 */
export function linkCommentPreview(ci: Row | undefined) {
  if (!ci?.channel) return null;
  const channel = publishChannelFor(ci.biz_id, ci.channel);
  if (!channel) return null;
  const plan = autoLinkPlan(ci, channel);
  if (!plan) return null;
  const { product } = plan;
  const text = linkCommentText(ci.biz_id, channel.platform, { link: product.url!, product: product.name, shop: String(channel.name ?? "") }, product.commentText);
  return { product: { key: product.key, name: product.name, why: product.why }, url: product.url, text, channel: channel.name };
}

/** Xếp job tự gắn link 30–60 giây sau khi đăng (bình luận ngay tức thì dễ bị Facebook coi là spam). */
export function queueAutoLinkComment(post: Row, channel: Row) {
  const jitter = 30_000 + Math.floor(Math.random() * 30_000);
  return enqueue("publish", "posts.comment_link", { postId: post.id }, {
    bizId: post.biz_id, runAt: new Date(Date.now() + jitter), idempotencyKey: `cmtlink:${post.id}`, maxAttempts: 2,
    lockKey: commentRoute(channel, post) === "browser" ? "flow-chrome" : undefined,
  });
}
/** Chữ bình luận cho phiên Chrome đăng bài (agent bình luận ngay trong phiên). Chỉ Facebook + biết sản phẩm. */
export function linkCommentForPublish(ci: Row, channel: Row): { text: string; url: string; product: LinkProduct } | null {
  const plan = autoLinkPlan(ci, channel);
  if (!plan) return null;
  const c = commentFor({ bizId: ci.biz_id, product: plan.product, channel, ci });
  return { ...c, product: plan.product };
}
/**
 * Chrome đã đăng bài và trong cùng phiên đã bình luận (commentPosted=true) → ghi nhận; ngược lại báo rõ "chưa gắn" (KHÔNG tự
 * thử lại: agent có thể đã bình luận mà quên báo → bình luận trùng công khai; Sếp bấm Gắn lại sau khi kiểm tra).
 */
export function recordBrowserComment(post: Row, channel: Row, c: { text: string; url: string; product: LinkProduct }, r: { commentPosted: boolean; notes?: string }) {
  if (r.commentPosted) {
    insert("post_comment", { biz_id: post.biz_id, post_id: post.id, author: channel.name, text: c.text, label: LINK_LABEL, label_source: "system", label_confidence: 1, hidden: 0 });
    setMeta(post.id, { state: "done", at: nowIso(), text: c.text, via: "browser" });
    audit(post.biz_id, "publishing", "post.comment_link", { type: "post", id: post.id }, { via: "browser", url: c.url, productKey: c.product.key });
    emit(post.biz_id, "post.comment_linked", { postId: post.id, url: c.url });
    return;
  }
  const why = `Chrome đã đăng bài nhưng chưa xác nhận gắn được link dưới bình luận${r.notes ? ` (${String(r.notes).slice(0, 200)})` : ""} — mở bài kiểm tra rồi bấm Gắn lại`;
  setMeta(post.id, { state: "failed", at: nowIso(), text: c.text, error: why });
  audit(post.biz_id, "publishing", "post.comment_link.failed", { type: "post", id: post.id }, { error: why });
  emit(post.biz_id, "alert.raised", { level: "warning", text: `Bài "${post.title}" trên ${channel.name}: ${why}.`, category: "publish", key: `cmtlink:${post.id}`, href: "/publish" });
}

// ---------------- Thủ công ----------------
/**
 * Gắn link dưới bài (gắn tay / gắn lại). Nguồn link: `url` nhập tay > `productKey` (sản phẩm DNA) > sản phẩm của bài.
 * `text` có thể chứa {link}; không có thì link được thêm cuối. Gắn lại = bình luận THÊM (bình luận cũ không bị xoá).
 */
export async function attachLinkComment(bizId: string, postId: string, opts: { url?: string; text?: string; productKey?: string }, actor: string) {
  const post = byId<Row>("post", postId);
  if (!post || post.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy bài", 404);
  const channel = byId<Row>("channel", post.channel_id)!;
  const ci = post.content_item_id ? byId<Row>("content_item", post.content_item_id) : undefined;
  let product: LinkProduct | null = null;
  if (opts.productKey) {
    product = findLinkProduct(bizId, opts.productKey);
    if (!product) throw new AppError("BAD_PRODUCT", "Sản phẩm không có trong Mục tiêu & DNA", 400);
  } else if (!opts.url?.trim()) product = productForPost(post);
  const manualUrl = opts.url?.trim() ? fixUrl(opts.url) : "";
  if (opts.url?.trim() && !/^https?:\/\/\S+$/i.test(opts.url.trim())) throw new AppError("BAD_LINK", "Link phải bắt đầu bằng http:// hoặc https://");
  const target = manualUrl || product?.url || "";
  if (!target) throw new AppError("NO_LINK", product ? `Sản phẩm "${product.name}" chưa có link — thêm ở Mục tiêu & DNA hoặc nhập link` : "Bài này chưa biết thuộc sản phẩm nào — chọn sản phẩm hoặc nhập link cần gắn");
  const block = inFlightBlock(post, true);
  if (block) throw new AppError("IN_FLIGHT", block, 409);
  const prod: LinkProduct = product ?? { key: "manual", name: ci?.title ?? "sản phẩm", url: target, link: target, shortLink: "", commentText: "", why: "manual" };
  const custom = opts.text?.trim();
  const { text, url } = commentFor({ bizId, product: prod, channel, post, ci, urlOverride: manualUrl || undefined, textOverride: custom || undefined });
  if (text.length > 1500) throw new AppError("TOO_LONG", "Bình luận quá dài (tối đa 1500 ký tự)");
  const r = await deliver(post, channel, text, { manual: true, actor, idemKey: `cmtlink-manual:${postId}:${Date.now()}`, url: target, productKey: product?.key ?? null });
  return { ok: true, text, url, via: r.via, permalink: r.permalink ?? post.permalink ?? null };
}
