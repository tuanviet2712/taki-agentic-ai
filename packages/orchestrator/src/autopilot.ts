import { z } from "zod";
import { activeDna, audit, bizSettings, byId, emit, isKilled, q, update, type Row } from "@dotaka/db";
import { AppError, logger, nowIso } from "@dotaka/shared";
import { linkCommentSettings } from "./link-product.ts";
import { createGoal } from "./runtime.ts";
import { decideApproval } from "./approvals.ts";
import { makeVideoFromScript, planVideoFromScript } from "./script-video.ts";
import { notifyTelegramChats } from "./telegram-assistant.ts";

/**
 * LÁI TỰ ĐỘNG (theo mẫu Affiliate Agentic AI, chỉnh cho doanh nghiệp đào tạo / dịch vụ):
 * Sếp cấu hình 1 lần → hệ thống tự giữ đủ "đường ống" nội dung cho từng nền tảng:
 *   khóa học / sản phẩm trong DNA (chia bài theo kết quả thật: đơn → lead → điểm bài)
 *   → chiến dịch "weekly_content" (brief → kế hoạch nội dung → bài / kịch bản) + khuôn hay từ Trinh sát nội dung
 *   → video (Video tự động miễn phí nếu chọn; Flow tốn tín dụng luôn chờ Sếp bấm) → SẾP DUYỆT ĐĂNG → đăng kênh chính
 *   → chấm điểm bài → đề xuất chạy ads bài thắng (chờ Sếp) → chăm khách / chat.
 * Chỉ NỐI các phần có sẵn (createGoal, schedulePublish, makeVideoFromScript, nurture) — không có đường tắt.
 * Không bao giờ vượt cổng ĐỎ: đăng công khai, chạy quảng cáo, sửa DNA/giá luôn chờ Sếp.
 */

export const AUTOPILOT_PLATFORMS = ["facebook", "instagram", "tiktok"] as const;
export type AutopilotPlatform = (typeof AUTOPILOT_PLATFORMS)[number];
/** Mỗi chiến dịch tự động lên kế hoạch 3 nội dung cho 1 nền tảng. */
export const CONTENT_PER_GOAL = 3;
/** Chiến dịch "đang làm" quá số ngày này mà chưa ra bài → coi là kẹt (không tính vào độ phủ, báo Sếp). */
const STALE_GOAL_DAYS = 3;
const DAY = 86400_000;
export const PLATFORM_NAME: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok" };

const PlatformCfg = z.object({ platform: z.enum(AUTOPILOT_PLATFORMS), postsPerDay: z.number().int().min(1, "Ít nhất 1 bài/ngày").max(5, "Tối đa 5 bài/ngày") });
export const AutopilotSettingsSchema = z.object({
  enabled: z.boolean(),
  platforms: z.array(PlatformCfg).max(3)
    .refine((a) => new Set(a.map((p) => p.platform)).size === a.length, "Mỗi nền tảng chỉ chọn 1 lần"),
  /** Key khóa học / sản phẩm (DNA) xoay vòng; rỗng = mọi sản phẩm trong DNA. */
  products: z.array(z.string().trim().min(1).max(64)).max(50),
  /** Giữ sẵn nội dung cho bao nhiêu ngày tới. */
  cadence: z.number().int().min(1).max(7),
  /** free_auto = kịch bản đạt + đã duyệt → Video tự động (miễn phí) tự làm; Flow (tốn tín dụng) luôn chờ Sếp bấm. */
  videoMode: z.enum(["free_auto", "suggest", "none"]),
  /** Lấy khuôn nội dung đang thắng của kênh đối thủ (Trinh sát nội dung, đã Decode) làm gợi ý cho chiến dịch. */
  useScout: z.boolean(),
  /** Kế hoạch nội dung (không có ngân sách ads) đạt chấm điểm → tự chạy tiếp, không chờ Sếp. */
  autoStrategy: z.boolean(),
  /** Bài / kịch bản của chiến dịch tự động LUÔN chờ Sếp duyệt (bỏ qua mức tự chủ của agent). */
  approvalGate: z.boolean(),
  postWhenApproved: z.enum(["next_slot", "now"]),
  /** Trần số chiến dịch tự tạo trong 24 giờ (cả mọi nền tảng). */
  maxGoalsPerDay: z.number().int().min(1).max(10),
  /** Báo Ngân Nguyệt trên Telegram khi mở chiến dịch mới / có việc cần Sếp. */
  notifyTelegram: z.boolean(),
  /** Tỉ trọng Sếp ghim cho từng khóa học (%, 0 = tạm không đăng); không ghim → chia tự động theo kết quả. */
  productWeights: z.record(z.string().trim().min(1).max(64), z.number().int().min(0).max(100)),
});
export type AutopilotSettings = z.infer<typeof AutopilotSettingsSchema>;
export const AutopilotSettingsPatch = AutopilotSettingsSchema.omit({ enabled: true }).partial();

export const AUTOPILOT_DEFAULTS: AutopilotSettings = {
  enabled: false,
  platforms: [{ platform: "facebook", postsPerDay: 1 }],
  products: [],
  cadence: 3,
  videoMode: "suggest",
  useScout: true,
  autoStrategy: true,
  approvalGate: true,
  postWhenApproved: "next_slot",
  maxGoalsPerDay: 3,
  notifyTelegram: true,
  productWeights: {},
};

export type Coverage = { target: number; scheduled: number; publishedToday: number; awaiting: number; inProduction: number; waitingVideo: number; total: number };
export type AutopilotRun = {
  at: string; ran: boolean; reason?: "disabled" | "killed" | "quiet" | "no_products" | "no_platforms";
  message: string; created: { goalId: string; title: string; platform: string; product: string; reason?: string; scout?: string }[];
  autoApproved: number; videosStarted: number; coverage: Record<string, Coverage>; capReached?: boolean;
};

const settingsRow = (bizId: string): Row => (q.get<Row>("SELECT settings FROM biz WHERE id = ?", bizId)?.settings ?? {}) as Row;
function writeSettings(bizId: string, patch: Row) {
  update("biz", bizId, { settings: { ...settingsRow(bizId), ...patch } });
}

