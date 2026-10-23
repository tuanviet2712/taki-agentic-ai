import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, CheckCircle2, ChevronDown, Copy, Loader2, MessageCircle, Plus, Send, Square, Trash2, Users, Wand2, X } from "lucide-react";
import { api, useApi, useEvents } from "../lib/api";
import { timeAgo } from "../lib/format";
import { cx, useToast } from "./ui";
import { CouncilReviewView } from "./CouncilReview";

/**
 * Hội đồng Agent — 1 ô chat:
 *  • "Hỏi cả đội": 2–4 agent (mỗi agent 1 model AI đã kết nối) lần lượt nêu quan điểm theo chuyên môn và phản biện nhau
 *    tới khi cả đội thống nhất (máy chủ: packages/orchestrator/src/agent-debate.ts, API /v1/agent-debates).
 *  • "Giao việc": giao 1 việc thật cho 1 agent, chạy bằng model đã chọn (API /v1/agents/assign) → hiện trong Agent & Tác vụ.
 * Phiên "Hội đồng thảo luận" mở từ Kế hoạch / Nội dung / Duyệt / Ads (1 AI viết ↔ 1 AI chấm) hiển thị bằng CouncilReviewView.
 */

const SUGGESTIONS = [
  "Đội ngũ nghĩ gì về kế hoạch tăng doanh thu tháng tới?",
  "Nếu ngân sách marketing giảm 20%, mỗi agent đề xuất điều gì?",
  "Rủi ro lớn nhất trong hành trình khách hàng hiện tại là gì?",
];
/** Agent nhận việc riêng (packages/orchestrator/src/assign.ts ASSIGNABLE, loại task / action). */
const ASSIGN_AGENTS: { key: string; label: string; usesModel: boolean }[] = [
  { key: "content", label: "Content Agent · viết bài MXH", usesModel: true },
  { key: "video_script", label: "Video Agent · kịch bản video", usesModel: true },
  { key: "seo_web", label: "SEO Agent · bài blog SEO", usesModel: true },
  { key: "strategy", label: "Strategy Agent · lập kế hoạch", usesModel: true },
  { key: "market_research", label: "Research Agent · nghiên cứu", usesModel: true },
  { key: "brief", label: "Brief Agent · chuẩn hóa yêu cầu", usesModel: true },
  { key: "ads", label: "Ads Agent · phân tích quảng cáo", usesModel: false },
  { key: "analytics", label: "Analytics Agent · báo cáo nhanh", usesModel: false },
  { key: "review", label: "Review Agent · chấm 1 bài", usesModel: false },
];
const SEAT_STYLE = [
  { dot: "bg-violet-600", text: "text-violet-700 dark:text-violet-300" },
  { dot: "bg-sky-600", text: "text-sky-700 dark:text-sky-300" },
  { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  { dot: "bg-emerald-600", text: "text-emerald-700 dark:text-emerald-300" },
];
const seatOfRole = (role: string) => "abcd".indexOf(String(role).slice(-1));
const isTurn = (m: any) => /^debater_[a-d]$/.test(String(m.role));
const initial = (label?: string) => (String(label ?? "?").trim()[0] ?? "?").toUpperCase();
const shortModel = (m?: string) => String(m ?? "").replace(/^claude-/, "").replace(/^gpt-/, "GPT-");

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
        "relative grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-indigo-500 text-white shadow-sm ring-2 ring-white/80",
        pulse && "animate-pulse",
      )}
      style={{ width: size, height: size }}
    >
      <Users style={{ width: size * 0.48, height: size * 0.48 }} />
    </span>
  );
}

type Seat = { agentKey: string; model: string };
type View = "team" | "history" | "review";

