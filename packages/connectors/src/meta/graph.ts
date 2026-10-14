import { ConnectorError } from "../errors.ts";

/**
 * Graph API transport for Meta — ported from TakiAcademy-AI/ads-os (lib/ads/facebook*.ts), whose write path was
 * verified against real ad accounts. Rules carried over:
 *  - the token goes in the Authorization header, never in the URL (URLs end up in logs);
 *  - Facebook answers some account errors with HTTP 200 + an `error` block (e.g. 31/3858385), so `error` is
 *    checked BEFORE the status code;
 *  - reads retry 5xx/network errors; writes are NEVER retried (the request may have landed and only the response
 *    was lost — a retry could double-create or overwrite a change made by hand).
 */
export const GRAPH_VERSION = () => process.env.META_GRAPH_VERSION ?? process.env.FB_API_VERSION ?? "v23.0";
const BASE = () => `https://graph.facebook.com/${GRAPH_VERSION()}`;
export const graphBase = BASE;
const TIMEOUT = 25_000;

export type GraphError = { message?: string; code?: number; error_subcode?: number; error_user_msg?: string; error_user_title?: string; type?: string };

/**
 * Guidance for errors only the user can clear by hand.
 *
 * 31/3858385 is Meta's security lock, not a payload or permission problem: it binds to the PERSON whose token is
 * used. Verified in ads-os on 2026-10-01: same account and Reel — a person token fails at the ad step with
 * 31/3858385, a System User token runs all four steps.
 */
export function fbActionHint(code?: number, subcode?: number): string | null {
  if (code === 31 && subcode === 3858385) {
    return "Meta đang tạm khoá quyền tạo/sửa quảng cáo để kiểm tra bảo mật. Khoá này bám vào TÀI KHOẢN FACEBOOK CỦA NGƯỜI tạo token, "
      + "không phải tài khoản quảng cáo — đổi tài khoản quảng cáo hay nhờ người khác kết nối đều không gỡ được. "
      + "CÁCH CHẮC ĂN NHẤT: dùng token System User — business.facebook.com/settings → Người dùng hệ thống → tạo (vai trò Quản trị viên) → "
      + "Thêm tài sản: tài khoản quảng cáo (Quản lý chiến dịch) VÀ Trang (Quản lý Trang) → Tạo mã truy cập, tick ads_management, ads_read, "
      + "business_management, pages_show_list, pages_read_engagement, pages_manage_ads → dán vào Trung tâm tích hợp → Facebook. "
      + "CÁCH CÒN LẠI: đăng nhập đúng người đã tạo token → Ads Manager → mở sửa một nhóm quảng cáo → bấm \"Start authentication\". Đừng bấm thử lại liên tục.";
  }
  // 3858759: bài không thuộc Trang mà token được quyền quảng cáo. Facebook trả 1487390 ("thử lại sau") cho CÙNG lỗi này
  // khi nội dung có nút Nhắn tin — thử lại không bao giờ được.
  if (code === 100 && (subcode === 3858759 || subcode === 1487390)) {
    return "Thường do kết nối Facebook đang dùng để tạo quảng cáo KHÔNG có quyền quảng cáo trên Trang của bài viết "
      + "(token chỉ thấy tài khoản quảng cáo, không thấy Trang). Cách sửa: dùng token System User được gán CẢ tài khoản quảng cáo "
      + "(Quản lý chiến dịch) VÀ Trang (Quản lý Trang / quảng cáo) — Trung tâm tích hợp → Facebook. Hệ thống đã tự chọn kết nối có đủ quyền nếu có.";
  }
  return null;
}

/**
 * Lỗi đăng bài Facebook (subcode) mà Sếp tự xử lý được → lời nhắn tiếng Việt + loại lỗi. Chỉ đoán theo mã/subcode
 * (hoặc câu chữ đặc trưng của Graph), không đoán bừa: không khớp thì giữ nguyên lời của Facebook.
 */
