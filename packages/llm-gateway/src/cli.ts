import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AppError } from "@dotaka/shared";

/**
 * Claude Code CLI provider: runs `claude -p` headless with the CEO's logged-in account
 * (Pro/Max/Team subscription). No API key involved — we even strip ANTHROPIC_API_KEY from the
 * child env so the CLI never silently switches to API billing.
 * Each call: no tools, no session persistence, no project/user settings, JSON-schema output.
 */
const BIN = process.env.CLAUDE_CLI_PATH ?? "claude";
const MAX_PARALLEL = Number(process.env.CLAUDE_CLI_CONCURRENCY ?? 2);
const TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS ?? 240_000);
const WORKDIR = join(tmpdir(), "dotaka-claude-cli");

let info: { available: boolean; version?: string; checkedAt: number } | null = null;
export function cliInfo() {
  if (!info || Date.now() - info.checkedAt > 60_000) {
    try {
      const v = execFileSync(BIN, ["--version"], { encoding: "utf8", timeout: 10_000, env: childEnv() }).trim();
      info = { available: true, version: v, checkedAt: Date.now() };
    } catch {
      info = { available: false, checkedAt: Date.now() };
    }
  }
  return { ...info, bin: BIN };
}
export const cliAvailable = () => cliInfo().available;

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force the subscription login, never API billing
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDECODE; // allow running even when the server itself was started from Claude Code
  return env;
}

// Simple semaphore: CLI calls are heavy processes; keep a few at a time.
let active = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

export interface CliResult {
  structured: unknown;
  model: string;
  usage: { input: number; output: number; cached: number };
  costMicros: number;
  durationMs: number;
}

export function runClaudeCli(opts: { prompt: string; system: string; model: string; jsonSchema: object; effort?: string }): Promise<CliResult> {
  return slot(() => new Promise<CliResult>((resolve, reject) => {
    mkdirSync(WORKDIR, { recursive: true });
    const args = [
      "-p", "--output-format", "json", "--model", opts.model,
      "--system-prompt", opts.system,
      "--json-schema", JSON.stringify(opts.jsonSchema),
      "--tools", "", "--no-session-persistence", "--setting-sources", "",
    ];
    if (opts.effort && !opts.model.includes("haiku")) args.push("--effort", opts.effort);
    const child = spawn(BIN, args, { cwd: WORKDIR, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new AppError("CLI_TIMEOUT", `Claude CLI quá ${Math.round(TIMEOUT_MS / 1000)} giây`, 504));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new AppError("CLI_NOT_FOUND", `Không chạy được Claude CLI: ${e.message}`, 503));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let j: any;
      try {
        j = JSON.parse(out.trim().split("\n").filter(Boolean).at(-1) ?? "{}");
      } catch {
        return reject(new AppError("CLI_BAD_OUTPUT", `Claude CLI trả về không phải JSON (code ${code}): ${(err || out).slice(0, 400)}`, 502));
      }
      if (j.is_error || j.subtype !== "success") {
        const msg = String(j.result ?? j.api_error_status ?? err ?? "lỗi không rõ").slice(0, 400);
        const code2 = /login|auth|credential|not logged/i.test(msg) ? "CLI_NOT_LOGGED_IN" : /limit|quota|usage/i.test(msg) ? "CLI_USAGE_LIMIT" : "CLI_ERROR";
        return reject(new AppError(code2, `Claude CLI: ${msg}`, 502));
      }
      const mu = Object.entries(j.modelUsage ?? {}) as [string, any][];
      const main = mu.sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0];
      const u = j.usage ?? {};
      resolve({
        structured: j.structured_output ?? safeJson(j.result),
        model: main?.[1]?.canonicalModel ?? main?.[0] ?? opts.model,
        usage: { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, cached: u.cache_read_input_tokens ?? 0 },
        costMicros: Math.round((j.total_cost_usd ?? 0) * 1e6),
        durationMs: j.duration_ms ?? 0,
      });
    });
    child.stdin.end(opts.prompt);
  }));
}

