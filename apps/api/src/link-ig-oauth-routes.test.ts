import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { encryptSecret } from "@dotaka/shared";
import { errorHandler } from "./http.ts";
import { registerApiRoutes } from "./register-routes.ts";

/** Route: link dưới bình luận (gắn tay, cài đặt, trạng thái), sản phẩm của chiến dịch, đăng nhập bằng nút, TikTok audited, địa chỉ công khai. */
const KEY = "d".repeat(64);
let app: FastifyInstance, B: string, fb: Row;
const api = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { "x-biz-id": B } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  app = Fastify({ logger: false });
  await app.register(cors, { origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });
  app.setErrorHandler(errorHandler);
  registerApiRoutes(app);
  await app.ready();
});
beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  for (const t of ["publish_job", "post", "post_comment", "content_item", "channel", "connection", "job", "goal", "task", "approval", "dna_profile", "track_link", "audit_log", "outbox", "biz"]) q.run(`DELETE FROM ${t}`);
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  const conn = insert("connection", { biz_id: B, platform: "meta", external_account_id: "sys1", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
  fb = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Fanpage Shop", external_id: "PAGE1", connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
  insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "t", data: { company: { brand: "Lan" }, products: [{ key: "sua-x", name: "Sữa X", link: "https://shopee.vn/sua-x", verified: true }] } });
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.TOKEN_ENCRYPTION_KEY; });
afterAll(async () => { await app.close(); closeDb(); });

