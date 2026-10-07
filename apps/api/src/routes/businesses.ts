import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { archiveBusiness, archivedBusinesses, createBusiness, listBusinesses, renameBusiness, restoreBusiness } from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { routes } from "../http.ts";

/** Bộ chọn doanh nghiệp ("🏢 TAKI Group ▾"): danh sách, thêm, đổi tên, lưu trữ / khôi phục (không xoá dữ liệu). */
export function businessRoutes(app: FastifyInstance) {
  const r = routes(app);
  const Name = z.object({ name: z.string().trim().min(2, "Tên doanh nghiệp cần ít nhất 2 ký tự").max(120) });
  r.get("/v1/businesses", ({ bizId }) => ({ current: bizId, items: listBusinesses(), archived: archivedBusinesses() }));
  r.post("/v1/businesses", ({ bizId, body, actor }) => createBusiness(Name.parse(body).name, actor, bizId));
  r.put("/v1/businesses/:id", ({ params, body, actor }) => renameBusiness(params.id, Name.parse(body).name, actor));
  r.post("/v1/businesses/:id/restore", ({ params, actor }) => restoreBusiness(params.id, actor));
  r.del("/v1/businesses/:id", ({ params, query, actor }) => {
    if (!["1", "true", "yes"].includes(String(query.confirm ?? ""))) throw new AppError("CONFIRM_REQUIRED", "Cần xác nhận (confirm=1) để lưu trữ doanh nghiệp", 400);
    return archiveBusiness(params.id, actor);
  });
}
