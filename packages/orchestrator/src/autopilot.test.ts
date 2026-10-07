import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, insert, openDb, q, update } from "@dotaka/db";
import { autopilotPublishOpts, autopilotTick, pipelineCoverage, saveAutopilotSettings, setAutopilotEnabled, sharesWithFloor } from "./autopilot.ts";
import { planForGoal } from "./runtime.ts";

let B = "";
// 10:00 giờ VN (ngoài giờ yên lặng 22h–7h)
const NOW = new Date("2026-10-07T03:00:00Z");

beforeAll(() => { openDb(":memory:"); });
beforeEach(() => {
  for (const t of ["biz", "dna_profile", "goal", "task", "content_item", "approval", "job", "audit_log", "publish_job", "channel"]) q.run(`DELETE FROM ${t}`);
  B = insert("biz", { name: "DOTAKA", timezone: "Asia/Ho_Chi_Minh", currency: "VND", settings: { ...DEFAULT_SETTINGS } }).id;
  insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "test", data: {
    products: [
      { key: "khoa-ceo", name: "Khóa CEO Thực Chiến", summary: "Vận hành tự động", price: 12_000_000 },
      { key: "khoa-startup", name: "Khóa Startup 0-1", summary: "Từ ý tưởng tới doanh thu" },
    ],
  } });
});

describe("chia tỉ trọng có sàn thăm dò", () => {
  it("giữ mỗi bên ít nhất ở sàn, phần còn lại theo điểm", () => {
    const { share, floored } = sharesWithFloor([10, 0], [0.2, 0.2]);
    expect(share[1]).toBeCloseTo(0.2);
    expect(share[0]).toBeCloseTo(0.8);
    expect(floored).toEqual([false, true]);
  });
  it("chia đều khi chưa có điểm", () => {
    expect(sharesWithFloor([0, 0, 0], [0.2, 0.2, 0.2]).share.map((x) => Math.round(x * 100))).toEqual([33, 33, 33]);
  });
});

describe("kế hoạch nội dung của chiến dịch tự động", () => {
  const plan = [
    { channel: "zalo", format: "video", topic: "a" }, { channel: "facebook", format: "text", topic: "b" },
    { channel: "tiktok", format: "reel", topic: "c" }, { channel: "facebook", format: "image", topic: "d" },
  ];
  it("đưa mọi nội dung về đúng nền tảng + đúng số bài", () => {
    const out = planForGoal({ params: { autopilot: { platform: "facebook", contentCount: 3, videoMode: "none" } } }, plan);
    expect(out).toHaveLength(3);
    expect(out.every((i) => i.channel === "facebook")).toBe(true);
    expect(out[0].format).toBe("image"); // không làm video → video thành bài ảnh
  });
  it("TikTok luôn là video ngắn", () => {
    expect(planForGoal({ params: { autopilot: { platform: "tiktok", contentCount: 3, videoMode: "none" } } }, plan).every((i) => i.format === "reel")).toBe(true);
  });
  it("chiến dịch thường giữ nguyên", () => {
    expect(planForGoal({ params: {} }, plan)).toBe(plan);
  });
});

describe("vòng lái tự động", () => {
  it("tắt thì không làm gì", async () => {
    const run = await autopilotTick(B, { now: NOW });
    expect(run.ran).toBe(false);
    expect(q.scalar<number>("SELECT COUNT(*) FROM goal")).toBe(0);
  });

  it("thiếu bài thì mở chiến dịch, đủ rồi thì thôi (không trùng)", async () => {
    setAutopilotEnabled(B, true, "test");
    const run = await autopilotTick(B, { now: NOW });
    expect(run.created).toHaveLength(1); // 1 bài/ngày × 3 ngày = 3 = 1 chiến dịch × 3 nội dung
    const g = q.get<any>("SELECT * FROM goal");
    expect(g.template).toBe("weekly_content");
    expect(g.budget_ads).toBe(0);
    expect(g.params.autopilot).toMatchObject({ platform: "facebook", contentCount: 3, gate: true, autoStrategy: true });
    expect(q.get<any>("SELECT input FROM task WHERE goal_id = ? AND agent_key = 'strategy'", g.id).input.contentCount).toBe(3);
    expect(pipelineCoverage(B, "facebook", undefined, NOW).inProduction).toBe(3);
    const again = await autopilotTick(B, { now: NOW });
    expect(again.created).toHaveLength(0);
    expect(q.scalar<number>("SELECT COUNT(*) FROM goal")).toBe(1);
  });

  it("chạm trần chiến dịch/ngày + xoay vòng khóa học", async () => {
    setAutopilotEnabled(B, true, "test");
    saveAutopilotSettings(B, { platforms: [{ platform: "facebook", postsPerDay: 5 }], maxGoalsPerDay: 2 }, "test");
    const run = await autopilotTick(B, { now: NOW });
    expect(run.created).toHaveLength(2);
    expect(run.capReached).toBe(true);
    expect(new Set(run.created.map((c) => c.product)).size).toBe(2);
  });

  it("dừng khẩn cấp đăng bài thì không mở chiến dịch", async () => {
    setAutopilotEnabled(B, true, "test");
    const s = q.get<any>("SELECT settings FROM biz WHERE id = ?", B).settings;
    update("biz", B, { settings: { ...s, killSwitch: { ...s.killSwitch, publish: true } } });
    const run = await autopilotTick(B, { now: NOW });
    expect(run.reason).toBe("killed");
    expect(q.scalar<number>("SELECT COUNT(*) FROM goal")).toBe(0);
  });

  it("giờ yên lặng thì chờ lượt sau (trừ khi Sếp bấm Chạy ngay)", async () => {
    setAutopilotEnabled(B, true, "test");
    const night = new Date("2026-10-07T16:00:00Z"); // 23:00 VN
    expect((await autopilotTick(B, { now: night })).reason).toBe("quiet");
    expect((await autopilotTick(B, { now: night, manual: true })).created).toHaveLength(1);
  });
});

describe("đăng ngay khi Sếp duyệt", () => {
  it("chỉ áp dụng cho bài của chiến dịch tự động", async () => {
    setAutopilotEnabled(B, true, "test");
    saveAutopilotSettings(B, { postWhenApproved: "now" }, "test");
    await autopilotTick(B, { now: NOW });
    const g = q.get<any>("SELECT id FROM goal");
    const auto = insert("content_item", { biz_id: B, goal_id: g.id, agent_key: "content", kind: "post", channel: "facebook", title: "t", body: "b", status: "approved" });
    const manual = insert("content_item", { biz_id: B, agent_key: "content", kind: "post", channel: "facebook", title: "t", body: "b", status: "approved" });
    expect(autopilotPublishOpts(B, auto.id, NOW)).toEqual({ now: true });
    expect(autopilotPublishOpts(B, manual.id, NOW)).toEqual({});
  });
});
