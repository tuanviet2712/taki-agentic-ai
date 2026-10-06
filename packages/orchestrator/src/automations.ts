import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { RuleDefinition } from "@dotaka/contracts";
import { audit, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { live } from "@dotaka/connectors";
import { AppError, nowIso } from "@dotaka/shared";
import { enqueue } from "./queue.ts";
import { latestDaily, runRule, sumMetrics, syncAdMetrics, today } from "./ads.ts";
import { credsOf } from "./connections.ts";

/**
 * Automation configs — the "Cấu hình" screen (ads.done-style):
 *  - metrics_pull: pull ad metrics and write them to Google Sheets on a schedule
 *  - auto_off:     pause ads that match conditions            (backed by a rule → same engine, dry-run first)
 *  - budget:       raise/lower daily budget on conditions      (backed by a rule)
 *  - auto_run:     turn ads on/off by time of day, or turn high-scoring posts into ads
 * Rule-backed configs keep all guards of the rule engine (min data, cooldown, step cap, total cap, whitelist).
 */
export const AUTOMATION_TYPES = ["metrics_pull", "auto_off", "budget", "auto_run"] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];

const Cond = z.object({
  metric: z.enum(["spend", "results", "cpa", "ctr", "cpm", "impressions", "clicks", "reach"]),
  window: z.enum(["today", "3d", "7d"]),
  op: z.enum([">", ">=", "<", "<="]),
  value: z.number().optional(),
  ref: z.string().optional(),
  factor: z.number().optional(),
  consecutiveDays: z.number().int().optional(),
});
const Scope = z.object({
  platform: z.enum(["any", "meta", "tiktok", "google_ads"]).default("any"),
  accountIds: z.array(z.string()).default([]),
  nameFilter: z.object({ op: z.enum(["contains", "notContains", "startsWith"]), value: z.string() }).nullable().optional(),
});
export const AutomationConfig = {
  metrics_pull: z.object({
    accountIds: z.array(z.string()).default([]),
    level: z.enum(["ad", "campaign"]).default("ad"),
    range: z.enum(["today", "yesterday", "last_3d", "last_7d", "last_30d"]).default("today"),
    sheetConnectionId: z.string().nullable().default(null),
    spreadsheet: z.string().default(""),
    tab: z.string().min(1).default("Chỉ số Ads"),
    writeMode: z.enum(["overwrite", "append"]).default("overwrite"),
    everyMinutes: z.number().int().min(5).max(1440).default(60),
  }),
  auto_off: Scope.extend({
    match: z.enum(["all", "any"]).default("all"),
    conditions: z.array(Cond).min(1),
    minSpend: z.number().min(0).default(0),
    notify: z.boolean().default(true),
    everyMinutes: z.number().int().min(5).max(1440).default(15),
    live: z.boolean().default(false),
  }),
  budget: Scope.extend({
    match: z.enum(["all", "any"]).default("all"),
    conditions: z.array(Cond).min(1),
    pct: z.number().min(-50).max(50).refine((v) => v !== 0, "Phần trăm phải khác 0"),
    maxBudget: z.number().int().positive().default(20_000_000),
    minSpend: z.number().min(0).default(0),
    cooldownHours: z.number().min(1).max(168).default(24),
    notify: z.boolean().default(true),
    everyMinutes: z.number().int().min(5).max(1440).default(60),
    live: z.boolean().default(false),
  }),
  auto_run: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("schedule"),
      adIds: z.array(z.string()).min(1, "Chọn ít nhất 1 quảng cáo"),
      onTime: z.string().regex(/^\d{2}:\d{2}$/), offTime: z.string().regex(/^\d{2}:\d{2}$/),
      days: z.array(z.number().int().min(0).max(6)).min(1),
    }),
    z.object({
      mode: z.literal("post_to_ad"),
      channelIds: z.array(z.string()).default([]),
      minScore: z.number().min(0).max(100).default(70),
      templateId: z.string().nullable().default(null),
      adAccountId: z.string().nullable().default(null),
      dailyBudget: z.number().int().positive().default(1_000_000),
      requireApproval: z.boolean().default(true),
      startPaused: z.boolean().default(false),
      maxPerDay: z.number().int().min(1).max(20).default(2),
    }),
  ]),
} as const;

