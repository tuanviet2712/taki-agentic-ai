import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { AppError } from "@dotaka/shared";
import type { AgentRunResult, CliResult } from "./cli.ts";

export function grokHome(): string {
  return process.env.GROK_HOME?.trim() || join(homedir(), ".grok");
}

/** Resolve the native Grok CLI binary or npm JS bootstrap launcher on Windows/macOS/Linux. */
export function grokCommand(): { bin: string; args: string[] } {
  const configured = process.env.GROK_CLI_PATH?.trim() || undefined;
  if (configured && /\.(?:c?m?js)$/i.test(configured)) return { bin: process.execPath, args: [configured] };
  if (configured && !/\.(?:cmd|ps1|bat)$/i.test(configured) && existsSync(configured)) return { bin: configured, args: [] };

  const isWin = process.platform === "win32";
  const exeName = isWin ? "grok.exe" : "grok";
  const canonical = join(grokHome(), "bin", exeName);
  if (existsSync(canonical)) return { bin: canonical, args: [] };

  const dirs = [
    ...(configured ? [dirname(configured)] : []),
    ...(process.env.PATH ?? "").split(delimiter),
    ...(process.env.APPDATA ? [join(process.env.APPDATA, "npm")] : []),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const platBin = join(dir, "node_modules", "@xai-official", "grok", "node_modules", `@xai-official`, `grok-${process.platform}-${process.arch}`, "bin", exeName);
    if (existsSync(platBin)) return { bin: platBin, args: [] };
    const jsLauncher = join(dir, "node_modules", "@xai-official", "grok", "bin", "grok");
    if (existsSync(jsLauncher)) return { bin: process.execPath, args: [jsLauncher] };
    const directExe = join(dir, exeName);
    if (existsSync(directExe)) return { bin: directExe, args: [] };
  }
  return { bin: configured ?? "grok", args: [] };
}

export function grokEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDECODE;
  return { ...env, GROK_HOME: grokHome() };
}

export function stopGrok(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
  } else child.kill("SIGTERM");
}

export function grokLoggedIn(): { loggedIn: boolean; authMode?: "api_key" | "oauth"; detail?: string } {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (apiKey) return { loggedIn: true, authMode: "api_key", detail: `API Key (${apiKey.slice(0, 6)}…)` };
  const authPath = join(grokHome(), "auth.json");
  if (!existsSync(authPath)) return { loggedIn: false };
  try {
    const raw = readFileSync(authPath, "utf8").trim();
    if (!raw) return { loggedIn: false };
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      const hasToken = Boolean(parsed.access_token || parsed.token || parsed.tokens?.access_token || parsed.id_token || Object.keys(parsed).length > 0);
      return { loggedIn: hasToken, authMode: "oauth", detail: parsed.email ?? "Tài khoản Grok (OAuth)" };
    }
    return { loggedIn: raw.length > 10, authMode: "oauth", detail: "Tài khoản Grok" };
  } catch {
    return { loggedIn: false };
  }
}

type GrokLoginSession = {
  child: ChildProcess;
  state: "waiting" | "done" | "error" | "cancelled";
  method: "browser" | "device";
  url?: string;
  code?: string;
  error?: string;
  expiresAt: string;
  timer?: NodeJS.Timeout;
};
let activeLogin: GrokLoginSession | null = null;
process.once("exit", () => { if (activeLogin?.state === "waiting") stopGrok(activeLogin.child); });

