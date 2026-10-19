import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { AppError } from "@dotaka/shared";
import type { AgentRunResult, CliResult } from "./cli.ts";

export function geminiHome(): string {
  return process.env.GEMINI_HOME?.trim() || join(homedir(), ".gemini");
}

export function geminiCommand(): { bin: string; args: string[] } {
  const configured = process.env.GEMINI_CLI_PATH?.trim() || undefined;
  if (configured && /\.(?:c?m?js)$/i.test(configured)) return { bin: process.execPath, args: [configured] };
  if (configured && !/\.(?:cmd|ps1|bat)$/i.test(configured) && existsSync(configured)) return { bin: configured, args: [] };

  const dirs = [
    ...(configured ? [dirname(configured)] : []),
    ...(process.env.PATH ?? "").split(delimiter),
    ...(process.env.APPDATA ? [join(process.env.APPDATA, "npm")] : []),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const bundle = join(dir, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
    if (existsSync(bundle)) return { bin: process.execPath, args: [bundle] };
    const dist = join(dir, "node_modules", "@google", "gemini-cli", "dist", "index.js");
    if (existsSync(dist)) return { bin: process.execPath, args: [dist] };
  }
  return { bin: configured ?? "gemini", args: [] };
}

export function geminiEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDECODE;
  return { ...env, GEMINI_CLI_TRUST_WORKSPACE: "true" };
}

export function stopGemini(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
  } else child.kill("SIGTERM");
}

export function geminiLoggedIn(): { loggedIn: boolean; authMode?: "api_key" | "oauth"; detail?: string } {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
  if (apiKey) return { loggedIn: true, authMode: "api_key", detail: `API Key (${apiKey.slice(0, 6)}…)` };
  const oauthPath = join(geminiHome(), "oauth_creds.json");
  if (existsSync(oauthPath)) {
    try {
      const creds = JSON.parse(readFileSync(oauthPath, "utf8"));
      if (creds.access_token || creds.refresh_token) {
        let email: string | undefined;
        try {
          const accts = JSON.parse(readFileSync(join(geminiHome(), "google_accounts.json"), "utf8"));
          email = accts.active;
        } catch { /* ignore */ }
        return { loggedIn: true, authMode: "oauth", detail: email ?? "Tài khoản Google (OAuth)" };
      }
    } catch { /* ignore */ }
  }
  return { loggedIn: false };
}

let cachedInfo: { available: boolean; version?: string; checkedAt: number } | null = null;
export function geminiInfo() {
  if (!cachedInfo || Date.now() - cachedInfo.checkedAt > 30_000) {
    const cmd = geminiCommand();
    let found = false;
    if (cmd.args[0] && existsSync(cmd.args[0])) {
      try {
        const pkgPath = join(dirname(dirname(cmd.args[0])), "package.json");
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
          cachedInfo = { available: true, version: pkg.version ?? "installed", checkedAt: Date.now() };
          found = true;
        }
      } catch { /* fall through */ }
    }
    if (!found) {
      try {
        const version = execFileSync(cmd.bin, [...cmd.args, "--version"], { encoding: "utf8", timeout: 2_500, env: geminiEnv(), windowsHide: true }).trim().split("\n").at(-1)?.trim();
        cachedInfo = { available: true, version, checkedAt: Date.now() };
      } catch {
        cachedInfo = { available: false, checkedAt: Date.now() };
      }
    }
  }
  const info = cachedInfo!;
  const auth = geminiLoggedIn();
  const loggedIn = info.available ? auth.loggedIn : false;
  return {
    ...info,
    loggedIn,
    authMode: auth.authMode ?? null,
    authMethod: auth.authMode ?? null,
    authDetail: auth.detail ?? null,
    authError: !info.available ? "Chưa cài Gemini CLI" : !loggedIn ? "Gemini CLI chưa đăng nhập (chạy `gemini` hoặc nhập GEMINI_API_KEY)" : undefined,
  };
}

