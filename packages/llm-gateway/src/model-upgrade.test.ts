import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb } from "@dotaka/db";
import { ALL_PROVIDER_CATALOGS, CODEX_MODELS, MODEL_CATALOG, RETIRED_MODELS, agentConfiguredModel, currentModel, llmSettings } from "./index.ts";

let biz: string;
beforeAll(() => {
  openDb(":memory:");
  biz = insert("biz", {
    name: "Upgrade",
    settings: {
      ...DEFAULT_SETTINGS,
      llm: { provider: "claude_cli", models: { small: "claude-haiku-4-5", medium: "claude-sonnet-5", large: "claude-opus-5" }, providerModels: { codex_cli: { small: "gpt-5-mini", medium: "gpt-5", large: "o3" } } },
    },
  }).id;
  insert("agent_config", { biz_id: biz, agent_key: "strategy", autonomy: "L1", enabled: 1, tools: [], token_budget_run: 1000, token_budget_day: 1000, limits: { model: "claude-opus-5" } });
});
afterAll(() => closeDb());

describe("Danh sách model mới + tự nâng cấp model đã gỡ", () => {
  it("lists only current-generation models (verified live) and none of the retired ones", () => {
    const listed = Object.values(ALL_PROVIDER_CATALOGS).flat().map((m) => m.id);
    for (const old of Object.keys(RETIRED_MODELS)) expect(listed).not.toContain(old);
    expect(MODEL_CATALOG.map((m) => m.id)).toEqual(["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(CODEX_MODELS.map((m) => m.id)).toEqual(["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-terra", "default"]);
  });

  it("upgrades saved settings and per-agent overrides that still name a retired model", () => {
    expect(llmSettings(biz).models).toEqual({ small: "claude-haiku-5-5", medium: "claude-sonnet-5-5", large: "claude-opus-5-5" });
    expect(llmSettings(biz).providerModels.codex_cli).toEqual({ small: "gpt-6-luna", medium: "gpt-6.1-sol", large: "gpt-6-astra" });
    expect(agentConfiguredModel(biz, "strategy")).toBe("claude-opus-5-5");
    expect(currentModel("grok-4.3")).toBe("grok-4.7-build-fast");
    expect(currentModel("claude-fable-5-1")).toBe("claude-fable-5-1");
  });
});