let cachedInfo: { available: boolean; version?: string; checkedAt: number } | null = null;
export function grokInfo() {
  if (!cachedInfo || Date.now() - cachedInfo.checkedAt > 30_000) {
    const cmd = grokCommand();
    let found = false;
    const binExists = existsSync(cmd.bin) && (cmd.args.length === 0 || existsSync(cmd.args[0]));
    if (binExists && process.env.APPDATA) {
      try {
        const pkgPath = join(process.env.APPDATA, "npm", "node_modules", "@xai-official", "grok", "package.json");
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
          cachedInfo = { available: true, version: pkg.version ?? "installed", checkedAt: Date.now() };
          found = true;
        }
      } catch { /* fall through */ }
    }
    if (!found) {
      try {
        const version = execFileSync(cmd.bin, [...cmd.args, "--version"], { encoding: "utf8", timeout: 2_500, env: grokEnv(), windowsHide: true }).trim().split("\n")[0];
        cachedInfo = { available: true, version, checkedAt: Date.now() };
      } catch {
        cachedInfo = { available: false, checkedAt: Date.now() };
      }
    }
  }
  const info = cachedInfo!;
  const auth = grokLoggedIn();
  const loggedIn = info.available ? auth.loggedIn : false;
  return {
    ...info,
    loggedIn,
    authMode: auth.authMode ?? null,
    authMethod: auth.authMode ?? null,
    authDetail: auth.detail ?? null,
    authError: !info.available ? "Chưa cài Grok CLI" : !loggedIn ? "Grok CLI chưa đăng nhập (nhấn Đăng nhập Grok hoặc nhập XAI_API_KEY)" : undefined,
    login: activeLogin
      ? { state: activeLogin.state, method: activeLogin.method, url: activeLogin.url, code: activeLogin.code, error: activeLogin.error, expiresAt: activeLogin.expiresAt }
      : null,
    loginState: activeLogin
      ? {
          status: activeLogin.state,
          method: activeLogin.method,
          loginUrl: activeLogin.url,
          userCode: activeLogin.code,
          message: activeLogin.error ?? (activeLogin.method === "device" ? "Mở trang xác thực xAI và nhập mã bên dưới:" : "Đang chờ xác thực tài khoản Grok trên trình duyệt…"),
        }
      : null,
  };
}

function parseGrokLoginOutput(output: string): { url?: string; code?: string } {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  let url: string | undefined;
  for (const match of clean.matchAll(/https:\/\/[^\s<>"']+/g)) {
    try {
      const u = new URL(match[0]);
      if (["auth.x.ai", "accounts.x.ai", "grok.com", "x.ai"].includes(u.hostname)) { url = u.toString(); break; }
    } catch { /* partial chunk */ }
  }
  const code = clean.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0];
  return { ...(url ? { url } : {}), ...(code ? { code } : {}) };
}

export function startGrokLogin(method: "browser" | "device", onUpdate?: () => void) {
  if (!grokInfo().available) throw new AppError("GROK_MISSING", "Chưa cài Grok CLI. Chạy: npm install -g @xai-official/grok", 503);
  if (activeLogin?.state === "waiting") stopGrok(activeLogin.child);
  mkdirSync(grokHome(), { recursive: true });
  const cmd = grokCommand();
  const flag = method === "device" ? "--device-auth" : "--oauth";
  const child = spawn(cmd.bin, [...cmd.args, "login", flag], { cwd: grokHome(), env: grokEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const session: GrokLoginSession = { child, method, state: "waiting", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
  activeLogin = session;
  let output = "";
  const consume = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-24_000);
    const parsed = parseGrokLoginOutput(output);
    const changed = (parsed.url && parsed.url !== session.url) || (parsed.code && parsed.code !== session.code);
    Object.assign(session, parsed);
    if (changed) onUpdate?.();
  };
  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);
  session.timer = setTimeout(() => {
    session.state = "error";
    session.error = "Lượt đăng nhập Grok đã hết thời gian. Bấm đăng nhập lại.";
    stopGrok(child);
    onUpdate?.();
  }, 10 * 60_000);
  child.once("error", (e) => {
    clearTimeout(session.timer);
    session.state = "error";
    session.error = `Không khởi động được Grok CLI: ${e.message}`;
    onUpdate?.();
  });
  child.once("close", (code) => {
    clearTimeout(session.timer);
    if (session.state !== "waiting") return;
    session.state = code === 0 && grokLoggedIn().loggedIn ? "done" : "error";
    if (session.state === "error") session.error = "Đăng nhập Grok chưa hoàn tất. Thử lại hoặc dán XAI_API_KEY.";
    onUpdate?.();
  });
  return grokInfo();
}

export function cancelGrokLogin(onUpdate?: () => void) {
  if (activeLogin?.state === "waiting") {
    activeLogin.state = "cancelled";
    clearTimeout(activeLogin.timer);
    stopGrok(activeLogin.child);
    onUpdate?.();
  }
  return grokInfo();
}

export function disconnectGrok(onUpdate?: () => void) {
  cancelGrokLogin();
  delete process.env.XAI_API_KEY;
  const authPath = join(grokHome(), "auth.json");
  if (existsSync(authPath)) {
    try { rmSync(authPath, { force: true }); } catch { /* ignore */ }
  }
  activeLogin = null;
  onUpdate?.();
  return grokInfo();
}

export type GrokRunOptions = {
  prompt: string;
  system: string;
  model: string;
  effort?: string;
  jsonSchema?: object;
  imageDir?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  sessionId?: string;
  mcp?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  onStep?: (step: { at: string; kind: "tool" | "text"; text: string; id?: string; ok?: boolean }) => void;
};

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch { /* ignore */ }
  }
  return null;
}

