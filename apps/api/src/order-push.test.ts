import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, activeDna, byId, closeDb, db, insert, openDb, q, update, type Row } from "@dotaka/db";
import { handleIncoming, setConversationConnector } from "@dotaka/chat-engine";
import type { Connector } from "@dotaka/connectors";
import { HANDLERS, ensureBizSchedules, expireApprovals } from "@dotaka/orchestrator";
import { encryptSecret } from "@dotaka/shared";
import { errorHandler } from "./http.ts";
import { chatRoutes } from "./routes/chat.ts";
import { orderRoutes } from "./routes/orders.ts";
import { workRoutes } from "./routes/work.ts";

/**
 * Chốt đơn → duyệt [ĐỎ] → (tuỳ chọn) đẩy Pancake POS. Offline: DB :memory:, fetch giả cho Pancake, Fanpage là connector giả.
 * Luật cần giữ: không đẩy POS nếu thiếu phiếu `pushToPancake:true` HOẶC thiếu `meta.approvalId`; không SĐT thật trong preview / audit / job /
 * orders.meta / phản hồi API; không Pancake giả lập; không đơn trùng khi gửi lại; trạng thái thủ công không đè lên Pancake.
 */
const PHONE = "0912345678";
const COURSE = { key: "khoa-ai", name: "Khóa AI Marketing", aliases: ["AI Marketing"], summary: "Khóa học offline 3 ngày", price: 12_000_000, format: "Offline", delivery: "none", sample: true, extraKey: "giữ-nguyên" };
const GOODS = { key: "may-loc", name: "Máy lọc không khí Mini", aliases: ["máy lọc"], summary: "Máy lọc không khí để bàn", price: 1_500_000, format: "Hàng hoá", delivery: "ship" };
const DNA = {
  company: { name: "Shop Mẫu", brand: "Shop Mẫu", industry: "Bán lẻ" }, voice: { selfPronoun: "em", customerPronoun: "anh/chị" },
  offers: [], forbiddenClaims: [], bannedChars: [], products: [COURSE, GOODS],
};

// ---- Pancake giả
type Call = { method: string; url: string; body: any };
const calls: Call[] = [];
let pancakeOrders: Record<string, any> = {}; // id -> đơn Pancake giả
let nextId = 9000;
let failPost: "none" | "timeout" | "reject" = "none";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
function fakeFetch(input: unknown, init?: RequestInit) {
  const url = String(input);
  const method = String(init?.method ?? "GET");
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url, body });
  const u = new URL(url);
  if (!u.hostname.includes("pos.pages.fm")) throw new Error(`mạng thật bị gọi: ${url}`);
  const path = u.pathname.replace("/api/v1", "");
  if (method === "POST" && /\/shops\/1001\/orders$/.test(path)) {
    if (failPost === "timeout") { failPost = "none"; pancakeOrders[`late${nextId}`] = { id: ++nextId, display_id: nextId, status: 0, note: body.note, bill_full_name: body.bill_full_name, total_price: 0 }; throw new TypeError("fetch failed (timeout)"); }
    if (failPost === "reject") return json({ success: false, message: "variation_id không hợp lệ" });
    const o = { id: ++nextId, display_id: 100 + nextId, status: 0, note: body.note, bill_full_name: body.bill_full_name, total_price: body.items.reduce((s: number, i: any) => s + i.variation_info.retail_price * i.quantity, 0) };
    pancakeOrders[String(o.id)] = o;
    return json(o);
  }
  if (method === "GET" && /\/shops\/1001\/orders\/(\d+)$/.test(path)) {
    const id = path.split("/").pop()!;
    return pancakeOrders[id] ? json({ data: pancakeOrders[id] }) : json({ success: false, message: "not found" });
  }
  if (method === "GET" && /\/shops\/1001\/orders$/.test(path)) {
    const search = u.searchParams.get("search");
    const all = Object.values(pancakeOrders);
    return json({ data: search ? all.filter((o) => String(o.note ?? "").includes(search)) : all });
  }
  if (method === "GET" && /\/shops\/1001\/products\/variations$/.test(path)) {
    return json({ data: [{ id: "var-1", product_id: "prod-1", display_id: "SKU1", retail_price: 1_400_000, product: { name: "Máy lọc không khí Mini" }, fields: [{ value: "Trắng" }] }] });
  }
  return json({ success: false, message: `route lạ ${path}` }, 404);
}

