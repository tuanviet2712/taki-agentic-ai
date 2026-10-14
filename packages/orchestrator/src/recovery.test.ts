import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";

/** Không để rơi bài: khởi động lại giữa bước hoàn thiện, task mất job, lượt đăng mất job. DB :memory:, không gọi AI. */
vi.mock("./image-engine.ts", async (orig) => ({ ...(await orig<typeof import("./image-engine.ts")>()), postImageEngine: () => ({ engine: "claude", chosen: "claude" }) }));
const { recoverStuckTasks, recoverTasksAfterRestart } = await import("./runtime.ts");
const { recoverStuckPublishing } = await import("./publishing.ts");

let B = "";
beforeEach(() => {
  openDb(":memory:");
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
});
afterEach(() => closeDb());

const old = (table: string, id: string, min = 30) => q.run(`UPDATE ${table} SET updated_at = ? WHERE id = ?`, new Date(Date.now() - min * 60_000).toISOString(), id);
const jobsFor = (taskId: string, name: string) => q.scalar<number>("SELECT COUNT(*) FROM job WHERE name = ? AND json_extract(payload, '$.taskId') = ?", name, taskId);
/** Bài đã viết + chấm xong (đang tạo ảnh / chờ vào Duyệt). */
function written(status: string, goalStatus = "active") {
  const goal = insert("goal", { biz_id: B, title: "Kế hoạch", description: "", template: "weekly_content", budget_ads: 0, status: goalStatus, params: {} });
  const t = insert("task", { biz_id: B, goal_id: goal.id, agent_key: "content", title: "Bài facebook: A", status, input: {}, depends_on: [] });
  const rs = insert("review_score", { biz_id: B, subject_type: "content_item", subject_id: "x", rubric_key: "post", rubric_version: 1, total: 80, verdict: "pass", result: {} });
  insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "facebook", title: "A", body: "Nội dung", status: "in_review", task_id: t.id, review_score_id: rs.id });
  return t;
}

describe("khởi động lại", () => {
  it("bài đang ở bước hoàn thiện → giữ 'in_review' và làm nốt (không đặt về 'ready' rồi kẹt); bài đang viết → viết lại", () => {
    const fin = written("in_review");
    const writing = insert("task", { biz_id: B, agent_key: "content", title: "Bài đang viết", status: "running", input: {}, depends_on: [] });
    recoverTasksAfterRestart();
    expect(byId<Row>("task", fin.id)!.status).toBe("in_review");
    expect(jobsFor(fin.id, "task.finalize")).toBe(1);
    expect(byId<Row>("task", writing.id)!.status).toBe("ready");
  });
});

describe("bộ canh", () => {
  it("cứu bài bị đặt nhầm về 'ready' sau khởi động lại (đúng lỗi đã gặp): làm nốt bước hoàn thiện, không viết lại", () => {
    const t = written("ready");
    old("task", t.id);
    expect(recoverStuckTasks()).toEqual({ finalized: 1, rerun: 0 });
    expect(byId<Row>("task", t.id)!.status).toBe("in_review");
    expect(jobsFor(t.id, "task.finalize")).toBe(1);
    expect(jobsFor(t.id, "agent.run")).toBe(0);
    expect(recoverStuckTasks()).toEqual({ finalized: 0, rerun: 0 }); // đã có job → không xếp trùng
  });

  it("task 'ready' mất job viết bài → xếp lại; còn job / mới đổi / chiến dịch tạm dừng → để yên", () => {
    const lost = insert("task", { biz_id: B, agent_key: "content", title: "Mất job", status: "ready", input: {}, depends_on: [] });
    old("task", lost.id);
    const fresh = insert("task", { biz_id: B, agent_key: "content", title: "Vừa tạo", status: "ready", input: {}, depends_on: [] });
    const paused = written("ready", "paused");
    q.run("UPDATE content_item SET review_score_id = NULL WHERE task_id = ?", paused.id);
    old("task", paused.id);
    expect(recoverStuckTasks()).toEqual({ finalized: 0, rerun: 1 });
    expect(jobsFor(lost.id, "agent.run")).toBe(1);
    expect(jobsFor(fresh.id, "agent.run")).toBe(0);
    expect(jobsFor(paused.id, "agent.run")).toBe(0);
  });

  it("lượt đăng quá giờ mất job → xếp đăng lại; lượt bỏ dở giữa lúc đăng → 'Cần kiểm tra kênh' (không đăng trùng)", () => {
    const ch = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Fanpage", external_id: "P1", enabled: 1, whitelisted: 1 });
    const ci = insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "facebook", title: "B", body: "x", status: "scheduled" });
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    const due = insert("publish_job", { biz_id: B, content_item_id: ci.id, channel_id: ch.id, scheduled_at: past, status: "scheduled", idempotency_key: "pub:a" });
    const half = insert("publish_job", { biz_id: B, content_item_id: ci.id, channel_id: ch.id, scheduled_at: past, status: "posting", idempotency_key: "pub:b" });
    old("publish_job", half.id, 30);
    expect(recoverStuckPublishing()).toEqual({ requeued: 1, needsCheck: 1 });
    expect(q.scalar<number>("SELECT COUNT(*) FROM job WHERE name = 'publish.run' AND json_extract(payload, '$.publishJobId') = ?", due.id)).toBe(1);
    expect(byId<Row>("publish_job", half.id)!.status).toBe("needs_check");
    expect(recoverStuckPublishing()).toEqual({ requeued: 0, needsCheck: 0 });
  });
});
