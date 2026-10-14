import { ConnectorError } from "./errors.ts";
import { GRAPH_VERSION, graphBase, graphError, graphGet } from "./meta/graph.ts";
import { tiktokError } from "./tiktok-post.ts";

/**
 * Đăng nhập bằng NÚT (OAuth): Facebook Login (Fanpage + Instagram Business) và TikTok Login Kit (PKCE).
 * Quy tắc: client_secret + code + token chỉ đi trong thân POST (form) và header Authorization — KHÔNG BAO GIỜ nằm trong URL
 * (URL rơi vào nhật ký / thông báo lỗi). Các hàm nhận `fetch` toàn cục nên test thay được bằng bản giả.
 */
const TIMEOUT = 25_000;

// ---------------- Facebook ----------------
/** Quyền đăng bài + quản lý bình luận + Messenger + Instagram (đăng, bình luận, số liệu). */
export const META_SCOPES = [
  "pages_show_list", "business_management", "pages_manage_posts", "pages_manage_engagement", "pages_read_engagement", "read_insights",
  // Chăm khách từ bình luận / Messenger: đọc tên người bình luận + nhắn inbox (Private Reply)
  "pages_read_user_content", "pages_messaging",
  "instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_insights",
];
/** Tuỳ chọn (mặc định TẮT): quyền quảng cáo. Xin quyền này khi app chưa có sản phẩm Marketing API làm hộp thoại đăng nhập lỗi. */
export const META_ADS_SCOPES = ["ads_management", "ads_read"];
export const metaScopes = (o: { ads?: boolean } = {}) => (o.ads ? [...META_SCOPES, ...META_ADS_SCOPES] : META_SCOPES);
/** Quyền tối thiểu để đăng bài; thiếu thì báo Sếp tick lại khi đăng nhập. */
export const META_REQUIRED = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];

export function metaAuthUrl(appId: string, redirectUri: string, state: string, o: { ads?: boolean } = {}) {
  return `https://www.facebook.com/${GRAPH_VERSION()}/dialog/oauth?${new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, scope: metaScopes(o).join(","), response_type: "code" })}`;
}

async function formPostRaw(url: string, form: Record<string, string>): Promise<{ status: number; ok: boolean; json: any }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    throw new ConnectorError("Transient", `Không kết nối được (${e instanceof Error ? e.message.replace(/client_secret=[^&\s]+/g, "client_secret=***") : "lỗi mạng"})`);
  }
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, ok: res.ok, json };
}
async function formPost(url: string, form: Record<string, string>): Promise<any> {
  const { status, ok, json } = await formPostRaw(url, form);
  if (json?.error) throw typeof json.error === "string" ? new ConnectorError("InvalidRequest", `Facebook: ${json.error_description ?? json.error}`) : graphError(json.error, status, "Facebook");
  if (!ok) throw new ConnectorError(status >= 500 ? "Transient" : "InvalidRequest", `Facebook: HTTP ${status}`);
  return json;
}

/** code → token ngắn → token dài hạn (~60 ngày); page token lấy từ token dài hạn thì không hết hạn. Thân POST, không có secret trong URL. */
export async function metaExchangeCode(app: { id: string; secret: string }, redirectUri: string, code: string) {
  const short = await formPost(`${graphBase()}/oauth/access_token`, { client_id: app.id, client_secret: app.secret, redirect_uri: redirectUri, code });
  const long = await formPost(`${graphBase()}/oauth/access_token`, { grant_type: "fb_exchange_token", client_id: app.id, client_secret: app.secret, fb_exchange_token: String(short.access_token) });
  const accessToken = String(long.access_token);
  const perms = await graphGet(accessToken, "me/permissions"); // token trong header Authorization
  const granted = (perms.data ?? []).filter((p: any) => p.status === "granted").map((p: any) => String(p.permission));
  return { accessToken, expiresIn: Number(long.expires_in ?? 60 * 86400), granted, missing: META_REQUIRED.filter((s) => !granted.includes(s)) };
}

// ---------------- TikTok ----------------
// video.upload = gửi bản nháp vào hộp thư (app chưa duyệt vẫn dùng được); video.publish = đăng công khai (cần app được duyệt).
export const TIKTOK_SCOPES = ["user.info.basic", "video.upload", "video.publish", "video.list"];
export function tiktokAuthUrl(clientKey: string, redirectUri: string, state: string, codeChallenge: string) {
  return `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: clientKey, redirect_uri: redirectUri, state, response_type: "code", scope: TIKTOK_SCOPES.join(","), code_challenge: codeChallenge, code_challenge_method: "S256" })}`;
}
export type TikTokTokens = { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; open_id: string; scope: string };
async function tiktokToken(form: Record<string, string>): Promise<TikTokTokens> {
  const { status, ok, json } = await formPostRaw("https://open.tiktokapis.com/v2/oauth/token/", form);
  if (json?.error && json.error !== "ok") throw tiktokError(String(json.error), String(json.error_description ?? json.error));
  if (!ok || !json?.access_token) throw new ConnectorError(status >= 500 ? "Transient" : "InvalidRequest", `TikTok: không đổi được token (HTTP ${status})`);
  return json as TikTokTokens;
}
export const tiktokExchangeCode = (app: { id: string; secret: string }, redirectUri: string, code: string, codeVerifier: string) =>
  tiktokToken({ client_key: app.id, client_secret: app.secret, code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: codeVerifier });
export const tiktokRefresh = (app: { id: string; secret: string }, refreshToken: string) =>
  tiktokToken({ client_key: app.id, client_secret: app.secret, grant_type: "refresh_token", refresh_token: refreshToken });