function safeJson(s: unknown) {
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
}

// ---------------- Long-running tool-using agent (browser automation) ----------------
export interface AgentRunOptions {
  prompt: string;
  system: string;
  model: string;
  jsonSchema: object;
  allowedTools: string[];
  addDirs: string[];
  cwd: string;
  chrome?: boolean;
  /** MCP servers for this run (e.g. Playwright attached to Chrome Flow); only these are loaded (--strict-mcp-config). */
  mcpConfig?: object;
  /** Extra environment for the agent process. */
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Called for each tool call / text step so the UI can show live progress. */
  onStep?: (step: { at: string; kind: "tool" | "text"; text: string }) => void;
  signal?: AbortSignal;
}
export interface AgentRunResult {
  structured: unknown;
  model: string;
  usage: { input: number; output: number; cached: number };
  costMicros: number;
  durationMs: number;
  turns: number;
  denials: unknown[];
}

function describeTool(name: string, input: any): string {
  const short = name.replace(/^mcp__claude-in-chrome__/, "chrome.").replace(/^mcp__flow__browser_/, "flow.");
  if (input?.element) return `${short} "${String(input.element).slice(0, 70)}"${input.text ? ` ← "${String(input.text).slice(0, 50)}"` : ""}`;
  if (input?.url) return `${short} ${input.url}`;
  if (input?.command) return `${short}: ${String(input.command).slice(0, 140)}`;
  if (input?.action) return `${short} ${input.action}${input.text ? ` "${String(input.text).slice(0, 60)}"` : ""}`;
  if (input?.query) return `${short} "${String(input.query).slice(0, 60)}"`;
  return short;
}

/** Runs `claude -p` with tools (and optionally Claude in Chrome) until it returns schema-shaped JSON. */
export function runClaudeAgent(o: AgentRunOptions): Promise<AgentRunResult> {
  return new Promise<AgentRunResult>((resolve, reject) => {
    const args = [
      "-p", "--output-format", "stream-json", "--verbose", "--model", o.model,
      "--append-system-prompt", o.system,
      "--json-schema", JSON.stringify(o.jsonSchema),
      "--permission-mode", "dontAsk",
      "--allowedTools", ...o.allowedTools,
      "--no-session-persistence", "--setting-sources", "",
      ...(o.chrome ? ["--chrome"] : ["--no-chrome"]),
      ...(o.mcpConfig ? ["--mcp-config", JSON.stringify(o.mcpConfig), "--strict-mcp-config"] : []),
      ...o.addDirs.flatMap((d) => ["--add-dir", d]),
    ];
    const child = spawn(BIN, args, { cwd: o.cwd, env: { ...childEnv(), ...(o.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let err = "";
    let final: any = null;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new AppError("AGENT_TIMEOUT", `Agent chạy quá ${Math.round((o.timeoutMs ?? 0) / 60000)} phút`, 504));
    }, o.timeoutMs ?? 75 * 60_000);
    o.signal?.addEventListener("abort", () => { child.kill("SIGTERM"); reject(new AppError("CANCELLED", "Đã hủy", 499)); });
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: any;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "assistant") {
          for (const c of ev.message?.content ?? []) {
            if (c.type === "tool_use") o.onStep?.({ at: new Date().toISOString(), kind: "tool", text: describeTool(c.name, c.input) });
            else if (c.type === "text" && c.text?.trim()) o.onStep?.({ at: new Date().toISOString(), kind: "text", text: c.text.trim().slice(0, 300) });
          }
        } else if (ev.type === "result") final = ev;
      }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new AppError("CLI_NOT_FOUND", `Không chạy được Claude CLI: ${e.message}`, 503)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!final) return reject(new AppError("CLI_BAD_OUTPUT", `Agent dừng không có kết quả (code ${code}): ${err.slice(-400)}`, 502));
      if (final.is_error || final.subtype !== "success") return reject(new AppError("AGENT_ERROR", `Agent lỗi: ${String(final.result ?? final.subtype).slice(0, 400)}`, 502));
      const mu = Object.entries(final.modelUsage ?? {}) as [string, any][];
      const main = mu.sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0];
      const u = final.usage ?? {};
      resolve({
        structured: final.structured_output ?? safeJson(final.result),
        model: main?.[1]?.canonicalModel ?? main?.[0] ?? o.model,
        usage: { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, cached: u.cache_read_input_tokens ?? 0 },
        costMicros: Math.round((final.total_cost_usd ?? 0) * 1e6),
        durationMs: final.duration_ms ?? 0,
        turns: final.num_turns ?? 0,
        denials: final.permission_denials ?? [],
      });
    });
    child.stdin.end(o.prompt);
  });
}

