import { audit, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { AppError, nowIso, sha256 } from "@dotaka/shared";

/**
 * Sổ liên hệ email (email_contact). Email thô CHỈ nằm ở bảng này; mọi chỗ khác (thư đã gửi, loại trừ, opt-out, log)
 * dùng email_hash hoặc bản che. consent: opt_in (đồng ý nhận marketing) | unknown (khách tự để lại email: chat, đơn)
 * | transactional (chỉ nhận thư giao dịch — chiến dịch/chuỗi bỏ qua).
 */
export type Consent = "opt_in" | "unknown" | "transactional";
export type ContactSource = "manual" | "import" | "chat" | "order" | "nurture" | "form" | "api";

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
export const normEmail = (s: string) => String(s ?? "").trim().toLowerCase();
export const isEmail = (s: string) => EMAIL_RE.test(normEmail(s)) && normEmail(s).length <= 254;
export const emailHash = (s: string) => sha256(`email:${normEmail(s)}`);
/** ng***@gmail.com — hiển thị / log, không để lộ địa chỉ thật. */
export function maskEmail(s: string): string {
  const [u, d] = normEmail(s).split("@");
  if (!d) return "***";
  return `${u.slice(0, Math.min(2, u.length))}***@${d}`;
}
/** Địa chỉ email khách gõ trong tin nhắn (bỏ ảnh/link tệp kiểu name@2x.png). */
export function extractEmails(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? "").matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    const e = normEmail(m[0]).replace(/\.+$/, "");
    if (isEmail(e) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(e)) out.add(e);
  }
  return [...out];
}

export type ContactInput = {
  email: string; name?: string | null; source?: ContactSource; consent?: Consent; conversationId?: string | null; leadId?: string | null;
  tags?: string[]; purchased?: boolean; data?: Record<string, unknown>;
};

/** Thêm hoặc cập nhật 1 liên hệ theo email (không hạ consent: opt_in giữ nguyên dù nguồn mới là chat). */
export function upsertContact(bizId: string, input: ContactInput, actor = "system"): { contact: Row; created: boolean } {
  if (!isEmail(input.email)) throw new AppError("BAD_EMAIL", `Email không hợp lệ: ${String(input.email).slice(0, 80)}`);
  const email = normEmail(input.email);
  const hash = emailHash(email);
  const ex = q.get<Row>("SELECT * FROM email_contact WHERE biz_id = ? AND email_hash = ?", bizId, hash);
  const tags = [...new Set([...(ex?.tags ?? []), ...(input.tags ?? []).map((t) => String(t).trim()).filter(Boolean)])].slice(0, 50);
  if (ex) {
    const consent = ex.consent === "opt_in" ? "opt_in" : input.consent && input.consent !== "unknown" ? input.consent : ex.consent;
    const patch: Row = {
      tags, consent,
      ...(input.name && !ex.name ? { name: String(input.name).slice(0, 120) } : {}),
      ...(input.conversationId && !ex.conversation_id ? { conversation_id: input.conversationId } : {}),
      ...(input.leadId && !ex.lead_id ? { lead_id: input.leadId } : {}),
      ...(input.purchased ? { purchased: 1 } : {}),
      ...(input.data ? { data: { ...(ex.data ?? {}), ...input.data } } : {}),
    };
    update("email_contact", ex.id, patch);
    const added = tags.filter((t) => !(ex.tags ?? []).includes(t));
    if (added.length) emit(bizId, "email.contact_tagged", { contactId: ex.id, tags: added });
    return { contact: byId<Row>("email_contact", ex.id)!, created: false };
  }
  const c = insert("email_contact", {
    biz_id: bizId, email, email_hash: hash, name: input.name ? String(input.name).slice(0, 120) : null, status: "active",
    consent: input.consent ?? "unknown", source: input.source ?? "manual", conversation_id: input.conversationId ?? null, lead_id: input.leadId ?? null,
    purchased: input.purchased ? 1 : 0, tags, data: input.data ?? {},
  });
  audit(bizId, actor, "email.contact_added", { type: "email_contact", id: c.id }, { email: maskEmail(email), source: c.source });
  emit(bizId, "email.contact_created", { contactId: c.id, source: c.source, tags });
  return { contact: c, created: true };
}

export function contactOf(bizId: string, id: string): Row {
  const c = byId<Row>("email_contact", id);
  if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy liên hệ", 404);
  return c;
}

