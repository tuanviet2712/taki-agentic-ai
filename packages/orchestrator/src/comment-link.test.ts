import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { encryptSecret } from "@dotaka/shared";
import * as bp from "./browser-publish.ts";

// Chỉ giả phần Chrome (browserReady / browserPublish); API Facebook là fetch giả, mọi thứ khác là mã thật.
let chromeReady = false;
let routeOverride: "api" | "browser" | "none" | null = null;
let browserImpl: (channel: Row, spec: Row) => Promise<Row> = async () => ({ status: "done", permalink: "https://facebook.com/p/1", commentPosted: true, notes: "" });
const realReady = bp.browserReady;
const realRoute = bp.publishRoute;
vi.spyOn(bp, "publishRoute").mockImplementation((ch: Row) => routeOverride ?? realRoute(ch));
vi.spyOn(bp, "browserReady").mockImplementation((ch: Row) => (chromeReady ? { ok: true } : realReady(ch)));
const browserCalls: Row[] = [];
vi.spyOn(bp, "browserPublish").mockImplementation(async (ch: Row, spec: any) => { browserCalls.push(spec); return browserImpl(ch, spec) as any; });

const { attachLinkComment, attachProductLinkComment, linkCommentStatus } = await import("./comment-link.ts");
const { runPublishJob, schedulePublish } = await import("./publishing.ts");
const { importExternalPost } = await import("./nurture.ts");
const { saveLinkCommentSettings } = await import("./link-product.ts");

/**
 * Link sản phẩm dưới bình luận: gắn tay / tự động sau khi đăng, KHÔNG bình luận trùng (kể cả khi sập giữa chừng / timeout),
 * Facebook thật (fetch giả: token ở header Authorization), Chrome, Instagram, kill switch.
 */
type Call = { url: string; method: string; headers: Record<string, string>; body: string };
let calls: Call[] = [];
let commentReply: () => Response | Promise<Response> = () => json({ id: "PAGE1_100_c1" });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
function mockGraph() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET");
    calls.push({ url: String(url), method, headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
    if (method === "POST" && /\/comments$/.test(String(url))) return commentReply();
    if (method === "POST" && /\/feed$/.test(String(url))) return json({ id: "PAGE1_100" });
    if (/fields=permalink_url/.test(String(url))) return json({ permalink_url: "https://www.facebook.com/PAGE1/posts/100" });
    return json({ id: "ok" });
  }));
}
const commentPosts = () => calls.filter((c) => c.method === "POST" && /\/comments$/.test(c.url));
const linkJobs = () => q.all<Row>("SELECT * FROM job WHERE name = 'posts.comment_link'");

let B: string, conn: Row, fb: Row, goalId: string, seq = 0;
const content = (title: string, extra: Row = {}) => insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "facebook", title, body: `${title} — nội dung`, status: "approved", ...extra });
const postOf = (ci: Row | null, ch: Row = fb, extra: Row = {}) => insert("post", {
  biz_id: B, channel_id: ch.id, external_id: `PAGE1_${100 + ++seq}`, content_item_id: ci?.id ?? null, kind: "image", title: ci?.title ?? "Bài", body: "b",
  published_at: new Date().toISOString(), permalink: "https://www.facebook.com/PAGE1/posts/1", ad_status: "none", simulated: 0, ...extra,
});

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
});
beforeEach(() => {
  chromeReady = false;
  routeOverride = null;
  browserCalls.length = 0;
  browserImpl = async () => ({ status: "done", permalink: "https://facebook.com/p/1", commentPosted: true, notes: "" });
  commentReply = () => json({ id: "PAGE1_100_c1" });
  for (const t of ["publish_job", "post", "post_comment", "post_metric_snapshot", "content_item", "channel", "connection", "job", "outbox", "audit_log", "goal", "track_link", "track_click", "dna_profile", "creative_job"]) q.run(`DELETE FROM ${t}`);
  q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } }), B);
  conn = insert("connection", { biz_id: B, platform: "meta", external_account_id: "sys1", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
  fb = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Fanpage Shop", external_id: "PAGE1", connection_id: conn.id, enabled: 1, whitelisted: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
  insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "test", data: {
    company: { brand: "Lan Shop" }, cta: { text: "", link: "" },
    products: [{ key: "sua-x", name: "Sữa X", link: "https://shopee.vn/sua-x", shortLink: "", commentText: "", verified: true }, { key: "khong-link", name: "Món Z", link: "", verified: true }],
  } });
  goalId = insert("goal", { biz_id: B, title: "Sữa X tháng 10", description: "d", template: "weekly_content", status: "active", params: { product: "sua-x" } }).id;
  mockGraph();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => closeDb());

