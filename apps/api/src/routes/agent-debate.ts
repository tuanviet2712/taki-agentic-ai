import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  advanceDebate,
  createDebate,
  debateMeta,
  deleteDebate,
  getDebate,
  listDebates,
  pauseDebate,
  sayToDebate,
  stopDebate,
} from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { routes, type Ctx } from "../http.ts";

const Debater = z
  .object({
    agentKey: z.string().min(1).max(60).optional(),
    label: z.string().min(1).max(80).optional(),
    provider: z.enum(["claude_cli", "grok_cli", "codex_cli", "gemini_cli"]).optional(),
    model: z.string().min(1).max(120).optional(),
    stance: z.string().max(300).optional(),
  })
  .optional();

const CreateBody = z.object({
  question: z.string().min(3).max(4000),
  a: Debater,
  b: Debater,
  maxTurns: z.number().int().min(4).max(20).optional(),
  consensusThreshold: z.number().int().min(60).max(100).optional(),
  pace: z.enum(["auto", "step"]).optional(),
  mode: z.enum(["auto", "live", "simulate"]).optional(),
  useDna: z.boolean().optional(),
  wait: z.boolean().optional(),
});

const SayBody = z.object({
  text: z.string().min(1).max(4000),
  to: z.enum(["both", "a", "b"]).optional(),
  wait: z.boolean().optional(),
});

const AdvanceBody = z.object({
  steps: z.enum(["one", "auto"]).optional(),
  pace: z.enum(["auto", "step"]).optional(),
  extraTurns: z.number().int().min(1).max(10).optional(),
  wait: z.boolean().optional(),
});

/** Phòng tranh luận AI (packages/orchestrator/src/agent-debate.ts). */
export function agentDebateRoutes(app: FastifyInstance) {
  const r = routes(app);
  // Chỉ người dùng trên giao diện điều khiển tranh luận; công cụ của Ngân Nguyệt / MCP (ký x-taki-actor) thì không.
  const ownerOnly = (c: Ctx) => {
    if (c.req.headers["x-taki-actor"]) throw new AppError("FORBIDDEN", "Chỉ người dùng mới được điều khiển Phòng tranh luận", 403);
  };

  r.get("/v1/agent-debates/meta", ({ bizId }) => debateMeta(bizId));
  r.get("/v1/agent-debates", ({ bizId }) => listDebates(bizId));
  r.get("/v1/agent-debates/:id", ({ bizId, params }) => getDebate(bizId, params.id));

  r.post("/v1/agent-debates", async (c) => {
    ownerOnly(c);
    return createDebate(c.bizId, CreateBody.parse(c.body ?? {}), c.actor);
  });

  r.post("/v1/agent-debates/:id/say", async (c) => {
    ownerOnly(c);
    return sayToDebate(c.bizId, c.params.id, SayBody.parse(c.body ?? {}), c.actor);
  });

  r.post("/v1/agent-debates/:id/advance", async (c) => {
    ownerOnly(c);
    return advanceDebate(c.bizId, c.params.id, AdvanceBody.parse(c.body ?? {}), c.actor);
  });

  r.post("/v1/agent-debates/:id/pause", (c) => {
    ownerOnly(c);
    return pauseDebate(c.bizId, c.params.id);
  });

  r.post("/v1/agent-debates/:id/stop", (c) => {
    ownerOnly(c);
    return stopDebate(c.bizId, c.params.id, c.actor);
  });

  r.del("/v1/agent-debates/:id", (c) => {
    ownerOnly(c);
    return deleteDebate(c.bizId, c.params.id, c.actor);
  });
}
