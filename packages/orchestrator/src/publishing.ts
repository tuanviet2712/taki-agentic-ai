import { audit, bizSettings, byId, emit, insert, isKilled, q, update, type Row } from "@dotaka/db";
import { connector, platformForChannel } from "@dotaka/connectors";
import { COMMENT_LABELS, commentHeuristic, commentQuestions, judge, norm, postFitHeuristic, postFitQuestions, recordDecision } from "@dotaka/jev";
import { FORMULA_VERSION, scorePost } from "@dotaka/scoring";
import { maskPhonesInText, nowIso, seeded } from "@dotaka/shared";
import { PermanentError, enqueue } from "./queue.ts";
import { browserPublish, chromeLock, publishRoute, routeReason } from "./browser-publish.ts";
import { connectorForChannel } from "./connections.ts";
import { existsSync } from "node:fs";

/** Sandbox time compression: 1 platform-hour = TIME_SCALE_SECONDS real seconds (default 60). */
export const HOUR_MS = (Number(process.env.TIME_SCALE_SECONDS ?? 60) || 3600) * 1000;
const SLOTS = [8, 11.5, 20]; // posting windows (local), refined by learning proposals

// ---------------- 9.5 Publishing ----------------
export function schedulePublish(bizId: string, contentItemId: string, opts: { now?: boolean } = {}) {
  const ci = byId<Row>("content_item", contentItemId);
  if (!ci) throw new PermanentError("content_item not found");
  const channel = q.get<Row>("SELECT * FROM channel WHERE biz_id = ? AND platform = ? AND enabled = 1", bizId, ci.channel);
  if (!channel) {
    update("content_item", ci.id, { status: "manual_publish" }); // manual fallback package
    return null;
  }
  const s = bizSettings(bizId);
  let when: Date;
  if (opts.now) when = new Date();
  else {
    // Next slot with room under maxPostsPerDayPerChannel. In sandbox, slots are compressed.
    const today = q.scalar<number>("SELECT COUNT(*) FROM publish_job WHERE channel_id = ? AND scheduled_at >= ?", channel.id, new Date(Date.now() - 24 * 3600_000).toISOString());
    const idx = Math.min(today, SLOTS.length - 1);
    when = today >= s.caps.maxPostsPerDayPerChannel ? new Date(Date.now() + 24 * HOUR_MS) : new Date(Date.now() + (idx + 1) * HOUR_MS * 0.5);
  }
  const job = insert("publish_job", { biz_id: bizId, content_item_id: ci.id, channel_id: channel.id, scheduled_at: when.toISOString(), status: "scheduled", idempotency_key: `pub:${ci.id}:${channel.id}` });
  update("content_item", ci.id, { status: "scheduled", scheduled_at: when.toISOString() });
  enqueue("publish", "publish.run", { publishJobId: job.id }, { bizId, runAt: when, idempotencyKey: `pubrun:${job.id}`, lockKey: chromeLock(channel) });
  audit(bizId, "publishing", "publish.scheduled", { type: "content_item", id: ci.id }, { at: when.toISOString(), channel: channel.name });
  return job;
}

/** Local media file of a content item (finished video / image), for API uploads and Chrome file pickers. */
export function mediaOf(ci: Row): { path: string; mime: string } | undefined {
  const asset = ci.asset_id ? byId<Row>("creative_asset", ci.asset_id) : undefined;
  if (!asset?.path || !existsSync(asset.path)) return undefined;
  return { path: asset.path, mime: asset.mime ?? (asset.kind === "video" ? "video/mp4" : "image/jpeg") };
}

/**
 * Real or nothing. Route per channel (Kênh đăng): API with the Page token → Chrome Flow agent → otherwise refuse with
 * the reason. A job already "posting" after a crash is never re-posted (needs a human check: it may be live already).
 */
