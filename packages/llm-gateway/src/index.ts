import { z } from "zod";
import { bizSettings, insert, q } from "@dotaka/db";
import { AppError, logger } from "@dotaka/shared";
import { cliAvailable, runClaudeCli } from "./cli.ts";

export { cliAvailable, cliInfo, followClaudeRun, noteCliAuth, probeCliAuth, runClaudeAgent, runClaudeInTerminal, type AgentRunResult } from "./cli.ts";

/**
 * LLM Gateway (spec §16): the ONLY place that calls a language model.
 * Every AI agent runs through Claude Code CLI — the CEO's logged-in Claude account via `claude -p`. There is
 * deliberately NO Anthropic API path (no API key, no per-token billing). Only Jev (TypeSafe) uses its own API.
 * Providers (Cài đặt → Chế độ AI, stored in biz settings):
 *  - claude_cli (default) — Claude Code CLI.
 *  - sandbox — deterministic drafts from the agent's own generator, offline (also the fallback when `claude` is missing).
 * Model per tier (small/medium/large) is configurable, and any agent can override it.
 * Every call: token budget check before, schema-validated output with up to 2 repair rounds,
 * a model_usage row after.
 */
export type Tier = "small" | "medium" | "large";
export type Provider = "claude_cli" | "sandbox";

/** Models offered in the UI. `id` is what we pass to `claude --model`. */
export const MODEL_CATALOG = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Nhanh, rẻ — phân loại, chat, tóm tắt" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "Cân bằng — viết nội dung, kịch bản" },
  { id: "claude-opus-5", label: "Claude Opus 5", note: "Mạnh — chiến lược, nghiên cứu" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Opus mới nhất" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: "Mạnh nhất — việc khó, chậm & tốn hạn mức hơn" },
] as const;

export const DEFAULT_LLM = {
  provider: (process.env.LLM_PROVIDER === "sandbox" ? "sandbox" : "claude_cli") as Provider,
  models: {
    small: process.env.LLM_MODEL_SMALL ?? "claude-haiku-4-5",
    medium: process.env.LLM_MODEL_MEDIUM ?? "claude-sonnet-5",
    large: process.env.LLM_MODEL_LARGE ?? "claude-opus-5",
  } as Record<Tier, string>,
  effort: "medium" as "low" | "medium" | "high",
};
export type LlmSettings = typeof DEFAULT_LLM;

export function llmSettings(bizId?: string): LlmSettings {
  const s = bizId ? ((bizSettings(bizId) as any).llm as Partial<LlmSettings> | undefined) : undefined;
  const merged = { ...DEFAULT_LLM, ...(s ?? {}), models: { ...DEFAULT_LLM.models, ...(s?.models ?? {}) } };
  // Older settings may still say "anthropic_api" — that path no longer exists: everything runs on the CLI.
  if (merged.provider !== "sandbox") merged.provider = "claude_cli";
  return merged;
}

/** The provider actually used: falls back to sandbox when the chosen one is unavailable. */
export function effectiveProvider(bizId?: string): { provider: Provider; reason?: string } {
  const want = llmSettings(bizId).provider;
  if (want === "claude_cli") return cliAvailable() ? { provider: "claude_cli" } : { provider: "sandbox", reason: "Không tìm thấy lệnh `claude` (Claude Code CLI) hoặc chưa đăng nhập" };
  return { provider: "sandbox" };
}
/** Kept for callers that only need "is a real model on?" */
export function llmEnabled(bizId?: string): boolean {
  return effectiveProvider(bizId).provider !== "sandbox";
}

