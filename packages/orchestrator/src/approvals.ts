import { audit, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import type { OrderForm } from "@dotaka/contracts";
import { REJECTION_REASONS, judge, recordDecision, rejectionHeuristic, rejectionQuestions } from "@dotaka/jev";
import { AppError, nowIso } from "@dotaka/shared";
import { enqueue } from "./queue.ts";
import { approvalExpiresAt, approveTask, setTaskStatus } from "./runtime.ts";
import { applyProposal } from "./learning.ts";
import { scheduleDrafts } from "./creative.ts";
import { seoImagesShortReason } from "./seo-images.ts";
import { sendZaloFollowUp } from "./zalo-followup.ts";
import { decideNurtureSend } from "./nurture.ts";
import { createApprovedOrder, validateOrderDraft } from "./order-push.ts";

/**
 * Approval gate (spec §5, §14): approve | edit | reject, with a reason.
 * Edits and rejections are learning signals: Jev classifies the CEO's note into a reason
 * category so the Feedback Agent can aggregate them.
 */
export async function decideApproval(bizId: string, approvalId: string, decision: "approve" | "edit" | "reject", note: string | undefined, edited: string | undefined, actor = "ceo", opts: { orderForm?: OrderForm } = {}) {
  const ap = byId<Row>("approval", approvalId);
  if (!ap || ap.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy mục duyệt", 404);
  if (ap.status !== "pending") throw new AppError("ALREADY_DECIDED", "Mục này đã được xử lý");
  if (ap.expires_at && new Date(ap.expires_at) < new Date()) {
    expireOne(ap); // hết hạn cả nội dung đi kèm (không để "Chờ duyệt" mãi) — Sếp bấm "Mở lại" để duyệt tiếp
    throw new AppError("EXPIRED", "Mục duyệt đã hết hạn — mở lại nội dung để duyệt tiếp");
  }
  // Đơn nháp: phiếu sai (thiếu SĐT / địa chỉ…) báo lỗi TRƯỚC khi ghi bất cứ gì — mục duyệt vẫn mở để sửa phiếu.
  if (ap.subject_type === "order_draft" && decision !== "reject") validateOrderDraft(bizId, ap, opts.orderForm);
  // Bài SEO phải đủ ảnh theo quy tắc (4 ảnh / 1000 chữ, tối thiểu 4) mới được duyệt — không để bài thiếu ảnh lọt lên website.
  if (ap.subject_type === "task" && decision === "approve") {
    const short = seoImagesShortReason(q.get<Row>("SELECT * FROM content_item WHERE task_id = ?", ap.subject_id));
    if (short) throw new AppError("SEO_IMAGES_MISSING", short, 409);
  }
  const status = decision === "approve" ? "approved" : decision === "edit" ? "edited" : "rejected";
  update("approval", ap.id, { status, decided_by: actor, decision_note: note ?? null, decided_at: nowIso() });
  audit(bizId, actor, `approval.${status}`, { type: ap.subject_type, id: ap.subject_id }, { note, edited: Boolean(edited) });

  // Đơn nháp bị từ chối không phải tín hiệu về văn phong/nội dung → không tạo ví dụ "nên tránh" cho agent chat.
  if (decision !== "approve" && note && ap.subject_type !== "order_draft") {
    const j = await judge({ bizId, purpose: "feedback.rejection", subject: { type: "approval", id: ap.id }, state: { ceo_note: note, draft_title: ap.title }, questions: rejectionQuestions, heuristic: rejectionHeuristic });
    const reason = (j.answers as any).reason;
    recordDecision(j.id, { reason: reason.choice, label: REJECTION_REASONS[reason.choice as keyof typeof REJECTION_REASONS] });
    insert("exemplar", { biz_id: bizId, agent_key: ap.agent_key ?? "content", kind: decision === "edit" ? "ceo_edit" : "avoid", text: `${ap.title}\nGhi chú CEO: ${note}${edited ? `\nBản sửa: ${edited.slice(0, 800)}` : ""}`, outcome: reason.choice });
  }

  switch (ap.subject_type) {
    case "task": {
      const task = byId<Row>("task", ap.subject_id)!;
      if (decision === "reject") {
        setTaskStatus(task, "rejected", {}, actor);
        q.run("UPDATE content_item SET status = 'rejected' WHERE task_id = ?", task.id);
      } else await approveTask(task, actor, decision === "edit" ? edited : undefined);
      break;
    }
    case "ad_candidate": {
      if (decision === "reject") {
        update("ad_candidate", ap.subject_id, { status: "rejected", decision_note: note ?? null });
        const c = byId<Row>("ad_candidate", ap.subject_id)!;
        update("post", c.post_id, { ad_status: "none" });
      } else {
        if (decision === "edit" && edited && /^\d+$/.test(edited.replace(/[.,\s]/g, ""))) update("ad_candidate", ap.subject_id, { daily_budget: Number(edited.replace(/[.,\s]/g, "")) });
        update("ad_candidate", ap.subject_id, { status: "approved" });
        enqueue("ads", "candidate.publish", { candidateId: ap.subject_id }, { bizId, idempotencyKey: `candpub:${ap.subject_id}` });
      }
      break;
    }
    case "action": {
      if (decision === "reject") update("action", ap.subject_id, { status: "blocked", reason: `CEO từ chối: ${note ?? ""}` });
      else {
        update("action", ap.subject_id, { status: "approved" });
        const a = byId<Row>("action", ap.subject_id)!;
        enqueue("ads", "action.execute", { actionId: a.id }, { bizId, idempotencyKey: `exec:${a.id}`, lockKey: `obj:${a.target_id}` });
      }
      break;
    }
    case "creative_job": {
      const job = byId<Row>("creative_job", ap.subject_id)!;
      if (decision === "reject") {
        update("content_item", job.content_item_id, { status: "rejected" });
        update("creative_job", job.id, { status: "rejected", step: "Sếp từ chối" });
      } else {
        if (decision === "edit" && edited) {
          const ci = byId<Row>("content_item", job.content_item_id)!;
          update("content_item", ci.id, { body: `${edited}\n\n---\n${String(ci.body).split("\n---\n")[1] ?? ""}` });
        }
        scheduleDrafts(bizId, ap.subject_id, actor);
      }
      break;
    }
    case "follow_up": {
      if (decision === "reject") update("follow_up_plan", ap.subject_id, { status: "stopped" });
      else {
        try {
          await sendZaloFollowUp(bizId, ap.subject_id, decision === "edit" && edited ? edited : String(ap.preview?.text ?? ""), actor);
        } catch (e) {
          // Not sent: keep the approval open unless the customer already replied.
          const replied = (e as any)?.code === "CUSTOMER_REPLIED";
          update("approval", ap.id, { status: replied ? "expired" : "pending", decided_at: null, decided_by: null });
          throw e;
        }
      }
      break;
    }
    case "nurture_send": {
      // Chăm khách từ bình luận — chế độ duyệt trước (gửi trả lời + inbox / bỏ qua): xử lý trong nurture.ts.
      await decideNurtureSend(bizId, ap, decision, edited, actor);
      break;
    }
    case "change_proposal": {
      if (decision === "reject") update("change_proposal", ap.subject_id, { status: "rejected" });
      else applyProposal(bizId, ap.subject_id, actor);
      break;
    }
    case "order_draft": {
      // Đơn chốt từ chat [ĐỎ]: từ chối → không tạo đơn; duyệt → đơn nội bộ (+ đẩy Pancake CHỈ khi phiếu có pushToPancake === true).
      if (decision === "reject") break;
      try {
        createApprovedOrder(bizId, ap, opts.orderForm, actor);
      } catch (e) {
        // Lỗi (phiếu / ghi đơn): mục duyệt về "chờ" để Sếp sửa phiếu và duyệt lại; chưa có đơn nào được tạo.
        update("approval", ap.id, { status: "pending", decided_at: null, decided_by: null, decision_note: null });
        throw e;
      }
      break;
    }
  }
  emit(bizId, "approval.decided", { approvalId: ap.id, status });
  return { status };
}

/**
 * Mục duyệt quá hạn → "expired". Không để nội dung treo "Chờ duyệt" mãi:
 *  - task: khâu → "expired", nội dung của khâu → "expired";
 *  - creative_job (video "Duyệt & lên kênh"): nội dung → "expired".
 * Sếp bấm "Mở lại" (reopenContentApproval) để duyệt tiếp.
 */
export function expireApprovals(now = new Date()) {
  const rows = q.all<Row>("SELECT * FROM approval WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?", now.toISOString());
  for (const ap of rows) expireOne(ap);
  return rows.length;
}
function expireOne(ap: Row) {
  update("approval", ap.id, { status: "expired" });
  if (ap.subject_type === "task") {
    const t = byId<Row>("task", ap.subject_id);
    if (t?.status === "awaiting_approval") setTaskStatus(t, "expired");
    q.run("UPDATE content_item SET status = 'expired' WHERE task_id = ? AND status = 'awaiting_approval'", ap.subject_id);
  } else if (ap.subject_type === "creative_job") {
    const job = byId<Row>("creative_job", ap.subject_id);
    if (job?.content_item_id) q.run("UPDATE content_item SET status = 'expired' WHERE id = ? AND status IN ('awaiting_approval','in_review')", job.content_item_id);
  }
  emit(ap.biz_id, "approval.expired", { approvalId: ap.id, subjectType: ap.subject_type });
}

/**
 * "Mở lại" nội dung hết hạn duyệt: tạo lại đúng mục duyệt cũ (bài của 1 khâu, hoặc video "Duyệt & lên kênh"), hạn mới theo
 * cài đặt. Không đăng gì, không viết lại — vẫn chờ Sếp duyệt.
 */
export function reopenContentApproval(bizId: string, contentItemId: string, actor = "ceo") {
  const ci = byId<Row>("content_item", contentItemId);
  if (!ci || ci.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
  if (ci.status !== "expired") throw new AppError("NOT_EXPIRED", "Chỉ mở lại được nội dung đã hết hạn duyệt", 409);
  const OWN = `((a.subject_type = 'task' AND a.subject_id = ?)
    OR (a.subject_type = 'creative_job' AND a.subject_id IN (SELECT id FROM creative_job WHERE content_item_id = ?)))`;
  const taskId = ci.task_id ?? "-";
  const pendingFor = q.get<Row>(`SELECT a.* FROM approval a WHERE a.biz_id = ? AND a.status = 'pending' AND ${OWN}`, bizId, taskId, ci.id);
  if (pendingFor) { update("content_item", ci.id, { status: "awaiting_approval" }); return pendingFor; }
  const last = q.get<Row>(`SELECT a.* FROM approval a WHERE a.biz_id = ? AND a.status = 'expired' AND ${OWN} ORDER BY a.created_at DESC LIMIT 1`, bizId, taskId, ci.id);
  if (!last) throw new AppError("NO_APPROVAL", "Không thấy mục duyệt cũ của nội dung này — bấm Tạo lại để viết bản mới", 409);
  if (last.subject_type === "task") {
    // Khâu hết hạn: đưa về "chờ duyệt" đúng bản nháp cũ (không chạy lại agent).
    const t = byId<Row>("task", last.subject_id);
    if (!t || t.status !== "expired") throw new AppError("NOT_EXPIRED", "Khâu này không còn ở trạng thái hết hạn — bấm Tạo lại để viết bản mới", 409);
    update("task", t.id, { status: "awaiting_approval", progress: 0.9, step: "Chờ CEO duyệt (mở lại)" });
    audit(bizId, actor, "task.status", { type: "task", id: t.id }, { from: "expired", to: "awaiting_approval", agent: t.agent_key });
  }
  const ap = insert("approval", {
    biz_id: bizId, subject_type: last.subject_type, subject_id: last.subject_id, agent_key: last.agent_key, title: last.title,
    risk: last.risk, status: "pending", review_score_id: last.review_score_id ?? null, preview: last.preview ?? {},
    expires_at: approvalExpiresAt(bizId),
  });
  update("content_item", ci.id, { status: "awaiting_approval" });
  audit(bizId, actor, "approval.reopened", { type: "content_item", id: ci.id }, { approvalId: ap.id, from: last.id });
  emit(bizId, "approval.created", { approvalId: ap.id, title: ap.title });
  return ap;
}
