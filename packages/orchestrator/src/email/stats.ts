import { audit, q, type Row } from "@dotaka/db";
import { AppError } from "@dotaka/shared";
import { emailHash, isEmail, maskEmail } from "./contacts.ts";
import { suppress } from "./events.ts";

/** Chất lượng gửi (trang Email → Chất lượng gửi): tỉ lệ giao / mở / click / bounce / khiếu nại theo 24h và 7 ngày. */
export function deliverability(bizId: string, now = new Date()) {
  const win = (hours: number) => {
    const since = new Date(now.getTime() - hours * 3600_000).toISOString();
    const r = q.get<Row>(`SELECT
        SUM(CASE WHEN status NOT IN ('skipped','failed','queued') THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN delivered_at IS NOT NULL OR status IN ('delivered','opened','clicked') THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced, SUM(CASE WHEN status = 'complained' THEN 1 ELSE 0 END) AS complained,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, SUM(revenue) AS revenue
      FROM email_message WHERE biz_id = ? AND created_at >= ? AND COALESCE(json_extract(meta, '$.test'), 0) = 0`, bizId, since) ?? {};
    const n = (k: string) => Number(r[k] ?? 0);
    const sent = n("sent");
    const pct = (k: string) => (sent ? Math.round((n(k) / sent) * 10000) / 100 : 0);
    return { sent, delivered: n("delivered"), opened: n("opened"), clicked: n("clicked"), bounced: n("bounced"), complained: n("complained"), skipped: n("skipped"), failed: n("failed"), revenue: n("revenue"),
      rates: { delivered: pct("delivered"), opened: pct("opened"), clicked: pct("clicked"), bounced: pct("bounced"), complained: pct("complained") } };
  };
  return {
    day: win(24), week: win(24 * 7),
    thresholds: { throttleBounce: 2.1, throttleComplaint: 0.07, stopBounce: 3, stopComplaint: 0.1 },
    contacts: q.get<Row>(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed,
      SUM(CASE WHEN status IN ('bounced','complained') THEN 1 ELSE 0 END) AS suppressed FROM email_contact WHERE biz_id = ?`, bizId) ?? {},
    suppression: q.all<Row>("SELECT id, email_masked, reason, created_at FROM email_suppression WHERE biz_id = ? ORDER BY created_at DESC LIMIT 200", bizId),
  };
}

/** Nhật ký thư (không có email thô: chỉ bản che). */
export function recentMessages(bizId: string, opts: { contactId?: string; status?: string; sourceKind?: string; sourceId?: string; limit?: number } = {}) {
  const where = ["biz_id = ?"];
  const p: unknown[] = [bizId];
  if (opts.contactId) { where.push("contact_id = ?"); p.push(opts.contactId); }
  if (opts.status) { where.push("status = ?"); p.push(opts.status); }
  if (opts.sourceKind) { where.push("source_kind = ?"); p.push(opts.sourceKind); }
  if (opts.sourceId) { where.push("source_id = ?"); p.push(opts.sourceId); }
  return q.all<Row>(`SELECT id, contact_id, to_masked, subject, source_kind, source_id, step, status, reason, transactional, sent_at, delivered_at, opened_at, clicked_at, revenue, created_at
    FROM email_message WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`, ...p, Math.min(500, opts.limit ?? 100));
}

export function addSuppressionManual(bizId: string, email: string, actor: string) {
  if (!isEmail(email)) throw new AppError("BAD_EMAIL", "Email không hợp lệ");
  suppress(bizId, emailHash(email), maskEmail(email), "manual");
  q.run("UPDATE email_enrollment SET status = 'stopped', stop_reason = 'suppressed' WHERE contact_id IN (SELECT id FROM email_contact WHERE biz_id = ? AND email_hash = ?) AND status = 'active'", bizId, emailHash(email));
  audit(bizId, actor, "email.suppressed_manual", undefined, { email: maskEmail(email) });
  return { ok: true };
}
export function removeSuppression(bizId: string, id: string, actor: string) {
  const r = q.get<Row>("SELECT * FROM email_suppression WHERE id = ? AND biz_id = ?", id, bizId);
  if (!r) throw new AppError("NOT_FOUND", "Không tìm thấy", 404);
  if (r.reason === "complaint") throw new AppError("COMPLAINT", "Địa chỉ đã khiếu nại spam — không gỡ được (bảo vệ uy tín domain)", 409);
  q.run("DELETE FROM email_suppression WHERE id = ?", id);
  q.run("UPDATE email_contact SET status = 'active' WHERE biz_id = ? AND email_hash = ? AND status = 'bounced'", bizId, r.email_hash);
  audit(bizId, actor, "email.suppression_removed", undefined, { email: r.email_masked });
  return { ok: true };
}
