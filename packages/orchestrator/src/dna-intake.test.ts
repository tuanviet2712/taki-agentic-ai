import { describe, expect, it } from "vitest";
import { DnaDraft, blankDna, mergeDnaParts } from "./dna-intake.ts";

const A = { company: { name: "Công ty X", brand: "X", website: "https://x.vn", industry: "Đào tạo", ceo: "", scale: "" }, positioning: "Thực chiến", voice: { selfPronoun: "em", customerPronoun: "anh/chị" }, forbiddenClaims: [] };
const B = { products: [{ key: "khoa-a", name: "Khoá A", price: 1000000, pancake: { variationId: "v1", shopId: "s" }, shortLink: "http://bịa", commentText: "bịa" }, { name: "Khoá B", price: null }], offers: ["Giảm 25%"] };

describe("ghép bản nháp DNA từ 2 lượt AI", () => {
  it("lượt công ty + lượt sản phẩm thành một DNA hợp lệ", () => {
    const d = mergeDnaParts(A, B);
    expect(DnaDraft.safeParse(d).success).toBe(true);
    expect(d.company.brand).toBe("X");
    expect(d.products.map((p) => p.name)).toEqual(["Khoá A", "Khoá B"]);
    expect(d.offers).toEqual(["Giảm 25%"]);
    expect(d.products[1].price).toBeNull();
  });
  it("AI không được điền mã Pancake, link rút gọn, câu bình luận riêng", () => {
    const [p] = mergeDnaParts(A, B).products;
    expect(p.pancake).toBeNull();
    expect(p.shortLink).toBe("");
    expect(p.commentText).toBe("");
  });
  it("giữ danh sách cấm mặc định dù AI trả rỗng, không nhân đôi khi AI đã có", () => {
    expect(mergeDnaParts(A, B).forbiddenClaims).toEqual(blankDna().forbiddenClaims);
    const d = mergeDnaParts({ ...A, forbiddenClaims: ["Cam kết thu nhập", "không bán thuốc"] }, B);
    expect(d.forbiddenClaims.filter((c) => c.toLowerCase() === "cam kết thu nhập")).toHaveLength(1);
    expect(d.forbiddenClaims).toContain("không bán thuốc");
  });
  it("thiếu lượt sản phẩm vẫn ra DNA hợp lệ (mảng rỗng)", () => {
    const d = mergeDnaParts(A, {});
    expect(d.products).toEqual([]);
    expect(d.offers).toEqual([]);
  });
});