export function publishErrorHint(e: GraphError): { kind: ConnectorError["kind"]; text: string } | null {
  const sub = e.error_subcode;
  const msg = String(e.message ?? "");
  if (sub === 1404078 || /Unpublished posts must be posted to a page as the page itself/i.test(msg)) return { kind: "AuthError", text: "chưa được cấp quyền đăng với tư cách Trang — kết nối lại và chọn đủ Trang" };
  if (sub === 1390008) return { kind: "RateLimited", text: "đăng quá nhanh, tạm bị chặn — hệ thống sẽ thử lại sau" };
  if (sub === 1366046) return { kind: "InvalidRequest", text: "ảnh phải nhỏ hơn 4MB, định dạng JPG/PNG" };
  if (sub === 1366051) return { kind: "InvalidRequest", text: "các ảnh này đã được đăng trước đó" };
  if (sub === 1346003 || sub === 1404102) return { kind: "PolicyRejected", text: "nội dung bị đánh dấu vi phạm tiêu chuẩn cộng đồng" };
  if (sub === 1404006) return { kind: "PolicyRejected", text: "Facebook yêu cầu kiểm tra bảo mật — mở Facebook trên Chrome xác minh rồi thử lại" };
  if (sub === 2069019) return { kind: "InvalidRequest", text: "tệp không hợp lệ" };
  // Instagram Content Publishing
  if (sub === 2207026 || sub === 2207004) return { kind: "InvalidRequest", text: "Instagram: định dạng/thời lượng media không hợp lệ (Reels 3 giây–15 phút, MP4 H.264/AAC, tỉ lệ 9:16; ảnh JPEG)" };
  if (sub === 2207042) return { kind: "RateLimited", text: "Instagram: đã đạt giới hạn 25 bài/24 giờ" };
  if (sub === 9004 || sub === 2207052) return { kind: "InvalidRequest", text: "Instagram không tải được media từ link công khai — kiểm tra PUBLIC_BASE_URL và cổng công khai (PUBLIC_PORT) đang chạy" };
  return null;
}

/** Turn a Graph `error` block into a ConnectorError with the most useful Vietnamese text. */
export function graphError(e: GraphError, status: number, label = "Meta"): ConnectorError {
  const hint = fbActionHint(e.code, e.error_subcode);
  const pub = hint ? null : publishErrorHint(e);
  const code = e.code ? ` [mã ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""}]` : "";
  const title = e.error_user_title ? `${e.error_user_title}: ` : "";
  const fbText = `${title}${e.error_user_msg || e.message || `HTTP ${status}`}`;
  // Lỗi quyền Trang khi tạo nội dung: giữ lời Facebook rồi nói cách sửa (lời Facebook "thử lại sau" dễ gây hiểu lầm).
  const keepFb = e.code === 100 && (e.error_subcode === 3858759 || e.error_subcode === 1487390);
  const text = hint ? (keepFb ? `${fbText} — ${hint}` : hint) : pub?.text ?? fbText;
  // 190 = token hỏng/hết hạn, 102 = phiên hết hạn, 10/200 = thiếu quyền → người dùng phải xử lý, không thử lại.
  const kind: ConnectorError["kind"] = pub?.kind ?? (e.code === 190 || e.code === 102 || e.code === 10 || e.code === 200 ? "AuthError"
    : e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || e.code === 80004 ? "RateLimited"
    : e.code === 31 || e.code === 368 ? "PolicyRejected"
    : status >= 500 || e.code === 1 || e.code === 2 ? "Transient" : "InvalidRequest");
  return new ConnectorError(kind, `${label}: ${text}${code}`);
}

async function call(method: "GET" | "POST" | "DELETE", url: string, token: string, body?: URLSearchParams) {
  const res = await fetch(url, {
    method, body,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 200) }; }
  // TRAP: HTTP 200 with an `error` block — check it first.
  if (json?.error) throw graphError(typeof json.error === "string" ? { message: json.error } : json.error, res.status);
  if (res.status === 429) throw new ConnectorError("RateLimited", "Meta: bị giới hạn tần suất, thử lại sau");
  if (!res.ok) throw new ConnectorError(res.status >= 500 ? "Transient" : res.status === 401 || res.status === 403 ? "AuthError" : "InvalidRequest", `Meta: HTTP ${res.status}${json?._raw ? ` ${json._raw}` : ""}`);
  return json;
}

