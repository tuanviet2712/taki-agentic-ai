import { createSign } from "node:crypto";
import type { CanonicalMetrics } from "@dotaka/contracts";
import { ConnectorError } from "../errors.ts";
import type { AdRef, Connector, ImportedAd } from "../index.ts";
import { buildGoogleSearchOperations, parseMutateResponse, validateGoogleSearchSpec, type GoogleSearchCampaignSpec } from "./create.ts";

/**
 * Google Ads API — ported from TakiAcademy-AI/ads-os (lib/ads/google*.ts). Rules carried over:
 *  - Auth: SERVICE ACCOUNT (JSON key → JWT → access token 1h; no Google login/consent screen) or OAuth refresh token.
 *    token_uri is NEVER taken from the key file (SSRF) — fixed Google endpoint.
 *  - Developer token is no longer required (sent only when configured). Accounts under an MCC need login-customer-id.
 *  - searchStream returns CHUNKS (flatten all) and wraps errors in an array; GoogleAdsFailure sits in later details.
 *  - Money is already MICROS of the account currency → / 1e6 for this system's whole-currency units.
 *  - Unit of control = CAMPAIGN (status, daily budget, metrics). Writes are never retried. Shared budgets are refused.
 */
const HOST = "https://googleads.googleapis.com";
const VERSION = process.env.GOOGLE_ADS_API_VERSION || "v25";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/adwords";

export type GoogleAdsCreds = {
  service_account_json?: string;
  client_id?: string; client_secret?: string; refresh_token?: string;
  developer_token?: string;
  /** Optional: restrict to these customer ids (digits, comma separated). */
  customer_ids?: string;
};
type Auth = { accessToken: string; developerToken?: string; loginCustomerId?: string | null };
const digits = (x: string) => String(x).replace(/\D/g, "");
export const fmtCustomerId = (id: string) => digits(id).replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");

// ---------------- Auth ----------------
export function parseServiceAccountKey(raw: string): { client_email: string; private_key: string; project_id?: string } {
  let j: Record<string, unknown>;
  try { j = JSON.parse(String(raw).trim()); } catch { throw new ConnectorError("InvalidRequest", "Không đọc được JSON — dán nguyên nội dung file khoá .json của service account"); }
  if (j.web || j.installed) throw new ConnectorError("InvalidRequest", "Đây là file OAuth client (client_secret…json), không phải khoá service account. Vào IAM & Admin → Service Accounts → Keys → Add key → JSON");
  if (j.type !== "service_account" || typeof j.client_email !== "string" || typeof j.private_key !== "string")
    throw new ConnectorError("InvalidRequest", "File không phải khoá service account (thiếu type, client_email hoặc private_key)");
  return { client_email: j.client_email, private_key: j.private_key, project_id: typeof j.project_id === "string" ? j.project_id : undefined };
}

async function tokenRequest(body: URLSearchParams): Promise<string> {
  let res: Response;
  try { res = await fetch(TOKEN_URI, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20_000) }); }
  catch (e) { throw new ConnectorError("Transient", `Google: không kết nối được máy chủ xác thực (${e instanceof Error ? e.message : e})`); }
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) {
    const why = j.error_description || j.error || `HTTP ${res.status}`;
    throw new ConnectorError("AuthError", j.error === "invalid_grant"
      ? `Google từ chối thông tin xác thực (${why}) — khoá service account bị xoá/vô hiệu hoá, refresh token bị thu hồi, hoặc đồng hồ máy lệch. Tạo khoá mới rồi kết nối lại`
      : `Google không cấp access token: ${why}`);
  }
  return j.access_token;
}

