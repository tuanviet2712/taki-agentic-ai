import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlarmClock, AlertTriangle, CheckCircle2, ChevronRight, CircleDot, ClipboardList, History, Info, Loader2, MessageSquareText, Mic, MicOff, Moon, Plus, Search, Send, ShieldCheck, Square, ThumbsDown, ThumbsUp, Trash2, Wrench, X, XCircle } from "lucide-react";
import { api, useApi, useEvents } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useSpeech } from "../lib/speech";
import { Badge, Toggle, cx, inputCls, useToast } from "./ui";

/**
 * Ngân Nguyệt — the CEO's command assistant, floating on every page. Chat (live streaming, tool steps, confirm
 * cards), work she dispatched, system findings and history. Backend: /v1/assistant/* (packages/orchestrator/src/assistant.ts).
 */
type Tab = "chat" | "dispatch" | "findings" | "feedback" | "history" | "reminders";
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "chat", label: "Trò chuyện", icon: MessageSquareText },
  { key: "dispatch", label: "Việc giao", icon: ClipboardList },
  { key: "findings", label: "Phát hiện", icon: Search },
  { key: "feedback", label: "Phản hồi", icon: ThumbsUp },
  { key: "history", label: "Lịch sử", icon: History },
  { key: "reminders", label: "Lịch & nhắc", icon: AlarmClock },
];
const STATUS_VI: Record<string, [string, any]> = {
  ready: ["Chờ chạy", "gray"], pending: ["Chờ", "gray"], queued: ["Chờ", "gray"], running: ["Đang làm", "blue"], in_review: ["Đang review", "violet"], revising: ["Đang sửa", "amber"],
  awaiting_approval: ["Chờ Sếp duyệt", "amber"], approved: ["Đã duyệt", "green"], done: ["Xong", "green"], drafted: ["Đã lên nháp", "green"],
  failed: ["Lỗi", "red"], blocked: ["Bị chặn", "red"], cancelled: ["Đã hủy", "gray"], rejected: ["Từ chối", "gray"], dead: ["Lỗi", "red"],
};
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };

export function NguyetAvatar({ size = 40, ring = true }: { size?: number; ring?: boolean }) {
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-sm", ring && "ring-2 ring-white/80")} style={{ width: size, height: size }}>
      <Moon style={{ width: size * 0.5, height: size * 0.5 }} className="fill-white/90" />
    </span>
  );
}

// ---------------- Minimal, safe markdown (bold, italic, code, links, lists, headings) ----------------
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("[[")) {
      // [[Ghi chú]] in Agentic Brain → opens it on the brain page
      const [target, alias] = t.slice(2, -2).split("|");
      out.push(<Link key={k} to={`/brain?link=${encodeURIComponent(target.split("#")[0].trim())}`} className="font-medium text-violet-600 hover:underline dark:text-violet-300">{alias ?? target.split("/").pop()}</Link>);
    } else if (t.startsWith("**")) out.push(<strong key={k} className="font-semibold text-ink">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-soft px-1 py-0.5 text-[12px]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label, href] = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
      out.push(href?.startsWith("/") ? <Link key={k} to={href} className="font-medium text-blue-600 hover:underline">{label}</Link>
        : /^https?:\/\//.test(href ?? "") ? <a key={k} href={href} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">{label}</a> : label);
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushList = () => {
    if (!list) return;
    const L = list.ordered ? "ol" : "ul";
    blocks.push(<L key={`l${blocks.length}`} className={cx("my-1 space-y-0.5 pl-5", list.ordered ? "list-decimal" : "list-disc")}>{list.items.map((it, i) => <li key={i}>{inline(it, `li${blocks.length}-${i}`)}</li>)}</L>);
    list = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
      return;
    }
    flushList();
    if (!line.trim()) return;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) blocks.push(<p key={i} className="mt-1 font-semibold text-ink">{inline(h[1], `h${i}`)}</p>);
    else blocks.push(<p key={i}>{inline(line, `p${i}`)}</p>);
  });
  flushList();
  return <div className="space-y-1.5 break-words">{blocks}</div>;
}

