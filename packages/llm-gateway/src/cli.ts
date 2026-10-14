import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  const i = cliInfoRaw();
  // `--version` keeps working after the OAuth token expires, so it only proves the binary is there.
  // Whether the account still works is a separate fact — see `auth` below; never block on it here.
  if (i.available && !authFresh()) void probeCliAuth();
  return { ...i, bin: BIN, loggedIn: i.available ? (auth?.loggedIn ?? null) : false, authError: auth?.error, authCheckedAt: auth?.checkedAt };
}
export const cliAvailable = () => cliInfo().available;

/* ---------------- Login state: `--version` cannot see an expired token ---------------- */

const PROBE_MODEL = process.env.LLM_MODEL_SMALL ?? "claude-haiku-4-5";
const PROBE_TIMEOUT_MS = Number(process.env.CLAUDE_CLI_PROBE_TIMEOUT_MS ?? 30_000);
const AUTH_TTL_OK = 10 * 60_000; // a working login rarely drops; re-check sparingly
const AUTH_TTL_BAD = 60_000; // after /login, pick the recovery up quickly
const AUTH_ERR_RE = /Failed to authenticate|OAuth[^.]*expire|session expired|not logged in|Invalid API key|Please run \/login|authentication_error/i;

/** `loggedIn: null` = could not tell (timeout, no network) — report it, never cry wolf. */
let auth: { loggedIn: boolean | null; error?: string; checkedAt: number } | null = null;
let probing: Promise<boolean | null> | null = null;
const authFresh = () => !!auth && Date.now() - auth.checkedAt < (auth.loggedIn === true ? AUTH_TTL_OK : AUTH_TTL_BAD);

function setAuth(loggedIn: boolean | null, error?: string) {
  auth = { loggedIn, error: error?.slice(0, 200), checkedAt: Date.now() };
}

/** What a real `claude` call just proved about the login — keeps the state fresh for free. */
export function noteCliAuth(ok: boolean, error?: string) {
  if (!ok && !AUTH_ERR_RE.test(error ?? "")) return; // an ordinary failure says nothing about the login
  setAuth(ok, ok ? undefined : error);
}

/** Spends one tiny `claude -p` call to find out whether the account still works. */
export function probeCliAuth(): Promise<boolean | null> {
  if (authFresh()) return Promise.resolve(auth!.loggedIn);
  if (probing) return probing;
  probing = new Promise<boolean | null>((resolve) => {
    const done = (loggedIn: boolean | null, error?: string) => {
      setAuth(loggedIn, error);
      probing = null;
      resolve(loggedIn);
    };
    if (!cliInfoRaw().available) return done(false, "Không tìm thấy lệnh `claude`");
    mkdirSync(WORKDIR, { recursive: true });
    const child = spawn(BIN, ["-p", "--output-format", "json", "--model", PROBE_MODEL, "--tools", "", "--no-session-persistence", "--setting-sources", ""], { cwd: WORKDIR, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, PROBE_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); done(null, `Không chạy được Claude CLI: ${e.message}`); });
    child.on("close", () => {
      clearTimeout(timer);
      if (timedOut) return done(null, `Claude CLI không phản hồi sau ${Math.round(PROBE_TIMEOUT_MS / 1000)} giây`);
      const raw = `${out}\n${err}`.trim();
      let j: any;
      try { j = JSON.parse(out.trim().split("\n").filter(Boolean).at(-1) ?? "{}"); } catch { j = null; }
      if (j && !j.is_error && j.subtype === "success") return done(true);
      // JSON metadata precedes `result` in CLI output; show the human-readable failure rather than truncating that envelope.
      const message = cliFailureMessage(j) || firstLine(err) || firstLine(raw);
      if (AUTH_ERR_RE.test(message) || AUTH_ERR_RE.test(raw)) return done(false, message);
      // Reached Claude but got something else (usage limit, transient error): the login is not the problem.
      return done(null, message || `Claude CLI trả về bất thường (${j?.subtype ?? "không rõ"})`);
    });
    feedStdin(child, "hi");
  });
  return probing;
}

