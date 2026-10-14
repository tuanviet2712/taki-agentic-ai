import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { decryptSecret, encryptSecret, isValidEncryptionKey } from "@dotaka/shared";
import { encryptionKeyReady, reencryptLegacySecrets, requireEncryptionKey } from "./key-migration.ts";

/** Khóa mã hóa token: khóa thật là 64 hex; bí mật cũ (khóa dev công khai) được chuyển sang khóa mới, không mất kết nối. */
let B: string;
beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
});
afterEach(() => { delete process.env.TOKEN_ENCRYPTION_KEY; });
afterAll(() => closeDb());

describe("khóa mã hóa", () => {
  it("chỉ 64 ký tự hex mới là khóa thật; thiếu khóa → từ chối lưu bí mật dài hạn với lời nhắn tiếng Việt", () => {
    expect(isValidEncryptionKey("b".repeat(64))).toBe(true);
    expect(isValidEncryptionKey("b".repeat(63))).toBe(false);
    expect(isValidEncryptionKey("xyz")).toBe(false);
    expect(isValidEncryptionKey("")).toBe(false);
    expect(encryptionKeyReady()).toBe(false);
    expect(() => requireEncryptionKey()).toThrow(/TOKEN_ENCRYPTION_KEY/);
    process.env.TOKEN_ENCRYPTION_KEY = "b".repeat(64);
    expect(encryptionKeyReady()).toBe(true);
    expect(() => requireEncryptionKey()).not.toThrow();
  });

  it("chưa có khóa thật: không đụng vào gì (khóa hiện tại chính là khóa dev)", () => {
    const c = insert("connection", { biz_id: B, platform: "meta", external_account_id: "a", token_ciphertext: encryptSecret("{\"access_token\":\"T\"}"), status: "active", mode: "live" });
    expect(reencryptLegacySecrets()).toEqual({ reencrypted: 0, unreadable: 0 });
    expect(byId<Row>("connection", c.id)!.token_ciphertext).toBe(c.token_ciphertext);
  });

  it("đặt khóa thật → token kết nối / token Trang / SĐT đơn / App Secret đang dùng khóa dev được mã hóa lại; chạy lại không đổi gì; bí mật hỏng được đếm", () => {
    q.run("DELETE FROM connection");
    const old = (plain: string) => encryptSecret(plain); // chưa có TOKEN_ENCRYPTION_KEY → khóa dev
    const conn = insert("connection", { biz_id: B, platform: "meta", external_account_id: "b", token_ciphertext: old("{\"access_token\":\"USER\"}"), status: "active", mode: "live" });
    const ch = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "P", external_id: "P1", connection_id: conn.id, enabled: 1, secret_ciphertext: old("PAGE_TOKEN"), meta: {} });
    const order = insert("orders", { biz_id: B, customer_name: "A", product: "X", total: 1, status: "pending", meta: { shipping: { phoneCipher: old("0912345678"), phoneMasked: "09****78" } } });
    const broken = insert("connection", { biz_id: B, platform: "tiktok_post", external_account_id: "c", token_ciphertext: "bm90LWEtY2lwaGVydGV4dA==", status: "active", mode: "live" });
    q_run(B, { oauthApps: { facebook: { id: "APP", secret: old("APP_SECRET") } } });

    process.env.TOKEN_ENCRYPTION_KEY = "c".repeat(64);
    const r = reencryptLegacySecrets();
    expect(r).toEqual({ reencrypted: 4, unreadable: 1 });
    expect(decryptSecret(byId<Row>("connection", conn.id)!.token_ciphertext)).toBe("{\"access_token\":\"USER\"}");
    expect(decryptSecret(byId<Row>("channel", ch.id)!.secret_ciphertext)).toBe("PAGE_TOKEN");
    expect(decryptSecret(byId<Row>("orders", order.id)!.meta.shipping.phoneCipher)).toBe("0912345678");
    expect(decryptSecret((byId<Row>("biz", B)!.settings as Row).oauthApps.facebook.secret)).toBe("APP_SECRET");
    expect(byId<Row>("connection", broken.id)!.token_ciphertext).toBe("bm90LWEtY2lwaGVydGV4dA=="); // không xoá dữ liệu không đọc được
    expect(reencryptLegacySecrets()).toEqual({ reencrypted: 0, unreadable: 1 }); // idempotent
  });
});

function q_run(bizId: string, patch: Row) {
  const s = (q.get<Row>("SELECT settings FROM biz WHERE id = ?", bizId)!.settings ?? {}) as Row;
  update("biz", bizId, { settings: { ...s, ...patch } });
}
