import { audit, bus, byId, insert, q, update, type Row } from "@dotaka/db";
import { logger, nowIso } from "@dotaka/shared";
import { setEmailClickHook } from "../tracking.ts";
import { extractEmails, upsertContact } from "./contacts.ts";
import { onEmailLinkClick } from "./events.ts";
import { fireTrigger, markGoalPurchase } from "./sequences.ts";

/**
 * Nối kênh email với phần còn lại của Agentic AI qua bus sự kiện (không sửa luồng chat / đơn):
 *  - Khách gõ email trong chat (Messenger / Zalo / website, kể cả hội thoại từ Chăm khách bình luận) → liên hệ email gắn hội thoại.
 *  - Liên hệ mới / gắn thẻ → trigger chuỗi email đang chạy.
 *  - Có đơn → liên hệ "đã mua", dừng chuỗi mục tiêu mua hàng, quy doanh thu về email đã click gần nhất (7 ngày), trigger chuỗi sau mua.
 *  - Click link email (/r/<mã>) → đánh dấu thư + liên hệ.
 */
let registered = false;
export function registerEmailHooks() {
  if (registered) return;
  registered = true;
  setEmailClickHook(onEmailLinkClick);
  bus.on("conversation.message_in", (e: { bizId: string; conversationId: string }) => safe("message_in", () => captureFromConversation(e.bizId, e.conversationId)));
  bus.on("email.contact_created", (e: { bizId: string; contactId: string; source?: string; tags?: string[] }) => safe("contact_created", () => {
    fireTrigger(e.bizId, { type: "contact_created", contactId: e.contactId, source: e.source });
    if (e.tags?.length) fireTrigger(e.bizId, { type: "tag_added", contactId: e.contactId, tags: e.tags });
  }));
  bus.on("email.contact_tagged", (e: { bizId: string; contactId: string; tags: string[] }) => safe("contact_tagged", () => fireTrigger(e.bizId, { type: "tag_added", contactId: e.contactId, tags: e.tags })));
  bus.on("order.created", (e: { bizId: string; orderId: string }) => safe("order_created", () => onOrderCreated(e.bizId, e.orderId)));
}
function safe(what: string, fn: () => unknown) {
  try { fn(); } catch (e) { logger.warn("email.hook_failed", { hook: what, error: String(e).slice(0, 300) }); }
}

/** Email trong tin khách mới nhất của hội thoại → liên hệ (consent "unknown": khách tự để lại; vẫn có link hủy ở mọi thư). */
export function captureFromConversation(bizId: string, conversationId: string): Row[] {
  const conv = byId<Row>("conversation", conversationId);
  if (!conv || conv.biz_id !== bizId) return [];
  const m = q.get<Row>("SELECT body FROM message WHERE conversation_id = ? AND direction = 'in' ORDER BY sent_at DESC LIMIT 1", conversationId);
  const text = typeof m?.body === "object" ? String(m.body?.text ?? "") : String(m?.body ?? "");
  const out: Row[] = [];
  for (const email of extractEmails(text).slice(0, 3)) {
    const lead = q.get<Row>("SELECT id FROM lead WHERE conversation_id = ?", conversationId);
    const { contact, created } = upsertContact(bizId, { email, name: conv.customer_name ?? null, source: "chat", consent: "unknown", conversationId, leadId: lead?.id ?? null, tags: [`kenh:${conv.channel}`] }, "chat");
    if (created) audit(bizId, "chat", "email.captured_from_chat", { type: "conversation", id: conversationId }, { contactId: contact.id });
    out.push(contact);
  }
  return out;
}

export function onOrderCreated(bizId: string, orderId: string) {
  const o = byId<Row>("orders", orderId);
  if (!o || o.biz_id !== bizId) return;
  let contact = o.conversation_id ? q.get<Row>("SELECT * FROM email_contact WHERE biz_id = ? AND conversation_id = ? ORDER BY created_at LIMIT 1", bizId, o.conversation_id) : undefined;
  const formEmail = o.meta?.email ? String(o.meta.email) : null;
  if (formEmail) contact = upsertContact(bizId, { email: formEmail, name: o.customer_name, source: "order", consent: "unknown", conversationId: o.conversation_id ?? null, purchased: true, tags: ["da-mua"] }, "order").contact;
  if (!contact) return;
  update("email_contact", contact.id, { purchased: 1, tags: [...new Set([...(contact.tags ?? []), "da-mua"])] });
  markGoalPurchase(contact.id);
  // Quy doanh thu last-touch về email được click (hoặc mở) gần nhất trong 7 ngày trước đơn.
  const since = new Date(Date.parse(o.created_at) - 7 * 86_400_000).toISOString();
  const touch = q.get<Row>(`SELECT id, source_kind, source_id FROM email_message WHERE contact_id = ? AND (clicked_at >= ? OR opened_at >= ?) AND created_at <= ?
    ORDER BY COALESCE(clicked_at, opened_at) DESC LIMIT 1`, contact.id, since, since, o.created_at);
  if (touch && Number(o.total) > 0) {
    q.run("UPDATE email_message SET revenue = revenue + ?, updated_at = ? WHERE id = ?", Number(o.total), nowIso(), touch.id);
    if (o.conversation_id && !q.get("SELECT id FROM attribution_link WHERE conversation_id = ? AND source = 'email'", o.conversation_id)) {
      insert("attribution_link", { biz_id: bizId, conversation_id: o.conversation_id, source: "email", method: "email_last_touch", confidence: 0.7 });
    }
    audit(bizId, "email", "email.revenue_attributed", { type: "orders", id: o.id }, { messageId: touch.id, total: o.total, source: `${touch.source_kind}:${touch.source_id ?? ""}` });
  }
  fireTrigger(bizId, { type: "order_created", contactId: contact.id, productKey: o.product_key ?? null });
}