async function accessTokenFor(c: GoogleAdsCreds): Promise<string> {
  if (c.service_account_json?.trim()) {
    const key = parseServiceAccountKey(c.service_account_json);
    const now = Math.floor(Date.now() / 1000);
    const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
    const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600 }));
    let sig: string;
    try { const s = createSign("RSA-SHA256"); s.update(`${head}.${claims}`); sig = s.sign(key.private_key).toString("base64url"); }
    catch { throw new ConnectorError("InvalidRequest", "private_key trong file khoá bị hỏng — tạo khoá JSON mới cho service account"); }
    return tokenRequest(new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }));
  }
  if (c.refresh_token && c.client_id && c.client_secret)
    return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client_id, client_secret: c.client_secret }));
  throw new ConnectorError("InvalidRequest", "Cần khoá service account JSON (hoặc Client ID + Client secret + Refresh token)");
}

// ---------------- Transport ----------------
const HINTS: Record<string, string> = {
  CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION: "Project Google Cloud đang ở cấp truy cập Test, chỉ gọi được tài khoản thử nghiệm. Vào Google Cloud Console → trang Tổng quan Google Ads API của project, đăng ký Explorer hoặc Basic.",
  ACTION_NOT_PERMITTED: "Project Google Cloud chưa được phép gọi tài khoản thật (cấp truy cập Test). Đăng ký Explorer hoặc Basic ở trang Tổng quan Google Ads API của project.",
  DEVELOPER_TOKEN_NOT_APPROVED: "Project Google Cloud chưa được duyệt cấp truy cập cho tài khoản thật. Đăng ký Explorer hoặc Basic ở trang Tổng quan Google Ads API của project.",
  USER_PERMISSION_DENIED: "Service account / tài khoản đăng nhập không có quyền trên tài khoản Google Ads này. Thêm đúng email vào tài khoản (hoặc MCC quản lý nó) ở Quản trị → Quyền truy cập và bảo mật, và lời mời phải được chấp nhận.",
  CUSTOMER_NOT_ENABLED: "Tài khoản Google Ads này chưa kích hoạt hoặc đã bị huỷ — chưa nhập thanh toán hay chưa tạo chiến dịch đầu tiên thì Google chưa cho gọi API.",
  SERVICE_DISABLED: "Google Ads API chưa được bật trong project Google Cloud. Vào APIs & Services → Library → Google Ads API → Enable, chờ vài phút rồi thử lại.",
  ACCESS_TOKEN_SCOPE_INSUFFICIENT: "Token không có quyền adwords. Kết nối lại.",
  DUPLICATE_CAMPAIGN_NAME: "Tài khoản đã có chiến dịch trùng tên (kể cả chiến dịch đã tạm dừng). Đổi tên chiến dịch rồi tạo lại.",
  DUPLICATE_NAME: "Tên bị trùng với một mục đã có trong tài khoản Google Ads. Đổi tên rồi thử lại.",
  OPERATION_NOT_PERMITTED_FOR_CONTEXT: "Tài khoản này không được phép tạo chiến dịch Search (có thể là tài khoản quản lý MCC, hoặc tài khoản đã bị tạm ngưng).",
  BILLING_SETUP_REQUIRED: "Tài khoản Google Ads chưa nhập thông tin thanh toán — vào Google Ads → Thanh toán để thiết lập, rồi tạo lại.",
  TOO_LONG: "Có nội dung dài quá giới hạn của Google.",
  TOO_SHORT: "Có nội dung ngắn quá giới hạn của Google.",
  POLICY_FINDING: "Nội dung quảng cáo vi phạm chính sách Google Ads (xem chi tiết bên dưới) — sửa lại câu chữ rồi tạo lại.",
};
/** Tên trường Google báo lỗi → chữ người dùng hiểu (vị trí cuối cùng trong đường dẫn lỗi). */
const FIELD_VI: [RegExp, string][] = [
  [/headlines/, "tiêu đề quảng cáo"], [/descriptions/, "mô tả quảng cáo"], [/final_urls|finalUrls/, "URL trang đích"], [/keyword/, "từ khóa"],
  [/path1|path2/, "đường dẫn hiển thị"], [/campaign_budget|amount_micros/, "ngân sách"], [/\bname\b/, "tên"], [/bidding|target_spend|maximize/, "chiến lược giá thầu"],
  [/location|geo_target/, "khu vực nhắm"], [/language/, "ngôn ngữ nhắm"],
];
function fieldWhere(error: any): string {
  const els: { fieldName?: string; index?: number | string }[] = error?.location?.fieldPathElements ?? [];
  if (!els.length) return "";
  const path = els.map((e) => `${e.fieldName}${e.index !== undefined ? `[${e.index}]` : ""}`).join(".");
  const idx = [...els].reverse().find((e) => e.index !== undefined && e.fieldName !== "mutate_operations")?.index;
  const vi = FIELD_VI.find(([re]) => re.test(path))?.[1];
  return vi ? ` — ở ${vi}${idx !== undefined ? ` số ${Number(idx) + 1}` : ""}` : "";
}
export function extractGoogleError(body: unknown, status: number): string {
  const wrapped = (Array.isArray(body) ? body[0] : body) as { error?: any } | undefined;
  const err = wrapped?.error;
  const details: any[] = err?.details ?? [];
  const adsErr = details.flatMap((d) => d.errors ?? [])[0];
  const code: string | undefined = adsErr?.errorCode ? String(Object.values(adsErr.errorCode)[0]) : undefined;
  const reason: string | undefined = details.find((d) => d.reason)?.reason;
  const raw = adsErr?.message || err?.message || `Google Ads trả HTTP ${status}`;
  if (code === "BUDGET_BELOW_PER_DAY_MINIMUM") {
    const d = adsErr?.details?.budgetPerDayMinimumErrorDetails;
    if (d?.budgetPerDayMinimumMicros) return `Ngân sách thấp hơn mức tối thiểu Google cho phép: tối thiểu ${Math.ceil(Number(d.budgetPerDayMinimumMicros) / 1e6).toLocaleString("vi-VN")} ${d.currencyCode ?? ""}/ngày`;
  }
  const hint = (code && HINTS[code]) || (reason && HINTS[reason]);
  const where = fieldWhere(adsErr);
  return hint ? `${hint}${where} (${code ?? reason}: ${raw})` : code ? `${raw}${where} (${code})` : raw;
}
function headers(a: Auth): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${a.accessToken}`, "content-type": "application/json" };
  if (a.developerToken) h["developer-token"] = a.developerToken;
  if (a.loginCustomerId) h["login-customer-id"] = digits(a.loginCustomerId); // missing under an MCC → permission error that never mentions it
  return h;
}
/** Reads: retried on 5xx / 429 / network. Writes go through mutate() — never retried. */
async function call<T>(path: string, a: Auth, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
  let last: ConnectorError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try { res = await fetch(`${HOST}/${VERSION}${path}`, { method: init.method, headers: headers(a), body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(30_000) }); }
    catch (e) { last = new ConnectorError("Transient", `Google Ads: không kết nối được (${e instanceof Error ? e.message : e})`); await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
    if (res.ok) return (await res.json()) as T;
    const msg = `Google Ads: ${extractGoogleError(await res.json().catch(() => ({})), res.status)}`;
    if (res.status === 401 || res.status === 403) throw new ConnectorError("AuthError", msg);
    if (res.status === 429) last = new ConnectorError("RateLimited", msg);
    else if (res.status >= 500) last = new ConnectorError("Transient", msg);
    else throw new ConnectorError(res.status === 404 ? "NotFound" : "InvalidRequest", msg);
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw last ?? new ConnectorError("Transient", "Google Ads: lỗi không rõ");
}
export async function gaql<T>(a: Auth, customerId: string, query: string): Promise<T[]> {
  const chunks = await call<{ results?: T[] }[]>(`/customers/${digits(customerId)}/googleAds:searchStream`, a, { method: "POST", body: { query } });
  return (Array.isArray(chunks) ? chunks : []).flatMap((c) => c.results ?? []); // ALL chunks, not just the first
}
async function mutate(a: Auth, customerId: string, resource: "campaigns" | "campaignBudgets", operations: unknown[], validateOnly = false) {
  let res: Response;
  try { res = await fetch(`${HOST}/${VERSION}/customers/${digits(customerId)}/${resource}:mutate`, { method: "POST", headers: headers(a), body: JSON.stringify({ operations, validateOnly }), signal: AbortSignal.timeout(25_000) }); }
  catch (e) { throw new ConnectorError("Transient", `Google Ads: không kết nối được khi ghi (${e instanceof Error ? e.message : e}) — kiểm tra lại trên Google Ads trước khi thử lại`); }
  if (!res.ok) {
    const msg = `Google Ads: ${extractGoogleError(await res.json().catch(() => ({})), res.status)}`;
    throw new ConnectorError(res.status === 401 || res.status === 403 ? "AuthError" : res.status === 429 ? "RateLimited" : res.status >= 500 ? "Transient" : "InvalidRequest", msg);
  }
}

/** Chuỗi thao tác liên hoàn (tạo chiến dịch). Ghi 1 lần, KHÔNG thử lại; `validateOnly` = chỉ kiểm, không tạo gì. */
async function mutateAll(a: Auth, customerId: string, operations: unknown[], validateOnly: boolean): Promise<any> {
  let res: Response;
  try { res = await fetch(`${HOST}/${VERSION}/customers/${digits(customerId)}/googleAds:mutate`, { method: "POST", headers: headers(a), body: JSON.stringify({ mutateOperations: operations, validateOnly, partialFailure: false }), signal: AbortSignal.timeout(40_000) }); }
  catch (e) { throw new ConnectorError("Transient", `Google Ads: không kết nối được khi tạo chiến dịch (${e instanceof Error ? e.message : e}) — vào Google Ads kiểm tra xem chiến dịch đã được tạo chưa trước khi tạo lại`); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = `Google Ads: ${extractGoogleError(body, res.status)}`;
    throw new ConnectorError(res.status === 401 || res.status === 403 ? "AuthError" : res.status === 429 ? "RateLimited" : res.status >= 500 ? "Transient" : "InvalidRequest", msg);
  }
  return body;
}

// ---------------- Accounts ----------------
export type GoogleAdAccount = { id: string; name: string; currency: string; timeZone: string; isManager: boolean; loginCustomerId: string | null };
/** Every account reachable by these credentials, INCLUDING sub-accounts under each MCC (listAccessibleCustomers alone only shows the MCC). */
export async function listGoogleAdAccounts(a: Auth): Promise<GoogleAdAccount[]> {
  const roots = ((await call<{ resourceNames?: string[] }>("/customers:listAccessibleCustomers", a, { method: "GET" })).resourceNames ?? []).map((n) => n.split("/").pop() ?? "").filter(Boolean);
  const seen = new Map<string, GoogleAdAccount>();
  let firstError: unknown = null, ok = 0;
  for (const root of roots) {
    const rows = await gaql<any>({ ...a, loginCustomerId: root }, root,
      `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status
       FROM customer_client WHERE customer_client.status = 'ENABLED'`).then((r) => { ok++; return r; }, (e) => { firstError ??= e; return [] as any[]; });
    for (const r of rows) {
      const c = r.customerClient;
      if (!c?.id || seen.has(String(c.id))) continue;
      seen.set(String(c.id), { id: String(c.id), name: c.descriptiveName || `Tài khoản ${fmtCustomerId(String(c.id))}`, currency: c.currencyCode || "VND", timeZone: c.timeZone || "Asia/Ho_Chi_Minh", isManager: c.manager === true, loginCustomerId: String(c.id) === root ? null : root });
    }
  }
  if (roots.length && !ok && firstError) throw firstError; // all roots failed → the real reason (e.g. project not approved), not "no accounts"
  return [...seen.values()];
}
/** Why an MCC has no usable sub-account: empty, all cancelled/suspended, or link invitations still PENDING. */
export async function describeManagerChildren(a: Auth, managerId: string): Promise<string> {
  const rows = await gaql<any>({ ...a, loginCustomerId: managerId }, managerId,
    "SELECT customer_client.id, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level > 0").catch(() => null);
  if (!rows) return "";
  const children = rows.map((r) => r.customerClient).filter((c) => c?.id && !c.manager);
  if (!children.length) {
    const managers = [managerId, ...rows.map((r) => r.customerClient).filter((c) => c?.id && c.manager).map((c) => String(c.id))];
    const pending: string[] = [];
    for (const m of managers) {
      const links = await gaql<any>({ ...a, loginCustomerId: managerId }, m, "SELECT customer_client_link.client_customer, customer_client_link.status FROM customer_client_link WHERE customer_client_link.status = 'PENDING'").catch(() => []);
      for (const l of links) { const id = l.customerClientLink?.clientCustomer?.split("/").pop(); if (id) pending.push(`${fmtCustomerId(id)} (mời từ ${fmtCustomerId(m)})`); }
    }
    return pending.length
      ? `Có ${pending.length} lời mời liên kết ĐANG CHỜ chấp nhận: ${pending.join(", ")}. Đăng nhập tài khoản được mời → Quản trị → Quyền truy cập và bảo mật → tab Người quản lý → Chấp nhận.`
      : `Dưới MCC ${fmtCustomerId(managerId)} chưa có tài khoản quảng cáo nào, cũng không có lời mời liên kết đang chờ.`;
  }
  const VI: Record<string, string> = { CANCELED: "đã huỷ", SUSPENDED: "bị tạm ngưng", CLOSED: "đã đóng" };
  const by = new Map<string, number>();
  for (const c of children) by.set(c.status ?? "UNKNOWN", (by.get(c.status ?? "UNKNOWN") ?? 0) + 1);
  return `MCC ${fmtCustomerId(managerId)} có ${children.length} tài khoản con nhưng không cái nào đang hoạt động: ${[...by].map(([s, n]) => `${n} ${VI[s] ?? s}`).join(", ")}.`;
}

/** Connection test + discovery (Trung tâm tích hợp). Only non-manager accounts can run ads. */
export async function googleAdsTest(c: GoogleAdsCreds) {
  const a: Auth = { accessToken: await accessTokenFor(c), developerToken: c.developer_token?.trim() || undefined };
  const all = await listGoogleAdAccounts(a);
  const only = (c.customer_ids ?? "").split(/[,\s]+/).map(digits).filter(Boolean);
  const usable = all.filter((x) => !x.isManager && (!only.length || only.includes(x.id)));
  if (!usable.length) {
    const mcc = all.find((x) => x.isManager);
    const why = mcc ? await describeManagerChildren(a, mcc.id) : "";
    throw new ConnectorError("InvalidRequest", all.length
      ? `Chưa có tài khoản quảng cáo Google dùng được. ${why || `Chỉ thấy tài khoản quản lý: ${all.filter((x) => x.isManager).map((x) => `${x.name} (${fmtCustomerId(x.id)})`).join(", ")}.`}`
      : "Thông tin xác thực hợp lệ nhưng chưa được thêm vào tài khoản Google Ads nào. Thêm email service account vào Google Ads → Quản trị → Quyền truy cập và bảo mật (hoặc vào MCC quản lý tài khoản).");
  }
  const who = c.service_account_json ? parseServiceAccountKey(c.service_account_json).client_email : "google-oauth";
  return {
    accountId: who, name: `Google Ads · ${usable.length} tài khoản`,
    adAccounts: usable.map((x) => ({ externalId: x.id, name: `${x.name} (${fmtCustomerId(x.id)})`, currency: x.currency, active: true, meta: { loginCustomerId: x.loginCustomerId, timeZone: x.timeZone } })),
  };
}

// ---------------- Connector (sync, pause/resume, budget) ----------------
const CHANNEL_OBJECTIVE: Record<string, string> = { SEARCH: "traffic", SHOPPING: "sales", PERFORMANCE_MAX: "sales", VIDEO: "video_views", DISPLAY: "awareness", DEMAND_GEN: "awareness", DISCOVERY: "awareness" };
export function googleAdsConnector(c: GoogleAdsCreds): Connector {
  let tok: { v: string; until: number } | null = null;
  let accounts: Map<string, GoogleAdAccount> | null = null;
  const token = async () => { if (!tok || tok.until < Date.now()) tok = { v: await accessTokenFor(c), until: Date.now() + 50 * 60_000 }; return tok.v; };
  /** Auth for one customer: login-customer-id = its MCC (looked up once per connector). */
  const authFor = async (customerId: string): Promise<Auth> => {
    const base: Auth = { accessToken: await token(), developerToken: c.developer_token?.trim() || undefined };
    if (!accounts) accounts = new Map((await listGoogleAdAccounts(base)).map((x) => [x.id, x]));
    return { ...base, loginCustomerId: accounts.get(digits(customerId))?.loginCustomerId ?? null };
  };
  const budgetInfo = async (a: Auth, customerId: string, campaignId: string) => {
    const rows = await gaql<any>(a, customerId, `SELECT campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.reference_count FROM campaign WHERE campaign.id = ${digits(campaignId)}`);
    const b = rows[0]?.campaignBudget;
    return b?.resourceName ? { resourceName: String(b.resourceName), amountMicros: Number(b.amountMicros ?? 0), shared: b.explicitlyShared === true, refs: Number(b.referenceCount ?? 1) } : null;
  };
  const need = (ad: AdRef) => { if (!ad.accountExternalId) throw new ConnectorError("InvalidRequest", "Thiếu Customer ID của tài khoản Google Ads"); return ad.accountExternalId; };
  return {
    platform: "google_ads", mode: "live", limits: { requestsPerMinute: 60, concurrency: 2 },
    async health() {
      const n = (await listGoogleAdAccounts({ accessToken: await token(), developerToken: c.developer_token?.trim() || undefined })).filter((x) => !x.isManager).length;
      return { ok: true, detail: `Google Ads: ${n} tài khoản quảng cáo` };
    },
    /** Google campaign = 1 "ad" here (status, daily budget and metrics all live on the campaign). */
    async listAds(customerId) {
      const a = await authFor(customerId);
      const rows = await gaql<any>(a, customerId, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date_time, campaign_budget.amount_micros, campaign_budget.resource_name, campaign_budget.explicitly_shared
        FROM campaign WHERE campaign.status != 'REMOVED'`);
      return rows.filter((r) => r.campaign?.id).map((r): ImportedAd => {
        const status = r.campaign.status === "ENABLED" ? "active" as const : "paused" as const;
        const daily = r.campaignBudget?.amountMicros ? Math.round(Number(r.campaignBudget.amountMicros) / 1e6) : null;
        const type = String(r.campaign.advertisingChannelType ?? "UNKNOWN");
        return {
          externalId: String(r.campaign.id), name: r.campaign.name || `Chiến dịch ${r.campaign.id}`, status, dailyBudget: daily,
          meta: { budgetOwnerId: String(r.campaign.id), channelType: type, budgetResource: r.campaignBudget?.resourceName ?? null, sharedBudget: r.campaignBudget?.explicitlyShared === true, startDateTime: r.campaign.startDateTime ?? null },
          campaign: { externalId: String(r.campaign.id), name: r.campaign.name || `Chiến dịch ${r.campaign.id}`, objective: CHANNEL_OBJECTIVE[type] ?? "unknown", status, dailyBudget: daily },
        };
      });
    },
    async fetchAccountMetrics(customerId, since, until) {
      const a = await authFor(customerId);
      // Removed campaigns are NOT filtered out: their late conversions and past spend are still real money.
      const rows = await gaql<any>(a, customerId, `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
        FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`);
      return rows.filter((r) => r.campaign?.id && r.segments?.date).map((r) => ({
        adExternalId: String(r.campaign.id), day: String(r.segments.date),
        metrics: { spend: Math.round(Number(r.metrics?.costMicros ?? 0) / 1e6), impressions: Number(r.metrics?.impressions ?? 0), clicks: Number(r.metrics?.clicks ?? 0), results: Math.round(Number(r.metrics?.conversions ?? 0) * 100) / 100, reach: 0 } as CanonicalMetrics,
      }));
    },
    async updateStatus(ad, status) {
      const cid = need(ad);
      const a = await authFor(cid);
      await mutate(a, cid, "campaigns", [{ update: { resourceName: `customers/${digits(cid)}/campaigns/${digits(ad.externalId)}`, status: status === "active" ? "ENABLED" : "PAUSED" }, updateMask: "status" }]);
      // Trust the data, not the response.
      const now = (await gaql<any>(a, cid, `SELECT campaign.status FROM campaign WHERE campaign.id = ${digits(ad.externalId)}`).catch(() => []))[0]?.campaign?.status;
      if (now && now !== (status === "active" ? "ENABLED" : "PAUSED")) throw new ConnectorError("Transient", `Google Ads chưa ghi nhận trạng thái mới (đang ${now}) — kiểm tra lại trên Google Ads`);
      return { ok: true };
    },
    async updateBudget(ad, amount) {
      const cid = need(ad);
      if (!(amount > 0)) throw new ConnectorError("InvalidRequest", "Ngân sách phải lớn hơn 0");
      const a = await authFor(cid);
      const info = await budgetInfo(a, cid, ad.externalId);
      if (!info) throw new ConnectorError("InvalidRequest", "Không đọc được ngân sách của chiến dịch này");
      // A shared budget changes EVERY campaign using it — refuse rather than touch campaigns nobody asked about.
      if (info.shared || info.refs > 1) throw new ConnectorError("PolicyRejected", `Ngân sách đang dùng chung cho ${info.refs} chiến dịch — đổi sẽ ảnh hưởng chiến dịch khác nên bỏ qua. Tách ngân sách riêng trên Google Ads nếu muốn tự động điều chỉnh`);
      await mutate(a, cid, "campaignBudgets", [{ update: { resourceName: info.resourceName, amountMicros: String(Math.round(amount * 1e6)) }, updateMask: "amount_micros" }]);
      return { ok: true };
    },
    /** Tài khoản đã có hành động chuyển đổi đang bật chưa? (quyết định tối ưu theo chuyển đổi hay theo lượt nhấp). Lỗi → coi như chưa. */
    async hasConversionTracking(customerId) {
      try {
        const a = await authFor(customerId);
        return (await gaql<any>(a, customerId, "SELECT conversion_action.id FROM conversion_action WHERE conversion_action.status = 'ENABLED' LIMIT 1")).length > 0;
      } catch { return false; }
    },
    /** Google kiểm TOÀN BỘ chuỗi (ngân sách → quảng cáo → từ khóa) mà không tạo gì. */
    async validateSearchCampaign(spec: GoogleSearchCampaignSpec) {
      validateGoogleSearchSpec(spec);
      const cid = spec.accountExternalId;
      const a = await authFor(cid);
      await mutateAll(a, cid, buildGoogleSearchOperations(cid, spec, Date.now().toString(36)), true);
      return { ok: true as const };
    },
    /** Tạo chiến dịch Search nguyên khối. Không thử lại; trùng tên thì Google từ chối (DUPLICATE_CAMPAIGN_NAME) nên bấm 2 lần không ra 2 chiến dịch. */
    async createSearchCampaign(spec: GoogleSearchCampaignSpec, _key: string) {
      validateGoogleSearchSpec(spec);
      const cid = spec.accountExternalId;
      const a = await authFor(cid);
      const body = await mutateAll(a, cid, buildGoogleSearchOperations(cid, spec, Date.now().toString(36)), false);
      return parseMutateResponse(body, spec);
    },
  };
}
