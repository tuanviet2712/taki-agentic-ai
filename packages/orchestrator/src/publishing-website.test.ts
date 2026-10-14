import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { createConnection } from "./connections.ts";
import { publishWebsiteDraft, runPublishJob, schedulePublish, syncWebsiteDrafts, updateWebsitePost } from "./publishing.ts";
import { liveWebsitePost, seoImagesView } from "./seo-images.ts";
import { channelPublishInfo } from "./browser-publish.ts";

/**
 * Kênh website WordPress: kết nối bằng mật khẩu ứng dụng → tự tạo/nhận kênh "website" → bài SEO đã duyệt đăng THẬT qua REST
 * (ảnh trong bài tải lên + alt, ảnh đại diện, excerpt = meta, slug theo từ khoá). WordPress = fetch giả; DB :memory:.
 */
type Call = { url: string; method: string; body: string };
let calls: Call[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
let B = "";
let tmp = "";
/** Bài mới tạo trên WordPress: id + trạng thái website trả về (nháp khi cài đặt / plugin ép). */
let wp = { nextId: 900, status: "publish" };
beforeAll(() => {
  openDb(":memory:");
  tmp = mkdtempSync(join(tmpdir(), "taki-website-"));
  B = insert("biz", { name: "TAKI", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const c = { url: String(url), method: String(init?.method ?? "GET"), body: init?.body instanceof Uint8Array ? "<bytes>" : String(init?.body ?? "") };
    calls.push(c);
    if (c.url.includes("/wp/v2/users/me")) return json({ id: 1, name: "Admin", capabilities: { publish_posts: true, upload_files: true } });
    if (c.url.endsWith("/wp-json/")) return json({ name: "TAKI Academy" });
    if (c.url.endsWith("/wp/v2/media") && c.method === "POST") return json({ id: 31, source_url: "https://taki.vn/wp-content/uploads/ung-dung-ai-1.jpg" });
    if (/\/wp\/v2\/media\/\d+$/.test(c.url)) return json({ id: 31 });
    if (c.url.endsWith("/wp/v2/posts") && c.method === "POST") return json({ id: wp.nextId, link: wp.nextId === 900 ? "https://taki.vn/ung-dung-ai/" : `https://taki.vn/?p=${wp.nextId}` });
    if (/\/wp\/v2\/posts\/900/.test(c.url)) return json({ id: 900, status: "publish", link: "https://taki.vn/ung-dung-ai/" });
    const m = /\/wp\/v2\/posts\/(\d+)(?:\?|$)/.exec(c.url);
    if (m) {
      if (c.method === "POST" && JSON.parse(c.body).status === "publish") wp.status = "publish";
      return json({ id: Number(m[1]), status: wp.status, link: wp.status === "publish" ? `https://taki.vn/bai-${m[1]}/` : `https://taki.vn/?p=${m[1]}` });
    }
    return json({ code: "rest_no_route", message: "No route" }, 404);
  }));
});
afterEach(() => { calls = []; });
afterAll(() => { vi.unstubAllGlobals(); closeDb(); rmSync(tmp, { recursive: true, force: true }); });

