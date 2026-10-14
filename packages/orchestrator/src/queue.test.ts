import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, openDb } from "@dotaka/db";
import { claimJobs, enqueue } from "./queue.ts";

/** Hàng đợi: nhiều job Flow (khoá "flow-chrome") đang xếp hàng không được làm nghẽn job không khoá (agent.run…). */
describe("queue — chọn job khi có khoá đang giữ", () => {
  beforeAll(() => {
    process.env.DB_PATH = ":memory:";
    openDb(":memory:");
  });
  afterAll(() => closeDb());

  it("30 job flow-chrome xếp trước + khoá đang giữ → vẫn chọn được job agent.run phía sau", () => {
    const past = new Date(Date.now() - 60_000);
    for (let i = 0; i < 30; i++) enqueue("agent", "creative.flow", { i }, { lockKey: "flow-chrome", runAt: new Date(past.getTime() + i) });
    const runId = enqueue("agent", "agent.run", {}, { runAt: new Date(past.getTime() + 1000) });
    const picked = claimJobs("agent", 3, new Set(["flow-chrome"]));
    expect(picked.map((j) => j.id)).toEqual([runId]);
  });

  it("khoá không bị giữ → chỉ 1 job cùng khoá được chọn mỗi lượt, phần còn lại cho job khác", () => {
    const otherId = enqueue("agent", "agent.run", { other: true }, { runAt: new Date(Date.now() - 1000) });
    const picked = claimJobs("agent", 3, new Set());
    expect(picked.filter((j) => j.lock_key === "flow-chrome")).toHaveLength(1);
    expect(picked.map((j) => j.id)).toContain(otherId);
    expect(picked).toHaveLength(3);
  });
});

describe("lịch dưới 1 phút (số phút lẻ)", () => {
  it("lịch 0.25 phút (15 giây) chạy đúng nhịp: chưa đủ 15 giây thì chưa xếp job, đủ thì xếp 1 lần cho mỗi nhịp", async () => {
    const { vi } = await import("vitest");
    const { insert, q } = await import("@dotaka/db");
    const { startScheduler } = await import("./queue.ts");
    vi.useFakeTimers();
    try {
      const biz = insert("biz", { name: "Shop lịch nhanh", settings: {} }).id;
      insert("schedule", { biz_id: biz, name: "nurture.poll", queue: "chat", every_minutes: 0.25, enabled: 1, label: "t", last_run_at: new Date(Date.now() - 20_000).toISOString() });
      const count = () => q.scalar<number>("SELECT COUNT(*) FROM job WHERE biz_id = ? AND name = 'nurture.poll'", biz);
      const stop = startScheduler();
      await vi.advanceTimersByTimeAsync(3_100); // lượt kiểm tra đầu: đã quá 15 giây → xếp job
      expect(count()).toBe(1);
      await vi.advanceTimersByTimeAsync(10_000); // chưa đủ 15 giây kể từ lần chạy
      expect(count()).toBe(1);
      await vi.advanceTimersByTimeAsync(10_000); // đủ nhịp kế nhưng lượt trước CHƯA chạy → không dồn thêm lượt trùng
      expect(count()).toBe(1);
      q.run("UPDATE job SET status = 'done' WHERE biz_id = ? AND name = 'nurture.poll'", biz);
      await vi.advanceTimersByTimeAsync(15_000); // lượt trước đã chạy xong → nhịp kế được xếp
      expect(count()).toBe(2);
      stop();
    } finally { vi.useRealTimers(); }
  });
});
