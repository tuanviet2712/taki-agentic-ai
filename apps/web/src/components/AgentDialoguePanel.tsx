import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowLeftRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns2,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api, useApi, useEvents } from "../lib/api";
import { timeAgo } from "../lib/format";
import { cx, useToast } from "./ui";

const QUICK_PROMPTS = [
  "Viết bài Facebook giới thiệu khóa học AI Marketing thực chiến cho chủ shop",
  "Kịch bản TikTok 45s: 3 sai lầm khiến chạy quảng cáo đắt mà không ra đơn",
  "Bài chia sẻ câu chuyện CEO 9h tối vẫn ngồi sửa bài cho nhân viên",
];

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

export type CouncilAuditRequest = {
  targetType?: "task" | "content_item" | "approval" | "ad_candidate" | "action";
  targetId?: string;
  goalId?: string;
  title?: string;
  forceRevise?: boolean;
};

export function openCouncilAudit(req: CouncilAuditRequest) {
  window.dispatchEvent(new CustomEvent("council:audit", { detail: req }));
}

export function CouncilAvatar({ size = 44, pulse = false }: { size?: number; pulse?: boolean }) {
  return (
    <span
      className={cx(
        "relative grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm ring-2 ring-white/80",
        pulse && "animate-pulse",
      )}
      style={{ width: size, height: size }}
    >
      <Users style={{ width: size * 0.48, height: size * 0.48 }} />
    </span>
  );
}

/**
 * Hội đồng Agent · Đa Model — Minimal, clean, modern chat interface.
 * Sits directly above Trợ lý Ngân Nguyệt (`bottom-[calc(var(--bottom-nav-h)+4.75rem)] right-4`).
 */
