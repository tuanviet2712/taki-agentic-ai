import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, byId, insert, q, update, type Row } from "@dotaka/db";
import { BROWSER_SITES, channelPublishInfo, checkBrowserLogin, flowSettings, openLoginPage, setPublishVia } from "@dotaka/orchestrator";
import { effectiveProvider } from "@dotaka/llm-gateway";
import { AppError } from "@dotaka/shared";
import { routes } from "../http.ts";

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
      channels: q.all<Row>("SELECT * FROM channel WHERE biz_id = ? ORDER BY platform, name", bizId).map(channelPublishInfo),
    };
  });
  // Channels without an API link (TikTok, Instagram, a Fanpage before the token is pasted) are added by hand.
  r.post("/v1/publish-channels", ({ bizId, body, actor }) => {
    const p = z.object({
      platform: z.enum(["facebook", "instagram", "tiktok"]),
      name: z.string().trim().min(2).max(80),
      profileUrl: z.string().trim().url("Địa chỉ trang chưa đúng").max(300).optional().or(z.literal("")),
    }).parse(body);
    const kind = p.platform === "facebook" ? "page" : "business";
    const row = insert("channel", { biz_id: bizId, platform: p.platform, kind, name: p.name, external_id: `manual:${p.platform}:${Date.now()}`, connection_id: null, enabled: 1, whitelisted: 1, meta: { profileUrl: p.profileUrl || null, publishVia: "browser" } });
    audit(bizId, actor, "channel.added", { type: "channel", id: row.id }, { platform: p.platform, name: p.name });
    return channelPublishInfo(byId<Row>("channel", row.id)!);
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
}
