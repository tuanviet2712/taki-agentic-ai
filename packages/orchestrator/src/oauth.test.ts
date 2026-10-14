import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { decryptSecret, encryptSecret } from "@dotaka/shared";
import { finishOAuth, isOAuthProvider, oauthApp, oauthStatus, redirectUri, safeReturn, saveOAuthApp, startOAuth, tiktokAccessToken } from "./oauth.ts";
import { setPublicGateway } from "./tracking.ts";

/**
 * Đăng nhập bằng nút: từ chối lưu bí mật khi chưa có khóa mã hóa thật, App Secret mã hóa + không bao giờ trả ra, state dùng 1 lần,
 * Facebook (Fanpage + Instagram, tài khoản quảng cáo không bắt buộc), TikTok (https, tự gia hạn token). Mọi mạng là fetch giả.
 */
const KEY = "a".repeat(64);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
type Call = { url: string; method: string; body: string; auth: string };
let calls: Call[] = [];
let handler: (c: Call) => Response | Promise<Response>;
let B: string;

function stub(h: (c: Call) => Response | Promise<Response>) {
  calls = [];
  handler = h;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { url: String(url), method: String(init?.method ?? "GET"), body: String(init?.body ?? ""), auth: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "") };
    calls.push(c);
    return handler(c);
  }));
}
const GRANTED = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "instagram_basic", "instagram_content_publish"].map((permission) => ({ permission, status: "granted" }));
/** Facebook giả: token / Trang / Instagram; opts để làm hỏng từng nhánh. */
function facebook(o: { adAccounts?: "403" | "ok"; igError?: boolean; permissions?: Row[] } = {}) {
  stub((c) => {
    if (c.url.includes("/oauth/access_token")) return new URLSearchParams(c.body).get("grant_type") === "fb_exchange_token" ? json({ access_token: "LONG_USER_TOKEN", expires_in: 5184000 }) : json({ access_token: "SHORT" });
    if (c.url.includes("/me/permissions")) return json({ data: o.permissions ?? GRANTED });
    if (c.url.includes("/me/adaccounts")) return o.adAccounts === "ok" ? json({ data: [{ id: "act_1", name: "TK QC 1", currency: "VND", account_status: 1 }] }) : json({ error: { message: "(#200) Requires ads_read permission", code: 200 } }, 403);
    if (c.url.includes("/me/businesses")) return json({ data: [] });
    if (c.url.includes("instagram_business_account")) return o.igError ? json({ error: { message: "(#10) instagram_basic required", code: 10 } }, 403) : json({ data: [{ id: "PAGE1", username: "takiacademy", instagram_business_account: { id: "IG1", username: "takiacademy_ig" } }, { id: "PAGE2", username: "shop2" }] });
    if (c.url.includes("/me/accounts")) return json({ data: [{ id: "PAGE1", name: "Fanpage TAKI", category: "Edu", access_token: "PAGE1_TOKEN" }, { id: "PAGE2", name: "Fanpage Shop 2", category: "Shop", access_token: "PAGE2_TOKEN" }] });
    if (/\/me\?/.test(c.url)) return json({ id: "u100", name: "Nguyễn Lan" });
    return json({});
  });
}
async function login(provider: "facebook" | "tiktok", q2: Record<string, string> = {}, o: { ads?: boolean; returnTo?: string } = {}) {
  const start = startOAuth(B, provider, o.returnTo ?? "http://localhost:5173/channels", { ads: o.ads });
  const state = new URL(start.url).searchParams.get("state")!;
  return { start, back: new URL(await finishOAuth(provider, { state, ...q2 })) };
}

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
});
beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  for (const k of ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "OAUTH_REDIRECT_BASE", "PUBLIC_BASE_URL"]) delete process.env[k];
  for (const t of ["publish_job", "post", "channel", "connection", "ad_account", "job", "outbox", "audit_log", "biz"]) q.run(`DELETE FROM ${t}`);
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  setPublicGateway({ listening: false });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(() => { delete process.env.TOKEN_ENCRYPTION_KEY; closeDb(); });

