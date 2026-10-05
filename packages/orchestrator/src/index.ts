import { audit, emit, insert, q, update, type Row } from "@dotaka/db";
import { sendTelegram } from "@dotaka/connectors";
import { handleIncoming, runFollowUps, setConversationConnector } from "@dotaka/chat-engine";
import { formatVnd, logger, nowIso } from "@dotaka/shared";
import { runAllRules, executeAction, publishCandidate, startAdsReport, syncAdMetrics, scheduledAdSync, latestDaily, sumMetrics, today } from "./ads.ts";
import { expireApprovals } from "./approvals.ts";
import { learnDaily } from "./learning.ts";
import { engineOf, reattachVideoJob, runDraftUpload, runLocalVideoJob, runVideoJob } from "./creative.ts";
import { ensureAssistantAgent } from "./assistant.ts";
import { startBrain } from "./brain.ts";
import { brainTick, registerBrainHooks } from "./brain-auto.ts";
import { runPublishJob, schedulePublish, snapshotPost } from "./publishing.ts";
import { enqueue, startScheduler, startWorkers, type Handler } from "./queue.ts";
import { runTask } from "./runtime.ts";
import { connectionHealthAll, liveMessengerConnector, registerTelegramFromDb } from "./connections.ts";
import { MESSENGER_HANDLERS } from "./messenger-sync.ts";
import { NURTURE_HANDLERS } from "./nurture.ts";
import { automationsTick, ensureAutomations } from "./automations.ts";
import { registerZaloProxy, runZaloFollowUps, syncZalo } from "./zalo-followup.ts";

export * from "./queue.ts";
export * from "./runtime.ts";
export * from "./review.ts";
export * from "./ads.ts";
export * from "./publishing.ts";
export * from "./browser-publish.ts";
export * from "./approvals.ts";
export * from "./learning.ts";
export * from "./creative.ts";
export * from "./connections.ts";
export * from "./automations.ts";
export * from "./zalo-followup.ts";
export * from "./messenger-sync.ts";
export * from "./nurture.ts";
export * from "./script-video.ts";
export * from "./chrome-profiles.ts";
export * from "./flow-browser.ts";
export * from "./assistant.ts";
export * from "./brain.ts";
export * from "./brain-auto.ts";
export * from "./video-ai.ts";

export async function dailyReport(bizId: string) {
  const ads = q.all<Row>("SELECT id FROM ad WHERE biz_id = ?", bizId);
  const m = sumMetrics(ads.flatMap((a) => latestDaily(bizId, a.id, today())));
  const leads = q.scalar<number>("SELECT COUNT(*) FROM lead WHERE biz_id = ? AND created_at >= ?", bizId, `${today()}T00:00:00`);
  const hot = q.scalar<number>("SELECT COUNT(*) FROM lead WHERE biz_id = ? AND grade = 'hot' AND updated_at >= ?", bizId, `${today()}T00:00:00`);
  const revenue = q.scalar<number>("SELECT COALESCE(SUM(total),0) FROM orders WHERE biz_id = ? AND created_at >= ?", bizId, `${today()}T00:00:00`);
  const pending = q.scalar<number>("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'pending'", bizId);
  const text = `Báo cáo sáng ${q.get<Row>("SELECT name FROM biz WHERE id = ?", bizId)?.name ?? ""}, ${today()}\n• Chi ads: ${formatVnd(m.spend)} · ${m.results} kết quả\n• Lead mới: ${leads} (nóng: ${hot})\n• Doanh thu ghi nhận: ${formatVnd(revenue)}\n• ${pending} mục chờ Sếp duyệt`;
  await sendTelegram(text, "info");
  audit(bizId, "analytics_agent", "report.daily", undefined, { text });
  emit(bizId, "alert.raised", { level: "info", text: "Báo cáo sáng đã sẵn sàng" });
}

export const HANDLERS: Record<string, Handler> = {
  "agent.run": async (p) => runTask(p.taskId),
  "chat.ingest": async (p) => void (await handleIncoming(p.bizId, p.msg)),
  "creative.flow": async (p) => runVideoJob(p.jobId),
  "creative.local": async (p) => runLocalVideoJob(p.jobId),
  "publish.draft": async (p) => runDraftUpload(p.publishJobId),
  "publish.schedule": async (p, job) => void schedulePublish(job.biz_id, p.contentItemId),
  "publish.run": async (p) => runPublishJob(p.publishJobId),
  "posts.snapshot": async (p) => snapshotPost(p.postId, p.mark),
  "candidate.publish": async (p, job) => publishCandidate(job.biz_id, p.candidateId),
  "action.execute": async (p) => executeAction(p.actionId),
  // scheduled
  "metrics.sync.ads": async (p) => void (await scheduledAdSync(p.bizId)),
  "rules.evaluate": async (p) => runAllRules(p.bizId),
  "chat.followup": async (p) => { await runFollowUps(p.bizId); await runZaloFollowUps(p.bizId); },
  "zalo.sync": async (p) => void (await syncZalo(p.bizId)),
  ...MESSENGER_HANDLERS,
  ...NURTURE_HANDLERS,
  "learn.daily": async (p) => void learnDaily(p.bizId),
  "ads.weekly_report": async (p) => { if (q.scalar<number>("SELECT COUNT(*) FROM ad WHERE biz_id = ?", p.bizId)) startAdsReport(p.bizId); },
  "report.daily": async (p) => dailyReport(p.bizId),
  "connection.health": async (p) => connectionHealthAll(p.bizId),
  "automations.tick": async (p) => void (await automationsTick(p.bizId)),
  "approvals.expire": async () => void expireApprovals(),
  "brain.tick": async (p) => brainTick(p.bizId),
};

