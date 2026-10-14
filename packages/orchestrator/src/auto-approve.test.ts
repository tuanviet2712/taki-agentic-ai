import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, insert, openDb, q, update } from "@dotaka/db";
import { AUTO_APPROVE_DEFAULT, autoApproveConfig, autoApprovePending, autoApproveOne, autoApproveView, checkAutoApprove, setAutoApprove } from "./auto-approve.ts";
import { queueAutoApprove } from "./auto-approve-hook.ts";

/** Tự động phê duyệt: chỉ nội dung / video, chỉ khi review "Đạt" + đủ điểm + đủ ảnh; không bao giờ đụng tới tiền / tin gửi khách. */
let B = "";
beforeAll(() => { openDb(":memory:"); });
beforeEach(() => {
  for (const t of ["biz", "task", "content_item", "approval", "review_score", "creative_job", "creative_asset", "job", "audit_log", "channel", "publish_job"]) q.run(`DELETE FROM ${t}`);
  B = insert("biz", { name: "Shop", timezone: "Asia/Ho_Chi_Minh", currency: "VND", settings: { ...DEFAULT_SETTINGS } }).id;
});

const on = (minScore = 80) => setAutoApprove(B, { enabled: true, minScore }, "ceo");
let n = 0;
/** Mục duyệt của 1 bài (task + content_item + review + approval). */
function post(over: { agent?: string; kind?: string; total?: number; verdict?: string; fatal?: string[]; preview?: Record<string, unknown>; risk?: string; body?: string; channel?: string } = {}) {
  const t = insert("task", { biz_id: B, goal_id: null, agent_key: over.agent ?? "content", title: `Bài ${++n}`, status: "awaiting_approval", input: { noPublish: true }, depends_on: [] });
  const rv = insert("review_score", { biz_id: B, subject_type: "content_item", subject_id: t.id, rubric_key: "content_social", rubric_version: 3, total: over.total ?? 90, verdict: over.verdict ?? "pass", result: { fatalFindings: over.fatal ?? [] } });
  const ci = insert("content_item", { biz_id: B, task_id: t.id, agent_key: over.agent ?? "content", kind: over.kind ?? "social_post", channel: over.channel ?? "facebook", title: `Bài ${n}`, body: over.body ?? "Nội dung bài viết.", status: "awaiting_approval", review_score_id: rv.id });
  const ap = insert("approval", { biz_id: B, subject_type: "task", subject_id: t.id, agent_key: over.agent ?? "content", title: `Bài ${n}`, risk: over.risk ?? "low", status: "pending", review_score_id: rv.id, preview: over.preview ?? {} });
  return { t, ci, ap, rv };
}
const status = (id: string) => byId<any>("approval", id)!.status;

describe("cài đặt", () => {
  it("mặc định TẮT, ngưỡng 85; ngưỡng bị kẹp trong 70-100; đổi được từng phần", () => {
    expect(autoApproveConfig(B)).toEqual({ enabled: false, minScore: AUTO_APPROVE_DEFAULT });
    expect(setAutoApprove(B, { enabled: true }, "ceo")).toMatchObject({ enabled: true, minScore: 85 });
    expect(setAutoApprove(B, { minScore: 92 }, "ceo")).toMatchObject({ enabled: true, minScore: 92 });
    expect(setAutoApprove(B, { minScore: 10 }, "ceo").minScore).toBe(70);
    expect(setAutoApprove(B, { enabled: false }, "ceo")).toMatchObject({ enabled: false, minScore: 70 });
    expect(q.all("SELECT id FROM audit_log WHERE event = 'auto_approve.changed'")).toHaveLength(4);
  });
  it("giữ nguyên các cài đặt khác của doanh nghiệp", () => {
    update("biz", B, { settings: { ...DEFAULT_SETTINGS, backupPerson: "An", quietHours: [21, 6] } });
    on(80);
    expect(byId<any>("biz", B)!.settings).toMatchObject({ backupPerson: "An", quietHours: [21, 6], autoApprove: { enabled: true, minScore: 80 } });
  });
});

