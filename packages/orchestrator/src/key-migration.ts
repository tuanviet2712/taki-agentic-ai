import { q, update, type Row } from "@dotaka/db";
import { AppError, decryptSecret, encryptSecret, isValidEncryptionKey, legacyDevKey, logger } from "@dotaka/shared";

/**
 * Khóa mã hóa token nền tảng (TOKEN_ENCRYPTION_KEY, 64 ký tự hex).
 * Chưa đặt khóa → mọi token/secret bị mã hóa bằng khóa dev CÔNG KHAI trong mã nguồn. Hệ thống KHÔNG tự sinh / ghi .env
 * (đổi khóa là việc của chủ máy); thay vào đó:
 *  - `requireEncryptionKey()`: từ chối LƯU token đăng nhập (OAuth) & App Secret khi chưa có khóa thật;
 *  - `reencryptLegacySecrets()`: lúc khởi động, nếu đã có khóa thật thì mã hóa lại mọi bí mật đang dùng khóa dev (không mất kết nối).
 */
export const ENCRYPTION_KEY_HELP = "Cần đặt khóa mã hóa trước: thêm dòng TOKEN_ENCRYPTION_KEY=<64 ký tự hex> vào file .env (tạo bằng lệnh: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\") rồi khởi động lại hệ thống. Các kết nối cũ sẽ được tự chuyển sang khóa mới.";

export function encryptionKeyReady(): boolean {
  return isValidEncryptionKey(process.env.TOKEN_ENCRYPTION_KEY);
}
/** Từ chối lưu bí mật dài hạn (token đăng nhập, App Secret) bằng khóa dev công khai. */
export function requireEncryptionKey(what = "token đăng nhập / App Secret") {
  if (!encryptionKeyReady()) throw new AppError("NO_ENCRYPTION_KEY", `Chưa có khóa mã hóa (TOKEN_ENCRYPTION_KEY) nên hệ thống không lưu ${what} — khóa mặc định là khóa công khai trong mã nguồn. ${ENCRYPTION_KEY_HELP}`, 400);
}

type Stats = { reencrypted: number; unreadable: number };
/** Bí mật đang dùng khóa dev → giá trị mã hóa lại bằng khóa hiện tại; null nếu không cần / không đọc được. */
function migrateOne(blob: unknown, stats: Stats): string | null {
  if (typeof blob !== "string" || !blob) return null;
  try { decryptSecret(blob); return null; } catch { /* không phải khóa hiện tại */ }
  try {
    const plain = decryptSecret(blob, legacyDevKey());
    stats.reencrypted++;
    return encryptSecret(plain);
  } catch {
    stats.unreadable++;
    return null;
  }
}

export function reencryptLegacySecrets(): Stats {
  const stats: Stats = { reencrypted: 0, unreadable: 0 };
  // Khóa hiện tại CHÍNH LÀ khóa dev (chưa có khóa thật) → không có gì để chuyển.
  if (!encryptionKeyReady()) return stats;
  for (const c of q.all<Row>("SELECT id, token_ciphertext FROM connection WHERE token_ciphertext IS NOT NULL")) {
    const n = migrateOne(c.token_ciphertext, stats);
    if (n) update("connection", c.id, { token_ciphertext: n });
  }
  for (const ch of q.all<Row>("SELECT id, secret_ciphertext FROM channel WHERE secret_ciphertext IS NOT NULL")) {
    const n = migrateOne(ch.secret_ciphertext, stats);
    if (n) update("channel", ch.id, { secret_ciphertext: n });
  }
  for (const l of q.all<Row>("SELECT id, phone_cipher FROM nurture_lead WHERE phone_cipher IS NOT NULL")) {
    const n = migrateOne(l.phone_cipher, stats);
    if (n) update("nurture_lead", l.id, { phone_cipher: n });
  }
  for (const o of q.all<Row>("SELECT id, meta FROM orders")) {
    const ship = (o.meta as Row | undefined)?.shipping as Row | undefined;
    const n = ship && migrateOne(ship.phoneCipher, stats);
    if (n) update("orders", o.id, { meta: { ...(o.meta as Row), shipping: { ...ship, phoneCipher: n } } });
  }
  for (const b of q.all<Row>("SELECT id, settings FROM biz")) {
    const s = (b.settings ?? {}) as Row;
    let changed = false;
    for (const app of Object.values((s.oauthApps ?? {}) as Record<string, Row>)) {
      const n = app && migrateOne(app.secret, stats);
      if (n) { app.secret = n; changed = true; }
    }
    if (changed) update("biz", b.id, { settings: s });
  }
  if (stats.reencrypted) logger.warn("secrets.reencrypted", { count: stats.reencrypted, msg: "Đã chuyển các token/secret đang mã hóa bằng khóa dev sang TOKEN_ENCRYPTION_KEY" });
  if (stats.unreadable) logger.warn("secrets.unreadable", { count: stats.unreadable, msg: "Có token/secret không giải mã được bằng khóa hiện tại lẫn khóa dev — cần kết nối/nhập lại" });
  return stats;
}