export function autopilotSettings(bizId: string): AutopilotSettings {
  const saved = (settingsRow(bizId).autopilot ?? {}) as Partial<AutopilotSettings>;
  const ok = AutopilotSettingsSchema.safeParse({ ...AUTOPILOT_DEFAULTS, ...saved });
  return ok.success ? ok.data : { ...AUTOPILOT_DEFAULTS, enabled: Boolean(saved.enabled) };
}
export function autopilotState(bizId: string): { lastRun: AutopilotRun | null } {
  return { lastRun: (settingsRow(bizId).autopilotState?.lastRun ?? null) as AutopilotRun | null };
}

/** Lưu cấu hình (KHÔNG đổi bật/tắt — dùng setAutopilotEnabled). */
export function saveAutopilotSettings(bizId: string, patch: unknown, actor: string): AutopilotSettings {
  const p = AutopilotSettingsPatch.parse(patch);
  const next = AutopilotSettingsSchema.parse({ ...autopilotSettings(bizId), ...p });
  writeSettings(bizId, { autopilot: next });
  audit(bizId, actor, "autopilot.settings_changed", { type: "biz", id: bizId }, { changed: Object.keys(p) });
  emit(bizId, "autopilot.settings_changed", {});
  return next;
}

/** Bật / tạm dừng. Điều kiện trước khi bật kiểm ở API (autopilotPrerequisites) — hàm này chỉ ghi trạng thái. */
export function setAutopilotEnabled(bizId: string, enabled: boolean, actor: string): AutopilotSettings {
  const next = { ...autopilotSettings(bizId), enabled };
  writeSettings(bizId, { autopilot: next });
  audit(bizId, actor, enabled ? "autopilot.enabled" : "autopilot.paused", { type: "biz", id: bizId }, { platforms: next.platforms, cadence: next.cadence });
  emit(bizId, "autopilot.settings_changed", { enabled });
  return next;
}

// ---------------- Khóa học / sản phẩm xoay vòng ----------------
export function dnaProducts(bizId: string): Row[] {
  return ((activeDna(bizId)?.data?.products ?? []) as Row[])
    .map((p, i): Row => ({ ...p, key: String(p.key || p.name || `sp-${i + 1}`) }))
    .filter((p) => String(p.name ?? "").trim());
}
/** Khóa học Sếp chọn (theo thứ tự chọn); rỗng = mọi khóa học trong DNA. */
export function rotationProducts(bizId: string, s = autopilotSettings(bizId)): Row[] {
  const all = dnaProducts(bizId);
  if (!s.products.length) return all;
  return s.products.map((k) => all.find((p) => p.key === k)).filter(Boolean) as Row[];
}

// ---------------- Giờ VN ----------------
const vnDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const vnDayStart = (d: Date) => new Date(`${vnDate(d)}T00:00:00+07:00`);
export function inQuiet(bizId: string, d: Date) {
  const [start, end] = bizSettings(bizId).quietHours ?? [22, 7];
  const h = (d.getUTCHours() + 7) % 24;
  return start > end ? h >= start || h < end : h >= start && h < end;
}
/** Số tuần ISO (theo ngày VN) — dùng trong tên chiến dịch "tuần n". */
function isoWeek(d: Date): number {
  const t = new Date(`${vnDate(d)}T00:00:00Z`);
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - firstThu.getTime()) / DAY - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}

// ---------------- Chia bài theo kết quả ----------------
/**
 * Khóa học nào được nhiều bài hơn: điểm = đơn (doanh thu) mỗi bài → lead mỗi bài → điểm chấm bài trung bình → chia đều,
 * tính trên bài đã đăng THẬT (bỏ bài mô phỏng) của chiến dịch tự động trong 14 ngày (ít bài → 30 ngày).
 * Làm mượt (thêm 2 "bài ảo" ở mức trung bình) để 1 lead may mắn không nuốt hết bài; mỗi khóa học giữ sàn thăm dò ≥ 20%
 * (nhiều khóa thì ≥ 1/n); khóa mới được tăng; Sếp ghim tỉ trọng thì dùng đúng số đó (0% = tạm không đăng).
 */
export const ALLOC_WINDOW_DAYS = 14;
export const ALLOC_FALLBACK_DAYS = 30;
export const EXPLORE_FLOOR = 0.2;
export const STALE_PRODUCT_DAYS = 9;
const PRIOR_POSTS = 2;
const NEW_PRODUCT_DAYS = 7;

export type AllocMetric = "money" | "leads" | "score" | "none";
export interface ProductStat { key: string; name: string; posts: number; money: number; orders: number; leads: number; scoreSum: number; scored: number }
export interface Allocation extends ProductStat { share: number; mode: "manual" | "exploit" | "explore" | "new" | "even"; reason: string }
export interface AllocationPlan { window: number; metric: AllocMetric; products: Allocation[]; notes: string[] }

export function productStats(bizId: string, products: Row[], days: number, now = new Date()): ProductStat[] {
  const since = new Date(now.getTime() - days * DAY).toISOString();
  const minConf = bizSettings(bizId).attributionMinConfidence;
  const out = new Map<string, ProductStat>(products.map((p) => [String(p.key), { key: String(p.key), name: String(p.name ?? p.key), posts: 0, money: 0, orders: 0, leads: 0, scoreSum: 0, scored: 0 }]));
  const posts = q.all<Row>(`SELECT p.id, json_extract(g.params, '$.autopilot.product') product FROM post p
    JOIN content_item ci ON ci.id = p.content_item_id JOIN goal g ON g.id = ci.goal_id
    WHERE p.biz_id = ? AND p.published_at >= ? AND p.published_at <= ? AND COALESCE(p.simulated, 0) = 0
      AND json_extract(g.params, '$.autopilot.product') IS NOT NULL`, bizId, since, now.toISOString());
  for (const p of posts) {
    const st = out.get(String(p.product));
    if (!st) continue;
    st.posts++;
    const convs = q.all<Row>("SELECT DISTINCT conversation_id FROM attribution_link WHERE post_id = ? AND confidence >= ?", p.id, minConf).map((r) => r.conversation_id);
    if (convs.length) {
      const ph = convs.map(() => "?").join(",");
      st.leads += q.scalar<number>(`SELECT COUNT(*) FROM lead WHERE biz_id = ? AND conversation_id IN (${ph})`, bizId, ...convs) ?? 0;
      const o = q.get<Row>(`SELECT COUNT(*) n, COALESCE(SUM(total), 0) s FROM orders WHERE biz_id = ? AND conversation_id IN (${ph}) AND status NOT IN ('cancelled','refunded','returned')`, bizId, ...convs);
      st.orders += Number(o?.n ?? 0); st.money += Number(o?.s ?? 0);
    }
    const sc = q.get<Row>("SELECT score FROM post_score WHERE post_id = ? AND low_data = 0 ORDER BY computed_at DESC LIMIT 1", p.id);
    if (sc) { st.scoreSum += Number(sc.score); st.scored++; }
  }
  return [...out.values()];
}

