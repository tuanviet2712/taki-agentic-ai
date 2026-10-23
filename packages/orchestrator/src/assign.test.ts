import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, insert, openDb, q, update } from "@dotaka/db";
import { assignAgentTask } from "./assign.ts";
import { continueGoal, createGoal, onTaskDone, setTaskStatus } from "./runtime.ts";

let B = "";
beforeAll(() => { openDb(":memory:"); });
beforeEach(() => {
  for (const t of ["biz", "dna_profile", "goal", "task", "job", "audit_log", "agent_config"]) q.run(`DELETE FROM ${t}`);
  B = insert("biz", { name: "DOTAKA", timezone: "Asia/Ho_Chi_Minh", currency: "VND", settings: { ...DEFAULT_SETTINGS } }).id;
  for (const k of ["brief", "market_research", "strategy", "content"]) insert("agent_config", { biz_id: B, agent_key: k, autonomy: "L1", enabled: 1, tools: [], token_budget_run: 1, token_budget_day: 1, limits: {} });
});

const PLAN = { contentPlan: [{ channel: "facebook", format: "text", topic: "a", angle: "b", funnel: "tofu" }, { channel: "tiktok", format: "reel", topic: "c", angle: "d", funnel: "tofu" }] };
/** Đưa 1 task về "done" với đầu ra cho trước rồi chạy bước kế tiếp của runtime. */
function finish(taskId: string, output: unknown) {
  const t = byId<any>("task", taskId)!;
  update("task", t.id, { status: "done", output });
  onTaskDone({ ...t, status: "done", output });
}

describe("giao việc riêng cho từng agent", () => {
  it("nghiên cứu riêng: tạo đúng 1 việc, không có chiến dịch", async () => {
    const r = await assignAgentTask(B, { agent: "market_research", instruction: "Nghiên cứu đối thủ FUNIX" }, "test");
    expect(r.kind).toBe("task");
    const t = byId<any>("task", (r as any).taskId)!;
    expect(t.goal_id).toBeNull();
    expect(t.input).toMatchObject({ standalone: true, instruction: "Nghiên cứu đối thủ FUNIX" });
    expect(q.scalar<number>("SELECT COUNT(*) FROM goal")).toBe(0);
  });

  it("kế hoạch riêng xong là dừng: không sinh việc viết bài", async () => {
    const r = await assignAgentTask(B, { agent: "strategy", instruction: "Lập kế hoạch 4 tuần cho khóa CEO" }, "test") as any;
    finish(r.taskId, PLAN);
    expect(q.scalar<number>("SELECT COUNT(*) FROM task")).toBe(1);
  });

  it("giao việc kèm model (Hội đồng Agent → Giao việc): việc lưu đúng model để chạy bằng model đó; không chọn thì không ép", async () => {
    const withModel = await assignAgentTask(B, { agent: "content", instruction: "Bài giới thiệu khóa AI", model: "gpt-6.1-sol" }, "test") as any;
    expect(byId<any>("task", withModel.taskId)!.input.model).toBe("gpt-6.1-sol");
    const plain = await assignAgentTask(B, { agent: "content", instruction: "Bài giới thiệu khóa AI" }, "test") as any;
    expect(byId<any>("task", plain.taskId)!.input.model).toBeUndefined();
  });

  it("bài riêng mặc định chỉ viết, không đăng sau khi duyệt", async () => {
    const r = await assignAgentTask(B, { agent: "content", instruction: "Bài case học viên spa" }, "test") as any;
    expect(byId<any>("task", r.taskId)!.input.noPublish).toBe(true);
    const r2 = await assignAgentTask(B, { agent: "content", instruction: "Bài case học viên spa", publishAfterApproval: true }, "test") as any;
    expect(byId<any>("task", r2.taskId)!.input.noPublish).toBe(false);
  });

  it("chỉ nhận kết quả đã xong làm đầu vào", async () => {
    const done = insert("task", { biz_id: B, goal_id: null, agent_key: "market_research", title: "x", status: "done", output: { a: 1 }, input: {}, depends_on: [] });
    const running = insert("task", { biz_id: B, goal_id: null, agent_key: "market_research", title: "y", status: "running", input: {}, depends_on: [] });
    const r = await assignAgentTask(B, { agent: "strategy", instruction: "Kế hoạch dựa trên nghiên cứu", basedOn: [done.id, running.id] }, "test") as any;
    expect(byId<any>("task", r.taskId)!.input.basedOn).toEqual([done.id]);
  });

  it("agent đang tắt thì không nhận việc; thiếu yêu cầu thì báo", async () => {
    q.run("UPDATE agent_config SET enabled = 0 WHERE agent_key = 'brief'");
    await expect(assignAgentTask(B, { agent: "brief", instruction: "abcdef" }, "test")).rejects.toThrow(/tắt/);
    await expect(assignAgentTask(B, { agent: "strategy", instruction: "ab" }, "test")).rejects.toThrow(/yêu cầu/);
  });

  it("agent có trang riêng → trả đường dẫn", async () => {
    expect(await assignAgentTask(B, { agent: "creative" }, "test")).toEqual({ kind: "page", href: "/video-flow" });
  });
});

