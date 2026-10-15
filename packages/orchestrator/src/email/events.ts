import { audit, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { kiemSvix, readUnsubToken } from "@dotaka/email";
import { logger, nowIso } from "@dotaka/shared";
import { maskEmail } from "./contacts.ts";
import { emailSendConfig, setSendState, unsubSecret } from "./settings.ts";

/**
 * Sự kiện quay về của email (chép luật auto-funnel F-028 / F-139):
 *  - webhook Resend (svix): delivered / opened / clicked / bounced / complained → cập nhật thư; bounce cứng + khiếu nại → loại trừ;
 *    ≥50 thư trong ngày mà bounce > 3% hoặc complaint > 0,1% → NGẮT gửi (mở lại thủ công).
 *  - quét uy tín 24h: bounce > 2,1% hoặc complaint > 0,07% → GIẢM TỐC 50%; hạ nhiệt (≤1,5% / ≤0,05%) → tự mở lại.
 *  - hủy nhận một chạm (link footer + header List-Unsubscribe), click link đo /r/<mã>.
 */
const RANK: Record<string, number> = { queued: 0, failed: 0, skipped: 0, sent: 1, delivered: 2, opened: 3, clicked: 4, bounced: 5, complained: 6 };
const STATUS_OF: Record<string, string> = {
  "email.delivered": "delivered", "email.opened": "opened", "email.clicked": "clicked", "email.bounced": "bounced", "email.complained": "complained",
};

export type WebhookResult = { status: number; body: Record<string, unknown> };

/** POST /hooks/email/resend — thân RAW (để kiểm chữ ký). Sai chữ ký hoặc chưa có khoá ký → 401, không ghi gì. */
export function handleResendWebhook(raw: string, headers: Record<string, string | string[] | undefined>, now = Date.now()): WebhookResult {
  const h = (k: string) => { const v = headers[k]; return Array.isArray(v) ? v[0] : v; };
  let body: { type?: string; created_at?: string; data?: { email_id?: string; bounce?: { type?: string; message?: string } } };
  try { body = JSON.parse(raw); } catch { return { status: 400, body: { ok: false } }; }
  const providerId = body.data?.email_id;
  if (!providerId) return { status: 200, body: { ok: true, ignored: "no email_id" } };
  const msg = q.get<Row>("SELECT * FROM email_message WHERE provider_id = ?", providerId);
  if (!msg) return { status: 200, body: { ok: true, ignored: "unknown email" } };
  const secret = emailSendConfig(msg.biz_id)?.webhookSecret;
  if (!secret) return { status: 401, body: { ok: false, error: "webhook secret not configured" } };
  const sig = kiemSvix({ thanRaw: raw, id: h("svix-id"), timestamp: h("svix-timestamp"), header: h("svix-signature"), secret, bayGioMs: now });
  if (!sig.dat) {
    logger.warn("email.webhook_bad_signature", { reason: sig.lyDo });
    return { status: 401, body: { ok: false } };
  }
  const dedupe = `resend:${h("svix-id")}`;
  if (q.get("SELECT id FROM raw_event WHERE dedupe_key = ?", dedupe)) return { status: 200, body: { ok: true, duplicate: true } };
  insert("raw_event", { platform: "resend", received_at: nowIso(), signature_ok: 1, payload: { type: body.type, email_id: providerId }, processed_at: nowIso(), dedupe_key: dedupe });

  const type = body.type ?? "";
  let status = STATUS_OF[type];
  if (!status) return { status: 200, body: { ok: true, ignored: type } };
  // Bounce tạm (hộp thư đầy, máy chủ bận): không loại trừ, chỉ ghi lý do.
  const softBounce = status === "bounced" && /transient|temporary/i.test(String(body.data?.bounce?.type ?? ""));
  const at = body.created_at && !Number.isNaN(Date.parse(body.created_at)) ? new Date(body.created_at).toISOString() : nowIso();
  const patch: Row = {};
  if (status === "delivered") patch.delivered_at = msg.delivered_at ?? at;
  if (status === "opened") patch.opened_at = msg.opened_at ?? at;
  if (status === "clicked") { patch.clicked_at = msg.clicked_at ?? at; patch.opened_at = msg.opened_at ?? at; }
  if (status === "bounced") { patch.bounced_at = at; patch.reason = `${softBounce ? "soft" : "hard"} bounce: ${String(body.data?.bounce?.message ?? "").slice(0, 200)}`; }
  if (softBounce) status = msg.status;
  if ((RANK[status] ?? 0) > (RANK[msg.status] ?? 0)) patch.status = status;
  update("email_message", msg.id, patch);

  const contact = msg.contact_id ? byId<Row>("email_contact", msg.contact_id) : undefined;
  if (contact && status === "opened") update("email_contact", contact.id, { last_open_at: at });
  if (contact && status === "clicked") update("email_contact", contact.id, { last_click_at: at, last_open_at: contact.last_open_at ?? at });
  if (!softBounce && (status === "bounced" || status === "complained")) {
    suppress(msg.biz_id, msg.to_hash, msg.to_masked, status === "bounced" ? "hard_bounce" : "complaint");
    if (contact) {
      update("email_contact", contact.id, { status: status === "bounced" ? "bounced" : "complained" });
      q.run("UPDATE email_enrollment SET status = 'stopped', stop_reason = ?, updated_at = ? WHERE contact_id = ? AND status = 'active'", status, nowIso(), contact.id);
    }
    dailyKillCheck(msg.biz_id);
  }
  emit(msg.biz_id, `email.${status}`, { messageId: msg.id, contactId: msg.contact_id });
  return { status: 200, body: { ok: true } };
}

export function suppress(bizId: string, hash: string, masked: string | null, reason: string) {
  if (q.get("SELECT id FROM email_suppression WHERE biz_id = ? AND email_hash = ?", bizId, hash)) return;
  insert("email_suppression", { biz_id: bizId, email_hash: hash, email_masked: masked, reason });
}

/** Ngưỡng NGÀY (≥50 thư): bounce > 3% hoặc complaint > 0,1% → ngắt gửi, ghi lý do, báo Sếp. */
export function dailyKillCheck(bizId: string, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const r = q.get<Row>(`SELECT COUNT(*) AS sent, SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounce, SUM(CASE WHEN status = 'complained' THEN 1 ELSE 0 END) AS complaint
    FROM email_message WHERE biz_id = ? AND sent_at >= ? AND transactional = 0 AND COALESCE(json_extract(meta, '$.test'), 0) = 0`, bizId, since)!;
  const sent = Number(r.sent ?? 0), bounce = Number(r.bounce ?? 0), complaint = Number(r.complaint ?? 0);
  if (sent < 50) return false;
  if (bounce / sent > 0.03 || complaint / sent > 0.001) {
    const reason = `Vượt ngưỡng 24h: bounce ${bounce}/${sent}, khiếu nại ${complaint}/${sent} — kiểm tra danh sách rồi bấm «Mở lại gửi».`;
    setSendState(bizId, "stopped", reason);
    audit(bizId, "email", "email.sending_stopped", undefined, { sent, bounce, complaint });
    emit(bizId, "alert.raised", { level: "error", text: `Email: đã NGẮT gửi tự động — ${reason}` });
    return true;
  }
  return false;
}

/** Cron uy tín (F-139): giảm tốc khi chớm ngưỡng, tự mở lại khi hạ nhiệt. */
export function reputationScan(bizId: string, now = new Date()) {
  const s = emailSendConfig(bizId);
  if (!s || s.state === "stopped") return { state: s?.state ?? null };
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const r = q.get<Row>(`SELECT COUNT(*) AS sent, SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounce, SUM(CASE WHEN status = 'complained' THEN 1 ELSE 0 END) AS complaint
    FROM email_message WHERE biz_id = ? AND sent_at >= ? AND COALESCE(json_extract(meta, '$.test'), 0) = 0`, bizId, since)!;
  const sent = Number(r.sent ?? 0);
  if (sent < 50) return { state: s.state, sent };
  const b = Number(r.bounce ?? 0) / sent, c = Number(r.complaint ?? 0) / sent;
  if (s.state !== "throttled" && (b > 0.021 || c > 0.0007)) {
    const reason = `Bounce ${(b * 100).toFixed(2)}% / khiếu nại ${(c * 100).toFixed(3)}% trong 24h chớm ngưỡng — giảm tốc 50% để bảo vệ uy tín gửi.`;
    setSendState(bizId, "throttled", reason);
    emit(bizId, "alert.raised", { level: "warn", text: `Email: ${reason}` });
    return { state: "throttled", sent };
  }
  if (s.state === "throttled" && b <= 0.015 && c <= 0.0005) { setSendState(bizId, "active", null); return { state: "active", sent }; }
  return { state: s.state, sent };
}

export function reopenSending(bizId: string, actor: string) {
  setSendState(bizId, "active", null);
  audit(bizId, actor, "email.sending_reopened");
  return { ok: true };
}

/** Hủy nhận (GET trang / POST một chạm). Trả tên doanh nghiệp để trang xác nhận hiển thị; null = token hỏng. */
export function unsubscribeByToken(token: string, source: "link" | "one_click" = "link"): { ok: boolean; brand?: string } {
  const t = readUnsubToken(token, unsubSecret());
  if (!t) return { ok: false };
  const c = byId<Row>("email_contact", t.contactId);
  const brand = q.get<Row>("SELECT name FROM biz WHERE id = ?", t.bizId)?.name ?? "";
  if (!c || c.biz_id !== t.bizId) return { ok: true, brand }; // liên hệ đã xoá: coi như đã hủy
  if (c.status !== "unsubscribed") {
    update("email_contact", c.id, { status: c.status === "active" ? "unsubscribed" : c.status });
    if (!q.get("SELECT id FROM contact_optout WHERE biz_id = ? AND channel = 'email' AND external_id = ?", c.biz_id, c.email_hash)) {
      insert("contact_optout", { biz_id: c.biz_id, channel: "email", external_id: c.email_hash, name: c.name ?? maskEmail(c.email), reason: "Hủy nhận email", source: `email_${source}`, conversation_id: c.conversation_id ?? null, created_by: "khách" });
    }
    q.run("UPDATE email_enrollment SET status = 'stopped', stop_reason = 'unsubscribed', updated_at = ? WHERE contact_id = ? AND status = 'active'", nowIso(), c.id);
    audit(c.biz_id, "khách", "email.unsubscribed", { type: "email_contact", id: c.id }, { email: maskEmail(c.email), via: source });
    emit(c.biz_id, "email.unsubscribed", { contactId: c.id });
  }
  return { ok: true, brand };
}

/** Click qua /r/<mã> của thư: đánh dấu thư + liên hệ (gọi từ tracking.recordClick). */
export function onEmailLinkClick(link: Row, counted: boolean) {
  const mid = link.meta?.emailMessageId;
  if (!mid || !counted) return;
  const m = byId<Row>("email_message", mid);
  if (!m) return;
  const at = nowIso();
  update("email_message", m.id, { clicked_at: m.clicked_at ?? at, opened_at: m.opened_at ?? at, ...((RANK.clicked > (RANK[m.status] ?? 0)) ? { status: "clicked" } : {}) });
  if (m.contact_id) update("email_contact", m.contact_id, { last_click_at: at });
  emit(m.biz_id, "email.clicked", { messageId: m.id, contactId: m.contact_id });
}
