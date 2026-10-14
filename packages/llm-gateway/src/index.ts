import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { bizSettings, insert, q } from "@dotaka/db";
import { AppError, logger } from "@dotaka/shared";
import { cliAvailable, runClaudeCli } from "./cli.ts";
import { codexInfo, runCodexCli, runCodexImage } from "./codex.ts";
import { mustAiAccount, publicAiAccount, selectedAiAccount, withAiAccount } from "./ai-accounts.ts";

export { codexInfo, runCodexAgent, runCodexImage } from "./codex.ts";
export { aiAccountHome, cancelAiLogin, checkAiAccount, createAiAccount, disconnectAiAccount, listAiAccounts, mustAiAccount, removeAiAccount, selectedAiAccount, startAiLogin, withAiAccount } from "./ai-accounts.ts";

export { buildCliArgs, runInLane, cliAvailable, cliInfo, cliSystemPrompt, fastEnv, fastJsonInstruction, followClaudeRun, noteCliAuth, permissionPath, probeCliAuth, RESUME_PROMPT, runClaudeAgent, runClaudeInTerminal, safeJson, type AgentRunOptions, type AgentRunResult, type ApproverOptions, type TerminalRunOptions } from "./cli.ts";

/**
 * LLM Gateway (spec §16): the ONLY place that calls a language model.
 * Text/vision agents use the selected Claude CLI or a named ChatGPT profile through Codex CLI.
 * No provider API keys are used. Only Jev (TypeSafe) uses its own API.
 * Providers (Cài đặt → Chế độ AI, stored in biz settings):
 *  - claude_cli (default) — Claude Code CLI.
 *  - codex_cli — Codex CLI, with an explicitly selected business-owned ChatGPT login profile.
 *  - sandbox — deterministic drafts from the agent's own generator, offline (also the fallback when `claude` is missing).
 * Model per tier (small/medium/large) is configurable, and any agent can override it.
 * Every call: token budget check before, schema-validated output with up to 2 repair rounds,
 * a model_usage row after.
 */
export type Tier = "small" | "medium" | "large";
export type Provider = "claude_cli" | "codex_cli" | "sandbox";

/** Models offered in the UI. `id` is what we pass to `claude --model`. */
export const MODEL_CATALOG = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Nhanh, rẻ — phân loại, chat, tóm tắt" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "Cân bằng — viết nội dung, kịch bản" },
  { id: "claude-opus-5", label: "Claude Opus 5", note: "Mạnh — chiến lược, nghiên cứu" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Opus mới nhất" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: "Mạnh nhất — việc khó, chậm & tốn hạn mức hơn" },
] as const;
export const CODEX_MODELS = [{ id: "default", label: "Model mặc định của Codex", note: "Theo phiên bản CLI và quyền tài khoản ChatGPT" }];
export const DEFAULT_CODEX_MODELS: Record<Tier, string> = { small: "default", medium: "default", large: "default" };
export function modelCatalog(bizId: string) {
  if (llmSettings(bizId).provider !== "codex_cli") return [...MODEL_CATALOG];
  const models = new Set([...Object.values(llmSettings(bizId).models), ...q.all<{ limits: { model?: string } }>("SELECT limits FROM agent_config WHERE biz_id = ?", bizId).map((c) => c.limits?.model).filter((m): m is string => !!m && modelMatchesProvider(m, "codex_cli"))]);
  return [...CODEX_MODELS, ...[...models].filter((m) => m !== "default").map((id) => ({ id, label: id, note: "Model do người dùng chọn; kiểm tra quyền với tài khoản đang dùng" }))];
}
export function modelMatchesProvider(model: string, provider: Provider) {
  return provider === "codex_cli" ? model === "default" || /^gpt-[a-z0-9._-]+$/i.test(model) : /^(?:claude-[a-z0-9._-]+|haiku|sonnet|opus)$/i.test(model);
}

export const DEFAULT_LLM = {
  provider: (process.env.LLM_PROVIDER === "sandbox" ? "sandbox" : "claude_cli") as Provider,
  models: {
    small: process.env.LLM_MODEL_SMALL ?? "claude-haiku-4-5",
    medium: process.env.LLM_MODEL_MEDIUM ?? "claude-sonnet-5",
    large: process.env.LLM_MODEL_LARGE ?? "claude-opus-5",
  } as Record<Tier, string>,
  effort: "medium" as "low" | "medium" | "high",
  codexAccountId: null as string | null,
  providerModels: {} as Partial<Record<Provider, Record<Tier, string>>>,
};
export type LlmSettings = typeof DEFAULT_LLM;