describe("khóa mã hóa & App Secret", () => {
  it("chưa có TOKEN_ENCRYPTION_KEY thật → KHÔNG lưu App Secret, không bắt đầu đăng nhập, thông báo tiếng Việt rõ ràng", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => saveOAuthApp(B, "facebook", { id: "APP1", secret: "SECRET1" }, "t")).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect((q.get<Row>("SELECT settings FROM biz WHERE id = ?", B)!.settings as Row).oauthApps).toBeUndefined();
    expect(() => startOAuth(B, "facebook")).toThrow(/khóa mã hóa/);
    process.env.TOKEN_ENCRYPTION_KEY = "chua-hop-le"; // sai định dạng cũng bị từ chối
    expect(() => saveOAuthApp(B, "facebook", { id: "APP1", secret: "SECRET1" }, "t")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("có khóa: App Secret được mã hóa; oauthStatus không bao giờ trả secret", () => {
    saveOAuthApp(B, "facebook", { id: "1234567890", secret: "SECRET_VALUE" }, "t");
    const raw = (q.get<Row>("SELECT settings FROM biz WHERE id = ?", B)!.settings as Row).oauthApps.facebook;
    expect(raw.secret).not.toContain("SECRET_VALUE");
    expect(decryptSecret(raw.secret)).toBe("SECRET_VALUE");
    expect(oauthApp(B, "facebook")).toMatchObject({ id: "1234567890", secret: "SECRET_VALUE", source: "saved" });
    const st = oauthStatus(B);
    expect(JSON.stringify(st)).not.toContain("SECRET_VALUE");
    expect(st.facebook).toMatchObject({ configured: true, appId: "1234…890" });
    expect(st.facebook.redirectUri).toBe(`http://localhost:${process.env.API_PORT ?? 8787}/v1/oauth/facebook/callback`);
    expect(st.facebook.adsScopes).toEqual(["ads_management", "ads_read"]);
    expect(isOAuthProvider("facebook") && isOAuthProvider("tiktok") && !isOAuthProvider("zalo")).toBe(true);
  });
});

describe("bắt đầu / quay về", () => {
  it("state tự hết hạn sau 1 giờ dù không có lượt đăng nhập mới; không đổi code và không phục hồi khi đồng hồ quay lại", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = new Date("2026-10-10T03:00:00Z");
    vi.setSystemTime(startedAt);
    saveOAuthApp(B, "facebook", { id: "APP1234", secret: "SECRET1" }, "t");
    const state = new URL(startOAuth(B, "facebook").url).searchParams.get("state")!;
    facebook();
    vi.setSystemTime(new Date(startedAt.getTime() + 3600_001));
    const expired = new URL(await finishOAuth("facebook", { state, code: "OLD_CODE" }));
    expect(expired.searchParams.get("oauth_error")).toMatch(/hết hạn hoặc không hợp lệ/);
    expect(calls).toHaveLength(0);
    expect(q.all("SELECT id FROM connection")).toHaveLength(0);
    vi.setSystemTime(startedAt);
    expect(new URL(await finishOAuth("facebook", { state, code: "OLD_CODE" })).searchParams.get("oauth_error")).toMatch(/hết hạn hoặc không hợp lệ/);
    expect(calls).toHaveLength(0);
  });

  it("chưa có app → NO_APP; có app → URL đăng nhập có state; quyền quảng cáo chỉ khi tick", () => {
    expect(() => startOAuth(B, "facebook")).toThrow(/App ID/);
    saveOAuthApp(B, "facebook", { id: "APP1234", secret: "SECRET1" }, "t");
    const u = new URL(startOAuth(B, "facebook").url);
    expect(u.searchParams.get("client_id")).toBe("APP1234");
    expect(u.searchParams.get("scope")).not.toMatch(/ads_management/);
    expect(new URL(startOAuth(B, "facebook", undefined, { ads: true }).url).searchParams.get("scope")).toMatch(/ads_management,ads_read/);
  });

  it("state lạ / dùng lại / returnTo ngoài máy → bị từ chối hoặc về trang mặc định; không chuyển hướng ra ngoài", async () => {
    saveOAuthApp(B, "facebook", { id: "APP1234", secret: "SECRET1" }, "t");
    expect(await finishOAuth("facebook", { code: "c", state: "khong-co" })).toMatch(/oauth_error/);
    const { back } = await login("facebook", { error: "access_denied", error_description: "User denied" }, { returnTo: "https://evil.example/steal" });
    expect(back.hostname).toBe("localhost"); // returnTo lạ → trang mặc định
    expect(back.searchParams.get("oauth_error")).toBe("User denied");
    const state = new URL(startOAuth(B, "facebook").url).searchParams.get("state")!;
    await finishOAuth("facebook", { state, error: "x" });
    expect(new URL(await finishOAuth("facebook", { state, error: "x" })).searchParams.get("oauth_error")).toMatch(/hết hạn hoặc không hợp lệ/); // dùng 1 lần
    expect(safeReturn("https://evil.example/a")).toMatch(/^http:\/\/localhost/);
    expect(safeReturn("http://127.0.0.1:8787/channels")).toBe("http://127.0.0.1:8787/channels");
  });

  it("có state hợp lệ nhưng mất khóa mã hóa giữa chừng → không lưu token", async () => {
    process.env.FACEBOOK_APP_ID = "ENVAPP1";
    process.env.FACEBOOK_APP_SECRET = "ENVSECRET1"; // App lấy từ .env (không cần giải mã) — vẫn không được lưu token khi mất khóa
    const state = new URL(startOAuth(B, "facebook").url).searchParams.get("state")!;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    facebook();
    const back = new URL(await finishOAuth("facebook", { state, code: "c" }));
    expect(back.searchParams.get("oauth_error")).toMatch(/TOKEN_ENCRYPTION_KEY/);
    expect(calls).toHaveLength(0);
    expect(q.all("SELECT id FROM connection")).toHaveLength(0);
  });
});

