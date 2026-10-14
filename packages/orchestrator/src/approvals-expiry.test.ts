import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { approvalExpiresAt } from "./runtime.ts";
import { decideApproval, expireApprovals, reopenContentApproval } from "./approvals.ts";

/** Mục duyệt hết hạn: nội dung không treo "Chờ duyệt" mãi; "Mở lại" tạo lại đúng mục duyệt cũ (bài của 1 khâu và video). */
let B: string, B2: string;
const past = () => new Date(Date.now() - 3600_000).toISOString();
const future = () => new Date(Date.now() + 3600_000).toISOString();

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, approvalExpiryHours: 24, llm: { provider: "sandbox" } } }).id;
  B2 = insert("biz", { name: "Shop khác", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
});
beforeEach(() => { for (const t of ["approval", "task", "goal", "content_item", "creative_job", "creative_asset", "job", "audit_log", "publish_job", "channel"]) q.run(`DELETE FROM ${t}`); });
afterAll(() => closeDb());

const taskPost = (approvalExpires = past()) => {
  const g = insert("goal", { biz_id: B, title: "G", description: "x", template: "weekly_content", status: "active", params: {} });
  const t = insert("task", { biz_id: B, goal_id: g.id, agent_key: "content", title: "Bài", status: "awaiting_approval", input: {}, depends_on: [] });
  const ci = insert("content_item", { biz_id: B, goal_id: g.id, task_id: t.id, agent_key: "content", kind: "social_post", channel: "facebook", title: "Bài", body: "Nội dung bài", status: "awaiting_approval" });
  const ap = insert("approval", { biz_id: B, subject_type: "task", subject_id: t.id, agent_key: "content", title: "Bài", risk: "low", status: "pending", preview: { body: "Nội dung bài" }, expires_at: approvalExpires });
  return { g, t, ci, ap };
};
const videoJob = (approvalExpires = past()) => {
  const ci = insert("content_item", { biz_id: B, agent_key: "creative", kind: "video", channel: "facebook", title: "Video", body: "Caption", status: "awaiting_approval" });
  const job = insert("creative_job", { biz_id: B, tool: "review-do-an-vat", title: "Video", status: "done", input: { channels: ["facebook"] }, content_item_id: ci.id });
  const ap = insert("approval", { biz_id: B, subject_type: "creative_job", subject_id: job.id, agent_key: "creative", title: "Video: Video", risk: "low", status: "pending", preview: { channels: ["facebook"] }, expires_at: approvalExpires });
  return { ci, job, ap };
};

describe("hạn duyệt", () => {
  it("approvalExpiresAt theo cài đặt của doanh nghiệp (mặc định 72 giờ)", () => {
    const from = Date.parse("2026-10-10T00:00:00Z");
    expect(approvalExpiresAt(B, from)).toBe("2026-10-11T00:00:00.000Z");
    expect(approvalExpiresAt(B2, from)).toBe("2026-10-13T00:00:00.000Z");
  });

  it("expireApprovals: bài của khâu → khâu + nội dung 'expired'; video → nội dung 'expired'; mục chưa tới hạn giữ nguyên", () => {
    const a = taskPost();
    const v = videoJob();
    const keep = taskPost(future());
    expect(expireApprovals()).toBe(2);
    expect(byId<Row>("approval", a.ap.id)!.status).toBe("expired");
    expect(byId<Row>("task", a.t.id)!.status).toBe("expired");
    expect(byId<Row>("content_item", a.ci.id)!.status).toBe("expired");
    expect(byId<Row>("approval", v.ap.id)!.status).toBe("expired");
    expect(byId<Row>("content_item", v.ci.id)!.status).toBe("expired");
    expect(byId<Row>("approval", keep.ap.id)!.status).toBe("pending");
    expect(byId<Row>("content_item", keep.ci.id)!.status).toBe("awaiting_approval");
  });

  it("duyệt một mục đã quá hạn → báo hết hạn + nội dung hết hạn (không treo 'Chờ duyệt')", async () => {
    const a = taskPost();
    await expect(decideApproval(B, a.ap.id, "approve", undefined, undefined, "ceo")).rejects.toThrowError(/hết hạn — mở lại/);
    expect(byId<Row>("approval", a.ap.id)!.status).toBe("expired");
    expect(byId<Row>("content_item", a.ci.id)!.status).toBe("expired");
  });
});

describe("Mở lại", () => {
  it("bài của khâu: tạo lại mục duyệt với hạn mới, khâu + nội dung về 'chờ duyệt'; duyệt được tiếp", async () => {
    const a = taskPost();
    expireApprovals();
    const ap = reopenContentApproval(B, a.ci.id, "ceo");
    expect(ap).toMatchObject({ subject_type: "task", subject_id: a.t.id, status: "pending", title: "Bài" });
    expect(new Date(ap.expires_at).getTime()).toBeGreaterThan(Date.now() + 20 * 3600_000);
    expect(byId<Row>("task", a.t.id)!.status).toBe("awaiting_approval");
    expect(byId<Row>("content_item", a.ci.id)!.status).toBe("awaiting_approval");
    // mở lại lần nữa không tạo mục thứ hai
    expect(() => reopenContentApproval(B, a.ci.id, "ceo")).toThrowError(/Chỉ mở lại được/);
    // duyệt xong chạy bình thường (đã duyệt; kênh chưa có → "đăng thủ công" là việc của publishing)
    await decideApproval(B, ap.id, "approve", undefined, undefined, "ceo");
    expect(byId<Row>("task", a.t.id)!.status).toBe("done");
    expect(byId<Row>("content_item", a.ci.id)!.status).toBe("approved");
  });

  it("video: tạo lại mục duyệt 'creative_job' + giữ điểm review; từ chối → job 'rejected'", async () => {
    const v = videoJob();
    update("approval", v.ap.id, { review_score_id: null });
    expireApprovals();
    const ap = reopenContentApproval(B, v.ci.id, "ceo");
    expect(ap).toMatchObject({ subject_type: "creative_job", subject_id: v.job.id, status: "pending" });
    expect(byId<Row>("content_item", v.ci.id)!.status).toBe("awaiting_approval");
    await decideApproval(B, ap.id, "reject", undefined, undefined, "ceo");
    expect(byId<Row>("content_item", v.ci.id)!.status).toBe("rejected");
    expect(byId<Row>("creative_job", v.job.id)!.status).toBe("rejected");
  });

  it("nội dung không hết hạn / của doanh nghiệp khác / không còn mục duyệt cũ → từ chối rõ ràng", () => {
    const a = taskPost(future());
    expect(() => reopenContentApproval(B, a.ci.id, "ceo")).toThrowError(/hết hạn duyệt/);
    expect(() => reopenContentApproval(B2, a.ci.id, "ceo")).toThrowError(/Không thấy/);
    const orphan = insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "facebook", title: "Mồ côi", body: "x", status: "expired" });
    expect(() => reopenContentApproval(B, orphan.id, "ceo")).toThrowError(/Không thấy mục duyệt cũ/);
  });
});
