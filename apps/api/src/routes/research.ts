import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addResearchChannel, cloneResearchVideo, decodeResearchVideo, queueResearchScan, removeResearchChannel, researchOverview, saveResearchSettings, updateResearchChannel,
} from "@dotaka/orchestrator";
import { routes } from "../http.ts";

/** Research đối thủ · Radar xu hướng (trang /research). */
export function researchRoutes(app: FastifyInstance) {
  const r = routes(app);
  r.get("/v1/research", ({ bizId, query }) => researchOverview(bizId, { days: Number(query.days ?? 30), group: typeof query.group === "string" && query.group ? query.group : null }));
  r.post("/v1/research/channels", ({ bizId, body, actor }) => addResearchChannel(bizId, body, actor));
  r.put("/v1/research/channels/:id", ({ bizId, params, body, actor }) => updateResearchChannel(bizId, params.id, body, actor));
  r.del("/v1/research/channels/:id", ({ bizId, params, actor }) => removeResearchChannel(bizId, params.id, actor));
  r.post("/v1/research/scan", ({ bizId, body }) => queueResearchScan(bizId, z.object({ channelIds: z.array(z.string()).optional() }).parse(body ?? {}).channelIds));
  r.post("/v1/research/videos/:id/decode", ({ bizId, params, body }) => decodeResearchVideo(bizId, params.id, { group: z.object({ group: z.string().optional() }).parse(body ?? {}).group }));
  r.post("/v1/research/videos/:id/clone", ({ bizId, params, body, actor }) => cloneResearchVideo(bizId, params.id, z.object({ group: z.string().min(1) }).parse(body).group, actor));
  r.put("/v1/research/settings", ({ bizId, body, actor }) => saveResearchSettings(bizId, body, actor));
}
