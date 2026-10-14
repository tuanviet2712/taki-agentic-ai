import { z } from "zod";
import { activeDna, audit, bizSettings, byId, emit, insert, isKilled, q, update, type Row } from "@dotaka/db";
import { ConnectorError, live, type FeedComment } from "@dotaka/connectors";
import { applyBannedChars, configureNurtureHook, conversationOptedOut, findOptOut, sendBotMessage, type OptOutKey } from "@dotaka/chat-engine";
import { AppError, decryptSecret, encryptSecret, extractVnPhone, logger, maskPhone, normalizeVnPhone, nowIso } from "@dotaka/shared";
import { connectorForChannel, credsOf } from "./connections.ts";
import { fixUrl } from "./link-product.ts";
import { trackedUrlFor } from "./tracking.ts";
import { classifyComments } from "./publishing.ts";
import { enqueue, type Handler } from "./queue.ts";
import { activeZl, planFollowUp, zaloSettings } from "./zalo-followup.ts";

/**
 * Chăm khách từ bình luận Facebook — nối tiếp sau khi đăng bài (port từ AI Affiliate OS, bỏ affiliate/mô phỏng):
 *
 *   bình luận (webhook feed / quét định kỳ) → Jev phân loại (purchase_intent, question…)
 *     → trả lời công khai dưới bình luận (mẫu xoay vòng)            [steps.replyComment]
 *     → Private Reply vào inbox, hỏi SĐT/Zalo (+ link chương trình)  [steps.privateReply/askContact]
 *     → khách trả lời Messenger → bắt SĐT, xác nhận (chat-engine hook) / nhắc 1 lần nếu chưa cho
 *     → ZL-CRM: tìm Zalo theo SĐT + gửi lời mời kết bạn kèm lời chào   [steps.zaloFriend]
 *     → khách đồng ý → hội thoại Zalo + follow_up_plan (follow-up Zalo sẵn có, vẫn theo luật duyệt) [steps.zaloFollowUp]
 *
 * Mọi bước idempotent (cột thời điểm trên nurture_lead + khóa idempotency của connector/queue) nên thử lại / khởi
 * động lại không gửi trùng. Luật: kill switch "chat", giờ yên lặng của biz, hạn mức/ngày, mỗi người 1 lần/bài,
 * bỏ spam/tiêu cực. SĐT lưu mã hoá; nhật ký/audit chỉ ghi số đã che.
 *
 * Stage: new → (replied | asked_contact | dm_sent) → has_phone → friend_requesting → friend_requested → friend_accepted
 *   → following_up → ordered; nhánh dừng: skipped, failed, no_response, no_zalo, stopped,
 *   needs_check ("Cần Sếp kiểm tra" — không chắc đã gửi trả lời/inbox; hệ thống KHÔNG tự gửi lại).
 *   awaiting_review ("Chờ Sếp duyệt" — chế độ duyệt trước N khách đầu: đã soạn sẵn câu trả lời + tin inbox, CHƯA gửi,
 *   chưa giữ chỗ; Sếp duyệt ở hộp Duyệt → gửi đúng đường thường; từ chối → skipped).
 *
 * Khách trong danh sách "không nhận tin" (contact_optout) không bao giờ được trả lời/nhắn/nhắc/kết bạn tự động.
 *
 * Bật/tắt + hạn mức theo nền tảng (`platforms`, `capsFor`): hiện CHỈ Facebook có connector. Phần Instagram giữ lại cho đủ khung
 * (mặc định TẮT, bản này không có connector Instagram → không kênh Instagram nào được quét/gửi).
 *
 * Chỉ chạy THẬT: Fanpage có page token (kết nối live) + ZL-CRM live. Không có thì báo rõ, không giả kết quả.
 */
export const NURTURE_PLATFORMS = ["facebook", "instagram"] as const;
export type NurturePlatform = (typeof NURTURE_PLATFORMS)[number];
export const isNurturePlatform = (p: unknown): p is NurturePlatform => NURTURE_PLATFORMS.includes(p as NurturePlatform);
/** Tên hiển thị nền tảng (nhật ký / thông báo cho Sếp). */
export const platformLabel = (p: unknown) => (p === "instagram" ? "Instagram" : "Facebook");
export const NURTURE_DEFAULTS = {
  enabled: false, // Sếp bật ở trang "Chăm khách từ bình luận" (trả lời công khai = gần cổng ĐỎ)
  steps: { replyComment: true, privateReply: true, askContact: true, zaloFriend: true, zaloFollowUp: true },
  /** Nhãn bình luận được chăm: mặc định MỌI bình luận thật (muốn mua / hỏi / khen). Spam và chê KHÔNG BAO GIỜ được trả lời tự động. */
  labels: ["purchase_intent", "question", "praise"] as string[],
  /** true = trả lời + inbox ngay cả ban đêm (bỏ qua giờ yên lặng của doanh nghiệp). Kết bạn Zalo / nhắc SĐT vẫn theo giờ yên lặng. */
  replyAllDay: true,
  /** Lúc bật chăm khách (hệ tự ghi): bình luận viết TRƯỚC lúc này và quá 24 giờ thì bỏ (quét bù); bình luận viết SAU lúc này luôn được trả lời (trong 7 ngày của Private Reply). */
  enabledAt: null as string | null,
  replyTemplates: [
    "Dạ em đã inbox {ten} rồi ạ, {ten} kiểm tra tin nhắn giúp em nhé!",
    "Em vừa nhắn riêng cho {ten} thông tin {san_pham} rồi ạ, {ten} xem tin nhắn chờ giúp em nha.",
    "Dạ {ten} ơi, em gửi thông tin chi tiết qua tin nhắn rồi ạ.",
    "Cảm ơn {ten} đã quan tâm ạ! Em đã inbox, {ten} kiểm tra tin nhắn giúp em nhé.",
    "Em gửi tin nhắn cho {ten} rồi ạ, có gì {ten} cứ nhắn em nhé!",
  ] as string[],
  dmTemplates: [
    "Chào {ten}, em gửi {ten} thông tin {san_pham} ạ. Chi tiết tại: {link}\n{ten} để lại SĐT hoặc Zalo để bên em tư vấn kỹ hơn cho mình nhé!",
    "Dạ em chào {ten} ạ! Cảm ơn {ten} đã quan tâm {san_pham}. Thông tin chi tiết: {link}\n{ten} cho em xin SĐT/Zalo để bên em tư vấn kỹ hơn cho mình nha.",
    "Chào {ten} ạ, em nhận được bình luận của {ten} về {san_pham} rồi. Chi tiết: {link}\n{ten} để lại số điện thoại/Zalo giúp em, bên em gọi tư vấn và gửi ưu đãi phù hợp nhé!",
  ] as string[],
  confirmTemplate: "Dạ em đã nhận SĐT của {ten} rồi ạ. Bên em sẽ kết bạn Zalo với {ten} để gửi thông tin {san_pham} nhé!",
  reminderTemplate: "Dạ {ten} ơi, {ten} để lại giúp em SĐT hoặc Zalo để bên em tư vấn kỹ về {san_pham} nhé ạ!",
  friendGreetingTemplates: [
    "Chào {ten}, em bên {shop} ạ. Em kết bạn để gửi {ten} thông tin {san_pham} như đã hẹn qua Messenger nhé!",
    "Dạ em bên {shop} chào {ten} ạ, em gửi lời mời kết bạn để tư vấn {san_pham} cho {ten} nha!",
  ] as string[],
  /** Khách đã trả lời inbox mà chưa cho SĐT: nhắc 1 lần sau N giờ (vẫn trong cửa sổ 24h của Messenger). */
  reminderAfterHours: 4,
  /** Quá N giờ không có SĐT (sau khi nhắn/nhắc) → dừng chăm. */
  giveUpAfterHours: 48,
  maxPublicRepliesPerDay: 300,
  maxPrivateRepliesPerDay: 200,
  maxFriendRequestsPerNickPerDay: 20,
  /** Giãn cách ngẫu nhiên trước khi gửi lời mời kết bạn (phút) — tránh Zalo coi là spam. */
  friendDelayMinMinutes: 3,
  friendDelayMaxMinutes: 20,
  /** Nick Zalo (ZL-CRM zaloAccountId) dùng để kết bạn; trống = nick đầu tiên. */
  zaloAccountId: null as string | null,
  /** Chế độ duyệt trước: N khách đầu tiên sau khi bật, mỗi lượt trả lời + inbox chờ Sếp duyệt (0 = tắt). */
  reviewFirst: 10,
  /** Đã duyệt bao nhiêu khách (hệ tự đếm; đủ reviewFirst thì chạy tự động). */
  reviewApproved: 0,
  /** Bật theo nền tảng: Facebook như trước; Instagram mặc định TẮT (chưa có connector Instagram trong bản này). */
  platforms: { facebook: true, instagram: false } as Record<NurturePlatform, boolean>,
  /** Hạn mức riêng của Instagram (chặt hơn Facebook). Facebook dùng 2 hạn mức ở trên. */
  instagram: { maxPublicRepliesPerDay: 40, maxPrivateRepliesPerDay: 30 },
};
export type NurtureSettings = typeof NURTURE_DEFAULTS;

const tplList = z.array(z.string().trim().min(3).max(600)).min(1).max(10);
export const NurtureSettingsPatch = z.object({
  enabled: z.boolean(),
  steps: z.object({ replyComment: z.boolean(), privateReply: z.boolean(), askContact: z.boolean(), zaloFriend: z.boolean(), zaloFollowUp: z.boolean() }).partial(),
  labels: z.array(z.enum(["purchase_intent", "question", "praise"])).min(1),
  replyTemplates: tplList, dmTemplates: tplList, friendGreetingTemplates: tplList,
  confirmTemplate: z.string().trim().min(3).max(600), reminderTemplate: z.string().trim().min(3).max(600),
  reminderAfterHours: z.number().min(0.5).max(23), giveUpAfterHours: z.number().min(6).max(24 * 14),
  maxPublicRepliesPerDay: z.number().int().min(0).max(500), maxPrivateRepliesPerDay: z.number().int().min(0).max(500),
  maxFriendRequestsPerNickPerDay: z.number().int().min(0).max(60),
  friendDelayMinMinutes: z.number().min(0).max(240), friendDelayMaxMinutes: z.number().min(0).max(24 * 60),
  zaloAccountId: z.string().min(1).nullable(),
  reviewFirst: z.number().int().min(0).max(100),
  replyAllDay: z.boolean(),
  platforms: z.object({ facebook: z.boolean(), instagram: z.boolean() }).partial(),
  instagram: z.object({ maxPublicRepliesPerDay: z.number().int().min(0).max(200), maxPrivateRepliesPerDay: z.number().int().min(0).max(200) }).partial(),
}).partial();

export function nurtureSettings(bizId: string): NurtureSettings {
  const saved = ((bizSettings(bizId) as unknown as Row).nurture ?? {}) as Partial<NurtureSettings>;
  const out = { ...NURTURE_DEFAULTS, ...saved, ...mergeNested(NURTURE_DEFAULTS, saved) };
  // Doanh nghiệp đã BẬT từ trước khi có chế độ duyệt trước → coi như đã duyệt xong (không tự dưng dừng luồng đang chạy).
  if (saved.reviewApproved === undefined && saved.enabled) out.reviewApproved = out.reviewFirst;
  return out;
}
/** Các nhóm cài đặt lồng nhau (bước, nền tảng, hạn mức Instagram): gộp từng khoá, không ghi đè cả nhóm. */
function mergeNested(base: NurtureSettings, p: Partial<NurtureSettings>) {
  return {
    steps: { ...base.steps, ...(p.steps ?? {}) },
    platforms: { ...base.platforms, ...(p.platforms ?? {}) },
    instagram: { ...base.instagram, ...(p.instagram ?? {}) },
  };
}
/** Hạn mức/ngày theo nền tảng của kênh (mỗi kênh đếm riêng). */
export function capsFor(s: NurtureSettings, platform: unknown) {
  return platform === "instagram"
    ? { publicReplies: s.instagram.maxPublicRepliesPerDay, privateReplies: s.instagram.maxPrivateRepliesPerDay }
    : { publicReplies: s.maxPublicRepliesPerDay, privateReplies: s.maxPrivateRepliesPerDay };
}
export function saveNurtureSettings(bizId: string, patch: unknown, actor: string): NurtureSettings {
  const p = NurtureSettingsPatch.parse(patch);
  const cur = nurtureSettings(bizId);
  const next: NurtureSettings = { ...cur, ...p, ...mergeNested(cur, p as Partial<NurtureSettings>) } as NurtureSettings;
  next.reviewApproved = cur.reviewApproved; // bộ đếm do hệ tự tăng khi Sếp duyệt — không nhận từ form
  next.enabledAt = cur.enabledAt; // hệ tự ghi, không nhận từ form
  if (p.enabled === true && !cur.enabled) next.enabledAt = nowIso();
  if (next.friendDelayMaxMinutes < next.friendDelayMinMinutes) next.friendDelayMaxMinutes = next.friendDelayMinMinutes;
  const biz = q.get<Row>("SELECT settings FROM biz WHERE id = ?", bizId);
  update("biz", bizId, { settings: { ...(biz?.settings ?? {}), nurture: next } });
  audit(bizId, actor, "nurture.settings_changed", { type: "biz", id: bizId }, { changed: Object.keys(p) });
  return next;
}

