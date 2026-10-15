import { randomBytes } from "node:crypto";
import { bizSettings, byId, insert, q, update, type Row } from "@dotaka/db";
import { nowIso, sha256 } from "@dotaka/shared";

/**
 * Link dưới bình luận + đo click (bài nào ra click → đơn).
 *  - Có địa chỉ công khai ỔN ĐỊNH (PUBLIC_BASE_URL https không phải tunnel nhanh) VÀ cổng công khai đang chạy (PUBLIC_PORT):
 *    bình luận dùng `${PUBLIC_BASE_URL}/r/<code>`; route /r/:code ghi click (IP băm kèm muối, KHÔNG lưu IP thô) rồi 302 sang link gốc + UTM.
 *  - Không có: bình luận dùng thẳng link gốc của sản phẩm + UTM (+ sub-id nếu là link của sàn/mạng affiliate quen) — không cần
 *    mở cổng nào ra internet, vẫn quy được đơn về bài qua báo cáo của mạng affiliate.
 */

// ---------------- Địa chỉ công khai ----------------
/** Cổng công khai (PUBLIC_PORT) có thật sự đang lắng nghe trong tiến trình này không (API đặt khi khởi động cổng). */
let gateway: { listening: boolean; port: number | null } = { listening: false, port: null };
export function setPublicGateway(s: { listening: boolean; port?: number | null }) {
  gateway = { listening: s.listening, port: s.port ?? null };
}
export const publicGatewayState = () => ({ ...gateway });

/** PUBLIC_BASE_URL (chỉ https, bỏ dấu / cuối). Dùng cho OAuth TikTok, media Instagram, link /r/. */
export function publicBaseUrl(): string | undefined {
  const raw = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? `${u.origin}${u.pathname.replace(/\/+$/, "")}` : undefined;
  } catch { return undefined; }
}
/** Tunnel "nhanh" đổi địa chỉ mỗi lần bật → link /r/ đã đăng sẽ chết. Chỉ dùng được tạm cho media Instagram. */
const QUICK_TUNNEL = /(^|\.)(trycloudflare\.com|loca\.lt|lhr\.life|localhost\.run|serveo\.net|ngrok-free\.app|ngrok\.io)$/i;
export const isQuickTunnelHost = (urlOrHost: string) => {
  try { return QUICK_TUNNEL.test(new URL(urlOrHost.includes("://") ? urlOrHost : `https://${urlOrHost}`).hostname); } catch { return false; }
};
/** Gốc của link đo click /r/<mã>: chỉ khi có địa chỉ ổn định + cổng công khai đang chạy. */
export function trackingBase(): string | undefined {
  const base = publicBaseUrl();
  if (!base || !gateway.listening || isQuickTunnelHost(base)) return undefined;
  return base;
}
/** Gốc của link media ký (/m/<token>) để Instagram tải ảnh/video: cần cổng công khai đang chạy (tunnel nhanh vẫn được). */
export function mediaBase(): string | undefined {
  const base = publicBaseUrl();
  return base && gateway.listening ? base : undefined;
}

/** Lý do (tiếng Việt) chưa dùng được link đo click / media Instagram — cho giao diện. */
export function publicStatus() {
  const base = publicBaseUrl();
  const raw = process.env.PUBLIC_BASE_URL?.trim() || null;
  const port = process.env.PUBLIC_PORT?.trim() || null;
  const quick = base ? isQuickTunnelHost(base) : false;
  const trackNote = trackingBase() ? null
    : !port ? "Chưa bật cổng công khai (PUBLIC_PORT) — link dưới bình luận dùng link sản phẩm + UTM, chưa đo được click."
    : !gateway.listening ? "Cổng công khai (PUBLIC_PORT) chưa chạy được — xem nhật ký khởi động."
    : !base ? (raw ? "PUBLIC_BASE_URL phải là địa chỉ https." : "Chưa đặt PUBLIC_BASE_URL.")
    : quick ? "PUBLIC_BASE_URL là tunnel nhanh (đổi địa chỉ mỗi lần bật) — không dùng cho link đo click; dùng tên miền / tunnel có tên cố định."
    : null;
  return {
    publicBaseUrl: base ?? null, publicPortConfigured: Boolean(port), listening: gateway.listening, port: gateway.port,
    stable: Boolean(base && !quick), https: Boolean(base), trackingBase: trackingBase() ?? null, mediaBase: mediaBase() ?? null,
    clickTracking: Boolean(trackingBase()), clickTrackingNote: trackNote,
  };
}