export function llmSettings(bizId?: string): LlmSettings {
  const s = bizId ? ((bizSettings(bizId) as any).llm as Partial<LlmSettings> | undefined) : undefined;
  const merged = { ...DEFAULT_LLM, ...(s ?? {}), models: { ...DEFAULT_LLM.models, ...(s?.models ?? {}) } };
  // Older settings may still say "anthropic_api" — that path no longer exists: everything runs on the CLI.
  if (!["sandbox", "claude_cli", "codex_cli"].includes(merged.provider)) merged.provider = "claude_cli";
  if (merged.provider === "codex_cli") {
    merged.models = Object.fromEntries((["small", "medium", "large"] as Tier[]).map((t) => [t, modelMatchesProvider(merged.models[t], "codex_cli") ? merged.models[t] : DEFAULT_CODEX_MODELS[t]])) as Record<Tier, string>;
  }
  return merged;
}

/** The provider actually used: falls back to sandbox when the chosen one is unavailable. */
export function effectiveProvider(bizId?: string): { provider: Provider; ready?: boolean; reason?: string } {
  const want = llmSettings(bizId).provider;
  if (want === "claude_cli") return cliAvailable() ? { provider: "claude_cli" } : { provider: "sandbox", reason: "Không tìm thấy lệnh `claude` (Claude Code CLI) hoặc chưa đăng nhập" };
  if (want === "codex_cli") {
    const reason = bizId ? codexReadiness(bizId).reason : "Chưa cài Codex CLI";
    return { provider: "codex_cli", ready: !reason, ...(reason ? { reason } : {}) };
  }
  return { provider: "sandbox" };
}

/**
 * Hồ sơ ChatGPT (Codex CLI) dùng được không — cho cả khi ChatGPT chỉ dùng để VẼ ẢNH còn đội AI viết bằng Claude.
 * accountId: hồ sơ riêng cho ảnh (Cài đặt → Tạo ảnh bằng); trống = hồ sơ đang chọn ở Kết nối AI.
 */
export function codexReadiness(bizId: string, accountId?: string | null): { ready: boolean; reason?: string; account: ReturnType<typeof selectedAiAccount> } {
  let account: ReturnType<typeof selectedAiAccount> = null;
  if (accountId) { try { account = publicAiAccount(mustAiAccount(bizId, accountId), false); } catch { account = null; } }
  else account = selectedAiAccount(bizId);
  const reason = !codexInfo().available ? "Chưa cài Codex CLI" : !account ? "Chọn hồ sơ tài khoản ChatGPT (Kết nối AI → Tài khoản ChatGPT)" : account.login?.state === "waiting" ? "Đang chờ đăng nhập ChatGPT" : !account.loggedIn ? "Hồ sơ ChatGPT chưa đăng nhập" : undefined;
  return { ready: !reason, ...(reason ? { reason } : {}), account };
}
/** Kept for callers that only need "is a real model on?" */
export function llmEnabled(bizId?: string): boolean {
  const e = effectiveProvider(bizId);
  return e.provider !== "sandbox" && e.ready !== false;
}

