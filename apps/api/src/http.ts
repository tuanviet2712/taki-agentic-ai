import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { defaultBizId, isActiveBiz } from "@dotaka/db";
import { AppError, logger } from "@dotaka/shared";

export type Ctx = { bizId: string; actor: string; body: any; query: any; params: any; req: FastifyRequest };
type H = (c: Ctx) => unknown | Promise<unknown>;

/** Doanh nghiệp đang chọn: web gửi header `x-biz-id` (fetch) và cookie `taki_biz` (EventSource, <img>, <video>, tải tệp). */
export const BIZ_HEADER = "x-biz-id";
export const BIZ_COOKIE = "taki_biz";
function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
/** Doanh nghiệp yêu cầu xin (chưa kiểm): header > ?biz= > cookie. */
export function requestedBizId(req: Pick<FastifyRequest, "headers" | "query">): string | undefined {
  const h = req.headers[BIZ_HEADER];
  const fromHeader = Array.isArray(h) ? h[0] : h;
  const fromQuery = (req.query as Record<string, unknown> | undefined)?.biz;
  return (fromHeader || (typeof fromQuery === "string" ? fromQuery : "") || cookieValue(req.headers.cookie, BIZ_COOKIE) || "").trim() || undefined;
}
/** Id lạ / đã lưu trữ → doanh nghiệp mặc định (bản cài 1 chủ, không có ranh giới quyền giữa các doanh nghiệp). */
export function currentBizId(req: Pick<FastifyRequest, "headers" | "query">): string {
  const want = requestedBizId(req);
  return want && isActiveBiz(want) ? want : defaultBizId();
}

// Idempotency-Key replay store (spec §14). Production: persist in Redis/Postgres with TTL.
const idem = new Map<string, { at: number; body: unknown }>();

export function routes(app: FastifyInstance) {
  const wrap = (h: H) => async (req: FastifyRequest, reply: FastifyReply) => {
    const key = req.headers["idempotency-key"] as string | undefined;
    if (key && req.method !== "GET") {
      const hit = idem.get(`${requestedBizId(req) ?? ""}:${req.url}:${key}`);
      if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.body;
    }
    // Ngân Nguyệt's tools call this API from the same machine and sign their changes (audit log shows who did what).
    const as = req.headers["x-taki-actor"];
    const actor = typeof as === "string" && as && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip) ? decodeURIComponent(as).slice(0, 60) : "Phòng Marketing TAKI";
    const bizId = currentBizId(req);
    reply.header(BIZ_HEADER, bizId);
    const ctx: Ctx = { bizId, actor, body: req.body ?? {}, query: req.query ?? {}, params: req.params ?? {}, req };
    const out = await h(ctx);
    if (key && req.method !== "GET") idem.set(`${requestedBizId(req) ?? ""}:${req.url}:${key}`, { at: Date.now(), body: out ?? { ok: true } });
    return out ?? { ok: true };
  };
  return {
    get: (path: string, h: H) => app.get(path, wrap(h)),
    post: (path: string, h: H) => app.post(path, wrap(h)),
    put: (path: string, h: H) => app.put(path, wrap(h)),
    del: (path: string, h: H) => app.delete(path, wrap(h)),
  };
}

export function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  const requestId = req.id;
  if (err instanceof ZodError) return reply.status(400).send({ code: "VALIDATION", message: "Dữ liệu không hợp lệ", details: err.issues, requestId });
  if (err instanceof AppError) return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details, requestId });
  logger.error("api.error", { url: req.url, error: err instanceof Error ? err.stack : String(err) });
  return reply.status(500).send({ code: "INTERNAL", message: err instanceof Error ? err.message : "Lỗi hệ thống", requestId });
}
