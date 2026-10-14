import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, insert, openDb, q, update } from "@dotaka/db";

/** Ảnh đi kèm bài viết: khi nào tạo, trang thiết kế có an toàn để dựng không, và ảnh có theo bài tới lượt đăng không. */
const cwd = process.cwd();
const work = mkdtempSync(join(tmpdir(), "taki-postimg-test-"));
let mod: typeof import("./post-image.ts");
let pub: typeof import("./publishing.ts");
beforeAll(async () => {
  process.env.DB_PATH = ":memory:"; openDb(":memory:");
  process.chdir(work); // data/uploads + data/creative của test nằm trong thư mục tạm
  mod = await import("./post-image.ts");
  pub = await import("./publishing.ts");
});
afterAll(() => { process.chdir(cwd); rmSync(work, { recursive: true, force: true }); });

// PNG 1×1 hợp lệ (đủ phần đầu IHDR để đọc kích thước).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let B = "";
const post = (over: Record<string, unknown> = {}) => insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "facebook", title: "Thuê thêm người", body: "Nội dung bài viết.", status: "in_review", ...over });
const upload = (name: string, data: Buffer = PNG) => { const dir = join(work, "data", "uploads"); mkdirSync(dir, { recursive: true }); const p = join(dir, name); writeFileSync(p, data); return p; };

