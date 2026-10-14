import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { contentAgent } from "@dotaka/agents";

/** Quy tắc ảnh bài SEO (4 ảnh / 1000 chữ, tối thiểu 4) áp cho MỌI bài website — không còn bài website lọt thành "bài mạng xã hội" 1 ảnh. */
vi.mock("./image-engine.ts", async (orig) => ({ ...(await orig<typeof import("./image-engine.ts")>()), postImageEngine: () => ({ engine: "claude", chosen: "claude" }) }));
const { upgradeWebsitePosts, seoImagesShortReason } = await import("./seo-images.ts");
const { decideApproval } = await import("./approvals.ts");

let B = "";
beforeEach(() => { openDb(":memory:"); B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id; });
afterEach(() => closeDb());
const para = (n: number, s: string) => Array.from({ length: n }, (_, i) => `từ${s}${i}`).join(" ");

describe("bài website luôn theo quy tắc ảnh SEO", () => {
  it("agent viết bài giao kênh website → bài SEO (Meta + từ khoá, không hashtag); kênh khác vẫn là bài mạng xã hội", () => {
    const out = { title: "Lộ trình 90 ngày", format: "text", channel: "facebook", variants: [{ key: "A", hook: "Mở bài", body: "Thân bài", cta: "Đăng ký", hashtags: ["#AI"] }] } as never;
    const web = contentAgent.toContent!(out, { item: { channel: "website", topic: "lộ trình AI 90 ngày" } });
    expect(web).toMatchObject({ kind: "seo_article", channel: "website" });
    expect(web.body).toMatch(/^Meta: .+\nTừ khóa: lộ trình AI 90 ngày\n\nMở bài/);
    expect(web.body).not.toContain("#AI");
    expect(contentAgent.toContent!(out, { item: { channel: "facebook" } }).kind).toBe("social_post");
  });

  it("bài website cũ đang chờ duyệt (1 ảnh) → chuyển bài SEO, bỏ hashtag, xếp tạo bù ảnh ưu tiên; bài kênh khác để nguyên", () => {
    const body = `Mở bài.\n\n${para(300, "a")}\n\n${para(300, "b")}\n\nĐăng ký ngay.\n\n#AI #HeThong`;
    const web = insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "website", title: "Lộ trình 90 ngày", body, status: "awaiting_approval" });
    const fb = insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "facebook", title: "Bài FB", body, status: "awaiting_approval" });
    expect(upgradeWebsitePosts()).toBe(1);
    const after = byId<Row>("content_item", web.id)!;
    expect(after.kind).toBe("seo_article");
    expect(after.body).toMatch(/^Meta: .+\nTừ khóa: Lộ trình 90 ngày\n\nMở bài\./);
    expect(after.body).not.toMatch(/#AI/);
    expect(byId<Row>("content_item", fb.id)!.kind).toBe("social_post");
    expect(q.scalar<number>("SELECT COUNT(*) FROM job WHERE name = 'seo.images' AND queue = 'image' AND json_extract(payload, '$.contentItemId') = ?", web.id)).toBe(1);
    expect(upgradeWebsitePosts()).toBe(0); // chạy lại an toàn
  });

  it("cổng duyệt: bài SEO chưa đủ ảnh thì không duyệt được (mục duyệt vẫn mở)", async () => {
    const t = insert("task", { biz_id: B, agent_key: "seo_web", title: "Bài SEO", status: "awaiting_approval", input: {}, depends_on: [] });
    const ci = insert("content_item", { biz_id: B, agent_key: "seo_web", kind: "seo_article", channel: "website", title: "Bài SEO", body: `Meta: m\nTừ khóa: k\n\n${para(500, "x")}\n\n${para(500, "y")}`, status: "awaiting_approval", task_id: t.id });
    const ap = insert("approval", { biz_id: B, subject_type: "task", subject_id: t.id, agent_key: "seo_web", title: "Bài SEO", risk: "low", status: "pending", preview: {} });
    expect(seoImagesShortReason(ci)).toMatch(/0\/4 ảnh/);
    await expect(decideApproval(B, ap.id, "approve", undefined, undefined)).rejects.toMatchObject({ code: "SEO_IMAGES_MISSING" });
    expect(byId<Row>("approval", ap.id)!.status).toBe("pending");
  });
});
