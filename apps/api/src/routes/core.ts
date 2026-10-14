import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CATALOG, STAGES } from "@dotaka/agents";
import { AgentConfigUpdate } from "@dotaka/contracts";
import { activeDna, audit, bizSettings, bus, byId, emit, insert, ownerProfile, q, update, type Row } from "@dotaka/db";
import { JEV_MODEL, jevEnabled } from "@dotaka/jev";
import { DEFAULT_LLM, DEFAULT_CODEX_MODELS, MODEL_CATALOG, cancelAiLogin, checkAiAccount, codexInfo, createAiAccount, disconnectAiAccount, listAiAccounts, mustAiAccount, removeAiAccount, selectedAiAccount, startAiLogin, cliInfo, effectiveProvider, llmSettings, modelCatalog, modelMatchesProvider, modelFor, testModel, tokensUsedToday, type Tier } from "@dotaka/llm-gateway";
import { FLOW_IMAGE_MODELS, imageEngineStatus, latestDaily, sumMetrics, today } from "@dotaka/orchestrator";
import { AppError, sha256 } from "@dotaka/shared";
import { currentBizId, routes } from "../http.ts";
import { publicProfile } from "./account.ts";

const since = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
const dayStr = (days: number) => today(new Date(Date.now() - days * 86400_000));

