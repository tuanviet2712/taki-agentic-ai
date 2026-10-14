import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { byId, q, update, type Row } from "@dotaka/db";
import { AppError, logger, uuidv7 } from "@dotaka/shared";
import { enqueue, type Handler } from "./queue.ts";

/**
 * Ảnh trong hội thoại (Messenger): link CDN Facebook hết hạn sau vài ngày → tải ảnh về máy để xem lại về sau.
 *  - Chỉ ẢNH (image/sticker), ≤ 8MB, đúng kiểu ảnh (content-type), chỉ từ máy chủ ảnh của Facebook (chống SSRF).
 *  - Lưu ở <DATA_DIR>/chat-media/<biz>/<tên tệp>; tên tệp ghi vào message.meta.attachments[i].stored.
 *  - Xem qua GET /v1/chat/media/:messageId/:index — theo doanh nghiệp, KHÔNG bao giờ nhận đường dẫn tuỳ ý.
 * Video/tệp/ghi âm: chỉ giữ link + loại (không tải về).
 */
export const CHAT_MEDIA_MAX = 8 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
export const chatImageExt = (mime: string) => IMAGE_MIME[mime.split(";")[0].trim().toLowerCase()];
/** Máy chủ ảnh Facebook/Messenger (fbcdn.net, fbsbx.com…). Ngoài danh sách → không tải. */
const ALLOWED_HOSTS = [/(^|\.)fbcdn\.net$/i, /(^|\.)fbsbx\.com$/i, /(^|\.)facebook\.com$/i, /(^|\.)cdninstagram\.com$/i];
export function isAllowedMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** Cùng thư mục dữ liệu với phần còn lại của hệ thống (DATA_DIR hoặc <thư mục chạy>/data). */
export const chatMediaDir = (bizId: string) => join(resolve(process.env.DATA_DIR ?? "data"), "chat-media", bizId.replace(/[^\w-]/g, "_"));
const SAFE_NAME = /^[\w-]+\.(jpg|png|gif|webp)$/;
const MIME_OF: Record<string, string> = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

/** Xếp job tải ảnh của 1 tin (nếu có ảnh chưa tải). Gọi được nhiều lần — khoá theo tin. */
export function queueChatMedia(bizId: string, messageId: string): string | null {
  const m = byId<Row>("message", messageId);
  const atts = (m?.meta?.attachments ?? []) as Row[];
  if (!m || !atts.some((a) => (a.type === "image" || a.type === "sticker") && a.url && !a.stored && !a.fetchError)) return null;
  return enqueue("chat", "chat.media", { bizId, messageId }, { bizId, idempotencyKey: `chat.media:${messageId}`, maxAttempts: 4 });
}
/** Sau khi tin khách đã lưu (webhook/đồng bộ → chat.ingest): tìm tin theo mã nền tảng rồi xếp job tải ảnh. */
export function queueChatMediaByExternal(bizId: string, channel: string, externalConversationId: string, externalMessageId?: string) {
  if (!externalMessageId) return null;
  const m = q.get<Row>(`SELECT m.id FROM message m JOIN conversation c ON c.id = m.conversation_id
    WHERE c.biz_id = ? AND c.channel = ? AND c.external_id = ? AND m.external_id = ?`, bizId, channel, externalConversationId, externalMessageId);
  return m ? queueChatMedia(bizId, m.id) : null;
}

