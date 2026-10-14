import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { decryptSecret, encryptSecret } from "@dotaka/shared";
import { connectorForChannel, createConnection, disconnect, testConnection } from "./connections.ts";

/** Khám phá Instagram / TikTok từ kết nối: Trang không bao giờ bị mất, kênh thêm tay được nhận (giữ kênh đăng chính + đăng nhập Chrome). */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
let B: string;
let igFails = false;
let adFails = false;
let meId = "sys1";
function graph() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/me/permissions")) return json({ data: [] });
    if (u.includes("/me/adaccounts")) return adFails ? json({ error: { message: "(#200) no ads permission", code: 200 } }, 403) : json({ data: [{ id: "act_9", name: "TK QC", currency: "VND", account_status: 1 }] });
    if (u.includes("instagram_business_account")) return igFails ? json({ error: { message: "(#10) instagram_basic", code: 10 } }, 403) : json({ data: [{ id: "PAGE1", username: "takiacademy", instagram_business_account: { id: "IG1", username: "takiacademy_ig" } }] });
    if (u.includes("/me/accounts")) return json({ data: [{ id: "PAGE1", name: "Fanpage TAKI", category: "Edu", access_token: "PAGE1_TOKEN" }] });
    if (/\/me\?/.test(u)) return json({ id: meId, name: "System User" });
    return json({});
  }));
}

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
});
beforeEach(() => {
  igFails = false;
  adFails = false;
  meId = "sys1";
  for (const t of ["channel", "connection", "ad_account", "audit_log", "outbox"]) q.run(`DELETE FROM ${t}`);
  graph();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => closeDb());
const sysToken = { platform: "meta", mode: "live" as const, credentials: { access_token: "SYS_TOKEN" } };

describe("khám phá tài sản của token Meta", () => {
  it("token System User: Trang + tài khoản Instagram Business gắn kèm thành kênh (token Trang mã hóa, nhớ pageId)", async () => {
    await createConnection(B, sysToken, "t");
    const fb = q.get<Row>("SELECT * FROM channel WHERE platform = 'facebook'")!;
    const ig = q.get<Row>("SELECT * FROM channel WHERE platform = 'instagram'")!;
    expect(fb).toMatchObject({ external_id: "PAGE1", name: "Fanpage TAKI" });
    expect(ig).toMatchObject({ external_id: "IG1", name: "@takiacademy_ig", kind: "business" });
    expect(ig.meta).toMatchObject({ pageId: "PAGE1", username: "takiacademy_ig" });
    expect(decryptSecret(ig.secret_ciphertext)).toBe("PAGE1_TOKEN");
    expect(connectorForChannel(ig).mode).toBe("live");
    expect(connectorForChannel(fb).mode).toBe("live");
  });

  it("nhánh Instagram lỗi (token thiếu instagram_basic) → Trang vẫn đủ, chỉ không có Instagram", async () => {
    igFails = true;
    await createConnection(B, sysToken, "t");
    expect(q.all("SELECT id FROM channel WHERE platform = 'facebook'")).toHaveLength(1);
    expect(q.all("SELECT id FROM channel WHERE platform = 'instagram'")).toHaveLength(0);
  });

  it("token System User thiếu quyền quảng cáo vẫn báo lỗi như trước (không im lặng mất tài khoản quảng cáo)", async () => {
    adFails = true;
    await expect(createConnection(B, sysToken, "t")).rejects.toThrow(/Kết nối thất bại/);
  });
});

describe("nhận kênh thêm tay", () => {
  it("Fanpage + Instagram thêm tay (mã = tên trang) được nhận: không trùng, giữ kênh đăng chính + đăng nhập Chrome, chuyển 'Luôn qua Chrome' → Tự động", async () => {
    const handFb = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "taki", external_id: "takiacademy", connection_id: null, enabled: 1, meta: { isDefault: true, publishVia: "browser", profileUrl: "https://www.facebook.com/takiacademy", browser: { loggedIn: true, account: "Lan", profileUrl: "https://www.facebook.com/takiacademy" } } });
    const handIg = insert("channel", { biz_id: B, platform: "instagram", kind: "business", name: "ig", external_id: "takiacademy_ig", connection_id: null, enabled: 1, meta: { isDefault: true, publishVia: "browser", profileUrl: "https://www.instagram.com/takiacademy_ig/" } });
    await createConnection(B, sysToken, "t");
    expect(q.all("SELECT id FROM channel WHERE platform = 'facebook'")).toHaveLength(1);
    expect(q.all("SELECT id FROM channel WHERE platform = 'instagram'")).toHaveLength(1);
    const fb = byId<Row>("channel", handFb.id)!;
    expect(fb).toMatchObject({ external_id: "PAGE1", name: "Fanpage TAKI" });
    expect(fb.connection_id).toBeTruthy();
    expect(fb.meta).toMatchObject({ isDefault: true, publishVia: "auto", browser: { loggedIn: true, account: "Lan" } });
    const ig = byId<Row>("channel", handIg.id)!;
    expect(ig).toMatchObject({ external_id: "IG1" });
    expect(ig.meta).toMatchObject({ isDefault: true, pageId: "PAGE1" });
    expect(q.get("SELECT id FROM audit_log WHERE event = 'channel.adopted'")).toBeTruthy();
  });

  it("kênh đã gỡ không được nhận; chỉ có đúng 1 kênh TikTok thêm tay thì mới nhận khi nối TikTok", async () => {
    insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "taki", external_id: "takiacademy", connection_id: null, enabled: 0, meta: { removedAt: new Date().toISOString() } });
    await createConnection(B, sysToken, "t");
    expect(q.all("SELECT id FROM channel WHERE platform = 'facebook'")).toHaveLength(2); // kênh đã gỡ + kênh mới từ API
    const tt1 = insert("channel", { biz_id: B, platform: "tiktok", kind: "business", name: "@taki", external_id: "taki", connection_id: null, enabled: 1, meta: { isDefault: true, publishVia: "browser" } });
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: { user: { open_id: "open1", display_name: "Kênh TAKI" } }, error: { code: "ok" } })));
    await createConnection(B, { platform: "tiktok_post", mode: "live", credentials: { access_token: "TT" } }, "t");
    expect(q.all("SELECT id FROM channel WHERE platform = 'tiktok'")).toHaveLength(1);
    expect(byId<Row>("channel", tt1.id)).toMatchObject({ external_id: "open1", name: "Kênh TAKI" });
    expect(byId<Row>("channel", tt1.id)!.connection_id).toBeTruthy();
    // kênh TikTok qua API: connector live (đăng nháp luôn được, đăng công khai theo audited)
    expect(connectorForChannel(byId<Row>("channel", tt1.id)!).mode).toBe("live");
  });

  it("kiểm tra lại kết nối không làm mất cài đặt kênh; ngắt kết nối xoá token Trang của cả kênh Instagram", async () => {
    const c = await createConnection(B, sysToken, "t");
    const ig = q.get<Row>("SELECT * FROM channel WHERE platform = 'instagram'")!;
    q.run("UPDATE channel SET meta = ? WHERE id = ?", JSON.stringify({ ...ig.meta, isDefault: true, note: "giữ" }), ig.id);
    expect((await testConnection(B, c.id, "t")).ok).toBe(true);
    expect(byId<Row>("channel", ig.id)!.meta).toMatchObject({ isDefault: true, note: "giữ", pageId: "PAGE1" });
    disconnect(B, c.id, "t");
    expect(byId<Row>("channel", ig.id)!.secret_ciphertext).toBeNull();
    expect(connectorForChannel(byId<Row>("channel", ig.id)!).mode).toBe("sandbox");
  });

  it("kết nối đăng nhập bằng nút không giành lại tài khoản quảng cáo của kết nối System User đang chạy", async () => {
    const sys = await createConnection(B, sysToken, "t");
    const acc = q.get<Row>("SELECT * FROM ad_account WHERE external_id = 'act_9'")!;
    expect(acc.connection_id).toBe((sys as Row).id);
    meId = "user77";
    const login = await createConnection(B, { platform: "meta", mode: "live", credentials: { access_token: "USER_TOKEN" }, config: { oauth: "facebook" } }, "t");
    expect((login as Row).id).not.toBe((sys as Row).id);
    expect(byId<Row>("ad_account", acc.id)!.connection_id).toBe((sys as Row).id);
  });
});
