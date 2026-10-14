import { describe, expect, it } from "vitest";
import { contentAgent, priceLabel, strategyAgent, systemPrefix, videoAgent, type Dna, type RunContext } from "./index.ts";

/** Số bài tới được model; "Giá" cho sản phẩm thường, "Học phí" chỉ cho khoá học; kênh do Chiến lược giao là chuẩn. */
const dna: Dna = {
  company: { name: "Shop", brand: "Shop", website: "shop.vn", industry: "Mẹ bé", ceo: "A", scale: "nhỏ" },
  positioning: "p", mission: "m", audience: [{ name: "Mẹ bỉm", pains: ["x"], goals: ["y"] }],
  products: [
    { key: "sua-x", name: "Sữa X", summary: "Ít đường; Hộp 1 lít", format: "Affiliate", price: 250_000, link: "https://shop.vn/x" },
    { key: "khoa-ai", name: "Khóa học AI", summary: "Học AI", format: "Online 5 buổi", price: 0 },
  ],
  offers: [], voice: { style: ["thân thiện"], do: [], dont: [], sample: "" }, differentiators: [], forbiddenClaims: [], channels: [],
  goals: { yearTarget: 0, currentRunRate: 0, painPoint: "", competitors: [] },
};
const ctx = (extra: Partial<RunContext> = {}): RunContext => ({
  dna, upstream: {}, knowledge: [], lessons: [], exemplars: [], revision: 0,
  goal: { title: "Tuần nội dung", description: "d", budget_ads: 0 },
  ...extra,
});

describe("ngữ cảnh & kênh giao cho agent viết bài", () => {
  it("Chiến lược: số bài khách yêu cầu tới được model (không chỉ bản mô phỏng)", () => {
    expect(strategyAgent.buildUser({ contentCount: 3 }, ctx())).toContain("contentPlan đúng 3 mục");
    expect(strategyAgent.buildUser({}, ctx())).not.toContain("YÊU CẦU KẾ HOẠCH");
  });

  it("'Học phí' chỉ cho khoá học; sản phẩm thường ghi 'Giá'", () => {
    expect(priceLabel({ name: "Sữa X", format: "Affiliate" })).toBe("Giá");
    expect(priceLabel({ name: "Nồi chiên", format: "COD" })).toBe("Giá");
    expect(priceLabel({ name: "Khóa học AI", format: "Online 5 buổi" })).toBe("Học phí");
    expect(priceLabel({ name: "AI Business System", format: "Offline" })).toBe("Học phí");
    const sys = systemPrefix(dna, contentAgent);
    expect(sys).toContain("Sữa X: Ít đường; Hộp 1 lít. Affiliate. Giá: 250.000đ");
    expect(sys).toContain("Học phí: miễn phí");
  });

  it("kênh do Chiến lược giao là chuẩn — agent viết 'facebook' cho mục tiktok vẫn ra tiktok", () => {
    const out = contentAgent.sandbox({ item: { channel: "facebook", format: "text", topic: "T", angle: "", funnel: "tofu" } }, ctx());
    expect(contentAgent.toContent!(out, { item: { channel: "tiktok" } }).channel).toBe("tiktok");
    expect(contentAgent.toContent!(out, {}).channel).toBe(out.channel); // không có kênh giao → giữ kênh agent chọn
    const vs = videoAgent.sandbox({ item: { channel: "facebook" } }, ctx());
    expect(videoAgent.toContent!(vs, { item: { channel: "instagram" } }).channel).toBe("instagram");
  });
});