const firstLine = (s: string) => (s.split("\n").find((l) => AUTH_ERR_RE.test(l)) ?? s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 200);
function cliFailureMessage(result: any): string {
  const text = (value: unknown): string => typeof value === "string" ? value.trim()
    : value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string" ? String((value as { message: string }).message).trim() : "";
  return text(result?.result) || (Array.isArray(result?.errors) ? result.errors.map(text).filter(Boolean).join("; ") : text(result?.errors)) || text(result?.error);
}

/** Is the `claude` binary there, and which version — cached, no probe side-effect. */
function cliInfoRaw() {
  if (!info || Date.now() - info.checkedAt > 60_000) {
    try {
      const v = execFileSync(BIN, ["--version"], { encoding: "utf8", timeout: 10_000, env: childEnv() }).trim();
      info = { available: true, version: v, checkedAt: Date.now() };
    } catch {
      info = { available: false, checkedAt: Date.now() };
    }
  }
  return info;
}

/**
 * Feed the prompt in. A CLI that exits before reading it (an expired login prints its error and quits)
 * makes this write fail with EPIPE — an unhandled 'error' on the socket would take the API process down,
 * so swallow it: the real outcome is read from stdout/close.
 */
function feedStdin(child: ChildProcess, text: string) {
  child.stdin?.on("error", () => { /* child already gone; close handler reports why */ });
  try { child.stdin?.end(text); } catch { /* same */ }
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force the subscription login, never API billing
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDECODE; // allow running even when the server itself was started from Claude Code
  return env;
}

/**
 * Long text (system prompt = DNA + skills, MCP config) goes to the CLI through a file, never an argument: Windows caps a
 * command line at ~32 KB (spawn ENAMETOOLONG) and a skill-laden system prompt is several times that.
 * Returns the path and a cleanup function.
 */
