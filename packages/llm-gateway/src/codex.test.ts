import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ spawn: vi.fn(), mode: "success", calls: [] as any[] }));
vi.mock("node:child_process", async (original) => ({ ...(await original<Record<string, unknown>>()), spawn: fake.spawn }));
const { codexEnv, codexFailure, codexRunConfig, runCodexAgent } = await import("./codex.ts");
const home = mkdtempSync(join(tmpdir(), "taki-codex-test-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));
beforeEach(() => {
  fake.mode = "success"; fake.calls = []; fake.spawn.mockReset();
  fake.spawn.mockImplementation((bin: string, args: string[], opts: any) => {
    const child: any = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn();
    const profile = args[args.indexOf("--profile") + 1];
    fake.calls.push({ bin, args, opts, config: readFileSync(join(home, `${profile}.config.toml`), "utf8") });
    child.stdin = Object.assign(new EventEmitter(), { end: (input: string) => {
      fake.calls.at(-1).input = input;
      setImmediate(() => {
        if (fake.mode === "spawn-error") { child.emit("error", new Error("spawn EACCES")); child.emit("close", 1); return; }
        const lines = fake.mode === "success" ? [JSON.stringify({ type: "item.started", item: { type: "mcp_tool_call", server: "taki", tool: "doc" } }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"reply":"Chào Sếp"}' } }), JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 5, cached_input_tokens: 7 } })]
          : [JSON.stringify({ type: "error", message: fake.mode === "quota" ? "Weekly usage limit reached" : "Not logged in" })];
        const output = lines.join("\n"); child.stdout.emit("data", output.slice(0, 30)); child.stdout.emit("data", output.slice(30)); child.emit("close", fake.mode === "success" ? 0 : 1);
      });
    } });
    return child;
  });
});
describe("Codex invocation", () => {
  it("uses only the selected home and strips all inherited auth/provider state", () => {
    vi.stubEnv("OPENAI_API_KEY", "API-SECRET"); vi.stubEnv("CODEX_API_KEY", "OTHER-KEY"); vi.stubEnv("CODEX_HOME", "other-home"); vi.stubEnv("CODEX_ACCESS_TOKEN", "ACCESS-SECRET");
    const env = codexEnv(home);
    expect(env.CODEX_HOME).toBe(home); expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.CODEX_API_KEY).toBeUndefined(); expect(env.CODEX_ACCESS_TOKEN).toBeUndefined();
    expect(process.env.CODEX_HOME).toBe("other-home"); vi.unstubAllEnvs();
  });
  it("handles chunked JSONL, tool progress, token accounting, stdin prompt and isolated config", async () => {
    const steps: any[] = [];
    const r = await runCodexAgent({ home, system: "SYS\nDNA rất dài", prompt: "USER", model: "default", jsonSchema: { type: "object" }, onStep: (s) => steps.push(s), mcp: { taki: { command: "node", args: ["tool.mjs"], env: { TAKI_BIZ: "biz-2" } } } });
    expect(r.structured).toEqual({ reply: "Chào Sếp" }); expect(r.usage).toEqual({ input: 20, output: 5, cached: 7 }); expect(r.costMicros).toBe(0);
    expect(steps.map((s) => s.kind)).toEqual(["tool", "text"]);
    const c = fake.calls[0]; expect(c.input).toContain("USER"); expect(c.args).not.toContain("USER"); expect(c.args.join(" ")).not.toContain("DNA"); expect(c.args).not.toContain("--model");
    expect(c.args).toEqual(expect.arrayContaining(["--ephemeral", "--ignore-user-config", "--sandbox", "read-only"])); expect(c.opts.env.CODEX_HOME).toBe(home); expect(c.opts.cwd).not.toBe(home);
    expect(c.config).toContain('forced_login_method = "chatgpt"'); expect(c.config).toContain("shell_tool = false"); expect(c.config).toContain("plugins = false"); expect(c.config).toContain('[mcp_servers.taki]'); expect(c.config).toContain('"TAKI_BIZ" = "biz-2"');
    expect(() => readFileSync(join(home, `${c.args[c.args.indexOf("--profile") + 1]}.config.toml`))).toThrow();
  });
  it("requires a completed turn, classifies quota separately from login errors and redacts CLI output", async () => {
    fake.mode = "quota"; await expect(runCodexAgent({ home, system: "s", prompt: "p", model: "default" })).rejects.toMatchObject({ code: "CODEX_QUOTA", status: 429 });
    fake.mode = "auth"; await expect(runCodexAgent({ home, system: "s", prompt: "p", model: "default" })).rejects.toMatchObject({ code: "CODEX_AUTH", status: 401 });
    expect(codexFailure("private TOKEN-SECRET unrelated failure").message).not.toContain("TOKEN-SECRET");
  });
  it("rejects spawn failure or a pre-aborted request without hanging", async () => {
    fake.mode = "spawn-error"; await expect(runCodexAgent({ home, system: "s", prompt: "p", model: "default" })).rejects.toMatchObject({ code: "CODEX_MISSING" });
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runCodexAgent({ home, system: "s", prompt: "p", model: "default", signal: ctrl.signal })).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it("does not load tool servers when none were supplied", () => {
    expect(codexRunConfig({ home, prompt: "p", system: "s", model: "default" })).not.toContain("mcp_servers");
  });
});
