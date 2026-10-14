import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, insert, openDb } from "@dotaka/db";
import type { Dna } from "@dotaka/agents";
import { amountsIn, deterministicChecks, reviewOutput } from "./review.ts";

/** Kiểm giá: chấp nhận số tiền có trong ưu đãi/chính sách; lỗi chữ "sửa được", lỗi kỹ thuật video thì không. */
const dna = {
  company: { name: "Shop", brand: "Shop", website: "shop.vn", industry: "x", ceo: "A", scale: "nhỏ" },
  positioning: "p", mission: "m", audience: [{ name: "Mẹ", pains: [], goals: [] }],
  products: [{ key: "sua-x", name: "Sữa X", summary: "s", format: "Affiliate", price: 250_000, offer: "Giảm còn 219.000đ tuần này" }],
  offers: ["Freeship đơn từ 300k"], voice: { style: [], do: [], dont: [], sample: "" }, differentiators: [], forbiddenClaims: ["khỏi bệnh"], channels: [],
  goals: { yearTarget: 0, currentRunRate: 0, painPoint: "", competitors: [] },
} as unknown as Dna;
const post = (body: string) => ({ channel: "facebook", format: "text", title: "T", variants: [{ key: "A", hook: "Hook", body, cta: "Mua", hashtags: [] }], facts: [], productRefs: [], openQuestions: [] });
const priceCheck = (body: string, allowed: string[] = []) => deterministicChecks("content_social", post(body), dna, [], 0, allowed).find((c) => c.check === "Giá khớp DNA")!;

describe("Review: giá & lỗi sửa được", () => {
  beforeAll(() => { process.env.DB_PATH = ":memory:"; openDb(":memory:"); });
  afterAll(() => closeDb());

  it("amountsIn hiểu 50.000đ / 30k / 1,2 triệu", () => {
    expect(amountsIn("giảm 50.000đ, thêm 30k, tối đa 1,2 triệu")).toEqual(expect.arrayContaining(["50000", "30000", "1200000"]));
  });

  it("giá niêm yết, ưu đãi sản phẩm, ưu đãi DNA, chính sách chiến dịch đều hợp lệ; số lạ vẫn bị bắt", () => {
    expect(priceCheck("Giá 250.000đ").passed).toBe(true);
    expect(priceCheck("Chỉ còn 219.000đ").passed).toBe(true); // ưu đãi của sản phẩm
    expect(priceCheck("Freeship đơn từ 300.000đ").passed).toBe(true); // DNA offers "300k"
    expect(priceCheck("Ship 25.000đ toàn quốc").passed).toBe(false);
    expect(priceCheck("Ship 25.000đ toàn quốc", ["Phí ship 25k toàn quốc"]).passed).toBe(true); // chính sách chiến dịch
    expect(priceCheck("Giá sốc 99.000đ").passed).toBe(false);
  });

  it("lỗi nghiêm trọng ở chữ → fixable; lỗi kỹ thuật video (caller) → không fixable", async () => {
    const biz = insert("biz", { name: "R", settings: { llm: { provider: "sandbox" } } }).id;
    const r1 = await reviewOutput({ bizId: biz, subjectType: "task", subjectId: "t1", rubricKey: "content_social", output: post("Uống là khỏi bệnh ngay, giá 99.000đ"), dna });
    expect(r1.verdict).toBe("block");
    expect(r1.fixable).toBe(true);
    const r2 = await reviewOutput({ bizId: biz, subjectType: "content_item", subjectId: "c1", rubricKey: "video_final", output: { caption: "ok", script: [] }, dna,
      extraChecks: [{ check: "Có file MP4 hợp lệ", passed: false, severity: "fatal" }] });
    expect(r2.verdict).toBe("block");
    expect(r2.fixable).toBe(false);
  });
});
