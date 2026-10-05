import { audit, byId, defaultBizId, emit, insert, q, tx, update, type Row } from "@dotaka/db";
import { ConnectorError, configureTelegram, connector, live, platformDef, platformForChannel, type AdRef, type Connector, type PlatformKey } from "@dotaka/connectors";
import { AppError, decryptSecret, encryptSecret, logger, nowIso } from "@dotaka/shared";

/**
 * Connections hub: add/test/disconnect platform accounts, discover their assets
 * (ad accounts → ad_account, Fanpages → channel), whitelist, import campaigns/ads.
 * Credentials are stored encrypted (connection.token_ciphertext = encrypted JSON) and never returned.
 * mode = "sandbox" gives a demo account with simulated data so every flow can be tested without tokens.
 */
export type NewConnection = { platform: string; name?: string; mode: "live" | "sandbox"; credentials: Record<string, string>; config?: Record<string, string> };

const SECRET_KEYS = new Set(["access_token", "bot_token", "api_key", "service_account_json"]);

export function credsOf(c: Row): Record<string, string> {
  try { return JSON.parse(decryptSecret(c.token_ciphertext)); } catch { return {}; }
}

/** What the UI may see about a connection (no secrets). */
export function publicConnection(c: Row) {
  const assets = {
    adAccounts: q.all("SELECT id, platform, external_id, name, currency, whitelisted, status FROM ad_account WHERE connection_id = ? ORDER BY name", c.id),
    pages: q.all("SELECT id, platform, external_id, name, whitelisted, enabled FROM channel WHERE connection_id = ? ORDER BY name", c.id),
  };
  const def = platformDef(c.platform);
  return {
    id: c.id, platform: c.platform, platformName: def?.name ?? c.platform, display_name: c.display_name, external_account_id: c.external_account_id,
    status: c.status, mode: c.mode, config: c.config ?? {}, last_health_at: c.last_health_at, last_error: c.last_error, created_at: c.created_at,
    ads: q.scalar<number>("SELECT COUNT(*) FROM ad a JOIN ad_account x ON x.id = a.ad_account_id WHERE x.connection_id = ?", c.id), assets,
  };
}

type Discovered = {
  accountId: string; name: string;
  adAccounts?: { externalId: string; name: string; currency: string; active: boolean }[];
  pages?: { externalId: string; name: string; token?: string; category?: string | null }[];
  config?: Record<string, unknown>;
};

async function discover(platform: string, mode: "live" | "sandbox", cr: Record<string, string>, cfg: Record<string, string>): Promise<Discovered> {
  if (mode === "sandbox") {
    const tag = Math.random().toString(36).slice(2, 6);
    if (platform === "meta") return { accountId: `sandbox_meta_${tag}`, name: "Facebook (mô phỏng)", adAccounts: [{ externalId: `act_demo_${tag}`, name: `TAKI Ads demo ${tag}`, currency: "VND", active: true }], pages: [{ externalId: `page_demo_${tag}`, name: "TAKI Academy (demo)" }] };
    if (platform === "tiktok") return { accountId: `sandbox_tt_${tag}`, name: "TikTok (mô phỏng)", adAccounts: [{ externalId: `adv_demo_${tag}`, name: `TAKI TikTok demo ${tag}`, currency: "VND", active: true }] };
    if (platform === "zlcrm") return { accountId: `sandbox_zlcrm_${tag}`, name: "ZL-CRM (mô phỏng)", config: { sandbox: true, accounts: [{ id: `nick_demo_${tag}`, name: "Nick Zalo tư vấn (demo)", status: "connected" }], hasAccountField: true } };
    return { accountId: `sandbox_${platform}_${tag}`, name: `${platformDef(platform)?.name ?? platform} (mô phỏng)`, config: { sandbox: true } };
  }
  switch (platform) {
    case "meta": {
      const me = await live.metaTest(cr as any);
      const d = await live.metaDiscover(cr as any);
      return { ...me, ...d };
    }
    case "tiktok": {
      const ids = (cfg.advertiser_ids ?? cr.advertiser_ids ?? "").split(/[,\s]+/).filter(Boolean);
      if (!ids.length) throw new AppError("INVALID", "Cần ít nhất 1 Advertiser ID");
      const list = await live.tiktokTest(cr as any, ids);
      return { accountId: ids.join(","), name: list.map((a) => a.name).join(", "), adAccounts: list };
    }
    case "sheets": {
      const r = await live.sheetsTest(cr as any, cfg.default_spreadsheet || undefined);
      return { accountId: r.accountId, name: r.name, config: { spreadsheetTitle: r.title } };
    }
    case "telegram": {
      const r = await live.telegramTest(cr as any, cfg.chat_id);
      return { accountId: `${r.accountId}:${cfg.chat_id}`, name: `${r.name} → ${r.chat}`, config: { chatTitle: r.chat } };
    }
    case "pancake": {
      const shops = await live.pancakeTest(cr as any);
      return { accountId: shops[0]?.externalId ?? "pancake", name: shops.map((s) => s.name).join(", ") || "Pancake POS", config: { shops } };
    }
    case "zlcrm": {
      const accounts = await live.zlcrmAccounts({ ...cfg, ...cr } as any);
      const probe = await live.zlcrmConversations({ ...cfg, ...cr } as any, { limit: 1 });
      return {
        accountId: cfg.base_url.replace(/\/+$/, ""), name: `ZL-CRM · ${accounts.length} nick Zalo`,
        config: { accounts: accounts.map((a) => ({ id: a.id, name: a.displayName, status: a.status })), hasAccountField: probe.length ? "zaloAccountId" in probe[0] : null },
      };
    }
    case "nhanh": {
      const r = await live.nhanhTest({ ...cfg, ...cr } as any);
      return { accountId: r.accountId, name: r.name, config: { totalOrders: r.totalOrders } };
    }
    default:
      throw new AppError("NOT_SUPPORTED", "Nền tảng này sắp ra mắt");
  }
}