describe("link dưới bình luận", () => {
  it("gắn tay qua API + trạng thái trong danh sách bài + cài đặt tự gắn", async () => {
    const post = insert("post", { biz_id: B, channel_id: fb.id, external_id: "PAGE1_5", kind: "image", title: "Bài", body: "b", published_at: new Date().toISOString(), permalink: "https://fb.com/p", ad_status: "none" });
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { seen.push(`${init?.method ?? "GET"} ${url}`); return json({ id: "c1" }); }));
    const r = await api("POST", `/v1/posts/${post.id}/comment-link`, { productKey: "sua-x" });
    expect(r.statusCode).toBe(200);
    expect(r.json().text).toMatch(/^Link Sữa X & ưu đãi: https:\/\/shopee\.vn\/sua-x/);
    expect(seen.filter((s) => s.startsWith("POST ") && s.endsWith("/PAGE1_5/comments"))).toHaveLength(1);
    const st = await api("GET", `/v1/posts/${post.id}/comment-link`);
    expect(st.json()).toMatchObject({ state: "attached", clicks: 0 });
    const list = (await api("GET", "/v1/posts")).json();
    expect(list.find((p: Row) => p.id === post.id).link.state).toBe("attached");
    expect(list.find((p: Row) => p.id === post.id).comments).toEqual([]); // bình luận của hệ thống không phải bình luận của khách
    const detail = (await api("GET", `/v1/posts/${post.id}`)).json();
    expect(detail.clicks).toBe(0);
    expect(detail.link.state).toBe("attached");
    // bài của doanh nghiệp khác / không tồn tại
    expect((await api("GET", "/v1/posts/khong-co/comment-link")).statusCode).toBe(404);
  });

  it("hộp Duyệt cho thấy TRƯỚC bình luận sẽ được tự gắn (không tạo mã đo); không biết sản phẩm thì không hiện", async () => {
    const goal = insert("goal", { biz_id: B, title: "Sữa X", description: "d", template: "weekly_content", status: "active", params: { product: "sua-x" } });
    const task = insert("task", { biz_id: B, goal_id: goal.id, agent_key: "content", title: "Viết bài", status: "awaiting_approval", input: {}, depends_on: [] });
    insert("content_item", { biz_id: B, goal_id: goal.id, task_id: task.id, agent_key: "content", kind: "social_post", channel: "facebook", title: "Bài sữa", body: "nội dung", status: "awaiting_approval" });
    const ap = insert("approval", { biz_id: B, subject_type: "task", subject_id: task.id, agent_key: "content", title: "Duyệt bài", risk: "medium", status: "pending", preview: {}, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    const d = (await api("GET", `/v1/approvals/${ap.id}`)).json();
    expect(d.subject.linkComment).toMatchObject({ product: { key: "sua-x", name: "Sữa X" }, channel: "Fanpage Shop", url: "https://shopee.vn/sua-x" });
    expect(d.subject.linkComment.text).toBe("Link Sữa X & ưu đãi: https://shopee.vn/sua-x");
    expect(q.scalar<number>("SELECT COUNT(*) FROM track_link")).toBe(0);
    const goal2 = insert("goal", { biz_id: B, title: "Không rõ", description: "d", template: "weekly_content", status: "active", params: {} });
    const task2 = insert("task", { biz_id: B, goal_id: goal2.id, agent_key: "content", title: "Viết bài 2", status: "awaiting_approval", input: {}, depends_on: [] });
    insert("content_item", { biz_id: B, goal_id: goal2.id, task_id: task2.id, agent_key: "content", kind: "social_post", channel: "facebook", title: "Bài khác", body: "nội dung", status: "awaiting_approval" });
    const ap2 = insert("approval", { biz_id: B, subject_type: "task", subject_id: task2.id, agent_key: "content", title: "Duyệt bài 2", risk: "medium", status: "pending", preview: {}, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    expect((await api("GET", `/v1/approvals/${ap2.id}`)).json().subject.linkComment).toBeNull();
  });

  it("cài đặt: mặc định tự gắn BẬT, đoán sản phẩm / link chính TẮT; lưu được; trạng thái đo click", async () => {
    const r = (await api("GET", "/v1/link-comment/settings")).json();
    expect(r.settings).toMatchObject({ auto: true, autoGuess: false, fallbackMain: false });
    expect(r.public).toMatchObject({ clickTracking: false });
    const put = await api("PUT", "/v1/link-comment/settings", { auto: false, facebook: "Mua ngay: {link}" });
    expect(put.json().settings).toMatchObject({ auto: false, autoGuess: false, facebook: "Mua ngay: {link}" });
    expect((await api("PUT", "/v1/link-comment/settings", { auto: "không" })).statusCode).toBe(400);
    expect((await api("GET", "/v1/public/status")).json()).toMatchObject({ listening: false, clickTracking: false });
  });

  it("Sản phẩm của chiến dịch: lưu KEY vào goal.params.product; sản phẩm không có trong DNA → 400", async () => {
    const ok = await api("POST", "/v1/goals", { title: "Chiến dịch sữa", description: "mô tả chiến dịch", template: "weekly_content", product: "Sữa X" });
    expect(ok.statusCode).toBe(200);
    expect(byId<Row>("goal", ok.json().id)!.params).toMatchObject({ product: "sua-x" });
    const bad = await api("POST", "/v1/goals", { title: "Chiến dịch lạ", description: "mô tả chiến dịch", template: "weekly_content", product: "Không có" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("BAD_PRODUCT");
    const none = await api("POST", "/v1/goals", { title: "Không chọn sản phẩm", description: "mô tả chiến dịch", template: "weekly_content" });
    expect(byId<Row>("goal", none.json().id)!.params).toEqual({});
  });

  it("Mục tiêu & DNA: shortLink / commentText được lưu (không bị bộ lọc cắt mất)", async () => {
    const r = await api("PUT", "/v1/dna", { data: { products: [{ key: "sua-x", name: "Sữa X", link: "https://shopee.vn/sua-x", shortLink: "https://s.shopee.vn/AAA", commentText: "Mua: {link}", verified: true }] } });
    expect(r.statusCode).toBe(200);
    const dna = q.get<Row>("SELECT data FROM dna_profile WHERE biz_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1", B)!;
    expect(dna.data.products[0]).toMatchObject({ shortLink: "https://s.shopee.vn/AAA", commentText: "Mua: {link}" });
  });
});

describe("đăng nhập bằng nút (OAuth)", () => {
  it("GET /v1/oauth không trả secret; PUT app mã hóa; chưa có khóa mã hóa → 400 NO_ENCRYPTION_KEY, không lưu", async () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    const no = await api("PUT", "/v1/oauth/facebook/app", { id: "APP1234", secret: "SECRET_VALUE" });
    expect(no.statusCode).toBe(400);
    expect(no.json().code).toBe("NO_ENCRYPTION_KEY");
    expect(no.json().message).toMatch(/TOKEN_ENCRYPTION_KEY/);
    expect((q.get<Row>("SELECT settings FROM biz WHERE id = ?", B)!.settings as Row).oauthApps).toBeUndefined();
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    const ok = await api("PUT", "/v1/oauth/facebook/app", { id: "APP1234", secret: "SECRET_VALUE" });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).not.toContain("SECRET_VALUE");
    expect((await api("GET", "/v1/oauth")).body).not.toContain("SECRET_VALUE");
    expect(JSON.stringify(q.get<Row>("SELECT settings FROM biz WHERE id = ?", B)!.settings)).not.toContain("SECRET_VALUE");
    expect((await api("PUT", "/v1/oauth/zalo/app", { id: "APP1234", secret: "SECRET_VALUE" })).statusCode).toBe(400);
  });

  it("start trả URL đăng nhập (quyền quảng cáo chỉ khi ads=true); callback chạy trên app chính: 302 + no-store, state lạ → oauth_error", async () => {
    await api("PUT", "/v1/oauth/facebook/app", { id: "APP1234", secret: "SECRET_VALUE" });
    const s1 = (await api("POST", "/v1/oauth/facebook/start", { returnTo: "http://localhost:5173/channels" })).json();
    expect(new URL(s1.url).searchParams.get("scope")).not.toMatch(/ads_management/);
    expect(s1.redirectUri).toMatch(/\/v1\/oauth\/facebook\/callback$/);
    const s2 = (await api("POST", "/v1/oauth/facebook/start", { ads: true })).json();
    expect(new URL(s2.url).searchParams.get("scope")).toMatch(/ads_management,ads_read/);
    const cb = await app.inject({ method: "GET", url: "/v1/oauth/facebook/callback?code=ZZZ&state=khong-co" });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers["cache-control"]).toBe("no-store");
    expect(String(cb.headers.location)).toMatch(/oauth_error/);
    expect(String(cb.headers.location)).not.toContain("ZZZ");
  });
});

describe("kênh Instagram / TikTok", () => {
  it("GET /v1/publish-channels: trạng thái địa chỉ công khai + khóa mã hóa; kênh Instagram có apiBlock khi chưa có địa chỉ công khai", async () => {
    insert("channel", { biz_id: B, platform: "instagram", kind: "business", name: "@lanshop", external_id: "IG1", connection_id: fb.connection_id, enabled: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
    const r = (await api("GET", "/v1/publish-channels")).json();
    expect(r.encryptionKey).toBe(true);
    expect(r.public).toMatchObject({ listening: false, clickTracking: false });
    const ig = r.channels.find((c: Row) => c.platform === "instagram");
    expect(ig).toMatchObject({ api: true, route: "none" });
    expect(ig.apiBlock).toMatch(/PUBLIC_BASE_URL/);
  });

  it("PUT tiktok-audited: chỉ cho kênh TikTok đã nối API; bật → đăng công khai qua API", async () => {
    const tc = insert("connection", { biz_id: B, platform: "tiktok_post", external_account_id: "o1", token_ciphertext: encryptSecret(JSON.stringify({ access_token: "A", refresh_token: "R" })), status: "active", mode: "live", config: {} });
    const tt = insert("channel", { biz_id: B, platform: "tiktok", kind: "business", name: "Kênh TT", external_id: "o1", connection_id: tc.id, enabled: 1, meta: {} });
    expect((await api("GET", "/v1/publish-channels")).json().channels.find((c: Row) => c.id === tt.id)).toMatchObject({ audited: false, route: "none" });
    const r = await api("PUT", `/v1/publish-channels/${tt.id}/tiktok-audited`, { audited: true });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ audited: true, route: "api", apiBlock: null });
    expect(q.get("SELECT id FROM audit_log WHERE event = 'channel.tiktok_audited'")).toBeTruthy();
    const handAdded = insert("channel", { biz_id: B, platform: "tiktok", kind: "business", name: "Tay", external_id: "tay", enabled: 1, meta: {} });
    expect((await api("PUT", `/v1/publish-channels/${handAdded.id}/tiktok-audited`, { audited: true })).statusCode).toBe(400);
  });
});
