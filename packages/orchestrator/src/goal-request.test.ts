import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, insert, openDb, q, update } from "@dotaka/db";
import { strategyAgent } from "@dotaka/agents";
import { ensureTokenBudgets, inferGoalRequest } from "./goal-request.ts";
import { createGoal, onTaskDone } from "./runtime.ts";

/** "Làm 10 bài" phải ra đúng 10 bài đúng loại (trước đây chỉ ra 4-5 mục mặc định rồi đứng), và trần token không chặn các bài cuối. */
let B = "";
beforeAll(() => { openDb(":memory:"); });
beforeEach(() => {
  for (const t of ["biz", "dna_profile", "goal", "task", "job", "audit_log", "agent_config"]) q.run(`DELETE FROM ${t}`);
  B = insert("biz", { name: "DOTAKA", timezone: "Asia/Ho_Chi_Minh", currency: "VND", settings: { ...DEFAULT_SETTINGS } }).id;
  for (const [k, day] of [["brief", 1e6], ["market_research", 1e6], ["strategy", 1_200_000], ["content", 2_000_000], ["video_script", 500_000], ["seo_web", 500_000]] as const)
    insert("agent_config", { biz_id: B, agent_key: k, autonomy: "L1", enabled: 1, tools: [], token_budget_run: 200_000, token_budget_day: day, limits: {} });
});

describe("đọc số bài và loại nội dung từ yêu cầu", () => {
  it("các câu Sếp thực sự đã gõ", () => {
    expect(inferGoalRequest("làm 10 kịch bản video bán ABS")).toEqual({ count: 10, kind: "video" });
    expect(inferGoalRequest("viết 10 bài SEO về sản phẩm ABS")).toEqual({ count: 10, kind: "seo" });
    expect(inferGoalRequest("làm 10 bài viết chốt khách ABS")).toEqual({ count: 10, kind: "mixed" });
    expect(inferGoalRequest("tạo 10 bài viết bán khóa học AI Business System và 10 video AI bán khóa học")).toEqual({ count: 20, kind: "mixed" });
    expect(inferGoalRequest("10 bài viết chuẩn SEO cho website")).toEqual({ count: 10, kind: "seo" });
  });
  it("không bắt nhầm: không có số / số không đi kèm bài; SEO chỉ là một kênh trong mô tả", () => {
    expect(inferGoalRequest("Tuyển học viên đợt tháng 11")).toEqual({ kind: "mixed" });
    expect(inferGoalRequest("lớp 3 ngày, 5 buổi học thử")).toEqual({ kind: "mixed" });
    expect(inferGoalRequest("Ra lead cho khóa học. Kênh: Facebook, TikTok, SEO taki.vn")).toEqual({ kind: "mixed" });
    expect(inferGoalRequest("làm 100 bài viết").count).toBe(30); // trần 30 bài / kế hoạch
  });
});