// ---------------- Panel ----------------
/** Always a floating overlay above the page (never pushes/shrinks the layout underneath). */
export function AssistantPanel() {
  const location = useLocation();
  // Collapsed on every load: an open overlay would cover the page the user came to see.
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [threadId, setThreadId] = useState<string | null>(() => store.get("assistant.thread"));
  const info = useApi<any>("assistant", ["llm."]);
  const findings = useApi<any[]>("assistant/findings", ["task.", "approval.", "creative.", "alert.", "conversation.handoff"]);
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  useEffect(() => store.set("assistant.thread", threadId), [threadId]);
  const urgent = (findings.data ?? []).filter((f) => f.level !== "info").length;

  // Ask from anywhere: window.dispatchEvent(new CustomEvent("nguyet:ask", { detail: "..." }))
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => { setOpen(true); setTab("chat"); setPendingAsk(String((e as CustomEvent).detail ?? "")); };
    const o = () => setOpen(true);
    window.addEventListener("nguyet:ask", h);
    window.addEventListener("nguyet:open", o);
    return () => { window.removeEventListener("nguyet:ask", h); window.removeEventListener("nguyet:open", o); };
  }, []);

  const newThread = async () => {
    try { const t = await api.post("assistant/threads"); setThreadId(t.id); setTab("chat"); return t.id as string; } catch (e: any) { toast(e.message, "err"); return null; }
  };

  if (!open) {
    if (location.pathname.startsWith("/brain")) return null; // the brain page has its own "Nói với Ngân Nguyệt" bar
    return (
      <button onClick={() => setOpen(true)} title="Trợ lý Ngân Nguyệt" aria-label="Mở trợ lý Ngân Nguyệt" className="group fixed bottom-[calc(var(--bottom-nav-h)+1rem)] right-4 z-40 flex items-center gap-2 rounded-full bg-card p-1 shadow-pop ring-1 ring-line transition-all hover:pr-4 hover:shadow-sheet">
        <span className="relative"><NguyetAvatar size={44} />{urgent > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-card">{urgent}</span>}</span>
        <span className="hidden max-w-0 overflow-hidden whitespace-nowrap text-left leading-tight opacity-0 transition-all duration-200 group-hover:max-w-[10rem] group-hover:opacity-100 group-focus-visible:max-w-[10rem] group-focus-visible:opacity-100 sm:block"><span className="block text-sm font-semibold text-ink">Ngân Nguyệt</span><span className="block text-[11px] text-muted">Trợ lý điều phối</span></span>
      </button>
    );
  }

  return (
    <>
    <div className="fixed inset-0 z-40 bg-slate-900/30 sm:hidden" onClick={() => setOpen(false)} aria-hidden />
    <div role="dialog" aria-label="Trợ lý Ngân Nguyệt" className="fixed inset-x-2 bottom-2 top-2 z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-[0_24px_64px_-12px_rgba(15,23,42,0.35)] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto sm:h-[min(780px,calc(100vh-2rem))] sm:w-[440px]">
      <div className="flex items-center gap-3 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 px-4 py-3 text-white">
        <NguyetAvatar size={44} />
        <div className="min-w-0 flex-1"><p className="truncate text-base font-bold">Trợ lý Ngân Nguyệt</p><p className="truncate text-xs text-white/80">Tổng điều phối · riêng của Sếp</p></div>
        <button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/15 hover:bg-white/25" title="Thu gọn"><X className="h-5 w-5" /></button>
      </div>
      <div className="grid grid-cols-3 gap-1.5 border-b border-line p-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx("flex items-center justify-center gap-1.5 rounded-xl border px-1 py-1.5 text-xs font-medium transition", tab === t.key ? "border-blue-500/60 bg-blue-500/10 text-blue-700 dark:text-blue-300" : "border-line text-muted hover:bg-soft")}>
            <span className="relative"><t.icon className="h-3.5 w-3.5" />{t.key === "findings" && urgent > 0 && <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-rose-500" />}</span>{t.label}
          </button>
        ))}
      </div>
      {tab === "chat" && <ChatTab info={info.data} threadId={threadId} setThreadId={setThreadId} newThread={newThread} pendingAsk={pendingAsk} clearAsk={() => setPendingAsk(null)} onSettings={info.reload} />}
      {tab === "dispatch" && <DispatchTab />}
      {tab === "findings" && <FindingsTab data={findings.data} ask={(t) => { setTab("chat"); setPendingAsk(t); }} />}
      {tab === "history" && <HistoryTab current={threadId} open={(id) => { setThreadId(id); setTab("chat"); }} />}
      {tab === "feedback" && <FeedbackTab open={(id) => { setThreadId(id); setTab("chat"); }} />}
      {tab === "reminders" && <RemindersTab ask={(t) => { setTab("chat"); setPendingAsk(t); }} />}
    </div>
    </>
  );
}