/** Liên hệ cho giao diện (có email thật — chỉ phục vụ người vận hành trên máy này, không đưa vào LLM). */
export function listContacts(bizId: string, opts: { search?: string; status?: string; tag?: string; limit?: number; offset?: number } = {}) {
  const where = ["biz_id = ?"];
  const params: unknown[] = [bizId];
  if (opts.search?.trim()) { where.push("(email LIKE ? OR name LIKE ?)"); params.push(`%${opts.search.trim()}%`, `%${opts.search.trim()}%`); }
  if (opts.status) { where.push("status = ?"); params.push(opts.status); }
  if (opts.tag) { where.push("EXISTS (SELECT 1 FROM json_each(email_contact.tags) WHERE value = ?)"); params.push(opts.tag); }
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const rows = q.all<Row>(`SELECT * FROM email_contact WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, limit, Math.max(0, opts.offset ?? 0));
  const total = q.scalar<number>(`SELECT COUNT(*) FROM email_contact WHERE ${where.join(" AND ")}`, ...params) ?? 0;
  const tags = q.all<Row>("SELECT value AS tag, COUNT(*) AS n FROM email_contact, json_each(email_contact.tags) WHERE biz_id = ? GROUP BY value ORDER BY n DESC LIMIT 100", bizId);
  return { contacts: rows, total, tags };
}

export function updateContact(bizId: string, id: string, patch: { name?: string | null; tags?: string[]; consent?: Consent }, actor: string) {
  const c = contactOf(bizId, id);
  const p: Row = {};
  if (patch.name !== undefined) p.name = patch.name ? String(patch.name).slice(0, 120) : null;
  if (patch.tags) p.tags = [...new Set(patch.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 50);
  if (patch.consent && ["opt_in", "unknown", "transactional"].includes(patch.consent)) p.consent = patch.consent;
  update("email_contact", c.id, p);
  const added = (p.tags ?? []).filter((t: string) => !(c.tags ?? []).includes(t));
  if (added.length) emit(bizId, "email.contact_tagged", { contactId: c.id, tags: added });
  audit(bizId, actor, "email.contact_updated", { type: "email_contact", id: c.id }, { fields: Object.keys(p) });
  return byId<Row>("email_contact", c.id)!;
}

/** Xoá hẳn liên hệ (yêu cầu xoá dữ liệu): giữ email_hash trong loại trừ nếu khách đã hủy/bounce để không gửi lại khi nhập lại. */
export function deleteContact(bizId: string, id: string, actor: string) {
  const c = contactOf(bizId, id);
  q.run("UPDATE email_enrollment SET status = 'stopped', stop_reason = 'contact_deleted', updated_at = ? WHERE contact_id = ? AND status = 'active'", nowIso(), c.id);
  q.run("DELETE FROM email_contact WHERE id = ?", c.id);
  audit(bizId, actor, "email.contact_deleted", { type: "email_contact", id: c.id }, { email: maskEmail(c.email) });
  return { ok: true };
}

/** Một dòng CSV có ngoặc kép (dấu phẩy / chấm phẩy). */
function csvRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", inq = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inq) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inq = false; else cur += ch;
    } else if (ch === '"') inq = true;
    else if (ch === sep) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Nhập CSV (cột email bắt buộc; name/ten/ho_ten, tags/the tuỳ chọn) hoặc mỗi dòng 1 email. Bắt buộc chọn consent:
 * danh sách mua/thu thập không rõ nguồn → chọn "transactional" (chiến dịch sẽ bỏ qua) để giữ uy tín domain.
 */
export function importContacts(bizId: string, text: string, opts: { consent: Consent; tags?: string[]; source?: ContactSource }, actor: string) {
  if (!["opt_in", "unknown", "transactional"].includes(opts.consent)) throw new AppError("INVALID", "Chọn nguồn đồng ý nhận thư (consent)");
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > 50_000) throw new AppError("TOO_LARGE", "Tối đa 50.000 dòng mỗi lần nhập");
  const sep = (lines[0]?.match(/;/g)?.length ?? 0) > (lines[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = csvRow(lines[0] ?? "", sep).map((h) => h.toLowerCase());
  const hasHeader = head.some((h) => ["email", "e-mail", "mail"].includes(h));
  const iEmail = hasHeader ? head.findIndex((h) => ["email", "e-mail", "mail"].includes(h)) : -1;
  const iName = head.findIndex((h) => ["name", "ten", "tên", "ho_ten", "họ tên", "ho ten", "full name"].includes(h));
  const iTags = head.findIndex((h) => ["tags", "tag", "the", "thẻ"].includes(h));
  let added = 0, updated = 0;
  const invalid: string[] = [];
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cols = csvRow(line, sep);
    const email = hasHeader ? cols[iEmail] : cols.find((c) => isEmail(c)) ?? cols[0];
    if (!email || !isEmail(email)) { if (invalid.length < 20) invalid.push(String(email ?? line).slice(0, 60)); continue; }
    const rowTags = iTags >= 0 && cols[iTags] ? cols[iTags].split(/[|,;]/).map((t) => t.trim()).filter(Boolean) : [];
    const r = upsertContact(bizId, { email, name: iName >= 0 ? cols[iName] : null, consent: opts.consent, source: opts.source ?? "import", tags: [...(opts.tags ?? []), ...rowTags] }, actor);
    if (r.created) added++; else updated++;
  }
  audit(bizId, actor, "email.contacts_imported", undefined, { added, updated, invalid: invalid.length, consent: opts.consent });
  return { added, updated, invalid: invalid.length, invalidSamples: invalid };
}
