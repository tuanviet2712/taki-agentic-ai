import { createHash, randomBytes } from "node:crypto";
import { audit, bizSettings, byId, emit, update, type Row } from "@dotaka/db";
import { ConnectorError, live } from "@dotaka/connectors";
import { AppError, decryptSecret, encryptSecret, logger, nowIso } from "@dotaka/shared";
import { createConnection, credsOf } from "./connections.ts";
import { requireEncryptionKey } from "./key-migration.ts";
import { publicBaseUrl, publicStatus } from "./tracking.ts";

/**
 * Kết nối kênh bằng NÚT ĐĂNG NHẬP (OAuth) thay vì dán token tay:
 *  - Facebook Login: 1 lần cấp quyền cho cả Fanpage (kể cả Trang trong Business Manager) và Instagram Business.
 *    Token dài hạn (~60 ngày); page token lấy từ đó không hết hạn. Callback chạy được ngay trên http://localhost:<API_PORT>
 *    (mở bằng trình duyệt của chính Sếp, app ở chế độ Development) — không cần tunnel.
 *  - TikTok Login Kit (PKCE): access token 24 giờ + refresh token 365 ngày → tự gia hạn trước khi dùng. TikTok chỉ nhận
 *    Redirect URI https → cần PUBLIC_BASE_URL (+ cổng công khai PUBLIC_PORT) MỘT LẦN lúc kết nối.
 * App ID/Secret: .env (FACEBOOK_APP_ID/SECRET, TIKTOK_CLIENT_KEY/SECRET) hoặc Sếp nhập ở trang Kênh đăng (mã hoá).
 * Chưa có TOKEN_ENCRYPTION_KEY thật → KHÔNG lưu App Secret / token đăng nhập (khóa mặc định là khóa công khai trong mã nguồn).
 */
export const OAUTH_PROVIDERS = {
  facebook: { name: "Facebook + Instagram", env: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"], console: "https://developers.facebook.com/apps", scopes: live.META_SCOPES, httpsOnly: false },
  tiktok: { name: "TikTok", env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], console: "https://developers.tiktok.com/apps", scopes: live.TIKTOK_SCOPES, httpsOnly: true },
} as const;
export type OAuthProvider = keyof typeof OAUTH_PROVIDERS;
export const isOAuthProvider = (p: string): p is OAuthProvider => p in OAUTH_PROVIDERS;

type App = { id: string; secret: string; source: "env" | "saved" };
export function oauthApp(bizId: string, provider: OAuthProvider): App | null {
  const [idEnv, secretEnv] = OAUTH_PROVIDERS[provider].env;
  if (process.env[idEnv] && process.env[secretEnv]) return { id: process.env[idEnv]!, secret: process.env[secretEnv]!, source: "env" };
  const saved = (bizSettings(bizId) as any).oauthApps?.[provider] as { id?: string; secret?: string } | undefined;
  if (saved?.id && saved.secret) {
    try { return { id: saved.id, secret: decryptSecret(saved.secret), source: "saved" }; } catch (e) {
      logger.warn("oauth.app_secret_unreadable", { provider, error: e instanceof Error ? e.message : String(e), hint: "Khóa TOKEN_ENCRYPTION_KEY đã đổi? Nhập lại App Secret ở Kênh đăng." });
      return null;
    }
  }
  return null;
}
export function saveOAuthApp(bizId: string, provider: OAuthProvider, app: { id: string; secret: string }, actor: string) {
  requireEncryptionKey("App Secret");
  const s = bizSettings(bizId) as any;
  update("biz", bizId, { settings: { ...s, oauthApps: { ...(s.oauthApps ?? {}), [provider]: { id: app.id.trim(), secret: encryptSecret(app.secret.trim()) } } } });
  audit(bizId, actor, "oauth.app_saved", { type: "biz", id: bizId }, { provider, appId: app.id.trim() });
}

const apiBase = () => `http://localhost:${process.env.API_PORT ?? 8787}`;
/** Facebook: OAUTH_REDIRECT_BASE hoặc chính localhost:<API_PORT>. TikTok: OAUTH_REDIRECT_BASE hoặc PUBLIC_BASE_URL (bắt buộc https). */
export function redirectBase(provider: OAuthProvider) {
  const env = process.env.OAUTH_REDIRECT_BASE?.trim().replace(/\/+$/, "");
  if (env) return env;
  return provider === "tiktok" ? (publicBaseUrl() ?? apiBase()) : apiBase();
}
export const redirectUri = (provider: OAuthProvider) => `${redirectBase(provider)}/v1/oauth/${provider}/callback`;