function buildGrokMcpConfig(mcp: GrokRunOptions["mcp"]): string {
  if (!mcp || !Object.keys(mcp).length) return "";
  const lines: string[] = [];
  for (const [name, server] of Object.entries(mcp)) {
    lines.push(`[mcp_servers.${name}]`);
    lines.push(`command = ${JSON.stringify(server.command)}`);
    lines.push(`args = ${JSON.stringify(server.args ?? [])}`);
    lines.push(`enabled = true`);
    lines.push(`startup_timeout_sec = 30`);
    lines.push(`tool_timeout_sec = 120`);
    if (server.env && Object.keys(server.env).length) {
      const pairs = Object.entries(server.env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ");
      lines.push(`env = { ${pairs} }`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function grokFailure(raw: string): AppError {
  if (/not authenticated|unauthorized|401|sign in|login|expired/i.test(raw)) {
    return new AppError("GROK_AUTH", "Grok CLI chưa đăng nhập hoặc hết phiên. Mở Kết nối AI → Grok để đăng nhập hoặc nhập XAI_API_KEY.", 401);
  }
  if (/usage limit|rate.limit|quota|credits|429/i.test(raw)) {
    return new AppError("GROK_QUOTA", "Tài khoản Grok đã đạt hạn mức. Chờ hạn mức khôi phục hoặc đổi sang model/CLI khác.", 429);
  }
  if (/model.*(?:not found|not supported|not available|does not exist)/i.test(raw)) {
    return new AppError("GROK_MODEL", "Model Grok không khả dụng với tài khoản này. Chọn grok-4.6 hoặc grok-4.5.", 400);
  }
  return new AppError("GROK_FAILED", `Grok CLI chưa hoàn tất yêu cầu: ${raw.trim().slice(0, 280) || "Kiểm tra đăng nhập và kết nối mạng"}`, 502);
}

export async function runGrokAgent(opts: GrokRunOptions): Promise<AgentRunResult & { text: string; sessionId?: string }> {
  if (opts.signal?.aborted) throw new AppError("CANCELLED", "Đã dừng lượt gọi AI", 409);
  const base = join(tmpdir(), "taki-grok-runs");
  mkdirSync(base, { recursive: true });
  const work = mkdtempSync(join(base, "run-"));
  const promptFile = join(work, "prompt.md");
  try {
    if (opts.mcp && Object.keys(opts.mcp).length) {
      const grokDir = join(work, ".grok");
      mkdirSync(grokDir, { recursive: true });
      writeFileSync(join(grokDir, "config.toml"), buildGrokMcpConfig(opts.mcp), { mode: 0o600 });
    }
    const schemaInstruction = opts.jsonSchema
      ? `\n\nĐỊNH DẠNG ĐẦU RA BẮT BUỘC: Chỉ trả về DUY NHẤT một đối tượng JSON hợp lệ khớp JSON Schema sau (không kèm markdown \`\`\`json, không giải thích thêm):\n${JSON.stringify(opts.jsonSchema)}`
      : "";
    const fullPrompt = `${opts.system ? `[HƯỚNG DẪN HỆ THỐNG]\n${opts.system}\n\n` : ""}[YÊU CẦU]\n${opts.prompt}${schemaInstruction}`;
    writeFileSync(promptFile, fullPrompt, "utf8");

    const cmd = grokCommand();
    const hasMcp = Boolean(opts.mcp && Object.keys(opts.mcp).length);
    const modelArg = opts.model && opts.model !== "default" ? ["-m", opts.model] : ["-m", "grok-4.6"];
    const args = [
      ...cmd.args,
      "--prompt-file", promptFile,
      ...modelArg,
      "--output-format", hasMcp ? "streaming-messages-json" : "json",
      ...(hasMcp ? ["--include-partial-messages", "--always-approve", "--permission-mode", "bypassPermissions"] : ["--permission-mode", "dontAsk"]),
      ...(hasMcp ? [] : opts.imageDir ? ["--tools", "read_file", "--allow", "Read"] : ["--tools", ""]),
      ...(opts.effort ? ["--reasoning-effort", opts.effort] : []),
      "--no-plan",
      "--no-subagents",
      "--disable-web-search",
      "--no-leader",
      "--cwd", work,
    ];
    const start = Date.now();
    return await new Promise((done, reject) => {
      const child = spawn(cmd.bin, args, { cwd: work, env: grokEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let buf = "";
      let stopped = false;
      const parts: string[] = [];
      let streamed = false;
      let finalText = "";
      let sessionId = opts.sessionId;
      let usage = { input: 0, output: 0, cached: 0 };
      let costMicros = 0;

      const cancel = () => { stopped = true; stopGrok(child); };
      const timer = setTimeout(cancel, opts.timeoutMs ?? 240_000);
      opts.signal?.addEventListener("abort", cancel, { once: true });

      const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let ev: any;
        try { ev = JSON.parse(trimmed); } catch { return; }
        if (typeof ev.sessionId === "string") sessionId = ev.sessionId;
        if (typeof ev.text === "string" && ev.stopReason) finalText = ev.text;
        if (ev.type === "text" && typeof ev.data === "string") {
          streamed = true;
          if (!parts.length) parts.push("");
          parts[parts.length - 1] += ev.data;
          opts.onStep?.({ at: new Date().toISOString(), kind: "text", text: parts.join("\n\n") });
        } else if (ev.type === "stream_event") {
          const e = ev.event;
          if (e?.type === "content_block_start" && e.content_block?.type === "text") { streamed = true; parts.push(""); }
          else if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
            if (!parts.length) parts.push("");
            parts[parts.length - 1] += e.delta.text;
            opts.onStep?.({ at: new Date().toISOString(), kind: "text", text: parts.filter((p) => p.trim()).join("\n\n") });
          }
        } else if (ev.type === "assistant") {
          for (const c of ev.message?.content ?? []) {
            if (c.type === "tool_use") {
              const tName = String(c.name ?? "").replace(/^(?:mcp__taki__|taki__)/, "");
              opts.onStep?.({ at: new Date().toISOString(), kind: "tool", text: tName, id: c.id });
            } else if (c.type === "text" && !streamed && c.text?.trim()) {
              parts.push(c.text);
              opts.onStep?.({ at: new Date().toISOString(), kind: "text", text: parts.filter((p) => p.trim()).join("\n\n") });
            }
          }
        } else if (ev.type === "result") {
          if (typeof ev.result === "string" && !finalText) finalText = ev.result;
          const u = ev.usage ?? {};
          usage = {
            input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            output: u.output_tokens ?? 0,
            cached: u.cache_read_input_tokens ?? 0,
          };
          costMicros = Math.round((ev.total_cost_usd ?? 0) * 1e6);
        }
      };

      child.stdout.on("data", (d) => {
        out += d;
        buf += d;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          consumeLine(line);
        }
      });
      child.stderr.on("data", (d) => { err = (err + d).slice(-16_000); });
      const clean = () => { clearTimeout(timer); opts.signal?.removeEventListener("abort", cancel); };
      child.once("error", () => { clean(); reject(new AppError("GROK_MISSING", "Không chạy được Grok CLI. Cài @xai-official/grok hoặc kiểm tra GROK_CLI_PATH.", 503)); });
      child.once("close", (code) => {
        clean();
        if (buf.trim()) consumeLine(buf);
        if (stopped) return reject(new AppError(opts.signal?.aborted ? "CANCELLED" : "GROK_TIMEOUT", opts.signal?.aborted ? "Đã dừng lượt gọi AI" : "Grok phản hồi quá thời gian cho phép", 408));
        if (!finalText && out.trim()) {
          try {
            const parsedOut = JSON.parse(out.trim());
            if (typeof parsedOut?.text === "string") finalText = parsedOut.text;
            else if (typeof parsedOut?.result === "string") finalText = parsedOut.result;
          } catch { /* streaming lines already consumed */ }
        }
        const text = (parts.filter((p) => p.trim()).join("\n\n") || finalText || out.trim()).trim();
        if (code !== 0 && !text) return reject(grokFailure(`${err}\n${out}`));
        if (!text) return reject(grokFailure(err || "Grok không trả về nội dung"));
        const structured = opts.jsonSchema ? extractJsonObject(text) : text;
        done({ text, structured, model: opts.model || "grok-4.6", usage, costMicros, durationMs: Date.now() - start, turns: 1, denials: [], sessionId });
      });
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const runGrokCli = (opts: GrokRunOptions): Promise<CliResult> => runGrokAgent(opts);

