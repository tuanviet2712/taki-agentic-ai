import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  auditAndOptimizeGoal,
  auditAndOptimizeTarget,
  createAndStartDialogue,
  deleteDialogue,
  dialogueMeta,
  executeDialogueCta,
  getDialogue,
  interveneDialogue,
  listDialogues,
  promoteDialogueToApproval,
  stopDialogue,
} from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { routes, type Ctx } from "../http.ts";

const ParticipantInput = z
  .object({
    agentKey: z.string().min(1).max(60).optional(),
    label: z.string().min(1).max(120).optional(),
    provider: z.enum(["claude_cli", "grok_cli", "codex_cli", "gemini_cli", "sandbox"]).optional(),
    model: z.string().min(1).max(120).optional(),
  })
  .optional();

const CreateDialogueBody = z.object({
  scenario: z.string().min(1).max(60).optional(),
  topic: z.string().min(3).max(4000),
  channel: z.string().min(1).max(40).optional(),
  maxRounds: z.number().int().min(1).max(5).optional(),
  passThreshold: z.number().int().min(50).max(98).optional(),
  mode: z.enum(["auto", "live", "simulate"]).optional(),
  writer: ParticipantInput,
  reviewer: ParticipantInput,
  runImmediately: z.boolean().optional(),
});

const AuditTargetBody = z.object({
  targetType: z.enum(["task", "content_item", "approval", "ad_candidate", "action"]),
  targetId: z.string().min(1).max(120),
  mode: z.enum(["auto", "live", "simulate"]).optional(),
  writerProvider: z.enum(["claude_cli", "grok_cli", "codex_cli", "gemini_cli", "sandbox"]).optional(),
  reviewerProvider: z.enum(["claude_cli", "grok_cli", "codex_cli", "gemini_cli", "sandbox"]).optional(),
  instruction: z.string().max(2000).optional(),
  forceRevise: z.boolean().optional(),
});

const AuditGoalBody = z.object({
  mode: z.enum(["auto", "live", "simulate"]).optional(),
  writerProvider: z.enum(["claude_cli", "grok_cli", "codex_cli", "gemini_cli", "sandbox"]).optional(),
  reviewerProvider: z.enum(["claude_cli", "grok_cli", "codex_cli", "gemini_cli", "sandbox"]).optional(),
});

const ExecuteCtaBody = z.object({
  action: z.enum(["approve", "re_optimize", "apply_to_plan"]).optional(),
  instruction: z.string().max(2000).optional(),
});

const InterveneBody = z.object({
  text: z.string().min(1).max(2000),
  wait: z.boolean().optional(),
});

export function agentDialogueRoutes(app: FastifyInstance) {
  const r = routes(app);
  // Security guard (ECC): Prevent MCP tools or untrusted actors from spoofing CEO actions on the Multi-Agent Council
  const ceoOnly = (c: Ctx) => {
    if (c.req.headers["x-taki-actor"]) {
      throw new AppError("FORBIDDEN", "Chỉ Sếp mới được điều khiển Hội đồng Agent hoặc đẩy bài vào Hộp Duyệt", 403);
    }
  };

  r.get("/v1/agent-dialogues/meta", ({ bizId }) => dialogueMeta(bizId));

  r.get("/v1/agent-dialogues", ({ bizId }) => listDialogues(bizId));

  r.get("/v1/agent-dialogues/:id", ({ bizId, params }) => getDialogue(bizId, params.id));

  r.post("/v1/agent-dialogues", async (c) => {
    ceoOnly(c);
    const body = CreateDialogueBody.parse(c.body ?? {});
    return createAndStartDialogue(c.bizId, body, c.actor);
  });

  r.post("/v1/agent-dialogues/audit-target", async (c) => {
    ceoOnly(c);
    const body = AuditTargetBody.parse(c.body ?? {});
    return auditAndOptimizeTarget(c.bizId, body, c.actor);
  });

  r.post("/v1/agent-dialogues/audit-goal/:goalId", async (c) => {
    ceoOnly(c);
    const body = AuditGoalBody.parse(c.body ?? {});
    return auditAndOptimizeGoal(c.bizId, c.params.goalId, body, c.actor);
  });

  r.post("/v1/agent-dialogues/:id/execute-cta", async (c) => {
    ceoOnly(c);
    const body = ExecuteCtaBody.parse(c.body ?? {});
    return executeDialogueCta(c.bizId, c.params.id, body.action ?? "approve", c.actor, body.instruction);
  });

  r.post("/v1/agent-dialogues/:id/intervene", async (c) => {
    ceoOnly(c);
    const body = InterveneBody.parse(c.body ?? {});
    return interveneDialogue(c.bizId, c.params.id, body.text, c.actor, body.wait ?? true);
  });

  r.post("/v1/agent-dialogues/:id/stop", (c) => {
    ceoOnly(c);
    return stopDialogue(c.bizId, c.params.id, c.actor);
  });

  r.post("/v1/agent-dialogues/:id/promote", (c) => {
    ceoOnly(c);
    return promoteDialogueToApproval(c.bizId, c.params.id, c.actor);
  });

  r.del("/v1/agent-dialogues/:id", (c) => {
    ceoOnly(c);
    return deleteDialogue(c.bizId, c.params.id, c.actor);
  });
}