const valueOf = (s: ProductStat, m: AllocMetric) => (m === "money" ? s.money : m === "leads" ? s.leads : m === "score" ? s.scoreSum : 0);
const unitsOf = (s: ProductStat, m: AllocMetric) => (m === "score" ? s.scored : s.posts);
const pctText = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (x: number) => (Math.round(x * 10) / 10).toLocaleString("vi-VN");
const vndText = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;

/** Chia tỉ trọng theo điểm, có sàn thăm dò (floor[i]) — bên chạm sàn được giữ ở sàn, phần còn lại chia theo điểm. */
export function sharesWithFloor(scores: number[], floors: number[]): { share: number[]; floored: boolean[] } {
  const n = scores.length;
  const share = new Array<number>(n).fill(0);
  const floored = new Array<boolean>(n).fill(false);
  if (!n) return { share, floored };
  const sumFloors = floors.reduce((a, b) => a + b, 0);
  if (sumFloors >= 1) return { share: floors.map((f) => f / sumFloors), floored: floored.fill(true) };
  for (let iter = 0; iter <= n; iter++) {
    const free = scores.map((_, i) => i).filter((i) => !floored[i]);
    const mass = 1 - floors.reduce((a, f, i) => a + (floored[i] ? f : 0), 0);
    const tot = free.reduce((a, i) => a + scores[i], 0);
    for (const i of free) share[i] = tot > 0 ? (mass * scores[i]) / tot : mass / free.length;
    for (let i = 0; i < n; i++) if (floored[i]) share[i] = floors[i];
    const below = free.filter((i) => share[i] < floors[i] - 1e-9);
    if (!below.length) break;
    for (const i of below) floored[i] = true;
  }
  return { share, floored };
}

/** Bức tranh chia bài (chỉ đọc): tỉ trọng + lý do từng khóa học. */
export function allocationPlan(bizId: string, products: Row[], weights: Record<string, number> = {}, now = new Date()): AllocationPlan {
  let window = ALLOC_WINDOW_DAYS;
  let stats = productStats(bizId, products, window, now);
  if (stats.reduce((a, s) => a + s.posts, 0) < 2 * Math.max(3, products.length)) {
    window = ALLOC_FALLBACK_DAYS;
    stats = productStats(bizId, products, window, now);
  }
  const tot = (f: (s: ProductStat) => number) => stats.reduce((a, s) => a + f(s), 0);
  const metric: AllocMetric = tot((s) => s.orders) >= 2 && tot((s) => s.money) > 0 ? "money"
    : tot((s) => s.leads) >= 3 ? "leads" : tot((s) => s.scored) >= 3 ? "score" : "none";
  const notes: string[] = [];

  const manual = stats.filter((s) => Number.isFinite(weights[s.key]));
  const auto = stats.filter((s) => !Number.isFinite(weights[s.key]));
  let manualSum = manual.reduce((a, s) => a + weights[s.key] / 100, 0);
  const manualScale = manualSum > 1 ? 1 / manualSum : 1;
  manualSum = Math.min(1, manualSum);
  const autoMass = auto.length ? 1 - manualSum : 0;
  if (!auto.length && manualSum < 1 && manualSum > 0) notes.push("Tổng tỉ trọng ghim chưa đủ 100% — chia lại theo tỉ lệ đã ghim");

  const totUnits = stats.reduce((a, s) => a + unitsOf(s, metric), 0);
  const mean = totUnits ? tot((s) => valueOf(s, metric)) / totUnits : 0;
  const firstGoal = (key: string) => q.get<Row>("SELECT MIN(created_at) at FROM goal WHERE biz_id = ? AND json_extract(params, '$.autopilot.product') = ?", bizId, key)?.at as string | null;
  const isNew = (s: ProductStat) => {
    if (s.posts > 0) return false;
    const at = firstGoal(s.key);
    return !at || now.getTime() - Date.parse(at) < NEW_PRODUCT_DAYS * DAY;
  };
  const rates = auto.map((s) => (metric === "none" ? 1 : (valueOf(s, metric) + PRIOR_POSTS * mean) / (unitsOf(s, metric) + PRIOR_POSTS)));
  const n = auto.length;
  const baseFloor = n ? Math.min(EXPLORE_FLOOR, 1 / n) : 0;
  const newFlags = auto.map(isNew);
  const floors = auto.map((_, i) => (newFlags[i] ? Math.max(baseFloor, Math.min(0.5, 1 / n)) : baseFloor));
  const { share, floored } = sharesWithFloor(rates, floors);
  const best = Math.max(0, ...auto.map((s, i) => (s.posts ? rates[i] : 0)));

  const perPost = (s: ProductStat) => {
    if (!s.posts) return "chưa có bài đăng";
    if (metric === "money") return `${vndText(s.money / s.posts)} doanh thu/bài`;
    if (metric === "leads") return `${fmt(s.leads / s.posts)} lead/bài`;
    if (metric === "score") return s.scored ? `điểm bài TB ${Math.round(s.scoreSum / s.scored)}` : "chưa có điểm bài";
    return `${s.posts} bài`;
  };
  const rows: Allocation[] = [];
  for (const s of manual) {
    const w = (weights[s.key] / 100) * manualScale;
    rows.push({ ...s, share: !auto.length && manualSum > 0 ? w / manualSum : w, mode: "manual",
      reason: weights[s.key] === 0 ? "Sếp ghim 0% — tạm không đăng" : `Sếp ghim ${weights[s.key]}%${metric !== "none" ? ` · ${perPost(s)}` : ""}` });
  }
  auto.forEach((s, i) => {
    let mode: Allocation["mode"]; let reason: string;
    if (newFlags[i] && floored[i]) { mode = "new"; reason = "Khóa học mới — đang thăm dò"; }
    else if (metric === "none") { mode = "even"; reason = `Chưa đủ số liệu ${window} ngày — chia đều`; }
    else if (floored[i]) { mode = "explore"; reason = `Đang thăm dò (giữ tối thiểu ${pctText(floors[i] * autoMass)}) · ${perPost(s)}`; }
    else if (s.posts && rates[i] >= best - 1e-9) { mode = "exploit"; reason = `Hiệu quả nhất ${window} ngày (${perPost(s)})`; }
    else { mode = "exploit"; reason = `${perPost(s)} trong ${window} ngày`; }
    rows.push({ ...s, share: share[i] * autoMass, mode, reason });
  });
  rows.sort((a, b) => products.findIndex((p) => p.key === a.key) - products.findIndex((p) => p.key === b.key));
  return { window, metric, products: rows, notes };
}

