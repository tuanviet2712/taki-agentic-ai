import { audit, bizSettings, byId, emit, insert, isKilled, q, tx, update, type Row } from "@dotaka/db";
import { ConnectorError, type WebArticle } from "@dotaka/connectors";
import { COMMENT_LABELS, commentHeuristic, commentQuestions, judge, norm, postFitHeuristic, postFitQuestions, recordDecision } from "@dotaka/jev";
import { FORMULA_VERSION, scorePost } from "@dotaka/scoring";
import { AppError, logger, maskPhonesInText, nowIso, seeded } from "@dotaka/shared";
import { PermanentError, enqueue } from "./queue.ts";
import { browserPublish, browserReady, chromeLock, publishChannelFor, publishRoute, routeReason } from "./browser-publish.ts";
import { autoLinkPlan, linkCommentForPublish, queueAutoLinkComment, recordBrowserComment } from "./comment-link.ts";
import { connectorForChannel } from "./connections.ts";
import { publicMediaUrl } from "./public-media.ts";
import { bindTrackLink } from "./tracking.ts";
import { nextSlotAt, postingSlots } from "./schedule-slots.ts";
import { existsSync } from "node:fs";
import { publicTitle } from "./post-image.ts";
import { isSeoArticle, seoSlug } from "./seo-images.ts";
import { seoArticleParts, seoBodyHtml } from "./seo-export.ts";

/**
 * Độ dài 1 "giờ nền tảng" tính lúc dùng. Mặc định = GIỜ THẬT (Full ads không còn đăng mô phỏng); chỉ khi đặt rõ
 * TIME_SCALE_SECONDS (chạy thử nén thời gian) mới nén.
 */
export function hourMs(_bizId?: string): number {
  const scale = Number(process.env.TIME_SCALE_SECONDS);
  return Number.isFinite(scale) && scale > 0 ? scale * 1000 : 3_600_000;
}
/** @deprecated giữ để tương thích — dùng hourMs(). */
export const HOUR_MS = hourMs();

// ---------------- 9.5 Publishing ----------------
export const SCRIPT_NOT_PUBLISHABLE_MSG = "Kịch bản cần làm thành video trước — vào Sản xuất video bấm \"Làm video\", duyệt video rồi mới đăng";
/**
 * Nội dung có đăng công khai được không. Kịch bản video (video_script) chỉ là chữ "HOOK / [0-4s]…" → chỉ đăng khi đã có
 * video thành phẩm đi kèm (publishText lấy phần Caption); video phải có tệp (asset). Trả lý do tiếng Việt, null = đăng được.
 */
export function publishBlockReason(ci: Row): string | null {
  if (ci.kind === "video_script" && !ci.asset_id) return SCRIPT_NOT_PUBLISHABLE_MSG;
  if (ci.kind === "video" && !ci.asset_id) return "Video chưa có tệp thành phẩm — làm lại video rồi mới đăng";
  return null;
}
/** Chặn ở API "Đăng ngay": lỗi 400 rõ ràng thay vì xếp lượt đăng rồi mới báo lỗi. */
export function assertPublishable(ci: Row) {
  const why = publishBlockReason(ci);
  if (why) throw new AppError("NOT_PUBLISHABLE", why, 400);
}

export function schedulePublish(bizId: string, contentItemId: string, opts: { now?: boolean } = {}) {
  const ci = byId<Row>("content_item", contentItemId);
  if (!ci) throw new PermanentError("content_item not found");
  const blocked = publishBlockReason(ci);
  if (blocked) throw new PermanentError(blocked);
  const channel = publishChannelFor(bizId, ci.channel); // ưu tiên "kênh đăng chính"
  if (!channel) {
    update("content_item", ci.id, { status: "manual_publish" }); // manual fallback package
    return null;
  }
  const s = bizSettings(bizId);
  const HOUR = hourMs(bizId);
  let when: Date;
  if (opts.now) when = new Date();
  else {
    // Next slot with room under maxPostsPerDayPerChannel.
    const today = q.scalar<number>("SELECT COUNT(*) FROM publish_job WHERE channel_id = ? AND scheduled_at >= ?", channel.id, new Date(Date.now() - 24 * 3600_000).toISOString());
    const slots = postingSlots(bizId); // khung giờ đăng (cài đặt postingSlots ← đề xuất học từ số liệu)
    const idx = Math.min(today, slots.length - 1);
    const waiting = () => q.scalar<number>("SELECT COUNT(*) FROM publish_job WHERE channel_id = ? AND mode != 'draft' AND status = 'scheduled' AND scheduled_at > ?", channel.id, nowIso()) ?? 0;
    when = today >= s.caps.maxPostsPerDayPerChannel ? new Date(Date.now() + 24 * HOUR)
      : HOUR >= 3600_000 ? nextSlotAt(slots, new Date(), waiting()) // giờ thật → khung giờ kế tiếp còn trống
      : new Date(Date.now() + (idx + 1) * HOUR * 0.5); // chạy thử nén thời gian
  }
  const job = insert("publish_job", { biz_id: bizId, content_item_id: ci.id, channel_id: channel.id, scheduled_at: when.toISOString(), status: "scheduled", idempotency_key: `pub:${ci.id}:${channel.id}` });
  update("content_item", ci.id, { status: "scheduled", scheduled_at: when.toISOString() });
  enqueue("publish", "publish.run", { publishJobId: job.id }, { bizId, runAt: when, idempotencyKey: `pubrun:${job.id}`, lockKey: chromeLock(channel) });
  audit(bizId, "publishing", "publish.scheduled", { type: "content_item", id: ci.id }, { at: when.toISOString(), channel: channel.name });
  return job;
}

/**
 * Bộ canh lượt đăng (5 phút/lần, index.ts): lượt "đã lên lịch" đã quá giờ ≥ 10 phút mà không còn job nào sẽ chạy nó (job mất
 * khi máy chủ khởi động lại / lỗi hàng đợi) → xếp đăng lại. Lượt "đang đăng / đang xác minh" bị bỏ dở ≥ 15 phút KHÔNG đăng lại
 * (có thể đã lên kênh) mà chuyển "Cần kiểm tra kênh" để Sếp xem — không bao giờ đăng trùng.
 */
export function recoverStuckPublishing(): { requeued: number; needsCheck: number } {
  const live = (id: string) => Boolean(q.get("SELECT id FROM job WHERE status IN ('queued','running') AND name IN ('publish.run','publish.draft') AND json_extract(payload, '$.publishJobId') = ?", id));
  let requeued = 0, needsCheck = 0;
  for (const j of q.all<Row>("SELECT * FROM publish_job WHERE status = 'scheduled' AND scheduled_at < ?", new Date(Date.now() - 10 * 60_000).toISOString())) {
    if (live(j.id)) continue;
    const channel = byId<Row>("channel", j.channel_id);
    if (!channel) continue;
    if (j.mode === "draft") enqueue("publish", "publish.draft", { publishJobId: j.id }, { bizId: j.biz_id, idempotencyKey: `draftrun:${j.id}:recover:${Date.now()}`, lockKey: chromeLock(channel, "draft") });
    else enqueuePublishNow(j.biz_id, j, `recover:${Date.now()}`);
    audit(j.biz_id, "publishing", "publish.requeued", { type: "publish_job", id: j.id }, { reason: "no_live_job" });
    requeued++;
  }
  for (const j of q.all<Row>("SELECT * FROM publish_job WHERE status IN ('posting','verifying') AND updated_at < ?", new Date(Date.now() - 15 * 60_000).toISOString())) {
    if (live(j.id)) continue;
    markNeedsCheck(j, "lượt đăng bị gián đoạn giữa chừng (máy chủ khởi động lại)");
    needsCheck++;
  }
  return { requeued, needsCheck };
}

