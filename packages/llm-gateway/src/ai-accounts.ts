import { execFile, execFileSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { audit, bizSettings, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { AppError, sha256 } from "@dotaka/shared";
import { codexEnv, codexInfo, codexLoginStatus, spawnCodexLogin, stopCodex } from "./codex.ts";

type Login = { child: ChildProcess; state: "waiting" | "done" | "error" | "cancelled"; method: "browser" | "device"; url?: string; code?: string; error?: string; expiresAt: string; timer?: NodeJS.Timeout; closed?: boolean };
const logins = new Map<string, Login>();
const active = new Map<string, Set<AbortController>>();
const tails = new Map<string, Promise<void>>();
process.once("exit", () => { for (const session of logins.values()) if (session.state === "waiting") stopCodex(session.child); });
function privateHome(home: string) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    try {
      const owner = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true, timeout: 5000 }).trim();
      execFileSync("icacls.exe", [home, "/inheritance:r", "/grant:r", `${owner}:(OI)(CI)F`], { windowsHide: true, timeout: 10_000, stdio: "pipe" });
    } catch { throw new AppError("PROFILE_PERMISSIONS", "Chưa bảo vệ được thư mục phiên ChatGPT cho người dùng Windows hiện tại. Kiểm tra quyền ghi của thư mục dữ liệu.", 503); }
  } else chmodSync(home, 0o700);
}
export function mustAiAccount(bizId: string, id: string): Row {
  const row = byId<Row>("ai_account", id);
  if (!row || row.biz_id !== bizId || row.provider !== "codex_cli") throw new AppError("NOT_FOUND", "Không thấy hồ sơ ChatGPT của doanh nghiệp này", 404);
  return row;
}
export function aiAccountHome(bizId: string, id: string) {
  mustAiAccount(bizId, id);
  return join(resolve(process.env.AI_ACCOUNTS_DIR ?? "data/ai-accounts"), sha256(`${bizId}:${id}`));
}

/** Local identity for display only. JWT claims are not proof of account entitlement; a real model test checks that. */
export function codexIdentity(home: string): { loggedIn: boolean; email?: string; plan?: string } {
  try {
    const auth = JSON.parse(readFileSync(join(home, "auth.json"), "utf8"));
    if ((auth.auth_mode && auth.auth_mode !== "chatgpt") || auth.OPENAI_API_KEY || !auth.tokens?.access_token || !auth.tokens?.refresh_token || !auth.tokens?.id_token) return { loggedIn: false };
    const claims = JSON.parse(Buffer.from(auth.tokens.id_token.split(".")[1], "base64url").toString("utf8"));
    const plan = claims["https://api.openai.com/auth"]?.chatgpt_plan_type;
    return { loggedIn: true, ...(typeof claims.email === "string" ? { email: claims.email.slice(0, 254) } : {}), ...(typeof plan === "string" ? { plan: plan.slice(0, 50) } : {}) };
  } catch { return { loggedIn: false }; }
}

export function publicAiAccount(row: Row, includeLogin = true) {
  const home = aiAccountHome(row.biz_id, row.id);
  const session = logins.get(row.id);
  // A server restart cannot leave a UI spinner waiting on a login process we no longer manage.
  return { id: row.id, provider: row.provider, name: row.name, createdAt: row.created_at, ...codexIdentity(home),
    running: active.get(row.id)?.size ?? 0,
    login: session ? { state: session.state, method: session.method, ...(includeLogin ? { url: session.url, code: session.code } : {}), error: session.error, expiresAt: session.expiresAt } : null };
}
export function listAiAccounts(bizId: string, includeLogin = true) {
  return q.all<Row>("SELECT * FROM ai_account WHERE biz_id = ? AND provider = 'codex_cli' ORDER BY created_at", bizId).map((r) => publicAiAccount(r, includeLogin));
}
export function createAiAccount(bizId: string, name: string, actor: string) {
  const row = insert("ai_account", { biz_id: bizId, provider: "codex_cli", name: name.trim() });
  privateHome(aiAccountHome(bizId, row.id));
  audit(bizId, actor, "ai.account_created", { type: "ai_account", id: row.id }, { provider: "codex_cli", name: row.name });
  emit(bizId, "llm.updated", {});
  return publicAiAccount(row);
}
export function selectedAiAccount(bizId: string) {
  const id = (bizSettings(bizId) as any).llm?.codexAccountId;
  if (typeof id !== "string" || !id) return null;
  try { return publicAiAccount(mustAiAccount(bizId, id), false); } catch { return null; }
}