/** Model for an agent: per-agent override (agent_config.limits.model) > tier default. */
export function modelFor(bizId: string, agentKey: string, tier: Tier): string {
  const cfg = q.get<{ limits: Record<string, unknown> }>("SELECT limits FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, agentKey);
  const override = cfg?.limits?.model;
  return typeof override === "string" && override ? override : llmSettings(bizId).models[tier];
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
}
export interface GenerateResult<T> {
  output: T;
  model: string;
  source: "claude" | "sandbox";
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
  const { provider } = effectiveProvider(req.bizId);
  if (provider === "sandbox") {
    const output = req.schema.parse(req.sandbox());
    record(req, "sandbox", "sandbox", { input: 0, output: 0, cached: 0 }, 0, 0);
    return { output, model: "sandbox", source: "sandbox", provider, usage: { input: 0, output: 0, cached: 0, costMicros: 0 } };
  }

  let model = req.model ?? modelFor(req.bizId, req.agentKey, req.tier);
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

// ---------------- Provider: Claude Code CLI (subscription login) ----------------
async function viaCli<T>(req: GenerateRequest<T>, model: string): Promise<GenerateResult<T>> {
  // The CLI validates with draft-07 and rejects the 2020-12 `$schema` URI zod emits by default.
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(req.schema as z.ZodType, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  let prompt = req.user;
  const totals = { input: 0, output: 0, cached: 0, costMicros: 0 };
  for (let round = 0; round < 3; round++) {
    const started = Date.now();
    const r = await runClaudeCli({ prompt, system: req.system, model, jsonSchema, effort: llmSettings(req.bizId).effort });
    totals.input += r.usage.input; totals.output += r.usage.output; totals.cached += r.usage.cached; totals.costMicros += r.costMicros;
    record(req, "claude_cli", r.model, r.usage, Date.now() - started, r.costMicros);
    if (req.budget?.perRun && totals.input + totals.output > req.budget.perRun) throw new BudgetExceeded(`Task vượt trần ${req.budget.perRun} token/lần chạy.`);
    const check = req.schema.safeParse(r.structured);
    if (check.success) return { output: check.data, model: r.model, source: "claude", provider: "claude_cli", usage: totals };
    prompt = `${req.user}\n\nLẦN TRƯỚC ĐẦU RA SAI SCHEMA: ${check.error.message.slice(0, 1200)}\nHãy trả lại JSON đúng schema.`;
  }
  throw new AppError("SCHEMA_REPAIR_FAILED", "Đầu ra của Claude CLI sai schema sau 2 vòng sửa", 502);
}

function record(req: { bizId: string; agentKey: string; taskRunId?: string }, provider: string, model: string, t: { input: number; output: number; cached: number }, latencyMs: number, costMicros: number) {
  insert("model_usage", {
    biz_id: req.bizId, task_run_id: req.taskRunId ?? null, agent_key: req.agentKey, provider, model,
    tokens_in: t.input, tokens_out: t.output, tokens_cached: t.cached, cost_micros: costMicros, latency_ms: latencyMs, at: new Date().toISOString(),
  });
}

/** Short free-text helper (handoff summaries). Falls back to the given text on any failure. */
export async function summarize(bizId: string, agentKey: string, instruction: string, content: string, fallback: string): Promise<string> {
  const { provider } = effectiveProvider(bizId);
  if (provider === "sandbox") return fallback;
  try {
    const Out = z.object({ summary: z.string() });
    const r = await generate({ bizId, agentKey, tier: "small", system: instruction, user: content, schema: Out, sandbox: () => ({ summary: fallback }) });
    return r.output.summary.trim() || fallback;
  } catch (e) {
    logger.warn("llm.summarize_failed", { error: String(e).slice(0, 300) });
    return fallback;
  }
}

/** Connection test for the settings page. */
export async function testModel(bizId: string, model: string) {
  const { provider, reason } = effectiveProvider(bizId);
  if (provider === "sandbox") return { ok: false, provider, reason: reason ?? "Đang ở chế độ sandbox" };
  const started = Date.now();
  const r = await generate({
    bizId, agentKey: "system_test", tier: "small", system: "Bạn là trợ lý kiểm tra kết nối. Trả JSON theo schema.",
    user: "Chào đội Marketing bằng một câu ngắn tiếng Việt.", schema: z.object({ greeting: z.string() }), sandbox: () => ({ greeting: "" }), model,
  }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }) as const);
  if ("error" in r) return { ok: false, provider, model, reason: r.error };
  return { ok: true, provider, model: r.model, reply: r.output.greeting, latencyMs: Date.now() - started, requested: model };
}