export type GeminiRunOptions = {
  prompt: string;
  system: string;
  model: string;
  jsonSchema?: object;
  timeoutMs?: number;
  signal?: AbortSignal;
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

export async function runGeminiAgent(opts: GeminiRunOptions): Promise<AgentRunResult & { text: string }> {
  if (opts.signal?.aborted) throw new AppError("CANCELLED", "Đã dừng lượt gọi AI", 409);
  const base = join(tmpdir(), "taki-gemini-runs");
  mkdirSync(base, { recursive: true });
  const work = mkdtempSync(join(base, "run-"));
  try {
    if (opts.mcp && Object.keys(opts.mcp).length) {
      const geminiDir = join(work, ".gemini");
      mkdirSync(geminiDir, { recursive: true });
      writeFileSync(join(geminiDir, "settings.json"), JSON.stringify({ mcpServers: opts.mcp }), { mode: 0o600 });
    }
    const schemaInstruction = opts.jsonSchema
      ? `\n\nĐỊNH DẠNG ĐẦU RA BẮT BUỘC: Chỉ trả về DUY NHẤT một đối tượng JSON hợp lệ khớp JSON Schema sau (không markdown, không giải thích thêm):\n${JSON.stringify(opts.jsonSchema)}`
      : "";
    const fullPrompt = `${opts.system ? `[HƯỚNG DẪN HỆ THỐNG]\n${opts.system}\n\n` : ""}[YÊU CẦU]\n${opts.prompt}${schemaInstruction}`;

    const cmd = geminiCommand();
    const model = opts.model && opts.model !== "default" ? opts.model : "gemini-2.5-flash";
    const args = [...cmd.args, "-p", "Thực hiện yêu cầu trong stdin.", "-m", model, "-o", "json", "--yolo", "--skip-trust"];
    const start = Date.now();
    return await new Promise((done, reject) => {
      const child = spawn(cmd.bin, args, { cwd: work, env: geminiEnv(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let stopped = false;
      const cancel = () => { stopped = true; stopGemini(child); };
      const timer = setTimeout(cancel, opts.timeoutMs ?? 180_000);
      opts.signal?.addEventListener("abort", cancel, { once: true });

      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err = (err + d).slice(-16_000); });
      const clean = () => { clearTimeout(timer); opts.signal?.removeEventListener("abort", cancel); };
      child.once("error", () => { clean(); reject(new AppError("GEMINI_MISSING", "Không chạy được Gemini CLI. Cài @google/gemini-cli hoặc kiểm tra GEMINI_CLI_PATH.", 503)); });
      child.once("close", (code) => {
        clean();
        if (stopped) return reject(new AppError(opts.signal?.aborted ? "CANCELLED" : "GEMINI_TIMEOUT", opts.signal?.aborted ? "Đã dừng lượt gọi AI" : "Gemini phản hồi quá thời gian cho phép", 408));
        let text = out.trim();
        let usage = { input: 0, output: 0, cached: 0 };
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed?.response === "string") text = parsed.response.trim();
          else if (typeof parsed?.text === "string") text = parsed.text.trim();
          if (parsed?.stats?.models) {
            for (const m of Object.values<any>(parsed.stats.models)) {
              usage.input += m?.tokens?.prompt ?? 0;
              usage.output += m?.tokens?.candidates ?? 0;
              usage.cached += m?.tokens?.cached ?? 0;
            }
          }
        } catch { /* plain text fallback */ }
        if (code !== 0 || !text) {
          const rawErr = `${err}\n${out}`.trim();
          if (/IneligibleTierError|UNSUPPORTED_CLIENT/i.test(rawErr)) {
            return reject(new AppError("GEMINI_AUTH", "Gemini CLI yêu cầu GEMINI_API_KEY (từ Google AI Studio) hoặc tài khoản Workspace. Hãy dán GEMINI_API_KEY trong Kết nối AI → Gemini.", 401));
          }
          return reject(new AppError("GEMINI_FAILED", `Gemini CLI lỗi: ${rawErr.slice(0, 280) || "Không có phản hồi"}`, 502));
        }
        opts.onStep?.({ at: new Date().toISOString(), kind: "text", text });
        const structured = opts.jsonSchema ? extractJsonObject(text) : text;
        done({ text, structured, model, usage, costMicros: 0, durationMs: Date.now() - start, turns: 1, denials: [] });
      });
      child.stdin.on("error", () => { /* ignore EPIPE */ });
      child.stdin.end(fullPrompt);
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const runGeminiCli = (opts: GeminiRunOptions): Promise<CliResult> => runGeminiAgent(opts);