/** Đăng ngay 1 publish_job đã có (nút "Đăng ngay") — giữ khóa Chrome nếu kênh đăng qua Chrome. */
export function enqueuePublishNow(bizId: string, job: Row, attempt?: string) {
  const channel = byId<Row>("channel", job.channel_id);
  return enqueue("publish", "publish.run", { publishJobId: job.id }, { bizId, idempotencyKey: `pubnow:${job.id}${attempt ? `:${attempt}` : ""}`, lockKey: channel ? chromeLock(channel) : undefined });
}

/** Local media file of a content item (finished video / image), for API uploads and Chrome file pickers. */
export function mediaOf(ci: Row): { path: string; mime: string; publicUrl?: string } | undefined {
  const asset = ci.asset_id ? byId<Row>("creative_asset", ci.asset_id) : undefined;
  if (!asset?.path || !existsSync(asset.path)) return undefined;
  // publicUrl: link công khai ký sẵn (/m/<token>) — chỉ khi có PUBLIC_BASE_URL + cổng công khai đang chạy; Instagram cần nó.
  const publicUrl = publicMediaUrl(asset.id);
  return { path: asset.path, mime: asset.mime ?? (asset.kind === "video" ? "video/mp4" : "image/jpeg"), ...(publicUrl ? { publicUrl } : {}) };
}

/**
 * Bài cho kênh website: bài SEO → tiêu đề, thân HTML (ảnh trong <figure> có alt, chú thích), meta description, slug theo từ khoá,
 * ảnh trong bài (connector tải lên rồi thay link; ảnh đầu = ảnh đại diện). Nội dung khác → tiêu đề + các đoạn văn.
 */
export async function websiteArticle(ci: Row, text: string): Promise<WebArticle> {
  if (isSeoArticle(ci)) {
    const p = seoArticleParts(ci);
    return { title: p.title, html: await seoBodyHtml(p.md, p.images), excerpt: p.meta, slug: p.slug, images: p.images.map((i) => ({ src: i.src, path: i.path, name: i.name, mime: i.mime, alt: i.alt })) };
  }
  const title = publicTitle(ci.title);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { title, html: text.split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("\n"), excerpt: "", slug: seoSlug(title, 60), images: [] };
}

/** Bài đã đăng THẬT lên kênh website (qua API, cập nhật được) của nội dung này — vd bài SEO đã lên WordPress. */
export function websitePostOf(ci: Row): { post: Row; channel: Row } | null {
  const post = q.get<Row>(`SELECT p.* FROM post p JOIN channel ch ON ch.id = p.channel_id
    WHERE p.content_item_id = ? AND ch.platform = 'website' AND p.simulated = 0 ORDER BY p.published_at DESC LIMIT 1`, ci.id);
  if (!post) return null;
  const channel = byId<Row>("channel", post.channel_id)!;
  return connectorForChannel(channel).updatePost ? { post, channel } : null;
}

/**
 * Cập nhật bài đã đăng trên website theo nội dung hiện tại (vd vừa tạo thêm ảnh cho bài SEO đã xuất bản): tải ảnh mới, thay thân
 * bài, đặt ảnh đại diện — giữ tiêu đề, đường dẫn, trạng thái. Không tạo bài mới.
 */
export async function updateWebsitePost(contentItemId: string, actor = "publishing"): Promise<{ permalink: string }> {
  const ci = byId<Row>("content_item", contentItemId);
  if (!ci) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
  const live = websitePostOf(ci);
  if (!live) throw new AppError("NOT_PUBLISHED", "Bài này chưa đăng lên website bằng kết nối cập nhật được", 409);
  const pt = publishText(ci, Boolean(mediaOf(ci)));
  if ("error" in pt) throw new AppError("NOT_PUBLISHABLE", pt.error, 409);
  const article = await websiteArticle(ci, pt.text);
  const r = await connectorForChannel(live.channel).updatePost!({ externalId: live.post.external_id, article, media: mediaOf(ci) }, `upd:${live.post.id}:${Date.now()}`);
  update("post", live.post.id, { body: pt.text, ...(r.permalink ? { permalink: r.permalink } : {}) });
  audit(ci.biz_id, actor, "post.website_updated", { type: "post", id: live.post.id }, { permalink: r.permalink, images: article.images.length });
  emit(ci.biz_id, "alert.raised", { level: "info", text: `Đã cập nhật bài "${ci.title}" trên website (${article.images.length} ảnh)`, category: "publish", key: `webupd:${live.post.id}`, href: r.permalink });
  return { permalink: r.permalink };
}

/** Bài website đang NHÁP / chờ duyệt trên kênh (đã tải lên qua API, chưa công khai) của nội dung này. */
export function websiteDraftOf(ci: Row): { post: Row; channel: Row } | null {
  const live = websitePostOf(ci);
  return live?.post.meta?.draft && connectorForChannel(live.channel).publishDraftPost ? live : null;
}

/**
 * "Đăng ngay" cho bài website đang nháp trên kênh: chuyển ĐÚNG bài đó sang công khai (không tạo bài mới → không trùng),
 * rồi mới ghi "Đã xuất bản". Website từ chối → báo lỗi, bài vẫn "Nháp trên kênh" trong hàng đăng.
 */
