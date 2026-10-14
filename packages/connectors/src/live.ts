import { createSign } from "node:crypto";
import type { CanonicalMetrics } from "@dotaka/contracts";
import { ConnectorError, type AdRef, type Connector, type CreatedCampaign, type ImportedAd } from "./index.ts";
import { graphAll, graphGet, graphPost } from "./meta/graph.ts";
import { CONVERSION_EVENTS, OBJECTIVE, toObjective } from "./meta/objectives.ts";
import { buildTargeting, estimateReach, listPixels, searchInterests, searchLocations, templateTargeting } from "./meta/targeting.ts";
import { AdCreateError, StructureCreateError, activateBoost, activateStructure, cleanupPartial, cleanupStructure, createBoost, createCampaignStructure, readDailyBudget, readStatus, storyIdOf, validateBoost, type BoostSpec, type CreatedAd, type CreatedStructure } from "./meta/create.ts";
import { FIT_LABEL, assessPosts, fetchPostsDetailed } from "./meta/posts.ts";
export { metaPageConnector } from "./meta/page.ts";
export { instagramConnector } from "./meta/instagram.ts";
export { tiktokError, tiktokPostConnector, tiktokPostTest } from "./tiktok-post.ts";
export * from "./oauth.ts";
export { googleAdsConnector, googleAdsTest, type GoogleAdsCreds } from "./google/ads.ts";
export { wordpressConnector, wordpressTest, wpSiteUrl, type WordpressCreds } from "./wordpress.ts";
import { CONVERSION_ACTIONS, RESULT_SETTING, countConversions, mapObjective } from "./meta/conversions.ts";

/**
 * Live platform adapters. Each takes decrypted credentials (never logged) and speaks the
 * platform's public API. Errors are mapped to ConnectorError kinds so the queue can decide
 * retry (Transient/RateLimited) vs. dead-letter (Auth/InvalidRequest/PolicyRejected).
 */
const TIMEOUT = 25_000;

/** Lỗi mạng xảy ra TRƯỚC khi gửi được byte nào (chưa mở được kết nối) — mã lỗi của Node/undici. */
const NOT_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
function failedBeforeSend(e: unknown): boolean {
  const code = (e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code;
  return Boolean(code && NOT_SENT_CODES.has(code));
}

async function http(url: string, init: RequestInit & { label: string; classify?: (text: string, status: number) => ConnectorError | undefined }): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    // requestNotSent = chắc chắn yêu cầu CHƯA tới máy chủ (từ chối kết nối / không phân giải tên miền) → gửi lại an toàn.
    // Hết thời gian chờ / mất kết nối giữa chừng: có thể máy chủ đã nhận → bên gọi phải coi là "không rõ kết quả".
    throw Object.assign(new ConnectorError("Transient", `${init.label}: không kết nối được (${e instanceof Error ? e.message : e})`), { requestNotSent: failedBeforeSend(e) });
  }
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok && init.classify) {
    const known = init.classify(text, res.status);
    if (known) throw known;
  }
  if (res.status === 429) throw new ConnectorError("RateLimited", `${init.label}: bị giới hạn tần suất, thử lại sau`);
  if (res.status >= 500) throw new ConnectorError("Transient", `${init.label}: lỗi máy chủ ${res.status}`);
  if (!res.ok) {
    const msg = body?.error?.message ?? (typeof body?.error === "string" ? body.error : undefined) ?? body?.error_description ?? body?.message ?? body?.description ?? String(text).slice(0, 200);
    throw new ConnectorError(res.status === 401 || res.status === 403 ? "AuthError" : "InvalidRequest", `${init.label}: ${msg}`);
  }
  return body;
}

/** Currencies without minor units: Meta/TikTok budgets are sent in whole units. */
const ZERO_DECIMAL = new Set(["VND", "JPY", "KRW", "CLP", "ISK", "PYG", "TWD", "HUF", "IDR", "COP"]);
export const minorFactor = (cur = "VND") => (ZERO_DECIMAL.has(cur.toUpperCase()) ? 1 : 100);

// =====================================================================================
// Meta (Graph API) — transport, objectives, targeting, boost chain and post scoring live in ./meta/
// (ported from TakiAcademy-AI/ads-os, whose write path was verified on real ad accounts).
// =====================================================================================
export type MetaCreds = { access_token: string };

export async function metaTest(c: MetaCreds) {
  const me = await graphGet(c.access_token, "me", { fields: "id,name" });
  return { accountId: String(me.id), name: String(me.name ?? me.id) };
}
/**
 * Tìm tài sản của token: tài khoản quảng cáo, Fanpage (+ token Trang) và tài khoản Instagram Business gắn với Trang.
 * Phòng thủ: lỗi ở một nhánh KHÔNG BAO GIỜ làm mất danh sách Trang đã có — Instagram lấy bằng lời gọi RIÊNG (token thiếu
 * `instagram_basic` thì chỉ không có Instagram, Trang vẫn đủ). `tolerant` (token đăng nhập bằng nút): thiếu quyền quảng cáo
 * không làm kết nối thất bại, và gom thêm Trang nằm trong Business Manager (không hiện ở me/accounts).
 */
