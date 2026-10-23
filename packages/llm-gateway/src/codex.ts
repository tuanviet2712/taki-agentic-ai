import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { AppError } from "@dotaka/shared";
import type { AgentRunResult, CliResult } from "./cli.ts";

/** Resolve npm's JS launcher directly on Windows: spawning .cmd with shell:false does not work. */
export function codexCommand(): { bin: string; args: string[] } {
  const configured = process.env.CODEX_CLI_PATH?.trim() || undefined;
  if (configured && /\.(?:c?m?js)$/i.test(configured)) return { bin: process.execPath, args: [configured] };
  if (configured && !/\.(?:cmd|ps1|bat)$/i.test(configured)) return { bin: configured, args: [] };
  if (process.platform === "win32" || configured) {
    const dirs = [...(configured ? [dirname(configured)] : []), ...(process.env.PATH ?? "").split(delimiter), ...(process.env.APPDATA ? [join(process.env.APPDATA, "npm")] : [])];
    for (const dir of dirs) {
      const launcher = join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (existsSync(launcher)) return { bin: process.execPath, args: [launcher] };
      const exe = join(dir, "codex.exe");
      if (existsSync(exe)) return { bin: exe, args: [] };
    }
  }
  return { bin: configured ?? "codex", args: [] };
}

/** Never inherit this app's/desktop's active account or an API key. Only the explicitly selected profile. */
export function codexEnv(home: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(OPENAI|CODEX|CHATGPT|ANTHROPIC|CLAUDE)/i.test(key)) delete env[key];
  return { ...env, CODEX_HOME: home };
}

let info: { available: boolean; version?: string; checkedAt: number } | undefined;
export function codexInfo() {
  if (!info || Date.now() - info.checkedAt > 60_000) {
    const cmd = codexCommand();
    // Nhanh, không chạy lệnh: có tệp khởi chạy của npm thì đọc phiên bản ngay từ package.json (như Gemini). `codex --version` chạy
    // ĐỒNG BỘ (chặn cả máy chủ) và mất ~4 giây lúc nguội — máy bận thì quá 10 giây và bị báo nhầm "chưa cài Codex".
    const launcher = cmd.args[0] && existsSync(cmd.args[0]) ? cmd.args[0] : null;
    if (launcher) {
      try {
        const pkg = JSON.parse(readFileSync(join(dirname(dirname(launcher)), "package.json"), "utf8"));
        info = { available: true, version: `codex-cli ${pkg.version ?? "đã cài"}`, checkedAt: Date.now() };
        return info;
      } catch { /* không đọc được package.json → hỏi bằng lệnh bên dưới */ }
    }
    try {
      const version = execFileSync(cmd.bin, [...cmd.args, "--version"], { encoding: "utf8", timeout: 10_000, windowsHide: true }).trim();
      info = { available: true, version, checkedAt: Date.now() };
    } catch {
      // Quá giờ / lỗi tạm khi máy đang bận không có nghĩa là CLI biến mất: nếu lần trước dùng được thì giữ nguyên kết quả đó,
      // và (chưa từng thấy) thì hỏi lại sau ~30 giây thay vì ghi nhớ "chưa cài" cả phút làm mọi lượt gọi ChatGPT báo sai.
      info = info?.available ? { ...info, checkedAt: Date.now() } : { available: false, checkedAt: Date.now() - 30_000 };
    }
  }
  return info;
}

