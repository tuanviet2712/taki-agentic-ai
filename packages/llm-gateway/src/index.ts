import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { bizSettings, insert, q } from "@dotaka/db";
import { AppError, logger } from "@dotaka/shared";
import { cliAvailable, runClaudeCli } from "./cli.ts";
import { codexInfo, runCodexCli, runCodexImage } from "./codex.ts";
import { cancelGrokLogin, disconnectGrok, grokAvailableModels, grokInfo, runGrokAgent, runGrokCli, startGrokLogin } from "./grok.ts";
import { geminiInfo, runGeminiAgent, runGeminiCli } from "./gemini.ts";
import { mustAiAccount, publicAiAccount, selectedAiAccount, withAiAccount } from "./ai-accounts.ts";

export { codexInfo, runCodexAgent, runCodexImage } from "./codex.ts";
export { cancelGrokLogin, disconnectGrok, grokAvailableModels, grokInfo, resolveGrokModel, runGrokAgent, runGrokCli, startGrokLogin } from "./grok.ts";
export { geminiInfo, runGeminiAgent, runGeminiCli } from "./gemini.ts";
export { aiAccountHome, cancelAiLogin, checkAiAccount, createAiAccount, disconnectAiAccount, listAiAccounts, mustAiAccount, removeAiAccount, selectedAiAccount, startAiLogin, withAiAccount } from "./ai-accounts.ts";

export { buildCliArgs, runInLane, cliAvailable, cliInfo, cliSystemPrompt, fastEnv, fastJsonInstruction, followClaudeRun, noteCliAuth, permissionPath, probeCliAuth, RESUME_PROMPT, runClaudeAgent, runClaudeInTerminal, safeJson, type AgentRunOptions, type AgentRunResult, type ApproverOptions, type TerminalRunOptions } from "./cli.ts";

/**
 * LLM Gateway (spec §16): the ONLY place that calls a language model.
 * Providers (Cài đặt → Chế độ AI, stored in biz settings):
 *  - claude_cli (default) — Claude Code CLI.
 *  - grok_cli — Official xAI Grok CLI (@xai-official/grok).
 *  - codex_cli — Codex CLI, with an explicitly selected business-owned ChatGPT login profile.
 *  - gemini_cli — Google Gemini CLI (@google/gemini-cli).
 *  - sandbox — deterministic drafts from the agent's own generator, offline.
 */
export type Tier = "small" | "medium" | "large";
export type Provider = "claude_cli" | "codex_cli" | "grok_cli" | "gemini_cli" | "sandbox";

/**
 * Models offered in the UI. Mọi model trong các danh sách dưới đây đã được GỌI THẬT qua đúng CLI + tài khoản của hệ thống
 * (21/10/2026) và trả lời đúng; model đời cũ / yếu đã gỡ và tự nâng cấp qua RETIRED_MODELS (cài đặt cũ không bị lỗi).
 */
export const MODEL_CATALOG = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: "Mạnh nhất — việc khó, chiến lược sâu; chậm & tốn hạn mức hơn" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Rất mạnh — chiến lược, nghiên cứu, phản biện" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Cân bằng — viết nội dung, kịch bản, điều phối" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Nhanh, rẻ — phân loại, chat khách, tóm tắt" },
] as const;

export const GROK_MODELS = [
  { id: "grok-4.7", label: "Grok 4.7", note: "Mạnh nhất của xAI — nghiên cứu thị trường, chiến lược, phản biện" },
  { id: "grok-4.6", label: "Grok 4.6", note: "Cân bằng — điều phối, bài viết, kịch bản" },
  { id: "grok-4.7-build-fast", label: "Grok 4.7 Build Fast", note: "Nhanh — phân loại, chat khách, tóm tắt" },
] as const;
export const DEFAULT_GROK_MODELS: Record<Tier, string> = { small: "grok-4.7-build-fast", medium: "grok-4.6", large: "grok-4.7" };