/**
 * Khóa học cho chiến dịch kế tiếp trên 1 nền tảng:
 *  1. Khóa (tỉ trọng > 0) lâu nhất chưa có chiến dịch tự động nào ≥ STALE_PRODUCT_DAYS (hoặc chưa từng) → chọn ngay.
 *  2. Còn lại: bên "thiếu phần" nhất so với tỉ trọng (tỉ trọng × tổng chiến dịch 14 ngày trên nền tảng − số đã có).
 */
export function pickProduct(bizId: string, platform: string, products: Row[], plan: AllocationPlan, now = new Date()): Row | undefined {
  const live = plan.products.filter((a) => a.share > 1e-9);
  if (!live.length) return undefined;
  const byKey = (k: string) => products.find((p) => p.key === k);
  const lastAt = (k: string) => q.get<Row>("SELECT MAX(created_at) at FROM goal WHERE biz_id = ? AND json_extract(params, '$.autopilot.product') = ?", bizId, k)?.at as string | null;
  const stale = live.map((a) => ({ a, at: lastAt(a.key) }))
    .filter((x) => !x.at || now.getTime() - Date.parse(x.at) >= STALE_PRODUCT_DAYS * DAY)
    .sort((x, y) => (x.at ? Date.parse(x.at) : 0) - (y.at ? Date.parse(y.at) : 0));
  if (stale.length) return byKey(stale[0].a.key);
  const since = new Date(now.getTime() - ALLOC_WINDOW_DAYS * DAY).toISOString();
  const counts = new Map(q.all<Row>(`SELECT json_extract(params, '$.autopilot.product') k, COUNT(*) n FROM goal WHERE biz_id = ?
    AND json_extract(params, '$.autopilot.platform') = ? AND created_at >= ? GROUP BY k`, bizId, platform, since).map((r) => [String(r.k), Number(r.n)]));
  const total = live.reduce((a, x) => a + (counts.get(x.key) ?? 0), 0) + 1;
  let best: Allocation | undefined; let bestGap = -Infinity;
  for (const a of live) {
    const gap = a.share * total - (counts.get(a.key) ?? 0);
    if (gap > bestGap + 1e-9) { best = a; bestGap = gap; }
  }
  return best ? byKey(best.key) : undefined;
}
export function autopilotAllocation(bizId: string, s = autopilotSettings(bizId), now = new Date()) {
  return allocationPlan(bizId, rotationProducts(bizId, s), s.productWeights, now);
}

// ---------------- Độ phủ đường ống ----------------
const DEAD = "('rejected','blocked','failed','cancelled','expired')";
/**
 * Nội dung đã/đang có cho 1 nền tảng trong `cadence` ngày tới: đã lên lịch + đã đăng hôm nay + chờ duyệt
 * + đang được agent viết + video đang dựng + kịch bản đã duyệt chờ làm video.
 */
export function pipelineCoverage(bizId: string, platform: string, s = autopilotSettings(bizId), now = new Date()): Coverage {
  const cfg = s.platforms.find((p) => p.platform === platform);
  const target = (cfg?.postsPerDay ?? 0) * s.cadence;
  const until = new Date(now.getTime() + s.cadence * DAY).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const scheduled = q.scalar<number>(`SELECT COUNT(*) FROM publish_job pj JOIN channel ch ON ch.id = pj.channel_id
    WHERE pj.biz_id = ? AND ch.platform = ? AND pj.mode != 'draft' AND pj.status IN ('scheduled','posting','verifying') AND pj.scheduled_at <= ?`, bizId, platform, until) ?? 0;
  const publishedToday = q.scalar<number>(`SELECT COUNT(*) FROM post p JOIN channel ch ON ch.id = p.channel_id
    WHERE p.biz_id = ? AND ch.platform = ? AND p.published_at >= ? AND COALESCE(p.simulated, 0) = 0`, bizId, platform, vnDayStart(now).toISOString()) ?? 0;
  // Bài/video đã viết xong nhưng chưa lên lịch (đang chấm, chờ Sếp duyệt, vừa duyệt) + kịch bản chưa duyệt — 7 ngày gần đây.
  const awaiting = q.scalar<number>(`SELECT COUNT(*) FROM content_item ci WHERE ci.biz_id = ? AND ci.channel = ? AND ci.created_at >= ?
    AND ((ci.kind != 'video_script' AND ci.status IN ('in_review','awaiting_approval','approved','draft_on_channel'))
      OR (ci.kind = 'video_script' AND ci.status IN ('in_review','awaiting_approval')))
    AND NOT EXISTS (SELECT 1 FROM publish_job pj WHERE pj.content_item_id = ci.id AND pj.mode != 'draft')`, bizId, platform, weekAgo) ?? 0;
  // Chiến dịch tự động đang chạy (chưa kẹt): số nội dung dự kiến chưa viết ra.
  let inProduction = 0;
  const goals = q.all<Row>(`SELECT id FROM goal WHERE biz_id = ? AND status = 'active' AND json_extract(params, '$.autopilot.platform') = ? AND created_at >= ?`,
    bizId, platform, new Date(now.getTime() - STALE_GOAL_DAYS * DAY).toISOString());
  for (const g of goals) {
    // Khâu nền (brief/kế hoạch) chết → chiến dịch không ra bài nữa: không tính "đang làm" (kẻo dừng tạo nội dung).
    if (q.scalar<number>(`SELECT COUNT(*) FROM task WHERE goal_id = ? AND agent_key IN ('brief','market_research','strategy') AND status IN ${DEAD}`, g.id)) continue;
    const strategy = q.get<Row>("SELECT status, output FROM task WHERE goal_id = ? AND agent_key = 'strategy'", g.id);
    const planned = strategy?.status === "done" ? Math.min(CONTENT_PER_GOAL, ((strategy.output?.contentPlan ?? []) as unknown[]).length) : CONTENT_PER_GOAL;
    const produced = q.scalar<number>("SELECT COUNT(DISTINCT task_id) FROM content_item WHERE goal_id = ? AND task_id IS NOT NULL", g.id) ?? 0;
    const dead = q.scalar<number>(`SELECT COUNT(*) FROM task t WHERE t.goal_id = ? AND t.agent_key IN ('content','video_script') AND t.status IN ${DEAD}
      AND NOT EXISTS (SELECT 1 FROM content_item ci WHERE ci.task_id = t.id)`, g.id) ?? 0;
    inProduction += Math.max(0, planned - produced - dead);
  }
  inProduction += q.scalar<number>(`SELECT COUNT(*) FROM creative_job WHERE biz_id = ? AND status IN ('queued','running') AND json_extract(input, '$.channels[0]') = ?`, bizId, platform) ?? 0;
  const waitingVideo = scriptsWaitingVideo(bizId, platform, now);
  const total = scheduled + publishedToday + awaiting + inProduction + waitingVideo;
  return { target, scheduled, publishedToday, awaiting, inProduction, waitingVideo, total };
}
/** Kịch bản video đã duyệt (14 ngày) chưa có video nào đang/đã làm từ nó. */
function scriptsWaitingVideo(bizId: string, platform: string | null, now = new Date()): number {
  return q.scalar<number>(`SELECT COUNT(*) FROM content_item ci WHERE ci.biz_id = ? AND ci.kind = 'video_script' AND ci.status = 'approved'
    ${platform ? "AND ci.channel = ?" : ""} AND ci.created_at >= ?
    AND NOT EXISTS (SELECT 1 FROM creative_job cj WHERE cj.source_content_id = ci.id AND cj.status NOT IN ('failed','cancelled','blocked'))`,
    ...[bizId, ...(platform ? [platform] : []), new Date(now.getTime() - 14 * DAY).toISOString()]) ?? 0;
}

