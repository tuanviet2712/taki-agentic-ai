import { audit, byId, bizSettings, isKilled, q, update, type Row } from "@dotaka/db";
import { datGioTai, gioGuiHopLe, type KhungGio } from "@dotaka/email";
import { AppError, legacyDevKey, sha256 } from "@dotaka/shared";
import { credsOf } from "../connections.ts";
import { publicBaseUrl, publicGatewayState, trackingBase } from "../tracking.ts";

/**
 * Cài đặt gửi email của doanh nghiệp = kết nối Resend đang hoạt động (connection.platform = "resend").
 * Trạng thái gửi (giống cai_dat_email bên auto-funnel) nằm trong connection.config:
 *   send_state: active | throttled (giảm tốc 50% khi chỉ số uy tín chớm ngưỡng) | stopped (ngắt, mở lại thủ công)
 *   daily_limit: hạn mức warm-up/ngày. Số đã gửi hôm nay ĐẾM từ email_message (không giữ bộ đếm riêng → không lệch).
 */
export type SendState = "active" | "throttled" | "stopped";

export function emailConnection(bizId: string): Row | undefined {
  return q.get<Row>("SELECT * FROM connection WHERE biz_id = ? AND platform = 'resend' AND status != 'revoked' ORDER BY (mode = 'live') DESC, updated_at DESC LIMIT 1", bizId);
}

/** Đầu ngày hôm nay theo múi giờ doanh nghiệp (UTC ISO) — mốc đếm hạn mức. */
export function dayStartIso(bizId: string, now = new Date()): string {
  const tz = q.get<Row>("SELECT timezone FROM biz WHERE id = ?", bizId)?.timezone ?? "Asia/Ho_Chi_Minh";
  return datGioTai(now, 0, tz, 0).toISOString();
}
export function bizTimezone(bizId: string): string {
  return q.get<Row>("SELECT timezone FROM biz WHERE id = ?", bizId)?.timezone ?? "Asia/Ho_Chi_Minh";
}

export function sentToday(bizId: string, now = new Date()): number {
  return q.scalar<number>("SELECT COUNT(*) FROM email_message WHERE biz_id = ? AND sent_at >= ? AND status NOT IN ('skipped','failed','queued')", bizId, dayStartIso(bizId, now)) ?? 0;
}

/** Khoá HMAC cho token hủy nhận: dẫn xuất từ TOKEN_ENCRYPTION_KEY (cùng khoá mã hoá token), không lưu riêng. */
export function unsubSecret(): string {
  const base = process.env.TOKEN_ENCRYPTION_KEY?.trim() || legacyDevKey().toString("hex");
  return sha256(`email-unsub:${base}`);
}

export function emailSendConfig(bizId: string) {
  const c = emailConnection(bizId);
  if (!c) return null;
  const cfg = (c.config ?? {}) as Row;
  const cr = credsOf(c);
  return {
    conn: c, live: c.mode === "live" && c.status !== "revoked", apiKey: cr.api_key as string | undefined, webhookSecret: cr.webhook_secret as string | undefined,
    cloudflareToken: cr.cloudflare_token as string | undefined,
    fromName: String(cfg.from_name || q.get<Row>("SELECT name FROM biz WHERE id = ?", bizId)?.name || "TAKI"), fromAddress: String(cfg.from_address ?? ""),
    replyTo: cfg.reply_to ? String(cfg.reply_to) : undefined, domain: String(cfg.domain ?? ""), domainStatus: String(cfg.domain_status ?? "unknown"),
    dailyLimit: Math.max(1, Number(cfg.daily_limit) || 50), state: (cfg.send_state ?? "active") as SendState, stateReason: (cfg.send_state_reason ?? null) as string | null,
    dns: cfg.dns ?? null,
  };
}

