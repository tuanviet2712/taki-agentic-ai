import { audit, byId, insert, q, update, type Row } from "@dotaka/db";
import { MAU_EMAIL_KEO_THA, MAU_EMAIL_KHOI, MAU_EMAIL_LE, NHOM_EMAIL_LE, NHOM_MAU_KHOI } from "@dotaka/email";
import { AppError } from "@dotaka/shared";
import type { Mode } from "./campaigns.ts";

/**
 * Mẫu email: mẫu hệ thống chép từ auto-funnel (10 mẫu khối maily.to, 10 mẫu kéo thả, 40 email lẻ văn bản) + mẫu riêng của
 * doanh nghiệp. Mẫu hệ thống nạp 1 lần / doanh nghiệp (theo code), không sửa / xoá được — "Nhân bản" để chỉnh.
 */
export const TEMPLATE_GROUPS = [...NHOM_MAU_KHOI.map((g) => ({ key: g.ma, name: g.ten })), ...NHOM_EMAIL_LE.filter((g) => !NHOM_MAU_KHOI.some((x) => x.ma === g.ma)).map((g) => ({ key: g.ma, name: g.ten }))];

export function ensureSystemTemplates(bizId: string): number {
  let n = 0;
  const has = new Set(q.all<Row>("SELECT code FROM email_template WHERE biz_id = ? AND system = 1", bizId).map((r) => r.code));
  const add = (code: string, row: Row) => { if (has.has(code)) return; insert("email_template", { biz_id: bizId, code, system: 1, ...row }); n++; };
  for (const m of MAU_EMAIL_KHOI) add(`khoi:${m.ma}`, { name: m.ten, grp: m.nhom, subject: m.tieuDe, preheader: m.preheader, mode: "blocks", body: "", data: m.noiDungKhoi });
  for (const m of MAU_EMAIL_KEO_THA) add(`keotha:${m.ma}`, { name: m.ten, grp: m.nhom, subject: m.tieuDe, preheader: m.preheader, mode: "dnd", body: "", data: m.noiDungKeoTha });
  for (const m of MAU_EMAIL_LE) add(`le:${m.ma}`, { name: m.ten, grp: m.nhom, subject: m.tieuDe, preheader: m.preheader, mode: "text", body: m.noiDung, data: {} });
  return n;
}

export function listTemplates(bizId: string, mode?: string) {
  ensureSystemTemplates(bizId);
  return {
    groups: TEMPLATE_GROUPS,
    templates: q.all<Row>(`SELECT * FROM email_template WHERE biz_id = ? ${mode ? "AND mode = ?" : ""} ORDER BY system, updated_at DESC`, ...(mode ? [bizId, mode] : [bizId])),
  };
}

export function templateOf(bizId: string, id: string): Row {
  const t = byId<Row>("email_template", id);
  if (!t || t.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy mẫu", 404);
  return t;
}

export function saveTemplate(bizId: string, input: { id?: string; name: string; grp?: string; subject: string; preheader?: string | null; mode: Mode; body?: string; data?: unknown }, actor: string) {
  if (!String(input.name ?? "").trim()) throw new AppError("INVALID", "Đặt tên mẫu");
  if (!["text", "blocks", "dnd"].includes(input.mode)) throw new AppError("INVALID", "Chế độ soạn không hợp lệ");
  const row = { name: input.name.trim().slice(0, 160), grp: input.grp || "khac", subject: String(input.subject ?? "").slice(0, 200), preheader: input.preheader ?? null, mode: input.mode, body: String(input.body ?? ""), data: input.data ?? {} };
  if (input.id) {
    const t = templateOf(bizId, input.id);
    if (t.system) throw new AppError("SYSTEM_TEMPLATE", "Mẫu hệ thống không sửa được — bấm Nhân bản", 409);
    update("email_template", t.id, row);
    audit(bizId, actor, "email.template_saved", { type: "email_template", id: t.id });
    return byId<Row>("email_template", t.id)!;
  }
  const t = insert("email_template", { biz_id: bizId, system: 0, code: null, ...row });
  audit(bizId, actor, "email.template_saved", { type: "email_template", id: t.id });
  return t;
}

export function duplicateTemplate(bizId: string, id: string, actor: string) {
  const t = templateOf(bizId, id);
  return saveTemplate(bizId, { name: `${t.name} (bản sao)`, grp: t.grp, subject: t.subject, preheader: t.preheader, mode: t.mode, body: t.body, data: t.data }, actor);
}

export function deleteTemplate(bizId: string, id: string, actor: string) {
  const t = templateOf(bizId, id);
  if (t.system) throw new AppError("SYSTEM_TEMPLATE", "Mẫu hệ thống không xoá được", 409);
  q.run("DELETE FROM email_template WHERE id = ?", t.id);
  audit(bizId, actor, "email.template_deleted", { type: "email_template", id: t.id });
  return { ok: true };
}