// ---------------- Ý tưởng từ Trinh sát nội dung ----------------
/** Video đối thủ đã Decode, vượt trung vị kênh ≥ 2×, chưa chiến dịch tự động nào dùng — mới nhất trước. */
export function scoutIdea(bizId: string, platform: string): Row | null {
  const used = new Set(q.all<Row>("SELECT json_extract(params, '$.autopilot.scoutVideoId') v FROM goal WHERE biz_id = ? AND json_extract(params, '$.autopilot.scoutVideoId') IS NOT NULL", bizId).map((r) => String(r.v)));
  const rows = q.all<Row>(`SELECT * FROM research_video WHERE biz_id = ? AND decode IS NOT NULL AND COALESCE(multiple, 0) >= 2
    ORDER BY CASE WHEN platform = ? THEN 0 ELSE 1 END, COALESCE(decode_at, updated_at) DESC LIMIT 30`, bizId, platform);
  return rows.find((r) => !used.has(r.id)) ?? null;
}

// ---------------- Lưới an toàn: kế hoạch nội dung đạt chấm điểm ----------------
/**
 * Mục duyệt "Kế hoạch nội dung" (strategy) còn treo của chiến dịch tự động mà Review đã chấm "pass" → duyệt qua đúng
 * luồng decideApproval (lưới an toàn khi bật autoStrategy sau khi chiến dịch đã tạo). Không đụng bài/kịch bản/ads/đăng.
 */
export async function autoApproveStrategies(bizId: string): Promise<number> {
  if (!autopilotSettings(bizId).autoStrategy) return 0;
  const rows = q.all<Row>(`SELECT a.* FROM approval a JOIN task t ON t.id = a.subject_id JOIN goal g ON g.id = t.goal_id
    WHERE a.biz_id = ? AND a.status = 'pending' AND a.subject_type = 'task' AND t.agent_key = 'strategy' AND t.status = 'awaiting_approval'
      AND json_extract(g.params, '$.autopilot.key') IS NOT NULL AND g.budget_ads = 0`, bizId);
  let n = 0;
  for (const a of rows) {
    if (a.preview?.notPassed || a.preview?.escalated) continue;
    const review = a.review_score_id ? byId<Row>("review_score", a.review_score_id) : undefined;
    if (review?.verdict !== "pass") continue;
    try {
      await decideApproval(bizId, a.id, "approve", "Lái tự động: kế hoạch nội dung đã đạt chấm điểm Review", undefined, "autopilot");
      n++;
    } catch (e) {
      logger.warn("autopilot.auto_approve_failed", { approvalId: a.id, error: String(e) });
    }
  }
  return n;
}

// ---------------- Video tự động (miễn phí) ----------------
/** Kịch bản đã duyệt của chiến dịch tự động → Video tự động nếu không tốn tín dụng và đủ đầu vào. Flow luôn chờ Sếp. */
export function startFreeVideos(bizId: string, limit = 2): number {
  const rows = q.all<Row>(`SELECT ci.id FROM content_item ci JOIN goal g ON g.id = ci.goal_id
    WHERE ci.biz_id = ? AND ci.kind = 'video_script' AND ci.status = 'approved' AND json_extract(g.params, '$.autopilot.key') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM creative_job cj WHERE cj.source_content_id = ci.id AND cj.status NOT IN ('failed','cancelled','blocked'))
    ORDER BY ci.updated_at LIMIT 10`, bizId);
  let n = 0;
  for (const r of rows) {
    if (n >= limit) break;
    try {
      const plan = planVideoFromScript(bizId, r.id);
      if (plan.paidCredits || plan.missing.length || plan.job) continue;
      const res = makeVideoFromScript(bizId, r.id, "autopilot");
      if (!res.already) { n++; audit(bizId, "autopilot", "autopilot.video_started", { type: "content_item", id: r.id }, { jobId: res.jobId, tool: plan.tool }); }
    } catch (e) {
      logger.warn("autopilot.video_skip", { contentId: r.id, error: String(e) });
    }
  }
  return n;
}

