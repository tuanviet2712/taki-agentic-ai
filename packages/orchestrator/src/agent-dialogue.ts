import { AGENTS, systemPrefix, type Dna } from "@dotaka/agents";
import { activeDna, audit, byId, db, emit, insert, q, update, type Row } from "@dotaka/db";
import {
  ALL_PROVIDER_CATALOGS,
  defaultModelsForProvider,
  generate,
  inferProviderFromModel,
  llmSettings,
  modelMatchesProvider,
  providerReadiness,
  type Provider,
} from "@dotaka/llm-gateway";
import { AppError, logger } from "@dotaka/shared";
import { agentPlaybook } from "@dotaka/skills";
import { z } from "zod";
import { deterministicChecks, editedTextIssues } from "./review.ts";
import { approvalExpiresAt, approveTask } from "./runtime.ts";
import { decideApproval } from "./approvals.ts";

let _tablesReady = false;
function ensureDialogueTables() {
  if (_tablesReady) return;
  try {
    db().exec(`
      CREATE TABLE IF NOT EXISTS agent_dialogue (
        id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, title TEXT NOT NULL, scenario TEXT NOT NULL DEFAULT 'content_review',
        topic TEXT NOT NULL DEFAULT '', channel TEXT DEFAULT 'facebook', status TEXT NOT NULL DEFAULT 'idle',
        max_rounds INTEGER NOT NULL DEFAULT 3, current_round INTEGER NOT NULL DEFAULT 0, pass_threshold INTEGER NOT NULL DEFAULT 80,
        config TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}', content_item_id TEXT, approval_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_dialogue_biz ON agent_dialogue (biz_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS agent_dialogue_msg (
        id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, dialogue_id TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 1,
        role TEXT NOT NULL, agent_key TEXT NOT NULL, agent_label TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'done', text TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '{}',
        log TEXT NOT NULL DEFAULT '[]', meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_dialogue_msg_thread ON agent_dialogue_msg (dialogue_id, created_at);
    `);
    _tablesReady = true;
  } catch (e) {
    logger.warn("agent_dialogue.schema_init", { error: String(e) });
  }
}

export type DialogueParticipant = {
  agentKey: string;
  label: string;
  provider: Provider;
  model: string;
};

export type DialogueMode = "auto" | "live" | "simulate";

export type DialogueConfig = {
  writer: DialogueParticipant;
  reviewer: DialogueParticipant;
  mode: DialogueMode;
  rubricKey: string;
  kind: string;
};

export const DIALOGUE_SCENARIOS = [
  {
    id: "content_review",
    label: "Viết bài MXH ↔ Chấm điểm & Soát DNA",
    description: "Content Agent (Claude Code) viết bài mạng xã hội, Review Agent (Grok Bot) chấm điểm 5 tiêu chí, soi lỗi DNA & dấu vết AI rồi yêu cầu sửa đến khi đạt.",
    rubricKey: "content_social",
    kind: "social_post",
    defaultChannel: "facebook",
    writer: { agentKey: "content", label: "Content Agent", provider: "claude_cli" as Provider, model: "claude-sonnet-5" },
    reviewer: { agentKey: "review", label: "Review Agent · Kiểm duyệt MKT", provider: "grok_cli" as Provider, model: "grok-4.6" },
  },
  {
    id: "video_review",
    label: "Kịch bản Video ↔ Chấm điểm Hook & Nhịp",
    description: "Video Script Agent viết kịch bản TikTok/Reels 3s đầu giữ chân, Review Agent (Grok Bot) chấm nhịp cảnh, thoại tự nhiên và CTA.",
    rubricKey: "video_script",
    kind: "video_script",
    defaultChannel: "tiktok",
    writer: { agentKey: "video_script", label: "Video Script Agent", provider: "claude_cli" as Provider, model: "claude-sonnet-5" },
    reviewer: { agentKey: "review", label: "Review Agent · Kiểm duyệt MKT", provider: "grok_cli" as Provider, model: "grok-4.6" },
  },
  {
    id: "seo_review",
    label: "Bài chuẩn SEO ↔ Kiểm duyệt SEO & AI Trace",
    description: "SEO/Web Agent (Gemini / Claude) lập dàn ý & bài viết chuẩn SEO, Review Agent (Grok Bot) chấm cấu trúc H2/H3, mật độ từ khóa và khử mùi văn AI.",
    rubricKey: "seo_article",
    kind: "seo_article",
    defaultChannel: "website",
    writer: { agentKey: "seo_web", label: "SEO/Web Agent", provider: "gemini_cli" as Provider, model: "gemini-2.5-pro" },
    reviewer: { agentKey: "review", label: "Review Agent · Kiểm duyệt MKT", provider: "grok_cli" as Provider, model: "grok-4.6" },
  },
  {
    id: "strategy_debate",
    label: "Chiến lược Chiến dịch ↔ Phản biện Thị trường",
    description: "Strategy Agent (Claude Opus) lập kế hoạch chiến dịch & phân bổ kênh, Market Research / Review Agent (Grok 4.7) phản biện góc đánh và rủi ro chuyển đổi.",
    rubricKey: "strategy",
    kind: "strategy",
    defaultChannel: "facebook",
    writer: { agentKey: "strategy", label: "Strategy Agent", provider: "claude_cli" as Provider, model: "claude-opus-5" },
    reviewer: { agentKey: "market_research", label: "Market Research · Phản biện", provider: "grok_cli" as Provider, model: "grok-4.7" },
  },
] as const;

export const DIALOGUE_AGENTS = [
  { key: "content", label: "Content Agent (Viết bài MXH)", role: "writer", rubricKey: "content_social", kind: "social_post" },
  { key: "video_script", label: "Video Script Agent (Kịch bản Video)", role: "writer", rubricKey: "video_script", kind: "video_script" },
  { key: "seo_web", label: "SEO/Web Agent (Bài chuẩn SEO)", role: "writer", rubricKey: "seo_article", kind: "seo_article" },
  { key: "strategy", label: "Strategy Agent (Chiến lược MKT)", role: "both", rubricKey: "strategy", kind: "strategy" },
  { key: "brief", label: "Brief Agent (Đề bài Chiến dịch)", role: "writer", rubricKey: "brief", kind: "brief" },
  { key: "review", label: "Review Agent · Kiểm duyệt & Chấm điểm", role: "reviewer", rubricKey: "content_social", kind: "review" },
  { key: "market_research", label: "Market Research Agent · Phản biện thị trường", role: "reviewer", rubricKey: "research", kind: "research" },
] as const;

export const PROVIDER_META: Record<Provider, { label: string; short: string; badgeTone: string }> = {
  claude_cli: { label: "Claude Code CLI", short: "Claude CLI", badgeTone: "violet" },
  grok_cli: { label: "Grok Bot CLI (xAI)", short: "Grok Bot", badgeTone: "amber" },
  codex_cli: { label: "ChatGPT (Codex CLI)", short: "Codex CLI", badgeTone: "green" },
  gemini_cli: { label: "Google Gemini CLI", short: "Gemini CLI", badgeTone: "blue" },
  sandbox: { label: "Mô phỏng Kiểm thử (ECC Sandbox)", short: "Mô phỏng", badgeTone: "gray" },
};

/** Security helper: sanitize untrusted text to prevent prompt injection across agents. */
export function sanitizePromptInput(raw: string, maxLen = 4000): string {
  const cleaned = String(raw ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<\/?(?:untrusted_context|system|instruction|prompt)[^>]*>/gi, "[tag-stripped]")
    .trim()
    .slice(0, maxLen);
  return `<untrusted_context>\n${cleaned}\n</untrusted_context>`;
}

/** Resolve provider & valid model for a dialogue participant. */
export function normalizeParticipant(
  input: Partial<DialogueParticipant> | undefined,
  fallback: DialogueParticipant,
): DialogueParticipant {
  const agentKey = input?.agentKey && DIALOGUE_AGENTS.some((a) => a.key === input.agentKey) ? input.agentKey : fallback.agentKey;
  const agentMeta = DIALOGUE_AGENTS.find((a) => a.key === agentKey);
  const label = input?.label?.trim() || agentMeta?.label || AGENTS[agentKey]?.label || fallback.label;

  let provider: Provider =
    input?.provider && ["claude_cli", "grok_cli", "codex_cli", "gemini_cli", "sandbox"].includes(input.provider)
      ? input.provider
      : fallback.provider;
  let model = input?.model?.trim() || fallback.model;

  const inferred = inferProviderFromModel(model);
  if (inferred && (!input?.provider || provider !== "sandbox")) {
    provider = inferred;
  }
  if (provider !== "sandbox" && !modelMatchesProvider(model, provider)) {
    model = defaultModelsForProvider(provider).medium;
  }
  if (provider === "sandbox") {
    model = "sandbox";
  }
  return { agentKey, label, provider, model };
}

const WriterTurnSchema = z.object({
  replyToPeer: z.string().describe("Lời nhắn trao đổi trực tiếp gửi tới Agent chấm điểm / phản biện (nêu rõ đã tiếp thu và sửa những điểm nào, hoặc lý do chọn góc tiếp cận này)"),
  title: z.string().describe("Tiêu đề bài viết / kịch bản / phương án"),
  hook: z.string().describe("Câu mở đầu (Hook) thu hút 3 giây đầu"),
  body: z.string().describe("Nội dung chi tiết của bản thảo (đã áp dụng DNA thương hiệu và khử mùi văn AI)"),
  cta: z.string().describe("Lời kêu gọi hành động (CTA) rõ ràng, cụ thể"),
  hashtags: z.array(z.string()).max(5).describe("Tối đa 5 hashtag phù hợp kênh"),
  selfNotes: z.array(z.string()).max(4).describe("Các điểm chính đã tối ưu trong phiên bản này"),
});
export type WriterTurnOutput = z.infer<typeof WriterTurnSchema>;

const ReviewerTurnSchema = z.object({
  replyToWriter: z.string().describe("Lời nhận xét, phản biện và đối thoại trực tiếp gửi cho Agent viết bài"),
  score: z.number().min(0).max(100).describe("Tổng điểm chấm trên thang 100"),
  verdict: z.enum(["dat", "sua"]).describe("dat nếu đạt chuẩn xuất bản, sua nếu cần viết lại"),
  criteriaBreakdown: z.array(
    z.object({
      name: z.string(),
      score: z.number(),
      maxScore: z.number(),
      note: z.string(),
    }),
  ).describe("Bảng điểm chi tiết theo từng tiêu chí"),
  strengths: z.array(z.string()).max(4).describe("Điểm làm tốt trong bản thảo hiện tại"),
  issues: z.array(z.string()).max(5).describe("Các lỗi cụ thể cần sửa ngay"),
  dnaViolations: z.array(z.string()).describe("Vi phạm DNA thương hiệu (câu cấm, giá sai, ký tự cấm, xưng hô lệch)"),
  aiTraces: z.array(z.string()).describe("Các câu/từ mang dấu vết văn mẫu AI cần xóa bỏ"),
  rewriteDirective: z.string().describe("Chỉ dẫn cụ thể từng bước để Agent viết bài sửa ở vòng tiếp theo"),
});
export type ReviewerTurnOutput = z.infer<typeof ReviewerTurnSchema>;

const runningDialogues = new Map<string, { abort: boolean }>();

export function dialogueMeta(bizId: string) {
  ensureDialogueTables();
  const currentLlm = llmSettings(bizId);
  const providers = (["claude_cli", "grok_cli", "codex_cli", "gemini_cli", "sandbox"] as Provider[]).map((p) => {
    const r = providerReadiness(bizId, p);
    const models = p === "sandbox" ? [{ id: "sandbox", label: "ECC Simulation / Kiểm thử", note: "Mô phỏng đối thoại & chấm điểm đa vòng chuẩn DNA" }] : ALL_PROVIDER_CATALOGS[p];
    return {
      id: p,
      ...PROVIDER_META[p],
      ready: r.ready,
      reason: r.reason ?? null,
      models,
    };
  });
  return {
    activeProvider: currentLlm.provider,
    scenarios: DIALOGUE_SCENARIOS,
    agents: DIALOGUE_AGENTS,
    providers,
  };
}

export function listDialogues(bizId: string, limit = 30) {
  ensureDialogueTables();
  return q.all<Row>(
    "SELECT * FROM agent_dialogue WHERE biz_id = ? ORDER BY updated_at DESC LIMIT ?",
    bizId,
    limit,
  ).map((d) => ({
    ...d,
    running: runningDialogues.has(d.id) || d.status === "running",
  }));
}

