import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, byId, q, update, type Row } from "@dotaka/db";
import { BROWSER_SITES, addBrowserChannel, channelPublishInfo, checkBrowserLogin, encryptionKeyReady, flowSettings, isOAuthProvider, oauthStatus, openLoginPage, publicStatus, saveOAuthApp, setChannelEnabled, setDefaultChannel, setPublishVia, startOAuth } from "@dotaka/orchestrator";
import { effectiveProvider } from "@dotaka/llm-gateway";
import { AppError } from "@dotaka/shared";
import { routes } from "../http.ts";
import { oauthCallback } from "./oauth-callback.ts";

/**
 * "Kênh đăng": per channel, how a post really goes out — Liên kết API (live Page token from Trung tâm tích hợp) or
 * Cách 2 · Đăng qua Chrome (Chrome Flow with the CEO's own login). No simulated route.
 */
export function channelRoutes(app: FastifyInstance) {
  const r = routes(app);

  r.get("/v1/publish-channels", ({ bizId }) => {
    const fs = flowSettings(bizId);
    return {
      chrome: { profile: fs.chromeProfileDir, name: fs.chromeProfileName, email: fs.chromeProfileEmail, claudeCli: effectiveProvider(bizId).provider === "claude_cli" },
      sites: Object.fromEntries(Object.entries(BROWSER_SITES).map(([k, s]) => [k, { name: s.name, login: s.login }])),
      // Địa chỉ công khai (Instagram tải media, link đo click, TikTok OAuth) + khóa mã hóa đã sẵn sàng chưa.
      public: publicStatus(), encryptionKey: encryptionKeyReady(),
      channels: q.all<Row>("SELECT * FROM channel WHERE biz_id = ? ORDER BY platform, name", bizId).map(channelPublishInfo),
    };
  });
  // Channels without an API link (TikTok, Instagram, a Fanpage before the token is pasted) are added by hand — link of the
  // Page/account is required (it fixes the channel id, so the same Page is never added twice). First one = "kênh đăng chính".
  r.post("/v1/publish-channels", ({ bizId, body, actor }) => addBrowserChannel(bizId, body, actor));
  // Bật/tắt kênh, và đặt "kênh đăng chính" của nền tảng (bài duyệt xong đăng vào kênh này).
  r.put("/v1/publish-channels/:id/enabled", ({ bizId, params, body, actor }) => {
    const ch = byId<Row>("channel", params.id);
    if (!ch || ch.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy kênh", 404);
    const enabled = z.object({ enabled: z.boolean() }).parse(body).enabled;
    if (!enabled && q.get("SELECT id FROM publish_job WHERE channel_id = ? AND status IN ('scheduled','posting','verifying') AND mode != 'draft'", ch.id)) throw new AppError("IN_USE", "Kênh đang có bài chờ đăng — chờ đăng xong hoặc huỷ trước khi tắt");
    return setChannelEnabled(bizId, ch.id, enabled, actor);
  });
  r.put("/v1/publish-channels/:id/default", ({ bizId, params, actor }) => {
    const ch = byId<Row>("channel", params.id);
    if (!ch || ch.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy kênh", 404);
    return setDefaultChannel(bizId, ch.id, actor);
  });
  r.del("/v1/publish-channels/:id", ({ bizId, params, actor }) => {
    const ch = byId<Row>("channel", params.id);
    if (!ch || ch.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy kênh", 404);
    if (ch.connection_id) throw new AppError("LINKED", "Kênh này đến từ kết nối API — gỡ ở Trung tâm tích hợp");
    if (q.get("SELECT id FROM publish_job WHERE channel_id = ? AND status IN ('scheduled','posting','verifying')", ch.id)) throw new AppError("IN_USE", "Kênh đang có bài chờ đăng");
    update("channel", ch.id, { enabled: 0, meta: { ...(ch.meta ?? {}), removedAt: new Date().toISOString() } });
    audit(bizId, actor, "channel.removed", { type: "channel", id: ch.id }, { name: ch.name });
    return { ok: true };
  });
  r.post("/v1/publish-channels/:id/open-login", async ({ bizId, params }) => {
    const ch = byId<Row>("channel", params.id);
    if (!ch || ch.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy kênh", 404);
    return openLoginPage(bizId, ch.platform);
  });
  r.post("/v1/publish-channels/:id/check-login", ({ bizId, params, actor }) => checkBrowserLogin(bizId, params.id, actor));
  r.put("/v1/publish-channels/:id/via", ({ bizId, params, body, actor }) =>
    setPublishVia(bizId, params.id, z.object({ via: z.enum(["auto", "browser"]) }).parse(body).via, actor));
  // TikTok: Sếp đánh dấu app "đã được TikTok duyệt" → mới đăng CÔNG KHAI qua API (chưa duyệt: API chỉ gửi bản nháp vào hộp thư).
  r.put("/v1/publish-channels/:id/tiktok-audited", ({ bizId, params, body, actor }) => {
    const ch = byId<Row>("channel", params.id);
    if (!ch || ch.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy kênh", 404);
    const conn = ch.connection_id ? byId<Row>("connection", ch.connection_id) : undefined;
    if (ch.platform !== "tiktok" || conn?.platform !== "tiktok_post") throw new AppError("NOT_TIKTOK_API", "Kênh này chưa nối API TikTok — bấm Kết nối TikTok trước");
    const audited = z.object({ audited: z.boolean() }).parse(body).audited;
    update("connection", conn.id, { config: { ...(conn.config ?? {}), audited: audited ? "1" : "" } });
    audit(bizId, actor, "channel.tiktok_audited", { type: "channel", id: ch.id }, { audited });
    return channelPublishInfo(byId<Row>("channel", ch.id)!);
  });

  // ---------------- Kết nối bằng nút đăng nhập (OAuth) ----------------
  const provider = (p: string) => {
    if (!isOAuthProvider(p)) throw new AppError("NOT_SUPPORTED", "Nền tảng chưa hỗ trợ đăng nhập bằng nút");
    return p;
  };
  // Không bao giờ trả App Secret / token (chỉ dạng rút gọn của App ID).
  r.get("/v1/oauth", ({ bizId }) => oauthStatus(bizId));
  r.put("/v1/oauth/:provider/app", ({ bizId, params, body, actor }) => {
    saveOAuthApp(bizId, provider(params.provider), z.object({ id: z.string().trim().min(3).max(200), secret: z.string().trim().min(6).max(500) }).parse(body), actor);
    return oauthStatus(bizId);
  });
  // returnTo: trang web đang mở (localhost) để quay về đúng chỗ; ads = tick "Gồm quyền quảng cáo" (mặc định TẮT).
  r.post("/v1/oauth/:provider/start", ({ bizId, params, body }) => {
    const p = z.object({ returnTo: z.string().max(500).optional(), ads: z.boolean().optional() }).parse(body);
    return startOAuth(bizId, provider(params.provider), p.returnTo, { ads: p.ads });
  });
  // Callback chạy cả trên app chính (localhost) lẫn cổng công khai — cùng 1 handler (state kiểm trong finishOAuth).
  app.get("/v1/oauth/:provider/callback", oauthCallback);
}
