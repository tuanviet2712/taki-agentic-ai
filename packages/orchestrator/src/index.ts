import { activeBizIds, audit, emit, insert, q, update, type Row } from "@dotaka/db";
import { sendTelegram } from "@dotaka/connectors";
import { handleIncoming, runFollowUps, setConversationConnector } from "@dotaka/chat-engine";
import { formatVnd, logger, nowIso } from "@dotaka/shared";
import { runAllRules, executeAction, publishCandidate, startAdsReport, syncAdMetrics, scheduledAdSync, latestDaily, sumMetrics, today } from "./ads.ts";
import { expireApprovals } from "./approvals.ts";
import { autoApproveOne } from "./auto-approve.ts";
import { learnDaily } from "./learning.ts";
import { engineOf, reattachVideoJob, runDraftUpload, runLocalVideoJob, runVideoJob } from "./creative.ts";
import { ensureAssistantAgent } from "./assistant.ts";
import { ensureSeoImages, upgradeWebsitePosts } from "./seo-images.ts";
import { startBrain } from "./brain.ts";
import { brainTick, registerBrainHooks } from "./brain-auto.ts";
import { recoverStuckPublishing, runPublishJob, schedulePublish, snapshotPost, syncWebsiteDrafts } from "./publishing.ts";
import { attachProductLinkComment } from "./comment-link.ts";
import { enqueue, startScheduler, startWorkers, type Handler } from "./queue.ts";
import { finalizeTask, recoverStuckTasks, recoverTasksAfterRestart, runTask } from "./runtime.ts";
import { connectionHealthAll, liveMessengerConnector, registerTelegramFromDb } from "./connections.ts";
import { MESSENGER_HANDLERS } from "./messenger-sync.ts";
import { CHAT_MEDIA_HANDLERS, queueChatMediaByExternal } from "./chat-media.ts";
import { CHAT_INSIGHT_HANDLERS } from "./chat-insight.ts";
import { ORDER_PUSH_HANDLERS } from "./order-push.ts";
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
export * from "./google-campaign.ts";
export * from "./publishing.ts";
export * from "./post-image.ts"; // ảnh đi kèm bài viết (Claude thiết kế / ChatGPT tạo ảnh)
export * from "./image-engine.ts"; // chọn công cụ tạo ảnh: Claude thiết kế / ChatGPT vẽ / Gemini trên Flow (+ dự phòng)
export * from "./ai-image.ts"; // tạo 1 ảnh bằng công cụ đã chọn
export { FLOW_IMAGE_MODELS } from "./flow-image.ts";
export * from "./auto-approve.ts"; // tự động phê duyệt nội dung / video đạt ngưỡng điểm (Sếp bật tay ở trang Duyệt)
export * from "./auto-approve-hook.ts";
export * from "./goal-request.ts"; // đọc số bài / loại nội dung từ yêu cầu + nâng trần token cho đủ số bài
export * from "./seo-images.ts"; // bài SEO: 4 ảnh / 1000 chữ, đặt ở vị trí tối ưu SEO
export * from "./seo-export.ts"; // xuất bài SEO + ảnh (.zip: html + md + images/)
export * from "./schedule-slots.ts";
export * from "./browser-publish.ts";
export * from "./tracking.ts"; // link đo click /r/<mã>, UTM, địa chỉ công khai
export * from "./link-product.ts"; // sản phẩm (DNA products[]) ↔ link dưới bình luận
export * from "./comment-link.ts"; // gắn link sản phẩm dưới bình luận (tự động / thủ công)
export * from "./public-media.ts"; // link media công khai ký sẵn cho Instagram
export * from "./oauth.ts"; // đăng nhập bằng nút: Facebook (+Instagram) / TikTok
export * from "./key-migration.ts"; // khóa mã hóa token
export * from "./approvals.ts";
export * from "./learning.ts";
export * from "./creative.ts";
export * from "./connections.ts";
export * from "./automations.ts";
export * from "./zalo-followup.ts";
export * from "./messenger-sync.ts";
export * from "./chat-media.ts";
export * from "./chat-vision.ts"; // bot xem ảnh khách gửi (tiêm vào chat-engine khi nạp)
export * from "./chat-insight.ts"; // Vòng lặp Thấu hiểu khách (kịch bản chốt đơn)
export * from "./order-push.ts"; // Đơn chốt từ chat → duyệt [ĐỎ] → đẩy Pancake POS
export * from "./nurture.ts";
export * from "./script-video.ts";
export * from "./flow-manual.ts"; // Làm thủ công trên Flow · Veo 3: concept + storyboard + video từng cảnh theo kịch bản đã duyệt
export * from "./dna-intake.ts";
export * from "./research.ts";
export * from "./autopilot.ts";
export * from "./assign.ts";
export * from "./business.ts";
export * from "./telegram-assistant.ts";
export * from "./chrome-profiles.ts";
export * from "./claude-chrome.ts";
export * from "./flow-browser.ts";
export * from "./assistant.ts";
export * from "./brain.ts";
export * from "./brain-auto.ts";
export * from "./video-ai.ts";
export * from "./pro-edit.ts"; // dựng video chuyên nghiệp từ video thô (cắt cảnh, chuyển cảnh, zoom, chữ động, hiệu ứng âm thanh)

export async function dailyReport(bizId: string) {
  const text = quickReport(bizId).replace(/^Báo cáo nhanh/, "Báo cáo sáng");
  await sendTelegram(text, "info");
  audit(bizId, "analytics_agent", "report.daily", undefined, { text });
  emit(bizId, "alert.raised", { level: "info", text: "Báo cáo sáng đã sẵn sàng" });
}