export function oauthStatus(bizId: string) {
  const pub = publicStatus();
  return Object.fromEntries((Object.keys(OAUTH_PROVIDERS) as OAuthProvider[]).map((p) => {
    const def = OAUTH_PROVIDERS[p];
    const app = oauthApp(bizId, p);
    const uri = redirectUri(p);
    const httpsProblem = def.httpsOnly && !uri.startsWith("https://");
    return [p, {
      name: def.name, configured: Boolean(app), source: app?.source ?? null, appId: app ? `${app.id.slice(0, 4)}…${app.id.slice(-3)}` : null,
      redirectUri: uri, console: def.console, scopes: p === "facebook" ? live.META_SCOPES : def.scopes, adsScopes: p === "facebook" ? live.META_ADS_SCOPES : [], envKeys: def.env,
      warning: httpsProblem ? "TikTok chỉ chấp nhận Redirect URI dạng https — đặt PUBLIC_BASE_URL (địa chỉ https của cổng công khai, vd. Cloudflare Tunnel trỏ về PUBLIC_PORT) rồi khởi động lại; chỉ cần mở MỘT LẦN lúc kết nối."
        : def.httpsOnly && !pub.listening ? "Cổng công khai (PUBLIC_PORT) chưa chạy — TikTok không gọi được địa chỉ quay về."
        : null,
    }];
  }));
}

// state → phiên đăng nhập đang chờ (1 tiến trình, sống 1 giờ, dùng 1 lần)
const pending = new Map<string, { provider: OAuthProvider; bizId: string; verifier: string; returnTo: string; at: number; ads: boolean }>();
const OAUTH_STATE_TTL_MS = 3600_000;
const b64url = (b: Buffer) => b.toString("base64url");
const defaultReturn = () => `${(process.env.WEB_URL ?? "http://localhost:5173").replace(/\/+$/, "")}/channels`;
/** Chỉ cho quay về giao diện chạy trên máy này (chống open redirect). */
export function safeReturn(returnTo?: string) {
  try {
    const u = new URL(returnTo ?? "");
    if (["localhost", "127.0.0.1"].includes(u.hostname) && ["http:", "https:"].includes(u.protocol)) return u.toString();
  } catch { /* fallthrough */ }
  return defaultReturn();
}

export function startOAuth(bizId: string, provider: OAuthProvider, returnTo?: string, opts: { ads?: boolean } = {}) {
  requireEncryptionKey("token đăng nhập");
  const app = oauthApp(bizId, provider);
  if (!app) throw new AppError("NO_APP", `Chưa có App ID/Secret cho ${OAUTH_PROVIDERS[provider].name}`);
  if (provider === "tiktok" && !redirectUri(provider).startsWith("https://")) {
    throw new AppError("NEEDS_HTTPS", "TikTok chỉ chấp nhận Redirect URI https — đặt PUBLIC_BASE_URL (+ PUBLIC_PORT) rồi khởi động lại");
  }
  for (const [k, v] of pending) if (Date.now() - v.at > OAUTH_STATE_TTL_MS) pending.delete(k);
  while (pending.size >= 200) pending.delete(pending.keys().next().value!); // trần kích thước (xoá phiên cũ nhất)
  const state = randomBytes(16).toString("hex");
  const verifier = b64url(randomBytes(32));
  pending.set(state, { provider, bizId, verifier, returnTo: safeReturn(returnTo), at: Date.now(), ads: Boolean(opts.ads) });
  const url = provider === "facebook"
    ? live.metaAuthUrl(app.id, redirectUri(provider), state, { ads: opts.ads })
    : live.tiktokAuthUrl(app.id, redirectUri(provider), state, b64url(createHash("sha256").update(verifier).digest()));
  return { url, redirectUri: redirectUri(provider) };
}

/**
 * Callback: đổi code lấy token, tạo/cập nhật kết nối (tự tìm Fanpage, Instagram, kênh TikTok). Trả URL quay về giao diện.
 * Không bao giờ phản chiếu `code` / chữ lỗi từ query vào nội dung trả về (chỉ chuyển hướng).
 */
