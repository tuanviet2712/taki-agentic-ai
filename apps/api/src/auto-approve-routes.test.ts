import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q } from "@dotaka/db";
import { errorHandler } from "./http.ts";
import { workRoutes } from "./routes/work.ts";

/** Tự động phê duyệt qua API: xem / bật / đặt ngưỡng (kiểm tra giá trị) / "Duyệt ngay"; tách biệt giữa các doanh nghiệp. */
let B: string, B2: string, app: FastifyInstance;
const api = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, biz = B) => app.inject({ method, url, payload: payload as any, headers: { "x-biz-id": biz } });
let n = 0;
function post(biz: string, total: number) {
  const t = insert("task", { biz_id: biz, goal_id: null, agent_key: "content", title: `Bài ${++n}`, status: "awaiting_approval", input: { noPublish: true }, depends_on: [] });
  const rv = insert("review_score", { biz_id: biz, subject_type: "content_item", subject_id: t.id, rubric_key: "content_social", rubric_version: 3, total, verdict: "pass", result: { fatalFindings: [] } });
  insert("content_item", { biz_id: biz, task_id: t.id, agent_key: "content", kind: "social_post", channel: "facebook", title: `Bài ${n}`, body: "x", status: "awaiting_approval", review_score_id: rv.id });
  return insert("approval", { biz_id: biz, subject_type: "task", subject_id: t.id, agent_key: "content", title: `Bài ${n}`, risk: "low", status: "pending", review_score_id: rv.id, preview: {} });
}

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  B2 = insert("biz", { name: "Shop Khác", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  workRoutes(app);
  await app.ready();
});
beforeEach(() => { for (const t of ["approval", "task", "content_item", "review_score", "job", "audit_log"]) q.run(`DELETE FROM ${t}`); });
afterAll(async () => { await app.close(); closeDb(); });

describe("/v1/auto-approve", () => {
  it("mặc định tắt, ngưỡng 85, thấp nhất 70", async () => {
    expect((await api("GET", "/v1/auto-approve")).json()).toMatchObject({ enabled: false, minScore: 85, min: 70, pendingEligible: 0, pendingReady: 0, recent: [] });
  });
  it("bật + đặt ngưỡng; giá trị sai bị từ chối; không lẫn sang doanh nghiệp khác", async () => {
    expect((await api("PUT", "/v1/auto-approve", { enabled: true, minScore: 90 })).json()).toMatchObject({ enabled: true, minScore: 90 });
    expect((await api("PUT", "/v1/auto-approve", { minScore: 60 })).statusCode).toBe(400);
    expect((await api("PUT", "/v1/auto-approve", { minScore: 101 })).statusCode).toBe(400);
    expect((await api("PUT", "/v1/auto-approve", {})).statusCode).toBe(400);
    expect((await api("GET", "/v1/auto-approve")).json()).toMatchObject({ enabled: true, minScore: 90 });
    expect((await api("GET", "/v1/auto-approve", undefined, B2)).json()).toMatchObject({ enabled: false, minScore: 85 });
  });
  it("/run duyệt các mục chờ đạt ngưỡng của đúng doanh nghiệp này, trả danh sách mục bỏ qua", async () => {
    await api("PUT", "/v1/auto-approve", { enabled: true, minScore: 85 });
    const hi = post(B, 92), lo = post(B, 75), other = post(B2, 99);
    expect((await api("GET", "/v1/auto-approve")).json()).toMatchObject({ pendingEligible: 2, pendingReady: 1 });
    const r = (await api("POST", "/v1/auto-approve/run")).json();
    expect(r).toMatchObject({ approved: 1, skipped: [{ id: lo.id, reason: "Điểm 75 thấp hơn ngưỡng 85" }], view: { pendingReady: 0, recent: [{ score: 92 }] } });
    expect(byId<any>("approval", hi.id)!.status).toBe("approved");
    expect(byId<any>("approval", lo.id)!.status).toBe("pending");
    expect(byId<any>("approval", other.id)!.status).toBe("pending"); // doanh nghiệp khác không bị đụng tới
    // đã duyệt tự động thì thấy trong lịch sử của mục
    const detail = (await api("GET", `/v1/approvals/${hi.id}`)).json();
    expect(detail.history.map((h: any) => h.event)).toEqual(expect.arrayContaining(["approval.approved", "approval.auto_approved"]));
  });
});
