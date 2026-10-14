import { afterEach, describe, expect, it, vi } from "vitest";
import { META_ADS_SCOPES, META_REQUIRED, META_SCOPES, TIKTOK_SCOPES, metaAuthUrl, metaExchangeCode, tiktokAuthUrl, tiktokExchangeCode, tiktokRefresh } from "./oauth.ts";

/** Đăng nhập bằng nút: URL xin quyền, đổi code bằng thân POST (client_secret / code / token KHÔNG nằm trong URL), thiếu quyền. */
type Call = { url: string; method: string; headers: Record<string, string>; body: string };
let calls: Call[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
function stub(handler: (c: Call) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = { url: String(url), method: String(init?.method ?? "GET"), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") };
    calls.push(c);
    return handler(c);
  }));
}
afterEach(() => vi.unstubAllGlobals());
const app = { id: "APP123", secret: "SECRET_VALUE_XYZ" };

describe("URL đăng nhập", () => {
  it("Facebook: quyền đăng bài + Instagram; quyền quảng cáo chỉ khi tick (mặc định TẮT)", () => {
    const u = new URL(metaAuthUrl("APP123", "http://localhost:8787/v1/oauth/facebook/callback", "st"));
    const scopes = u.searchParams.get("scope")!.split(",");
    for (const s of ["pages_manage_posts", "pages_show_list", "instagram_basic", "instagram_content_publish"]) expect(scopes).toContain(s);
    for (const s of META_ADS_SCOPES) expect(scopes).not.toContain(s);
    expect(scopes).not.toContain("instagram_manage_messages"); // nhắn tin Instagram chưa có trong hệ thống này
    const withAds = new URL(metaAuthUrl("APP123", "http://localhost:8787/x", "st", { ads: true })).searchParams.get("scope")!.split(",");
    expect(withAds).toEqual([...META_SCOPES, ...META_ADS_SCOPES]);
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:8787/v1/oauth/facebook/callback");
  });
  it("TikTok: PKCE S256, đủ scope", () => {
    const u = new URL(tiktokAuthUrl("CK", "https://link.taki.vn/v1/oauth/tiktok/callback", "st", "CHAL"));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe(TIKTOK_SCOPES.join(","));
    expect(u.searchParams.get("client_key")).toBe("CK");
  });
});

describe("đổi code lấy token", () => {
  it("Facebook: code → token ngắn → token dài hạn bằng thân POST; secret / code / token không nằm trong URL; /me/permissions bằng header", async () => {
    stub((c) => {
      if (c.url.includes("/oauth/access_token")) {
        const f = new URLSearchParams(c.body);
        return f.get("grant_type") === "fb_exchange_token" ? json({ access_token: "LONG", expires_in: 5184000 }) : json({ access_token: "SHORT" });
      }
      return json({ data: META_REQUIRED.map((p) => ({ permission: p, status: "granted" })).concat([{ permission: "instagram_basic", status: "declined" }]) });
    });
    const t = await metaExchangeCode(app, "http://localhost:8787/v1/oauth/facebook/callback", "CODE_ABC");
    expect(t).toMatchObject({ accessToken: "LONG", expiresIn: 5184000, missing: [] });
    expect(t.granted).not.toContain("instagram_basic");
    expect(calls.every((c) => !/SECRET_VALUE_XYZ|CODE_ABC|SHORT|LONG/.test(c.url))).toBe(true);
    expect(calls[0].method).toBe("POST");
    const f1 = new URLSearchParams(calls[0].body);
    expect(f1.get("client_secret")).toBe("SECRET_VALUE_XYZ");
    expect(f1.get("code")).toBe("CODE_ABC");
    expect(new URLSearchParams(calls[1].body).get("fb_exchange_token")).toBe("SHORT");
    expect(calls[2].headers.Authorization).toBe("Bearer LONG");
  });

  it("thiếu quyền tối thiểu → báo missing (không tạo kết nối ở tầng trên)", async () => {
    stub((c) => (c.url.includes("/oauth/access_token") ? json({ access_token: "T" }) : json({ data: [{ permission: "pages_show_list", status: "granted" }] })));
    const t = await metaExchangeCode(app, "x", "c");
    expect(t.missing).toEqual(["pages_manage_posts", "pages_read_engagement"]);
  });

  it("lỗi từ Facebook → ConnectorError, lời nhắn không chứa secret", async () => {
    stub(() => json({ error: { message: "Error validating verification code", code: 100 } }, 400));
    const e = await metaExchangeCode(app, "x", "c").catch((x) => x);
    expect(e.message).toMatch(/verification code/);
    expect(e.message).not.toContain("SECRET_VALUE_XYZ");
    stub(() => { throw new Error("fetch failed: https://graph.facebook.com/x?client_secret=SECRET_VALUE_XYZ"); });
    const e2 = await metaExchangeCode(app, "x", "c").catch((x) => x);
    expect(e2.message).not.toContain("SECRET_VALUE_XYZ");
  });

  it("TikTok: đổi code (PKCE verifier) và gia hạn bằng POST form; lỗi invalid_grant → ConnectorError", async () => {
    stub(() => json({ access_token: "A", refresh_token: "R", expires_in: 86400, refresh_expires_in: 31536000, open_id: "o", scope: "video.upload,video.publish" }));
    const t = await tiktokExchangeCode({ id: "CK", secret: "CS" }, "https://link.taki.vn/cb", "CODE", "VERIFIER");
    expect(t.access_token).toBe("A");
    const f = new URLSearchParams(calls[0].body);
    expect(f.get("code_verifier")).toBe("VERIFIER");
    expect(f.get("grant_type")).toBe("authorization_code");
    expect(calls[0].url).not.toMatch(/CODE|CS|VERIFIER/);
    await tiktokRefresh({ id: "CK", secret: "CS" }, "R");
    expect(new URLSearchParams(calls[1].body).get("grant_type")).toBe("refresh_token");
    stub(() => json({ error: "invalid_grant", error_description: "Refresh token is invalid or expired" }, 400));
    await expect(tiktokRefresh({ id: "CK", secret: "CS" }, "bad")).rejects.toThrow(/TikTok/);
  });
});