// ---------------- Vòng chạy ----------------
const goalsCreatedSince = (bizId: string, since: Date, platform?: string) => q.scalar<number>(
  `SELECT COUNT(*) FROM goal WHERE biz_id = ? AND json_extract(params, '$.autopilot.key') IS NOT NULL AND created_at >= ?${platform ? " AND json_extract(params, '$.autopilot.platform') = ?" : ""}`,
  ...[bizId, since.toISOString(), ...(platform ? [platform] : [])]) ?? 0;

function recordRun(bizId: string, run: AutopilotRun) {
  writeSettings(bizId, { autopilotState: { lastRun: run } });
  emit(bizId, "autopilot.ran", { ran: run.ran, reason: run.reason ?? null, created: run.created.length });
  return run;
}

/**
 * 1 lượt lái tự động (lịch 15 phút + nút "Chạy ngay"): đo độ phủ từng nền tảng, thiếu thì tạo chiến dịch cho khóa học kế
 * tiếp. Không trùng: mỗi chiến dịch có khóa nền tảng+ngày+thứ tự; phần tạo chạy liền một mạch (không await giữa chừng).
 */
export async function autopilotTick(bizId: string, opts: { now?: Date; manual?: boolean; actor?: string } = {}): Promise<AutopilotRun> {
  const now = opts.now ?? new Date();
  const s = autopilotSettings(bizId);
  const base = { at: now.toISOString(), created: [] as AutopilotRun["created"], autoApproved: 0, videosStarted: 0, coverage: {} as Record<string, Coverage> };
  if (!s.enabled) return { ...base, ran: false, reason: "disabled", message: "Lái tự động đang tạm dừng" };
  if (isKilled(bizId, "publish")) {
    audit(bizId, "autopilot", "autopilot.skipped", { type: "biz", id: bizId }, { reason: "killed" });
    return recordRun(bizId, { ...base, ran: false, reason: "killed", message: "Đang bật Dừng khẩn cấp đăng bài — lái tự động không tạo thêm nội dung" });
  }
  if (!s.platforms.length) return recordRun(bizId, { ...base, ran: false, reason: "no_platforms", message: "Chưa chọn nền tảng đăng" });
  if (!opts.manual && inQuiet(bizId, now)) return recordRun(bizId, { ...base, ran: false, reason: "quiet", message: "Giờ yên lặng — lượt sau sẽ chạy tiếp" });
  const products = rotationProducts(bizId, s);
  if (!products.length) {
    emit(bizId, "alert.raised", { level: "warning", text: "Lái tự động: DNA chưa có khóa học / sản phẩm nào — thêm ở Mục tiêu & DNA.", href: "/dna" });
    return recordRun(bizId, { ...base, ran: false, reason: "no_products", message: "DNA chưa có khóa học / sản phẩm để xoay vòng" });
  }

  const autoApproved = await autoApproveStrategies(bizId);
  const videosStarted = s.videoMode === "free_auto" ? startFreeVideos(bizId) : 0;

  // Từ đây đến hết phần tạo: đồng bộ (không await) → 2 lượt chạy cùng lúc không thể tạo trùng.
  const created: AutopilotRun["created"] = [];
  const coverage: Record<string, Coverage> = {};
  let today = goalsCreatedSince(bizId, new Date(now.getTime() - DAY));
  let capReached = false;
  const dayStart = vnDayStart(now);
  const plan = allocationPlan(bizId, products, s.productWeights, now);
  for (const { platform } of s.platforms) {
    let cov = pipelineCoverage(bizId, platform, s, now);
    while (cov.total < cov.target) {
      if (today >= s.maxGoalsPerDay) { capReached = true; break; }
      const seq = goalsCreatedSince(bizId, dayStart, platform) + 1;
      const key = `${platform}:${vnDate(now)}:${seq}`;
      if (q.get("SELECT id FROM goal WHERE biz_id = ? AND json_extract(params, '$.autopilot.key') = ?", bizId, key)) break; // đã có (idempotent)
      const product = pickProduct(bizId, platform, products, plan, now);
      if (!product) break; // Sếp ghim 0% cho mọi khóa học
      const idea = s.useScout ? scoutIdea(bizId, platform) : null;
      const goal = createAutopilotGoal(bizId, product, platform, key, s, now, idea);
      const why = plan.products.find((a) => a.key === product.key);
      created.push({ goalId: goal.id, title: goal.title, platform, product: String(product.name), ...(why ? { reason: why.reason } : {}), ...(idea ? { scout: String(idea.decode?.cloneTitle || idea.title || "") } : {}) });
      today++;
      cov = pipelineCoverage(bizId, platform, s, now);
    }
    coverage[platform] = cov;
  }
  const message = created.length
    ? `Đã mở ${created.length} chiến dịch: ${created.map((c) => c.title).join(" · ")}`
    : capReached ? `Đã chạm trần ${s.maxGoalsPerDay} chiến dịch/ngày — chờ ngày mai` : "Đường ống đủ nội dung — không cần tạo thêm";
  audit(bizId, opts.actor ?? "autopilot", "autopilot.tick", { type: "biz", id: bizId }, { created: created.length, autoApproved, videosStarted, capReached, manual: Boolean(opts.manual) });
  const run = recordRun(bizId, { at: now.toISOString(), ran: true, message, created, autoApproved, videosStarted, coverage, capReached });
  if (s.notifyTelegram && created.length) void notifyCreated(bizId, run);
  return run;
}

async function notifyCreated(bizId: string, run: AutopilotRun) {
  const pending = q.scalar<number>("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'pending'", bizId) ?? 0;
  const lines = [
    `🛫 **Lái tự động** vừa mở ${run.created.length} chiến dịch nội dung:`,
    ...run.created.map((c) => `• ${c.title}${c.reason ? ` — ${c.reason}` : ""}${c.scout ? `\n   khuôn tham khảo: ${c.scout}` : ""}`),
    "",
    pending ? `Hiện có ${pending} mục chờ Sếp duyệt (bài/kịch bản chỉ đăng sau khi Sếp duyệt).` : "Bài/kịch bản làm xong sẽ chờ Sếp duyệt trước khi đăng.",
  ];
  await notifyTelegramChats(bizId, lines.join("\n")).catch((e) => logger.warn("autopilot.notify_failed", { error: String(e) }));
}

