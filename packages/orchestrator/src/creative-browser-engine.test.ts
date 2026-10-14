import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { AppError } from "@dotaka/shared";
import type { TerminalRunOptions } from "@dotaka/llm-gateway";

const fake = vi.hoisted(() => ({
  run: vi.fn(), preflight: vi.fn(), ensure: vi.fn(), accounts: vi.fn(), source: vi.fn(), sync: vi.fn(), config: vi.fn(), openLogin: vi.fn(), bins: vi.fn(),
  subprocess: vi.fn(() => { throw new Error("Unexpected external process in isolated video engine test"); }),
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<Record<string, unknown>>()), spawn: fake.subprocess, spawnSync: fake.subprocess, execFile: fake.subprocess, execFileSync: fake.subprocess,
}));
vi.mock("node:os", async (original) => ({ ...(await original<Record<string, unknown>>()), homedir: () => home }));
vi.mock("@dotaka/llm-gateway", async (original) => ({
  ...(await original<Record<string, unknown>>()), effectiveProvider: () => ({ provider: "claude_cli" }), modelFor: () => "test-video-model", runClaudeInTerminal: fake.run,
}));
vi.mock("./claude-chrome.ts", async (original) => ({ ...(await original<Record<string, unknown>>()), claudeChromePreflight: fake.preflight }));
vi.mock("./flow-browser.ts", async (original) => ({
  ...(await original<Record<string, unknown>>()), ensureFlowBrowser: fake.ensure, flowAccounts: fake.accounts, flowSource: fake.source,
  syncFlowProfile: fake.sync, flowMcpConfig: fake.config, openFlowLogin: fake.openLogin,
}));
vi.mock("./video-ai.ts", async (original) => ({ ...(await original<Record<string, unknown>>()), ensureVideoBins: fake.bins }));

// The browser APIs, CLI and local media processes are all mocked. Only this temporary directory and a memory DB are written.
const prefix = join(tmpdir(), "creative-browser-engine-");
const temp = mkdtempSync(prefix);
const home = join(temp, "home");
mkdirSync(home);
const { CreativeInput, DATA_DIR, FLOW_TOOLS, UPLOAD_DIR, runVideoJob } = await import("./creative.ts");
const { permissionPath } = await import("@dotaka/llm-gateway");
let bizId: string;
const deviceId = "selected-local-device-18";
const profileEmail = "selected@example.test";
const preflightResult = { deviceId, label: "Selected Chrome (Windows)", profile: { channel: "chrome", dir: "Profile 18", email: profileEmail }, browser: { deviceId } };
const blockedResult = { status: "blocked", finalPath: "", durationSec: 0, scenes: 0, redoneScenes: [], script: [], caption: "", notes: "Test agent stopped before media generation" };

beforeEach(() => {
  vi.clearAllMocks();
  openDb(":memory:");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network in isolated video engine test"); }));
  fake.preflight.mockResolvedValue(preflightResult);
  fake.ensure.mockResolvedValue({});
  fake.accounts.mockResolvedValue([profileEmail]);
  fake.source.mockReturnValue({ channel: "chrome", dir: "Profile 18" });
  fake.sync.mockResolvedValue({});
  fake.config.mockImplementation((raw: string) => ({ mcpServers: { flow: { command: "fake-playwright", args: ["--output-dir", raw] } } }));
  fake.openLogin.mockResolvedValue({});
  fake.bins.mockReturnValue(join(temp, "bin"));
  fake.run.mockResolvedValue(blockedResult);
  bizId = insert("biz", { name: "Video engine test shop", settings: { ...DEFAULT_SETTINGS,
    flow: { chromeChannel: "chrome", chromeProfileDir: "Profile 18", chromeProfileEmail: profileEmail, browserDeviceId: deviceId, timeoutMin: 65 } } }).id;
  const key = FLOW_TOOLS["review-do-an-vat"].skill;
  insert("skill", { biz_id: bizId, key, kind: "skill", name: "Isolated Flow skill", description: "Test skill", body: "Produce the approved video brief.", refs: [], source_path: "test", hash: "test", version: 1, size: 1, status: "active" });
});
afterEach(async () => {
  // Drain asynchronous outbox callbacks before closing the per-test database.
  await new Promise<void>((done) => setImmediate(done));
  closeDb();
  vi.unstubAllGlobals();
});
afterAll(() => {
  if (!temp.startsWith(prefix)) throw new Error("Unexpected cleanup path");
  rmSync(temp, { recursive: true, force: true });
});