export async function metaDiscover(c: MetaCreds, opts: { tolerant?: boolean } = {}) {
  const t = c.access_token;
  const adAccountsP = graphAll(t, "me/adaccounts", { fields: "id,name,currency,account_status,business_name", limit: 200 });
  const [adAccounts, basePages, igRows, bmPages] = await Promise.all([
    opts.tolerant ? adAccountsP.catch(() => [] as any[]) : adAccountsP,
    graphAll(t, "me/accounts", { fields: "id,name,category,access_token", limit: 100 }, 5).catch(() => [] as any[]),
    graphAll(t, "me/accounts", { fields: "id,username,instagram_business_account{id,username,name}", limit: 100 }, 5).catch(() => [] as any[]),
    opts.tolerant ? businessPages(t) : Promise.resolve([] as any[]),
  ]);
  const seen = new Set<string>(basePages.map((p) => String(p.id)));
  const pages = [...basePages, ...bmPages.filter((p) => p?.id && !seen.has(String(p.id)) && seen.add(String(p.id)))];
  const extra = new Map<string, any>(igRows.map((r) => [String(r.id), r]));
  return {
    adAccounts: adAccounts.map((a) => ({ externalId: String(a.id), name: String(a.name ?? a.id), currency: String(a.currency ?? "VND"), active: a.account_status === 1, business: a.business_name ?? null })),
    pages: pages.map((p) => ({ externalId: String(p.id), name: String(p.name), category: p.category ?? null, token: p.access_token as string | undefined, username: (extra.get(String(p.id))?.username as string | undefined) ?? undefined })),
    instagram: pages.flatMap((p) => {
      const ig = extra.get(String(p.id))?.instagram_business_account;
      return ig?.id && p.access_token ? [{ externalId: String(ig.id), name: ig.username ? `@${ig.username}` : String(ig.name ?? ig.id), username: ig.username ? String(ig.username) : undefined, token: String(p.access_token), pageId: String(p.id) }] : [];
    }),
  };
}
/** Trang nằm trong Business Manager (owned_pages / client_pages) — mỗi nhánh lỗi riêng thì bỏ nhánh đó. */
async function businessPages(token: string): Promise<any[]> {
  const out: any[] = [];
  const businesses = await graphAll(token, "me/businesses", { fields: "id,name", limit: 25 }, 2).catch(() => [] as any[]);
  for (const b of businesses.slice(0, 10)) {
    for (const edge of ["owned_pages", "client_pages"]) {
      out.push(...(await graphAll(token, `${b.id}/${edge}`, { fields: "id,name,category,access_token", limit: 100 }, 3).catch(() => [] as any[])));
    }
  }
  return out;
}
/** Recent Page posts with an ads-os fitness verdict per objective (Tin nhắn / Tương tác / Chuyển đổi). */
export async function metaPagePosts(pageId: string, pageToken: string, limit = 25) {
  const { posts, note, medianEngagement } = assessPosts(await fetchPostsDetailed(pageToken, pageId, limit));
  return posts.map((p) => ({
    externalId: p.id, text: p.message || "(không có chữ)", createdAt: p.createdTime, image: p.image, permalink: p.permalink, kind: p.fitness.kind,
    engagement: p.fitness.engagement, best: p.best, externalLink: p.fitness.externalLink,
    fitness: Object.fromEntries(Object.entries(p.fitness.byObjective).map(([k, v]) => [k, { verdict: v.verdict, label: FIT_LABEL[v.verdict], reason: v.reason }])),
    pageNote: note, medianEngagement,
  }));
}
/** True when this token can read every given Graph id (ad account "act_…", Page id…). Read-only, used to pick the right token. */
export async function metaCanAccess(token: string, ids: string[]): Promise<boolean> {
  try {
    for (const id of ids) await graphGet(token, id, { fields: "id" });
    return true;
  } catch {
    return false;
  }
}
export { CONVERSION_EVENTS, OBJECTIVE as META_OBJECTIVES, buildTargeting, templateTargeting, estimateReach, searchInterests, searchLocations, listPixels, validateBoost };

/** Template definition + post → the boost spec ads-os uses. */
export function metaBoostSpec(spec: { accountExternalId: string; pageExternalId: string; postExternalId: string; name: string; dailyBudget: number; currency?: string; template?: any }): BoostSpec {
  const t = spec.template ?? {};
  return {
    adAccountId: spec.accountExternalId, pageId: spec.pageExternalId, postId: storyIdOf(spec.pageExternalId, spec.postExternalId),
    campaignName: spec.name, dailyBudget: spec.dailyBudget, minorFactor: minorFactor(spec.currency),
    targeting: templateTargeting(t), objective: toObjective(t.objective), pixelId: t.pixelId ?? null, conversionEvent: t.conversionEvent ?? null,
  };
}