function createAutopilotGoal(bizId: string, product: Row, platform: AutopilotPlatform, key: string, s: AutopilotSettings, now: Date, idea: Row | null) {
  const name = PLATFORM_NAME[platform];
  const week = isoWeek(now);
  const title = `Tự động · ${product.name} · ${name} · tuần ${week}`;
  const dna = activeDna(bizId)?.data ?? {};
  const videoHint = platform === "tiktok" ? "TikTok: mọi nội dung là video ngắn (kịch bản)."
    : s.videoMode === "none" ? "Chỉ làm bài viết + ảnh (không làm video)." : "Kết hợp bài viết và 1 video ngắn (reel).";
  const d = idea?.decode as Row | undefined;
  const scout = d ? [
    `KHUÔN THAM KHẢO từ Trinh sát nội dung (video đối thủ vượt ${Math.round(Number(idea!.multiple) * 10) / 10}× trung vị kênh — CHỈ học khuôn, không chép nội dung):`,
    `hook dạng "${d.hookType}" (${d.hookText}); định dạng ${d.format}; cấu trúc: ${(d.structure ?? []).join(" → ")};`,
    `vì sao thắng: ${d.whyItWorks}; ý tưởng phiên bản của mình: ${d.cloneTitle} — ${d.cloneIdea}. Lưu ý: ${d.cautions}`,
  ].join(" ") : "";
  const description = [
    `Lái tự động: ${CONTENT_PER_GOAL} nội dung giới thiệu "${product.name}" trên ${name} (kênh đăng chính), không chạy quảng cáo.`,
    product.summary ? `Điểm chính: ${product.summary}.` : "",
    product.audience ? `Đối tượng: ${product.audience}.` : "",
    product.price ? `Học phí/giá: ${Number(product.price).toLocaleString("vi-VN")}đ (chỉ dùng nếu DNA đã xác nhận).` : "",
    dna.leadMagnet ? `Cửa vào cho khách: ${dna.leadMagnet}.` : "",
    // Facebook + tự gắn link: link nằm ở bình luận đầu tiên (hệ thống tự gắn sau khi đăng) → trong bài chỉ nhắc, không dán link.
    platform === "facebook" && (product.shortLink || product.link) && linkCommentSettings(bizId).auto
      ? "Chốt bằng: link sản phẩm đặt ở BÌNH LUẬN ĐẦU TIÊN (hệ thống tự gắn sau khi đăng) — trong bài chỉ nhắc \"link ở bình luận\", KHÔNG dán link vào bài."
      : `Chốt bằng: ${product.link ? `link ${product.link}` : dna.cta?.text ? dna.cta.text : "mời khách nhắn tin / để lại SĐT để được tư vấn"}.`,
    videoHint,
    scout,
  ].filter(Boolean).join(" ");
  const params = {
    autopilot: {
      key, platform, product: product.key, week, videoMode: s.videoMode, contentCount: CONTENT_PER_GOAL,
      autoStrategy: s.autoStrategy, gate: s.approvalGate, scoutVideoId: idea?.id ?? null, createdAt: nowIso(),
    },
  };
  const goal = createGoal(bizId, { title, description, template: "weekly_content", budgetAds: 0, contentCount: CONTENT_PER_GOAL, params }, "autopilot");
  audit(bizId, "autopilot", "autopilot.goal_created", { type: "goal", id: goal.id }, { key, platform, product: product.key, scout: idea?.id ?? null });
  emit(bizId, "autopilot.goal_created", { goalId: goal.id, title, platform });
  return { ...goal, title };
}

// ---------------- Đăng khi Sếp duyệt ----------------
/**
 * Tuỳ chọn cho schedulePublish khi bài vừa được duyệt (cổng ĐỎ đã qua): bài của chiến dịch tự động + chế độ "đăng ngay"
 * → đăng luôn, trừ giờ yên lặng hoặc kênh đã đủ trần bài/ngày (khi đó về khung giờ kế tiếp như thường).
 */
export function autopilotPublishOpts(bizId: string, contentItemId: string, now = new Date()): { now?: boolean } {
  const s = autopilotSettings(bizId);
  if (!s.enabled || s.postWhenApproved !== "now") return {};
  const ci = byId<Row>("content_item", contentItemId);
  const goal = ci?.goal_id ? byId<Row>("goal", ci.goal_id) : undefined;
  if (!ci || !goal?.params?.autopilot) return {};
  if (inQuiet(bizId, now)) return {};
  const cap = bizSettings(bizId).caps.maxPostsPerDayPerChannel;
  const sent = q.scalar<number>(`SELECT COUNT(*) FROM publish_job pj JOIN channel ch ON ch.id = pj.channel_id
    WHERE pj.biz_id = ? AND ch.platform = ? AND pj.mode != 'draft' AND pj.scheduled_at >= ?`, bizId, ci.channel, new Date(now.getTime() - DAY).toISOString()) ?? 0;
  return sent < cap ? { now: true } : {};
}

// ---------------- Bức tranh toàn chuỗi (trang Lái tự động) ----------------
export type StageNeed = { text: string; href: string } | null;
export type Stage = { key: string; title: string; href: string; count: number; label: string; detail: string; need: StageNeed };