export const HANDLERS: Record<string, Handler> = {
  "agent.run": async (p) => runTask(p.taskId),
  "task.finalize": async (p) => finalizeTask(p.taskId, p.runId),
  "seo.images": async (p, job) => void (await ensureSeoImages(job.biz_id, p.contentItemId, { replaceAll: !!p.replaceAll, note: p.note || undefined, actor: p.actor || "ceo" })),
  "chat.ingest": async (p) => {
    await handleIncoming(p.bizId, p.msg);
    // Tin có ảnh: tải ảnh về máy (link CDN Facebook hết hạn) — job riêng, không chặn lượt trả lời.
    if (p.msg?.attachments?.length) queueChatMediaByExternal(p.bizId, p.msg.channel, p.msg.externalConversationId, p.msg.messageId);
  },
  "creative.flow": async (p) => runVideoJob(p.jobId),
  "creative.local": async (p) => runLocalVideoJob(p.jobId),
  "publish.draft": async (p) => runDraftUpload(p.publishJobId),
  // Bài của Lái tự động + chế độ "Đăng ngay" → đăng luôn khi vừa duyệt (trừ giờ yên lặng / đủ trần bài/ngày).
  "publish.schedule": async (p, job) => void schedulePublish(job.biz_id, p.contentItemId, autopilotPublishOpts(job.biz_id, p.contentItemId)),
  "publish.run": async (p) => runPublishJob(p.publishJobId),
  "posts.snapshot": async (p) => snapshotPost(p.postId, p.mark),
  "posts.comment_link": async (p) => attachProductLinkComment(p.postId), // link sản phẩm dưới bình luận (30–60 giây sau khi đăng Facebook)
  "candidate.publish": async (p, job) => publishCandidate(job.biz_id, p.candidateId),
  "action.execute": async (p) => executeAction(p.actionId),
  // scheduled
  "metrics.sync.ads": async (p) => void (await scheduledAdSync(p.bizId)),
  "rules.evaluate": async (p) => runAllRules(p.bizId),
  "chat.followup": async (p) => { await runFollowUps(p.bizId); await runZaloFollowUps(p.bizId); },
  "zalo.sync": async (p) => void (await syncZalo(p.bizId)),
  ...MESSENGER_HANDLERS,
  ...CHAT_MEDIA_HANDLERS, // Tải ảnh khách gửi qua Messenger về máy (chat.media)
  ...CHAT_INSIGHT_HANDLERS, // chat.insight: hằng tuần học từ hội thoại → đề xuất sửa kịch bản chốt đơn
  ...NURTURE_HANDLERS,
  ...RESEARCH_HANDLERS,
  ...AUTOPILOT_HANDLERS,
  ...ORDER_PUSH_HANDLERS, // order.push_pancake + orders.pancake_sync
  "learn.daily": async (p) => void learnDaily(p.bizId),
  "ads.weekly_report": async (p) => { if (q.scalar<number>("SELECT COUNT(*) FROM ad WHERE biz_id = ?", p.bizId)) startAdsReport(p.bizId); },
  "report.daily": async (p) => dailyReport(p.bizId),
  "connection.health": async (p) => connectionHealthAll(p.bizId),
  "automations.tick": async (p) => void (await automationsTick(p.bizId)),
  "approvals.expire": async () => void expireApprovals(),
  "approval.auto": async (p, job) => void (await autoApproveOne(job.biz_id, p.approvalId)),
  "brain.tick": async (p) => brainTick(p.bizId),
};

export function startOrchestrator() {
  // Recovery (spec §5): bài đang viết → viết lại; bài đã viết + chấm, đang tạo ảnh → làm nốt rồi vào Duyệt (runtime.ts).
  recoverTasksAfterRestart();
  // Flow and news agents run detached (headless Claude CLI) and survive a server restart: re-attach (live log + result.json).
  for (const j of q.all<Row>("SELECT id, biz_id, tool FROM creative_job WHERE status = 'running'")) {
    if (engineOf(j.tool) === "flow" || engineOf(j.tool) === "news") { void reattachVideoJob(j.id).catch((e) => logger.warn("creative.reattach_failed", { jobId: j.id, error: String(e) })); continue; }
    // Local engines run inside this process — after a restart, start the job again from the queue.
    update("creative_job", j.id, { status: "queued", step: "Máy chủ vừa khởi động lại — chạy lại" });
    enqueue("media", "creative.local", { jobId: j.id }, { bizId: j.biz_id, idempotencyKey: `flow:${j.id}:r${Date.now()}`, lockKey: "video-ai", maxAttempts: 1 });
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
  // Bộ canh không để rơi bài: task / lượt đăng không còn job nào xử lý → đẩy đi tiếp (lần đầu sau 1 phút, rồi 5 phút/lần).
  const watchdog = () => {
    try { upgradeWebsitePosts(); recoverStuckTasks(); recoverStuckPublishing(); } catch (e) { logger.warn("watchdog.failed", { error: String(e).slice(0, 300) }); }
    // Bài website còn nháp trên WordPress → về hàng Đăng bài; Sếp đã tự xuất bản → "Đã xuất bản" (đọc trạng thái thật qua API).
    void syncWebsiteDrafts().catch((e) => logger.warn("watchdog.website_sync_failed", { error: String(e).slice(0, 300) }));
  };
  const firstWatch = setTimeout(watchdog, 60_000);
  const watchTimer = setInterval(watchdog, 5 * 60_000);
  return () => {
    stopWorkers();
    stopScheduler();
    stopTelegram();
    clearTimeout(firstWatch);
    clearInterval(watchTimer);
  };
}
