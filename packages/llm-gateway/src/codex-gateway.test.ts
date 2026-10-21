import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, q, update } from "@dotaka/db";

const fake = vi.hoisted(() => ({ calls: [] as any[], queue: [] as unknown[] }));
vi.mock("./codex.ts", async (original) => ({ ...(await original<Record<string, unknown>>()), codexInfo: () => ({ available: true, version: "test" }), runCodexCli: vi.fn(async (o) => {
  fake.calls.push(o); const next = fake.queue.shift(); if (next instanceof Error) throw next;
  return { structured: next, model: o.model, usage: { input: 10, output: 5, cached: 3 }, durationMs: 2, costMicros: 0 };
}) }));
const gateway = await import("./index.ts");
const root = mkdtempSync(join(tmpdir(), "taki-gateway-test-"));
let biz: string, account: string;
beforeAll(() => {
  vi.stubEnv("AI_ACCOUNTS_DIR", root); openDb(":memory:");
  biz = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "codex_cli" } } }).id;
  account = gateway.createAiAccount(biz, "ChatGPT riêng", "test").id;
  const claims = Buffer.from(JSON.stringify({ email: "test@example.test" })).toString("base64url");
  writeFileSync(join(gateway.aiAccountHome(biz, account), "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "a", refresh_token: "r", id_token: `x.${claims}.x` } }));
});
beforeEach(() => { fake.calls = []; fake.queue = []; q.run("DELETE FROM model_usage"); update("biz", biz, { settings: { ...DEFAULT_SETTINGS, llm: { provider: "codex_cli", codexAccountId: account } } }); });
afterAll(() => { closeDb(); rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const req = () => ({ bizId: biz, agentKey: "chat", tier: "small" as const, system: "DNA của Shop", user: "Chào", schema: z.object({ reply: z.string() }), sandbox: () => ({ reply: "SANDBOX" }) });
describe("ChatGPT routing through the shared gateway", () => {
  it("routes to the selected account, repairs invalid schema, and records actual usage", async () => {
    fake.queue = [{ reply: 123 }, { reply: "Chào bạn" }];
    const r = await gateway.generate(req());
    expect(r).toMatchObject({ output: { reply: "Chào bạn" }, source: "codex", provider: "codex_cli", usage: { input: 20, output: 10, cached: 6, costMicros: 0 } });
    expect(fake.calls[0].home).toBe(gateway.aiAccountHome(biz, account)); expect(fake.calls[0].system).toBe("DNA của Shop"); expect(fake.calls[1].prompt).toContain("sai schema");
    expect(q.all("SELECT provider, tokens_in FROM model_usage")).toHaveLength(2);
  });
  it("does not silently return sandbox output when no account is selected", async () => {
    update("biz", biz, { settings: { ...DEFAULT_SETTINGS, llm: { provider: "codex_cli" } } });
    expect(gateway.effectiveProvider(biz)).toMatchObject({ provider: "codex_cli", ready: false });
    await expect(gateway.generate(req())).rejects.toMatchObject({ code: "CODEX_NOT_READY" }); expect(fake.calls).toHaveLength(0);
  });
  it("enforces budget and does not switch accounts or providers after a CLI failure", async () => {
    fake.queue = [{ reply: "hello" }];
    await expect(gateway.generate({ ...req(), budget: { perRun: 12 } })).rejects.toMatchObject({ code: "TOKEN_BUDGET_EXCEEDED" });
    fake.queue = [new Error("account quota")];
    await expect(gateway.generate(req())).rejects.toThrow("account quota"); expect(fake.calls).toHaveLength(2);
  });
  it("ignores old Claude model overrides for ChatGPT and rejects incompatible forced models", async () => {
    insert("agent_config", { biz_id: biz, agent_key: "chat", autonomy: "L1", enabled: 1, tools: [], token_budget_run: 1000, token_budget_day: 1000, limits: { model: "claude-opus-5" } });
    expect(gateway.modelFor(biz, "chat", "small")).toBe("gpt-6-luna");
    await expect(gateway.generate({ ...req(), model: "claude-opus-5" })).rejects.toMatchObject({ code: "BAD_MODEL" });
    update("biz", biz, { settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } });
    expect((await gateway.generate(req())).output.reply).toBe("SANDBOX");
  });
});
