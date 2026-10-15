import { audit, byId, emit, insert, isKilled, q, update, type Row } from "@dotaka/db";
import { live } from "@dotaka/connectors";
import { conversationOptedOut } from "@dotaka/chat-engine";
import {
  bocLinkDoClick, bocLinkHtml, headerHuyDangKy, laHtmlDayDu, makeUnsubToken, renderCaNhan, renderEmail, renderEmailKeoTha, renderEmailKhoi, themFooterBatBuoc,
  thayBien, trichUrl, trichUrlHtml, type KhoiJson, type TaiLieuKeoTha,
} from "@dotaka/email";
import { logger, nowIso } from "@dotaka/shared";
import { randomBytes } from "node:crypto";
import { appendUtm, trackingBase } from "../tracking.ts";
import { emailHash, maskEmail } from "./contacts.ts";
import { emailSendConfig, sentToday, unsubSecret } from "./settings.ts";

/**
 * CỔNG GỬI EMAIL DUY NHẤT (như guiEmailNgay của auto-funnel): chiến dịch, chuỗi, thư giao dịch, gửi thử… đều đi qua đây.
 * Thứ tự kiểm: chưa kết nối thật → khoá khẩn cấp → hủy nhận / opt-out đa kênh → loại trừ (bounce/khiếu nại) → trạng thái ngắt
 * → hạn mức warm-up (giảm tốc = 50%). Thư bị bỏ qua vẫn ghi email_message status "skipped" + lý do.
 * Render: cá nhân hoá {{bien|dự phòng}} → bọc link đo click (mỗi thư mã riêng) → footer định danh + hủy nhận (không xoá được)
 * → header List-Unsubscribe một chạm (RFC 8058). Real-or-nothing: không có kết nối Resend thật thì KHÔNG có thư nào "đã gửi".
 */
export type SourceKind = "campaign" | "sequence" | "test" | "transactional" | "agent";
export type EmailContent =
  | { mode: "text"; subject: string; body: string; preheader?: string | null }
  | { mode: "blocks"; subject: string; data: KhoiJson; preheader?: string | null }
  | { mode: "dnd"; subject: string; data: TaiLieuKeoTha; preheader?: string | null }
  /** HTML đầy đủ đã render sẵn (dùng lại cho mọi người nhận của 1 chiến dịch). */
  | { mode: "html"; subject: string; html: string; preheader?: string | null };

export type SendRequest = {
  bizId: string;
  contactId: string;
  content: EmailContent;
  source: { kind: SourceKind; id?: string | null; step?: number | null };
  vars?: Record<string, string | null | undefined>;
  /** Thư giao dịch (xác nhận đơn…): bỏ qua hủy nhận marketing + consent; vẫn chặn khi khách dừng mọi kênh / bị loại trừ / ngắt. */
  transactional?: boolean;
  /** Gửi thử tới chính người vận hành: không cần địa chỉ công khai (link hủy là link mẫu). */
  test?: boolean;
};
export type SendResult = { status: "sent" | "skipped" | "failed"; messageId: string; reason?: string };

export const SKIP_REASONS: Record<string, string> = {
  not_connected: "Chưa kết nối Email (Resend)",
  sandbox: "Kết nối Email đang ở chế độ mô phỏng — không gửi thư thật",
  kill_switch: "Đang bật khoá khẩn cấp Email",
  unsubscribed: "Khách đã hủy nhận email",
  opt_out: "Khách đã yêu cầu ngừng nhận tin (đa kênh)",
  consent: "Liên hệ chỉ nhận thư giao dịch",
  suppressed: "Địa chỉ trong danh sách loại trừ (bounce / khiếu nại)",
  stopped: "Gửi email đang bị NGẮT do uy tín",
  daily_limit: "Đã đủ hạn mức gửi hôm nay",
  throttled: "Đang giảm tốc 50% do chỉ số uy tín",
  no_public_url: "Chưa có địa chỉ công khai ổn định — thư marketing bắt buộc có link hủy nhận hoạt động",
  missing_var: "Thiếu biến không có giá trị dự phòng",
  bad_content: "Nội dung email không hợp lệ",
};

/** Render nội dung (khối / kéo thả) ra HTML 1 lần — biến giữ nguyên để cá nhân hoá từng người lúc gửi. */
export async function renderContent(c: EmailContent, fromName: string, opts: { vars?: Record<string, string | null | undefined>; unsubUrl?: string } = {}): Promise<{ subject: string; preheader: string | null; html?: string; text?: string }> {
  const pre = c.preheader ?? null;
  if (c.mode === "blocks") return { subject: c.subject, preheader: pre, html: await renderEmailKhoi(c.data, { tenGui: fromName, preheader: pre, bien: opts.vars, linkHuyNhan: opts.unsubUrl }) };
  if (c.mode === "dnd") return { subject: c.subject, preheader: pre, html: await renderEmailKeoTha(c.data, { tenGui: fromName, preheader: pre, bien: opts.vars, linkHuyNhan: opts.unsubUrl }) };
  if (c.mode === "html") return { subject: c.subject, preheader: pre, html: c.html };
  return { subject: c.subject, preheader: pre, text: c.body };
}