beforeEach(() => {
  for (const t of ["biz", "content_item", "creative_asset", "audit_log"]) q.run(`DELETE FROM ${t}`);
  B = insert("biz", { name: "Shop", timezone: "Asia/Ho_Chi_Minh", currency: "VND", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
});

describe("design page → safe to render", () => {
  it("drops scripts / embeds / external tags and locks the page with a CSP placed first", () => {
    const h = mod.safeDesignHtml(`<!doctype html><html><head><link rel="stylesheet" href="https://x.test/a.css"><meta http-equiv="refresh" content="0;url=file:///C:/secret"><style>body{color:red}</style></head>
      <body><script>fetch("file:///C:/secret")</script><iframe src="file:///C:/Users"></iframe><h1>Tiêu đề</h1><svg><circle r="4"/></svg></body></html>`);
    expect(h).not.toMatch(/<script|<iframe|<link|http-equiv="refresh"/i);
    expect(h).toContain("<h1>Tiêu đề</h1>"); expect(h).toContain("<svg>");
    expect(h.indexOf("Content-Security-Policy")).toBeLessThan(h.indexOf("<style>body{color:red}"));
    expect(h).toContain("default-src 'none'");
    expect(h).toContain(`width:${mod.POST_IMAGE.width}px!important;height:${mod.POST_IMAGE.height}px!important`);
  });
  it("wraps a bare fragment (and a fenced answer) into a full page", () => {
    const h = mod.safeDesignHtml("```html\n<div>Xin chào</div>\n```");
    expect(h).toMatch(/^<!doctype html>/i); expect(h).toContain("<div>Xin chào</div>"); expect(h).toContain("Content-Security-Policy");
  });
});

describe("what the image model is told", () => {
  it("never passes the plan's internal funnel label to the image", () => {
    expect(mod.publicTitle("TOFU - Vì sao chủ doanh nghiệp nên học AI")).toBe("Vì sao chủ doanh nghiệp nên học AI");
    expect(mod.publicTitle("BOFU #2: Mời tư vấn lộ trình (BOFU)")).toBe("Mời tư vấn lộ trình");
    expect(mod.publicTitle("Tofu chiên giòn ngon")).toBe("Tofu chiên giòn ngon"); // không phải nhãn: không có dấu ngăn
    const ci = post({ title: "TOFU - Thuê thêm người", body: "Thân bài." });
    for (const text of [mod.claudeDesignPrompt(ci, undefined).user, mod.chatgptImagePrompt(ci, undefined).prompt]) {
      expect(text).toContain("Tiêu đề: Thuê thêm người"); expect(text).not.toContain("TOFU -");
    }
    expect(mod.chatgptImagePrompt(ci, undefined, "nền sáng hơn").prompt).toContain("nền sáng hơn");
    expect(mod.claudeDesignPrompt(ci, undefined).system).toContain(`${mod.POST_IMAGE.width}×${mod.POST_IMAGE.height}px`);
  });
});

describe("when a post gets an image", () => {
  it("only social posts, only when the image is missing or made for older text; the CEO's own image is kept", () => {
    expect(mod.needsPostImage(post({ kind: "video_script" }))).toBe(false);
    expect(mod.needsPostImage(post({ kind: "seo_article" }))).toBe(false);
    const ci = post();
    expect(mod.needsPostImage(ci)).toBe(true);
    const file = upload("a.png");
    const ai = insert("creative_asset", { biz_id: B, kind: "image", path: file, mime: "image/png", meta: { source: "ai", bodyHash: mod.bodyHash(ci) } });
    update("content_item", ci.id, { asset_id: ai.id });
    expect(mod.needsPostImage(byId("content_item", ci.id)!)).toBe(false);
    update("content_item", ci.id, { body: "Nội dung đã viết lại." });
    expect(mod.needsPostImage(byId("content_item", ci.id)!)).toBe(true); // ảnh AI cũ không còn khớp
    const mine = insert("creative_asset", { biz_id: B, kind: "image", path: file, mime: "image/png", meta: { source: "upload" } });
    update("content_item", ci.id, { asset_id: mine.id });
    expect(mod.needsPostImage(byId("content_item", ci.id)!)).toBe(false);
  });
  it("never blocks the post: no AI connection or the switch off → skipped, post untouched", async () => {
    const ci = post();
    expect(await mod.ensurePostImage(B, ci.id)).toEqual({ skipped: "no_ai" }); // sandbox
    update("biz", B, { settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" }, content: { autoImage: false } } });
    expect(await mod.ensurePostImage(B, ci.id)).toEqual({ skipped: "off" });
    expect(byId<any>("content_item", ci.id)!.asset_id ?? null).toBeNull();
    await expect(mod.createPostImage(B, ci.id)).rejects.toMatchObject({ code: "IMAGE_AI_OFF" });
  });
});

describe("the CEO's own image, removing it, and publishing", () => {
  it("accepts an uploaded JPG/PNG only from data/uploads and attaches it to the post", () => {
    const ci = post();
    const a = mod.setPostImageFromUpload(B, ci.id, upload("anh.png"), "ceo");
    expect(a).toMatchObject({ kind: "image", mime: "image/png", width: 1, height: 1 });
    expect(byId<any>("content_item", ci.id)!.asset_id).toBe(a.id);
    const outside = join(work, "ngoai.png"); writeFileSync(outside, PNG);
    expect(() => mod.setPostImageFromUpload(B, ci.id, outside, "ceo")).toThrow(/tải lên/);
    expect(() => mod.setPostImageFromUpload(B, ci.id, upload("gia.png", Buffer.from("không phải ảnh")), "ceo")).toThrow(/JPG hoặc PNG/);
    expect(() => mod.setPostImageFromUpload(B, ci.id, upload("a.gif"), "ceo")).toThrow(/JPG hoặc PNG/);
  });
  it("the attached image is the media of the publish job; removing it leaves a text-only post", () => {
    const ci = post({ status: "approved" });
    const a = mod.setPostImageFromUpload(B, ci.id, upload("anh.png"), "ceo");
    const media = pub.mediaOf(byId("content_item", ci.id)!);
    expect(media).toMatchObject({ path: a.path, mime: "image/png" });
    expect(mod.postImageView(byId("content_item", ci.id)!)).toMatchObject({ supported: true, locked: false, asset: { id: a.id, source: "upload", stale: false } });
    mod.removePostImage(B, ci.id, "ceo");
    expect(pub.mediaOf(byId("content_item", ci.id)!)).toBeUndefined();
    expect(mod.postImageView(byId("content_item", ci.id)!)!.asset).toBeNull();
  });
  it("locks the image once the post is scheduled or published", () => {
    const ci = post({ status: "scheduled" });
    expect(() => mod.setPostImageFromUpload(B, ci.id, upload("anh.png"), "ceo")).toThrow(/đã lên lịch/i);
    expect(() => mod.removePostImage(B, ci.id, "ceo")).toThrow(/đã lên lịch/i);
    expect(mod.postImageView(ci)!.locked).toBe(true);
  });
  it("reads PNG dimensions from the file header", () => {
    expect(mod.imageSize(upload("s.png"))).toEqual({ width: 1, height: 1 });
  });
});