// ---------------- Chế độ duyệt trước (N khách đầu) ----------------
export function reviewActive(s: NurtureSettings) {
  return s.reviewFirst > 0 && s.reviewApproved < s.reviewFirst;
}
/** Trạng thái hiển thị: còn bao nhiêu khách cần Sếp duyệt, đang chờ duyệt mấy mục. */
export function nurtureReviewStatus(bizId: string) {
  const s = nurtureSettings(bizId);
  return {
    active: reviewActive(s), first: s.reviewFirst, approved: Math.min(s.reviewApproved, s.reviewFirst),
    remaining: Math.max(0, s.reviewFirst - s.reviewApproved),
    pending: q.scalar<number>("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND subject_type = 'nurture_send' AND status = 'pending'", bizId),
  };
}
function setReviewApproved(bizId: string, n: number) {
  const biz = q.get<Row>("SELECT settings FROM biz WHERE id = ?", bizId);
  const cur = nurtureSettings(bizId);
  const saved = (biz?.settings ?? {}) as Row;
  update("biz", bizId, { settings: { ...saved, nurture: { ...(saved.nurture ?? {}), reviewFirst: cur.reviewFirst, reviewApproved: n } } });
}
/**
 * Sếp bỏ qua chế độ duyệt trước: tắt (reviewFirst = 0). Các khách đang chờ duyệt quay về hàng đợi tự động
 * (vẫn qua đủ luật: hạn mức, giờ yên lặng, dừng khẩn cấp, danh sách không nhận tin).
 */
export function skipNurtureReview(bizId: string, actor: string) {
  saveNurtureSettings(bizId, { reviewFirst: 0 }, actor);
  let released = 0;
  for (const ap of q.all<Row>("SELECT * FROM approval WHERE biz_id = ? AND subject_type = 'nurture_send' AND status = 'pending'", bizId)) {
    update("approval", ap.id, { status: "expired", decided_by: actor, decision_note: "Sếp bỏ qua chế độ duyệt trước", decided_at: nowIso() });
    const lead = byId<Row>("nurture_lead", ap.subject_id);
    if (lead?.stage === "awaiting_review") {
      const { review: _r, ...meta } = (lead.meta ?? {}) as Row;
      logLead(lead, "review_skipped", `Sếp bỏ qua chế độ duyệt trước — chuyển sang tự động (${actor})`, { stage: "new", next_check_at: nowIso(), meta });
      released++;
    }
  }
  audit(bizId, actor, "nurture.review_skipped", { type: "biz", id: bizId }, { released });
  emit(bizId, "nurture.review_skipped", { released });
  return { ok: true, released };
}

// ---------------- Thời gian (giờ Việt Nam) ----------------
const vnHour = (d: Date) => (d.getUTCHours() + 7) % 24;
const vnDayStart = (d: Date) => new Date(`${new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)}T00:00:00+07:00`);
function inQuiet(bizId: string, d: Date) {
  const [start, end] = bizSettings(bizId).quietHours ?? [22, 7];
  const h = vnHour(d);
  return start > end ? h >= start || h < end : h >= start && h < end;
}
/** Lần kế tiếp hết giờ yên lặng (giờ VN). */
function quietEndAfter(bizId: string, d: Date): Date {
  const end = (bizSettings(bizId).quietHours ?? [22, 7])[1];
  let t = new Date(vnDayStart(d).getTime() + end * 3600_000);
  while (t <= d) t = new Date(t.getTime() + 24 * 3600_000);
  return t;
}
const tomorrowMorning = (bizId: string, d: Date) => {
  const end = (bizSettings(bizId).quietHours ?? [22, 7])[1];
  return new Date(vnDayStart(d).getTime() + 24 * 3600_000 + end * 3600_000 + Math.floor(Math.random() * 30) * 60_000);
};
const hours = (h: number) => h * 3600_000;

// ---------------- Mẫu câu ----------------
const givenName = (name: string) => {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length || /^(khách|người dùng)/i.test(name)) return "bạn";
  return parts.length >= 2 && parts.length <= 5 ? parts[parts.length - 1] : parts[0];
};
/** Điền {ten} {san_pham} {link} {shop}. Thiếu link → bỏ cụm từ đầu câu tới {link} (không để "Link: " trống). */
export function fillTemplate(tpl: string, v: { ten: string; san_pham: string; link?: string | null; shop?: string }) {
  let t = tpl;
  if (!v.link) t = t.replace(/(?<=^|[.!?\n])[^.!?\n]*\{link\}[.!?]?[ \t]*\n?/g, " ");
  return t.replaceAll("{ten}", v.ten).replaceAll("{san_pham}", v.san_pham).replaceAll("{link}", v.link ?? "").replaceAll("{shop}", v.shop ?? "")
    .replace(/[ \t]+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n").trim();
}
const pick = (list: string[], seed: number) => list[Math.abs(seed) % list.length];

/** Biến mẫu để Sếp xem trước: khách "Lan", sản phẩm có link đầu tiên (DNA), tên Trang Facebook đầu tiên. */
export function sampleTemplateVars(bizId: string) {
  const products = (activeDna(bizId)?.data?.products ?? []) as Row[];
  const prod = products.find((p) => p.link) ?? products[0];
  const ch = q.get<Row>("SELECT name FROM channel WHERE biz_id = ? AND platform = 'facebook' AND enabled = 1 ORDER BY created_at LIMIT 1", bizId);
  return {
    ten: "Lan", san_pham: String(prod?.name ?? "chương trình (ví dụ)"),
    link: String(prod?.shortLink || prod?.link || "https://shop.vn/san-pham-vi-du"), shop: String(ch?.name ?? "Shop của Sếp"), example: !(prod?.shortLink || prod?.link),
  };
}
/** Xem trước mẫu câu: điền đúng như lúc gửi thật (fillTemplate + ký tự cấm trong DNA), giữ xuống dòng. */
export function previewTemplates(bizId: string, templates: string[]) {
  const v = sampleTemplateVars(bizId);
  const dna = activeDna(bizId);
  return { vars: v, items: templates.map((t) => applyBannedChars(fillTemplate(String(t ?? ""), v), dna)) };
}
const hashOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

/** Biến cho mẫu câu của 1 lead: tên khách, sản phẩm (khớp tên/alias trong bài + bình luận, theo DNA), link sản phẩm / CTA chính. */
function varsFor(lead: Row, post?: Row, channel?: Row) {
  const p = post ?? byId<Row>("post", lead.post_id);
  const products = ((activeDna(lead.biz_id)?.data?.products ?? []) as Row[]).filter((x) => x?.name);
  const hay = vn(`${p?.title ?? ""} ${p?.body ?? ""} ${lead.comment_text ?? ""}`);
  const prod = products.find((x) => [x.name, ...((x.aliases ?? []) as string[])].some((a) => a && hay.includes(vn(String(a)))))
    ?? products.find((x) => x.verified) ?? products[0];
  const raw = String(prod?.shortLink || prod?.link || activeDna(lead.biz_id)?.data?.cta?.link || "").trim();
  const ch = channel ?? (p ? byId<Row>("channel", p.channel_id) : undefined);
  // Link có UTM / mã đo — cùng bài + cùng sản phẩm với link dưới bình luận nên click từ inbox và từ bình luận quy về cùng 1 bài.
  const link = raw ? trackedUrlFor({
    bizId: lead.biz_id, url: fixUrl(raw), postId: p?.id ?? lead.post_id ?? null, contentItemId: p?.content_item_id ?? null,
    productKey: prod ? String(prod.key || prod.name) : null, channel: String(ch?.platform ?? "facebook"),
  }) : null;
  return { ten: givenName(lead.author_name), san_pham: String(prod?.name ?? "sản phẩm"), link, shop: String(ch?.name ?? "") };
}
const vn = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

// ---------------- Nhật ký lead (timeline) ----------------
function logLead(lead: Row, event: string, text: string, patch: Row = {}) {
  const fresh = byId<Row>("nurture_lead", lead.id) ?? lead;
  const log = [...((fresh.log as Row[]) ?? []), { at: nowIso(), event, text }].slice(-60);
  update("nurture_lead", lead.id, { ...patch, log });
  Object.assign(lead, patch, { log });
}

/** Nền tảng của lead (theo kênh của bài). */
function leadPlatform(lead: Row): NurturePlatform {
  return byId<Row>("channel", lead.channel_id)?.platform === "instagram" ? "instagram" : "facebook";
}

// ---------------- Khách không nhận tin ----------------
/** Lead này thuộc khách đã báo không nhận tin? (id người bình luận, PSID, hội thoại inbox/Zalo, SĐT) */
export function leadOptedOut(lead: Row): Row | undefined {
  const ig = leadPlatform(lead) === "instagram";
  // Instagram: id người bình luận = IGSID (cũng là người nhận DM). Thêm tay từ lead / hội thoại ghi dưới khoá "facebook"/"messenger"
  // (chat-engine dùng chung cho mọi lead) → kiểm cả các khoá đó.
  const keys: OptOutKey[] = ig
    ? [{ channel: "instagram", externalId: lead.author_external_id }, { channel: "instagram", externalId: lead.psid },
      { channel: "facebook", externalId: lead.author_external_id }, { channel: "messenger", externalId: lead.psid }]
    : [{ channel: "facebook", externalId: lead.author_external_id }, { channel: "messenger", externalId: lead.psid }];
  let phone: string | null = null;
  if (lead.phone_cipher) { try { phone = decryptSecret(lead.phone_cipher); } catch { /* khoá đổi → bỏ qua */ } }
  const hit = findOptOut(lead.biz_id, keys, [phone]);
  if (hit) return hit;
  for (const cid of [lead.conversation_id, lead.zalo_conversation_id]) {
    if (!cid) continue;
    const conv = byId<Row>("conversation", cid);
    if (conv?.state === "opted_out") return { reason: "Hội thoại: khách từ chối nhận tin" };
    const h = conv ? conversationOptedOut(conv) : undefined;
    if (h) return h;
  }
  return undefined;
}
function stopOptedOut(bizId: string, lead: Row) {
  logLead(lead, "opted_out", "Khách đã báo không muốn nhận tin (danh sách khách không nhận tin) — không trả lời/nhắn/kết bạn tự động", { stage: "stopped", next_check_at: null });
  audit(bizId, "nurture", "nurture.opted_out", { type: "nurture_lead", id: lead.id }, {});
  return { stage: "stopped" as const, skipped: "opted_out" as const };
}

// ---------------- 1) Nhận bình luận thật ----------------
/** Tên thay thế khi Facebook không trả người viết (thiếu quyền pages_read_user_content) — KHÔNG dùng để chống trùng theo tên. */
export const GENERIC_AUTHOR = "Khách Facebook";
export const GENERIC_AUTHOR_IG = "Khách Instagram";
/** Private Reply chỉ được trong 7 ngày kể từ lúc khách viết bình luận (giờ Facebook). */
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 3600_000;
/** Bình luận viết quá 24 giờ trước lúc tạo lead (quét bù khi mới bật / quét lại 14 ngày) → không trả lời (trông như spam). */
const MAX_COMMENT_AGE_ON_START_MS = 24 * 3600_000;
/** Thời điểm bật chăm khách. Doanh nghiệp bật từ trước khi có mốc này: lấy lúc xử lý đầu tiên (rồi lưu lại) để không trả lời dồn bình luận cũ. */
function enabledSince(bizId: string, s: NurtureSettings, now: Date): number {
  if (s.enabledAt) return new Date(s.enabledAt).getTime();
  const biz = q.get<Row>("SELECT settings FROM biz WHERE id = ?", bizId);
  const saved = (biz?.settings ?? {}) as Row;
  update("biz", bizId, { settings: { ...saved, nurture: { ...(saved.nurture ?? {}), enabledAt: now.toISOString() } } });
  return now.getTime();
}

/** Bài CÓ SẴN trên Fanpage (không do hệ thống đăng) → tạo bản ghi bài để quét bình luận. */
export function importExternalPost(bizId: string, channelId: string, p: { externalId: string; text?: string | null; permalink?: string | null; createdAt?: string | null }) {
  const ex = q.get<Row>("SELECT * FROM post WHERE channel_id = ? AND external_id = ?", channelId, p.externalId);
  if (ex) return ex;
  const body = String(p.text ?? "").trim();
  return insert("post", {
    biz_id: bizId, channel_id: channelId, external_id: p.externalId, content_item_id: null, kind: "image",
    title: (body.split("\n")[0] || "Bài có sẵn trên Fanpage").slice(0, 120), body, published_at: p.createdAt ?? nowIso(),
    permalink: p.permalink ?? null, ad_status: "none",
  });
}

/**
 * Bình luận từ webhook feed / quét: tìm bài (tự nhập bài có sẵn trên Fanpage / Instagram), bỏ bình luận của Trang/tài khoản, chống trùng.
 * Instagram: platform "instagram", pageId = id tài khoản Instagram (entry.id), postId = id media, fromName = username.
 */
export function ingestFeedComment(bizId: string, c: FeedComment & { pageId?: string; platform?: NurturePlatform }, source: "webhook" | "poll", channelHint?: Row, scanOnly = false) {
  const platform: NurturePlatform = c.platform ?? (channelHint?.platform === "instagram" ? "instagram" : "facebook");
  const pageId = c.pageId ?? channelHint?.external_id ?? c.postId.split("_")[0];
  const channel = channelHint ?? q.get<Row>("SELECT * FROM channel WHERE biz_id = ? AND platform = ? AND external_id = ? ORDER BY created_at LIMIT 1", bizId, platform, pageId);
  if (!channel) return { skipped: "unknown_page" as const };
  if (c.fromId && c.fromId === channel.external_id) return { skipped: "page_comment" as const };
  // Instagram: bình luận của chính tài khoản (trả lời tự động / link) có thể đến với username thay vì id.
  if (platform === "instagram" && c.fromName && c.fromName.replace(/^@/, "").toLowerCase() === String(channel.name ?? "").replace(/^@/, "").toLowerCase()) return { skipped: "page_comment" as const };
  const suffix = c.postId.includes("_") ? c.postId.split("_").slice(1).join("_") : c.postId;
  let post = q.get<Row>("SELECT * FROM post WHERE channel_id = ? AND external_id IN (?, ?, ?) ORDER BY created_at LIMIT 1", channel.id, c.postId, suffix, `${channel.external_id}_${suffix}`);
  if (!post) post = importExternalPost(bizId, channel.id, { externalId: c.postId, text: "", createdAt: c.createdTime ?? nowIso() });
  if (q.get("SELECT id FROM post_comment WHERE post_id = ? AND external_id = ?", post.id, c.commentId)) return { skipped: "duplicate" as const };
  const row = insert("post_comment", {
    biz_id: bizId, post_id: post.id,
    author: (c.fromName || (c.fromId ? `Khách ${platform === "instagram" ? "IG" : "FB"} ${c.fromId.slice(-6)}` : platform === "instagram" ? GENERIC_AUTHOR_IG : GENERIC_AUTHOR)).slice(0, 120),
    author_external_id: c.fromId ?? null, external_id: c.commentId, parent_external_id: c.parentId ?? null, source,
    text: c.message.slice(0, 2000), hidden: 0,
    external_created_at: c.createdTime ?? null, // giờ khách viết theo Facebook (không phải giờ hệ thống nhận được)
  });
  enqueue("chat", "nurture.classify", { postId: post.id, ...(scanOnly ? { scanOnly: true } : {}) }, { bizId, idempotencyKey: `nurture:classify:${row.id}`, lockKey: `nurture:post:${post.id}` });
  emit(bizId, "nurture.comment_in", { postId: post.id });
  return { commentId: row.id, postId: post.id };
}

/** Quét bình luận mới của 1 bài (Facebook GET /{post-id}/comments filter=stream; Instagram GET /{media-id}/comments) kể từ lần quét trước. */
export async function pollPostComments(post: Row, scanOnly = false): Promise<number> {
  const channel = byId<Row>("channel", post.channel_id);
  if (!channel || !isNurturePlatform(channel.platform)) return 0;
  const c = connectorForChannel(channel);
  if (c.mode !== "live" || !c.listComments || !post.external_id) return 0;
  const since = (post.meta?.commentsCheckedAt as string | undefined) ?? post.published_at;
  const startedAt = nowIso();
  const list = await c.listComments({ postExternalId: post.external_id, since });
  const added = ingestPolled(post, channel, list, scanOnly);
  // Lùi 2 phút để không lọt bình luận đến đúng lúc quét (trùng đã được chặn theo id).
  update("post", post.id, { meta: { ...(post.meta ?? {}), commentsCheckedAt: new Date(new Date(startedAt).getTime() - 120_000).toISOString() } });
  return added;
}

/** Đưa danh sách bình luận vừa đọc vào hệ thống (cũ → mới; trùng đã chặn theo mã bình luận). */
function ingestPolled(post: Row, channel: Row, list: FeedComment[], scanOnly = false): number {
  let added = 0;
  for (const cm of [...list].sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)))) {
    if (!cm.message?.trim()) continue;
    const r = ingestFeedComment(post.biz_id, { ...cm, postId: post.external_id, pageId: channel.external_id, platform: channel.platform }, "poll", channel, scanOnly);
    if ("commentId" in r) added++;
  }
  return added;
}

