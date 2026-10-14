import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, q } from "@dotaka/db";
import { jevEnabled } from "@dotaka/jev";
import { cliInfo, codexInfo, effectiveProvider, llmSettings, probeCliAuth, selectedAiAccount } from "@dotaka/llm-gateway";
import { reencryptLegacySecrets, startOrchestrator } from "@dotaka/orchestrator";
import { logger } from "@dotaka/shared";
import { errorHandler } from "./http.ts";
import { registerLocalGuard } from "./local-guard.ts";
import { startPublicGateway } from "./public-gateway.ts";
import { registerApiRoutes } from "./register-routes.ts";
import { seed } from "./seed.ts";

const PORT = Number(process.env.API_PORT ?? 8787);
// Bound to localhost: this build has no login yet (spec M0 auth/2FA is the next milestone).
const HOST = process.env.HOST ?? "127.0.0.1";

async function main() {
  openDb();
  if (!q.get("SELECT id FROM biz LIMIT 1")) {
    logger.info("seed.first_run");
    await seed({ blank: process.env.SEED_MODE === "blank" });
  }
  // Đã đặt TOKEN_ENCRYPTION_KEY thật → chuyển mọi token/secret đang mã hóa bằng khóa dev công khai sang khóa mới (không mất kết nối).
  try { reencryptLegacySecrets(); } catch (e) { logger.warn("secrets.migrate_failed", { error: e instanceof Error ? e.message : String(e) }); }
  const app = Fastify({ logger: false, genReqId: () => crypto.randomUUID() });
  await app.register(cors, { origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });
  app.setErrorHandler(errorHandler);
  registerLocalGuard(app); // Host lạ / ghi chéo trang → 421 / 403 (không phải đăng nhập)

  registerApiRoutes(app); // danh sách module route: apps/api/src/register-routes.ts (có test khởi động server-boot.test.ts)

  const dist = resolve(process.cwd(), "apps/web/dist");
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/v1") || req.url.startsWith("/hooks") ? reply.status(404).send({ code: "NOT_FOUND", message: "Không có endpoint" }) : reply.sendFile("index.html")));
  }

  startOrchestrator();
  await app.listen({ port: PORT, host: HOST });
  console.log(`\n  TAKI Agentic AI · http://${HOST}:${PORT}`);
  // Cổng công khai (chỉ /r/:code, /m/:token, callback OAuth, /healthz) — chỉ chạy khi đặt PUBLIC_PORT; mặc định KHÔNG có cổng nào.
  const pub = await startPublicGateway(process.env, PORT);
  if (pub) {
    const pubPort = (pub.server.address() as { port: number }).port;
    console.log(`  Cổng công khai: http://127.0.0.1:${pubPort} (chỉ /r, /m, callback OAuth) — tunnel CHỈ trỏ về cổng này${process.env.PUBLIC_BASE_URL ? ` · ${process.env.PUBLIC_BASE_URL}` : " · chưa đặt PUBLIC_BASE_URL"}`);
  }
  console.log(`  Jev (TypeSafe): ${jevEnabled() ? "LIVE" : "chế độ heuristic (thiếu TYPESAFE_API_KEY)"}`);
  const bizId = q.get<{ id: string }>("SELECT id FROM biz LIMIT 1")!.id;
  const eff = effectiveProvider(bizId);
  if (eff.provider === "claude_cli") {
    const loggedIn = await probeCliAuth(); // `claude --version` still passes with an expired token — ask Claude itself
    const state = loggedIn === true ? "tài khoản đã đăng nhập" : loggedIn === false ? `⚠️  CHƯA ĐĂNG NHẬP — mở Terminal, gõ \`claude\` rồi \`/login\`${cliInfo().authError ? ` (${cliInfo().authError})` : ""}` : `⚠️  chưa xác minh được đăng nhập${cliInfo().authError ? ` (${cliInfo().authError})` : ""}`;
    console.log(`  Claude:         Claude Code CLI (${cliInfo().version}) — ${state}`);
  } else if (eff.provider === "codex_cli") console.log(`  ChatGPT:        ${codexInfo().version ?? "Codex CLI chưa cài"} · ${selectedAiAccount(bizId)?.name ?? "chưa chọn hồ sơ"}${eff.reason ? ` — ${eff.reason}` : ""}`);
  else console.log(`  Claude:         sandbox${eff.reason ? ` — ${eff.reason}` : ""}`);
  console.log(`  Model:          small=${llmSettings(bizId).models.small} · medium=${llmSettings(bizId).models.medium} · large=${llmSettings(bizId).models.large}`);
  const conns = q.all<{ platform: string; mode: string }>("SELECT platform, mode FROM connection WHERE status = 'active'");
  console.log(`  Nền tảng:       ${conns.length ? conns.map((c) => `${c.platform}${c.mode === "live" ? "" : " (mô phỏng)"}`).join(", ") : "chưa kết nối — kênh chạy mô phỏng"}\n`);
}

main().catch((e) => {
  logger.error("boot.failed", { error: e instanceof Error ? e.stack : String(e) });
  process.exit(1);
});