describe("điều kiện tự duyệt", () => {
  it("bài Đạt + đủ điểm → duyệt luôn, ghi nhật ký có điểm và ngưỡng", async () => {
    on(80);
    const { ap, ci, t } = post({ total: 88 });
    expect(await autoApproveOne(B, ap.id)).toEqual({ approved: true, score: 88 });
    expect(status(ap.id)).toBe("approved");
    expect(byId<any>("approval", ap.id)).toMatchObject({ decided_by: "Tự động duyệt" });
    expect(byId<any>("content_item", ci.id)!.status).toBe("approved");
    expect(byId<any>("task", t.id)!.status).toBe("done");
    const a = q.get<any>("SELECT data FROM audit_log WHERE event = 'approval.auto_approved'")!;
    expect(a.data).toMatchObject({ score: 88, minScore: 80 });
  });
  it("điểm bằng ngưỡng thì duyệt (từ N điểm trở lên); thấp hơn thì để Sếp, ghi lý do", async () => {
    on(80);
    const eq = post({ total: 80 }); const low = post({ total: 79.9 });
    expect((await autoApproveOne(B, eq.ap.id)).approved).toBe(true);
    const r = await autoApproveOne(B, low.ap.id);
    expect(r).toMatchObject({ approved: false, reason: "Điểm 79.9 thấp hơn ngưỡng 80" });
    expect(status(low.ap.id)).toBe("pending");
    expect(q.get<any>("SELECT data FROM audit_log WHERE event = 'approval.auto_skipped'")!.data.reason).toMatch(/79.9/);
  });
  it("công tắc TẮT thì không làm gì", async () => {
    const { ap } = post({ total: 99 });
    expect(await autoApproveOne(B, ap.id)).toMatchObject({ approved: false, reason: expect.stringMatching(/đang tắt/) });
    expect(status(ap.id)).toBe("pending");
  });
  it("review cần sửa / bị chặn / cần Sếp xem / có lỗi nghiêm trọng → không tự duyệt dù điểm cao", async () => {
    on(70);
    for (const over of [{ verdict: "revise" }, { verdict: "block" }, { verdict: "escalate" }, { fatal: ["Giá lệch DNA"] }, { preview: { notPassed: true } }, { preview: { escalated: true } }, { preview: { imageError: "Chưa tạo được ảnh" } }, { risk: "high" }]) {
      const { ap } = post({ total: 99, ...over });
      expect((await autoApproveOne(B, ap.id)).approved, JSON.stringify(over)).toBe(false);
      expect(status(ap.id)).toBe("pending");
    }
  });
  it("chưa có điểm chấm / hết hạn → không tự duyệt", async () => {
    on(70);
    const a = post(); update("approval", a.ap.id, { review_score_id: null });
    expect(await autoApproveOne(B, a.ap.id)).toMatchObject({ approved: false, reason: "Chưa có điểm chấm" });
    const b = post(); update("approval", b.ap.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await autoApproveOne(B, b.ap.id)).toMatchObject({ approved: false, reason: "Mục duyệt đã hết hạn" });
  });
  it("kill switch đăng bài đang bật → không tự duyệt", async () => {
    on(70);
    update("biz", B, { settings: { ...byId<any>("biz", B)!.settings, killSwitch: { publish: true, ads: false, chat: false, all: false } } });
    const { ap } = post();
    expect(await autoApproveOne(B, ap.id)).toMatchObject({ approved: false, reason: "Kill switch đăng bài đang bật" });
  });
  it("bài SEO thiếu ảnh (4 ảnh / 1000 chữ) → không tự duyệt; đủ ảnh thì duyệt", async () => {
    on(70);
    const w = (k: number) => Array.from({ length: k }, (_, i) => `từ${i}`).join(" ");
    const body = ["Meta: m", "Từ khóa: k", "", w(60), "", "## A", "", w(90), "", w(90), "", "## B", "", w(90), "", w(90), ""].join("\n");
    const s = post({ agent: "seo_web", kind: "seo_article", channel: "website", body });
    const r = await autoApproveOne(B, s.ap.id);
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/ảnh/);
    expect(status(s.ap.id)).toBe("pending");
  });
});

