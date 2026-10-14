import { RuleDefinition, type CanonicalMetrics } from "@dotaka/contracts";
import { audit, bizSettings, byId, emit, insert, isKilled, q, tx, update, type Row } from "@dotaka/db";
import { sendTelegram, type PlatformKey } from "@dotaka/connectors";
import { adRefOf, connectorForAccount, connectorForAdPublish } from "./connections.ts";
import { DEFAULT_ATTRIBUTION, describeAction, evaluateRule, measureAttributionLag, suggestAttributionDays, type AttributionOptions, type MetricRevision, type RuleEntity } from "@dotaka/rule-engine";
import { AppError, nowIso } from "@dotaka/shared";
import { PermanentError, enqueue } from "./queue.ts";

export const today = (d = new Date()) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => today(new Date(Date.now() - n * 86400_000));

// ---------------- Metrics sync (append-only snapshots, latest per (entity, day) wins) ----------------
export async function syncAdMetrics(bizId: string, day = today(), opts: { since?: string; accountIds?: string[] } = {}) {
  const since = opts.since ?? day;
  const accounts = q.all<Row>("SELECT DISTINCT ad_account_id id FROM ad WHERE biz_id = ?", bizId).map((r) => r.id as string)
    .filter((id) => !opts.accountIds?.length || opts.accountIds.includes(id));
  let n = 0;
  const errors: string[] = [];
  for (const accountId of accounts) {
    const ads = q.all<Row>("SELECT * FROM ad WHERE biz_id = ? AND ad_account_id = ?", bizId, accountId);
    if (!ads.length) continue;
    const { c, acc, conn } = connectorForAccount(accountId, ads[0].platform as PlatformKey);
    try {
      if (c.mode === "live" && c.fetchAccountMetrics && acc) {
        // One call per account; days with no delivery come back empty -> write zeros so "today" is not stale.
        const rows = await c.fetchAccountMetrics(acc.external_id, since, day);
        const byExt = new Map(ads.map((a) => [a.external_id, a]));
        // Snapshots are a revision history (ads-os ad_metric_revision): write only when the numbers changed, so
        // re-pulling past days records late conversions without bloating the table — and the history measures
        // the account's real attribution window.
        const last = new Map(q.all<Row>(
          `SELECT entity_id, day, metrics FROM metric_snapshot s WHERE biz_id = ? AND entity_type = 'ad' AND day BETWEEN ? AND ?
             AND entity_id IN (${ads.map(() => "?").join(",")})
             AND captured_at = (SELECT MAX(captured_at) FROM metric_snapshot x WHERE x.entity_id = s.entity_id AND x.day = s.day)`,
          bizId, since, day, ...ads.map((a) => a.id),
        ).map((r) => [`${r.entity_id}:${r.day}`, r.metrics]));
        const same = (a: any, b: any) => !!a && !!b && ["spend", "impressions", "clicks", "results", "reach"].every((k) => Number(a[k] ?? 0) === Number(b[k] ?? 0));
        const seen = new Set<string>();
        for (const r of rows) {
          const ad = byExt.get(r.adExternalId);
          if (!ad) continue;
          seen.add(`${ad.id}:${r.day}`);
          if (same(last.get(`${ad.id}:${r.day}`), r.metrics)) continue;
          insert("metric_snapshot", { biz_id: bizId, entity_type: "ad", entity_id: ad.id, day: r.day, metrics: r.metrics, source: ad.platform, captured_at: nowIso() });
          n++;
        }
        for (const ad of ads) if (!seen.has(`${ad.id}:${day}`) && !last.has(`${ad.id}:${day}`)) insert("metric_snapshot", { biz_id: bizId, entity_type: "ad", entity_id: ad.id, day, metrics: { spend: 0, impressions: 0, clicks: 0, results: 0, reach: 0 }, source: ad.platform, captured_at: nowIso() });
      } else {
        for (let d = new Date(`${since}T00:00:00Z`); today(d) <= day; d = new Date(d.getTime() + 86400_000)) {
          for (const ad of ads) {
            const m = await c.fetchAdMetrics!(adRefOf(ad, acc), today(d));
            insert("metric_snapshot", { biz_id: bizId, entity_type: "ad", entity_id: ad.id, day: today(d), metrics: m, source: ad.platform, captured_at: nowIso() });
            n++;
          }
        }
      }
      if (conn?.last_error) update("connection", conn.id, { last_error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${acc?.name ?? accountId}: ${msg}`);
      if (conn) update("connection", conn.id, { last_error: msg, status: (e as any)?.kind === "AuthError" ? "expired" : conn.status });
    }
  }
  emit(bizId, "metrics.updated", { day, snapshots: n });
  if (errors.length) emit(bizId, "alert.raised", { level: "warning", text: `Đồng bộ chỉ số lỗi: ${errors[0]}` });
  return n;
}

/**
 * Scheduled sync (every 15 min): today only, plus — at most once an hour — the last 7 days again, because
 * Facebook keeps revising past days as late conversions arrive. Without the re-pull, 3d/7d CPA stays frozen at
 * its worst and the guard has no history to measure the attribution window from.
 */
const lastBackfill = new Map<string, number>();
export async function scheduledAdSync(bizId: string) {
  if (Date.now() - (lastBackfill.get(bizId) ?? 0) < 3600_000) return syncAdMetrics(bizId);
  lastBackfill.set(bizId, Date.now());
  return syncAdMetrics(bizId, today(), { since: daysAgo(7) });
}

/** metric_latest: newest snapshot per (entity, day). */
export function latestDaily(bizId: string, entityId: string, fromDay: string, toDay = today()): { day: string; metrics: CanonicalMetrics }[] {
  return q.all<Row>(
    `SELECT day, metrics FROM metric_snapshot s WHERE biz_id = ? AND entity_id = ? AND day BETWEEN ? AND ?
       AND captured_at = (SELECT MAX(captured_at) FROM metric_snapshot x WHERE x.entity_id = s.entity_id AND x.day = s.day)
     ORDER BY day`, bizId, entityId, fromDay, toDay,
  ) as any;
}
export function sumMetrics(rows: { metrics: CanonicalMetrics }[]): CanonicalMetrics {
  return rows.reduce((a, r) => ({
    spend: a.spend + r.metrics.spend, impressions: a.impressions + r.metrics.impressions, clicks: a.clicks + r.metrics.clicks,
    results: a.results + r.metrics.results, reach: (a.reach ?? 0) + (r.metrics.reach ?? 0),
  }), { spend: 0, impressions: 0, clicks: 0, results: 0, reach: 0 } as CanonicalMetrics);
}

/**
 * Attribution window for the guard: biz setting `adsAttribution` ({enabled, days, minConversions, minClicks}),
 * else measured from the revision history (95% of final conversions reported), else ads-os's default of 7 days.
 */
const measured = new Map<string, { at: number; days: number | null; samples: number }>();
export function attributionInfo(bizId: string) {
  const hit = measured.get(bizId);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit;
  const rows = q.all<Row>(
    `SELECT entity_id, day, captured_at, json_extract(metrics, '$.results') results FROM metric_snapshot
      WHERE biz_id = ? AND entity_type = 'ad' AND day >= ? ORDER BY captured_at`, bizId, daysAgo(45));
  const revs: MetricRevision[] = rows.map((r) => ({ seriesId: r.entity_id, date: r.day, fetchedAt: r.captured_at, conversions: Number(r.results ?? 0) }));
  const curve = measureAttributionLag(revs);
  const info = { at: Date.now(), days: suggestAttributionDays(curve), samples: curve.reduce((a, p) => a + p.samples, 0), curve };
  measured.set(bizId, info);
  return info;
}
export function attributionOptions(bizId: string): AttributionOptions | undefined {
  const cfg = ((bizSettings(bizId) as any).adsAttribution ?? {}) as { enabled?: boolean; days?: number; minConversions?: number; minClicks?: number };
  if (cfg.enabled === false) return undefined;
  return {
    attributionDays: cfg.days ?? attributionInfo(bizId).days ?? DEFAULT_ATTRIBUTION.attributionDays,
    minConversions: cfg.minConversions ?? DEFAULT_ATTRIBUTION.minConversions,
    minClicks: cfg.minClicks ?? DEFAULT_ATTRIBUTION.minClicks,
    today: today(),
  };
}

function loadEntities(bizId: string): RuleEntity[] {
  // Whitelist: automation only touches ads in whitelisted ad accounts.
  return q.all<Row>("SELECT a.*, c.target_cpa, c.name campaign_name FROM ad a LEFT JOIN campaign c ON c.id = a.campaign_id JOIN ad_account x ON x.id = a.ad_account_id WHERE a.biz_id = ? AND x.whitelisted = 1", bizId).map((ad) => {
    const month = latestDaily(bizId, ad.id, daysAgo(29));
    const hist = month.filter((h) => h.day >= daysAgo(6));
    const t = hist.filter((h) => h.day === today());
    return {
      id: ad.id, name: ad.name, platform: ad.platform, level: "ad", status: ad.status, dailyBudget: ad.daily_budget,
      metrics: { today: sumMetrics(t), "3d": sumMetrics(hist.filter((h) => h.day >= daysAgo(2))), "7d": sumMetrics(hist) },
      dailyHistory: hist.map((h) => h.metrics), refs: { target_cpa: ad.target_cpa }, cooldownUntil: ad.cooldown_until,
      attrs: { account: ad.ad_account_id, campaign: ad.campaign_name },
      dailyRows: month.map((h) => ({ day: h.day, spend: h.metrics.spend, results: h.metrics.results, clicks: h.metrics.clicks })),
    };
  });
}

// ---------------- Rule run (spec §8 loop) ----------------
export async function runRule(bizId: string, ruleId: string, opts: { forceDryRun?: boolean; actor?: string } = {}) {
  const rule = byId<Row>("rule", ruleId);
  if (!rule || rule.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy rule", 404);
  const def = RuleDefinition.parse(rule.definition);
  const mode = opts.forceDryRun ? "dry_run" : rule.mode;
  const entities = loadEntities(bizId);
  const settings = bizSettings(bizId);
  def.budgetGuard.maxTotalDailyBudget = Math.min(def.budgetGuard.maxTotalDailyBudget, settings.caps.maxTotalDailyAdBudget);
  const actionsToday = q.scalar<number>("SELECT COUNT(*) FROM action WHERE biz_id = ? AND actor = 'rule' AND status IN ('done','queued','approved') AND created_at >= ?", bizId, `${today()}T00:00:00`);
  const totalDailyBudget = entities.filter((e) => e.status === "active").reduce((a, e) => a + (e.dailyBudget ?? 0), 0);
  const res = evaluateRule(def, entities, { now: new Date(), actionsToday, totalDailyBudget, attribution: attributionOptions(bizId) });

  const cfg = q.get<Row>("SELECT autonomy FROM agent_config WHERE biz_id = ? AND agent_key = 'ads'", bizId);
  const lines = res.actions.map(describeAction);
  const runRow = insert("rule_run", {
    biz_id: bizId, rule_id: rule.id, rule_version: rule.version, mode, evaluated: res.evaluated, matched: res.matched,
    skipped: res.skipped, summary: { lines, actions: res.actions.length, blocked: res.actions.filter((a) => a.blocked).length },
  });
  for (const a of res.actions) {
    if (a.type === "notify") {
      if (mode === "live") await sendTelegram(`Rule "${rule.name}": ${a.reason} (${a.entityName})`, "warning");
      continue;
    }
    const key = `rule:${rule.id}:v${rule.version}:${a.entityId}:${a.type}:${today()}:${mode}`;
    if (q.get("SELECT id FROM action WHERE biz_id = ? AND idempotency_key = ?", bizId, key)) continue;
    const status = a.blocked ? "blocked" : mode === "dry_run" ? "proposed" : cfg?.autonomy === "L2" || cfg?.autonomy === "L3" ? "approved" : "proposed";
    const act = insert("action", {
      biz_id: bizId, rule_run_id: runRow.id, actor: "rule", type: a.type, target_type: "ad", target_id: a.entityId,
      params: { ...a.params, dryRun: mode === "dry_run", ruleName: rule.name }, before: a.before, after: a.after, status, reason: a.blocked ?? a.reason,
      reversible: a.reversible ? 1 : 0, idempotency_key: key,
    });
    if (mode === "live" && status === "approved") enqueue("ads", "action.execute", { actionId: act.id }, { bizId, idempotencyKey: `exec:${act.id}`, lockKey: `obj:${a.entityId}` });
    if (mode === "live" && status === "proposed") {
      insert("approval", { biz_id: bizId, subject_type: "action", subject_id: act.id, agent_key: "ads", title: describeAction(a), risk: a.type === "update_budget" ? "high" : "medium", status: "pending", preview: { before: a.before, after: a.after, rule: rule.name } });
      emit(bizId, "approval.created", { title: describeAction(a) });
    }
  }
  update("rule", rule.id, { consecutive_errors: 0 });
  audit(bizId, opts.actor ?? "rule_engine", "rule.run", { type: "rule", id: rule.id }, { mode, matched: res.matched, actions: res.actions.length });
  return { runId: runRow.id, mode, ...res, lines };
}

const EVERY_MIN: Record<string, number> = { m: 1, h: 60, d: 1440 };
export function everyMinutes(every: string | undefined) {
  const m = /^(\d+)\s*([mhd])$/.exec(every ?? "");
  return m ? Number(m[1]) * EVERY_MIN[m[2]] : 15;
}
const lastScheduledRun = new Map<string, number>();
/** Runs every active rule whose own trigger interval ("5m", "1h", "1d") has elapsed since its last live run. */
export async function runAllRules(bizId: string) {
  for (const r of q.all<Row>("SELECT id, name, definition FROM rule WHERE biz_id = ? AND status = 'active' ORDER BY priority DESC", bizId)) {
    const last = lastScheduledRun.get(r.id);
    if (last && Date.now() - last < everyMinutes(r.definition?.trigger?.every) * 60_000 - 30_000) continue;
    lastScheduledRun.set(r.id, Date.now());
    try {
      await runRule(bizId, r.id);
    } catch (e) {
      const row = byId<Row>("rule", r.id)!;
      const errs = row.consecutive_errors + 1;
      update("rule", r.id, { consecutive_errors: errs, ...(errs >= 3 ? { status: "paused" } : {}) });
      if (errs >= 3) await sendTelegram(`Rule "${r.name}" lỗi ${errs} lần liên tiếp — đã tự tạm dừng`, "urgent");
    }
  }
}

// ---------------- Action execution (worker side) ----------------
export async function executeAction(actionId: string) {
  const a = byId<Row>("action", actionId);
  if (!a || !["approved", "queued"].includes(a.status)) return;
  if (isKilled(a.biz_id, "ads") && a.type !== "pause_ad") {
    update("action", a.id, { status: "blocked", reason: "Kill switch quảng cáo đang bật" });
    return;
  }
  const ad = byId<Row>("ad", a.target_id);
  if (!ad) {
    update("action", a.id, { status: "failed", reason: "Đối tượng không còn tồn tại (NotFound)" });
    throw new PermanentError("ad not found");
  }
  const { c, acc } = connectorForAccount(ad.ad_account_id, ad.platform as PlatformKey);
  const ref = adRefOf(ad, acc);
  update("action", a.id, { status: "queued" });
  const cooldown = new Date(Date.now() + 24 * 3600_000).toISOString();
  if (a.type === "pause_ad" || a.type === "resume_ad") {
    const to = a.type === "pause_ad" ? "paused" : "active";
    await c.updateStatus!(ref, to, a.idempotency_key);
    update("ad", ad.id, { status: to, cooldown_until: a.actor === "rule" ? cooldown : ad.cooldown_until });
  } else if (a.type === "update_budget") {
    const amount = Number(a.after.daily_budget);
    await c.updateBudget!(ref, amount, a.idempotency_key);
    update("ad", ad.id, { daily_budget: amount, cooldown_until: cooldown });
  }
  update("action", a.id, { status: "done" });
  audit(a.biz_id, a.actor, "action.executed", { type: "action", id: a.id }, { type: a.type, target: ad.name, before: a.before, after: a.after });
  emit(a.biz_id, "action.executed", { actionId: a.id, type: a.type, target: ad.name });
}

/** Revert = a new action linked by reverts_action_id, through the same path (spec §8). */
export function revertAction(bizId: string, actionId: string, actor = "ceo") {
  const a = byId<Row>("action", actionId);
  if (!a || a.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy action", 404);
  if (a.status !== "done" || !a.reversible) throw new AppError("NOT_REVERSIBLE", "Chỉ hoàn tác được action đã thực hiện và có thể hoàn tác");
  const ad = byId<Row>("ad", a.target_id)!;
  if (a.type === "update_budget" && ad.daily_budget !== Number(a.after.daily_budget)) {
    throw new AppError("CHANGED_SINCE", "Ngân sách đã bị đổi sau hành động này — không hoàn tác tự động");
  }
  const type = a.type === "pause_ad" ? "resume_ad" : a.type === "resume_ad" ? "pause_ad" : "update_budget";
  const rev = insert("action", {
    biz_id: bizId, actor, type, target_type: "ad", target_id: a.target_id, params: { revert: true },
    before: a.after, after: a.before, status: "approved", reason: `Hoàn tác action ${a.id.slice(0, 8)}`, reversible: 0,
    reverts_action_id: a.id, idempotency_key: `revert:${a.id}`,
  });
  update("action", a.id, { status: "reverted" });
  update("ad", ad.id, { cooldown_until: null });
  enqueue("ads", "action.execute", { actionId: rev.id }, { bizId, idempotencyKey: `exec:${rev.id}`, lockKey: `obj:${a.target_id}` });
  audit(bizId, actor, "action.reverted", { type: "action", id: a.id });
  return rev;
}

/**
 * Total daily budget of everything running, counted ONCE per budget owner: several ads in one adset share the
 * adset budget (each ad row carries it, like Meta reports it), so summing ad rows would count it once per ad.
 * `excludeAdId` leaves out that ad's budget owner (used when that budget is about to change).
 */
export function activeAdBudget(bizId: string, excludeAdId?: string): number {
  const owner = "COALESCE(json_extract(meta, '$.budgetOwnerId'), id)";
  const skip = excludeAdId ? q.get<Row>(`SELECT ${owner} o FROM ad WHERE id = ?`, excludeAdId)?.o : undefined;
  return q.scalar<number>(`SELECT COALESCE(SUM(b), 0) FROM (SELECT MAX(daily_budget) b FROM ad WHERE biz_id = ? AND status = 'active'${skip ? ` AND ${owner} != ?` : ""} GROUP BY ${owner})`, ...(skip ? [bizId, skip] : [bizId])) ?? 0;
}

/** Manual change from the UI or MCP: same path (action -> queue), same caps. */
export function proposeManualAction(bizId: string, adId: string, type: "pause_ad" | "resume_ad" | "update_budget", amount: number | undefined, actor: string) {
  const ad = byId<Row>("ad", adId);
  if (!ad || ad.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy quảng cáo", 404);
  const s = bizSettings(bizId);
  if (type === "update_budget") {
    if (!amount || amount <= 0) throw new AppError("INVALID", "Ngân sách không hợp lệ");
    const total = activeAdBudget(bizId, adId);
    if (total + amount > s.caps.maxTotalDailyAdBudget) throw new AppError("CAP_EXCEEDED", `Vượt trần tổng ngân sách ngày ${s.caps.maxTotalDailyAdBudget.toLocaleString("vi-VN")}đ`);
  }
  const act = insert("action", {
    biz_id: bizId, actor, type, target_type: "ad", target_id: adId, params: { amount },
    before: { status: ad.status, daily_budget: ad.daily_budget }, after: type === "update_budget" ? { daily_budget: amount } : { status: type === "pause_ad" ? "paused" : "active" },
    status: "approved", reason: `Thao tác thủ công bởi ${actor}`, reversible: 1, idempotency_key: `manual:${adId}:${type}:${Date.now()}`,
  });
  enqueue("ads", "action.execute", { actionId: act.id }, { bizId, idempotencyKey: `exec:${act.id}`, lockKey: `obj:${adId}` });
  return act;
}

// ---------------- 9.4 Campaign Publisher ----------------
export async function publishCandidate(bizId: string, candidateId: string) {
  const cand = byId<Row>("ad_candidate", candidateId);
  if (!cand || cand.status !== "approved") return;
  const s = bizSettings(bizId);
  if (isKilled(bizId, "ads")) { update("ad_candidate", cand.id, { status: "failed", decision_note: "Kill switch quảng cáo" }); return; }
  const post = byId<Row>("post", cand.post_id)!;
  // Tự động (đề xuất bài điểm cao / luồng tự chạy) không tự nhân đôi chi tiêu trên cùng 1 bài. Sếp tạo tay ở
  // "Tạo chiến dịch" thì 1 bài được chạy ở nhiều chiến dịch / nhiều nhóm khác nhau.
  if (cand.options?.source !== "quick" && q.get("SELECT id FROM ad WHERE post_id = ? AND status = 'active'", post.id)) { update("ad_candidate", cand.id, { status: "failed", decision_note: "Bài đã có ad đang chạy" }); return; }
  const total = activeAdBudget(bizId);
  const structure = cand.options?.structure as CandidateStructure | undefined;
  if (structure?.adsets?.length) return publishStructure(bizId, cand, structure, total);
  if (total + cand.daily_budget > s.caps.maxTotalDailyAdBudget) { update("ad_candidate", cand.id, { status: "failed", decision_note: "Vượt trần tổng ngân sách ngày" }); return; }

  update("ad_candidate", cand.id, { status: "publishing" });
  const platform = cand.platform as PlatformKey;
  const account = cand.ad_account_id ? byId<Row>("ad_account", cand.ad_account_id) : q.get<Row>("SELECT * FROM ad_account WHERE biz_id = ? AND platform = ? AND whitelisted = 1 AND status = 'active' LIMIT 1", bizId, platform);
  if (!account) { update("ad_candidate", cand.id, { status: "failed", decision_note: `Chưa kết nối tài khoản quảng cáo ${platform} (Quản lý kết nối)` }); return; }
  if (!account.whitelisted) { update("ad_candidate", cand.id, { status: "failed", decision_note: "Tài khoản quảng cáo không nằm trong whitelist" }); return; }
  const tpl = cand.ad_template_id ? byId<Row>("ad_template", cand.ad_template_id) : null;
  const channel = byId<Row>("channel", post.channel_id);
  const opts = cand.options ?? {};
  const name = opts.name || `${today().replace(/-/g, "")}_${(channel?.name ?? "TAKI").replace(/\s+/g, "")}_${post.external_id.slice(-6)}_${tpl?.name ?? "msg"}`; // {date}_{page}_{postId}_{template}
  const { c } = await connectorForAdPublish(account.id, channel?.external_id, platform);
  let res: Awaited<ReturnType<NonNullable<typeof c.createAdFromPost>>>;
  try {
    res = await c.createAdFromPost!({ postExternalId: post.external_id, pageExternalId: channel?.external_id, accountExternalId: account.external_id, name, dailyBudget: cand.daily_budget, template: tpl?.definition, startPaused: !!opts.startPaused, currency: account.currency }, `cand:${cand.id}`);
  } catch (e) {
    update("ad_candidate", cand.id, { status: "failed", decision_note: e instanceof Error ? e.message : String(e) });
    throw new PermanentError(e instanceof Error ? e.message : String(e));
  }
  // Live Meta reports what actually happened (created paused, then switched on unless asked to stay paused).
  const adStatus = res.status ?? (opts.startPaused ? "paused" : "active");
  const activationError = (res.meta as any)?.activationError as string | undefined;
  tx(() => {
    let campaign = q.get<Row>("SELECT id FROM campaign WHERE ad_account_id = ? AND external_id = ?", account.id, res.campaignExternalId);
    if (!campaign) campaign = insert("campaign", { biz_id: bizId, ad_account_id: account.id, platform, external_id: res.campaignExternalId, name: `Từ bài: ${post.title.slice(0, 40)}`, objective: tpl?.definition?.objective ?? "messages", status: adStatus, daily_budget: cand.daily_budget, target_cpa: tpl?.definition?.targetCpa ?? null });
    const ad = q.get<Row>("SELECT id FROM ad WHERE ad_account_id = ? AND external_id = ?", account.id, res.externalId)
      ?? insert("ad", { biz_id: bizId, ad_account_id: account.id, platform, external_id: res.externalId, campaign_id: campaign.id, name, status: adStatus, daily_budget: cand.daily_budget, post_id: post.id, currency: account.currency, meta: res.meta ?? {} });
    insert("post_ad_link", { biz_id: bizId, post_id: post.id, ad_id: ad.id });
    update("ad_candidate", cand.id, { status: "published", ad_id: ad.id, ...(activationError ? { decision_note: `Đã tạo nhưng chưa bật được (đang tạm dừng): ${activationError}` } : {}) });
    syncPostAdStatus(post.id);
    insert("action", { biz_id: bizId, actor: "agent", type: "create_ad_from_post", target_type: "ad", target_id: ad.id, params: { candidateId: cand.id }, before: {}, after: { status: adStatus, daily_budget: cand.daily_budget }, status: "done", reason: activationError ? `Đã tạo (tạm dừng) — chưa bật được: ${activationError}` : "Đề xuất đã được duyệt", reversible: 1, idempotency_key: `create:${cand.id}` });
  });
  audit(bizId, "ads", "ad.created_from_post", { type: "ad_candidate", id: cand.id }, { name });
  emit(bizId, "action.executed", { type: "create_ad_from_post", target: name });
}

/** post.ad_status từ quảng cáo thật của bài: "running" khi CÒN BẤT KỲ quảng cáo nào đang chạy (1 bài có thể ở nhiều chiến dịch). */
export function syncPostAdStatus(postId: string) {
  const running = q.get("SELECT id FROM ad WHERE post_id = ? AND status = 'active' LIMIT 1", postId);
  update("post", postId, { ad_status: running ? "running" : "none" });
}

/** Saved on ad_candidate.options.structure by "Tạo chiến dịch" when several posts / adsets are chosen. */
export type CandidateStructure = {
  /** Every selected post (stored post ids); ad_candidate.post_id is the first one. */
  postIds: string[];
  /** Per adset: daily budget + optional own template (targeting). */
  adsets: { dailyBudget: number; templateId?: string | null; name?: string }[];
  /** "test" = công thức 1:3:3, "custom" = Sếp tự chọn số nhóm / số bài. */
  mode?: "test" | "custom";
};

/** 1 campaign → N adsets → M ads (one per post). Same checks as a single ad, budget counted per adset. */
async function publishStructure(bizId: string, cand: Row, st: CandidateStructure, activeTotal: number) {
  const s = bizSettings(bizId);
  const fail = (note: string) => { update("ad_candidate", cand.id, { status: "failed", decision_note: note }); };
  const posts = st.postIds.map((id) => byId<Row>("post", id)).filter((p): p is Row => !!p);
  if (!posts.length) return fail("Không thấy bài viết đã chọn");
  const total = st.adsets.reduce((a, x) => a + x.dailyBudget, 0);
  if (!cand.options?.startPaused && activeTotal + total > s.caps.maxTotalDailyAdBudget) return fail("Vượt trần tổng ngân sách ngày");

  update("ad_candidate", cand.id, { status: "publishing" });
  const platform = cand.platform as PlatformKey;
  const account = cand.ad_account_id ? byId<Row>("ad_account", cand.ad_account_id) : undefined;
  if (!account) return fail(`Chưa kết nối tài khoản quảng cáo ${platform} (Quản lý kết nối)`);
  if (!account.whitelisted) return fail("Tài khoản quảng cáo không nằm trong whitelist");
  const tpl = cand.ad_template_id ? byId<Row>("ad_template", cand.ad_template_id) : null;
  const channel = byId<Row>("channel", posts[0].channel_id);
  const opts = cand.options ?? {};
  const name = opts.name || `${today().replace(/-/g, "")}_${(channel?.name ?? "TAKI").replace(/\s+/g, "")}_${st.adsets.length}nhom_${posts.length}bai_${tpl?.name ?? "msg"}`;
  const { c } = await connectorForAdPublish(account.id, channel?.external_id, platform);
  if (!c.createCampaignFromPosts) return fail("Nền tảng này chưa hỗ trợ tạo chiến dịch nhiều nhóm");
  let res: Awaited<ReturnType<NonNullable<typeof c.createCampaignFromPosts>>>;
  try {
    res = await c.createCampaignFromPosts({
      name, template: tpl?.definition, accountExternalId: account.external_id, pageExternalId: channel?.external_id,
      startPaused: !!opts.startPaused, currency: account.currency,
      posts: posts.map((p) => ({ postExternalId: p.external_id })),
      adsets: st.adsets.map((a) => ({ dailyBudget: a.dailyBudget, name: a.name, template: a.templateId ? byId<Row>("ad_template", a.templateId)?.definition : undefined })),
    }, `cand:${cand.id}`);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    throw new PermanentError(e instanceof Error ? e.message : String(e));
  }
  const adStatus = res.status ?? (opts.startPaused ? "paused" : "active");
  const activationError = (res.meta as any)?.activationError as string | undefined;
  const byExternal = new Map(posts.map((p) => [String(p.external_id), p]));
  let firstAdId: string | null = null;
  tx(() => {
    let campaign = q.get<Row>("SELECT id FROM campaign WHERE ad_account_id = ? AND external_id = ?", account.id, res.campaignExternalId);
    if (!campaign) campaign = insert("campaign", { biz_id: bizId, ad_account_id: account.id, platform, external_id: res.campaignExternalId, name, objective: tpl?.definition?.objective ?? "messages", status: adStatus, daily_budget: null, target_cpa: tpl?.definition?.targetCpa ?? null });
    for (const set of res.adsets) {
      for (const a of set.ads) {
        const post = byExternal.get(String(a.postExternalId));
        // Each ad row carries its adset budget (same as an import from Meta); totals count it once per budgetOwnerId.
        const ad = q.get<Row>("SELECT id FROM ad WHERE ad_account_id = ? AND external_id = ?", account.id, a.externalId)
          ?? insert("ad", { biz_id: bizId, ad_account_id: account.id, platform, external_id: a.externalId, campaign_id: campaign.id, name: a.name, status: adStatus, daily_budget: set.dailyBudget, post_id: post?.id ?? null, currency: account.currency,
            meta: { ...(res.meta ?? {}), adsetId: set.externalId, adsetName: set.name, budgetOwner: "adset", budgetOwnerId: set.externalId, structureCandidateId: cand.id } });
        firstAdId ??= ad.id;
        if (post) insert("post_ad_link", { biz_id: bizId, post_id: post.id, ad_id: ad.id });
      }
    }
    for (const p of posts) syncPostAdStatus(p.id);
    update("ad_candidate", cand.id, { status: "published", ad_id: firstAdId, ...(activationError ? { decision_note: `Đã tạo nhưng chưa bật được (đang tạm dừng): ${activationError}` } : {}) });
    insert("action", { biz_id: bizId, actor: "agent", type: "create_ad_from_post", target_type: "campaign", target_id: campaign.id, params: { candidateId: cand.id, adsets: res.adsets.length, posts: posts.length }, before: {}, after: { status: adStatus, daily_budget: total }, status: "done", reason: activationError ? `Đã tạo (tạm dừng) — chưa bật được: ${activationError}` : `Chiến dịch ${res.adsets.length} nhóm × ${posts.length} bài`, reversible: 1, idempotency_key: `create:${cand.id}` });
  });
  audit(bizId, "ads", "ad.campaign_created", { type: "ad_candidate", id: cand.id }, { name, adsets: res.adsets.length, posts: posts.length, total });
  emit(bizId, "action.executed", { type: "create_ad_from_post", target: name });
}

// ---------------- Weekly ads analysis (Ads Agent with the mkt-ads skills) ----------------
export function startAdsReport(bizId: string, actor = "scheduler") {
  if (!q.scalar<number>("SELECT COUNT(*) FROM ad WHERE biz_id = ?", bizId)) throw new AppError("NO_ADS", "Chưa có quảng cáo nào để phân tích");
  const table = q.all<Row>("SELECT a.id, a.name, a.platform, a.status, a.daily_budget, c.name campaign, c.target_cpa FROM ad a LEFT JOIN campaign c ON c.id = a.campaign_id WHERE a.biz_id = ?", bizId).map((a) => {
    const m = sumMetrics(latestDaily(bizId, a.id, daysAgo(6)));
    return {
      name: a.name, campaign: a.campaign, platform: a.platform, status: a.status, daily_budget: a.daily_budget, target_cpa: a.target_cpa,
      spend: m.spend, impressions: m.impressions, clicks: m.clicks, results: m.results,
      ctr: m.impressions ? Math.round((m.clicks / m.impressions) * 10000) / 100 : null, cpa: m.results ? Math.round(m.spend / m.results) : null,
    };
  });
  const task = insert("task", { biz_id: bizId, goal_id: null, agent_key: "ads", title: `Báo cáo & đề xuất Ads tuần ${today()}`, status: "ready", input: { table }, depends_on: [] });
  enqueue("agent", "agent.run", { taskId: task.id }, { bizId, idempotencyKey: `run:${task.id}:0` });
  audit(bizId, actor, "ads.report_started", { type: "task", id: task.id });
  return task;
}

/** Turn the report's pause/scale/fix decisions into approval items (same caps and queue as rules). */
export function createAdsProposals(task: Row) {
  const bizId = task.biz_id as string;
  const s = bizSettings(bizId);
  let created = 0;
  for (const d of (task.output?.decisions ?? []) as { adName: string; decision: string; reason: string; budgetChangePct: number }[]) {
    if (d.decision === "keep") continue;
    const ad = q.get<Row>("SELECT * FROM ad WHERE biz_id = ? AND name = ?", bizId, d.adName);
    if (!ad) continue;
    const key = `adsreport:${task.id}:${ad.id}`;
    if (q.get("SELECT id FROM action WHERE biz_id = ? AND idempotency_key = ?", bizId, key)) continue;
    let type: "pause_ad" | "update_budget";
    let after: Row;
    if (d.decision === "pause") {
      if (ad.status !== "active") continue;
      type = "pause_ad"; after = { status: "paused" };
    } else {
      if (!ad.daily_budget || ad.status !== "active") continue;
      const pct = Math.max(-20, Math.min(20, d.budgetChangePct || (d.decision === "scale" ? 20 : -20)));
      const next = Math.round((ad.daily_budget * (1 + pct / 100)) / 1000) * 1000;
      const total = activeAdBudget(bizId);
      if (next > ad.daily_budget && total + (next - ad.daily_budget) > s.caps.maxTotalDailyAdBudget) continue;
      type = "update_budget"; after = { daily_budget: next };
    }
    const act = insert("action", {
      biz_id: bizId, task_run_id: null, actor: "agent", type, target_type: "ad", target_id: ad.id, params: { source: "ads_report", taskId: task.id },
      before: { status: ad.status, daily_budget: ad.daily_budget }, after, status: "proposed", reason: d.reason, reversible: 1, idempotency_key: key,
    });
    const title = type === "pause_ad" ? `Tắt "${ad.name}": ${d.reason}` : `Đổi ngân sách "${ad.name}" ${ad.daily_budget} → ${after.daily_budget}: ${d.reason}`;
    insert("approval", { biz_id: bizId, subject_type: "action", subject_id: act.id, agent_key: "ads", title: title.slice(0, 240), risk: type === "update_budget" ? "high" : "medium", status: "pending", preview: { before: act.before, after, source: "Báo cáo Ads tuần" } });
    created++;
  }
  if (created) emit(bizId, "approval.created", { title: `${created} đề xuất từ báo cáo Ads` });
  return created;
}
