import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { byId, type Row } from "@dotaka/db";
import { MODEL_CATALOG, cliInfo, effectiveProvider, modelFor } from "@dotaka/llm-gateway";
import {
  createTelegramPairCode, removeTelegramChat, telegramAssistantStatus,
  ASSISTANT, assistantBusy, assistantFindings, assistantSettings, checkActionPath, createAction, createThread, deleteThread, dispatchAgentTask,
  finishAction, getThread, listDispatches, listFeedback, listThreads, recordDispatch, saveAssistantSettings, sendAssistantMessage, setFeedback, stopAssistant,
} from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { routes, type Ctx } from "../http.ts";

/** Ngân Nguyệt — the CEO's command chat. Tool calls arrive with an x-taki-actor header (see taki-mcp.mjs). */
export function assistantRoutes(app: FastifyInstance) {
  const r = routes(app);
  // Only the CEO's own clicks may confirm cards or change Ngân Nguyệt's permissions — never her tools.
  const ceoOnly = (c: Ctx) => { if (c.req.headers["x-taki-actor"]) throw new AppError("FORBIDDEN", "Chỉ Sếp mới làm được thao tác này", 403); };

  /** Run a confirmed card through the normal API (same validation, audit, kill switch). */
  async function execute(bizId: string, id: string, actor: string) {
    const a = byId<Row>("assistant_action", id);
    if (!a || a.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy thẻ", 404);
    if (a.status !== "pending") throw new AppError("DONE", "Thẻ này đã xử lý", 409);
    const req = a.params as { method: "POST" | "PUT" | "DELETE"; path: string; body?: unknown };
    checkActionPath(req.path);
    const res = await app.inject({
      method: req.method, url: req.path, payload: req.body === undefined ? undefined : (req.body as any),
      headers: { "x-taki-actor": encodeURIComponent(actor), "idempotency-key": `assistant-action:${id}` },
    });
    let body: unknown = res.body;
    try { body = res.json(); } catch { /* not JSON */ }
    return finishAction(bizId, id, res.statusCode < 400 ? "done" : "failed", res.statusCode < 400 ? body : { status: res.statusCode, error: (body as any)?.message ?? body }, actor);
  }

  r.get("/v1/assistant", ({ bizId }) => ({
    name: ASSISTANT.name, settings: assistantSettings(bizId), defaultModel: modelFor(bizId, ASSISTANT.key, "medium"),
    models: MODEL_CATALOG, ready: effectiveProvider(bizId).provider === "claude_cli" && cliInfo().available && cliInfo().loggedIn !== false,
    authError: cliInfo().loggedIn === false ? (cliInfo().authError ?? "Claude CLI chưa đăng nhập") : undefined,
    suggestions: [
      "Hôm nay hệ thống có gì cần em để ý không?",
      "Báo cáo nhanh tình hình quảng cáo 7 ngày qua",
      "Giao Content Agent viết 1 bài Facebook giới thiệu khóa học mới",
      "Những mục nào đang chờ Sếp duyệt? Mục nào nên duyệt trước?",
      "Các agent đang làm gì? Có tác vụ nào lỗi không?",
    ],
  }));
  r.put("/v1/assistant/settings", (c) => {
    ceoOnly(c);
    const p = z.object({ model: z.string().nullable().optional(), autoConfirm: z.boolean().optional() }).parse(c.body);
    return saveAssistantSettings(c.bizId, p, c.actor);
  });

  r.get("/v1/assistant/threads", ({ bizId }) => listThreads(bizId));
  r.post("/v1/assistant/threads", ({ bizId }) => createThread(bizId));
  r.get("/v1/assistant/threads/:id", ({ bizId, params }) => getThread(bizId, params.id));
  r.del("/v1/assistant/threads/:id", (c) => { ceoOnly(c); deleteThread(c.bizId, c.params.id); });
  r.post("/v1/assistant/threads/:id/messages", (c) => {
    ceoOnly(c);
    const p = z.object({ text: z.string().min(1).max(8000), model: z.string().optional() }).parse(c.body);
    return sendAssistantMessage(c.bizId, c.params.id, p.text, { model: p.model });
  });
  r.post("/v1/assistant/threads/:id/stop", ({ params }) => { stopAssistant(params.id); return { running: assistantBusy(params.id) }; });

  r.get("/v1/assistant/findings", ({ bizId }) => assistantFindings(bizId));
  r.get("/v1/assistant/feedback", ({ bizId }) => listFeedback(bizId));
  r.post("/v1/assistant/messages/:id/feedback", (c) => {
    ceoOnly(c);
    const p = z.object({ feedback: z.enum(["up", "down"]).nullable(), note: z.string().max(1000).optional() }).parse(c.body);
    return setFeedback(c.bizId, c.params.id, p);
  });
  r.get("/v1/assistant/dispatches", ({ bizId }) => listDispatches(bizId));
  r.post("/v1/assistant/dispatches", ({ bizId, body }) => {
    const p = z.object({ threadId: z.string().nullable().optional(), kind: z.string(), refType: z.enum(["task", "goal", "creative_job", "job"]), refId: z.string(), title: z.string() }).parse(body);
    return recordDispatch(bizId, p);
  });
  r.post("/v1/assistant/agent-task", ({ bizId, body, actor }) => {
    const p = z.object({
      threadId: z.string().nullable().optional(), agent: z.enum(["content", "video_script", "seo_web"]), instruction: z.string().min(5).max(4000),
      channel: z.string().optional(), format: z.string().optional(), keyword: z.string().optional(), funnel: z.string().optional(),
    }).parse(body);
    return dispatchAgentTask(bizId, p as any, actor);
  });

  // Confirm cards
  r.post("/v1/assistant/actions", async ({ bizId, body }) => {
    const p = z.object({
      threadId: z.string().nullable().optional(), title: z.string().min(2), summary: z.string().default(""),
      request: z.object({ method: z.enum(["POST", "PUT", "DELETE"]), path: z.string(), body: z.unknown().optional() }),
    }).parse(body);
    const a = createAction(bizId, p);
    if (!assistantSettings(bizId).autoConfirm) return a;
    return execute(bizId, a.id, `${ASSISTANT.actor} · tự thực hiện`);
  });
  // Ngân Nguyệt trên Telegram: trạng thái, mã ghép nối, bỏ ghép nối 1 chat.
  r.get("/v1/assistant/telegram", ({ bizId }) => telegramAssistantStatus(bizId));
  r.post("/v1/assistant/telegram/pair", (c) => { ceoOnly(c); return createTelegramPairCode(c.bizId, c.actor); });
  r.del("/v1/assistant/telegram/chats/:id", (c) => { ceoOnly(c); return removeTelegramChat(c.bizId, c.params.id, c.actor); });
  r.post("/v1/assistant/actions/:id/confirm", async (c) => { ceoOnly(c); return execute(c.bizId, c.params.id, "Sếp · qua Ngân Nguyệt"); });
  r.post("/v1/assistant/actions/:id/cancel", (c) => {
    ceoOnly(c);
    const a = byId<Row>("assistant_action", c.params.id);
    if (!a || a.biz_id !== c.bizId) throw new AppError("NOT_FOUND", "Không thấy thẻ", 404);
    if (a.status !== "pending") throw new AppError("DONE", "Thẻ này đã xử lý", 409);
    return finishAction(c.bizId, a.id, "cancelled", null, c.actor);
  });
}
