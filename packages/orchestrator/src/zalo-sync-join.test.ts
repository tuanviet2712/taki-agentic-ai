import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { encryptSecret } from "@dotaka/shared";
import { syncZalo } from "./zalo-followup.ts";

/**
 * Khách đến từ "chăm khách từ bình luận" (đã kết bạn Zalo qua nick X, hội thoại `zlu:<nick>:<uid>`) nhắn lại trên Zalo →
 * đồng bộ ZL-CRM phải nối vào ĐÚNG hội thoại đó, không tạo hội thoại thứ hai `zl:<id>` (mất ngữ cảnh + follow-up trùng).
 * ZL-CRM là fetch giả; DB :memory:.
 */
let B: string;
const sentAt = new Date(Date.now() - 60_000).toISOString();

function mockZl(opts: { threadId: string; accountId: string }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (u.includes("/api/public/zalo-accounts")) return json({ accounts: [{ id: opts.accountId, displayName: "Nick Shop", status: "connected" }] });
    if (/\/api\/public\/conversations\/[^/]+\/messages/.test(u)) {
      return json({ messages: [{ id: "m1", senderType: "contact", senderName: "Nguyễn Thị Hoa", content: "Em đồng ý kết bạn rồi, tư vấn giúp em ạ", contentType: "text", sentAt }] });
    }
    if (u.includes("/api/public/conversations")) {
      return json({ conversations: [{ id: "zlc1", externalThreadId: opts.threadId, threadType: "user", zaloAccountId: opts.accountId, lastMessageAt: sentAt, contact: { fullName: "Nguyễn Thị Hoa", phone: null }, zaloAccount: { displayName: "Nick Shop" } }] });
    }
    return json({});
  }));
}

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Hoa", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  insert("connection", {
    biz_id: B, platform: "zlcrm", external_account_id: "http://zl.test", token_ciphertext: encryptSecret(JSON.stringify({ api_key: "k" })), status: "active", mode: "live",
    config: { base_url: "http://zl.test", cursor: new Date(Date.now() - 3600_000).toISOString(), accounts: [{ id: "nick1", name: "Nick Shop", status: "connected" }] },
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => closeDb());

describe("syncZalo nối khách đã kết bạn từ bình luận", () => {
  it("tin Zalo của khách → vào hội thoại zlu:<nick>:<uid> đã có (không tạo zl:<id> thứ hai)", async () => {
    const existing = insert("conversation", {
      biz_id: B, channel: "zalo", external_id: "zlu:nick1:u77", customer_ref: "cust_zlu:nick1:u77", customer_name: "Nguyễn Thị Hoa", state: "awaiting_customer",
      tags: ["Từ bình luận", "Có SĐT"], unread: 0, ext: { zaloAccountId: "nick1", threadId: "u77", threadType: "user" },
    });
    mockZl({ threadId: "u77", accountId: "nick1" });
    const r = await syncZalo(B, "test");
    expect(r).toMatchObject({ conversations: 1, inbound: 1 });
    expect(q.get("SELECT id FROM conversation WHERE biz_id = ? AND external_id = ?", B, "zl:zlc1")).toBeUndefined();
    const msgs = q.all<Row>("SELECT body, sender FROM message WHERE conversation_id = ?", existing.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].sender).toBe("customer");
    expect(q.scalar<number>("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND channel = 'zalo'", B)).toBe(1);
  });

  it("khách chưa từng qua chăm khách → vẫn tạo hội thoại zl:<id> như trước", async () => {
    mockZl({ threadId: "u88", accountId: "nick1" });
    q.run("UPDATE connection SET config = json_set(config, '$.cursor', ?) WHERE biz_id = ? AND platform = 'zlcrm'", new Date(Date.now() - 3600_000).toISOString(), B);
    const r = await syncZalo(B, "test");
    expect(r).toMatchObject({ inbound: 1 });
    expect(q.get("SELECT id FROM conversation WHERE biz_id = ? AND external_id = ?", B, "zl:zlc1")).toBeTruthy();
  });
});