/**
 * Quét NHANH: 1 lệnh Graph / Trang lấy bình luận mới nhất của 10 bài gần nhất (kèm bài mới Sếp đăng ngoài hệ thống) — chạy mỗi 15 giây
 * chỉ tốn ~4 lệnh/phút/Trang (quét riêng từng bài tốn 6+ lệnh mỗi lượt). Trả về các Trang chưa hỗ trợ để quét kiểu cũ.
 */
const FAST_POST_LIMIT = 10;
const FAST_COMMENT_LIMIT = 25;
async function pollHotPages(bizId: string, scanOnly: boolean | undefined, errors: string[]): Promise<{ posts: Row[]; added: number; fallback: Set<string> }> {
  const out = { posts: [] as Row[], added: 0, fallback: new Set<string>() };
  const pages = q.all<Row>(`SELECT ch.* FROM channel ch JOIN connection c ON c.id = ch.connection_id
    WHERE ch.biz_id = ? AND ch.platform = 'facebook' AND ch.enabled = 1 AND ch.secret_ciphertext IS NOT NULL AND c.mode = 'live' AND c.status NOT IN ('revoked','expired')`, bizId);
  const oldest = Date.now() - 14 * 24 * 3600_000;
  for (const ch of pages) {
    const c = connectorForChannel(ch);
    if (c.mode !== "live") continue;
    if (!c.listRecentPageComments) { out.fallback.add(ch.id); continue; }
    try {
      for (const rp of await c.listRecentPageComments({ pageId: String(ch.external_id), postLimit: FAST_POST_LIMIT, commentLimit: FAST_COMMENT_LIMIT })) {
        if (rp.createdTime && new Date(rp.createdTime).getTime() < oldest) continue; // bài quá 14 ngày: lượt quét đủ bài lo
        const post = importExternalPost(bizId, ch.id, { externalId: rp.id, text: rp.message, permalink: rp.permalink, createdAt: rp.createdTime });
        out.added += ingestPolled(post, ch, rp.comments, scanOnly);
        out.posts.push(post);
      }
    } catch (e) {
      const error = `${ch.name}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(error);
      logger.warn("nurture.fast_poll_failed", { channel: ch.id, error });
      out.fallback.add(ch.id); // lỗi lệnh gộp → thử kiểu cũ ngay lượt này
    }
  }
  return out;
}

/** Bài trên Fanpage thật trong 14 ngày (kể cả bài Sếp tự đăng ngoài hệ thống) → có bản ghi bài để quét bình luận. */
async function discoverPagePosts(bizId: string, since: string) {
  const errors: string[] = [];
  const pages = q.all<Row>(`SELECT ch.* FROM channel ch JOIN connection c ON c.id = ch.connection_id
    WHERE ch.biz_id = ? AND ch.platform = 'facebook' AND ch.enabled = 1 AND ch.secret_ciphertext IS NOT NULL AND c.mode = 'live' AND c.status NOT IN ('revoked','expired')`, bizId);
  for (const ch of pages) {
    const c = connectorForChannel(ch);
    if (c.mode !== "live" || !c.listPagePosts) continue;
    try {
      for (const p of await c.listPagePosts({ pageId: String(ch.external_id), since, limit: 30 }))
        importExternalPost(bizId, ch.id, { externalId: p.id, text: p.message, permalink: p.permalink, createdAt: p.createdTime });
    } catch (e) {
      const error = `${ch.name}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(error);
      logger.warn("nurture.discover_failed", { channel: ch.id, error });
    }
  }
  return errors;
}

/**
 * Quét 2 tầng để bình luận được trả lời nhanh mà không đốt hạn mức gọi API của Facebook (lịch chạy mỗi phút):
 *  - mỗi lượt: chỉ bài MỚI (đăng trong 48 giờ, tối đa 6 bài) — nơi bình luận mới xuất hiện nhiều nhất;
 *  - 5 phút/lần (hoặc khi Sếp bấm "Quét ngay" → full): quét đủ bài 14 ngày gần đây (tối đa 40 bài) như trước.
 */
const HOT_WINDOW_MS = 48 * 3600_000;
const HOT_LIMIT = 6;
const FULL_SWEEP_MS = 5 * 60_000;
const lastFullSweep = new Map<string, number>();