function extension() {
  const settings = byId<Row>("biz", bizId)!.settings;
  update("biz", bizId, { settings: { ...settings, flow: { ...settings.flow, engine: "claude-in-chrome", chromeAutoApprove: true } } });
}
function job() {
  const workdir = mkdtempSync(join(temp, "job-"));
  const input = CreativeInput.parse({ tool: "review-do-an-vat", title: "Approved snack video", brief: "Approved product video brief", brand: "other", channels: ["facebook"] });
  const row = insert("creative_job", { biz_id: bizId, tool: input.tool, title: input.title, status: "queued", input, log: [], workdir });
  return { id: row.id as string, workdir };
}
const launched = () => fake.run.mock.calls[0][0] as TerminalRunOptions;

describe("Flow video engine integration", () => {
  it("uses the existing Playwright terminal runner when the engine setting is absent", async () => {
    const j = job();
    await runVideoJob(j.id);
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.ensure).toHaveBeenCalledWith({ channel: "chrome", dir: "Profile 18" });
    expect(fake.accounts).toHaveBeenCalledTimes(1);
    expect(fake.sync).not.toHaveBeenCalled();
    const o = launched();
    expect(o).toMatchObject({ cwd: join(DATA_DIR, "creative"), resultFile: join(j.workdir, "result.json"), model: "test-video-model", timeoutMs: 65 * 60_000,
      mcpConfig: { mcpServers: { flow: { command: "fake-playwright", args: ["--output-dir", join(j.workdir, "raw")] } } }, addDirs: [j.workdir, UPLOAD_DIR] });
    expect(o).not.toHaveProperty("chrome");
    expect(o).not.toHaveProperty("approver");
    expect(o.allowedTools).toEqual(expect.arrayContaining(["mcp__flow", "Read", "Write", "Glob", "Bash(taki-flow-save:*)", "Bash(taki-flow-wait:*)"]));
    expect(o.system).toContain("taki-flow-save");
    expect(o.system).toContain("taki-flow-wait");
    expect(o.signal).toBeInstanceOf(AbortSignal);
    expect(fake.subprocess).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("waits for extension preflight before launching any video-generation agent", async () => {
    extension();
    let resolvePreflight!: (value: typeof preflightResult) => void;
    fake.preflight.mockImplementationOnce(() => new Promise((resolve) => { resolvePreflight = resolve; }));
    const j = job();
    const pending = runVideoJob(j.id);
    expect(fake.preflight).toHaveBeenCalledWith(bizId);
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.bins).not.toHaveBeenCalled();
    expect(q.scalar<number>("SELECT COUNT(*) FROM model_usage")).toBe(0);
    expect(byId<Row>("creative_job", j.id)!.status).toBe("queued");
    resolvePreflight(preflightResult);
    await pending;
    expect(fake.run).toHaveBeenCalledTimes(1);
    expect(fake.preflight.mock.invocationCallOrder[0]).toBeLessThan(fake.run.mock.invocationCallOrder[0]);
    expect(fake.ensure).not.toHaveBeenCalled();
    expect(fake.sync).not.toHaveBeenCalled();
    expect(fake.accounts).not.toHaveBeenCalled();
  });

  it("launches extension video with the selected device, Flow-only hosts and scoped job files without granting Downloads access", async () => {
    extension();
    const j = job();
    await runVideoJob(j.id);
    const o = launched();
    const downloads = join(home, "Downloads");
    expect(o).toMatchObject({ chrome: true, cwd: join(DATA_DIR, "creative"), mcpConfig: { mcpServers: {} }, resultFile: join(j.workdir, "result.json"),
      approver: { deviceId, fileRoots: [j.workdir, UPLOAD_DIR], hosts: ["flow.google.com", "labs.google", "accounts.google.com"], js: true,
        logFile: join(j.workdir, "approver.jsonl"), killFile: join(DATA_DIR, "chrome-autoapprove.off") }, addDirs: [j.workdir, UPLOAD_DIR] });
    expect(o.allowedTools).toEqual(expect.arrayContaining(["mcp__claude-in-chrome", `Read(${permissionPath(j.workdir)}/**)`, `Read(${permissionPath(UPLOAD_DIR)}/**)`,
      `Write(${permissionPath(j.workdir)}/**)`, `Glob(${permissionPath(j.workdir)}/**)`, "Bash(cp:*)", "Bash(ls:*)", "Bash(stat:*)"]));
    expect(o.allowedTools).not.toContain(`Read(${permissionPath(downloads)}/**)`);
    expect(o.addDirs).not.toContain(downloads);
    expect(o.approver!.fileRoots).not.toContain(downloads);
    for (const broadOrFlowTool of ["Read", "Write", "Glob", "mcp__flow", "Bash(taki-flow-save:*)", "Bash(taki-flow-wait:*)", "Bash(curl:*)"]) expect(o.allowedTools).not.toContain(broadOrFlowTool);
    expect(o.system).toContain(deviceId);
    expect(o.system).toContain("Claude in Chrome");
    expect(o.system).toContain(downloads);
    expect(o.system).not.toContain("taki-flow-save");
    expect(o.system).not.toContain("taki-flow-wait");
    expect(o.system).not.toContain("9333");
    expect(o.system).toContain("TOOL_NOT_OWNED");
    expect(o.disallowedTools).toEqual(expect.arrayContaining(["TaskCreate", "TodoWrite"]));
    expect(fake.config).not.toHaveBeenCalled();
    expect(fake.subprocess).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(byId<Row>("creative_job", j.id)).toMatchObject({ status: "blocked", result: blockedResult });
  });

  it.each([
    ["BROWSER_OTHER_MACHINE", "Selected browser belongs to another machine"],
    ["CHROME_APPROVER_OFF", "Chrome automatic approval is disabled"],
    ["BROWSER_NOT_SELECTED", "Selected browser is not connected"],
  ])("preflight denial %s blocks the job with no fallback or CLI launch", async (code, message) => {
    extension();
    fake.preflight.mockRejectedValueOnce(new AppError(code, message, 409));
    const j = job();
    await runVideoJob(j.id);
    expect(byId<Row>("creative_job", j.id)).toMatchObject({ status: "blocked", ended_at: expect.any(String) });
    expect(byId<Row>("creative_job", j.id)!.error).toBeTruthy();
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.ensure).not.toHaveBeenCalled();
    expect(fake.sync).not.toHaveBeenCalled();
    expect(fake.bins).not.toHaveBeenCalled();
    expect(q.scalar<number>("SELECT COUNT(*) FROM model_usage")).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the Flow login recovery path and blocks before launching if Google login remains missing", async () => {
    fake.accounts.mockResolvedValue([]);
    const j = job();
    await runVideoJob(j.id);
    expect(fake.sync).toHaveBeenCalledWith("chrome", "Profile 18");
    expect(fake.ensure).toHaveBeenNthCalledWith(2, {});
    expect(fake.accounts).toHaveBeenCalledTimes(2);
    expect(fake.openLogin).toHaveBeenCalledWith({});
    expect(byId<Row>("creative_job", j.id)).toMatchObject({ status: "blocked", error: expect.stringContaining("chưa đăng nhập Google") });
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.preflight).not.toHaveBeenCalled();
  });
});
