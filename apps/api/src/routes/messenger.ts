import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { messengerSyncStatus, runMessengerSyncNow, setMessengerBot } from "@dotaka/orchestrator";
import { routes } from "../http.ts";

/** Đồng bộ Messenger của Fanpage thật về trang Hội thoại (chạy tay + trạng thái + bật/tắt bot trả lời). */
export function messengerRoutes(app: FastifyInstance) {
  const r = routes(app);
  r.get("/v1/messenger/sync/status", ({ bizId }) => messengerSyncStatus(bizId));
  r.post("/v1/messenger/sync", ({ bizId, body }) => {
    const p = z.object({ mode: z.enum(["incremental", "backfill"]).default("incremental"), days: z.number().int().min(1).max(90).optional() }).parse(body ?? {});
    return runMessengerSyncNow(bizId, p);
  });
  r.put("/v1/messenger/bot", ({ bizId, body, actor }) => setMessengerBot(bizId, z.object({ enabled: z.boolean() }).parse(body).enabled, actor));
}
