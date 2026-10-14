import { CATALOG } from "@dotaka/agents";
import { DEFAULT_SETTINGS, activeBizIds, audit, byId, defaultBizId, insert, q, tx, update, type Row } from "@dotaka/db";
import { DEFAULT_LLM } from "@dotaka/llm-gateway";
import { syncSkills } from "@dotaka/skills";
import { AppError, logger, nowIso } from "@dotaka/shared";
import { ensureAutomations } from "./automations.ts";
import { blankDna } from "./dna-intake.ts";
import { ensureAssistantAgent } from "./assistant.ts";

/**
 * NHIỀU DOANH NGHIỆP trong 1 bản cài (theo mẫu AI Affiliate OS): mỗi doanh nghiệp có DNA, kế hoạch, kênh, khách,
 * lịch nền, báo cáo riêng (mọi bảng đã có biz_id). Web chọn doanh nghiệp bằng header x-biz-id / cookie taki_biz.
 * Không xoá doanh nghiệp: chỉ LƯU TRỮ (ẩn + dừng lịch nền), khôi phục được bất cứ lúc nào.
 */
const isArchived = (b: Row) => Boolean(b.settings?.archived);

/** Bộ lịch nền của 1 doanh nghiệp (giống bản cài mới). Chỉ thêm lịch còn thiếu, không bật lại lịch Sếp đã tắt. */
/** Nhịp quét khách đang chờ: 15 giây (đơn vị phút; lịch cho phép số lẻ). */
export const FAST_MIN = 0.25;
const SCHEDULES: [name: string, queue: string, every: number, label: string][] = [
  ["metrics.sync.ads", "ads", 15, "Đồng bộ chỉ số ads (15 phút)"],
  ["rules.evaluate", "ads", 5, "Chạy rule/cấu hình quảng cáo (5 phút)"],
  ["chat.followup", "chat", 10, "Follow-up khách (10 phút)"],
  ["learn.daily", "agent", 24 * 60, "Feedback loop hằng ngày"],
  ["report.daily", "agent", 24 * 60, "Báo cáo sáng qua Telegram"],
  ["connection.health", "agent", 60, "Kiểm tra kết nối (60 phút)"],
  ["approvals.expire", "review", 30, "Hết hạn mục duyệt"],
  ["ads.weekly_report", "agent", 7 * 24 * 60, "Báo cáo & đề xuất Ads tuần (skill mkt-ads)"],
  ["brain.tick", "agent", 5, "Bộ não: nhật ký, dashboard, nhắc việc, đồng bộ (5 phút)"],
  ["automations.tick", "ads", 5, "Chạy cấu hình tự động (5 phút)"],
  ["zalo.sync", "chat", 2, "Đồng bộ hội thoại Zalo từ ZL-CRM (2 phút)"],
  ["research.tick", "agent", 10, "Trinh sát nội dung: cập nhật nguồn quan sát theo lịch"],
  // Khách đang chờ trả lời: quét mỗi 15 giây (số phút lẻ). Bình luận: 1 lệnh Graph gộp/Trang cho 10 bài gần nhất, đủ bài 14 ngày 5 phút/lần — xem nurture.pollBizComments.
  ["nurture.poll", "chat", FAST_MIN, "Chăm khách: quét bình luận mới trên Fanpage (15 giây)"],
  ["nurture.tick", "chat", FAST_MIN, "Chăm khách: trả lời, nhắc SĐT, kết bạn Zalo (15 giây)"],
  ["messenger.sync", "chat", FAST_MIN, "Đồng bộ hội thoại Messenger của Fanpage thật (15 giây)"],
  // Vòng lặp Thấu hiểu khách (kịch bản chốt đơn): bỏ qua nếu doanh nghiệp chưa có kịch bản nào.
  ["chat.insight", "agent", 7 * 24 * 60, "Vòng lặp Thấu hiểu khách: học từ hội thoại → đề xuất sửa kịch bản chốt đơn (hằng tuần)"],
  ["autopilot.tick", "agent", 15, "Lái tự động: giữ đủ nội dung cho các ngày tới (15 phút)"],
  // Đơn đã đẩy sang Pancake: kéo trạng thái (đã nhận / đã huỷ…) về để báo cáo doanh thu đúng; không gọi mạng nếu chưa có đơn nào.
  ["orders.pancake_sync", "agent", 30, "Cập nhật trạng thái đơn đã đẩy sang Pancake (30 phút)"],
];
export function ensureBizSchedules(bizId: string): string[] {
  const added: string[] = [];
  for (const [name, queue, every, label] of SCHEDULES) {
    if (q.get("SELECT id FROM schedule WHERE biz_id = ? AND name = ?", bizId, name)) continue;
    insert("schedule", { biz_id: bizId, name, queue, every_minutes: every, enabled: 1, label, last_run_at: nowIso() });
    added.push(name);
  }
  q.run("UPDATE schedule SET label = 'Trinh sát nội dung: cập nhật nguồn quan sát theo lịch' WHERE biz_id = ? AND name = 'research.tick'", bizId);
  q.run("UPDATE schedule SET every_minutes = 5, label = 'Chạy rule/cấu hình quảng cáo (5 phút)' WHERE biz_id = ? AND name = 'rules.evaluate' AND every_minutes > 5", bizId);
  // Khách đang chờ trả lời: bản cũ quét 1–5 phút/lần → khách chờ quá lâu: nâng lên 15 giây (chỉ lịch còn chậm hơn; không đụng việc bật/tắt).
  for (const [name, label] of [
    ["messenger.sync", "Đồng bộ hội thoại Messenger của Fanpage thật (15 giây)"],
    ["nurture.poll", "Chăm khách: quét bình luận mới trên Fanpage (15 giây)"],
    ["nurture.tick", "Chăm khách: trả lời, nhắc SĐT, kết bạn Zalo (15 giây)"],
  ]) q.run("UPDATE schedule SET every_minutes = ?, label = ? WHERE biz_id = ? AND name = ? AND every_minutes > ?", FAST_MIN, label, bizId, name, FAST_MIN);
  ensureAutomations(bizId);
  return added;
}

