import { createHmac, timingSafeEqual } from "node:crypto";
import type { CanonicalMetrics } from "@dotaka/contracts";
import { logger, seeded, sleep } from "@dotaka/shared";

/**
 * Connector interface (spec §6). A connector declares only what it can do; the Tool Layer
 * rejects tools whose method is missing. Write methods are only called from queue workers
 * via `action` rows and always carry an idempotency key.
 *
 * This build ships SANDBOX connectors for Meta/TikTok/Google Ads/Pancake/Zalo/CMS so the
 * whole flow runs without platform app review. Live adapters plug in behind the same interface.
 */
export type PlatformKey = "meta" | "tiktok" | "google_ads" | "pancake" | "zalo" | "cms" | "sheets" | "telegram";
// "zalo" is served by ZL-CRM when a live ZL-CRM connection exists (orchestrator registers a proxy connector).

export interface AdRef {
  externalId: string; dailyBudget: number | null; status: string; name: string;
  /** Ad account / advertiser the ad belongs to (TikTok needs it on every call). */
  accountExternalId?: string;
  /** Platform-specific: where the budget lives (adset/campaign/adgroup id), currency. */
  meta?: { budgetOwnerId?: string | null; currency?: string; [k: string]: unknown };
}
export interface ImportedAd {
  externalId: string; name: string; status: "active" | "paused"; dailyBudget: number | null; meta: Record<string, unknown>;
  campaign: { externalId: string; name: string; objective: string; status: "active" | "paused"; dailyBudget: number | null };
}
export interface PostRef { externalId: string; publishedAt: string; kind: string; quality?: number }

export interface Connector {
  platform: PlatformKey;
  mode: "sandbox" | "live";
  limits: { requestsPerMinute: number; concurrency: number };
  health(): Promise<{ ok: boolean; detail: string }>;
  fetchAdMetrics?(ad: AdRef, day: string): Promise<CanonicalMetrics>;
  /** One call per account for all ads × days (live platforms); preferred over fetchAdMetrics. */
  fetchAccountMetrics?(accountExternalId: string, since: string, until: string): Promise<{ adExternalId: string; day: string; metrics: CanonicalMetrics }[]>;
  /** Import campaigns/ads of an ad account. */
  listAds?(accountExternalId: string, currency?: string): Promise<ImportedAd[]>;
  updateStatus?(ad: AdRef, status: "active" | "paused", key: string): Promise<{ ok: true }>;
  updateBudget?(ad: AdRef, amount: number, key: string): Promise<{ ok: true }>;
  createAdFromPost?(spec: { postExternalId: string; name: string; dailyBudget: number; template: unknown; accountExternalId?: string; pageExternalId?: string; startPaused?: boolean; currency?: string }, key: string): Promise<{ externalId: string; campaignExternalId: string; status?: "active" | "paused"; meta?: Record<string, unknown> }>;
  /** `media`: local file of the post (video/image from Video Flow or upload). */
  publishPost?(spec: { channelExternalId: string; text: string; kind: string; media?: PostMedia }, key: string): Promise<{ externalId: string; permalink: string }>;
  /** Comment on a published post as the Page. */
  postComment?(spec: { postExternalId: string; text: string }, key: string): Promise<{ externalId: string; permalink?: string }>;
  /** Public reply right under a customer's comment (Facebook: POST /{comment-id}/comments as the Page). */
  replyToComment?(spec: { commentExternalId: string; text: string }, key: string): Promise<{ externalId: string }>;
  /** Private Reply: one inbox message to the commenter (recipient {comment_id}), once per comment, within 7 days. Returns the PSID. */
  privateReply?(spec: { commentExternalId: string; text: string }, key: string): Promise<{ recipientId: string; messageId: string }>;
  /** New comments of a post (fallback when there is no webhook). since = ISO time. */
  listComments?(spec: { postExternalId: string; since?: string }): Promise<FeedComment[]>;
  /** Messenger threads of the Page, newest first (since = stop paging older than this). */
  listConversations?(spec: { pageId: string; since?: string; limit: number }): Promise<MessengerThread[]>;
  /** Messages of one thread, newest first. */
  listConversationMessages?(threadId: string, spec: { pageId: string; since?: string; limit: number }): Promise<MessengerSyncMessage[]>;
  /** Recent posts on the Page (also ones posted outside this system) — to scan their comments. */
  listPagePosts?(spec: { pageId: string; since?: string; limit: number }): Promise<{ id: string; message: string | null; permalink: string | null; createdTime: string | null }[]>;
  verifyPost?(externalId: string): Promise<boolean>;
  fetchPostMetrics?(post: PostRef, mark: "1h" | "6h" | "24h" | "72h"): Promise<{ reach: number; reactions: number; comments: number; shares: number; saves: number }>;
  sendMessage?(spec: { conversationExternalId: string; text: string }, key: string): Promise<{ externalId: string }>;
  /** Upload a finished video as a DRAFT the channel owner publishes manually
   *  (live equivalents: TikTok Content Posting "inbox" upload, Facebook unpublished video, YouTube private). */
  uploadDraft?(spec: { channelExternalId: string; videoPath: string; caption: string }, key: string): Promise<{ externalId: string; draftUrl: string }>;
}