const enc = (params: Record<string, unknown>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, typeof v === "string" ? v : JSON.stringify(v));
  return qs;
};

/** Read. Retries 5xx/network errors (1s, 2s); 4xx and error blocks throw at once. */
export async function graphGet(token: string, path: string, params: Record<string, unknown> = {}): Promise<any> {
  const url = path.startsWith("https://") ? path : `${BASE()}/${path}?${enc(params)}`;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call("GET", url, token);
    } catch (e) {
      const transient = !(e instanceof ConnectorError) || e.kind === "Transient";
      if (!transient || attempt >= 2) throw e instanceof ConnectorError ? e : new ConnectorError("Transient", `Meta: không kết nối được (${e instanceof Error ? e.message : e})`);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/** Every page of a list endpoint. */
export async function graphAll(token: string, path: string, params: Record<string, unknown>, maxPages = 10): Promise<any[]> {
  const out: any[] = [];
  let r = await graphGet(token, path, params);
  for (let i = 0; i < maxPages; i++) {
    out.push(...(r.data ?? []));
    if (!r.paging?.next) break;
    r = await graphGet(token, r.paging.next);
  }
  return out;
}

/** Network errors raised BEFORE a single byte reached Meta (connection refused / DNS) — the write certainly did not land. */
const NOT_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
function failedBeforeSend(e: unknown): boolean {
  const code = (e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code;
  return Boolean(code && NOT_SENT_CODES.has(code));
}
/**
 * A write whose answer never arrived (timeout / connection dropped after sending): Meta MAY have applied it.
 * The kind stays "InvalidRequest" (the queue must not auto-retry ad creation), and `outcomeUnknown` tells callers that
 * can duplicate a customer-facing message (nurture public reply / Private Reply) to NEVER resend automatically.
 * Errors that happen before any byte was sent are not "unknown" — those are safe to retry.
 */
function writeNotAnswered(e: unknown, what: string, where: string): ConnectorError {
  const err = new ConnectorError("InvalidRequest", `Meta: ${what} không nhận được phản hồi (${e instanceof Error ? e.message : e}) — kiểm tra trên ${where} trước khi thử lại`);
  // requestNotSent: certainly not delivered (safe for a caller to retry); outcomeUnknown: may have been applied (never auto-resend).
  return Object.assign(err, failedBeforeSend(e) ? { requestNotSent: true } : { outcomeUnknown: true });
}

/** Write. NEVER retried; a network failure is reported as such so a human can check before trying again. */
export async function graphPost(token: string, path: string, params: Record<string, unknown>): Promise<any> {
  try {
    return await call("POST", `${BASE()}/${path}`, token, enc(params));
  } catch (e) {
    if (e instanceof ConnectorError) throw e;
    throw writeNotAnswered(e, "lệnh ghi", "Ads Manager");
  }
}

/** Multipart upload of a local file (Page photos/videos; `field` = "filedata" for a Messenger Send API image). Videos go to graph-video. NEVER retried (a retry double-posts). */
export async function graphUpload(token: string, path: string, fields: Record<string, string>, file: { path: string; mime: string }, video = false, field = "source"): Promise<any> {
  const { readFileSync } = await import("node:fs");
  const { basename } = await import("node:path");
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set(field, new Blob([readFileSync(file.path)], { type: file.mime }), basename(file.path));
  const base = BASE().replace("graph.facebook.com", video ? "graph-video.facebook.com" : "graph.facebook.com");
  let res: Response;
  try {
    res = await fetch(`${base}/${path}`, { method: "POST", body: form, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10 * 60_000) });
  } catch (e) {
    throw writeNotAnswered(e, "tải tệp lên", "Trang");
  }
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (json?.error) throw graphError(json.error, res.status);
  if (!res.ok) throw new ConnectorError(res.status >= 500 ? "Transient" : "InvalidRequest", `Meta: tải tệp lên lỗi HTTP ${res.status}`);
  return json;
}

/** Delete — used ONLY to clean up objects this system created seconds earlier in a failed chain. */
export async function graphDelete(token: string, path: string): Promise<void> {
  await call("DELETE", `${BASE()}/${path}`, token).catch(() => {});
}
