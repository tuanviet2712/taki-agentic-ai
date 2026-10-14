import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { commentFor, findLinkProduct, linkCommentSettings, linkCommentText, productForContent, saveLinkCommentSettings } from "./link-product.ts";

/** Sản phẩm của bài (DNA products[]): thứ tự tín hiệu, shortLink > link, chữ bình luận mặc định (Instagram không hứa nhắn tin). */
let B: string;
const ci = (extra: Row = {}) => insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "facebook", title: "Bài viết", body: "nội dung chung chung", status: "approved", ...extra });

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  insert("dna_profile", {
    biz_id: B, version: 1, status: "active", created_by: "test",
    data: {
      company: { name: "Shop Lan", brand: "Lan Shop" }, cta: { text: "Nhắn tin", link: "chinh.vn" },
      products: [
        { key: "sua-x", name: "Sữa X", aliases: ["sữa non"], link: "shopee.vn/sua-x", shortLink: "https://s.shopee.vn/AAA", commentText: "Mua Sữa X: {link}", verified: true },
        { key: "", name: "Khoá Học Y", aliases: [], link: "https://taki.vn/khoa-y", verified: true },
        { key: "khong-link", name: "Sản phẩm Z", link: "", verified: false },
      ],
    },
  });
});
afterAll(() => closeDb());

describe("tìm sản phẩm DNA", () => {
  it("khớp theo key / tên / tên gọi khác (không phân biệt dấu); key rỗng → slug của tên; shortLink > link; thêm https://", () => {
    expect(findLinkProduct(B, "sua-x")).toMatchObject({ key: "sua-x", url: "https://s.shopee.vn/AAA", link: "https://shopee.vn/sua-x", shortLink: "https://s.shopee.vn/AAA" });
    expect(findLinkProduct(B, "SỮA NON")?.key).toBe("sua-x");
    expect(findLinkProduct(B, "Khoá Học Y")).toMatchObject({ key: "khoa-hoc-y", url: "https://taki.vn/khoa-y" });
    expect(findLinkProduct(B, "khoa-hoc-y")?.name).toBe("Khoá Học Y");
    expect(findLinkProduct(B, "san-pham-z")?.url).toBeNull();
    expect(findLinkProduct(B, "không có")).toBeNull();
  });
});

describe("sản phẩm của một nội dung", () => {
  it("1. goal.params.product thắng; 2. autopilot.product; 3. video của sản phẩm; không có tín hiệu → null (mặc định không đoán)", () => {
    const g1 = insert("goal", { biz_id: B, title: "Chiến dịch Sữa", description: "d", template: "weekly_content", status: "active", params: { product: "sua-x" } });
    expect(productForContent(ci({ goal_id: g1.id }))).toMatchObject({ key: "sua-x", why: "campaign" });
    const g2 = insert("goal", { biz_id: B, title: "Lái tự động", description: "d", template: "weekly_content", status: "active", params: { autopilot: { product: "khoa-hoc-y" } } });
    expect(productForContent(ci({ goal_id: g2.id }))).toMatchObject({ key: "khoa-hoc-y", why: "autopilot" });
    const video = ci({ kind: "video" });
    insert("creative_job", { biz_id: B, tool: "auto-video", title: "V", input: { product: "Khoá Học Y" }, status: "done", content_item_id: video.id });
    expect(productForContent(video)).toMatchObject({ key: "khoa-hoc-y", why: "video" });
    expect(productForContent(ci({ title: "Bài nói về Sữa X rất nhiều", body: "Sữa X ngon" }))).toBeNull(); // không đoán theo tên
    expect(productForContent(ci())).toBeNull();
  });
  it("video làm từ kịch bản: lấy chiến dịch của kịch bản gốc", () => {
    const g = insert("goal", { biz_id: B, title: "G", description: "d", template: "weekly_content", status: "active", params: { product: "khoa-hoc-y" } });
    const script = ci({ goal_id: g.id, kind: "video_script" });
    const video = ci({ kind: "video" });
    insert("creative_job", { biz_id: B, tool: "auto-video", title: "V", input: {}, status: "done", content_item_id: video.id, source_content_id: script.id });
    expect(productForContent(video)).toMatchObject({ key: "khoa-hoc-y", why: "campaign" });
  });
  it("bật autoGuess / fallbackMain thì mới đoán theo tên / dùng link chính", () => {
    expect(linkCommentSettings(B)).toMatchObject({ auto: true, autoGuess: false, fallbackMain: false });
    saveLinkCommentSettings(B, { autoGuess: true }, "test");
    expect(productForContent(ci({ title: "Review sữa non cho bé" }))).toMatchObject({ key: "sua-x", why: "guess" });
    saveLinkCommentSettings(B, { autoGuess: false, fallbackMain: true }, "test");
    expect(productForContent(ci())).toMatchObject({ why: "main", url: "https://chinh.vn" });
    saveLinkCommentSettings(B, { fallbackMain: false }, "test");
    expect(productForContent(ci())).toBeNull();
    expect(q.get<Row>("SELECT settings FROM biz WHERE id = ?", B)!.settings.llm.provider).toBe("sandbox"); // không làm mất cài đặt khác
  });
});

describe("chữ bình luận", () => {
  it("Facebook: mặc định có link; câu riêng của sản phẩm ưu tiên và tự thêm link nếu thiếu {link}", () => {
    expect(linkCommentText(B, "facebook", { link: "https://x.vn/a", product: "Sữa X" })).toBe("Link Sữa X & ưu đãi: https://x.vn/a");
    expect(linkCommentText(B, "facebook", { link: "https://x.vn/a", product: "Sữa X" }, "Mua Sữa X: {link}")).toBe("Mua Sữa X: https://x.vn/a");
    expect(linkCommentText(B, "facebook", { link: "https://x.vn/a" }, "Ưu đãi hôm nay")).toBe("Ưu đãi hôm nay https://x.vn/a");
  });
  it("Instagram: hướng về link ở bio, KHÔNG hứa nhắn tin / inbox; không chèn link không bấm được", () => {
    const t = linkCommentText(B, "instagram", { link: "https://x.vn/a", shop: "@lanshop" });
    expect(t).toBe("Link sản phẩm ở bio của @lanshop 👆");
    expect(t).not.toMatch(/nhắn|inbox|tin nhắn|DM/i);
  });
  it("commentFor: bình luận hoàn chỉnh theo kênh + link có UTM", () => {
    const channel = { platform: "facebook", name: "Fanpage Lan" } as Row;
    const p = findLinkProduct(B, "sua-x", "campaign")!;
    const r = commentFor({ bizId: B, product: p, channel, ci: ci() });
    expect(r.text).toMatch(/^Mua Sữa X: https:\/\/s\.shopee\.vn\/AAA\?utm_source=facebook/);
    const manual = commentFor({ bizId: B, product: p, channel, ci: ci(), urlOverride: "https://khac.vn/z", textOverride: "Xem {link} nhé" });
    expect(manual.text).toMatch(/^Xem https:\/\/khac\.vn\/z\?utm_source=facebook.* nhé$/);
  });
});
