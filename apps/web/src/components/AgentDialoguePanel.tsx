import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowLeftRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Columns2,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Send,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api, useApi, useEvents } from "../lib/api";
import { timeAgo } from "../lib/format";
import { cx, useToast } from "./ui";

/** Việc Hội đồng làm khi gõ đề bài trực tiếp: mỗi việc có agent viết, giám khảo, kênh và gợi ý riêng (máy chủ: DIALOGUE_SCENARIOS). */
type TaskDef = { id: string; label: string; icon: string; agent: string; reviewer: string; channels: string[]; placeholder: string; prompts: string[] };
const TASKS: TaskDef[] = [
  {
    id: "content_review", label: "Bài MXH", icon: "📘", agent: "content", reviewer: "review", channels: ["facebook", "instagram", "tiktok", "zalo"],
    placeholder: "Chủ đề bài viết…",
    prompts: ["Giới thiệu khóa học AI Marketing thực chiến cho chủ shop", "Câu chuyện CEO 9h tối vẫn ngồi sửa bài cho nhân viên"],
  },
  {
    id: "video_review", label: "Video ngắn", icon: "🎬", agent: "video_script", reviewer: "review", channels: ["tiktok", "facebook", "instagram", "youtube"],
    placeholder: "Ý tưởng video…",
    prompts: ["45 giây: 3 sai lầm khiến chạy quảng cáo đắt mà không ra đơn", "Demo dùng AI viết 10 bài đăng trong 5 phút"],
  },
  {
    id: "seo_review", label: "Bài SEO", icon: "🌐", agent: "seo_web", reviewer: "review", channels: ["website"],
    placeholder: "Từ khóa / chủ đề bài SEO…",
    prompts: ["Ứng dụng AI trong marketing cho doanh nghiệp nhỏ", "Cách tự động hóa chăm sóc khách hàng bằng chatbot"],
  },
  {
    id: "strategy_debate", label: "Chiến lược", icon: "🧭", agent: "strategy", reviewer: "market_research", channels: [],
    placeholder: "Mục tiêu cần lên phương án…",
    prompts: ["Kế hoạch 30 ngày tăng 200 lead cho khóa AI với 30 triệu ngân sách", "Ra mắt sản phẩm mới trong 2 tuần, ưu tiên kênh miễn phí"],
  },
];
const CHANNEL_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", zalo: "Zalo", youtube: "YouTube", website: "Website" };
const taskOf = (id?: string | null) => TASKS.find((t) => t.id === id) ?? TASKS[0];
const shortModel = (m?: string) => String(m ?? "").replace(/^claude-/, "").replace(/^gpt-/, "GPT-");
/** Lời nhận xét của AI hay có **in đậm** / `mã`: bỏ ký hiệu markdown cho dễ đọc trong bong bóng chat. */
const plain = (s: unknown) => String(s ?? "").replace(/\*\*|__|`/g, "");
const draftText = (d: any) => [d?.title, d?.hook, d?.body, d?.cta, (d?.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");

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
    if (location.pathname.startsWith("/brain") || location.pathname.startsWith("/debate")) return null;
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
            <Link
              to="/debate"
              onClick={() => setOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/15 hover:bg-white/25"
              title="Phòng tranh luận AI: 2 model / agent tranh luận tự do tới khi thống nhất"
              aria-label="Mở Phòng tranh luận AI"
            >
              <Swords className="h-4 w-4" />
            </Link>
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
  const [writerModel, setWriterModel] = useState("claude-sonnet-5-5");
  const [reviewerModel, setReviewerModel] = useState("grok-4.6");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [ctaLoading, setCtaLoading] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Việc + kênh + agent viết cho đề bài MỚI (nhớ việc chọn lần trước). Kênh / agent nằm trong "Tùy chỉnh" (ẩn sẵn).
  const [taskId, setTaskId] = useState(() => store.get("council.task") ?? TASKS[0].id);
  const task = taskOf(taskId);
  const [channel, setChannel] = useState(() => taskOf(store.get("council.task")).channels[0] ?? "facebook");
  const [writerAgent, setWriterAgent] = useState(() => taskOf(store.get("council.task")).agent);
  const [showOptions, setShowOptions] = useState(false);
  const pickTask = (id: string) => {
    const t = taskOf(id);
    setTaskId(t.id);
    store.set("council.task", t.id);
    setChannel(t.channels[0] ?? "facebook");
    setWriterAgent(t.agent);
  };
  const writerAgents = (meta?.agents ?? []).filter((a: any) => a.role !== "reviewer");

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

    // Không chờ cả vòng tranh luận (nhiều phút với CLI thật): máy chủ chạy nền, mỗi lượt Viết / Chấm hiện ngay khi xong
    // qua sự kiện agent_dialogue.updated.
    try {
      if (!dialogueId) {
        const created = await api.post("agent-dialogues", {
          scenario: task.id,
          topic: val,
          channel: task.channels.length ? channel : "facebook",
          maxRounds: 3,
          passThreshold: 82,
          mode: "auto",
          writer: { agentKey: writerAgent, provider: inferProvider(writerModel), model: writerModel },
          reviewer: { agentKey: task.reviewer, provider: inferProvider(reviewerModel), model: reviewerModel },
          runImmediately: false,
        });
        setDialogueId(created.id);
        reloadAll();
      } else {
        await api.post(`agent-dialogues/${dialogueId}/intervene`, { text: val, wait: false });
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
  const live = Boolean(dialogue && (dialogue.status === "running" || messages.some((m: any) => m.status === "streaming")));
  const anyStreaming = messages.some((m: any) => m.status === "streaming");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyStreaming) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [anyStreaming]);
  // Dự phòng khi mất kết nối sự kiện: hỏi lại nhẹ trong lúc Hội đồng đang trao đổi.
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(reloadAll, 4000);
    return () => window.clearInterval(t);
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const modelKnown = (m: string) => modelGroups.some((g: any) => g.models.some((x: any) => x.id === m));
  // C. Điểm qua từng vòng (74 → 91) + bản đầu / bản chốt để thấy rõ Hội đồng đã sửa gì.
  const scoreTrail: number[] = messages
    .filter((m: any) => m.role === "reviewer" && m.status === "done" && typeof m.result?.score === "number")
    .map((m: any) => Math.round(m.result.score));
  const drafts = messages.filter((m: any) => m.role === "writer" && m.status === "done" && m.result?.body);
  const firstDraft = drafts[0]?.result;
  const finalDraft = res.finalDraft ?? drafts.at(-1)?.result;
  const publishable = !["strategy", "brief"].includes(dialogue?.config?.kind);
  const [compare, setCompare] = useState<"first" | "final" | null>(null);
  useEffect(() => setCompare(null), [dialogue?.id]);
  const copyFinal = () => {
    void navigator.clipboard?.writeText(draftText(finalDraft)).then(
      () => toast("Đã sao chép bản chốt", "ok"),
      () => toast("Không sao chép được", "err"),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-soft/30">
      {dialogue ? (
        /* Đang xem 1 phiên: chỉ 1 dòng tóm tắt việc + 2 model, không lặp lại bộ chọn */
        <div className="flex items-center gap-1.5 border-b border-line bg-card px-3.5 py-2 text-[11px] text-muted">
          <span className="shrink-0">{taskOf(dialogue.scenario).icon}</span>
          <span className="shrink-0 font-semibold text-ink">{taskOf(dialogue.scenario).label}</span>
          {taskOf(dialogue.scenario).channels.length > 0 && <span className="shrink-0">· {CHANNEL_LABEL[dialogue.channel] ?? dialogue.channel}</span>}
          <span className="ml-auto min-w-0 truncate font-mono text-[10px]">
            ✍️ {shortModel(dialogue.config?.writer?.model)} ⇄ ⚖️ {shortModel(dialogue.config?.reviewer?.model)}
          </span>
        </div>
      ) : (
        <div className="space-y-2 border-b border-line bg-card px-3 py-2.5 text-xs">
          {/* A. Chọn việc */}
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-soft/70 p-1" role="tablist" aria-label="Hội đồng làm việc gì">
            {TASKS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={task.id === t.id}
                onClick={() => pickTask(t.id)}
                data-testid={`council-task-${t.id}`}
                className={cx(
                  "rounded-lg px-1 py-1.5 text-[11px] font-semibold transition",
                  task.id === t.id ? "bg-card text-emerald-700 shadow-2xs dark:text-emerald-300" : "text-muted hover:text-ink",
                )}
              >
                <span className="mr-0.5">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
          {/* Model 2 bên + nút Tùy chỉnh */}
          <div className="flex items-center gap-1.5">
            <label className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-line bg-soft/60 px-2 py-1.5">
              <span className="shrink-0 text-[11px] font-semibold text-violet-600 dark:text-violet-400">✍️</span>
              <select
                value={writerModel}
                onChange={(e) => setWriterModel(e.target.value)}
                aria-label="Model viết"
                className="min-w-0 flex-1 truncate bg-transparent text-xs font-semibold text-ink focus:outline-none"
              >
                {/* Danh sách model chưa tải xong / model không có trong danh sách: vẫn hiện model đang chọn, không để ô trống. */}
                {!modelKnown(writerModel) && <option value={writerModel}>{writerModel}</option>}
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
            </label>
            <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-muted" />
            <label className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-line bg-soft/60 px-2 py-1.5">
              <span className="shrink-0 text-[11px] font-semibold text-amber-600 dark:text-amber-400">⚖️</span>
              <select
                value={reviewerModel}
                onChange={(e) => setReviewerModel(e.target.value)}
                aria-label="Model chấm điểm"
                className="min-w-0 flex-1 truncate bg-transparent text-xs font-semibold text-ink focus:outline-none"
              >
                {!modelKnown(reviewerModel) && <option value={reviewerModel}>{reviewerModel}</option>}
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
            </label>
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
              title="Tùy chỉnh kênh và agent viết"
              className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-xl border transition", showOptions ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700" : "border-line text-muted hover:text-ink")}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* B. Tùy chỉnh (ẩn sẵn): kênh + agent viết */}
          {showOptions && (
            <div className="grid grid-cols-2 gap-1.5">
              {task.channels.length > 1 && (
                <label className="text-[11px] text-muted">
                  Kênh
                  <select value={channel} onChange={(e) => setChannel(e.target.value)} className="mt-0.5 w-full rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-ink focus:outline-none">
                    {task.channels.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABEL[c] ?? c}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={cx("text-[11px] text-muted", task.channels.length > 1 ? "" : "col-span-2")}>
                Agent viết
                <select value={writerAgent} onChange={(e) => setWriterAgent(e.target.value)} className="mt-0.5 w-full rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-ink focus:outline-none">
                  {writerAgents.map((a: any) => (
                    <option key={a.key} value={a.key}>
                      {String(a.label).replace(/\s*\(.*\)$/, "")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}

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
            <p className="text-sm font-semibold text-ink">
              {task.icon} {task.label}: 1 AI viết, 1 AI chấm
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted">Nhập đề bài bên dưới. Hai bên sửa qua lại tới khi đạt ≥ 82 điểm.</p>
            <div className="mt-4 w-full space-y-1.5 text-left">
              {task.prompts.map((q, i) => (
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
          <CleanBubble key={m.id} msg={m} passThreshold={dialogue?.pass_threshold ?? 82} now={now} />
        ))}

        {dialogue?.status === "failed" && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/[0.06] p-3 text-xs text-rose-700 dark:text-rose-300" data-testid="council-error">
            <p className="font-semibold">Hội đồng dừng giữa chừng</p>
            <p className="mt-1 break-words leading-relaxed">{res.error || "Có lỗi khi gọi AI."}</p>
            <p className="mt-1 text-[11px] text-muted">Gửi góp ý bên dưới (VD: "chạy lại") để Hội đồng làm vòng mới, hoặc đổi model ở thanh trên.</p>
          </div>
        )}

        {/* In-Chat Council Conclusion & Direct CTA Bubble */}
        {dialogue && !live && dialogue.status !== "failed" && !sending && !auditingLabel && (isTargetAudit || res.finalDraft) && (
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
                    : res.passed === false
                      ? "Hết vòng: chưa đạt ngưỡng điểm"
                      : "Kết luận Hội đồng: Đạt chuẩn"}
              </span>
              {!isTargetAudit && scoreTrail.length > 0 ? (
                <span className="rounded-lg bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white" title="Điểm qua từng vòng">
                  {scoreTrail.join(" → ")}đ
                </span>
              ) : typeof res.finalScore === "number" && (
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
              ) : (
                <>
                  <button
                    onClick={copyFinal}
                    disabled={!finalDraft}
                    className="inline-flex items-center gap-1 rounded-xl border border-line bg-card px-3 py-2 text-xs font-semibold text-ink transition hover:bg-soft disabled:opacity-50"
                  >
                    <Copy className="h-3.5 w-3.5" /> Sao chép
                  </button>
                  {drafts.length > 1 && (
                    <button
                      onClick={() => setCompare((v) => (v ? null : "first"))}
                      aria-expanded={Boolean(compare)}
                      data-testid="council-compare-btn"
                      className={cx(
                        "inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-semibold transition",
                        compare ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700" : "border-line bg-card text-ink hover:bg-soft",
                      )}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" /> So sánh
                    </button>
                  )}
                  {publishable &&
                    (dialogue.approval_id ? (
                      <Link
                        to="/approvals"
                        className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                      >
                        Duyệt & lên lịch đăng →
                      </Link>
                    ) : (
                      <button
                        onClick={() => void handlePromote()}
                        disabled={Boolean(ctaLoading)}
                        data-testid="promote-dialogue-btn"
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-2xs transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {ctaLoading === "promote" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Đưa vào Hộp Duyệt
                      </button>
                    ))}
                </>
              )}
            </div>

            {compare && firstDraft && finalDraft && (
              <div className="mt-2.5 rounded-xl border border-line bg-card p-2.5" data-testid="council-compare">
                <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-soft/70 p-0.5 text-[11px] font-semibold">
                  {(["first", "final"] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setCompare(k)}
                      className={cx("rounded-md py-1 transition", compare === k ? "bg-card text-ink shadow-2xs" : "text-muted hover:text-ink")}
                    >
                      {k === "first" ? `Bản đầu${scoreTrail[0] != null ? ` · ${scoreTrail[0]}đ` : ""}` : `Bản chốt${scoreTrail.length ? ` · ${scoreTrail.at(-1)}đ` : ""}`}
                    </button>
                  ))}
                </div>
                <div className="max-h-64 overflow-y-auto whitespace-pre-line text-[11.5px] leading-relaxed text-ink/90">
                  {draftText(compare === "first" ? firstDraft : finalDraft)}
                </div>
              </div>
            )}
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
            placeholder={dialogue ? "Góp ý để Hội đồng sửa tiếp (VD: nhấn mạnh ưu đãi)…" : task.placeholder}
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

function CleanBubble({ msg, passThreshold, now }: { msg: any; passThreshold: number; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const isWriter = msg.role === "writer";

  // Lượt đang chạy trên CLI: hiện ai đang làm gì + số giây đã chờ (Grok / Claude thật mất 30 giây đến vài phút mỗi lượt).
  if ((isWriter || msg.role === "reviewer") && (msg.status === "streaming" || msg.status === "failed")) {
    const secs = Math.max(0, Math.round((now - new Date(msg.created_at).getTime()) / 1000));
    const failed = msg.status === "failed";
    return (
      <div className={isWriter ? "mr-4" : "ml-4"}>
        <div
          className={cx(
            "flex items-start gap-2 rounded-2xl border px-3.5 py-2.5 text-xs",
            failed
              ? "border-rose-500/40 bg-rose-500/[0.06] text-rose-700 dark:text-rose-300"
              : isWriter
                ? "rounded-tl-xs border-violet-500/30 bg-violet-500/[0.04] text-muted"
                : "rounded-tr-xs border-amber-500/40 bg-amber-500/[0.04] text-muted",
          )}
        >
          {failed ? <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Loader2 className={cx("mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin", isWriter ? "text-violet-600" : "text-amber-600")} />}
          <span className="min-w-0 break-words">
            <b className={cx("font-semibold", failed ? "" : isWriter ? "text-violet-700 dark:text-violet-300" : "text-amber-700 dark:text-amber-300")}>
              {isWriter ? "✍️" : "⚖️"} {msg.agent_label}
            </b>{" "}
            <span className="font-mono text-[10px]">({msg.model})</span>{" "}
            {failed ? `— lỗi: ${msg.text}` : `${isWriter ? `đang viết bản v${msg.round}` : `đang đọc & chấm bản v${msg.round}`}… ${secs}s`}
          </span>
        </div>
      </div>
    );
  }

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
              {draft.replyToPeer && (
                <p className="rounded-lg border-l-2 border-violet-500/60 bg-violet-500/[0.06] px-2.5 py-1.5 leading-relaxed text-ink/90">
                  💬 {plain(draft.replyToPeer)}
                </p>
              )}
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

        {/* Lời Giám khảo nói trực tiếp với người viết (phản biện) + yêu cầu sửa cho vòng sau */}
        <p className="leading-relaxed text-ink/90">💬 {plain(rev.replyToWriter || msg.text)}</p>
        {!passed && rev.rewriteDirective && rev.rewriteDirective !== rev.replyToWriter && (
          <p className="mt-2 rounded-lg bg-card/80 px-2.5 py-1.5 leading-relaxed text-ink/85">
            <b className="font-semibold text-amber-700 dark:text-amber-300">Yêu cầu sửa: </b>
            {plain(rev.rewriteDirective)}
          </p>
        )}

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
        const wModel = d.config?.writer?.model ?? "claude-sonnet-5-5";
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
              <p className="truncate font-semibold text-ink">{d.config?.target ? "📋" : taskOf(d.scenario).icon} {d.title}</p>
              <p className="mt-1 text-[11px] text-muted">
                {shortModel(wModel)} ⇄ {shortModel(rModel)} · {timeAgo(d.updated_at)}
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
