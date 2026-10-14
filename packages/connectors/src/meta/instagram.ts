import { sleep } from "@dotaka/shared";
import { ConnectorError } from "../errors.ts";
import type { Connector } from "../index.ts";
import { graphGet, graphPost } from "./graph.ts";

/**
 * Đăng bài Instagram qua Graph API (Content Publishing) — tài khoản Instagram Business gắn với Fanpage, dùng token của Trang.
 * Chỉ phần ĐĂNG + bình luận + số liệu (nhắn tin / trả lời bình luận Instagram chưa có trong hệ thống này).
 *  - Instagram chỉ nhận media qua LINK CÔNG KHAI (image_url / video_url): cần `media.publicUrl` (PUBLIC_BASE_URL + cổng công khai).
 *    Không có → NeedsBrowser (đăng qua Chrome nếu kênh đã thiết lập).
 *  - Chống đăng trùng: id container và id bài đã đăng được báo qua `onPending` → lần thử lại chỉ hỏi tiếp, không tạo container mới.
 *  - Instagram không có bản nháp qua API (uploadDraft → NeedsBrowser). Ghi qua graphPost: không bao giờ tự thử lại.
 */
export function instagramConnector(token: string, igUserId: string, opts: { pollMs?: number; maxPolls?: number } = {}): Connector {
  const pollMs = opts.pollMs ?? 5000;
  const maxPolls = opts.maxPolls ?? 60; // video cần xử lý: chờ ~5 phút
  const permalinkOf = async (id: string) => {
    const m: any = await graphGet(token, id, { fields: "permalink" }).catch(() => ({})); // chỉ để hiển thị, không làm hỏng bài đã đăng
    return { externalId: id, permalink: String(m.permalink ?? "https://www.instagram.com/") };
  };
  return {
    platform: "meta", mode: "live", limits: { requestsPerMinute: 30, concurrency: 1 },
    async health() {
      const p = await graphGet(token, igUserId, { fields: "id,username" });
      return { ok: true, detail: `Instagram @${p.username ?? igUserId}` };
    },
    async publishPost(spec) {
      const saved = (spec.resume ?? {}) as { containerId?: string | null; mediaId?: string | null };
      if (saved.mediaId) return permalinkOf(String(saved.mediaId));
      if (!spec.media) throw new ConnectorError("InvalidRequest", "Instagram không đăng bài chỉ có chữ — cần ảnh hoặc video");
      if (!spec.media.publicUrl) throw new ConnectorError("NeedsBrowser", "Instagram API cần link media công khai (PUBLIC_BASE_URL + cổng PUBLIC_PORT) — chuyển sang đăng qua Chrome");
      let containerId = saved.containerId ? String(saved.containerId) : undefined;
      if (!containerId) {
        const isVideo = spec.media.mime.startsWith("video/");
        const c = await graphPost(token, `${igUserId}/media`, isVideo
          ? { media_type: "REELS", video_url: spec.media.publicUrl, caption: spec.text, share_to_feed: "true" }
          : { image_url: spec.media.publicUrl, caption: spec.text });
        containerId = String(c.id);
        spec.onPending?.({ containerId });
      }
      for (let i = 0; ; i++) {
        const st = await graphGet(token, containerId, { fields: "status_code,status" });
        if (st.status_code === "FINISHED") break;
        if (st.status_code === "PUBLISHED") {
          // Đã đăng ở lần trước nhưng mình không giữ được id bài → không thể tự xác nhận: Sếp kiểm tra.
          throw Object.assign(new ConnectorError("InvalidRequest", "Instagram: container này đã được đăng trước đó — kiểm tra bài trên Instagram"), { outcomeUnknown: true });
        }
        if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
          spec.onPending?.({ containerId: null }); // container hỏng → lần sau tạo lại
          throw new ConnectorError("InvalidRequest", `Instagram xử lý media lỗi: ${st.status ?? st.status_code} — kiểm tra định dạng (Reels MP4 H.264/AAC 3 giây–15 phút, ảnh JPEG) và link media công khai`);
        }
        if (i >= maxPolls) throw Object.assign(new ConnectorError("Transient", "Instagram xử lý media quá lâu — hệ thống sẽ kiểm tra lại (không tạo bài mới)"), { resumable: true });
        await sleep(pollMs);
      }
      const r = await graphPost(token, `${igUserId}/media_publish`, { creation_id: containerId });
      const id = String(r.id);
      spec.onPending?.({ containerId, mediaId: id });
      return permalinkOf(id);
    },
    async verifyPost(externalId) {
      await graphGet(token, externalId, { fields: "id" });
      return true;
    },
    async postComment(spec) {
      // POST /{ig-media-id}/comments (instagram_manage_comments). Link trong bình luận Instagram KHÔNG bấm được.
      const r = await graphPost(token, `${spec.postExternalId}/comments`, { message: spec.text });
      return { externalId: String(r.id) };
    },
    async fetchPostMetrics(post) {
      const m = await graphGet(token, post.externalId, { fields: "like_count,comments_count" });
      const ins = await graphGet(token, `${post.externalId}/insights`, { metric: "reach,saved,shares" }).catch(() => ({ data: [] }));
      const v = (n: string) => Number(ins.data?.find((x: any) => x.name === n)?.values?.[0]?.value ?? 0);
      return { reach: v("reach"), reactions: Number(m.like_count ?? 0), comments: Number(m.comments_count ?? 0), shares: v("shares"), saves: v("saved") };
    },
    async uploadDraft() {
      throw new ConnectorError("NeedsBrowser", "Instagram API không có bản nháp — chuyển sang Chrome");
    },
  };
}