const sentToCustomer: string[] = [];
const fakeLive = (): Connector => ({
  platform: "meta", mode: "live", limits: { requestsPerMinute: 60, concurrency: 2 },
  health: async () => ({ ok: true, detail: "fake" }),
  sendMessage: async (spec) => { sentToCustomer.push(spec.text); return { externalId: `m_out_${sentToCustomer.length}` }; },
});

let app: FastifyInstance;
let B: string;
let conn: Row;
const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, payload: payload as any, headers: { "x-biz-id": B } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
let seq = 0;
/** Khách chốt mua qua chat thật (bot) → đơn nháp [ĐỎ]. */
async function draft(productName: string, phone = PHONE): Promise<{ approvalId: string; conversationId: string }> {
  const ext = `psid_${++seq}`;
  const r = await handleIncoming(B, { channel: "messenger", externalConversationId: ext, customerName: `Khách ${seq}`, text: `Em muốn đăng ký ${productName}, sđt ${phone}`, messageId: `mm${seq}`, pageExternalId: "PAGE1" });
  const a = q.get<Row>("SELECT * FROM approval WHERE biz_id = ? AND subject_type = 'order_draft' AND subject_id = ?", B, r.conversationId);
  if (!a) throw new Error(`không có đơn nháp cho ${productName}`);
  return { approvalId: a.id, conversationId: r.conversationId };
}
const runPush = async (orderId: string) => {
  const job = q.get<Row>("SELECT * FROM job WHERE name = 'order.push_pancake' AND json_extract(payload, '$.orderId') = ? ORDER BY created_at DESC", orderId)!;
  return HANDLERS["order.push_pancake"](job.payload, job);
};
const orderOf = (convId: string) => q.get<Row>("SELECT * FROM orders WHERE conversation_id = ?", convId);
const postsToPancake = () => calls.filter((c) => c.method === "POST");
const FORM = { fullName: "Chị Lan", phone: PHONE, address: "12 Nguyễn Trãi, Thanh Xuân, Hà Nội", quantity: 1, discount: 0, shippingFee: 30_000, note: "Giao giờ hành chính", pushToPancake: true };

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Mẫu", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "test", data: DNA });
  conn = insert("connection", {
    biz_id: B, platform: "pancake", external_account_id: "1001", display_name: "Shop A", token_ciphertext: encryptSecret(JSON.stringify({ api_key: "KEY-SECRET" })),
    scopes: [], status: "active", mode: "live", config: { shops: [{ externalId: "1001", name: "Shop A" }] },
  });
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  chatRoutes(app); workRoutes(app); orderRoutes(app);
  await app.ready();
});
afterAll(async () => { await app.close(); setConversationConnector(() => null); closeDb(); });
beforeEach(() => {
  calls.length = 0; sentToCustomer.length = 0; failPost = "none";
  setConversationConnector(() => fakeLive());
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});
afterEach(() => vi.unstubAllGlobals());