export function metaConnector(c: MetaCreds, config: { result_action?: string }): Connector {
  // "auto" (default): count results by each campaign's own objective, the ads-os way. Fixed settings kept for older connections.
  const fixed = config.result_action && config.result_action !== "auto" ? RESULT_SETTING[config.result_action] ?? RESULT_SETTING.messaging : null;
  const toMetrics = (r: any): CanonicalMetrics => ({
    spend: Math.round(Number(r.spend ?? 0)), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
    results: countConversions(r.actions, fixed ?? CONVERSION_ACTIONS[mapObjective(r.objective)] ?? CONVERSION_ACTIONS.messages).count, reach: Number(r.reach ?? 0),
  });
  const token = c.access_token;
  return {
    platform: "meta", mode: "live", limits: { requestsPerMinute: 60, concurrency: 2 },
    async health() {
      const me = await metaTest(c);
      return { ok: true, detail: `Token hợp lệ (${me.name})` };
    },
    async fetchAdMetrics(ad: AdRef, day: string) {
      const r = await graphGet(token, `${ad.externalId}/insights`, { fields: "spend,impressions,clicks,reach,actions,objective", time_range: { since: day, until: day } });
      return r.data?.[0] ? toMetrics(r.data[0]) : { spend: 0, impressions: 0, clicks: 0, results: 0, reach: 0 };
    },
    async fetchAccountMetrics(accountExternalId, since, until) {
      const rows = await graphAll(token, `${accountExternalId}/insights`, {
        level: "ad", fields: "ad_id,spend,impressions,clicks,reach,actions,objective", time_range: { since, until }, time_increment: 1, limit: 500,
      }, 20);
      return rows.map((r) => ({ adExternalId: String(r.ad_id), day: String(r.date_start), metrics: toMetrics(r) }));
    },
    async listAds(accountExternalId, currency = "VND") {
      const f = minorFactor(currency);
      const rows = await graphAll(token, `${accountExternalId}/ads`, {
        fields: "id,name,effective_status,adset{id,name,daily_budget},campaign{id,name,objective,daily_budget,effective_status}",
        filtering: [{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"] }], limit: 200,
      });
      return rows.map((a): ImportedAd => {
        const adsetBudget = a.adset?.daily_budget ? Number(a.adset.daily_budget) / f : null;
        const cmpBudget = a.campaign?.daily_budget ? Number(a.campaign.daily_budget) / f : null;
        return {
          externalId: String(a.id), name: String(a.name), status: a.effective_status === "ACTIVE" ? "active" : "paused",
          dailyBudget: adsetBudget ?? cmpBudget,
          meta: { adsetId: a.adset?.id, budgetOwner: adsetBudget != null ? "adset" : cmpBudget != null ? "campaign" : null, budgetOwnerId: adsetBudget != null ? a.adset?.id : a.campaign?.id, currency },
          campaign: { externalId: String(a.campaign?.id ?? "unknown"), name: String(a.campaign?.name ?? "Chiến dịch"), objective: String(a.campaign?.objective ?? "unknown"), status: a.campaign?.effective_status === "ACTIVE" ? "active" : "paused", dailyBudget: cmpBudget },
        };
      });
    },
    async updateStatus(ad, status) {
      const want = status === "active" ? "ACTIVE" : "PAUSED";
      await graphPost(token, ad.externalId, { status: want });
      // Trust the data, not the write response (ads-os): a null read is tolerated, a different status is not.
      const now = await readStatus(token, ad.externalId);
      if (now && now !== want) throw new ConnectorError("InvalidRequest", `Meta: đã gửi lệnh ${want === "ACTIVE" ? "bật" : "tắt"} nhưng đọc lại thấy trạng thái ${now}`);
      return { ok: true };
    },
    async updateBudget(ad, amount) {
      const owner = ad.meta?.budgetOwnerId;
      if (!owner) throw new ConnectorError("InvalidRequest", "Quảng cáo này không có ngân sách ngày ở nhóm/chiến dịch (có thể dùng ngân sách trọn đời)");
      const value = Math.round(amount * minorFactor(ad.meta?.currency));
      if (!(value > 0)) throw new ConnectorError("InvalidRequest", "Ngân sách phải lớn hơn 0");
      await graphPost(token, owner, { daily_budget: String(value) });
      const now = await readDailyBudget(token, owner);
      if (now != null && now !== value) throw new ConnectorError("InvalidRequest", `Meta: đã gửi ngân sách ${value} nhưng đọc lại thấy ${now}`);
      return { ok: true };
    },
    async createCampaignFromPosts(spec): Promise<CreatedCampaign> {
      if (!spec.accountExternalId || !spec.pageExternalId) throw new ConnectorError("InvalidRequest", "Thiếu tài khoản quảng cáo hoặc Fanpage");
      const t: any = spec.template ?? {};
      const objective = toObjective(t.objective);
      const pageId = spec.pageExternalId;
      const structure = {
        adAccountId: spec.accountExternalId, pageId, campaignName: spec.name, minorFactor: minorFactor(spec.currency),
        objective, pixelId: t.pixelId ?? null, conversionEvent: t.conversionEvent ?? null,
        postIds: spec.posts.map((p) => storyIdOf(pageId, p.postExternalId)),
        adsets: spec.adsets.map((a) => ({ name: a.name, dailyBudget: a.dailyBudget, targeting: templateTargeting(a.template ?? spec.template ?? {}) })),
      };
      let created: CreatedStructure;
      try {
        created = await createCampaignStructure(token, structure);
      } catch (e) {
        if (e instanceof StructureCreateError) await cleanupStructure(token, e.created);
        throw e;
      }
      const meta: Record<string, unknown> = { objective, currency: spec.currency ?? "VND" };
      let status: "active" | "paused" = "paused";
      if (!spec.startPaused) {
        // The whole structure exists (paused); switch it on. A failure leaves it paused — reported, not hidden.
        try { status = (await activateStructure(token, created)) === "PAUSED" ? "paused" : "active"; } catch (e) { meta.activationError = e instanceof Error ? e.message : String(e); }
      }
      return {
        campaignExternalId: created.campaignId, status, meta,
        adsets: created.adsets.map((a, i) => ({
          externalId: a.adsetId, name: spec.adsets[i].name?.trim() || `${spec.name} — nhóm ${i + 1}`, dailyBudget: a.dailyBudget,
          ads: a.ads.map((ad, j) => ({ externalId: ad.adId, postExternalId: spec.posts[j].postExternalId, name: `${spec.adsets[i].name?.trim() || `${spec.name} — nhóm ${i + 1}`} — bài ${j + 1}` })),
        })),
      };
    },
    async createAdFromPost(spec) {
      if (!spec.accountExternalId || !spec.pageExternalId) throw new ConnectorError("InvalidRequest", "Thiếu tài khoản quảng cáo hoặc Fanpage");
      const boost = metaBoostSpec({ ...spec, accountExternalId: spec.accountExternalId, pageExternalId: spec.pageExternalId });
      let created: CreatedAd;
      try {
        created = await createBoost(token, boost);
      } catch (e) {
        if (e instanceof AdCreateError) await cleanupPartial(token, e.created);
        throw e;
      }
      const meta = { adsetId: created.adsetId, creativeId: created.creativeId, budgetOwner: "adset", budgetOwnerId: created.adsetId, currency: spec.currency ?? "VND", objective: boost.objective };
      if (spec.startPaused) return { externalId: created.adId, campaignExternalId: created.campaignId, status: "paused", meta };
      // Started on request: the chain exists (paused), now switch it on. If that fails the ad stays paused — reported, not hidden.
      try {
        const st = await activateBoost(token, created);
        return { externalId: created.adId, campaignExternalId: created.campaignId, status: st && st !== "ACTIVE" ? "paused" : "active", meta };
      } catch (e) {
        return { externalId: created.adId, campaignExternalId: created.campaignId, status: "paused", meta: { ...meta, activationError: e instanceof Error ? e.message : String(e) } };
      }
    },
  };
}

// =====================================================================================
// TikTok Business API v1.3
// =====================================================================================
const TT = "https://business-api.tiktok.com/open_api/v1.3";
export type TikTokCreds = { access_token: string };
async function tt(token: string, path: string, params: Record<string, unknown> = {}, method: "GET" | "POST" = "GET") {
  let r: any;
  if (method === "GET") {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
    r = await http(`${TT}${path}?${qs}`, { label: "TikTok", headers: { "Access-Token": token } });
  } else {
    r = await http(`${TT}${path}`, { label: "TikTok", method, headers: { "Access-Token": token, "content-type": "application/json" }, body: JSON.stringify(params) });
  }
  if (r?.code !== 0) throw new ConnectorError(r?.code === 40105 || r?.code === 40100 ? "AuthError" : "InvalidRequest", `TikTok: ${r?.message ?? "lỗi không rõ"} (code ${r?.code})`);
  return r.data;
}
export async function tiktokTest(c: TikTokCreds, advertiserIds: string[]) {
  const info = await tt(c.access_token, "/advertiser/info/", { advertiser_ids: advertiserIds });
  const list = (info?.list ?? []) as any[];
  if (!list.length) throw new ConnectorError("AuthError", "TikTok: token không có quyền với Advertiser ID đã nhập");
  return list.map((a) => ({ externalId: String(a.advertiser_id), name: String(a.name ?? a.advertiser_id), currency: String(a.currency ?? "VND"), active: String(a.status ?? "").includes("ENABLE") }));
}
export function tiktokConnector(c: TikTokCreds): Connector {
  const toMetrics = (m: any): CanonicalMetrics => ({ spend: Math.round(Number(m.spend ?? 0)), impressions: Number(m.impressions ?? 0), clicks: Number(m.clicks ?? 0), results: Number(m.conversion ?? 0), reach: Number(m.reach ?? 0) });
  const advertiserOf = (ad: AdRef) => {
    if (!ad.accountExternalId) throw new ConnectorError("InvalidRequest", "Thiếu advertiser_id");
    return ad.accountExternalId;
  };
  return {
    platform: "tiktok", mode: "live", limits: { requestsPerMinute: 30, concurrency: 2 },
    async health() {
      await tt(c.access_token, "/user/info/");
      return { ok: true, detail: "Token TikTok hợp lệ" };
    },
    async fetchAccountMetrics(advertiserId, since, until) {
      const out: { adExternalId: string; day: string; metrics: CanonicalMetrics }[] = [];
      for (let page = 1; page <= 20; page++) {
        const d = await tt(c.access_token, "/report/integrated/get/", {
          advertiser_id: advertiserId, report_type: "BASIC", data_level: "AUCTION_AD", dimensions: ["ad_id", "stat_time_day"],
          metrics: ["spend", "impressions", "clicks", "reach", "conversion"], start_date: since, end_date: until, page, page_size: 1000,
        });
        for (const r of d?.list ?? []) out.push({ adExternalId: String(r.dimensions.ad_id), day: String(r.dimensions.stat_time_day).slice(0, 10), metrics: toMetrics(r.metrics) });
        if (page >= (d?.page_info?.total_page ?? 1)) break;
      }
      return out;
    },
    async listAds(advertiserId) {
      const fetchAll = async (path: string, fields: string[]) => {
        const out: any[] = [];
        for (let page = 1; page <= 20; page++) {
          const d = await tt(c.access_token, path, { advertiser_id: advertiserId, fields, page, page_size: 1000 });
          out.push(...(d?.list ?? []));
          if (page >= (d?.page_info?.total_page ?? 1)) break;
        }
        return out;
      };
      const [cmps, groups, ads] = await Promise.all([
        fetchAll("/campaign/get/", ["campaign_id", "campaign_name", "objective_type", "budget", "budget_mode", "operation_status"]),
        fetchAll("/adgroup/get/", ["adgroup_id", "campaign_id", "budget", "budget_mode"]),
        fetchAll("/ad/get/", ["ad_id", "ad_name", "adgroup_id", "campaign_id", "operation_status"]),
      ]);
      const cm = new Map(cmps.map((x) => [String(x.campaign_id), x]));
      const gm = new Map(groups.map((x) => [String(x.adgroup_id), x]));
      return ads.map((a): ImportedAd => {
        const g = gm.get(String(a.adgroup_id));
        const cp = cm.get(String(a.campaign_id));
        const daily = g?.budget_mode === "BUDGET_MODE_DAY" ? Number(g.budget) : null;
        return {
          externalId: String(a.ad_id), name: String(a.ad_name), status: a.operation_status === "ENABLE" ? "active" : "paused", dailyBudget: daily,
          meta: { adgroupId: a.adgroup_id, budgetOwner: daily != null ? "adgroup" : null, budgetOwnerId: daily != null ? String(a.adgroup_id) : null },
          campaign: { externalId: String(a.campaign_id), name: String(cp?.campaign_name ?? "Chiến dịch"), objective: String(cp?.objective_type ?? "unknown"), status: cp?.operation_status === "ENABLE" ? "active" : "paused", dailyBudget: cp?.budget_mode === "BUDGET_MODE_DAY" ? Number(cp.budget) : null },
        };
      });
    },
    async updateStatus(ad, status) {
      await tt(c.access_token, "/ad/status/update/", { advertiser_id: advertiserOf(ad), ad_ids: [ad.externalId], operation_status: status === "active" ? "ENABLE" : "DISABLE" }, "POST");
      return { ok: true };
    },
    async updateBudget(ad, amount) {
      if (!ad.meta?.budgetOwnerId) throw new ConnectorError("InvalidRequest", "Nhóm quảng cáo không dùng ngân sách ngày");
      await tt(c.access_token, "/adgroup/budget/update/", { advertiser_id: advertiserOf(ad), budget: [{ adgroup_id: ad.meta.budgetOwnerId, budget: amount }] }, "POST");
      return { ok: true };
    },
  };
}

// =====================================================================================
// Google Sheets (service account, JWT bearer)
// =====================================================================================
export type SheetsCreds = { service_account_json: string };
const tokenCache = new Map<string, { token: string; exp: number }>();
function parseSa(json: string) {
  let sa: any;
  try { sa = JSON.parse(json); } catch { throw new ConnectorError("InvalidRequest", "Service account JSON không hợp lệ"); }
  if (!sa.client_email || !sa.private_key) throw new ConnectorError("InvalidRequest", "JSON thiếu client_email/private_key");
  return sa as { client_email: string; private_key: string };
}
async function sheetsToken(c: SheetsCreds) {
  const sa = parseSa(c.service_account_json);
  const hit = tokenCache.get(sa.client_email);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const r = await http("https://oauth2.googleapis.com/token", {
    label: "Google", method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  tokenCache.set(sa.client_email, { token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 });
  return r.access_token as string;
}
export const spreadsheetIdOf = (urlOrId: string) => urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? urlOrId.trim();

export async function sheetsTest(c: SheetsCreds, spreadsheet?: string) {
  const sa = parseSa(c.service_account_json);
  const token = await sheetsToken(c);
  if (!spreadsheet) return { accountId: sa.client_email, name: sa.client_email, title: null as string | null };
  const r = await http(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetIdOf(spreadsheet)}?fields=properties.title`, { label: "Google Sheets", headers: { authorization: `Bearer ${token}` } });
  return { accountId: sa.client_email, name: sa.client_email, title: r.properties?.title as string };
}
export async function sheetsWrite(c: SheetsCreds, spreadsheet: string, tab: string, rows: (string | number | null)[][], mode: "overwrite" | "append") {
  const token = await sheetsToken(c);
  const id = spreadsheetIdOf(spreadsheet);
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const meta = await http(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties.title`, { label: "Google Sheets", headers: auth });
  if (!(meta.sheets ?? []).some((s: any) => s.properties?.title === tab)) {
    await http(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { label: "Google Sheets", method: "POST", headers: auth, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }) });
  }
  const range = encodeURIComponent(`'${tab}'!A1`);
  if (mode === "overwrite") {
    await http(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${tab}'`)}:clear`, { label: "Google Sheets", method: "POST", headers: auth, body: "{}" });
    await http(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?valueInputOption=USER_ENTERED`, { label: "Google Sheets", method: "PUT", headers: auth, body: JSON.stringify({ values: rows }) });
  } else {
    await http(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { label: "Google Sheets", method: "POST", headers: auth, body: JSON.stringify({ values: rows }) });
  }
  return { title: meta.properties?.title as string, url: `https://docs.google.com/spreadsheets/d/${id}` };
}

// =====================================================================================
// Telegram
// =====================================================================================
export type TelegramCreds = { bot_token: string };
export async function telegramTest(c: TelegramCreds, chatId?: string) {
  const me = await http(`https://api.telegram.org/bot${c.bot_token}/getMe`, { label: "Telegram" });
  let chat: string | null = null;
  if (chatId) {
    const r = await http(`https://api.telegram.org/bot${c.bot_token}/getChat?chat_id=${encodeURIComponent(chatId)}`, { label: "Telegram" });
    chat = r.result?.title ?? r.result?.username ?? r.result?.first_name ?? chatId;
  }
  return { accountId: String(me.result.id), name: `@${me.result.username}`, chat };
}
export async function telegramSend(c: TelegramCreds, chatId: string, text: string) {
  await http(`https://api.telegram.org/bot${c.bot_token}/sendMessage`, { label: "Telegram", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) });
}

// =====================================================================================
// Pancake POS
// =====================================================================================
const POS = "https://pos.pages.fm/api/v1";
export type PancakeCreds = { api_key: string };
export async function pancakeTest(c: PancakeCreds) {
  const r = await http(`${POS}/shops?api_key=${encodeURIComponent(c.api_key)}`, { label: "Pancake POS" });
  const shops = (r.shops ?? r.data ?? []) as any[];
  if (r.success === false) throw new ConnectorError("AuthError", `Pancake POS: ${r.message ?? "API key không hợp lệ"}`);
  return shops.map((s) => ({ externalId: String(s.id), name: String(s.name ?? s.id) }));
}
export async function pancakeOrders(c: PancakeCreds, shopId: string, limit = 30) {
  // Sắp theo lần đổi gần nhất → đồng bộ trạng thái (đơn đã đẩy từ TAKI) thấy đơn vừa đổi trước.
  const r = await pancake(c, `/shops/${encodeURIComponent(shopId)}/orders`, { page_size: limit, page_number: 1, option_sort: "last_updated_order_desc" });
  return ((r.data ?? []) as any[]).map(pancakeOrderOf);
}

/*
 * ---- Tạo đơn / tìm mẫu mã (Pancake POS Open API — https://docs.pancake.biz/pos/api/, spec ./openapi.json) ----
 *  GET  /shops                                   → { shops: [{ id, name }] }
 *  GET  /shops/{SHOP_ID}/products/variations     ?search=&page_size= → { data: [{ id, product_id, display_id, retail_price, fields[], product: { name } }] }
 *  GET  /shops/{SHOP_ID}/orders                  ?search= (SĐT, tên khách, GHI CHÚ…) → { data: [order] }
 *  GET  /shops/{SHOP_ID}/orders/{ORDER_ID}       → order (một số bản bọc trong { data })
 *  POST /shops/{SHOP_ID}/orders                  body = order (xem pancakeOrderBody) → order
 * Xác thực: ?api_key=… trên mọi yêu cầu. Lỗi nghiệp vụ có thể về HTTP 200 kèm { success: false, message }.
 */
async function pancake(c: PancakeCreds, path: string, query: Record<string, string | number | undefined> = {}, body?: unknown): Promise<any> {
  const qs = new URLSearchParams({ api_key: c.api_key });
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const r = await http(`${POS}${path}?${qs}`, {
    label: "Pancake POS", method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
  if (r && typeof r === "object" && r.success === false) {
    const msg = String(r.message ?? r.error ?? "yêu cầu bị từ chối");
    throw new ConnectorError(/api.?key|unauthor|token|permission|quyền/i.test(msg) ? "AuthError" : "InvalidRequest", `Pancake POS: ${msg}`);
  }
  return r;
}

/** Mã trạng thái đơn của Pancake POS (enum `status` trong spec) → nhãn tiếng Việt cho Sếp. */
export const PANCAKE_STATUS: Record<number, string> = {
  0: "Mới", 17: "Chờ xác nhận", 11: "Chờ hàng", 12: "Chờ in", 13: "Đã in", 20: "Đã đặt hàng", 1: "Đã xác nhận",
  8: "Đang đóng hàng", 9: "Chờ lấy hàng", 2: "Đang giao", 3: "Đã nhận hàng", 16: "Đã thu tiền", 4: "Đang hoàn",
  15: "Hoàn một phần", 5: "Đã hoàn", 6: "Đã huỷ", 7: "Đã xoá",
};
export type PancakeOrder = { id: string; displayId: string | null; customer: string | null; total: number; status: string; statusCode: number | null; note: string; createdAt: string | null };
function pancakeOrderOf(o: any): PancakeOrder {
  const code = typeof o.status === "number" ? o.status : Number.isFinite(Number(o.status)) && o.status !== null && o.status !== "" ? Number(o.status) : null;
  return {
    id: String(o.id), displayId: o.display_id != null ? String(o.display_id) : null, customer: o.bill_full_name ?? o.customer?.name ?? null,
    total: Number(o.total_price ?? o.total ?? 0), status: (code != null ? PANCAKE_STATUS[code] : undefined) ?? o.status_name ?? String(o.status ?? ""),
    statusCode: code, note: String(o.note ?? ""), createdAt: o.inserted_at ?? o.created_at ?? null,
  };
}

export type PancakeVariation = { id: string; productId: string | null; name: string; sku: string | null; price: number | null; stock: number | null };
/** Tìm mẫu mã (variation) để ghép với sản phẩm trong DNA. */
export async function pancakeFindVariations(c: PancakeCreds, shopId: string, search: string, limit = 20): Promise<PancakeVariation[]> {
  const r = await pancake(c, `/shops/${encodeURIComponent(shopId)}/products/variations`, { search: search.trim() || undefined, page_size: limit, page_number: 1 });
  return ((r.data ?? []) as any[]).map((v) => {
    const attrs = ((v.fields ?? []) as any[]).map((f) => f?.value).filter(Boolean).join(" / ");
    const base = String(v.product?.name ?? v.name ?? v.display_id ?? v.id);
    return {
      id: String(v.id), productId: v.product_id != null ? String(v.product_id) : null, name: attrs ? `${base} — ${attrs}` : base,
      sku: v.display_id != null ? String(v.display_id) : null, price: v.retail_price != null ? Number(v.retail_price) : null,
      stock: v.remain_quantity != null ? Number(v.remain_quantity) : null,
    };
  });
}

/** Danh sách shop của API key (dùng chọn shop đẩy đơn). */
export async function pancakeShops(c: PancakeCreds) {
  return pancakeTest(c);
}

/** Đơn TAKI cần tạo trên Pancake (đã qua cổng duyệt [ĐỎ] của Sếp). */
export type PancakeOrderSpec = {
  /** Mã chống trùng, ghi vào ghi chú đơn: "TAKI-<id đơn nội bộ>" — dùng để tìm lại đơn khi lần gửi trước hết giờ chờ. */
  marker: string;
  fullName: string; phone: string;
  /** Hàng cần giao: địa chỉ dạng chữ. Pancake tự tách tỉnh/huyện/xã khi không gửi province_id (theo tài liệu). */
  address?: string | null; provinceId?: string | null; districtId?: string | null; communeId?: string | null;
  items: { variationId: string; productId?: string | null; name: string; quantity: number; unitPrice: number }[];
  discount: number; shippingFee: number; cod: number; note?: string | null; warehouseId?: string | null;
};

/**
 * ÁNH XẠ TRƯỜNG DUY NHẤT TAKI → Pancake POS (POST /shops/{SHOP_ID}/orders). Nếu Pancake đổi tên trường, chỉ sửa ở đây.
 *  - bill_full_name / bill_phone_number: người mua.
 *  - shipping_address: { full_name, phone_number, address, province_id?, district_id?, commune_id? } — để trống
 *    province_id thì Pancake tự phân tích `address` dạng chữ (mô tả trường `address` trong spec).
 *  - items[]: { variation_id (bắt buộc), quantity (bắt buộc), product_id?, discount_each_product, variation_info.retail_price }
 *    — gửi retail_price để giá dòng hàng đúng giá đã báo khách (spec khuyến nghị).
 *  - total_discount, shipping_fee, cod (tiền thu hộ), note (ghi chú nội bộ, chứa mã chống trùng), warehouse_id?.
 */
export function pancakeOrderBody(shopId: string, s: PancakeOrderSpec): Record<string, unknown> {
  const ship: Record<string, unknown> = { full_name: s.fullName, phone_number: s.phone };
  if (s.address) ship.address = s.address;
  if (s.provinceId) ship.province_id = s.provinceId;
  if (s.districtId) ship.district_id = s.districtId;
  if (s.communeId) ship.commune_id = s.communeId;
  const note = [s.note?.trim(), `[${s.marker}]`].filter(Boolean).join("\n");
  return {
    shop_id: /^\d+$/.test(shopId) ? Number(shopId) : shopId,
    bill_full_name: s.fullName,
    bill_phone_number: s.phone,
    shipping_address: ship,
    items: s.items.map((it) => ({
      variation_id: it.variationId,
      ...(it.productId ? { product_id: it.productId } : {}),
      quantity: it.quantity,
      discount_each_product: 0, is_bonus_product: false, is_discount_percent: false, is_wholesale: false, one_time_product: false,
      variation_info: { name: it.name, retail_price: it.unitPrice },
    })),
    total_discount: s.discount,
    shipping_fee: s.shippingFee,
    cod: s.cod,
    received_at_shop: false,
    note,
    ...(s.warehouseId ? { warehouse_id: s.warehouseId } : {}),
  };
}

/** Tạo đơn thật trên Pancake POS. `idempotencyKey` = mã chống trùng (đã nằm trong ghi chú) — Pancake không có header idempotency. */
export async function pancakeCreateOrder(c: PancakeCreds, shopId: string, spec: PancakeOrderSpec, idempotencyKey = spec.marker): Promise<PancakeOrder> {
  const body = pancakeOrderBody(shopId, { ...spec, marker: idempotencyKey });
  const r = await pancake(c, `/shops/${encodeURIComponent(shopId)}/orders`, {}, body);
  const o = r?.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : r;
  if (!o || o.id == null) throw new ConnectorError("InvalidRequest", "Pancake POS: tạo đơn không trả về mã đơn");
  return pancakeOrderOf(o);
}

/** Tìm đơn đã tạo bằng mã chống trùng trong ghi chú (tìm theo ghi chú; dự phòng tìm theo SĐT rồi lọc ghi chú). */
export async function pancakeFindOrderByMarker(c: PancakeCreds, shopId: string, marker: string, phone?: string): Promise<PancakeOrder | null> {
  for (const search of [marker, phone].filter(Boolean) as string[]) {
    const r = await pancake(c, `/shops/${encodeURIComponent(shopId)}/orders`, { search, page_size: 50, page_number: 1 });
    const hit = ((r.data ?? []) as any[]).map(pancakeOrderOf).find((o) => o.note.includes(marker));
    if (hit) return hit;
  }
  return null;
}

/** 1 đơn theo mã Pancake (đồng bộ trạng thái). */
export async function pancakeGetOrder(c: PancakeCreds, shopId: string, orderId: string): Promise<PancakeOrder | null> {
  try {
    const r = await pancake(c, `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}`);
    const o = r?.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : r;
    return o?.id != null ? pancakeOrderOf(o) : null;
  } catch (e) {
    if (e instanceof ConnectorError && e.kind === "InvalidRequest" && /not.?found|không tìm thấy|404/i.test(e.message)) return null;
    throw e;
  }
}

// =====================================================================================
// Nhanh.vn (API v2.0, form-encoded)
// =====================================================================================
export type NhanhCreds = { app_id: string; business_id: string; access_token: string };
async function nhanh(c: NhanhCreds, path: string, data: unknown) {
  const base = process.env.NHANH_API_BASE ?? "https://open.nhanh.vn/api";
  const r = await http(`${base}${path}`, {
    label: "Nhanh.vn", method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ version: "2.0", appId: c.app_id, businessId: c.business_id, accessToken: c.access_token, data: JSON.stringify(data) }),
  });
  if (r?.code !== 1) throw new ConnectorError("AuthError", `Nhanh.vn: ${(r?.messages ?? []).join?.(", ") || r?.message || "lỗi không rõ"}`);
  return r.data;
}
export async function nhanhTest(c: NhanhCreds) {
  const d = await nhanh(c, "/order/index", { page: 1, icpp: 1 });
  return { accountId: c.business_id, name: `Doanh nghiệp ${c.business_id}`, totalOrders: Number(d?.totalRecords ?? 0) };
}
export async function nhanhOrders(c: NhanhCreds, limit = 30) {
  const d = await nhanh(c, "/order/index", { page: 1, icpp: limit });
  return Object.values(d?.orders ?? {}).map((o: any) => ({ id: String(o.id), customer: o.customerName ?? null, total: Number(o.calcTotalMoney ?? o.totalMoney ?? 0), status: o.statusName ?? o.statusCode, createdAt: o.createdDateTime }));
}

// =====================================================================================
// ZL-CRM (github.com/nguyentatkiem/ZL-CRM) — Public API, header X-Api-Key
// =====================================================================================
export type ZlCreds = { base_url: string; api_key: string };
async function zl(c: ZlCreds, path: string, init: RequestInit & { classify?: (text: string, status: number) => ConnectorError | undefined } = {}) {
  const base = (c.base_url ?? "").trim().replace(/\/+$/, "").replace(/\/api$/, "");
  if (!/^https?:\/\//.test(base)) throw new ConnectorError("InvalidRequest", "ZL-CRM: địa chỉ phải bắt đầu bằng http:// hoặc https://");
  return http(`${base}${path}`, { ...init, label: "ZL-CRM", headers: { "x-api-key": c.api_key, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
}
/**
 * Lỗi kết bạn/tra SĐT từ ZL-CRM, GIỮ NGUYÊN mã server trả (`code`) để bộ chăm khách quyết định:
 *  - 503 SESSION_EXPIRED / ZALO_UNAVAILABLE → kind "Transient" (retryable) — KHÔNG được coi là "không có Zalo";
 *  - 503 RATE_LIMITED / 429 → kind "RateLimited" (retryable);
 *  - 4xx FRIEND_REQUEST_BLOCKED / ZALO_USER_NOT_FOUND / INVALID_ZALO_USER… → vĩnh viễn (retryable=false).
 */
export type ZlcrmError = ConnectorError & { code: string; status: number; retryable: boolean };
/** (Không dùng subclass: live.ts nạp trước khi index.ts định nghĩa xong ConnectorError — vòng import.) */
function zlErr(kind: ConnectorError["kind"], message: string, code: string, status: number): ZlcrmError {
  return Object.assign(new ConnectorError(kind, message), { code, status, retryable: kind === "Transient" || kind === "RateLimited" });
}
export const isZlcrmError = (e: unknown): e is ZlcrmError => e instanceof ConnectorError && typeof (e as Partial<ZlcrmError>).code === "string";
function zlFriendError(text: string, status: number): ConnectorError | undefined {
  let body: any;
  try { body = JSON.parse(text); } catch { body = undefined; }
  const code = String(body?.code ?? (typeof body?.error === "string" && /^[A-Z_]+$/.test(body.error) ? body.error : "") ?? "") || (status >= 500 ? "ZALO_UNAVAILABLE" : `HTTP_${status}`);
  const msg = `ZL-CRM: ${typeof body?.message === "string" ? body.message : `lỗi ${status}`}`;
  if (status === 429 || code === "RATE_LIMITED") return zlErr("RateLimited", msg, code, status);
  if (status >= 500) return zlErr("Transient", msg, code, status);
  if (status === 401) return zlErr("AuthError", msg, code, status); // sai API key ZL-CRM → cần cắm lại khóa
  if (status === 404) return zlErr("NotFound", msg, code, status);
  if (status === 403) return zlErr("PolicyRejected", msg, code, status); // Zalo từ chối (vd khách chặn) — không phải lỗi khóa
  return zlErr("InvalidRequest", msg, code, status);
}
export type ZlAccount = { id: string; displayName: string; status: string };
export type ZlConversation = {
  id: string; threadType: "user" | "group"; externalThreadId: string | null; lastMessageAt: string | null; unreadCount: number; isReplied: boolean;
  zaloAccountId?: string; zaloAccount?: { id: string; displayName: string };
  contact: { id: string; fullName: string | null; phone: string | null } | null;
};
export type ZlMessage = { id: string; senderType: "self" | "contact" | string; senderName: string | null; content: string | null; contentType: string; sentAt: string };
export async function zlcrmAccounts(c: ZlCreds): Promise<ZlAccount[]> {
  const r = await zl(c, "/api/public/zalo-accounts");
  if (!Array.isArray(r?.accounts)) throw new ConnectorError("InvalidRequest", "ZL-CRM: phản hồi không đúng định dạng (sai địa chỉ?)");
  return r.accounts;
}
export async function zlcrmConversations(c: ZlCreds, opts: { since?: string; limit?: number } = {}): Promise<ZlConversation[]> {
  const qs = new URLSearchParams({ limit: String(opts.limit ?? 100), threadType: "user", ...(opts.since ? { since: opts.since } : {}) });
  return (await zl(c, `/api/public/conversations?${qs}`)).conversations ?? [];
}
export async function zlcrmMessages(c: ZlCreds, conversationId: string, limit = 30): Promise<ZlMessage[]> {
  return (await zl(c, `/api/public/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`)).messages ?? [];
}
export async function zlcrmSend(c: ZlCreds, spec: { zaloAccountId: string; threadId: string; threadType?: "user" | "group"; content: string }) {
  await zl(c, "/api/public/messages/send", { method: "POST", body: JSON.stringify({ zaloAccountId: spec.zaloAccountId, threadId: spec.threadId, threadType: spec.threadType ?? "user", content: spec.content }) });
}

/** Tìm người dùng Zalo theo SĐT, nhìn từ 1 nick (UID khác nhau theo từng nick). Endpoint public thêm cho TAKI.
 *  found=false CHỈ khi Zalo nói rõ SĐT không có tài khoản; phiên hết hạn/mất mạng → ném ZlcrmError retryable. */
export async function zlcrmFindUserByPhone(c: ZlCreds, spec: { zaloAccountId: string; phone: string }): Promise<{ found: boolean; uid: string | null; zaloName: string | null; reason?: string }> {
  const r = await zl(c, "/api/public/friends/lookup-by-phone", { method: "POST", body: JSON.stringify({ zaloAccountId: spec.zaloAccountId, phone: spec.phone }), classify: zlFriendError });
  return { found: Boolean(r?.found && r?.uid), uid: r?.uid ? String(r.uid) : null, zaloName: r?.zaloName ?? null, reason: r?.reason };
}
/** Gửi lời mời kết bạn kèm lời chào từ 1 nick (theo userId hoặc SĐT — server tự tìm UID).
 *  sentMessage = đúng lời chào ZL-CRM đã gửi (server cắt ~150 ký tự); null nếu không gửi/không rõ. */
export async function zlcrmSendFriendRequest(c: ZlCreds, spec: { zaloAccountId: string; userId?: string; phone?: string; message: string }): Promise<{ sent: boolean; uid: string | null; alreadyFriend?: boolean; reason?: string; sentMessage: string | null }> {
  const r = await zl(c, "/api/public/friends/request", { method: "POST", body: JSON.stringify(spec), classify: zlFriendError });
  const sent = Boolean(r?.sent);
  const sentMessage = typeof r?.sentMessage === "string" ? r.sentMessage : r?.sentMessage === null || !sent ? null : spec.message.trim().slice(0, 150); // server cũ chưa trả sentMessage → tự cắt như server
  return { sent, uid: r?.uid ? String(r.uid) : null, alreadyFriend: Boolean(r?.alreadyFriend), reason: r?.reason, sentMessage };
}
/** Trạng thái kết bạn giữa nick và khách: accepted | pending_sent | none | rejected… */
export async function zlcrmFriendStatus(c: ZlCreds, spec: { zaloAccountId: string; userId: string }): Promise<{ isFriend: boolean; status: string }> {
  const qs = new URLSearchParams({ zaloAccountId: spec.zaloAccountId, userId: spec.userId });
  const r = await zl(c, `/api/public/friends/status?${qs}`, { classify: zlFriendError });
  return { isFriend: Boolean(r?.isFriend), status: String(r?.status ?? "none") };
}

