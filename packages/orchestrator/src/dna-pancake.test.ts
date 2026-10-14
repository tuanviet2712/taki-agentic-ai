import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, activeDna, closeDb, insert, openDb, q, type Row } from "@dotaka/db";

/** AI nạp DNA không bao giờ được bịa mã Pancake; lưu DNA giữ `delivery` / `pancake`; ghép mẫu mã không viết lại sản phẩm khác. */
vi.mock("@dotaka/llm-gateway", async (orig) => ({
  ...(await orig<typeof import("@dotaka/llm-gateway")>()),
  generate: vi.fn(async () => ({
    model: "fake",
    output: {
      company: { name: "Shop", brand: "Shop", website: "", industry: "", ceo: "", scale: "" },
      products: [
        { key: "a", name: "Sản phẩm A", delivery: "ship", pancake: { variationId: "BỊA", productId: "BỊA", variationName: "BỊA", price: 1, shopId: "x" } },
        { key: "b", name: "Khóa B", delivery: "none" },
      ],
    },
  })),
}));
const { DnaDraft, draftDnaFromText, saveDna, setProductPancake } = await import("./dna-intake.ts");

let B: string;
beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
});
afterAll(() => closeDb());

describe("DNA ↔ Pancake", () => {
  it("schema giữ delivery / pancake của sản phẩm (zod không xoá), mặc định delivery rỗng + pancake null", () => {
    const p = DnaDraft.parse({ products: [{ name: "X", delivery: "ship", pancake: { variationId: "v1", shopId: "1" } }, { name: "Y" }] }).products;
    expect(p[0]).toMatchObject({ delivery: "ship", pancake: { variationId: "v1", productId: null, variationName: null, price: null, shopId: "1" } });
    expect(p[1]).toMatchObject({ delivery: "", pancake: null });
    expect(() => DnaDraft.parse({ products: [{ name: "X", delivery: "bay" }] })).toThrow();
  });

  it("bản nháp từ AI: delivery giữ, pancake luôn null (không bịa mã mẫu mã)", async () => {
    const { draft } = await draftDnaFromText(B, "Mô tả doanh nghiệp. ".repeat(10));
    expect(draft.products.map((p) => [p.key, p.delivery, p.pancake])).toEqual([["a", "ship", null], ["b", "none", null]]);
  });

  it("saveDna (sửa sản phẩm trên trang DNA) giữ nguyên pancake + delivery; setProductPancake chỉ đổi đúng 1 trường của 1 sản phẩm, khoá lạ giữ nguyên", () => {
    insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "test", data: { company: { name: "Shop" }, products: [
      { key: "a", name: "Sản phẩm A", summary: "", format: "", price: 100, delivery: "ship", pancake: null, sample: true, tuyChon: 7 },
      { key: "b", name: "Khóa B", summary: "", format: "", price: null, delivery: "none", pancake: null },
    ] } });
    const v2 = setProductPancake(B, "a", { variationId: "v1", productId: "p1", variationName: "A đỏ", price: 90, shopId: "1001" }, "Sếp");
    expect(v2.version).toBe(2);
    const prods = activeDna(B)!.data.products as Row[];
    expect(prods[0]).toMatchObject({ key: "a", sample: true, tuyChon: 7, pancake: { variationId: "v1", shopId: "1001" } });
    expect(prods[1]).toEqual({ key: "b", name: "Khóa B", summary: "", format: "", price: null, delivery: "none", pancake: null });
    // Sếp sửa tên + giá ở trang DNA (editor gửi nguyên mục sản phẩm kèm pancake) → pancake không mất
    saveDna(B, { products: prods.map((p) => (p.key === "a" ? { ...p, price: 120, name: "Sản phẩm A+" } : p)) }, "Sếp");
    const after = (activeDna(B)!.data.products as Row[])[0];
    expect(after).toMatchObject({ name: "Sản phẩm A+", price: 120, delivery: "ship", pancake: { variationId: "v1", productId: "p1", variationName: "A đỏ", price: 90, shopId: "1001" } });
    // bỏ ghép
    setProductPancake(B, "a", null, "Sếp");
    expect((activeDna(B)!.data.products as Row[])[0].pancake).toBeNull();
    expect(() => setProductPancake(B, "khong-co", null, "Sếp")).toThrow(/Không thấy sản phẩm/);
    expect(q.scalar("SELECT COUNT(*) FROM dna_profile WHERE biz_id = ? AND status = 'active'", B)).toBe(1);
  });
});