// ---------------- Rule compilation (auto_off / budget) ----------------
function buildRule(type: "auto_off" | "budget", c: any): RuleDefinition {
  const filters: { field: string; op: any; value: string }[] = [];
  if (c.accountIds?.length) filters.push({ field: "account", op: "in", value: c.accountIds.join(",") });
  if (c.nameFilter?.value) filters.push({ field: "name", op: c.nameFilter.op, value: c.nameFilter.value });
  const conds = c.conditions.map((x: any) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined && v !== null)));
  const notify = c.notify ? [{ type: "notify" as const, channel: "telegram" }] : [];
  return RuleDefinition.parse({
    scope: { platform: c.platform ?? "any", level: "ad", filters },
    trigger: { type: "schedule", every: `${c.everyMinutes}m` },
    conditions: c.match === "any" ? { any: conds } : { all: conds },
    minData: c.minSpend ? { spend: c.minSpend } : {},
    actions: type === "auto_off" ? [{ type: "pause_ad" }, ...notify] : [{ type: "budget_change", pct: c.pct }, ...notify],
    limits: { cooldownHours: c.cooldownHours ?? 24, maxActionsPerRun: 20, maxActionsPerDay: 60 },
    budgetGuard: { maxStepPct: Math.max(20, Math.abs(c.pct ?? 20)), maxDailyBudgetPerEntity: c.maxBudget ?? 20_000_000, maxTotalDailyBudget: 1_000_000_000 },
  });
}
/** Best-effort reverse mapping so rules created before this screen show up as configs. */
function configFromRule(def: any) {
  const tree = def.conditions ?? {};
  const list = (tree.all ?? tree.any ?? []).filter((x: any) => typeof x?.metric === "string");
  const acc = (def.scope?.filters ?? []).find((f: any) => f.field === "account");
  const nf = (def.scope?.filters ?? []).find((f: any) => (f.field ?? "name") === "name");
  const budget = (def.actions ?? []).find((a: any) => a.type === "budget_change");
  return {
    platform: def.scope?.platform ?? "any", accountIds: acc ? String(acc.value).split(",") : [], nameFilter: nf ? { op: nf.op === "==" ? "contains" : nf.op, value: nf.value } : null,
    match: tree.any ? "any" : "all", conditions: list, minSpend: def.minData?.spend ?? 0, notify: (def.actions ?? []).some((a: any) => a.type === "notify"),
    everyMinutes: parseEvery(def.trigger?.every), ...(budget ? { pct: budget.pct, maxBudget: def.budgetGuard?.maxDailyBudgetPerEntity ?? 20_000_000, cooldownHours: def.limits?.cooldownHours ?? 24 } : {}),
  };
}
function parseEvery(e?: string) {
  const m = /^(\d+)\s*([mhd])$/.exec(e ?? "");
  return m ? Number(m[1]) * ({ m: 1, h: 60, d: 1440 } as Record<string, number>)[m[2]] : 15;
}

