// Luật của bộ duyệt quyền Claude in Chrome (thuần, không I/O ngoài kiểm tra tệp công tắc) — dùng chung cho
// chrome-approver.mjs (tiến trình MCP) và bài kiểm tra. KHÔNG nhập gì từ phần còn lại của hệ thống: tiến trình này
// chạy độc lập dưới `claude`, chỉ cần Node.
//
// Nguyên tắc: TỪ CHỐI MẶC ĐỊNH. Chỉ cho phép
//   1. công cụ Chrome nằm trong danh sách (TOOLS), không phải "mọi mcp__claude-in-chrome__*";
//   2. điều hướng (navigate / tạo tab) CHỈ tới https + máy chủ trong danh sách (HOSTS);
//   3. tải tệp lên (file_upload / upload_image) CHỈ từ thư mục job / data/uploads / data/creative (FILE_ROOTS),
//      không bao giờ .env, CSDL, thư mục hồ sơ Chrome, ~/.claude, ~/.ssh;
//   4. javascript_tool: bật/tắt theo job; script có dấu hiệu rút dữ liệu ra ngoài (fetch, XMLHttpRequest, cookie…) bị từ chối;
//   5. công cụ tệp của Claude (Read/Write/Edit) chỉ trong FILE_ROOTS (lớp dự phòng nếu luật --allowedTools không khớp).
// Còn lại (Bash, WebFetch, công cụ lạ, công cụ Chrome mới…) → từ chối + ghi nhật ký.

import { existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

export const CHROME_PREFIX = "mcp__claude-in-chrome__";

/** Công cụ Chrome được phép (theo tên rút gọn). Danh sách thật của tiện ích: đối chiếu bằng lần chạy thật đầu tiên (nhật ký). */
export const DEFAULT_TOOLS = [
  "list_connected_browsers", "select_browser", "switch_browser", "tabs_context_mcp", "tabs_create_mcp",
  "navigate", "read_page", "get_page_text", "find", "computer", "form_input",
  "file_upload", "upload_image", "javascript_tool", "resize_window", "read_console_messages",
];

/**
 * Máy chủ mặc định được mở (khớp chính xác HOẶC là tên miền con của mục đó). Cấu hình riêng của job thay thế danh sách này.
 * flow.google.com và accounts.google.com chỉ khớp đúng máy chủ đó (không mở cả *.google.com).
 */
export const DEFAULT_HOSTS = ["flow.google.com", "labs.google", "accounts.google.com", "facebook.com", "instagram.com", "tiktok.com"];

/** Công cụ tệp của Claude Code: chỉ trong thư mục cho phép. */
const FILE_TOOLS = ["Read", "Write", "Edit", "NotebookEdit"];
const SEARCH_TOOLS = ["Glob", "Grep"];

/** Dấu hiệu rút dữ liệu / điều hướng ngầm trong script javascript_tool. */
const JS_DENY = [
  [/\bfetch\s*\(/i, "fetch()"], [/XMLHttpRequest/i, "XMLHttpRequest"], [/sendBeacon/i, "sendBeacon"], [/\bWebSocket\b/i, "WebSocket"],
  [/document\s*\.\s*cookie/i, "document.cookie"], [/\b(local|session)Storage\b/i, "localStorage/sessionStorage"], [/indexedDB/i, "indexedDB"],
  [/navigator\s*\.\s*(clipboard|sendBeacon)/i, "navigator.clipboard"], [/\bwindow\s*\.\s*open\s*\(/i, "window.open"],
  [/\blocation\s*(\.\s*(href|assign|replace)\s*[=(]|\s*=[^=])/i, "đổi location"], [/\bimport\s*\(/i, "import()"], [/\beval\s*\(/i, "eval()"],
  [/new\s+Function\s*\(/i, "new Function()"], [/\.\s*submit\s*\(/i, "form.submit()"],
];

const lower = (s) => String(s).toLowerCase();
const win = (platform) => (platform ?? process.platform) === "win32";

/** Đọc cấu hình từ biến môi trường (tiến trình MCP nhận qua khối `env` của cấu hình). */
export function configFromEnv(env = process.env) {
  const list = (v) => { try { const a = JSON.parse(v ?? "[]"); return Array.isArray(a) ? a.map(String).filter(Boolean) : []; } catch { return String(v ?? "").split(/[,;]/).map((x) => x.trim()).filter(Boolean); } };
  const tools = env.TAKI_APPROVER_TOOLS ? list(env.TAKI_APPROVER_TOOLS) : DEFAULT_TOOLS;
  const hosts = env.TAKI_APPROVER_HOSTS === undefined ? DEFAULT_HOSTS : list(env.TAKI_APPROVER_HOSTS);
  return {
    tools,
    hosts: [...new Set(hosts.map((h) => lower(h).replace(/^\*\./, "")))],
    fileRoots: list(env.TAKI_APPROVER_FILE_ROOTS),
    js: lower(env.TAKI_APPROVER_JS ?? "on") !== "off",
    killFile: env.TAKI_APPROVER_KILL_FILE || "",
    killEnv: env.ALLOW_CHROME_AUTOAPPROVE === "0",
    deviceId: env.TAKI_APPROVER_DEVICE_ID || "",
  };
}

/** Công tắc khẩn cấp: biến môi trường ALLOW_CHROME_AUTOAPPROVE=0 hoặc tệp công tắc tồn tại (đọc MỖI lần gọi → dừng được job đang chạy). */
export function isKilled(cfg) {
  return Boolean(cfg.killEnv) || (Boolean(cfg.killFile) && existsSync(cfg.killFile));
}

/** `host` có nằm trong danh sách (khớp chính xác hoặc là tên miền con) không. */
export function hostAllowed(host, hosts) {
  const h = lower(host).replace(/\.$/, "");
  if (!h || !/^[a-z0-9.-]+$/.test(h)) return false;
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
}

/** Địa chỉ được phép mở? Chỉ https + máy chủ trong danh sách; "back"/"forward" của navigate là hành động lịch sử. */
export function urlDecision(raw, hosts, { history = false } = {}) {
  const s = String(raw ?? "").trim();
  if (history && /^(back|forward)$/i.test(s)) return { ok: true, host: "" };
  let u;
  try { u = new URL(s); } catch { return { ok: false, host: "", reason: "địa chỉ không hợp lệ" }; }
  if (u.protocol !== "https:") return { ok: false, host: u.host, reason: `chỉ cho phép https (nhận ${u.protocol.replace(":", "")})` };
  if (u.username || u.password) return { ok: false, host: u.hostname, reason: "địa chỉ có tài khoản/mật khẩu nhúng" };
  if (u.port && u.port !== "443") return { ok: false, host: u.host, reason: `cổng ${u.port} không được phép` };
  if (!hostAllowed(u.hostname, hosts)) return { ok: false, host: u.hostname, reason: `${u.hostname} không nằm trong danh sách trang được mở` };
  return { ok: true, host: u.hostname };
}

const SENSITIVE_NAME = /^\.env(\..*)?$|^\.npmrc$|^id_(rsa|ed25519|ecdsa)|\.(pem|key|pfx|p12|kdbx|db|sqlite3?|db-wal|db-shm)$|^(cookies|login data|web data|local state|history|preferences)$|^\.claude\.json$/i;
const SENSITIVE_SEG = new Set([".ssh", ".aws", ".claude", ".config", ".gnupg", "user data", ".git"]);

/** Chuẩn hoá đường dẫn để so sánh: tuyệt đối, bỏ `..`, hạ chữ thường trên Windows, cố gắng giải symlink. */
function canonical(p, platform) {
  let abs = normalize(resolve(String(p)));
  // A file not created yet can still sit below a symlink/junction that escapes the job folder.
  // Resolve its nearest existing ancestor instead of only resolving existing leaf files.
  try {
    let ancestor = abs;
    const tail = [];
    while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) {
      tail.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
    if (existsSync(ancestor)) abs = join(realpathSync(ancestor), ...tail);
  } catch { return null; }
  return win(platform) ? lower(abs) : abs;
}

/** Đường dẫn tệp được phép: nằm TRONG một thư mục gốc (hoặc đúng là tệp gốc), không phải tệp nhạy cảm. */
export function pathDecision(p, roots, platform) {
  const raw = String(p ?? "").trim();
  if (!raw) return { ok: false, reason: "thiếu đường dẫn tệp" };
  if (raw.includes("\0")) return { ok: false, reason: "đường dẫn không hợp lệ" };
  if (win(platform) && (/^\\\\[?.]\\/.test(raw) || raw.replace(/^[a-zA-Z]:/, "").includes(":"))) return { ok: false, reason: "không cho phép luồng dữ liệu hoặc đường dẫn thiết bị Windows" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return { ok: false, reason: "chỉ nhận tệp trên máy này" };
  if (!isAbsolute(raw) && !/^[a-zA-Z]:[\\/]/.test(raw)) return { ok: false, reason: "cần đường dẫn tuyệt đối" };
  const abs = canonical(raw, platform);
  if (abs === null) return { ok: false, reason: "không xác minh được đường dẫn tệp" };
  const name = abs.split(/[\\/]+/).pop() ?? "";
  if (SENSITIVE_NAME.test(name)) return { ok: false, reason: `tệp nhạy cảm (${name})` };
  if (!roots.length) return { ok: false, reason: "chưa khai báo thư mục được phép" };
  for (const r of roots) {
    const root = canonical(r, platform);
    if (root === null) continue;
    const base = root.endsWith(sep) ? root : root + sep;
    if (abs !== root && !abs.startsWith(base)) continue;
    // Chỉ xét các thư mục BÊN DƯỚI thư mục gốc (gốc do hệ thống khai báo nên tin được, kể cả nằm trong AppData/tmp).
    const hit = abs.slice(root.length).split(/[\\/]+/).map((x) => lower(x)).find((x) => SENSITIVE_SEG.has(x));
    if (hit) return { ok: false, reason: `nằm trong thư mục nhạy cảm (${hit})` };
    return { ok: true };
  }
  return { ok: false, reason: "nằm ngoài thư mục job / tải lên" };
}

const pathsOf = (input) => {
  const out = [];
  const push = (v) => { if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach(push); };
  for (const k of ["paths", "path", "file", "files", "filePath", "file_path", "filepath", "filename"]) push(input?.[k]);
  return out;
};

const head = (s, n = 120) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);

/**
 * Quyết định cho 1 lần xin quyền. Trả { behavior, reason, host?, note? } — `note` là phần ngắn để ghi nhật ký (không ghi nội dung gõ vào trang).
 * @param {string} toolName  vd "mcp__claude-in-chrome__navigate", "Read", "Bash"
 * @param {any} input
 * @param {{tools:string[],hosts:string[],fileRoots:string[],js:boolean,killFile:string,killEnv:boolean,platform?:string}} cfg
 */
export function decide(toolName, input, cfg) {
  const name = String(toolName ?? "");
  const deny = (reason, extra = {}) => ({ behavior: "deny", reason, ...extra });
  const allow = (reason, extra = {}) => ({ behavior: "allow", reason, ...extra });
  const inp = input && typeof input === "object" ? input : {};
  if (isKilled(cfg)) return deny("công tắc tắt khẩn cấp đang BẬT");

  // ---- Công cụ tệp / tìm kiếm của Claude Code (lớp dự phòng) ----
  if (FILE_TOOLS.includes(name)) {
    const p = inp.file_path ?? inp.path ?? inp.notebook_path;
    const d = pathDecision(p, cfg.fileRoots, cfg.platform);
    return d.ok ? allow("tệp trong thư mục job", { note: head(basename(String(p))) }) : deny(d.reason, { note: head(basename(String(p ?? ""))) });
  }
  if (SEARCH_TOOLS.includes(name)) {
    const p = inp.path;
    if (p === undefined || p === "") {
      const pat = String(inp.pattern ?? "");
      return /^([a-zA-Z]:|[\\/]|~)|\.\./.test(pat) ? deny("mẫu tìm kiếm trỏ ra ngoài thư mục job") : allow("tìm trong thư mục job");
    }
    const d = pathDecision(p, cfg.fileRoots, cfg.platform);
    return d.ok ? allow("tìm trong thư mục job") : deny(d.reason);
  }

  // ---- Công cụ Chrome ----
  if (!name.startsWith(CHROME_PREFIX)) return deny("chỉ cho phép công cụ Chrome và công cụ tệp trong thư mục job");
  const tool = name.slice(CHROME_PREFIX.length);
  if (!cfg.tools.includes(tool)) return deny(`công cụ Chrome "${tool}" không nằm trong danh sách được phép`);
  if (cfg.deviceId && ["select_browser", "switch_browser"].includes(tool) && String(inp.device_id ?? inp.deviceId ?? "") !== cfg.deviceId) {
    return deny("không được chuyển sang Chrome khác với hồ sơ đã chọn");
  }

  // Mọi tham số kiểu địa chỉ đều phải hợp lệ (navigate, tabs_create_mcp, và công cụ lạ có url).
  for (const k of ["url", "href", "uri"]) {
    if (inp[k] === undefined || inp[k] === null || inp[k] === "") continue;
    const u = urlDecision(inp[k], cfg.hosts, { history: tool === "navigate" && k === "url" });
    if (!u.ok) return deny(u.reason, { host: u.host });
  }
  if (tool === "navigate" && !inp.url) return deny("navigate thiếu địa chỉ");

  if (tool === "file_upload" || tool === "upload_image") {
    const paths = pathsOf(inp);
    if (tool === "upload_image" && !paths.length) return allow("ảnh chụp trong phiên (imageId), không phải tệp trên máy");
    if (!paths.length) return deny("tải tệp lên nhưng không có đường dẫn để kiểm tra");
    for (const p of paths) {
      const d = pathDecision(p, cfg.fileRoots, cfg.platform);
      if (!d.ok) return deny(`${d.reason}: ${head(basename(p), 60)}`, { note: head(p, 200) });
    }
    return allow("tệp trong thư mục job", { note: head(paths.map((p) => basename(p)).join(", "), 200) });
  }

  if (tool === "javascript_tool") {
    const code = String(inp.text ?? inp.code ?? inp.script ?? inp.javascript ?? "");
    const note = `script ${code.length} ký tự; sha256 ${createHash("sha256").update(code).digest("hex").slice(0, 16)}`;
    if (!cfg.js) return deny("javascript_tool đang TẮT cho job này", { note });
    for (const [re, label] of JS_DENY) if (re.test(code)) return deny(`script có dấu hiệu rút dữ liệu / điều hướng ngầm (${label})`, { note });
    return allow("script trên trang", { note });
  }

  const host = typeof inp.url === "string" ? urlDecision(inp.url, cfg.hosts, { history: true }).host : undefined;
  const note = tool === "computer" ? `computer ${head(inp.action ?? "", 30)}` : undefined;
  return allow("công cụ Chrome trong danh sách", { ...(host ? { host } : {}), ...(note ? { note } : {}) });
}