export function AgentDialoguePanel() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [dockedLeft, setDockedLeft] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [dialogueId, setDialogueId] = useState<string | null>(() => store.get("agent_dialogue.id"));
  const [auditingLabel, setAuditingLabel] = useState<string | null>(null);

  const meta = useApi<any>("agent-dialogues/meta", ["llm."]);
  const list = useApi<any[]>("agent-dialogues", ["agent_dialogue."]);
  const current = useApi<any>(dialogueId ? `agent-dialogues/${dialogueId}` : null, ["agent_dialogue."]);
  const toast = useToast();

  useEffect(() => {
    store.set("agent_dialogue.id", dialogueId);
  }, [dialogueId]);

  useEffect(() => {
    if (current.error && dialogueId) setDialogueId(null);
  }, [current.error, dialogueId]);

  useEffect(() => {
    const openHandler = (e: Event) => {
      setOpen(true);
      const detail = (e as CustomEvent).detail;
      if (detail?.dialogueId) setDialogueId(detail.dialogueId);
    };
    const auditHandler = async (e: Event) => {
      const req = ((e as CustomEvent).detail ?? {}) as CouncilAuditRequest;
      setOpen(true);
      setShowHistory(false);
      setAuditingLabel(req.title ?? "mục kế hoạch");
      try {
        if (req.goalId) {
          const res = await api.post(`agent-dialogues/audit-goal/${req.goalId}`, { mode: "auto" });
          if (res?.dialogue?.id) setDialogueId(res.dialogue.id);
          toast(
            `Hội đồng đã rà soát ${res.totalAudited ?? 0} mục (sửa tối ưu ${res.revisedCount ?? 0} mục)`,
            "ok",
          );
        } else if (req.targetType && req.targetId) {
          const res = await api.post("agent-dialogues/audit-target", {
            targetType: req.targetType,
            targetId: req.targetId,
            forceRevise: req.forceRevise,
            mode: "auto",
          });
          if (res?.id) setDialogueId(res.id);
          const v = res?.result?.councilVerdict;
          toast(
            v === "revised_and_synced"
              ? "Hội đồng đã tự tranh luận, sửa tối ưu và cập nhật về Kế hoạch!"
              : "Hội đồng đã thẩm định xong — sẵn sàng duyệt!",
            "ok",
          );
        }
        current.reload();
        list.reload();
      } catch (err: any) {
        toast(err.message || "Không thể chạy Hội đồng Agent", "err");
      } finally {
        setAuditingLabel(null);
      }
    };
    window.addEventListener("council:open", openHandler);
    window.addEventListener("council:audit", auditHandler);
    return () => {
      window.removeEventListener("council:open", openHandler);
      window.removeEventListener("council:audit", auditHandler);
    };
  }, [current, list, toast]);

  useEvents((e) => {
    if (e.type !== "agent_dialogue.updated") return;
    current.reload();
    list.reload();
  });

  const activeRunning = Boolean(auditingLabel) || (list.data ?? []).some((d: any) => d.running || d.status === "running");
  const latestScore = current.data?.result?.finalScore ?? (list.data?.[0]?.result?.finalScore as number | undefined);

  if (!open) {
    if (location.pathname.startsWith("/brain")) return null;
    return (
      <button
        onClick={() => setOpen(true)}
        title="Hội đồng Agent (Viết bài ↔ Chấm điểm)"
        aria-label="Mở Hội đồng Agent"
        data-testid="agent-council-trigger"
        className="group fixed bottom-[calc(var(--bottom-nav-h)+4.75rem)] right-4 z-40 flex items-center gap-2 rounded-full bg-card p-1 shadow-pop ring-1 ring-line transition-all hover:pr-4 hover:shadow-sheet"
      >
        <span className="relative">
          <CouncilAvatar size={44} pulse={activeRunning} />
          {activeRunning ? (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white ring-2 ring-card">
              <Loader2 className="h-3 w-3 animate-spin" />
            </span>
          ) : typeof latestScore === "number" ? (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white ring-2 ring-card">
              {Math.round(latestScore)}
            </span>
          ) : null}
        </span>
        <span className="hidden max-w-0 overflow-hidden whitespace-nowrap text-left leading-tight opacity-0 transition-all duration-200 group-hover:max-w-[10rem] group-hover:opacity-100 group-focus-visible:max-w-[10rem] group-focus-visible:opacity-100 sm:block">
          <span className="block text-sm font-semibold text-ink">Hội đồng Agent</span>
          <span className="block text-[11px] text-muted">Tự phản biện & tối ưu</span>
        </span>
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/25 backdrop-blur-[1px] sm:hidden" onClick={() => setOpen(false)} aria-hidden />
      <div
        role="dialog"
        aria-label="Hội đồng Agent"
        data-testid="agent-council-dialog"
        className={cx(
          "fixed inset-x-2 bottom-2 top-2 z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-[0_20px_60px_-15px_rgba(15,23,42,0.3)] transition-all sm:inset-x-auto sm:bottom-4 sm:top-auto sm:h-[min(740px,calc(100vh-2rem))]",
          dockedLeft ? "sm:right-[460px]" : "sm:right-4",
          wide ? "sm:w-[min(680px,calc(100vw-2rem))]" : "sm:w-[440px]",
        )}
      >
        {/* Minimal Header */}
        <div className="flex items-center gap-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-white">
          <CouncilAvatar size={36} pulse={activeRunning} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">Hội đồng Agent</p>
            <p className="truncate text-[11px] text-white/80">Tự thảo luận · Chốt phương án · Đồng bộ Kế hoạch</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setDialogueId(null);
                setShowHistory(false);
              }}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-white/15 px-2.5 text-xs font-medium hover:bg-white/25"
              title="Cuộc hội thoại mới"
            >
              <Plus className="h-3.5 w-3.5" /> Mới
            </button>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={cx(
                "grid h-8 w-8 place-items-center rounded-full transition",
                showHistory ? "bg-white text-emerald-700" : "bg-white/15 hover:bg-white/25",
              )}
              title="Lịch sử hội thoại"
            >
              <History className="h-4 w-4" />
            </button>
            <button
              onClick={() => setDockedLeft((v) => !v)}
              className={cx(
                "hidden h-8 w-8 place-items-center rounded-full transition sm:grid",
                dockedLeft ? "bg-white text-emerald-700" : "bg-white/15 hover:bg-white/25",
              )}
              title="Đặt cạnh Ngân Nguyệt"
            >
              <Columns2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setWide((v) => !v)}
              className="hidden h-8 w-8 place-items-center rounded-full bg-white/15 hover:bg-white/25 sm:grid"
              title={wide ? "Thu nhỏ" : "Mở rộng"}
            >
              {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/15 hover:bg-white/25"
              title="Đóng"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {showHistory ? (
          <SimpleHistoryView
            dialogues={list.data ?? []}
            currentId={dialogueId}
            onSelect={(id) => {
              setDialogueId(id);
              setShowHistory(false);
            }}
            onReload={list.reload}
            toast={toast}
          />
        ) : (
          <SimpleChatView
            meta={meta.data}
            dialogue={current.data}
            dialogueId={dialogueId}
            auditingLabel={auditingLabel}
            setDialogueId={setDialogueId}
            reloadAll={() => {
              current.reload();
              list.reload();
            }}
            toast={toast}
          />
        )}
      </div>
    </>
  );
}