// ---------------- CRUD ----------------
export async function saveAutomation(bizId: string, input: { id?: string; type: AutomationType; name: string; config: unknown }, actor: string) {
  if (!AUTOMATION_TYPES.includes(input.type)) throw new AppError("INVALID", "Loại cấu hình không hợp lệ");
  const name = input.name?.trim();
  if (!name) throw new AppError("INVALID", "Cần đặt tên cấu hình");
  const config: any = (AutomationConfig[input.type] as z.ZodTypeAny).parse(input.config);
  if (input.type === "metrics_pull" && !config.sheetConnectionId) throw new AppError("INVALID", "Chọn kết nối Google Sheets (hoặc thêm trong Quản lý kết nối)");
  if (input.type === "metrics_pull") {
    const sc = byId<Row>("connection", config.sheetConnectionId);
    if (!sc || sc.platform !== "sheets" || sc.status === "revoked") throw new AppError("INVALID", "Kết nối Google Sheets không hợp lệ");
    if (sc.mode === "live" && !config.spreadsheet && !sc.config?.default_spreadsheet) throw new AppError("INVALID", "Nhập link Google Sheet");
  }
  const cur = input.id ? byId<Row>("automation", input.id) : undefined;
  if (input.id && (!cur || cur.biz_id !== bizId)) throw new AppError("NOT_FOUND", "Không tìm thấy cấu hình", 404);

  let ruleId: string | null = cur?.rule_id ?? null;
  if (input.type === "auto_off" || input.type === "budget") {
    const def = buildRule(input.type, config);
    const desc = input.type === "auto_off" ? "Cấu hình Tắt ads tự động" : `Cấu hình ${config.pct > 0 ? "tăng" : "giảm"} ngân sách ${Math.abs(config.pct)}%`;
    const rule = ruleId ? byId<Row>("rule", ruleId) : undefined;
    if (rule) update("rule", rule.id, { name, description: desc, definition: def, version: rule.version + 1, mode: "dry_run", status: cur?.status === "paused" ? "paused" : "active" });
    else ruleId = insert("rule", { biz_id: bizId, name, description: desc, definition: def, mode: "dry_run", status: "active", version: 1, priority: input.type === "auto_off" ? 200 : 100 }).id;
    // New version always dry-runs first (spec §8); LIVE only after that, when requested.
    await runRule(bizId, ruleId!, { forceDryRun: true, actor });
    if (config.live) {
      update("rule", ruleId!, { mode: "live" });
      audit(bizId, actor, "rule.mode_changed", { type: "rule", id: ruleId! }, { to: "live", via: "automation" });
    }
  }
  const data = { type: input.type, name, config, rule_id: ruleId, next_run_at: nowIso() };
  const row = cur ? (update("automation", cur.id, data), byId<Row>("automation", cur.id)!) : insert("automation", { biz_id: bizId, status: "active", run_count: 0, ...data });
  audit(bizId, actor, cur ? "automation.updated" : "automation.created", { type: "automation", id: row.id }, { type: input.type, name });
  return publicAutomation(row);
}

