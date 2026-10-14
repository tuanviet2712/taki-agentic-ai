import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, insert, openDb, q } from "@dotaka/db";
import type { Dna } from "@dotaka/agents";

/** "Tạo lại" mọi trạng thái; kênh do Chiến lược giao là chuẩn; lỗi chữ sửa được đi vòng sửa trước khi bị chặn. */
const outputs: any[] = [];
vi.mock("@dotaka/llm-gateway", async (orig) => {
  const real = await orig<typeof import("@dotaka/llm-gateway")>();
  return {
    ...real,
    generate: async (req: any) => {
      if (req.agentKey === "content" && outputs.length) return { output: outputs.shift(), usage: { input: 0, output: 0, cached: 0, costMicros: 0 }, model: "fake" };
      return real.generate(req);
    },
  };
});

const dna = {
  company: { name: "Shop", brand: "Shop", website: "shop.vn", industry: "x", ceo: "A", scale: "nhỏ" },
  positioning: "p", mission: "m", audience: [{ name: "Mẹ", pains: ["mệt"], goals: ["khỏe"] }],
  products: [{ key: "sua-x", name: "Sữa X", summary: "s", format: "Affiliate", price: 250_000 }],
  offers: [], voice: { style: ["gần gũi"], do: [], dont: [], sample: "" }, differentiators: [], forbiddenClaims: ["khỏi bệnh"], channels: [],
  goals: { yearTarget: 0, currentRunRate: 0, painPoint: "", competitors: [] },
} as unknown as Dna;

const body = "Mẹ nào cũng mệt khi con biếng ăn. Sữa X ít đường, vị dịu, bé dễ uống hơn. Pha 1 cốc mỗi sáng, mẹ nhẹ người hẳn. ".repeat(2);
const post = (b: string, channel = "facebook") => ({
  channel, format: "text", title: "Sữa X",
  variants: [{ key: "A", hook: "Bé biếng ăn?", body: b, cta: "Inbox", hashtags: ["#suax"] }, { key: "B", hook: "Mẹ mệt?", body: `${b} Thử nhé.`, cta: "Inbox", hashtags: [] }],
  facts: [{ statement: "Sữa X: Affiliate", sourceRef: "dna:products.sua-x" }], productRefs: ["sua-x"], openQuestions: [],
});

let B = "";
beforeAll(() => { process.env.DB_PATH = ":memory:"; openDb(":memory:"); });
beforeEach(() => {
  for (const t of ["biz", "dna_profile", "goal", "task", "task_run", "content_item", "approval", "publish_job", "channel", "job", "audit_log", "agent_config", "review_score"]) q.run(`DELETE FROM ${t}`);
  outputs.length = 0;
  B = insert("biz", { name: "Shop", timezone: "Asia/Ho_Chi_Minh", currency: "VND", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "test", data: dna });
  for (const k of ["brief", "strategy", "content"]) insert("agent_config", { biz_id: B, agent_key: k, autonomy: "L1", enabled: 1, tools: [], token_budget_run: 100000, token_budget_day: 1000000, limits: {} });
});

const ITEM = { channel: "facebook", format: "text", topic: "Chủ đề", angle: "", funnel: "tofu" };
const mk = (taskStatus: string, contentStatus: string, extra: { goalStatus?: string; input?: any; noContent?: boolean } = {}) => {
  const g = insert("goal", { biz_id: B, title: "G", description: "x", template: "weekly_content", status: extra.goalStatus ?? "active", params: {} });
  const t = insert("task", { biz_id: B, goal_id: g.id, agent_key: "content", title: "Bài", status: taskStatus, input: extra.input ?? { item: ITEM }, depends_on: [] });
  const ci = extra.noContent ? null : insert("content_item", { biz_id: B, goal_id: g.id, task_id: t.id, agent_key: "content", kind: "social_post", channel: "facebook", title: "Bài", body: "x", status: contentStatus });
  return { g, t, ci: ci as any };
};

