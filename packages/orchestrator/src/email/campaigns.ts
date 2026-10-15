import { audit, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { kiemJsonKeoTha, kiemNoiDungKhoi, phanBan, soatBien, type KhoiJson, type TaiLieuKeoTha } from "@dotaka/email";
import { AppError, logger, nowIso } from "@dotaka/shared";
import { approvalExpiresAt } from "../runtime.ts";
import { renderContent, sendEmail, type EmailContent } from "./send.ts";
import { emailSendConfig, emailStatus, inSendWindow } from "./settings.ts";
import { segmentMembers, segmentOf } from "./segments.ts";

/**
 * Chiến dịch email (broadcast) — chép luồng auto-funnel F-023/F-025/F-026/F-008, thêm cổng DUYỆT của Agentic AI:
 * nháp → "Gửi duyệt" (mục duyệt [ĐỎ] email_campaign, không bao giờ tự duyệt) → duyệt = lên lịch → email.tick gửi.
 * Gửi tiếp được: dừng vì hết hạn mức ngày thì giữ "sending" và hôm sau gửi nốt (không gửi trùng người đã nhận).
 * A/B tiêu đề tất định theo người nhận; gửi lại 1 lần cho người chưa mở sau N giờ (tiêu đề thứ hai).
 */
export type Mode = "text" | "blocks" | "dnd";
export function contentOf(row: Row, subject = row.subject): EmailContent {
  if (row.mode === "blocks") return { mode: "blocks", subject, data: row.data as KhoiJson, preheader: row.preheader };
  if (row.mode === "dnd") return { mode: "dnd", subject, data: row.data as TaiLieuKeoTha, preheader: row.preheader };
  return { mode: "text", subject, body: String(row.body ?? ""), preheader: row.preheader };
}

/** Lỗi nội dung chặn gửi: thiếu tiêu đề / nội dung, khối hỏng, biến không có dự phòng (F-025). */
export function contentErrors(row: Row): string[] {
  const err: string[] = [];
  if (!String(row.subject ?? "").trim()) err.push("Thiếu tiêu đề");
  if (row.mode === "blocks") err.push(...kiemNoiDungKhoi(row.data).loi);
  else if (row.mode === "dnd") err.push(...kiemJsonKeoTha(row.data).loi);
  else if (!String(row.body ?? "").trim()) err.push("Thiếu nội dung");
  const textual = `${row.subject ?? ""}\n${row.subject_b ?? ""}\n${row.preheader ?? ""}\n${row.mode === "text" ? row.body ?? "" : JSON.stringify(row.data ?? {})}`;
  const missing = soatBien(textual, { ten_thuong_hieu: "x", email: "x", link_huy_nhan: "x" });
  if (missing.length) err.push(`Biến thiếu giá trị dự phòng: ${missing.map((b) => `{{${b}}}`).join(", ")} — viết dạng {{${missing[0]}|giá trị dự phòng}}`);
  return err;
}

export function campaignOf(bizId: string, id: string): Row {
  const c = byId<Row>("email_campaign", id);
  if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy chiến dịch", 404);
  return c;
}

export type CampaignInput = {
  name?: string; segmentId?: string | null; subject?: string; subjectB?: string | null; abPct?: number; preheader?: string | null;
  mode?: Mode; body?: string; data?: unknown; scheduledAt?: string | null; resendAfterHours?: number | null; resendSubject?: string | null;
};
function patchOf(input: CampaignInput): Row {
  const p: Row = {};
  if (input.name !== undefined) p.name = String(input.name).trim().slice(0, 160) || "Chiến dịch email";
  if (input.segmentId !== undefined) p.segment_id = input.segmentId || null;
  if (input.subject !== undefined) p.subject = String(input.subject).slice(0, 200);
  if (input.subjectB !== undefined) p.subject_b = input.subjectB ? String(input.subjectB).slice(0, 200) : null;
  if (input.abPct !== undefined) p.ab_pct = Math.max(0, Math.min(50, Math.floor(Number(input.abPct) || 0)));
  if (input.preheader !== undefined) p.preheader = input.preheader ? String(input.preheader).slice(0, 200) : null;
  if (input.mode !== undefined) { if (!["text", "blocks", "dnd"].includes(input.mode)) throw new AppError("INVALID", "Chế độ soạn không hợp lệ"); p.mode = input.mode; }
  if (input.body !== undefined) p.body = String(input.body).slice(0, 100_000);
  if (input.data !== undefined) p.data = input.data ?? {};
  if (input.scheduledAt !== undefined) {
    if (input.scheduledAt && Number.isNaN(Date.parse(input.scheduledAt))) throw new AppError("INVALID", "Giờ hẹn gửi không hợp lệ");
    p.scheduled_at = input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null;
  }
  if (input.resendAfterHours !== undefined) p.resend_after_hours = input.resendAfterHours ? Math.max(6, Math.min(240, Math.floor(Number(input.resendAfterHours)))) : null;
  if (input.resendSubject !== undefined) p.resend_subject = input.resendSubject ? String(input.resendSubject).slice(0, 200) : null;
  return p;
}

export function createCampaign(bizId: string, input: CampaignInput, actor: string) {
  if (input.segmentId) segmentOf(bizId, input.segmentId);
  const c = insert("email_campaign", { biz_id: bizId, name: "Chiến dịch email", subject: "", mode: "text", body: "", data: {}, status: "draft", summary: {}, created_by: actor, ...patchOf(input) });
  audit(bizId, actor, "email.campaign_created", { type: "email_campaign", id: c.id });
  return byId<Row>("email_campaign", c.id)!;
}

export function updateCampaign(bizId: string, id: string, input: CampaignInput, actor: string) {
  const c = campaignOf(bizId, id);
  if (!["draft", "awaiting_approval"].includes(c.status)) throw new AppError("LOCKED", "Chiến dịch đã lên lịch / đang gửi — không sửa được", 409);
  if (input.segmentId) segmentOf(bizId, input.segmentId);
  // Sửa khi đang chờ duyệt → huỷ mục duyệt cũ, về nháp (nội dung đã duyệt phải đúng nội dung gửi).
  if (c.status === "awaiting_approval" && c.approval_id) q.run("UPDATE approval SET status = 'expired', decision_note = 'Chiến dịch đã bị sửa sau khi gửi duyệt', updated_at = ? WHERE id = ? AND status = 'pending'", nowIso(), c.approval_id);
  update("email_campaign", c.id, { ...patchOf(input), status: "draft", approval_id: null });
  audit(bizId, actor, "email.campaign_updated", { type: "email_campaign", id: c.id });
  return byId<Row>("email_campaign", c.id)!;
}

export function deleteCampaign(bizId: string, id: string, actor: string) {
  const c = campaignOf(bizId, id);
  if (c.status === "sending") throw new AppError("LOCKED", "Đang gửi — bấm Dừng trước", 409);
  if (c.approval_id) q.run("UPDATE approval SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'", nowIso(), c.approval_id);
  q.run("DELETE FROM email_campaign WHERE id = ?", c.id);
  audit(bizId, actor, "email.campaign_deleted", { type: "email_campaign", id: c.id }, { name: c.name });
  return { ok: true };
}

export function cancelCampaign(bizId: string, id: string, actor: string) {
  const c = campaignOf(bizId, id);
  if (!["scheduled", "sending", "awaiting_approval"].includes(c.status)) throw new AppError("INVALID", "Chiến dịch không ở trạng thái dừng được");
  if (c.approval_id) q.run("UPDATE approval SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'", nowIso(), c.approval_id);
  update("email_campaign", c.id, { status: "cancelled" });
  audit(bizId, actor, "email.campaign_cancelled", { type: "email_campaign", id: c.id });
  return byId<Row>("email_campaign", c.id)!;
}

/** Xem trước HTML (người nhận mẫu) — không gửi, không ghi gì. */
export async function previewCampaign(bizId: string, id: string, variant: "a" | "b" = "a") {
  return previewContent(bizId, campaignOf(bizId, id), variant);
}
/** Xem trước 1 nội dung bất kỳ (chiến dịch / email chuỗi / mẫu / bản đang soạn) với người nhận mẫu. */
export async function previewContent(bizId: string, c: Row, variant: "a" | "b" = "a") {
  const s = emailSendConfig(bizId);
  const r = await renderContent(contentOf(c, variant === "b" && c.subject_b ? c.subject_b : c.subject), s?.fromName ?? "TAKI", { vars: { ho_ten: "Anh Minh", ten: "Anh Minh", email: "khach@vidu.vn", ten_thuong_hieu: s?.fromName ?? "TAKI" }, unsubUrl: "#" });
  const { renderEmail, renderCaNhan } = await import("@dotaka/email");
  const vars = { ho_ten: "Anh Minh", email: "khach@vidu.vn", ten_thuong_hieu: s?.fromName ?? "TAKI", link_huy_nhan: "#" };
  const html = r.html ? renderCaNhan(r.html, vars) : renderEmail({ tieuDe: renderCaNhan(r.subject, vars), noiDung: renderCaNhan(r.text ?? "", vars), preheader: r.preheader, tenNguoiGui: s?.fromName ?? "TAKI", linkHuy: "#" });
  return { subject: renderCaNhan(r.subject, vars), html, errors: contentErrors(c) };
}

/** Gửi duyệt: kiểm nội dung + người nhận + kết nối, mở mục duyệt [ĐỎ] (gửi thư cho khách không bao giờ tự duyệt). */
export function requestCampaignApproval(bizId: string, id: string, actor: string) {
  const c = campaignOf(bizId, id);
  if (c.status !== "draft") throw new AppError("INVALID", "Chỉ gửi duyệt chiến dịch đang nháp");
  const err = contentErrors(c);
  if (err.length) throw new AppError("CONTENT_INVALID", err.join(" · "));
  const st = emailStatus(bizId);
  if (!st.connected || !st.live) throw new AppError("EMAIL_NOT_CONNECTED", "Chưa kết nối Email (Resend) thật — Kết nối → Email (Resend)");
  if (!st.trackingBase) throw new AppError("NO_PUBLIC_URL", "Chưa có địa chỉ công khai ổn định (PUBLIC_BASE_URL + PUBLIC_PORT): thư marketing bắt buộc có link hủy nhận hoạt động");
  const members = segmentMembers(bizId, c.segment_id ?? null).length;
  if (!members) throw new AppError("NO_RECIPIENTS", "Phân khúc chưa có người nhận nào");
  const ap = insert("approval", {
    biz_id: bizId, subject_type: "email_campaign", subject_id: c.id, title: `Gửi email: ${c.name}`, agent_key: "email", risk: "high", status: "pending",
    preview: { kind: "email_campaign", name: c.name, subject: c.subject, subjectB: c.subject_b, abPct: c.ab_pct, preheader: c.preheader, recipients: members,
      segment: c.segment_id ? segmentOf(bizId, c.segment_id).name : "Mọi liên hệ đang nhận", scheduledAt: c.scheduled_at, dailyLimit: st.dailyLimit, sentToday: st.sentToday, mode: c.mode,
      resendAfterHours: c.resend_after_hours, resendSubject: c.resend_subject },
    expires_at: approvalExpiresAt(bizId),
  });
  update("email_campaign", c.id, { status: "awaiting_approval", approval_id: ap.id });
  emit(bizId, "approval.created", { approvalId: ap.id, subjectType: "email_campaign" });
  audit(bizId, actor, "email.campaign_submitted", { type: "email_campaign", id: c.id }, { recipients: members });
  return { approvalId: ap.id, recipients: members };
}

/** Gọi từ decideApproval. Duyệt → lên lịch (giờ hẹn hoặc ngay); từ chối → về nháp. */
export function decideCampaignApproval(bizId: string, ap: Row, decision: "approve" | "edit" | "reject", actor: string) {
  const c = byId<Row>("email_campaign", ap.subject_id);
  if (!c) return;
  if (decision === "reject") { update("email_campaign", c.id, { status: "draft", approval_id: null }); return; }
  if (c.status !== "awaiting_approval" || c.approval_id !== ap.id) throw new AppError("STALE", "Chiến dịch đã đổi sau khi gửi duyệt — gửi duyệt lại", 409);
  update("email_campaign", c.id, { status: "scheduled", scheduled_at: c.scheduled_at ?? nowIso() });
  audit(bizId, actor, "email.campaign_approved", { type: "email_campaign", id: c.id });
}

/** Gửi 1 chiến dịch đã lên lịch (resumable). Trả số đã gửi trong lượt này. */
export async function runCampaign(bizId: string, id: string): Promise<{ sent: number; done: boolean; stoppedBy?: string }> {
  const c0 = campaignOf(bizId, id);
  if (!["scheduled", "sending"].includes(c0.status)) return { sent: 0, done: true };
  update("email_campaign", c0.id, { status: "sending" });
  const c = byId<Row>("email_campaign", c0.id)!;
  const parent = c.parent_id ? byId<Row>("email_campaign", c.parent_id) : null;
  // Bản gửi lại: chỉ người đã NHẬN bản gốc mà chưa mở / click (tại lúc lập tệp).
  const recipients = parent
    ? q.all<Row>(`SELECT DISTINCT e.* FROM email_message m JOIN email_contact e ON e.id = m.contact_id WHERE m.biz_id = ? AND m.source_kind = 'campaign' AND m.source_id = ?
        AND m.status IN ('sent','delivered') AND m.opened_at IS NULL AND m.clicked_at IS NULL AND e.status = 'active'`, bizId, parent.id)
    : segmentMembers(bizId, c.segment_id ?? null);
  const done = new Set(q.all<Row>("SELECT DISTINCT contact_id FROM email_message WHERE source_kind = 'campaign' AND source_id = ? AND status NOT IN ('failed')", c.id).map((r) => r.contact_id));
  const stats: Row = { ...(c.summary ?? {}), total: recipients.length };
  let sent = 0, stoppedBy: string | undefined;
  // Render khối / kéo thả 1 lần cho cả chiến dịch (biến giữ nguyên để cá nhân hoá từng người).
  const s = emailSendConfig(bizId);
  const prerender = async (subject: string): Promise<EmailContent> => {
    const cnt = contentOf(c, subject);
    if (cnt.mode === "text") return cnt;
    const r = await renderContent(cnt, s?.fromName ?? "TAKI");
    return { mode: "html", subject, html: r.html!, preheader: c.preheader };
  };
  const contentA = await prerender(c.subject);
  const contentB = c.subject_b && c.ab_pct > 0 ? await prerender(c.subject_b) : null;
  for (const r of recipients) {
    if (done.has(r.id)) continue;
    const fresh = byId<Row>("email_campaign", c.id);
    if (fresh?.status !== "sending") { stoppedBy = "cancelled"; break; }
    const isB = Boolean(contentB) && phanBan(r.id, c.id, c.ab_pct) === "b";
    const res = await sendEmail({ bizId, contactId: r.id, content: isB ? contentB! : contentA, source: { kind: "campaign", id: c.id, step: isB ? 2 : 1 } });
    stats[res.status === "sent" ? "sent" : res.reason ?? res.status] = (stats[res.status === "sent" ? "sent" : res.reason ?? res.status] ?? 0) + 1;
    if (res.status === "sent") { sent++; if (isB) stats.variantB = (stats.variantB ?? 0) + 1; }
    // Hết hạn mức / ngắt / khoá: dừng lượt này, thư bị bỏ qua vì lý do này được gửi lại lượt sau.
    if (["daily_limit", "throttled", "stopped", "kill_switch", "not_connected", "sandbox", "no_public_url"].includes(res.reason ?? "")) {
      q.run("DELETE FROM email_message WHERE id = ?", res.messageId);
      stats[res.reason!]--;
      stoppedBy = res.reason;
      break;
    }
  }
  const finished = !stoppedBy;
  update("email_campaign", c.id, { summary: { ...stats, pausedBy: stoppedBy ?? null }, ...(finished ? { status: "sent", sent_at: nowIso() } : stoppedBy === "cancelled" ? {} : { status: "sending" }) });
  if (finished) {
    audit(bizId, "email", "email.campaign_sent", { type: "email_campaign", id: c.id }, stats);
    emit(bizId, "email.campaign_sent", { campaignId: c.id, sent: stats.sent ?? 0 });
  }
  return { sent, done: finished, stoppedBy };
}

/** Thống kê theo bản (A/B) từ email_message. */
export function campaignStats(bizId: string, id: string) {
  const c = campaignOf(bizId, id);
  const rows = q.all<Row>(`SELECT step, COUNT(*) AS n,
      SUM(CASE WHEN status NOT IN ('skipped','failed','queued') THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN delivered_at IS NOT NULL OR status IN ('delivered','opened','clicked') THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
      SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced, SUM(CASE WHEN status = 'complained' THEN 1 ELSE 0 END) AS complained,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, SUM(revenue) AS revenue
    FROM email_message WHERE biz_id = ? AND source_kind = 'campaign' AND source_id = ? GROUP BY step`, bizId, c.id);
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const total = { sent: sum("sent"), delivered: sum("delivered"), opened: sum("opened"), clicked: sum("clicked"), bounced: sum("bounced"), complained: sum("complained"), skipped: sum("skipped"), failed: sum("failed"), revenue: sum("revenue") };
  const skipReasons = q.all<Row>("SELECT reason, COUNT(*) AS n FROM email_message WHERE source_kind = 'campaign' AND source_id = ? AND status = 'skipped' GROUP BY reason", c.id);
  const resends = q.all<Row>("SELECT id, name, status, summary FROM email_campaign WHERE parent_id = ?", c.id);
  return { total, variants: rows.map((r) => ({ variant: r.step === 2 ? "B" : "A", ...r })), skipReasons, resends };
}

export function listCampaigns(bizId: string) {
  return q.all<Row>("SELECT id, name, status, subject, subject_b, ab_pct, mode, segment_id, scheduled_at, sent_at, parent_id, summary, created_at, updated_at FROM email_campaign WHERE biz_id = ? ORDER BY created_at DESC LIMIT 200", bizId)
    .map((c) => ({ ...c, stats: campaignStats(bizId, c.id).total }));
}

/** email.tick: chiến dịch đến giờ + bản gửi lại cho người chưa mở. */
export async function campaignTick(bizId: string, now = new Date()) {
  let sent = 0;
  if (!inSendWindow(bizId, now)) return 0; // giờ yên lặng: chiến dịch chờ đến đầu khung giờ gửi
  for (const c of q.all<Row>("SELECT id FROM email_campaign WHERE biz_id = ? AND status IN ('scheduled','sending') AND (scheduled_at IS NULL OR scheduled_at <= ?) ORDER BY scheduled_at LIMIT 5", bizId, now.toISOString())) {
    try { sent += (await runCampaign(bizId, c.id)).sent; } catch (e) { logger.warn("email.campaign_failed", { campaignId: c.id, error: String(e).slice(0, 300) }); }
  }
  // F-026: gửi lại 1 lần cho người chưa mở sau N giờ (cần webhook để biết ai đã mở → chỉ khi có khoá ký webhook).
  if (emailSendConfig(bizId)?.webhookSecret) {
    for (const c of q.all<Row>("SELECT * FROM email_campaign WHERE biz_id = ? AND status = 'sent' AND parent_id IS NULL AND resend_after_hours IS NOT NULL AND resent_at IS NULL", bizId)) {
      if (!c.sent_at || Date.parse(c.sent_at) + c.resend_after_hours * 3600_000 > now.getTime()) continue;
      update("email_campaign", c.id, { resent_at: nowIso() });
      insert("email_campaign", {
        biz_id: bizId, name: `${c.name} — gửi lại người chưa mở`, segment_id: c.segment_id, subject: c.resend_subject || `Nhắc lại: ${c.subject}`, preheader: c.preheader,
        mode: c.mode, body: c.body, data: c.data, status: "scheduled", scheduled_at: nowIso(), parent_id: c.id, summary: {}, created_by: "email",
      });
    }
  }
  return sent;
}