export function listBusinesses(): Row[] {
  const def = defaultBizId();
  return q.all<Row>("SELECT id, name, settings, created_at FROM biz ORDER BY created_at")
    .filter((b) => !isArchived(b))
    .map((b) => ({
      id: b.id, name: b.name, created_at: b.created_at, isDefault: b.id === def,
      counts: {
        goals: q.scalar<number>("SELECT COUNT(*) FROM goal WHERE biz_id = ?", b.id) ?? 0,
        posts: q.scalar<number>("SELECT COUNT(*) FROM post WHERE biz_id = ? AND COALESCE(simulated, 0) = 0", b.id) ?? 0,
        conversations: q.scalar<number>("SELECT COUNT(*) FROM conversation WHERE biz_id = ?", b.id) ?? 0,
        approvals: q.scalar<number>("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'pending'", b.id) ?? 0,
      },
    }));
}
export function archivedBusinesses(): Row[] {
  return q.all<Row>("SELECT id, name, settings FROM biz ORDER BY created_at").filter(isArchived)
    .map((b) => ({ id: b.id, name: b.name, archivedAt: b.settings?.archivedAt ?? null }));
}

/**
 * Tạo doanh nghiệp TRỐNG (giống `pnpm seed:fresh`, không đụng dữ liệu doanh nghiệp khác): DNA trống, đủ agent
 * (mức tự chủ mặc định), skill phòng Marketing, mẫu ads, bộ lịch nền. Giữ lựa chọn Claude của doanh nghiệp đang dùng.
 * Không có kết nối / kênh / dữ liệu mẫu — Sếp nạp DNA (tài liệu hoặc link website) và kết nối kênh cho doanh nghiệp này.
 */
