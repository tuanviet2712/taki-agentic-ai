import { createHash } from "node:crypto";
import { audit, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { AppError, decryptSecret, maskPhone, normalizeVnPhone, nowIso } from "@dotaka/shared";

/**
 * Danh sách "khách không nhận tin" (opt-out) — bảng contact_optout.
 *
 * Khách nhắn kiểu "đừng nhắn nữa", "hủy đăng ký", "spam quá"… → ghi vào danh sách (kèm mọi danh tính liên quan:
 * hội thoại, id người bình luận Facebook, SĐT dạng băm). Từ đó MỌI lượt gửi TỰ ĐỘNG đều kiểm danh sách:
 * trả lời/inbox/nhắc của "Chăm khách từ bình luận", lời mời kết bạn Zalo, bot trả lời, follow-up (Messenger + Zalo).
 * Nhân viên vẫn được trả lời tay (trang Hội thoại hiện cảnh báo).
 */

// ---------------- Nhận diện câu từ chối nhận tin (thận trọng) ----------------
/** Chữ thường, bỏ dấu tiếng Việt, bỏ dấu câu → so khớp theo từ. "dùng"/"dụng" (≠ "đừng") đổi thành từ riêng trước khi bỏ dấu. */
const lower = (s: string) => String(s ?? "").normalize("NFC").toLowerCase();
const plain = (s: string) => ` ${lower(s).replace(/d[ùụ]ng/g, "xdungx").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Cụm rõ ràng (đứng đâu trong câu cũng là từ chối). Lưu ý: bỏ dấu thì "nhắn" và "nhận" đều thành "nhan". */
const STRONG: RegExp[] = [
  // "đừng nhắn nữa", "thôi đừng gửi tin nữa", "khỏi nhắn cho tôi nữa", "ngừng nhắn tin thêm"
  / (dung|khoi|thoi|ngung|ngung han|xin dung|lam on dung|dung co) (nhan|gui|inbox|ib|spam|lam phien)( tin| tin nhan| nhan tin)?( cho (toi|tui|tao|minh|em|anh|chi|chau|co|chu))? (nua|them)/,
  / (dung|xin dung|lam on dung|dung co) (lam phien|spam)( toi| tui| tao| minh| em)? /,
  / (dung|ngung|thoi) (nhan|gui) tin (nhan )?(cho|toi) (toi|tui|tao) /,
  / (khong|ko|k|hong) muon (nhan|nghe|doc) (them )?(tin|tin nhan|quang cao|thong bao|khuyen mai)/,
  / (khong|ko|k|hong) (nhan|gui) (tin )?(quang cao|khuyen mai) (nua|them)/,
  / huy (dang ky|theo doi) (nhan )?(tin|tin nhan|thong bao)/,
  / (unsubscribe|unsub) /,
  / (spam|lam phien) (qua|vay|the|ghe|thi|hoai|mai)( |$)/,
  / (bao cao|report) (spam|page|trang|shop)/,
  / (nhan|gui|spam|ib|inbox) (nua|tiep|lan nua) (la|thi) (toi |tao |tui |minh )?(se )?(block|bao cao|report) /,
];
/** "Chặn" phải xét CÓ DẤU (bỏ dấu thì trùng "chán", "chân"). */
const BLOCK_THREAT = /(^|[\s,.!])(sẽ|tôi|tao|tui|mình|là|thì)\s+(chặn|block)(\s|$|[,.!])|(^|[\s,.!])(chặn|block)\s+(luôn|page|trang|shop)(\s|$|[,.!])/;
/** Toàn bộ tin chỉ là lệnh ngắn: "STOP", "hủy đăng ký", "đừng nhắn". */
const WHOLE: RegExp[] = [
  /^ (stop|dung lai|huy|huy dang ky|unsubscribe)( nhan| gui| tin| nhan tin| sms| spam| nha| nhe| a)? $/,
];
/** Cụm yếu hơn: chỉ tính khi KHÔNG phải câu hỏi ("sao shop không nhắn nữa vậy?"). */
const WEAK: RegExp[] = [
  // "không nhắn nữa", "ko nhận tin nữa" (nhưng "không nhắn được" thì không)
  / (khong|ko|k|hong) (nhan|gui)( tin| tin nhan)? nua( dau| nhe| nha| a)? $/,
  // kết câu bằng "…, đừng gửi" / "thôi đừng nhắn"
  / (dung|khoi|thoi) (nhan|gui|ib|inbox)( tin| tin nhan)?( nhe| nha| a| nua)? $/,
  // "không quan tâm nữa, đừng gửi …"
  / khong quan tam( nua)?( dau)? (dung|khoi|thoi) (nhan|gui|ib|inbox)/,
];
/** Câu hỏi: có "?" hoặc kết bằng tiểu từ hỏi (xét CÓ DẤU: "à" là hỏi, "ạ" là lễ phép). */
const QUESTION = /(\?|(^|\s)(à|hả|ha|sao|vậy|vay|chưa|không|ko|hông|ư|nhỉ|thế|ak|ah)\s*[.!…]*\s*$)/;
const SHOP_SUBJECT = / (shop|ben|page|trang|sao|ma|cung|chua|ad|admin) (khong|ko|k|hong) (nhan|gui)/;

/** Tin của khách có phải lời từ chối nhận tin không? Thận trọng: nghi ngờ thì KHÔNG (để nhân viên/AI xét). */
export function detectOptOut(text: string): boolean {
  const raw = String(text ?? "");
  if (!raw.trim() || raw.length > 400) return false;
  const t = plain(raw);
  if (WHOLE.some((r) => r.test(t))) return true;
  if (STRONG.some((r) => r.test(t)) || BLOCK_THREAT.test(lower(raw))) return true;
  const isQuestion = QUESTION.test(lower(raw).trim());
  if (isQuestion || SHOP_SUBJECT.test(t)) return false;
  return WEAK.some((r) => r.test(t));
}

// ---------------- Danh sách ----------------
/** SĐT → mã băm (không lưu số thật trong danh sách). */
export function phoneHash(phone: string | null | undefined): string | null {
  const p = normalizeVnPhone(phone ?? "");
  return p ? createHash("sha256").update(`optout:${p}`).digest("hex") : null;
}
export type OptOutKey = { channel: string; externalId: string | null | undefined };

/** Có trong danh sách không (theo bất kỳ danh tính nào: kênh + mã, hoặc SĐT). */
export function findOptOut(bizId: string, keys: OptOutKey[], phones: (string | null | undefined)[] = []): Row | undefined {
  for (const k of keys) {
    if (!k.externalId) continue;
    const r = q.get<Row>("SELECT * FROM contact_optout WHERE biz_id = ? AND channel = ? AND external_id = ?", bizId, k.channel, String(k.externalId));
    if (r) return r;
  }
  for (const p of phones) {
    const h = phoneHash(p);
    if (!h) continue;
    const r = q.get<Row>("SELECT * FROM contact_optout WHERE biz_id = ? AND phone_hash = ? LIMIT 1", bizId, h);
    if (r) return r;
  }
  return undefined;
}

/** Danh tính của 1 hội thoại: chính nó + người bình luận Facebook / PSID của lead chăm khách + SĐT đã biết. */
function identitiesOf(conv: Row): { keys: OptOutKey[]; phones: string[]; lead?: Row } {
  const keys: OptOutKey[] = [{ channel: conv.channel, externalId: conv.external_id }];
  const phones: string[] = [];
  const lead = q.get<Row>("SELECT * FROM nurture_lead WHERE biz_id = ? AND (conversation_id = ? OR zalo_conversation_id = ?) ORDER BY created_at DESC LIMIT 1", conv.biz_id, conv.id, conv.id);
  if (lead) {
    keys.push({ channel: "facebook", externalId: lead.author_external_id }, { channel: "messenger", externalId: lead.psid });
    if (lead.phone_cipher) { try { phones.push(decryptSecret(lead.phone_cipher)); } catch { /* khoá đổi → bỏ qua */ } }
  }
  const salesLead = q.get<Row>("SELECT phone FROM lead WHERE conversation_id = ? AND phone IS NOT NULL", conv.id);
  if (salesLead?.phone) phones.push(String(salesLead.phone));
  if (conv.ext?.phone) phones.push(String(conv.ext.phone));
  return { keys, phones, lead };
}

/** Hội thoại này thuộc khách đã báo không nhận tin? (đọc lại từ DB nếu chỉ có id) */
export function conversationOptedOut(convOrId: Row | string): Row | undefined {
  const conv = typeof convOrId === "string" ? byId<Row>("conversation", convOrId) : convOrId;
  if (!conv) return undefined;
  const { keys, phones } = identitiesOf(conv);
  return findOptOut(conv.biz_id, keys, phones);
}

function addRow(bizId: string, row: { channel: string; externalId: string; phone?: string | null; name?: string | null; reason?: string | null; source: string; conversationId?: string | null; by?: string }) {
  const existing = q.get<Row>("SELECT * FROM contact_optout WHERE biz_id = ? AND channel = ? AND external_id = ?", bizId, row.channel, row.externalId);
  if (existing) return existing;
  return insert("contact_optout", {
    biz_id: bizId, channel: row.channel, external_id: row.externalId, phone_hash: phoneHash(row.phone), phone_masked: row.phone ? maskPhone(row.phone) : null,
    name: row.name ? String(row.name).slice(0, 120) : null, reason: row.reason ? String(row.reason).slice(0, 300) : null, source: row.source,
    conversation_id: row.conversationId ?? null, created_by: row.by ?? null,
  });
}

/** Ngừng mọi việc tự động đang chờ của 1 hội thoại (follow-up, mục duyệt follow-up) + đánh dấu lead chăm khách đã dừng. */
function stopAutomation(bizId: string, conv: Row, why: string) {
  q.run("UPDATE follow_up_plan SET status = 'stopped' WHERE conversation_id = ? AND status IN ('active','awaiting_approval')", conv.id);
  q.run("UPDATE approval SET status = 'expired' WHERE subject_type = 'follow_up' AND status = 'pending' AND subject_id IN (SELECT id FROM follow_up_plan WHERE conversation_id = ?)", conv.id);
  for (const l of q.all<Row>("SELECT * FROM nurture_lead WHERE biz_id = ? AND (conversation_id = ? OR zalo_conversation_id = ?) AND stage NOT IN ('stopped','ordered','skipped','failed')", bizId, conv.id, conv.id)) {
    update("nurture_lead", l.id, { stage: "stopped", next_check_at: null, log: [...((l.log as Row[]) ?? []), { at: nowIso(), event: "opted_out", text: why }].slice(-60) });
  }
}

/**
 * Ghi khách của hội thoại vào danh sách không nhận tin (mọi danh tính liên quan) + dừng tự động.
 * Không đổi trạng thái hội thoại ở đây (chat-engine tự chuyển opted_out theo máy trạng thái).
 */
export function recordConversationOptOut(bizId: string, conv: Row, opts: { reason?: string; source: string; by?: string }) {
  const { keys, phones, lead } = identitiesOf(conv);
  const phone = phones.map((p) => normalizeVnPhone(p)).find(Boolean) ?? null;
  const base = { name: conv.customer_name, reason: opts.reason ?? null, source: opts.source, conversationId: conv.id, by: opts.by, phone };
  const first = addRow(bizId, { ...base, channel: conv.channel, externalId: String(conv.external_id) });
  for (const k of keys.slice(1)) if (k.externalId) addRow(bizId, { ...base, channel: k.channel, externalId: String(k.externalId) });
  if (phone) addRow(bizId, { ...base, channel: "phone", externalId: phoneHash(phone)! });
  stopAutomation(bizId, conv, "Khách báo không muốn nhận tin — dừng mọi tin tự động");
  audit(bizId, opts.by ?? "chat_engine", "optout.added", { type: "conversation", id: conv.id }, { source: opts.source, phone: phone ? maskPhone(phone) : null, lead: lead?.id ?? null });
  emit(bizId, "optout.added", { conversationId: conv.id });
  return first;
}

/** Sếp thêm tay theo SĐT (và/hoặc 1 hội thoại / lead chăm khách). */
export function addOptOutManual(bizId: string, input: { phone?: string | null; name?: string | null; reason?: string | null; conversationId?: string | null; leadId?: string | null }, by: string) {
  const out: Row[] = [];
  const convIds = new Set<string>();
  if (input.conversationId) convIds.add(input.conversationId);
  if (input.leadId) {
    const l = byId<Row>("nurture_lead", input.leadId);
    if (l && l.biz_id === bizId) {
      if (l.conversation_id) convIds.add(l.conversation_id);
      if (l.zalo_conversation_id) convIds.add(l.zalo_conversation_id);
      // Gộp các dòng của cùng 1 khách: theo hội thoại inbox (hoặc mã lead khi chưa có hội thoại).
      const group = l.conversation_id ?? `lead:${l.id}`;
      if (l.author_external_id) out.push(addRow(bizId, { channel: "facebook", externalId: String(l.author_external_id), name: input.name ?? l.author_name, reason: input.reason, source: "manual", by, conversationId: group }));
      if (l.phone_cipher) { try { const p = decryptSecret(l.phone_cipher); out.push(addRow(bizId, { channel: "phone", externalId: phoneHash(p)!, phone: p, name: input.name ?? l.author_name, reason: input.reason, source: "manual", by, conversationId: group })); } catch { /* bỏ qua */ } }
      update("nurture_lead", l.id, { stage: ["ordered"].includes(l.stage) ? l.stage : "stopped", next_check_at: null, log: [...((l.log as Row[]) ?? []), { at: nowIso(), event: "opted_out", text: `Thêm vào danh sách không nhận tin (${by})` }].slice(-60) });
    }
  }
  const phone = normalizeVnPhone(input.phone ?? "");
  if (input.phone && !phone) throw new AppError("BAD_PHONE", "SĐT không hợp lệ (di động Việt Nam 10 số, vd 0912 345 678)");
  if (phone) {
    out.push(addRow(bizId, { channel: "phone", externalId: phoneHash(phone)!, phone, name: input.name, reason: input.reason, source: "manual", by }));
    // Hội thoại đã biết SĐT này → cũng dừng tự động
    const h = phoneHash(phone);
    for (const l of q.all<Row>("SELECT conversation_id, phone FROM lead WHERE biz_id = ? AND phone IS NOT NULL", bizId)) if (phoneHash(l.phone) === h) convIds.add(l.conversation_id);
    for (const l of q.all<Row>("SELECT conversation_id, zalo_conversation_id, phone_cipher FROM nurture_lead WHERE biz_id = ? AND phone_cipher IS NOT NULL", bizId)) {
      try { if (phoneHash(decryptSecret(l.phone_cipher)) === h) { if (l.conversation_id) convIds.add(l.conversation_id); if (l.zalo_conversation_id) convIds.add(l.zalo_conversation_id); } } catch { /* bỏ qua */ }
    }
  }
  for (const id of convIds) {
    const conv = byId<Row>("conversation", id);
    if (!conv || conv.biz_id !== bizId) continue;
    out.push(recordConversationOptOut(bizId, conv, { reason: input.reason ?? undefined, source: "manual", by }));
    if (!["opted_out", "resolved"].includes(conv.state)) {
      update("conversation", conv.id, { state: "opted_out" });
      audit(bizId, by, "conversation.state", { type: "conversation", id: conv.id }, { from: conv.state, to: "opted_out" });
    }
  }
  if (!out.length) throw new AppError("EMPTY", "Cần SĐT (hoặc chọn 1 khách) để thêm vào danh sách");
  audit(bizId, by, "optout.manual_added", { type: "biz", id: bizId }, { phone: phone ? maskPhone(phone) : null, entries: out.length });
  return out[0];
}

/** Bỏ khỏi danh sách: xoá dòng này + các dòng cùng hội thoại/SĐT (cùng 1 khách). */
export function removeOptOut(bizId: string, id: string, by: string) {
  const r = q.get<Row>("SELECT * FROM contact_optout WHERE id = ? AND biz_id = ?", id, bizId);
  if (!r) return { removed: 0 };
  const rows = q.all<Row>(`SELECT * FROM contact_optout WHERE biz_id = ? AND (id = ? OR (conversation_id IS NOT NULL AND conversation_id = ?) OR (phone_hash IS NOT NULL AND phone_hash = ?))`,
    bizId, id, r.conversation_id ?? "", r.phone_hash ?? "");
  for (const x of rows) q.run("DELETE FROM contact_optout WHERE id = ?", x.id);
  // Hội thoại đang "khách từ chối" → chuyển cho nhân viên (máy trạng thái chỉ cho opted_out → human_active); nhân viên trả cho bot khi muốn.
  for (const cid of new Set(rows.map((x) => x.conversation_id).filter(Boolean))) {
    const conv = byId<Row>("conversation", cid);
    if (conv?.state === "opted_out") {
      update("conversation", conv.id, { state: "human_active" });
      audit(bizId, by, "conversation.state", { type: "conversation", id: conv.id }, { from: "opted_out", to: "human_active" });
    }
  }
  audit(bizId, by, "optout.removed", { type: "contact_optout", id }, { entries: rows.length, phone: r.phone_masked ?? null });
  emit(bizId, "optout.removed", { id });
  return { removed: rows.length };
}

/** Danh sách cho giao diện — gộp theo khách (hội thoại / SĐT), không bao giờ trả SĐT thật. */
export function listOptOuts(bizId: string, search?: string) {
  const s = String(search ?? "").trim();
  const h = s ? phoneHash(s) : null;
  const rows = q.all<Row>(`SELECT id, channel, external_id, phone_masked, name, reason, source, conversation_id, created_by, created_at FROM contact_optout
    WHERE biz_id = ? ${s ? "AND (name LIKE ? OR phone_masked LIKE ? OR reason LIKE ? OR phone_hash = ?)" : ""} ORDER BY created_at DESC LIMIT 500`,
  bizId, ...(s ? [`%${s}%`, `%${s}%`, `%${s}%`, h ?? "-"] : []));
  const groups = new Map<string, Row>();
  for (const r of rows) {
    const key = r.conversation_id ?? (r.channel === "phone" ? `p:${r.external_id}` : `${r.channel}:${r.external_id}`);
    const g = groups.get(key);
    if (!g) groups.set(key, { ...r, channels: [r.channel] });
    else {
      if (!g.channels.includes(r.channel)) g.channels.push(r.channel);
      g.phone_masked = g.phone_masked ?? r.phone_masked;
      g.name = g.name ?? r.name;
    }
  }
  return [...groups.values()].map(({ external_id: _e, ...g }) => g);
}
