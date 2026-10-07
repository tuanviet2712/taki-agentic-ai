import { createReadStream, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, bizSettings, byId, defaultBizId, insert, isKilled, q, update, type Row } from "@dotaka/db";
import { MCP_SCOPES, PLATFORMS, live, platformDef, sendTelegram } from "@dotaka/connectors";
import { jevEnabled } from "@dotaka/jev";
import { effectiveProvider } from "@dotaka/llm-gateway";
import {
  AUTOMATION_TYPES, automationCounts, createConnection, credsOf, deleteAutomation, disconnect, enqueue, importAds, publicAutomation, publicConnection,
  runAutomation, saveAutomation, setAutomationLive, setAutomationStatus, setWhitelist, syncAdMetrics, testConnection, today,
  attributionInfo, attributionOptions, liveMetaToken,
} from "@dotaka/orchestrator";
import { AppError, decryptSecret, sha256 } from "@dotaka/shared";
import { currentBizId, routes } from "../http.ts";

/** Connections hub, whitelist, automation configs, quick ad publish, ad templates, MCP keys. */
export function connectRoutes(app: FastifyInstance) {
  const r = routes(app);

  // ---------------- Platforms & connections ----------------
  r.get("/v1/platforms", ({ bizId }) => {
    const eff = effectiveProvider(bizId);
    return PLATFORMS.map((p) => ({
      ...p,
      count: p.key === "whitelist"
        ? q.scalar<number>("SELECT COUNT(*) FROM ad_account WHERE biz_id = ? AND whitelisted = 1", bizId) + q.scalar<number>("SELECT COUNT(*) FROM channel WHERE biz_id = ? AND platform = 'facebook' AND whitelisted = 1 AND connection_id IS NOT NULL", bizId)
        : p.key === "ai" ? (eff.provider !== "sandbox" ? 1 : 0) + (jevEnabled() ? 1 : 0)
        : q.scalar<number>("SELECT COUNT(*) FROM connection WHERE biz_id = ? AND platform = ? AND status != 'revoked'", bizId, p.key),
      ...(p.key === "ai" ? { ai: { claude: eff.provider, jev: jevEnabled() } } : {}),
    }));
  });
  r.get("/v1/connections", ({ bizId, query }) =>
    q.all<Row>(`SELECT * FROM connection WHERE biz_id = ? ${query.all ? "" : "AND status != 'revoked'"} ${query.platform ? "AND platform = ?" : ""} ORDER BY created_at DESC`, bizId, ...(query.platform ? [query.platform] : [])).map(publicConnection));
  r.post("/v1/connections", ({ bizId, body, actor }) => {
    const p = z.object({ platform: z.string(), name: z.string().optional(), mode: z.enum(["live", "sandbox"]), credentials: z.record(z.string(), z.string()).default({}), config: z.record(z.string(), z.string()).default({}) }).parse(body);
    return createConnection(bizId, p, actor);
  });
  r.put("/v1/connections/:id", ({ bizId, params, body, actor }) => {
    const c = byId<Row>("connection", params.id);
    if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy kết nối", 404);
    const p = z.object({ display_name: z.string().min(1).optional(), config: z.record(z.string(), z.string()).optional() }).parse(body);
    const allowed = new Set((platformDef(c.platform)?.fields ?? []).filter((f) => !f.secret).map((f) => f.key));
    const cfg = { ...(c.config ?? {}), ...Object.fromEntries(Object.entries(p.config ?? {}).filter(([k]) => allowed.has(k))) };
    update("connection", c.id, { ...(p.display_name ? { display_name: p.display_name } : {}), config: cfg });
    audit(bizId, actor, "connection.updated", { type: "connection", id: c.id }, { display_name: p.display_name, config: p.config });
    return publicConnection(byId<Row>("connection", c.id)!);
  });
  r.post("/v1/connections/:id/test", ({ bizId, params, actor }) => testConnection(bizId, params.id, actor));
  r.post("/v1/connections/:id/import", async ({ bizId, params, actor }) => {
    const res = await importAds(bizId, params.id, actor);
    const accounts = q.all<Row>("SELECT id FROM ad_account WHERE connection_id = ?", params.id).map((a) => a.id);
    // Backfill 7 days so charts and rules have history right away.
    const snapshots = accounts.length ? await syncAdMetrics(bizId, today(), { since: today(new Date(Date.now() - 6 * 86400_000)), accountIds: accounts }) : 0;
    return { ...res, snapshots };
  });
  r.del("/v1/connections/:id", ({ bizId, params, actor }) => disconnect(bizId, params.id, actor));
  r.post("/v1/connections/:id/telegram-test", async ({ bizId, params }) => {
    const c = byId<Row>("connection", params.id);
    if (!c || c.biz_id !== bizId || c.platform !== "telegram") throw new AppError("NOT_FOUND", "Không tìm thấy kết nối Telegram", 404);
    if (c.mode !== "live") return { ok: true, detail: "Mô phỏng: tin nhắn được ghi vào log thay vì gửi thật" };
    await live.telegramSend(credsOf(c) as any, c.config.chat_id, "✅ TAKI Agentic AI đã kết nối Telegram — cảnh báo quảng cáo sẽ gửi về đây.");
    return { ok: true, detail: "Đã gửi tin nhắn thử" };
  });
  r.get("/v1/connections/:id/orders", async ({ bizId, params }) => {
    const c = byId<Row>("connection", params.id);
    if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy kết nối", 404);
    if (c.mode !== "live") return q.all("SELECT id, customer_name customer, total, status, created_at createdAt FROM orders WHERE biz_id = ? ORDER BY created_at DESC LIMIT 30", bizId);
    if (c.platform === "pancake") return live.pancakeOrders(credsOf(c) as any, c.config?.shops?.[0]?.externalId ?? c.external_account_id);
    if (c.platform === "nhanh") return live.nhanhOrders({ ...(credsOf(c) as any), app_id: c.config.app_id, business_id: c.config.business_id });
    throw new AppError("NOT_SUPPORTED", "Kết nối này không có đơn hàng");
  });

  // ---------------- Whitelist ----------------
  r.get("/v1/whitelist", ({ bizId }) => ({
    adAccounts: q.all(`SELECT x.id, x.platform, x.external_id, x.name, x.currency, x.whitelisted, x.status, c.display_name connection, c.mode,
      (SELECT COUNT(*) FROM ad WHERE ad_account_id = x.id) ads FROM ad_account x LEFT JOIN connection c ON c.id = x.connection_id WHERE x.biz_id = ? ORDER BY x.name`, bizId),
    pages: q.all(`SELECT ch.id, ch.platform, ch.external_id, ch.name, ch.whitelisted, c.display_name connection, c.mode FROM channel ch JOIN connection c ON c.id = ch.connection_id
      WHERE ch.biz_id = ? AND ch.kind = 'page' ORDER BY ch.name`, bizId),
  }));
  r.put("/v1/whitelist", ({ bizId, body, actor }) => {
    const p = z.object({ kind: z.enum(["ad_account", "page"]), id: z.string(), on: z.boolean() }).parse(body);
    return setWhitelist(bizId, p.kind, p.id, p.on, actor);
  });

  // ---------------- Automation configs ----------------
  r.get("/v1/automations", ({ bizId, query }) => ({
    counts: automationCounts(bizId),
    items: q.all<Row>(`SELECT * FROM automation WHERE biz_id = ? ${query.type ? "AND type = ?" : ""} ORDER BY created_at DESC`, bizId, ...(query.type ? [query.type] : [])).map(publicAutomation),
  }));
  r.get("/v1/automation-options", ({ bizId }) => ({
    adAccounts: q.all("SELECT x.id, x.platform, x.name, x.external_id, x.whitelisted, c.mode FROM ad_account x LEFT JOIN connection c ON c.id = x.connection_id WHERE x.biz_id = ? AND x.status = 'active' ORDER BY x.name", bizId),
    ads: q.all("SELECT a.id, a.name, a.status, a.platform, a.daily_budget, a.ad_account_id, cp.name campaign FROM ad a LEFT JOIN campaign cp ON cp.id = a.campaign_id WHERE a.biz_id = ? ORDER BY cp.name, a.name", bizId),
    channels: q.all("SELECT id, platform, kind, name, whitelisted, connection_id FROM channel WHERE biz_id = ? AND enabled = 1 ORDER BY name", bizId),
    templates: q.all("SELECT id, name, platform, definition FROM ad_template WHERE biz_id = ? ORDER BY name", bizId),
    sheets: q.all<Row>("SELECT id, display_name, mode, config FROM connection WHERE biz_id = ? AND platform = 'sheets' AND status != 'revoked'", bizId).map((c) => ({ id: c.id, name: c.display_name, mode: c.mode, defaultSpreadsheet: c.config?.default_spreadsheet ?? "" })),
    telegram: !!q.get("SELECT id FROM connection WHERE biz_id = ? AND platform = 'telegram' AND status = 'active'", bizId) || !!process.env.TELEGRAM_BOT_TOKEN,
  }));
  const AutoBody = z.object({ type: z.enum(AUTOMATION_TYPES), name: z.string(), config: z.unknown() });
  r.post("/v1/automations", ({ bizId, body, actor }) => saveAutomation(bizId, AutoBody.parse(body), actor));
  r.put("/v1/automations/:id", ({ bizId, params, body, actor }) => saveAutomation(bizId, { ...AutoBody.parse(body), id: params.id }, actor));
  r.del("/v1/automations/:id", ({ bizId, params, actor }) => deleteAutomation(bizId, params.id, actor));
  r.post("/v1/automations/:id/status", ({ bizId, params, body, actor }) => setAutomationStatus(bizId, params.id, z.object({ on: z.boolean() }).parse(body).on, actor));
  r.post("/v1/automations/:id/live", ({ bizId, params, body, actor }) => {
    const p = z.object({ on: z.boolean(), confirm: z.literal(true).optional() }).parse(body);
    if (p.on && !p.confirm) throw new AppError("CONFIRM_REQUIRED", "Bật LIVE cần xác nhận");
    return setAutomationLive(bizId, params.id, p.on, actor);
  });
  r.post("/v1/automations/:id/run", ({ bizId, params, body, actor }) => runAutomation(bizId, params.id, { dryRun: !!body.dryRun, actor }));
  r.get("/v1/automations/:id/runs", ({ bizId, params }) => {
    const a = byId<Row>("automation", params.id);
    if (!a || a.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy cấu hình", 404);
    if (a.rule_id) return q.all<Row>("SELECT id, mode, evaluated, matched, summary, created_at FROM rule_run WHERE rule_id = ? ORDER BY created_at DESC LIMIT 30", a.rule_id)
      .map((x) => ({ id: x.id, created_at: x.created_at, status: x.mode, text: `Khớp ${x.matched}/${x.evaluated} ad`, lines: x.summary?.lines ?? [] }));
    return q.all<Row>("SELECT * FROM automation_run WHERE automation_id = ? ORDER BY created_at DESC LIMIT 30", a.id).map((x) => ({ id: x.id, created_at: x.created_at, status: x.status, text: x.result?.text, lines: x.result?.lines ?? [], url: x.result?.url }));
  });
  app.get("/v1/automations/:id/export.csv", async (req, reply) => {
    const id = (req.params as Row).id as string;
    const a = byId<Row>("automation", id);
    const file = join(resolve(process.env.DATA_DIR ?? "data", "exports"), `${id}.csv`);
    if (!a || a.biz_id !== currentBizId(req) || !existsSync(file)) return reply.status(404).send({ code: "NOT_FOUND", message: "Chưa có file — hãy chạy cấu hình trước" });
    reply.header("content-disposition", `attachment; filename="chi-so-ads-${today()}.csv"`).type("text/csv; charset=utf-8");
    return reply.send(createReadStream(file));
  });

  // ---------------- Ad templates ----------------
  const Template = z.object({
    name: z.string().min(1), platform: z.enum(["meta", "tiktok"]).default("meta"),
    definition: z.object({
      objective: z.enum(["messages", "engagement", "sales", "traffic"]).default("messages"),
      audience: z.object({
        locations: z.array(z.string()).default(["VN"]), ageMin: z.number().int().min(13).max(65).default(25), ageMax: z.number().int().min(13).max(65).default(55),
        genders: z.array(z.number().int().min(1).max(2)).default([]),
        // Plain strings are notes for the Ads Agent; {id,name} (from the interest search) are sent to Facebook.
        interests: z.array(z.union([z.string(), z.object({ id: z.string(), name: z.string() })])).default([]),
        geo: z.array(z.object({ type: z.enum(["city", "region"]), key: z.string(), name: z.string() })).default([]),
      }).default({} as any),
      // ads-os fields: Chuyển đổi needs a pixel + event; Advantage+ audience on by default (age/gender become hints).
      pixelId: z.string().nullable().default(null),
      conversionEvent: z.string().nullable().default(null),
      advantageAudience: z.boolean().default(true),
      budget: z.object({ type: z.literal("daily").default("daily"), amount: z.number().int().positive().default(1_000_000), currency: z.string().default("VND") }).default({} as any),
      targetCpa: z.number().int().positive().nullable().default(null),
      naming: z.string().default("{date}_{page}_{postId}_{template}"),
      cta: z.string().default("MESSAGE_PAGE"),
      placements: z.union([z.literal("auto"), z.object({ automatic: z.boolean(), publisherPlatforms: z.array(z.string()).optional(), facebookPositions: z.array(z.string()).optional(), instagramPositions: z.array(z.string()).optional() })]).default("auto"),
      note: z.string().default(""),
    }).superRefine((d, ctx) => {
      if (d.objective !== "sales") return;
      if (!d.pixelId) ctx.addIssue({ code: "custom", message: "Mục tiêu Chuyển đổi cần chọn pixel", path: ["pixelId"] });
      else if (!live.CONVERSION_EVENTS.some((e) => e.value === d.conversionEvent)) ctx.addIssue({ code: "custom", message: "Mục tiêu Chuyển đổi cần chọn sự kiện chuyển đổi", path: ["conversionEvent"] });
    }),
  });
  r.get("/v1/ad-templates", ({ bizId }) => q.all<Row>("SELECT * FROM ad_template WHERE biz_id = ? ORDER BY created_at DESC", bizId).map((t) => ({
    ...t, used: q.scalar<number>("SELECT COUNT(*) FROM ad_candidate WHERE ad_template_id = ?", t.id),
  })));
  r.post("/v1/ad-templates", ({ bizId, body, actor }) => {
    const p = Template.parse(body);
    const row = insert("ad_template", { biz_id: bizId, name: p.name, platform: p.platform, definition: p.definition });
    audit(bizId, actor, "ad_template.created", { type: "ad_template", id: row.id }, { name: p.name });
    return row;
  });
  r.put("/v1/ad-templates/:id", ({ bizId, params, body, actor }) => {
    const t = byId<Row>("ad_template", params.id);
    if (!t || t.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy mẫu", 404);
    const p = Template.parse(body);
    update("ad_template", t.id, { name: p.name, platform: p.platform, definition: p.definition });
    audit(bizId, actor, "ad_template.updated", { type: "ad_template", id: t.id }, { name: p.name });
    return byId("ad_template", t.id);
  });
  r.del("/v1/ad-templates/:id", ({ bizId, params, actor }) => {
    const t = byId<Row>("ad_template", params.id);
    if (!t || t.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy mẫu", 404);
    q.run("UPDATE ad_candidate SET ad_template_id = NULL WHERE ad_template_id = ? AND status IN ('published','failed','rejected')", t.id);
    if (q.get("SELECT id FROM ad_candidate WHERE ad_template_id = ?", t.id)) throw new AppError("IN_USE", "Mẫu đang được dùng bởi đề xuất chưa xử lý");
    q.run("DELETE FROM ad_template WHERE id = ?", t.id);
    audit(bizId, actor, "ad_template.deleted", { type: "ad_template", id: t.id }, { name: t.name });
    return { ok: true };
  });

  // ---------------- Meta helpers ported from ads-os (pixels, targeting search, reach, validate_only) ----------------
  const metaToken = (adAccountId: unknown) => {
    const t = liveMetaToken(String(adAccountId ?? ""));
    if (!t) throw new AppError("NOT_LIVE", "Cần tài khoản quảng cáo Facebook đã kết nối thật (không phải demo)");
    return t;
  };
  r.get("/v1/ads/meta/options", () => ({ objectives: live.META_OBJECTIVES, conversionEvents: live.CONVERSION_EVENTS }));
  r.get("/v1/ads/meta/pixels", async ({ query }) => {
    const t = liveMetaToken(String(query.adAccountId ?? ""));
    return t ? live.listPixels(t.token, t.acc.external_id) : [];
  });
  r.get("/v1/ads/meta/search", async ({ query }) => {
    const { token } = metaToken(query.adAccountId);
    const text = String(query.q ?? "").trim();
    if (text.length < 2) return [];
    return query.kind === "location" ? live.searchLocations(token, text, String(query.country ?? "VN")) : live.searchInterests(token, text);
  });
  r.post("/v1/ads/meta/estimate", async ({ bizId, body }) => {
    const p = z.object({ adAccountId: z.string(), templateId: z.string().optional(), definition: z.any().optional() }).parse(body);
    const { token, acc } = metaToken(p.adAccountId);
    const tpl = p.templateId ? byId<Row>("ad_template", p.templateId) : null;
    if (tpl && tpl.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy mẫu", 404);
    const def = tpl?.definition ?? p.definition ?? {};
    const obj = live.META_OBJECTIVES[(def.objective in live.META_OBJECTIVES ? def.objective : "messages") as keyof typeof live.META_OBJECTIVES];
    return live.estimateReach(token, acc.external_id, live.templateTargeting(def), obj.optimizationGoal);
  });
  /** "Kiểm tra trước": Facebook checks the campaign with validate_only — creates NOTHING. Partial check by design. */
  r.post("/v1/ads/quick/check", async ({ bizId, body }) => {
    const p = z.object({ adAccountId: z.string(), channelId: z.string(), templateId: z.string().nullable().default(null), dailyBudget: z.number().int().positive(), postExternalId: z.string(), name: z.string().optional() }).parse(body);
    const t = liveMetaToken(p.adAccountId);
    if (!t) return { ok: true, live: false, note: "Tài khoản demo — không cần kiểm tra với Facebook." };
    const ch = byId<Row>("channel", p.channelId);
    const tpl = p.templateId ? byId<Row>("ad_template", p.templateId) : null;
    if (!ch || ch.biz_id !== bizId || (tpl && tpl.biz_id !== bizId)) throw new AppError("NOT_FOUND", "Không tìm thấy Fanpage hoặc mẫu", 404);
    const spec = live.metaBoostSpec({ accountExternalId: t.acc.external_id, pageExternalId: ch.external_id, postExternalId: p.postExternalId, name: p.name || "Kiểm tra trước", dailyBudget: p.dailyBudget, currency: t.acc.currency, template: tpl?.definition });
    try {
      await live.validateBoost(t.token, spec);
      return { ok: true, live: true, objective: spec.objective, note: "Facebook đã kiểm tra bước chiến dịch: hợp lệ. Đây là kiểm một phần (tài khoản, token, quyền tạo quảng cáo) — chưa bảo chứng cả chuỗi." };
    } catch (e) {
      return { ok: false, live: true, objective: spec.objective, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ---------------- "Không tắt oan": attribution window (ads-os) ----------------
  r.get("/v1/ads/attribution", ({ bizId }) => {
    const info: any = attributionInfo(bizId);
    return { settings: (bizSettings(bizId) as any).adsAttribution ?? {}, effective: attributionOptions(bizId) ?? null, measuredDays: info.days, samples: info.samples, curve: info.curve ?? [] };
  });
  r.put("/v1/ads/attribution", ({ bizId, body, actor }) => {
    const p = z.object({ enabled: z.boolean().optional(), days: z.number().int().min(0).max(30).nullable().optional(), minConversions: z.number().int().min(0).max(1000).optional(), minClicks: z.number().int().min(0).max(100000).optional() }).parse(body);
    const s = bizSettings(bizId) as any;
    const next = { ...(s.adsAttribution ?? {}), ...p };
    if (next.days === null) delete next.days; // null = measure automatically again
    update("biz", bizId, { settings: { ...s, adsAttribution: next } });
    audit(bizId, actor, "ads.attribution_changed", { type: "biz", id: bizId }, next);
    return { settings: next, effective: attributionOptions(bizId) ?? null };
  });

  // ---------------- Quick ad publish (Đăng quảng cáo nhanh) ----------------
  r.get("/v1/pages/:id/posts", async ({ bizId, params }) => {
    const ch = byId<Row>("channel", params.id);
    if (!ch || ch.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy Fanpage", 404);
    const conn = ch.connection_id ? byId<Row>("connection", ch.connection_id) : undefined;
    if (conn?.mode === "live" && ch.secret_ciphertext) return live.metaPagePosts(ch.external_id, decryptSecret(ch.secret_ciphertext));
    const stored = q.all<Row>("SELECT external_id, title, body, published_at, permalink, kind FROM post WHERE channel_id = ? ORDER BY published_at DESC LIMIT 25", ch.id)
      .map((p) => ({ externalId: p.external_id, text: p.body || p.title, createdAt: p.published_at, image: null, permalink: p.permalink, kind: p.kind }));
    if (stored.length) return stored;
    // Sandbox page with no posts yet: offer demo posts so the flow can be tried end to end.
    return ["Doanh nghiệp 30 nhân sự dùng AI cắt 40% việc lặp lại — học cách làm trong 1 buổi", "Chủ doanh nghiệp: 5 việc nên giao cho AI ngay tuần này", "Lịch khai giảng AI Business System tháng tới — còn 20 chỗ"]
      .map((t, i) => ({ externalId: `${ch.external_id}_demo${i + 1}`, text: t, createdAt: new Date(Date.now() - (i + 1) * 5 * 3600_000).toISOString(), image: null, permalink: null, kind: "post" }));
  });
  r.post("/v1/ads/quick", ({ bizId, body, actor }) => {
    const p = z.object({
      adAccountId: z.string(), channelId: z.string(), templateId: z.string().nullable().default(null), dailyBudget: z.number().int().positive(),
      post: z.object({ externalId: z.string(), text: z.string(), permalink: z.string().nullable().optional(), kind: z.string().optional() }),
      name: z.string().optional(), startPaused: z.boolean().default(true), confirm: z.literal(true),
    }).parse(body);
    const acc = byId<Row>("ad_account", p.adAccountId);
    const ch = byId<Row>("channel", p.channelId);
    if (!acc || acc.biz_id !== bizId || !ch || ch.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy tài khoản hoặc Fanpage", 404);
    if (!acc.whitelisted) throw new AppError("NOT_WHITELISTED", `Tài khoản "${acc.name}" không nằm trong whitelist`);
    if (!ch.whitelisted) throw new AppError("NOT_WHITELISTED", `Fanpage "${ch.name}" không nằm trong whitelist`);
    if (acc.platform !== "meta") throw new AppError("NOT_SUPPORTED", "Đăng nhanh hiện hỗ trợ Facebook (Meta Ads)");
    if (isKilled(bizId, "ads")) throw new AppError("KILLED", "Đang bật dừng khẩn cấp quảng cáo");
    const s = bizSettings(bizId);
    const total = q.scalar<number>("SELECT COALESCE(SUM(daily_budget),0) FROM ad WHERE biz_id = ? AND status = 'active'", bizId);
    if (!p.startPaused && total + p.dailyBudget > s.caps.maxTotalDailyAdBudget) throw new AppError("CAP_EXCEEDED", `Vượt trần tổng ngân sách ngày ${s.caps.maxTotalDailyAdBudget.toLocaleString("vi-VN")}đ`);
    const createdToday = q.scalar<number>("SELECT COUNT(*) FROM ad_candidate WHERE biz_id = ? AND created_at >= ? AND status != 'rejected'", bizId, `${today()}T00:00:00`);
    if (createdToday >= s.caps.maxAdsCreatedPerDay) throw new AppError("CAP_EXCEEDED", `Đã đạt giới hạn ${s.caps.maxAdsCreatedPerDay} ads tạo mới/ngày (Cài đặt → Giới hạn)`);
    let post = q.get<Row>("SELECT * FROM post WHERE channel_id = ? AND external_id = ?", ch.id, p.post.externalId);
    if (!post) post = insert("post", { biz_id: bizId, channel_id: ch.id, external_id: p.post.externalId, content_item_id: null, kind: p.post.kind ?? "post", title: p.post.text.slice(0, 90), body: p.post.text, published_at: new Date().toISOString(), permalink: p.post.permalink ?? null, ad_status: "none" });
    if (q.get("SELECT id FROM ad WHERE post_id = ? AND status = 'active'", post.id)) throw new AppError("DUPLICATE", "Bài này đã có quảng cáo đang chạy");
    const cand = insert("ad_candidate", {
      biz_id: bizId, post_id: post.id, platform: "meta", ad_template_id: p.templateId, daily_budget: p.dailyBudget, score: 0, reasons: ["Đăng nhanh thủ công"],
      status: "approved", ad_account_id: acc.id, options: { source: "quick", startPaused: p.startPaused, name: p.name?.trim() || undefined },
    });
    update("post", post.id, { ad_status: "candidate" });
    enqueue("ads", "candidate.publish", { candidateId: cand.id }, { bizId, idempotencyKey: `candpub:${cand.id}` });
    audit(bizId, actor, "ad.quick_publish", { type: "ad_candidate", id: cand.id }, { account: acc.name, page: ch.name, budget: p.dailyBudget, startPaused: p.startPaused });
    return cand;
  });
  r.get("/v1/ads/quick/recent", ({ bizId }) => q.all(`SELECT c.id, c.status, c.daily_budget, c.decision_note, c.options, c.created_at, p.title, x.name account, ad.name ad_name, ad.status ad_status, ch.name page
    FROM ad_candidate c JOIN post p ON p.id = c.post_id LEFT JOIN ad_account x ON x.id = c.ad_account_id LEFT JOIN ad ON ad.id = c.ad_id LEFT JOIN channel ch ON ch.id = p.channel_id
    WHERE c.biz_id = ? AND json_extract(c.options, '$.source') = 'quick' ORDER BY c.created_at DESC LIMIT 20`, bizId));

  // ---------------- MCP keys (fine-grained permissions, shown once) ----------------
  r.get("/v1/mcp-keys", ({ bizId }) => ({
    scopes: MCP_SCOPES,
    keys: q.all<Row>("SELECT id, name, key_last4, permissions, expires_at, revoked_at, created_at FROM mcp_key WHERE biz_id = ? ORDER BY created_at DESC", bizId).map((k) => ({
      ...k, calls: q.scalar<number>("SELECT COUNT(*) FROM mcp_call WHERE key_id = ?", k.id), lastUsed: q.scalar<string>("SELECT MAX(at) FROM mcp_call WHERE key_id = ?", k.id),
    })),
    projectDir: resolve(process.cwd()),
  }));
  r.post("/v1/mcp-keys", ({ bizId, body, actor }) => {
    const p = z.object({ name: z.string().min(2, "Tên key tối thiểu 2 ký tự"), all: z.boolean().default(false), scopes: z.record(z.string(), z.array(z.string())).default({}), days: z.number().int().min(1).max(3650).nullable().default(90) }).parse(body);
    const valid = new Map(MCP_SCOPES.map((s) => [s.platform, new Set(s.perms.map((x) => x.key))]));
    const scopes = Object.fromEntries(Object.entries(p.scopes).map(([k, v]) => [k, v.filter((x) => valid.get(k)?.has(x))]).filter(([, v]) => (v as string[]).length));
    if (!p.all && !Object.keys(scopes).length) throw new AppError("INVALID", "Chọn ít nhất 1 quyền");
    const write = p.all || Object.values(scopes).some((v) => (v as string[]).some((x) => x === "write" || x === "create"));
    const raw = `mcp_${sha256(`${bizId}:${Date.now()}:${Math.random()}`).slice(0, 32)}`;
    const row = insert("mcp_key", { biz_id: bizId, name: p.name, key_hash: sha256(raw), key_last4: raw.slice(-4), permissions: { all: p.all, scopes, write }, expires_at: p.days ? new Date(Date.now() + p.days * 86400_000).toISOString() : null });
    audit(bizId, actor, "mcp_key.created", { type: "mcp_key", id: row.id }, { name: p.name, all: p.all, scopes });
    return { id: row.id, key: raw, warning: write ? "Key có quyền GHI — mọi thao tác vẫn đi qua xác nhận, trần ngân sách và cooldown" : undefined };
  });
  r.del("/v1/mcp-keys/:id", ({ bizId, params, actor }) => {
    const k = byId<Row>("mcp_key", params.id);
    if (!k || k.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy key", 404);
    update("mcp_key", k.id, { revoked_at: new Date().toISOString() });
    audit(bizId, actor, "mcp_key.revoked", { type: "mcp_key", id: k.id });
    return { ok: true };
  });
  r.get("/v1/mcp-keys/:id/calls", ({ bizId, params }) => q.all("SELECT tool, params, result, at FROM mcp_call WHERE biz_id = ? AND key_id = ? ORDER BY at DESC LIMIT 50", bizId, params.id));

  // ---------------- AI Agent Ads shell (footer tokens, header badges) ----------------
  r.get("/v1/ads-agent/summary", ({ bizId }) => {
    const from = `${today()}T00:00:00`;
    const llm = q.get<Row>("SELECT COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout FROM model_usage WHERE biz_id = ? AND at >= ?", bizId, from);
    const jev = q.scalar<number>("SELECT COALESCE(SUM(tokens_in),0) FROM jev_judgment WHERE biz_id = ? AND created_at >= ?", bizId, from);
    return {
      tokensIn: (llm?.tin ?? 0) + (jev ?? 0), tokensOut: llm?.tout ?? 0,
      pendingAds: q.scalar<number>("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'pending' AND subject_type IN ('action','ad_candidate')", bizId),
      connections: q.scalar<number>("SELECT COUNT(*) FROM connection WHERE biz_id = ? AND status != 'revoked'", bizId),
      telegram: !!q.get("SELECT id FROM connection WHERE biz_id = ? AND platform = 'telegram' AND status = 'active'", bizId) || !!process.env.TELEGRAM_BOT_TOKEN,
    };
  });

  // ---------------- Test notification ----------------
  r.post("/v1/notify/test", async () => ({ sent: await sendTelegram("Tin nhắn thử từ TAKI Agentic AI", "info") }));
}