export async function publishWebsiteDraft(bizId: string, contentItemId: string, actor = "publishing"): Promise<{ permalink: string }> {
  const ci = byId<Row>("content_item", contentItemId);
  if (!ci || ci.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
  const live = websiteDraftOf(ci);
  if (!live) throw new AppError("NOT_DRAFT", "Bài này không có bản nháp trên website", 409);
  if (isKilled(bizId, "publish")) throw new AppError("KILLED", "Kill switch đăng bài đang bật", 409);
  const r = await connectorForChannel(live.channel).publishDraftPost!(live.post.external_id, `pubdraft:${live.post.id}`).catch((e) => {
    const f = permanentIfFinal(e, live.channel); // lỗi đăng nhập → đánh dấu kết nối hết hạn + báo Sếp
    throw new AppError("PUBLISH_FAILED", `Chưa xuất bản được: ${f instanceof Error ? f.message : String(f)}`, 409);
  });
  const { draft: _d, note: _n, ...meta } = (live.post.meta ?? {}) as Row;
  update("post", live.post.id, { meta, published_at: nowIso(), ...(r.permalink ? { permalink: r.permalink } : {}) });
  update("content_item", ci.id, { status: "published" });
  emit(bizId, "post.published", { postId: live.post.id, title: ci.title, channel: live.channel.name, simulated: false, via: "api" });
  audit(bizId, actor, "post.published", { type: "post", id: live.post.id }, { permalink: r.permalink, channel: live.channel.name, via: "api", from: "draft_on_channel" });
  return { permalink: r.permalink };
}

/**
 * Bộ canh (5 phút/lần): đối chiếu bài website với trạng thái THẬT trên WordPress — còn nháp → "Nháp trên kênh" (nằm ở hàng
 * Đăng bài); Sếp đã tự xuất bản trên WordPress → "Đã xuất bản". Cũng sửa bài cũ bị ghi nhầm "Đã đăng" khi website để nháp
 * (trước đây chỉ có ghi chú, không có cờ draft). Lỗi đọc 1 bài không chặn bài khác.
 */
export async function syncWebsiteDrafts(): Promise<{ drafts: number; published: number }> {
  let drafts = 0, published = 0;
  const rows = q.all<Row>(`SELECT p.* FROM post p JOIN channel ch ON ch.id = p.channel_id JOIN content_item c ON c.id = p.content_item_id
    WHERE ch.platform = 'website' AND p.simulated = 0 AND c.status IN ('published', 'draft_on_channel')
      AND (json_extract(p.meta, '$.draft') = 1 OR (c.status = 'published' AND json_extract(p.meta, '$.note') LIKE '%WordPress để xuất bản%'))`);
  for (const post of rows) {
    const channel = byId<Row>("channel", post.channel_id);
    const c = channel ? connectorForChannel(channel) : undefined;
    if (!channel || !c?.readPostState) continue;
    try {
      const st = await c.readPostState(post.external_id);
      const ci = byId<Row>("content_item", post.content_item_id)!;
      const { draft: _d, note: _n, ...rest } = (post.meta ?? {}) as Row;
      if (st.draft) {
        if (ci.status === "draft_on_channel" && post.meta?.draft) continue;
        update("post", post.id, { meta: { ...rest, draft: true, note: `Bài đang là nháp trên website, CHƯA công khai — bấm "Đăng ngay" ở trang Đăng bài để xuất bản.` } });
        update("content_item", ci.id, { status: "draft_on_channel" });
        emit(post.biz_id, "alert.raised", { level: "warning", text: `Bài "${ci.title}" vẫn là NHÁP trên ${channel.name} — đã đưa lại vào hàng Đăng bài`, category: "publish", key: `webdraft:${post.id}`, href: "/publish" });
        audit(post.biz_id, "publishing", "post.draft_detected", { type: "post", id: post.id }, { channel: channel.name });
        drafts++;
      } else {
        update("post", post.id, { meta: rest, permalink: st.permalink || post.permalink });
        update("content_item", ci.id, { status: "published" });
        audit(post.biz_id, "publishing", "post.published", { type: "post", id: post.id }, { permalink: st.permalink, channel: channel.name, via: "website", from: "draft_on_channel" });
        published++;
      }
    } catch (e) {
      logger.warn("publish.website_sync_failed", { postId: post.id, error: String(e).slice(0, 200) });
    }
  }
  return { drafts, published };
}

// ---------------- What actually goes on the channel ----------------
/**
 * Text that is posted, never the raw production body:
 *  - video_script (HOOK / [0-3s] scenes / 🎙 / CTA / Caption): only the "Caption:" section, and ONLY together with the
 *    finished video — a script alone is not a post;
 *  - video (caption + "---\nLời thoại:"): the caption before "---";
 *  - other kinds: the body.
 * Then a last guard: anything that still looks like a production note / script / unverified-claim marker is refused.
 */
export function publishText(ci: Row, hasMedia: boolean): { text: string } | { error: string } {
  const body = String(ci.body ?? "");
  let text = body;
  if (ci.kind === "video_script") {
    if (!hasMedia) return { error: "Đây là KỊCH BẢN video — phải làm xong video rồi mới đăng (không đăng kịch bản thành bài chữ)" };
    const m = /(?:^|\n)Caption:\s*([\s\S]+)$/.exec(body);
    if (!m) return { error: "Kịch bản không có phần Caption — sửa nội dung rồi đăng lại" };
    text = m[1];
  } else if (ci.kind === "video" || ci.kind === "social_video") {
    text = body.split("\n---\n")[0];
  }
  text = text.trim();
  if (!text) return { error: "Nội dung đăng đang trống" };
  const leak = internalLeak(text);
  if (leak) return { error: `Nội dung còn ${leak} — Sếp sửa lại trong Nội dung rồi đăng (hệ thống không tự đăng)` };
  return { text };
}
const LEAKS: [RegExp, string][] = [
  [/ghi chú nội bộ|internal note/i, "ghi chú nội bộ"],
  [/\[\d+\s*-\s*\d+s\]|^\s*\[Cảnh \d+\]/im, "chỉ dẫn cảnh quay của kịch bản"],
  [/🎙|🅣|^\s*HOOK:|^\s*Lời thoại:/im, "nhãn soạn thảo kịch bản (HOOK / lời thoại)"],
  [/⚠️|\bTODO\b|\bTBD\b/, "dấu chờ xác nhận (⚠️/TODO)"],
  [/(cần|chờ)[^.\n]{0,60}(xác nhận|chốt)[^.\n]{0,40}(trước khi|bản final|công bố)/i, "câu nhắc nội bộ chờ xác nhận"],
];
export function internalLeak(text: string): string | null {
  for (const [re, what] of LEAKS) if (re.test(text)) return what;
  return null;
}

// ---------------- Trạng thái lượt đăng ----------------
//   scheduled → posting → verifying → done
//   needs_check : CÓ THỂ đã lên bài (sập/timeout giữa chừng, xác minh thất bại) — không bao giờ tự đăng lại
//   needs_setup : kênh chưa kết nối (không token, Chrome chưa sẵn sàng) — CHƯA đăng gì, bài vẫn "đã duyệt"
//   failed      : chắc chắn CHƯA đăng (lỗi nội dung/quyền/Chrome chưa sẵn sàng) — sửa rồi bấm "Đăng lại"
export const NEEDS_CHECK_MSG = "Có thể đã đăng — Sếp kiểm tra kênh rồi bấm Đăng lại nếu chưa có bài";
/** Lần đăng trước có thể đã lên bài → KHÔNG tự đăng lại (tránh bài trùng công khai); báo Sếp kiểm tra. */
export function markNeedsCheck(job: Row, detail?: string): PermanentError {
  const error = detail ? `${NEEDS_CHECK_MSG} (${detail})` : NEEDS_CHECK_MSG;
  update("publish_job", job.id, { status: "needs_check", error });
  const ci = byId<Row>("content_item", job.content_item_id);
  emit(job.biz_id, "alert.raised", { level: "warning", text: `Bài "${ci?.title ?? job.id}": ${error}`, category: "publish", key: `publish:${job.id}`, href: "/publish" });
  audit(job.biz_id, "publishing", "publish.needs_check", { type: "publish_job", id: job.id }, { detail: detail ?? null });
  return new PermanentError(error);
}

/**
 * Nút "Đăng lại" (sau khi Sếp kiểm tra kênh chưa có bài / đã sửa lỗi): đưa lượt needs_check / failed / needs_setup về lịch
 * và đăng ngay (lượt bản nháp video chạy lại hàng đợi nháp).
 */
export function retryPublishJob(bizId: string, publishJobId: string, actor: string) {
  const job = byId<Row>("publish_job", publishJobId);
  if (!job || job.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy lượt đăng", 404);
  if (!["failed", "needs_check", "needs_setup"].includes(job.status)) throw new AppError("INVALID_STATE", "Chỉ đăng lại được lượt đăng lỗi, cần kiểm tra hoặc chờ thiết lập kênh");
  const channel = byId<Row>("channel", job.channel_id)!;
  // Sếp đã xác nhận chưa có bài → bỏ trạng thái nền tảng cũ để lần này đăng mới hoàn toàn.
  update("publish_job", job.id, { status: "scheduled", error: null, platform_state: {}, scheduled_at: nowIso() });
  audit(bizId, actor, "publish.retried", { type: "publish_job", id: job.id }, { from: job.status });
  const attempt = String(Date.now());
  if (job.mode === "draft") enqueue("publish", "publish.draft", { publishJobId: job.id }, { bizId, idempotencyKey: `draftrun:${job.id}:${attempt}`, lockKey: chromeLock(channel, "draft") });
  else enqueuePublishNow(bizId, byId<Row>("publish_job", job.id)!, attempt);
  return byId<Row>("publish_job", job.id)!;
}

/**
 * Sếp đổi kênh đăng của 1 lượt CHƯA lên bài (chờ kết nối kênh / lỗi chắc chắn chưa đăng / đang chờ giờ đăng) — vd video tạo với
 * TikTok chưa nối, chuyển sang Fanpage đã nối. Không cho đổi lượt "cần kiểm tra" (có thể ĐÃ lên kênh cũ) hay đang/đã đăng.
 * Lượt lỗi / chờ kết nối thì đăng lại ngay trên kênh mới; lượt đang chờ giờ đăng giữ nguyên giờ (lúc chạy đọc kênh mới).
 */
export function changePublishChannel(bizId: string, publishJobId: string, channelId: string, actor: string) {
  const job = byId<Row>("publish_job", publishJobId);
  if (!job || job.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy lượt đăng", 404);
  if (!["needs_setup", "failed", "scheduled"].includes(job.status)) {
    throw new AppError("INVALID_STATE", job.status === "needs_check" ? "Lượt này có thể ĐÃ lên kênh cũ — kiểm tra kênh trước, không đổi kênh" : "Chỉ đổi kênh được khi bài chưa lên kênh (chờ kết nối, lỗi, hoặc đang chờ giờ đăng)");
  }
  const channel = byId<Row>("channel", channelId);
  if (!channel || channel.biz_id !== bizId || !channel.enabled || channel.meta?.removedAt) throw new AppError("NOT_FOUND", "Không thấy kênh này (Kênh đăng)", 404);
  if (channel.id === job.channel_id) return job;
  const dup = q.get<Row>("SELECT id FROM publish_job WHERE content_item_id = ? AND channel_id = ? AND id != ? AND COALESCE(mode, 'publish') = COALESCE(?, 'publish') AND status NOT IN ('cancelled')", job.content_item_id, channel.id, job.id, job.mode ?? null);
  if (dup) throw new AppError("DUPLICATE", `Bài này đã có lượt đăng lên ${channel.name}`);
  const from = byId<Row>("channel", job.channel_id);
  const retry = job.status !== "scheduled";
  update("publish_job", job.id, { channel_id: channel.id, idempotency_key: `${job.idempotency_key}:to:${channel.id}`, ...(retry ? {} : { error: null }) });
  // Bài chỉ có lượt đăng này → nền tảng của bài theo kênh mới (lịch, danh sách nội dung).
  if (!q.scalar<number>("SELECT COUNT(*) FROM publish_job WHERE content_item_id = ? AND id != ?", job.content_item_id, job.id)) update("content_item", job.content_item_id, { channel: channel.platform });
  audit(bizId, actor, "publish.channel_changed", { type: "publish_job", id: job.id }, { from: from?.name ?? job.channel_id, to: channel.name });
  return retry ? retryPublishJob(bizId, job.id, actor) : byId<Row>("publish_job", job.id)!;
}

/**
 * Sếp xóa một nội dung khỏi "Bài chờ / sắp đăng" (trang Đăng bài): bỏ nội dung cùng các lượt đăng CHƯA lên bài của nó.
 * Không xóa được khi: đang đăng/xác minh (lượt đang chạy), hoặc đã có bài công khai từ nội dung này (xóa ở "Bài đã đăng công khai").
 * Lượt đăng bị xóa HẲN (không đánh dấu "hủy"): hàng đợi tới giờ chạy sẽ không thấy lượt nữa và bỏ qua, không tự đăng.
 * Không đụng tới kênh thật: bản nháp video đã tải lên kênh (draft_on_channel) vẫn còn trên kênh — Sếp tự xóa ở đó.
 * Giữ nguyên video/ảnh đã tạo (thư viện), job dựng video, link theo dõi — chỉ gỡ liên kết tới nội dung đã xóa.
 */
export function deleteContent(bizId: string, contentId: string, actor: string) {
  const c = byId<Row>("content_item", contentId);
  if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
  if (q.scalar<number>("SELECT COUNT(*) FROM publish_job WHERE content_item_id = ? AND status IN ('posting', 'verifying')", c.id)) {
    throw new AppError("BUSY", "Bài đang được đăng — chờ đăng xong rồi hãy xóa", 409);
  }
  if (q.scalar<number>("SELECT COUNT(*) FROM post WHERE content_item_id = ?", c.id)) {
    throw new AppError("ALREADY_POSTED", "Bài này đã đăng — xóa ở bảng \"Bài đã đăng công khai\" bên dưới", 409);
  }
  const jobs = q.all<Row>("SELECT id, status FROM publish_job WHERE content_item_id = ?", c.id);
  tx(() => {
    q.run("DELETE FROM publish_job WHERE content_item_id = ?", c.id);
    q.run("UPDATE creative_job SET content_item_id = NULL WHERE content_item_id = ?", c.id);
    q.run("UPDATE track_link SET content_item_id = NULL WHERE content_item_id = ?", c.id);
    q.run("UPDATE content_item SET variant_of = NULL WHERE variant_of = ?", c.id);
    q.run("DELETE FROM review_score WHERE subject_type = 'content_item' AND subject_id = ?", c.id);
    q.run("DELETE FROM content_item WHERE id = ?", c.id);
  });
  audit(bizId, actor, "content.deleted", { type: "content_item", id: c.id }, { title: c.title, status: c.status, kind: c.kind, jobs: jobs.length });
  emit(bizId, "content.deleted", { contentId: c.id, title: c.title });
  return { ok: true, id: c.id };
}

/**
 * Sếp xóa một bài khỏi bảng "Bài đã đăng công khai": ẨN khỏi danh sách (meta.hidden), KHÔNG xóa bài thật trên kênh và KHÔNG xóa số liệu —
 * báo cáo, truy vết đơn hàng, điểm bài vẫn đúng; bài vẫn nằm trong DB nên đồng bộ từ kênh không nạp lại thành bài trùng.
 */
export function hidePost(bizId: string, postId: string, actor: string) {
  const p = byId<Row>("post", postId);
  if (!p || p.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy bài", 404);
  if (p.meta?.hidden) return { ok: true, id: p.id };
  update("post", p.id, { meta: { ...(p.meta ?? {}), hidden: true, hiddenAt: nowIso() } });
  audit(bizId, actor, "post.hidden", { type: "post", id: p.id }, { title: p.title, permalink: p.permalink ?? null });
  emit(bizId, "post.hidden", { postId: p.id, title: p.title });
  return { ok: true, id: p.id };
}

/**
 * Phân loại lỗi connector khi đăng:
 *  - AuthError (token hỏng/thiếu quyền): đánh dấu kết nối "hết hạn" + báo khẩn Sếp kết nối lại;
 *  - AuthError / InvalidRequest / PolicyRejected / NotFound: lỗi cố định → PermanentError (không thử lại);
 *  - RateLimited / Transient: trả nguyên lỗi (người gọi quyết định — xem runPublishJob).
 */
export function permanentIfFinal(e: unknown, channel: Row): unknown {
  if (!(e instanceof ConnectorError)) return e;
  if (e.kind === "AuthError" && channel.connection_id) {
    update("connection", channel.connection_id, { status: "expired", last_error: e.message });
    emit(channel.biz_id, "alert.raised", { level: "urgent", text: `${channel.name}: ${e.message}`, category: "publish", key: `conn_auth:${channel.connection_id}`, href: "/ads/integrations" });
  }
  return ["AuthError", "InvalidRequest", "PolicyRejected", "NotFound"].includes(e.kind) ? new PermanentError(e.message) : e;
}

/** Lượt đăng bị chặn vì kênh chưa kết nối: "needs_setup" — CHƯA đăng gì; bài vẫn "đã duyệt" để Sếp bấm Đăng lại sau khi kết nối. */
export function blockNotConnected(job: Row, ci: Row, channel: Row, what: "bài" | "video (bản nháp)" = "bài"): PermanentError {
  const error = `${channel.name} (${channel.platform}): ${routeReason(channel)} — ${what} CHƯA được ${what === "bài" ? "đăng" : "tải lên kênh"} (mở Kênh đăng để liên kết API hoặc thiết lập đăng qua Chrome, rồi bấm Đăng lại)`;
  update("publish_job", job.id, { status: "needs_setup", error });
  q.run("UPDATE content_item SET status = 'approved' WHERE id = ? AND status = 'scheduled'", ci.id);
  emit(job.biz_id, "alert.raised", { level: "warning", text: `Bài "${ci.title ?? job.id}" chưa đăng: ${error}`, category: "publish", key: `publish:${job.id}`, href: "/channels" });
  audit(job.biz_id, "publishing", "post.publish_refused", { type: "content_item", id: ci.id }, { channel: channel.name, reason: routeReason(channel) });
  return new PermanentError(error);
}

/**
 * Lỗi CHẮC CHẮN chưa đăng → lượt "failed" (không phải "cần kiểm tra"): Chrome chưa sẵn sàng, thiếu tệp, chưa khởi động được
 * Chrome, Chrome Flow đang bận, hoặc agent Chrome tự báo blocked/failed (BROWSER_PUBLISH_FAILED — chỉ ném khi status khác "done").
 */
const BROWSER_BEFORE_POST_CODES = new Set([
  "BROWSER_NOT_READY", "NO_FILE", "NEED_CLI", "NO_BROWSER", "NO_PROFILE", "BROWSER_START", "BROWSER_PUBLISH_FAILED", "CHROME_BUSY",
  // Extension preflight / permission configuration is checked before the publishing agent starts.
  "CHROME_CONSENT_REQUIRED", "CHROME_APPROVER_OFF", "CHROME_APPROVER_MISSING", "NO_EXTENSION", "NO_BROWSER_DEVICE",
  "PROFILE_NOT_OPEN", "BROWSER_DEVICE_CHANGED", "BROWSER_NOT_CONNECTED", "BROWSER_OTHER_MACHINE", "BROWSER_NOT_SELECTED", "PATH_NOT_ALLOWED",
]);
export const browserFailedBeforePosting = (e: unknown) => e instanceof AppError && BROWSER_BEFORE_POST_CODES.has(e.code);

const MAX_RATE_LIMIT_TRIES = 3;
const MAX_BUSY_TRIES = 10;
const MAX_PROCESSING_TRIES = 10;
const TRIES_KEY = { rate_limited: "rateLimitedTries", chrome_busy: "chromeBusyTries", processing: "processingTries" } as const;
/**
 * Xếp lại lượt đăng chưa hề gửi đi (bị giới hạn tần suất / Chrome đang bận) sau `delayMs`; quá số lần thì trả false → báo lỗi.
 * "processing": nền tảng (Instagram / TikTok) đã NHẬN media nhưng chưa xử lý xong — id container / publish_id đã lưu trong
 * platform_state nên lần chạy lại chỉ hỏi tiếp trạng thái, không thể đăng trùng.
 */
export function requeueLater(job: Row, channel: Row, why: "rate_limited" | "chrome_busy" | "processing", message: string, delayMs: number): boolean {
  const key = TRIES_KEY[why];
  const prev = (byId<Row>("publish_job", job.id)?.platform_state ?? {}) as Row;
  const tries = Number(prev[key] ?? 0) + 1;
  if (tries >= (why === "rate_limited" ? MAX_RATE_LIMIT_TRIES : why === "processing" ? MAX_PROCESSING_TRIES : MAX_BUSY_TRIES)) return false;
  const runAt = new Date(Date.now() + delayMs);
  update("publish_job", job.id, { status: "scheduled", error: `${message} — hệ thống tự thử lại (lần ${tries})`, platform_state: { ...prev, [key]: tries }, scheduled_at: runAt.toISOString() });
  enqueue("publish", job.mode === "draft" ? "publish.draft" : "publish.run", { publishJobId: job.id }, { bizId: job.biz_id, runAt, idempotencyKey: `pubretry-auto:${job.id}:${why}:${tries}`, lockKey: chromeLock(channel, job.mode === "draft" ? "draft" : "publish") });
  return true;
}

/** Lỗi do HỆ THỐNG TỪ CHỐI NỘI DUNG lúc đăng (runPublishJob ghi `${publishText.error} — bài CHƯA được đăng`); lỗi kênh/quyền/Chrome không tính. */
const REFUSAL_RE = /^(Nội dung còn |Nội dung đăng đang trống|Kịch bản không có phần Caption|Đây là KỊCH BẢN video).* — bài CHƯA được đăng$/s;
export const isContentRefusal = (error: unknown) => typeof error === "string" && REFUSAL_RE.test(error);

/**
 * Đồng bộ lại các lượt đăng bị từ chối vì NỘI DUNG sau khi Sếp sửa nội dung (hoặc khi mở trang Đăng bài): lượt "Lỗi" giữ nguyên thông báo
 * cũ dù nội dung đã sạch → trang Đăng bài báo sai. Kiểm tra lại đúng như lúc đăng (publishText):
 *  - nội dung đã hợp lệ → bỏ lượt lỗi cũ (CHƯA từng đăng, chắc chắn) + đưa bài về "Đã duyệt" → Sếp bấm "Đăng ngay";
 *  - vẫn còn lỗi → cập nhật thông báo theo lỗi HIỆN TẠI (vd đã sửa câu này nhưng còn câu khác).
 * Trả về số lượt đã xử lý. Không tự đăng gì.
 */
export function resyncRefusedJobs(bizId: string, contentId?: string): number {
  const jobs = q.all<Row>(
    `SELECT * FROM publish_job WHERE biz_id = ? AND status = 'failed' AND COALESCE(mode, 'publish') != 'draft' ${contentId ? "AND content_item_id = ?" : ""}`,
    ...[bizId, contentId].filter(Boolean),
  ).filter((j) => isContentRefusal(j.error));
  let changed = 0;
  for (const j of jobs) {
    const ci = byId<Row>("content_item", j.content_item_id);
    if (!ci) continue;
    const pt = publishText(ci, Boolean(mediaOf(ci)));
    if ("error" in pt) {
      const error = `${pt.error} — bài CHƯA được đăng`;
      if (error !== j.error) { update("publish_job", j.id, { error }); changed++; }
      continue;
    }
    tx(() => {
      q.run("DELETE FROM publish_job WHERE id = ?", j.id);
      if (ci.status === "manual_publish") update("content_item", ci.id, { status: "approved" }); // runPublishJob đã chuyển sang manual_publish khi từ chối
    });
    audit(bizId, "publishing", "publish.refusal_cleared", { type: "content_item", id: ci.id }, { was: j.error });
    changed++;
  }
  if (changed) emit(bizId, "post.queue_synced", { contentId: contentId ?? null, changed });
  return changed;
}

/**
 * Real or nothing. Route per channel (Kênh đăng): API with the Page token → Chrome Flow agent → otherwise "needs_setup"
 * with the reason. A job already "posting" after a crash is never re-posted (needs a human check: it may be live already).
 * Errors are classified (see the state list above); only a rate limit / busy Chrome — where nothing was sent — retries itself.
 */
export async function runPublishJob(publishJobId: string) {
  const job = byId<Row>("publish_job", publishJobId);
  if (!job || job.status === "done" || job.status === "needs_check") return;
  // Lần trước dừng giữa lúc đăng/xác minh (server khởi động lại, Chrome treo…) → có thể bài đã lên: không đăng lần 2.
  if (job.status === "posting" || job.status === "verifying") {
    markNeedsCheck(job, "lần đăng trước bị gián đoạn");
    return;
  }
  if (isKilled(job.biz_id, "publish")) {
    update("publish_job", job.id, { status: "failed", error: "Kill switch đăng bài đang bật" });
    return;
  }
  const ci = byId<Row>("content_item", job.content_item_id)!;
  const channel = byId<Row>("channel", job.channel_id)!;
  const route = publishRoute(channel);
  if (route === "none") {
    blockNotConnected(job, ci, channel);
    return;
  }
  const media = mediaOf(ci);
  const pt = publishText(ci, Boolean(media));
  if ("error" in pt) {
    update("publish_job", job.id, { status: "failed", error: `${pt.error} — bài CHƯA được đăng` });
    update("content_item", ci.id, { status: "manual_publish" });
    emit(job.biz_id, "alert.raised", { level: "warning", text: `"${ci.title}": ${pt.error}`, category: "publish", key: `publish:${job.id}`, href: "/publish" });
    audit(job.biz_id, "publishing", "post.publish_refused", { type: "content_item", id: ci.id }, { channel: channel.name, reason: pt.error });
    return;
  }
  update("publish_job", job.id, { status: "posting", error: null });
  // Link sản phẩm dưới bình luận: phiên Chrome bình luận ngay trong lúc đăng; đường API thì job posts.comment_link chạy sau 30–60 giây.
  let lcMemo: ReturnType<typeof linkCommentForPublish> | undefined; // chỉ tính khi thật sự đăng qua Chrome (tạo mã đo)
  const lc = () => (lcMemo === undefined ? (lcMemo = linkCommentForPublish(ci, channel)) : lcMemo);
  let res: { externalId: string; permalink: string; note?: string; commentPosted?: boolean; notes?: string };
  let via: "api" | "browser" = route;
  try {
    if (route === "api") {
      const c = connectorForChannel(channel);
      try {
        // resume/onPending: id container Instagram / publish_id TikTok được lưu NGAY khi nền tảng nhận → lần chạy lại chỉ hỏi tiếp.
        res = await c.publishPost!({
          channelExternalId: channel.external_id, text: pt.text, kind: ci.kind, media,
          ...(channel.platform === "website" ? { article: await websiteArticle(ci, pt.text) } : {}),
          resume: (byId<Row>("publish_job", job.id)?.platform_state ?? {}) as Record<string, unknown>,
          onPending: (st) => update("publish_job", job.id, { platform_state: { ...((byId<Row>("publish_job", job.id)?.platform_state ?? {}) as Row), ...st } }),
        }, job.idempotency_key);
      } catch (e) {
        // API không làm được (connector báo NeedsBrowser) → đăng qua Chrome nếu kênh đã thiết lập.
        if (!(e instanceof ConnectorError && e.kind === "NeedsBrowser" && browserReady(channel).ok)) throw e;
        via = "browser";
        res = await publishViaBrowser(job, channel, pt.text, media?.path, lc()?.text);
      }
      if (via === "api") {
        update("publish_job", job.id, { status: "verifying", platform_state: { ...((byId<Row>("publish_job", job.id)?.platform_state ?? {}) as Row), externalId: res.externalId, permalink: res.permalink } });
        const ok = c.verifyPost ? await c.verifyPost(res.externalId).catch(() => false) : true;
        if (!ok) throw markNeedsCheck(job, `xác minh sau đăng thất bại — ${res.permalink || res.externalId}`);
      }
    } else res = await publishViaBrowser(job, channel, pt.text, media?.path, lc()?.text);
  } catch (e) {
    const cur = byId<Row>("publish_job", job.id) ?? job;
    if (cur.status === "needs_check") throw e; // markNeedsCheck đã ghi trạng thái + báo
    // CHROME_BUSY: Chrome Flow đang dựng video — chưa gửi gì, xếp lại vài phút sau.
    if (e instanceof AppError && e.code === "CHROME_BUSY" && requeueLater(cur, channel, "chrome_busy", e.message, 2 * 60_000)) return;
    // Giới hạn tần suất: Facebook từ chối TRƯỚC khi đăng → thử lại sau vài phút (tối đa MAX_RATE_LIMIT_TRIES lần).
    if (e instanceof ConnectorError && e.kind === "RateLimited" && requeueLater(cur, channel, "rate_limited", e.message, 10 * 60_000)) return;
    // Instagram / TikTok đang xử lý media đã nhận (id đã lưu): hỏi lại sau vài phút — không tạo / tải lại.
    if (e instanceof ConnectorError && (e as { resumable?: boolean }).resumable && requeueLater(cur, channel, "processing", e.message, 3 * 60_000)) return;
    // Mạng/timeout/5xx sau khi đã gửi lệnh đăng: Facebook CÓ THỂ đã đăng → cần Sếp kiểm tra, KHÔNG tự đăng lại.
    if (e instanceof ConnectorError && (e.kind === "Transient" || (e as { outcomeUnknown?: boolean }).outcomeUnknown)) throw markNeedsCheck(job, e.message);
    const final = permanentIfFinal(e, channel);
    const error = final instanceof Error ? final.message : String(final);
    update("publish_job", job.id, { status: "failed", error });
    emit(job.biz_id, "alert.raised", { level: "warning", text: `Đăng "${ci.title}" lên ${channel.name} lỗi: ${error}`, category: "publish", key: `publish:${job.id}`, href: "/publish" });
    throw new PermanentError(error); // never auto-retry a publish: it may have gone through
  }
  const post = finishPublished(job, ci, channel, res, via, pt.text);
  if (via === "browser") {
    const c = lcMemo ?? null;
    if (c) recordBrowserComment(post, channel, c, { commentPosted: Boolean(res.commentPosted), notes: res.notes });
  } else if (autoLinkPlan(ci, channel)) queueAutoLinkComment(post, channel);
}

/**
 * Đăng qua Chrome Flow. Lỗi CHẮC CHẮN chưa đăng (Chrome chưa sẵn sàng, thiếu tệp, agent tự báo blocked/failed) → ném lại để
 * thành "failed"; agent dừng giữa chừng / hết giờ / trả kết quả hỏng: có thể đã bấm Đăng → "cần kiểm tra".
 */
async function publishViaBrowser(job: Row, channel: Row, text: string, mediaPath?: string, comment?: string): Promise<{ externalId: string; permalink: string; commentPosted: boolean; notes: string }> {
  try {
    const r = await browserPublish(channel, { text, mediaPath, mode: "publish", comment, tag: `pub-${job.id}` });
    return { externalId: r.permalink || `chrome:${job.id}`, permalink: r.permalink, commentPosted: r.commentPosted, notes: r.notes };
  } catch (e) {
    if (browserFailedBeforePosting(e)) throw e;
    throw markNeedsCheck(job, e instanceof Error ? e.message : String(e));
  }
}

function finishPublished(job: Row, ci: Row, channel: Row, res: { externalId: string; permalink: string; note?: string; draft?: boolean }, via: "api" | "browser", text: string) {
  const kind = ci.kind === "social_video" || ci.kind === "video" ? "reel" : ci.kind === "seo_article" ? "article" : "image";
  const meta = { ...(res.note ? { note: res.note } : {}), ...(res.draft ? { draft: true } : {}) };
  const post = q.get<Row>("SELECT id FROM post WHERE channel_id = ? AND external_id = ?", channel.id, res.externalId)
    ?? insert("post", { biz_id: job.biz_id, channel_id: channel.id, external_id: res.externalId, content_item_id: ci.id, kind, title: ci.title, body: text, published_at: nowIso(), permalink: res.permalink, ad_status: "none", simulated: 0, meta });
  update("publish_job", job.id, { status: "done", post_id: post.id, simulated: 0, error: null });
  // Bài lên kênh nhưng CHƯA công khai (WordPress "Bản nháp"/"Chờ duyệt") → "Nháp trên kênh": vẫn ở hàng Đăng bài, không bị
  // coi là đã đăng rồi biến mất khỏi cả trang Duyệt lẫn trang Đăng bài.
  update("content_item", ci.id, { status: res.draft ? "draft_on_channel" : "published" });
  bindTrackLink(ci.id, post.id);
  emit(job.biz_id, "post.published", { postId: post.id, title: res.draft ? `Nháp trên ${channel.name}: ${ci.title}` : ci.title, channel: channel.name, simulated: false, via });
  // Nền tảng báo bài không ở chế độ như mong đợi (vd. TikTok đăng RIÊNG TƯ) → nói rõ, không để Sếp tưởng đã công khai.
  if (res.note) emit(job.biz_id, "alert.raised", { level: "warning", text: `Bài "${ci.title}" trên ${channel.name}: ${res.note}`, category: "publish", key: `postnote:${post.id}`, href: "/publish" });
  audit(job.biz_id, "publishing", res.draft ? "post.drafted_on_channel" : "post.published", { type: "post", id: post.id }, { permalink: res.permalink, channel: channel.name, via });
  // Metrics snapshots only for API channels (Chrome-published posts have no reliable id to read insights from).
  // Website không có số liệu tiếp cận theo bài (WordPress) → không xếp lịch đo.
  if (via === "api" && channel.platform !== "website") for (const [mark, h] of [["1h", 1], ["6h", 6], ["24h", 24], ["72h", 72]] as const) {
    enqueue("ads", "posts.snapshot", { postId: post.id, mark }, { bizId: job.biz_id, runAt: new Date(Date.now() + h * hourMs(job.biz_id)), idempotencyKey: `snap:${post.id}:${mark}` });
  }
  return post;
}

// ---------------- Post Scanner: snapshots, comments, scoring (spec §7, §9) ----------------
const SAMPLE_COMMENTS = [
  "Học phí AI Business System bao nhiêu vậy ad?", "Inbox mình lịch khai giảng nhé", "Bài hay quá, đúng tình trạng công ty mình",
  "Cho mình xin link AI Plus", "Có học online không ạ?", "Lại khóa học lùa gà à", "Chuẩn luôn, CEO ôm việc quá nhiều",
  "Đăng ký khóa miễn phí thế nào ạ?", "Vay tiền nhanh lãi thấp liên hệ zalo", "Công ty 30 nhân sự có phù hợp không?", "Autovis dùng thử được không?",
  "Cảm ơn TAKI", "Giá có trả góp không ạ", "Mình học rồi, áp dụng được ngay",
];

export async function snapshotPost(postId: string, mark: "1h" | "6h" | "24h" | "72h") {
  const post = byId<Row>("post", postId);
  if (!post) return;
  const channel = byId<Row>("channel", post.channel_id)!;
  // Số liệu của bài THẬT lấy bằng token Trang của chính kênh đó (trước đây mọi bài đều đọc connector mô phỏng).
  const c = connectorForChannel(channel);
  const conn = channel.connection_id ? byId<Row>("connection", channel.connection_id) : undefined;
  if (c.mode !== "live" && conn?.mode === "live") {
    // Kết nối thật nhưng không còn dùng được (đã ngắt / mất token Trang): KHÔNG bịa số liệu cho bài thật.
    audit(post.biz_id, "post_scanner", "post.snapshot_skipped", { type: "post", id: post.id }, { mark, reason: "connection_not_usable" });
    return;
  }
  let m: { reach: number; reactions: number; comments: number; shares: number; saves: number };
  try {
    m = await c.fetchPostMetrics!({ externalId: post.external_id, publishedAt: post.published_at, kind: post.kind }, mark);
  } catch (e) {
    // Nền tảng không đo được bài này (vd. TikTok chưa có mã video công khai): bỏ qua, KHÔNG ghi số 0 giả vào điểm bài.
    if (e instanceof ConnectorError && e.kind === "NotFound") {
      audit(post.biz_id, "post_scanner", "post.snapshot_skipped", { type: "post", id: post.id }, { mark, reason: "not_measurable", detail: e.message });
      return;
    }
    throw e;
  }
  insert("post_metric_snapshot", { biz_id: post.biz_id, post_id: post.id, mark, metrics: m, captured_at: nowIso() });
  // Kênh mô phỏng (demo) ONLY: materialise some comments so the Jev classifier and intent component have data.
  // Bài thật KHÔNG bao giờ nhận bình luận giả — sẽ kích hoạt nhắn tin cho khách không có thật.
  if (c.mode === "sandbox") {
    const have = q.scalar<number>("SELECT COUNT(*) FROM post_comment WHERE post_id = ?", post.id);
    const want = Math.min(12, Math.round(m.comments / 6));
    for (let i = have; i < want; i++) {
      insert("post_comment", { biz_id: post.biz_id, post_id: post.id, author: `Người dùng ${i + 1}`, text: SAMPLE_COMMENTS[Math.floor(seeded(`${post.id}:c${i}`) * SAMPLE_COMMENTS.length)] });
    }
  }
  await classifyComments(post);
  await scorePostNow(post.id);
}

export async function classifyComments(post: Row) {
  const pending = q.all<Row>("SELECT * FROM post_comment WHERE post_id = ? AND label IS NULL LIMIT 30", post.id);
  if (!pending.length) return;
  const j = await judge({
    bizId: post.biz_id, purpose: "comments.classify", subject: { type: "post", id: post.id },
    state: { post: { title: post.title }, comments: pending.map((c) => ({ text: maskPhonesInText(c.text) })) },
    questions: commentQuestions(pending.length), heuristic: commentHeuristic,
  });
  const labels: Record<string, string> = {};
  pending.forEach((c, i) => {
    const a = (j.answers as any)[`c${i}`];
    const label = a.confidence >= 0.25 ? a.choice : "question";
    labels[c.id] = label;
    update("post_comment", c.id, { label, label_source: j.source, label_confidence: a.confidence, hidden: label === "spam" ? 1 : 0 });
  });
  recordDecision(j.id, { labels, hiddenSpam: Object.values(labels).filter((l) => l === "spam").length });
}

export async function scorePostNow(postId: string) {
  const post = byId<Row>("post", postId)!;
  const snaps = q.all<Row>("SELECT mark, metrics FROM post_metric_snapshot WHERE post_id = ? ORDER BY captured_at", postId);
  const byMark = new Map(snaps.map((s) => [s.mark, s.metrics]));
  const snapshots = [...byMark.entries()].map(([mark, m]: [string, any]) => ({ mark: mark as any, ...m }));
  const channelRates = q.all<Row>(
    `SELECT s.metrics FROM post_metric_snapshot s JOIN post p ON p.id = s.post_id WHERE p.channel_id = ? AND p.id != ? AND s.mark = '24h' ORDER BY s.captured_at DESC LIMIT 30`,
    post.channel_id, postId,
  ).map((r) => { const m = r.metrics; return m.reach ? (m.reactions + 2 * m.comments + 3 * m.shares + 2 * m.saves) / m.reach : 0; });
  const early = q.all<Row>(`SELECT s.metrics FROM post_metric_snapshot s JOIN post p ON p.id = s.post_id WHERE p.channel_id = ? AND s.mark = '6h' LIMIT 30`, post.channel_id)
    .map((r) => { const m = r.metrics; return m.reactions + 2 * m.comments + 3 * m.shares + 2 * m.saves; }).sort((a, b) => a - b);
  const labels = q.all<Row>("SELECT label, COUNT(*) n FROM post_comment WHERE post_id = ? AND label IS NOT NULL AND COALESCE(label_source, '') != 'system' GROUP BY label", postId);
  const cnt = (l: string) => labels.find((x) => x.label === l)?.n ?? 0;
  const total = labels.reduce((a, x) => a + x.n, 0);

  // Jev: post fit to the active goal's focus products
  const goal = q.get<Row>("SELECT title FROM goal WHERE biz_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", post.biz_id);
  const fj = await judge({
    bizId: post.biz_id, purpose: "post.fit", subject: { type: "post", id: postId },
    state: { goal: { title: goal?.title ?? "Tăng học viên", focus_products: ((q.get<Row>("SELECT data FROM dna_profile WHERE biz_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1", post.biz_id)?.data?.products ?? []) as Row[]).filter((p) => p.verified !== false).map((p) => p.name) }, post: { title: post.title, body: String(post.body).slice(0, 1500) } },
    questions: postFitQuestions, heuristic: postFitHeuristic,
  });
  const fit = norm((fj.answers as any).fit);

  const r = scorePost({
    kind: post.kind, hasCta: /bình luận|nhắn|inbox|đăng ký/i.test(post.body), ageHours: (Date.now() - new Date(post.published_at).getTime()) / hourMs(post.biz_id),
    snapshots, channelEngagementRates: channelRates.length ? channelRates : [0.02, 0.03, 0.04],
    channelMedianEarly: early.length ? early[Math.floor(early.length / 2)] : 150,
    commentLabels: { purchase_intent: cnt("purchase_intent"), negative: cnt("negative"), total },
    fit,
  });
  insert("post_score", { biz_id: post.biz_id, post_id: postId, formula_version: FORMULA_VERSION, score: r.score, low_data: r.lowData ? 1 : 0, components: r.components, reasons: r.reasons, computed_at: nowIso() });
  recordDecision(fj.id, { fit, postScore: r.score });
  emit(post.biz_id, "post.scored", { postId, score: r.score });
  maybeCreateCandidate(post, r.score, r.lowData, r.reasons);
}

// ---------------- 9.2 Ad Selector ----------------
export function maybeCreateCandidate(post: Row, score: number, lowData: boolean, reasons: string[]) {
  const s = bizSettings(post.biz_id);
  if (lowData || score < s.postScoreThreshold || post.ad_status !== "none") return null;
  if (q.get("SELECT id FROM ad_candidate WHERE post_id = ? AND status IN ('proposed','approved','publishing','published')", post.id)) return null;
  const today = q.scalar<number>("SELECT COUNT(*) FROM ad_candidate WHERE biz_id = ? AND created_at >= ?", post.biz_id, new Date(Date.now() - 24 * 3600_000).toISOString());
  if (today >= s.caps.maxAdsCreatedPerDay) return null;
  const channel = byId<Row>("channel", post.channel_id)!;
  // Bài Instagram không "boost" được theo cách Meta (id media IG ≠ id bài Trang); bài TikTok chỉ khi có id video thật (số).
  if (channel.platform === "instagram" || channel.platform === "website") return null; // bài website không phải bài Trang để chạy quảng cáo
  if (channel.platform === "tiktok" && !/^\d{10,}$/.test(String(post.external_id))) return null;
  const platform = channel.platform === "tiktok" ? "tiktok" : "meta";
  const tpl = q.get<Row>("SELECT id FROM ad_template WHERE biz_id = ? AND platform = ? LIMIT 1", post.biz_id, platform);
  const cand = insert("ad_candidate", { biz_id: post.biz_id, post_id: post.id, platform, ad_template_id: tpl?.id ?? null, daily_budget: 2_000_000, score, reasons, status: "proposed" });
  update("post", post.id, { ad_status: "candidate" });
  const approval = insert("approval", {
    biz_id: post.biz_id, subject_type: "ad_candidate", subject_id: cand.id, agent_key: "ads", title: `Chạy ads từ bài: ${post.title}`,
    risk: "medium", status: "pending", preview: { platform, dailyBudget: 2_000_000, score, reasons },
    expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
  });
  emit(post.biz_id, "approval.created", { approvalId: approval.id, title: approval.title });
  return cand;
}

export { COMMENT_LABELS };