describe("regenerateContent", () => {
  it("khâu đã XONG + bài đã duyệt (chưa ra ngoài) → viết lại tại chỗ, giữ đầu vào riêng, mở lại chiến dịch đã xong", async () => {
    const { regenerateContent } = await import("./runtime.ts");
    const { g, t, ci } = mk("done", "approved", { goalStatus: "done", input: { standalone: true, noPublish: true, item: { ...ITEM, channel: "tiktok" } } });
    q.run("UPDATE task SET revisions = 2 WHERE id = ?", t.id);
    const r = regenerateContent(B, ci.id, "ceo", "Ngắn hơn, thêm giá");
    expect(r).toEqual({ taskId: t.id, mode: "rewrite" });
    const after = byId<any>("task", t.id)!;
    expect(after.status).toBe("ready");
    expect(after.revisions).toBe(0);
    expect(after.input).toMatchObject({ standalone: true, noPublish: true, findings: ["GÓP Ý CỦA SẾP: Ngắn hơn, thêm giá"] });
    expect(byId<any>("goal", g.id)!.status).toBe("active");
    expect(q.get("SELECT id FROM job WHERE name = 'agent.run' AND status = 'queued'")).toBeTruthy();
  });

  it("chiến dịch đang 'Tạm dừng' (dừng sau 1 bước) KHÔNG bị mở lại khi tạo lại bài", async () => {
    const { regenerateContent } = await import("./runtime.ts");
    const { g, ci } = mk("done", "approved", { goalStatus: "paused" });
    regenerateContent(B, ci.id);
    expect(byId<any>("goal", g.id)!.status).toBe("paused");
  });

  it("bài đã đăng/đã lên lịch → khâu MỚI '(tạo lại)', bài cũ giữ nguyên", async () => {
    const { regenerateContent } = await import("./runtime.ts");
    const { t, ci } = mk("done", "published");
    const r = regenerateContent(B, ci.id);
    expect(r.mode).toBe("new_task");
    expect(r.taskId).not.toBe(t.id);
    expect(byId<any>("task", r.taskId)!).toMatchObject({ status: "ready", title: "Bài (tạo lại)", agent_key: "content" });
    expect(byId<any>("task", t.id)!.status).toBe("done");
    expect(byId<any>("content_item", ci.id)!.status).toBe("published");
  });

  it("lệnh đăng đã LỖI (đăng thủ công) → viết lại tại chỗ, nhả khoá chống trùng để duyệt lại còn lên lịch được", async () => {
    const { regenerateContent } = await import("./runtime.ts");
    const { t, ci } = mk("done", "manual_publish");
    const ch = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Fanpage", external_id: "1", enabled: 1 });
    const pj = insert("publish_job", { biz_id: B, content_item_id: ci.id, channel_id: ch.id, scheduled_at: new Date().toISOString(), status: "failed", idempotency_key: `pub:${ci.id}:${ch.id}` });
    insert("job", { biz_id: B, queue: "publish", name: "publish.schedule", payload: {}, status: "done", run_at: new Date().toISOString(), idempotency_key: `sched-pub:${ci.id}` });
    const r = regenerateContent(B, ci.id);
    expect(r).toEqual({ taskId: t.id, mode: "rewrite" });
    expect(byId<any>("publish_job", pj.id)!.idempotency_key).not.toBe(`pub:${ci.id}:${ch.id}`);
    expect(q.get("SELECT id FROM job WHERE idempotency_key = ?", `sched-pub:${ci.id}`)).toBeFalsy();
  });

  it("đang chờ duyệt + góp ý → huỷ mục duyệt cũ, mở lại đúng khâu, góp ý đứng đầu findings", async () => {
    const { regenerateContent } = await import("./runtime.ts");
    const { t, ci } = mk("awaiting_approval", "awaiting_approval", { input: { findings: ["cũ"], item: ITEM } });
    const ap = insert("approval", { biz_id: B, subject_type: "task", subject_id: t.id, agent_key: "content", title: "Bài", risk: "low", status: "pending", preview: {}, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    const r = regenerateContent(B, ci.id, "ceo", "Ngắn hơn");
    expect(r).toEqual({ taskId: t.id, mode: "retry" });
    expect(byId<any>("approval", ap.id)!.status).toBe("cancelled");
    const after = byId<any>("task", t.id)!;
    expect(after.status).toBe("ready");
    expect(after.input.findings).toEqual(["GÓP Ý CỦA SẾP: Ngắn hơn", "cũ"]);
  });

  it("đang chạy → BUSY; nội dung của doanh nghiệp khác → NOT_FOUND", async () => {
    const { regenerateContent } = await import("./runtime.ts");
    const { ci } = mk("running", "in_review");
    expect(() => regenerateContent(B, ci.id)).toThrow(/đang viết/);
    expect(() => regenerateContent("other-biz", ci.id)).toThrow(/Không thấy nội dung/);
  });
});

describe("runTask: kênh chuẩn & vòng sửa cho lỗi chữ sửa được", () => {
  it("agent trả kênh khác kênh Chiến lược giao → bài vẫn ra đúng kênh giao", async () => {
    const { runTask } = await import("./runtime.ts");
    const { t } = mk("ready", "", { input: { item: { ...ITEM, channel: "tiktok" } }, noContent: true });
    outputs.push(post(body, "facebook"));
    await runTask(t.id);
    expect(q.get<any>("SELECT channel FROM content_item WHERE task_id = ?", t.id)!.channel).toBe("tiktok");
  });

  it("giá lệch (fatal nhưng sửa được) → vòng sửa rồi qua; hết vòng sửa mà vẫn lệch → BLOCKED", async () => {
    const { runTask } = await import("./runtime.ts");
    const bad = `${body} Giá sốc 99.000đ hôm nay.`;
    const a = mk("ready", "", { noContent: true });
    outputs.push(post(bad), post(body));
    await runTask(a.t.id);
    let cur = byId<any>("task", a.t.id)!;
    expect(cur.status).toBe("revising");
    expect(cur.revisions).toBe(1);
    expect(cur.input.findings.join(" ")).toMatch(/Giá/);
    await runTask(a.t.id);
    cur = byId<any>("task", a.t.id)!;
    expect(cur.status).not.toBe("blocked"); // bản sửa hết lỗi chữ → không bị chặn nữa (có thể còn cần sửa văn phong / chờ duyệt)
    expect(byId<any>("content_item", q.get<any>("SELECT id FROM content_item WHERE task_id = ?", a.t.id)!.id)!.status).not.toBe("blocked");

    const m = mk("ready", "", { noContent: true });
    for (let i = 0; i < 4; i++) outputs.push(post(bad));
    await runTask(m.t.id); // vòng 0 → sửa
    await runTask(m.t.id); // vòng 1 → sửa
    await runTask(m.t.id); // hết vòng sửa → chặn
    const done = byId<any>("task", m.t.id)!;
    expect(done.status).toBe("blocked");
    expect(done.error.code).toBe("REVIEW_BLOCKED");
  });
});