describe("chỉ nội dung / video, không bao giờ tiền hay tin gửi khách", () => {
  it("ads, hành động ngân sách, follow-up, chăm khách, đơn hàng, đề xuất học, chiến lược → luôn để Sếp dù điểm tuyệt đối", async () => {
    on(70);
    const rv = insert("review_score", { biz_id: B, subject_type: "x", subject_id: "x", rubric_key: "content_social", rubric_version: 1, total: 100, verdict: "pass", result: { fatalFindings: [] } });
    const strat = insert("task", { biz_id: B, goal_id: null, agent_key: "strategy", title: "KH", status: "awaiting_approval", input: {}, depends_on: [] });
    const rows = [
      ["ad_candidate", "c1", "ads"], ["action", "a1", "ads"], ["follow_up", "f1", "chat"], ["nurture_send", "n1", "chat"], ["order_draft", "o1", "chat"], ["change_proposal", "p1", "feedback"], ["task", strat.id, "strategy"],
    ].map(([type, id, agent]) => insert("approval", { biz_id: B, subject_type: type, subject_id: id, agent_key: agent, title: type, risk: "low", status: "pending", review_score_id: rv.id, preview: {} }));
    for (const ap of rows) {
      expect(checkAutoApprove(byId<any>("approval", ap.id)!, 70)).toMatchObject({ ok: false, eligible: false });
      expect((await autoApproveOne(B, ap.id, { ignoreSwitch: true })).approved).toBe(false);
      expect(status(ap.id)).toBe("pending");
    }
    expect(await autoApprovePending(B)).toMatchObject({ approved: 0 });
    expect(autoApproveView(B)).toMatchObject({ pendingEligible: 0 });
  });
  it("video Flow: tự duyệt khi đạt kiểm tra kỹ thuật + đủ điểm; hỏng kỹ thuật thì không", async () => {
    on(80);
    const mk = (tech: { check: string; passed: boolean }[], total: number) => {
      const asset = insert("creative_asset", { biz_id: B, kind: "video", path: "x.mp4", mime: "video/mp4" });
      const ci = insert("content_item", { biz_id: B, agent_key: "creative", kind: "video", channel: "facebook", title: "V", body: "c", status: "awaiting_approval", asset_id: asset.id });
      const job = insert("creative_job", { biz_id: B, tool: "flow-thu-cong", title: "V", status: "done", input: { channels: [] }, content_item_id: ci.id, asset_id: asset.id });
      const rv = insert("review_score", { biz_id: B, subject_type: "content_item", subject_id: ci.id, rubric_key: "video_final", rubric_version: 1, total, verdict: "pass", result: { fatalFindings: [] } });
      return insert("approval", { biz_id: B, subject_type: "creative_job", subject_id: job.id, agent_key: "creative", title: "Video: V", risk: "low", status: "pending", review_score_id: rv.id, preview: { tech, channels: [] } });
    };
    const good = mk([{ check: "Có file MP4", passed: true }, { check: "Có âm thanh", passed: true }], 85);
    const bad = mk([{ check: "Có file MP4", passed: true }, { check: "Có âm thanh", passed: false }], 95);
    expect(checkAutoApprove(byId<any>("approval", good.id)!, 80)).toMatchObject({ ok: true, score: 85 });
    expect(await autoApproveOne(B, bad.id)).toMatchObject({ approved: false, reason: expect.stringContaining("Có âm thanh") });
    expect(status(bad.id)).toBe("pending");
  });
});

describe("mục mới được xếp việc; mục chờ từ trước chỉ duyệt khi bấm \"Duyệt ngay\"", () => {
  it("queueAutoApprove: công tắc tắt thì không xếp việc; bật thì xếp đúng 1 việc ở hàng đợi review (không trùng)", () => {
    const { ap } = post();
    queueAutoApprove(B, ap.id);
    expect(q.all("SELECT id FROM job WHERE name = 'approval.auto'")).toHaveLength(0);
    on(80);
    queueAutoApprove(B, ap.id); queueAutoApprove(B, ap.id);
    expect(q.all<any>("SELECT queue, payload FROM job WHERE name = 'approval.auto'")).toEqual([{ queue: "review", payload: { approvalId: ap.id } }]);
  });
  it("bật công tắc KHÔNG tự duyệt mục đang chờ; autoApprovePending chỉ duyệt mục đạt, báo lý do mục còn lại", async () => {
    const hi = post({ total: 91 }); const lo = post({ total: 74 }); const rev = post({ total: 95, verdict: "revise" });
    on(80);
    expect([hi, lo, rev].every((x) => status(x.ap.id) === "pending")).toBe(true);
    expect(autoApproveView(B)).toMatchObject({ enabled: true, pendingEligible: 3, pendingReady: 1 });
    const r = await autoApprovePending(B);
    expect(r.approved).toBe(1);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['Review chưa "Đạt" (cần sửa)', "Điểm 74 thấp hơn ngưỡng 80"]);
    expect(status(hi.ap.id)).toBe("approved"); expect(status(lo.ap.id)).toBe("pending"); expect(status(rev.ap.id)).toBe("pending");
    expect(autoApproveView(B).recent).toHaveLength(1);
  });
  it("bài duyệt xong đi xuống phần Đăng bài (xếp lịch đăng) khi không phải việc 'chỉ viết'", async () => {
    on(80);
    const { ap, t } = post({ total: 95 });
    update("task", t.id, { input: {} }); // việc của kế hoạch: duyệt xong thì đăng
    await autoApproveOne(B, ap.id);
    expect(q.all<any>("SELECT name FROM job WHERE name = 'publish.schedule'")).toHaveLength(1);
  });
});