/** Tình trạng cho trang Email (không có khoá bí mật nào). */
export function emailStatus(bizId: string, now = new Date()) {
  const s = emailSendConfig(bizId);
  const pub = publicGatewayState();
  const base = publicBaseUrl();
  const track = trackingBase();
  const killed = isKilled(bizId, "email");
  const checklist = [
    { key: "connected", ok: Boolean(s), label: "Kết nối Resend", hint: s ? `${s.fromName} <${s.fromAddress}>` : "Kết nối → Email (Resend) → dán API key + địa chỉ gửi" },
    { key: "live", ok: Boolean(s?.live), label: "Kết nối thật (không mô phỏng)", hint: s && !s.live ? "Kết nối đang ở chế độ mô phỏng — thư không được gửi" : "" },
    { key: "domain", ok: s?.domainStatus === "verified", label: "Domain gửi đã xác minh trên Resend", hint: s ? `${s.domain || "?"}: ${s.domainStatus}` : "" },
    { key: "public", ok: Boolean(track), label: "Địa chỉ công khai ổn định (link hủy nhận, click, webhook)", hint: track ? track : "Đặt PUBLIC_PORT + PUBLIC_BASE_URL (https, tên miền cố định) rồi khởi động lại" },
    { key: "webhook", ok: Boolean(s?.webhookSecret), label: "Webhook Resend (giao / mở / bounce / khiếu nại)", hint: s?.webhookSecret ? "Đã có khoá ký" : "Trang Email → Thiết lập tự động, hoặc dán Signing secret vào kết nối" },
  ];
  return {
    connected: Boolean(s), live: Boolean(s?.live), connectionId: s?.conn.id ?? null,
    fromName: s?.fromName ?? null, fromAddress: s?.fromAddress ?? null, replyTo: s?.replyTo ?? null, domain: s?.domain ?? null, domainStatus: s?.domainStatus ?? null,
    dailyLimit: s?.dailyLimit ?? 0, sentToday: s ? sentToday(bizId, now) : 0, state: s?.state ?? "active", stateReason: s?.stateReason ?? null,
    killSwitch: killed, dns: s?.dns ?? null, publicBaseUrl: base ?? null, publicListening: pub.listening, trackingBase: track ?? null,
    webhookUrl: base ? `${base}/hooks/email/resend` : null, hasWebhookSecret: Boolean(s?.webhookSecret), hasCloudflareToken: Boolean(s?.cloudflareToken),
    quietHours: bizSettings(bizId).quietHours, checklist, ready: checklist.every((c) => c.ok) && !killed,
  };
}

/** Lưu thay đổi cấu hình gửi (hạn mức, tên/địa chỉ trả lời) vào kết nối. */
export function setEmailConfig(bizId: string, patch: { dailyLimit?: number; fromName?: string; replyTo?: string | null }, actor: string) {
  const s = emailSendConfig(bizId);
  if (!s) throw new AppError("EMAIL_NOT_CONNECTED", "Chưa kết nối Email (Resend)", 400);
  const cfg: Row = { ...(s.conn.config ?? {}) };
  if (patch.dailyLimit !== undefined) {
    const n = Math.floor(Number(patch.dailyLimit));
    if (!(n >= 1 && n <= 100_000)) throw new AppError("INVALID", "Hạn mức/ngày từ 1 đến 100.000");
    cfg.daily_limit = String(n);
  }
  if (patch.fromName !== undefined && String(patch.fromName).trim()) cfg.from_name = String(patch.fromName).trim().slice(0, 80);
  if (patch.replyTo !== undefined) cfg.reply_to = patch.replyTo ? String(patch.replyTo).trim() : "";
  update("connection", s.conn.id, { config: cfg });
  audit(bizId, actor, "email.config_updated", { type: "connection", id: s.conn.id }, { dailyLimit: cfg.daily_limit, fromName: cfg.from_name });
  return emailStatus(bizId);
}

export function setSendState(bizId: string, state: SendState, reason: string | null) {
  const c = emailConnection(bizId);
  if (!c) return;
  const fresh = byId<Row>("connection", c.id)!;
  update("connection", c.id, { config: { ...(fresh.config ?? {}), send_state: state, send_state_reason: reason } });
}

/** Khung giờ gửi thư marketing = ngoài giờ yên lặng của doanh nghiệp (mặc định 7h–22h), theo múi giờ doanh nghiệp. */
export function sendWindow(bizId: string): KhungGio {
  const [start, end] = bizSettings(bizId).quietHours ?? [22, 7];
  return start > end ? { tu: end, den: start } : { tu: 8, den: 21 };
}
export function inSendWindow(bizId: string, now = new Date()): boolean {
  return gioGuiHopLe(now, sendWindow(bizId), bizTimezone(bizId)).getTime() === now.getTime();
}
/** Mốc gửi hợp lệ gần nhất từ `at` (dồn sang đầu khung nếu rơi vào giờ yên lặng). */
export function nextSendTime(bizId: string, at: Date): Date {
  return gioGuiHopLe(at, sendWindow(bizId), bizTimezone(bizId));
}