export async function runPublishJob(publishJobId: string) {
  const job = byId<Row>("publish_job", publishJobId);
  if (!job || job.status === "done" || job.status === "needs_check") return;
  if (job.status === "posting" || job.status === "verifying") {
    update("publish_job", job.id, { status: "needs_check", error: "Lần đăng trước bị ngắt giữa chừng — kiểm tra trên kênh xem bài đã lên chưa rồi bấm Đăng lại nếu cần" });
    return;
  }
  if (isKilled(job.biz_id, "publish")) {
    update("publish_job", job.id, { status: "failed", error: "Kill switch đăng bài đang bật" });
    return;
  }
  const ci = byId<Row>("content_item", job.content_item_id)!;
  const channel = byId<Row>("channel", job.channel_id)!;
  const route = publishRoute(channel);
  if (route === "none") {
    const error = `${channel.name} (${channel.platform}): ${routeReason(channel)} — bài CHƯA được đăng (mở Kênh đăng để liên kết API hoặc đăng qua Chrome)`;
    update("publish_job", job.id, { status: "failed", error });
    update("content_item", ci.id, { status: "manual_publish" });
    emit(job.biz_id, "alert.raised", { level: "warning", text: `"${ci.title}": ${error}` });
    audit(job.biz_id, "publishing", "post.publish_refused", { type: "content_item", id: ci.id }, { channel: channel.name, reason: routeReason(channel) });
    return;
  }
  const media = mediaOf(ci);
  update("publish_job", job.id, { status: "posting" });
  let res: { externalId: string; permalink: string };
  try {
    if (route === "api") {
      const c = connectorForChannel(channel);
      res = await c.publishPost!({ channelExternalId: channel.external_id, text: ci.body, kind: ci.kind, media }, job.idempotency_key);
      update("publish_job", job.id, { status: "verifying" });
      if (c.verifyPost && !(await c.verifyPost(res.externalId))) throw new Error("Xác minh sau đăng thất bại");
    } else {
      const r = await browserPublish(channel, { text: ci.body, mediaPath: media?.path, mode: "publish", tag: `pub-${job.id}` });
      res = { externalId: r.permalink || `chrome:${job.id}`, permalink: r.permalink };
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    update("publish_job", job.id, { status: "failed", error });
    emit(job.biz_id, "alert.raised", { level: "warning", text: `Đăng "${ci.title}" lên ${channel.name} lỗi: ${error}` });
    throw new PermanentError(error); // never auto-retry a publish: it may have gone through
  }
  const kind = ci.kind === "social_video" ? "reel" : ci.kind === "seo_article" ? "article" : "image";
  const post = q.get<Row>("SELECT id FROM post WHERE channel_id = ? AND external_id = ?", channel.id, res.externalId)
    ?? insert("post", { biz_id: job.biz_id, channel_id: channel.id, external_id: res.externalId, content_item_id: ci.id, kind, title: ci.title, body: ci.body, published_at: nowIso(), permalink: res.permalink, ad_status: "none", simulated: 0 });
  update("publish_job", job.id, { status: "done", post_id: post.id, simulated: 0, error: null });
  update("content_item", ci.id, { status: "published" });
  emit(job.biz_id, "post.published", { postId: post.id, title: ci.title, channel: channel.name, simulated: false, via: route });
  audit(job.biz_id, "publishing", "post.published", { type: "post", id: post.id }, { permalink: res.permalink, channel: channel.name, via: route });
  // Metrics snapshots only for API channels (Chrome-published posts have no reliable id to read insights from).
  if (route === "api") for (const [mark, h] of [["1h", 1], ["6h", 6], ["24h", 24], ["72h", 72]] as const) {
    enqueue("ads", "posts.snapshot", { postId: post.id, mark }, { bizId: job.biz_id, runAt: new Date(Date.now() + h * 3600_000), idempotencyKey: `snap:${post.id}:${mark}` });
  }
}

/** "Đăng lại" for a failed / needs_check job — the CEO confirmed on the channel that it is not live. */
export function retryPublishJob(bizId: string, publishJobId: string, actor: string) {
  const job = byId<Row>("publish_job", publishJobId);
  if (!job || job.biz_id !== bizId) throw new PermanentError("Không thấy lệnh đăng");
  if (!["failed", "needs_check"].includes(job.status)) throw new PermanentError("Chỉ đăng lại được lệnh lỗi / cần kiểm tra");
  const channel = byId<Row>("channel", job.channel_id)!;
  update("publish_job", job.id, { status: "scheduled", error: null, scheduled_at: nowIso() });
  enqueue("publish", job.mode === "draft" ? "publish.draft" : "publish.run", { publishJobId: job.id }, { bizId, idempotencyKey: `pubretry:${job.id}:${Date.now()}`, lockKey: chromeLock(channel) });
  audit(bizId, actor, "publish.retried", { type: "publish_job", id: job.id }, {});
  return byId("publish_job", job.id);
}

// ---------------- Post Scanner: snapshots, comments, scoring (spec §7, §9) ----------------
const SAMPLE_COMMENTS = [
  "Học phí AI Business System bao nhiêu vậy ad?", "Inbox mình lịch khai giảng nhé", "Bài hay quá, đúng tình trạng công ty mình",
  "Cho mình xin link AI Plus", "Có học online không ạ?", "Lại khóa học lùa gà à", "Chuẩn luôn, CEO ôm việc quá nhiều",
  "Đăng ký khóa miễn phí thế nào ạ?", "Vay tiền nhanh lãi thấp liên hệ zalo", "Công ty 30 nhân sự có phù hợp không?", "Autovis dùng thử được không?",
  "Cảm ơn TAKI", "Giá có trả góp không ạ", "Mình học rồi, áp dụng được ngay",
];

export async function snapshotPost(postId: string, mark: "1h" | "6h" | "24h" | "72h") {
  const post = byId<Row>("post", postId);
  if (!post) return;
  const channel = byId<Row>("channel", post.channel_id)!;
  const m = await connector(platformForChannel(channel.platform)).fetchPostMetrics!({ externalId: post.external_id, publishedAt: post.published_at, kind: post.kind }, mark);
  insert("post_metric_snapshot", { biz_id: post.biz_id, post_id: post.id, mark, metrics: m, captured_at: nowIso() });
  // Sandbox: materialise some comments so the Jev classifier and intent component have data.
  const have = q.scalar<number>("SELECT COUNT(*) FROM post_comment WHERE post_id = ?", post.id);
  const want = Math.min(12, Math.round(m.comments / 6));
  for (let i = have; i < want; i++) {
    insert("post_comment", { biz_id: post.biz_id, post_id: post.id, author: `Người dùng ${i + 1}`, text: SAMPLE_COMMENTS[Math.floor(seeded(`${post.id}:c${i}`) * SAMPLE_COMMENTS.length)] });
  }
  await classifyComments(post);
  await scorePostNow(post.id);
}

export async function classifyComments(post: Row) {
  const pending = q.all<Row>("SELECT * FROM post_comment WHERE post_id = ? AND label IS NULL LIMIT 30", post.id);
  if (!pending.length) return;
  const j = await judge({
    bizId: post.biz_id, purpose: "comments.classify", subject: { type: "post", id: post.id },
    state: { post: { title: post.title }, comments: pending.map((c) => ({ text: maskPhonesInText(c.text) })) },
    questions: commentQuestions(pending.length), heuristic: commentHeuristic,
  });
  const labels: Record<string, string> = {};
  pending.forEach((c, i) => {
    const a = (j.answers as any)[`c${i}`];
    const label = a.confidence >= 0.25 ? a.choice : "question";
    labels[c.id] = label;
    update("post_comment", c.id, { label, label_source: j.source, label_confidence: a.confidence, hidden: label === "spam" ? 1 : 0 });
  });
  recordDecision(j.id, { labels, hiddenSpam: Object.values(labels).filter((l) => l === "spam").length });
}

export async function scorePostNow(postId: string) {
  const post = byId<Row>("post", postId)!;
  const snaps = q.all<Row>("SELECT mark, metrics FROM post_metric_snapshot WHERE post_id = ? ORDER BY captured_at", postId);
  const byMark = new Map(snaps.map((s) => [s.mark, s.metrics]));
  const snapshots = [...byMark.entries()].map(([mark, m]: [string, any]) => ({ mark: mark as any, ...m }));
  const channelRates = q.all<Row>(
    `SELECT s.metrics FROM post_metric_snapshot s JOIN post p ON p.id = s.post_id WHERE p.channel_id = ? AND p.id != ? AND s.mark = '24h' ORDER BY s.captured_at DESC LIMIT 30`,
    post.channel_id, postId,
  ).map((r) => { const m = r.metrics; return m.reach ? (m.reactions + 2 * m.comments + 3 * m.shares + 2 * m.saves) / m.reach : 0; });
  const early = q.all<Row>(`SELECT s.metrics FROM post_metric_snapshot s JOIN post p ON p.id = s.post_id WHERE p.channel_id = ? AND s.mark = '6h' LIMIT 30`, post.channel_id)
    .map((r) => { const m = r.metrics; return m.reactions + 2 * m.comments + 3 * m.shares + 2 * m.saves; }).sort((a, b) => a - b);
  const labels = q.all<Row>("SELECT label, COUNT(*) n FROM post_comment WHERE post_id = ? AND label IS NOT NULL GROUP BY label", postId);
  const cnt = (l: string) => labels.find((x) => x.label === l)?.n ?? 0;
  const total = labels.reduce((a, x) => a + x.n, 0);

  // Jev: post fit to the active goal's focus products
  const goal = q.get<Row>("SELECT title FROM goal WHERE biz_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", post.biz_id);
  const fj = await judge({
    bizId: post.biz_id, purpose: "post.fit", subject: { type: "post", id: postId },
    state: { goal: { title: goal?.title ?? "Tăng học viên", focus_products: ((q.get<Row>("SELECT data FROM dna_profile WHERE biz_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1", post.biz_id)?.data?.products ?? []) as Row[]).filter((p) => p.verified !== false).map((p) => p.name) }, post: { title: post.title, body: String(post.body).slice(0, 1500) } },
    questions: postFitQuestions, heuristic: postFitHeuristic,
  });
  const fit = norm((fj.answers as any).fit);

  const r = scorePost({
    kind: post.kind, hasCta: /bình luận|nhắn|inbox|đăng ký/i.test(post.body), ageHours: (Date.now() - new Date(post.published_at).getTime()) / HOUR_MS,
    snapshots, channelEngagementRates: channelRates.length ? channelRates : [0.02, 0.03, 0.04],
    channelMedianEarly: early.length ? early[Math.floor(early.length / 2)] : 150,
    commentLabels: { purchase_intent: cnt("purchase_intent"), negative: cnt("negative"), total },
    fit,
  });
  insert("post_score", { biz_id: post.biz_id, post_id: postId, formula_version: FORMULA_VERSION, score: r.score, low_data: r.lowData ? 1 : 0, components: r.components, reasons: r.reasons, computed_at: nowIso() });
  recordDecision(fj.id, { fit, postScore: r.score });
  emit(post.biz_id, "post.scored", { postId, score: r.score });
  maybeCreateCandidate(post, r.score, r.lowData, r.reasons);
}

// ---------------- 9.2 Ad Selector ----------------
export function maybeCreateCandidate(post: Row, score: number, lowData: boolean, reasons: string[]) {
  const s = bizSettings(post.biz_id);
  if (lowData || score < s.postScoreThreshold || post.ad_status !== "none") return null;
  if (q.get("SELECT id FROM ad_candidate WHERE post_id = ? AND status IN ('proposed','approved','publishing','published')", post.id)) return null;
  const today = q.scalar<number>("SELECT COUNT(*) FROM ad_candidate WHERE biz_id = ? AND created_at >= ?", post.biz_id, new Date(Date.now() - 24 * 3600_000).toISOString());
  if (today >= s.caps.maxAdsCreatedPerDay) return null;
  const channel = byId<Row>("channel", post.channel_id)!;
  const platform = channel.platform === "tiktok" ? "tiktok" : "meta";
  const tpl = q.get<Row>("SELECT id FROM ad_template WHERE biz_id = ? AND platform = ? LIMIT 1", post.biz_id, platform);
  const cand = insert("ad_candidate", { biz_id: post.biz_id, post_id: post.id, platform, ad_template_id: tpl?.id ?? null, daily_budget: 2_000_000, score, reasons, status: "proposed" });
  update("post", post.id, { ad_status: "candidate" });
  const approval = insert("approval", {
    biz_id: post.biz_id, subject_type: "ad_candidate", subject_id: cand.id, agent_key: "ads", title: `Chạy ads từ bài: ${post.title}`,
    risk: "medium", status: "pending", preview: { platform, dailyBudget: 2_000_000, score, reasons },
    expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
  });
  emit(post.biz_id, "approval.created", { approvalId: approval.id, title: approval.title });
  return cand;
}

export { COMMENT_LABELS };
