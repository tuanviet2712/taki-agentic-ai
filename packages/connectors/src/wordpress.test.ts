import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { wordpressConnector, wordpressTest, wpSiteUrl } from "./wordpress.ts";

/** WordPress REST: đăng bài SEO (ảnh + alt + ảnh đại diện + excerpt + slug), không đăng trùng khi chạy lại, chỉ https. fetch giả. */
type Call = { url: string; method: string; auth: string; body: string; headers: Record<string, string> };
let calls: Call[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
function stub(handler: (c: Call) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const c: Call = { url: String(url), method: String(init?.method ?? "GET"), auth: String(headers.authorization ?? ""), body: init?.body instanceof Uint8Array ? "<bytes>" : String(init?.body ?? ""), headers };
    calls.push(c);
    return handler(c);
  }));
}
const dir = mkdtempSync(join(tmpdir(), "wp-test-"));
const img = join(dir, "phan-mem-ai-1.jpg");
writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff]));
afterEach(() => vi.unstubAllGlobals());
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const creds = { site_url: "https://taki.vn/", username: "admin", app_password: "abcd EFGH 1234 ijkl MNOP 5678" };

describe("WordPress", () => {
  it("chỉ nhận https (trừ localhost), bỏ /wp-admin ở cuối địa chỉ", () => {
    expect(wpSiteUrl("taki.vn/wp-admin/")).toBe("https://taki.vn");
    expect(wpSiteUrl("http://localhost:8080/")).toBe("http://localhost:8080");
    expect(() => wpSiteUrl("http://taki.vn")).toThrow(/https/);
  });

  it("kiểm tra kết nối: cần quyền đăng bài + tải ảnh; tự chuyển sang ?rest_route= khi không có /wp-json", async () => {
    stub((c) => {
      if (c.url.includes("/wp-json/")) return new Response("<html>Not found</html>", { status: 404 });
      if (c.url.includes("users%2Fme")) return json({ id: 1, name: "Admin", capabilities: { publish_posts: true, upload_files: true } });
      return json({ name: "TAKI Academy" });
    });
    const t = await wordpressTest(creds);
    expect(t).toEqual({ siteUrl: "https://taki.vn", siteName: "TAKI Academy", user: "Admin", restMode: "query" });
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("admin:abcdEFGH1234ijklMNOP5678").toString("base64")}`);
    stub(() => json({ id: 2, name: "Khách", capabilities: { read: true } }));
    await expect(wordpressTest(creds)).rejects.toThrow(/không có quyền đăng bài/);
  });

  it("đăng bài SEO: tải ảnh + alt, thay link ảnh trong bài, ảnh đầu = ảnh đại diện, excerpt + slug; lưu id ngay để không đăng trùng", async () => {
    stub((c) => {
      if (c.url.endsWith("/wp/v2/media") && c.method === "POST") return json({ id: 77, source_url: "https://taki.vn/wp-content/uploads/phan-mem-ai-1.jpg" });
      if (/\/wp\/v2\/media\/77$/.test(c.url)) return json({ id: 77 });
      if (c.url.endsWith("/wp/v2/posts") && c.method === "POST") return json({ id: 501, link: "https://taki.vn/phan-mem-ai/" });
      return json({ id: 501, status: "publish", link: "https://taki.vn/phan-mem-ai/" });
    });
    const pending: Record<string, unknown>[] = [];
    const c = wordpressConnector({ ...creds, category_id: "12" });
    const res = await c.publishPost!({
      channelExternalId: "https://taki.vn", text: "x", kind: "seo_article", onPending: (s) => pending.push(s),
      article: { title: "Phần mềm AI", html: '<p>Mở bài</p><figure><img src="images/phan-mem-ai-1.jpg" alt="Phần mềm AI"></figure>', excerpt: "Mô tả ngắn", slug: "phan-mem-ai",
        images: [{ src: "images/phan-mem-ai-1.jpg", path: img, name: "phan-mem-ai-1.jpg", mime: "image/jpeg", alt: "Phần mềm AI" }] },
    }, "pub:1");
    expect(res).toEqual({ externalId: "501", permalink: "https://taki.vn/phan-mem-ai/" });
    const upload = calls.find((x) => x.url.endsWith("/wp-json/wp/v2/media"))!;
    expect(upload.headers["content-disposition"]).toBe('attachment; filename="phan-mem-ai-1.jpg"');
    expect(JSON.parse(calls.find((x) => /media\/77$/.test(x.url))!.body)).toEqual({ alt_text: "Phần mềm AI" });
    const post = JSON.parse(calls.find((x) => x.url.endsWith("/wp/v2/posts"))!.body);
    expect(post).toMatchObject({ title: "Phần mềm AI", excerpt: "Mô tả ngắn", slug: "phan-mem-ai", status: "publish", featured_media: 77, categories: [12] });
    expect(post.content).toContain('src="https://taki.vn/wp-content/uploads/phan-mem-ai-1.jpg"');
    expect(post.content).not.toContain("images/");
    expect(pending.at(-1)).toEqual({ wpPostId: 501 });

    // Chạy lại sau khi bài đã tạo: chỉ đọc lại bài, không tải ảnh / tạo bài lần 2.
    stub(() => json({ id: 501, status: "publish", link: "https://taki.vn/phan-mem-ai/" }));
    const again = await c.publishPost!({ channelExternalId: "https://taki.vn", text: "x", kind: "seo_article", resume: { wpPostId: 501 } }, "pub:1");
    expect(again.externalId).toBe("501");
    expect(calls.every((x) => x.method === "GET")).toBe(true);
  });

  it("bản nháp theo cài đặt → draft + ghi chú cho Sếp", async () => {
    stub((c) => (c.url.endsWith("/wp/v2/posts") ? json({ id: 9, link: "https://taki.vn/?p=9" }) : json({})));
    const r = await wordpressConnector({ ...creds, post_status: "draft" }).publishPost!({ channelExternalId: "x", text: "Tiêu đề\n\nĐoạn 1", kind: "post" }, "k");
    expect(r.note).toMatch(/Bản nháp/);
    expect(r.draft).toBe(true);
    expect(JSON.parse(calls[0].body)).toMatchObject({ title: "Tiêu đề", status: "draft" });
    // Cài đặt "công khai" nhưng website ép "Chờ duyệt" → vẫn là nháp (theo trạng thái THẬT website trả về).
    stub(() => json({ id: 10, status: "pending", link: "https://taki.vn/?p=10" }));
    expect(await wordpressConnector(creds).publishPost!({ channelExternalId: "x", text: "a", kind: "post" }, "k")).toMatchObject({ draft: true, note: expect.stringMatching(/Chờ duyệt/) });
  });

  it("xuất bản bài nháp: đổi ĐÚNG bài đó sang công khai; website vẫn giữ nháp → lỗi, không coi là đã đăng", async () => {
    stub(() => json({ id: 9, status: "publish", link: "https://taki.vn/bai-9/" }));
    expect(await wordpressConnector(creds).publishDraftPost!("9", "k")).toEqual({ externalId: "9", permalink: "https://taki.vn/bai-9/" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://taki.vn/wp-json/wp/v2/posts/9" });
    expect(JSON.parse(calls[0].body)).toEqual({ status: "publish" });
    stub(() => json({ id: 9, status: "pending", link: "https://taki.vn/?p=9" }));
    await expect(wordpressConnector(creds).publishDraftPost!("9", "k")).rejects.toMatchObject({ kind: "PolicyRejected" });
  });

  it("sai mật khẩu ứng dụng → AuthError", async () => {
    stub(() => json({ code: "incorrect_password", message: "The provided password is an invalid application password." }, 401));
    await expect(wordpressConnector(creds).publishPost!({ channelExternalId: "x", text: "a", kind: "post" }, "k")).rejects.toMatchObject({ kind: "AuthError" });
  });
});