const AUTH_CONFIG = ["-c", 'cli_auth_credentials_store="file"', "-c", 'forced_login_method="chatgpt"'];
export function spawnCodexLogin(home: string, method: "browser" | "device") {
  const cmd = codexCommand();
  return spawn(cmd.bin, [...cmd.args, ...AUTH_CONFIG, "login", ...(method === "device" ? ["--device-auth"] : [])], {
    cwd: home, env: codexEnv(home), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function codexLoginStatus(home: string): Promise<boolean> {
  const cmd = codexCommand();
  return new Promise((done) => {
    const child = spawn(cmd.bin, [...cmd.args, ...AUTH_CONFIG, "login", "status"], { cwd: home, env: codexEnv(home), windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => { stopCodex(child); done(false); }, 10_000);
    child.once("error", () => { clearTimeout(timer); done(false); });
    child.once("close", (code) => { clearTimeout(timer); done(code === 0); });
  });
}

export function stopCodex(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
  } else child.kill("SIGTERM");
}

export type CodexRunOptions = {
  home: string; prompt: string; system: string; model: string; effort?: string;
  jsonSchema?: object; images?: string[]; timeoutMs?: number; signal?: AbortSignal;
  mcp?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  onStep?: (step: { at: string; kind: "tool" | "text"; text: string }) => void;
  /** Bật công cụ tạo ảnh của Codex (ChatGPT). Ảnh ra ở `<home>/generated_images/<thread>/` — xem runCodexImage. */
  imageGeneration?: boolean;
};

// Runs live in a scratch folder outside the repo and outside the credentials folder.
// Only this folder's AGENTS.md/config is visible as instructions, never the user's personal Codex config/plugins.
export function codexRunConfig(opts: CodexRunOptions): string {
  const lines = ['cli_auth_credentials_store = "file"', 'forced_login_method = "chatgpt"', 'approval_policy = "never"', 'sandbox_mode = "read-only"', 'web_search = "disabled"', 'model_provider = "openai"',
    `developer_instructions = ${JSON.stringify(opts.system)}`, `model_reasoning_effort = ${JSON.stringify(opts.effort ?? "medium")}`,
    '[features]', 'shell_tool = false', 'unified_exec = false', 'apps = false', 'plugins = false', 'hooks = false', 'multi_agent = false', 'multi_agent_v2 = false', 'browser_use = false', 'computer_use = false', `image_generation = ${opts.imageGeneration ? "true" : "false"}`];
  for (const [name, server] of Object.entries(opts.mcp ?? {})) {
    if (!/^[a-z][a-z0-9_]*$/i.test(name)) throw new AppError("BAD_MCP", "Tên công cụ AI không hợp lệ");
    lines.push(`[mcp_servers.${name}]`, `command = ${JSON.stringify(server.command)}`, `args = ${JSON.stringify(server.args ?? [])}`, 'required = true', 'default_tools_approval_mode = "auto"', 'startup_timeout_sec = 30', 'tool_timeout_sec = 120');
    if (server.env) {
      lines.push(`[mcp_servers.${name}.env]`);
      for (const [k, v] of Object.entries(server.env)) lines.push(`${JSON.stringify(k)} = ${JSON.stringify(v)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** JSONL parsing tolerates non-JSON progress lines and requires turn.completed for success. */
export function codexEvent(line: string): any | null {
  try { return JSON.parse(line); } catch { return null; }
}
export function codexFailure(raw: string): AppError {
  if (/usage limit|rate.limit|quota|credits|weekly limit/i.test(raw)) return new AppError("CODEX_QUOTA", "Tài khoản ChatGPT đã đạt hạn mức. Chờ hạn mức khôi phục hoặc chọn hồ sơ khác đã đăng nhập.", 429);
  if (/unauthorized|401|expired|not logged|sign in|authentication|refresh.token/i.test(raw)) return new AppError("CODEX_AUTH", "Phiên ChatGPT hết hạn. Đăng nhập lại đúng hồ sơ trong Kết nối AI.", 401);
  if (/model.*(?:not found|not supported|not available|access|does not exist)/i.test(raw)) return new AppError("CODEX_MODEL", "Model không khả dụng với tài khoản ChatGPT này. Chọn Model mặc định hoặc model được tài khoản hỗ trợ.", 400);
  return new AppError("CODEX_FAILED", "Codex CLI chưa hoàn tất yêu cầu. Kiểm tra kết nối mạng, hồ sơ ChatGPT và model rồi thử lại.", 502);
}

export async function runCodexAgent(opts: CodexRunOptions): Promise<AgentRunResult & { text: string; threadId?: string }> {
  if (opts.signal?.aborted) throw new AppError("CANCELLED", "Đã dừng lượt gọi AI", 409);
  const base = join(tmpdir(), "taki-codex-runs");
  mkdirSync(base, { recursive: true });
  const work = mkdtempSync(join(base, "run-"));
  const profile = `taki-${process.pid}-${work.split(/[\\/]/).at(-1)}`;
  const configFile = join(opts.home, `${profile}.config.toml`);
  const finalFile = join(work, "reply.txt");
  try {
    writeFileSync(configFile, codexRunConfig(opts), { mode: 0o600 });
    const cmd = codexCommand();
    const args = [...cmd.args, "--config", `project_doc_max_bytes=0`, "exec", "--ignore-user-config", "--ignore-rules", "--profile", profile, "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--json", "--color", "never", "--cd", work, "--output-last-message", finalFile,
      ...(opts.model !== "default" ? ["--model", opts.model] : []), ...(opts.images ?? []).flatMap((p) => ["--image", resolve(p)]), "-"];
    const start = Date.now();
    return await new Promise((done, reject) => {
      const child = spawn(cmd.bin, args, { cwd: work, env: codexEnv(opts.home), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let buffered = "", error = "", completed = false, failed = false, stopped = false, text = "", model = opts.model, threadId: string | undefined;
      let usage = { input: 0, output: 0, cached: 0 };
      const cancel = () => { stopped = true; stopCodex(child); };
      const timer = setTimeout(cancel, opts.timeoutMs ?? 180_000);
      opts.signal?.addEventListener("abort", cancel, { once: true });
      const consume = (line: string) => {
        const e = codexEvent(line);
        if (!e) return;
        if (e.type === "thread.started" && typeof e.thread_id === "string") threadId = e.thread_id;
        if (e.type === "turn.completed") { completed = true; usage = { input: e.usage?.input_tokens ?? 0, output: e.usage?.output_tokens ?? 0, cached: e.usage?.cached_input_tokens ?? 0 }; }
        if (e.type === "turn.failed") failed = true;
        if (e.type === "turn.failed" || e.type === "error") error += `\n${e.error?.message ?? e.message ?? ""}`;
        if (typeof e.model === "string") model = e.model;
        const item = e.item;
        if (e.type === "item.completed" && item?.type === "agent_message") { text = item.text ?? ""; opts.onStep?.({ at: new Date().toISOString(), kind: "text", text }); }
        if (e.type === "item.started" && item?.type === "mcp_tool_call") opts.onStep?.({ at: new Date().toISOString(), kind: "tool", text: `${item.server}.${item.tool}` });
      };
      child.stdout.on("data", (data) => { buffered += data; const lines = buffered.split("\n"); buffered = lines.pop() ?? ""; for (const line of lines) consume(line); });
      child.stderr.on("data", (data) => { error = (error + data).slice(-16_000); });
      const clean = () => { clearTimeout(timer); opts.signal?.removeEventListener("abort", cancel); };
      child.once("error", () => { clean(); reject(new AppError("CODEX_MISSING", "Không chạy được Codex CLI. Cài @openai/codex hoặc kiểm tra CODEX_CLI_PATH.", 503)); });
      child.once("close", (code) => {
        clean(); consume(buffered);
        if (stopped) return reject(new AppError(opts.signal?.aborted ? "CANCELLED" : "CODEX_TIMEOUT", opts.signal?.aborted ? "Đã dừng lượt gọi AI" : "ChatGPT phản hồi quá thời gian cho phép", 408));
        if (code !== 0 || failed || !completed) return reject(codexFailure(error));
        if (existsSync(finalFile)) text = readFileSync(finalFile, "utf8").trim();
        if (!text) return reject(new AppError("CODEX_EMPTY", "ChatGPT không trả nội dung", 502));
        let structured: unknown = text;
        if (opts.jsonSchema) { try { structured = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { structured = null; } }
        done({ text, structured, model, usage, costMicros: 0, durationMs: Date.now() - start, turns: 1, denials: [], threadId });
      });
      child.stdin.on("error", () => { /* Early CLI failure is handled by close, not EPIPE. */ });
      child.stdin.end(`${opts.prompt}${opts.jsonSchema ? `\n\nChỉ trả về một JSON đúng schema sau, không markdown:\n${JSON.stringify(opts.jsonSchema)}` : ""}`);
    });
  } finally {
    rmSync(configFile, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}
export const runCodexCli = (opts: CodexRunOptions): Promise<CliResult> => runCodexAgent(opts);

/** Thư mục Codex lưu ảnh của 1 lượt chạy (tên thư mục = thread id; chỉ nhận id dạng uuid để không thoát khỏi thư mục hồ sơ). */
export function codexImageDir(home: string, threadId: string): string | null {
  return /^[0-9a-f-]{16,64}$/i.test(threadId) ? join(home, "generated_images", threadId) : null;
}
/**
 * Tạo 1 ảnh bằng công cụ tạo ảnh của ChatGPT (Codex CLI, tính năng image_generation) rồi chép ra `outFile`.
 * Codex tự lưu ảnh vào `<home>/generated_images/<thread>/…png`; lấy ảnh mới nhất của đúng lượt này, xong dọn thư mục đó.
 */
export async function runCodexImage(opts: Omit<CodexRunOptions, "jsonSchema" | "mcp" | "imageGeneration"> & { outFile: string }): Promise<{ path: string; model: string; usage: { input: number; output: number; cached: number }; durationMs: number }> {
  const { outFile, ...run } = opts;
  const r = await runCodexAgent({ timeoutMs: 6 * 60_000, ...run, imageGeneration: true });
  const dir = r.threadId ? codexImageDir(opts.home, r.threadId) : null;
  try {
    const files = dir && existsSync(dir)
      ? readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
      : [];
    if (!files.length) throw new AppError("CODEX_NO_IMAGE", "ChatGPT không trả về ảnh (tài khoản có thể chưa có quyền tạo ảnh hoặc đã hết lượt tạo ảnh).", 502);
    mkdirSync(dirname(outFile), { recursive: true });
    copyFileSync(files[0].f, outFile);
    return { path: outFile, model: r.model, usage: r.usage, durationMs: r.durationMs };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