export function createBusiness(name: string, actor: string, fromBizId?: string): Row {
  const from = fromBizId ? byId<Row>("biz", fromBizId) : undefined;
  const biz = tx(() => {
    const b = insert("biz", { name: name.trim(), timezone: from?.timezone ?? "Asia/Ho_Chi_Minh", currency: from?.currency ?? "VND", settings: { ...DEFAULT_SETTINGS, llm: { ...(from?.settings?.llm ?? DEFAULT_LLM), codexAccountId: null } } });
    insert("dna_profile", { biz_id: b.id, version: 1, status: "active", data: blankDna(), created_by: "doanh nghiệp mới (DNA trống)" });
    for (const c of CATALOG) {
      insert("agent_config", { biz_id: b.id, agent_key: c.key, autonomy: c.autonomy, enabled: 1, tools: c.tools, token_budget_run: 200_000, token_budget_day: c.tokenBudgetDay, limits: {} });
      if (!q.get("SELECT id FROM prompt_version WHERE agent_key = ? AND version = 1", c.key))
        insert("prompt_version", { agent_key: c.key, version: 1, body: `builtin:${c.key}`, rubric_version: 1, status: "active" });
    }
    insert("ad_template", { biz_id: b.id, name: "msg", platform: "meta", definition: { objective: "messages", destination: { type: "messenger" }, audience: { locations: ["VN"], ageMin: 25, ageMax: 55, interests: [] }, placements: "auto", budget: { type: "daily", amount: 500_000, currency: "VND" }, naming: "{date}_{page}_{postId}_{template}", cta: "MESSAGE_PAGE" } });
    insert("ad_template", { biz_id: b.id, name: "spark", platform: "tiktok", definition: { objective: "lead_generation", spark: true, audience: { locations: ["VN"], ageMin: 25, ageMax: 50 }, budget: { type: "daily", amount: 500_000, currency: "VND" }, naming: "{date}_{page}_{postId}_{template}" } });
    ensureBizSchedules(b.id);
    audit(b.id, actor, "business.created", { type: "biz", id: b.id }, { name: b.name, from: fromBizId ?? null });
    return b;
  });
  // Skill đọc từ ổ đĩa / trợ lý: lỗi không được làm hỏng việc tạo doanh nghiệp.
  try { syncSkills(biz.id, actor); } catch (e) { logger.warn("business.skills_sync_failed", { error: String(e) }); }
  try { ensureAssistantAgent(biz.id); } catch (e) { logger.warn("business.assistant_failed", { error: String(e) }); }
  return { id: biz.id, name: biz.name, created_at: biz.created_at };
}

export function renameBusiness(id: string, name: string, actor: string) {
  const b = byId<Row>("biz", id);
  if (!b || isArchived(b)) throw new AppError("NOT_FOUND", "Không thấy doanh nghiệp", 404);
  update("biz", id, { name: name.trim() });
  audit(id, actor, "business.renamed", { type: "biz", id }, { before: b.name, after: name.trim() });
  return { id, name: name.trim() };
}

/** Lưu trữ (KHÔNG xoá dữ liệu): ẩn khỏi bộ chọn, dừng lịch nền. Không lưu trữ được doanh nghiệp cuối cùng. */
export function archiveBusiness(id: string, actor: string) {
  const b = byId<Row>("biz", id);
  if (!b || isArchived(b)) throw new AppError("NOT_FOUND", "Không thấy doanh nghiệp", 404);
  if (activeBizIds().length <= 1) throw new AppError("LAST_BUSINESS", "Không thể lưu trữ doanh nghiệp cuối cùng", 400);
  update("biz", id, { settings: { ...(b.settings ?? {}), archived: true, archivedAt: nowIso() } });
  audit(id, actor, "business.archived", { type: "biz", id }, { name: b.name });
  return { ok: true, archived: id, current: defaultBizId() };
}
export function restoreBusiness(id: string, actor: string) {
  const b = byId<Row>("biz", id);
  if (!b || !isArchived(b)) throw new AppError("NOT_FOUND", "Không thấy doanh nghiệp đã lưu trữ", 404);
  const { archived: _a, archivedAt: _t, ...settings } = (b.settings ?? {}) as Row;
  update("biz", id, { settings });
  const schedules = ensureBizSchedules(id);
  audit(id, actor, "business.restored", { type: "biz", id }, { name: b.name, schedules });
  return { ok: true, id, name: b.name };
}