// Own module: meta/create.ts extends it at load time, which a circular import through this file would break.
export { ConnectorError } from "./errors.ts";
export type PostMedia = { path: string; mime: string };
/** One Messenger message read through Graph (mid = message id, same as the webhook's message.mid). */
export type MessengerSyncMessage = { mid: string; text: string; fromPage: boolean; createdTime: string; hasAttachment: boolean };
/** One Messenger thread: the customer is the participant who is not the Page (psid = page-scoped id). */
export type MessengerThread = {
  threadId: string; updatedTime: string; customer: { psid: string; name: string | null };
  messages: MessengerSyncMessage[]; hasMoreMessages: boolean;
};
/** One comment read from the platform (webhook feed or polling). */
export type FeedComment = { commentId: string; postId: string; parentId?: string | null; fromId?: string | null; fromName?: string | null; message: string; createdTime?: string | null };
import { ConnectorError } from "./errors.ts";

// ---------------- Sandbox implementations ----------------
const done = new Map<string, unknown>(); // idempotency ledger (a real platform dedupes by key/name)
async function once<T>(key: string, fn: () => T): Promise<T> {
  if (done.has(key)) return done.get(key) as T;
  await sleep(40 + Math.random() * 80);
  const r = fn();
  done.set(key, r);
  return r;
}

function sandboxAds(platform: "meta" | "tiktok" | "google_ads"): Connector {
  const cpmBase = { meta: 55_000, tiktok: 38_000, google_ads: 70_000 }[platform];
  return {
    platform,
    mode: "sandbox",
    limits: { requestsPerMinute: 200, concurrency: 4 },
    async health() {
      return { ok: true, detail: "Sandbox — dữ liệu mô phỏng" };
    },
    async fetchAdMetrics(ad, day) {
      if (ad.status !== "active" || !ad.dailyBudget) return { spend: 0, impressions: 0, clicks: 0, results: 0, reach: 0 };
      // Each ad has a stable "quality"; some ads are deliberately bad so rules have something to do.
      const quality = seeded(`q:${ad.externalId}`);
      const noise = 0.75 + seeded(`${ad.externalId}:${day}`) * 0.5;
      const spend = Math.round((ad.dailyBudget * (0.7 + 0.3 * seeded(`s:${ad.externalId}:${day}`))) / 1000) * 1000;
      const impressions = Math.round((spend / cpmBase) * 1000 * noise);
      const ctr = 0.006 + quality * 0.018;
      const clicks = Math.round(impressions * ctr);
      const cvr = quality < 0.15 ? 0 : 0.008 + quality * 0.035;
      const results = Math.round(clicks * cvr * noise);
      return { spend, impressions, clicks, results, reach: Math.round(impressions * 0.72) };
    },
    async updateStatus(_ad, _status, key) {
      return once(key, () => ({ ok: true as const }));
    },
    async updateBudget(_ad, amount, key) {
      if (amount <= 0) throw new ConnectorError("InvalidRequest", "Ngân sách phải > 0");
      return once(key, () => ({ ok: true as const }));
    },
    async createAdFromPost(spec, key) {
      return once(key, () => ({ externalId: `${platform}_ad_${key.slice(-10)}`, campaignExternalId: `${platform}_cmp_${key.slice(-8)}` }));
    },
    // Demo account for sandbox connections: stable campaigns/ads so the whole ads flow can be tested.
    async listAds(accountExternalId) {
      const seedName = accountExternalId.slice(-4);
      const camps = [
        { n: "AI Business System — Tin nhắn", b: [2_000_000, 1_500_000] },
        { n: "Scale Camp — Lead form", b: [3_000_000] },
        { n: "AI Plus miễn phí — Remarketing", b: [800_000, 1_200_000] },
      ];
      return camps.flatMap((c, ci) => c.b.map((budget, ai): ImportedAd => ({
        externalId: `${accountExternalId}_ad_${ci}${ai}`, name: `[Demo ${seedName}] ${c.n} #${ai + 1}`, status: "active", dailyBudget: budget,
        meta: { budgetOwnerId: `${accountExternalId}_set_${ci}${ai}`, currency: "VND", sandbox: true },
        campaign: { externalId: `${accountExternalId}_cmp_${ci}`, name: `[Demo] ${c.n}`, objective: "messages", status: "active", dailyBudget: null },
      })));
    },
  };
}

