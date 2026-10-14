import { audit, bizSettings, byId, isKilled, q, update, type Row } from "@dotaka/db";
import { AppError, logger } from "@dotaka/shared";
import { decideApproval } from "./approvals.ts";
import { seoImagesShortReason } from "./seo-images.ts";

/**
 * Tự động phê duyệt (trang Duyệt & Phê duyệt). Sếp BẬT TAY, đặt ngưỡng điểm; mục duyệt mới của nội dung đạt điều kiện được duyệt luôn
 * (cùng đường với nút "Phê duyệt": bài → lên lịch đăng, video → đăng nháp lên kênh) và ghi nhật ký "Tự động duyệt".
 *
 * Chỉ áp cho NỘI DUNG: bài viết, kịch bản video, bài SEO (khâu content / video_script / seo_web) và video thành phẩm (Video Flow).
 * KHÔNG BAO GIỜ tự duyệt: quảng cáo + ngân sách, thay đổi ads, tin gửi khách (follow-up Zalo, chăm khách từ bình luận), đơn hàng,
 * đề xuất học, kế hoạch / chiến lược — những thứ tốn tiền hoặc nói chuyện với khách luôn do Sếp quyết.
 *
 * Điều kiện (thiếu 1 điều kiện = để Sếp duyệt như thường, kèm lý do):
 *   1. Đã có điểm chấm, review "Đạt" (không phải cần sửa / chặn / cần Sếp xem), không có lỗi nghiêm trọng;
 *   2. Điểm ≥ ngưỡng Sếp đặt;
 *   3. Bài đủ ảnh (bài viết có ảnh khi bật tự tạo ảnh; bài SEO đủ 4 ảnh / 1000 chữ), video qua kiểm tra kỹ thuật;
 *   4. Mục chưa hết hạn, kill switch đăng bài đang TẮT.
 * Chỉ tác động tới mục duyệt MỚI sau khi bật. Mục đang chờ từ trước chỉ được duyệt khi Sếp bấm "Duyệt ngay" (autoApprovePending).
 */
export const AUTO_APPROVE_MIN = 70; // thấp nhất: mức "Đạt" của mọi thang chấm nội dung (72 / 70 / 70 / 70) — dưới đó review không bao giờ "Đạt"
export const AUTO_APPROVE_DEFAULT = 85;
const CONTENT_AGENTS = new Set(["content", "video_script", "seo_web"]);
const ACTOR = "Tự động duyệt";

export const clampScore = (n: unknown) => Math.max(AUTO_APPROVE_MIN, Math.min(100, Math.round(Number(n) || AUTO_APPROVE_DEFAULT)));
export function autoApproveConfig(bizId: string): { enabled: boolean; minScore: number } {
  const s = bizSettings(bizId).autoApprove;
  return { enabled: s?.enabled === true, minScore: clampScore(s?.minScore ?? AUTO_APPROVE_DEFAULT) };
}

export type AutoCheck = { ok: true; score: number } | { ok: false; reason: string; eligible: boolean };
const no = (reason: string, eligible = true): AutoCheck => ({ ok: false, reason, eligible });

/** Loại mục duyệt này có thuộc phạm vi tự duyệt không (nội dung / video). */
export function isAutoApprovable(ap: Row): boolean {
  if (ap.subject_type === "creative_job") return true;
  if (ap.subject_type !== "task") return false;
  const t = byId<Row>("task", ap.subject_id);
  return !!t && CONTENT_AGENTS.has(t.agent_key);
}

/** Mục duyệt này có đủ điều kiện tự duyệt ở ngưỡng `minScore` không (chỉ đọc, không đổi gì). */
export function checkAutoApprove(ap: Row, minScore: number): AutoCheck {
  if (!isAutoApprovable(ap)) return no("Loại này luôn do Sếp duyệt (tiền, tin gửi khách, kế hoạch)", false);
  if (ap.status !== "pending") return no("Mục này đã được xử lý");
  if (ap.expires_at && new Date(ap.expires_at) < new Date()) return no("Mục duyệt đã hết hạn");
  if (ap.risk === "high") return no("Rủi ro cao");
  const rv = ap.review_score_id ? byId<Row>("review_score", ap.review_score_id) : undefined;
  if (!rv) return no("Chưa có điểm chấm");
  const fatal = (rv.result?.fatalFindings ?? []) as unknown[];
  if (rv.verdict !== "pass" || fatal.length) {
    const why = ({ revise: "cần sửa", block: "bị chặn", escalate: "cần Sếp xem" } as Record<string, string>)[rv.verdict] ?? rv.verdict;
    return no(`Review chưa "Đạt" (${why})`);
  }
  const score = Math.round(Number(rv.total) * 10) / 10;
  if (!(score >= minScore)) return no(`Điểm ${score} thấp hơn ngưỡng ${minScore}`);
  const pv = (ap.preview ?? {}) as Row;
  if (pv.notPassed) return no("Chưa đạt review sau số vòng sửa tối đa");
  if (pv.escalated) return no("Review báo cần Sếp xem");
  if (pv.imageError) return no(String(pv.imageError).slice(0, 160));
  if (ap.subject_type === "task") {
    const ci = q.get<Row>("SELECT * FROM content_item WHERE task_id = ?", ap.subject_id);
    if (!ci || ci.status !== "awaiting_approval") return no("Nội dung không còn chờ duyệt");
    const short = seoImagesShortReason(ci);
    if (short) return no(short);
  } else {
    const tech = (pv.tech ?? []) as { passed: boolean; check: string }[];
    const bad = tech.find((t) => !t.passed);
    if (bad) return no(`Video chưa đạt kiểm tra kỹ thuật: ${bad.check}`);
    const job = byId<Row>("creative_job", ap.subject_id);
    if (!job?.content_item_id || !job.asset_id) return no("Video chưa có tệp thành phẩm");
  }
  if (isKilled(ap.biz_id, "publish")) return no("Kill switch đăng bài đang bật");
  return { ok: true, score };
}

