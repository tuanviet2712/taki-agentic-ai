import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { setConversationConnector } from "@dotaka/chat-engine";
import { liveMessengerConnector } from "@dotaka/orchestrator";
import { encryptSecret } from "@dotaka/shared";
import { errorHandler } from "./http.ts";
import { chatRoutes } from "./routes/chat.ts";

/**
 * Trang Chat qua API: cửa sổ 24 giờ (canReply + chặn trả lời TRƯỚC khi đổi trạng thái), nhân viên gửi ảnh (byte ảnh → Send API
 * multipart), xem ảnh đã lưu theo đúng doanh nghiệp. Facebook là fetch giả; dữ liệu ở thư mục tạm + DB :memory:.
 */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let sendSeq = 0;
function mockFetch() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method ?? "GET"), body: init?.body });
    if (/\/messages$/.test(String(url)) && init?.method === "POST") return new Response(JSON.stringify({ recipient_id: "x", message_id: `m_sent_${++sendSeq}` }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  }));
}
const sends = () => calls.filter((c) => c.method === "POST" && /\/messages$/.test(c.url));

let B: string, B2: string, app: FastifyInstance, tmp: string;
const mkConv = (psid: string, extra: Row = {}) =>
  insert("conversation", { biz_id: B, channel: "messenger", external_id: psid, customer_ref: `cust_${psid}`, customer_name: "Khách", state: "awaiting_customer", tags: [], unread: 0, ext: { pageId: "PAGE1" }, last_customer_at: new Date().toISOString(), ...extra });

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "taki-chat-routes-"));
  process.env.DATA_DIR = tmp;
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  B2 = insert("biz", { name: "Shop Khác", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  const conn = insert("connection", { biz_id: B, platform: "meta", external_account_id: "u1", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
  insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Shop Lan", external_id: "PAGE1", connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
  setConversationConnector(liveMessengerConnector);
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  chatRoutes(app);
  await app.ready();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await app.close();
  setConversationConnector(() => null);
  closeDb();
  delete process.env.DATA_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

describe("cửa sổ 24 giờ", () => {
  it("quá 24 giờ: chi tiết báo canReply=false; trả lời bị chặn 409 OUTSIDE_24H, không gọi Facebook, không đổi trạng thái", async () => {
    mockFetch();
    const c = mkConv("PSID_8", { last_customer_at: new Date(Date.now() - 25 * 3600_000).toISOString() });
    const detail = await app.inject({ method: "GET", url: `/v1/conversations/${c.id}`, headers: { "x-biz-id": B } });
    expect(detail.json()).toMatchObject({ canReply: false, replyWindowLimited: true, replyWindowEndsAt: expect.any(String) });
    const res = await app.inject({ method: "POST", url: `/v1/conversations/${c.id}/reply`, payload: { text: "Dạ shop chào chị" }, headers: { "x-biz-id": B } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "OUTSIDE_24H", message: "Facebook chỉ cho nhắn trong 24 giờ kể từ tin cuối của khách — khách cần nhắn lại trước" });
    expect(calls).toHaveLength(0);
    expect(byId<Row>("conversation", c.id)!.state).toBe("awaiting_customer");

    update("conversation", c.id, { last_customer_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    expect((await app.inject({ method: "GET", url: `/v1/conversations/${c.id}`, headers: { "x-biz-id": B } })).json()).toMatchObject({ canReply: true, replyWindowLimited: true });
    expect((await app.inject({ method: "POST", url: `/v1/conversations/${c.id}/reply`, payload: { text: "Dạ shop chào chị" }, headers: { "x-biz-id": B } })).statusCode).toBe(200);
    expect(sends()).toHaveLength(1);
    expect(byId<Row>("conversation", c.id)!.state).toBe("human_active");
  });
});

describe("nhân viên gửi ảnh + xem ảnh", () => {
  it("tải ảnh lên → Send API multipart, lưu tin; xem ảnh đúng doanh nghiệp (doanh nghiệp khác → 404)", async () => {
    mockFetch();
    const c = mkConv("PSID_IMG", { state: "bot_active" });
    const res = await app.inject({ method: "POST", url: `/v1/conversations/${c.id}/image?name=${encodeURIComponent("ảnh mẫu.png")}`, payload: PNG, headers: { "content-type": "image/png", "x-biz-id": B } });
    expect(res.statusCode).toBe(200);
    expect(sends()).toHaveLength(1);
    expect((sends()[0].body as FormData).get("filedata")).toBeInstanceOf(Blob);
    const m = q.get<Row>("SELECT * FROM message WHERE conversation_id = ? AND direction = 'out' ORDER BY sent_at DESC LIMIT 1", c.id)!;
    expect(m).toMatchObject({ sender: "human", body: { text: "[Ảnh]" } });
    expect(m.meta.attachments[0]).toMatchObject({ type: "image", name: "ảnh mẫu.png", stored: expect.stringMatching(/^out-\w+\.png$/) });
    expect(byId<Row>("conversation", c.id)!.state).toBe("human_active");

    const view = await app.inject({ method: "GET", url: `/v1/chat/media/${m.id}/0`, headers: { "x-biz-id": B } });
    expect(view.statusCode).toBe(200);
    expect(view.headers["content-type"]).toBe("image/png");
    expect(view.rawPayload.equals(PNG)).toBe(true);
    expect((await app.inject({ method: "GET", url: `/v1/chat/media/${m.id}/0`, headers: { "x-biz-id": B2 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/chat/media/${m.id}/3`, headers: { "x-biz-id": B } })).statusCode).toBe(404);
  });

  it("quá 24 giờ → 409, không gọi Facebook, không để tệp mồ côi; không phải ảnh → 400; thân JSON → 400; doanh nghiệp khác → 404", async () => {
    mockFetch();
    const c = mkConv("PSID_IMG2", { last_customer_at: new Date(Date.now() - 30 * 3600_000).toISOString() });
    const blocked = await app.inject({ method: "POST", url: `/v1/conversations/${c.id}/image`, payload: PNG, headers: { "content-type": "image/png", "x-biz-id": B } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("OUTSIDE_24H");
    expect(sends()).toHaveLength(0);
    expect(q.scalar<number>("SELECT COUNT(*) FROM message WHERE conversation_id = ?", c.id)).toBe(0);

    update("conversation", c.id, { last_customer_at: new Date().toISOString() });
    const bad = await app.inject({ method: "POST", url: `/v1/conversations/${c.id}/image`, payload: Buffer.from("<script>alert(1)</script>"), headers: { "content-type": "image/png", "x-biz-id": B } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("BAD_TYPE");
    const json = await app.inject({ method: "POST", url: `/v1/conversations/${c.id}/image`, payload: { path: "C:/x.png" }, headers: { "x-biz-id": B } });
    expect(json.statusCode).toBe(400);
    const other = await app.inject({ method: "POST", url: `/v1/conversations/${c.id}/image`, payload: PNG, headers: { "content-type": "image/png", "x-biz-id": B2 } });
    expect(other.statusCode).toBe(404);
    expect(sends()).toHaveLength(0);
  });
});
