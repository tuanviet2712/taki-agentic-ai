import { audit, byId, insert, q, update, type Row } from "@dotaka/db";
import { AppError, nowIso } from "@dotaka/shared";

/**
 * Phân khúc động (rút gọn từ auto-funnel core/phan-khuc.ts, theo dữ liệu Agentic AI có): nhóm điều kiện AND/OR.
 * Trường: thẻ, nguồn, consent, đã mua, có hội thoại, hạng lead (A/B/C của hội thoại), mở / click / tạo trong N ngày.
 * Liên hệ không "active" (đã hủy / bounce / khiếu nại) KHÔNG BAO GIỜ khớp.
 */
export type Rule =
  | { field: "tag"; op: "has" | "not"; value: string }
  | { field: "source" | "consent"; op: "=" | "!="; value: string }
  | { field: "purchased" | "has_conversation"; op: "is"; value: boolean }
  | { field: "lead_grade"; op: "in"; value: string[] }
  | { field: "opened_within" | "clicked_within" | "created_within" | "not_opened_within"; op: "days"; value: number };
export type SegmentDef = { match: "all" | "any"; rules: Rule[] };

export function validateSegment(def: SegmentDef): string[] {
  const err: string[] = [];
  if (!def || !Array.isArray(def.rules)) return ["Phân khúc không hợp lệ"];
  if (!["all", "any"].includes(def.match)) err.push("match phải là all hoặc any");
  if (def.rules.length > 20) err.push("Tối đa 20 điều kiện");
  for (const r of def.rules) {
    if (!["tag", "source", "consent", "purchased", "has_conversation", "lead_grade", "opened_within", "clicked_within", "created_within", "not_opened_within"].includes((r as Rule).field)) err.push(`Trường lạ: ${(r as Rule).field}`);
    if (r.field === "tag" && !String(r.value ?? "").trim()) err.push("Điều kiện thẻ cần tên thẻ");
    if (r.op === "days" && !(Number(r.value) > 0 && Number(r.value) <= 3650)) err.push("Số ngày từ 1 đến 3650");
  }
  return err;
}

const daysAgo = (iso: string | null | undefined, now: number) => (iso ? (now - Date.parse(iso)) / 86_400_000 : Infinity);

export function matches(c: Row, def: SegmentDef, extra: { grade?: string | null } = {}, now = Date.now()): boolean {
  if (c.status !== "active") return false;
  if (!def?.rules?.length) return true; // phân khúc rỗng = mọi liên hệ đang nhận
  const one = (r: Rule): boolean => {
    switch (r.field) {
      case "tag": return ((c.tags as string[]) ?? []).includes(r.value) === (r.op === "has");
      case "source": case "consent": return (String(c[r.field]) === String(r.value)) === (r.op === "=");
      case "purchased": return Boolean(c.purchased) === Boolean(r.value);
      case "has_conversation": return Boolean(c.conversation_id) === Boolean(r.value);
      case "lead_grade": return Boolean(extra.grade && r.value.includes(extra.grade));
      case "opened_within": return daysAgo(c.last_open_at, now) <= r.value;
      case "not_opened_within": return !(daysAgo(c.last_open_at, now) <= r.value);
      case "clicked_within": return daysAgo(c.last_click_at, now) <= r.value;
      case "created_within": return daysAgo(c.created_at, now) <= r.value;
      default: return false;
    }
  };
  return def.match === "any" ? def.rules.some(one) : def.rules.every(one);
}

/** Người nhận của phân khúc (null = mọi liên hệ đang nhận). Không gồm consent "transactional" (chỉ thư giao dịch). */
export function segmentMembers(bizId: string, segmentId: string | null): Row[] {
  const def: SegmentDef = segmentId ? (segmentOf(bizId, segmentId).definition as SegmentDef) : { match: "all", rules: [] };
  const grades = new Map(q.all<Row>("SELECT id, lead_grade FROM conversation WHERE biz_id = ?", bizId).map((r) => [r.id, r.lead_grade]));
  return q.all<Row>("SELECT * FROM email_contact WHERE biz_id = ? AND status = 'active' AND consent != 'transactional' ORDER BY created_at", bizId)
    .filter((c) => matches(c, def, { grade: c.conversation_id ? grades.get(c.conversation_id) : null }));
}

export function segmentOf(bizId: string, id: string): Row {
  const s = byId<Row>("email_segment", id);
  if (!s || s.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy phân khúc", 404);
  return s;
}

export function saveSegment(bizId: string, input: { id?: string; name: string; definition: SegmentDef }, actor: string): Row {
  const err = validateSegment(input.definition);
  if (err.length) throw new AppError("INVALID", err.join("; "));
  if (!String(input.name ?? "").trim()) throw new AppError("INVALID", "Đặt tên phân khúc");
  const row = input.id
    ? (segmentOf(bizId, input.id), update("email_segment", input.id, { name: input.name.trim().slice(0, 120), definition: input.definition }), byId<Row>("email_segment", input.id)!)
    : insert("email_segment", { biz_id: bizId, name: input.name.trim().slice(0, 120), definition: input.definition, member_count: 0 });
  const n = segmentMembers(bizId, row.id).length;
  update("email_segment", row.id, { member_count: n, computed_at: nowIso() });
  audit(bizId, actor, "email.segment_saved", { type: "email_segment", id: row.id }, { members: n });
  return { ...row, member_count: n };
}

export function listSegments(bizId: string) {
  return q.all<Row>("SELECT * FROM email_segment WHERE biz_id = ? ORDER BY created_at DESC", bizId).map((s) => ({ ...s, member_count: segmentMembers(bizId, s.id).length }));
}
export function deleteSegment(bizId: string, id: string, actor: string) {
  segmentOf(bizId, id);
  if (q.get("SELECT id FROM email_campaign WHERE segment_id = ? AND status IN ('awaiting_approval','scheduled','sending')", id)) throw new AppError("IN_USE", "Phân khúc đang được chiến dịch dùng", 409);
  q.run("DELETE FROM email_segment WHERE id = ?", id);
  audit(bizId, actor, "email.segment_deleted", { type: "email_segment", id });
  return { ok: true };
}