function friendly(e: unknown) {
  if (e instanceof ConnectorError || e instanceof AppError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Upsert discovered ad accounts / pages under this connection. */
function saveAssets(bizId: string, conn: Row, d: Discovered) {
  const platform = conn.platform as string;
  for (const a of d.adAccounts ?? []) {
    const ex = q.get<Row>("SELECT id FROM ad_account WHERE biz_id = ? AND platform = ? AND external_id = ?", bizId, platform, a.externalId);
    if (ex) update("ad_account", ex.id, { name: a.name, currency: a.currency, connection_id: conn.id, status: a.active ? "active" : "disabled" });
    else insert("ad_account", { biz_id: bizId, platform, external_id: a.externalId, name: a.name, currency: a.currency, connection_id: conn.id, status: a.active ? "active" : "disabled", whitelisted: 1, meta: {} });
  }
  for (const p of d.pages ?? []) {
    const ex = q.get<Row>("SELECT id FROM channel WHERE biz_id = ? AND platform = 'facebook' AND external_id = ?", bizId, p.externalId);
    const secret = p.token ? encryptSecret(p.token) : null;
    if (ex) update("channel", ex.id, { name: p.name, connection_id: conn.id, ...(secret ? { secret_ciphertext: secret } : {}), meta: { category: p.category ?? null } });
    else insert("channel", { biz_id: bizId, platform: "facebook", kind: "page", name: p.name, external_id: p.externalId, connection_id: conn.id, enabled: 1, whitelisted: 1, secret_ciphertext: secret, meta: { category: p.category ?? null } });
  }
}

export async function createConnection(bizId: string, input: NewConnection, actor: string) {
  const def = platformDef(input.platform);
  if (!def || def.status !== "live" || !def.fields.length) throw new AppError("NOT_SUPPORTED", "Nền tảng này chưa hỗ trợ kết nối");
  const cr: Record<string, string> = {};
  const cfg: Record<string, string> = { ...(input.config ?? {}) };
  for (const f of def.fields) {
    const v = (input.credentials?.[f.key] ?? input.config?.[f.key] ?? "").trim();
    if (input.mode === "live" && f.required && !v) throw new AppError("INVALID", `Thiếu "${f.label}"`);
    if (!v) continue;
    if (f.secret || SECRET_KEYS.has(f.key)) cr[f.key] = v;
    else cfg[f.key] = v;
  }
  let d: Discovered;
  try {
    d = await discover(input.platform, input.mode, cr, cfg);
  } catch (e) {
    throw new AppError("CONNECT_FAILED", `Kết nối thất bại — ${friendly(e)}`);
  }
  const existing = q.get<Row>("SELECT * FROM connection WHERE biz_id = ? AND platform = ? AND external_account_id = ?", bizId, input.platform, d.accountId);
  const existingCfg = existing?.status !== "revoked" ? existing?.config : undefined;
  const data = {
    display_name: input.name?.trim() || d.name, token_ciphertext: encryptSecret(JSON.stringify(cr)), scopes: def.capabilities, status: "active",
    mode: input.mode, config: { ...(existingCfg ?? {}), ...cfg, ...(d.config ?? {}) }, last_health_at: nowIso(), last_error: null,
  };
  const conn = existing ? (update("connection", existing.id, data), byId<Row>("connection", existing.id)!) : insert("connection", { biz_id: bizId, platform: input.platform, external_account_id: d.accountId, ...data });
  saveAssets(bizId, conn, d);
  audit(bizId, actor, existing ? "connection.updated" : "connection.created", { type: "connection", id: conn.id }, { platform: input.platform, mode: input.mode, adAccounts: d.adAccounts?.length ?? 0, pages: d.pages?.length ?? 0 });
  emit(bizId, "alert.raised", { level: "info", text: `Đã kết nối ${def.name}: ${data.display_name}` });
  return publicConnection(byId<Row>("connection", conn.id)!);
}

export async function testConnection(bizId: string, id: string, actor: string) {
  const c = mustConn(bizId, id);
  try {
    const d = await discover(c.platform, c.mode, credsOf(c), c.config ?? {});
    if (c.mode === "live") saveAssets(bizId, c, d);
    if (c.platform === "zlcrm" && d.config) update("connection", c.id, { config: { ...(c.config ?? {}), ...d.config } });
    update("connection", c.id, { status: "active", last_health_at: nowIso(), last_error: null });
    audit(bizId, actor, "connection.tested", { type: "connection", id: c.id }, { ok: true });
    return { ok: true, detail: c.mode === "sandbox" ? "Kết nối mô phỏng hoạt động" : `Hoạt động: ${d.name}` };
  } catch (e) {
    const msg = friendly(e);
    update("connection", c.id, { status: e instanceof ConnectorError && e.kind === "AuthError" ? "expired" : "error", last_health_at: nowIso(), last_error: msg });
    return { ok: false, detail: msg };
  }
}

export function disconnect(bizId: string, id: string, actor: string) {
  const c = mustConn(bizId, id);
  tx(() => {
    update("connection", c.id, { status: "revoked", token_ciphertext: encryptSecret("{}"), last_error: "Đã ngắt kết nối" });
    q.run("UPDATE channel SET secret_ciphertext = NULL WHERE connection_id = ?", c.id);
  });
  audit(bizId, actor, "connection.revoked", { type: "connection", id: c.id }, { platform: c.platform });
  return { ok: true };
}

export function setWhitelist(bizId: string, kind: "ad_account" | "page", id: string, on: boolean, actor: string) {
  const table = kind === "ad_account" ? "ad_account" : "channel";
  const row = byId<Row>(table, id);
  if (!row || row.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy tài sản", 404);
  update(table, id, { whitelisted: on ? 1 : 0 });
  audit(bizId, actor, on ? "whitelist.added" : "whitelist.removed", { type: table, id }, { name: row.name });
  return { ok: true };
}

function mustConn(bizId: string, id: string) {
  const c = byId<Row>("connection", id);
  if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy kết nối", 404);
  return c;
}

// ---------------- Connector resolution ----------------
const liveCache = new Map<string, { at: string; c: Connector }>();
/** Live adapter for a connection, or the platform sandbox when the connection is sandbox/missing. */
export function connectorForConnection(conn: Row | undefined | null, platform: PlatformKey): Connector {
  if (!conn || conn.mode !== "live" || conn.status === "revoked") return connector(platform);
  const hit = liveCache.get(conn.id);
  if (hit && hit.at === conn.updated_at) return hit.c;
  const cr = credsOf(conn);
  const c = platform === "meta" ? live.metaConnector(cr as any, conn.config ?? {}) : platform === "tiktok" ? live.tiktokConnector(cr as any) : connector(platform);
  liveCache.set(conn.id, { at: conn.updated_at, c });
  return c;
}
/**
 * Publisher for a channel: the live Facebook Page connector when the channel came from a LIVE Meta connection and
 * has its page token; otherwise the platform sandbox (mode "sandbox" — publishing refuses it, see publishing.ts).
 */
export function connectorForChannel(channel: Row): Connector {
  const conn = channel.connection_id ? byId<Row>("connection", channel.connection_id) : undefined;
  if (conn?.mode === "live" && conn.status !== "revoked" && channel.platform === "facebook" && channel.secret_ciphertext) {
    try {
      const pageToken = decryptSecret(channel.secret_ciphertext);
      if (pageToken && pageToken !== "{}") return live.metaPageConnector(pageToken, channel.external_id);
    } catch (e) {
      logger.warn("page_connector.decrypt_failed", { channel: channel.id, error: String(e) });
    }
  }
  return connector(platformForChannel(channel.platform));
}

/** Live page connector a Messenger conversation replies through (its own Page, else the only live Page), or null. */
export function liveMessengerConnector(conv: Row): Connector | null {
  if (conv.channel !== "messenger") return null;
  const live = q.all<Row>(`SELECT ch.* FROM channel ch JOIN connection c ON c.id = ch.connection_id
    WHERE ch.biz_id = ? AND ch.platform = 'facebook' AND ch.enabled = 1 AND ch.secret_ciphertext IS NOT NULL AND c.mode = 'live' AND c.status != 'revoked'`, conv.biz_id);
  const pageId = conv.ext?.pageId;
  const ch = pageId ? live.find((c) => String(c.external_id) === String(pageId)) : live.length === 1 ? live[0] : undefined;
  if (!ch) return null;
  const c = connectorForChannel(ch);
  return c.mode === "live" ? c : null;
}

export function connectorForAccount(accountId: string | null | undefined, platform: PlatformKey) {
  const acc = accountId ? byId<Row>("ad_account", accountId) : undefined;
  const conn = acc?.connection_id ? byId<Row>("connection", acc.connection_id) : undefined;
  return { c: connectorForConnection(conn, platform), acc, conn };
}
/** Token of the LIVE Meta connection an ad account belongs to, or null (sandbox / not connected). */
export function liveMetaToken(accountId: string): { token: string; acc: Row } | null {
  const acc = byId<Row>("ad_account", accountId);
  const conn = acc?.connection_id ? byId<Row>("connection", acc.connection_id) : undefined;
  if (!acc || acc.platform !== "meta" || !conn || conn.mode !== "live" || conn.status === "revoked") return null;
  const token = credsOf(conn).access_token;
  return token ? { token, acc } : null;
}
export function adRefOf(ad: Row, acc?: Row): AdRef {
  return { externalId: ad.external_id, dailyBudget: ad.daily_budget, status: ad.status, name: ad.name, accountExternalId: acc?.external_id, meta: ad.meta ?? {} };
}

// ---------------- Import campaigns/ads from an account ----------------
export async function importAds(bizId: string, connectionId: string, actor: string) {
  const conn = mustConn(bizId, connectionId);
  if (conn.status === "revoked") throw new AppError("REVOKED", "Kết nối đã bị ngắt");
  const c = connectorForConnection(conn, conn.platform as PlatformKey);
  if (!c.listAds) throw new AppError("NOT_SUPPORTED", "Nền tảng này không có quảng cáo để đồng bộ");
  let ads = 0, campaigns = 0;
  const errors: string[] = [];
  for (const acc of q.all<Row>("SELECT * FROM ad_account WHERE connection_id = ? AND status = 'active'", conn.id)) {
    try {
      const list = await c.listAds(acc.external_id, acc.currency);
      tx(() => {
        for (const a of list) {
          let cmp = q.get<Row>("SELECT id FROM campaign WHERE ad_account_id = ? AND external_id = ?", acc.id, a.campaign.externalId);
          if (!cmp) { cmp = insert("campaign", { biz_id: bizId, ad_account_id: acc.id, platform: conn.platform, external_id: a.campaign.externalId, name: a.campaign.name, objective: a.campaign.objective, status: a.campaign.status, daily_budget: a.campaign.dailyBudget, target_cpa: null, meta: {} }); campaigns++; }
          else update("campaign", cmp.id, { name: a.campaign.name, status: a.campaign.status, daily_budget: a.campaign.dailyBudget });
          const ex = q.get<Row>("SELECT id FROM ad WHERE ad_account_id = ? AND external_id = ?", acc.id, a.externalId);
          if (ex) update("ad", ex.id, { name: a.name, status: a.status, daily_budget: a.dailyBudget, campaign_id: cmp.id, meta: a.meta });
          else { insert("ad", { biz_id: bizId, ad_account_id: acc.id, platform: conn.platform, external_id: a.externalId, campaign_id: cmp.id, name: a.name, status: a.status, daily_budget: a.dailyBudget, currency: acc.currency, meta: a.meta }); ads++; }
        }
      });
    } catch (e) {
      errors.push(`${acc.name}: ${friendly(e)}`);
    }
  }
  update("connection", conn.id, { last_health_at: nowIso(), last_error: errors[0] ?? null });
  audit(bizId, actor, "ads.imported", { type: "connection", id: conn.id }, { ads, campaigns, errors });
  emit(bizId, "metrics.updated", { imported: ads });
  return { ads, campaigns, errors };
}

// ---------------- Telegram via the connection ----------------
export function registerTelegramFromDb() {
  configureTelegram(() => {
    try {
      const c = q.get<Row>("SELECT * FROM connection WHERE biz_id = ? AND platform = 'telegram' AND mode = 'live' AND status = 'active' ORDER BY updated_at DESC LIMIT 1", defaultBizId());
      if (!c) return null;
      const cr = credsOf(c);
      return cr.bot_token && c.config?.chat_id ? { token: cr.bot_token, chatId: c.config.chat_id } : null;
    } catch (e) {
      logger.warn("telegram.resolve_failed", { error: String(e) });
      return null;
    }
  });
}

export async function connectionHealthAll(bizId: string) {
  for (const c of q.all<Row>("SELECT id FROM connection WHERE biz_id = ? AND status != 'revoked'", bizId)) await testConnection(bizId, c.id, "scheduler");
}
