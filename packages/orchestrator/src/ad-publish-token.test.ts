import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb } from "@dotaka/db";
import { encryptSecret } from "@dotaka/shared";
import { connectorForAdPublish } from "./connections.ts";

/**
 * Tạo quảng cáo phải dùng token thấy được CẢ tài khoản quảng cáo LẪN Trang của bài. Hai kết nối Meta cùng thấy 1 tài
 * khoản quảng cáo thì kết nối nào làm mới sau cùng "giữ" tài khoản đó — token cá nhân không có quyền Trang làm Facebook
 * báo 100/1487390 ở bước tạo nội dung. Graph được giả lập (không gọi Facebook).
 */
let B: string;
const PAGE = "PAGE_TAKI";
const conn = (name: string, token: string) => insert("connection", { biz_id: B, platform: "meta", external_account_id: name, display_name: name, token_ciphertext: encryptSecret(JSON.stringify({ access_token: token })), status: "active", mode: "live", config: {} });

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS } }).id;
});
afterAll(() => closeDb());
afterEach(() => vi.unstubAllGlobals());

/** Token "PERSONAL" thấy tài khoản quảng cáo nhưng không thấy Trang; "SYSTEM" thấy cả hai. */
function stubGraph() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const token = String((init.headers as Record<string, string>).Authorization ?? "").replace("Bearer ", "");
    const ok = token === "SYSTEM" || !String(url).includes(PAGE);
    return new Response(JSON.stringify(ok ? { id: "x" } : { error: { message: "(#100) Object does not exist", code: 100 } }), { status: ok ? 200 : 400 });
  }));
}

describe("connectorForAdPublish", () => {
  it("tài khoản đang gắn kết nối cá nhân (không có quyền Trang) → tự dùng kết nối có đủ quyền", async () => {
    stubGraph();
    const personal = conn("Facebook ads", "PERSONAL");
    const system = conn("Facebook test", "SYSTEM");
    insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Taki", external_id: PAGE, connection_id: system.id, enabled: 1, whitelisted: 1, meta: {} });
    const acc = insert("ad_account", { biz_id: B, platform: "meta", external_id: "act_9", name: "TK 02", currency: "VND", connection_id: personal.id, status: "active", whitelisted: 1, meta: {} });
    const r = await connectorForAdPublish(acc.id, PAGE, "meta");
    expect(r.conn?.id).toBe(system.id);
    expect(r.switched).toBe(true);
  });

  it("kết nối của tài khoản đã đủ quyền → giữ nguyên; không có Trang → giữ nguyên", async () => {
    stubGraph();
    const system = conn("System 2", "SYSTEM");
    const acc = insert("ad_account", { biz_id: B, platform: "meta", external_id: "act_10", name: "TK 03", currency: "VND", connection_id: system.id, status: "active", whitelisted: 1, meta: {} });
    expect((await connectorForAdPublish(acc.id, PAGE, "meta")).switched).toBe(false);
    expect((await connectorForAdPublish(acc.id, null, "meta")).conn?.id).toBe(system.id);
  });
});