export function parseLoginOutput(output: string): { url?: string; code?: string } {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  let url: string | undefined;
  for (const match of clean.matchAll(/https:\/\/[^\s<>"']+/g)) {
    try {
      const u = new URL(match[0]);
      if (["auth.openai.com", "chatgpt.com"].includes(u.hostname) && !u.username && !u.password) { url = u.toString(); break; }
    } catch { /* incomplete chunk */ }
  }
  const code = clean.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0];
  return { ...(url ? { url } : {}), ...(code ? { code } : {}) };
}

function idle(id: string) {
  if (active.get(id)?.size) throw new AppError("ACCOUNT_BUSY", "Hồ sơ đang chạy tác vụ. Dừng hoặc chờ tác vụ xong trước khi đăng nhập lại hay ngắt kết nối.", 409);
}
export async function cancelAiLogin(bizId: string, id: string) {
  mustAiAccount(bizId, id);
  const session = logins.get(id);
  if (session?.state === "waiting") {
    session.state = "cancelled"; session.url = undefined; session.code = undefined; clearTimeout(session.timer);
    const closed = new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new AppError("LOGIN_STOP_FAILED", "Chưa dừng được tiến trình đăng nhập. Chờ tiến trình đóng rồi thử lại.", 409)), 10_000);
      session.child.once("close", () => { clearTimeout(timer); done(); });
    });
    stopCodex(session.child); await closed; emit(bizId, "llm.updated", {});
  }
  return publicAiAccount(mustAiAccount(bizId, id));
}
export function startAiLogin(bizId: string, id: string, method: "browser" | "device", actor: string) {
  const row = mustAiAccount(bizId, id);
  idle(id);
  if (!codexInfo().available) throw new AppError("CODEX_MISSING", "Chưa cài Codex CLI. Chạy npm install -g @openai/codex trên máy chạy hệ thống.", 503);
  if ([...logins.values()].some((s) => s.state === "waiting" || !s.closed && !!s.child.pid)) throw new AppError("LOGIN_BUSY", "Đang chờ đăng nhập một hồ sơ ChatGPT. Hoàn tất hoặc hủy lượt đó trước.", 409);
  const home = aiAccountHome(bizId, id);
  privateHome(home);
  const child = spawnCodexLogin(home, method);
  const session: Login = { child, method, state: "waiting", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
  logins.set(id, session);
  let output = "";
  const consume = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-24_000); const parsed = parseLoginOutput(output); const changed = (parsed.url && parsed.url !== session.url) || (parsed.code && parsed.code !== session.code); Object.assign(session, parsed); if (changed) emit(bizId, "llm.updated", {}); };
  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);
  session.timer = setTimeout(() => { session.state = "error"; session.error = "Lượt đăng nhập đã hết thời gian. Bấm đăng nhập lại."; stopCodex(child); emit(bizId, "llm.updated", {}); }, 10 * 60_000);
  child.once("error", () => { clearTimeout(session.timer); session.state = "error"; session.error = "Không khởi động được Codex CLI. Kiểm tra cài đặt trên máy."; emit(bizId, "llm.updated", {}); });
  child.once("close", (code) => {
    session.closed = true;
    clearTimeout(session.timer);
    if (session.state !== "waiting") return;
    session.state = code === 0 && codexIdentity(home).loggedIn ? "done" : "error";
    session.code = undefined; session.url = undefined;
    if (session.state === "done") { try { chmodSync(join(home, "auth.json"), 0o600); } catch { /* OS handles permissions */ } }
    else session.error = method === "device" ? "Đăng nhập chưa thành công. Kiểm tra quyền đăng nhập bằng mã thiết bị trong ChatGPT hoặc dùng đăng nhập trình duyệt." : "Đăng nhập chưa thành công. Hủy rồi thử lại hoặc chọn đăng nhập bằng mã thiết bị.";
    audit(bizId, actor, `ai.login_${session.state}`, { type: "ai_account", id }, { method });
    emit(bizId, "llm.updated", {});
  });
  audit(bizId, actor, "ai.login_started", { type: "ai_account", id }, { method });
  emit(bizId, "llm.updated", {});
  return publicAiAccount(row);
}
export async function checkAiAccount(bizId: string, id: string) {
  const row = mustAiAccount(bizId, id);
  const home = aiAccountHome(bizId, id);
  const local = codexIdentity(home);
  const ok = local.loggedIn && codexInfo().available && await codexLoginStatus(home);
  return { ...publicAiAccount(row), loggedIn: ok };
}
export async function disconnectAiAccount(bizId: string, id: string, actor: string) {
  mustAiAccount(bizId, id); idle(id); await cancelAiLogin(bizId, id);
  const home = aiAccountHome(bizId, id);
  // Use the official logout operation in this profile only; never touch ~/.codex or other accounts.
  if (existsSync(join(home, "auth.json"))) {
    const { codexCommand } = await import("./codex.ts");
    const cmd = codexCommand();
    await new Promise<void>((done, reject) => execFile(cmd.bin, [...cmd.args, "-c", 'cli_auth_credentials_store="file"', "logout"], { cwd: home, env: codexEnv(home), timeout: 10_000, windowsHide: true }, (e) => e ? reject(new AppError("LOGOUT_FAILED", "Chưa đăng xuất được hồ sơ ChatGPT. Kiểm tra CLI rồi thử lại.", 502)) : done()));
  }
  logins.delete(id);
  audit(bizId, actor, "ai.account_disconnected", { type: "ai_account", id }, {});
  emit(bizId, "llm.updated", {});
  return publicAiAccount(mustAiAccount(bizId, id));
}
export async function removeAiAccount(bizId: string, id: string, actor: string) {
  await disconnectAiAccount(bizId, id, actor);
  const s = bizSettings(bizId) as any;
  if (s.llm?.codexAccountId === id) update("biz", bizId, { settings: { ...s, llm: { ...s.llm, codexAccountId: null } } });
  q.run("DELETE FROM ai_account WHERE id = ? AND biz_id = ?", id, bizId);
  audit(bizId, actor, "ai.account_removed", { type: "ai_account", id }, {});
  emit(bizId, "llm.updated", {});
  return { ok: true };
}
/** Keep a captured account for the entire call; switching defaults never moves an in-flight task to another account. */
export async function withAiAccount<T>(bizId: string, id: string, work: (home: string, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const home = aiAccountHome(bizId, id);
  if (logins.get(id)?.state === "waiting") throw new AppError("LOGIN_BUSY", "Hồ sơ đang đăng nhập, chờ hoàn tất trước khi gọi AI", 409);
  if (!codexIdentity(home).loggedIn) throw new AppError("CODEX_AUTH", "Hồ sơ ChatGPT chưa đăng nhập. Mở Kết nối AI để đăng nhập.", 401);
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort(); else signal?.addEventListener("abort", abort, { once: true });
  const set = active.get(id) ?? new Set<AbortController>();
  set.add(ctrl); active.set(id, set);
  const previous = tails.get(id) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((r) => { release = r; });
  tails.set(id, tail);
  try {
    await previous;
    if (ctrl.signal.aborted) throw new AppError("CANCELLED", "Đã dừng lượt gọi AI", 409);
    return await work(home, ctrl.signal);
  } finally { release(); if (tails.get(id) === tail) tails.delete(id); set.delete(ctrl); if (!set.size) active.delete(id); signal?.removeEventListener("abort", abort); }
}
