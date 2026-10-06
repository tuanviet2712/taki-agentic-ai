import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, q } from "@dotaka/db";
import { jevEnabled } from "@dotaka/jev";
import { cliInfo, effectiveProvider, llmSettings } from "@dotaka/llm-gateway";
import { startOrchestrator } from "@dotaka/orchestrator";
import { logger } from "@dotaka/shared";
import { errorHandler } from "./http.ts";
import { chatRoutes } from "./routes/chat.ts";
import { coreRoutes } from "./routes/core.ts";
import { growthRoutes } from "./routes/growth.ts";
import { jevRoutes } from "./routes/jev.ts";
import { workRoutes } from "./routes/work.ts";
import { skillRoutes } from "./routes/skills.ts";
import { creativeRoutes } from "./routes/creative.ts";
import { connectRoutes } from "./routes/connect.ts";
import { zaloRoutes } from "./routes/zalo.ts";
import { orchestraRoutes } from "./routes/orchestra.ts";
import { assistantRoutes } from "./routes/assistant.ts";
import { accountRoutes } from "./routes/account.ts";
import { channelRoutes } from "./routes/channels.ts";
import { messengerRoutes } from "./routes/messenger.ts";
import { nurtureRoutes } from "./routes/nurture.ts";
import { researchRoutes } from "./routes/research.ts";
import { brainRoutes } from "./routes/brain.ts";
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
  const app = Fastify({ logger: false, genReqId: () => crypto.randomUUID() });
  await app.register(cors, { origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });
  app.setErrorHandler(errorHandler);

  coreRoutes(app);
  workRoutes(app);
  growthRoutes(app);
  chatRoutes(app);
  jevRoutes(app);
  skillRoutes(app);
  creativeRoutes(app);
  connectRoutes(app);
  zaloRoutes(app);
  orchestraRoutes(app);
  assistantRoutes(app);
  brainRoutes(app);
  accountRoutes(app);
  channelRoutes(app);
  messengerRoutes(app);
  nurtureRoutes(app);
  researchRoutes(app);

  const dist = resolve(process.cwd(), "apps/web/dist");
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/v1") || req.url.startsWith("/hooks") ? reply.status(404).send({ code: "NOT_FOUND", message: "Không có endpoint" }) : reply.sendFile("index.html")));
  }

  startOrchestrator();
  await app.listen({ port: PORT, host: HOST });
  console.log(`\n  TAKI Agentic AI · http://${HOST}:${PORT}`);
  console.log(`  Jev (TypeSafe): ${jevEnabled() ? "LIVE" : "chế độ heuristic (thiếu TYPESAFE_API_KEY)"}`);
  const bizId = q.get<{ id: string }>("SELECT id FROM biz LIMIT 1")!.id;
  const eff = effectiveProvider(bizId);
  console.log(`  Claude:         ${eff.provider === "claude_cli" ? `Claude Code CLI (${cliInfo().version}) — tài khoản đã đăng nhập` : `sandbox${eff.reason ? ` — ${eff.reason}` : ""}`}`);
  console.log(`  Model:          small=${llmSettings(bizId).models.small} · medium=${llmSettings(bizId).models.medium} · large=${llmSettings(bizId).models.large}`);
  const conns = q.all<{ platform: string; mode: string }>("SELECT platform, mode FROM connection WHERE status = 'active'");
  console.log(`  Nền tảng:       ${conns.length ? conns.map((c) => `${c.platform}${c.mode === "live" ? "" : " (mô phỏng)"}`).join(", ") : "chưa kết nối — kênh chạy mô phỏng"}\n`);
}

main().catch((e) => {
  logger.error("boot.failed", { error: e instanceof Error ? e.stack : String(e) });
  process.exit(1);
});