// ---------------- Unattended browser run (hidden pseudo-terminal, Claude Code "auto" permission mode) ----------------
export interface TerminalRunOptions {
  title: string;
  prompt: string;
  system: string;
  /** Must be a Sonnet/Opus model: auto mode is not available for Haiku. */
  model: string;
  /** Fixed, pre-trusted working directory (no "trust this folder?" question). */
  cwd: string;
  allowedTools: string[];
  addDirs: string[];
  /** The agent writes its final JSON here (absolute path); the run completes when this file parses. */
  resultFile: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onStep?: (step: { at: string; kind: "tool" | "text"; text: string }) => void;
  /** MCP servers for the run (e.g. Playwright attached to Chrome Flow). Given → plain headless `claude -p`
   *  (MCP tools are allowed by --allowedTools; no Claude in Chrome, no pseudo-terminal needed). */
  mcpConfig?: object;
  /** Extra environment for the agent process (e.g. PATH with this repo's video commands first). */
  env?: Record<string, string>;
}

/** Mark a folder as trusted for Claude Code (the CEO's own project data folder) so no dialog appears. */
async function ensureTrusted(dir: string) {
  const { readFileSync, writeFileSync, renameSync, existsSync } = await import("node:fs");
  const { homedir } = await import("node:os");
  const f = join(homedir(), ".claude.json");
  if (!existsSync(f)) return;
  const cfg = JSON.parse(readFileSync(f, "utf8"));
  if (cfg.projects?.[dir]?.hasTrustDialogAccepted) return;
  cfg.projects = cfg.projects ?? {};
  cfg.projects[dir] = { ...(cfg.projects[dir] ?? {}), hasTrustDialogAccepted: true };
  const tmp = `${f}.taki-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  renameSync(tmp, f);
}

/**
 * Claude Code refuses Claude in Chrome actions in `-p` runs, but an interactive session in "auto" permission
 * mode lets Claude's safety classifier approve safe actions itself (risky ones are blocked) — no human clicks.
 * We run that interactive session inside a hidden pseudo-terminal (`script -q /dev/null …`), follow its
 * transcript for live progress, and finish when the agent writes `resultFile`.
 */
export async function runClaudeInTerminal(o: TerminalRunOptions): Promise<unknown> {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new AppError("NOT_SUPPORTED", "Chạy trình duyệt tự động hỗ trợ macOS/Linux");
  const { writeFileSync, rmSync } = await import("node:fs");
  const { randomUUID } = await import("node:crypto");
  mkdirSync(o.cwd, { recursive: true });
  await ensureTrusted(o.cwd);
  const runDir = join(dirname(o.resultFile), ".taki-run");
  mkdirSync(runDir, { recursive: true });
  rmSync(o.resultFile, { force: true });
  const systemFile = join(runDir, "system.md");
  writeFileSync(systemFile, o.system);
  writeFileSync(join(runDir, "prompt.md"), o.prompt);
  let bin = BIN;
  try { bin = execFileSync("/bin/sh", ["-lc", `command -v '${BIN.replace(/'/g, "")}'`], { encoding: "utf8", env: childEnv() }).trim() || BIN; } catch { /* keep BIN */ }
  const sessionId = randomUUID();
  const env: NodeJS.ProcessEnv = { ...childEnv(), ...(o.env ?? {}), TERM: "xterm-256color", COLUMNS: "160", LINES: "50", CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: "1" };
  delete env.CLAUDE_CODE_CHILD_SESSION; delete env.CLAUDE_CODE_ENTRYPOINT; delete env.CLAUDE_CODE_SSE_PORT;
  let child: ChildProcess;
  /** Headless run, or (resume) the same session continued after the CLI died mid-run (e.g. a dropped API connection). */
  const spawnHeadless = (resume: boolean) => {
    const mcpFile = join(runDir, "mcp.json");
    writeFileSync(mcpFile, JSON.stringify(o.mcpConfig));
    const prompt = resume
      ? `Phiên trước bị ngắt giữa chừng (lỗi kết nối) và CHƯA có ${o.resultFile}. Kiểm tra lại trạng thái hiện tại (trình duyệt, tệp đã có) rồi làm TIẾP từ chỗ đang dở, không làm lại bước đã xong. Nếu không thể làm tiếp thì ghi ${o.resultFile} với status "failed"/"blocked" và lý do.`
      : o.prompt;
    // Prompt FIRST: --allowedTools / --add-dir are variadic and would swallow a trailing positional prompt.
    const args = [
      prompt, "-p", "--model", o.model, "--permission-mode", "dontAsk", ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]), "--no-chrome",
      "--mcp-config", mcpFile, "--strict-mcp-config", "--setting-sources", "", "--append-system-prompt-file", systemFile,
      "--allowedTools", ...o.allowedTools, ...o.addDirs.flatMap((d) => ["--add-dir", d]),
    ];
    // Detached: survives an API restart (the job is re-attached through resultFile).
    return spawn(bin, args, { cwd: o.cwd, env, stdio: ["ignore", "ignore", "ignore"], detached: true });
  };
  if (o.mcpConfig) {
    child = spawnHeadless(false);
  } else {
    // Prompt FIRST: --allowedTools / --add-dir are variadic and would swallow a trailing positional prompt.
    const claudeArgs = [
      o.prompt, "--chrome", "--model", o.model, "--permission-mode", "auto", "--session-id", sessionId, "--name", `TAKI · ${o.title}`,
      "--append-system-prompt-file", systemFile, "--allowedTools", ...o.allowedTools, ...o.addDirs.flatMap((d) => ["--add-dir", d]),
    ];
    // `script` gives the TUI a real terminal; its stdin must be a pipe (Node's stdio pipes are sockets), so feed it
    // from a never-ending `sleep` via process substitution. Whole process group is killed when we are done.
    const ptyCmd = process.platform === "darwin"
      ? 'exec script -q /dev/null "$@" < <(exec sleep 2147483647)'
      : 'exec script -qec "$(printf "%q " "$@")" /dev/null < <(exec sleep 2147483647)';
    child = spawn("/bin/bash", ["-c", ptyCmd, "bash", bin, ...claudeArgs], { cwd: o.cwd, env, stdio: ["ignore", "ignore", "ignore"], detached: true });
  }
  writeFileSync(join(runDir, "session.json"), JSON.stringify({ sessionId, pid: child.pid, startedAt: new Date().toISOString() }));
  const stop = () => { try { process.kill(-child.pid!, "SIGTERM"); } catch { /* gone */ } setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, 3000); };
  let exited = false;
  child.on("exit", () => { exited = true; });
  let resumes = 0;

  const readSteps = transcriptReader(sessionId, o.onStep);
  const startedAt = Date.now();

  o.onStep?.({ at: new Date().toISOString(), kind: "text", text: "Claude đang chạy ngầm — không cần thao tác" });
  try {
    while (true) {
      if (o.signal?.aborted) throw new AppError("CANCELLED", "Đã hủy", 499);
      if (Date.now() - startedAt > o.timeoutMs) throw new AppError("AGENT_TIMEOUT", `Quá ${Math.round(o.timeoutMs / 60000)} phút chưa có kết quả`, 504);
      try { readSteps(); } catch { /* transcript mid-write */ }
      if (existsSync(o.resultFile)) {
        try { return JSON.parse(readFileSync(o.resultFile, "utf8")); } catch { /* still being written */ }
      }
      if (exited) {
        // Headless run died without a result (most often a dropped API connection): continue the same session, at most twice.
        if (!o.mcpConfig || resumes >= 2 || Date.now() - startedAt > o.timeoutMs - 5 * 60_000) throw new AppError("AGENT_EXITED", "Phiên Claude kết thúc mà không ghi kết quả", 502);
        resumes++;
        o.onStep?.({ at: new Date().toISOString(), kind: "text", text: `Phiên Claude bị ngắt giữa chừng — tự nối lại phiên (lần ${resumes}/2)` });
        await new Promise((r) => setTimeout(r, 15_000));
        exited = false;
        child = spawnHeadless(true);
        child.on("exit", () => { exited = true; });
        writeFileSync(join(runDir, "session.json"), JSON.stringify({ sessionId, pid: child.pid, startedAt: new Date().toISOString(), resumes }));
        continue;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    stop();
  }
}

/** Incremental reader of a Claude session transcript → onStep events (tool calls + text). */
function transcriptReader(sessionId: string, onStep?: TerminalRunOptions["onStep"]) {
  const projects = join(homedir(), ".claude", "projects");
  let transcript: string | null = null;
  let offset = 0;
  return () => {
    if (!transcript) {
      try {
        for (const d of readdirSync(projects)) {
          const f = join(projects, d, `${sessionId}.jsonl`);
          if (existsSync(f)) { transcript = f; break; }
        }
      } catch { /* not created yet */ }
      if (!transcript) return;
    }
    const size = statSync(transcript).size;
    if (size <= offset) return;
    const chunk = readFileSync(transcript, "utf8").slice(offset);
    offset = size;
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      let ev: any;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type !== "assistant") continue;
      for (const c of ev.message?.content ?? []) {
        if (c.type === "tool_use") onStep?.({ at: ev.timestamp ?? new Date().toISOString(), kind: "tool", text: describeTool(c.name, c.input) });
        else if (c.type === "text" && c.text?.trim()) onStep?.({ at: ev.timestamp ?? new Date().toISOString(), kind: "text", text: c.text.trim().slice(0, 300) });
      }
    }
  };
}