describe("Facebook (+ Instagram)", () => {
  beforeEach(() => saveOAuthApp(B, "facebook", { id: "APP1234", secret: "SECRET_VALUE" }, "t"));

  it("đăng nhập: tạo kết nối (config.oauth), Fanpage + Instagram thành kênh có token Trang mã hóa; thiếu quyền quảng cáo KHÔNG làm hỏng", async () => {
    facebook({ adAccounts: "403" });
    const { back } = await login("facebook", { code: "CODE1" });
    expect(back.searchParams.get("connected")).toBe("facebook");
    expect(back.searchParams.get("oauth_error")).toBeNull();
    // secret / code không nằm trong URL; token dài hạn không bị đưa vào URL nào
    expect(calls.every((c) => !/SECRET_VALUE|CODE1|LONG_USER_TOKEN/.test(c.url))).toBe(true);
    const conn = q.get<Row>("SELECT * FROM connection WHERE platform = 'meta'")!;
    expect(conn.config.oauth).toBe("facebook");
    expect(conn.display_name).toMatch(/đăng nhập bằng nút$/);
    expect(JSON.parse(decryptSecret(conn.token_ciphertext)).access_token).toBe("LONG_USER_TOKEN");
    const chans = q.all<Row>("SELECT * FROM channel");
    expect(chans.map((c) => `${c.platform}:${c.external_id}`).sort()).toEqual(["facebook:PAGE1", "facebook:PAGE2", "instagram:IG1"]);
    const ig = chans.find((c) => c.platform === "instagram")!;
    expect(ig).toMatchObject({ name: "@takiacademy_ig", connection_id: conn.id });
    expect(ig.meta.pageId).toBe("PAGE1");
    expect(decryptSecret(ig.secret_ciphertext)).toBe("PAGE1_TOKEN");
    expect(q.all("SELECT id FROM ad_account")).toHaveLength(0);
  });

  it("lỗi nhánh Instagram không làm mất danh sách Trang", async () => {
    facebook({ adAccounts: "403", igError: true });
    const { back } = await login("facebook", { code: "CODE1" });
    expect(back.searchParams.get("connected")).toBe("facebook");
    expect(q.all<Row>("SELECT external_id FROM channel WHERE platform = 'facebook' ORDER BY external_id").map((c) => c.external_id)).toEqual(["PAGE1", "PAGE2"]);
    expect(q.all("SELECT id FROM channel WHERE platform = 'instagram'")).toHaveLength(0);
  });

  it("thiếu quyền tối thiểu → báo lỗi và KHÔNG tạo kết nối", async () => {
    facebook({ permissions: [{ permission: "pages_show_list", status: "granted" }] });
    const { back } = await login("facebook", { code: "CODE1" });
    expect(back.searchParams.get("oauth_error")).toMatch(/Thiếu quyền: pages_manage_posts, pages_read_engagement/);
    expect(q.all("SELECT id FROM connection")).toHaveLength(0);
  });

  it("tick quyền quảng cáo + token có tài khoản quảng cáo: không giành tài khoản đang chạy bằng kết nối System User khác", async () => {
    const sys = insert("connection", { biz_id: B, platform: "meta", external_account_id: "sys1", token_ciphertext: encryptSecret("{\"access_token\":\"SYS\"}"), status: "active", mode: "live", config: {} });
    const acc = insert("ad_account", { biz_id: B, platform: "meta", external_id: "act_1", name: "TK QC 1", currency: "VND", connection_id: sys.id, status: "active", whitelisted: 1, meta: {} });
    facebook({ adAccounts: "ok" });
    await login("facebook", { code: "CODE1" }, { ads: true });
    expect(byId<Row>("ad_account", acc.id)!.connection_id).toBe(sys.id); // vẫn dùng token System User
  });

  it("OAUTH_REDIRECT_BASE đổi Redirect URI của Facebook; mặc định là localhost:API_PORT", () => {
    expect(redirectUri("facebook")).toMatch(/^http:\/\/localhost:\d+\/v1\/oauth\/facebook\/callback$/);
    process.env.OAUTH_REDIRECT_BASE = "https://app.taki.vn/";
    expect(redirectUri("facebook")).toBe("https://app.taki.vn/v1/oauth/facebook/callback");
  });
});