/** Đọc thân phản hồi tối đa `max` byte; vượt → null. */
async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Tải các ảnh của 1 tin về máy. Lỗi vĩnh viễn (link hết hạn, sai kiểu, quá lớn) → ghi fetchError, không thử lại. */
export async function downloadChatMedia(bizId: string, messageId: string): Promise<{ saved: number; failed: number }> {
  const m = byId<Row>("message", messageId);
  if (!m || m.biz_id !== bizId) return { saved: 0, failed: 0 };
  const atts = [...((m.meta?.attachments ?? []) as Row[])];
  let saved = 0, failed = 0, transient: Error | null = null;
  for (let i = 0; i < atts.length; i++) {
    const a = atts[i];
    if ((a.type !== "image" && a.type !== "sticker") || !a.url || a.stored || a.fetchError) continue;
    const fail = (why: string) => { atts[i] = { ...a, fetchError: why }; failed++; };
    if (!isAllowedMediaUrl(String(a.url))) { fail("Link ảnh không thuộc Facebook — không tải"); continue; }
    let res: Response;
    try {
      res = await fetch(String(a.url), { redirect: "follow", signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      transient = e instanceof Error ? e : new Error(String(e));
      continue;
    }
    if (res.status === 429 || res.status >= 500) { transient = new Error(`Máy chủ ảnh lỗi ${res.status}`); continue; }
    if (!res.ok) { fail(`Link ảnh đã hết hạn (${res.status})`); continue; }
    const ext = chatImageExt(res.headers.get("content-type") ?? "");
    if (!ext) { fail("Không phải tệp ảnh"); continue; }
    if (Number(res.headers.get("content-length") ?? 0) > CHAT_MEDIA_MAX) { fail("Ảnh quá 8MB — không lưu"); continue; }
    const buf = await readCapped(res, CHAT_MEDIA_MAX).catch(() => null);
    if (!buf) { fail("Ảnh quá 8MB — không lưu"); continue; }
    const dir = chatMediaDir(bizId);
    mkdirSync(dir, { recursive: true });
    const name = `${messageId.replace(/[^\w-]/g, "")}-${i}.${ext}`;
    writeFileSync(join(dir, name), buf);
    atts[i] = { ...a, stored: name, mime: MIME_OF[ext], size: buf.length };
    saved++;
  }
  // Đọc lại meta ngay trước khi ghi (chỗ khác có thể vừa sửa), chỉ thay danh sách đính kèm.
  const fresh = byId<Row>("message", messageId);
  update("message", messageId, { meta: { ...(fresh?.meta ?? {}), attachments: atts } });
  if (transient && !saved) throw transient; // lỗi mạng tạm thời → hàng đợi thử lại (ảnh đã lưu được thì bỏ qua)
  return { saved, failed };
}

/** Nhận diện ảnh theo byte đầu tệp (không tin đuôi tệp / content-type do trình duyệt gửi). */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Lưu ảnh nhân viên sắp gửi vào kho ảnh chat (kiểm: đúng ảnh jpg/png/gif/webp theo byte, ≤ 8MB) → tên tệp an toàn. */
export function saveOutboundChatImage(bizId: string, data: Buffer): { name: string; path: string; mime: string; size: number } {
  if (!data?.length) throw new AppError("EMPTY", "Chưa có ảnh", 400);
  if (data.length > CHAT_MEDIA_MAX) throw new AppError("TOO_LARGE", "Ảnh quá 8MB — hãy chọn ảnh nhỏ hơn", 413);
  const mime = sniffImageMime(data);
  if (!mime) throw new AppError("BAD_TYPE", "Chỉ gửi được ảnh jpg, png, gif, webp", 400);
  const dir = chatMediaDir(bizId);
  mkdirSync(dir, { recursive: true });
  const name = `out-${uuidv7().replace(/-/g, "")}.${chatImageExt(mime)}`;
  const path = join(dir, name);
  writeFileSync(path, data);
  return { name, path, mime, size: data.length };
}
/** Tệp ảnh của tin `messageId`, đính kèm thứ `index` — chỉ khi tin thuộc đúng doanh nghiệp và ảnh đã lưu. */
export function chatMediaFile(bizId: string, messageId: string, index: number): { path: string; mime: string } | null {
  const m = byId<Row>("message", messageId);
  if (!m || m.biz_id !== bizId || !Number.isInteger(index) || index < 0) return null;
  const a = ((m.meta?.attachments ?? []) as Row[])[index];
  const name = typeof a?.stored === "string" ? a.stored : "";
  if (!SAFE_NAME.test(name) || basename(name) !== name) return null;
  const dir = resolve(chatMediaDir(bizId));
  const path = resolve(dir, name);
  if (!path.startsWith(dir + sep) || !existsSync(path) || !statSync(path).isFile()) return null;
  return { path, mime: MIME_OF[name.split(".").pop()!] };
}

/** Xoá ảnh đã lưu (dùng khi gửi ảnh thất bại sau khi đã chép vào kho). */
export function removeChatMediaFile(bizId: string, name: string) {
  if (!SAFE_NAME.test(name)) return;
  try { unlinkSync(join(chatMediaDir(bizId), name)); } catch { /* đã xoá */ }
}

export const CHAT_MEDIA_HANDLERS: Record<string, Handler> = {
  "chat.media": async (p, job) => {
    const r = await downloadChatMedia((p.bizId ?? job.biz_id) as string, p.messageId);
    if (r.failed) logger.info("chat_media.skipped", { messageId: p.messageId, failed: r.failed });
  },
};
