import { activeBizIds, audit, emit, insert, q, update, type Row } from "@dotaka/db";
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
import { RESEARCH_HANDLERS } from "./research.ts";
import { AUTOPILOT_HANDLERS, autopilotPublishOpts } from "./autopilot.ts";
import { quickReport } from "./assign.ts";
import { ensureBizSchedules } from "./business.ts";
import { startTelegramAssistant } from "./telegram-assistant.ts";
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
export * from "./dna-intake.ts";
export * from "./research.ts";
export * from "./autopilot.ts";
export * from "./assign.ts";
export * from "./business.ts";
export * from "./telegram-assistant.ts";
export * from "./chrome-profiles.ts";
export * from "./flow-browser.ts";
export * from "./assistant.ts";
export * from "./brain.ts";
export * from "./brain-auto.ts";
export * from "./video-ai.ts";

export async function dailyReport(bizId: string) {
  const text = quickReport(bizId).replace(/^Báo cáo nhanh/, "Báo cáo sáng");
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
  // Bài của Lái tự động + chế độ "Đăng ngay" → đăng luôn khi vừa duyệt (trừ giờ yên lặng / đủ trần bài/ngày).
  "publish.schedule": async (p, job) => void schedulePublish(job.biz_id, p.contentItemId, autopilotPublishOpts(job.biz_id, p.contentItemId)),
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
  ...RESEARCH_HANDLERS,
  ...AUTOPILOT_HANDLERS,
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
  // Mọi doanh nghiệp đang hoạt động: trợ lý, bộ não, bộ lịch nền đầy đủ (business.ts ensureBizSchedules).
  for (const id of activeBizIds()) {
    ensureAssistantAgent(id);
    setTimeout(() => void brainTick(id, { full: true }).catch((e) => logger.warn("brain.boot_tick_failed", { error: String(e) })), 3000);
    ensureBizSchedules(id);
  }
  const stopWorkers = startWorkers(HANDLERS);
  const stopScheduler = startScheduler();
  // Ngân Nguyệt trên Telegram (long polling; ngủ khi chưa có kết nối Telegram).
  const stopTelegram = startTelegramAssistant();
  return () => {
    stopWorkers();
    stopScheduler();
    stopTelegram();
  };
}