/** Đếm sống từng khâu của chuỗi + "cần Sếp làm gì" khi khâu bị chặn. Chỉ đọc. */
export function autopilotPipeline(bizId: string, now = new Date()): Stage[] {
  const s = autopilotSettings(bizId);
  const dayStart = vnDayStart(now).toISOString();
  const n = (sql: string, ...a: unknown[]) => q.scalar<number>(sql, bizId, ...a) ?? 0;
  const stages: Stage[] = [];

  // 1. Khóa học
  const all = dnaProducts(bizId);
  const rot = rotationProducts(bizId, s);
  stages.push({ key: "products", title: "Khóa học / sản phẩm", href: "/dna", count: rot.length, label: "đang xoay vòng",
    detail: `${all.length} trong DNA${s.products.length ? ` · Sếp chọn ${s.products.length}` : " · dùng tất cả"}`,
    need: !rot.length ? { text: "Thêm khóa học / sản phẩm vào DNA", href: "/dna" } : null });

  // 2. Kế hoạch
  const auto = n("SELECT COUNT(*) FROM goal WHERE biz_id = ? AND status = 'active' AND json_extract(params, '$.autopilot.key') IS NOT NULL");
  const active = n("SELECT COUNT(*) FROM goal WHERE biz_id = ? AND status = 'active'");
  const stuck = n("SELECT COUNT(*) FROM task t JOIN goal g ON g.id = t.goal_id WHERE t.biz_id = ? AND g.status = 'active' AND t.status IN ('failed','blocked')");
  const planWait = n(`SELECT COUNT(*) FROM approval a JOIN task t ON t.id = a.subject_id WHERE a.biz_id = ? AND a.status = 'pending' AND a.subject_type = 'task' AND t.agent_key = 'strategy'`);
  stages.push({ key: "plan", title: "Kế hoạch", href: "/plan", count: active, label: "chiến dịch đang chạy", detail: `${auto} do lái tự động mở${planWait ? ` · ${planWait} kế hoạch chờ duyệt` : ""}`,
    need: stuck ? { text: `${stuck} khâu bị lỗi/chặn — mở Kế hoạch bấm Chạy lại`, href: "/plan" }
      : planWait ? { text: `Duyệt ${planWait} kế hoạch nội dung`, href: "/approvals" } : null });

  // 3. Nội dung
  const writing = n("SELECT COUNT(*) FROM task WHERE biz_id = ? AND agent_key IN ('content','video_script') AND status IN ('ready','running','in_review','revising')");
  const contentWait = n(`SELECT COUNT(*) FROM approval a JOIN task t ON t.id = a.subject_id WHERE a.biz_id = ? AND a.status = 'pending' AND a.subject_type = 'task' AND t.agent_key IN ('content','video_script')`);
  stages.push({ key: "content", title: "Bài & kịch bản", href: "/content", count: writing, label: "đang viết", detail: contentWait ? `${contentWait} bản chờ Sếp duyệt` : "Không có bản chờ duyệt",
    need: contentWait ? { text: `Duyệt ${contentWait} bài / kịch bản (duyệt = cho phép đăng)`, href: "/approvals" } : null });

  // 4. Sản xuất video
  const making = n("SELECT COUNT(*) FROM creative_job WHERE biz_id = ? AND status IN ('queued','running')");
  const waiting = scriptsWaitingVideo(bizId, null, now);
  const mode = s.videoMode === "free_auto" ? "Video tự động miễn phí tự chạy · Flow chờ Sếp" : s.videoMode === "suggest" ? "Kịch bản chờ Sếp bấm Tạo video" : "Không làm video";
  stages.push({ key: "video", title: "Sản xuất video", href: "/video-flow", count: making, label: "video đang làm", detail: `${waiting} kịch bản chờ làm video · ${mode}`,
    need: waiting && s.videoMode !== "none" ? { text: `${waiting} kịch bản đã duyệt chờ làm video`, href: "/video-flow" } : null });

  // 5. Duyệt đăng video (cổng ĐỎ — luôn là Sếp)
  const videoWait = n("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND subject_type = 'creative_job' AND status = 'pending'");
  const allWait = n("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'pending'");
  stages.push({ key: "approvals", title: "Duyệt video", href: "/approvals", count: videoWait, label: "video chờ Sếp duyệt", detail: `${allWait} mục chờ duyệt tất cả`,
    need: videoWait ? { text: `Xem & duyệt ${videoWait} video`, href: "/approvals" } : null });

  // 6. Đăng bài
  const scheduled = n("SELECT COUNT(*) FROM publish_job WHERE biz_id = ? AND mode != 'draft' AND status = 'scheduled'");
  const pubToday = n("SELECT COUNT(*) FROM post WHERE biz_id = ? AND published_at >= ? AND COALESCE(simulated, 0) = 0", dayStart);
  const broken = n("SELECT COUNT(*) FROM publish_job WHERE biz_id = ? AND status IN ('needs_check','failed','needs_setup') AND updated_at >= ?", new Date(now.getTime() - 3 * DAY).toISOString());
  stages.push({ key: "publish", title: "Đăng bài", href: "/publish", count: scheduled, label: "bài đã lên lịch", detail: `${pubToday} bài đăng thật hôm nay`,
    need: broken ? { text: `${broken} lượt đăng lỗi / cần kiểm tra`, href: "/publish" } : null });

  // 7. Quảng cáo bài thắng (đề xuất — Sếp quyết)
  const adWait = n("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND subject_type = 'ad_candidate' AND status = 'pending'");
  const boosted = n("SELECT COUNT(*) FROM ad_candidate WHERE biz_id = ? AND status IN ('published','publishing') AND updated_at >= ?", new Date(now.getTime() - 7 * DAY).toISOString());
  stages.push({ key: "ads", title: "Ads bài thắng", href: "/approvals", count: adWait, label: "đề xuất chạy ads", detail: `${boosted} bài đã đẩy ads 7 ngày · bài điểm ≥ ${bizSettings(bizId).postScoreThreshold} được đề xuất`,
    need: adWait ? { text: `Xem ${adWait} đề xuất chạy ads bài thắng`, href: "/approvals" } : null });

  // 8. Chăm khách & chat
  const comments = n("SELECT COUNT(*) FROM post_comment WHERE biz_id = ? AND created_at >= ? AND COALESCE(label_source, '') != 'system'", dayStart);
  const leads = n("SELECT COUNT(*) FROM lead WHERE biz_id = ? AND created_at >= ?", dayStart);
  const handoff = n("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND state = 'handoff_pending'");
  stages.push({ key: "nurture", title: "Chăm khách & lead", href: "/chat", count: leads, label: "lead mới hôm nay", detail: `${comments} bình luận hôm nay`,
    need: handoff ? { text: `${handoff} khách cần tư vấn viên`, href: "/chat" } : null });
  return stages;
}

/** Lượt chạy kế tiếp theo lịch nền "autopilot.tick". */
export function autopilotNextTick(bizId: string): string | null {
  const sch = q.get<Row>("SELECT * FROM schedule WHERE biz_id = ? AND name = 'autopilot.tick'", bizId);
  if (!sch || !sch.enabled) return null;
  const last = sch.last_run_at ? Date.parse(sch.last_run_at) : Date.now();
  return new Date(Math.max(Date.now(), last + sch.every_minutes * 60_000)).toISOString();
}

export function assertAutopilotEnabled(bizId: string) {
  if (!autopilotSettings(bizId).enabled) throw new AppError("AUTOPILOT_OFF", "Lái tự động đang tạm dừng — bấm Bật lái tự động trước");
}

export const AUTOPILOT_HANDLERS = {
  "autopilot.tick": async (p: Row) => void (await autopilotTick(p.bizId)),
};
