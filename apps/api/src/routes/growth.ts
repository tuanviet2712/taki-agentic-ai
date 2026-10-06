import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { derived } from "@dotaka/contracts";
import { audit, bizSettings, byId, q, update, type Row } from "@dotaka/db";
import { latestDaily, proposeManualAction, revertAction, runRule, startAdsReport, sumMetrics, syncAdMetrics, today } from "@dotaka/orchestrator";
import { publishRoute } from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { routes } from "../http.ts";

const dayStr = (n: number) => today(new Date(Date.now() - n * 86400_000));

export function growthRoutes(app: FastifyInstance) {
  const r = routes(app);

  // ---------------- Channels & posts ----------------
  // publishLive: whether "Đăng" on this channel reaches the real page (API token or Chrome Flow ready) — see Kênh đăng.
  r.get("/v1/channels", ({ bizId }) => q.all<Row>("SELECT * FROM channel WHERE biz_id = ? AND enabled = 1", bizId).map((c) => ({ ...c, secret_ciphertext: undefined, publishLive: publishRoute(c) !== "none", publishVia: publishRoute(c) })));
  r.get("/v1/posts", ({ bizId }) => q.all<Row>(`SELECT p.*, c.platform channel, c.name channel_name FROM post p JOIN channel c ON c.id = p.channel_id WHERE p.biz_id = ? ORDER BY p.published_at DESC LIMIT 60`, bizId).map((p) => ({
    ...p,
    score: q.get("SELECT score, low_data, components, reasons, computed_at FROM post_score WHERE post_id = ? ORDER BY computed_at DESC LIMIT 1", p.id),
    metrics: q.get<Row>("SELECT mark, metrics FROM post_metric_snapshot WHERE post_id = ? ORDER BY captured_at DESC LIMIT 1", p.id),
    comments: q.all("SELECT label, COUNT(*) n FROM post_comment WHERE post_id = ? AND label IS NOT NULL GROUP BY label", p.id),
  })));
  r.get("/v1/posts/:id", ({ bizId, params }) => {
    const p = byId<Row>("post", params.id);
    if (!p || p.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy bài", 404);
    return {
      ...p, channel_name: byId<Row>("channel", p.channel_id)?.name ?? null, scores: q.all("SELECT * FROM post_score WHERE post_id = ? ORDER BY computed_at", p.id),
      snapshots: q.all("SELECT mark, metrics, captured_at FROM post_metric_snapshot WHERE post_id = ? ORDER BY captured_at", p.id),
      comments: q.all("SELECT * FROM post_comment WHERE post_id = ? ORDER BY created_at", p.id),
      ads: q.all("SELECT a.* FROM ad a JOIN post_ad_link l ON l.ad_id = a.id WHERE l.post_id = ?", p.id),
    };
  });
  r.get("/v1/candidates", ({ bizId }) => q.all(`SELECT c.*, p.title, p.kind, (SELECT id FROM approval WHERE subject_id = c.id ORDER BY created_at DESC LIMIT 1) approval_id FROM ad_candidate c JOIN post p ON p.id = c.post_id WHERE c.biz_id = ? ORDER BY c.created_at DESC`, bizId));

  // ---------------- Ads ----------------
  r.get("/v1/ads", ({ bizId }) => {
    const campaigns = q.all<Row>("SELECT * FROM campaign WHERE biz_id = ? ORDER BY created_at", bizId);
    return campaigns.map((c) => ({
      ...c,
      ads: q.all<Row>("SELECT * FROM ad WHERE campaign_id = ?", c.id).map((a) => {
        const m7 = sumMetrics(latestDaily(bizId, a.id, dayStr(6)));
        const t = sumMetrics(latestDaily(bizId, a.id, dayStr(0)));
        const orders = q.get<Row>("SELECT COUNT(o.id) n, COALESCE(SUM(o.total),0) revenue FROM attribution_link al JOIN orders o ON o.conversation_id = al.conversation_id WHERE al.ad_id = ? AND al.confidence >= ?", a.id, bizSettings(bizId).attributionMinConfidence);
        return { ...a, m7, today: t, ...derived(m7), orders: orders?.n ?? 0, attributedRevenue: orders?.revenue ?? 0 };
      }),
    }));
  });
  r.get("/v1/metrics/ads", ({ bizId, query }) => {
    const days = Math.min(Number(query.days ?? 7), 30);
    const pf = ["meta", "tiktok", "google_ads"].includes(query.platform as string) ? (query.platform as string) : null;
    const ads = q.all<Row>(`SELECT id, platform FROM ad WHERE biz_id = ? ${pf ? "AND platform = ?" : ""}`, ...(pf ? [bizId, pf] : [bizId]));
    const series = Array.from({ length: days }, (_, i) => {
      const d = dayStr(days - 1 - i);
      const rows = ads.flatMap((a) => latestDaily(bizId, a.id, d, d).map((x) => ({ ...x, platform: a.platform })));
      const m = sumMetrics(rows);
      const revenue = q.scalar<number>("SELECT COALESCE(SUM(total),0) FROM orders WHERE biz_id = ? AND status = 'paid' AND substr(created_at,1,10) = ?", bizId, d);
      return { day: d, ...m, revenue, cpa: m.results ? Math.round(m.spend / m.results) : null, roas: m.spend ? Math.round((revenue / m.spend) * 10) / 10 : null };
    });
    const byPlatform = ["meta", "tiktok", "google_ads"].map((p) => ({ platform: p, ...sumMetrics(ads.filter((a) => a.platform === p).flatMap((a) => latestDaily(bizId, a.id, dayStr(days - 1)))) }));
    return { series, byPlatform };
  });
  // Báo cáo hiệu quả quảng cáo theo nền tảng (Facebook / TikTok / Google) hoặc tổng tất cả — chỉ số liệu THẬT đã đồng bộ.
  r.get("/v1/ads/performance", ({ bizId, query }) => {
    const PLATS = ["meta", "tiktok", "google_ads"] as const;
    const platform = PLATS.includes(query.platform as any) ? (query.platform as string) : "all";
    const days = [7, 14, 30, 90].includes(Number(query.days)) ? Number(query.days) : 7;
    const from = dayStr(days - 1), prevFrom = dayStr(2 * days - 1), prevTo = dayStr(days);
    const ads = q.all<Row>(`SELECT a.id, a.name, a.status, a.platform, a.daily_budget, a.campaign_id, cp.name campaign, x.name account
      FROM ad a LEFT JOIN campaign cp ON cp.id = a.campaign_id LEFT JOIN ad_account x ON x.id = a.ad_account_id WHERE a.biz_id = ? ${platform === "all" ? "" : "AND a.platform = ?"}`,
    ...(platform === "all" ? [bizId] : [bizId, platform]));
    const minConf = bizSettings(bizId).attributionMinConfidence;
    const kpi = (rows: { metrics: any }[], revenue = 0) => {
      const m = sumMetrics(rows);
      return { ...m, revenue, ctr: m.impressions ? m.clicks / m.impressions : null, cpc: m.clicks ? m.spend / m.clicks : null,
        cpm: m.impressions ? (m.spend / m.impressions) * 1000 : null, cpa: m.results ? m.spend / m.results : null, roas: m.spend && revenue ? revenue / m.spend : null };
    };
    const revenueOf = (ids: string[], a: string, b: string) => ids.length ? q.scalar<number>(
      `SELECT COALESCE(SUM(o.total),0) FROM attribution_link al JOIN orders o ON o.conversation_id = al.conversation_id
       WHERE al.ad_id IN (${ids.map(() => "?").join(",")}) AND al.confidence >= ? AND o.status != 'cancelled' AND substr(o.created_at,1,10) BETWEEN ? AND ?`, ...ids, minConf, a, b) : 0;
    const per = ads.map((a) => ({ a, cur: latestDaily(bizId, a.id, from), prev: latestDaily(bizId, a.id, prevFrom, prevTo) }));
    const ids = ads.map((a) => a.id);
    const totals = kpi(per.flatMap((x) => x.cur), revenueOf(ids, from, dayStr(0)));
    const prev = kpi(per.flatMap((x) => x.prev), revenueOf(ids, prevFrom, prevTo));
    const series = Array.from({ length: days }, (_, i) => {
      const d = dayStr(days - 1 - i);
      const m = kpi(per.flatMap((x) => x.cur.filter((r) => r.day === d)));
      return { day: d, spend: m.spend, results: m.results, clicks: m.clicks, impressions: m.impressions, cpa: m.cpa };
    });
    const accounts = q.all<Row>("SELECT x.platform, c.mode, c.status FROM ad_account x LEFT JOIN connection c ON c.id = x.connection_id WHERE x.biz_id = ? AND x.status = 'active'", bizId);
    const byPlatform = PLATS.map((p) => {
      const rows = per.filter((x) => x.a.platform === p);
      const accs = accounts.filter((x) => x.platform === p);
      return {
        platform: p, ads: rows.length, activeAds: rows.filter((x) => x.a.status === "active").length, accounts: accs.length, liveAccounts: accs.filter((x) => x.mode === "live").length,
        connectionError: accs.some((x) => x.mode === "live" && x.status === "error"),
        ...kpi(rows.flatMap((x) => x.cur), revenueOf(rows.map((x) => x.a.id), from, dayStr(0))),
      };
    }).filter((p) => platform === "all" || p.platform === platform);
    const camps = new Map<string, { name: string; platform: string; rows: any[]; ads: number }>();
    for (const x of per) {
      const k = x.a.campaign_id ?? `none:${x.a.platform}`;
      const c = camps.get(k) ?? { name: x.a.campaign ?? "(không thuộc chiến dịch)", platform: x.a.platform, rows: [] as any[], ads: 0 };
      c.rows.push(...x.cur); c.ads++; camps.set(k, c);
    }
    const campaigns = [...camps.values()].map((c) => ({ name: c.name, platform: c.platform, ads: c.ads, ...kpi(c.rows) })).filter((c) => c.spend > 0 || c.impressions > 0).sort((a, b) => b.spend - a.spend);
    const topAds = per.map((x) => ({ id: x.a.id, name: x.a.name, platform: x.a.platform, status: x.a.status, campaign: x.a.campaign, ...kpi(x.cur) }))
      .filter((x) => x.spend > 0 || x.impressions > 0).sort((a, b) => b.spend - a.spend).slice(0, 15);
    const actions = ids.length ? q.all<Row>(`SELECT type, status, COUNT(*) n FROM action WHERE biz_id = ? AND target_type = 'ad' AND target_id IN (${ids.map(() => "?").join(",")}) AND substr(created_at,1,10) >= ? GROUP BY type, status`, bizId, ...ids, from) : [];
    const lastSync = q.scalar<string>(`SELECT MAX(s.captured_at) FROM metric_snapshot s WHERE s.biz_id = ? AND s.entity_type = 'ad'`, bizId) ?? null;
    return { platform, days, from, to: dayStr(0), totals, prev, series, byPlatform, campaigns, topAds, actions, lastSync };
  });
  r.post("/v1/metrics/sync", async ({ bizId }) => ({ ads: await syncAdMetrics(bizId) }));
  r.post("/v1/ads/report", ({ bizId, actor }) => startAdsReport(bizId, actor));
  r.get("/v1/ads/report/latest", ({ bizId }) => q.get("SELECT id, title, status, step, output, updated_at FROM task WHERE biz_id = ? AND agent_key = 'ads' ORDER BY created_at DESC LIMIT 1", bizId) ?? null);
  r.post("/v1/ads/:id/action", ({ bizId, params, body, actor }) => {
    const p = z.object({ type: z.enum(["pause_ad", "resume_ad", "update_budget"]), amount: z.number().int().positive().optional() }).parse(body);
    return proposeManualAction(bizId, params.id, p.type, p.amount, actor);
  });

  // ---------------- Rules & actions ----------------
  r.get("/v1/rules", ({ bizId }) => q.all<Row>("SELECT * FROM rule WHERE biz_id = ? AND status != 'archived' ORDER BY priority DESC", bizId).map((rule) => ({
    ...rule, lastRun: q.get("SELECT * FROM rule_run WHERE rule_id = ? ORDER BY created_at DESC LIMIT 1", rule.id),
  })));
  r.post("/v1/rules/:id/dry-run", ({ bizId, params, actor }) => runRule(bizId, params.id, { forceDryRun: true, actor }));
  r.post("/v1/rules/:id/mode", ({ bizId, params, body, actor }) => {
    const p = z.object({ mode: z.enum(["dry_run", "live"]), confirm: z.literal(true).optional() }).parse(body);
    const rule = byId<Row>("rule", params.id);
    if (!rule || rule.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy rule", 404);
    if (p.mode === "live") {
      if (!p.confirm) throw new AppError("CONFIRM_REQUIRED", "Bật live cần xác nhận rõ (confirm: true)");
      const dry = q.scalar<number>("SELECT COUNT(*) FROM rule_run WHERE rule_id = ? AND rule_version = ? AND mode = 'dry_run'", rule.id, rule.version);
      if (!dry) throw new AppError("DRY_RUN_REQUIRED", "Rule phiên bản này chưa chạy dry-run lần nào — chạy dry-run trước khi bật live");
    }
    update("rule", rule.id, { mode: p.mode });
    audit(bizId, actor, "rule.mode_changed", { type: "rule", id: rule.id }, { from: rule.mode, to: p.mode, version: rule.version });
    return byId("rule", rule.id);
  });
  r.put("/v1/rules/:id/status", ({ bizId, params, body, actor }) => {
    const rule = byId<Row>("rule", params.id);
    if (!rule || rule.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy rule", 404);
    const status = z.enum(["active", "paused"]).parse(body.status);
    update("rule", rule.id, { status, consecutive_errors: 0 });
    audit(bizId, actor, "rule.status", { type: "rule", id: rule.id }, { status });
    return byId("rule", rule.id);
  });
  r.get("/v1/rule-runs", ({ bizId }) => q.all("SELECT rr.*, r.name FROM rule_run rr JOIN rule r ON r.id = rr.rule_id WHERE rr.biz_id = ? ORDER BY rr.created_at DESC LIMIT 30", bizId));
  r.get("/v1/actions", ({ bizId }) => q.all("SELECT a.*, ad.name target_name FROM action a LEFT JOIN ad ON ad.id = a.target_id WHERE a.biz_id = ? ORDER BY a.created_at DESC LIMIT 80", bizId));
  r.post("/v1/actions/:id/revert", ({ bizId, params, actor }) => revertAction(bizId, params.id, actor));

  // ---------------- Reports ----------------
  r.get("/v1/reports/summary", ({ bizId, query }) => {
    const days = Math.min(Number(query.days ?? 7), 30);
    const from = new Date(Date.now() - days * 86400_000).toISOString();
    const ads = q.all<Row>("SELECT id, platform FROM ad WHERE biz_id = ?", bizId);
    const m = sumMetrics(ads.flatMap((a) => latestDaily(bizId, a.id, dayStr(days - 1))));
    const postAgg = q.get<Row>(`SELECT COALESCE(SUM(json_extract(metrics,'$.reach')),0) reach, COALESCE(SUM(json_extract(metrics,'$.reactions') + json_extract(metrics,'$.comments') + json_extract(metrics,'$.shares')),0) eng
      FROM post_metric_snapshot s WHERE biz_id = ? AND captured_at = (SELECT MAX(captured_at) FROM post_metric_snapshot x WHERE x.post_id = s.post_id)`, bizId)!;
    const conversations = q.scalar<number>("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND created_at >= ?", bizId, from);
    const leads = q.scalar<number>("SELECT COUNT(*) FROM lead WHERE biz_id = ? AND grade IN ('warm','hot')", bizId);
    const orders = q.scalar<number>("SELECT COUNT(*) FROM orders WHERE biz_id = ? AND created_at >= ?", bizId, from);
    const reach = (m.reach ?? 0) + postAgg.reach;
    const engaged = m.clicks + postAgg.eng;
    const minConf = bizSettings(bizId).attributionMinConfidence;
    const attributed = q.scalar<number>("SELECT COUNT(DISTINCT conversation_id) FROM attribution_link WHERE biz_id = ? AND confidence >= ?", bizId, minConf);
    const allConv = q.scalar<number>("SELECT COUNT(*) FROM conversation WHERE biz_id = ?", bizId);
    return {
      totals: { reach, engaged, conversations, leads, orders, spend: m.spend, clicks: m.clicks, results: m.results, cpa: m.results ? Math.round(m.spend / m.results) : null, costPerOrder: orders ? Math.round(m.spend / orders) : null },
      funnel: [
        { stage: "Lượt tiếp cận", value: reach }, { stage: "Tương tác", value: engaged }, { stage: "Hội thoại", value: conversations + m.results },
        { stage: "Lead ấm/nóng", value: leads + Math.round(m.results * 0.35) }, { stage: "Khách hàng (đơn)", value: orders },
      ],
      attribution: { coverage: allConv ? attributed / allConv : 0, minConfidence: minConf, byMethod: q.all("SELECT method, COUNT(*) n, AVG(confidence) conf FROM attribution_link WHERE biz_id = ? GROUP BY method ORDER BY conf DESC", bizId) },
      topPosts: q.all(`SELECT p.id, p.title, p.kind, c.platform, s.score, (SELECT metrics FROM post_metric_snapshot x WHERE x.post_id = p.id ORDER BY captured_at DESC LIMIT 1) metrics
        FROM post p JOIN channel c ON c.id = p.channel_id JOIN post_score s ON s.post_id = p.id AND s.computed_at = (SELECT MAX(computed_at) FROM post_score y WHERE y.post_id = p.id) WHERE p.biz_id = ? ORDER BY s.score DESC LIMIT 5`, bizId),
      trace: q.all(`SELECT g.title goal, ci.title content, po.title post, a.name ad, COUNT(DISTINCT al.conversation_id) conversations, COUNT(DISTINCT o.id) orders, COALESCE(SUM(o.total),0) revenue
        FROM post po LEFT JOIN content_item ci ON ci.id = po.content_item_id LEFT JOIN goal g ON g.id = ci.goal_id
        LEFT JOIN post_ad_link l ON l.post_id = po.id LEFT JOIN ad a ON a.id = l.ad_id
        LEFT JOIN attribution_link al ON al.ad_id = a.id AND al.confidence >= ? LEFT JOIN orders o ON o.conversation_id = al.conversation_id
        WHERE po.biz_id = ? GROUP BY po.id ORDER BY conversations DESC, po.published_at DESC LIMIT 10`, minConf, bizId),
      revenueBySource: q.all("SELECT COALESCE(source,'khác') source, COUNT(*) orders, SUM(total) revenue FROM orders WHERE biz_id = ? AND created_at >= ? GROUP BY 1 ORDER BY revenue DESC", bizId, from),
    };
  });
}
