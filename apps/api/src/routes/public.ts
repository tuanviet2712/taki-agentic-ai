import { createReadStream, statSync } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { handleResendWebhook, recordClick, servableAsset, unsubscribeByToken, verifyMediaToken } from "@dotaka/orchestrator";
import { logger } from "@dotaka/shared";
import { oauthCallback } from "./oauth-callback.ts";

/**
 * CỔNG CÔNG KHAI — instance Fastify RIÊNG, chỉ chạy khi đặt PUBLIC_PORT. Đây là cổng duy nhất được phép đưa ra internet
 * (cloudflared / tunnel trỏ về PUBLIC_PORT; KHÔNG BAO GIỜ trỏ về cổng chính 8787: API chính không có đăng nhập).
 * Chỉ có các đường dẫn dưới đây, mọi thứ khác 404:
 *   /r/:code                       link đo click dưới bình luận (302 sang link sản phẩm + UTM)
 *   /m/:token                      media đã duyệt, ký sẵn, hết hạn sau 3 giờ (để Instagram tải ảnh/video)
 *   /v1/oauth/:provider/callback   quay về sau khi đăng nhập (TikTok cần https)
 *   /hooks/email/resend (POST)     webhook Resend: giao / mở / click / bounce / khiếu nại (kiểm chữ ký svix)
 *   /u/:token (GET + POST)         hủy nhận email (trang xác nhận + một chạm RFC 8058)
 *   /healthz
 * Không có static, không CORS, không /v1/* nào khác, không bọc routes().
 */
export const PUBLIC_ROUTES = ["/healthz", "/r/:code", "/m/:token", "/v1/oauth/:provider/callback", "/hooks/email/resend", "/u/:token"] as const;

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

  // ---- Email ----
  // Thân yêu cầu giữ nguyên dạng chuỗi (webhook phải kiểm chữ ký trên thân RAW; hủy một chạm gửi form-urlencoded).
  app.addContentTypeParser("*", { parseAs: "string", bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));
  app.post("/hooks/email/resend", async (req, reply) => {
    if (throttled(`w:${clientIp(req) ?? "?"}`, Date.now(), 1200)) return reply.status(429).send({ ok: false });
    let out: ReturnType<typeof handleResendWebhook>;
    try {
      out = handleResendWebhook(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}), req.headers as Record<string, string | string[] | undefined>);
    } catch (e) {
      logger.error("email.webhook_failed", { error: String(e).slice(0, 300) });
      return reply.status(500).send({ ok: false });
    }
    return reply.status(out.status).send(out.body);
  });
  const unsubPage = (title: string, text: string, extra = "") => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;background:#f3f4f6;color:#1f2937;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px">
<div style="max-width:420px;text-align:center;border:1px solid #e5e7eb;border-radius:14px;padding:32px;background:#fff"><div style="font-size:34px">✉️</div>
<h1 style="font-size:19px;margin:12px 0 8px">${title}</h1><p style="font-size:14px;color:#6b7280;line-height:1.6">${text}</p>${extra}</div></body></html>`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  // Trang hủy nhận (link trong footer): GET hiện nút xác nhận — tránh trình quét link của hộp thư tự hủy hộ khách.
  app.get("/u/:token", async (req, reply) => {
    if (throttled(`u:${clientIp(req) ?? "?"}`)) return reply.status(429).type("text/plain; charset=utf-8").send("Too many requests");
    const token = String((req.params as { token?: string }).token ?? "");
    reply.header("cache-control", "no-store").header("x-robots-tag", "noindex").type("text/html; charset=utf-8");
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return reply.status(404).send(unsubPage("Liên kết không hợp lệ", "Liên kết hủy nhận đã hỏng. Bạn có thể trả lời thẳng email để yêu cầu ngừng nhận thư."));
    return reply.send(unsubPage("Hủy nhận email?", "Bạn sẽ không nhận email marketing nữa. Thư giao dịch thiết yếu (xác nhận đơn hàng…) vẫn được gửi khi cần.",
      `<form method="post" action="/u/${esc(token)}"><input type="hidden" name="confirm" value="1"><button style="margin-top:8px;padding:10px 22px;border:0;border-radius:8px;background:#0f172a;color:#fff;font-size:15px;cursor:pointer">Xác nhận hủy nhận</button></form>`));
  });
  // POST: nút xác nhận ở trang trên, hoặc hủy một chạm RFC 8058 (Gmail/Yahoo gửi "List-Unsubscribe=One-Click").
  app.post("/u/:token", async (req, reply) => {
    if (throttled(`u:${clientIp(req) ?? "?"}`)) return reply.status(429).send("Too many requests");
    const token = String((req.params as { token?: string }).token ?? "");
    const oneClick = String(req.body ?? "").includes("List-Unsubscribe=One-Click");
    let res: ReturnType<typeof unsubscribeByToken>;
    try { res = unsubscribeByToken(token, oneClick ? "one_click" : "link"); } catch (e) {
      logger.error("email.unsubscribe_failed", { error: String(e).slice(0, 300) });
      return reply.status(500).type("text/html; charset=utf-8").send(unsubPage("Có lỗi xảy ra", "Hệ thống bận — thử lại sau ít phút nhé."));
    }
    if (oneClick) return reply.status(res.ok ? 200 : 404).send("");
    reply.header("cache-control", "no-store").type("text/html; charset=utf-8");
    return res.ok
      ? reply.send(unsubPage("Đã hủy nhận", `Bạn sẽ không nhận thêm email marketing${res.brand ? ` từ ${esc(res.brand)}` : ""} nữa.`))
      : reply.status(404).send(unsubPage("Liên kết không hợp lệ", "Liên kết hủy nhận đã hỏng. Bạn có thể trả lời thẳng email để yêu cầu ngừng nhận thư."));
  });
}