describe("duyệt đơn nháp không phiếu → đơn nội bộ, KHÔNG đẩy Pancake", () => {
  it("approve không phiếu: đơn pending, pancake.state=off, không job, không gọi mạng; đơn mang approvalId + product_key", async () => {
    const d = await draft("Khóa AI Marketing");
    insert("attribution_link", { biz_id: B, conversation_id: d.conversationId, source: "facebook_ads", method: "asked", confidence: 0.6 });
    const res = await call("POST", `/v1/approvals/${d.approvalId}/decide`, { decision: "approve" });
    expect(res.status).toBe(200);
    const o = orderOf(d.conversationId)!;
    expect(o).toMatchObject({ status: "pending", product: "Khóa AI Marketing", product_key: "khoa-ai", total: 12_000_000, source: "facebook_ads" });
    expect(o.meta.approvalId).toBe(d.approvalId);
    expect(o.meta.pancake).toMatchObject({ state: "off" });
    expect(q.scalar("SELECT COUNT(*) FROM job WHERE name = 'order.push_pancake'")).toBe(0);
    expect(calls).toHaveLength(0);
    // đã duyệt rồi không duyệt lại (không đơn trùng)
    expect((await call("POST", `/v1/approvals/${d.approvalId}/decide`, { decision: "approve" })).status).toBeGreaterThanOrEqual(400);
    expect(q.scalar("SELECT COUNT(*) FROM orders WHERE conversation_id = ?", d.conversationId)).toBe(1);
  });

  it("phiếu pushToPancake:false → vẫn off, không gọi mạng; từ chối → không có đơn", async () => {
    const a = await draft("Khóa AI Marketing");
    await call("POST", `/v1/approvals/${a.approvalId}/decide`, { decision: "approve", orderForm: { fullName: "Chị A", pushToPancake: false } });
    expect(orderOf(a.conversationId)!.meta.pancake.state).toBe("off");
    const b = await draft("Khóa AI Marketing");
    await call("POST", `/v1/approvals/${b.approvalId}/decide`, { decision: "reject", note: "khách ảo" });
    expect(orderOf(b.conversationId)).toBeUndefined();
    expect(byId<Row>("approval", b.approvalId)!.status).toBe("rejected");
    expect(calls).toHaveLength(0);
  });

  it("duyệt hàng loạt không áp dụng cho đơn nháp (cần phiếu)", async () => {
    const d = await draft("Khóa AI Marketing");
    const r = await call("POST", "/v1/approvals/bulk-decide", { ids: [d.approvalId], decision: "approve" });
    expect(r.body[0].error).toMatch(/phiếu lên đơn/);
    expect(byId<Row>("approval", d.approvalId)!.status).toBe("pending");
    expect(orderOf(d.conversationId)).toBeUndefined();
  });

  it("chi tiết mục duyệt + ngữ cảnh phiếu: có hội thoại / khách; gợi ý SĐT lấy từ hồ sơ khách, preview chỉ bản che", async () => {
    const d = await draft("Máy lọc không khí Mini");
    const detail = await call("GET", `/v1/approvals/${d.approvalId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.subject.conversation.id).toBe(d.conversationId);
    expect(detail.body.subject.lead.phone).toBe(PHONE); // hồ sơ khách (đã có sẵn ở trang Chat)
    expect(detail.body.preview.phoneMasked).toBe("0912***678");
    expect(JSON.stringify(detail.body.preview)).not.toContain(PHONE);
    const ctx = await call("GET", `/v1/orders/draft/${d.approvalId}`);
    expect(ctx.body).toMatchObject({
      product: { key: "may-loc", needsShipping: true }, defaults: { phone: PHONE, unitPrice: 1_500_000 },
      pancake: { connected: true, mapped: false, shopName: "Shop A" }, pushDefault: false, pushPossible: false,
    });
    expect(ctx.body.blockLink).toBe("/dna?pancake=map");
    expect((await call("GET", "/v1/orders/draft/khong-co")).status).toBe(404);
  });
});

describe("ghép sản phẩm DNA ↔ Pancake (lưu trên sản phẩm trong DNA)", () => {
  it("PUT ghi products[].pancake (kèm shopId) thành phiên bản DNA mới; sản phẩm khác + khoá lạ giữ nguyên; DELETE gỡ", async () => {
    const before = activeDna(B)!;
    const v = await call("GET", "/v1/pancake/variations?search=m%C3%A1y");
    expect(v.body).toMatchObject({ shopId: "1001", shopName: "Shop A", items: [{ id: "var-1", productId: "prod-1", name: "Máy lọc không khí Mini — Trắng", price: 1_400_000 }] });
    const put = await call("PUT", "/v1/pancake/products/may-loc", { variationId: "var-1", productId: "prod-1", variationName: "Máy lọc — Trắng", price: 1_400_000 });
    expect(put.status).toBe(200);
    const after = activeDna(B)!;
    expect(after.version).toBe(before.version + 1);
    const products = after.data.products as Row[];
    expect(products.find((p) => p.key === "may-loc")!.pancake).toEqual({ variationId: "var-1", productId: "prod-1", variationName: "Máy lọc — Trắng", price: 1_400_000, shopId: "1001" });
    expect(products.find((p) => p.key === "khoa-ai")).toEqual(COURSE); // nguyên văn (kể cả `sample`, `extraKey`)
    expect(q.scalar("SELECT COUNT(*) FROM dna_profile WHERE biz_id = ? AND status = 'active'", B)).toBe(1);
    const ov = await call("GET", "/v1/pancake/overview");
    expect(ov.body.connection).toMatchObject({ usable: true, shopName: "Shop A", state: "ok" });
    expect(ov.body.products.find((p: Row) => p.key === "may-loc")).toMatchObject({ needsShipping: true, mapping: { variationId: "var-1", shopMismatch: false } });
    expect((await call("PUT", "/v1/pancake/products/khong-co", { variationId: "x" })).status).toBe(404);
    // gỡ + ghép lại để các test sau dùng
    await call("DELETE", "/v1/pancake/products/may-loc");
    expect((activeDna(B)!.data.products as Row[]).find((p) => p.key === "may-loc")!.pancake).toBeNull();
    await call("PUT", "/v1/pancake/products/may-loc", { variationId: "var-1", productId: "prod-1", variationName: "Máy lọc — Trắng", price: 1_400_000 });
  });
});

describe("duyệt có phiếu pushToPancake:true → đẩy", () => {
  it("hàng cần giao thiếu địa chỉ → 400, mục duyệt vẫn chờ, chưa có đơn; đủ phiếu → job + POST đúng 1 lần, đơn có external_id", async () => {
    const d = await draft("Máy lọc không khí Mini");
    const bad = await call("POST", `/v1/approvals/${d.approvalId}/decide`, { decision: "approve", orderForm: { ...FORM, address: "" } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/địa chỉ/);
    expect(byId<Row>("approval", d.approvalId)!.status).toBe("pending");
    expect(orderOf(d.conversationId)).toBeUndefined();
    expect(calls).toHaveLength(0);

    const ok = await call("POST", `/v1/approvals/${d.approvalId}/decide`, { decision: "approve", orderForm: FORM });
    expect(ok.status).toBe(200);
    let o = orderOf(d.conversationId)!;
    expect(o.meta.pancake).toMatchObject({ state: "queued", seq: 1 });
    expect(o).toMatchObject({ total: 1_500_000 + 30_000, product_key: "may-loc" });
    const job = q.get<Row>("SELECT * FROM job WHERE name = 'order.push_pancake' AND json_extract(payload, '$.orderId') = ?", o.id)!;
    expect(job).toMatchObject({ queue: "agent", lock_key: `order:${o.id}`, idempotency_key: `pancake-push:${o.id}:1`, max_attempts: 6 });
    expect(JSON.stringify(job.payload)).not.toContain(PHONE);

    await runPush(o.id);
    expect(postsToPancake()).toHaveLength(1);
    const body = postsToPancake()[0].body;
    expect(body).toMatchObject({
      bill_phone_number: PHONE, bill_full_name: "Chị Lan", shipping_fee: 30_000, cod: 1_530_000, total_discount: 0,
      shipping_address: { address: "12 Nguyễn Trãi, Thanh Xuân, Hà Nội" },
    });
    expect(body.items).toMatchObject([{ variation_id: "var-1", product_id: "prod-1", quantity: 1, variation_info: { retail_price: 1_500_000 } }]);
    expect(body.note).toContain(`[TAKI-${o.id}]`);
    o = orderOf(d.conversationId)!;
    expect(o.meta.pancake).toMatchObject({ state: "pushed", shopId: "1001", mode: "live" });
    expect(o.external_id).toBe(`pancake:${o.meta.pancake.orderId}`);
    // chạy lại job → không tạo trùng
    await runPush(o.id);
    expect(postsToPancake()).toHaveLength(1);
    // không SĐT thật trong audit / job / meta / preview; cipher không lộ qua API
    const dump = JSON.stringify([q.all("SELECT data FROM audit_log WHERE biz_id = ?", B), q.all("SELECT payload FROM job"), byId<Row>("approval", d.approvalId)!.preview, o.meta]);
    expect(dump).not.toContain(PHONE);
    expect(o.meta.shipping.phoneCipher).toBeTruthy();
    const apiOrder = await call("GET", `/v1/orders/${o.id}`);
    expect(JSON.stringify(apiOrder.body)).not.toContain("phoneCipher");
    expect(apiOrder.body.meta.shipping.phoneMasked).toBe("0912***678");
    expect(apiOrder.body.meta.pancake.url).toContain("/shop/1001/order?search=");
    const conv = await call("GET", `/v1/conversations/${d.conversationId}`);
    expect(JSON.stringify(conv.body)).not.toContain("phoneCipher");
    expect(conv.body.orders).toHaveLength(1);
    const list = await call("GET", "/v1/orders");
    expect(JSON.stringify(list.body)).not.toContain("phoneCipher");
    expect((await call("GET", `/v1/orders/by-conversation/${d.conversationId}`)).body).toHaveLength(1);
    // đã lên Pancake → không đổi trạng thái tay, không đẩy lại
    const manual = await call("POST", `/v1/orders/${o.id}/status`, { status: "paid" });
    expect(manual.status).toBe(409);
    expect((await call("POST", `/v1/orders/${o.id}/push-pancake`, { orderForm: FORM })).status).toBe(400);
  });

  it("khoá học (không giao) đẩy được không cần địa chỉ; sản phẩm chưa ghép → blocked kèm link ghép, không gọi mạng; ghép rồi 'Đẩy lại' chạy", async () => {
    const d = await draft("Khóa AI Marketing");
    const ok = await call("POST", `/v1/approvals/${d.approvalId}/decide`, { decision: "approve", orderForm: { fullName: "Chị Hoa", pushToPancake: true } });
    expect(ok.status).toBe(200);
    let o = orderOf(d.conversationId)!;
    expect(o.meta.pancake).toMatchObject({ state: "blocked", link: "/dna?pancake=map" });
    expect(o.meta.pancake.reason).toMatch(/chưa được ghép/);
    expect(calls).toHaveLength(0);
    expect(q.scalar("SELECT COUNT(*) FROM job WHERE name = 'order.push_pancake' AND json_extract(payload, '$.orderId') = ?", o.id)).toBe(0);
    await call("PUT", "/v1/pancake/products/khoa-ai", { variationId: "var-course", variationName: "Khóa AI Marketing", price: 12_000_000 });
    // thiếu phiếu → từ chối; có phiếu → xếp job
    expect((await call("POST", `/v1/orders/${o.id}/push-pancake`, {})).body.code).toBe("NEEDS_FORM");
    const re = await call("POST", `/v1/orders/${o.id}/push-pancake`, { orderForm: { fullName: "Chị Hoa", pushToPancake: true } });
    expect(re.status).toBe(200);
    expect(re.body.meta.pancake.state).toBe("queued");
    await runPush(o.id);
    o = orderOf(d.conversationId)!;
    expect(o.meta.pancake.state).toBe("pushed");
    expect(postsToPancake()[0].body.shipping_address.address).toBeUndefined(); // không giao hàng → không địa chỉ
  });

  it("đơn ghép với shop khác → blocked", async () => {
    const d = await draft("Khóa AI Marketing");
    const dna = activeDna(B)!;
    const products = (dna.data.products as Row[]).map((p) => (p.key === "khoa-ai" ? { ...p, pancake: { ...p.pancake, shopId: "OTHER" } } : p));
    q.run("UPDATE dna_profile SET status = 'archived' WHERE biz_id = ?", B);
    insert("dna_profile", { biz_id: B, version: dna.version + 1, status: "active", created_by: "test", data: { ...dna.data, products } });
    await call("POST", `/v1/approvals/${d.approvalId}/decide`, { decision: "approve", orderForm: { fullName: "Chị X", pushToPancake: true } });
    expect(orderOf(d.conversationId)!.meta.pancake.reason).toMatch(/shop Pancake khác/);
    expect(calls).toHaveLength(0);
    // trả lại ghép đúng shop
    await call("PUT", "/v1/pancake/products/khoa-ai", { variationId: "var-course", variationName: "Khóa AI Marketing", price: 12_000_000 });
  });

  it("kết nối Pancake ở chế độ mô phỏng / hết hạn → blocked (không Pancake giả, không doanh thu ảo)", async () => {
    const d = await draft("Khóa AI Marketing");
    update("connection", conn.id, { mode: "sandbox" });
    await call("POST", `/v1/approvals/${d.approvalId}/decide`, { decision: "approve", orderForm: { fullName: "Chị Sbx", pushToPancake: true } });
    const o = orderOf(d.conversationId)!;
    expect(o.meta.pancake).toMatchObject({ state: "blocked", link: "/ads/integrations" });
    expect(o.meta.pancake.reason).toMatch(/mô phỏng/);
    expect(calls).toHaveLength(0);
    expect(o.status).toBe("pending");
    const ov = await call("GET", "/v1/pancake/overview");
    expect(ov.body.connection).toMatchObject({ usable: false, state: "sandbox" });
    expect((await call("GET", "/v1/pancake/variations?search=x")).status).toBeGreaterThanOrEqual(400);
    update("connection", conn.id, { mode: "live", status: "expired" });
    const re = await call("POST", `/v1/orders/${o.id}/push-pancake`, { orderForm: { fullName: "Chị Sbx", pushToPancake: true } });
    expect(re.body.meta.pancake.reason).toMatch(/hết hạn/);
    update("connection", conn.id, { mode: "live", status: "active" });
    // đơn thủ công (chưa lên Pancake) đổi trạng thái tay được, có nhật ký
    const st = await call("POST", `/v1/orders/${o.id}/status`, { status: "paid" });
    expect(st.body.status).toBe("paid");
    expect(q.scalar("SELECT COUNT(*) FROM audit_log WHERE event = 'order.status_manual'")).toBeGreaterThanOrEqual(1);
    expect((await call("POST", `/v1/orders/${o.id}/status`, { status: "refunded-xyz" })).status).toBe(400);
  });
});

describe("không bao giờ đẩy đơn chưa qua cổng duyệt / lỗi & thử lại", () => {
  it("đơn ghi tay POST /v1/conversations/:id/order (không approvalId) → push-pancake 409 NOT_APPROVED, không gọi mạng", async () => {
    const d = await draft("Khóa AI Marketing");
    const o = await call("POST", `/v1/conversations/${d.conversationId}/order`, { product: "Khóa AI Marketing", total: 5_000_000, productKey: "khoa-ai" });
    expect(o.status).toBe(200);
    expect(JSON.stringify(o.body)).not.toContain("phoneCipher");
    const r = await call("POST", `/v1/orders/${o.body.id}/push-pancake`, { orderForm: { fullName: "X", phone: PHONE, pushToPancake: true } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("NOT_APPROVED");
    expect(calls).toHaveLength(0);
  });

  it("hết giờ chờ khi tạo đơn (đơn đã tới Pancake) → thử lại tìm theo mã TAKI-<id>, KHÔNG tạo trùng", async () => {
    const d = await draft("Khóa AI Marketing");
    await call("POST", `/v1/approvals/${d.approvalId}/decide`, { decision: "approve", orderForm: { fullName: "Chị T", pushToPancake: true } });
    const o = orderOf(d.conversationId)!;
    failPost = "timeout";
    await expect(runPush(o.id)).rejects.toThrow();
    let cur = orderOf(d.conversationId)!;
    expect(cur.meta.pancake).toMatchObject({ state: "queued", attempted: true });
    expect(cur.meta.pancake.error).toMatch(/Đang thử lại/);
    // lần timeout đã để lại 1 đơn trên Pancake (có mã TAKI-<id> trong ghi chú) → lần 2 phải tìm thấy đúng đơn đó
    const orphan = Object.values(pancakeOrders).find((p) => String(p.note).includes(`[TAKI-${o.id}]`))!;
    expect(orphan).toBeTruthy();
    const postsBefore = postsToPancake().length;
    await runPush(o.id);
    expect(postsToPancake().length).toBe(postsBefore); // không POST thêm
    cur = orderOf(d.conversationId)!;
    expect(cur.meta.pancake).toMatchObject({ state: "pushed", orderId: String(orphan.id) });
    expect(cur.external_id).toBe(`pancake:${orphan.id}`);
    expect(q.scalar("SELECT COUNT(*) FROM audit_log WHERE event = 'order.pushed_pancake' AND data LIKE '%found_existing%'")).toBe(1);
  });

  it("Pancake từ chối (success:false) → failed + PermanentError, đơn nội bộ vẫn còn; 'Đẩy lại' xếp job mới", async () => {
    const d = await draft("Khóa AI Marketing");
    await call("POST", `/v1/approvals/${d.approvalId}/decide`, { decision: "approve", orderForm: { fullName: "Chị F", pushToPancake: true } });
    const o = orderOf(d.conversationId)!;
    failPost = "reject";
    await expect(runPush(o.id)).rejects.toThrow(/variation_id/);
    const cur = orderOf(d.conversationId)!;
    expect(cur.meta.pancake).toMatchObject({ state: "failed" });
    expect(cur.status).toBe("pending");
    const re = await call("POST", `/v1/orders/${o.id}/push-pancake`, { orderForm: { fullName: "Chị F", pushToPancake: true } });
    expect(re.body.meta.pancake).toMatchObject({ state: "queued", seq: 2 });
    expect(q.scalar("SELECT COUNT(*) FROM job WHERE name = 'order.push_pancake' AND json_extract(payload, '$.orderId') = ?", o.id)).toBe(2);
  });
});

describe("đồng bộ trạng thái + lịch + di trú", () => {
  it("syncPancakeOrders: mã 3/16 → paid, mã 6 → cancelled; đơn đã final không bị tra lại; GET /connections/:id/orders cũng làm mới", async () => {
    const pushed = q.all<Row>("SELECT * FROM orders WHERE biz_id = ? AND external_id LIKE 'pancake:%'", B);
    expect(pushed.length).toBeGreaterThanOrEqual(3);
    const [a, b] = pushed;
    pancakeOrders[a.external_id.slice(8)] = { ...pancakeOrders[a.external_id.slice(8)], id: Number(a.external_id.slice(8)), status: 16 };
    pancakeOrders[b.external_id.slice(8)] = { ...pancakeOrders[b.external_id.slice(8)], id: Number(b.external_id.slice(8)), status: 6 };
    calls.length = 0;
    const r = await call("POST", "/v1/orders/pancake-sync");
    expect(r.status).toBe(200);
    expect(r.body.updated).toBeGreaterThanOrEqual(2);
    expect(byId<Row>("orders", a.id)!.status).toBe("paid");
    expect(byId<Row>("orders", b.id)!.status).toBe("cancelled");
    expect(byId<Row>("orders", a.id)!.meta.pancake.statusCode).toBe(16);
    calls.length = 0;
    await call("POST", "/v1/orders/pancake-sync");
    // a và b đã ở trạng thái cuối → không còn nằm trong danh sách tra lẻ
    expect(calls.filter((c) => /\/orders\/\d+$/.test(c.url)).every((c) => !c.url.endsWith(a.external_id.slice(8)) && !c.url.endsWith(b.external_id.slice(8)))).toBe(true);
  });

  it("lịch orders.pancake_sync có sẵn cho doanh nghiệp; handler là no-op KHÔNG gọi mạng khi chưa có kết nối / chưa có đơn đã đẩy", async () => {
    const added = ensureBizSchedules(B);
    expect(added.length === 0 || added.includes("orders.pancake_sync")).toBe(true);
    expect(q.get<Row>("SELECT * FROM schedule WHERE biz_id = ? AND name = 'orders.pancake_sync'", B)).toMatchObject({ queue: "agent", every_minutes: 30, enabled: 1 });
    const B2 = insert("biz", { name: "Chưa kết nối", settings: { ...DEFAULT_SETTINGS } }).id;
    calls.length = 0;
    await HANDLERS["orders.pancake_sync"]({ bizId: B2 }, { biz_id: B2 } as Row);
    // doanh nghiệp B2 có đơn "đã đẩy" nhưng không có kết nối thật → cũng không gọi mạng
    insert("orders", { biz_id: B2, customer_name: "K", product: "P", total: 1, status: "pending", external_id: "pancake:1", meta: { pancake: { orderId: "1" } } });
    await HANDLERS["orders.pancake_sync"]({ bizId: B2 }, { biz_id: B2 } as Row);
    expect(calls).toHaveLength(0);
  });

  it("DB: cột orders.meta / external_id / product_key + chỉ mục duy nhất theo (biz, external_id) có mặt; trùng mã Pancake bị chặn", () => {
    const cols = (db().prepare("PRAGMA table_info(orders)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["meta", "external_id", "product_key"]));
    const idx = (db().prepare("PRAGMA index_list(orders)").all() as { name: string }[]).map((i) => i.name);
    expect(idx).toContain("orders_pancake_external");
    insert("orders", { biz_id: B, customer_name: "U1", product: "P", total: 1, status: "pending", source: null, external_id: "pancake:dup" });
    expect(() => insert("orders", { biz_id: B, customer_name: "U2", product: "P", total: 1, status: "pending", source: null, external_id: "pancake:dup" })).toThrow();
    // nhiều đơn không có mã (NULL) không bị coi là trùng
    insert("orders", { biz_id: B, customer_name: "U3", product: "P", total: 1, status: "pending" });
    insert("orders", { biz_id: B, customer_name: "U4", product: "P", total: 1, status: "pending" });
  });

  it("đơn nháp hết hạn → expired, không đơn; đơn nháp hết hạn không duyệt được", async () => {
    const d = await draft("Khóa AI Marketing");
    update("approval", d.approvalId, { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(expireApprovals()).toBeGreaterThanOrEqual(1);
    expect(byId<Row>("approval", d.approvalId)!.status).toBe("expired");
    expect((await call("POST", `/v1/approvals/${d.approvalId}/decide`, { decision: "approve" })).status).toBeGreaterThanOrEqual(400);
    expect(orderOf(d.conversationId)).toBeUndefined();
  });
});
