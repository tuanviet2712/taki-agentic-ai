import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { byId, q, type Row } from "@dotaka/db";
import { attachLinkComment, clicksForPost, importExternalPost, linkCommentSettings, linkCommentStatus, publicStatus, saveLinkCommentSettings } from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { routes } from "../http.ts";

/**
 * "Gắn link dưới bình luận": trạng thái từng bài, gắn tay / gắn lại, gắn cho bài có sẵn trên Fanpage, cài đặt tự gắn.
 * Sản phẩm = mục products[] của DNA (không có thực thể "sản phẩm affiliate").
 */
export function commentLinkRoutes(app: FastifyInstance) {
  const r = routes(app);
  const Body = z.object({ url: z.string().max(2000).optional(), text: z.string().max(1500).optional(), productKey: z.string().max(160).optional() });

  r.get("/v1/posts/:id/comment-link", ({ bizId, params }) => {
    const p = byId<Row>("post", params.id);
    if (!p || p.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy bài", 404);
    return { ...linkCommentStatus(p), clicks: clicksForPost(p) };
  });
  r.post("/v1/posts/:id/comment-link", ({ bizId, params, body, actor }) => attachLinkComment(bizId, params.id, Body.parse(body), actor));

  // Bài có sẵn trên Fanpage (lấy từ GET /v1/pages/:id/posts) → tạo bản ghi bài rồi gắn link
  r.post("/v1/channels/:id/external-posts/comment-link", async ({ bizId, params, body, actor }) => {
    const ch = byId<Row>("channel", params.id);
    if (!ch || ch.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy kênh", 404);
    const p = Body.extend({ externalId: z.string().min(1).max(200), postText: z.string().max(5000).nullable().optional(), permalink: z.string().max(1000).nullable().optional(), createdAt: z.string().max(60).nullable().optional() }).parse(body);
    if (!p.url?.trim() && !p.productKey) throw new AppError("NO_LINK", "Chọn sản phẩm hoặc nhập link cần gắn");
    const post = importExternalPost(bizId, ch.id, { externalId: p.externalId, text: p.postText, permalink: p.permalink, createdAt: p.createdAt });
    return { postId: post.id, ...(await attachLinkComment(bizId, post.id, { url: p.url, text: p.text, productKey: p.productKey }, actor)) };
  });

  // Fanpage thật (có token) để chọn bài có sẵn
  r.get("/v1/comment-link/channels", ({ bizId }) => q.all<Row>(
    `SELECT ch.id, ch.platform, ch.name FROM channel ch JOIN connection c ON c.id = ch.connection_id
     WHERE ch.biz_id = ? AND ch.platform = 'facebook' AND ch.enabled = 1 AND ch.secret_ciphertext IS NOT NULL AND c.mode = 'live' AND c.status != 'revoked'
       AND json_extract(ch.meta, '$.removedAt') IS NULL ORDER BY ch.name`, bizId));

  // Cài đặt tự gắn + tình trạng đo click (địa chỉ công khai) — hiện trên trang Đăng bài.
  r.get("/v1/link-comment/settings", ({ bizId }) => ({ settings: linkCommentSettings(bizId), public: publicStatus() }));
  r.put("/v1/link-comment/settings", ({ bizId, body, actor }) => ({ settings: saveLinkCommentSettings(bizId, z.object({
    auto: z.boolean().optional(), autoGuess: z.boolean().optional(), fallbackMain: z.boolean().optional(),
    facebook: z.string().max(500).optional(), instagram: z.string().max(500).optional(), tiktok: z.string().max(500).optional(),
  }).parse(body), actor), public: publicStatus() }));
  // Chỉ đọc: PUBLIC_BASE_URL / cổng công khai có đang dùng được không (không đổi gì).
  r.get("/v1/public/status", () => publicStatus());
}