function ChatTab({ info, threadId, setThreadId, newThread, pendingAsk, clearAsk, onSettings }: { info: any; threadId: string | null; setThreadId: (id: string | null) => void; newThread: () => Promise<string | null>; pendingAsk: string | null; clearAsk: () => void; onSettings: () => void }) {
  const threads = useApi<any[]>("assistant/threads");
  const thread = useApi<any>(threadId ? `assistant/threads/${threadId}` : null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState<string>("");
  const toast = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const t = thread.data;
  const running = !!t?.running || (t?.messages ?? []).some((m: any) => m.status === "streaming");

  // A stale stored id (thread deleted) → start clean.
  useEffect(() => { if (thread.error && threadId) setThreadId(null); }, [thread.error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setModel(t?.model ?? ""); }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live: patch the streaming message in place; reload on structural changes (new card, done, dispatch).
  useEvents((e) => {
    if (e.type !== "assistant.updated") return;
    const p = e.payload ?? {};
    if (p.threadId && p.threadId !== threadId) { if (!p.messageId) threads.reload(); return; }
    if (p.messageId && typeof p.text === "string" && thread.data) {
      thread.setData((d: any) => d && ({ ...d, running: true, messages: d.messages.map((m: any) => (m.id === p.messageId ? { ...m, text: p.text, log: p.log ?? m.log, status: p.status ?? m.status } : m)) }));
      return;
    }
    thread.reload();
    if (p.status === "done") threads.reload();
  });
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [t?.messages?.length, t?.messages?.at(-1)?.text?.length, t?.actions?.length]);

  const send = async (raw?: string) => {
    const msg = (raw ?? text).trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      const id = threadId ?? (await newThread());
      if (!id) return;
      if (!raw) setText("");
      await api.post(`assistant/threads/${id}/messages`, { text: msg, model: model || undefined });
      if (id !== threadId) setThreadId(id);
      else thread.reload();
      threads.reload();
    } catch (e: any) { toast(e.message, "err"); if (!raw) setText(msg); } finally { setSending(false); }
  };
  useEffect(() => { if (pendingAsk) { clearAsk(); void send(pendingAsk); } }, [pendingAsk]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = async () => { if (threadId) await api.post(`assistant/threads/${threadId}/stop`).catch(() => {}); };
  const speech = useSpeech((t) => setText((x) => (x ? `${x} ${t}` : t)));
  const setAuto = async (v: boolean) => {
    try { await api.put("assistant/settings", { autoConfirm: v }); onSettings(); toast(v ? "Ngân Nguyệt sẽ tự thực hiện thao tác nhạy cảm (không hỏi lại)" : "Thao tác nhạy cảm sẽ cần Sếp bấm xác nhận", v ? "info" : "ok"); } catch (e: any) { toast(e.message, "err"); }
  };

  // Interleave confirm cards with messages by time.
  const items = useMemo(() => {
    const ms = (t?.messages ?? []).map((m: any) => ({ k: "m", at: m.created_at, m }));
    const as = (t?.actions ?? []).map((a: any) => ({ k: "a", at: a.created_at, a }));
    return [...ms, ...as].sort((x, y) => x.at.localeCompare(y.at));
  }, [t]);

  return (
    <>
      <div className="space-y-2 border-b border-line p-2">
        <div className="flex gap-1.5">
          <select className="min-w-0 flex-1 rounded-xl border border-line bg-card px-2.5 py-1.5 text-xs text-ink" value={threadId ?? ""} onChange={(e) => setThreadId(e.target.value || null)}>
            <option value="">— Cuộc trò chuyện mới —</option>
            {(threads.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
          <button onClick={() => void newThread()} className="flex items-center gap-1 rounded-xl border border-line px-2.5 text-xs font-semibold text-ink hover:bg-soft"><Plus className="h-3.5 w-3.5" />Mới</button>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            className="min-w-0 flex-1 rounded-xl border border-line bg-card px-2.5 py-1.5 text-xs text-ink"
            value={model}
            onChange={async (e) => {
              const v = e.target.value;
              setModel(v);
              try {
                await api.put("assistant/settings", { model: v || null });
                onSettings();
                if (v) toast(`Ngân Nguyệt & hệ thống đã kích hoạt model: ${v}`);
              } catch (err: any) { toast(err.message, "err"); }
            }}
            title="Chọn model AI (tự động kích hoạt CLI tương ứng: Grok, Claude, Codex, Gemini)"
          >
            <option value="">Model mặc định ({info?.settings?.model ?? info?.defaultModel ?? "…"})</option>
            {info?.allCatalogs ? (
              Object.entries(info.allCatalogs as Record<string, any[]>).map(([prov, items]) => (
                <optgroup key={prov} label={prov === "grok_cli" ? "Grok Bot (Grok CLI)" : prov === "claude_cli" ? "Claude (Claude Code CLI)" : prov === "codex_cli" ? "ChatGPT (Codex CLI)" : "Google Gemini (Gemini CLI)"}>
                  {(items ?? []).map((m: any) => (
                    <option key={`${prov}-${m.id}`} value={m.id}>{m.label} ({m.id})</option>
                  ))}
                </optgroup>
              ))
            ) : (
              (info?.models ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)
            )}
          </select>
          <label className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line px-2 py-1 text-[11px] text-muted" title="Bật: Ngân Nguyệt tự thực hiện thao tác nhạy cảm (duyệt, trả lời khách, đổi quảng cáo, tốn tín dụng Flow…) không cần Sếp bấm xác nhận">
            <ShieldCheck className={cx("h-3.5 w-3.5", info?.settings?.autoConfirm ? "text-amber-500" : "text-emerald-500")} />Tự thực hiện
            <Toggle checked={!!info?.settings?.autoConfirm} onChange={setAuto} />
          </label>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm scroll-thin">
        {!items.length ? (
          <div className="flex flex-col items-center px-2 pt-6 text-center">
            <NguyetAvatar size={72} />
            <p className="mt-3 font-semibold text-ink">Em là Ngân Nguyệt — trợ lý riêng của Sếp.</p>
            <p className="mt-1 text-xs text-muted">Em điều phối toàn bộ Agentic AI: giao việc ngay cho các agent, theo dõi và can thiệp mọi tác vụ, báo cáo số liệu thật. Đổi model ở trên sẽ tự động chuyển đổi giữa Grok Bot, Claude Code, Codex và Gemini.</p>
            {info && !info.ready && <p className="mt-2 rounded-xl bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">{info.authError ?? "Chọn và đăng nhập Grok, Claude, ChatGPT hoặc Gemini trong Kết nối AI để em làm việc."}</p>}
            <div className="mt-4 flex flex-col items-center gap-2">
              {(info?.suggestions ?? []).map((s: string) => (
                <button key={s} onClick={() => void send(s)} className="rounded-full border border-dashed border-blue-400/60 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-500/5 dark:text-blue-300">{s}</button>
              ))}
            </div>
          </div>
        ) : items.map((it: any) => it.k === "m" ? <MessageBubble key={it.m.id} m={it.m} /> : <ActionCard key={it.a.id} a={it.a} onDone={thread.reload} />)}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-line p-2">
        <button onClick={speech.toggle} disabled={!speech.supported} title={speech.supported ? (speech.listening ? "Dừng nghe" : "Nói (tiếng Việt)") : "Trình duyệt chưa hỗ trợ nhận giọng nói"}
          className={cx("grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border", speech.listening ? "animate-pulse border-rose-400 bg-rose-500 text-white" : "border-line text-ink hover:bg-soft disabled:opacity-40")}>{speech.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</button>
        <textarea rows={1} value={speech.interim ? `${text} ${speech.interim}` : text} onChange={(e) => setText(e.target.value)} placeholder="Nhắn Ngân Nguyệt…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-blue-500" />
        {running
          ? <button onClick={stop} className="flex h-[42px] items-center gap-1.5 rounded-xl bg-rose-500 px-3 text-sm font-semibold text-white hover:bg-rose-600"><Square className="h-4 w-4" />Dừng</button>
          : <button onClick={() => void send()} disabled={!text.trim() || sending} className="flex h-[42px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Gửi</button>}
      </div>
    </>
  );
}

function MessageBubble({ m }: { m: any }) {
  if (m.role === "user") return <div className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-white">{m.text}</div></div>;
  const steps = (m.log ?? []) as any[];
  const streaming = m.status === "streaming";
  return (
    <div className="flex gap-2">
      <NguyetAvatar size={28} ring={false} />
      <div className="min-w-0 max-w-[88%] space-y-1.5">
        {steps.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {steps.map((s, i) => (
              <span key={i} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px]", s.ok === false ? "bg-rose-500/10 text-rose-600" : "bg-soft text-muted")}>
                {s.ok === undefined && streaming ? <Loader2 className="h-3 w-3 animate-spin" /> : s.ok === false ? <XCircle className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}{s.text}
              </span>
            ))}
          </div>
        )}
        <div className="rounded-2xl rounded-tl-md bg-soft px-3 py-2 text-ink">
          {m.text ? <Markdown text={m.text} /> : streaming ? <span className="flex items-center gap-2 text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Ngân Nguyệt đang xử lý…</span> : null}
          {m.status === "error" && <p className="mt-1 text-xs text-rose-600">{m.error ?? "Lỗi"}</p>}
        </div>
        <div className="flex items-center gap-1 pl-1 text-[10px] text-muted">
          <span>{timeAgo(m.updated_at ?? m.created_at)}{m.model ? ` · ${m.model}` : ""}</span>
          {!streaming && m.text && <Rate m={m} />}
        </div>
      </div>
    </div>
  );
}

/** 👍/👎 on an answer; 👎 asks what to do differently — Ngân Nguyệt applies it from the next message on. */
function Rate({ m }: { m: any }) {
  const [fb, setFb] = useState<string | null>(m.feedback ?? null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState(m.feedback_note ?? "");
  const toast = useToast();
  const save = async (feedback: "up" | "down" | null, n?: string) => {
    try { await api.post(`assistant/messages/${m.id}/feedback`, { feedback, note: n }); setFb(feedback); if (n) toast("Đã ghi góp ý — Ngân Nguyệt sẽ làm theo từ tin sau"); } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <span className="relative ml-auto flex items-center gap-0.5">
      <button onClick={() => save(fb === "up" ? null : "up")} className={cx("rounded p-1 hover:bg-soft", fb === "up" && "text-emerald-600")} title="Hữu ích"><ThumbsUp className="h-3 w-3" /></button>
      <button onClick={() => { if (fb === "down") void save(null); else { setAsking(true); void save("down"); } }} className={cx("rounded p-1 hover:bg-soft", fb === "down" && "text-rose-600")} title="Chưa ổn"><ThumbsDown className="h-3 w-3" /></button>
      {asking && (
        <span className="absolute right-0 top-6 z-10 flex w-64 gap-1 rounded-xl border border-line bg-card p-1.5 shadow-lg">
          <input autoFocus className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink" placeholder="Lần sau em nên làm khác thế nào?" value={note} onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { void save("down", note); setAsking(false); } if (e.key === "Escape") setAsking(false); }} />
          <button onClick={() => { void save("down", note); setAsking(false); }} className="rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white">Gửi</button>
        </span>
      )}
    </span>
  );
}

function ActionCard({ a, onDone }: { a: any; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const act = async (what: "confirm" | "cancel") => {
    setBusy(what);
    try {
      const r = await api.post(`assistant/actions/${a.id}/${what}`);
      toast(what === "cancel" ? "Đã hủy thao tác" : r.status === "done" ? "Đã thực hiện" : "Thực hiện lỗi", r.status === "failed" ? "err" : "ok");
      onDone();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const tone = a.status === "pending" ? "border-amber-400/60 bg-amber-500/5" : a.status === "done" ? "border-emerald-400/50 bg-emerald-500/5" : a.status === "failed" ? "border-rose-400/50 bg-rose-500/5" : "border-line bg-soft";
  return (
    <div className={cx("ml-9 rounded-xl border p-3 text-xs", tone)}>
      <p className="flex items-center gap-1.5 font-semibold text-ink"><ShieldCheck className="h-4 w-4 text-amber-500" />{a.title}</p>
      {a.summary && <p className="mt-1 whitespace-pre-wrap text-muted">{a.summary}</p>}
      <p className="mt-1 font-mono text-[10px] text-muted">{a.params?.method} {a.params?.path}</p>
      {a.status === "pending" ? (
        <div className="mt-2 flex gap-2">
          <button onClick={() => act("confirm")} disabled={!!busy} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy === "confirm" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Xác nhận</button>
          <button onClick={() => act("cancel")} disabled={!!busy} className="rounded-lg border border-line px-3 py-1.5 font-medium text-ink hover:bg-soft disabled:opacity-60">Hủy</button>
        </div>
      ) : (
        <p className={cx("mt-2 font-medium", a.status === "done" ? "text-emerald-600" : a.status === "failed" ? "text-rose-600" : "text-muted")}>
          {a.status === "done" ? "✓ Đã thực hiện" : a.status === "failed" ? `✗ Lỗi: ${a.result?.error ?? ""}` : "Đã hủy"}{a.decided_at ? ` · ${timeAgo(a.decided_at)}` : ""}
        </p>
      )}
    </div>
  );
}

function DispatchTab() {
  const { data } = useApi<any[]>("assistant/dispatches", ["assistant.", "task.", "creative.", "approval.", "goal."]);
  if (!data) return <div className="grid flex-1 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (!data.length) return <p className="flex-1 p-6 text-center text-sm text-muted">Chưa giao việc nào. Ví dụ: “Giao Content Agent viết bài Facebook về khóa học X”.</p>;
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3 scroll-thin">
      {data.map((d) => {
        const [label, tone] = STATUS_VI[d.status] ?? [d.status, "gray"];
        return (
          <Link key={d.id} to={d.link} className="block rounded-xl border border-line p-3 hover:bg-soft">
            <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium text-ink">{d.title}</p><Badge tone={tone}>{["running", "in_review", "revising"].includes(d.status) && <Loader2 className="h-3 w-3 animate-spin" />}{label}</Badge></div>
            <p className="mt-1 truncate text-xs text-muted">{d.kind} · {timeAgo(d.created_at)}{d.step ? ` · ${d.step}` : ""}</p>
          </Link>
        );
      })}
    </div>
  );
}

function FindingsTab({ data, ask }: { data: any[] | null; ask: (t: string) => void }) {
  if (!data) return <div className="grid flex-1 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (!data.length) return <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted"><CheckCircle2 className="h-8 w-8 text-emerald-500" />Hệ thống ổn, chưa có gì cần Sếp để ý.</div>;
  const Icon = { urgent: AlertTriangle, warning: CircleDot, info: Info } as const;
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3 scroll-thin">
      {data.map((f, i) => {
        const I = Icon[f.level as keyof typeof Icon] ?? Info;
        return (
          <div key={i} className={cx("rounded-xl border p-3", f.level === "urgent" ? "border-rose-400/50 bg-rose-500/5" : f.level === "warning" ? "border-amber-400/50 bg-amber-500/5" : "border-line")}>
            <p className="flex items-start gap-2 text-sm font-medium text-ink"><I className={cx("mt-0.5 h-4 w-4 shrink-0", f.level === "urgent" ? "text-rose-500" : f.level === "warning" ? "text-amber-500" : "text-blue-500")} />{f.title}</p>
            {f.detail && <p className="mt-1 pl-6 text-xs text-muted">{f.detail}</p>}
            <div className="mt-2 flex gap-2 pl-6">
              <button onClick={() => ask(f.ask)} className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"><Moon className="h-3 w-3" />Nhờ Ngân Nguyệt xử lý</button>
              <Link to={f.link} className="flex items-center gap-0.5 rounded-lg border border-line px-2.5 py-1 text-xs text-ink hover:bg-soft">Mở<ChevronRight className="h-3 w-3" /></Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HistoryTab({ current, open }: { current: string | null; open: (id: string) => void }) {
  const { data, reload } = useApi<any[]>("assistant/threads", ["assistant."]);
  const toast = useToast();
  const del = async (id: string) => { try { await api.del(`assistant/threads/${id}`); reload(); } catch (e: any) { toast(e.message, "err"); } };
  if (!data) return <div className="grid flex-1 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (!data.length) return <p className="flex-1 p-6 text-center text-sm text-muted">Chưa có cuộc trò chuyện nào.</p>;
  return (
    <div className="flex-1 space-y-1 overflow-y-auto p-2 scroll-thin">
      {data.map((t) => (
        <Fragment key={t.id}>
          <div className={cx("group flex items-center gap-2 rounded-xl p-2.5", t.id === current ? "bg-blue-500/10" : "hover:bg-soft")}>
            <button onClick={() => open(t.id)} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-medium text-ink">{t.title}</p><p className="text-[11px] text-muted">{t.messages} tin · {timeAgo(t.last_message_at ?? t.created_at)}</p></button>
            <button onClick={() => del(t.id)} className="hidden rounded-lg p-1.5 text-muted hover:bg-rose-500/10 hover:text-rose-600 group-hover:block" title="Xóa"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function FeedbackTab({ open }: { open: (threadId: string) => void }) {
  const { data } = useApi<any[]>("assistant/feedback", ["assistant."]);
  if (!data) return <div className="grid flex-1 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  const up = data.filter((d) => d.feedback === "up").length;
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3 scroll-thin">
      <p className="rounded-xl bg-soft p-3 text-xs text-muted">Bấm 👍/👎 dưới mỗi câu trả lời. Góp ý kèm ghi chú (👎) được Ngân Nguyệt áp dụng ngay từ tin nhắn sau và lưu vào Agentic Brain (12. Bài học).{data.length ? ` Đã chấm ${data.length}: 👍 ${up} · 👎 ${data.length - up}.` : ""}</p>
      {!data.length ? <p className="p-4 text-center text-sm text-muted">Chưa có phản hồi nào.</p> : data.map((d) => (
        <button key={d.id} onClick={() => open(d.thread_id)} className={cx("block w-full rounded-xl border p-3 text-left hover:bg-soft", d.feedback === "up" ? "border-emerald-400/40" : "border-rose-400/40")}>
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink">{d.feedback === "up" ? <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" /> : <ThumbsDown className="h-3.5 w-3.5 text-rose-600" />}<span className="truncate">{d.thread_title}</span><span className="ml-auto shrink-0 text-[10px] text-muted">{timeAgo(d.updated_at)}</span></p>
          {d.feedback_note && <p className="mt-1 text-xs font-semibold text-ink">“{d.feedback_note}”</p>}
          <p className="mt-1 line-clamp-2 text-[11px] text-muted">{d.text}</p>
        </button>
      ))}
    </div>
  );
}

function RemindersTab({ ask }: { ask: (t: string) => void }) {
  const { data, reload } = useApi<any[]>("brain/reminders", ["brain.", "assistant."]);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(() => { const d = new Date(Date.now() + 3600_000); d.setMinutes(0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); });
  const toast = useToast();
  const add = async () => {
    try { await api.post("brain/reminders", { title, due: due.replace("T", " ") }); setTitle(""); reload(); toast("Đã đặt nhắc việc"); } catch (e: any) { toast(e.message, "err"); }
  };
  const done = async (path: string) => { try { await api.post("brain/reminders/done", { path }); reload(); } catch (e: any) { toast(e.message, "err"); } };
  const fmt = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3 scroll-thin">
      <div className="space-y-2 rounded-xl border border-line p-3">
        <input className={inputCls} placeholder="Nhắc việc gì? (vd: Gọi nhà cung cấp)" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && title.trim().length > 1 && add()} />
        <div className="flex gap-2"><input type="datetime-local" className={cx(inputCls, "min-w-0 flex-1")} value={due} onChange={(e) => setDue(e.target.value)} /><button onClick={add} disabled={title.trim().length < 2} className="rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50">Đặt</button></div>
        <button onClick={() => ask("Nhắc tôi 3 giờ chiều mai gọi nhà cung cấp")} className="text-[11px] text-blue-600 hover:underline">…hoặc nói với Ngân Nguyệt: “Nhắc tôi 3 giờ chiều mai gọi nhà cung cấp”</button>
      </div>
      {!data ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted" /> : !data.length ? <p className="text-center text-sm text-muted">Chưa có nhắc việc nào sắp tới.</p> : data.map((r) => {
        const past = new Date(r.due).getTime() < Date.now();
        return (
          <div key={r.path} className={cx("flex items-start gap-2 rounded-xl border p-3", past ? "border-amber-400/50 bg-amber-500/5" : "border-line")}>
            <AlarmClock className={cx("mt-0.5 h-4 w-4 shrink-0", past ? "text-amber-500" : "text-blue-500")} />
            <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink">{r.title}</p><p className="text-[11px] text-muted">{fmt(r.due)}{r.notified ? " · đã nhắc" : past ? " · quá giờ" : ""}</p></div>
            <Link to={`/brain?note=${encodeURIComponent(r.path)}`} className="text-[11px] text-blue-600 hover:underline">Mở</Link>
            <button onClick={() => done(r.path)} className="rounded-lg border border-line px-2 py-0.5 text-[11px] text-ink hover:bg-soft">Xong</button>
          </div>
        );
      })}
    </div>
  );
}
