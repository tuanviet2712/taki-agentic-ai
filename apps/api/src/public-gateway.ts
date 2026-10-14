import Fastify, { type FastifyInstance } from "fastify";
import { setPublicGateway } from "@dotaka/orchestrator";
import { logger } from "@dotaka/shared";
import { registerPublicRoutes } from "./routes/public.ts";

/** Dựng instance công khai (chưa lắng nghe) — dùng cho server.ts và test. */
export async function buildPublicApp(): Promise<FastifyInstance> {
  // maxParamLength: token media ký sẵn dài ~100 ký tự (mặc định của Fastify là 100 → 414).
  const app = Fastify({ logger: false, genReqId: () => crypto.randomUUID(), routerOptions: { maxParamLength: 256 } });
  registerPublicRoutes(app);
  await app.ready();
  return app;
}

/**
 * Chỉ khởi động khi đặt PUBLIC_PORT (mặc định KHÔNG đặt → không có cổng nào, không đổi hành vi).
 * Chỉ nghe 127.0.0.1 (tunnel nối vào máy này). Trả instance đang chạy, hoặc null khi không bật / không chạy được.
 */
export async function startPublicGateway(env: NodeJS.ProcessEnv = process.env, apiPort?: number): Promise<FastifyInstance | null> {
  const raw = env.PUBLIC_PORT?.trim();
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    logger.warn("public_gateway.bad_port", { PUBLIC_PORT: raw });
    return null;
  }
  if (apiPort && port === apiPort) {
    logger.warn("public_gateway.same_port", { port, msg: "PUBLIC_PORT trùng API_PORT — cổng công khai KHÔNG được chạy chung cổng với API chính" });
    return null;
  }
  try {
    const app = await buildPublicApp();
    await app.listen({ port, host: env.PUBLIC_HOST?.trim() || "127.0.0.1" });
    const actual = (app.server.address() as { port: number } | null)?.port ?? port;
    setPublicGateway({ listening: true, port: actual });
    return app;
  } catch (e) {
    setPublicGateway({ listening: false });
    logger.error("public_gateway.failed", { port, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