export function startOrchestrator() {
  // Recovery (spec §5): a worker that died mid-task leaves the task "running"/"in_review"; its job is
  // re-queued by startWorkers, so put the task back to "ready" to let the runtime pick it up again.
  const stuck = q.all<Row>("SELECT id, biz_id, status FROM task WHERE status IN ('running','in_review')");
  for (const t of stuck) {
    update("task", t.id, { status: "ready", step: "Khôi phục sau khởi động lại" });
    audit(t.biz_id, "orchestrator", "task.recovered", { type: "task", id: t.id }, { from: t.status });
  }
  // Flow and news agents run detached (headless Claude CLI) and survive a server restart: re-attach (live log + result.json).
  for (const j of q.all<Row>("SELECT id, biz_id, tool FROM creative_job WHERE status = 'running'")) {
    if (engineOf(j.tool) === "flow" || engineOf(j.tool) === "news") { void reattachVideoJob(j.id).catch((e) => logger.warn("creative.reattach_failed", { jobId: j.id, error: String(e) })); continue; }
    // Local engines run inside this process — after a restart, start the job again from the queue.
    update("creative_job", j.id, { status: "queued", step: "Máy chủ vừa khởi động lại — chạy lại" });
    enqueue("agent", "creative.local", { jobId: j.id }, { bizId: j.biz_id, idempotencyKey: `flow:${j.id}:r${Date.now()}`, lockKey: "video-ai", maxAttempts: 1 });
  }
  registerTelegramFromDb();
  // Bộ não: index + watch every vault, archive finished work as it happens, first tick (creates the default vault).
  startBrain();
  registerBrainHooks();
  registerZaloProxy();
  setConversationConnector(liveMessengerConnector);
  for (const b of q.all<Row>("SELECT id FROM biz")) {
    ensureAssistantAgent(b.id);
    setTimeout(() => void brainTick(b.id, { full: true }).catch((e) => logger.warn("brain.boot_tick_failed", { error: String(e) })), 3000);
    if (!q.get("SELECT id FROM schedule WHERE biz_id = ? AND name = 'brain.tick'", b.id))
      insert("schedule", { biz_id: b.id, name: "brain.tick", queue: "agent", every_minutes: 5, enabled: 1, label: "Bộ não: nhật ký, dashboard, nhắc việc, đồng bộ (5 phút)", last_run_at: nowIso() });
    ensureAutomations(b.id);
    // Configs can run every 5 minutes: the tick and rule evaluation must be at least that frequent.
    if (!q.get("SELECT id FROM schedule WHERE biz_id = ? AND name = 'automations.tick'", b.id))
      insert("schedule", { biz_id: b.id, name: "automations.tick", queue: "ads", every_minutes: 5, enabled: 1, label: "Chạy cấu hình tự động (5 phút)", last_run_at: nowIso() });
    if (!q.get("SELECT id FROM schedule WHERE biz_id = ? AND name = 'zalo.sync'", b.id))
      insert("schedule", { biz_id: b.id, name: "zalo.sync", queue: "chat", every_minutes: 2, enabled: 1, label: "Đồng bộ hội thoại Zalo từ ZL-CRM (2 phút)", last_run_at: nowIso() });
    // Chăm khách từ bình luận: chỉ làm việc khi Sếp bật (nurture.enabled) — tắt thì 2 lịch này không gọi Facebook.
    if (!q.get("SELECT id FROM schedule WHERE biz_id = ? AND name = 'nurture.poll'", b.id))
      insert("schedule", { biz_id: b.id, name: "nurture.poll", queue: "chat", every_minutes: 5, enabled: 1, label: "Chăm khách: quét bình luận mới trên Fanpage (5 phút)", last_run_at: nowIso() });
    if (!q.get("SELECT id FROM schedule WHERE biz_id = ? AND name = 'nurture.tick'", b.id))
      insert("schedule", { biz_id: b.id, name: "nurture.tick", queue: "chat", every_minutes: 5, enabled: 1, label: "Chăm khách: trả lời, nhắc SĐT, kết bạn Zalo (5 phút)", last_run_at: nowIso() });
    if (!q.get("SELECT id FROM schedule WHERE biz_id = ? AND name = 'messenger.sync'", b.id))
      insert("schedule", { biz_id: b.id, name: "messenger.sync", queue: "chat", every_minutes: 3, enabled: 1, label: "Đồng bộ hội thoại Messenger của Fanpage thật (3 phút)", last_run_at: nowIso() });
    q.run("UPDATE schedule SET every_minutes = 5, label = 'Chạy rule/cấu hình quảng cáo (5 phút)' WHERE biz_id = ? AND name = 'rules.evaluate' AND every_minutes > 5", b.id);
  }
  const stopWorkers = startWorkers(HANDLERS);
  const stopScheduler = startScheduler();
  return () => {
    stopWorkers();
    stopScheduler();
  };
}