function sandboxPublisher(platform: PlatformKey): Connector {
  return {
    platform,
    mode: "sandbox",
    limits: { requestsPerMinute: 60, concurrency: 2 },
    async health() {
      return { ok: true, detail: "Sandbox — đăng mô phỏng" };
    },
    async publishPost(spec, key) {
      return once(key, () => {
        const id = `${spec.channelExternalId}_${key.slice(-12)}`;
        return { externalId: id, permalink: `https://sandbox.taki.vn/p/${id}` };
      });
    },
    async verifyPost() {
      return true;
    },
    async fetchPostMetrics(post, mark) {
      const q = post.quality ?? seeded(`pq:${post.externalId}`);
      const mult = { "1h": 0.08, "6h": 0.35, "24h": 0.8, "72h": 1 }[mark];
      const reach = Math.round((3000 + q * 30000) * mult * (post.kind === "reel" || post.kind === "video" ? 1.6 : 1));
      const rate = 0.015 + q * 0.06;
      const eng = reach * rate;
      return {
        reach,
        reactions: Math.round(eng * 0.62),
        comments: Math.round(eng * 0.14),
        shares: Math.round(eng * 0.08),
        saves: Math.round(eng * 0.1),
      };
    },
    async sendMessage(spec, key) {
      return once(key, () => ({ externalId: `msg_${key.slice(-12)}` }));
    },
    async uploadDraft(spec, key) {
      return once(key, () => {
        const id = `draft_${platform}_${key.slice(-10)}`;
        return { externalId: id, draftUrl: `https://sandbox.taki.vn/drafts/${platform}/${id}` };
      });
    },
  };
}

// ---------------- Telegram (live when a Telegram connection or env token is configured) ----------------
let telegramResolver: () => { token: string; chatId: string } | null = () => null;
/** The orchestrator registers a resolver that reads the active Telegram connection from the DB. */
export function configureTelegram(fn: typeof telegramResolver) {
  telegramResolver = fn;
}
export async function sendTelegram(text: string, level: "urgent" | "warning" | "info" = "info"): Promise<boolean> {
  const conf = telegramResolver();
  const token = conf?.token ?? process.env.TELEGRAM_BOT_TOKEN;
  const chat = conf?.chatId ?? process.env.TELEGRAM_CHAT_ID;
  const icon = { urgent: "🚨", warning: "⚠️", info: "ℹ️" }[level];
  if (!token || !chat) {
    logger.info("telegram.sandbox", { severity: level, text });
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `${icon} ${text}` }),
    });
    return r.ok;
  } catch (e) {
    logger.warn("telegram.failed", { error: String(e) });
    return false;
  }
}

// ---------------- Webhook signature (HMAC-SHA256) ----------------
export function signWebhook(body: string, secret = process.env.WEBHOOK_SECRET ?? "dev-webhook-secret"): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}
export function verifyWebhook(body: string, signature: string | undefined, secret = process.env.WEBHOOK_SECRET ?? "dev-webhook-secret"): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signWebhook(body, secret));
  const got = Buffer.from(signature.replace(/^sha256=/, ""));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

// ---------------- Registry ----------------
const registry = new Map<PlatformKey, Connector>([
  ["meta", { ...sandboxAds("meta"), ...pick(sandboxPublisher("meta"), ["publishPost", "verifyPost", "fetchPostMetrics", "uploadDraft"]) }],
  ["tiktok", { ...sandboxAds("tiktok"), ...pick(sandboxPublisher("tiktok"), ["publishPost", "verifyPost", "fetchPostMetrics", "uploadDraft"]) }],
  ["google_ads", sandboxAds("google_ads")],
  ["pancake", sandboxPublisher("pancake")],
  ["zalo", sandboxPublisher("zalo")],
  ["cms", sandboxPublisher("cms")],
]);
function pick<T extends object>(o: T, keys: (keyof T)[]): Partial<T> {
  return Object.fromEntries(keys.map((k) => [k, o[k]])) as Partial<T>;
}

export function connector(platform: PlatformKey): Connector {
  const c = registry.get(platform);
  if (!c) throw new ConnectorError("InvalidRequest", `Chưa có connector cho ${platform}`);
  return c;
}
export function registerConnector(c: Connector) {
  registry.set(c.platform, c);
}
/** Which platform publishes to a given content channel. */
export function platformForChannel(channel: string): PlatformKey {
  if (channel === "tiktok") return "tiktok";
  if (channel === "zalo") return "zalo";
  if (channel === "website") return "cms";
  return "meta"; // facebook, instagram, messenger
}

export * from "./catalog.ts";
export * as live from "./live.ts";
export { minorFactor, spreadsheetIdOf } from "./live.ts";