/** Model for an agent: per-agent override (agent_config.limits.model) > tier default. */
export function modelFor(bizId: string, agentKey: string, tier: Tier): string {
  const cfg = q.get<{ limits: Record<string, unknown> }>("SELECT limits FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, agentKey);
  const override = cfg?.limits?.model;
  return typeof override === "string" && override && modelMatchesProvider(override, llmSettings(bizId).provider) ? override : llmSettings(bizId).models[tier];
}

export interface GenerateRequest<T> {
  bizId: string;
  agentKey: string;
  tier: Tier;
  taskRunId?: string;
  /** Stable prefix: role, rules, brand DNA. Must not contain timestamps/ids (cacheable). */
  system: string;
  /** Per-task content: retrieved knowledge, lessons, input, reviewer findings. */
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  budget?: { perRun?: number | null; perDay?: number | null };
  sandbox: () => T;
  /** Force a specific model (connection test); normally resolved from agent/tier settings. */
  model?: string;
  /** Skill playbook (DNA + persona + skills) appended after the stable prefix. */
  systemSuffix?: string;
  /**
   * Ảnh cho model xem (bước "bot xem ảnh khách gửi"): tệp trên máy, đã kiểm là ảnh. CLI: chép vào thư mục tạm riêng,
   * chỉ cho công cụ Read trong thư mục đó. Sandbox: bỏ qua (dùng `sandbox()`).
   */
  images?: GenerateImage[];
  /**
   * Câu trả lời cần tức thì (bot chat): CLI chạy chế độ nhanh (JSON thuần trong văn bản, 1 vòng ~5 giây thay vì 9 đến 44 giây).
   * Sai schema thì tự chạy lại bằng chế độ schema chắc chắn. Không áp dụng khi có ảnh.
   */
  fast?: boolean;
}
export type GenerateImage = { path: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };
export interface GenerateResult<T> {
  output: T;
  model: string;
  source: "claude" | "codex" | "sandbox";
  provider: Provider;
  usage: { input: number; output: number; cached: number; costMicros: number };
}

export class BudgetExceeded extends AppError {
  constructor(msg: string) {
    super("TOKEN_BUDGET_EXCEEDED", msg, 429);
  }
}

export function tokensUsedToday(bizId: string, agentKey: string): number {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return q.scalar<number>("SELECT COALESCE(SUM(tokens_in + tokens_out), 0) FROM model_usage WHERE biz_id = ? AND agent_key = ? AND at >= ?", bizId, agentKey, since.toISOString()) ?? 0;
}

const FALLBACK: Record<Tier, Tier | null> = { large: "medium", medium: "small", small: null };

export async function generate<T>(input: GenerateRequest<T>): Promise<GenerateResult<T>> {
  const req = input.systemSuffix ? { ...input, system: `${input.system}\n\n${input.systemSuffix}` } : input;
  if (req.budget?.perDay) {
    const used = tokensUsedToday(req.bizId, req.agentKey);
    if (used >= req.budget.perDay) throw new BudgetExceeded(`Agent ${req.agentKey} đã dùng ${used} token hôm nay (trần ${req.budget.perDay}).`);
  }
  const { provider, ready, reason } = effectiveProvider(req.bizId);
  if (provider === "codex_cli" && ready === false) throw new AppError("CODEX_NOT_READY", reason ?? "ChatGPT chưa sẵn sàng", 400);
  if (provider === "sandbox") {
    const output = req.schema.parse(req.sandbox());
    record(req, "sandbox", "sandbox", { input: 0, output: 0, cached: 0 }, 0, 0);
    return { output, model: "sandbox", source: "sandbox", provider, usage: { input: 0, output: 0, cached: 0, costMicros: 0 } };
  }

  let model = req.model ?? modelFor(req.bizId, req.agentKey, req.tier);
  if (!modelMatchesProvider(model, provider)) throw new AppError("BAD_MODEL", "Model không thuộc kết nối AI đang chọn", 400);
  if (provider === "codex_cli") return viaCodex(req, model);
  let tier: Tier | null = req.tier;
  let lastErr: unknown;
  while (true) {
    try {
      return await viaCli(req, model);
    } catch (e) {
      lastErr = e;
      if (e instanceof BudgetExceeded) throw e;
      tier = tier ? FALLBACK[tier] : null;
      if (!tier) break;
      const next = llmSettings(req.bizId).models[tier];
      if (next === model) break;
      logger.warn("llm.fallback", { agent: req.agentKey, from: model, to: next, error: String(e).slice(0, 300) });
      model = next;
    }
  }
  throw lastErr;
}

async function viaCodex<T>(req: GenerateRequest<T>, model: string): Promise<GenerateResult<T>> {
  const account = selectedAiAccount(req.bizId);
  if (!account) throw new AppError("CODEX_ACCOUNT_REQUIRED", "Chọn hồ sơ ChatGPT trước khi gọi AI", 400);
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(req.schema as z.ZodType, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  return withAiAccount(req.bizId, account.id, async (home, signal) => {
    const totals = { input: 0, output: 0, cached: 0, costMicros: 0 };
    let prompt = req.user;
    for (let round = 0; round < 3; round++) {
      if (req.budget?.perDay && tokensUsedToday(req.bizId, req.agentKey) >= req.budget.perDay) throw new BudgetExceeded("Agent đã đạt trần token/ngày");
      const r = await runCodexCli({ home, signal, prompt, system: req.system, model, jsonSchema, effort: llmSettings(req.bizId).effort, images: req.images?.map((i) => i.path) });
      totals.input += r.usage.input; totals.output += r.usage.output; totals.cached += r.usage.cached;
      record(req, "codex_cli", r.model, r.usage, r.durationMs, 0);
      if (req.budget?.perRun && totals.input + totals.output > req.budget.perRun) throw new BudgetExceeded(`Task vượt trần ${req.budget.perRun} token/lần chạy.`);
      const parsed = req.schema.safeParse(r.structured);
      if (parsed.success) return { output: parsed.data, model: r.model, source: "codex", provider: "codex_cli", usage: totals };
      prompt = `${req.user}\n\nĐầu ra trước sai schema: ${parsed.error.message.slice(0, 1200)}. Trả lại JSON đúng schema.`;
    }
    throw new AppError("SCHEMA_REPAIR_FAILED", "Đầu ra ChatGPT sai schema sau 2 vòng sửa", 502);
  });
}

// ---------------- Provider: Claude Code CLI (subscription login) ----------------
async function viaCli<T>(req: GenerateRequest<T>, model: string): Promise<GenerateResult<T>> {
  // The CLI validates with draft-07 and rejects the 2020-12 `$schema` URI zod emits by default.
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(req.schema as z.ZodType, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  // Ảnh: chép vào 1 thư mục tạm RIÊNG cho lượt này (tên tệp trung tính, không lộ mã tin/doanh nghiệp) → Read chỉ thấy đúng các ảnh này.
  const imageDir = req.images?.length ? join(tmpdir(), "dotaka-vision", randomUUID()) : undefined;
  let imageNote = "";
  if (imageDir) {
    mkdirSync(imageDir, { recursive: true });
    const paths = req.images!.map((img, i) => {
      const dest = join(imageDir, `anh-${i + 1}${extname(img.path).toLowerCase() || ".jpg"}`);
      copyFileSync(img.path, dest);
      return dest;
    });
    imageNote = `\n\nẢNH CẦN XEM (dùng công cụ Read mở từng tệp, chỉ đọc, không làm gì khác):\n${paths.map((p) => `- ${p}`).join("\n")}`;
  }
  try {
    return await cliRounds(req, model, jsonSchema, imageDir, imageNote);
  } finally {
    if (imageDir) rmSync(imageDir, { recursive: true, force: true });
  }
}

async function cliRounds<T>(req: GenerateRequest<T>, model: string, jsonSchema: object, imageDir: string | undefined, imageNote: string): Promise<GenerateResult<T>> {
  let prompt = req.user + imageNote;
  const totals = { input: 0, output: 0, cached: 0, costMicros: 0 };
  for (let round = 0; round < 3; round++) {
    const started = Date.now();
    // Chỉ vòng đầu chạy nhanh; sai schema → các vòng sửa dùng chế độ schema (chắc chắn đúng định dạng).
    const fast = Boolean(req.fast) && !imageDir && round === 0;
    const r = await runClaudeCli({ prompt, system: req.system, model, jsonSchema, effort: llmSettings(req.bizId).effort, ...(imageDir ? { imageDir } : {}), ...(fast ? { fast } : {}), ...(req.agentKey === "chat" || req.agentKey === "chat_vision" ? { priority: true } : {}) });
    totals.input += r.usage.input; totals.output += r.usage.output; totals.cached += r.usage.cached; totals.costMicros += r.costMicros;
    record(req, "claude_cli", r.model, r.usage, Date.now() - started, r.costMicros);
    if (req.budget?.perRun && totals.input + totals.output > req.budget.perRun) throw new BudgetExceeded(`Task vượt trần ${req.budget.perRun} token/lần chạy.`);
    const check = req.schema.safeParse(r.structured);
    if (check.success) return { output: check.data, model: r.model, source: "claude", provider: "claude_cli", usage: totals };
    prompt = `${req.user}${imageNote}\n\nLẦN TRƯỚC ĐẦU RA SAI SCHEMA: ${check.error.message.slice(0, 1200)}\nHãy trả lại JSON đúng schema.`;
  }
  throw new AppError("SCHEMA_REPAIR_FAILED", "Đầu ra của Claude CLI sai schema sau 2 vòng sửa", 502);
}

function record(req: { bizId: string; agentKey: string; taskRunId?: string }, provider: string, model: string, t: { input: number; output: number; cached: number }, latencyMs: number, costMicros: number) {
  insert("model_usage", {
    biz_id: req.bizId, task_run_id: req.taskRunId ?? null, agent_key: req.agentKey, provider, model,
    tokens_in: t.input, tokens_out: t.output, tokens_cached: t.cached, cost_micros: costMicros, latency_ms: latencyMs, at: new Date().toISOString(),
  });
}

/**
 * Tạo ảnh bằng ChatGPT (công cụ tạo ảnh của Codex CLI) với 1 hồ sơ ChatGPT đã đăng nhập. Ảnh PNG được chép ra `outFile`.
 * Dùng được cả khi đội AI viết bằng Claude (ChatGPT chỉ vẽ ảnh): `accountId` = hồ sơ dành cho ảnh, trống = hồ sơ của Kết nối AI.
 * Kết nối Claude không có model tạo ảnh — nơi gọi tự thiết kế ảnh bằng `generate()` (xem orchestrator/post-image.ts).
 */
export async function generateImageFile(req: { bizId: string; agentKey: string; taskRunId?: string; system: string; prompt: string; outFile: string; tier?: Tier; accountId?: string | null }): Promise<{ path: string; model: string; provider: Provider }> {
  const { ready, reason, account } = codexReadiness(req.bizId, req.accountId);
  if (!ready || !account) throw new AppError("CODEX_NOT_READY", reason ?? "ChatGPT chưa sẵn sàng", 400);
  // Model: theo cài đặt khi đội AI đang chạy ChatGPT; đội AI chạy Claude thì để Codex tự chọn model theo tài khoản.
  const model = llmSettings(req.bizId).provider === "codex_cli" ? modelFor(req.bizId, req.agentKey, req.tier ?? "medium") : DEFAULT_CODEX_MODELS[req.tier ?? "medium"];
  return withAiAccount(req.bizId, account.id, async (home, signal) => {
    const r = await runCodexImage({ home, signal, prompt: req.prompt, system: req.system, model, effort: "low", outFile: req.outFile });
    record(req, "codex_cli", r.model, r.usage, r.durationMs, 0);
    return { path: r.path, model: r.model, provider: "codex_cli" as const };
  });
}

/** Short free-text helper (handoff summaries). Falls back to the given text on any failure. */
export async function summarize(bizId: string, agentKey: string, instruction: string, content: string, fallback: string): Promise<string> {
  const { provider } = effectiveProvider(bizId);
  if (provider === "sandbox") return fallback;
  try {
    const Out = z.object({ summary: z.string() });
    const r = await generate({ bizId, agentKey, tier: "small", system: instruction, user: content, schema: Out, sandbox: () => ({ summary: fallback }), fast: true });
    return r.output.summary.trim() || fallback;
  } catch (e) {
    logger.warn("llm.summarize_failed", { error: String(e).slice(0, 300) });
    return fallback;
  }
}

/** Connection test for the settings page. */
export async function testModel(bizId: string, model: string) {
  const { provider, reason } = effectiveProvider(bizId);
  if (provider === "sandbox" || effectiveProvider(bizId).ready === false) return { ok: false, provider, reason: reason ?? "Đang ở chế độ sandbox" };
  const started = Date.now();
  const r = await generate({
    bizId, agentKey: "system_test", tier: "small", system: "Bạn là trợ lý kiểm tra kết nối. Trả JSON theo schema.",
    user: "Chào đội Marketing bằng một câu ngắn tiếng Việt.", schema: z.object({ greeting: z.string() }), sandbox: () => ({ greeting: "" }), model,
  }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }) as const);
  if ("error" in r) return { ok: false, provider, model, reason: r.error };
  return { ok: true, provider, model: r.model, reply: r.output.greeting, latencyMs: Date.now() - started, requested: model };
}