// ---------------- Link affiliate / UTM ----------------
/**
 * Mạng/sàn affiliate nhận diện theo tên miền → tham số sub-id mà báo cáo chuyển đổi (CSV) trả lại. Link rút gọn (s.shopee.vn,
 * shope.ee, c.lazada.vn…) thường KHÔNG có tham số nào → vẫn gắn sub-id đúng tên tham số của mạng đó.
 */
const AFF_HOSTS: { re: RegExp; network: string; param: string }[] = [
  { re: /(^|\.)(shopee\.vn|shope\.ee|shp\.ee)$/i, network: "Shopee", param: "sub_id" },
  { re: /(^|\.)(lazada\.vn|lzd\.co)$/i, network: "Lazada", param: "sub_aff_id" },
  { re: /(^|\.)(shop\.tiktok\.com|affiliate\.tiktok\.com|vt\.tokopedia\.com)$/i, network: "TikTok Shop", param: "sub_id" },
  { re: /(^|\.)(isclix\.com|accesstrade\.vn|atrk\.vn|accesstra\.de)$/i, network: "Accesstrade", param: "sub1" },
  { re: /(^|\.)(invol\.co|involve\.asia)$/i, network: "Involve Asia", param: "aff_sub" },
  { re: /(^|\.)(ecotrackings\.com|ecomobi\.com)$/i, network: "Ecomobi", param: "sub1" },
  { re: /(^|\.)(masoffer\.net|rutgon\.me)$/i, network: "MasOffer", param: "aff_sub" },
  { re: /(^|\.)(tiki\.vn|ti\.ki)$/i, network: "Tiki", param: "sub_id" },
];
export function affiliateNetwork(url: string): { network: string; param: string } | null {
  let host: string;
  try { host = new URL(url).host.toLowerCase(); } catch { return null; }
  const hit = AFF_HOSTS.find((h) => h.re.test(host));
  return hit ? { network: hit.network, param: hit.param } : null;
}

/** Slug không dấu cho utm_campaign / khoá sản phẩm. */
export function slugify(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "chien-dich";
}

/** Tham số cho thấy đây là link affiliate (Shopee an_redir, Accesstrade, Involve/HasOffers, Lazada…). */
const AFF_KEYS = ["aff", "aff_id", "affid", "affiliate", "affiliate_id", "aff_sid", "af_id", "aff_sub", "sub_id", "sub1", "sub_aff_id", "pid"];
/** Tham số sub-id mạng affiliate đọc lại trong báo cáo chuyển đổi (theo thứ tự ưu tiên nếu đã có sẵn trong link). */
const SUB_KEYS = ["sub_id", "aff_sub", "sub1", "sub_aff_id"];

export interface UtmCtx { channel?: string | null; campaign?: string | null; content?: string | null; subId?: string | null }
/**
 * Gắn UTM (utm_source=<kênh>, utm_medium=social, utm_campaign, utm_content) — giữ nguyên tham số sẵn có,
 * KHÔNG ghi đè UTM/sub-id Sếp đã đặt. Link affiliate → thêm sub-id = mã link để báo cáo mạng affiliate khớp về bài.
 */
export function appendUtm(url: string, c: UtmCtx): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const sp = u.searchParams;
  const setIfAbsent = (k: string, v?: string | null) => { if (v && !sp.get(k)) sp.set(k, v); };
  setIfAbsent("utm_source", c.channel ?? undefined);
  setIfAbsent("utm_medium", "social");
  setIfAbsent("utm_campaign", c.campaign ?? undefined);
  setIfAbsent("utm_content", c.content ?? undefined);
  if (c.subId) {
    const keys = [...sp.keys()].map((k) => k.toLowerCase());
    const net = affiliateNetwork(url);
    const isAff = Boolean(net) || AFF_KEYS.some((k) => keys.includes(k)) || sp.get("utm_source") === "accesstrade" || u.pathname.includes("an_redir");
    if (isAff) {
      const existing = [...(net ? [net.param] : []), ...SUB_KEYS].find((k) => sp.has(k));
      if (!existing) sp.set(net?.param ?? "sub_id", c.subId);
      else if (!sp.get(existing)) sp.set(existing, c.subId); // có khoá nhưng rỗng → điền
    }
  }
  return u.toString();
}

