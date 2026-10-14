import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { byId, q, type Row } from "@dotaka/db";
import { OrderForm } from "@dotaka/contracts";
import { ConnectorError } from "@dotaka/connectors";
import {
  MANUAL_ORDER_STATUSES, deletePancakeMapping, orderDraftContext, pancakeOverview, publicOrder, repushOrder, savePancakeMapping,
  searchPancakeVariations, setOrderStatus, syncPancakeOrders,
} from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { routes } from "../http.ts";

/** Lỗi Pancake (API key sai, mạng…) → thông báo tiếng Việt cho Sếp thay vì lỗi 500. */
async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ConnectorError) throw new AppError(e.kind === "AuthError" ? "PANCAKE_AUTH" : "PANCAKE_ERROR", e.message, 502);
    throw e;
  }
}

/**
 * Đơn hàng ↔ Pancake POS: ghép sản phẩm DNA ↔ mẫu mã, phiếu lên đơn khi duyệt, đẩy / đẩy lại, đồng bộ trạng thái.
 * Việc duyệt đơn nháp đi qua POST /v1/approvals/:id/decide (kèm orderForm) — không có route tạo đơn thẳng sang Pancake ở đây.
 */
export function orderRoutes(app: FastifyInstance) {
  const r = routes(app);

  // Ghép sản phẩm DNA ↔ mẫu mã Pancake (ghi lên sản phẩm trong DNA)
  r.get("/v1/pancake/overview", ({ bizId }) => pancakeOverview(bizId));
  r.get("/v1/pancake/variations", ({ bizId, query }) => friendly(async () => searchPancakeVariations(bizId, String(query.search ?? ""))));
  r.put("/v1/pancake/products/:key", ({ bizId, params, body, actor }) => {
    const p = z.object({ variationId: z.string().min(1).max(100), productId: z.string().max(100).nullish(), variationName: z.string().max(300).nullish(), price: z.number().nonnegative().nullish() }).parse(body);
    return savePancakeMapping(bizId, params.key, p, actor);
  });
  r.del("/v1/pancake/products/:key", ({ bizId, params, actor }) => deletePancakeMapping(bizId, params.key, actor));

  // Phiếu lên đơn khi duyệt đơn nháp (giá trị gợi ý + đã ghép/kết nối chưa)
  r.get("/v1/orders/draft/:approvalId", ({ bizId, params }) => orderDraftContext(bizId, params.approvalId));

  // Cập nhật trạng thái tay (đơn chưa lên Pancake): đã thanh toán / huỷ / hoàn hàng — có ghi nhật ký
  r.post("/v1/orders/:id/status", ({ bizId, params, body, actor }) => {
    const p = z.object({ status: z.enum(MANUAL_ORDER_STATUSES) }).parse(body ?? {});
    return setOrderStatus(bizId, params.id, p.status, actor);
  });

  r.get("/v1/orders/by-conversation/:id", ({ bizId, params }) =>
    q.all<Row>("SELECT * FROM orders WHERE biz_id = ? AND conversation_id = ? ORDER BY created_at DESC", bizId, params.id).map(publicOrder));
  r.get("/v1/orders/:id", ({ bizId, params }) => {
    const o = byId<Row>("orders", params.id);
    if (!o || o.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy đơn", 404);
    return publicOrder(o);
  });
  // Đẩy sang Pancake / Đẩy lại: bắt buộc kèm phiếu có pushToPancake:true; đơn phải đã qua cổng duyệt (409 NOT_APPROVED nếu không).
  r.post("/v1/orders/:id/push-pancake", ({ bizId, params, body, actor }) => {
    const p = z.object({ orderForm: OrderForm.optional() }).parse(body ?? {});
    return repushOrder(bizId, params.id, p.orderForm, actor);
  });
  r.post("/v1/orders/pancake-sync", ({ bizId }) => friendly(() => syncPancakeOrders(bizId)));
}