describe("kế hoạch ra đúng số bài", () => {
  const planOf = (n: number, over: Record<string, unknown> = {}) => ({ contentPlan: Array.from({ length: n }, (_, i) => ({ channel: "facebook", format: "text", topic: `chủ đề ${i + 1}`, angle: "g", funnel: "tofu", ...over })) });
  const runUntilPieces = (goalId: string, plan: unknown) => {
    const brief = q.get<any>("SELECT * FROM task WHERE goal_id = ? AND agent_key = 'brief'", goalId);
    update("task", brief.id, { status: "done", output: { kpis: [] } }); onTaskDone({ ...brief, status: "done" });
    const strat = q.get<any>("SELECT * FROM task WHERE goal_id = ? AND agent_key = 'strategy'", goalId);
    update("task", strat.id, { status: "done", output: plan }); onTaskDone({ ...strat, status: "done", output: plan });
    return q.all<any>("SELECT * FROM task WHERE goal_id = ? AND agent_key IN ('content','video_script','seo_web') ORDER BY created_at", goalId);
  };

  it("10 bài: Chiến lược được yêu cầu đúng 10 mục và sinh đúng 10 việc (không thêm bài SEO phụ)", () => {
    const g = createGoal(B, { title: "làm 10 bài viết chốt khách ABS", description: "x", template: "launch_campaign", budgetAds: 0, contentCount: 10 });
    expect(byId<any>("goal", g.id)!.params.contentCount).toBe(10);
    const strat = q.get<any>("SELECT * FROM task WHERE goal_id = ? AND agent_key = 'strategy'", g.id);
    expect(strat.input.contentCount).toBe(10);
    expect(strategyAgent.buildUser(strat.input, { dna: { company: {}, audience: [], voice: {}, products: [], offers: [] }, upstream: {}, knowledge: [], lessons: [], exemplars: [], revision: 0 } as any)).toContain("contentPlan đúng 10 mục");
    const pieces = runUntilPieces(g.id, planOf(10));
    expect(pieces).toHaveLength(10);
    expect(pieces.every((t) => t.agent_key === "content")).toBe(true);
    expect(q.scalar<number>("SELECT COUNT(*) FROM job WHERE name = 'agent.run'", )).toBeGreaterThanOrEqual(10);
  });
  it("model lập dư mục thì cắt đúng số yêu cầu; không nêu số bài thì giữ cách cũ (5 + 1 bài SEO phụ)", () => {
    const g = createGoal(B, { title: "x", description: "x", template: "weekly_content", budgetAds: 0, contentCount: 3 });
    expect(runUntilPieces(g.id, planOf(8))).toHaveLength(3);
    const g2 = createGoal(B, { title: "chiến dịch", description: "x", template: "launch_campaign", budgetAds: 0 });
    const p2 = runUntilPieces(g2.id, planOf(5));
    expect(p2).toHaveLength(6);
    expect(p2.filter((t) => t.agent_key === "seo_web")).toHaveLength(1);
  });
  it("model lập thiếu mục: vẫn làm số mục có và báo rõ (không im lặng)", () => {
    const g = createGoal(B, { title: "x", description: "x", template: "weekly_content", budgetAds: 0, contentCount: 10 });
    expect(runUntilPieces(g.id, planOf(6))).toHaveLength(6);
    expect(q.all<any>("SELECT data FROM audit_log WHERE event = 'goal.plan_short'")).toHaveLength(1);
  });
  it("loại SEO: toàn bài SEO website, mỗi bài một từ khoá; loại video: toàn kịch bản video", () => {
    const g = createGoal(B, { title: "viết 10 bài SEO", description: "x", template: "launch_campaign", budgetAds: 0, contentCount: 10, contentKind: "seo" });
    const seo = runUntilPieces(g.id, planOf(10));
    expect(seo).toHaveLength(10);
    expect(seo.every((t) => t.agent_key === "seo_web" && t.input.keyword === t.input.item.topic && t.input.item.channel === "website")).toBe(true);
    expect(new Set(seo.map((t) => t.input.keyword)).size).toBe(10);
    const g2 = createGoal(B, { title: "10 kịch bản video", description: "x", template: "weekly_content", budgetAds: 0, contentCount: 10, contentKind: "video" });
    const vid = runUntilPieces(g2.id, planOf(10)); // model trả toàn "text": vẫn phải thành kịch bản video
    expect(vid).toHaveLength(10);
    expect(vid.every((t) => t.agent_key === "video_script" && ["video", "reel"].includes(t.input.item.format))).toBe(true);
  });
  it("bản mô phỏng của Chiến lược cũng ra đủ số mục (kể cả hơn 6) và đúng loại", () => {
    const dna = { company: { brand: "B" }, positioning: "p", audience: [], voice: { style: [] }, products: [], offers: [] } as any;
    const out = strategyAgent.sandbox({ contentCount: 10, contentKind: "seo" }, { dna, goal: { budget_ads: 0 }, upstream: {} } as any) as any;
    expect(out.contentPlan).toHaveLength(10);
    expect(new Set(out.contentPlan.map((i: any) => i.topic)).size).toBe(10);
    expect(out.contentPlan.every((i: any) => i.channel === "website" && i.format === "article")).toBe(true);
    expect((strategyAgent.sandbox({}, { dna, goal: { budget_ads: 0 }, upstream: {} } as any) as any).contentPlan).toHaveLength(4);
  });
});

describe("trần token không chặn các bài cuối", () => {
  it("nâng trần theo số bài (80.000 token/bài), không bao giờ hạ, có ghi nhật ký", () => {
    const r = ensureTokenBudgets(B, "video", 10);
    expect(r).toEqual([{ agent: "video_script", from: 500_000, to: 800_000 }]);
    expect(q.get<any>("SELECT token_budget_day d FROM agent_config WHERE agent_key = 'video_script'").d).toBe(800_000);
    expect(ensureTokenBudgets(B, "video", 3)).toEqual([]); // đã đủ → không đổi
    expect(q.get<any>("SELECT token_budget_day d FROM agent_config WHERE agent_key = 'content'").d).toBe(2_000_000); // không hạ
    expect(q.all<any>("SELECT * FROM audit_log WHERE event = 'agent.token_budget_raised'")).toHaveLength(1);
    expect(ensureTokenBudgets(B, "mixed", 30).map((x) => x.agent).sort()).toEqual(["content", "seo_web", "video_script"]); // 30 bài × 80.000 = 2,4 triệu
  });
  it("tạo kế hoạch 10 bài SEO nâng trần agent SEO để đủ làm hết", () => {
    createGoal(B, { title: "viết 10 bài SEO", description: "x", template: "launch_campaign", budgetAds: 0, contentCount: 10, contentKind: "seo" });
    expect(q.get<any>("SELECT token_budget_day d FROM agent_config WHERE agent_key = 'seo_web'").d).toBe(800_000);
    expect(q.get<any>("SELECT token_budget_day d FROM agent_config WHERE agent_key = 'video_script'").d).toBe(500_000); // agent khác không đụng tới
  });
});