export const GEMINI_MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Nhanh, cân bằng — bài viết, kịch bản, điều phối" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "Mạnh — nghiên cứu sâu, chiến lược, SEO" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", note: "Siêu nhanh — chat khách, phân loại, tóm tắt" },
] as const;
export const DEFAULT_GEMINI_MODELS: Record<Tier, string> = { small: "gemini-2.5-flash-lite", medium: "gemini-2.5-flash", large: "gemini-2.5-pro" };

export const CODEX_MODELS = [
  { id: "gpt-6-astra", label: "GPT-6 Astra", note: "Mạnh nhất của OpenAI — việc khó, chiến lược, phản biện" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", note: "Mới nhất, đa năng — viết nội dung, điều phối, kịch bản" },
  { id: "gpt-6-sol", label: "GPT-6 Sol", note: "Đa năng (đời 6.0)" },
  { id: "gpt-6-luna", label: "GPT-6 Luna", note: "Nhanh, rẻ — chat khách, phân loại, tóm tắt" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "Cân bằng, đời 5.6 (OpenAI xếp vào thế hệ cũ)" },
  { id: "default", label: "Model mặc định của Codex", note: "Codex tự chọn theo tài khoản ChatGPT" },
];
export const DEFAULT_CODEX_MODELS: Record<Tier, string> = { small: "gpt-6-luna", medium: "gpt-6.1-sol", large: "gpt-6-astra" };

/**
 * Model đã gỡ khỏi danh sách (đời cũ / yếu / tài khoản không còn) → model mới tương ứng. Áp dụng khi đọc cài đặt và khi
 * gọi AI, nên cài đặt đã lưu (.env LLM_MODEL_*, Cài đặt → Chế độ AI, model riêng của từng agent) vẫn chạy, bằng model mới.
 */
export const RETIRED_MODELS: Record<string, string> = {
  "claude-haiku-4-5": "claude-haiku-5-5",
  "claude-sonnet-5": "claude-sonnet-5-5",
  "claude-opus-5": "claude-opus-5-5",
  "gpt-5": "gpt-6.1-sol",
  "gpt-5-mini": "gpt-6-luna",
  "o3": "gpt-6-astra",
  "grok-4.5": "grok-4.6",
  "grok-4.3": "grok-4.7-build-fast",
  "grok-build-0.1": "grok-4.7-build-fast",
};
export const currentModel = (model: string): string => RETIRED_MODELS[model] ?? model;

/**
 * Model Grok hiển thị để chọn: chỉ những model tài khoản Grok đang đăng nhập thật sự dùng được (đọc từ bộ nhớ đệm
 * `grok models`), thêm model mới của tài khoản chưa có trong danh sách tĩnh. Chưa đăng nhập / chưa có bộ đệm → danh sách tĩnh.
 */
export function grokModelCatalog(): { id: string; label: string; note: string }[] {
  const avail = grokAvailableModels();
  if (!avail) return [...GROK_MODELS];
  const ids = new Set(avail.map((m) => m.id));
  const known = new Set<string>(GROK_MODELS.map((m) => m.id));
  return [
    ...GROK_MODELS.filter((m) => ids.has(m.id)),
    // model mới của tài khoản chưa có trong danh sách tĩnh (model đã gỡ vì yếu / đời cũ thì không thêm lại)
    ...avail.filter((m) => !known.has(m.id) && !RETIRED_MODELS[m.id]).map((m) => ({ id: m.id, label: m.name, note: m.description ?? "Model Grok của tài khoản" })),
  ];
}

export const ALL_PROVIDER_CATALOGS: Record<Exclude<Provider, "sandbox">, readonly { id: string; label: string; note: string }[]> = {
  // getter: đọc lại mỗi lần (đăng nhập tài khoản Grok khác → danh sách model đổi theo)
  get grok_cli() {
    return grokModelCatalog();
  },
  claude_cli: MODEL_CATALOG,
  codex_cli: CODEX_MODELS,
  gemini_cli: GEMINI_MODELS,
};

/** Automatically detect which CLI provider a model ID belongs to. */
export function inferProviderFromModel(model: string): Exclude<Provider, "sandbox"> | null {
  const m = model.trim();
  if (!m) return null;
  if (/^grok-[a-z0-9._-]+$/i.test(m)) return "grok_cli";
  if (/^(?:claude-[a-z0-9._-]+|haiku|sonnet|opus)$/i.test(m)) return "claude_cli";
  if (/^gemini-[a-z0-9._-]+$/i.test(m)) return "gemini_cli";
  if (m === "default" || /^(?:gpt-|o1|o3|o4|codex)[a-z0-9._-]*$/i.test(m)) return "codex_cli";
  return null;
}

export function defaultModelsForProvider(provider: Provider): Record<Tier, string> {
  if (provider === "grok_cli") return { ...DEFAULT_GROK_MODELS };
  if (provider === "gemini_cli") return { ...DEFAULT_GEMINI_MODELS };
  if (provider === "codex_cli") return { ...DEFAULT_CODEX_MODELS };
  return { ...DEFAULT_LLM.models };
}

export function modelCatalog(bizId: string) {
  const p = llmSettings(bizId).provider;
  if (p === "grok_cli") {
    const custom = new Set([...Object.values(llmSettings(bizId).models), ...q.all<{ limits: { model?: string } }>("SELECT limits FROM agent_config WHERE biz_id = ?", bizId).map((c) => c.limits?.model).filter((m): m is string => !!m && modelMatchesProvider(m, "grok_cli"))]);
    const base = grokModelCatalog();
    const baseIds = new Set(base.map((m) => m.id));
    return [...base, ...[...custom].filter((m) => !baseIds.has(m as any)).map((id) => ({ id, label: id, note: "Model Grok tùy chỉnh" }))];
  }
  if (p === "gemini_cli") {
    const custom = new Set([...Object.values(llmSettings(bizId).models), ...q.all<{ limits: { model?: string } }>("SELECT limits FROM agent_config WHERE biz_id = ?", bizId).map((c) => c.limits?.model).filter((m): m is string => !!m && modelMatchesProvider(m, "gemini_cli"))]);
    const baseIds = new Set(GEMINI_MODELS.map((m) => m.id));
    return [...GEMINI_MODELS, ...[...custom].filter((m) => !baseIds.has(m as any)).map((id) => ({ id, label: id, note: "Model Gemini tùy chỉnh" }))];
  }
  if (p !== "codex_cli") return [...MODEL_CATALOG];
  const models = new Set([...Object.values(llmSettings(bizId).models), ...q.all<{ limits: { model?: string } }>("SELECT limits FROM agent_config WHERE biz_id = ?", bizId).map((c) => c.limits?.model).filter((m): m is string => !!m && modelMatchesProvider(m, "codex_cli"))]);
  const baseIds = new Set(CODEX_MODELS.map((m) => m.id));
  return [...CODEX_MODELS, ...[...models].filter((m) => !baseIds.has(m)).map((id) => ({ id, label: id, note: "Model do người dùng chọn; kiểm tra quyền với tài khoản đang dùng" }))];
}

export function modelMatchesProvider(model: string, provider: Provider) {
  if (provider === "grok_cli") return /^grok-[a-z0-9._-]+$/i.test(model);
  if (provider === "gemini_cli") return /^gemini-[a-z0-9._-]+$/i.test(model);
  if (provider === "codex_cli") return model === "default" || /^(?:gpt-|o1|o3|o4|codex)[a-z0-9._-]*$/i.test(model);
  return /^(?:claude-[a-z0-9._-]+|haiku|sonnet|opus)$/i.test(model);
}

export const DEFAULT_LLM = {
  provider: (process.env.LLM_PROVIDER === "sandbox" ? "sandbox" : "claude_cli") as Provider,
  models: {
    small: currentModel(process.env.LLM_MODEL_SMALL ?? "claude-haiku-5-5"),
    medium: currentModel(process.env.LLM_MODEL_MEDIUM ?? "claude-sonnet-5-5"),
    large: currentModel(process.env.LLM_MODEL_LARGE ?? "claude-opus-5-5"),
  } as Record<Tier, string>,
  effort: "medium" as "low" | "medium" | "high",
  codexAccountId: null as string | null,
  providerModels: {} as Partial<Record<Provider, Record<Tier, string>>>,
};
export type LlmSettings = typeof DEFAULT_LLM;

export function llmSettings(bizId?: string): LlmSettings {
  const s = bizId ? ((bizSettings(bizId) as any).llm as Partial<LlmSettings> | undefined) : undefined;
  const merged = { ...DEFAULT_LLM, ...(s ?? {}), models: { ...DEFAULT_LLM.models, ...(s?.models ?? {}) } };
  merged.models = Object.fromEntries(Object.entries(merged.models).map(([t, m]) => [t, currentModel(String(m))])) as Record<Tier, string>;
  if (merged.providerModels) {
    merged.providerModels = Object.fromEntries(Object.entries(merged.providerModels).map(([p, tiers]) => [p, Object.fromEntries(Object.entries(tiers ?? {}).map(([t, m]) => [t, currentModel(String(m))]))])) as LlmSettings["providerModels"];
  }
  if (!["sandbox", "claude_cli", "codex_cli", "grok_cli", "gemini_cli"].includes(merged.provider)) merged.provider = "claude_cli";
  if (merged.provider !== "claude_cli" && merged.provider !== "sandbox") {
    const fallback = defaultModelsForProvider(merged.provider);
    merged.models = Object.fromEntries((["small", "medium", "large"] as Tier[]).map((t) => [t, modelMatchesProvider(merged.models[t], merged.provider) ? merged.models[t] : fallback[t]])) as Record<Tier, string>;
  }
  return merged;
}

/** Check readiness of any specific provider without mutating global biz settings. */
export function providerReadiness(bizId: string | undefined, provider: Provider): { ready: boolean; reason?: string } {
  if (provider === "sandbox") return { ready: true };
  if (provider === "claude_cli") {
    const ok = cliAvailable();
    return { ready: ok, ...(ok ? {} : { reason: "Không tìm thấy lệnh `claude` (Claude Code CLI) hoặc chưa đăng nhập" }) };
  }
  if (provider === "codex_cli") {
    if (!bizId) return { ready: false, reason: "Chưa cài Codex CLI" };
    const r = codexReadiness(bizId);
    return { ready: r.ready, ...(r.reason ? { reason: r.reason } : {}) };
  }
  if (provider === "grok_cli") {
    const g = grokInfo();
    const reason = !g.available ? "Chưa cài Grok CLI (@xai-official/grok)" : !g.loggedIn ? "Grok CLI chưa đăng nhập (Bấm Đăng nhập Grok hoặc dán XAI_API_KEY)" : undefined;
    return { ready: !reason, ...(reason ? { reason } : {}) };
  }
  if (provider === "gemini_cli") {
    const gm = geminiInfo();
    const reason = !gm.available ? "Chưa cài Gemini CLI (@google/gemini-cli)" : !gm.loggedIn ? (gm.authError ?? "Gemini CLI chưa đăng nhập hoặc chưa có GEMINI_API_KEY") : undefined;
    return { ready: !reason, ...(reason ? { reason } : {}) };
  }
  return { ready: false, reason: "Provider không hợp lệ" };
}

/** The provider actually used: falls back to sandbox when the chosen one is unavailable. */
export function effectiveProvider(bizId?: string): { provider: Provider; ready?: boolean; reason?: string } {
  const want = llmSettings(bizId).provider;
  if (want === "claude_cli") return cliAvailable() ? { provider: "claude_cli" } : { provider: "sandbox", reason: "Không tìm thấy lệnh `claude` (Claude Code CLI) hoặc chưa đăng nhập" };
  if (want === "codex_cli" || want === "grok_cli" || want === "gemini_cli") {
    const r = providerReadiness(bizId, want);
    return { provider: want, ready: r.ready, ...(r.reason ? { reason: r.reason } : {}) };
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

/** Raw model override configured on a specific agent (may belong to any CLI provider). */
export function agentConfiguredModel(bizId: string, agentKey: string): string | null {
  const cfg = q.get<{ limits: Record<string, unknown> }>("SELECT limits FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, agentKey);
  const override = cfg?.limits?.model;
  return typeof override === "string" && override.trim() ? currentModel(override.trim()) : null;
}

/** Model for an agent: per-agent override (agent_config.limits.model) > tier default. */
export function modelFor(bizId: string, agentKey: string, tier: Tier, providerOverride?: Provider): string {
  const override = agentConfiguredModel(bizId, agentKey);
  const p = providerOverride ?? llmSettings(bizId).provider;
  if (override && modelMatchesProvider(override, p)) return override;
  return providerOverride ? defaultModelsForProvider(providerOverride)[tier] : llmSettings(bizId).models[tier];
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
  /** Explicitly route this request through a specific CLI provider (used by Multi-Agent Council / cross-CLI agents). */
  providerOverride?: Provider;
  /** Allow auto-resolving the CLI provider from `model` or `agent_config.limits.model` across providers. */
  allowCrossProvider?: boolean;
  /** Skill playbook (DNA + persona + skills) appended after the stable prefix. */
  systemSuffix?: string;
  images?: GenerateImage[];
  fast?: boolean;
  /** Mức suy luận riêng cho lượt gọi này (thấp = nhanh hơn rõ rệt); trống = theo Cài đặt → Chế độ AI. */
  effort?: "low" | "medium" | "high";
}
export type GenerateImage = { path: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };
export interface GenerateResult<T> {
  output: T;
  model: string;
  source: "claude" | "codex" | "grok" | "gemini" | "sandbox";
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

  let provider: Provider;
  let ready: boolean | undefined;
  let reason: string | undefined;

  const candidateModel = req.model ?? (req.allowCrossProvider ? agentConfiguredModel(req.bizId, req.agentKey) ?? undefined : undefined);
  const inferred = req.allowCrossProvider && candidateModel ? inferProviderFromModel(candidateModel) : null;
  // When inferred from agent_config (not explicit providerOverride), only switch provider if that CLI is ready (or if req.model was explicitly passed).
  const inferredReady = inferred ? providerReadiness(req.bizId, inferred).ready : false;
  const targetProvider = req.providerOverride ?? (inferred && (req.model || inferredReady) ? inferred : null);
  if (targetProvider) {
    provider = targetProvider;
    if (provider !== "sandbox") {
      const r = providerReadiness(req.bizId, provider);
      ready = r.ready;
      reason = r.reason;
      if (provider === "claude_cli" && !ready) provider = "sandbox";
    }
  } else {
    const eff = effectiveProvider(req.bizId);
    provider = eff.provider;
    ready = eff.ready;
    reason = eff.reason;
  }

  if (provider === "codex_cli" && ready === false) throw new AppError("CODEX_NOT_READY", reason ?? "ChatGPT chưa sẵn sàng", 400);
  if (provider === "grok_cli" && ready === false) throw new AppError("GROK_NOT_READY", reason ?? "Grok CLI chưa sẵn sàng", 400);
  if (provider === "gemini_cli" && ready === false) throw new AppError("GEMINI_NOT_READY", reason ?? "Gemini CLI chưa sẵn sàng", 400);
  if (provider === "sandbox") {
    const output = req.schema.parse(req.sandbox());
    record(req, "sandbox", "sandbox", { input: 0, output: 0, cached: 0 }, 0, 0);
    return { output, model: "sandbox", source: "sandbox", provider, usage: { input: 0, output: 0, cached: 0, costMicros: 0 } };
  }

  let model = currentModel(req.model && modelMatchesProvider(req.model, provider) ? req.model : req.model && !targetProvider ? req.model : modelFor(req.bizId, req.agentKey, req.tier, targetProvider ?? undefined));
  if (!modelMatchesProvider(model, provider)) throw new AppError("BAD_MODEL", "Model không thuộc kết nối AI đang chọn", 400);
  if (provider === "codex_cli") return viaCodex(req, model);
  if (provider === "grok_cli") return viaGrok(req, model);
  if (provider === "gemini_cli") return viaGemini(req, model);
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
      const next = (targetProvider ? defaultModelsForProvider(provider) : llmSettings(req.bizId).models)[tier];
      if (next === model) break;
      logger.warn("llm.fallback", { agent: req.agentKey, from: model, to: next, error: String(e).slice(0, 300) });
      model = next;
    }
  }
  throw lastErr;
}

async function viaGrok<T>(req: GenerateRequest<T>, model: string): Promise<GenerateResult<T>> {
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(req.schema as z.ZodType, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  const totals = { input: 0, output: 0, cached: 0, costMicros: 0 };
  let prompt = req.user;
  for (let round = 0; round < 3; round++) {
    if (req.budget?.perDay && tokensUsedToday(req.bizId, req.agentKey) >= req.budget.perDay) throw new BudgetExceeded("Agent đã đạt trần token/ngày");
    const r = await runGrokCli({ prompt, system: req.system, model, jsonSchema, effort: req.effort ?? llmSettings(req.bizId).effort });
    totals.input += r.usage.input; totals.output += r.usage.output; totals.cached += r.usage.cached; totals.costMicros += r.costMicros;
    record(req, "grok_cli", r.model, r.usage, r.durationMs, r.costMicros);
    if (req.budget?.perRun && totals.input + totals.output > req.budget.perRun) throw new BudgetExceeded(`Task vượt trần ${req.budget.perRun} token/lần chạy.`);
    const parsed = req.schema.safeParse(r.structured);
    if (parsed.success) return { output: parsed.data, model: r.model, source: "grok", provider: "grok_cli", usage: totals };
    prompt = `${req.user}\n\nĐầu ra trước sai schema: ${parsed.error.message.slice(0, 1200)}. Trả lại JSON đúng schema.`;
  }
  throw new AppError("SCHEMA_REPAIR_FAILED", "Đầu ra Grok CLI sai schema sau 2 vòng sửa", 502);
}

async function viaGemini<T>(req: GenerateRequest<T>, model: string): Promise<GenerateResult<T>> {
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(req.schema as z.ZodType, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  const totals = { input: 0, output: 0, cached: 0, costMicros: 0 };
  let prompt = req.user;
  for (let round = 0; round < 3; round++) {
    if (req.budget?.perDay && tokensUsedToday(req.bizId, req.agentKey) >= req.budget.perDay) throw new BudgetExceeded("Agent đã đạt trần token/ngày");
    const r = await runGeminiCli({ prompt, system: req.system, model, jsonSchema });
    totals.input += r.usage.input; totals.output += r.usage.output; totals.cached += r.usage.cached;
    record(req, "gemini_cli", r.model, r.usage, r.durationMs, 0);
    if (req.budget?.perRun && totals.input + totals.output > req.budget.perRun) throw new BudgetExceeded(`Task vượt trần ${req.budget.perRun} token/lần chạy.`);
    const parsed = req.schema.safeParse(r.structured);
    if (parsed.success) return { output: parsed.data, model: r.model, source: "gemini", provider: "gemini_cli", usage: totals };
    prompt = `${req.user}\n\nĐầu ra trước sai schema: ${parsed.error.message.slice(0, 1200)}. Trả lại JSON đúng schema.`;
  }
  throw new AppError("SCHEMA_REPAIR_FAILED", "Đầu ra Gemini CLI sai schema sau 2 vòng sửa", 502);
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
      const r = await runCodexCli({ home, signal, prompt, system: req.system, model, jsonSchema, effort: req.effort ?? llmSettings(req.bizId).effort, images: req.images?.map((i) => i.path) });
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
    const r = await runClaudeCli({ prompt, system: req.system, model, jsonSchema, effort: req.effort ?? llmSettings(req.bizId).effort, ...(imageDir ? { imageDir } : {}), ...(fast ? { fast } : {}), ...(req.agentKey === "chat" || req.agentKey === "chat_vision" ? { priority: true } : {}) });
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