/**
 * Re-attach to a detached run after an API restart: keep streaming its transcript and wait for resultFile.
 * `skipSteps` = steps already stored, so the log continues without duplicates.
 */
export async function followClaudeRun(o: { resultFile: string; deadline: number; onStep?: TerminalRunOptions["onStep"]; skipSteps?: number; isActive?: () => boolean }): Promise<unknown | null> {
  let session: { sessionId: string; pid?: number } | null = null;
  try { session = JSON.parse(readFileSync(join(dirname(o.resultFile), ".taki-run", "session.json"), "utf8")); } catch { /* older run */ }
  let skip = o.skipSteps ?? 0;
  const read = session ? transcriptReader(session.sessionId, (s) => { if (skip > 0) skip--; else o.onStep?.(s); }) : () => {};
  const alive = () => { if (!session?.pid) return true; try { process.kill(session.pid, 0); return true; } catch { return false; } };
  let deadAt = 0;
  while (Date.now() < o.deadline) {
    if (o.isActive && !o.isActive()) return null;
    try { read(); } catch { /* mid-write */ }
    if (existsSync(o.resultFile)) {
      try { return JSON.parse(readFileSync(o.resultFile, "utf8")); } catch { /* still being written */ }
    }
    // Agent process gone and no result for 30s → it ended without writing one.
    if (!alive()) { deadAt ||= Date.now(); if (Date.now() - deadAt > 30_000) throw new AppError("AGENT_EXITED", "Phiên Claude kết thúc mà không ghi kết quả", 502); }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new AppError("AGENT_TIMEOUT", "Hết thời gian chờ kết quả từ agent", 504);
}
