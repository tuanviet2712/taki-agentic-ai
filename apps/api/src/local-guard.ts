import { hostname } from "node:os";
import type { FastifyInstance } from "fastify";

/**
 * Lớp bảo vệ nhỏ cho API chính (KHÔNG phải đăng nhập): chặn
 *  1. DNS rebinding / vô tình đưa cổng 8787 ra internet: `Host` phải là localhost, địa chỉ IP trực tiếp (127.0.0.1, IP trong LAN…),
 *     tên máy (1 nhãn / *.local), hoặc nằm trong ALLOWED_HOSTS (tên miền cách nhau dấu phẩy). Tên miền lạ → 421.
 *  2. Ghi chéo trang: yêu cầu ghi (POST/PUT/DELETE…) có `Sec-Fetch-Site: cross-site` hoặc `Origin` không thuộc các host trên → 403.
 * Không đụng: giao diện web (localhost:5173 qua proxy / 8787), MCP & Telegram (127.0.0.1), webhook /hooks/* (server → server,
 * đã có chữ ký HMAC), SSE, tải tệp. Cổng công khai là instance riêng nên không đi qua đây.
 */
const LOOPBACK_NAMES = new Set(["localhost", "ip6-localhost"]);
const hostOnly = (hostHeader: string): string => {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]")); // [::1]:8787
  return h.replace(/:\d+$/, "");
};
// IPv4 / IPv6 literal: trình duyệt không phân giải DNS cho nó → không thể là rebinding.
const isIpLiteral = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^[0-9a-f]*:[0-9a-f:.]*$/.test(h);

export function allowedHost(host: string, extra: string[] = (process.env.ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)): boolean {
  const h = hostOnly(host);
  if (!h) return false;
  // Tên máy 1 nhãn (desktop-abc, không có dấu chấm) hoặc *.local (mDNS) không thể là tên miền công khai → coi là mạng nội bộ.
  return LOOPBACK_NAMES.has(h) || h.endsWith(".localhost") || h.endsWith(".local") || !h.includes(".") || isIpLiteral(h) || h === hostname().toLowerCase() || extra.includes(h);
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
export function registerLocalGuard(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0];
    if (url === "/healthz" || url.startsWith("/hooks/")) return;
    if (!allowedHost(String(req.headers.host ?? ""))) {
      return reply.status(421).send({ code: "BAD_HOST", message: "Địa chỉ truy cập không được phép — hệ thống chỉ phục vụ localhost / mạng nội bộ (thêm tên miền vào ALLOWED_HOSTS nếu thật sự cần)" });
    }
    if (!SAFE.has(req.method)) {
      const site = String(req.headers["sec-fetch-site"] ?? "");
      const origin = String(req.headers.origin ?? "");
      let crossOrigin = site === "cross-site";
      if (origin && origin !== "null") {
        try { crossOrigin = crossOrigin || !allowedHost(new URL(origin).host); } catch { crossOrigin = true; }
      } else if (origin === "null") crossOrigin = true;
      if (crossOrigin) return reply.status(403).send({ code: "CROSS_SITE", message: "Yêu cầu ghi từ trang web khác bị chặn" });
    }
  });
}