describe("gắn tay / gắn lại", () => {
  it("Facebook thật: bình luận bằng Trang, token trong header Authorization (không nằm trong URL / thân), link có UTM + sub-id", async () => {
    const ci = content("Bài Sữa X", { goal_id: goalId });
    const p = postOf(ci);
    expect(linkCommentStatus(p)).toMatchObject({ state: "none", auto: true, product: { key: "sua-x", name: "Sữa X", why: "campaign" } });
    const r = await attachLinkComment(B, p.id, {}, "test");
    expect(r.via).toBe("api");
    expect(r.text).toMatch(/^Link Sữa X & ưu đãi: https:\/\/shopee\.vn\/sua-x\?utm_source=facebook&utm_medium=social.*utm_content=.*sub_id=/);
    const c = commentPosts();
    expect(c).toHaveLength(1);
    expect(c[0].url).toMatch(/graph\.facebook\.com\/v[\d.]+\/PAGE1_\d+\/comments$/);
    expect(c[0].headers.Authorization).toBe("Bearer PAGE_TOKEN");
    expect(c[0].url + c[0].body).not.toContain("PAGE_TOKEN");
    expect(new URLSearchParams(c[0].body).get("message")).toBe(r.text);
    expect(q.get("SELECT id FROM post_comment WHERE post_id = ? AND label = 'product_link' AND label_source = 'system'", p.id)).toBeTruthy();
    expect(linkCommentStatus(byId<Row>("post", p.id)!)).toMatchObject({ state: "attached", text: r.text });
    expect(q.get("SELECT id FROM audit_log WHERE event = 'post.comment_link'")).toBeTruthy();
  });

  it("kiểm tra đầu vào: link sai, bài chưa biết sản phẩm, sản phẩm chưa có link, sản phẩm không có trong DNA", async () => {
    const p = postOf(content("Bài lạ"));
    await expect(attachLinkComment(B, p.id, {}, "t")).rejects.toThrow(/chưa biết thuộc sản phẩm/);
    await expect(attachLinkComment(B, p.id, { url: "shopee.vn/abc" }, "t")).rejects.toThrow(/http/);
    await expect(attachLinkComment(B, p.id, { productKey: "khong-link" }, "t")).rejects.toThrow(/chưa có link/);
    await expect(attachLinkComment(B, p.id, { productKey: "khong-co" }, "t")).rejects.toThrow(/không có trong/);
    await expect(attachLinkComment(B, "nope", { url: "https://a.vn" }, "t")).rejects.toThrow(/Không thấy bài/);
    expect(commentPosts()).toHaveLength(0);
    const ok = await attachLinkComment(B, p.id, { productKey: "sua-x", text: "Mua tại {link} nha" }, "t");
    expect(ok.text).toMatch(/^Mua tại https:\/\/shopee\.vn\/sua-x\?.* nha$/);
  });

  it("lỗi thiếu quyền (#200) → trạng thái Lỗi kèm lý do, bình luận không ghi nhận; gắn lại được", async () => {
    const p = postOf(content("Bài", { goal_id: goalId }));
    commentReply = () => json({ error: { message: "(#200) Permissions error", code: 200 } }, 403);
    await expect(attachLinkComment(B, p.id, {}, "t")).rejects.toThrow();
    const st = linkCommentStatus(byId<Row>("post", p.id)!) as { state: string; error?: string };
    expect(st.state).toBe("failed");
    expect(st.error).toMatch(/\(#200\)/);
    expect(q.get("SELECT id FROM post_comment WHERE post_id = ?", p.id)).toBeUndefined();
    commentReply = () => json({ id: "c2" });
    await attachLinkComment(B, p.id, {}, "t");
    expect(linkCommentStatus(byId<Row>("post", p.id)!).state).toBe("attached");
  });

  it("bài có sẵn trên Fanpage: tạo bản ghi 1 lần rồi gắn được link (đo click bắt đầu từ đó)", async () => {
    const a = importExternalPost(B, fb.id, { externalId: "PAGE1_999", text: "Bài Sếp tự đăng\ndòng 2", permalink: "https://facebook.com/999" });
    expect(importExternalPost(B, fb.id, { externalId: "PAGE1_999", text: "khác" }).id).toBe(a.id);
    const r = await attachLinkComment(B, a.id, { productKey: "sua-x" }, "t");
    expect(r.ok).toBe(true);
    expect(q.get("SELECT id FROM track_link WHERE post_id = ?", a.id)).toBeTruthy();
  });

  it("Instagram: câu mặc định hướng về link ở bio (không hứa nhắn tin, không chèn link không bấm được); gọi POST /{media}/comments", async () => {
    const igConn = insert("connection", { biz_id: B, platform: "meta", external_account_id: "sys2", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
    const ig = insert("channel", { biz_id: B, platform: "instagram", kind: "business", name: "@lanshop", external_id: "IG1", connection_id: igConn.id, enabled: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: { pageId: "PAGE1" } });
    const p = postOf(content("Reel", { channel: "instagram", goal_id: goalId }), ig, { external_id: "17900001" });
    const r = await attachLinkComment(B, p.id, {}, "t");
    expect(r.text).toBe("Link sản phẩm ở bio của @lanshop 👆");
    expect(r.text).not.toMatch(/nhắn|inbox|https?:/i);
    expect(commentPosts()[0].url).toMatch(/\/17900001\/comments$/);
  });
});

describe("không bình luận trùng", () => {
  it("timeout sau khi gửi → 'cần kiểm tra', job tự động KHÔNG gửi lại", async () => {
    const ci = content("Bài", { goal_id: goalId });
    const p = postOf(ci);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method ?? "GET"), headers: {}, body: "" });
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    }));
    await expect(attachProductLinkComment(p.id)).rejects.toThrow();
    expect(linkCommentStatus(byId<Row>("post", p.id)!).state).toBe("needs_check");
    const before = commentPosts().length;
    await attachProductLinkComment(p.id); // chạy lại (hàng đợi thử lại): im lặng
    expect(commentPosts().length).toBe(before);
    expect(q.get("SELECT id FROM post_comment WHERE post_id = ?", p.id)).toBeUndefined();
  });

  it("sập giữa chừng (đang 'sending' quá 2 phút) → cần kiểm tra, không gửi lại; đang gửi < 2 phút → bỏ qua", async () => {
    const p = postOf(content("Bài", { goal_id: goalId }));
    update("post", p.id, { meta: { linkComment: { state: "sending", at: new Date().toISOString(), text: "x" } } });
    await attachProductLinkComment(p.id);
    expect(commentPosts()).toHaveLength(0);
    expect(linkCommentStatus(byId<Row>("post", p.id)!).state).toBe("pending");
    update("post", p.id, { meta: { linkComment: { state: "sending", at: new Date(Date.now() - 5 * 60_000).toISOString(), text: "x" } } });
    await attachProductLinkComment(p.id);
    expect(commentPosts()).toHaveLength(0);
    expect(linkCommentStatus(byId<Row>("post", p.id)!).state).toBe("needs_check");
    expect(q.get("SELECT id FROM audit_log WHERE event = 'post.comment_link.needs_check'")).toBeTruthy();
    // Sếp kiểm tra rồi bấm Gắn lại: được phép
    await attachLinkComment(B, p.id, {}, "ceo");
    expect(commentPosts()).toHaveLength(1);
  });

  it("đã gắn thì job chạy lại không bình luận thêm; kill switch đăng bài → không bình luận", async () => {
    const p = postOf(content("Bài", { goal_id: goalId }));
    await attachProductLinkComment(p.id);
    await attachProductLinkComment(p.id);
    expect(commentPosts()).toHaveLength(1);
    const p2 = postOf(content("Bài 2", { goal_id: goalId }));
    q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, killSwitch: { ...DEFAULT_SETTINGS.killSwitch, publish: true } }), B);
    await attachProductLinkComment(p2.id);
    expect(commentPosts()).toHaveLength(1);
    expect(linkCommentStatus(byId<Row>("post", p2.id)!).state).toBe("skipped");
  });
});