function argFile(name: string, content: string) {
  const dir = join(WORKDIR, "args");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${process.pid}-${randomUUID()}-${name}`);
  writeFileSync(file, content);
  return { file, cleanup: () => rmSync(file, { force: true }) };
}

// Simple semaphore: CLI calls are heavy processes; keep a few at a time.
let active = 0;
const waiters: (() => void)[] = [];
/**
 * Làn ưu tiên cho khách đang chờ (bot chat, ~5 giây/lượt): có chỗ RIÊNG nên không phải xếp hàng sau các tác vụ dài 80–170 giây
 * (viết bài, review…) đang chiếm hết làn thường. Tối đa PRIORITY_PARALLEL lượt cùng lúc; vượt thì xếp hàng trong làn ưu tiên.
 */
const PRIORITY_PARALLEL = Number(process.env.CLAUDE_CLI_PRIORITY_CONCURRENCY ?? 3);
let priorityActive = 0;
const priorityWaiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>, priority = false): Promise<T> {
  if (priority) {
    if (priorityActive >= PRIORITY_PARALLEL) await new Promise<void>((r) => priorityWaiters.push(r));
    priorityActive++;
    try { return await fn(); } finally { priorityActive--; priorityWaiters.shift()?.(); }
  }
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

/** Chỉ để kiểm thử làn chạy (làn thường / làn ưu tiên của bot chat). */
export const runInLane = slot;

export interface CliResult {
  structured: unknown;
  model: string;
  usage: { input: number; output: number; cached: number };
  costMicros: number;
  durationMs: number;
}

export interface CliRunOptions {
  prompt: string; system: string; model: string; jsonSchema: object; effort?: string;
  /** Thư mục chứa ảnh cần xem (bước "bot xem ảnh"): bật DUY NHẤT công cụ Read, chỉ đọc trong thư mục này. */
  imageDir?: string;
  /**
   * Chế độ NHANH cho câu trả lời cần tức thì (bot chat): không dùng `--json-schema` (CLI bắt model gọi công cụ StructuredOutput
   * và thử lại nhiều vòng — đo thực tế 3 đến 18 vòng, 9 đến 44 giây cho câu 1 dòng) mà dặn model trả JSON thuần trong văn bản:
   * luôn 1 vòng, ~5 giây. Đầu ra vẫn được kiểm bằng zod ở nơi gọi; sai thì nơi gọi chạy lại bằng chế độ schema.
   */
  fast?: boolean;
  /** Khách đang chờ (bot chat): chạy ở làn ưu tiên, không xếp hàng sau tác vụ nền dài. */
  priority?: boolean;
}

/** Lời dặn định dạng cho chế độ nhanh (thay cho `--json-schema`). */
export function fastJsonInstruction(jsonSchema: object): string {
  return `ĐỊNH DẠNG ĐẦU RA: chỉ trả về MỘT đối tượng JSON thuần (không markdown, không giải thích thêm) đúng JSON Schema sau:
${JSON.stringify(jsonSchema)}`;
}

/**
 * Biến môi trường thêm cho lượt chạy nhanh: tắt "suy nghĩ" (MAX_THINKING_TOKENS=0) — câu chat 1 dòng không cần, và đây là
 * phần tốn thời gian nhất. Chỉ áp dụng cho lượt chạy nhanh; agent viết nội dung dài (chế độ schema) vẫn giữ nguyên.
 */
export const fastEnv = (fast?: boolean): Record<string, string> => (fast ? { MAX_THINKING_TOKENS: "0" } : {});

/** Đường dẫn tuyệt đối → dạng luật quyền của Claude Code (`//c/Users/x` trên Windows, `//tmp/x` trên POSIX). */
export function permissionPath(abs: string): string {
  const posix = abs.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`).replace(/\/+$/, "");
  return `/${posix.startsWith("/") ? posix : `/${posix}`}`;
}

/** Nội dung system prompt của 1 lượt generate (chế độ nhanh: thêm lời dặn JSON thay cho --json-schema). */
export function cliSystemPrompt(opts: Pick<CliRunOptions, "system" | "fast" | "jsonSchema">): string {
  return opts.fast ? `${opts.system}

${fastJsonInstruction(opts.jsonSchema)}` : opts.system;
}

/**
 * Đối số `claude -p` cho 1 lượt generate; system prompt nằm trong tệp `systemFile` (Windows giới hạn ~32 KB cho dòng lệnh).
 * Mặc định KHÔNG có công cụ nào. Có ảnh (imageDir): chỉ công cụ Read (chỉ đọc), chỉ được phép trong thư mục ảnh tạm
 * (--add-dir), chế độ dontAsk → mọi thao tác khác bị từ chối, không hỏi.
 */
export function buildCliArgs(opts: CliRunOptions, systemFile: string): string[] {
  const args = [
    "-p", "--output-format", "json", "--model", opts.model,
    "--system-prompt-file", systemFile,
    ...(opts.fast ? [] : ["--json-schema", JSON.stringify(opts.jsonSchema)]),
    ...(opts.imageDir
      ? ["--tools", "Read", "--allowedTools", `Read(${permissionPath(opts.imageDir)}/**)`, "--permission-mode", "dontAsk", "--add-dir", opts.imageDir]
      : ["--tools", ""]),
    "--no-session-persistence", "--setting-sources", "",
    // Lượt gọi 1 phát không cần MCP/skill: không có 2 cờ này, CLI nạp cả connector của tài khoản claude.ai (Figma, Canva, Higgsfield…)
    // → ~80.000 token nền và ~0,16 USD cho MỖI câu (đo: 80.561 token → 3.127 token, 0,164 → 0,007 USD).
    "--strict-mcp-config", "--disable-slash-commands",
  ];
  if (opts.effort && !opts.model.includes("haiku")) args.push("--effort", opts.effort);
  return args;
}

export function runClaudeCli(opts: CliRunOptions): Promise<CliResult> {
  return slot(() => new Promise<CliResult>((resolve, reject) => {
    mkdirSync(WORKDIR, { recursive: true });
    const sys = argFile("system.md", cliSystemPrompt(opts));
    const args = buildCliArgs(opts, sys.file);
    const child = spawn(BIN, args, { cwd: WORKDIR, env: { ...childEnv(), ...fastEnv(opts.fast) }, stdio: ["pipe", "pipe", "pipe"] });
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
      sys.cleanup();
      reject(new AppError("CLI_NOT_FOUND", `Không chạy được Claude CLI: ${e.message}`, 503));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      sys.cleanup();
      let j: any;
      try {
        j = JSON.parse(out.trim().split("\n").filter(Boolean).at(-1) ?? "{}");
      } catch {
        return reject(new AppError("CLI_BAD_OUTPUT", `Claude CLI trả về không phải JSON (code ${code}): ${(err || out).slice(0, 400)}`, 502));
      }
      if (j.is_error || j.subtype !== "success") {
        const msg = String(j.result ?? j.api_error_status ?? err ?? "lỗi không rõ").slice(0, 400);
        const code2 = /login|auth|credential|not logged/i.test(msg) ? "CLI_NOT_LOGGED_IN" : /limit|quota|usage/i.test(msg) ? "CLI_USAGE_LIMIT" : "CLI_ERROR";
        noteCliAuth(false, msg);
        return reject(new AppError(code2, `Claude CLI: ${msg}`, 502));
      }
      noteCliAuth(true);
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
    feedStdin(child, opts.prompt);
  }), opts.priority);
}

/** Bóc JSON từ văn bản của model: bỏ hàng rào ```json, và nếu còn chữ thừa quanh thì lấy từ `{` đầu tới `}` cuối. */
export function safeJson(s: unknown) {
  if (typeof s !== "string") return s;
  const parse = (t: string) => { try { return JSON.parse(t); } catch { return undefined; } };
  const plain = s.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const direct = parse(plain);
  if (direct !== undefined) return direct;
  const i = plain.indexOf("{"), k = plain.lastIndexOf("}");
  return i >= 0 && k > i ? (parse(plain.slice(i, k + 1)) ?? null) : null;
}

// ---------------- Long-running tool-using agent (browser automation) ----------------
export interface ApproverOptions {
  /** Only these local folders can be read or uploaded by the permission approver. Empty is valid for browser discovery. */
  fileRoots: string[];
  hosts?: string[];
  tools?: string[];
  /** When set, switching/selecting another Chrome instance is denied. */
  deviceId?: string;
  logFile?: string;
  js?: boolean;
  /** Creating this file stops new Chrome permissions, including in an already-running job. */
  killFile?: string;
}

export interface AgentRunOptions {
  prompt: string;
  system: string;
  model: string;
  jsonSchema: object;
  allowedTools: string[];
  addDirs: string[];
  cwd: string;
  /** Claude in Chrome, with the guarded permission approver; existing MCP servers are merged. */
  chrome?: boolean;
  approver?: ApproverOptions;
  /** Continue the same session if the CLI connection drops; never more than two retries. */
  resume?: { max: number; delayMs?: number };
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
  resumes?: number;
}

function describeTool(name: string, input: any): string {
  const short = name.replace(/^mcp__claude-in-chrome__/, "chrome.").replace(/^mcp__flow__browser_/, "flow.").replace(/^mcp__taki_approver__/, "quyền.");
  if (input?.element) return `${short} "${String(input.element).slice(0, 70)}"${input.text ? ` ← "${String(input.text).slice(0, 50)}"` : ""}`;
  if (input?.url) return `${short} ${input.url}`;
  if (input?.command) return `${short}: ${String(input.command).slice(0, 140)}`;
  if (input?.action) return `${short} ${input.action}${input.text ? ` "${String(input.text).slice(0, 60)}"` : ""}`;
  if (input?.query) return `${short} "${String(input.query).slice(0, 60)}"`;
  if (input?.ref) return `${short} ${String(input.ref).slice(0, 60)}`;
  if (input?.coordinate) return `${short} ${JSON.stringify(input.coordinate).slice(0, 60)}`;
  return short;
}

export const RESUME_PROMPT = "Phiên trước bị ngắt giữa chừng (lỗi kết nối). Kiểm tra lại trạng thái hiện tại (trình duyệt, tệp đã có) rồi làm TIẾP từ chỗ đang dở, không làm lại bước đã xong và không đăng trùng nội dung. Hoàn tất công việc và trả kết quả đúng định dạng đã yêu cầu.";
const APPROVER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "chrome-approver.mjs");
const APPROVER_ARGS = ["--permission-prompt-tool", "mcp__taki_approver__approve"];

function assertChromeApprover(a: ApproverOptions | undefined, env?: Record<string, string>) {
  if (process.env.ALLOW_CHROME_AUTOAPPROVE === "0" || env?.ALLOW_CHROME_AUTOAPPROVE === "0" || (a?.killFile && existsSync(a.killFile))) {
    throw new AppError("CHROME_APPROVER_OFF", "Bộ duyệt quyền Chrome đang tắt — kiểm tra công tắc khẩn cấp", 409);
  }
  if (!a || !Array.isArray(a.fileRoots) || !existsSync(APPROVER_SCRIPT)) {
    throw new AppError("CHROME_APPROVER_MISSING", "Chưa có bộ duyệt quyền Chrome hoặc thư mục được phép", 409);
  }
}

function chromeApproverConfig(extra: object | undefined, a: ApproverOptions | undefined, env?: Record<string, string>) {
  assertChromeApprover(a, env);
  return {
    ...(extra ?? {}),
    mcpServers: {
      ...((extra as { mcpServers?: Record<string, unknown> } | undefined)?.mcpServers ?? {}),
      taki_approver: {
        command: process.execPath,
        args: [APPROVER_SCRIPT],
        env: {
          TAKI_APPROVER_FILE_ROOTS: JSON.stringify(a!.fileRoots),
          ...(a!.hosts ? { TAKI_APPROVER_HOSTS: JSON.stringify(a!.hosts) } : {}),
          ...(a!.tools ? { TAKI_APPROVER_TOOLS: JSON.stringify(a!.tools) } : {}),
          ...(a!.deviceId ? { TAKI_APPROVER_DEVICE_ID: a!.deviceId } : {}),
          TAKI_APPROVER_LOG: a!.logFile ?? "",
          TAKI_APPROVER_JS: a!.js === false ? "off" : "on",
          TAKI_APPROVER_KILL_FILE: a!.killFile ?? "",
        },
      },
    },
  };
}

/** Chrome calls must reach the permission approver rather than match a blanket allow rule. */
function agentAllowedTools(tools: string[], chrome?: boolean) {
  return chrome ? tools.filter((t) => !t.startsWith("mcp__claude-in-chrome")) : tools;
}

function agentAllowedArgs(tools: string[], chrome?: boolean) {
  const allowed = agentAllowedTools(tools, chrome);
  // Commander requires at least one value for --allowedTools <tools...>; discovery may have only Chrome tools.
  return allowed.length || !chrome ? ["--allowedTools", ...allowed] : [];
}

/** Runs `claude -p` with tools (and optionally Claude in Chrome) until it returns schema-shaped JSON. */
export function runClaudeAgent(o: AgentRunOptions): Promise<AgentRunResult> {
  return new Promise<AgentRunResult>((resolve, reject) => {
    const timeoutMs = o.timeoutMs ?? 75 * 60_000;
    const startedAt = Date.now();
    const maxResumes = Math.min(2, Math.max(0, Math.floor(o.resume?.max ?? 0)));
    const sessionId = maxResumes > 0 ? randomUUID() : null;
    let resumes = 0;
    let settled = false;
    let child: ChildProcess | undefined;
    let cleanup = () => {};
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (!child) return;
      if (process.platform === "win32" && child.pid) {
        try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* already gone */ }
      } else child.kill("SIGTERM");
    };
    const finish = (error?: Error, result?: AgentRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      o.signal?.removeEventListener("abort", abort);
      cleanup();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => {
      stop();
      finish(new AppError("CANCELLED", "Đã hủy", 499));
    };
    const timer = setTimeout(() => {
      stop();
      finish(new AppError("AGENT_TIMEOUT", `Agent chạy quá ${Math.round(timeoutMs / 60000)} phút`, 504));
    }, timeoutMs);
    o.signal?.addEventListener("abort", abort, { once: true });

    const launch = (resume: boolean) => {
      if (settled) return;
      if (o.signal?.aborted) return abort();
      try {
        const config = o.chrome ? chromeApproverConfig(o.mcpConfig, o.approver, o.env) : o.mcpConfig;
        const sys = argFile("system.md", o.system);
        cleanup = sys.cleanup;
        const mcp = config ? argFile("mcp.json", JSON.stringify(config)) : null;
        cleanup = () => { sys.cleanup(); mcp?.cleanup(); };
        const args = [
          "-p", "--output-format", "stream-json", "--verbose", "--model", o.model,
          "--append-system-prompt-file", sys.file,
          "--json-schema", JSON.stringify(o.jsonSchema),
          ...(o.chrome ? APPROVER_ARGS : ["--permission-mode", "dontAsk"]),
          ...agentAllowedArgs(o.allowedTools, o.chrome),
          ...(sessionId ? [resume ? "--resume" : "--session-id", sessionId] : ["--no-session-persistence"]),
          "--setting-sources", "",
          ...(o.chrome ? ["--chrome"] : ["--no-chrome"]),
          ...(mcp ? ["--mcp-config", mcp.file, "--strict-mcp-config"] : []),
          ...o.addDirs.flatMap((d) => ["--add-dir", d]),
        ];
        const c = spawn(BIN, args, { cwd: o.cwd, env: { ...childEnv(), ...(o.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
        child = c;
        let buf = "";
        let err = "";
        let final: any = null;
        const readLine = (line: string) => {
          let ev: any;
          try { ev = JSON.parse(line); } catch { return; }
          if (ev.type === "assistant") {
            for (const block of ev.message?.content ?? []) {
              if (block.type === "tool_use") o.onStep?.({ at: new Date().toISOString(), kind: "tool", text: describeTool(block.name, block.input) });
              else if (block.type === "text" && block.text?.trim()) o.onStep?.({ at: new Date().toISOString(), kind: "text", text: block.text.trim().slice(0, 300) });
            }
          } else if (ev.type === "result") final = ev;
        };
        c.stdout!.on("data", (d) => {
          if (settled) return;
          buf += d;
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) readLine(line);
          }
        });
        c.stderr!.on("data", (d) => (err += d));
        c.on("error", (e) => finish(new AppError("CLI_NOT_FOUND", `Không chạy được Claude CLI: ${e.message}`, 503)));
        c.on("close", (code) => {
          if (settled) return;
          if (buf.trim()) readLine(buf.trim());
          cleanup();
          const interrupted = !final || final.subtype === "error_during_execution";
          if (interrupted && sessionId && resumes < maxResumes && !o.signal?.aborted && Date.now() - startedAt < timeoutMs - 5 * 60_000) {
            resumes++;
            child = undefined;
            o.onStep?.({ at: new Date().toISOString(), kind: "text", text: `Phiên Claude bị ngắt giữa chừng — tự nối lại phiên (lần ${resumes}/${maxResumes})` });
            retryTimer = setTimeout(() => launch(true), Math.max(0, o.resume?.delayMs ?? 15_000));
            return;
          }
          if (!final) {
            noteCliAuth(false, err);
            return finish(new AppError("CLI_BAD_OUTPUT", `Agent dừng không có kết quả (code ${code}): ${err.slice(-400)}`, 502));
          }
          if (final.is_error || final.subtype !== "success") {
            const msg = String(final.result ?? final.subtype).slice(0, 400);
            noteCliAuth(false, msg);
            return finish(new AppError("AGENT_ERROR", `Agent lỗi: ${msg}`, 502));
          }
          noteCliAuth(true);
          const mu = Object.entries(final.modelUsage ?? {}) as [string, any][];
          const main = mu.sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0];
          const u = final.usage ?? {};
          finish(undefined, {
            structured: final.structured_output ?? safeJson(final.result),
            model: main?.[1]?.canonicalModel ?? main?.[0] ?? o.model,
            usage: { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, cached: u.cache_read_input_tokens ?? 0 },
            costMicros: Math.round((final.total_cost_usd ?? 0) * 1e6),
            durationMs: final.duration_ms ?? 0,
            turns: final.num_turns ?? 0,
            denials: final.permission_denials ?? [],
            ...(sessionId ? { resumes } : {}),
          });
        });
        feedStdin(c, resume ? RESUME_PROMPT : o.prompt);
      } catch (e) {
        finish(e instanceof AppError ? e : new AppError("CLI_NOT_FOUND", `Không chạy được Claude CLI: ${String(e)}`, 503));
      }
    };
    launch(false);
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
  /** Built-in tools the agent must not use (e.g. TaskCreate/TaskUpdate bookkeeping that only adds turns). */
  disallowedTools?: string[];
  addDirs: string[];
  /** The agent writes its final JSON here (absolute path); the run completes when this file parses. */
  resultFile: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onStep?: (step: { at: string; kind: "tool" | "text"; text: string }) => void;
  /** MCP servers for the run (e.g. Playwright attached to Chrome Flow). Given → plain headless `claude -p`
   *  (MCP tools are allowed by --allowedTools; no Claude in Chrome, no pseudo-terminal needed). */
  mcpConfig?: object;
  /** Run the Chrome extension headlessly through the guarded permission approver. */
  chrome?: boolean;
  approver?: ApproverOptions;
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
  if (o.chrome) assertChromeApprover(o.approver, o.env);
  // Only the interactive (pseudo-terminal) mode below is macOS/Linux-only; the headless `claude -p` mode (mcpConfig) runs everywhere.
  const headless = Boolean(o.mcpConfig || o.chrome);
  if (!headless && process.platform !== "darwin" && process.platform !== "linux") throw new AppError("NOT_SUPPORTED", "Chạy trình duyệt tự động hỗ trợ macOS/Linux");
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
  // Windows names the variable "Path": a second "PATH" key (from o.env) would be a duplicate in the child's environment block.
  if (process.platform === "win32" && o.env?.PATH) for (const k of Object.keys(env)) if (k !== "PATH" && k.toLowerCase() === "path") delete env[k];
  let child: ChildProcess;
  /** Headless run, or (resume) the same session continued after the CLI died mid-run (e.g. a dropped API connection). */
  const spawnHeadless = (resume: boolean) => {
    const mcpFile = join(runDir, "mcp.json");
    writeFileSync(mcpFile, JSON.stringify(o.chrome ? chromeApproverConfig(o.mcpConfig, o.approver, o.env) : o.mcpConfig));
    const prompt = resume
      ? `Phiên trước bị ngắt giữa chừng (lỗi kết nối) và CHƯA có ${o.resultFile}. Kiểm tra lại trạng thái hiện tại (trình duyệt, tệp đã có) rồi làm TIẾP từ chỗ đang dở, không làm lại bước đã xong. Nếu không thể làm tiếp thì ghi ${o.resultFile} với status "failed"/"blocked" và lý do.`
      : o.prompt;
    // Windows: the prompt (brief + image list) is read from a file on stdin — a command line is capped at ~32 KB there.
    // Elsewhere it stays the first positional argument: --allowedTools / --add-dir are variadic and would swallow a trailing one.
    const viaStdin = process.platform === "win32";
    let promptFd: number | null = null;
    if (viaStdin) {
      const pf = join(runDir, resume ? "prompt-resume.md" : "prompt-run.md");
      writeFileSync(pf, prompt);
      promptFd = openSync(pf, "r");
    }
    // Windows also offers a PowerShell tool next to Bash; every allow-rule here is a Bash(...) rule, so steer the model to Bash.
    const disallowed = [...(o.disallowedTools ?? []), ...(viaStdin ? ["PowerShell"] : [])];
    const args = [
      ...(viaStdin ? [] : [prompt]), "-p", "--model", o.model, ...(o.chrome ? APPROVER_ARGS : ["--permission-mode", "dontAsk"]), ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]), o.chrome ? "--chrome" : "--no-chrome",
      "--mcp-config", mcpFile, "--strict-mcp-config", "--setting-sources", "", "--append-system-prompt-file", systemFile,
      ...agentAllowedArgs(o.allowedTools, o.chrome), ...(disallowed.length ? ["--disallowedTools", ...disallowed] : []), ...o.addDirs.flatMap((d) => ["--add-dir", d]),
    ];
    // Detached: survives an API restart (the job is re-attached through resultFile).
    try {
      return spawn(bin, args, { cwd: o.cwd, env, stdio: [promptFd ?? "ignore", "ignore", "ignore"], detached: true, windowsHide: true });
    } finally {
      if (promptFd !== null) closeSync(promptFd);
    }
  };
  if (headless) {
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
  const stop = () => {
    if (process.platform === "win32") {
      // No process groups on Windows: end the whole tree (claude + its MCP / Bash children).
      try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* gone */ }
      return;
    }
    try { process.kill(-child.pid!, "SIGTERM"); } catch { /* gone */ } setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, 3000);
  };
  let exited = false;
  let launchError: Error | undefined;
  child.on("exit", () => { exited = true; });
  child.on("error", (e) => { launchError = e; });
  let resumes = 0;

  const readSteps = transcriptReader(sessionId, o.onStep);
  const startedAt = Date.now();

  o.onStep?.({ at: new Date().toISOString(), kind: "text", text: "Claude đang chạy ngầm — không cần thao tác" });
  try {
    while (true) {
      if (o.signal?.aborted) throw new AppError("CANCELLED", "Đã hủy", 499);
      if (o.chrome) assertChromeApprover(o.approver, o.env);
      if (launchError) throw new AppError("CLI_NOT_FOUND", `Không chạy được Claude CLI: ${launchError.message}`, 503);
      if (Date.now() - startedAt > o.timeoutMs) throw new AppError("AGENT_TIMEOUT", `Quá ${Math.round(o.timeoutMs / 60000)} phút chưa có kết quả`, 504);
      try { readSteps(); } catch { /* transcript mid-write */ }
      if (existsSync(o.resultFile)) {
        try { return JSON.parse(readFileSync(o.resultFile, "utf8")); } catch { /* still being written */ }
      }
      if (exited) {
        // Headless run died without a result (most often a dropped API connection): continue the same session, at most twice.
        if (!headless || resumes >= 2 || Date.now() - startedAt > o.timeoutMs - 5 * 60_000) throw new AppError("AGENT_EXITED", "Phiên Claude kết thúc mà không ghi kết quả", 502);
        resumes++;
        o.onStep?.({ at: new Date().toISOString(), kind: "text", text: `Phiên Claude bị ngắt giữa chừng — tự nối lại phiên (lần ${resumes}/2)` });
        await new Promise((r) => setTimeout(r, 15_000));
        if (o.signal?.aborted) throw new AppError("CANCELLED", "Đã hủy", 499);
        if (Date.now() - startedAt >= o.timeoutMs) throw new AppError("AGENT_TIMEOUT", "Hết thời gian chờ kết quả từ agent", 504);
        exited = false;
        child = spawnHeadless(true);
        child.on("exit", () => { exited = true; });
        child.on("error", (e) => { launchError = e; });
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
export function transcriptReader(sessionId: string, onStep?: TerminalRunOptions["onStep"]) {
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
    // `offset` đếm BYTE: đọc đúng phần mới theo byte (trước đây `readFileSync(..., "utf8").slice(offset)` cắt theo KÝ TỰ — transcript
    // tiếng Việt nhiều ký tự nhiều byte nên mỗi lần đọc làm mất một đoạn, dần dần mất hết → nhật ký đứng yên dù agent vẫn chạy).
    // Chỉ xử lý tới dòng đã ghi trọn (dòng đang ghi dở để lần sau).
    const buf = Buffer.alloc(size - offset);
    const fd = openSync(transcript, "r");
    try { readSync(fd, buf, 0, buf.length, offset); } finally { closeSync(fd); }
    const end = buf.lastIndexOf(0x0a);
    if (end < 0) return;
    const chunk = buf.subarray(0, end + 1).toString("utf8");
    offset += end + 1;
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