export function setAutomationStatus(bizId: string, id: string, on: boolean, actor: string) {
  const a = must(bizId, id);
  update("automation", a.id, { status: on ? "active" : "paused", next_run_at: nowIso() });
  if (a.rule_id) update("rule", a.rule_id, { status: on ? "active" : "paused", consecutive_errors: 0 });
  audit(bizId, actor, on ? "automation.enabled" : "automation.paused", { type: "automation", id: a.id });
  return publicAutomation(byId<Row>("automation", a.id)!);
}
export function setAutomationLive(bizId: string, id: string, liveOn: boolean, actor: string) {
  const a = must(bizId, id);
  if (!a.rule_id) throw new AppError("INVALID", "Chỉ cấu hình dạng rule mới có chế độ chạy thử/LIVE");
  const rule = byId<Row>("rule", a.rule_id)!;
  if (liveOn && !q.scalar<number>("SELECT COUNT(*) FROM rule_run WHERE rule_id = ? AND rule_version = ? AND mode = 'dry_run'", rule.id, rule.version))
    throw new AppError("DRY_RUN_REQUIRED", "Cần chạy thử ít nhất 1 lần trước khi bật LIVE");
  update("rule", rule.id, { mode: liveOn ? "live" : "dry_run" });
  update("automation", a.id, { config: { ...a.config, live: liveOn } });
  audit(bizId, actor, "rule.mode_changed", { type: "rule", id: rule.id }, { to: liveOn ? "live" : "dry_run", via: "automation" });
  return publicAutomation(byId<Row>("automation", a.id)!);
}
export function deleteAutomation(bizId: string, id: string, actor: string) {
  const a = must(bizId, id);
  if (a.rule_id) update("rule", a.rule_id, { status: "archived" });
  q.run("DELETE FROM automation WHERE id = ?", a.id);
  audit(bizId, actor, "automation.deleted", { type: "automation", id: a.id }, { name: a.name, type: a.type });
  return { ok: true };
}
function must(bizId: string, id: string) {
  const a = byId<Row>("automation", id);
  if (!a || a.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy cấu hình", 404);
  return a;
}

export function publicAutomation(a: Row) {
  const rule = a.rule_id ? byId<Row>("rule", a.rule_id) : undefined;
  const lastRun = rule ? q.get<Row>("SELECT created_at, mode, evaluated, matched, summary FROM rule_run WHERE rule_id = ? ORDER BY created_at DESC LIMIT 1", rule.id) : undefined;
  return {
    ...a, mode: rule?.mode ?? null, ruleVersion: rule?.version ?? null,
    lastRun: lastRun ? { at: lastRun.created_at, mode: lastRun.mode, text: `Khớp ${lastRun.matched}/${lastRun.evaluated} ad${lastRun.summary?.lines?.[0] ? ` — ${lastRun.summary.lines[0]}` : ""}` }
      : a.last_run_at ? { at: a.last_run_at, mode: null, text: a.last_result?.text ?? "" } : null,
    actionsToday: rule ? q.scalar<number>("SELECT COUNT(*) FROM action a JOIN rule_run r ON r.id = a.rule_run_id WHERE r.rule_id = ? AND a.created_at >= ? AND a.status = 'done'", rule.id, `${today()}T00:00:00`) : 0,
  };
}

/** Rules that predate the Cấu hình screen become configs (once), so everything is managed in one place. */
export function ensureAutomations(bizId: string) {
  for (const r of q.all<Row>("SELECT * FROM rule WHERE biz_id = ? AND status != 'archived' AND id NOT IN (SELECT rule_id FROM automation WHERE rule_id IS NOT NULL)", bizId)) {
    const acts = (r.definition?.actions ?? []) as { type: string }[];
    const type = acts.some((x) => x.type === "budget_change") ? "budget" : acts.some((x) => x.type === "pause_ad") ? "auto_off" : null;
    if (!type) continue;
    insert("automation", { biz_id: bizId, type, name: r.name, config: { ...configFromRule(r.definition), live: r.mode === "live" }, status: r.status === "paused" ? "paused" : "active", rule_id: r.id, run_count: 0 });
  }
}

// ---------------- Runners ----------------
const TZ = "Asia/Ho_Chi_Minh";
function localNow(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(d).map((p) => [p.type, p.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { hm: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`, dow };
}
const inWindow = (hm: string, on: string, off: string) => (on <= off ? hm >= on && hm < off : hm >= on || hm < off);

function rangeDates(range: string): [string, string] {
  const d = (n: number) => today(new Date(Date.now() - n * 86400_000));
  switch (range) {
    case "yesterday": return [d(1), d(1)];
    case "last_3d": return [d(2), d(0)];
    case "last_7d": return [d(6), d(0)];
    case "last_30d": return [d(29), d(0)];
    default: return [d(0), d(0)];
  }
}

async function runMetricsPull(a: Row) {
  const c = a.config;
  const [since, until] = rangeDates(c.range);
  const accountIds: string[] = c.accountIds?.length ? c.accountIds : q.all<Row>("SELECT id FROM ad_account WHERE biz_id = ? AND whitelisted = 1", a.biz_id).map((x) => x.id);
  if (!accountIds.length) throw new AppError("NO_ACCOUNT", "Chưa có tài khoản quảng cáo nào (kết nối Facebook/TikTok trước)");
  await syncAdMetrics(a.biz_id, until, { since, accountIds });
  const ads = q.all<Row>(`SELECT ad.*, x.name account_name, cp.name campaign_name FROM ad JOIN ad_account x ON x.id = ad.ad_account_id LEFT JOIN campaign cp ON cp.id = ad.campaign_id
    WHERE ad.biz_id = ? AND ad.ad_account_id IN (${accountIds.map(() => "?").join(",")}) ORDER BY x.name, cp.name, ad.name`, a.biz_id, ...accountIds);
  const header = c.level === "campaign"
    ? ["Ngày", "Tài khoản", "Chiến dịch", "Số ad", "Chi tiêu", "Hiển thị", "Click", "CTR %", "Kết quả", "Chi phí/KQ", "Reach", "Cập nhật"]
    : ["Ngày", "Tài khoản", "Chiến dịch", "Quảng cáo", "Trạng thái", "Ngân sách/ngày", "Chi tiêu", "Hiển thị", "Click", "CTR %", "Kết quả", "Chi phí/KQ", "Reach", "Cập nhật"];
  const stamp = new Date().toLocaleString("vi-VN", { timeZone: TZ });
  const rows: (string | number | null)[][] = [];
  const days: string[] = [];
  for (let d = new Date(`${since}T00:00:00Z`); today(d) <= until; d = new Date(d.getTime() + 86400_000)) days.push(today(d));
  const ctr = (m: any) => (m.impressions ? Math.round((m.clicks / m.impressions) * 10000) / 100 : 0);
  const cpa = (m: any) => (m.results ? Math.round(m.spend / m.results) : "");
  for (const day of days) {
    if (c.level === "campaign") {
      const groups = new Map<string, { account: string; campaign: string; ads: number; rows: ReturnType<typeof latestDaily> }>();
      for (const ad of ads) {
        const k = `${ad.account_name}|${ad.campaign_name ?? "—"}`;
        const g = groups.get(k) ?? { account: ad.account_name as string, campaign: (ad.campaign_name ?? "—") as string, ads: 0, rows: [] as ReturnType<typeof latestDaily> };
        g.ads++; g.rows.push(...latestDaily(a.biz_id, ad.id, day, day));
        groups.set(k, g);
      }
      for (const g of groups.values()) {
        const m = sumMetrics(g.rows);
        rows.push([day, g.account, g.campaign, g.ads, m.spend, m.impressions, m.clicks, ctr(m), m.results, cpa(m), m.reach ?? 0, stamp]);
      }
    } else {
      for (const ad of ads) {
        const m = sumMetrics(latestDaily(a.biz_id, ad.id, day, day));
        rows.push([day, ad.account_name, ad.campaign_name ?? "—", ad.name, ad.status === "active" ? "Đang chạy" : "Tạm dừng", ad.daily_budget ?? "", m.spend, m.impressions, m.clicks, ctr(m), m.results, cpa(m), m.reach ?? 0, stamp]);
      }
    }
  }
  const values = c.writeMode === "overwrite" || !a.run_count ? [header, ...rows] : rows;
  const sc = byId<Row>("connection", c.sheetConnectionId);
  if (!sc || sc.status === "revoked") throw new AppError("NO_SHEET", "Kết nối Google Sheets đã bị ngắt");
  if (sc.mode === "live") {
    const r = await live.sheetsWrite(credsOf(sc) as any, c.spreadsheet || sc.config?.default_spreadsheet, c.tab, values, c.writeMode);
    return { text: `Đã ghi ${rows.length} dòng vào "${r.title}" › ${c.tab}`, rows: rows.length, url: r.url };
  }
  // Sandbox Sheets: write a CSV the CEO can open, same columns as the real sheet.
  const dir = resolve(process.env.DATA_DIR ?? "data", "exports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${a.id}.csv`);
  const csv = values.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  writeFileSync(file, `﻿${csv}\n`, { flag: c.writeMode === "append" && a.run_count ? "a" : "w" });
  return { text: `(Mô phỏng) Đã ghi ${rows.length} dòng ra file CSV`, rows: rows.length, file, download: `/v1/automations/${a.id}/export.csv` };
}

function queueAdAction(bizId: string, ad: Row, type: "pause_ad" | "resume_ad", reason: string, actor: string) {
  if (q.get("SELECT id FROM action WHERE target_id = ? AND status IN ('approved','queued')", ad.id)) return false;
  const act = insert("action", {
    biz_id: bizId, actor, type, target_type: "ad", target_id: ad.id, params: { source: "automation" },
    before: { status: ad.status, daily_budget: ad.daily_budget }, after: { status: type === "pause_ad" ? "paused" : "active" },
    status: "approved", reason, reversible: 1, idempotency_key: `auto:${ad.id}:${type}:${Date.now()}`,
  });
  enqueue("ads", "action.execute", { actionId: act.id }, { bizId, idempotencyKey: `exec:${act.id}`, lockKey: `obj:${ad.id}` });
  return true;
}

async function runAutoRun(a: Row, dryRun: boolean) {
  const c = a.config;
  if (c.mode === "schedule") {
    const { hm, dow } = localNow();
    const want = c.days.includes(dow) && inWindow(hm, c.onTime, c.offTime) ? "active" : "paused";
    const lines: string[] = [];
    for (const id of c.adIds as string[]) {
      const ad = q.get<Row>("SELECT ad.*, x.whitelisted FROM ad JOIN ad_account x ON x.id = ad.ad_account_id WHERE ad.id = ?", id);
      if (!ad || ad.status === want) continue;
      if (!ad.whitelisted) { lines.push(`Bỏ qua "${ad.name}" (không trong whitelist)`); continue; }
      // A rule paused it for poor results: do not switch it back on just because it's daytime.
      if (want === "active" && ad.cooldown_until && new Date(ad.cooldown_until) > new Date()) { lines.push(`Giữ tắt "${ad.name}" (rule vừa tắt, đang cooldown)`); continue; }
      const reason = want === "active" ? `Lịch chạy: bật lúc ${c.onTime}` : `Lịch chạy: tắt lúc ${c.offTime}`;
      if (dryRun || queueAdAction(a.biz_id, ad, want === "active" ? "resume_ad" : "pause_ad", reason, `automation:${a.name}`)) lines.push(`${dryRun ? "Sẽ " : ""}${want === "active" ? "bật" : "tắt"} "${ad.name}"`);
    }
    return { text: lines.length ? lines.join(" · ") : `Đúng lịch (${want === "active" ? "đang trong giờ chạy" : "ngoài giờ chạy"}), không cần đổi`, lines };
  }
  // post_to_ad
  const created = q.scalar<number>("SELECT COUNT(*) FROM ad_candidate WHERE biz_id = ? AND created_at >= ? AND json_extract(options, '$.automationId') = ?", a.biz_id, `${today()}T00:00:00`, a.id);
  const room = Math.max(0, c.maxPerDay - created);
  const posts = q.all<Row>(`SELECT p.*, ch.platform ch_platform, (SELECT score FROM post_score s WHERE s.post_id = p.id ORDER BY computed_at DESC LIMIT 1) score
    FROM post p JOIN channel ch ON ch.id = p.channel_id WHERE p.biz_id = ? AND p.ad_status = 'none' AND p.published_at >= ? AND ch.whitelisted = 1
    ${c.channelIds.length ? `AND p.channel_id IN (${c.channelIds.map(() => "?").join(",")})` : ""} ORDER BY score DESC`, a.biz_id, new Date(Date.now() - 72 * 3600_000).toISOString(), ...c.channelIds)
    .filter((p) => (p.score ?? 0) >= c.minScore && !q.get("SELECT id FROM ad_candidate WHERE post_id = ? AND status NOT IN ('rejected','failed')", p.id)).slice(0, room);
  const lines: string[] = [];
  for (const p of posts) {
    const platform = p.ch_platform === "tiktok" ? "tiktok" : "meta";
    lines.push(`${dryRun ? "Sẽ tạo" : "Tạo"} ads từ "${String(p.title).slice(0, 60)}" (điểm ${Math.round(p.score)})`);
    if (dryRun) continue;
    const cand = insert("ad_candidate", {
      biz_id: a.biz_id, post_id: p.id, platform, ad_template_id: c.templateId, daily_budget: c.dailyBudget, score: p.score, reasons: [`Điểm bài ${Math.round(p.score)} ≥ ${c.minScore} (cấu hình "${a.name}")`],
      status: c.requireApproval ? "proposed" : "approved", ad_account_id: c.adAccountId, options: { automationId: a.id, startPaused: c.startPaused, source: "automation" },
    });
    update("post", p.id, { ad_status: "candidate" });
    if (c.requireApproval) {
      insert("approval", { biz_id: a.biz_id, subject_type: "ad_candidate", subject_id: cand.id, agent_key: "ads", title: `Chạy ads từ bài: ${p.title}`, risk: "medium", status: "pending", preview: { platform, dailyBudget: c.dailyBudget, score: p.score, reasons: cand.reasons } });
      emit(a.biz_id, "approval.created", { title: `Chạy ads từ bài: ${p.title}` });
    } else enqueue("ads", "candidate.publish", { candidateId: cand.id }, { bizId: a.biz_id, idempotencyKey: `candpub:${cand.id}` });
  }
  return { text: lines.length ? lines.join(" · ") : `Không có bài mới đạt ≥ ${c.minScore} điểm${room ? "" : " (đã đủ số ads/ngày)"}`, lines };
}

export async function runAutomation(bizId: string, id: string, opts: { dryRun?: boolean; actor?: string } = {}) {
  const a = must(bizId, id);
  const actor = opts.actor ?? "scheduler";
  if (a.rule_id) {
    const res = await runRule(bizId, a.rule_id, { forceDryRun: opts.dryRun, actor });
    const text = `${res.mode === "dry_run" ? "Chạy thử" : "LIVE"}: khớp ${res.matched}/${res.evaluated} ad${res.lines[0] ? ` — ${res.lines[0]}` : ""}`;
    update("automation", a.id, { last_run_at: nowIso(), last_result: { text }, run_count: a.run_count + 1 });
    return { ok: true, text, lines: res.lines, skipped: res.skipped, evaluated: res.evaluated, matched: res.matched };
  }
  try {
    const r: any = a.type === "metrics_pull" ? await runMetricsPull(a) : await runAutoRun(a, !!opts.dryRun);
    const every = a.type === "metrics_pull" ? a.config.everyMinutes : 5;
    if (!opts.dryRun) {
      update("automation", a.id, { last_run_at: nowIso(), last_result: r, run_count: a.run_count + 1, next_run_at: new Date(Date.now() + every * 60_000).toISOString() });
      insert("automation_run", { biz_id: bizId, automation_id: a.id, status: "ok", result: r });
    }
    emit(bizId, "automation.ran", { id: a.id, text: r.text });
    return { ok: true, ...r };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    update("automation", a.id, { last_run_at: nowIso(), last_result: { text, error: true }, next_run_at: new Date(Date.now() + 15 * 60_000).toISOString() });
    insert("automation_run", { biz_id: bizId, automation_id: a.id, status: "error", result: { text } });
    if (opts.actor && opts.actor !== "scheduler") throw new AppError("RUN_FAILED", text);
    return { ok: false, text };
  }
}

/** Scheduler entry: runs due non-rule configs (rule-backed ones run in rules.evaluate). */
export async function automationsTick(bizId: string) {
  const due = q.all<Row>("SELECT id FROM automation WHERE biz_id = ? AND status = 'active' AND rule_id IS NULL AND (next_run_at IS NULL OR next_run_at <= ?)", bizId, nowIso());
  for (const a of due) await runAutomation(bizId, a.id);
  return due.length;
}

export function automationCounts(bizId: string) {
  return Object.fromEntries(AUTOMATION_TYPES.map((t) => [t, q.scalar<number>("SELECT COUNT(*) FROM automation WHERE biz_id = ? AND type = ?", bizId, t)]));
}