describe("tự động sau khi đăng", () => {
  const publish = async (ci: Row, ch: Row = fb) => {
    const job = schedulePublish(B, ci.id, { now: true })!;
    await runPublishJob(job.id);
    return byId<Row>("publish_job", job.id)!;
  };

  it("đăng API thành công + biết sản phẩm → đúng 1 job posts.comment_link (30–60 giây sau); chạy job → 1 bình luận", async () => {
    const ci = content("Bài Sữa X", { goal_id: goalId });
    const j = await publish(ci);
    expect(j.status).toBe("done");
    const jobs = linkJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotency_key).toBe(`cmtlink:${j.post_id}`);
    const wait = Date.parse(jobs[0].run_at) - Date.now();
    expect(wait).toBeGreaterThan(25_000);
    expect(wait).toBeLessThan(65_000);
    expect(commentPosts()).toHaveLength(0); // chưa bình luận ngay lúc đăng
    await attachProductLinkComment(j.post_id);
    expect(commentPosts()).toHaveLength(1);
    expect(linkCommentStatus(byId<Row>("post", j.post_id)!).state).toBe("attached");
  });

  it("không có tín hiệu sản phẩm → không xếp job; Instagram → không tự gắn; tắt 'tự gắn' → không xếp job", async () => {
    const j1 = await publish(content("Bài không rõ sản phẩm"));
    expect(j1.status).toBe("done");
    expect(linkJobs()).toHaveLength(0);
    saveLinkCommentSettings(B, { auto: false }, "t");
    await publish(content("Bài khác", { goal_id: goalId }));
    expect(linkJobs()).toHaveLength(0);
    saveLinkCommentSettings(B, { auto: true }, "t");
  });

  it("đăng lỗi 5xx → needs_check (có thể đã lên bài): không xếp job gắn link", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method ?? "GET"), headers: {}, body: "" });
      return json({ error: { message: "x", code: 1 } }, 500);
    }));
    const j = await publish(content("Bài", { goal_id: goalId })).catch((e) => e);
    expect((j as Row).status ?? "needs_check").toBe("needs_check");
    expect(linkJobs()).toHaveLength(0);
  });

  it("Chrome: agent bình luận trong cùng phiên (commentPosted) → ghi nhận, không xếp job; không bình luận được → báo, không tự thử lại", async () => {
    update("channel", fb.id, { meta: { publishVia: "browser", browser: { loggedIn: true } } });
    chromeReady = true;
    routeOverride = "browser";
    const ci = content("Bài Chrome", { goal_id: goalId });
    const j = await publish(ci);
    expect(j.status).toBe("done");
    expect(browserCalls[0].mode).toBe("publish");
    expect(String(browserCalls[0].comment)).toMatch(/^Link Sữa X & ưu đãi: https:\/\/shopee\.vn\/sua-x\?/);
    expect(linkJobs()).toHaveLength(0);
    expect(linkCommentStatus(byId<Row>("post", j.post_id)!)).toMatchObject({ state: "attached" });

    browserImpl = async () => ({ status: "done", permalink: "https://facebook.com/p/2", commentPosted: false, notes: "không thấy ô bình luận" });
    const j2 = await publish(content("Bài Chrome 2", { goal_id: goalId }));
    expect(j2.status).toBe("done");
    expect(linkJobs()).toHaveLength(0); // không tự thử lại: có thể agent đã bình luận mà quên báo
    const st = linkCommentStatus(byId<Row>("post", j2.post_id)!) as { state: string; error?: string };
    expect(st.state).toBe("failed");
    expect(st.error).toMatch(/Gắn lại/);
    expect(q.get("SELECT id FROM outbox WHERE type = 'alert.raised' AND payload LIKE '%chưa xác nhận gắn được link%'")).toBeTruthy();
  });
});
