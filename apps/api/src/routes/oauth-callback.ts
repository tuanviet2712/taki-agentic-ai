import type { FastifyReply, FastifyRequest } from "fastify";
import { finishOAuth, isOAuthProvider } from "@dotaka/orchestrator";

/**
 * Nền tảng chuyển trình duyệt về đây sau khi Sếp đăng nhập → đổi code lấy token → 302 quay lại trang Kênh đăng.
 * Dùng chung cho app chính (localhost:<API_PORT>, Facebook không cần tunnel) và cổng công khai (TikTok cần https).
 * Chỉ chuyển hướng — không bao giờ in `code` / lỗi lấy từ query ra nội dung trả về.
 */
export async function oauthCallback(req: FastifyRequest, reply: FastifyReply) {
  const provider = String((req.params as { provider?: string }).provider ?? "");
  if (!isOAuthProvider(provider)) return reply.status(404).type("text/plain").send("Not found");
  const url = await finishOAuth(provider, (req.query ?? {}) as Record<string, string>);
  return reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer").redirect(url, 302);
}