// ==================== CLEAN CHAT VIEW ====================

function SimpleChatView({
  meta,
  dialogue,
  dialogueId,
  auditingLabel,
  setDialogueId,
  reloadAll,
  toast,
}: {
  meta: any;
  dialogue: any;
  dialogueId: string | null;
  auditingLabel: string | null;
  setDialogueId: (id: string | null) => void;
  reloadAll: () => void;
  toast: (msg: string, tone?: "ok" | "err" | "info") => void;
}) {
  const providers = meta?.providers ?? [];
  const [writerModel, setWriterModel] = useState("claude-sonnet-5");
  const [reviewerModel, setReviewerModel] = useState("grok-4.6");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [ctaLoading, setCtaLoading] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dialogue?.config) {
      if (dialogue.config.writer?.model) setWriterModel(dialogue.config.writer.model);
      if (dialogue.config.reviewer?.model) setReviewerModel(dialogue.config.reviewer.model);
    }
  }, [dialogue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [dialogue?.messages?.length, dialogue?.status, auditingLabel]);

  const modelGroups = useMemo(() => {
    return providers
      .filter((p: any) => p.id !== "sandbox")
      .map((p: any) => ({
        id: p.id,
        label: p.short || p.label,
        models: p.models ?? [],
      }));
  }, [providers]);

  const inferProvider = (m: string) => {
    if (m.startsWith("grok-")) return "grok_cli";
    if (m.startsWith("claude-")) return "claude_cli";
    if (m.startsWith("gemini-")) return "gemini_cli";
    return "codex_cli";
  };

  const handleSend = async (customPrompt?: string) => {
    const val = (customPrompt ?? text).trim();
    if (!val || sending) return;
    setSending(true);
    if (!customPrompt) setText("");

    try {
      if (!dialogueId) {
        const created = await api.post("agent-dialogues", {
          scenario: "content_review",
          topic: val,
          channel: "facebook",
          maxRounds: 3,
          passThreshold: 82,
          mode: "auto",
          writer: { agentKey: "content", provider: inferProvider(writerModel), model: writerModel },
          reviewer: { agentKey: "review", provider: inferProvider(reviewerModel), model: reviewerModel },
        });
        setDialogueId(created.id);
        reloadAll();
      } else {
        await api.post(`agent-dialogues/${dialogueId}/intervene`, { text: val, wait: true });
        reloadAll();
      }
    } catch (e: any) {
      toast(e.message, "err");
      if (!customPrompt) setText(val);
    } finally {
      setSending(false);
    }
  };

  const handleExecuteCta = async (action: "approve" | "re_optimize" | "apply_to_plan") => {
    if (!dialogueId || ctaLoading) return;
    setCtaLoading(action);
    try {
      const res = await api.post(`agent-dialogues/${dialogueId}/execute-cta`, { action });
      reloadAll();
      if (action === "approve") {
        toast(res.message || "Đã phê duyệt thành công!", "ok");
      } else if (action === "re_optimize") {
        toast("Hội đồng đã tự thảo luận lại và cập nhật bản tối ưu mới về Kế hoạch!", "ok");
      }
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setCtaLoading(null);
    }
  };

  const handlePromote = async () => {
    if (!dialogueId || ctaLoading) return;
    setCtaLoading("promote");
    try {
      const res = await api.post(`agent-dialogues/${dialogueId}/promote`);
      reloadAll();
      toast(res.alreadyPromoted ? "Bản thảo đã có trong Hộp Duyệt" : "Đã chuyển bản chốt vào Hộp Duyệt!", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setCtaLoading(null);
    }
  };

  const messages = dialogue?.messages ?? [];
  const res = dialogue?.result ?? {};
  const isTargetAudit = Boolean(dialogue?.config?.target || res.councilVerdict);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-soft/30">
      {/* Compact 1-Line Model Selector Bar */}
      <div className="flex items-center gap-1.5 border-b border-line bg-card px-3 py-2 text-xs">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-line bg-soft/60 px-2.5 py-1.5">
          <span className="shrink-0 text-[11px] font-semibold text-violet-600 dark:text-violet-400">✍️ Viết:</span>
          <select
            value={writerModel}
            onChange={(e) => setWriterModel(e.target.value)}
            aria-label="Model viết bài"
            className="min-w-0 flex-1 truncate bg-transparent text-xs font-semibold text-ink focus:outline-none"
          >
            {modelGroups.map((g: any) => (
              <optgroup key={g.id} label={g.label}>
                {g.models.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-muted" />

        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-line bg-soft/60 px-2.5 py-1.5">
          <span className="shrink-0 text-[11px] font-semibold text-amber-600 dark:text-amber-400">⚖️ Phản biện:</span>
          <select
            value={reviewerModel}
            onChange={(e) => setReviewerModel(e.target.value)}
            aria-label="Model chấm điểm"
            className="min-w-0 flex-1 truncate bg-transparent text-xs font-semibold text-ink focus:outline-none"
          >
            {modelGroups.map((g: any) => (
              <optgroup key={g.id} label={g.label}>
                {g.models.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Chat Messages Area */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-4">
        {auditingLabel && (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 text-xs text-ink shadow-2xs">
            <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Hội đồng đang tự thảo luận & tối ưu...</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Đang đọc & phản biện: <strong className="text-ink">{auditingLabel}</strong>
            </p>
          </div>
        )}

        {!dialogue && !sending && !auditingLabel && (
          <div className="flex h-full flex-col items-center justify-center px-2 text-center">
            <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-ink">Hội đồng Agent tự phản biện & đồng thuận</p>
            <p className="mt-1 max-w-xs text-xs text-muted">
              Bấm nút <strong>"Hội đồng thảo luận"</strong> ở bất kỳ mục nào trong Kế hoạch / Ads, hoặc giao đề bài mới bên dưới.
            </p>
            <div className="mt-4 w-full space-y-1.5 text-left">
              {QUICK_PROMPTS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => void handleSend(q)}
                  className="block w-full rounded-xl border border-line bg-card px-3 py-2.5 text-xs text-ink shadow-2xs transition hover:border-emerald-500/50 hover:bg-emerald-500/5"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m: any) => (
          <CleanBubble key={m.id} msg={m} passThreshold={dialogue?.pass_threshold ?? 82} />
        ))}

        {/* In-Chat Council Conclusion & Direct CTA Bubble */}
        {dialogue && !sending && !auditingLabel && (isTargetAudit || res.finalDraft) && (
          <div
            data-testid="council-conclusion-card"
            className="rounded-2xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-500/[0.08] to-teal-500/[0.04] p-3.5 text-xs shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {res.councilVerdict === "revised_and_synced"
                  ? "Kết luận Hội đồng: Đã tự sửa & cập nhật Kế hoạch"
                  : res.councilVerdict === "goal_audited"
                    ? "Kết luận Hội đồng: Đã tối ưu toàn Kế hoạch"
                    : "Kết luận Hội đồng: Đạt chuẩn duyệt ngay"}
              </span>
              {typeof res.finalScore === "number" && (
                <span className="rounded-lg bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
                  {res.initialScore && res.initialScore !== res.finalScore
                    ? `${res.initialScore}đ → ${res.finalScore}đ`
                    : `${res.finalScore}/100đ`}
                </span>
              )}
            </div>

            {res.consensusSummary && (
              <p className="mt-1.5 leading-relaxed text-ink/90">{res.consensusSummary}</p>
            )}

            {res.syncedToPlan && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-200">
                <Check className="h-3 w-3" /> Đã tự động đồng bộ bản tối ưu về mục Kế hoạch
              </div>
            )}

            {/* Direct CTA Buttons inside the Chat Bubble */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-emerald-500/20 pt-2.5">
              {res.ctaExecuted ? (
                <span
                  data-testid="council-cta-done"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600/15 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300"
                >
                  <CheckCircle2 className="h-4 w-4" /> Đã phê duyệt xong
                </span>
              ) : isTargetAudit ? (
                <>
                  <button
                    onClick={() => void handleExecuteCta("approve")}
                    disabled={Boolean(ctaLoading)}
                    data-testid="council-approve-cta-btn"
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {ctaLoading === "approve" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {res.ctaLabel || "Duyệt ngay"}
                  </button>
                  {res.councilVerdict !== "goal_audited" && (
                    <button
                      onClick={() => void handleExecuteCta("re_optimize")}
                      disabled={Boolean(ctaLoading)}
                      data-testid="council-reoptimize-cta-btn"
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-line bg-card px-3 py-2 text-xs font-semibold text-ink transition hover:border-emerald-500/50 hover:bg-emerald-500/5 disabled:opacity-50"
                    >
                      {ctaLoading === "re_optimize" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                      Tối ưu lại
                    </button>
                  )}
                </>
              ) : dialogue.approval_id ? (
                <Link
                  to="/approvals"
                  className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  Xem trong Hộp Duyệt →
                </Link>
              ) : (
                <button
                  onClick={() => void handlePromote()}
                  disabled={Boolean(ctaLoading)}
                  data-testid="promote-dialogue-btn"
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-2xs transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {ctaLoading === "promote" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Đưa vào Hộp Duyệt
                </button>
              )}
            </div>
          </div>
        )}

        {sending && (
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-card px-3.5 py-2.5 text-xs text-muted shadow-2xs">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
            <span>Hội đồng đang trao đổi và thống nhất phương án...</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Clean Input Box */}
      <div className="border-t border-line bg-card p-2.5">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-soft/50 px-3 py-1.5 focus-within:border-emerald-500/60 focus-within:bg-card">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={dialogue ? "Góp ý thêm cho Hội đồng (VD: nhấn mạnh ưu đãi)..." : "Nhập chủ đề cần viết hoặc bấm Hội đồng từ Kế hoạch..."}
            className="max-h-24 flex-1 resize-none bg-transparent py-1 text-xs text-ink placeholder:text-muted focus:outline-none"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!text.trim() || sending}
            data-testid="start-council-btn"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-35"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== CLEAN MESSAGE BUBBLES ====================

function CleanBubble({ msg, passThreshold }: { msg: any; passThreshold: number }) {
  const [expanded, setExpanded] = useState(false);

  // 1. CEO Prompt Bubble (Right-aligned, super clean)
  if (msg.role === "ceo") {
    const cleanTopic = msg.result?.topic || msg.result?.ceoDirective || msg.text;
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-xs bg-emerald-600 px-3.5 py-2.5 text-xs text-white shadow-2xs">
          <p className="leading-relaxed">{cleanTopic}</p>
        </div>
      </div>
    );
  }

  // 2. Writer Agent Bubble (Left-aligned, clean Draft card)
  if (msg.role === "writer") {
    const draft = msg.result ?? {};
    const bodyText = String(draft.body ?? "");
    const isLong = bodyText.length > 260;

    return (
      <div className="mr-4 space-y-1.5">
        <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted">
          <span className="font-semibold text-violet-600 dark:text-violet-400">✍️ {msg.agent_label}</span>
          <span>·</span>
          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-violet-700 dark:text-violet-300">
            {msg.model}
          </span>
          <span className="ml-auto text-[10px]">Bản v{msg.round}</span>
        </div>

        <div className="rounded-2xl rounded-tl-xs border border-line bg-card p-3.5 shadow-2xs">
          {draft.title ? (
            <div className="space-y-2 text-xs">
              <p className="font-bold text-ink">{draft.title}</p>
              {draft.hook && (
                <p className="rounded-lg bg-violet-500/5 px-2.5 py-1.5 font-medium text-ink/90">
                  🎯 {draft.hook}
                </p>
              )}
              <div className="whitespace-pre-line leading-relaxed text-ink/85">
                {isLong && !expanded ? `${bodyText.slice(0, 260)}...` : bodyText}
              </div>
              {isLong && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:underline dark:text-violet-400"
                >
                  {expanded ? (
                    <>
                      Thu gọn <ChevronUp className="h-3 w-3" />
                    </>
                  ) : (
                    <>
                      Xem toàn bộ bài viết <ChevronDown className="h-3 w-3" />
                    </>
                  )}
                </button>
              )}
              {draft.cta && (
                <div className="border-t border-line pt-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  👉 {draft.cta}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">{msg.text}</p>
          )}
        </div>
      </div>
    );
  }

  // 3. Reviewer Agent Bubble (Compact Score + Key Feedback)
  const rev = msg.result ?? {};
  const score = typeof rev.score === "number" ? rev.score : null;
  const passed = score != null && score >= passThreshold && (rev.dnaViolations?.length ?? 0) === 0;
  const issues: string[] = rev.issues ?? [];

  return (
    <div className="ml-4 space-y-1.5">
      <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted">
        <span className="font-semibold text-amber-600 dark:text-amber-400">⚖️ Chấm điểm</span>
        <span>·</span>
        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:text-amber-300">
          {msg.model}
        </span>
        <span className="ml-auto text-[10px]">Vòng {msg.round}</span>
      </div>

      <div
        className={cx(
          "rounded-2xl rounded-tr-xs border p-3.5 text-xs shadow-2xs",
          passed ? "border-emerald-500/40 bg-emerald-500/[0.04]" : "border-amber-500/40 bg-amber-500/[0.04]",
        )}
      >
        {/* Score Header */}
        {score != null && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cx(
                  "rounded-lg px-2 py-0.5 text-xs font-bold",
                  passed
                    ? "bg-emerald-600 text-white"
                    : "bg-amber-500 text-white",
                )}
              >
                {score}/100
              </span>
              <span className="font-semibold text-ink">
                {passed ? "Đạt chuẩn xuất bản" : "Cần chỉnh sửa lại"}
              </span>
            </div>
            {Array.isArray(rev.criteriaBreakdown) && rev.criteriaBreakdown.length > 0 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[11px] font-medium text-muted hover:text-ink"
              >
                {expanded ? "Ẩn chi tiết" : "Chi tiết điểm"}
              </button>
            )}
          </div>
        )}

        {/* Short Summary */}
        <p className="leading-relaxed text-ink/90">
          {passed
            ? "Bản thảo đã khắc phục hết lỗi, câu mở đầu thu hút, không còn mùi văn mẫu AI và đúng chuẩn DNA."
            : rev.rewriteDirective || rev.replyToWriter || msg.text}
        </p>

        {/* Issues list (only when needing revision, max 3 short bullets) */}
        {!passed && issues.length > 0 && (
          <ul className="mt-2 space-y-1 rounded-xl bg-card/80 p-2.5 text-[11px] text-ink/85">
            {issues.slice(0, 3).map((iss, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-0.5 text-amber-500">•</span>
                <span>{iss}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Collapsible 5-criteria breakdown */}
        {expanded && Array.isArray(rev.criteriaBreakdown) && (
          <div className="mt-2.5 space-y-1.5 border-t border-line/70 pt-2.5 text-[11px]">
            {rev.criteriaBreakdown.map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="text-muted">{c.name}</span>
                <span className="font-semibold text-ink">
                  {c.score}/{c.maxScore}đ
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== SIMPLE HISTORY VIEW ====================

function SimpleHistoryView({
  dialogues,
  currentId,
  onSelect,
  onReload,
  toast,
}: {
  dialogues: any[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onReload: () => void;
  toast: (msg: string, tone?: "ok" | "err" | "info") => void;
}) {
  const remove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.del(`agent-dialogues/${id}`);
      onReload();
    } catch (err: any) {
      toast(err.message, "err");
    }
  };

  if (!dialogues.length) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center text-xs text-muted">
        Chưa có lịch sử hội thoại nào.
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3">
      {dialogues.map((d: any) => {
        const wModel = d.config?.writer?.model ?? "claude-sonnet-5";
        const rModel = d.config?.reviewer?.model ?? "grok-4.6";
        const score = d.result?.finalScore;
        return (
          <div
            key={d.id}
            onClick={() => onSelect(d.id)}
            className={cx(
              "flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 text-xs transition hover:border-emerald-500/50",
              currentId === d.id ? "border-emerald-500 bg-emerald-500/5" : "border-line bg-card",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">{d.title}</p>
              <p className="mt-1 text-[11px] text-muted">
                {wModel} ⇄ {rModel} · {timeAgo(d.updated_at)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {typeof score === "number" && (
                <span className="rounded-lg bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  {score}đ
                </span>
              )}
              <button
                onClick={(e) => void remove(d.id, e)}
                className="rounded-lg p-1.5 text-muted hover:bg-rose-500/10 hover:text-rose-600"
                title="Xóa"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