function newCode(): string {
  const A = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (;;) {
    s = Array.from(randomBytes(8), (x) => A[x % A.length]).join("");
    if (!q.get("SELECT id FROM track_link WHERE code = ?", s)) return s;
  }
}

/** Dùng chung: email_message bỏ qua (có lý do). */
function skipped(bizId: string, contact: Row | undefined, req: SendRequest, subject: string, reason: string): SendResult {
  const m = insert("email_message", {
    biz_id: bizId, contact_id: contact?.id ?? req.contactId, to_hash: contact ? contact.email_hash : "?", to_masked: contact ? maskEmail(contact.email) : "?",
    subject: subject.slice(0, 300), source_kind: req.source.kind, source_id: req.source.id ?? null, step: req.source.step ?? null, status: "skipped", reason,
    transactional: req.transactional ? 1 : 0, meta: {},
  });
  return { status: "skipped", messageId: m.id, reason };
}

/** Khách đã chặn email này chưa: hủy nhận (marketing) / opt-out đa kênh (mọi thư) / loại trừ cứng. */
export function blockReason(bizId: string, contact: Row, transactional: boolean): string | null {
  const optEmail = q.get<Row>("SELECT source FROM contact_optout WHERE biz_id = ? AND channel = 'email' AND external_id = ?", bizId, contact.email_hash);
  // Khách nói "ngừng nhắn" trong chat (hội thoại gắn với liên hệ) = dừng MỌI kênh, kể cả thư giao dịch.
  if (contact.conversation_id && conversationOptedOut(contact.conversation_id)) return "opt_out";
  if (optEmail?.source === "all_channels") return "opt_out";
  if (!transactional && (contact.status === "unsubscribed" || optEmail)) return "unsubscribed";
  if (!transactional && contact.consent === "transactional") return "consent";
  if (contact.status === "bounced" || contact.status === "complained") return "suppressed";
  if (q.get("SELECT id FROM email_suppression WHERE biz_id = ? AND email_hash = ?", bizId, contact.email_hash)) return "suppressed";
  return null;
}