describe("kế hoạch dừng sau 1 bước", () => {
  it("dừng sau Kế hoạch: không viết bài, chiến dịch tạm dừng; Triển khai tiếp mới sinh bài", () => {
    const g = createGoal(B, { title: "Tuyển sinh tháng 11", description: "x", template: "weekly_content", budgetAds: 0, params: { stopAfter: "strategy" } });
    const brief = q.get<any>("SELECT id FROM task WHERE goal_id = ? AND agent_key = 'brief'", g.id);
    finish(brief.id, { kpis: [] });
    const strat = q.get<any>("SELECT * FROM task WHERE goal_id = ? AND agent_key = 'strategy'", g.id);
    expect(strat.status).toBe("ready");
    finish(strat.id, PLAN);
    expect(q.scalar<number>("SELECT COUNT(*) FROM task WHERE goal_id = ? AND agent_key IN ('content','video_script')", g.id)).toBe(0);
    expect(byId<any>("goal", g.id)!.status).toBe("paused");

    continueGoal(B, g.id, "test");
    expect(byId<any>("goal", g.id)!.status).toBe("active");
    expect(q.scalar<number>("SELECT COUNT(*) FROM task WHERE goal_id = ? AND agent_key IN ('content','video_script')", g.id)).toBe(2);
    expect(() => continueGoal(B, g.id, "test")).toThrow(/không ở trạng thái dừng/);
  });

  it("dừng sau Brief: khâu kế hoạch chưa chạy cho tới khi triển khai tiếp", () => {
    const g = createGoal(B, { title: "T", description: "x", template: "weekly_content", budgetAds: 0, params: { stopAfter: "brief" } });
    const brief = q.get<any>("SELECT id FROM task WHERE goal_id = ? AND agent_key = 'brief'", g.id);
    finish(brief.id, { kpis: [] });
    expect(q.get<any>("SELECT status FROM task WHERE goal_id = ? AND agent_key = 'strategy'", g.id).status).toBe("pending");
    continueGoal(B, g.id, "test");
    expect(q.get<any>("SELECT status FROM task WHERE goal_id = ? AND agent_key = 'strategy'", g.id).status).toBe("ready");
  });

  it("chiến dịch thường vẫn chạy hết chuỗi", () => {
    const g = createGoal(B, { title: "T", description: "x", template: "weekly_content", budgetAds: 0 });
    const strat = q.get<any>("SELECT * FROM task WHERE goal_id = ? AND agent_key = 'strategy'", g.id);
    setTaskStatus(strat, "ready");
    finish(strat.id, PLAN);
    expect(q.scalar<number>("SELECT COUNT(*) FROM task WHERE goal_id = ? AND agent_key IN ('content','video_script')", g.id)).toBe(2);
    expect(byId<any>("goal", g.id)!.status).toBe("active");
  });
});
