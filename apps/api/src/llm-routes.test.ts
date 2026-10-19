import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb } from "@dotaka/db";

vi.mock("../../../packages/llm-gateway/src/codex.ts", async (original) => ({ ...(await original<Record<string, unknown>>()), codexInfo: () => ({ available: true, version: "test" }) }));
vi.mock("../../../packages/llm-gateway/src/cli.ts", async (original) => ({ ...(await original<Record<string, unknown>>()), cliInfo: () => ({ available: true, loggedIn: true, version: "test" }), cliAvailable: () => true }));
const { coreRoutes } = await import("./routes/core.ts");
const { assistantRoutes } = await import("./routes/assistant.ts");
const { errorHandler } = await import("./http.ts");
let app: FastifyInstance, b1: string, b2: string, id: string;
const root = mkdtempSync(join(tmpdir(), "taki-llm-routes-test-"));
beforeAll(async () => {
  vi.stubEnv("AI_ACCOUNTS_DIR", root); openDb(":memory:");
  b1 = insert("biz", { name: "One", settings: { ...DEFAULT_SETTINGS, llm: { provider: "claude_cli" } } }).id;
  b2 = insert("biz", { name: "Two", settings: DEFAULT_SETTINGS }).id;
  app = Fastify({ logger: false }); app.setErrorHandler(errorHandler); coreRoutes(app); assistantRoutes(app); await app.ready();
});
afterAll(async () => { await app.close(); closeDb(); rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const call = (method: any, url: string, payload?: unknown, biz = b1) => app.inject({ method, url, headers: { "x-biz-id": biz }, ...(payload ? { payload } : {}) });
describe("AI connections API", () => {
  it("creates an explicitly named unconnected profile and keeps businesses separate", async () => {
    const r = await call("POST", "/v1/llm/accounts", { name: "Người dùng A" }); expect(r.statusCode).toBe(200); id = r.json().id;
    expect(r.json()).toMatchObject({ loggedIn: false, name: "Người dùng A" });
    expect((await call("GET", "/v1/llm/accounts", undefined, b2)).json()).toEqual([]);
    expect((await call("PUT", "/v1/llm", { provider: "codex_cli", codexAccountId: id }, b2)).statusCode).toBe(404);
    expect((await call("POST", `/v1/llm/accounts/${id}/login`, {}, b2)).statusCode).toBe(404);
  });
  it("changes provider/account without forcing one global account and restores provider-specific models", async () => {
    const before = (await call("GET", "/v1/llm")).json();
    const codex = (await call("PUT", "/v1/llm", { provider: "codex_cli", codexAccountId: id })).json();
    expect(codex.settings.models).toEqual({ small: "default", medium: "default", large: "default" }); expect(codex.effective).toMatchObject({ provider: "codex_cli", ready: false });
    expect((await call("PUT", "/v1/llm", { models: { medium: "gpt-example" } })).statusCode).toBe(200);
    const claude = (await call("PUT", "/v1/llm", { provider: "claude_cli" })).json(); expect(claude.settings.models).toEqual(before.settings.models);
    const again = (await call("PUT", "/v1/llm", { provider: "codex_cli" })).json(); expect(again.settings.models.medium).toBe("gpt-example");
    expect((await call("PUT", "/v1/llm", { models: { small: "claude-opus-5" } })).statusCode).toBe(400);
    const check = (await call("POST", "/v1/llm/test", { model: "default" })).json(); expect(check).toMatchObject({ ok: false, provider: "codex_cli" });
  });
  it("rejects remote login administration, validates labels and safely removes an unused profile", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/llm/accounts", remoteAddress: "192.168.1.10", payload: { name: "Remote" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/llm/accounts", headers: { "x-taki-actor": "assistant" } })).statusCode).toBe(403);
    expect((await call("POST", "/v1/llm/accounts", { name: "  " })).statusCode).toBe(400);
    expect((await call("DELETE", `/v1/llm/accounts/${id}`)).statusCode).toBe(200);
    const result = (await call("GET", "/v1/llm")).json(); expect(result.settings.codexAccountId).toBeNull(); expect(result.selectedAccount).toBeNull(); expect(result.effective.ready).toBe(false);
  });
  it("automatically activates Grok CLI, Gemini CLI, Codex CLI, or Claude CLI when switching models", async () => {
    const grokSwitched = (await call("PUT", "/v1/llm", { models: { medium: "grok-4.6" }, autoSwitch: true })).json();
    expect(grokSwitched.settings.provider).toBe("grok_cli");
    expect(grokSwitched.settings.models.medium).toBe("grok-4.6");
    expect(grokSwitched.allCatalogs.grok_cli.some((m: any) => m.id === "grok-4.6")).toBe(true);

    // Switching model in Assistant (Ngân Nguyệt) automatically switches & activates the matching CLI provider
    await call("PUT", "/v1/assistant/settings", { model: "gemini-2.5-pro" });
    const afterGemini = (await call("GET", "/v1/llm")).json();
    expect(afterGemini.settings.provider).toBe("gemini_cli");
    expect(afterGemini.settings.models.medium).toBe("gemini-2.5-pro");

    await call("PUT", "/v1/assistant/settings", { model: "grok-4.7" });
    const afterGrok = (await call("GET", "/v1/llm")).json();
    expect(afterGrok.settings.provider).toBe("grok_cli");
    expect(afterGrok.settings.models.medium).toBe("grok-4.7");

    await call("PUT", "/v1/assistant/settings", { model: "claude-sonnet-4-6" });
    const afterClaude = (await call("GET", "/v1/llm")).json();
    expect(afterClaude.settings.provider).toBe("claude_cli");
    expect(afterClaude.settings.models.medium).toBe("claude-sonnet-4-6");
  });
});
