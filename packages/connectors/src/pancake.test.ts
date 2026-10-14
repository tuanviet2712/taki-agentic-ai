import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "./errors.ts";
import { PANCAKE_STATUS, pancakeCreateOrder, pancakeFindOrderByMarker, pancakeFindVariations, pancakeGetOrder, pancakeOrderBody, pancakeOrders } from "./live.ts";

/** Pancake POS (Open API): ánh xạ trường tạo đơn, nhãn trạng thái, lỗi nghiệp vụ HTTP 200, tìm lại đơn theo mã chống trùng. Fetch giả. */
const CR = { api_key: "K" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const urls: string[] = [];
const stub = (fn: (u: URL, init?: RequestInit) => Response) => vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => { urls.push(String(input)); return Promise.resolve(fn(new URL(String(input)), init)); }));
afterEach(() => { vi.unstubAllGlobals(); urls.length = 0; });

describe("pancakeOrderBody", () => {
  it("một nơi ánh xạ: người mua, địa chỉ, dòng hàng (variation_id + giá), giảm giá, phí ship, COD, ghi chú có mã chống trùng", () => {
    const b: any = pancakeOrderBody("1001", {
      marker: "TAKI-abc", fullName: "Chị Lan", phone: "0912345678", address: "12 Nguyễn Trãi", provinceId: "01",
      items: [{ variationId: "v1", productId: "p1", name: "Máy lọc", quantity: 2, unitPrice: 1_500_000 }],
      discount: 100_000, shippingFee: 30_000, cod: 2_930_000, note: "Giao giờ hành chính",
    });
    expect(b).toMatchObject({
      shop_id: 1001, bill_full_name: "Chị Lan", bill_phone_number: "0912345678", total_discount: 100_000, shipping_fee: 30_000, cod: 2_930_000,
      shipping_address: { full_name: "Chị Lan", phone_number: "0912345678", address: "12 Nguyễn Trãi", province_id: "01" },
    });
    expect(b.items).toEqual([expect.objectContaining({ variation_id: "v1", product_id: "p1", quantity: 2, variation_info: { name: "Máy lọc", retail_price: 1_500_000 } })]);
    expect(b.note).toBe("Giao giờ hành chính\n[TAKI-abc]");
    const noAddr: any = pancakeOrderBody("shop-x", { marker: "M", fullName: "A", phone: "1", items: [], discount: 0, shippingFee: 0, cod: 0 });
    expect(noAddr.shop_id).toBe("shop-x");
    expect(noAddr.shipping_address.address).toBeUndefined();
  });
});

describe("gọi Pancake POS", () => {
  it("danh sách đơn: nhãn tiếng Việt theo mã trạng thái, api_key đi trên query; tạo đơn trả về mã; success:false → lỗi nghiệp vụ", async () => {
    stub((u, init) => {
      if (init?.method === "POST") return u.pathname.endsWith("/orders") && JSON.parse(String(init.body)).note.includes("BAD") ? json({ success: false, message: "variation_id không hợp lệ" }) : json({ id: 77, display_id: 5, status: 0 });
      return json({ data: [{ id: 1, display_id: 11, status: 3, total_price: 500000, bill_full_name: "A", note: "n", inserted_at: "2026-01-01" }, { id: 2, status: "weird", status_name: "Tên tự do" }] });
    });
    const list = await pancakeOrders(CR, "1001");
    expect(urls[0]).toContain("api_key=K");
    expect(list[0]).toMatchObject({ id: "1", displayId: "11", statusCode: 3, status: PANCAKE_STATUS[3], total: 500000, customer: "A" });
    expect(list[1]).toMatchObject({ id: "2", statusCode: null, status: "Tên tự do" });
    const created = await pancakeCreateOrder(CR, "1001", { marker: "TAKI-1", fullName: "A", phone: "1", items: [], discount: 0, shippingFee: 0, cod: 0 });
    expect(created).toMatchObject({ id: "77", displayId: "5", statusCode: 0, status: "Mới" });
    await expect(pancakeCreateOrder(CR, "1001", { marker: "BAD", fullName: "A", phone: "1", items: [], discount: 0, shippingFee: 0, cod: 0 })).rejects.toMatchObject({ kind: "InvalidRequest" });
  });

  it("api_key sai (HTTP 200 success:false 'api key') → AuthError; 5xx → Transient; tìm mẫu mã gộp thuộc tính", async () => {
    stub(() => json({ success: false, message: "Invalid api key" }));
    await expect(pancakeOrders(CR, "1")).rejects.toMatchObject({ kind: "AuthError" });
    stub(() => json({}, 503));
    await expect(pancakeOrders(CR, "1")).rejects.toBeInstanceOf(ConnectorError);
    stub(() => json({ data: [{ id: "v9", product_id: "p9", display_id: "SKU", retail_price: 99, remain_quantity: 4, product: { name: "Áo" }, fields: [{ value: "Đỏ" }, { value: "L" }] }] }));
    expect(await pancakeFindVariations(CR, "1", "áo")).toEqual([{ id: "v9", productId: "p9", name: "Áo — Đỏ / L", sku: "SKU", price: 99, stock: 4 }]);
  });

  it("tìm lại đơn theo mã trong ghi chú (rồi theo SĐT); getOrder 404 → null", async () => {
    stub((u) => {
      const s = u.searchParams.get("search");
      return json({ data: s === "0912345678" ? [{ id: 5, note: "ghi chú [TAKI-zz]", status: 0 }] : [{ id: 6, note: "khác", status: 0 }] });
    });
    expect(await pancakeFindOrderByMarker(CR, "1", "TAKI-zz", "0912345678")).toMatchObject({ id: "5" });
    expect(await pancakeFindOrderByMarker(CR, "1", "TAKI-none")).toBeNull();
    stub(() => json({ success: false, message: "Order not found" }));
    expect(await pancakeGetOrder(CR, "1", "404")).toBeNull();
  });
});