export function adsWindow(bizId: string, fromDaysAgo: number, toDaysAgo = 0) {
  const ads = q.all<Row>("SELECT id FROM ad WHERE biz_id = ?", bizId);
  return sumMetrics(ads.flatMap((a) => latestDaily(bizId, a.id, dayStr(fromDaysAgo), dayStr(toDaysAgo))));
}
const pct = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export function coreRoutes(app: FastifyInstance) {
  const r = routes(app);

  r.get("/v1/system", ({ bizId }) => ({
    biz: q.get("SELECT id, name, timezone, currency FROM biz WHERE id = ?", bizId),
    ceo: activeDna(bizId)?.data?.company?.ceo ?? "CEO",
    operator: ownerProfile().name,
    profile: publicProfile(),
    brand: activeDna(bizId)?.data?.company?.brand ?? null,
    pendingConfirmations: activeDna(bizId)?.data?.pendingConfirmations?.length ?? 0,
    jev: { enabled: jevEnabled(), model: JEV_MODEL },
    llm: { enabled: effectiveProvider(bizId).provider !== "sandbox" && effectiveProvider(bizId).ready !== false, ...effectiveProvider(bizId), chosen: llmSettings(bizId).provider, models: llmSettings(bizId).models, loggedIn: llmSettings(bizId).provider === "codex_cli" ? !!selectedAiAccount(bizId)?.loggedIn : cliInfo().loggedIn, authError: llmSettings(bizId).provider === "codex_cli" ? effectiveProvider(bizId).reason : cliInfo().authError },
    connectorsMode: "sandbox",
    killSwitch: bizSettings(bizId).killSwitch,
    connections: {
      live: q.scalar<number>("SELECT COUNT(*) FROM connection WHERE biz_id = ? AND mode = 'live' AND status = 'active'", bizId),
      sandbox: q.scalar<number>("SELECT COUNT(*) FROM connection WHERE biz_id = ? AND mode = 'sandbox' AND status = 'active'", bizId),
      broken: q.scalar<number>("SELECT COUNT(*) FROM connection WHERE biz_id = ? AND status IN ('error','expired')", bizId),
    },
    counts: {
      approvals: q.scalar("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'pending'", bizId),
      unread: q.scalar("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND state IN ('handoff_pending','bot_active','awaiting_customer','new') AND unread > 0", bizId),
      handoff: q.scalar("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND state = 'handoff_pending'", bizId),
    },
  }));

  r.get("/v1/overview", ({ bizId }) => {
    const rev = (a: number, b: number) => q.scalar<number>("SELECT COALESCE(SUM(total),0) FROM orders WHERE biz_id = ? AND status = 'paid' AND created_at >= ? AND created_at < ?", bizId, since(a), since(b));
    const cnt = (sql: string, a: number, b: number) => q.scalar<number>(sql, bizId, since(a), since(b));
    const ads7 = adsWindow(bizId, 6), adsPrev = adsWindow(bizId, 13, 7);
    const leadsSql = "SELECT COUNT(*) FROM lead WHERE biz_id = ? AND created_at >= ? AND created_at < ?";
    const ordersSql = "SELECT COUNT(*) FROM orders WHERE biz_id = ? AND created_at >= ? AND created_at < ?";
    const newCustomers = cnt(leadsSql, 7, 0) + cnt(ordersSql, 7, 0);
    const newCustomersPrev = cnt(leadsSql, 14, 7) + cnt(ordersSql, 14, 7);
    const postReach = q.scalar<number>("SELECT COALESCE(SUM(json_extract(metrics,'$.reach')),0) FROM post_metric_snapshot s WHERE biz_id = ? AND captured_at >= ? AND captured_at = (SELECT MAX(captured_at) FROM post_metric_snapshot x WHERE x.post_id = s.post_id)", bizId, since(7));
    const revenue14 = rev(14, 0);
    const dna = activeDna(bizId)?.data;

    const stageCount: Record<string, number> = {
      dna: q.scalar("SELECT COUNT(*) FROM task WHERE biz_id = ? AND agent_key IN ('brief','dna_intake')", bizId),
      research: q.scalar("SELECT COUNT(*) FROM task WHERE biz_id = ? AND agent_key = 'market_research'", bizId),
      strategy: q.scalar("SELECT COUNT(*) FROM task WHERE biz_id = ? AND agent_key = 'strategy'", bizId),
      content: q.scalar("SELECT COUNT(*) FROM task WHERE biz_id = ? AND agent_key IN ('content','video_script','seo_web')", bizId),
      publish: q.scalar("SELECT COUNT(*) FROM publish_job WHERE biz_id = ?", bizId) + q.scalar("SELECT COUNT(*) FROM post WHERE biz_id = ?", bizId),
      ads: q.scalar("SELECT COUNT(*) FROM ad WHERE biz_id = ? AND status = 'active'", bizId) + q.scalar("SELECT COUNT(*) FROM ad_candidate WHERE biz_id = ?", bizId),
      analytics: q.scalar("SELECT COUNT(*) FROM rule_run WHERE biz_id = ?", bizId),
      chat: q.scalar("SELECT COUNT(*) FROM conversation WHERE biz_id = ?", bizId),
      feedback: q.scalar("SELECT COUNT(*) FROM lesson WHERE biz_id = ?", bizId) + q.scalar("SELECT COUNT(*) FROM change_proposal WHERE biz_id = ?", bizId),
    };
    const channels = ["facebook", "instagram", "tiktok", "youtube", "google", "zalo"].map((ch) => {
      const posts = q.all<Row>(`SELECT s.metrics FROM post_metric_snapshot s JOIN post p ON p.id = s.post_id JOIN channel c ON c.id = p.channel_id WHERE p.biz_id = ? AND c.platform = ? AND s.captured_at = (SELECT MAX(captured_at) FROM post_metric_snapshot x WHERE x.post_id = s.post_id)`, bizId, ch);
      const platform = ch === "google" ? "google_ads" : ch === "tiktok" ? "tiktok" : ch === "facebook" ? "meta" : null;
      const adIds = platform ? q.all<Row>("SELECT id FROM ad WHERE biz_id = ? AND platform = ?", bizId, platform) : [];
      const am = sumMetrics(adIds.flatMap((a) => latestDaily(bizId, a.id, dayStr(6))));
      const reach = posts.reduce((a, p) => a + p.metrics.reach, 0) + (am.reach ?? 0);
      const engagement = posts.reduce((a, p) => a + p.metrics.reactions + p.metrics.comments + p.metrics.shares, 0) + am.clicks;
      const src = ch === "google" ? "google_search" : ch;
      const orders = q.scalar<number>("SELECT COUNT(*) FROM orders WHERE biz_id = ? AND source = ? AND created_at >= ?", bizId, src, since(7));
      return { channel: ch, reach, engagement, orders };
    });
    const sources = q.all<Row>("SELECT COALESCE(source,'khác') source, COUNT(*) n, SUM(total) revenue FROM orders WHERE biz_id = ? AND created_at >= ? GROUP BY 1 ORDER BY n DESC", bizId, since(7));

    return {
      kpis: {
        revenue: { value: rev(7, 0), delta: pct(rev(7, 0), rev(14, 7)) },
        newCustomers: { value: newCustomers, delta: pct(newCustomers, newCustomersPrev) },
        reach: { value: (ads7.reach ?? 0) + postReach, delta: pct(ads7.reach ?? 0, adsPrev.reach ?? 0) },
        adSpend: { value: ads7.spend, delta: pct(ads7.spend, adsPrev.spend) },
      },
      goal: { yearTarget: dna?.goals?.yearTarget ?? 0, runRate: Math.round((revenue14 / 14) * 365) /* annualised from the last 14 days */, currentRunRate: dna?.goals?.currentRunRate ?? 0 },
      stages: STAGES.map((s) => ({ ...s, count: stageCount[s.key] ?? 0 })),
      runningTasks: q.all("SELECT id, title, agent_key, status, progress, step, updated_at FROM task WHERE biz_id = ? AND status IN ('running','in_review','revising','awaiting_approval','ready') ORDER BY updated_at DESC LIMIT 6", bizId),
      approvals: q.all("SELECT id, title, subject_type, agent_key, risk, created_at, preview FROM approval WHERE biz_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 5", bizId),
      channels,
      sources,
      inbox: q.all("SELECT id, customer_name, channel, last_preview, last_message_at, state, lead_grade, unread FROM conversation WHERE biz_id = ? ORDER BY last_message_at DESC LIMIT 4", bizId),
      jev: {
        judgments7d: q.scalar("SELECT COUNT(*) FROM jev_judgment WHERE biz_id = ? AND created_at >= ?", bizId, since(7)),
        handoffs: q.scalar("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND state = 'handoff_pending'", bizId),
        guardBlocks: q.scalar("SELECT COUNT(*) FROM audit_log WHERE biz_id = ? AND event = 'chat.guard_blocked'", bizId),
        injections: q.scalar("SELECT COUNT(*) FROM audit_log WHERE biz_id = ? AND event = 'security.injection_detected'", bizId),
      },
    };
  });

  // ---------------- Agents & config ----------------
  r.get("/v1/agents", ({ bizId }) => CATALOG.map((c) => {
    const cfg = q.get<Row>("SELECT * FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, c.key);
    const runs = q.get<Row>("SELECT COUNT(*) n, SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) ok FROM task t WHERE t.biz_id = ? AND t.agent_key = ?", bizId, c.key);
    const reviews = q.get<Row>("SELECT AVG(total) avg FROM review_score r JOIN task t ON (t.id = r.subject_id OR r.subject_id IN (SELECT id FROM content_item WHERE task_id = t.id)) WHERE t.agent_key = ? AND t.biz_id = ?", c.key, bizId);
    return { ...c, model: modelFor(bizId, c.key, c.tier.startsWith("large") ? "large" : c.tier.startsWith("medium") ? "medium" : "small"), modelOverride: cfg?.limits?.model ?? null, config: cfg, tasks: runs?.n ?? 0, done: runs?.ok ?? 0, avgReview: reviews?.avg ? Math.round(reviews.avg) : null, tokensToday: tokensUsedToday(bizId, c.key) };
  }));
  r.put("/v1/agents/:key/config", ({ bizId, params, body, actor }) => {
    const patch = AgentConfigUpdate.parse(body);
    const cfg = q.get<Row>("SELECT * FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, params.key);
    if (!cfg) throw new AppError("NOT_FOUND", "Không có agent", 404);
    const limits = patch.model !== undefined ? { ...(cfg.limits ?? {}), model: patch.model ?? undefined } : cfg.limits;
    update("agent_config", cfg.id, { ...(patch.autonomy ? { autonomy: patch.autonomy } : {}), ...(patch.enabled != null ? { enabled: patch.enabled ? 1 : 0 } : {}), ...(patch.tokenBudgetDay ? { token_budget_day: patch.tokenBudgetDay } : {}), limits });
    audit(bizId, actor, "agent.config_changed", { type: "agent_config", id: cfg.id }, { agent: params.key, before: { autonomy: cfg.autonomy, enabled: cfg.enabled }, after: patch });
    return byId("agent_config", cfg.id);
  });

  // ---------------- LLM provider & model selection ----------------
  r.get("/v1/llm", ({ bizId }) => ({ settings: llmSettings(bizId), effective: effectiveProvider(bizId), cli: cliInfo(), codex: codexInfo(), accounts: listAiAccounts(bizId, false), selectedAccount: selectedAiAccount(bizId), catalog: modelCatalog(bizId), defaults: DEFAULT_LLM }));
  r.put("/v1/llm", ({ bizId, body, actor }) => {
    const model = z.string().min(3).max(100).regex(/^[a-z0-9._-]+$/i);
    const p = z.object({ provider: z.enum(["claude_cli", "codex_cli", "sandbox"]).optional(), codexAccountId: z.string().nullable().optional(), models: z.object({ small: model, medium: model, large: model }).partial().optional(), effort: z.enum(["low", "medium", "high"]).optional() }).parse(body);
    const cur = llmSettings(bizId);
    if (p.codexAccountId) mustAiAccount(bizId, p.codexAccountId);
    const provider = p.provider ?? cur.provider;
    const saved = { ...cur.providerModels, [cur.provider]: cur.models };
    const baseModels = provider === cur.provider || provider === "sandbox" ? cur.models : saved[provider] ?? (provider === "codex_cli" ? DEFAULT_CODEX_MODELS : DEFAULT_LLM.models);
    const models = { ...baseModels, ...(p.models ?? {}) } as Record<Tier, string>;
    if (provider !== "sandbox" && Object.values(models).some((m) => !modelMatchesProvider(m, provider))) throw new AppError("BAD_MODEL", "Model không thuộc kết nối AI đã chọn", 400);
    const next = { ...cur, ...p, models, providerModels: { ...saved, [provider]: models } };
    const s = bizSettings(bizId);
    update("biz", bizId, { settings: { ...s, llm: next } });
    audit(bizId, actor, "llm.settings_changed", { type: "biz", id: bizId }, { before: cur, after: next });
    emit(bizId, "llm.updated", {});
    return { settings: next, effective: effectiveProvider(bizId), catalog: modelCatalog(bizId), selectedAccount: selectedAiAccount(bizId) };
  });
  r.post("/v1/llm/test", ({ bizId, body }) => testModel(bizId, z.object({ model: z.string() }).parse(body).model));

  // OAuth is performed by the installed CLI on the local machine; no shared default ChatGPT account.
  const localAccountAction = (req: { ip: string; headers: Record<string, unknown> }) => {
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip)) throw new AppError("LOCAL_ONLY", "Quản lý đăng nhập ChatGPT trên máy chạy hệ thống", 403);
    if (req.headers["x-taki-actor"]) throw new AppError("DIRECT_ONLY", "Người dùng tự quản lý đăng nhập ChatGPT trên giao diện", 403);
  };
  r.get("/v1/llm/accounts", ({ bizId, req }) => { localAccountAction(req); return listAiAccounts(bizId); });
  r.post("/v1/llm/accounts", ({ bizId, body, actor, req }) => { localAccountAction(req); return createAiAccount(bizId, z.object({ name: z.string().trim().min(1).max(80) }).parse(body).name, actor); });
  r.post("/v1/llm/accounts/:id/login", ({ bizId, params, body, actor, req }) => { localAccountAction(req); return startAiLogin(bizId, params.id, z.object({ method: z.enum(["browser", "device"]).default("browser") }).parse(body).method, actor); });
  r.post("/v1/llm/accounts/:id/cancel", ({ bizId, params, req }) => { localAccountAction(req); return cancelAiLogin(bizId, params.id); });
  r.post("/v1/llm/accounts/:id/check", ({ bizId, params, req }) => { localAccountAction(req); return checkAiAccount(bizId, params.id); });
  r.post("/v1/llm/accounts/:id/disconnect", ({ bizId, params, actor, req }) => { localAccountAction(req); return disconnectAiAccount(bizId, params.id, actor); });
  r.del("/v1/llm/accounts/:id", ({ bizId, params, actor, req }) => { localAccountAction(req); return removeAiAccount(bizId, params.id, actor); });

  r.get("/v1/schedules", ({ bizId }) => q.all("SELECT * FROM schedule WHERE biz_id = ? ORDER BY every_minutes", bizId));
  r.put("/v1/schedules/:id", ({ bizId, params, body, actor }) => {
    const s = byId<Row>("schedule", params.id);
    if (!s || s.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy lịch", 404);
    update("schedule", s.id, { enabled: body.enabled ? 1 : 0 });
    audit(bizId, actor, "schedule.toggled", { type: "schedule", id: s.id }, { enabled: body.enabled });
    return byId("schedule", s.id);
  });

  // ---------------- Settings, kill switch, audit, usage ----------------
  r.get("/v1/settings", ({ bizId }) => ({
    biz: q.get("SELECT * FROM biz WHERE id = ?", bizId),
    settings: bizSettings(bizId),
    connections: q.all("SELECT id, platform, display_name, external_account_id, scopes, status, mode, expires_at, last_health_at FROM connection WHERE biz_id = ?", bizId), // never the token
    users: q.all("SELECT id, name, email, role, status, last_active_at FROM user_account WHERE biz_id = ?", bizId),
    mcpKeys: q.all("SELECT id, name, key_last4, permissions, expires_at, revoked_at, created_at FROM mcp_key WHERE biz_id = ?", bizId),
  }));
  r.put("/v1/settings", ({ bizId, body, actor }) => {
    const Patch = z.object({
      caps: z.object({ maxTotalDailyAdBudget: z.number().int().positive(), maxAdsCreatedPerDay: z.number().int().min(0), maxPostsPerDayPerChannel: z.number().int().min(0) }).partial().optional(),
      postScoreThreshold: z.number().min(0).max(100).optional(),
      explorationPct: z.number().min(0).max(100).optional(),
      approvalExpiryHours: z.number().int().positive().optional(),
      backupPerson: z.string().optional(),
      // vision: bot xem ảnh khách gửi (mặc định bật; cần bot Messenger bật). closeOrders: bot chốt đơn -> đơn nháp [ĐỎ] chờ duyệt (mặc định bật).
      chat: z.object({ vision: z.boolean(), closeOrders: z.boolean() }).partial().optional(),
      // autoImage: tự tạo ảnh đi kèm mỗi bài viết trước khi vào hộp Duyệt (mặc định bật).
      // imageEngine: công cụ tạo ảnh (auto = theo kết nối AI); imageFallback: lỗi thì AI viết bài thiết kế ảnh thay;
      // imageCodexAccountId: hồ sơ ChatGPT dùng để vẽ ảnh; flowImageModel: model Gemini trên Flow.
      content: z.object({
        autoImage: z.boolean(), imageEngine: z.enum(["auto", "claude", "chatgpt", "gemini_flow"]), imageFallback: z.boolean(),
        imageCodexAccountId: z.string().max(80).nullable(), flowImageModel: z.enum(FLOW_IMAGE_MODELS),
      }).partial().optional(),
    });
    const p = Patch.parse(body);
    if (p.content?.imageCodexAccountId) mustAiAccount(bizId, p.content.imageCodexAccountId);
    const cur = bizSettings(bizId);
    const next = { ...cur, ...p, caps: { ...cur.caps, ...(p.caps ?? {}) }, ...(p.chat ? { chat: { ...(cur.chat ?? {}), ...p.chat } } : {}), ...(p.content ? { content: { ...(cur.content ?? {}), ...p.content } } : {}) };
    update("biz", bizId, { settings: next });
    audit(bizId, actor, "settings.changed", { type: "biz", id: bizId }, { before: cur, after: next });
    return next;
  });
  // Công cụ tạo ảnh: lựa chọn, công cụ thực dùng (có dự phòng) và độ sẵn sàng của Claude / ChatGPT / Gemini trên Flow.
  r.get("/v1/image-engine", ({ bizId }) => ({ ...imageEngineStatus(bizId), flowModels: FLOW_IMAGE_MODELS, accounts: listAiAccounts(bizId, false).map((a) => ({ id: a.id, name: a.name, loggedIn: a.loggedIn, email: (a as { email?: string }).email ?? null })) }));
  r.post("/v1/kill-switch", ({ bizId, body, actor }) => {
    const p = z.object({ area: z.enum(["publish", "ads", "chat", "all"]), on: z.boolean() }).parse(body);
    const s = bizSettings(bizId);
    s.killSwitch[p.area] = p.on;
    update("biz", bizId, { settings: s });
    audit(bizId, actor, `kill_switch.${p.on ? "on" : "off"}`, { type: "biz", id: bizId }, p);
    emit(bizId, "alert.raised", { level: p.on ? "urgent" : "info", text: `Kill switch ${p.area} ${p.on ? "BẬT" : "tắt"}` });
    return s.killSwitch;
  });
  r.get("/v1/audit-log", ({ bizId, query }) => q.all("SELECT * FROM audit_log WHERE biz_id = ? ORDER BY at DESC LIMIT ?", bizId, Math.min(Number(query.limit ?? 100), 500)));
  r.get("/v1/usage", ({ bizId }) => ({
    byAgent: q.all("SELECT agent_key, provider, model, COUNT(*) calls, SUM(tokens_in) tokens_in, SUM(tokens_out) tokens_out, SUM(tokens_cached) cached, SUM(cost_micros) cost_micros FROM model_usage WHERE biz_id = ? AND at >= ? GROUP BY 1,2,3 ORDER BY cost_micros DESC", bizId, since(7)),
    daily: q.all("SELECT substr(at,1,10) day, SUM(tokens_in + tokens_out) tokens, SUM(cost_micros) cost_micros FROM model_usage WHERE biz_id = ? AND at >= ? GROUP BY 1 ORDER BY 1", bizId, since(7)),
    jev: q.get("SELECT COUNT(*) calls, SUM(tokens_in) tokens_in, SUM(cost_micros) cost_micros, AVG(latency_ms) latency FROM jev_judgment WHERE biz_id = ? AND created_at >= ?", bizId, since(7)),
    tasksDone: q.scalar("SELECT COUNT(*) FROM task WHERE biz_id = ? AND status = 'done'", bizId),
    avgTaskMinutes: q.scalar("SELECT AVG((julianday(ended_at) - julianday(started_at)) * 1440) FROM task_run WHERE biz_id = ? AND ended_at IS NOT NULL", bizId),
  }));

  // ---------------- Realtime (SSE) ----------------
  app.get("/v1/stream", (req, reply) => {
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    // Chỉ sự kiện của doanh nghiệp đang chọn (cookie taki_biz — EventSource không gửi header) + sự kiện chung (bizId null).
    const biz = currentBizId(req);
    const onEvent = (e: Row) => { if (!e.bizId || e.bizId === biz) reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); };
    bus.on("event", onEvent);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 20_000);
    req.raw.on("close", () => {
      bus.off("event", onEvent);
      clearInterval(ping);
    });
  });
}