/** Quét định kỳ: bài Facebook / Instagram (kênh kết nối thật, nền tảng đang bật) đăng trong 14 ngày gần đây. */
export async function pollBizComments(bizId: string, opts: { full?: boolean; scanOnly?: boolean } = {}) {
  const s = nurtureSettings(bizId);
  if (!s.enabled && !opts.scanOnly) return { posts: 0, added: 0, errors: [], skipped: "Chăm khách từ bình luận đang tắt" };
  const plats = NURTURE_PLATFORMS.filter((p) => s.platforms[p]);
  if (!plats.length) return { posts: 0, added: 0, errors: [], skipped: "Chưa bật nền tảng cần quét" };
  const now = Date.now();
  const full = opts.full ?? now - (lastFullSweep.get(bizId) ?? 0) >= FULL_SWEEP_MS;
  if (full) lastFullSweep.set(bizId, now);
  // Lượt nhanh (mỗi 15 giây): 1 lệnh gộp/Trang, đã gồm bài mới → không cần dò bài riêng. Lượt đủ bài (5 phút/lần): dò bài + quét từng bài.
  const errors: string[] = full && plats.includes("facebook") ? await discoverPagePosts(bizId, new Date(now - 14 * 24 * 3600_000).toISOString()) : [];
  let added = 0, scanned = 0;
  let fast: Awaited<ReturnType<typeof pollHotPages>> | null = null;
  if (!full && plats.includes("facebook")) {
    fast = await pollHotPages(bizId, opts.scanOnly, errors);
    added += fast.added;
    scanned += fast.posts.length;
    if (!opts.scanOnly) for (const p of fast.posts) enqueueNurtureComments(p, s);
  }
  const since = new Date(now - (full ? 14 * 24 * 3600_000 : HOT_WINDOW_MS)).toISOString();
  const onlyChannels = fast ? fast.fallback : null; // lượt nhanh: chỉ Trang không có lệnh gộp mới quét kiểu cũ (Instagram luôn kiểu cũ)
  const posts = q.all<Row>(`SELECT p.* FROM post p JOIN channel ch ON ch.id = p.channel_id
    WHERE p.biz_id = ? AND ch.platform IN (${plats.map(() => "?").join(",")}) AND ch.enabled = 1 AND ch.secret_ciphertext IS NOT NULL AND p.simulated = 0 AND p.published_at >= ?
    ORDER BY p.published_at DESC LIMIT ?`, bizId, ...plats, since, full ? 40 : HOT_LIMIT)
    .filter((p) => !onlyChannels || (onlyChannels.has(p.channel_id) || byId<Row>("channel", p.channel_id)?.platform !== "facebook"));
  for (const p of posts) {
    try {
      added += await pollPostComments(p, opts.scanOnly); scanned++;
      if (!opts.scanOnly) enqueueNurtureComments(p, s); // includes comments collected while replies were off
    } catch (e) {
      const error = `${p.title || "Bài đăng"}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(error);
      logger.warn("nurture.poll_failed", { post: p.id, error });
    }
  }
  return { posts: scanned, added, errors };
}

/**
 * Phân loại lại bình luận đã gán nhãn bằng heuristic (nhãn cũ có thể sai sau khi sửa bộ phân loại, vd. câu hỏi "…ko ạ" bị coi là khen)
 * rồi đưa vào hàng chăm khách. Chỉ đụng bình luận chưa có lead và chưa được trả lời/nhắn; bình luận quá 24 giờ vẫn bị chặn như thường.
 */
export async function reclassifyComments(bizId: string) {
  const rows = q.all<Row>(`SELECT c.id, c.post_id FROM post_comment c WHERE c.biz_id = ? AND c.source IN ('poll','webhook') AND c.label_source = 'heuristic'
    AND c.replied_at IS NULL AND c.dm_sent_at IS NULL AND c.id NOT IN (SELECT comment_id FROM nurture_lead)`, bizId);
  const s = nurtureSettings(bizId);
  const changed: { text: string; from: string | null; to: string | null }[] = [];
  for (const postId of new Set(rows.map((r) => r.post_id as string))) {
    const post = byId<Row>("post", postId);
    if (!post) continue;
    const ids = rows.filter((r) => r.post_id === postId).map((r) => r.id as string);
    const before = new Map(ids.map((id) => [id, byId<Row>("post_comment", id)!.label as string | null]));
    for (const id of ids) update("post_comment", id, { label: null, label_source: null, label_confidence: null });
    await classifyComments(post);
    for (const id of ids) { const c = byId<Row>("post_comment", id)!; if (c.label !== before.get(id)) changed.push({ text: String(c.text).slice(0, 60), from: before.get(id) ?? null, to: c.label }); }
    if (s.enabled) enqueueNurtureComments(post, s);
  }
  return { checked: rows.length, changed };
}

function enqueueNurtureComments(post: Row, s: NurtureSettings) {
  for (const c of q.all<Row>("SELECT id, label FROM post_comment WHERE post_id = ? AND source IN ('poll','webhook') AND label IS NOT NULL AND id NOT IN (SELECT comment_id FROM nurture_lead)", post.id)) {
    if (s.labels.includes(c.label))
      enqueue("chat", "nurture.comment", { commentId: c.id }, { bizId: post.biz_id, idempotencyKey: `nurture:cmt:${c.id}`, lockKey: `nurture:post:${post.id}` });
  }
}

// ---------------- 2) Trả lời công khai + Private Reply ----------------
function countToday(bizId: string, col: string, where: string, ...args: unknown[]) {
  return q.scalar<number>(`SELECT COUNT(*) FROM nurture_lead WHERE biz_id = ? AND ${col} >= ? ${where}`, bizId, vnDayStart(new Date()).toISOString(), ...args);
}
function gate(bizId: string, now: Date, manual = false): { until: Date; reason: string } | null {
  if (isKilled(bizId, "chat")) return { until: new Date(now.getTime() + 30 * 60_000), reason: "Đang bật dừng khẩn cấp chat" };
  if (!manual && inQuiet(bizId, now)) return { until: quietEndAfter(bizId, now), reason: "Giờ yên lặng — để sáng mai" };
  return null;
}
const retryable = (e: unknown) => e instanceof ConnectorError ? e.kind === "Transient" || e.kind === "RateLimited" || Boolean((e as { requestNotSent?: boolean }).requestNotSent) : !(e instanceof AppError);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Lỗi khi GỬI (trả lời công khai / Private Reply / lời nhắc) — Facebook đã nhận hay chưa?
 * Connector thật KHÔNG dùng khoá idempotency → gửi lại = khách bị nhắn trùng (và Private Reply lần 2 bị Facebook từ chối),
 * nên quy tắc thận trọng:
 *   - "not_sent" (chắc chắn CHƯA gửi): Facebook trả lời từ chối 4xx (InvalidRequest/AuthError/PolicyRejected/NotFound),
 *     bị giới hạn tần suất 429 / mã giới hạn (RateLimited — từ chối trước khi xử lý), không mở được kết nối
 *     (requestNotSent: ECONNREFUSED/ENOTFOUND… — chưa có byte nào tới máy chủ), lỗi nghiệp vụ của ta (AppError).
 *     → nhả giữ chỗ; lỗi tạm thời thì thử lại.
 *   - "unknown" (KHÔNG rõ kết quả): hết thời gian chờ / mất kết nối sau khi đã gửi, máy chủ 5xx, lỗi lạ khác.
 *     → GIỮ chỗ, chuyển lead sang "needs_check" (cần Sếp kiểm tra), KHÔNG tự gửi lại.
 */
export function sendOutcome(e: unknown): "not_sent" | "unknown" {
  if (e instanceof AppError) return "not_sent";
  // Ghi (POST) bị hết thời gian chờ / mất kết nối SAU khi gửi: Facebook có thể đã nhận (meta/graph.ts#graphPost đánh dấu).
  if ((e as { outcomeUnknown?: boolean } | null)?.outcomeUnknown) return "unknown";
  if (e instanceof ConnectorError) {
    if (e.kind === "Transient") return (e as ConnectorError & { requestNotSent?: boolean }).requestNotSent ? "not_sent" : "unknown";
    return "not_sent";
  }
  return "unknown";
}
/** Giữ chỗ quá 15 phút mà chưa ghi nhận kết quả = tiến trình đã chết giữa chừng. */
const CLAIM_STALE_MS = 15 * 60_000;
/** Dời lịch kiểm tra của lead còn ở stage "new" (không ghi đè lịch của lượt khác đã chuyển stage). */
function deferNew(leadId: string, until: Date, reason?: string) {
  q.run(`UPDATE nurture_lead SET next_check_at = ?, ${reason !== undefined ? "last_error = ?," : ""} updated_at = ? WHERE id = ? AND stage = 'new'`,
    until.toISOString(), ...(reason !== undefined ? [reason] : []), nowIso(), leadId);
}
/** Không rõ đã gửi hay chưa → cần Sếp kiểm tra trên Facebook; hệ thống không tự gửi lại. */
function markNeedsCheck(bizId: string, lead: Row, step: "reply" | "dm", why: string) {
  const what = step === "dm" ? "nhắn inbox (Private Reply)" : "trả lời công khai dưới bình luận";
  logLead(lead, "needs_check", `Không chắc đã ${what}: ${why}. Hệ thống KHÔNG tự gửi lại để tránh nhắn trùng — Sếp mở bình luận trên ${platformLabel(leadPlatform(lead))} kiểm tra; nếu chưa có thì bấm "Gửi lại inbox".`,
    { stage: "needs_check", next_check_at: null, last_error: why.slice(0, 300) });
  audit(bizId, "nurture", "nurture.needs_check", { type: "nurture_lead", id: lead.id }, { step, reason: why.slice(0, 300) });
  emit(bizId, "nurture.needs_check", { leadId: lead.id });
  return { stage: "needs_check" as const };
}
/**
 * Lead "new" mà bình luận đã bị giữ chỗ gửi (replied_at / dm_sent_at) nhưng chưa ghi nhận xong:
 * - giữ chỗ < 15 phút: lượt khác đang gửi → dời lịch kiểm tra (không chặn hàng đợi của tick);
 * - giữ chỗ ≥ 15 phút: tiến trình chết giữa chừng → needs_check (không chắc đã gửi, KHÔNG tự gửi lại).
 */
function pendingClaim(bizId: string, lead: Row, c: Row, now: Date) {
  const pending = !lead.dm_sent_at && c.dm_sent_at ? { step: "dm" as const, at: String(lead.dm_claimed_at ?? c.dm_sent_at) }
    : !lead.public_replied_at && lead.reply_claimed_at && c.replied_at ? { step: "reply" as const, at: String(lead.reply_claimed_at) }
    : null;
  if (!pending) return null;
  const at = new Date(pending.at).getTime();
  if (now.getTime() - at >= CLAIM_STALE_MS)
    return markNeedsCheck(bizId, lead, pending.step, `đã bắt đầu gửi lúc ${pending.at} nhưng không ghi nhận kết quả (tiến trình có thể đã dừng giữa chừng)`);
  deferNew(lead.id, new Date(Math.max(now.getTime(), at) + CLAIM_STALE_MS + 1000));
  return { stage: "new", skipped: pending.step === "dm" ? "dm_in_progress" : "reply_in_progress" };
}

/** Job nurture.comment: tạo lead cho bình luận (nếu đủ điều kiện) rồi chạy bước trả lời + inbox. */
export async function processNurtureComment(bizId: string, commentId: string, now = new Date()) {
  const s = nurtureSettings(bizId);
  if (!s.enabled) return { skipped: "off" };
  const c = byId<Row>("post_comment", commentId);
  if (!c || c.biz_id !== bizId) return { skipped: "not_found" };
  const post = byId<Row>("post", c.post_id);
  const channel = post ? byId<Row>("channel", post.channel_id) : undefined;
  if (!post || !channel) return { skipped: "no_post" };
  if (c.hidden || c.label === "spam" || c.label === "negative" || !s.labels.includes(c.label)) return { skipped: "label" };
  if (c.author_external_id && c.author_external_id === channel.external_id) return { skipped: "page_comment" };
  if (!isNurturePlatform(channel.platform)) {
    audit(bizId, "nurture", "nurture.skipped", { type: "post", id: post.id }, { reason: `Kênh ${channel.platform} chưa hỗ trợ trả lời + inbox tự động`, commentId });
    return { skipped: "platform" };
  }
  if (!s.platforms[channel.platform]) {
    audit(bizId, "nurture", "nurture.skipped", { type: "post", id: post.id }, { reason: `Đang tắt chăm khách trên ${platformLabel(channel.platform)}`, commentId });
    return { skipped: "platform_off" };
  }
  let lead = q.get<Row>("SELECT * FROM nurture_lead WHERE comment_id = ?", c.id);
  if (!lead) {
    // MỌI bình luận thật đều được trả lời + inbox — dù cùng người bình luận bao nhiêu lần, trên bài nào (mỗi bình luận = 1 lead,
    // chống trùng theo MÃ BÌNH LUẬN ở nurture_lead.comment_id). Người đã được chăm trước đó (bất kỳ bài nào) chỉ nhận trả lời công khai +
    // inbox cho bình luận mới, KHÔNG lặp chuỗi xin SĐT / nhắc / kết bạn Zalo (meta.repeat) để không làm phiền cùng một người.
    const genericName = !c.author_external_id && (!c.author || c.author === GENERIC_AUTHOR || c.author === GENERIC_AUTHOR_IG);
    const before = c.author_external_id
      ? q.get<Row>("SELECT id FROM nurture_lead WHERE biz_id = ? AND author_external_id = ? AND comment_id != ? AND stage NOT IN ('skipped','failed') ORDER BY created_at LIMIT 1", bizId, c.author_external_id, c.id)
      : genericName ? undefined
      : q.get<Row>("SELECT id FROM nurture_lead WHERE biz_id = ? AND author_external_id IS NULL AND author_name = ? AND comment_id != ? AND stage NOT IN ('skipped','failed') ORDER BY created_at LIMIT 1", bizId, c.author, c.id);
    // Bình luận cũ: chỉ bỏ khi viết TRƯỚC lúc bật chăm khách và quá 24 giờ (quét bù — trông như spam). Bình luận viết SAU lúc bật luôn được
    // trả lời, kể cả khi hệ thống tắt/nghẽn một lúc (Private Reply còn hiệu lực 7 ngày; quá 7 ngày bị chặn ở bước gửi).
    const writtenAt = new Date(c.external_created_at ?? c.created_at).getTime();
    const since = enabledSince(bizId, s, now);
    const skipReason = now.getTime() - writtenAt > MAX_COMMENT_AGE_ON_START_MS && writtenAt < since ? "Bình luận cũ (viết trước khi bật chăm khách, hơn 24 giờ) — không trả lời/nhắn để tránh trông như spam"
      : null;
    lead = insert("nurture_lead", {
      biz_id: bizId, post_id: post.id, comment_id: c.id, channel_id: channel.id, author_name: c.author, author_external_id: c.author_external_id ?? null,
      comment_text: String(c.text).slice(0, 500), label: c.label, stage: skipReason ? "skipped" : "new", next_check_at: skipReason ? null : now.toISOString(),
      log: [
        { at: nowIso(), event: "comment", text: `Bình luận (${c.label === "purchase_intent" ? "muốn mua" : c.label === "question" ? "hỏi" : "khen / quan tâm"})${before ? " — khách đã được chăm trước đó, chỉ trả lời + inbox, không lặp xin SĐT" : ""}` },
        ...(skipReason ? [{ at: nowIso(), event: "skipped", text: skipReason }] : []),
      ],
      meta: before ? { repeat: true, previousLeadId: before.id } : {},
    });
    emit(bizId, "nurture.lead_created", { leadId: lead.id });
    if (skipReason) {
      audit(bizId, "nurture", "nurture.skipped", { type: "nurture_lead", id: lead.id }, { reason: skipReason, commentId });
      return { skipped: "old_comment", leadId: lead.id, stage: "skipped" };
    }
  }
  return runNewLead(bizId, lead, now);
}

/**
 * Giữ chỗ 1 lần gửi (trả lời công khai / inbox) cho 1 bình luận — nguyên tử trong SQLite.
 * Hai lượt xử lý cùng lúc (quét định kỳ + nút Chạy ngay, hay job + bấm tay) chỉ 1 lượt được gửi → khách không bị nhắn trùng.
 */
function claimSend(commentId: string, col: "replied_at" | "dm_sent_at"): boolean {
  return Number(q.run(`UPDATE post_comment SET ${col} = ? WHERE id = ? AND ${col} IS NULL`, nowIso(), commentId).changes) === 1;
}
function releaseSend(commentId: string, col: "replied_at" | "dm_sent_at") {
  q.run(`UPDATE post_comment SET ${col} = NULL WHERE id = ?`, commentId);
}

/**
 * Bước trả lời công khai + Private Reply cho lead ở stage "new". Tự hoãn khi bị chặn bởi giờ yên lặng / hạn mức / kill switch.
 * opts.manual = Sếp vừa duyệt (chế độ duyệt trước) → không chờ hết giờ yên lặng (vẫn theo dừng khẩn cấp + hạn mức).
 */
export async function runNewLead(bizId: string, lead: Row, now = new Date(), opts: { manual?: boolean } = {}) {
  lead = byId<Row>("nurture_lead", lead.id) ?? lead; // đọc lại: lượt khác có thể vừa xử lý xong
  if (lead.stage !== "new") return { stage: lead.stage };
  const s = nurtureSettings(bizId);
  if (!s.enabled) { logger.info("nurture.lead_skipped_off", { lead: lead.id }); return { skipped: "off" }; }
  const c = byId<Row>("post_comment", lead.comment_id)!;
  const busy = pendingClaim(bizId, lead, c, now);
  if (busy) return busy;
  // Khách đã báo không nhận tin (vd ở bài khác / Messenger) → không trả lời, không nhắn.
  if (!c.replied_at && !c.dm_sent_at && leadOptedOut(lead)) return stopOptedOut(bizId, lead);
  const g = gate(bizId, now, opts.manual || s.replyAllDay); // replyAllDay: trả lời + inbox cả ban đêm (dừng khẩn cấp vẫn chặn)
  if (g) { update("nurture_lead", lead.id, { next_check_at: g.until.toISOString(), last_error: g.reason }); return { deferred: g.reason }; }
  const post = byId<Row>("post", lead.post_id)!;
  const channel = byId<Row>("channel", lead.channel_id)!;
  const platform: NurturePlatform = channel.platform === "instagram" ? "instagram" : "facebook";
  const plat = platformLabel(platform);
  if (!s.platforms[platform] && !opts.manual) {
    // Sếp tắt nền tảng này khi khách còn chờ → hoãn (bật lại thì chạy tiếp; quá 7 ngày thì bước dưới tự bỏ).
    update("nurture_lead", lead.id, { next_check_at: new Date(now.getTime() + hours(1)).toISOString(), last_error: `Đang tắt chăm khách trên ${plat}` });
    return { deferred: "platform_off" };
  }
  const caps = capsFor(s, platform);
  const conn = connectorForChannel(channel);
  if (conn.mode !== "live") {
    logLead(lead, "skipped", `${plat} chưa kết nối thật (token) — không trả lời/nhắn được`, { stage: "skipped", next_check_at: null });
    return { stage: "skipped" };
  }
  if (!c.external_id) {
    logLead(lead, "skipped", `Bình luận không có mã trên ${plat} — không trả lời được`, { stage: "skipped" });
    return { stage: "skipped" };
  }
  const commentExt = String(c.external_id);
  const v = varsFor(lead, post, channel);
  const dna = activeDna(bizId);

  // Tuổi bình luận theo giờ Facebook (created_time), không theo giờ hệ thống nhận được: quá 7 ngày thì Private Reply
  // bị từ chối → bỏ CẢ trả lời công khai (trả lời bình luận cũ trông như spam) lẫn inbox. Kiểm TRƯỚC khi trả lời công khai.
  if (now.getTime() - new Date(c.external_created_at ?? c.created_at).getTime() > PRIVATE_REPLY_WINDOW_MS) {
    logLead(lead, "skipped", `Bình luận quá 7 ngày — ${plat} không cho nhắn inbox từ bình luận cũ; không trả lời công khai`, { stage: "skipped", next_check_at: null });
    return { stage: "skipped" };
  }

  // Câu đã được Sếp duyệt (chế độ duyệt trước) — gửi đúng câu này, không chọn mẫu lại.
  const approved = (lead.meta?.review?.approvedAt ? lead.meta.review : null) as { replyText?: string | null; dmText?: string | null } | null;
  const replyStep = s.steps.replyComment && !lead.public_replied_at && Boolean(conn.replyToComment);
  const dmStep = s.steps.privateReply && Boolean(conn.privateReply);
  if (!approved && reviewActive(s) && (replyStep || dmStep)) {
    // Chế độ duyệt trước: soạn sẵn ĐÚNG câu sẽ gửi, mở mục Duyệt — chưa gửi, chưa giữ chỗ.
    const replyText = replyStep ? applyBannedChars(fillTemplate(pick(s.replyTemplates, countToday(bizId, "public_replied_at", "AND channel_id = ?", channel.id) + hashOf(c.id)), v), dna) : null;
    const dmText = dmStep ? applyBannedChars(fillTemplate(pick(s.dmTemplates, countToday(bizId, "dm_sent_at", "AND channel_id = ?", channel.id) + hashOf(c.id)), v), dna) : null;
    return openReview(bizId, lead, s, { post, c, replyText, dmText });
  }

  // a) Trả lời công khai dưới bình luận
  if (s.steps.replyComment && !lead.public_replied_at && conn.replyToComment) {
    const used = countToday(bizId, "public_replied_at", "AND channel_id = ?", channel.id);
    if (used >= caps.publicReplies) {
      update("nurture_lead", lead.id, { next_check_at: tomorrowMorning(bizId, now).toISOString(), last_error: `Đủ ${caps.publicReplies} trả lời công khai trên ${plat} hôm nay — để mai` });
      return { deferred: "public_cap" };
    }
    if (claimSend(c.id, "replied_at")) {
      update("nurture_lead", lead.id, { reply_claimed_at: nowIso() }); // cùng nhịp đồng bộ với claimSend (chưa có await)
      const text = approved?.replyText ? applyBannedChars(approved.replyText, dna) : applyBannedChars(fillTemplate(pick(s.replyTemplates, used + hashOf(c.id)), v), dna);
      try {
        const r = await conn.replyToComment({ commentExternalId: commentExt, text }, `nurture:reply:${c.id}`);
        lead = byId<Row>("nurture_lead", lead.id) ?? lead;
        logLead(lead, "public_reply", `Đã trả lời dưới bình luận: "${text}"`, { public_replied_at: nowIso(), last_error: null, meta: { ...(lead.meta ?? {}), publicReplyId: r.externalId } });
      } catch (e) {
        if (sendOutcome(e) === "unknown") return markNeedsCheck(bizId, lead, "reply", `lỗi khi trả lời công khai (${errText(e)}) — ${plat} có thể đã nhận`);
        releaseSend(c.id, "replied_at");
        update("nurture_lead", lead.id, { reply_claimed_at: null });
        if (retryable(e)) { deferNew(lead.id, new Date(now.getTime() + 10 * 60_000), errText(e)); throw e; }
        logLead(lead, "error", `Trả lời công khai lỗi: ${errText(e)}`, { last_error: errText(e) }); // vẫn thử nhắn inbox
      }
    }
  }

  // b) Private Reply vào inbox (hỏi SĐT/Zalo)
  if (!s.steps.privateReply || !conn.privateReply) {
    logLead(lead, "done", s.steps.privateReply ? "Kênh không hỗ trợ nhắn inbox từ bình luận" : "Đã tắt bước nhắn inbox", { stage: "replied", next_check_at: null });
    return { stage: "replied" };
  }
  const usedDm = countToday(bizId, "dm_sent_at", "AND channel_id = ?", channel.id);
  if (usedDm >= caps.privateReplies) {
    update("nurture_lead", lead.id, { next_check_at: tomorrowMorning(bizId, now).toISOString(), last_error: `Đủ ${caps.privateReplies} tin inbox trên ${plat} hôm nay — để mai` });
    return { deferred: "dm_cap" };
  }
  if (!claimSend(c.id, "dm_sent_at")) { // lượt khác đang/đã nhắn → dời lịch, không để tick chọn lại liên tục
    deferNew(lead.id, new Date(now.getTime() + CLAIM_STALE_MS + 1000));
    return { stage: lead.stage, skipped: "dm_in_progress" };
  }
  update("nurture_lead", lead.id, { dm_claimed_at: nowIso() });
  const dmText = approved?.dmText ? applyBannedChars(approved.dmText, dna) : applyBannedChars(fillTemplate(pick(s.dmTemplates, usedDm + hashOf(c.id)), v), dna);
  let r: { recipientId: string; messageId: string };
  try {
    r = await conn.privateReply({ commentExternalId: commentExt, text: dmText }, `nurture:dm:${c.id}`);
  } catch (e) {
    if (sendOutcome(e) === "unknown") return markNeedsCheck(bizId, lead, "dm", `lỗi khi nhắn inbox (${errText(e)}) — ${plat} có thể đã nhận`);
    releaseSend(c.id, "dm_sent_at");
    update("nurture_lead", lead.id, { dm_claimed_at: null });
    if (retryable(e)) { deferNew(lead.id, new Date(now.getTime() + 10 * 60_000), errText(e)); throw e; }
    logLead(lead, "failed", `Nhắn inbox lỗi: ${errText(e)}`, { stage: "failed", last_error: errText(e), next_check_at: null });
    audit(bizId, "nurture", "nurture.dm_failed", { type: "nurture_lead", id: lead.id }, { error: errText(e) });
    return { stage: "failed" };
  }
  // Người bình luận lặp (đã được chăm trước đó): xong trả lời công khai + inbox là dừng — không hẹn nhắc SĐT / kết bạn Zalo lần nữa.
  const repeat = Boolean(lead.meta?.repeat);
  const stage = repeat ? "replied" : s.steps.askContact ? "asked_contact" : "dm_sent";
  const nextCheck = repeat ? null : new Date(now.getTime() + hours(s.reminderAfterHours)).toISOString();
  if (!r.recipientId) {
    // Trang thật mà Facebook/Instagram không trả PSID/IGSID: KHÔNG tạo hội thoại với người nhận giả "cmt:…" (hội thoại ma, nhắn không tới ai).
    update("post_comment", c.id, { dm_sent_at: nowIso() });
    logLead(lead, "dm", `Đã nhắn inbox: "${dmText}" (${plat} không trả mã người nhận — tin khách trả lời sẽ hiện ở Hội thoại)`, { stage, dm_sent_at: nowIso(), last_error: null, next_check_at: nextCheck });
    audit(bizId, "nurture", "nurture.dm_sent", { type: "nurture_lead", id: lead.id }, { postId: post.id, via: conn.mode, noPsid: true });
    return { stage };
  }
  const psid = r.recipientId;
  // Instagram: hội thoại kênh "instagram", external_id = IGSID, ext.pageId = id tài khoản IG (để gửi đúng tài khoản, cửa sổ 24h).
  const convChannel = platform === "instagram" ? "instagram" : "messenger";
  let conv = q.get<Row>("SELECT * FROM conversation WHERE biz_id = ? AND channel = ? AND external_id = ?", bizId, convChannel, psid);
  if (!conv) {
    conv = insert("conversation", {
      biz_id: bizId, channel: convChannel, external_id: psid, customer_ref: `cust_${psid}`, customer_name: lead.author_name, state: "awaiting_customer",
      tags: ["Từ bình luận"], unread: 0, ext: { pageId: channel.external_id, nurtureLeadId: lead.id }, last_customer_at: null,
    });
  } else {
    // Lead lặp không chiếm hội thoại: tin khách trả lời vẫn gắn với lead gốc (đang xin SĐT) nếu còn.
    update("conversation", conv.id, { ext: { ...(conv.ext ?? {}), pageId: conv.ext?.pageId ?? channel.external_id, nurtureLeadId: repeat && conv.ext?.nurtureLeadId ? conv.ext.nurtureLeadId : lead.id } });
  }
  insert("message", { biz_id: bizId, conversation_id: conv.id, direction: "out", sender: "bot", body: { text: dmText }, external_id: r.messageId || null, meta: { kind: "nurture_dm", leadId: lead.id, via: conn.mode }, sent_at: nowIso() });
  update("conversation", conv.id, { last_message_at: nowIso(), last_preview: dmText.slice(0, 140) });
  // (hội thoại còn mở: Private Reply vẫn vào đúng luồng chat hiện có của khách)
  if (!q.get("SELECT id FROM attribution_link WHERE conversation_id = ? AND post_id = ?", conv.id, post.id))
    insert("attribution_link", { biz_id: bizId, conversation_id: conv.id, post_id: post.id, source: "comment", method: "tag", confidence: 0.9 });
  update("post_comment", c.id, { dm_sent_at: nowIso() });
  logLead(lead, "dm", `Đã nhắn inbox: "${dmText}"`, { stage, psid, conversation_id: conv.id, dm_sent_at: nowIso(), last_error: null, next_check_at: nextCheck });
  audit(bizId, "nurture", "nurture.dm_sent", { type: "nurture_lead", id: lead.id }, { postId: post.id, via: conn.mode });
  emit(bizId, "nurture.dm_sent", { leadId: lead.id, conversationId: conv.id });
  return { stage, conversationId: conv.id };
}

// ---------------- Chế độ duyệt trước: mở mục Duyệt / Sếp quyết định ----------------
/** Mở mục duyệt "nurture_send" cho lead (không giữ chỗ gửi). Hạn duyệt = hết cửa sổ 7 ngày của Private Reply. */
function openReview(bizId: string, lead: Row, s: NurtureSettings, x: { post: Row; c: Row; replyText: string | null; dmText: string | null }) {
  const writtenAt = new Date(x.c.external_created_at ?? x.c.created_at);
  const deadline = new Date(writtenAt.getTime() + PRIVATE_REPLY_WINDOW_MS);
  let ap = q.get<Row>("SELECT * FROM approval WHERE biz_id = ? AND subject_type = 'nurture_send' AND subject_id = ? AND status = 'pending'", bizId, lead.id);
  if (!ap) {
    ap = insert("approval", {
      biz_id: bizId, subject_type: "nurture_send", subject_id: lead.id, agent_key: "chat",
      title: `Chăm khách từ bình luận: ${lead.author_name}`, risk: "medium", status: "pending",
      preview: {
        kind: "nurture_send", channel: byId<Row>("channel", lead.channel_id)?.platform ?? "facebook", leadId: lead.id, author: lead.author_name, comment: String(lead.comment_text ?? x.c.text ?? ""),
        postTitle: x.post.title ?? null, permalink: x.post.permalink ?? null, replyText: x.replyText, dmText: x.dmText,
        text: x.dmText ?? x.replyText ?? "", // ô "Chỉnh sửa" sửa tin inbox
        reviewNo: Math.min(s.reviewApproved + 1, s.reviewFirst), reviewFirst: s.reviewFirst, deadline: deadline.toISOString(),
      },
      expires_at: deadline.toISOString(),
    });
    emit(bizId, "approval.created", { approvalId: ap.id, title: ap.title });
  }
  logLead(lead, "awaiting_review", `Chờ Sếp duyệt (chế độ duyệt trước — còn ${Math.max(0, s.reviewFirst - s.reviewApproved)}/${s.reviewFirst} khách cần duyệt). Hệ CHƯA trả lời/nhắn khách.`, {
    stage: "awaiting_review", next_check_at: null, last_error: null,
    meta: { ...(lead.meta ?? {}), review: { approvalId: ap.id, replyText: x.replyText, dmText: x.dmText, createdAt: nowIso() } },
  });
  audit(bizId, "nurture", "nurture.review_requested", { type: "nurture_lead", id: lead.id }, { approvalId: ap.id });
  return { stage: "awaiting_review" as const, approvalId: ap.id as string };
}

/**
 * Sếp quyết định mục duyệt "nurture_send" (gọi từ decideApproval — mục duyệt đã chuyển approved/edited/rejected):
 * - duyệt → gửi đúng đường thường (giữ chỗ nguyên tử, hạn mức, dừng khẩn cấp, danh sách không nhận tin) + tăng bộ đếm;
 * - "Chỉnh sửa" → tin inbox dùng bản Sếp sửa;
 * - từ chối → lead "Bỏ qua";
 * - duyệt quá 7 ngày kể từ lúc khách bình luận → failed (Facebook không cho nhắn inbox nữa).
 */
export async function decideNurtureSend(bizId: string, ap: Row, decision: "approve" | "edit" | "reject", edited: string | undefined, actor: string, now = new Date()) {
  const lead = byId<Row>("nurture_lead", ap.subject_id);
  if (!lead || lead.biz_id !== bizId) return { skipped: "not_found" };
  if (lead.stage !== "awaiting_review") return { skipped: "stage", stage: lead.stage };
  const reopen = (code: string, msg: string): never => {
    update("approval", ap.id, { status: "pending", decided_at: null, decided_by: null });
    throw new AppError(code, msg);
  };
  if (decision === "reject") {
    logLead(lead, "skipped", `Sếp không duyệt — không trả lời/nhắn khách này (${actor})`, { stage: "skipped", next_check_at: null });
    audit(bizId, actor, "nurture.review_rejected", { type: "nurture_lead", id: lead.id }, {});
    return { stage: "skipped" };
  }
  const c = byId<Row>("post_comment", lead.comment_id);
  const writtenAt = new Date(c?.external_created_at ?? c?.created_at ?? lead.created_at).getTime();
  if (now.getTime() - writtenAt > PRIVATE_REPLY_WINDOW_MS) {
    logLead(lead, "failed", `Duyệt muộn: bình luận đã quá 7 ngày — ${platformLabel(leadPlatform(lead))} không cho nhắn inbox từ bình luận cũ nữa, hệ không gửi`, { stage: "failed", next_check_at: null, last_error: "Duyệt quá 7 ngày sau bình luận" });
    return { stage: "failed" };
  }
  if (leadOptedOut(lead)) return stopOptedOut(bizId, lead);
  const s = nurtureSettings(bizId);
  if (!s.enabled) reopen("NURTURE_OFF", "Chăm khách từ bình luận đang TẮT — bật lại ở trang Chăm khách rồi duyệt");
  if (isKilled(bizId, "chat")) reopen("KILLED", "Đang bật dừng khẩn cấp chat — tắt dừng khẩn cấp rồi duyệt");
  const pv = (ap.preview ?? {}) as Row;
  let dmText = (pv.dmText ?? null) as string | null;
  if (decision === "edit" && edited?.trim()) {
    const t = edited.replace(/\r\n/g, "\n").trim();
    if (t.length < 3 || t.length > 1500) reopen("BAD_TEXT", "Tin inbox phải từ 3 đến 1500 ký tự");
    if (dmText) dmText = t;
  }
  const already = Boolean(lead.meta?.review?.approvedAt);
  logLead(lead, "review_approved", `Sếp đã duyệt${decision === "edit" ? " (có sửa tin inbox)" : ""} — gửi ngay (${actor})`, {
    stage: "new", next_check_at: now.toISOString(), last_error: null,
    meta: { ...(lead.meta ?? {}), review: { ...(lead.meta?.review ?? {}), approvalId: ap.id, replyText: pv.replyText ?? null, dmText, approvedAt: nowIso(), approvedBy: actor, edited: decision === "edit" } },
  });
  if (!already) setReviewApproved(bizId, s.reviewApproved + 1);
  audit(bizId, actor, "nurture.review_approved", { type: "nurture_lead", id: lead.id }, { edited: decision === "edit" });
  try {
    return await runNewLead(bizId, lead, now, { manual: true });
  } catch (e) {
    // Lỗi tạm thời: runNewLead đã dời lịch — tick tự gửi lại đúng câu đã duyệt (vẫn chống trùng bằng giữ chỗ).
    logger.warn("nurture.review_send_deferred", { lead: lead.id, error: errText(e) });
    return { deferred: errText(e) };
  }
}

// ---------------- 3) Bắt SĐT trong Messenger ----------------
/** Hook của chat-engine: tin khách trên hội thoại (Messenger / Instagram DM) đến từ bình luận. Có SĐT → lưu (mã hoá) + xác nhận + lên lịch kết bạn Zalo. */
export async function onNurtureMessage(bizId: string, conv: Row, text: string): Promise<{ reply?: string; meta?: Row } | null> {
  if (conv.channel !== "messenger" && conv.channel !== "instagram") return null;
  const lead = q.get<Row>("SELECT * FROM nurture_lead WHERE biz_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT 1", bizId, conv.id);
  if (!lead) return null;
  if (!lead.customer_replied_at) logLead(lead, "customer_reply", "Khách trả lời inbox", { customer_replied_at: nowIso() });
  if (!["asked_contact", "dm_sent", "no_response"].includes(lead.stage) || lead.phone_cipher) return null;
  const phone = extractVnPhone(text);
  if (!phone) return null;
  if (leadOptedOut(lead)) return null; // khách đã báo không nhận tin → không xác nhận, không kết bạn
  const s = nurtureSettings(bizId);
  if (!s.enabled || isKilled(bizId, "chat")) {
    // Đã tắt chăm khách / dừng khẩn cấp: không lưu SĐT, không xác nhận, không lên lịch kết bạn (tin vẫn ở Hội thoại cho nhân viên).
    logLead(lead, "paused", `Khách gửi SĐT nhưng ${!s.enabled ? "đang tắt chăm khách từ bình luận" : "đang bật dừng khẩn cấp chat"} — không tự xử lý (Sếp có thể nhập SĐT tay)`);
    return null;
  }
  savePhone(bizId, lead, phone, "customer");
  return { reply: fillTemplate(s.confirmTemplate, varsFor(lead)), meta: { leadId: lead.id } };
}
configureNurtureHook(onNurtureMessage);

/** Lưu SĐT (mã hoá + bản che), cập nhật lead bán hàng, lên lịch gửi lời mời kết bạn Zalo (giãn cách ngẫu nhiên). */
export function savePhone(bizId: string, lead: Row, phone: string, by: string) {
  const s = nurtureSettings(bizId);
  const masked = maskPhone(phone);
  const delayMin = s.friendDelayMinMinutes + Math.random() * Math.max(0, s.friendDelayMaxMinutes - s.friendDelayMinMinutes);
  const next = new Date(Date.now() + delayMin * 60_000);
  logLead(lead, "phone", `${by === "customer" ? "Khách để lại" : "Nhập tay"} SĐT ${masked}`, {
    phone_cipher: encryptSecret(phone), phone_masked: masked, phone_at: nowIso(), stage: "has_phone", last_error: null, next_check_at: next.toISOString(),
  });
  if (lead.conversation_id) {
    const conv = byId<Row>("conversation", lead.conversation_id);
    // Bảng lead = sổ khách của Sếp (trang Hội thoại hiện SĐT để gọi lại) → giữ số thật, như chat-engine. Số này chỉ lưu trên máy;
    // mọi chỗ gửi cho AI / nhật ký / audit đều dùng số đã che.
    const ex = q.get<Row>("SELECT id FROM lead WHERE conversation_id = ?", lead.conversation_id);
    if (ex) update("lead", ex.id, { phone });
    else if (conv) insert("lead", { biz_id: bizId, conversation_id: conv.id, name: conv.customer_name, phone, grade: "warm", score: 0.6, reasons: ["Để lại SĐT từ bình luận"], product_interest: null });
    if (conv) update("conversation", conv.id, { tags: [...new Set([...(conv.tags ?? []), "Có SĐT"])] });
  }
  audit(bizId, by === "customer" ? "nurture" : by, "nurture.phone_saved", { type: "nurture_lead", id: lead.id }, { phone: masked });
  emit(bizId, "nurture.phone", { leadId: lead.id });
  if (s.steps.zaloFriend) enqueue("chat", "nurture.zalo_friend", { leadId: lead.id }, { bizId, runAt: next, idempotencyKey: `nurture:friend:${lead.id}`, lockKey: "nurture:zalo" });
}

// ---------------- 4) Kết bạn Zalo qua ZL-CRM ----------------
/** ZL-CRM THẬT (kết nối live) — không có thì không kết bạn (không giả "đã gửi lời mời"). */
export function liveZl(bizId: string): Row | undefined {
  const c = activeZl(bizId);
  return c?.mode === "live" ? c : undefined;
}
/** Danh sách nick lưu lúc kết nối có thể đã cũ (vd kết nối khi ZL-CRM chưa có nick) → trống thì hỏi lại ZL-CRM 1 lần. */
export async function refreshZlNicks(conn: Row): Promise<Row> {
  if (((conn.config?.accounts ?? []) as unknown[]).length) return conn;
  try {
    const accounts = await live.zlcrmAccounts(zlCredsOf(conn));
    const config = { ...(conn.config ?? {}), accounts: accounts.map((a) => ({ id: a.id, name: a.displayName, status: a.status })) };
    update("connection", conn.id, { config });
    return { ...conn, config };
  } catch (e) {
    logger.warn("nurture.zl_accounts_failed", { error: errText(e) });
    return conn;
  }
}
const zlCredsOf = (conn: Row) => ({ ...(conn.config ?? {}), ...credsOf(conn) }) as live.ZlCreds;
function pickNick(bizId: string, conn: Row): { id: string; name: string | null } | null {
  const s = nurtureSettings(bizId);
  const accounts = (conn.config?.accounts ?? []) as { id: string; name?: string; status?: string }[];
  if (s.zaloAccountId) return { id: s.zaloAccountId, name: accounts.find((a) => a.id === s.zaloAccountId)?.name ?? null };
  const a = accounts.find((x) => !x.status || x.status === "connected") ?? accounts[0];
  if (a) return { id: a.id, name: a.name ?? null };
  return null;
}

const FRIEND_LEASE_MS = 30 * 60_000;
/** Lỗi gửi kết bạn (ZL-CRM 5xx, phiên Zalo hết hạn, 4xx…): thử lại giãn dần, quá 5 lần → dừng (failed). */
const MAX_FRIEND_ATTEMPTS = 5;
const FRIEND_BACKOFF_MS = [30 * 60_000, hours(2), hours(6), hours(12)];
const backoffLabel = (ms: number) => (ms < hours(1) ? `${Math.round(ms / 60_000)} phút` : `${Math.round(ms / hours(1))} giờ`);
/** ZL-CRM cắt lời chào kết bạn ở 150 ký tự → cắt trước (không cắt đôi emoji) để ghi lại đúng câu đã gửi. */
export const ZALO_GREETING_MAX = 150;
export function truncateGreeting(text: string) {
  if (text.length <= ZALO_GREETING_MAX) return text;
  let t = text.slice(0, ZALO_GREETING_MAX);
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return t.trimEnd();
}
function friendRequestFailed(bizId: string, lead: Row, fromStage: string, attempt: number, e: unknown, now: Date, force: boolean) {
  const raw = errText(e);
  const msg = e instanceof ConnectorError && /\b503\b/.test(raw) ? `${raw} (có thể phiên Zalo của nick đã hết hạn — đăng nhập lại nick trong ZL-CRM)` : raw;
  if (!force && attempt >= MAX_FRIEND_ATTEMPTS) {
    logLead(lead, "failed", `Gửi kết bạn Zalo lỗi ${attempt} lần — dừng tự động (lỗi cuối: ${msg})`, { stage: "failed", next_check_at: null, last_error: msg });
    audit(bizId, "nurture", "nurture.friend_failed", { type: "nurture_lead", id: lead.id }, { attempts: attempt, error: msg, phone: lead.phone_masked });
  } else {
    const wait = FRIEND_BACKOFF_MS[Math.min(attempt - 1, FRIEND_BACKOFF_MS.length - 1)];
    logLead(lead, "error", `Gửi kết bạn Zalo lỗi (lần ${attempt}${force ? ", bấm tay" : `/${MAX_FRIEND_ATTEMPTS}`}): ${msg}${force ? "" : ` — thử lại sau ${backoffLabel(wait)}`}`,
      { stage: fromStage, next_check_at: new Date(now.getTime() + wait).toISOString(), last_error: msg });
  }
  if (force) throw e;
  return { deferred: "error" as const };
}
/** Nhịp kiểm tra "khách đã đồng ý kết bạn chưa": 20 phút trong 2 giờ đầu, rồi mỗi giờ, sau 1 ngày thì 6 giờ/lần. */
export function friendCheckInterval(sinceRequestMs: number) {
  if (sinceRequestMs < hours(2)) return 20 * 60_000;
  if (sinceRequestMs < hours(24)) return hours(1);
  return hours(6);
}

/** Gửi lời mời kết bạn Zalo (job nurture.zalo_friend + tick). force = Sếp bấm "Kết bạn ngay" (bỏ qua giờ yên lặng & hẹn giờ). */
export async function tryFriendRequest(bizId: string, leadId: string, opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const lead = byId<Row>("nurture_lead", leadId);
  if (!lead || lead.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy khách", 404);
  const s = nurtureSettings(bizId);
  // Đã tắt chăm khách: job/tick đã xếp trước đó không làm gì (Sếp bấm tay "Kết bạn ngay" vẫn được — vẫn theo dừng khẩn cấp).
  if (!opts.force && !s.enabled) { logger.info("nurture.friend_skipped_off", { lead: lead.id }); return { skipped: "off" }; }
  if (!lead.phone_cipher) { if (opts.force) throw new AppError("NO_PHONE", "Khách chưa có SĐT — nhập SĐT trước"); return { skipped: "no_phone" }; }
  if (!opts.force && (lead.stage !== "has_phone" || !s.steps.zaloFriend)) return { skipped: "stage" };
  if (opts.force && !["has_phone", "no_zalo", "failed"].includes(lead.stage)) throw new AppError("BAD_STAGE", "Khách đã được gửi kết bạn hoặc đã dừng");
  if (!opts.force && lead.next_check_at && new Date(lead.next_check_at) > now) return { skipped: "not_due" };
  if (leadOptedOut(lead)) {
    if (opts.force) throw new AppError("OPTED_OUT", "Khách đã báo không muốn nhận tin — không gửi lời mời kết bạn (bỏ khách khỏi danh sách \"không nhận tin\" nếu khách đổi ý)");
    return stopOptedOut(bizId, lead);
  }
  if (isKilled(bizId, "chat")) { update("nurture_lead", lead.id, { last_error: "Đang bật dừng khẩn cấp chat" }); if (opts.force) throw new AppError("KILLED", "Đang bật dừng khẩn cấp chat"); return { deferred: "killed" }; }
  if (!opts.force && inQuiet(bizId, now)) { update("nurture_lead", lead.id, { next_check_at: quietEndAfter(bizId, now).toISOString(), last_error: "Giờ yên lặng — kết bạn sáng mai" }); return { deferred: "quiet" }; }
  const zl0 = liveZl(bizId);
  const conn = zl0 ? await refreshZlNicks(zl0) : undefined;
  if (!conn) { update("nurture_lead", lead.id, { last_error: "Chưa kết nối ZL-CRM thật (Trung tâm tích hợp › ZL-CRM)" }); if (opts.force) throw new AppError("NO_CONNECTION", "Chưa kết nối ZL-CRM thật"); return { deferred: "no_connection" }; }
  const nick = pickNick(bizId, conn);
  if (!nick) { update("nurture_lead", lead.id, { last_error: "ZL-CRM chưa có nick Zalo nào" }); if (opts.force) throw new AppError("NO_NICK", "ZL-CRM chưa có nick Zalo nào"); return { deferred: "no_nick" }; }
  const used = countToday(bizId, "friend_requested_at", "AND zalo_account_id = ?", nick.id);
  if (used >= s.maxFriendRequestsPerNickPerDay) {
    update("nurture_lead", lead.id, { next_check_at: tomorrowMorning(bizId, now).toISOString(), last_error: `Nick đã gửi đủ ${s.maxFriendRequestsPerNickPerDay} lời mời hôm nay — để mai` });
    if (opts.force) throw new AppError("CAPPED", `Nick đã gửi đủ ${s.maxFriendRequestsPerNickPerDay} lời mời kết bạn hôm nay`);
    return { deferred: "cap" };
  }
  // Giữ chỗ NGUYÊN TỬ trước mọi await: job nurture.zalo_friend + tick (hay 2 lượt bấm tay) cùng đến hạn → chỉ 1 lượt
  // được tra SĐT + gửi lời mời. "friend_requesting" có hạn 30 phút (tiến trình chết giữa chừng → tick trả về has_phone).
  const fromStage = String(lead.stage);
  const attempt = opts.force ? 1 : Number(lead.friend_attempts ?? 0) + 1;
  const claimed = Number(q.run("UPDATE nurture_lead SET stage = 'friend_requesting', friend_attempts = ?, next_check_at = ?, updated_at = ? WHERE id = ? AND stage = ?",
    attempt, new Date(now.getTime() + FRIEND_LEASE_MS).toISOString(), nowIso(), lead.id, fromStage).changes) === 1;
  if (!claimed) {
    if (opts.force) throw new AppError("IN_PROGRESS", "Đang gửi lời mời kết bạn cho khách này — chờ chút rồi xem lại");
    return { skipped: "in_progress" };
  }
  const phone = decryptSecret(lead.phone_cipher);
  // ZL-CRM cắt lời chào ở 150 ký tự → tự cắt trước, nhật ký/hội thoại ghi ĐÚNG câu khách nhận.
  const greeting = truncateGreeting(applyBannedChars(fillTemplate(pick(s.friendGreetingTemplates, used + hashOf(lead.id)), varsFor(lead)), activeDna(bizId)));
  let uid: string, already = false;
  {
    const creds = zlCredsOf(conn);
    try {
      // UID Zalo khác nhau theo từng nick → chỉ dùng lại UID đã tra bằng đúng nick này (thử lại không tốn lượt tìm SĐT).
      let found = lead.zalo_uid && lead.zalo_account_id === nick.id ? String(lead.zalo_uid) : null;
      if (!found) {
        const f = await live.zlcrmFindUserByPhone(creds, { zaloAccountId: nick.id, phone });
        // ZL-CRM chỉ trả "không tìm thấy" khi Zalo THẬT SỰ không có tài khoản (phiên hết hạn/lỗi mạng = 503, ném lỗi ở trên).
        if (!f.found || !f.uid) {
          logLead(lead, "no_zalo", `SĐT ${lead.phone_masked} chưa có Zalo (hoặc ẩn tìm kiếm)`, { stage: "no_zalo", zalo_account_id: nick.id, next_check_at: null, last_error: null });
          return { stage: "no_zalo" };
        }
        found = f.uid;
        update("nurture_lead", lead.id, { zalo_uid: found, zalo_account_id: nick.id });
      }
      const r = await live.zlcrmSendFriendRequest(creds, { zaloAccountId: nick.id, userId: found, message: greeting });
      uid = r.uid ?? found;
      already = Boolean(r.alreadyFriend);
    } catch (e) {
      return friendRequestFailed(bizId, lead, fromStage, attempt, e, now, Boolean(opts.force));
    }
  }
  logLead(lead, "friend_request", `Đã gửi lời mời kết bạn Zalo từ nick ${nick.name ?? nick.id}: "${greeting}"`, {
    stage: "friend_requested", zalo_account_id: nick.id, zalo_uid: uid, friend_requested_at: nowIso(), last_error: null,
    next_check_at: new Date(now.getTime() + 20 * 60_000).toISOString(), meta: { ...(lead.meta ?? {}), greeting, nickName: nick.name, connectionMode: conn.mode },
  });
  audit(bizId, opts.force ? "CEO" : "nurture", "nurture.friend_requested", { type: "nurture_lead", id: lead.id }, { nick: nick.id, phone: lead.phone_masked });
  emit(bizId, "nurture.friend_requested", { leadId: lead.id });
  if (already) await onFriendAccepted(bizId, byId<Row>("nurture_lead", lead.id)!);
  return { stage: already ? "following_up" : "friend_requested" };
}

/** Kiểm tra khách đã đồng ý kết bạn chưa (ZL-CRM thật: trạng thái lời mời). */
export async function checkFriendAccepted(bizId: string, lead: Row, now = new Date()) {
  if (lead.stage !== "friend_requested") return false;
  if (!nurtureSettings(bizId).enabled) return false;
  const conn = liveZl(bizId);
  if (!conn) return false;
  const age = now.getTime() - new Date(lead.friend_requested_at).getTime();
  if (age > 7 * 24 * 3600_000) {
    logLead(lead, "stopped", "Khách chưa đồng ý kết bạn sau 7 ngày — dừng", { stage: "stopped", next_check_at: null });
    return false;
  }
  const nextCheck = new Date(now.getTime() + friendCheckInterval(age)).toISOString();
  let accepted = false;
  {
    try {
      const st = await live.zlcrmFriendStatus(zlCredsOf(conn), { zaloAccountId: lead.zalo_account_id, userId: lead.zalo_uid });
      accepted = st.isFriend;
      if (st.status === "rejected") { logLead(lead, "stopped", "Khách từ chối lời mời kết bạn", { stage: "stopped", next_check_at: null }); return false; }
    } catch (e) {
      update("nurture_lead", lead.id, { last_error: errText(e), next_check_at: nextCheck }); // lỗi cũng giãn nhịp, không hỏi lại mỗi 5 phút
      return false;
    }
  }
  if (!accepted) { update("nurture_lead", lead.id, { next_check_at: nextCheck }); return false; }
  await onFriendAccepted(bizId, lead);
  return true;
}

/** Đã là bạn Zalo → hội thoại Zalo (gửi qua đúng nick) + follow_up_plan theo luật follow-up Zalo sẵn có (duyệt nếu đang bật). */
export async function onFriendAccepted(bizId: string, lead: Row) {
  const s = nurtureSettings(bizId);
  const conn = liveZl(bizId);
  logLead(lead, "friend_accepted", "Khách đã đồng ý kết bạn Zalo", { stage: "friend_accepted", friend_accepted_at: nowIso(), next_check_at: null });
  if (!s.steps.zaloFollowUp || !conn) return;
  const extId = `zlu:${lead.zalo_account_id}:${lead.zalo_uid}`;
  let conv = q.get<Row>("SELECT * FROM conversation WHERE biz_id = ? AND channel = 'zalo' AND external_id = ?", bizId, extId);
  const fbConv = lead.conversation_id ? byId<Row>("conversation", lead.conversation_id) : undefined;
  if (!conv) {
    conv = insert("conversation", {
      biz_id: bizId, channel: "zalo", external_id: extId, customer_ref: `cust_${extId}`, customer_name: lead.author_name, state: "awaiting_customer",
      lead_grade: fbConv?.lead_grade ?? "warm", lead_score: fbConv?.lead_score ?? 0.6, intent: fbConv?.intent ?? null, tags: ["Từ bình luận", "Có SĐT"], unread: 0,
      ext: { zaloAccountId: lead.zalo_account_id, zaloAccountName: lead.meta?.nickName ?? null, threadId: lead.zalo_uid, threadType: "user", connectionId: conn.id, nurtureLeadId: lead.id },
      analysis: fbConv?.analysis ?? null,
    });
    if (lead.meta?.greeting) insert("message", { biz_id: bizId, conversation_id: conv.id, direction: "out", sender: "bot", body: { text: lead.meta.greeting }, external_id: null, meta: { kind: "nurture_friend_greeting", leadId: lead.id }, sent_at: lead.friend_requested_at ?? nowIso() });
    // Ngữ cảnh cho AI soạn follow-up: hội thoại Messenger trước đó (đã che SĐT khi gửi model).
    insert("lead", { biz_id: bizId, conversation_id: conv.id, name: lead.author_name, phone: lead.phone_cipher ? decryptSecret(lead.phone_cipher) : null, grade: fbConv?.lead_grade ?? "warm", score: fbConv?.lead_score ?? 0.6, reasons: ["Kết bạn Zalo từ bình luận"], product_interest: q.get<Row>("SELECT product_interest FROM lead WHERE conversation_id = ?", lead.conversation_id ?? "")?.product_interest ?? null });
    const fresh = byId<Row>("conversation", conv.id)!;
    update("conversation", conv.id, { last_message_at: nowIso(), last_preview: String(lead.meta?.greeting ?? "Đã kết bạn Zalo").slice(0, 140) });
    conv = fresh;
  }
  const planned = planFollowUp(bizId, conv, { ...zaloSettings(conn), enabled: true, minGrade: "all" });
  logLead(lead, "follow_up", planned ? "Đã lên lịch follow-up Zalo (theo cài đặt Follow-up Zalo)" : "Hội thoại Zalo đã có lịch follow-up", { stage: "following_up", followup_at: nowIso(), zalo_conversation_id: conv.id });
  emit(bizId, "nurture.following_up", { leadId: lead.id, conversationId: conv.id });
}

// ---------------- Nhắc 1 lần / dừng / có đơn ----------------
/** Nhắc xin SĐT đúng 1 lần — chỉ khi khách ĐÃ trả lời inbox (Messenger chỉ cho nhắn trong 24h kể từ tin cuối của khách). */
export async function maybeRemind(bizId: string, lead: Row, s: NurtureSettings, now: Date) {
  if (!lead.conversation_id || lead.phone_cipher) return;
  const lastCustomer = q.get<Row>("SELECT sent_at FROM message WHERE conversation_id = ? AND sender = 'customer' ORDER BY sent_at DESC LIMIT 1", lead.conversation_id);
  const lastAny = q.get<Row>("SELECT sender, sent_at FROM message WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 1", lead.conversation_id);
  const ref = lead.reminder_sent_at ?? lastCustomer?.sent_at ?? lead.dm_sent_at;
  if (now.getTime() - new Date(ref).getTime() > hours(s.giveUpAfterHours)) {
    logLead(lead, "no_response", lead.customer_replied_at ? "Khách chưa để lại SĐT — dừng chăm" : "Khách chưa trả lời inbox — dừng chăm", { stage: "no_response", next_check_at: null });
    return;
  }
  if (lead.reminder_sent_at || !s.steps.askContact || !lastCustomer || lastAny?.sender === "customer") return; // chờ bot/nhân viên trả lời trước
  if (!s.platforms[leadPlatform(lead)]) return; // Sếp đã tắt chăm khách trên nền tảng này → không tự nhắc
  const since = now.getTime() - new Date(lastCustomer.sent_at).getTime();
  if (since < hours(s.reminderAfterHours) || since > hours(23)) return; // ngoài cửa sổ 24h thì không nhắn
  const conv = byId<Row>("conversation", lead.conversation_id);
  if (!conv || ["human_active", "opted_out", "handoff_pending"].includes(conv.state)) return;
  if (leadOptedOut(lead)) { stopOptedOut(bizId, lead); return; }
  // Đọc lại ngay trước khi gửi: Sếp có thể vừa tắt chăm khách / bật dừng khẩn cấp trong lúc tick đang chạy.
  if (!nurtureSettings(bizId).enabled || isKilled(bizId, "chat")) { logger.info("nurture.reminder_skipped", { lead: lead.id }); return; }
  // Giữ chỗ NGUYÊN TỬ: tick định kỳ + "Chạy ngay" (POST /v1/nurture/run) chạy chồng nhau → chỉ 1 lượt được nhắc.
  const at = nowIso();
  if (Number(q.run("UPDATE nurture_lead SET reminder_sent_at = ?, updated_at = ? WHERE id = ? AND reminder_sent_at IS NULL", at, at, lead.id).changes) !== 1) return;
  const text = fillTemplate(s.reminderTemplate, varsFor(lead));
  try {
    await sendBotMessage(bizId, conv.id, text, { kind: "nurture_reminder", leadId: lead.id }, `nurture:remind:${lead.id}`);
  } catch (e) {
    // Chắc chắn chưa gửi → nhả chỗ để lượt sau nhắc; không rõ kết quả → giữ (thà thiếu 1 lời nhắc còn hơn nhắn trùng).
    if (sendOutcome(e) === "not_sent") q.run("UPDATE nurture_lead SET reminder_sent_at = NULL WHERE id = ? AND reminder_sent_at = ?", lead.id, at);
    else logLead(lead, "error", `Không chắc đã gửi lời nhắc xin SĐT (${errText(e)}) — không nhắc lại`, { last_error: errText(e) });
    throw e;
  }
  logLead(lead, "reminder", `Đã nhắc xin SĐT: "${text}"`, { reminder_sent_at: at });
}

/** Lịch nurture.tick (1 phút): chạy tiếp lead bị hoãn, nhắc SĐT, gửi kết bạn đến hạn, kiểm tra đồng ý kết bạn, đánh dấu có đơn. */
/** Biz đang chạy tick (trong tiến trình): tick định kỳ và "Chạy ngay" không chạy chồng nhau. */
const ticking = new Set<string>();

export async function nurtureTick(bizId: string, now = new Date()) {
  const s = nurtureSettings(bizId);
  const out = { started: 0, reminded: 0, friendRequests: 0, accepted: 0, ordered: 0, errors: 0, busy: false };
  if (!s.enabled) return out;
  if (ticking.has(bizId)) return { ...out, busy: true };
  ticking.add(bizId);
  try {
    return await tickOnce(bizId, s, now, out);
  } finally {
    ticking.delete(bizId);
  }
}

async function tickOnce(bizId: string, s: NurtureSettings, now: Date, out: { started: number; reminded: number; friendRequests: number; accepted: number; ordered: number; errors: number; busy: boolean }) {
  const due = now.toISOString();
  // Lead đến hạn sớm nhất trước; mọi nhánh (hoãn, đang gửi, lỗi) đều dời next_check_at → lead kẹt không chiếm hết 40 chỗ mỗi lượt.
  for (const l of q.all<Row>("SELECT * FROM nurture_lead WHERE biz_id = ? AND stage = 'new' AND (next_check_at IS NULL OR next_check_at <= ?) ORDER BY next_check_at, created_at LIMIT 40", bizId, due)) {
    try { const r = await runNewLead(bizId, l, now); if ("conversationId" in r || r.stage === "replied") out.started++; } catch (e) {
      out.errors++;
      deferNew(l.id, new Date(now.getTime() + 10 * 60_000), errText(e));
    }
  }
  // Chờ duyệt mà mục duyệt đã hết hạn / bị huỷ (Sếp không duyệt kịp 7 ngày) → dừng, ghi rõ lý do.
  for (const l of q.all<Row>(`SELECT * FROM nurture_lead l WHERE biz_id = ? AND stage = 'awaiting_review'
      AND NOT EXISTS (SELECT 1 FROM approval a WHERE a.subject_type = 'nurture_send' AND a.subject_id = l.id AND a.status = 'pending' AND (a.expires_at IS NULL OR a.expires_at > ?))`, bizId, due)) {
    q.run("UPDATE approval SET status = 'expired' WHERE subject_type = 'nurture_send' AND subject_id = ? AND status = 'pending'", l.id);
    logLead(l, "failed", "Mục duyệt hết hạn (quá 7 ngày sau bình luận, Facebook không cho nhắn inbox nữa) — hệ không gửi", { stage: "failed", next_check_at: null, last_error: "Hết hạn duyệt" });
  }
  // Giữ chỗ kết bạn quá hạn (tiến trình chết giữa chừng) → trả về has_phone để thử lại (đã tính 1 lần thử).
  for (const l of q.all<Row>("SELECT * FROM nurture_lead WHERE biz_id = ? AND stage = 'friend_requesting' AND next_check_at <= ?", bizId, due)) {
    logLead(l, "error", "Lần gửi kết bạn trước bị gián đoạn — sẽ thử lại", { stage: "has_phone", next_check_at: due });
  }
  if (!isKilled(bizId, "chat") && !inQuiet(bizId, now)) {
    for (const l of q.all<Row>("SELECT * FROM nurture_lead WHERE biz_id = ? AND stage IN ('asked_contact','dm_sent') ORDER BY dm_sent_at LIMIT 100", bizId)) {
      const before = l.reminder_sent_at;
      try { await maybeRemind(bizId, l, s, now); if (!before && l.reminder_sent_at) out.reminded++; } catch (e) { out.errors++; update("nurture_lead", l.id, { last_error: errText(e) }); }
    }
  }
  // Kết bạn: tối đa 1 lời mời / nick / lượt tick — cộng với độ trễ ngẫu nhiên 3–20 phút của từng khách nên giãn cách tự nhiên.
  const nicksUsed = new Set<string>();
  for (const l of q.all<Row>("SELECT * FROM nurture_lead WHERE biz_id = ? AND stage = 'has_phone' AND (next_check_at IS NULL OR next_check_at <= ?) ORDER BY phone_at LIMIT 20", bizId, due)) {
    const conn = liveZl(bizId);
    const nick = conn ? pickNick(bizId, conn) : null;
    if (nick && nicksUsed.has(nick.id)) continue;
    try { const r = await tryFriendRequest(bizId, l.id, { now }); if ("stage" in r && r.stage !== "no_zalo" && r.stage !== "stopped") { out.friendRequests++; if (nick) nicksUsed.add(nick.id); } } catch (e) { out.errors++; }
  }
  for (const l of q.all<Row>("SELECT * FROM nurture_lead WHERE biz_id = ? AND stage = 'friend_requested' AND (next_check_at IS NULL OR next_check_at <= ?) LIMIT 50", bizId, due)) {
    try { if (await checkFriendAccepted(bizId, l, now)) out.accepted++; } catch (e) { out.errors++; }
  }
  for (const l of q.all<Row>(`SELECT * FROM nurture_lead WHERE biz_id = ? AND ordered_at IS NULL AND (conversation_id IS NOT NULL OR zalo_conversation_id IS NOT NULL)
      AND EXISTS (SELECT 1 FROM orders o WHERE o.status != 'cancelled' AND o.conversation_id IN (nurture_lead.conversation_id, nurture_lead.zalo_conversation_id))`, bizId)) {
    logLead(l, "ordered", "Khách đã có đơn", { stage: "ordered", ordered_at: nowIso(), next_check_at: null });
    out.ordered++;
  }
  return out;
}

// ---------------- Thao tác tay (trang /nurture) ----------------
function mustLead(bizId: string, id: string) {
  const l = byId<Row>("nurture_lead", id);
  if (!l || l.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy khách", 404);
  return l;
}
/** Gửi lại inbox: chưa nhắn được → chạy lại bước inbox; đã nhắn và khách đã trả lời (trong 24h) → gửi lại lời xin SĐT. */
export async function resendDm(bizId: string, id: string, actor: string) {
  const lead = mustLead(bizId, id);
  if (["new", "failed", "replied", "needs_check"].includes(lead.stage) && !lead.dm_sent_at) {
    if (isKilled(bizId, "chat")) throw new AppError("KILLED", "Đang bật dừng khẩn cấp chat");
    // Sếp đã kiểm tra trên Facebook là CHƯA nhắn (needs_check / lượt cũ chết giữa chừng) → nhả giữ chỗ inbox để gửi lại.
    // Trả lời công khai đã giữ chỗ mà chưa rõ kết quả thì KHÔNG trả lời lại (giữ replied_at), chỉ bỏ dấu "đang gửi" của lead.
    // Lead còn "new" đang giữ chỗ thì KHÔNG nhả (lượt khác có thể đang gửi) — runNewLead tự hoãn / chuyển needs_check.
    if (lead.stage === "needs_check") {
      q.run("UPDATE post_comment SET dm_sent_at = NULL WHERE id = ?", lead.comment_id);
      update("nurture_lead", lead.id, { dm_claimed_at: null, reply_claimed_at: null });
      logLead(lead, "dm_retry", `Sếp xác nhận chưa nhắn — gửi lại inbox (${actor})`);
    }
    update("nurture_lead", lead.id, { stage: "new", next_check_at: nowIso(), last_error: null });
    audit(bizId, actor, "nurture.dm_retry", { type: "nurture_lead", id: lead.id });
    return runNewLead(bizId, { ...lead, stage: "new" }, new Date(Math.max(Date.now(), quietSafeNow(bizId))));
  }
  if (!lead.conversation_id) throw new AppError("NO_CONVERSATION", "Chưa có hội thoại inbox với khách này");
  const lastCustomer = q.get<Row>("SELECT sent_at FROM message WHERE conversation_id = ? AND sender = 'customer' ORDER BY sent_at DESC LIMIT 1", lead.conversation_id);
  if (!lastCustomer || Date.now() - new Date(lastCustomer.sent_at).getTime() > 24 * 3600_000)
    throw new AppError("OUTSIDE_WINDOW", "Facebook chỉ cho nhắn tiếp khi khách đã trả lời inbox trong 24 giờ qua (Private Reply chỉ được 1 lần/bình luận)");
  const s = nurtureSettings(bizId);
  const text = fillTemplate(s.reminderTemplate, varsFor(lead));
  await sendBotMessage(bizId, lead.conversation_id, text, { kind: "nurture_reminder", leadId: lead.id, manual: true }, `nurture:resend:${lead.id}:${Date.now()}`);
  logLead(lead, "reminder", `Gửi lại lời xin SĐT (thủ công): "${text}"`, { reminder_sent_at: nowIso(), stage: lead.stage === "no_response" ? "asked_contact" : lead.stage });
  return { ok: true };
}
/** Thao tác tay không bị giờ yên lặng chặn: dùng thời điểm hiện tại nhưng "giả" ngoài giờ yên lặng. */
function quietSafeNow(bizId: string) {
  const now = new Date();
  return inQuiet(bizId, now) ? quietEndAfter(bizId, now).getTime() : now.getTime();
}
export function setPhoneManual(bizId: string, id: string, raw: string, actor: string) {
  const lead = mustLead(bizId, id);
  const phone = normalizeVnPhone(raw);
  if (!phone) throw new AppError("BAD_PHONE", "SĐT không hợp lệ (di động Việt Nam 10 số, vd 0912 345 678)");
  if (["friend_requesting", "friend_requested", "friend_accepted", "following_up", "ordered"].includes(lead.stage)) throw new AppError("BAD_STAGE", "Khách đã ở bước kết bạn Zalo");
  savePhone(bizId, lead, phone, actor);
  return { ok: true, phone: maskPhone(phone) };
}
export function stopLead(bizId: string, id: string, actor: string) {
  const lead = mustLead(bizId, id);
  logLead(lead, "stopped", `Dừng chăm (${actor})`, { stage: "stopped", next_check_at: null });
  q.run("UPDATE approval SET status = 'expired' WHERE subject_type = 'nurture_send' AND subject_id = ? AND status = 'pending'", lead.id);
  if (lead.zalo_conversation_id) {
    q.run("UPDATE follow_up_plan SET status = 'stopped' WHERE conversation_id = ? AND status IN ('active','awaiting_approval')", lead.zalo_conversation_id);
    q.run("UPDATE approval SET status = 'expired' WHERE subject_type = 'follow_up' AND status = 'pending' AND subject_id IN (SELECT id FROM follow_up_plan WHERE conversation_id = ?)", lead.zalo_conversation_id);
  }
  audit(bizId, actor, "nurture.stopped", { type: "nurture_lead", id: lead.id });
  return { ok: true };
}

// ---------------- Báo cáo phễu ----------------
export function nurtureFunnel(bizId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const n = (col: string) => q.scalar<number>(`SELECT COUNT(*) FROM nurture_lead WHERE biz_id = ? AND created_at >= ? AND ${col} IS NOT NULL`, bizId, since);
  return {
    days,
    comments: q.scalar<number>("SELECT COUNT(*) FROM post_comment WHERE biz_id = ? AND created_at >= ? AND COALESCE(label_source, '') != 'system'", bizId, since),
    leads: q.scalar<number>("SELECT COUNT(*) FROM nurture_lead WHERE biz_id = ? AND created_at >= ?", bizId, since),
    replied: n("public_replied_at"),
    dm: n("dm_sent_at"),
    customerReplied: n("customer_replied_at"),
    phone: n("phone_at"),
    friendRequested: n("friend_requested_at"),
    friendAccepted: n("friend_accepted_at"),
    followUp: n("followup_at"),
    ordered: n("ordered_at"),
    /** Không chắc đã gửi (lỗi giữa chừng / tiến trình dừng) — cần Sếp kiểm tra trên Facebook. */
    needsCheck: q.scalar<number>("SELECT COUNT(*) FROM nurture_lead WHERE biz_id = ? AND stage = 'needs_check'", bizId),
    today: {
      replied: countToday(bizId, "public_replied_at", ""), dm: countToday(bizId, "dm_sent_at", ""), friendRequested: countToday(bizId, "friend_requested_at", ""),
    },
    /** Hôm nay theo nền tảng (so với hạn mức riêng của từng nền tảng — mỗi kênh đếm riêng). */
    byPlatform: Object.fromEntries(NURTURE_PLATFORMS.map((pl) => {
      const w = "AND channel_id IN (SELECT id FROM channel WHERE platform = ?)";
      return [pl, {
        leads: q.scalar<number>("SELECT COUNT(*) FROM nurture_lead WHERE biz_id = ? AND created_at >= ? AND channel_id IN (SELECT id FROM channel WHERE platform = ?)", bizId, since, pl),
        repliedToday: countToday(bizId, "public_replied_at", w, pl), dmToday: countToday(bizId, "dm_sent_at", w, pl),
      }];
    })) as Record<NurturePlatform, { leads: number; repliedToday: number; dmToday: number }>,
    stages: q.all<Row>("SELECT stage, COUNT(*) n FROM nurture_lead WHERE biz_id = ? GROUP BY stage", bizId),
  };
}

/** Danh sách lead cho giao diện (không bao giờ trả SĐT thật — chỉ bản che). */
export function listNurtureLeads(bizId: string, opts: { stage?: string; limit?: number } = {}) {
  return q.all<Row>(`SELECT l.id, l.post_id, l.author_name, l.comment_text, l.label, l.stage, l.conversation_id, l.zalo_conversation_id, l.phone_masked,
      l.zalo_account_id, l.public_replied_at, l.dm_sent_at, l.customer_replied_at, l.reminder_sent_at, l.phone_at, l.friend_requested_at, l.friend_accepted_at,
      l.followup_at, l.ordered_at, l.next_check_at, l.last_error, l.friend_attempts, l.created_at, l.updated_at, p.title post_title, p.permalink post_permalink,
      COALESCE(ch.platform, 'facebook') platform, ch.name channel_name
    FROM nurture_lead l LEFT JOIN post p ON p.id = l.post_id LEFT JOIN channel ch ON ch.id = l.channel_id WHERE l.biz_id = ? ${opts.stage ? "AND l.stage = ?" : ""} ORDER BY l.updated_at DESC LIMIT ?`,
  bizId, ...(opts.stage ? [opts.stage] : []), opts.limit ?? 200);
}
export function nurtureLeadDetail(bizId: string, id: string) {
  const l = mustLead(bizId, id);
  const { phone_cipher: _p, ...safeLead } = l;
  return {
    ...safeLead,
    post: q.get("SELECT id, title, permalink FROM post WHERE id = ?", l.post_id),
    messages: l.conversation_id ? q.all("SELECT direction, sender, body, meta, sent_at FROM message WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 30", l.conversation_id).reverse() : [],
    followUps: l.zalo_conversation_id ? q.all("SELECT id, step, status, next_at, meta FROM follow_up_plan WHERE conversation_id = ? ORDER BY created_at DESC", l.zalo_conversation_id) : [],
  };
}

export const NURTURE_HANDLERS: Record<string, Handler> = {
  "nurture.classify": async (p) => {
    const post = byId<Row>("post", p.postId);
    if (!post) return;
    await classifyComments(post);
    const s = nurtureSettings(post.biz_id);
    emit(post.biz_id, "nurture.comments_classified", { postId: post.id });
    if (!s.enabled || p.scanOnly) return;
    enqueueNurtureComments(post, s);
  },
  "nurture.comment": async (p, job) => void (await processNurtureComment(job.biz_id, p.commentId)),
  "nurture.zalo_friend": async (p, job) => void (await tryFriendRequest(job.biz_id, p.leadId)),
  "nurture.tick": async (p) => void (await nurtureTick(p.bizId)),
  "nurture.poll": async (p) => void (await pollBizComments(p.bizId)),
};