describe("kênh website WordPress", () => {
  it("kết nối → nhận kênh website thêm tay sẵn có → bài SEO đăng thật, ảnh có alt, ảnh đại diện, không đo số liệu giả", async () => {
    const manual = insert("channel", { biz_id: B, platform: "website", kind: "blog", name: "Website", external_id: "ch_website", enabled: 1, whitelisted: 1, meta: {} });
    const conn = await createConnection(B, { platform: "wordpress", mode: "live", credentials: { app_password: "abcd efgh ijkl" }, config: { site_url: "https://taki.vn", username: "admin" } }, "CEO");
    expect(conn.display_name).toBe("TAKI Academy (WordPress)");
    const ch = byId<Row>("channel", manual.id)!;
    expect(ch).toMatchObject({ connection_id: conn.id, external_id: "https://taki.vn", name: "TAKI Academy" });
    expect(channelPublishInfo(ch).route).toBe("api");
    // Mật khẩu ứng dụng chỉ nằm trong token đã mã hoá, không lộ ra cấu hình.
    expect(JSON.stringify(byId<Row>("connection", conn.id)!.config)).not.toContain("abcd");

    const file = join(tmp, "a.jpg");
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff]));
    const asset = insert("creative_asset", { biz_id: B, kind: "image", path: file, mime: "image/jpeg", width: 1200, height: 675, meta: { filename: "ung-dung-ai-1.jpg" } });
    const ci = insert("content_item", {
      biz_id: B, agent_key: "seo_web", kind: "seo_article", channel: "website", title: "Ứng dụng AI cho doanh nghiệp", status: "approved", asset_id: asset.id,
      body: `Meta: Hướng dẫn ứng dụng AI cho doanh nghiệp nhỏ.\nTừ khóa: ứng dụng ai\n\nMở bài về AI.\n\n![Ứng dụng AI trong doanh nghiệp](/v1/media/${asset.id})\n\n## Bước 1\n\nNội dung bước 1.`,
    });
    const job = schedulePublish(B, ci.id, { now: true })!;
    await runPublishJob(job.id);
    const j = byId<Row>("publish_job", job.id)!;
    expect(j.status).toBe("done");
    expect(byId<Row>("post", j.post_id)).toMatchObject({ external_id: "900", permalink: "https://taki.vn/ung-dung-ai/", kind: "article" });
    const post = JSON.parse(calls.find((c) => c.url.endsWith("/wp/v2/posts") && c.method === "POST")!.body);
    expect(post).toMatchObject({ title: "Ứng dụng AI cho doanh nghiệp", excerpt: "Hướng dẫn ứng dụng AI cho doanh nghiệp nhỏ.", slug: "ung-dung-ai", status: "publish", featured_media: 31 });
    expect(post.content).toContain('src="https://taki.vn/wp-content/uploads/ung-dung-ai-1.jpg"');
    expect(post.content).toContain("<h2>Bước 1</h2>");
    expect(post.content).not.toMatch(/Meta:|Từ khóa:|\/v1\/media/);
    expect(q.scalar<number>("SELECT COUNT(*) FROM job WHERE name = 'posts.snapshot'")).toBe(0);

    // Bài ĐÃ ĐĂNG vẫn thêm ảnh được (không khoá) và cập nhật đúng bài #900 trên WordPress — không tạo bài mới.
    expect(liveWebsitePost(byId<Row>("content_item", ci.id)!)).toBe("https://taki.vn/ung-dung-ai/");
    expect(seoImagesView(byId<Row>("content_item", ci.id)!)).toMatchObject({ locked: false, liveUrl: "https://taki.vn/ung-dung-ai/" });
    calls = [];
    await updateWebsitePost(ci.id);
    const upd = calls.find((c) => /\/wp\/v2\/posts\/900$/.test(c.url) && c.method === "POST")!;
    expect(JSON.parse(upd.body)).toMatchObject({ excerpt: "Hướng dẫn ứng dụng AI cho doanh nghiệp nhỏ.", featured_media: 31 });
    expect(JSON.parse(upd.body)).not.toHaveProperty("slug");
    expect(calls.some((c) => c.url.endsWith("/wp/v2/posts") && c.method === "POST")).toBe(false);
  });

  it("website để bài ở Bản nháp → nội dung 'Nháp trên kênh' (vẫn ở hàng Đăng bài, không bị coi là đã đăng); Đăng ngay công khai ĐÚNG bài đó", async () => {
    const conn = q.get<Row>("SELECT * FROM connection WHERE biz_id = ? AND platform = 'wordpress'", B)!;
    q.run("UPDATE connection SET config = ? WHERE id = ?", JSON.stringify({ ...conn.config, post_status: "draft" }), conn.id);
    wp = { nextId: 5422, status: "draft" };
    const ci = insert("content_item", {
      biz_id: B, agent_key: "seo_web", kind: "seo_article", channel: "website", title: "AI cho doanh nghiệp: bắt đầu từ đâu", status: "approved",
      body: "Meta: Mô tả.\nTừ khóa: ai doanh nghiệp\n\nMở bài.\n\n## Phần 1\n\nNội dung.",
    });
    const job = schedulePublish(B, ci.id, { now: true })!;
    await runPublishJob(job.id);
    expect(byId<Row>("publish_job", job.id)!.status).toBe("done");
    expect(byId<Row>("content_item", ci.id)!.status).toBe("draft_on_channel");
    const post = q.get<Row>("SELECT * FROM post WHERE content_item_id = ?", ci.id)!;
    expect(post.meta).toMatchObject({ draft: true, note: expect.stringMatching(/Bản nháp/) });

    calls = [];
    const r = await publishWebsiteDraft(B, ci.id, "CEO");
    expect(r.permalink).toBe("https://taki.vn/bai-5422/");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["https://taki.vn/wp-json/wp/v2/posts/5422"]); // không tạo bài thứ 2
    expect(byId<Row>("content_item", ci.id)!.status).toBe("published");
    expect(byId<Row>("post", post.id)).toMatchObject({ permalink: "https://taki.vn/bai-5422/", meta: {} });
    await expect(publishWebsiteDraft(B, ci.id, "CEO")).rejects.toMatchObject({ code: "NOT_DRAFT" });
  });

  it("bộ canh: bài cũ bị ghi 'đã đăng' nhưng còn NHÁP trên WordPress → về hàng Đăng bài; Sếp tự xuất bản trên WordPress → 'Đã xuất bản'", async () => {
    const ch = q.get<Row>("SELECT * FROM channel WHERE biz_id = ? AND platform = 'website'", B)!;
    const ci = insert("content_item", { biz_id: B, agent_key: "seo_web", kind: "seo_article", channel: "website", title: "Bài cũ bị miss", status: "published", body: "Meta: m\nTừ khóa: k\n\nThân bài." });
    const post = insert("post", { biz_id: B, channel_id: ch.id, external_id: "5432", content_item_id: ci.id, kind: "article", title: ci.title, body: "x", published_at: new Date().toISOString(), permalink: "https://taki.vn/?p=5432", ad_status: "none", simulated: 0,
      meta: { note: 'Bài nằm ở trạng thái "Bản nháp" trên website (theo cài đặt kết nối) — vào WordPress để xuất bản.' } });
    wp.status = "draft";
    expect(await syncWebsiteDrafts()).toEqual({ drafts: 1, published: 0 });
    expect(byId<Row>("content_item", ci.id)!.status).toBe("draft_on_channel");
    expect(byId<Row>("post", post.id)!.meta).toMatchObject({ draft: true });
    expect(await syncWebsiteDrafts()).toEqual({ drafts: 0, published: 0 }); // không báo lặp lại

    wp.status = "publish"; // Sếp bấm Xuất bản ngay trên WordPress
    expect(await syncWebsiteDrafts()).toEqual({ drafts: 0, published: 1 });
    expect(byId<Row>("content_item", ci.id)!.status).toBe("published");
    expect(byId<Row>("post", post.id)).toMatchObject({ permalink: "https://taki.vn/bai-5432/", meta: {} });
  });
});