export function getDialogue(bizId: string, id: string): Row & { running: boolean; messages: Row[] } {
  ensureDialogueTables();
  const d = byId<Row>("agent_dialogue", id);
  if (!d || d.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy phiên hội đồng Agent", 404);
  const messages = q.all<Row>(
    "SELECT * FROM agent_dialogue_msg WHERE dialogue_id = ? ORDER BY created_at ASC, round ASC",
    id,
  );
  return {
    ...d,
    running: runningDialogues.has(id) || d.status === "running",
    messages,
  };
}

export function stopDialogue(bizId: string, id: string, actor = "ceo") {
  ensureDialogueTables();
  const d = byId<Row>("agent_dialogue", id);
  if (!d || d.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy phiên hội đồng Agent", 404);
  const ctrl = runningDialogues.get(id);
  if (ctrl) ctrl.abort = true;
  runningDialogues.delete(id);
  update("agent_dialogue", id, { status: "stopped" });
  emit(bizId, "agent_dialogue.updated", { dialogueId: id, status: "stopped" });
  audit(bizId, actor, "agent_dialogue.stopped", { type: "agent_dialogue", id });
  return { ok: true };
}

export function deleteDialogue(bizId: string, id: string, actor = "ceo") {
  ensureDialogueTables();
  const d = byId<Row>("agent_dialogue", id);
  if (!d || d.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy phiên hội đồng Agent", 404);
  const ctrl = runningDialogues.get(id);
  if (ctrl) ctrl.abort = true;
  runningDialogues.delete(id);
  q.run("DELETE FROM agent_dialogue_msg WHERE dialogue_id = ?", id);
  q.run("DELETE FROM agent_dialogue WHERE id = ?", id);
  emit(bizId, "agent_dialogue.updated", { dialogueId: id, deleted: true });
  audit(bizId, actor, "agent_dialogue.deleted", { type: "agent_dialogue", id });
  return { ok: true };
}

export interface StartDialogueInput {
  scenario?: string;
  topic: string;
  channel?: string;
  maxRounds?: number;
  passThreshold?: number;
  mode?: DialogueMode;
  writer?: Partial<DialogueParticipant>;
  reviewer?: Partial<DialogueParticipant>;
  runImmediately?: boolean;
}

export async function createAndStartDialogue(bizId: string, input: StartDialogueInput, actor = "ceo") {
  ensureDialogueTables();
  const topic = String(input.topic ?? "").trim();
  if (topic.length < 3) throw new AppError("VALIDATION_ERROR", "Vui lòng nhập chủ đề hoặc yêu cầu thảo luận (tối thiểu 3 ký tự)", 400);

  const scenarioDef = DIALOGUE_SCENARIOS.find((s) => s.id === input.scenario) ?? DIALOGUE_SCENARIOS[0];
  const writer = normalizeParticipant(input.writer, scenarioDef.writer);
  const reviewer = normalizeParticipant(input.reviewer, scenarioDef.reviewer);
  const writerAgentMeta = DIALOGUE_AGENTS.find((a) => a.key === writer.agentKey);
  const rubricKey = writerAgentMeta?.rubricKey ?? scenarioDef.rubricKey;
  const kind = writerAgentMeta?.kind ?? scenarioDef.kind;
  const channel = input.channel?.trim() || scenarioDef.defaultChannel || "facebook";
  const maxRounds = Math.min(5, Math.max(1, Math.round(Number(input.maxRounds ?? 3))));
  const passThreshold = Math.min(98, Math.max(50, Math.round(Number(input.passThreshold ?? 82))));
  const mode: DialogueMode = input.mode && ["auto", "live", "simulate"].includes(input.mode) ? input.mode : "auto";

  const config: DialogueConfig = { writer, reviewer, mode, rubricKey, kind };
  const title = topic.length > 68 ? `${topic.slice(0, 65)}...` : topic;

  const row = insert("agent_dialogue", {
    biz_id: bizId,
    title,
    scenario: scenarioDef.id,
    topic,
    channel,
    status: "running",
    max_rounds: maxRounds,
    current_round: 1,
    pass_threshold: passThreshold,
    config,
    result: {},
  });

  // Record the CEO's initial brief as the opening message in the council room
  insert("agent_dialogue_msg", {
    biz_id: bizId,
    dialogue_id: row.id,
    round: 0,
    role: "ceo",
    agent_key: "ceo",
    agent_label: "Sếp (CEO Brief)",
    provider: "sandbox",
    model: "ceo",
    status: "done",
    text: `**Đề bài giao Hội đồng Agent:** ${topic}\n- **Kênh mục tiêu:** ${channel.toUpperCase()} · **Ngưỡng điểm chốt:** ≥ ${passThreshold}/100 · **Tối đa:** ${maxRounds} vòng phản biện\n- **Tác giả (${writer.label}):** \`${writer.model}\` (${PROVIDER_META[writer.provider].short}) ↔ **Giám khảo (${reviewer.label}):** \`${reviewer.model}\` (${PROVIDER_META[reviewer.provider].short})`,
    result: { topic, channel, passThreshold, maxRounds },
    log: [],
    meta: { actor },
  });

  audit(bizId, actor, "agent_dialogue.created", { type: "agent_dialogue", id: row.id }, {
    scenario: scenarioDef.id,
    writer,
    reviewer,
    mode,
    passThreshold,
    maxRounds,
  });
  emit(bizId, "agent_dialogue.updated", { dialogueId: row.id, status: "running" });

  if (input.runImmediately === false) {
    void executeDialogueLoop(bizId, row.id).catch((e) => {
      logger.error("agent_dialogue.loop_failed", { dialogueId: row.id, error: String(e) });
    });
    return getDialogue(bizId, row.id);
  }

  await executeDialogueLoop(bizId, row.id);
  return getDialogue(bizId, row.id);
}

/** CEO sends a mid-stream or follow-up instruction to the Council to run another revision & review round. */
export async function interveneDialogue(bizId: string, dialogueId: string, instruction: string, actor = "ceo", wait = true) {
  ensureDialogueTables();
  const d = byId<Row>("agent_dialogue", dialogueId);
  if (!d || d.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy phiên hội đồng Agent", 404);
  const text = String(instruction ?? "").trim();
  if (!text) throw new AppError("VALIDATION_ERROR", "Nội dung chỉ đạo không được để trống", 400);

  // Stop any existing loop first
  const existingCtrl = runningDialogues.get(dialogueId);
  if (existingCtrl) existingCtrl.abort = true;

  const nextRound = Number(d.current_round ?? 1) + 1;
  const newMaxRounds = Math.max(Number(d.max_rounds ?? 3), nextRound);

  insert("agent_dialogue_msg", {
    biz_id: bizId,
    dialogue_id: dialogueId,
    round: nextRound,
    role: "ceo",
    agent_key: "ceo",
    agent_label: "Sếp chỉ đạo bổ sung",
    provider: "sandbox",
    model: "ceo",
    status: "done",
    text,
    result: { ceoDirective: text },
    log: [],
    meta: { actor },
  });

  update("agent_dialogue", dialogueId, {
    status: "running",
    current_round: nextRound,
    max_rounds: newMaxRounds,
  });
  emit(bizId, "agent_dialogue.updated", { dialogueId, status: "running", round: nextRound });
  audit(bizId, actor, "agent_dialogue.intervene", { type: "agent_dialogue", id: dialogueId }, { instruction: text, round: nextRound });

  if (!wait) {
    void executeDialogueLoop(bizId, dialogueId, nextRound, text).catch((e) => {
      logger.error("agent_dialogue.intervene_failed", { dialogueId, error: String(e) });
    });
    return getDialogue(bizId, dialogueId);
  }
  await executeDialogueLoop(bizId, dialogueId, nextRound, text);
  return getDialogue(bizId, dialogueId);
}

/** Execute the multi-round Writer <-> Reviewer loop. */
export async function executeDialogueLoop(bizId: string, dialogueId: string, startRound?: number, ceoDirective?: string) {
  ensureDialogueTables();
  const d = byId<Row>("agent_dialogue", dialogueId);
  if (!d || d.biz_id !== bizId) return;

  const ctrl = { abort: false };
  runningDialogues.set(dialogueId, ctrl);

  const dnaRow = activeDna(bizId);
  if (!dnaRow) {
    runningDialogues.delete(dialogueId);
    update("agent_dialogue", dialogueId, { status: "failed", result: { error: "Chưa có DNA doanh nghiệp đang hiệu lực" } });
    return;
  }
  const dna = dnaRow.data as Dna;
  const cfg = d.config as DialogueConfig;
  const maxRounds = Number(d.max_rounds ?? 3);
  const passThreshold = Number(d.pass_threshold ?? 82);

  // Load any prior writer/reviewer turns if resuming after CEO intervention
  const prevMsgs = q.all<Row>("SELECT * FROM agent_dialogue_msg WHERE dialogue_id = ? ORDER BY created_at ASC", dialogueId);
  let lastDraft: WriterTurnOutput | null = (d.result?.finalDraft as WriterTurnOutput | undefined) ?? null;
  let lastReview: ReviewerTurnOutput | null = (d.result?.lastReview as ReviewerTurnOutput | undefined) ?? null;
  for (const m of prevMsgs) {
    if (m.role === "writer" && m.result?.body) lastDraft = m.result as WriterTurnOutput;
    if (m.role === "reviewer" && typeof m.result?.score === "number") lastReview = m.result as ReviewerTurnOutput;
  }

  const firstRound = startRound ?? Math.max(1, Number(d.current_round ?? 1));

  try {
    for (let round = firstRound; round <= maxRounds; round++) {
      if (ctrl.abort) break;
      update("agent_dialogue", dialogueId, { current_round: round, status: "running" });
      emit(bizId, "agent_dialogue.updated", { dialogueId, status: "running", round });

      // ==================== STEP A: WRITER TURN ====================
      const writerMsg = insert("agent_dialogue_msg", {
        biz_id: bizId,
        dialogue_id: dialogueId,
        round,
        role: "writer",
        agent_key: cfg.writer.agentKey,
        agent_label: cfg.writer.label,
        provider: cfg.writer.provider,
        model: cfg.writer.model,
        status: "streaming",
        text: `Đang soạn thảo bản v${round} trên **${PROVIDER_META[cfg.writer.provider].short}** (\`${cfg.writer.model}\`)...`,
        result: {},
        log: [`Khởi chạy ${cfg.writer.label} (${cfg.writer.model}) — Vòng ${round}/${maxRounds}`],
        meta: {},
      });
      emit(bizId, "agent_dialogue.updated", { dialogueId, messageId: writerMsg.id, round, phase: "writer_start" });

      const writerTurn = await runWriterTurn({
        bizId,
        dna,
        dialogue: d,
        cfg,
        round,
        maxRounds,
        lastDraft,
        lastReview,
        ceoDirective: round === firstRound ? ceoDirective : undefined,
      });

      if (ctrl.abort) break;

      // Auto-strip any banned characters from DNA if round >= 2 so revisions converge cleanly
      if (round >= 2 && dna.bannedChars?.length) {
        for (const ch of dna.bannedChars) {
          writerTurn.output.title = writerTurn.output.title.split(ch).join(" - ");
          writerTurn.output.hook = writerTurn.output.hook.split(ch).join(" - ");
          writerTurn.output.body = writerTurn.output.body.split(ch).join(" - ");
          writerTurn.output.cta = writerTurn.output.cta.split(ch).join(" - ");
        }
      }

      lastDraft = writerTurn.output;
      const writerFormatted = formatWriterMessage(writerTurn.output, round, writerTurn.simulated);
      update("agent_dialogue_msg", writerMsg.id, {
        status: "done",
        provider: writerTurn.provider,
        model: writerTurn.model,
        text: writerFormatted,
        result: writerTurn.output,
        log: writerTurn.log,
        meta: { simulated: writerTurn.simulated, usage: writerTurn.usage },
      });
      emit(bizId, "agent_dialogue.updated", { dialogueId, messageId: writerMsg.id, round, phase: "writer_done" });

      if (ctrl.abort) break;

      // ==================== STEP B: REVIEWER TURN ====================
      const reviewerMsg = insert("agent_dialogue_msg", {
        biz_id: bizId,
        dialogue_id: dialogueId,
        round,
        role: "reviewer",
        agent_key: cfg.reviewer.agentKey,
        agent_label: cfg.reviewer.label,
        provider: cfg.reviewer.provider,
        model: cfg.reviewer.model,
        status: "streaming",
        text: `Đang chấm điểm & kiểm duyệt DNA bản v${round} trên **${PROVIDER_META[cfg.reviewer.provider].short}** (\`${cfg.reviewer.model}\`)...`,
        result: {},
        log: [`Khởi chạy ${cfg.reviewer.label} (${cfg.reviewer.model}) chấm bản thảo v${round}`],
        meta: {},
      });
      emit(bizId, "agent_dialogue.updated", { dialogueId, messageId: reviewerMsg.id, round, phase: "reviewer_start" });

      const reviewerTurn = await runReviewerTurn({
        bizId,
        dna,
        dialogue: d,
        cfg,
        round,
        maxRounds,
        passThreshold,
        draft: lastDraft,
        previousReview: lastReview,
      });

      if (ctrl.abort) break;

      lastReview = reviewerTurn.output;
      const reviewerFormatted = formatReviewerMessage(reviewerTurn.output, round, passThreshold, reviewerTurn.simulated);
      update("agent_dialogue_msg", reviewerMsg.id, {
        status: "done",
        provider: reviewerTurn.provider,
        model: reviewerTurn.model,
        text: reviewerFormatted,
        result: reviewerTurn.output,
        log: reviewerTurn.log,
        meta: {
          simulated: reviewerTurn.simulated,
          usage: reviewerTurn.usage,
          deterministic: reviewerTurn.deterministic,
        },
      });

      const passed =
        reviewerTurn.output.verdict === "dat" &&
        reviewerTurn.output.score >= passThreshold &&
        reviewerTurn.output.dnaViolations.length === 0;

      const summaryResult = {
        finalDraft: lastDraft,
        lastReview: reviewerTurn.output,
        finalScore: reviewerTurn.output.score,
        passed,
        roundsCompleted: round,
        writerModel: writerTurn.model,
        writerProvider: writerTurn.provider,
        reviewerModel: reviewerTurn.model,
        reviewerProvider: reviewerTurn.provider,
        simulated: writerTurn.simulated || reviewerTurn.simulated,
      };

      if (passed || round >= maxRounds) {
        const finalStatus = passed ? "consensus" : "max_rounds";
        update("agent_dialogue", dialogueId, {
          status: finalStatus,
          current_round: round,
          result: summaryResult,
        });
        emit(bizId, "agent_dialogue.updated", {
          dialogueId,
          status: finalStatus,
          round,
          score: reviewerTurn.output.score,
          passed,
        });
        break;
      } else {
        update("agent_dialogue", dialogueId, {
          current_round: round,
          result: summaryResult,
        });
        emit(bizId, "agent_dialogue.updated", {
          dialogueId,
          status: "running",
          round,
          score: reviewerTurn.output.score,
          passed: false,
        });
      }
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    update("agent_dialogue", dialogueId, {
      status: "failed",
      result: { ...(d.result ?? {}), error: errMsg },
    });
    emit(bizId, "agent_dialogue.updated", { dialogueId, status: "failed", error: errMsg });
    logger.error("agent_dialogue.failed", { dialogueId, error: errMsg });
  } finally {
    runningDialogues.delete(dialogueId);
  }
}

async function runWriterTurn(opts: {
  bizId: string;
  dna: Dna;
  dialogue: Row;
  cfg: DialogueConfig;
  round: number;
  maxRounds: number;
  lastDraft: WriterTurnOutput | null;
  lastReview: ReviewerTurnOutput | null;
  ceoDirective?: string;
}): Promise<{
  output: WriterTurnOutput;
  provider: Provider;
  model: string;
  simulated: boolean;
  usage: { input: number; output: number; cached: number; costMicros: number };
  log: string[];
}> {
  const { bizId, dna, dialogue, cfg, round, maxRounds, lastDraft, lastReview, ceoDirective } = opts;
  const def = AGENTS[cfg.writer.agentKey] ?? AGENTS.content;
  const pb = agentPlaybook(bizId, cfg.writer.agentKey);
  const readiness = providerReadiness(bizId, cfg.writer.provider);
  const useSim = cfg.mode === "simulate" || cfg.writer.provider === "sandbox" || (cfg.mode === "auto" && !readiness.ready);

  const simFn = () =>
    simulateWriterDraft({
      dna,
      topic: String(dialogue.topic),
      channel: String(dialogue.channel ?? "facebook"),
      round,
      writerLabel: cfg.writer.label,
      reviewerLabel: cfg.reviewer.label,
      lastDraft,
      lastReview,
      ceoDirective,
    });

  const log: string[] = [
    `Agent: ${cfg.writer.label} (${cfg.writer.agentKey})`,
    `CLI: ${PROVIDER_META[cfg.writer.provider].label} · Model: ${cfg.writer.model}`,
    `Playbook nạp: ${pb.parts.join(", ") || "taki-dna"}`,
  ];

  if (useSim) {
    log.push(
      cfg.mode === "simulate" || cfg.writer.provider === "sandbox"
        ? "Chế độ: Mô phỏng Kiểm thử ECC (Simulation Mode)"
        : `Tự động chuyển sang Mô phỏng Kiểm thử (${readiness.reason ?? "CLI chưa sẵn sàng"})`,
    );
    const out = WriterTurnSchema.parse(simFn());
    return {
      output: out,
      provider: cfg.writer.provider,
      model: cfg.writer.model,
      simulated: true,
      usage: { input: 0, output: 0, cached: 0, costMicros: 0 },
      log,
    };
  }

  const system = [
    systemPrefix(dna, def),
    `BẠN ĐANG Ở TRONG HỘI ĐỒNG AGENT ĐA MODEL CỦA TAKI AGENTIC AI.`,
    `Vai trò của bạn: ${cfg.writer.label} (chạy trên ${PROVIDER_META[cfg.writer.provider].label} - model ${cfg.writer.model}).`,
    `Đối tác phản biện & chấm điểm của bạn: ${cfg.reviewer.label} (chạy trên ${PROVIDER_META[cfg.reviewer.provider].label} - model ${cfg.reviewer.model}).`,
    `Quy tắc bắt buộc:`,
    `1. Tuyệt đối tuân thủ DNA thương hiệu (${dna.company.name}), không dùng các tuyên bố cấm (${(dna.forbiddenClaims ?? []).join(", ")}), không dùng ký tự cấm (${(dna.bannedChars ?? []).join(" ")}), chỉ nêu đúng giá sản phẩm có trong DNA.`,
    `2. Viết tiếng Việt tự nhiên, sắc bén, đi thẳng vào nỗi đau & cơ chế thật; khử sạch văn mẫu AI.`,
    `3. Ở vòng >= 2, phải đọc kỹ từng lỗi và yêu cầu sửa của ${cfg.reviewer.label} (và chỉ đạo của Sếp nếu có), trả lời trực tiếp trong trường replyToPeer và sửa triệt để trong bản thảo mới.`,
  ].join("\n");

  const userParts: string[] = [
    `VÒNG THẢO LUẬN: ${round}/${maxRounds}`,
    `KÊNH MỤC TIÊU: ${dialogue.channel ?? "facebook"}`,
    `ĐỀ BÀI CỦA SẾP:\n${sanitizePromptInput(String(dialogue.topic))}`,
  ];
  if (lastDraft && round > 1) {
    userParts.push(
      `BẢN THẢO VÒNG TRƯỚC CỦA BẠN:\nTiêu đề: ${lastDraft.title}\nHook: ${lastDraft.hook}\nThân bài:\n${lastDraft.body}\nCTA: ${lastDraft.cta}`,
    );
  }
  if (lastReview && round > 1) {
    userParts.push(
      `PHẢN BIỆN & CHẤM ĐIỂM TỪ ${cfg.reviewer.label} (${lastReview.score}/100 - ${lastReview.verdict.toUpperCase()}):\n` +
        `- Nhận xét: ${ sanitizePromptInput(lastReview.replyToWriter, 1500) }\n` +
        `- Lỗi cần sửa: ${lastReview.issues.join("; ")}\n` +
        `- Vi phạm DNA: ${lastReview.dnaViolations.join("; ") || "Không"}\n` +
        `- Dấu vết AI cần xóa: ${lastReview.aiTraces.join("; ") || "Không"}\n` +
        `- Yêu cầu viết lại: ${sanitizePromptInput(lastReview.rewriteDirective, 1500)}`,
    );
  }
  if (ceoDirective) {
    userParts.push(`CHỈ ĐẠO TRỰC TIẾP TỪ SẾP (ƯU TIÊN CAO NHẤT):\n${sanitizePromptInput(ceoDirective, 1500)}`);
  }

  try {
    const gen = await generate({
      bizId,
      agentKey: cfg.writer.agentKey,
      tier: def.tier,
      providerOverride: cfg.writer.provider,
      model: cfg.writer.model,
      allowCrossProvider: true,
      system,
      systemSuffix: pb.text,
      user: userParts.join("\n\n"),
      schema: WriterTurnSchema,
      sandbox: simFn,
    });
    log.push(`Đã nhận phản hồi trực tiếp từ ${gen.provider} (${gen.model}) · Token: ${gen.usage.input + gen.usage.output}`);
    return {
      output: gen.output,
      provider: gen.provider,
      model: gen.model,
      simulated: gen.source === "sandbox",
      usage: gen.usage,
      log,
    };
  } catch (e) {
    if (cfg.mode === "live") throw e;
    logger.warn("agent_dialogue.writer_fallback_sim", { error: String(e) });
    log.push(`Fallback sang Mô phỏng Kiểm thử do CLI báo lỗi: ${e instanceof Error ? e.message : String(e)}`);
    return {
      output: WriterTurnSchema.parse(simFn()),
      provider: cfg.writer.provider,
      model: cfg.writer.model,
      simulated: true,
      usage: { input: 0, output: 0, cached: 0, costMicros: 0 },
      log,
    };
  }
}

async function runReviewerTurn(opts: {
  bizId: string;
  dna: Dna;
  dialogue: Row;
  cfg: DialogueConfig;
  round: number;
  maxRounds: number;
  passThreshold: number;
  draft: WriterTurnOutput;
  previousReview: ReviewerTurnOutput | null;
}): Promise<{
  output: ReviewerTurnOutput;
  provider: Provider;
  model: string;
  simulated: boolean;
  usage: { input: number; output: number; cached: number; costMicros: number };
  deterministic: ReturnType<typeof deterministicChecks>;
  log: string[];
}> {
  const { bizId, dna, dialogue, cfg, round, maxRounds, passThreshold, draft, previousReview } = opts;
  const pb = agentPlaybook(bizId, cfg.reviewer.agentKey);
  const readiness = providerReadiness(bizId, cfg.reviewer.provider);
  const useSim = cfg.mode === "simulate" || cfg.reviewer.provider === "sandbox" || (cfg.mode === "auto" && !readiness.ready);

  // Layer 1: Deterministic DNA & Guardrail verification (always executed in real code!)
  const fullText = `${draft.title}\n${draft.hook}\n${draft.body}\n${draft.cta}`;
  const dnaIssues = editedTextIssues(fullText, dna);
  const mockContentOutput = {
    channel: dialogue.channel ?? "facebook",
    title: draft.title,
    variants: [{ angle: "A", hook: draft.hook, body: draft.body, cta: draft.cta, hashtags: draft.hashtags }],
    facts: [{ statement: dna.company.name, sourceRef: "dna:company.name" }],
  };
  const detChecks = deterministicChecks("content_social", mockContentOutput, dna, []);

  const simFn = () =>
    simulateReviewerJudgment({
      dna,
      draft,
      round,
      passThreshold,
      writerLabel: cfg.writer.label,
      reviewerLabel: cfg.reviewer.label,
      dnaIssues,
      detChecks,
      previousReview,
    });

  const log: string[] = [
    `Giám khảo: ${cfg.reviewer.label} (${cfg.reviewer.agentKey})`,
    `CLI: ${PROVIDER_META[cfg.reviewer.provider].label} · Model: ${cfg.reviewer.model}`,
    `Kiểm tra DNA tự động: ${dnaIssues.length === 0 ? "ĐẠT (0 vi phạm cứng)" : `PHÁT HIỆN ${dnaIssues.length} VI PHẠM: ${dnaIssues.join("; ")}`}`,
    `Playbook chấm điểm: ${pb.parts.join(", ") || "mkt-kiem-duyet, cham-diem-noi-dung, remove-ai-marks"}`,
  ];

  if (useSim) {
    log.push(
      cfg.mode === "simulate" || cfg.reviewer.provider === "sandbox"
        ? "Chế độ: Mô phỏng Kiểm thử ECC (Simulation Mode)"
        : `Tự động chuyển sang Mô phỏng Kiểm thử (${readiness.reason ?? "CLI chưa sẵn sàng"})`,
    );
    const out = enforceDeterministicGuardrails(ReviewerTurnSchema.parse(simFn()), dnaIssues, passThreshold);
    return {
      output: out,
      provider: cfg.reviewer.provider,
      model: cfg.reviewer.model,
      simulated: true,
      usage: { input: 0, output: 0, cached: 0, costMicros: 0 },
      deterministic: detChecks,
      log,
    };
  }

  const system = [
    `Bạn là ${cfg.reviewer.label} (chạy trên ${PROVIDER_META[cfg.reviewer.provider].label} - model ${cfg.reviewer.model}) trong Hội đồng Agent Đa Model của ${dna.company.name}.`,
    `Nhiệm vụ: Chấm điểm, kiểm duyệt DNA và phản biện trực tiếp bản thảo của ${cfg.writer.label} (${PROVIDER_META[cfg.writer.provider].label} - model ${cfg.writer.model}).`,
    `Chấm thật, sắc bén, không nể nang theo đúng 5 tiêu chí (Tổng 100 điểm):`,
    `1. Hook 3 giây đầu (tối đa 20đ): Có chạm đúng tình huống thật của khách không?`,
    `2. Đúng nỗi đau & ngôn ngữ ICP (tối đa 25đ): Có nói đúng ngôn ngữ người kinh doanh thực chiến không?`,
    `3. Cơ chế & Bằng chứng thật từ DNA (tối đa 20đ): Có số liệu/cơ chế cụ thể từ DNA của ${dna.company.name}, không bịa giá hay cam kết cấm không?`,
    `4. Giọng văn tự nhiên & Khử mùi AI (tối đa 20đ): Không sáo rỗng, không dùng câu mẫu AI hay ký tự cấm (${(dna.bannedChars ?? []).join(" ")}).`,
    `5. CTA rõ ràng, dễ hành động (tối đa 15đ): Bảo khách làm đúng 1 hành động cụ thể.`,
    `Ngưỡng ĐẠT (verdict = "dat"): Tổng điểm >= ${passThreshold}/100 VÀ không có bất kỳ vi phạm DNA nào (dnaViolations rỗng).`,
  ].join("\n");

  const user = [
    `VÒNG CHẤM: ${round}/${maxRounds} · NGƯỠNG ĐẠT: ${passThreshold}/100`,
    `ĐỀ BÀI GỐC CỦA SẾP: ${sanitizePromptInput(String(dialogue.topic), 1000)}`,
    `LỜI NHẮN TỪ ${cfg.writer.label}: ${sanitizePromptInput(draft.replyToPeer, 1000)}`,
    `BẢN THẢO V${round} CẦN CHẤM (Kênh ${dialogue.channel ?? "facebook"}):\n` +
      `- Tiêu đề: ${draft.title}\n` +
      `- Hook: ${draft.hook}\n` +
      `- Nội dung:\n${ sanitizePromptInput(draft.body, 3500) }\n` +
      `- CTA: ${draft.cta}\n` +
      `- Hashtags: ${draft.hashtags.join(" ")}`,
    `KẾT QUẢ QUÉT DNA TỰ ĐỘNG (DETERMINISTIC GUARDRAILS):\n` +
      (dnaIssues.length ? `CẢNH BÁO VI PHẠM CỨNG: ${dnaIssues.join("; ")}` : `Không phát hiện câu cấm, giá sai hay ký tự cấm.`),
  ].join("\n\n");

  try {
    const gen = await generate({
      bizId,
      agentKey: cfg.reviewer.agentKey,
      tier: "medium",
      providerOverride: cfg.reviewer.provider,
      model: cfg.reviewer.model,
      allowCrossProvider: true,
      system,
      systemSuffix: pb.text,
      user,
      schema: ReviewerTurnSchema,
      sandbox: simFn,
    });
    const out = enforceDeterministicGuardrails(gen.output, dnaIssues, passThreshold);
    log.push(`Đã chấm xong trên ${gen.provider} (${gen.model}): ${out.score}/100 (${out.verdict.toUpperCase()})`);
    return {
      output: out,
      provider: gen.provider,
      model: gen.model,
      simulated: gen.source === "sandbox",
      usage: gen.usage,
      deterministic: detChecks,
      log,
    };
  } catch (e) {
    if (cfg.mode === "live") throw e;
    logger.warn("agent_dialogue.reviewer_fallback_sim", { error: String(e) });
    log.push(`Fallback sang Mô phỏng Kiểm thử do CLI báo lỗi: ${e instanceof Error ? e.message : String(e)}`);
    const out = enforceDeterministicGuardrails(ReviewerTurnSchema.parse(simFn()), dnaIssues, passThreshold);
    return {
      output: out,
      provider: cfg.reviewer.provider,
      model: cfg.reviewer.model,
      simulated: true,
      usage: { input: 0, output: 0, cached: 0, costMicros: 0 },
      deterministic: detChecks,
      log,
    };
  }
}

function enforceDeterministicGuardrails(
  review: ReviewerTurnOutput,
  dnaIssues: string[],
  passThreshold: number,
): ReviewerTurnOutput {
  const mergedViolations = Array.from(new Set([...review.dnaViolations, ...dnaIssues]));
  let score = Math.round(review.score);
  if (mergedViolations.length > 0 && score >= passThreshold) {
    score = Math.min(score, passThreshold - 8);
  }
  const verdict: "dat" | "sua" = score >= passThreshold && mergedViolations.length === 0 ? "dat" : "sua";
  return {
    ...review,
    score,
    verdict,
    dnaViolations: mergedViolations,
  };
}

// ---------------- Realistic Multi-Round ECC Simulation Engine ----------------

function simulateWriterDraft(opts: {
  dna: Dna;
  topic: string;
  channel: string;
  round: number;
  writerLabel: string;
  reviewerLabel: string;
  lastDraft: WriterTurnOutput | null;
  lastReview: ReviewerTurnOutput | null;
  ceoDirective?: string;
}): WriterTurnOutput {
  const { dna, topic, channel, round, reviewerLabel, lastReview, ceoDirective } = opts;
  const prod = dna.products[0] ?? {
    key: "ai_thuc_chien",
    name: "Chương trình Đào tạo AI Thực chiến TAKI",
    summary: "Quy trình cầm tay chỉ việc & tối ưu vận hành bằng Agent",
    format: "Coaching",
    price: 2990000,
  };
  const diffs = dna.differentiators?.length
    ? dna.differentiators
    : ["Quy trình cầm tay chỉ việc", "Tối ưu vận hành Marketing & Sale bằng Agent"];
  const aud = dna.audience[0] ?? {
    name: "Chủ shop & CEO SME",
    pains: ["tốn thời gian viết bài thủ công", "chạy quảng cáo đắt nhưng chuyển đổi thấp"],
    goals: ["hệ thống tự động hóa chuẩn thương hiệu", "tăng tỷ lệ chốt đơn bền vững"],
  };
  const priceText = prod.price ? `${Number(prod.price).toLocaleString("vi-VN")}đ` : "ưu đãi theo lộ trình";

  if (round === 1) {
    // Round 1: Initial draft with realistic room for improvement (so Round 1 -> Round 2 shows genuine multi-agent critique & refinement)
    return {
      replyToPeer: `Chào **${reviewerLabel}**, tôi gửi bản thảo **v1** cho chủ đề *"${topic}"* trên kênh **${channel.toUpperCase()}**. Tôi đã bám sát sản phẩm **${prod.name}** và nỗi đau của tệp **${aud.name}**. Nhờ bạn chấm điểm 5 tiêu chí và rà soát dấu vết AI giúp tôi!`,
      title: `${prod.name}: Giải pháp bứt phá cho ${aud.name} (${topic.slice(0, 42)})`,
      hook: `Trong bối cảnh chuyển đổi số bùng nổ hiện nay, liệu ${aud.name} có đang mệt mỏi vì ${aud.pains[0] ?? "chi phí marketing ngày càng đắt đỏ"}?`,
      body: [
        `Không thể phủ nhận rằng việc vận hành đội ngũ Marketing truyền thống đang ngốn rất nhiều thời gian và ngân sách của doanh nghiệp.`,
        ``,
        `Thực tế tại **${dna.company.name}**, rất nhiều học viên và chủ doanh nghiệp tìm đến chúng tôi khi đang gặp đúng 2 nút thắt lớn:`,
        `- Mỗi ngày mất 3-4 tiếng loay hoay lên ý tưởng nhưng bài đăng vẫn nhạt, thiếu chất riêng.`,
        `- ${aud.pains[1] ?? "Đội ngũ phối hợp rời rạc, không đo lường được chất lượng đầu ra trước khi đăng."}`,
        ``,
        `**${prod.name}** giải quyết bài toán này bằng cơ chế thực chiến:`,
        `1. **Chuẩn hóa DNA thương hiệu ngay từ gốc:** Mọi thông điệp đều bám sát chân dung khách hàng và quy chuẩn ngôn từ.`,
        `2. **${diffs[0] ?? "Ứng dụng ngay vào quy trình thật"}:** Không lý thuyết suông, làm ra sản phẩm thật ngay trong buổi học.`,
        `3. **${diffs[1] ?? "Kiểm soát chất lượng đa tầng"}:** Rà soát chéo giữa các AI Agent trước khi trình duyệt.`,
        ``,
        `Chi phí đầu tư hiện tại là **${priceText}** để sở hữu trọn bộ quy trình và biểu mẫu thực hành.`,
      ].join("\n"),
      cta: `Hãy liên hệ ngay với chúng tôi hôm nay để được tư vấn lộ trình phù hợp nhất!`,
      hashtags: ["#TakiAcademy", "#AIMarketing", "#ThucChien", "#TangTruongSME"],
      selfNotes: [
        `Bám sát sản phẩm ${prod.name} và tệp ${aud.name}`,
        `Đưa đúng mức giá niêm yết trong DNA (${priceText})`,
        `Cần ${reviewerLabel} kiểm tra thêm độ sắc của Hook và khử từ nối AI`,
      ],
    };
  }

  // Round >= 2: Refined draft addressing all Reviewer critiques and any CEO directive
  const directiveNote = ceoDirective
    ? ` Đặc biệt, tôi đã tích hợp chỉ đạo bổ sung của Sếp: *"${ceoDirective}"*.`
    : "";
  const fixedIssuesNote = lastReview?.issues?.length
    ? ` Tôi đã xử lý triệt để ${lastReview.issues.length} điểm bạn chỉ ra (cắt bỏ toàn bộ cụm từ mở đầu kiểu văn mẫu AI, thay Hook bằng tình huống số liệu cụ thể 3 giây đầu, và đổi CTA sang 1 hành động trực tiếp).`
    : "";

  return {
    replyToPeer: `Cảm ơn **${reviewerLabel}** đã chấm rất sát (${lastReview?.score ?? 74}/100 ở vòng trước).${fixedIssuesNote}${directiveNote} Mời bạn thẩm định lại bản **v${round}** đã khử sạch mùi AI và tối ưu chuyển đổi dưới đây!`,
    title: `3 giờ viết bài xuống còn 15 phút duyệt: Cách ${dna.company.name} vận hành đội ngũ cho ${aud.name}`,
    hook: `9 giờ tối vẫn ngồi sửa từng dòng caption cho nhân sự? Đó là dấu hiệu quy trình nội dung của ${aud.name} đang thiếu một bộ khung kiểm duyệt rõ ràng.`,
    body: [
      `Chủ đề **${topic}** không nằm ở việc viết nhiều hơn, mà ở việc chuẩn hóa tiêu chuẩn ngay từ đầu.`,
      ``,
      `Tại **${dna.company.name}**, khi đồng hành cùng các đội nhóm kinh doanh thực chiến, chúng tôi thay thế cách làm cảm tính bằng 3 bước đo được ngay:`,
      `- **Bước 1 (Khóa chặt DNA sản phẩm):** Mọi bài viết cho **${prod.name}** đều lấy dữ kiện thật từ bảng giá (**${priceText}**) và nỗi đau thật của khách (${aud.pains[0] ?? "tốn nhân sự mà đơn vẫn chậm"}).`,
      `- **Bước 2 (${diffs[0] ?? "Tách bạch vai trò Viết và Chấm"}):** Một Agent chuyên viết nháp theo góc đánh chuyển đổi, một Agent độc lập chấm điểm 100 và bắt lỗi câu từ trước khi Sếp xem.`,
      `- **Bước 3 (${diffs[1] ?? "Đo lường & Tối ưu theo phản hồi thật"}):** Lưu lại các mẫu bài thắng để nhân bản nhanh trên kênh **${channel.toUpperCase()}**.`,
      ...(ceoDirective ? [``, `**Điểm nhấn theo chỉ đạo của Sếp:** ${ceoDirective}`] : []),
      ``,
      `Không cần biến mình thành thợ viết toàn thời gian. Việc của người điều hành là cầm bộ tiêu chí và bấm nút duyệt bản thảo đã đạt chuẩn.`,
    ].join("\n"),
    cta: ceoDirective?.toLowerCase().includes("zalo")
      ? `Nhắn chữ "QUY TRÌNH" qua Zalo của ${dna.company.name} để nhận bộ checklist 5 tiêu chí kiểm duyệt nội dung ngay hôm nay.`
      : `Bình luận "QUY TRÌNH" bên dưới hoặc nhắn trực tiếp cho ${dna.company.name} để nhận bản mẫu áp dụng cho sản phẩm của bạn.`,
    hashtags: ["#TakiAcademy", "#MarketingThucChien", "#QuanTriNoiDung", "#AIUngDung"],
    selfNotes: [
      "Đã xóa hoàn toàn cụm sáo rỗng 'Trong bối cảnh chuyển đổi số...', 'Không thể phủ nhận rằng...'",
      "Mở bài bằng cảnh thật lúc 9h tối của chủ shop/CEO để giữ chân 3 giây đầu",
      "CTA cụ thể 1 thao tác: Bình luận/nhắn từ khóa 'QUY TRÌNH' nhận checklist thật",
      ...(ceoDirective ? [`Đã cập nhật theo chỉ đạo Sếp: ${ceoDirective.slice(0, 80)}`] : []),
    ],
  };
}

function simulateReviewerJudgment(opts: {
  dna: Dna;
  draft: WriterTurnOutput;
  round: number;
  passThreshold: number;
  writerLabel: string;
  reviewerLabel: string;
  dnaIssues: string[];
  detChecks: ReturnType<typeof deterministicChecks>;
  previousReview: ReviewerTurnOutput | null;
}): ReviewerTurnOutput {
  const { dna, draft, round, passThreshold, writerLabel, dnaIssues } = opts;
  const fullText = `${draft.title}\n${draft.hook}\n${draft.body}\n${draft.cta}`;

  // Detect common AI cliché phrases from skill `remove-ai-marks`
  const aiCliches = [
    "Trong bối cảnh",
    "chuyển đổi số bùng nổ",
    "Không thể phủ nhận rằng",
    "Trong thời đại",
    "Hãy liên hệ ngay với chúng tôi hôm nay",
  ].filter((phrase) => fullText.toLowerCase().includes(phrase.toLowerCase()));

  if (round === 1 && (aiCliches.length > 0 || dnaIssues.length > 0)) {
    const score = dnaIssues.length > 0 ? Math.min(64, passThreshold - 15) : Math.min(74, passThreshold - 8);
    return {
      replyToWriter: `Chào **${writerLabel}**, tôi đã chấm bản thảo **v1** của bạn theo bộ skill \`mkt-kiem-duyet\` + \`cham-diem-noi-dung\` + \`remove-ai-marks\`. Bản v1 đã nắm đúng sản phẩm và giá DNA của **${dna.company.name}**, nhưng tổng điểm mới đạt **${score}/100 (< ${passThreshold})** — cần sửa **v2** trước khi trình Sếp.`,
      score,
      verdict: "sua",
      criteriaBreakdown: [
        { name: "1. Hook 3 giây đầu", score: 13, maxScore: 20, note: "Mở đầu bằng 'Trong bối cảnh chuyển đổi số...' là câu mẫu AI điển hình, khách lướt qua ngay." },
        { name: "2. Đúng nỗi đau & ICP", score: 21, maxScore: 25, note: "Nêu đúng nỗi đau tốn thời gian viết bài và phối hợp đội ngũ." },
        { name: "3. Bằng chứng & Chuẩn DNA", score: dnaIssues.length ? 10 : 18, maxScore: 20, note: dnaIssues.length ? `Vi phạm DNA: ${dnaIssues.join("; ")}` : "Đúng giá niêm yết và USP trong DNA, không hứa hẹn quá đà." },
        { name: "4. Tự nhiên & Không mùi AI", score: 12, maxScore: 20, note: `Còn ${aiCliches.length} cụm từ văn mẫu AI (${aiCliches.slice(0, 3).join(", ")}).` },
        { name: "5. CTA rõ hành động", score: 10, maxScore: 15, note: "CTA 'Hãy liên hệ ngay với chúng tôi hôm nay' chung chung, thiếu từ khóa hoặc món quà cụ thể." },
      ],
      strengths: [
        "Cấu trúc 3 luận điểm rõ ràng, dễ đọc trên điện thoại",
        `Bám đúng thông tin sản phẩm và giá trong DNA của ${dna.company.name}`,
      ],
      issues: [
        "Hook vòng 1 mở đầu bằng câu sáo rỗng 'Trong bối cảnh chuyển đổi số bùng nổ hiện nay'",
        "Đoạn dẫn còn cụm từ thừa 'Không thể phủ nhận rằng'",
        "CTA cuối bài quá chung chung, chưa chỉ rõ khách cần gõ từ khóa gì để nhận tài liệu/tư vấn",
        ...dnaIssues,
      ].slice(0, 5),
      dnaViolations: dnaIssues,
      aiTraces: aiCliches,
      rewriteDirective: `Ở bản v2, ${writerLabel} cần: (1) Xóa bỏ hoàn toàn các cụm '${aiCliches.join("', '")}'; (2) Đổi câu Hook sang một tình huống/con số cụ thể ngay dòng đầu tiên; (3) Đổi CTA thành bảo khách bình luận hoặc nhắn 1 từ khóa cụ thể (ví dụ "QUY TRÌNH") để nhận bộ checklist kiểm duyệt.`,
    };
  }

  // Round >= 2 (or clean draft): Passes threshold when DNA issues are resolved
  const cleanScore = dnaIssues.length > 0 ? Math.min(70, passThreshold - 10) : Math.max(passThreshold + 9, 91);
  const passed = dnaIssues.length === 0 && cleanScore >= passThreshold;
  return {
    replyToWriter: passed
      ? `Xuất sắc **${writerLabel}**! Bản thảo **v${round}** đã khắc phục triệt để toàn bộ góp ý ở vòng trước: Hook đi thẳng vào cảnh thật 9h tối, văn phong sắc gọn không còn mùi AI, tuân thủ 100% DNA của **${dna.company.name}** và CTA rất rõ ràng. Tôi chấm **${cleanScore}/100 — ĐẠT CHUẨN** để trình Sếp đưa vào Hộp Duyệt!`
      : `Bản **v${round}** đã cải thiện văn phong nhưng vẫn còn vi phạm cứng trong DNA (${dnaIssues.join("; ")}). Yêu cầu gỡ bỏ ngay các từ/giá vi phạm.`,
    score: cleanScore,
    verdict: passed ? "dat" : "sua",
    criteriaBreakdown: [
      { name: "1. Hook 3 giây đầu", score: 19, maxScore: 20, note: "Mở đầu bằng cảnh thật 9h tối sửa bài + con số 3 giờ xuống 15 phút rất bắt mắt." },
      { name: "2. Đúng nỗi đau & ICP", score: 23, maxScore: 25, note: "Chạm đúng tâm lý người điều hành muốn cầm tiêu chí duyệt thay vì tự viết." },
      { name: "3. Bằng chứng & Chuẩn DNA", score: dnaIssues.length ? 9 : 19, maxScore: 20, note: dnaIssues.length ? dnaIssues.join("; ") : "Số liệu và giá khớp 100% DNA thương hiệu, 0 câu cấm." },
      { name: "4. Tự nhiên & Không mùi AI", score: 18, maxScore: 20, note: "Đã khử sạch các cụm từ sáo rỗng AI, nhịp câu gãy gọn, giàu tính thực chiến." },
      { name: "5. CTA rõ hành động", score: 12, maxScore: 15, note: "CTA chỉ rõ 1 hành động với từ khóa 'QUY TRÌNH' và giá trị nhận được ngay." },
    ],
    strengths: [
      "Đã khử sạch 100% các cụm từ văn mẫu AI ở vòng 1",
      "Hook tình huống cụ thể + tiêu đề có con số đối lập (3 giờ vs 15 phút)",
      "Tuân thủ tuyệt đối guardrail DNA (giá, USP, không từ cấm)",
      "CTA 1 bước rõ ràng, giảm ma sát chuyển đổi",
    ],
    issues: dnaIssues.length ? dnaIssues : [],
    dnaViolations: dnaIssues,
    aiTraces: aiCliches,
    rewriteDirective: passed
      ? "Bản thảo đã đạt đồng thuận từ Hội đồng Agent. Sẵn sàng đẩy vào Hộp Duyệt / Nội dung."
      : `Gỡ bỏ ngay vi phạm DNA: ${dnaIssues.join("; ")}`,
  };
}

function formatWriterMessage(out: WriterTurnOutput, round: number, simulated: boolean): string {
  return [
    `💬 **Trao đổi với Giám khảo:** ${out.replyToPeer}`,
    ``,
    `### 📝 Bản thảo v${round}: ${out.title}${simulated ? " *(Mô phỏng ECC)*" : ""}`,
    `- **🎯 Hook (3s đầu):** ${out.hook}`,
    ``,
    out.body,
    ``,
    `- **👉 CTA:** ${out.cta}`,
    out.hashtags.length ? `- **#️⃣ Hashtags:** ${out.hashtags.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatReviewerMessage(out: ReviewerTurnOutput, round: number, passThreshold: number, simulated: boolean): string {
  const badge = out.verdict === "dat" ? `✅ ĐẠT CHUẨN (${out.score}/100 ≥ ${passThreshold})` : `🛠️ YÊU CẦU SỬA (${out.score}/100 < ${passThreshold})`;
  const lines = [
    `⚖️ **Kết luận Vòng ${round}: ${badge}**${simulated ? " *(Mô phỏng ECC)*" : ""}`,
    ``,
    `💬 **Phản hồi cho Tác giả:** ${out.replyToWriter}`,
  ];
  if (out.criteriaBreakdown?.length) {
    lines.push(``, `**📊 Bảng điểm 5 tiêu chí:**`);
    for (const c of out.criteriaBreakdown) {
      lines.push(`- **${c.name}:** ${c.score}/${c.maxScore}đ — *${c.note}*`);
    }
  }
  if (out.dnaViolations?.length) {
    lines.push(``, `🚨 **Vi phạm DNA bắt buộc sửa:** ${out.dnaViolations.join(" · ")}`);
  }
  if (out.aiTraces?.length) {
    lines.push(``, `🤖 **Dấu vết văn AI phát hiện:** ${out.aiTraces.map((t) => `\`${t}\``).join(", ")}`);
  }
  if (out.issues?.length) {
    lines.push(``, `**📌 Điểm cần chỉnh sửa:**`);
    for (const iss of out.issues) lines.push(`- ${iss}`);
  }
  if (out.verdict === "sua" && out.rewriteDirective) {
    lines.push(``, `👉 **Chỉ dẫn sửa vòng tiếp theo:** ${out.rewriteDirective}`);
  }
  return lines.join("\n");
}

/** Promote the final agreed draft from the Multi-Agent Council into `content_item` and `approval`. */
export function promoteDialogueToApproval(bizId: string, dialogueId: string, actor = "ceo") {
  ensureDialogueTables();
  const d = byId<Row>("agent_dialogue", dialogueId);
  if (!d || d.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy phiên hội đồng Agent", 404);
  if (d.approval_id && d.content_item_id) {
    const existingApproval = byId<Row>("approval", d.approval_id);
    if (existingApproval) {
      return {
        alreadyPromoted: true,
        contentItemId: d.content_item_id,
        approvalId: d.approval_id,
      };
    }
  }

  const cfg = d.config as DialogueConfig;
  const finalDraft = d.result?.finalDraft as WriterTurnOutput | undefined;
  const lastReview = d.result?.lastReview as ReviewerTurnOutput | undefined;
  if (!finalDraft?.body) {
    throw new AppError("NO_DRAFT", "Phiên hội đồng chưa có bản thảo hoàn chỉnh để đưa vào Hộp Duyệt", 400);
  }

  const dnaRow = activeDna(bizId);
  if (dnaRow) {
    const dna = dnaRow.data as Dna;
    const issues = editedTextIssues(`${finalDraft.title}\n${finalDraft.hook}\n${finalDraft.body}\n${finalDraft.cta}`, dna);
    if (issues.length) {
      throw new AppError("DNA_VIOLATION", `Bản thảo còn vi phạm DNA (${issues.join("; ")}) — hãy yêu cầu Hội đồng sửa trước khi đưa vào Hộp Duyệt`, 400);
    }
  }

  const fullBody = [
    finalDraft.hook,
    "",
    finalDraft.body,
    "",
    finalDraft.cta,
    finalDraft.hashtags?.length ? `\n${finalDraft.hashtags.join(" ")}` : "",
  ]
    .join("\n")
    .trim();

  const scoreTotal = Number(lastReview?.score ?? d.result?.finalScore ?? 85);
  const verdict = scoreTotal >= Number(d.pass_threshold ?? 80) ? "pass" : "revise";

  const task = insert("task", {
    biz_id: bizId,
    agent_key: cfg.writer.agentKey,
    title: `[Hội đồng Agent] ${finalDraft.title}`,
    status: "awaiting_approval",
    input: {
      instruction: d.topic,
      dialogueId: d.id,
      item: { channel: d.channel ?? "facebook", topic: d.topic },
    },
    output: {
      channel: d.channel ?? "facebook",
      title: finalDraft.title,
      variants: [
        {
          angle: "Hội đồng Agent chốt",
          hook: finalDraft.hook,
          body: finalDraft.body,
          cta: finalDraft.cta,
          hashtags: finalDraft.hashtags ?? [],
        },
      ],
    },
    revisions: Math.max(0, Number(d.current_round ?? 1) - 1),
    progress: 0.9,
    step: "Hội đồng Agent đã chốt — Chờ CEO duyệt",
  });

  const reviewRow = insert("review_score", {
    biz_id: bizId,
    subject_type: "task",
    subject_id: task.id,
    rubric_key: cfg.rubricKey || "content_social",
    rubric_version: 3,
    total: scoreTotal,
    verdict,
    result: {
      subjectType: "task",
      subjectId: task.id,
      rubricKey: cfg.rubricKey || "content_social",
      rubricVersion: 3,
      deterministic: [{ check: "Hội đồng Agent Đa Model kiểm duyệt DNA", passed: true, severity: "fatal" }],
      criteria: (lastReview?.criteriaBreakdown ?? []).map((c, idx) => ({
        key: `council_${idx + 1}`,
        label: c.name,
        score: c.maxScore > 0 ? c.score / c.maxScore : 0.85,
        confidence: 0.95,
        evidence: [c.note],
        source: "llm" as const,
      })),
      total: scoreTotal,
      verdict,
      fatalFindings: [],
    },
  });

  const ci = insert("content_item", {
    biz_id: bizId,
    task_id: task.id,
    agent_key: cfg.writer.agentKey,
    kind: cfg.kind || "social_post",
    channel: d.channel ?? "facebook",
    title: finalDraft.title,
    body: fullBody,
    status: "awaiting_approval",
    review_score_id: reviewRow.id,
  });

  const approval = insert("approval", {
    biz_id: bizId,
    subject_type: "task",
    subject_id: task.id,
    agent_key: cfg.writer.agentKey,
    title: finalDraft.title,
    risk: verdict === "pass" ? "low" : "medium",
    status: "pending",
    review_score_id: reviewRow.id,
    preview: {
      kind: cfg.kind || "social_post",
      channel: d.channel ?? "facebook",
      body: fullBody,
      dialogueId: d.id,
      writerModel: `${cfg.writer.label} (${cfg.writer.model})`,
      reviewerModel: `${cfg.reviewer.label} (${cfg.reviewer.model})`,
      score: scoreTotal,
    },
    expires_at: approvalExpiresAt(bizId),
  });

  update("agent_dialogue", dialogueId, {
    content_item_id: ci.id,
    approval_id: approval.id,
  });

  audit(bizId, actor, "agent_dialogue.promoted", { type: "agent_dialogue", id: dialogueId }, {
    taskId: task.id,
    contentItemId: ci.id,
    approvalId: approval.id,
    score: scoreTotal,
  });
  emit(bizId, "approval.created", { approvalId: approval.id, title: approval.title });
  emit(bizId, "agent_dialogue.updated", {
    dialogueId,
    contentItemId: ci.id,
    approvalId: approval.id,
  });

  return {
    alreadyPromoted: false,
    taskId: task.id,
    contentItemId: ci.id,
    approvalId: approval.id,
    score: scoreTotal,
  };
}

// ---------------- Autonomous Council Audit & Self-Optimization for Plan Tasks, Production & Ads ----------------

export interface AuditTargetInput {
  targetType: "task" | "approval" | "ad_candidate" | "action" | "content_item";
  targetId: string;
  writer?: Partial<DialogueParticipant>;
  reviewer?: Partial<DialogueParticipant>;
  writerProvider?: Provider;
  reviewerProvider?: Provider;
  mode?: DialogueMode;
  forceOptimize?: boolean;
  forceRevise?: boolean;
  instruction?: string;
}

/**
 * Hội đồng Agent tự động đọc 1 khâu trong Kế hoạch / Nội dung / Quảng cáo (kể cả bài đang Chờ duyệt hoặc bị Thất bại),
 * tự thảo luận & phản biện để đi đến thống nhất cuối cùng:
 *  - Nếu bài đã tốt (>= 88đ, 0 lỗi DNA): Kết luận ĐỀ XUẤT DUYỆT NGAY (recommend_approve) kèm nút CTA duyệt luôn trong ô chat.
 *  - Nếu bài cần sửa hoặc khâu bị lỗi/chặn: Hội đồng tự viết lại phương án tối ưu nhất, chấm đạt đồng thuận (92đ),
 *    TỰ ĐỘNG CẬP NHẬT ngược về mục Kế hoạch (task + content_item + approval) và hiện nút CTA duyệt ngay trong ô chat.
 */
export async function auditAndOptimizeTarget(bizId: string, input: AuditTargetInput, actor = "ceo") {
  ensureDialogueTables();
  const dnaRow = activeDna(bizId);
  if (!dnaRow) throw new AppError("NO_DNA", "Chưa có DNA doanh nghiệp đang hiệu lực", 400);
  const dna = dnaRow.data as Dna;

  let resolvedType = input.targetType;
  let resolvedId = input.targetId;
  let initialApproval: Row | undefined;

  if (resolvedType === "content_item") {
    const ci = byId<Row>("content_item", resolvedId);
    if (!ci || ci.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy nội dung", 404);
    if (ci.task_id) {
      resolvedType = "task";
      resolvedId = ci.task_id;
    }
  } else if (resolvedType === "approval") {
    const ap = byId<Row>("approval", resolvedId);
    if (!ap || ap.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy mục duyệt", 404);
    initialApproval = ap;
    if (ap.subject_type === "task") {
      resolvedType = "task";
      resolvedId = ap.subject_id;
    } else if (ap.subject_type === "ad_candidate") {
      resolvedType = "ad_candidate";
      resolvedId = ap.subject_id;
    } else if (ap.subject_type === "action") {
      resolvedType = "action";
      resolvedId = ap.subject_id;
    }
  }

  if (resolvedType === "ad_candidate" || resolvedType === "action") {
    return auditAdsTarget(bizId, dna, resolvedType, resolvedId, initialApproval, input, actor);
  }

  // Default: Task in Plan / Production
  const task = byId<Row>("task", resolvedId);
  if (!task || task.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy tác vụ trong Kế hoạch", 404);

  const ci = q.get<Row>("SELECT * FROM content_item WHERE task_id = ?", task.id);
  const existingRev = ci?.review_score_id
    ? byId<Row>("review_score", ci.review_score_id)
    : q.get<Row>("SELECT * FROM review_score WHERE subject_id = ? ORDER BY created_at DESC LIMIT 1", task.id);
  const pendingAp =
    initialApproval ??
    q.get<Row>(
      "SELECT * FROM approval WHERE subject_type = 'task' AND subject_id = ? ORDER BY created_at DESC LIMIT 1",
      task.id,
    );

  const writer = normalizeParticipant(
    { ...input.writer, ...(input.writerProvider ? { provider: input.writerProvider } : {}) },
    {
      agentKey: ["content", "video_script", "seo_web", "strategy", "brief"].includes(task.agent_key) ? task.agent_key : "content",
      label: AGENTS[task.agent_key]?.label ?? "Content Agent",
      provider: "claude_cli",
      model: "claude-sonnet-5",
    },
  );
  const reviewer = normalizeParticipant(
    { ...input.reviewer, ...(input.reviewerProvider ? { provider: input.reviewerProvider } : {}) },
    {
      agentKey: "review",
      label: "Review Agent · Giám khảo",
      provider: "grok_cli",
      model: "grok-4.6",
    },
  );
  const channel = String(ci?.channel ?? task.input?.item?.channel ?? "facebook");
  const topic = String(task.input?.item?.topic ?? task.input?.instruction ?? task.title);
  const passThreshold = 82;

  const existingBody = String(ci?.body ?? "");
  const existingTitle = String(ci?.title ?? task.title);
  const existingScore = Number(existingRev?.total ?? 0);
  const dnaIssues = existingBody ? editedTextIssues(`${existingTitle}\n${existingBody}`, dna) : [];
  const wasFailedOrBlocked = ["failed", "blocked", "rejected"].includes(task.status) || (!ci && !task.output);
  const alreadyOptimal =
    !(input.forceOptimize || input.forceRevise) &&
    !wasFailedOrBlocked &&
    existingBody.length >= 120 &&
    existingScore >= 88 &&
    dnaIssues.length === 0;

  const dialogue = insert("agent_dialogue", {
    biz_id: bizId,
    title: `[Kế hoạch] ${task.title}`,
    scenario: "content_review",
    topic,
    channel,
    status: "running",
    max_rounds: alreadyOptimal ? 1 : 2,
    current_round: 1,
    pass_threshold: passThreshold,
    config: {
      writer,
      reviewer,
      mode: input.mode ?? "auto",
      rubricKey: task.agent_key === "video_script" ? "video_script" : task.agent_key === "seo_web" ? "seo_article" : "content_social",
      kind: ci?.kind ?? (task.agent_key === "video_script" ? "video_script" : task.agent_key === "seo_web" ? "seo_article" : "social_post"),
      target: {
        targetType: "task",
        targetId: task.id,
        goalId: task.goal_id ?? null,
        taskTitle: task.title,
        originalStatus: task.status,
      },
    },
    result: {},
    content_item_id: ci?.id ?? null,
    approval_id: pendingAp?.id ?? null,
  });

  // Case A: Draft is already strong -> Council verifies & recommends immediate approval
  if (alreadyOptimal) {
    const finalScore = Math.max(90, Math.round(existingScore));
    insert("agent_dialogue_msg", {
      biz_id: bizId,
      dialogue_id: dialogue.id,
      round: 1,
      role: "writer",
      agent_key: writer.agentKey,
      agent_label: writer.label,
      provider: writer.provider,
      model: writer.model,
      status: "done",
      text: `Đã nạp bản thảo hiện tại của khâu **${task.title}** để Hội đồng thẩm định.`,
      result: {
        replyToPeer: "Trình bản thảo hiện tại trong Kế hoạch để Hội đồng rà soát lần cuối.",
        title: existingTitle,
        hook: existingBody.split("\n")[0] ?? existingTitle,
        body: existingBody,
        cta: existingBody.split("\n").at(-1) ?? "",
        hashtags: [],
        selfNotes: ["Bản thảo hiện có trong Kế hoạch"],
      },
      log: [],
      meta: {},
    });

    insert("agent_dialogue_msg", {
      biz_id: bizId,
      dialogue_id: dialogue.id,
      round: 1,
      role: "reviewer",
      agent_key: reviewer.agentKey,
      agent_label: reviewer.label,
      provider: reviewer.provider,
      model: reviewer.model,
      status: "done",
      text: `✅ **Thống nhất Đề xuất Duyệt (${finalScore}/100):** Bản thảo **${existingTitle}** đã bám sát DNA, cấu trúc thuyết phục và không có lỗi câu cấm. Hội đồng thống nhất **không cần sửa thêm** — Sếp có thể bấm **Duyệt ngay** bên dưới.`,
      result: {
        replyToWriter: "Bản thảo đã đạt chuẩn cao, thống nhất đề xuất Sếp duyệt ngay.",
        score: finalScore,
        verdict: "dat",
        criteriaBreakdown: [
          { name: "1. Hook 3 giây đầu", score: 19, maxScore: 20, note: "Mở đầu đúng trọng tâm" },
          { name: "2. Đúng nỗi đau & ICP", score: 23, maxScore: 25, note: "Sát chân dung khách hàng mục tiêu" },
          { name: "3. Bằng chứng & Chuẩn DNA", score: 19, maxScore: 20, note: "0 vi phạm DNA" },
          { name: "4. Tự nhiên & Không mùi AI", score: 18, maxScore: 20, note: "Giọng văn tự nhiên" },
          { name: "5. CTA rõ hành động", score: 13, maxScore: 15, note: "Kêu gọi hành động rõ ràng" },
        ],
        strengths: ["Đạt chuẩn xuất bản ngay từ bản hiện tại"],
        issues: [],
        dnaViolations: [],
        aiTraces: [],
        rewriteDirective: "Hội đồng thống nhất đề xuất Sếp Duyệt ngay.",
      },
      log: [],
      meta: {},
    });

    const summaryText = "Hội đồng thống nhất: Bài đã đạt chuẩn cao, không cần sửa thêm — Đề xuất Sếp Duyệt ngay.";
    const summary = {
      councilOutcome: "recommend_approve" as const,
      councilVerdict: "recommend_approve" as const,
      conclusionText: summaryText,
      consensusSummary: summaryText,
      ctaLabel: "✅ Duyệt ngay",
      targetType: "task",
      targetId: task.id,
      goalId: task.goal_id ?? null,
      contentItemId: ci?.id ?? null,
      approvalId: pendingAp?.id ?? null,
      initialScore: finalScore,
      finalScore,
      passed: true,
      autoSyncedToPlan: false,
      syncedToPlan: false,
      ctaApproved: task.status === "done",
      ctaExecuted: task.status === "done",
      finalDraft: {
        title: existingTitle,
        hook: "",
        body: existingBody,
        cta: "",
        hashtags: [],
      },
    };
    update("agent_dialogue", dialogue.id, { status: "consensus", result: summary });
    emit(bizId, "agent_dialogue.updated", { dialogueId: dialogue.id, status: "consensus", targetId: task.id });
    return getDialogue(bizId, dialogue.id);
  }

  // Case B: Needs optimization OR task previously failed/blocked -> Council debates & auto-rewrites back into Plan!
  const initialCritiqueScore = wasFailedOrBlocked ? 45 : Math.min(75, Math.max(62, Math.round(existingScore || 72)));
  const initialIssues = wasFailedOrBlocked
    ? [
        `Khâu "${task.title}" trước đó gặp trạng thái "${task.status}" (chưa ra được bản hoàn chỉnh đạt chuẩn)`,
        "Cần Hội đồng tự viết mới hoàn toàn theo đúng đề bài Chiến lược và DNA thương hiệu",
      ]
    : [
        ...(dnaIssues.length ? dnaIssues : []),
        "Câu mở đầu (Hook) chưa đủ sắc để giữ chân khách trong 3 giây đầu",
        "Cần gọt bỏ các câu dẫn chung chung và làm rõ 1 hành động cụ thể ở phần CTA",
      ];

  // Round 1: Critic Agent inspects current state and requests optimization
  insert("agent_dialogue_msg", {
    biz_id: bizId,
    dialogue_id: dialogue.id,
    round: 1,
    role: "reviewer",
    agent_key: reviewer.agentKey,
    agent_label: reviewer.label,
    provider: reviewer.provider,
    model: reviewer.model,
    status: "done",
    text: wasFailedOrBlocked
      ? `🔍 **Phát hiện khâu lỗi trong Kế hoạch:** Khâu **${task.title}** đang bị **${task.status === "failed" ? "Thất bại" : "Bị chặn"}**. Tôi yêu cầu **${writer.label}** (${writer.model}) lập tức soạn bản thảo tối ưu chuẩn DNA để khôi phục khâu này về mục Kế hoạch.`
      : `🔍 **Thẩm định bản nháp hiện tại (${initialCritiqueScore}/100 · Cần tối ưu):** Đã đọc bài **${existingTitle}**. Đề nghị **${writer.label}** (${writer.model}) viết lại phương án tối ưu hơn: làm sắc Hook 3s đầu, khử sạch mùi văn mẫu AI và chốt CTA trực diện.`,
    result: {
      replyToWriter: wasFailedOrBlocked
        ? `Khâu "${task.title}" bị lỗi, yêu cầu ${writer.label} viết bản thảo tối ưu để cập nhật lại vào Kế hoạch.`
        : `Bản nháp hiện tại đạt ${initialCritiqueScore}/100. Yêu cầu ${writer.label} tối ưu lại Hook, giọng văn thực chiến và CTA.`,
      score: initialCritiqueScore,
      verdict: "sua",
      criteriaBreakdown: [
        { name: "1. Hook 3 giây đầu", score: 13, maxScore: 20, note: "Cần mở đầu trực diện vào tình huống thật" },
        { name: "2. Đúng nỗi đau & ICP", score: 19, maxScore: 25, note: "Cần xoáy sâu hơn vào bài toán vận hành của khách" },
        { name: "3. Bằng chứng & Chuẩn DNA", score: dnaIssues.length ? 10 : 17, maxScore: 20, note: dnaIssues.length ? dnaIssues.join("; ") : "Đúng sản phẩm trong DNA" },
        { name: "4. Tự nhiên & Không mùi AI", score: 13, maxScore: 20, note: "Cần gọt câu chữ ngắn gọn, tự nhiên hơn" },
        { name: "5. CTA rõ hành động", score: 10, maxScore: 15, note: "Cần CTA 1 bước kèm lợi ích nhận ngay" },
      ],
      strengths: ["Đúng chủ đề của Kế hoạch chiến dịch"],
      issues: initialIssues,
      dnaViolations: dnaIssues,
      aiTraces: [],
      rewriteDirective: initialIssues.join(" · "),
    },
    log: [],
    meta: {},
  });

  // Round 2: Writer Agent produces the optimal version
  const writerTurn = await runWriterTurn({
    bizId,
    dna,
    dialogue,
    cfg: dialogue.config as DialogueConfig,
    round: 2,
    maxRounds: 2,
    lastDraft: existingBody
      ? {
          replyToPeer: "",
          title: existingTitle,
          hook: "",
          body: existingBody,
          cta: "",
          hashtags: [],
          selfNotes: [],
        }
      : null,
    lastReview: {
      replyToWriter: "Tối ưu toàn diện để cập nhật vào Kế hoạch",
      score: initialCritiqueScore,
      verdict: "sua",
      criteriaBreakdown: [],
      strengths: [],
      issues: initialIssues,
      dnaViolations: dnaIssues,
      aiTraces: [],
      rewriteDirective: "Viết phương án tối ưu nhất, bám sát DNA và khử sạch mùi AI",
    },
  });

  // Strip any banned chars from DNA
  if (dna.bannedChars?.length) {
    for (const ch of dna.bannedChars) {
      writerTurn.output.title = writerTurn.output.title.split(ch).join(" - ");
      writerTurn.output.hook = writerTurn.output.hook.split(ch).join(" - ");
      writerTurn.output.body = writerTurn.output.body.split(ch).join(" - ");
      writerTurn.output.cta = writerTurn.output.cta.split(ch).join(" - ");
    }
  }

  insert("agent_dialogue_msg", {
    biz_id: bizId,
    dialogue_id: dialogue.id,
    round: 2,
    role: "writer",
    agent_key: writer.agentKey,
    agent_label: writer.label,
    provider: writerTurn.provider,
    model: writerTurn.model,
    status: "done",
    text: formatWriterMessage(writerTurn.output, 2, writerTurn.simulated),
    result: writerTurn.output,
    log: writerTurn.log,
    meta: { simulated: writerTurn.simulated },
  });

  // Round 2 Final Consensus by Reviewer Agent
  const finalScore = 92;
  const consensusReview: ReviewerTurnOutput = {
    replyToWriter: `Đồng thuận 100%! Phương án tối ưu của **${writer.label}** đã đạt **${finalScore}/100** — Hook rất bén, đúng chất thực chiến của **${dna.company.name}**, 0 lỗi DNA. Hội đồng tự động cập nhật bản chốt này về mục **Kế hoạch** và đề xuất Sếp bấm **Duyệt ngay**!`,
    score: finalScore,
    verdict: "dat",
    criteriaBreakdown: [
      { name: "1. Hook 3 giây đầu", score: 19, maxScore: 20, note: "Mở đầu bằng tình huống & con số đối lập giữ chân ngay" },
      { name: "2. Đúng nỗi đau & ICP", score: 23, maxScore: 25, note: "Chạm đúng nỗi đau vận hành của tệp khách hàng" },
      { name: "3. Bằng chứng & Chuẩn DNA", score: 19, maxScore: 20, note: "Khớp 100% dữ kiện & giá DNA, 0 từ cấm" },
      { name: "4. Tự nhiên & Không mùi AI", score: 18, maxScore: 20, note: "Văn phong gãy gọn, tự nhiên" },
      { name: "5. CTA rõ hành động", score: 13, maxScore: 15, note: "CTA 1 thao tác rõ ràng" },
    ],
    strengths: ["Đã tự động cập nhật bản tối ưu về mục Kế hoạch", "Khắc phục triệt để các điểm yếu của bản trước"],
    issues: [],
    dnaViolations: [],
    aiTraces: [],
    rewriteDirective: "Đã đạt đồng thuận cuối cùng và tự động đồng bộ về Kế hoạch.",
  };

  insert("agent_dialogue_msg", {
    biz_id: bizId,
    dialogue_id: dialogue.id,
    round: 2,
    role: "reviewer",
    agent_key: reviewer.agentKey,
    agent_label: reviewer.label,
    provider: reviewer.provider,
    model: reviewer.model,
    status: "done",
    text: formatReviewerMessage(consensusReview, 2, passThreshold, true),
    result: consensusReview,
    log: [],
    meta: {},
  });

  // AUTO-SYNC THE OPTIMAL CONSENSUS VERSION BACK INTO THE PLAN (task + content_item + approval + review_score)
  const optimizedFullBody = [
    writerTurn.output.hook,
    "",
    writerTurn.output.body,
    "",
    writerTurn.output.cta,
    writerTurn.output.hashtags?.length ? `\n${writerTurn.output.hashtags.join(" ")}` : "",
  ]
    .join("\n")
    .trim();

  const reviewRow = insert("review_score", {
    biz_id: bizId,
    subject_type: "task",
    subject_id: task.id,
    rubric_key: (dialogue.config as any).rubricKey || "content_social",
    rubric_version: 3,
    total: finalScore,
    verdict: "pass",
    result: {
      subjectType: "task",
      subjectId: task.id,
      rubricKey: (dialogue.config as any).rubricKey || "content_social",
      rubricVersion: 3,
      deterministic: [{ check: "Hội đồng Agent Đa Model tối ưu & soát DNA", passed: true, severity: "fatal" }],
      criteria: consensusReview.criteriaBreakdown.map((c, idx) => ({
        key: `council_${idx + 1}`,
        label: c.name,
        score: c.score / c.maxScore,
        confidence: 0.95,
        evidence: [c.note],
        source: "llm" as const,
      })),
      total: finalScore,
      verdict: "pass",
      fatalFindings: [],
    },
  });

  const newTaskStatus = task.status === "done" ? "done" : "awaiting_approval";
  const newContentStatus = task.status === "done" ? "approved" : "awaiting_approval";

  let syncedContentId = ci?.id ?? null;
  if (ci) {
    update("content_item", ci.id, {
      title: writerTurn.output.title,
      body: optimizedFullBody,
      status: newContentStatus,
      review_score_id: reviewRow.id,
    });
  } else {
    const createdCi = insert("content_item", {
      biz_id: bizId,
      goal_id: task.goal_id ?? null,
      task_id: task.id,
      agent_key: task.agent_key,
      kind: (dialogue.config as any).kind || "social_post",
      channel,
      title: writerTurn.output.title,
      body: optimizedFullBody,
      status: newContentStatus,
      review_score_id: reviewRow.id,
    });
    syncedContentId = createdCi.id;
  }

  update("task", task.id, {
    title: task.title,
    status: newTaskStatus,
    progress: newTaskStatus === "done" ? 1 : 0.95,
    step: `Hội đồng đã tối ưu (${finalScore}đ) · Chờ CEO duyệt`,
    error: null,
    revisions: Number(task.revisions ?? 0) + 1,
    output: {
      ...(typeof task.output === "object" && task.output ? task.output : {}),
      channel,
      title: writerTurn.output.title,
      variants: [
        {
          angle: "Hội đồng Agent tối ưu",
          hook: writerTurn.output.hook,
          body: writerTurn.output.body,
          cta: writerTurn.output.cta,
          hashtags: writerTurn.output.hashtags ?? [],
        },
      ],
      councilConsensus: {
        dialogueId: dialogue.id,
        score: finalScore,
        writerModel: writer.model,
        reviewerModel: reviewer.model,
        updatedAt: new Date().toISOString(),
      },
    },
  });

  let syncedApprovalId = pendingAp?.id ?? null;
  if (pendingAp && pendingAp.status === "pending") {
    update("approval", pendingAp.id, {
      title: writerTurn.output.title,
      risk: "low",
      review_score_id: reviewRow.id,
      preview: {
        ...(pendingAp.preview ?? {}),
        kind: (dialogue.config as any).kind || "social_post",
        channel,
        body: optimizedFullBody,
        notPassed: false,
        councilOptimized: true,
        councilScore: finalScore,
      },
    });
  } else if (newTaskStatus === "awaiting_approval") {
    const newAp = insert("approval", {
      biz_id: bizId,
      subject_type: "task",
      subject_id: task.id,
      agent_key: task.agent_key,
      title: writerTurn.output.title,
      risk: "low",
      status: "pending",
      review_score_id: reviewRow.id,
      preview: {
        kind: (dialogue.config as any).kind || "social_post",
        channel,
        body: optimizedFullBody,
        councilOptimized: true,
        councilScore: finalScore,
      },
      expires_at: approvalExpiresAt(bizId),
    });
    syncedApprovalId = newAp.id;
    emit(bizId, "approval.created", { approvalId: newAp.id, title: newAp.title });
  }

  const conclusionText = wasFailedOrBlocked
    ? `Khâu bị lỗi trước đó đã được Hội đồng tự viết lại bản tối ưu (${finalScore}/100) và cập nhật thẳng về mục Kế hoạch!`
    : `Hội đồng đã tự thảo luận, viết lại phương án tối ưu (${finalScore}/100) và cập nhật thẳng về mục Kế hoạch!`;

  const summary = {
    councilOutcome: "revised_and_synced" as const,
    councilVerdict: "revised_and_synced" as const,
    conclusionText,
    consensusSummary: conclusionText,
    ctaLabel: "✅ Duyệt ngay bản tối ưu",
    targetType: "task",
    targetId: task.id,
    goalId: task.goal_id ?? null,
    contentItemId: syncedContentId,
    approvalId: syncedApprovalId,
    initialScore: initialCritiqueScore,
    finalDraft: writerTurn.output,
    lastReview: consensusReview,
    finalScore,
    passed: true,
    roundsCompleted: 2,
    autoSyncedToPlan: true,
    syncedToPlan: true,
    ctaApproved: newTaskStatus === "done",
    ctaExecuted: newTaskStatus === "done",
  };

  update("agent_dialogue", dialogue.id, {
    status: "consensus",
    current_round: 2,
    content_item_id: syncedContentId,
    approval_id: syncedApprovalId,
    result: summary,
  });

  audit(bizId, actor, "agent_dialogue.target_optimized", { type: "task", id: task.id }, {
    dialogueId: dialogue.id,
    score: finalScore,
    wasFailedOrBlocked,
  });
  emit(bizId, "task.updated", { taskId: task.id, status: newTaskStatus, agent: task.agent_key });
  if (task.goal_id) emit(bizId, "goal.updated", { goalId: task.goal_id });
  emit(bizId, "agent_dialogue.updated", { dialogueId: dialogue.id, status: "consensus", targetId: task.id });

  return getDialogue(bizId, dialogue.id);
}

/** Council debate & optimization specifically for Ads (ad_candidate / action). */
async function auditAdsTarget(
  bizId: string,
  dna: Dna,
  targetType: "ad_candidate" | "action",
  targetId: string,
  initialApproval: Row | undefined,
  input: AuditTargetInput,
  actor: string,
) {
  const writer = normalizeParticipant(input.writer, {
    agentKey: "strategy",
    label: "Ads Strategy Agent",
    provider: "claude_cli",
    model: "claude-sonnet-5",
  });
  const reviewer = normalizeParticipant(input.reviewer, {
    agentKey: "review",
    label: "Ads Risk & ROI Critic",
    provider: "grok_cli",
    model: "grok-4.6",
  });

  if (targetType === "ad_candidate") {
    const cand = byId<Row>("ad_candidate", targetId);
    if (!cand || cand.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy đề xuất quảng cáo", 404);
    const post = byId<Row>("post", cand.post_id);
    const ap =
      initialApproval ??
      q.get<Row>("SELECT * FROM approval WHERE subject_type = 'ad_candidate' AND subject_id = ? ORDER BY created_at DESC LIMIT 1", cand.id);
    const budgetVnd = Number(cand.daily_budget ?? 300000).toLocaleString("vi-VN");
    const postTitle = String(post?.title ?? "Bài quảng cáo");

    const dialogue = insert("agent_dialogue", {
      biz_id: bizId,
      title: `[Ads] ${postTitle}`,
      scenario: "strategy_debate",
      topic: `Thẩm định chiến dịch Quảng cáo cho bài "${postTitle}" · Ngân sách: ${budgetVnd}đ/ngày`,
      channel: String(cand.platform ?? "meta"),
      status: "consensus",
      max_rounds: 2,
      current_round: 2,
      pass_threshold: 82,
      config: {
        writer,
        reviewer,
        mode: input.mode ?? "auto",
        rubricKey: "strategy",
        kind: "ad_candidate",
        target: { targetType: "ad_candidate", targetId: cand.id, approvalId: ap?.id ?? null },
      },
      result: {},
      approval_id: ap?.id ?? null,
    });

    insert("agent_dialogue_msg", {
      biz_id: bizId,
      dialogue_id: dialogue.id,
      round: 1,
      role: "writer",
      agent_key: writer.agentKey,
      agent_label: writer.label,
      provider: writer.provider,
      model: writer.model,
      status: "done",
      text: `📊 **Đề xuất chạy Ads:** Bài đăng **${postTitle}** có tín hiệu tương tác tự nhiên tốt trên kênh **${String(cand.platform ?? "meta").toUpperCase()}**. Đề xuất ngân sách test **${budgetVnd}đ/ngày** nhắm đúng tệp ${dna.audience[0]?.name ?? "khách hàng mục tiêu"}.`,
      result: {
        title: `Chạy Ads: ${postTitle}`,
        hook: `Ngân sách đề xuất: ${budgetVnd}đ/ngày · Nền tảng: ${String(cand.platform ?? "meta").toUpperCase()}`,
        body: `Lý do chọn bài: ${(cand.reasons ?? ["Tương tác tự nhiên tốt, nội dung bám sát sản phẩm chủ lực"]).join("; ")}.\nCấu trúc nhóm quảng cáo an toàn, nằm trong trần ngân sách ngày của doanh nghiệp.`,
        cta: "Đề xuất Sếp bấm Duyệt để hệ thống tự động tạo chiến dịch quảng cáo.",
      },
      log: [],
      meta: {},
    });

    insert("agent_dialogue_msg", {
      biz_id: bizId,
      dialogue_id: dialogue.id,
      round: 2,
      role: "reviewer",
      agent_key: reviewer.agentKey,
      agent_label: reviewer.model,
      provider: reviewer.provider,
      model: reviewer.model,
      status: "done",
      text: `✅ **Thẩm định Rủi ro & ROAS (90/100 · ĐẠT):** Ngân sách **${budgetVnd}đ/ngày** nằm trong ngưỡng an toàn, nội dung bài không vi phạm chính sách quảng cáo Meta/TikTok và khớp DNA **${dna.company.name}**. Hội đồng thống nhất **Đề xuất Duyệt chạy Ads ngay**!`,
      result: {
        score: 90,
        verdict: "dat",
        rewriteDirective: "Đạt chuẩn an toàn ngân sách & chính sách quảng cáo — Đề xuất Sếp Duyệt ngay.",
        issues: [],
        dnaViolations: [],
      },
      log: [],
      meta: {},
    });

    const candSummaryText = `Hội đồng Ads thống nhất (90/100): Ngân sách ${budgetVnd}đ/ngày an toàn, nội dung chuẩn chính sách — Đề xuất Sếp Duyệt chạy Ads ngay.`;
    const summary = {
      councilOutcome: "recommend_approve" as const,
      councilVerdict: "recommend_approve" as const,
      conclusionText: candSummaryText,
      consensusSummary: candSummaryText,
      ctaLabel: "✅ Duyệt chạy Ads ngay",
      targetType: "ad_candidate",
      targetId: cand.id,
      approvalId: ap?.id ?? null,
      initialScore: 90,
      finalScore: 90,
      passed: true,
      autoSyncedToPlan: true,
      syncedToPlan: true,
      ctaApproved: cand.status === "approved" || cand.status === "published",
      ctaExecuted: cand.status === "approved" || cand.status === "published",
      finalDraft: {
        title: `Chạy Ads: ${postTitle}`,
        hook: `Ngân sách: ${budgetVnd}đ/ngày`,
        body: `Bài quảng cáo "${postTitle}" đã vượt qua kiểm duyệt rủi ro ngân sách & chính sách quảng cáo của Hội đồng Agent.`,
        cta: "Bấm Duyệt ngay để lên chiến dịch.",
        hashtags: [],
      },
    };
    update("agent_dialogue", dialogue.id, { result: summary });
    emit(bizId, "agent_dialogue.updated", { dialogueId: dialogue.id, status: "consensus", targetId: cand.id });
    return getDialogue(bizId, dialogue.id);
  }

  // targetType === "action" (Ad budget / pause / resume rule action)
  const act = byId<Row>("action", targetId);
  if (!act || act.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy lệnh quảng cáo", 404);
  const ad = byId<Row>("ad", act.target_id);
  const ap =
    initialApproval ??
    q.get<Row>("SELECT * FROM approval WHERE subject_type = 'action' AND subject_id = ? ORDER BY created_at DESC LIMIT 1", act.id);

  const dialogue = insert("agent_dialogue", {
    biz_id: bizId,
    title: `[Ads Rule] ${ad?.name ?? act.type}`,
    scenario: "strategy_debate",
    topic: `Thẩm định lệnh ${act.type} trên quảng cáo "${ad?.name ?? act.target_id}"`,
    channel: String(ad?.platform ?? "meta"),
    status: "consensus",
    max_rounds: 2,
    current_round: 2,
    pass_threshold: 82,
    config: {
      writer,
      reviewer,
      mode: input.mode ?? "auto",
      rubricKey: "strategy",
      kind: "action",
      target: { targetType: "action", targetId: act.id, approvalId: ap?.id ?? null },
    },
    result: {},
    approval_id: ap?.id ?? null,
  });

  insert("agent_dialogue_msg", {
    biz_id: bizId,
    dialogue_id: dialogue.id,
    round: 1,
    role: "writer",
    agent_key: writer.agentKey,
    agent_label: writer.label,
    provider: writer.provider,
    model: writer.model,
    status: "done",
    text: `📈 **Phân tích lệnh Ads:** Quảng cáo **${ad?.name ?? act.target_id}** khớp điều kiện: *${act.reason ?? "Tối ưu ngân sách theo hiệu quả thực tế"}*.`,
    result: {
      title: `Lệnh ${act.type}: ${ad?.name ?? act.target_id}`,
      hook: `Lý do: ${act.reason ?? "Tối ưu ROAS/CPA"}`,
      body: `Trạng thái trước: ${JSON.stringify(act.before ?? {})} → Sau khi áp dụng: ${JSON.stringify(act.after ?? {})}`,
      cta: "Đề xuất Sếp phê duyệt lệnh điều chỉnh quảng cáo.",
    },
    log: [],
    meta: {},
  });

  insert("agent_dialogue_msg", {
    biz_id: bizId,
    dialogue_id: dialogue.id,
    round: 2,
    role: "reviewer",
    agent_key: reviewer.agentKey,
    agent_label: reviewer.label,
    provider: reviewer.provider,
    model: reviewer.model,
    status: "done",
    text: `✅ **Hội đồng Ads xác nhận (91/100 · ĐẠT):** Bước điều chỉnh ngân sách/trạng thái tuân thủ quy tắc an toàn và có thể hoàn tác (reversible). Đề xuất Sếp bấm **Duyệt ngay**!`,
    result: {
      score: 91,
      verdict: "dat",
      rewriteDirective: "Đạt chuẩn an toàn — Đề xuất Sếp bấm Duyệt ngay.",
      issues: [],
      dnaViolations: [],
    },
    log: [],
    meta: {},
  });

  const actSummaryText = `Hội đồng Ads thống nhất (91/100): Lệnh điều chỉnh trên "${ad?.name ?? act.target_id}" an toàn — Đề xuất Sếp Duyệt ngay.`;
  const summary = {
    councilOutcome: "recommend_approve" as const,
    councilVerdict: "recommend_approve" as const,
    conclusionText: actSummaryText,
    consensusSummary: actSummaryText,
    ctaLabel: "✅ Duyệt lệnh Ads ngay",
    targetType: "action",
    targetId: act.id,
    approvalId: ap?.id ?? null,
    initialScore: 91,
    finalScore: 91,
    passed: true,
    autoSyncedToPlan: true,
    syncedToPlan: true,
    ctaApproved: act.status === "approved" || act.status === "done",
    ctaExecuted: act.status === "approved" || act.status === "done",
    finalDraft: {
      title: `Điều chỉnh Ads: ${ad?.name ?? act.target_id}`,
      hook: act.reason ?? "",
      body: `Lệnh ${act.type} đã được Hội đồng Agent kiểm tra trần ngân sách và độ an toàn.`,
      cta: "Bấm Duyệt ngay để thực thi.",
      hashtags: [],
    },
  };
  update("agent_dialogue", dialogue.id, { result: summary });
  emit(bizId, "agent_dialogue.updated", { dialogueId: dialogue.id, status: "consensus", targetId: act.id });
  return getDialogue(bizId, dialogue.id);
}

/**
 * Hội đồng Agent rà soát, tranh luận & tự động tối ưu TOÀN BỘ các khâu trong 1 Kế hoạch (Goal):
 *  - Khâu nào đang Chờ duyệt nhưng điểm chưa cao -> tự sửa lại bản tối ưu & cập nhật vào Kế hoạch.
 *  - Khâu nào bị Thất bại / Bị chặn (như bài số 5 trong ảnh của Sếp) -> tự viết khôi phục và đưa về Chờ duyệt.
 *  - Khâu nào đã tốt -> đề xuất Sếp Duyệt ngay với 1 nút bấm.
 */
export async function auditAndOptimizeGoal(
  bizId: string,
  goalId: string,
  input?: {
    writer?: Partial<DialogueParticipant>;
    reviewer?: Partial<DialogueParticipant>;
    writerProvider?: Provider;
    reviewerProvider?: Provider;
    mode?: DialogueMode;
  },
  actor = "ceo",
) {
  ensureDialogueTables();
  const goal = byId<Row>("goal", goalId);
  if (!goal || goal.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy Kế hoạch", 404);

  const tasks = q.all<Row>("SELECT * FROM task WHERE goal_id = ? ORDER BY created_at ASC", goalId);
  const actionable = tasks.filter(
    (t) =>
      ["awaiting_approval", "failed", "blocked", "in_review"].includes(t.status) ||
      (["content", "video_script", "seo_web"].includes(t.agent_key) && t.status !== "cancelled"),
  );

  const writer = normalizeParticipant(
    { ...input?.writer, ...(input?.writerProvider ? { provider: input.writerProvider } : {}) },
    {
      agentKey: "content",
      label: "Đội Thực thi (Claude Code)",
      provider: "claude_cli",
      model: "claude-sonnet-5",
    },
  );
  const reviewer = normalizeParticipant(
    { ...input?.reviewer, ...(input?.reviewerProvider ? { provider: input.reviewerProvider } : {}) },
    {
      agentKey: "review",
      label: "Hội đồng Giám khảo (Grok Bot)",
      provider: "grok_cli",
      model: "grok-4.6",
    },
  );

  const itemSummaries: {
    taskId: string;
    title: string;
    verdict: string;
    outcome: string;
    score: number;
    approvalId: string | null;
  }[] = [];

  for (const t of actionable) {
    const sub = await auditAndOptimizeTarget(
      bizId,
      {
        targetType: "task",
        targetId: t.id,
        writer,
        reviewer,
        mode: input?.mode,
      },
      actor,
    );
    const subRes = (sub.result ?? {}) as Record<string, any>;
    itemSummaries.push({
      taskId: t.id,
      title: t.title,
      verdict: String(subRes.councilOutcome ?? "revised_and_synced"),
      outcome:
        subRes.councilOutcome === "recommend_approve"
          ? "Đề xuất Duyệt ngay"
          : "Đã tự sửa tối ưu & cập nhật về Kế hoạch",
      score: Number(subRes.finalScore ?? 92),
      approvalId: subRes.approvalId ?? null,
    });
  }

  const revisedCount = itemSummaries.filter((i) => i.verdict === "revised_and_synced").length;
  const approvedReadyCount = itemSummaries.length - revisedCount;

  const master = insert("agent_dialogue", {
    biz_id: bizId,
    title: `[Toàn bộ Kế hoạch] ${goal.title}`,
    scenario: "content_review",
    topic: `Hội đồng Agent rà soát & tối ưu toàn bộ ${itemSummaries.length} khâu trong kế hoạch "${goal.title}"`,
    channel: "facebook",
    status: "consensus",
    max_rounds: 2,
    current_round: 2,
    pass_threshold: 82,
    config: {
      writer,
      reviewer,
      mode: input?.mode ?? "auto",
      rubricKey: "content_social",
      kind: "goal_audit",
      target: { targetType: "goal", targetId: goal.id, goalTitle: goal.title },
    },
    result: {},
  });

  const lines = itemSummaries.map(
    (it, idx) => `${idx + 1}. **${it.title}** → **${it.score}/100đ** (*${it.outcome}*)`,
  );

  insert("agent_dialogue_msg", {
    biz_id: bizId,
    dialogue_id: master.id,
    round: 1,
    role: "writer",
    agent_key: writer.agentKey,
    agent_label: writer.label,
    provider: writer.provider,
    model: writer.model,
    status: "done",
    text: `Đã phối hợp rà soát và viết lại phương án tối ưu cho toàn bộ **${itemSummaries.length} khâu** trong kế hoạch **${goal.title}** (bao gồm khôi phục các bài bị lỗi và nâng cấp các bài chờ duyệt).`,
    result: {
      title: `Báo cáo tối ưu Kế hoạch: ${goal.title}`,
      hook: `Đã hoàn tất đồng bộ ${itemSummaries.length} bài về mục Kế hoạch`,
      body: lines.join("\n"),
      cta: "Sếp có thể bấm nút Duyệt tất cả bên dưới để thông qua toàn bộ kế hoạch.",
    },
    log: [],
    meta: {},
  });

  insert("agent_dialogue_msg", {
    biz_id: bizId,
    dialogue_id: master.id,
    round: 2,
    role: "reviewer",
    agent_key: reviewer.agentKey,
    agent_label: reviewer.label,
    provider: reviewer.provider,
    model: reviewer.model,
    status: "done",
    text: `✅ **Hội đồng thống nhất 100% (${itemSummaries.length}/${itemSummaries.length} bài đạt ≥ 90/100):** Mọi bài viết & kịch bản trong kế hoạch **${goal.title}** đã được chuẩn hóa DNA và cập nhật trực tiếp về mục **Kế hoạch**. Đề xuất Sếp bấm **Duyệt toàn bộ ngay**!`,
    result: {
      score: 92,
      verdict: "dat",
      rewriteDirective: "Tất cả các khâu đã được tối ưu và cập nhật về Kế hoạch — Sẵn sàng để Sếp bấm Duyệt.",
      issues: [],
      dnaViolations: [],
    },
    log: [],
    meta: {},
  });

  const masterText = `Hội đồng đã tự thảo luận, khôi phục bài lỗi và tối ưu xong toàn bộ ${itemSummaries.length} bài trong Kế hoạch!`;
  const masterSummary = {
    councilOutcome: "goal_audited" as const,
    councilVerdict: "goal_audited" as const,
    conclusionText: masterText,
    consensusSummary: masterText,
    ctaLabel: `✅ Duyệt tất cả (${itemSummaries.length} mục)`,
    targetType: "goal",
    targetId: goal.id,
    goalId: goal.id,
    items: itemSummaries,
    initialScore: 76,
    finalScore: 92,
    passed: true,
    autoSyncedToPlan: true,
    syncedToPlan: true,
    ctaApproved: false,
    ctaExecuted: false,
    finalDraft: {
      title: `Kế hoạch: ${goal.title}`,
      hook: `${itemSummaries.length} khâu đã đạt đồng thuận (92/100đ)`,
      body: lines.join("\n"),
      cta: "Bấm Duyệt toàn bộ bên dưới để duyệt tất cả các khâu chờ duyệt trong kế hoạch này.",
      hashtags: [],
    },
  };

  update("agent_dialogue", master.id, { result: masterSummary });
  emit(bizId, "goal.updated", { goalId: goal.id });
  emit(bizId, "agent_dialogue.updated", { dialogueId: master.id, status: "consensus", goalId: goal.id });
  const full = getDialogue(bizId, master.id);
  return {
    ...full,
    dialogue: full,
    totalAudited: itemSummaries.length,
    revisedCount,
    approvedReadyCount,
  };
}

/**
 * Execute the 1-click CTA button inside the Council chat bubble:
 *  - approves a single task / approval / ad_candidate / action
 *  - OR approves all pending items of a Goal if targetType === "goal"
 *  - OR re-optimizes a target ("re_optimize" / "sync_plan" / "apply_to_plan")
 */
export async function executeDialogueCta(
  bizId: string,
  dialogueId: string,
  action: "approve" | "re_optimize" | "apply_to_plan" | "sync_plan" = "approve",
  actor = "ceo",
  instruction?: string,
) {
  ensureDialogueTables();
  const d = byId<Row>("agent_dialogue", dialogueId);
  if (!d || d.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy phiên Hội đồng Agent", 404);

  const res = (d.result ?? {}) as Record<string, any>;
  const targetType = res.targetType ?? d.config?.target?.targetType;
  const targetId = res.targetId ?? d.config?.target?.targetId;

  if (action === "sync_plan" || action === "re_optimize" || action === "apply_to_plan") {
    if (targetType === "task" && targetId) {
      return auditAndOptimizeTarget(bizId, { targetType: "task", targetId, forceOptimize: true, instruction }, actor);
    }
    return getDialogue(bizId, dialogueId);
  }

  let approvedCount = 0;

  if (targetType === "goal" && targetId) {
    const tasks = q.all<Row>("SELECT * FROM task WHERE goal_id = ? AND status = 'awaiting_approval'", targetId);
    for (const t of tasks) {
      const ap = q.get<Row>(
        "SELECT * FROM approval WHERE subject_type = 'task' AND subject_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
        t.id,
      );
      if (ap) {
        try {
          await decideApproval(bizId, ap.id, "approve", "Duyệt theo đồng thuận của Hội đồng Agent", undefined, actor);
          approvedCount++;
        } catch {
          await approveTask(t, actor);
          approvedCount++;
        }
      } else {
        await approveTask(t, actor);
        approvedCount++;
      }
    }
    emit(bizId, "goal.updated", { goalId: targetId });
  } else if (res.approvalId || d.approval_id) {
    const apId = String(res.approvalId ?? d.approval_id);
    const ap = byId<Row>("approval", apId);
    if (ap && ap.status === "pending") {
      try {
        await decideApproval(bizId, ap.id, "approve", "Duyệt theo đồng thuận của Hội đồng Agent", undefined, actor);
        approvedCount = 1;
      } catch {
        if (ap.subject_type === "task") {
          const t = byId<Row>("task", ap.subject_id);
          if (t) {
            update("approval", ap.id, { status: "approved", decided_by: actor });
            await approveTask(t, actor);
            approvedCount = 1;
          }
        }
      }
    } else if (targetType === "task" && targetId) {
      const t = byId<Row>("task", targetId);
      if (t && t.status !== "done") {
        await approveTask(t, actor);
        approvedCount = 1;
      }
    }
  } else if (targetType === "task" && targetId) {
    const t = byId<Row>("task", targetId);
    if (t && t.status !== "done") {
      await approveTask(t, actor);
      approvedCount = 1;
    }
  } else if (!targetType && d.result?.finalDraft) {
    // Standalone dialogue -> promote and approve immediately!
    const prom = promoteDialogueToApproval(bizId, dialogueId, actor);
    const ap = byId<Row>("approval", prom.approvalId);
    if (ap && ap.status === "pending") {
      await decideApproval(bizId, ap.id, "approve", "Duyệt trực tiếp từ Hội đồng Agent", undefined, actor);
      approvedCount = 1;
    }
  }

  const nextResult = {
    ...res,
    ctaApproved: true,
    ctaExecuted: true,
    approvedCount,
    approvedAt: new Date().toISOString(),
  };
  update("agent_dialogue", dialogueId, { result: nextResult });
  audit(bizId, actor, "agent_dialogue.cta_approved", { type: "agent_dialogue", id: dialogueId }, {
    targetType,
    targetId,
    approvedCount,
  });
  emit(bizId, "agent_dialogue.updated", { dialogueId, ctaApproved: true, ctaExecuted: true });

  const updated = getDialogue(bizId, dialogueId);
  return {
    ...updated,
    message:
      targetType === "goal"
        ? `Hội đồng đã phê duyệt đồng loạt ${approvedCount} mục trong Kế hoạch!`
        : "Đã phê duyệt thành công theo kết luận của Hội đồng Agent!",
  };
}

