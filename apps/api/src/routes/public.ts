import { createReadStream, statSync } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { recordClick, servableAsset, verifyMediaToken } from "@dotaka/orchestrator";
import { logger } from "@dotaka/shared";
import { oauthCallback } from "./oauth-callback.ts";

/**
 * CỔNG CÔNG KHAI — instance Fastify RIÊNG, chỉ chạy khi đặt PUBLIC_PORT. Đây là cổng duy nhất được phép đưa ra internet
 * (cloudflared / tunnel trỏ về PUBLIC_PORT; KHÔNG BAO GIỜ trỏ về cổng chính 8787: API chính không có đăng nhập).
 * Chỉ có đúng 4 đường dẫn GET, mọi thứ khác 404:
 *   /r/:code                       link đo click dưới bình luận (302 sang link sản phẩm + UTM)
 *   /m/:token                      media đã duyệt, ký sẵn, hết hạn sau 3 giờ (để Instagram tải ảnh/video)
 *   /v1/oauth/:provider/callback   quay về sau khi đăng nhập (TikTok cần https)
 *   /healthz
 * Không có static, không CORS, không /v1/* nào khác, không bọc routes().
 */
export const PUBLIC_ROUTES = ["/healthz", "/r/:code", "/m/:token", "/v1/oauth/:provider/callback"] as const;

/** IP khách thật phía sau Cloudflare Tunnel / proxy — chỉ tin được vì cổng này CHỈ nhận từ tunnel; chỉ dùng để băm. */
function clientIp(req: FastifyRequest): string | null {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim();
  return first(req.headers["cf-connecting-ip"]) || first(req.headers["x-forwarded-for"]) || req.ip || null;
}

// Giới hạn tần suất theo IP (không thêm thư viện): 120 yêu cầu / phút.
const hits = new Map<string, { n: number; at: number }>();
export function throttled(key: string, now = Date.now(), max = 120): boolean {
  const h = hits.get(key);
  if (!h || now - h.at > 60_000) {
    hits.set(key, { n: 1, at: now });
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.at > 60_000) hits.delete(k);
    return false;
  }
  h.n++;
  return h.n > max;
}

export function registerPublicRoutes(app: FastifyInstance) {
  app.setNotFoundHandler((_req, reply) => reply.status(404).type("text/plain; charset=utf-8").send("Not found"));
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/r/:code", async (req, reply) => {
    const code = String((req.params as { code?: string }).code ?? "");
    const ip = clientIp(req);
    if (throttled(`r:${ip ?? "?"}`)) return reply.status(429).type("text/plain; charset=utf-8").send("Too many requests");
    let hit: ReturnType<typeof recordClick>;
    try {
      hit = recordClick(code, { ip, ua: (req.headers["user-agent"] as string | undefined) ?? null, referer: (req.headers.referer as string | undefined) ?? null });
    } catch (e) {
      logger.error("track.click_failed", { code, error: String(e) });
    }
    if (!hit || !/^https?:\/\//i.test(hit.url)) return reply.status(404).type("text/html; charset=utf-8").send("<!doctype html><meta charset=utf-8><p>Link không tồn tại hoặc đã hết hạn.</p>");
    return reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer").header("x-robots-tag", "noindex").redirect(hit.url, 302);
  });

  app.get("/m/:token", async (req, reply) => {
    if (throttled(`m:${clientIp(req) ?? "?"}`, Date.now(), 600)) return reply.status(429).type("text/plain; charset=utf-8").send("Too many requests");
    const ok = verifyMediaToken(String((req.params as { token?: string }).token ?? ""));
    const file = ok ? servableAsset(ok.assetId) : null;
    if (!file) return reply.status(404).type("text/plain; charset=utf-8").send("Not found");
    const size = statSync(file.path).size;
    reply.header("x-robots-tag", "noindex").header("cache-control", "private, max-age=300").header("accept-ranges", "bytes").type(file.mime);
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (!(start <= end) || start >= size) return reply.status(416).header("content-range", `bytes */${size}`).send();
      return reply.status(206).header("content-range", `bytes ${start}-${end}/${size}`).header("content-length", end - start + 1).send(createReadStream(file.path, { start, end }));
    }
    return reply.header("content-length", size).send(createReadStream(file.path));
  });

  // Facebook cũng dùng được callback trên app chính (localhost); TikTok bắt buộc https → qua cổng này.
  app.get("/v1/oauth/:provider/callback", oauthCallback);
}
