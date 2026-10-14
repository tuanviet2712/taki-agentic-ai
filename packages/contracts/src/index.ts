import { z } from "zod";

// ============ Enums ============
export const AgentKey = z.enum([
  "dna_intake", "brief", "market_research", "strategy", "content", "video_script", "seo_web",
  "creative", "publishing", "post_scanner", "ads", "analytics", "chat", "follow_up", "feedback", "review",
]);
export type AgentKey = z.infer<typeof AgentKey>;

export const Autonomy = z.enum(["L0", "L1", "L2", "L3"]);
export type Autonomy = z.infer<typeof Autonomy>;

export const Channel = z.enum(["facebook", "instagram", "tiktok", "youtube", "zalo", "website", "messenger", "email"]);
export type Channel = z.infer<typeof Channel>;

export const Platform = z.enum(["meta", "tiktok", "google_ads", "pancake", "zalo", "cms", "sheets", "telegram"]);
export type Platform = z.infer<typeof Platform>;

export const TaskStatus = z.enum([
  "pending", "ready", "running", "in_review", "revising", "awaiting_approval",
  "approved", "executing", "done", "failed", "blocked", "cancelled", "rejected", "expired",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const ConversationState = z.enum([
  "new", "bot_active", "awaiting_customer", "handoff_pending", "human_active", "dormant", "resolved", "opted_out",
]);
export type ConversationState = z.infer<typeof ConversationState>;

export const ActionType = z.enum([
  "pause_ad", "resume_ad", "update_budget", "create_ad_from_post", "create_campaign", "publish_post", "send_message", "notify", "tag",
]);
export type ActionType = z.infer<typeof ActionType>;

// ============ Agent output schemas (the contract between agents, spec §10) ============
export const Money = z.object({ amount: z.number().int(), currency: z.literal("VND") });

export const Brief = z.object({
  goal: z.string(),
  kpis: z.array(z.object({ metric: z.string(), target: z.number(), unit: z.string(), by: z.string() })).min(1),
  budget: z.object({ ads: Money }),
  products: z.array(z.string()).min(1),
  channels: z.array(Channel).min(1),
  constraints: z.array(z.string()),
  feasibility: z.object({ verdict: z.enum(["ok", "risky", "unrealistic"]), notes: z.string() }),
  openQuestions: z.array(z.string()),
});
export type Brief = z.infer<typeof Brief>;

export const Research = z.object({
  findings: z.array(z.object({
    claim: z.string(),
    kind: z.enum(["fact", "inference"]),
    sources: z.array(z.string()),
    confidence: z.enum(["high", "medium", "low"]),
  })).min(1),
  competitors: z.array(z.object({ name: z.string(), positioning: z.string(), weakness: z.string() })),
  audience: z.array(z.object({ name: z.string(), pains: z.array(z.string()), triggers: z.array(z.string()) })),
  gaps: z.array(z.string()),
  hypotheses: z.array(z.object({ statement: z.string(), metric: z.string() })),
});
export type Research = z.infer<typeof Research>;

export const Strategy = z.object({
  positioning: z.string(),
  coreMessages: z.array(z.string()).min(1),
  funnel: z.object({ tofu: z.string(), mofu: z.string(), bofu: z.string() }),
  channelPlan: z.array(z.object({ channel: Channel, share: z.number(), role: z.string() })).min(1),
  budgetSplit: z.object({ adsByPlatform: z.array(z.object({ platform: z.string(), amount: z.number().int() })) }),
  options: z.array(z.object({ name: z.string(), tradeoffs: z.string() })).min(2).max(3),
  experiments: z.array(z.object({ hypothesis: z.string(), variable: z.string(), metric: z.string() })),
  fallback: z.string(),
  contentPlan: z.array(z.object({
    channel: Channel,
    format: z.enum(["text", "image", "video", "reel", "article"]),
    topic: z.string(),
    angle: z.string(),
    funnel: z.enum(["tofu", "mofu", "bofu"]),
  })).min(1),
});
export type Strategy = z.infer<typeof Strategy>;

export const ContentItem = z.object({
  channel: Channel,
  format: z.enum(["text", "image", "video", "reel", "article"]),
  title: z.string(),
  variants: z.array(z.object({
    key: z.string(),
    hook: z.string(),
    body: z.string(),
    cta: z.string(),
    hashtags: z.array(z.string()),
  })).min(1),
  facts: z.array(z.object({ statement: z.string(), sourceRef: z.string() })),
  productRefs: z.array(z.string()),
  openQuestions: z.array(z.string()),
});
export type ContentItem = z.infer<typeof ContentItem>;

export const VideoScript = z.object({
  platform: Channel,
  title: z.string(),
  durationSec: z.number(),
  aspect: z.enum(["9:16", "1:1", "16:9"]),
  hooks: z.array(z.string()).min(2),
  scenes: z.array(z.object({
    from: z.number(), to: z.number(), visual: z.string(), voiceover: z.string(), onScreenText: z.string(),
  })).min(1),
  cta: z.string(),
  caption: z.string(),
});
export type VideoScript = z.infer<typeof VideoScript>;

export const SeoArticle = z.object({
  keyword: z.string(),
  intent: z.enum(["info", "commercial", "transactional", "navigational"]),
  title: z.string(),
  metaDescription: z.string(),
  outline: z.array(z.string()).min(3),
  bodyMarkdown: z.string(),
  internalLinks: z.array(z.string()),
});
export type SeoArticle = z.infer<typeof SeoArticle>;

export const ChatReply = z.object({
  reply: z.string(),
  usedSourceRefs: z.array(z.string()),
  wantsHandoff: z.boolean(),
});
export type ChatReply = z.infer<typeof ChatReply>;

export const AdsReport = z.object({
  summary: z.string(),
  kpis: z.array(z.object({ metric: z.string(), value: z.string(), assessment: z.string() })),
  decisions: z.array(z.object({
    adName: z.string(),
    decision: z.enum(["scale", "keep", "fix", "pause"]),
    reason: z.string(),
    budgetChangePct: z.number(),
  })),
  nextTests: z.array(z.string()),
  alerts: z.array(z.string()),
});
export type AdsReport = z.infer<typeof AdsReport>;

// ============ Review (spec §12) ============
export const ReviewResult = z.object({
  subjectType: z.string(),
  subjectId: z.string(),
  rubricKey: z.string(),
  rubricVersion: z.number(),
  deterministic: z.array(z.object({
    check: z.string(), passed: z.boolean(), detail: z.string().optional(), severity: z.enum(["fatal", "major", "minor"]),
  })),
  criteria: z.array(z.object({
    key: z.string(), label: z.string(), score: z.number().min(0).max(1), confidence: z.number().nullable(),
    evidence: z.array(z.string()), source: z.enum(["jev", "heuristic", "llm"]), fix: z.string().optional(),
  })),
  total: z.number().min(0).max(100),
  verdict: z.enum(["pass", "revise", "block", "escalate"]),
  fatalFindings: z.array(z.string()),
});
export type ReviewResult = z.infer<typeof ReviewResult>;

// ============ Rule definition (spec §8) ============
const Cond = z.object({
  metric: z.string(),
  window: z.enum(["today", "3d", "7d", "lifetime"]),
  op: z.enum([">", ">=", "<", "<=", "==", "!="]),
  value: z.number().optional(),
  ref: z.string().optional(), // compare against a reference, e.g. "target_cpa"
  factor: z.number().optional(),
  consecutiveDays: z.number().int().optional(),
});
export type RuleCondition = z.infer<typeof Cond>;
export type ConditionTree = { all?: (RuleCondition | ConditionTree)[]; any?: (RuleCondition | ConditionTree)[] };
export const ConditionTree: z.ZodType<ConditionTree> = z.lazy(() =>
  z.object({ all: z.array(z.union([Cond, ConditionTree])).optional(), any: z.array(z.union([Cond, ConditionTree])).optional() }),
);
export const RuleDefinition = z.object({
  scope: z.object({
    platform: z.enum(["meta", "tiktok", "google_ads", "any"]),
    level: z.enum(["campaign", "ad"]),
    filters: z.array(z.object({ field: z.string(), op: z.enum(["startsWith", "contains", "notContains", "==", "in"]), value: z.string() })).default([]),
  }),
  trigger: z.object({ type: z.enum(["schedule", "event", "manual"]), every: z.string().optional(), event: z.string().optional() }),
  conditions: ConditionTree,
  minData: z.object({ spend: z.number().optional(), impressions: z.number().optional() }).default({}),
  actions: z.array(z.object({
    type: z.enum(["pause_ad", "resume_ad", "budget_change", "notify"]),
    pct: z.number().optional(),
    channel: z.string().optional(),
  })).min(1),
  limits: z.object({ cooldownHours: z.number().default(24), maxActionsPerRun: z.number().default(20), maxActionsPerDay: z.number().default(100) }),
  budgetGuard: z.object({
    maxStepPct: z.number().default(20),
    maxDailyBudgetPerEntity: z.number().default(20_000_000),
    maxTotalDailyBudget: z.number().default(80_000_000),
  }),
});
export type RuleDefinition = z.infer<typeof RuleDefinition>;

// ============ Canonical metrics (spec §7) ============
export const CanonicalMetrics = z.object({
  spend: z.number(), impressions: z.number(), clicks: z.number(), results: z.number(),
  reach: z.number().optional(), orders: z.number().optional(), revenue: z.number().optional(),
});
export type CanonicalMetrics = z.infer<typeof CanonicalMetrics>;

export const derived = (m: CanonicalMetrics) => ({
  ctr: m.impressions ? m.clicks / m.impressions : null,
  cpm: m.impressions ? (m.spend / m.impressions) * 1000 : null,
  cost_per_result: m.results ? m.spend / m.results : null, // null (not 0) when no results
  roas: m.spend && m.revenue != null ? m.revenue / m.spend : null,
});

// ============ API DTOs ============
export const CreateGoal = z.object({
  title: z.string().min(3),
  description: z.string().min(3),
  template: z.enum(["launch_campaign", "weekly_content"]).default("weekly_content"),
  budgetAds: z.number().int().nonnegative().default(0),
  dueDate: z.string().optional(),
  /** Chạy đến bước này thì dừng (không triển khai các khâu sau) — Sếp bấm "Triển khai tiếp" khi muốn. */
  stopAfter: z.enum(["brief", "market_research", "strategy"]).optional(),
  /** Sản phẩm của chiến dịch (key hoặc tên trong DNA) — bài đăng của chiến dịch gắn đúng link sản phẩm này dưới bình luận. */
  product: z.string().trim().max(160).optional(),
  /** Số bài / kịch bản cần làm (1-30). Bỏ trống: hệ thống tự đọc từ tiêu đề + mô tả ("10 bài SEO", "10 kịch bản video"), không có thì dùng mặc định của mẫu. */
  contentCount: z.number().int().min(1).max(30).optional(),
  /** Loại nội dung: mixed = đa kênh theo kế hoạch · seo = toàn bài SEO website · video = toàn kịch bản video. Bỏ trống: tự đọc từ yêu cầu. */
  contentKind: z.enum(["mixed", "seo", "video"]).optional(),
});
/** Phiếu lên đơn Sếp điền/xác nhận khi duyệt đơn nháp (order_draft) — thông tin giao hàng, số lượng, giá, COD, đẩy Pancake. */
export const OrderForm = z.object({
  fullName: z.string().trim().min(1, "Thiếu tên người nhận").max(120),
  /** Trống khi đẩy lại = giữ SĐT đã lưu. */
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(300).optional(),
  provinceId: z.string().trim().max(20).optional(),
  districtId: z.string().trim().max(20).optional(),
  communeId: z.string().trim().max(20).optional(),
  quantity: z.number().int().min(1).max(999).default(1),
  unitPrice: z.number().int().nonnegative().max(10_000_000_000).optional(),
  discount: z.number().int().nonnegative().max(10_000_000_000).default(0),
  shippingFee: z.number().int().nonnegative().max(100_000_000).default(0),
  /** Tiền thu hộ; bỏ trống = bằng tổng đơn. */
  cod: z.number().int().nonnegative().max(10_000_000_000).optional(),
  note: z.string().trim().max(500).optional(),
  /** Chỉ đẩy sang Pancake khi phiếu nói rõ true. */
  pushToPancake: z.boolean().optional(),
});
export type OrderForm = z.infer<typeof OrderForm>;
export const DecideApproval = z.object({
  decision: z.enum(["approve", "edit", "reject"]),
  note: z.string().optional(),
  editedOutput: z.unknown().optional(),
  orderForm: OrderForm.optional(),
});
export const IncomingMessage = z.object({
  channel: z.enum(["messenger", "zalo", "pancake", "website"]),
  externalConversationId: z.string(),
  customerName: z.string(),
  text: z.string().min(1).max(4000),
  referral: z.object({ adId: z.string().optional(), postId: z.string().optional(), utm: z.string().optional() }).optional(),
  messageId: z.string().optional(),
  /** Facebook Page id that owns a Messenger thread (để gửi tin trả lời bằng page token đúng Fanpage). */
  pageExternalId: z.string().optional(),
  /** Analyse only (lead grade, intent, opt-out) — staff reply in the source tool (e.g. ZL-CRM); the bot stays silent. */
  noReply: z.boolean().optional(),
  /** Chỉ đi kèm `noReply` (bot Messenger đang tắt): nếu kịch bản của sản phẩm ở chế độ "Gợi ý cho nhân viên" thì soạn gợi ý
   *  để nhân viên gửi (KHÔNG BAO GIỜ gửi gì cho khách); các trường hợp khác xử lý như `noReply` thường. */
  suggestOnly: z.boolean().optional(),
  /** Thời điểm khách gửi theo nền tảng (đồng bộ Messenger kéo tin về muộn vài phút). Không có = lúc nhận. */
  sentAt: z.string().optional(),
  /** Ảnh/tệp kèm tin (lưu vào message.meta.attachments; link KHÔNG BAO GIỜ đưa cho model — model chỉ thấy chữ thay thế). */
  attachments: z.array(z.object({
    type: z.enum(["image", "video", "audio", "file", "sticker"]), url: z.string().url().max(2000).optional(),
    name: z.string().max(200).optional(), mime: z.string().max(100).optional(), size: z.number().nonnegative().optional(),
  })).max(10).optional(),
  /** Khách chỉ gửi ảnh/tệp, không có chữ (text = "[Ảnh]"…): lưu + báo chưa đọc. Có ảnh + bật `chat.vision` (và bot Messenger bật)
   *  → bot xem ảnh (mô tả đã che dữ liệu cá nhân) rồi trả lời / chuyển người; ngược lại bot KHÔNG trả lời. */
  attachmentOnly: z.boolean().optional(),
});
export type IncomingMessage = z.infer<typeof IncomingMessage>;

export const AgentConfigUpdate = z.object({
  autonomy: Autonomy.optional(),
  enabled: z.boolean().optional(),
  tokenBudgetDay: z.number().int().positive().optional(),
  model: z.string().min(3).nullable().optional(), // null = follow the tier default
});
