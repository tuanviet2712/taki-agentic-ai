import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { handleIncoming, setConversationConnector } from "@dotaka/chat-engine";
import type { Connector } from "@dotaka/connectors";
import { errorHandler } from "./http.ts";
import { chatRoutes } from "./routes/chat.ts";

/**
 * Trang "Kịch bản chốt đơn" qua API: danh sách theo sản phẩm trong DNA, soạn / lưu / bật / tạm tắt, chat thử không gửi gì,
 * chi tiết hội thoại mang gợi ý + bảng hỗ trợ, vòng lặp Thấu hiểu khách chạy được. Offline (LLM sandbox).
 */
const sent: string[] = [];
const fakeLive = (): Connector => ({
  platform: "meta", mode: "live", limits: { requestsPerMinute: 60, concurrency: 2 },
  health: async () => ({ ok: true, detail: "fake" }),
  sendMessage: async (spec) => { sent.push(spec.text); return { externalId: `m_${sent.length}` }; },
});
const KH = { key: "khoa-ai", name: "Khóa AI Marketing", summary: "Khóa học offline 3 ngày", price: 12_000_000, format: "Offline", link: "https://khoa.example.vn/ai" };

let app: FastifyInstance;
let B: string;
const call = async (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, payload: payload as any, headers: { "x-biz-id": B } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Học viện Mẫu", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "test", data: { company: { name: "Học viện Mẫu", brand: "Mẫu" }, forbiddenClaims: ["cam kết kết quả"], bannedChars: [], products: [KH] } });
  setConversationConnector(() => fakeLive());
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  chatRoutes(app);
  await app.ready();
});
afterAll(async () => { await app.close(); setConversationConnector(() => null); closeDb(); });

describe("API kịch bản chốt đơn", () => {
  it("danh sách theo sản phẩm DNA; soạn → nháp; câu cấm không cho bật; bật; chat thử không gửi; tạm tắt; sản phẩm lạ 404", async () => {
    const list = await call("GET", "/v1/sales-flows");
    expect(list.body).toMatchObject([{ key: KH.key, status: "none", objective: "phone_consult" }]);
    const gen = await call("POST", `/v1/sales-flows/${KH.key}/generate`, { note: "ưu tiên xin Zalo" });
    expect(gen.status).toBe(200);
    expect(gen.body).toMatchObject({ status: "draft", flow: { mode: "auto" } });
    const bad = structuredClone(gen.body.flow);
    bad.stages[0].sayLike = ["Học xong cam kết kết quả luôn ạ"];
    const blocked = await call("PUT", `/v1/sales-flows/${KH.key}`, { flow: bad, status: "active" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe("FLOW_BLOCKED");
    const on = await call("PUT", `/v1/sales-flows/${KH.key}`, { flow: { ...gen.body.flow, mode: "suggest" }, status: "active" });
    expect(on.body).toMatchObject({ status: "active", flow: { mode: "suggest" } });
    const before = q.scalar<number>("SELECT COUNT(*) FROM message");
    const t = await call("POST", `/v1/sales-flows/${KH.key}/try`, { messages: [{ from: "customer", text: "học phí bao nhiêu shop" }] });
    expect(t.body).toMatchObject({ stage: "tu_van", sent: false });
    expect(q.scalar<number>("SELECT COUNT(*) FROM message")).toBe(before);
    expect(sent).toHaveLength(0);
    expect((await call("POST", `/v1/sales-flows/${KH.key}/status`, { status: "paused" })).body.status).toBe("paused");
    expect((await call("GET", "/v1/sales-flows/khong-co")).status).toBe(404);
    expect((await call("PUT", `/v1/sales-flows/${KH.key}`, { flow: { objective: "x" } })).status).toBeGreaterThanOrEqual(400);
    await call("POST", `/v1/sales-flows/${KH.key}/status`, { status: "active" });
  });

  it("chi tiết hội thoại mang gợi ý + bảng hỗ trợ (flowHelp); danh sách mang 'Bước'; chạy vòng lặp Thấu hiểu khách", async () => {
    const r = await handleIncoming(B, { channel: "messenger", externalConversationId: "psid_api", customerName: "Chị Hoa", text: "Khóa AI Marketing học phí bao nhiêu shop?", messageId: "a1", pageExternalId: "PAGE1" });
    expect(r.replied).toBe(false);
    const d = await call("GET", `/v1/conversations/${r.conversationId}`);
    expect(d.body.suggestion.text).toBeTruthy();
    expect(d.body.flowHelp).toMatchObject({ mode: "suggest", stage: "tu_van", step: 3 });
    const l = await call("GET", "/v1/conversations");
    expect(l.body.find((c: Row) => c.id === r.conversationId).flow_stage).toBe("Tư vấn theo nỗi đau");
    const run = await call("POST", "/v1/chat-insights/run", { days: 7, includeTest: true });
    expect(run.status).toBe(200);
    expect(run.body.insight.steps.collect.conversations).toBeGreaterThanOrEqual(1);
    expect((await call("GET", "/v1/chat-insights/latest")).body.insight.id).toBe(run.body.insight.id);
    expect(byId<Row>("conversation", r.conversationId)!.state).toBe("bot_active"); // gợi ý không đổi trạng thái
  });
});
