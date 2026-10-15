import { activeDna, audit, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { ConnectorError, live } from "@dotaka/connectors";
import { needsShipping } from "@dotaka/chat-engine";
import type { OrderForm } from "@dotaka/contracts";
import { AppError, decryptSecret, encryptSecret, logger, maskPhone, maskPhonesInText, nowIso } from "@dotaka/shared";
import { credsOf } from "./connections.ts";
import { dnaProductByKey, setProductPancake } from "./dna-intake.ts";
import { PermanentError, enqueue, type Handler } from "./queue.ts";

/**
 * Đẩy đơn ĐÃ DUYỆT sang Pancake POS (cổng [ĐỎ] giữ nguyên: chỉ chạy sau khi Sếp duyệt đơn nháp và nói rõ "Đẩy sang Pancake").
 *
 *  bot chốt (chat-engine.buyClose) → approval `order_draft` [ĐỎ] (SĐT chỉ ở dạng che; số thật ở lead.phone)
 *  Sếp duyệt + phiếu lên đơn → createApprovedOrder: lưu đơn nội bộ (luôn luôn) + meta.shipping (SĐT MÃ HOÁ) + meta.approvalId
 *    → requestPancakePush CHỈ khi phiếu có pushToPancake === true: thiếu điều kiện (chưa kết nối thật / chưa ghép sản phẩm / thiếu
 *      địa chỉ) → "blocked" kèm lý do + link sửa; đủ → job `order.push_pancake` (khoá chống trùng theo đơn + lượt đẩy).
 *  pushOrderToPancake: nếu lần trước CÓ THỂ đã tới Pancake (hết giờ chờ) → tìm lại đơn theo mã "TAKI-<id>" trong ghi chú
 *    trước khi tạo → không bao giờ tạo trùng. Lỗi tạm thời → thử lại (backoff); lỗi vĩnh viễn → "failed" + nút "Đẩy lại".
 *  syncPancakeOrders: kéo trạng thái từ Pancake → trạng thái đơn nội bộ (pending / paid / cancelled) để báo cáo doanh thu đúng.
 *
 * Nhật ký (audit/log) KHÔNG BAO GIỜ ghi SĐT thật — chỉ bản che (0912***678). Không có Pancake giả lập: kết nối ở chế độ mô phỏng
 * không bao giờ nhận đơn (tránh doanh thu "paid" ảo).
 */

export type PancakePushState = "off" | "queued" | "pushing" | "pushed" | "blocked" | "failed";
export const MAP_LINK = "/dna?pancake=map";
const INTEGRATIONS_LINK = "/ads/integrations";
export const orderMarker = (orderId: string) => `TAKI-${orderId}`;

export const ORDER_STATUS_LABEL: Record<string, string> = { pending: "Đang xử lý", paid: "Đã thanh toán", cancelled: "Đã huỷ", returned: "Hoàn hàng" };
export const MANUAL_ORDER_STATUSES = ["pending", "paid", "cancelled", "returned"] as const;

// ------------------------------- Kết nối & API -------------------------------
export type PancakeConnectionState = { kind: "none" | "sandbox" | "expired" | "ok"; connection?: Row };
/** Kết nối Pancake gần nhất (không tính đã thu hồi) và tình trạng dùng được hay chưa. */
export function pancakeConnectionState(bizId: string): PancakeConnectionState {
  const c = q.get<Row>("SELECT * FROM connection WHERE biz_id = ? AND platform = 'pancake' AND status != 'revoked' ORDER BY CASE WHEN mode = 'live' AND status = 'active' THEN 0 ELSE 1 END, created_at DESC LIMIT 1", bizId);
  if (!c) return { kind: "none" };
  if (c.mode !== "live") return { kind: "sandbox", connection: c };
  if (c.status !== "active") return { kind: "expired", connection: c };
  return { kind: "ok", connection: c };
}
/** Chỉ kết nối THẬT còn hoạt động. */
export function pancakeConnection(bizId: string): Row | undefined {
  const s = pancakeConnectionState(bizId);
  return s.kind === "ok" ? s.connection : undefined;
}
function shopIdOf(c: Row): string {
  return String(c.config?.shop_id || c.config?.shops?.[0]?.externalId || c.external_account_id);
}
function shopNameOf(c: Row, shopId: string): string | null {
  const shops = (c.config?.shops ?? []) as { externalId?: string; name?: string }[];
  return shops.find((s) => String(s.externalId) === shopId)?.name ?? null;
}

export interface PancakeApi {
  shopId: string; shopName: string | null; connectionId: string;
  findVariations(search: string): Promise<live.PancakeVariation[]>;
  createOrder(spec: live.PancakeOrderSpec): Promise<live.PancakeOrder>;
  findOrderByMarker(marker: string, phone?: string): Promise<live.PancakeOrder | null>;
  getOrder(id: string): Promise<live.PancakeOrder | null>;
  orders(limit: number): Promise<live.PancakeOrder[]>;
}
/** Pancake THẬT (API key). Không có kết nối thật → null. */
export function pancakeApi(bizId: string): PancakeApi | null {
  const c = pancakeConnection(bizId);
  if (!c) return null;
  const shopId = shopIdOf(c);
  const cr = credsOf(c) as live.PancakeCreds;
  return {
    shopId, shopName: shopNameOf(c, shopId), connectionId: c.id,
    findVariations: (s) => live.pancakeFindVariations(cr, shopId, s),
    createOrder: (spec) => live.pancakeCreateOrder(cr, shopId, spec, spec.marker),
    findOrderByMarker: (m, phone) => live.pancakeFindOrderByMarker(cr, shopId, m, phone),
    getOrder: (id) => live.pancakeGetOrder(cr, shopId, id),
    orders: (limit) => live.pancakeOrders(cr, shopId, limit),
  };
}

// ------------------------------- Ghép sản phẩm (trên sản phẩm DNA) -------------------------------
/** Sản phẩm DNA dùng cho đơn (key = `key` hoặc tên — cùng quy tắc với Lái tự động). KHÔNG export tên `dnaProducts` (đã có ở autopilot.ts). */
function productsOf(bizId: string): Row[] {
  return ((activeDna(bizId)?.data?.products ?? []) as Row[])
    .map((p, i): Row => ({ ...p, key: String(p.key || p.name || `sp-${i + 1}`) }))
    .filter((p) => String(p.name ?? "").trim());
}
export type PancakeMapping = { variationId: string; productId: string | null; variationName: string | null; price: number | null; shopId: string };
function mappingOf(p: Row | undefined): PancakeMapping | null {
  const m = p?.pancake;
  if (!m || typeof m !== "object" || !m.variationId) return null;
  return { variationId: String(m.variationId), productId: m.productId ?? null, variationName: m.variationName ?? null, price: typeof m.price === "number" ? m.price : null, shopId: String(m.shopId ?? "") };
}
/** Mẫu mã đã ghép cho sản phẩm (null nếu chưa ghép). */
export const pancakeMapping = (bizId: string, key: string | null | undefined): PancakeMapping | null => (key ? mappingOf(dnaProductByKey(bizId, key)) : null);

/** Danh sách sản phẩm DNA + mẫu mã Pancake đã ghép + đơn gần đây (panel ghép ở trang DNA / Trung tâm tích hợp). */
export function pancakeOverview(bizId: string) {
  const st = pancakeConnectionState(bizId);
  const c = st.connection;
  const shopId = c ? shopIdOf(c) : null;
  return {
    connection: c ? { id: c.id, mode: c.mode, status: c.status, name: c.display_name, shopId, shopName: shopId ? shopNameOf(c, shopId) : null, usable: st.kind === "ok", state: st.kind } : null,
    products: productsOf(bizId).map((p) => {
      const m = mappingOf(p);
      return {
        key: p.key, name: p.name, price: typeof p.price === "number" ? p.price : null, needsShipping: needsShipping(p), delivery: p.delivery ?? "",
        mapping: m ? { ...m, shopMismatch: Boolean(shopId && m.shopId && m.shopId !== shopId) } : null,
      };
    }),
    recent: q.all<Row>("SELECT * FROM orders WHERE biz_id = ? AND json_extract(meta, '$.pancake.state') IS NOT NULL ORDER BY created_at DESC LIMIT 20", bizId).map(publicOrder),
  };
}

export async function searchPancakeVariations(bizId: string, search: string) {
  const api = pancakeApi(bizId);
  if (!api) throw new AppError("NOT_CONNECTED", blockNoLive(bizId).reason);
  return { shopId: api.shopId, shopName: api.shopName, items: await api.findVariations(search.slice(0, 100)) };
}

export function savePancakeMapping(bizId: string, productKey: string, v: { variationId: string; productId?: string | null; variationName?: string | null; price?: number | null }, actor = "ceo") {
  if (!dnaProductByKey(bizId, productKey)) throw new AppError("NOT_FOUND", "Không thấy sản phẩm này trong DNA", 404);
  const api = pancakeApi(bizId);
  if (!api) throw new AppError("NOT_CONNECTED", blockNoLive(bizId).reason);
  setProductPancake(bizId, productKey, {
    variationId: String(v.variationId), productId: v.productId ?? null, variationName: v.variationName ?? null, price: v.price ?? null, shopId: api.shopId,
  }, actor);
  audit(bizId, actor, "pancake.product_mapped", { type: "product", id: productKey }, { variationId: v.variationId, name: v.variationName });
  return pancakeMapping(bizId, productKey);
}
export function deletePancakeMapping(bizId: string, productKey: string, actor = "ceo") {
  if (!pancakeMapping(bizId, productKey)) return;
  setProductPancake(bizId, productKey, null, actor);
  audit(bizId, actor, "pancake.product_unmapped", { type: "product", id: productKey });
}

// ------------------------------- Phiếu lên đơn -------------------------------
type Shipping = {
  fullName: string; phoneCipher: string | null; phoneMasked: string; address: string | null;
  provinceId: string | null; districtId: string | null; communeId: string | null;
  quantity: number; unitPrice: number; discount: number; shippingFee: number; cod: number; note: string | null; needsShipping: boolean;
};
const phoneOf = (s: Shipping | undefined) => {
  if (!s?.phoneCipher) return "";
  try { return decryptSecret(s.phoneCipher); } catch { return ""; }
};
const totalOf = (s: Pick<Shipping, "quantity" | "unitPrice" | "discount" | "shippingFee">) => Math.max(0, s.quantity * s.unitPrice - s.discount + s.shippingFee);
/** SĐT khách lấy từ hồ sơ khách (lead) của hội thoại — preview của mục duyệt chỉ giữ bản che. */
const leadPhone = (conversationId: string) => String(q.get<Row>("SELECT phone FROM lead WHERE conversation_id = ?", conversationId)?.phone ?? "");

/** Ghép phiếu Sếp gửi (nếu có) với thông tin đơn nháp/lần trước → thông tin giao hàng chuẩn hoá. */
function buildShipping(base: { fullName: string; phone: string; unitPrice: number; prev?: Shipping }, form: OrderForm | undefined, ship: boolean): Shipping {
  const prev = base.prev;
  const phone = (form?.phone?.trim() || base.phone || "").replace(/[^\d+]/g, "");
  const s = {
    fullName: form?.fullName?.trim() || prev?.fullName || base.fullName,
    phoneCipher: phone ? encryptSecret(phone) : null, phoneMasked: maskPhone(phone),
    address: (form ? form.address?.trim() : prev?.address) || null,
    provinceId: (form ? form.provinceId : prev?.provinceId) || null,
    districtId: (form ? form.districtId : prev?.districtId) || null,
    communeId: (form ? form.communeId : prev?.communeId) || null,
    quantity: form?.quantity ?? prev?.quantity ?? 1,
    unitPrice: form?.unitPrice ?? prev?.unitPrice ?? base.unitPrice,
    discount: form?.discount ?? prev?.discount ?? 0,
    shippingFee: form?.shippingFee ?? prev?.shippingFee ?? 0,
    cod: 0, note: (form ? form.note?.trim() : prev?.note) || null, needsShipping: ship,
  };
  s.cod = form?.cod ?? (form ? totalOf(s) : prev?.cod ?? totalOf(s));
  return s;
}

/** Lý do chưa có kết nối Pancake THẬT dùng được (câu chữ cho Sếp + chỗ sửa). */
function blockNoLive(bizId: string): { reason: string; link: string } {
  const st = pancakeConnectionState(bizId);
  if (st.kind === "sandbox") return { reason: "Kết nối Pancake đang ở chế độ mô phỏng — nhập API key thật ở Trung tâm tích hợp rồi bấm Đẩy lại", link: INTEGRATIONS_LINK };
  if (st.kind === "expired") return { reason: "Kết nối Pancake đã hết hạn hoặc lỗi — kiểm tra lại API key ở Trung tâm tích hợp rồi bấm Đẩy lại", link: INTEGRATIONS_LINK };
  return { reason: "Chưa kết nối Pancake POS — vào Trung tâm tích hợp để kết nối rồi bấm Đẩy lại", link: INTEGRATIONS_LINK };
}

/** Điều kiện về KẾT NỐI + GHÉP sản phẩm (không tính phiếu). null = đủ. */
function connectionBlock(bizId: string, productKey: string | null, productName: string): { reason: string; link?: string } | null {
  const c = pancakeConnection(bizId);
  if (!c) return blockNoLive(bizId);
  const m = pancakeMapping(bizId, productKey);
  if (!m) return { reason: `Sản phẩm "${productName}" chưa được ghép với mẫu mã trên Pancake — ghép ở trang Mục tiêu & DNA rồi bấm Đẩy lại`, link: MAP_LINK };
  if (m.shopId && m.shopId !== shopIdOf(c)) return { reason: `Sản phẩm "${productName}" đang ghép với shop Pancake khác — ghép lại ở trang Mục tiêu & DNA rồi bấm Đẩy lại`, link: MAP_LINK };
  return null;
}

/** Lý do CHƯA đẩy được (null = đủ điều kiện). Câu chữ cho Sếp đọc, kèm chỗ sửa. */
export function pushBlockReason(bizId: string, productKey: string | null, productName: string, s: Shipping | undefined): { reason: string; link?: string } | null {
  const cb = connectionBlock(bizId, productKey, productName);
  if (cb) return cb;
  if (!s || !phoneOf(s)) return { reason: "Thiếu số điện thoại khách — bổ sung rồi bấm Đẩy lại" };
  if (s.needsShipping && !s.address) return { reason: "Thiếu địa chỉ giao hàng — bổ sung rồi bấm Đẩy lại" };
  return null;
}

/** Bối cảnh để Sếp điền phiếu khi duyệt đơn nháp: giá trị gợi ý, sản phẩm cần giao hay không, đã ghép Pancake chưa. */
export function orderDraftContext(bizId: string, approvalId: string) {
  const ap = byId<Row>("approval", approvalId);
  if (!ap || ap.biz_id !== bizId || ap.subject_type !== "order_draft") throw new AppError("NOT_FOUND", "Không thấy đơn nháp", 404);
  const pv = (ap.preview ?? {}) as Row;
  const p = pv.productKey ? dnaProductByKey(bizId, pv.productKey) : undefined;
  const ship = p ? needsShipping(p) : true;
  const m = pancakeMapping(bizId, pv.productKey);
  const c = pancakeConnection(bizId);
  // Chỉ nêu lý do kết nối / ghép (thiếu SĐT / địa chỉ do phiếu quyết định).
  const connReason = connectionBlock(bizId, pv.productKey ?? null, pv.product ?? "Sản phẩm");
  const phone = leadPhone(ap.subject_id);
  return {
    product: { key: pv.productKey ?? null, name: pv.product ?? p?.name ?? "Sản phẩm", needsShipping: ship },
    defaults: { fullName: pv.customerName ?? "", phone, quantity: 1, unitPrice: typeof pv.total === "number" && pv.total > 0 ? pv.total : (m?.price ?? 0), discount: 0, shippingFee: 0, note: "" },
    pancake: { connected: Boolean(c), mapped: Boolean(m), variationName: m?.variationName ?? null, variationPrice: m?.price ?? null, shopName: c ? shopNameOf(c, shopIdOf(c)) : null },
    pushDefault: false, // luôn để Sếp tự bật: không bao giờ đẩy thẳng sang POS nếu chưa nói rõ
    pushPossible: !connReason,
    blockReason: connReason?.reason ?? null, blockLink: connReason?.link ?? null,
  };
}

// ------------------------------- Duyệt → đơn nội bộ → đẩy -------------------------------
/** Kiểm phiếu TRƯỚC khi ghi bất cứ gì (decideApproval gọi sớm). Lỗi phiếu → AppError, mục duyệt vẫn còn mở. */
export function validateOrderDraft(bizId: string, ap: Row, form: OrderForm | undefined): void {
  if (!form || form.pushToPancake !== true) return;
  const pv = (ap.preview ?? {}) as Row;
  const p = pv.productKey ? dnaProductByKey(bizId, pv.productKey) : undefined;
  const ship = p ? needsShipping(p) : true;
  const s = buildShipping({ fullName: pv.customerName ?? "Khách", phone: leadPhone(ap.subject_id), unitPrice: typeof pv.total === "number" ? pv.total : 0 }, form, ship);
  if (!phoneOf(s)) throw new AppError("INVALID", "Nhập số điện thoại khách để lên đơn");
  if (ship && !s.address) throw new AppError("INVALID", "Hàng cần giao: nhập địa chỉ nhận hàng (số nhà, đường, phường/xã, tỉnh/thành)");
}

/**
 * Gọi từ decideApproval (order_draft, approve/edit). Chỉ đẩy sang Pancake khi phiếu có pushToPancake === true; không có phiếu
 * (duyệt hàng loạt, API) → đơn nội bộ, trạng thái "off" (có nút "Đẩy sang Pancake" sau).
 */
export function createApprovedOrder(bizId: string, ap: Row, form: OrderForm | undefined, actor: string): Row {
  validateOrderDraft(bizId, ap, form);
  const pv = (ap.preview ?? {}) as Row;
  const p = pv.productKey ? dnaProductByKey(bizId, pv.productKey) : undefined;
  const ship = p ? needsShipping(p) : true;
  const m = pancakeMapping(bizId, pv.productKey);
  const push = form?.pushToPancake === true;
  const s = buildShipping({ fullName: pv.customerName ?? "Khách", phone: leadPhone(ap.subject_id), unitPrice: typeof pv.total === "number" && pv.total > 0 ? pv.total : (m?.price ?? 0) }, form, ship);
  const src = q.get<Row>("SELECT source FROM attribution_link WHERE conversation_id = ? ORDER BY confidence DESC LIMIT 1", ap.subject_id);
  const order = insert("orders", {
    biz_id: bizId, conversation_id: ap.subject_id, customer_name: s.fullName || pv.customerName || "Khách",
    product: pv.product ?? "Sản phẩm", product_key: pv.productKey ?? null, total: totalOf(s), status: "pending", source: src?.source ?? null,
    meta: { approvalId: ap.id, shipping: s, pancake: { state: push ? "queued" : "off", seq: 0 }, ...(form?.email ? { email: form.email.toLowerCase() } : {}) },
  });
  emit(bizId, "order.created", { orderId: order.id, conversationId: ap.subject_id });
  audit(bizId, actor, "order.created", { type: "order", id: order.id }, { total: order.total, product: order.product, phone: s.phoneMasked, pushToPancake: push, approvalId: ap.id });
  if (push) requestPancakePush(bizId, order.id, actor);
  return byId<Row>("orders", order.id)!;
}

function setPancake(orderId: string, patch: Row): Row {
  const o = byId<Row>("orders", orderId)!;
  const meta = { ...(o.meta ?? {}), pancake: { ...(o.meta?.pancake ?? {}), ...patch } };
  update("orders", orderId, { meta });
  return meta.pancake;
}

/** Chỉ đơn đi qua cổng duyệt (có meta.approvalId) mới được tới POS — đơn tạo thẳng qua API không bao giờ. */
function assertApproved(o: Row) {
  if (!o.meta?.approvalId) throw new AppError("NOT_APPROVED", "Đơn này không đi qua cổng duyệt — không đẩy sang Pancake", 409);
}

/** Xếp lượt đẩy (hoặc đánh dấu "blocked" kèm lý do). Gọi khi duyệt (có phiếu đẩy) và khi Sếp bấm "Đẩy sang Pancake / Đẩy lại". */
export function requestPancakePush(bizId: string, orderId: string, actor = "ceo"): Row {
  const o = byId<Row>("orders", orderId);
  if (!o || o.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy đơn", 404);
  assertApproved(o);
  const pk = (o.meta?.pancake ?? {}) as Row;
  if (pk.orderId) return pk;
  const block = pushBlockReason(bizId, o.product_key ?? null, o.product, o.meta?.shipping);
  if (block) {
    const r = setPancake(orderId, { state: "blocked", reason: block.reason, link: block.link ?? null, error: null });
    audit(bizId, actor, "order.pancake_blocked", { type: "order", id: orderId }, { reason: block.reason });
    emit(bizId, "order.updated", { orderId });
    return r;
  }
  const seq = Number(pk.seq ?? 0) + 1;
  const r = setPancake(orderId, { state: "queued", reason: null, link: null, error: null, seq });
  enqueue("agent", "order.push_pancake", { orderId }, { bizId, idempotencyKey: `pancake-push:${orderId}:${seq}`, lockKey: `order:${orderId}`, maxAttempts: 6 });
  emit(bizId, "order.updated", { orderId });
  return r;
}

/**
 * "Đẩy sang Pancake" / "Đẩy lại": CẦN phiếu có `pushToPancake: true` (Sếp nói rõ — không bao giờ đẩy ngầm) và đơn đã qua cổng duyệt.
 * Phiếu mang theo địa chỉ, SĐT, số lượng… đã sửa.
 */
export function repushOrder(bizId: string, orderId: string, form: OrderForm | undefined, actor = "ceo") {
  const o = byId<Row>("orders", orderId);
  if (!o || o.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy đơn", 404);
  assertApproved(o);
  if (form?.pushToPancake !== true) throw new AppError("NEEDS_FORM", "Cần phiếu lên đơn có bật \"Đẩy sang Pancake\" mới đẩy được", 400);
  const pk = (o.meta?.pancake ?? {}) as Row;
  if (pk.orderId) throw new AppError("ALREADY_PUSHED", "Đơn này đã có trên Pancake rồi");
  if (pk.state === "queued" || pk.state === "pushing") throw new AppError("IN_PROGRESS", "Đơn đang được đẩy sang Pancake, đợi chút rồi xem lại");
  {
    const prev = o.meta?.shipping as Shipping | undefined;
    const p = o.product_key ? dnaProductByKey(bizId, o.product_key) : undefined;
    const s = buildShipping({ fullName: o.customer_name, phone: phoneOf(prev), unitPrice: prev?.unitPrice ?? o.total, prev }, form, prev?.needsShipping ?? (p ? needsShipping(p) : true));
    if (!phoneOf(s)) throw new AppError("INVALID", "Nhập số điện thoại khách để lên đơn");
    if (s.needsShipping && !s.address) throw new AppError("INVALID", "Hàng cần giao: nhập địa chỉ nhận hàng");
    update("orders", orderId, { customer_name: s.fullName, total: totalOf(s), meta: { ...(o.meta ?? {}), shipping: s } });
    audit(bizId, actor, "order.shipping_updated", { type: "order", id: orderId }, { phone: s.phoneMasked, total: totalOf(s) });
  }
  audit(bizId, actor, "order.pancake_repush", { type: "order", id: orderId });
  requestPancakePush(bizId, orderId, actor);
  return publicOrder(byId<Row>("orders", orderId)!);
}

/** Job `order.push_pancake`. */
export async function pushOrderToPancake(orderId: string, job?: Row): Promise<void> {
  const o = byId<Row>("orders", orderId);
  if (!o) return;
  const bizId = o.biz_id as string;
  const pk = (o.meta?.pancake ?? {}) as Row;
  if (pk.orderId || pk.state === "off") return;
  if (!o.meta?.approvalId) return; // phòng thủ: đơn chưa qua cổng duyệt không bao giờ tới POS
  const s = o.meta?.shipping as Shipping | undefined;
  const block = pushBlockReason(bizId, o.product_key ?? null, o.product, s);
  const api = pancakeApi(bizId);
  if (block || !api || !s) {
    setPancake(orderId, { state: "blocked", reason: block?.reason ?? blockNoLive(bizId).reason, link: block?.link ?? null });
    emit(bizId, "order.updated", { orderId });
    return;
  }
  const map = pancakeMapping(bizId, o.product_key)!;
  const phone = phoneOf(s);
  const marker = orderMarker(orderId);

  // 1) Lần trước có thể đã tới Pancake (hết giờ chờ / mất kết nối giữa chừng) → tìm lại theo mã trong ghi chú, KHÔNG tạo trùng.
  if (pk.attempted) {
    const found = await api.findOrderByMarker(marker, phone); // lỗi mạng ở đây → ném ra → job thử lại sau
    if (found) {
      markPushed(bizId, orderId, found, api, "found_existing");
      return;
    }
  }
  // 2) Đánh dấu "đã gửi" TRƯỚC khi gọi tạo đơn: tiến trình chết giữa chừng thì lần sau vẫn tra trước.
  setPancake(orderId, { state: "pushing", attempted: true, lastAttemptAt: nowIso(), mode: "live", shopId: api.shopId });
  const spec: live.PancakeOrderSpec = {
    marker, fullName: s.fullName, phone, address: s.needsShipping ? s.address : null,
    provinceId: s.provinceId, districtId: s.districtId, communeId: s.communeId,
    items: [{ variationId: map.variationId, productId: map.productId, name: map.variationName ?? o.product, quantity: s.quantity, unitPrice: s.unitPrice }],
    discount: s.discount, shippingFee: s.shippingFee, cod: s.cod, note: s.note,
    warehouseId: (byId<Row>("connection", api.connectionId)?.config?.warehouse_id as string | undefined) ?? null,
  };
  try {
    const created = await api.createOrder(spec);
    markPushed(bizId, orderId, created, api, "created");
  } catch (e) {
    const msg = maskPhonesInText(e instanceof Error ? e.message : String(e));
    const ce = e instanceof ConnectorError ? (e as ConnectorError & { requestNotSent?: boolean }) : null;
    const transient = !ce || ce.kind === "Transient" || ce.kind === "RateLimited";
    if (transient) {
      // 429 / chưa mở được kết nối → chắc chắn CHƯA tạo; còn lại (hết giờ chờ, 5xx) → không rõ → lần sau tra trước.
      const surelyNotSent = ce?.kind === "RateLimited" || ce?.requestNotSent === true;
      const last = job ? Number(job.attempts ?? 0) + 1 >= Number(job.max_attempts ?? 5) : false;
      setPancake(orderId, {
        attempted: Boolean(pk.attempted) || !surelyNotSent,
        state: last ? "failed" : "queued",
        error: last ? `Lỗi đẩy Pancake: ${msg} (đã thử nhiều lần) — bấm Đẩy lại` : `Đang thử lại: ${msg}`,
      });
      logger.warn("order.pancake_retry", { orderId, error: msg, last });
      if (last) audit(bizId, "order_push", "order.pancake_failed", { type: "order", id: orderId }, { error: msg, phone: s.phoneMasked });
      emit(bizId, "order.updated", { orderId });
      throw e;
    }
    // Pancake từ chối (4xx / success:false) → đơn KHÔNG được tạo; giữ cờ "đã gửi" của lần trước (nếu có) để vẫn tra trước.
    setPancake(orderId, { attempted: Boolean(pk.attempted), state: "failed", error: `Lỗi đẩy Pancake: ${msg}` });
    audit(bizId, "order_push", "order.pancake_failed", { type: "order", id: orderId }, { error: msg, phone: s.phoneMasked });
    emit(bizId, "order.updated", { orderId });
    throw new PermanentError(msg);
  }
}

function markPushed(bizId: string, orderId: string, po: live.PancakeOrder, api: PancakeApi, how: "created" | "found_existing") {
  setPancake(orderId, {
    state: "pushed", orderId: po.id, displayId: po.displayId, status: po.status, statusCode: po.statusCode, shopId: api.shopId, mode: "live",
    pushedAt: nowIso(), syncedAt: nowIso(), error: null, reason: null, link: null,
  });
  const local = localStatusOf(po.statusCode);
  if (local && local !== "pending") update("orders", orderId, { status: local });
  try {
    update("orders", orderId, { external_id: `pancake:${po.id}` });
  } catch (e) {
    // Mã Pancake đã gắn cho đơn khác (không nên xảy ra) → vẫn giữ mã trong meta, không làm hỏng lượt đẩy.
    logger.warn("order.pancake_external_conflict", { orderId, pancakeOrderId: po.id, error: e instanceof Error ? e.message : String(e) });
  }
  audit(bizId, "order_push", "order.pushed_pancake", { type: "order", id: orderId }, { pancakeOrderId: po.id, how });
  emit(bizId, "order.updated", { orderId });
}

// ------------------------------- Trạng thái -------------------------------
/** Mã trạng thái Pancake → trạng thái nội bộ (báo cáo doanh thu tính 'paid'; 'cancelled' bị loại). */
export function localStatusOf(code: number | null | undefined): "pending" | "paid" | "cancelled" | null {
  if (code == null) return null;
  if (code === 3 || code === 16 || code === 15) return "paid"; // đã nhận hàng / đã thu tiền / hoàn một phần
  if (code === 5 || code === 6 || code === 7) return "cancelled"; // đã hoàn / đã huỷ / đã xoá
  return "pending"; // mới, chờ xác nhận, đã xác nhận, đóng hàng, chờ lấy, đang giao, đang hoàn
}

function applyStatus(o: Row, po: live.PancakeOrder): boolean {
  const pk = (o.meta?.pancake ?? {}) as Row;
  const local = localStatusOf(po.statusCode);
  const changed = pk.statusCode !== po.statusCode || (local != null && local !== o.status);
  setPancake(o.id, { status: po.status, statusCode: po.statusCode, syncedAt: nowIso() });
  if (local && local !== o.status) {
    update("orders", o.id, { status: local });
    audit(o.biz_id, "order_sync", "order.status_synced", { type: "order", id: o.id }, { from: o.status, to: local, pancake: po.status });
  }
  return changed;
}

/** Ghép danh sách đơn kéo từ Pancake (xem đơn) với đơn đã đẩy theo mã Pancake → cập nhật trạng thái. */
export function applyPancakeOrderList(bizId: string, list: live.PancakeOrder[]): number {
  let n = 0;
  for (const po of list) {
    const o = q.get<Row>("SELECT * FROM orders WHERE biz_id = ? AND external_id = ?", bizId, `pancake:${po.id}`);
    if (o && applyStatus(o, po)) n++;
  }
  if (n) { emit(bizId, "metrics.updated", { source: "pancake" }); emit(bizId, "order.updated", {}); }
  return n;
}

const FINAL = new Set([16, 5, 6, 7]);
/** Lịch `orders.pancake_sync`: 1 lần kéo danh sách mới đổi + tra lẻ các đơn còn lại (tối đa 30) trong 60 ngày. Không mạng nếu chưa có gì để đồng bộ. */
export async function syncPancakeOrders(bizId: string): Promise<{ checked: number; updated: number }> {
  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  const rows = q.all<Row>("SELECT * FROM orders WHERE biz_id = ? AND external_id LIKE 'pancake:%' AND created_at >= ?", bizId, since)
    .filter((o) => !FINAL.has(Number(o.meta?.pancake?.statusCode ?? -1)));
  if (!rows.length) return { checked: 0, updated: 0 };
  const api = pancakeApi(bizId);
  if (!api) return { checked: 0, updated: 0 };
  const listed = new Map((await api.orders(100)).map((po) => [po.id, po]));
  let updated = 0, single = 0;
  for (const o of rows) {
    const id = String(o.external_id).slice("pancake:".length);
    let po = listed.get(id) ?? null;
    if (!po && single < 30) { single++; po = await api.getOrder(id); }
    if (po && applyStatus(o, po)) updated++;
  }
  if (updated) { emit(bizId, "metrics.updated", { source: "pancake" }); emit(bizId, "order.updated", {}); }
  return { checked: rows.length, updated };
}

/** Đổi trạng thái đơn thủ công (đơn CHƯA lên Pancake). Đơn đã có trên Pancake: trạng thái theo Pancake, từ chối để lần đồng bộ sau không ghi đè. */
export function setOrderStatus(bizId: string, orderId: string, status: string, actor = "ceo") {
  const o = byId<Row>("orders", orderId);
  if (!o || o.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy đơn", 404);
  if (!(MANUAL_ORDER_STATUSES as readonly string[]).includes(status)) throw new AppError("INVALID", "Trạng thái không hợp lệ");
  if (o.meta?.pancake?.orderId) throw new AppError("ON_PANCAKE", "Đơn đã có trên Pancake — trạng thái lấy theo Pancake (bấm Cập nhật trạng thái)", 409);
  if (o.status !== status) {
    update("orders", orderId, { status });
    audit(bizId, actor, "order.status_manual", { type: "order", id: orderId }, { from: o.status, to: status });
    emit(bizId, "order.updated", { orderId });
    emit(bizId, "metrics.updated", { source: "order" });
  }
  return publicOrder(byId<Row>("orders", orderId)!);
}

// ------------------------------- Hiển thị -------------------------------
/** Đơn cho giao diện: bỏ SĐT mã hoá, kèm link mở đơn trên Pancake (khi là đơn thật). */
export function publicOrder(o: Row) {
  const { phoneCipher: _c, ...shipping } = (o.meta?.shipping ?? {}) as Row;
  const pk = (o.meta?.pancake ?? null) as Row | null;
  const url = pk?.orderId && pk.mode === "live" ? `https://pos.pancake.vn/shop/${pk.shopId}/order?search=${encodeURIComponent(pk.displayId ?? pk.orderId)}` : null;
  return { ...o, meta: { ...(o.meta ?? {}), shipping: o.meta?.shipping ? shipping : undefined, pancake: pk ? { ...pk, url } : null } };
}

export const ORDER_PUSH_HANDLERS: Record<string, Handler> = {
  "order.push_pancake": async (p, job) => pushOrderToPancake(p.orderId, job),
  "orders.pancake_sync": async (p, job) => void (await syncPancakeOrders((p.bizId ?? job.biz_id) as string)),
};