export async function finishOAuth(provider: OAuthProvider, q: { code?: string; state?: string; error?: string; error_description?: string }) {
  const p = q.state ? pending.get(q.state) : undefined;
  const expired = Boolean(p && Date.now() - p.at > OAUTH_STATE_TTL_MS);
  if (expired) pending.delete(q.state!);
  if (!p || p.provider !== provider || expired) return `${safeReturn()}?oauth_error=${encodeURIComponent("Phiên đăng nhập hết hạn hoặc không hợp lệ — bấm đăng nhập lại")}`;
  pending.delete(q.state!); // dùng 1 lần
  const back = (params: Record<string, string>) => `${p.returnTo}${p.returnTo.includes("?") ? "&" : "?"}${new URLSearchParams(params)}`;
  if (q.error || !q.code) return back({ oauth_error: q.error_description ? String(q.error_description).slice(0, 200) : q.error ? "Đã huỷ đăng nhập hoặc nền tảng từ chối" : "Sếp đã huỷ đăng nhập" });
  const app = oauthApp(p.bizId, provider);
  if (!app) return back({ oauth_error: "Thiếu App ID/Secret" });
  try { requireEncryptionKey("token đăng nhập"); } catch (e) { return back({ oauth_error: (e as Error).message }); }
  const actor = `Đăng nhập ${OAUTH_PROVIDERS[provider].name}`;
  try {
    if (provider === "facebook") {
      const t = await live.metaExchangeCode(app, redirectUri(provider), q.code);
      if (t.missing.length) return back({ oauth_error: `Thiếu quyền: ${t.missing.join(", ")} — đăng nhập lại và bật đủ quyền, chọn đủ Trang` });
      const c = await createConnection(p.bizId, {
        platform: "meta", mode: "live", credentials: { access_token: t.accessToken },
        config: { oauth: "facebook", token_expires_at: new Date(Date.now() + t.expiresIn * 1000).toISOString(), granted: t.granted.join(","), ads: p.ads ? "1" : "" },
      }, actor) as Row;
      const label = `${String(c.display_name ?? "Facebook").replace(/ · đăng nhập bằng nút$/, "")} · đăng nhập bằng nút`;
      update("connection", c.id, { display_name: label });
      return back({ connected: "facebook", name: label });
    }
    const t = await live.tiktokExchangeCode(app, redirectUri(provider), q.code, p.verifier);
    const granted = String(t.scope ?? "").split(",");
    const missing = live.TIKTOK_SCOPES.filter((s) => !granted.includes(s));
    if (!granted.includes("video.upload") && !granted.includes("video.publish")) return back({ oauth_error: "Thiếu quyền video.upload — đăng nhập lại và tick đủ quyền" });
    const c = await createConnection(p.bizId, { platform: "tiktok_post", mode: "live", credentials: { access_token: t.access_token }, config: { oauth: "tiktok" } }, actor) as Row;
    update("connection", c.id, {
      token_ciphertext: encryptSecret(JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token })),
      config: { ...(byId<Row>("connection", c.id)!.config ?? {}), token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), refresh_expires_at: new Date(Date.now() + t.refresh_expires_in * 1000).toISOString(), scope: t.scope },
    });
    return back({ connected: "tiktok", name: String(c.display_name ?? ""), ...(missing.length ? { warn: `Thiếu quyền: ${missing.join(", ")} (chỉ gửi được bản nháp nếu thiếu video.publish)` } : {}) });
  } catch (e) {
    logger.warn("oauth.failed", { provider, error: String(e).slice(0, 300) });
    return back({ oauth_error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) });
  }
}

// ---------------- TikTok: luôn có access token còn hạn ----------------
const refreshing = new Map<string, Promise<string>>();
export function tiktokAccessToken(connId: string): Promise<string> {
  const conn = byId<Row>("connection", connId);
  if (!conn) return Promise.reject(new ConnectorError("AuthError", "TikTok: không thấy kết nối"));
  const cr = credsOf(conn);
  const exp = conn.config?.token_expires_at ? Date.parse(conn.config.token_expires_at) : NaN;
  if (!cr.access_token) return Promise.reject(new ConnectorError("AuthError", "TikTok: chưa có token — bấm Kết nối TikTok ở trang Kênh đăng"));
  if (!cr.refresh_token || (Number.isFinite(exp) && exp - Date.now() > 10 * 60_000)) return Promise.resolve(cr.access_token);
  const inflight = refreshing.get(connId);
  if (inflight) return inflight;
  const job = (async () => {
    const app = oauthApp(conn.biz_id, "tiktok");
    if (!app) throw new ConnectorError("AuthError", "TikTok: thiếu Client Key/Secret để gia hạn token — nhập lại ở trang Kênh đăng");
    try {
      const t = await live.tiktokRefresh(app, cr.refresh_token);
      update("connection", connId, {
        token_ciphertext: encryptSecret(JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token || cr.refresh_token })),
        config: { ...(conn.config ?? {}), token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), refresh_expires_at: new Date(Date.now() + t.refresh_expires_in * 1000).toISOString() },
        status: "active", last_health_at: nowIso(), last_error: null,
      });
      return t.access_token;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      update("connection", connId, { status: "expired", last_error: msg });
      emit(conn.biz_id, "alert.raised", { level: "urgent", text: `TikTok cần kết nối lại: ${msg}`, category: "publish", key: `conn_auth:${connId}`, href: "/channels" });
      throw new ConnectorError("AuthError", `TikTok: không gia hạn được phiên đăng nhập — bấm Kết nối lại TikTok (${msg})`);
    }
  })().finally(() => refreshing.delete(connId));
  refreshing.set(connId, job);
  return job;
}