describe("TikTok", () => {
  beforeEach(() => saveOAuthApp(B, "tiktok", { id: "CKEY12345", secret: "CSECRET_VALUE" }, "t"));

  it("Redirect URI bắt buộc https: không có PUBLIC_BASE_URL thì từ chối bắt đầu; có thì dùng PUBLIC_BASE_URL", () => {
    expect(() => startOAuth(B, "tiktok")).toThrow(/https/);
    expect(oauthStatus(B).tiktok.warning).toMatch(/https/);
    process.env.PUBLIC_BASE_URL = "https://link.taki.vn";
    setPublicGateway({ listening: true, port: 8788 });
    const { url, redirectUri: ru } = startOAuth(B, "tiktok");
    expect(ru).toBe("https://link.taki.vn/v1/oauth/tiktok/callback");
    const u = new URL(url);
    expect(u.searchParams.get("client_key")).toBe("CKEY12345");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("đăng nhập: tạo kết nối tiktok_post (refresh token mã hóa), kênh TikTok; token còn hạn không gọi mạng, sắp hết hạn thì tự gia hạn", async () => {
    process.env.PUBLIC_BASE_URL = "https://link.taki.vn";
    setPublicGateway({ listening: true, port: 8788 });
    stub((c) => {
      if (c.url.includes("/oauth/token/")) {
        const g = new URLSearchParams(c.body).get("grant_type");
        return g === "refresh_token"
          ? json({ access_token: "NEW_ACCESS", refresh_token: "R2", expires_in: 86400, refresh_expires_in: 31536000, open_id: "open1", scope: "video.upload" })
          : json({ access_token: "ACCESS1", refresh_token: "REFRESH1", expires_in: 86400, refresh_expires_in: 31536000, open_id: "open1", scope: "user.info.basic,video.upload" });
      }
      return json({ data: { user: { open_id: "open1", display_name: "Kênh TAKI" } }, error: { code: "ok" } });
    });
    const { back } = await login("tiktok", { code: "CODE" });
    expect(back.searchParams.get("connected")).toBe("tiktok");
    expect(back.searchParams.get("warn")).toMatch(/video\.publish/); // thiếu quyền đăng công khai: chỉ gửi nháp
    const conn = q.get<Row>("SELECT * FROM connection WHERE platform = 'tiktok_post'")!;
    expect(JSON.parse(decryptSecret(conn.token_ciphertext))).toEqual({ access_token: "ACCESS1", refresh_token: "REFRESH1" });
    expect(q.get<Row>("SELECT * FROM channel WHERE platform = 'tiktok'")).toMatchObject({ external_id: "open1", name: "Kênh TAKI", connection_id: conn.id });
    // còn hạn → không gọi mạng
    const n = calls.length;
    expect(await tiktokAccessToken(conn.id)).toBe("ACCESS1");
    expect(calls.length).toBe(n);
    // sắp hết hạn → gia hạn
    update("connection", conn.id, { config: { ...byId<Row>("connection", conn.id)!.config, token_expires_at: new Date(Date.now() + 60_000).toISOString() } });
    expect(await tiktokAccessToken(conn.id)).toBe("NEW_ACCESS");
    expect(JSON.parse(decryptSecret(byId<Row>("connection", conn.id)!.token_ciphertext))).toEqual({ access_token: "NEW_ACCESS", refresh_token: "R2" });
  });

  it("không gia hạn được → kết nối 'hết hạn' + cảnh báo khẩn, lỗi AuthError", async () => {
    const conn = insert("connection", { biz_id: B, platform: "tiktok_post", external_account_id: "o9", token_ciphertext: encryptSecret(JSON.stringify({ access_token: "OLD", refresh_token: "R" })), status: "active", mode: "live", config: { token_expires_at: new Date(Date.now() + 1000).toISOString() } });
    stub(() => json({ error: "invalid_grant", error_description: "refresh token expired" }, 400));
    await expect(tiktokAccessToken(conn.id)).rejects.toMatchObject({ kind: "AuthError" });
    expect(byId<Row>("connection", conn.id)!.status).toBe("expired");
    expect(q.get("SELECT id FROM outbox WHERE type = 'alert.raised' AND payload LIKE '%TikTok cần kết nối lại%'")).toBeTruthy();
  });
});