// ---------------- Link đo (track_link) ----------------
const ALPHA = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(len = 8): string {
  const b = randomBytes(len);
  return Array.from(b, (x) => ALPHA[x % ALPHA.length]).join("");
}
const campaignOf = (goal?: Row) => (goal ? `${slugify(String(goal.title ?? ""))}-${String(goal.id).slice(-6)}` : null);

/** Bài đăng của 1 link (khi link tạo trước lúc có bài — đăng qua Chrome). */
export function postOfLink(link: Row): string | null {
  if (link.post_id) return link.post_id;
  if (!link.content_item_id) return null;
  return q.get<Row>("SELECT id FROM post WHERE content_item_id = ? ORDER BY published_at DESC LIMIT 1", link.content_item_id)?.id ?? null;
}

export interface LinkTarget {
  bizId: string; url: string; postId?: string | null; contentItemId?: string | null; goalId?: string | null; productKey?: string | null; channel?: string | null;
}
/** 1 link đo cho mỗi (bài | nội dung, đường dẫn đích) — idempotent; gắn post_id khi đã biết. */
export function ensureTrackLink(t: LinkTarget): Row {
  const where = t.postId ? ["post_id = ?", t.postId] : t.contentItemId ? ["content_item_id = ? AND post_id IS NULL", t.contentItemId] : ["post_id IS NULL AND content_item_id IS NULL", null];
  const existing = q.get<Row>(`SELECT * FROM track_link WHERE biz_id = ? AND target_url = ? AND ${where[0]} ORDER BY created_at LIMIT 1`, ...[t.bizId, t.url, ...(where[1] ? [where[1]] : [])]);
  if (existing) return existing;
  let code = newCode();
  while (q.get("SELECT id FROM track_link WHERE code = ?", code)) code = newCode();
  return insert("track_link", {
    biz_id: t.bizId, code, post_id: t.postId ?? null, content_item_id: t.contentItemId ?? null, goal_id: t.goalId ?? null,
    product_key: t.productKey ?? null, channel: t.channel ?? null, target_url: t.url,
  });
}

/** Gắn các link đo của 1 nội dung vào bài vừa đăng (gọi sau khi có bài). */
export function bindTrackLink(contentItemId: string, postId: string) {
  q.run("UPDATE track_link SET post_id = ?, updated_at = ? WHERE content_item_id = ? AND post_id IS NULL", postId, nowIso(), contentItemId);
}

/** URL đích (link gốc + UTM + sub-id) của 1 link đo. */
export function destinationUrl(link: Row): string {
  const goal = link.goal_id ? byId<Row>("goal", link.goal_id) : undefined;
  return appendUtm(link.target_url, { channel: link.channel, campaign: campaignOf(goal) ?? link.product_key ?? "taki", content: postOfLink(link) ?? link.code, subId: link.code });
}

/**
 * Link đưa vào bình luận / tin nhắn: `${PUBLIC_BASE_URL}/r/<mã>` khi có địa chỉ ổn định + cổng công khai đang chạy;
 * ngược lại link gốc + UTM (+ sub-id). Mỗi (bài, link) chỉ có 1 mã.
 */
export function trackedUrlFor(t: LinkTarget): string {
  const link = ensureTrackLink(t);
  if (t.postId && !link.post_id) { update("track_link", link.id, { post_id: t.postId }); link.post_id = t.postId; }
  const base = trackingBase();
  return base ? `${base}/r/${link.code}` : destinationUrl(link);
}