export type AutoResult = { approved: boolean; reason?: string; score?: number };

/** Duyệt 1 mục nếu đạt điều kiện. `ignoreSwitch`: chạy tay ("Duyệt ngay") thì không cần công tắc đang bật. Không bao giờ ném lỗi. */
export async function autoApproveOne(bizId: string, approvalId: string, opts: { ignoreSwitch?: boolean } = {}): Promise<AutoResult> {
  const cfg = autoApproveConfig(bizId);
  if (!cfg.enabled && !opts.ignoreSwitch) return { approved: false, reason: "Tự động phê duyệt đang tắt" };
  const ap = byId<Row>("approval", approvalId);
  if (!ap || ap.biz_id !== bizId) return { approved: false, reason: "Không thấy mục duyệt" };
  const c = checkAutoApprove(ap, cfg.minScore);
  if (!c.ok) {
    // Lý do chưa tự duyệt được ghi vào lịch sử của mục (chỉ cho mục mới; bấm "Duyệt ngay" thì lý do hiện ngay trên màn hình).
    if (!opts.ignoreSwitch && c.eligible && ap.status === "pending") audit(bizId, ACTOR, "approval.auto_skipped", { type: "approval", id: ap.id }, { reason: c.reason, title: ap.title, minScore: cfg.minScore });
    return { approved: false, reason: c.reason };
  }
  try {
    await decideApproval(bizId, ap.id, "approve", `Tự động duyệt: điểm ${c.score} ≥ ngưỡng ${cfg.minScore}`, undefined, ACTOR);
  } catch (e) {
    const reason = e instanceof AppError || e instanceof Error ? e.message : String(e);
    logger.warn("auto_approve.failed", { approvalId, error: reason.slice(0, 300) });
    return { approved: false, reason };
  }
  audit(bizId, ACTOR, "approval.auto_approved", { type: "approval", id: ap.id }, { score: c.score, minScore: cfg.minScore, title: ap.title, subjectType: ap.subject_type });
  return { approved: true, score: c.score };
}

/** "Duyệt ngay": duyệt các mục ĐANG chờ từ trước đã đạt ngưỡng (bật công tắc không tự làm việc này, tránh đăng hàng loạt bất ngờ). */
export async function autoApprovePending(bizId: string, minScore?: number) {
  const min = minScore ?? autoApproveConfig(bizId).minScore;
  const rows = q.all<Row>("SELECT * FROM approval WHERE biz_id = ? AND status = 'pending' ORDER BY created_at LIMIT 100", bizId);
  const out = { approved: 0, skipped: [] as { id: string; title: string; reason: string }[] };
  for (const ap of rows) {
    if (!isAutoApprovable(ap)) continue;
    const c = checkAutoApprove(ap, min);
    if (!c.ok) { out.skipped.push({ id: ap.id, title: ap.title, reason: c.reason }); continue; }
    const r = await autoApproveOne(bizId, ap.id, { ignoreSwitch: true });
    if (r.approved) out.approved++; else out.skipped.push({ id: ap.id, title: ap.title, reason: r.reason ?? "Không duyệt được" });
  }
  return out;
}

/** Cho giao diện: cài đặt + bao nhiêu mục đang chờ sẽ đạt ngưỡng + vài mục vừa được tự duyệt. */
export function autoApproveView(bizId: string) {
  const cfg = autoApproveConfig(bizId);
  const pending = q.all<Row>("SELECT * FROM approval WHERE biz_id = ? AND status = 'pending'", bizId).filter(isAutoApprovable);
  const ready = pending.filter((ap) => checkAutoApprove(ap, cfg.minScore).ok).length;
  const recent = q.all<Row>("SELECT at, data FROM audit_log WHERE biz_id = ? AND event = 'approval.auto_approved' ORDER BY at DESC LIMIT 5", bizId)
    .map((r) => ({ at: r.at, title: String(r.data?.title ?? ""), score: r.data?.score ?? null }));
  const publishKilled = isKilled(bizId, "publish");
  return { ...cfg, min: AUTO_APPROVE_MIN, pendingEligible: pending.length, pendingReady: ready, publishKilled, recent };
}

export function setAutoApprove(bizId: string, patch: { enabled?: boolean; minScore?: number }, actor: string) {
  const cur = bizSettings(bizId);
  const before = autoApproveConfig(bizId);
  const next = { enabled: patch.enabled ?? before.enabled, minScore: patch.minScore != null ? clampScore(patch.minScore) : before.minScore };
  update("biz", bizId, { settings: { ...cur, autoApprove: next } });
  audit(bizId, actor, "auto_approve.changed", { type: "biz", id: bizId }, { before, after: next });
  return autoApproveView(bizId);
}