export async function sendEmail(req: SendRequest): Promise<SendResult> {
  const { bizId } = req;
  const contact = byId<Row>("email_contact", req.contactId);
  const subj0 = req.content.subject ?? "";
  if (!contact || contact.biz_id !== bizId) return skipped(bizId, undefined, req, subj0, "bad_content");
  const s = emailSendConfig(bizId);
  if (!s) return skipped(bizId, contact, req, subj0, "not_connected");
  if (!s.live || !s.apiKey) return skipped(bizId, contact, req, subj0, "sandbox");
  if (isKilled(bizId, "email")) return skipped(bizId, contact, req, subj0, "kill_switch");
  if (!req.test) {
    const block = blockReason(bizId, contact, Boolean(req.transactional));
    if (block) return skipped(bizId, contact, req, subj0, block);
  }
  if (s.state === "stopped") return skipped(bizId, contact, req, subj0, "stopped");
  const sent = sentToday(bizId);
  if (sent >= s.dailyLimit) return skipped(bizId, contact, req, subj0, "daily_limit");
  if (s.state === "throttled" && sent >= Math.max(1, Math.floor(s.dailyLimit / 2))) return skipped(bizId, contact, req, subj0, "throttled");

  // Link hủy nhận + link đo click cần địa chỉ công khai ỔN ĐỊNH. Thư marketing thiếu link hủy hoạt động → không gửi (Gmail/Yahoo bắt buộc).
  const base = trackingBase();
  if (!base && !req.transactional && !req.test) return skipped(bizId, contact, req, subj0, "no_public_url");
  const unsubUrl = base ? `${base}/u/${makeUnsubToken(bizId, contact.id, unsubSecret())}` : "#";

  const brand = q.get<Row>("SELECT name FROM biz WHERE id = ?", bizId)?.name ?? s.fromName;
  const vars: Record<string, string | null | undefined> = {
    ten_thuong_hieu: brand, email: contact.email, ho_ten: contact.name ?? undefined, ...(req.vars ?? {}), link_huy_nhan: unsubUrl,
  };
  if (!vars.ten) vars.ten = vars.ho_ten;
  const ctx = { daMua: Boolean(contact.purchased), the: (contact.tags as string[]) ?? [] };

  let r: { subject: string; preheader: string | null; html?: string; text?: string };
  try {
    r = await renderContent(req.content, s.fromName);
  } catch (e) {
    return skipped(bizId, contact, req, subj0, `bad_content: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
  }
  const subject = thayBien(renderCaNhan(r.subject, vars, ctx), vars).slice(0, 300);
  let body = thayBien(renderCaNhan(r.html ?? r.text ?? "", vars, ctx), vars);
  if (/\{\{\s*[a-z_][a-z0-9_]*\s*\}\}/i.test(subject)) return skipped(bizId, contact, req, subj0, "missing_var");

  const msg = insert("email_message", {
    biz_id: bizId, contact_id: contact.id, to_hash: contact.email_hash, to_masked: maskEmail(contact.email), subject, source_kind: req.source.kind,
    source_id: req.source.id ?? null, step: req.source.step ?? null, status: "queued", transactional: req.transactional ? 1 : 0, meta: { test: Boolean(req.test) },
  });

  // Bọc link đo click: mỗi URL → /r/<mã> gắn với thư + liên hệ (click quy về đúng người, đúng thư). Không có địa chỉ công khai → link gốc + UTM.
  const html = laHtmlDayDu(body);
  const map = new Map<string, string>();
  for (const url of html ? trichUrlHtml(body) : trichUrl(body)) {
    if (base && url.startsWith(`${base}/u/`)) continue; // link hủy nhận giữ nguyên
    const target = appendUtm(url, { channel: "email", campaign: req.source.kind === "campaign" || req.source.kind === "sequence" ? `${req.source.kind}-${String(req.source.id ?? "").slice(-6)}` : req.source.kind, content: msg.id.slice(-8) })
      .replace("utm_medium=social", "utm_medium=email");
    if (!base) { map.set(url, target); continue; }
    const code = newCode();
    insert("track_link", { biz_id: bizId, code, channel: "email", target_url: target, meta: { emailMessageId: msg.id, contactId: contact.id } });
    map.set(url, `${base}/r/${code}`);
  }
  body = html ? bocLinkHtml(body, (u) => map.get(u) ?? u) : bocLinkDoClick(body, (u) => map.get(u) ?? u);
  const finalHtml = html
    ? themFooterBatBuoc(body, { tenGui: s.fromName, linkHuyNhan: unsubUrl })
    : renderEmail({ tieuDe: subject, noiDung: body, preheader: r.preheader ? thayBien(renderCaNhan(r.preheader, vars, ctx), vars) : null, tenNguoiGui: s.fromName, linkHuy: unsubUrl });

  try {
    const res = await live.resendSend(s.apiKey, {
      from: `${s.fromName} <${s.fromAddress}>`, to: contact.email, subject, html: finalHtml, replyTo: s.replyTo,
      ...(base ? { headers: headerHuyDangKy(unsubUrl) } : {}),
      tags: [{ name: "source", value: req.source.kind }],
    }, `taki-email-${msg.id}`);
    const at = nowIso();
    update("email_message", msg.id, { status: "sent", provider_id: res.id, html: finalHtml, sent_at: at });
    update("email_contact", contact.id, { last_sent_at: at });
    emit(bizId, "email.sent", { messageId: msg.id, contactId: contact.id, source: req.source });
    return { status: "sent", messageId: msg.id };
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
    update("email_message", msg.id, { status: "failed", reason, html: finalHtml });
    logger.warn("email.send_failed", { messageId: msg.id, to: maskEmail(contact.email), reason });
    if (/AuthError|từ chối khoá/.test(reason)) audit(bizId, "email", "email.auth_failed", { type: "connection", id: s.conn.id }, { reason });
    return { status: "failed", messageId: msg.id, reason };
  }
}

/** Gửi thử tới 1 địa chỉ (của người vận hành) — tạo/dùng liên hệ consent opt_in tag "test". */
export async function sendTestEmail(bizId: string, to: string, content: EmailContent, actor: string, vars?: Record<string, string>): Promise<SendResult> {
  const { upsertContact } = await import("./contacts.ts");
  const { contact } = upsertContact(bizId, { email: to, consent: "opt_in", source: "manual", tags: ["test"] }, actor);
  const r = await sendEmail({ bizId, contactId: contact.id, content, source: { kind: "test" }, test: true, vars: { ho_ten: vars?.ho_ten ?? "Anh/Chị", ...(vars ?? {}) } });
  audit(bizId, actor, "email.test_sent", { type: "email_message", id: r.messageId }, { to: maskEmail(to), status: r.status, reason: r.reason });
  return r;
}

export function messageHtml(bizId: string, id: string): string | null {
  const m = byId<Row>("email_message", id);
  return m && m.biz_id === bizId ? m.html ?? null : null;
}
export { emailHash };