// ---------------- Click ----------------
/** Muối băm IP: TRACK_SALT, hoặc muối ngẫu nhiên lưu trong cài đặt biz (không bao giờ lưu IP thô). */
function saltFor(bizId: string): string {
  if (process.env.TRACK_SALT) return process.env.TRACK_SALT;
  const s = bizSettings(bizId) as any;
  if (s.trackSalt) return s.trackSalt;
  const salt = randomBytes(16).toString("hex");
  const raw = q.get<Row>("SELECT settings FROM biz WHERE id = ?", bizId)?.settings ?? {};
  update("biz", bizId, { settings: { ...raw, trackSalt: salt } });
  return salt;
}
export const hashIp = (bizId: string, ip?: string | null) => (ip ? sha256(`${saltFor(bizId)}:${ip}`).slice(0, 32) : null);

/** Trình thu thập xem trước link / công cụ tự động — không phải khách bấm. */
const BOT_UA = /bot\b|bot\/|crawl|spider|preview|facebookexternalhit|facebookcatalog|facebot|slurp|embedly|whatsapp|skypeuripreview|zalo(bot|preview)|headless|curl\/|wget\/|python-requests|okhttp|go-http-client|java\//i;
export const isBotUserAgent = (ua?: string | null) => !ua || BOT_UA.test(ua);
const DEDUPE_MS = 10_000;
/** Kênh email gắn vào đây (email/events.ts onEmailLinkClick) — tránh import vòng tracking ↔ email. */
let emailClickHook: ((link: Row, counted: boolean) => void) | null = null;
export function setEmailClickHook(fn: (link: Row, counted: boolean) => void) { emailClickHook = fn; }

/**
 * Ghi 1 click và trả URL đích (302). Mã không tồn tại → undefined.
 * Bot (xem trước link): vẫn chuyển hướng nhưng ghi is_bot=1 (không tính). Cùng IP băm bấm lại trong 10 giây: không ghi thêm.
 */
export function recordClick(code: string, req: { ip?: string | null; ua?: string | null; referer?: string | null }): { url: string; linkId: string; counted: boolean } | undefined {
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return undefined;
  const link = q.get<Row>("SELECT * FROM track_link WHERE code = ?", code);
  if (!link) return undefined;
  if (!link.post_id) {
    const pid = postOfLink(link);
    if (pid) { update("track_link", link.id, { post_id: pid }); link.post_id = pid; }
  }
  const bot = isBotUserAgent(req.ua);
  const ipHash = hashIp(link.biz_id, req.ip);
  let counted = !bot;
  if (counted && ipHash) {
    const since = new Date(Date.now() - DEDUPE_MS).toISOString();
    if (q.get("SELECT id FROM track_click WHERE link_id = ? AND ip_hash = ? AND is_bot = 0 AND at >= ?", link.id, ipHash, since)) counted = false;
  }
  if (counted || bot) {
    insert("track_click", {
      biz_id: link.biz_id, link_id: link.id, at: nowIso(), ip_hash: ipHash, is_bot: bot ? 1 : 0,
      ua: req.ua ? String(req.ua).slice(0, 300) : null, referer: req.referer ? String(req.referer).slice(0, 500) : null,
    });
  }
  // Link trong email: đích đã gắn sẵn UTM lúc gửi; đánh dấu thư + người nhận đã click.
  if (link.meta?.emailMessageId) {
    try { emailClickHook?.(link, counted); } catch { /* không chặn chuyển hướng */ }
    return { url: link.target_url, linkId: link.id, counted };
  }
  return { url: destinationUrl(link), linkId: link.id, counted };
}

/** Số click (khách thật) của 1 bài: link gắn bài, hoặc link của nội dung chưa gắn bài. */
export function clicksForPost(post: Row, since?: string): number {
  return q.scalar<number>(
    `SELECT COUNT(*) FROM track_click c JOIN track_link l ON l.id = c.link_id
     WHERE c.is_bot = 0 AND (l.post_id = ? OR (l.post_id IS NULL AND l.content_item_id IS NOT NULL AND l.content_item_id = ?)) ${since ? "AND c.at >= ?" : ""}`,
    ...(since ? [post.id, post.content_item_id ?? null, since] : [post.id, post.content_item_id ?? null]),
  ) ?? 0;
}
