import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb } from "@dotaka/db";
import { publicGatewayState, setPublicGateway } from "@dotaka/orchestrator";
import { errorHandler } from "./http.ts";
import { registerLocalGuard } from "./local-guard.ts";
import { startPublicGateway } from "./public-gateway.ts";
import { registerApiRoutes } from "./register-routes.ts";

/**
 * API khởi động được: dựng Fastify với TẤT CẢ module route đúng như server.ts (cùng hàm registerApiRoutes) rồi `app.ready()`.
 * Bắt các lỗi chỉ lộ lúc khởi động mà test từng route lẻ không thấy — vd. đăng ký trùng trình phân tích content-type,
 * trùng đường dẫn route, route thiếu handler. Giữ test này trong bộ test; thêm module route mới ở register-routes.ts.
 */
let app: FastifyInstance;

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  insert("biz", { name: "Doanh nghiệp thử", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } });
  app = Fastify({ logger: false, genReqId: () => crypto.randomUUID() });
  await app.register(cors, { origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });
  app.setErrorHandler(errorHandler);
  registerLocalGuard(app); // giống server.ts: chặn Host lạ / ghi chéo trang
  registerApiRoutes(app);
});
afterAll(async () => {
  await app.close();
  closeDb();
});

describe("khởi động API", () => {
  it("đăng ký đủ mọi module route rồi app.ready() không lỗi", async () => {
    await expect(app.ready()).resolves.toBeDefined();
  });

  it("các route chính đã có (chat, kịch bản chốt đơn, thấu hiểu khách, ảnh, webhook, Messenger, chăm khách)", () => {
    const has = (method: "GET" | "POST" | "PUT" | "DELETE", url: string) => app.hasRoute({ method, url });
    for (const [m, u] of [
      ["GET", "/v1/conversations"], ["GET", "/v1/conversations/:id"], ["POST", "/v1/conversations/:id/reply"], ["POST", "/v1/conversations/:id/image"],
      ["GET", "/v1/chat/media/:messageId/:index"], ["POST", "/hooks/:platform"], ["POST", "/v1/simulate/message"],
      ["GET", "/v1/sales-flows"], ["GET", "/v1/sales-flows/:key"], ["PUT", "/v1/sales-flows/:key"], ["POST", "/v1/sales-flows/:key/generate"],
      ["POST", "/v1/sales-flows/:key/status"], ["POST", "/v1/sales-flows/:key/try"],
      ["GET", "/v1/chat-insights/latest"], ["POST", "/v1/chat-insights/run"],
      // Đơn hàng ↔ Pancake: /v1/orders (chat.ts) cùng tồn tại với /v1/orders/draft/:approvalId, /v1/orders/by-conversation/:id, /v1/orders/:id
      ["GET", "/v1/orders"], ["GET", "/v1/orders/draft/:approvalId"], ["GET", "/v1/orders/by-conversation/:id"], ["GET", "/v1/orders/:id"],
      ["POST", "/v1/orders/:id/push-pancake"], ["POST", "/v1/orders/:id/status"], ["POST", "/v1/orders/pancake-sync"],
      ["GET", "/v1/pancake/overview"], ["GET", "/v1/pancake/variations"], ["PUT", "/v1/pancake/products/:key"], ["DELETE", "/v1/pancake/products/:key"],
      ["POST", "/v1/approvals/:id/decide"],
      // Link dưới bình luận + đăng nhập bằng nút + kênh Instagram / TikTok
      ["GET", "/v1/posts/:id/comment-link"], ["POST", "/v1/posts/:id/comment-link"], ["POST", "/v1/channels/:id/external-posts/comment-link"],
      ["GET", "/v1/comment-link/channels"], ["GET", "/v1/link-comment/settings"], ["PUT", "/v1/link-comment/settings"], ["GET", "/v1/public/status"],
      ["GET", "/v1/oauth"], ["PUT", "/v1/oauth/:provider/app"], ["POST", "/v1/oauth/:provider/start"], ["GET", "/v1/oauth/:provider/callback"],
      ["PUT", "/v1/publish-channels/:id/tiktok-audited"], ["GET", "/v1/publish-channels"],
      ["GET", "/v1/nurture"], ["GET", "/v1/messenger/sync/status"], ["PUT", "/v1/messenger/bot"], ["GET", "/v1/approvals"], ["GET", "/v1/stream"],
      // Kênh Email
      ["GET", "/v1/email/status"], ["GET", "/v1/email/contacts"], ["POST", "/v1/email/contacts/import"], ["GET", "/v1/email/segments"], ["GET", "/v1/email/templates"],
      ["GET", "/v1/email/campaigns"], ["POST", "/v1/email/campaigns/:id/submit"], ["GET", "/v1/email/sequences"], ["POST", "/v1/email/sequences/:id/submit"],
      ["POST", "/v1/email/test"], ["POST", "/v1/email/domain/setup"], ["GET", "/v1/email/deliverability"],
    ] as const) expect(has(m, u), `${m} ${u}`).toBe(true);
  });

  it("route đọc trả 200 với DB trống (không lỗi khi chưa có DNA / kịch bản)", async () => {
    for (const url of ["/v1/sales-flows", "/v1/chat-insights/latest", "/v1/conversations", "/v1/conversations/counts", "/v1/orders", "/v1/pancake/overview",
      "/v1/link-comment/settings", "/v1/public/status", "/v1/oauth", "/v1/publish-channels", "/v1/comment-link/channels", "/v1/posts",
      "/v1/email/status", "/v1/email/contacts", "/v1/email/segments", "/v1/email/templates", "/v1/email/campaigns", "/v1/email/sequences", "/v1/email/sequence-presets", "/v1/email/deliverability", "/v1/email/messages"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, `${url} -> ${res.body.slice(0, 200)}`).toBe(200);
    }
  });

  it("lớp chặn Host không làm hỏng cách gọi cục bộ (127.0.0.1 / localhost) nhưng chặn Host lạ", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/orders", headers: { host: "127.0.0.1:8787" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/orders", headers: { host: "xyz.trycloudflare.com" } })).statusCode).toBe(421);
  });

  it("khởi động CÓ PUBLIC_PORT (cổng tạm): cổng công khai cùng chạy với API chính, mỗi bên chỉ có route của mình", async () => {
    const pub = await startPublicGateway({ PUBLIC_PORT: "0" } as NodeJS.ProcessEnv, 8787);
    expect(pub).not.toBeNull();
    try {
      await pub!.ready();
      expect(publicGatewayState().listening).toBe(true);
      const port = (pub!.server.address() as { port: number }).port;
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
      // cổng công khai không có route của API chính; API chính không có /r và /m
      expect(pub!.hasRoute({ method: "GET", url: "/v1/orders" })).toBe(false);
      expect(pub!.hasRoute({ method: "POST", url: "/v1/approvals/:id/decide" })).toBe(false);
      expect(app.hasRoute({ method: "GET", url: "/r/:code" })).toBe(false);
      expect(app.hasRoute({ method: "GET", url: "/m/:token" })).toBe(false);
    } finally {
      await pub!.close();
      setPublicGateway({ listening: false });
    }
  });
});