export function AgentDialoguePanel() {
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>(() => (store.get("council.view") === "review" && store.get("agent_dialogue.id") ? "review" : "team"));
  const [teamId, setTeamId] = useState<string | null>(() => store.get("council.team.id"));
  const [reviewId, setReviewId] = useState<string | null>(() => store.get("agent_dialogue.id"));
  const [auditingLabel, setAuditingLabel] = useState<string | null>(null);

  const meta = useApi<any>("agent-debates/meta", ["llm."]);
  const reviewMeta = useApi<any>("agent-dialogues/meta", ["llm."]);
  const teamList = useApi<any[]>("agent-debates", ["agent_debate."]);
  const reviewList = useApi<any[]>("agent-dialogues", ["agent_dialogue."]);
  const team = useApi<any>(teamId ? `agent-debates/${teamId}` : null, ["agent_debate."]);
  const review = useApi<any>(reviewId ? `agent-dialogues/${reviewId}` : null, ["agent_dialogue."]);

  useEffect(() => store.set("council.team.id", teamId), [teamId]);
  useEffect(() => store.set("agent_dialogue.id", reviewId), [reviewId]);
  useEffect(() => store.set("council.view", view === "review" ? "review" : "team"), [view]);
  useEffect(() => {
    if (team.error && teamId) setTeamId(null);
  }, [team.error, teamId]);
  useEffect(() => {
    if (review.error && reviewId) {
      setReviewId(null);
      if (view === "review") setView("team");
    }
  }, [review.error, reviewId, view]);

  // Mở từ menu trái / nơi khác; "Hội đồng thảo luận" ở Kế hoạch / Nội dung / Duyệt / Ads → chạy rà soát rồi hiện kết quả.
  useEffect(() => {
    const openHandler = (e: Event) => {
      setOpen(true);
      const detail = (e as CustomEvent).detail;
      if (detail?.dialogueId) {
        setReviewId(detail.dialogueId);
        setView("review");
      }
    };
    const auditHandler = async (e: Event) => {
      const req = ((e as CustomEvent).detail ?? {}) as CouncilAuditRequest;
      setOpen(true);
      setView("review");
      setAuditingLabel(req.title ?? "mục kế hoạch");
      try {
        if (req.goalId) {
          const res = await api.post(`agent-dialogues/audit-goal/${req.goalId}`, { mode: "auto" });
          if (res?.dialogue?.id) setReviewId(res.dialogue.id);
          toast(`Hội đồng đã rà soát ${res.totalAudited ?? 0} mục (sửa tối ưu ${res.revisedCount ?? 0} mục)`, "ok");
        } else if (req.targetType && req.targetId) {
          const res = await api.post("agent-dialogues/audit-target", { targetType: req.targetType, targetId: req.targetId, forceRevise: req.forceRevise, mode: "auto" });
          if (res?.id) setReviewId(res.id);
          toast(res?.result?.councilVerdict === "revised_and_synced" ? "Hội đồng đã sửa tối ưu và cập nhật về Kế hoạch!" : "Hội đồng đã thẩm định xong — sẵn sàng duyệt!", "ok");
        }
        review.reload();
        reviewList.reload();
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
  }, [review, reviewList, toast]);

  useEvents((e) => {
    if (e.type === "agent_dialogue.updated") {
      review.reload();
      reviewList.reload();
    }
  });

  const running = Boolean(auditingLabel) || (teamList.data ?? []).some((d: any) => d.running) || (reviewList.data ?? []).some((d: any) => d.running);

  if (!open) {
    if (location.pathname.startsWith("/brain")) return null;
    return (
      <button
        onClick={() => setOpen(true)}
        title="Hội đồng Agent"
        aria-label="Mở Hội đồng Agent"
        data-testid="agent-council-trigger"
        className="group fixed bottom-[calc(var(--bottom-nav-h)+4.75rem)] right-4 z-40 flex items-center gap-2 rounded-full bg-card p-1 shadow-pop ring-1 ring-line transition-all hover:pr-4 hover:shadow-sheet"
      >
        <span className="relative">
          <CouncilAvatar size={44} pulse={running} />
          {running && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white ring-2 ring-card">
              <Loader2 className="h-3 w-3 animate-spin" />
            </span>
          )}
        </span>
        <span className="hidden max-w-0 overflow-hidden whitespace-nowrap text-left leading-tight opacity-0 transition-all duration-200 group-hover:max-w-[10rem] group-hover:opacity-100 sm:block">
          <span className="block text-sm font-semibold text-ink">Hội đồng Agent</span>
          <span className="block text-[11px] text-muted">Hỏi cả đội · Giao việc</span>
        </span>
      </button>
    );
  }

  const startNew = () => {
    setTeamId(null);
    setView("team");
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/25 backdrop-blur-[1px] sm:hidden" onClick={() => setOpen(false)} aria-hidden />
      <div
        role="dialog"
        aria-label="Hội đồng Agent"
        data-testid="agent-council-dialog"
        className="fixed inset-x-2 bottom-2 top-2 z-50 flex flex-col overflow-hidden rounded-3xl border border-line bg-soft shadow-[0_20px_60px_-15px_rgba(15,23,42,0.35)] sm:inset-x-auto sm:right-4 sm:top-auto sm:bottom-4 sm:h-[min(760px,calc(100vh-2rem))] sm:w-[440px]"
      >
        {/* Đầu khung */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-violet-600 to-indigo-500 px-4 py-3.5 text-white">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/20">
            <Users className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold leading-tight">Hội đồng Agent</p>
            <p className="truncate text-xs text-white/80">Mỗi Agent một góc nhìn · Giao việc ngay</p>
          </div>
          <button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 hover:bg-white/25" aria-label="Đóng" title="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Lịch sử · Cuộc mới */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <button
            onClick={() => setView(view === "history" ? "team" : "history")}
            className={cx("text-sm font-medium transition", view === "history" ? "text-violet-700 dark:text-violet-300" : "text-muted hover:text-ink")}
          >
            {view === "history" ? "← Quay lại" : "Lịch sử"}
          </button>
          <button onClick={startNew} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-1.5 text-sm font-medium text-ink shadow-2xs hover:bg-soft" data-testid="council-new">
            <Plus className="h-4 w-4" /> Cuộc mới
          </button>
        </div>

        <div className="mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xs">
          {view === "history" ? (
            <HistoryView
              teams={teamList.data ?? []}
              reviews={reviewList.data ?? []}
              onOpenTeam={(id) => {
                setTeamId(id);
                setView("team");
              }}
              onOpenReview={(id) => {
                setReviewId(id);
                setView("review");
              }}
              onDeleted={() => {
                teamList.reload();
                reviewList.reload();
              }}
            />
          ) : view === "review" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <button onClick={() => setView("team")} className="flex items-center gap-1.5 border-b border-line px-4 py-2 text-left text-xs font-medium text-muted hover:text-ink">
                <ArrowLeft className="h-3.5 w-3.5" /> Về ô chat Hội đồng
              </button>
              <CouncilReviewView
                meta={reviewMeta.data}
                dialogue={review.data?.id === reviewId ? review.data : null}
                dialogueId={reviewId}
                auditingLabel={auditingLabel}
                setDialogueId={setReviewId}
                reloadAll={() => {
                  review.reload();
                  reviewList.reload();
                }}
                toast={toast}
              />
            </div>
          ) : (
            <TeamChat
              meta={meta.data}
              metaError={meta.error}
              conversation={team.data?.id === teamId ? team.data : null}
              teamId={teamId}
              setTeamId={setTeamId}
              reload={() => {
                team.reload();
                teamList.reload();
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ==================== Ô CHAT: HỎI CẢ ĐỘI / GIAO VIỆC ====================

function TeamChat({
  meta,
  metaError,
  conversation,
  teamId,
  setTeamId,
  reload,
}: {
  meta: any;
  metaError: string | null;
  conversation: any;
  teamId: string | null;
  setTeamId: (id: string | null) => void;
  reload: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"ask" | "assign">("ask");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState(false);
  const [seats, setSeats] = useState<Seat[]>(() => {
    try {
      return JSON.parse(store.get("council.team") ?? "[]");
    } catch {
      return [];
    }
  });
  const [assignAgent, setAssignAgent] = useState(ASSIGN_AGENTS[0].key);
  const [assignModel, setAssignModel] = useState("");
  const [assigned, setAssigned] = useState<any[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  // Model chỉ lấy từ AI đã kết nối (Trung tâm tích hợp / Kết nối AI).
  const readyGroups = useMemo(
    () => (meta?.providers ?? []).filter((p: any) => p.ready).map((p: any) => ({ id: p.id, label: p.short || p.label, models: p.models ?? [] })),
    [meta?.providers],
  );
  const readyModels = readyGroups.flatMap((g: any) => g.models.map((m: any) => m.id));
  const agents = meta?.agents ?? [];
  const agentLabel = (k: string) => agents.find((a: any) => a.key === k)?.label ?? k;

  // Đội mặc định tự xếp theo AI đã kết nối; đội đã chỉnh được nhớ lại (bỏ ghế có model không còn kết nối).
  useEffect(() => {
    if (!meta) return;
    const valid = seats.filter((s) => readyModels.includes(s.model));
    if (valid.length >= (meta.limits?.minSeats ?? 2) && valid.length === seats.length) return;
    const fresh = (meta.team ?? []).map((s: any) => ({ agentKey: s.agentKey, model: s.model }));
    setSeats(valid.length >= 2 ? valid : fresh);
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (seats.length) store.set("council.team", JSON.stringify(seats));
  }, [seats]);

  const msgs: any[] = conversation?.messages ?? [];
  const live = Boolean(conversation?.running || msgs.some((m) => m.status === "streaming"));
  const status = conversation?.status;
  const convSeats: any[] = conversation?.config?.seats ?? [];

  // Đồng hồ cho lượt đang nghĩ + hỏi lại nhẹ khi mất kết nối sự kiện
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t1 = window.setInterval(() => setNow(Date.now()), 1000);
    const t2 = window.setInterval(reload, 4000);
    return () => {
      window.clearInterval(t1);
      window.clearInterval(t2);
    };
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length, msgs.at(-1)?.status, assigned.length]);

  const noAi = Boolean(meta) && readyGroups.length === 0;
  const assignSpec = ASSIGN_AGENTS.find((a) => a.key === assignAgent) ?? ASSIGN_AGENTS[0];

  const send = async (custom?: string) => {
    const val = (custom ?? text).trim();
    if (!val || busy) return;
    setBusy("send");
    try {
      if (mode === "assign") {
        const r = await api.post("agents/assign", { agent: assignAgent, instruction: val, ...(assignSpec.usesModel && assignModel ? { model: assignModel } : {}) });
        setAssigned((a) => [...a, { ...r, agentLabel: assignSpec.label.split(" · ")[0], model: assignSpec.usesModel ? assignModel : null, instruction: val }]);
        if (r.kind === "task") toast(`Đã giao: ${r.title}`, "ok");
      } else if (conversation && teamId) {
        await api.post(`agent-debates/${teamId}/say`, { text: val, to: "all" });
        reload();
      } else {
        const created = await api.post("agent-debates", { question: val, seats, mode: "live" });
        setTeamId(created.id);
        setEditTeam(false);
        reload();
      }
      if (!custom) setText("");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  };
  const act = async (key: string, path: string, body: unknown = {}) => {
    if (!teamId) return;
    setBusy(key);
    try {
      await api.post(`agent-debates/${teamId}/${path}`, body);
      reload();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  };

  const statusTitle = !conversation
    ? "Đội Agent sẵn sàng"
    : live
      ? "Đội Agent đang thảo luận"
      : status === "consensus"
        ? "Cả đội đã thống nhất"
        : status === "max_turns"
          ? "Chưa thống nhất"
          : status === "failed"
            ? "Có lỗi khi gọi AI"
            : "Đã tạm dừng";
  const shownSeats = conversation ? convSeats.map((s: any) => ({ agentKey: s.agentKey, model: s.model, label: s.label })) : seats.map((s) => ({ ...s, label: agentLabel(s.agentKey) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Đội Agent: bấm để chọn agent & model (chỉnh được khi bắt đầu cuộc mới) */}
      <button
        type="button"
        onClick={() => !conversation && setEditTeam((v) => !v)}
        className={cx("flex items-center gap-2 border-b border-line px-4 py-3 text-left", !conversation && "hover:bg-soft/50")}
        aria-expanded={editTeam}
        data-testid="council-team-toggle"
      >
        {live ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" /> : <MessageCircle className="h-4 w-4 shrink-0 text-violet-600" />}
        <span className="flex-1 truncate text-sm font-bold text-ink">{statusTitle}</span>
        <span className="flex -space-x-1.5">
          {shownSeats.map((s, i) => (
            <span key={i} title={`${s.label} · ${s.model}`} className={cx("grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold text-white ring-2 ring-card", SEAT_STYLE[i % 4].dot)}>
              {initial(s.label)}
            </span>
          ))}
        </span>
        {!conversation && <ChevronDown className={cx("h-4 w-4 text-muted transition", editTeam && "rotate-180")} />}
      </button>

      {editTeam && !conversation && (
        <div className="space-y-2 border-b border-line bg-soft/40 px-4 py-3">
          {seats.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white", SEAT_STYLE[i % 4].dot)}>{initial(agentLabel(s.agentKey))}</span>
              <select
                value={s.agentKey}
                onChange={(e) => setSeats((x) => x.map((y, j) => (j === i ? { ...y, agentKey: e.target.value } : y)))}
                aria-label={`Agent ${i + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-ink focus:outline-none"
              >
                {agents.map((a: any) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
              <ModelSelect value={s.model} groups={readyGroups} onChange={(m) => setSeats((x) => x.map((y, j) => (j === i ? { ...y, model: m } : y)))} label={`Model của agent ${i + 1}`} />
              {seats.length > (meta?.limits?.minSeats ?? 2) && (
                <button onClick={() => setSeats((x) => x.filter((_, j) => j !== i))} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger-ink" aria-label="Bỏ agent">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            {seats.length < (meta?.limits?.maxSeats ?? 4) && readyModels.length > 0 ? (
              <button
                onClick={() => setSeats((x) => [...x, { agentKey: agents.find((a: any) => !x.some((y) => y.agentKey === a.key))?.key ?? "free", model: readyModels[x.length % readyModels.length] }])}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
              >
                <Plus className="h-3.5 w-3.5" /> Thêm agent
              </button>
            ) : (
              <span />
            )}
            <span className="text-[11px] text-muted">Chỉ hiện AI đã kết nối ở Trung tâm tích hợp</span>
          </div>
        </div>
      )}

      {/* Nội dung */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!conversation && !assigned.length && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/10 text-violet-600">
              <Wand2 className="h-7 w-7" />
            </span>
            <p className="text-lg font-bold text-ink">Sếp muốn hỏi cả đội điều gì?</p>
            <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">Mỗi agent sẽ tự trả lời theo chuyên môn. Bạn cũng có thể chọn một agent và giao việc cụ thể.</p>
            {noAi ? (
              <Link to="/ads/integrations" className="mt-4 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn-ink">
                Chưa có AI nào kết nối — mở Trung tâm tích hợp để kết nối Claude / ChatGPT / Grok →
              </Link>
            ) : (
              <div className="mt-5 flex flex-col items-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setMode("ask");
                      void send(s);
                    }}
                    disabled={Boolean(busy) || seats.length < 2}
                    className="rounded-full border border-line bg-card px-3.5 py-1.5 text-xs text-ink/85 transition hover:border-violet-500/40 hover:bg-violet-500/5 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {metaError && <p className="mt-3 text-xs text-danger-ink">{metaError}</p>}
          </div>
        )}

        {msgs.map((m) => (
          <ChatMessage key={m.id} msg={m} seats={convSeats} now={now} />
        ))}

        {assigned.map((a, i) => (
          <AssignedCard key={i} item={a} />
        ))}

        {conversation && !live && status !== "consensus" && status !== "max_turns" && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted">
            <span>{status === "failed" ? conversation.result?.error ?? "Có lỗi khi gọi AI." : "Cuộc thảo luận đang tạm dừng."}</span>
            <button onClick={() => void act("resume", "advance", { steps: "auto" })} className="font-semibold text-violet-700 hover:underline dark:text-violet-300">
              {status === "failed" ? "Thử lại" : "Tiếp tục"}
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Nhập liệu */}
      <div className="border-t border-line px-4 pb-3 pt-3">
        <div className="mb-2.5 flex items-center gap-2">
          {(
            [
              ["ask", "Hỏi cả đội"],
              ["assign", "Giao việc"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setMode(v)}
              aria-pressed={mode === v}
              data-testid={`council-mode-${v}`}
              className={cx("rounded-full px-3.5 py-1.5 text-sm font-semibold transition", mode === v ? "bg-violet-600 text-white shadow-sm" : "bg-soft text-muted hover:text-ink")}
            >
              {l}
            </button>
          ))}
          {live && (
            <button onClick={() => void act("stop", "stop")} className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted hover:bg-soft hover:text-ink" title="Dừng cuộc thảo luận">
              <Square className="h-3 w-3" /> Dừng
            </button>
          )}
        </div>

        {mode === "assign" && (
          <div className="mb-2 flex items-center gap-1.5">
            <select
              value={assignAgent}
              onChange={(e) => setAssignAgent(e.target.value)}
              aria-label="Giao cho agent"
              className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-ink focus:outline-none"
            >
              {ASSIGN_AGENTS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
            {assignSpec.usesModel && <ModelSelect value={assignModel} groups={readyGroups} onChange={setAssignModel} label="Model AI cho việc này" emptyLabel="Model đang cài cho agent" />}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-line bg-soft/60 p-2 focus-within:border-violet-500/50 focus-within:bg-card">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={mode === "assign" ? `Giao việc cho ${assignSpec.label.split(" · ")[0]}…` : conversation ? "Hỏi tiếp cả đội…" : "Hỏi cả đội Agent…"}
            className="max-h-32 min-h-12 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-ink placeholder:text-muted focus:outline-none"
            data-testid="council-input"
          />
          <button
            onClick={() => void send()}
            disabled={!text.trim() || Boolean(busy) || (mode === "ask" && !conversation && seats.length < 2)}
            aria-label="Gửi"
            data-testid="council-send"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-600 text-white shadow-sm transition hover:bg-violet-700 disabled:bg-violet-400/60 disabled:shadow-none"
          >
            {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">Enter để gửi · Shift+Enter để xuống dòng · Việc được giao sẽ hiện trong Agent & Tác vụ.</p>
      </div>
    </div>
  );
}

function ModelSelect({ value, groups, onChange, label, emptyLabel }: { value: string; groups: any[]; onChange: (m: string) => void; label: string; emptyLabel?: string }) {
  const known = groups.some((g) => g.models.some((m: any) => m.id === value));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="w-[9.5rem] shrink-0 truncate rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-ink focus:outline-none">
      {emptyLabel && <option value="">{emptyLabel}</option>}
      {!known && (value || !emptyLabel) && <option value={value}>{value || "Chọn model"}</option>}
      {groups.map((g) => (
        <optgroup key={g.id} label={g.label}>
          {g.models.map((m: any) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function Md({ text }: { text: string }) {
  return (
    <div className="brain-md break-words text-[13px] leading-relaxed text-ink [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-[13px] [&_p]:my-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(u) => (/^(https?:|mailto:|#)/i.test(u) ? u : "")}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ChatMessage({ msg, seats, now }: { msg: any; seats: any[]; now: number }) {
  const toast = useToast();
  const [details, setDetails] = useState(false);
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-violet-600 px-3.5 py-2 text-sm leading-relaxed text-white">{msg.text}</p>
      </div>
    );
  }
  if (msg.role === "verdict") {
    if (msg.meta?.consensus) {
      return (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.06] p-3.5" data-testid="council-verdict">
          <div className="mb-1.5 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="flex-1 text-sm font-bold text-emerald-800 dark:text-emerald-200">Cả đội đã thống nhất</span>
            <button
              onClick={() => void navigator.clipboard?.writeText(msg.text).then(() => toast("Đã sao chép kết luận", "ok"), () => toast("Không sao chép được", "err"))}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
            >
              <Copy className="h-3.5 w-3.5" /> Sao chép
            </button>
          </div>
          <Md text={msg.text} />
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-line bg-soft/60 p-3 text-xs text-muted">
        <p className="font-semibold text-ink">{msg.text} Hỏi tiếp để cả đội bàn thêm.</p>
        {(msg.result?.openIssues ?? []).length > 0 && (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            {msg.result.openIssues.map((x: string, i: number) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (!isTurn(msg)) return null;
  const seat = seatOfRole(msg.role);
  const style = SEAT_STYLE[seat % 4];
  const label = seats[seat]?.label ?? msg.agent_label;
  const r = msg.result ?? {};
  const head = (
    <div className="mb-1 flex items-center gap-1.5 text-xs">
      <span className={cx("font-semibold", style.text)}>{label}</span>
      <span className="truncate font-mono text-[10px] text-muted">{shortModel(msg.model)}</span>
    </div>
  );
  const avatar = <span className={cx("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white", style.dot)}>{initial(label)}</span>;

  if (msg.status === "streaming") {
    const secs = Math.max(0, Math.round((now - new Date(msg.meta?.startedAt ?? msg.created_at).getTime()) / 1000));
    return (
      <div className="flex gap-2.5">
        {avatar}
        <div className="min-w-0">
          {head}
          <p className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-soft px-3 py-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> đang suy nghĩ… {secs}s
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      {avatar}
      <div className="min-w-0 flex-1">
        {head}
        <div className={cx("rounded-2xl rounded-tl-md px-3.5 py-2.5", msg.status === "failed" ? "bg-danger-soft text-danger-ink" : "bg-soft")}>
          {msg.status === "failed" ? <p className="break-words text-xs">⚠ {msg.text}</p> : <Md text={String(r.message ?? msg.text)} />}
          {msg.status === "done" && (r.agree || r.position) && (
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
              {r.agree && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">Đồng ý chốt</span>}
              {r.position && (
                <button onClick={() => setDetails((v) => !v)} className="ml-auto hover:text-ink">
                  {details ? "Ẩn phương án" : "Xem phương án"}
                </button>
              )}
            </div>
          )}
          {details && r.position && (
            <div className="mt-2 border-t border-line pt-2">
              <Md text={r.position} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignedCard({ item }: { item: any }) {
  if (item.kind === "action") {
    return (
      <div className="rounded-2xl border border-line bg-soft/60 p-3 text-xs">
        <p className="mb-1 font-semibold text-ink">{item.agentLabel} đã làm xong</p>
        <pre className="whitespace-pre-wrap font-sans leading-relaxed text-ink/85">{item.text ?? item.summary ?? JSON.stringify(item).slice(0, 600)}</pre>
      </div>
    );
  }
  if (item.kind === "page") {
    return (
      <Link to={item.href ?? "/agents"} className="block rounded-2xl border border-line bg-soft/60 p-3 text-xs text-ink hover:bg-soft">
        Việc này làm ở trang riêng → mở trang
      </Link>
    );
  }
  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.05] p-3 text-xs">
      <p className="font-semibold text-ink">
        ✅ Đã giao cho {item.agentLabel}
        {item.model ? <span className="ml-1 font-mono text-[10px] font-normal text-muted">({shortModel(item.model)})</span> : null}
      </p>
      <p className="mt-0.5 text-muted">{item.title}</p>
      <Link to="/agents" className="mt-1.5 inline-block font-semibold text-violet-700 hover:underline dark:text-violet-300">
        Xem trong Agent & Tác vụ →
      </Link>
    </div>
  );
}

// ==================== LỊCH SỬ ====================

function HistoryView({
  teams,
  reviews,
  onOpenTeam,
  onOpenReview,
  onDeleted,
}: {
  teams: any[];
  reviews: any[];
  onOpenTeam: (id: string) => void;
  onOpenReview: (id: string) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const items = [
    ...teams.map((d) => ({ ...d, _type: "team" as const })),
    ...reviews.map((d) => ({ ...d, _type: "review" as const })),
  ].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const remove = async (d: any) => {
    try {
      await api.del(d._type === "team" ? `agent-debates/${d.id}` : `agent-dialogues/${d.id}`);
      onDeleted();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };
  if (!items.length) return <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted">Chưa có cuộc trò chuyện nào.</div>;
  return (
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
      {items.map((d) => (
        <div
          key={d.id}
          role="button"
          tabIndex={0}
          onClick={() => (d._type === "team" ? onOpenTeam(d.id) : onOpenReview(d.id))}
          onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && (d._type === "team" ? onOpenTeam(d.id) : onOpenReview(d.id))}
          className="group flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-soft"
        >
          <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full text-white", d._type === "team" ? "bg-violet-600" : "bg-emerald-600")}>
            {d._type === "team" ? <Users className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{d.title}</p>
            <p className="truncate text-[11px] text-muted">
              {d._type === "team" ? `Hỏi cả đội · ${(d.config?.seats ?? []).length} agent` : "Rà soát nội dung"} · {d.running ? "đang chạy" : timeAgo(d.updated_at)}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void remove(d);
            }}
            className="rounded-lg p-1.5 text-muted opacity-60 hover:bg-danger-soft hover:text-danger-ink group-hover:opacity-100"
            aria-label="Xóa"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
