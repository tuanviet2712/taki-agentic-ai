import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, activeDna, closeDb, insert, openDb } from "@dotaka/db";
import { saveDna } from "./dna-intake.ts";

/** Lỗi gốc: lưu MỘT mục DNA (vd chỉ sửa Định vị) xoá sạch các mục còn lại vì Zod 4 điền mặc định rỗng cho mọi trường vắng. */
let B: string;
const FULL = {
  company: { name: "Công ty X", brand: "X", website: "https://x.vn", industry: "Đào tạo", ceo: "A", scale: "50" },
  positioning: "Thực chiến", mission: "Giúp chủ shop",
  audience: [{ name: "Chủ shop", pains: ["Tốn thời gian"], goals: ["Bán nhiều"] }],
  products: [{ key: "khoa-a", name: "Khoá A", aliases: ["A"], summary: "s", format: "", price: 1_000_000, audience: "", link: "https://x.vn/a", verified: true, delivery: "none", shortLink: "", commentText: "", pancake: null }],
  offers: ["Giảm 25%"], leadMagnet: "Học thử", cta: { text: "Đăng ký", link: "https://x.vn" },
  voice: { style: ["thân thiện"], do: ["ngắn gọn"], dont: ["hứa hẹn"], sample: "Dạ em chào", selfPronoun: "em", customerPronoun: "chị" },
  spokesperson: { name: "Kiểm", gender: "nam", region: "Bắc", age: "40", voiceDesc: "trầm" },
  differentiators: ["Thực chiến"], channels: ["facebook"],
  goals: { yearTarget: 10_000_000_000, currentRunRate: 1_000_000_000, painPoint: "Ads đắt", competitors: ["Y"] },
  forbiddenClaims: ["cam kết thu nhập"], bannedChars: ["!!"], pendingConfirmations: ["Xác nhận giá"],
};

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "X", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  saveDna(B, FULL, "test", { replace: true, source: "intake" });
});
afterAll(() => closeDb());
const dna = () => activeDna(B)!.data as any;

describe("lưu DNA từng mục không làm mất các mục khác", () => {
  it("chỉ sửa Định vị → sản phẩm, khách hàng, giọng, điều cấm… còn nguyên", () => {
    saveDna(B, { positioning: "Định vị mới" }, "Sếp");
    const d = dna();
    expect(d.positioning).toBe("Định vị mới");
    expect(d.products).toHaveLength(1);
    expect(d.products[0]).toMatchObject({ key: "khoa-a", price: 1_000_000, link: "https://x.vn/a" });
    expect(d.audience[0].name).toBe("Chủ shop");
    expect(d.voice.selfPronoun).toBe("em");
    expect(d.forbiddenClaims).toEqual(["cam kết thu nhập"]);
    expect(d.pendingConfirmations).toEqual(["Xác nhận giá"]);
    expect(d.company.website).toBe("https://x.vn");
    expect(d.goals.yearTarget).toBe(10_000_000_000);
  });

  it("lưu mục Sản phẩm (đúng payload của trang DNA) giữ nguyên thương hiệu và giọng", () => {
    saveDna(B, { products: [{ ...FULL.products[0], price: 2_000_000 }, { key: "khoa-b", name: "Khoá B", price: null }] }, "Sếp");
    const d = dna();
    expect(d.products.map((p: any) => p.name)).toEqual(["Khoá A", "Khoá B"]);
    expect(d.products[0].price).toBe(2_000_000);
    expect(d.company.brand).toBe("X");
    expect(d.voice.sample).toBe("Dạ em chào");
    expect(d.positioning).toBe("Định vị mới");
  });

  it("object lồng nhau gộp theo khoá: sửa mỗi lời xưng hô không xoá phong cách / câu mẫu", () => {
    saveDna(B, { voice: { selfPronoun: "mình" } }, "Sếp");
    expect(dna().voice).toMatchObject({ selfPronoun: "mình", customerPronoun: "chị", sample: "Dạ em chào", style: ["thân thiện"] });
    saveDna(B, { company: { website: "https://moi.vn" } }, "Sếp");
    expect(dna().company).toMatchObject({ website: "https://moi.vn", name: "Công ty X", brand: "X", industry: "Đào tạo" });
  });

  it("mảng rỗng người dùng chủ động gửi vẫn được lưu (xoá hết ưu đãi là có chủ ý)", () => {
    saveDna(B, { offers: [] }, "Sếp");
    expect(dna().offers).toEqual([]);
    expect(dna().products).toHaveLength(2);
  });

  it("mỗi lần lưu là một phiên bản mới, giữ lịch sử", () => {
    const v = activeDna(B)!.version;
    saveDna(B, { mission: "Sứ mệnh mới" }, "Sếp");
    expect(activeDna(B)!.version).toBe(v + 1);
    expect(dna().mission).toBe("Sứ mệnh mới");
  });

  it("nhập trọn gói (thay thế) vẫn thay toàn bộ như thiết kế", () => {
    saveDna(B, { company: { name: "Mới", brand: "Mới" }, positioning: "P" }, "Sếp", { replace: true, source: "import" });
    const d = dna();
    expect(d.company.brand).toBe("Mới");
    expect(d.products).toEqual([]);
    expect(d.forbiddenClaims.length).toBeGreaterThan(0); // khung trống mặc định
  });
});
