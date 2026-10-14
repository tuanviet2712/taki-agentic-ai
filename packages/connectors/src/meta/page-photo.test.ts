import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { metaPageConnector } from "./page.ts";

/** Bài viết có ảnh đi kèm: Facebook nhận ẢNH + chữ trong cùng một bài (/photos, caption = nội dung), không đăng chữ rời. Facebook = fetch giả. */
const dir = mkdtempSync(join(tmpdir(), "taki-page-photo-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

describe("publishPost with an image", () => {
  it("uploads the image file with the post text as its caption, published", async () => {
    const file = join(dir, "bai.jpg");
    writeFileSync(file, Buffer.from("JPEG-BYTES"));
    const calls: { url: string; form?: FormData }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), form: init?.body instanceof FormData ? init.body : undefined });
      return new Response(JSON.stringify(String(url).includes("/photos") ? { id: "9001", post_id: "PAGE1_777" } : { permalink_url: "https://www.facebook.com/PAGE1/posts/777" }), { status: 200 });
    }));
    const r = await metaPageConnector("TKN", "PAGE1").publishPost!({ channelExternalId: "PAGE1", text: "Nội dung bài viết #ai", kind: "social_post", media: { path: file, mime: "image/jpeg" } }, "key-1");
    const upload = calls.find((c) => c.url.includes("/PAGE1/photos"))!;
    expect(upload).toBeTruthy();
    expect(calls.some((c) => c.url.includes("/PAGE1/feed"))).toBe(false); // không đăng thêm 1 bài chỉ có chữ
    expect(upload.form!.get("caption")).toBe("Nội dung bài viết #ai");
    expect(upload.form!.get("published")).toBe("true");
    const source = upload.form!.get("source") as File;
    expect(source.type).toBe("image/jpeg");
    expect(Buffer.from(await source.arrayBuffer()).toString()).toBe("JPEG-BYTES");
    expect(r.externalId).toBe("PAGE1_777"); // mã BÀI (post_id), không phải mã ảnh
  });

  it("a post without an image still goes to the feed as text", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(String(url)); return new Response(JSON.stringify({ id: "PAGE1_778", permalink_url: "https://www.facebook.com/PAGE1/posts/778" }), { status: 200 }); }));
    await metaPageConnector("TKN", "PAGE1").publishPost!({ channelExternalId: "PAGE1", text: "Chỉ có chữ", kind: "social_post" }, "key-2");
    expect(urls.some((u) => u.includes("/PAGE1/feed"))).toBe(true);
    expect(urls.some((u) => u.includes("/photos"))).toBe(false);
  });
});
