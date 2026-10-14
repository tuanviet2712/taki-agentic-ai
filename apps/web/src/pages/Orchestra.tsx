import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bot, ChevronRight, ChevronsDownUp, ChevronsUpDown, Crown, FileClock, FlaskConical, Inbox, LayoutDashboard, ListChecks, Mail, Minus, Network,
  OctagonPause, Plus, Radio, ShieldCheck, Target, Users, Workflow,
} from "lucide-react";
import { api, useApi, useEvents } from "../lib/api";
import { hhmm, num, timeAgo, vnd } from "../lib/format";
import { Badge, Button, Field, Modal, cx, inputCls, useToast } from "../components/ui";
import { NguyetAvatar } from "../components/AssistantPanel";

// ---------------- Visual model ----------------
type Status = "idle" | "running" | "done" | "approval" | "error";
const ORDER = ["dna", "research", "strategy", "content", "media", "review", "publish", "scan", "ads", "chat", "analytics", "learn"];
const COLOR: Record<string, { bar: string; soft: string; text: string; stroke: string }> = {
  dna: { bar: "bg-pink-500", soft: "bg-pink-500/10", text: "text-pink-500", stroke: "#ec4899" },
  research: { bar: "bg-blue-500", soft: "bg-blue-500/10", text: "text-blue-500", stroke: "#3b82f6" },
  strategy: { bar: "bg-violet-500", soft: "bg-violet-500/10", text: "text-violet-500", stroke: "#8b5cf6" },
  content: { bar: "bg-emerald-500", soft: "bg-emerald-500/10", text: "text-emerald-500", stroke: "#10b981" },
  media: { bar: "bg-teal-400", soft: "bg-teal-400/10", text: "text-teal-500", stroke: "#2dd4bf" },
  publish: { bar: "bg-rose-400", soft: "bg-rose-400/10", text: "text-rose-500", stroke: "#fb7185" },
  scan: { bar: "bg-amber-400", soft: "bg-amber-400/10", text: "text-amber-500", stroke: "#fbbf24" },
  ads: { bar: "bg-red-500", soft: "bg-red-500/10", text: "text-red-500", stroke: "#ef4444" },
  analytics: { bar: "bg-green-500", soft: "bg-green-500/10", text: "text-green-600", stroke: "#22c55e" },
  chat: { bar: "bg-sky-400", soft: "bg-sky-400/10", text: "text-sky-500", stroke: "#38bdf8" },
  learn: { bar: "bg-purple-500", soft: "bg-purple-500/10", text: "text-purple-500", stroke: "#a855f7" },
  review: { bar: "bg-orange-400", soft: "bg-orange-400/10", text: "text-orange-500", stroke: "#fb923c" },
};
const STATUS: Record<Status, { label: string; dot: string; edge: string }> = {
  idle: { label: "Chờ nhiệm vụ", dot: "bg-slate-400", edge: "#cbd5e1" },
  running: { label: "Đang chạy", dot: "bg-blue-500", edge: "#6366f1" },
  done: { label: "Hoàn thành", dot: "bg-emerald-500", edge: "#10b981" },
  approval: { label: "Cần duyệt", dot: "bg-amber-500", edge: "#f59e0b" },
  error: { label: "Lỗi", dot: "bg-rose-500", edge: "#f43f5e" },
};
const AUTONOMY: Record<string, { label: string; cls: string; dot: string; desc: string }> = {
  L0: { label: "Đề xuất", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300", dot: "bg-blue-500", desc: "Đưa ra đề xuất, cần xem xét" },
  L1: { label: "Chờ duyệt", cls: "bg-orange-500/10 text-orange-700 dark:text-orange-300", dot: "bg-violet-500", desc: "Tự soạn, chờ CEO duyệt" },
  L2: { label: "Trong giới hạn", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500", desc: "Tự thực hiện trong phạm vi cho phép" },
  L3: { label: "Tự chủ", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300", dot: "bg-amber-500", desc: "Tự quyết định, có giám sát của CEO" },
};

// Canvas coordinates (logical px). Two layouts: "Vòng điều phối" (orbit) and "Dây chuyền" (pipeline).
const W = 1200, H = 640, NW = 250, NH = 118;
const CENTER = { x: 600, y: 318 };
const ORBIT: Record<string, { x: number; y: number }> = {
  dna: { x: 80, y: 8 }, research: { x: 348, y: 0 }, strategy: { x: 616, y: 0 }, content: { x: 884, y: 8 },
  review: { x: 0, y: 176 }, learn: { x: 0, y: 344 }, media: { x: 950, y: 176 }, publish: { x: 950, y: 344 },
  chat: { x: 80, y: 514 }, analytics: { x: 348, y: 522 }, ads: { x: 616, y: 522 }, scan: { x: 884, y: 514 },
};
const PIPE: Record<string, { x: number; y: number }> = Object.fromEntries(ORDER.map((k, i) => {
  const row = Math.floor(i / 4), col = row === 1 ? 3 - (i % 4) : i % 4; // snake: → ← →
  return [k, { x: 20 + col * 295, y: 10 + row * 215 }];
}));

type Group = { key: string; label: string; sub: string; status: Status; current: string | null; progress: number | null; autonomy: string; approvals: number; doneToday: number; queued: number; running: number; link: string; agents: string[] };

export function Orchestra() {
  const toast = useToast();
  const nav = useNavigate();
  const refresh = ["task.", "approval.", "review.", "post.", "metrics.", "action.", "conversation.", "lead.", "creative.", "automation.", "goal.", "alert.", "proposal."];
  const { data, reload } = useApi<any>("orchestra", refresh);
  const [layout, setLayout] = useState<"orbit" | "pipe">(() => { try { return (localStorage.getItem("orch.layout") as any) || "orbit"; } catch { return "orbit"; } });
  const [compact, setCompact] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(1);
  const [sim, setSim] = useState(false);
  const [simStep, setSimStep] = useState(-1);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [feed, setFeed] = useState<any[]>([]);
  const [open, setOpen] = useState<Group | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [haltOpen, setHaltOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem("orch.layout", layout); } catch { /* ignore */ } }, [layout]);
  // Queue jobs don't emit events: poll gently so "Đang chạy" shows for scheduled work too.
  useEffect(() => { const t = window.setInterval(() => void reload(), 8000); return () => window.clearInterval(t); }, [reload]);
  // Fit the canvas to the available width.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFit(Math.min(1, (el.clientWidth - 16) / W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Keep simulated lines on top while simulating; real events refresh underneath.
  useEffect(() => { if (data?.events) setFeed((fd) => [...(sim ? fd.filter((x) => x.sim).slice(0, 12) : []), ...data.events].slice(0, 40)); }, [data, sim]);
  // Live: flash the node an event belongs to (group resolved on next refetch; guess now for instant feedback).
  useEvents((e) => {
    const g = guessGroup(e.type, e.payload);
    if (g) setFlash((f) => ({ ...f, [g]: Date.now() }));
  });
  // Simulation: walk the pipeline so the CEO sees how work flows (visual only).
  useEffect(() => {
    if (!sim) { setSimStep(-1); return; }
    setSimStep(0);
    const t = window.setInterval(() => setSimStep((s) => (s + 1) % (ORDER.length + 2)), 1500);
    return () => window.clearInterval(t);
  }, [sim]);
  useEffect(() => {
    if (!sim || simStep < 0 || simStep >= ORDER.length) return;
    const k = ORDER[simStep];
    const g = data?.groups?.find((x: Group) => x.key === k);
    setFlash((f) => ({ ...f, [k]: Date.now() }));
    setFeed((fd) => [{ id: `sim${Date.now()}`, at: new Date().toISOString(), group: k, text: `(mô phỏng) ${g?.label ?? k} ${SIM_TEXT[k] ?? "đang xử lý"}`, sim: true }, ...fd].slice(0, 40));
  }, [simStep, sim]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups: Group[] = useMemo(() => {
    const list: Group[] = data?.groups ?? [];
    if (!sim || simStep < 0) return list;
    return list.map((g) => {
      const i = ORDER.indexOf(g.key);
      const status: Status = simStep >= ORDER.length ? "done" : i < simStep ? "done" : i === simStep ? (g.key === "strategy" || g.key === "review" ? "approval" : "running") : "idle";
      return { ...g, status, current: i === simStep ? SIM_TEXT[g.key] ?? "Đang xử lý" : i < simStep ? "Đã chuyển bước tiếp" : null, progress: i === simStep ? 0.6 : null };
    });
  }, [data, sim, simStep]);

  const pos = layout === "orbit" ? ORBIT : PIPE;
  const scale = zoom * fit;
  const anyRunning = groups.some((g) => g.status === "running");
  const ks = data?.killSwitch ?? {};
  const halted = !!ks.all;

  const setKill = async (area: string, on: boolean) => {
    try { await api.post("kill-switch", { area, on }); toast(on ? `Đã dừng: ${KILL_LABEL[area]}` : `Đã mở lại: ${KILL_LABEL[area]}`, on ? "err" : "ok"); reload(); } catch (e: any) { toast(e.message, "err"); }
  };

  return (
    <div className="-mx-1 space-y-4">
      {/* Header + toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 shadow-sm">
        <Network className="h-8 w-8 text-violet-600" />
        <div className="mr-auto">
          <h1 className="text-xl font-bold tracking-tight text-ink md:text-2xl">Bản đồ điều phối Agentic AI</h1>
          <p className="text-sm text-muted">Một người điều hành · AI phối hợp xuyên suốt Marketing & Bán hàng{data?.summary?.activeGoal ? ` · Mục tiêu: ${data.summary.activeGoal.title}` : ""}</p>
        </div>
        <Button size="sm" icon={layout === "orbit" ? Workflow : LayoutDashboard} onClick={() => setLayout(layout === "orbit" ? "pipe" : "orbit")}>{layout === "orbit" ? "Dạng dây chuyền" : "Dạng vòng điều phối"}</Button>
        <Button size="sm" icon={compact ? ChevronsUpDown : ChevronsDownUp} onClick={() => setCompact(!compact)}>{compact ? "Mở rộng" : "Thu gọn"}</Button>
        <div className="flex items-center rounded-xl border border-line">
          <button className="p-2 text-muted hover:text-ink" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))} aria-label="Thu nhỏ"><Minus className="h-4 w-4" /></button>
          <button className="w-14 text-sm tabular-nums text-ink" onClick={() => setZoom(1)} title="Về 100%">{Math.round(zoom * 100)}%</button>
          <button className="p-2 text-muted hover:text-ink" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))} aria-label="Phóng to"><Plus className="h-4 w-4" /></button>
        </div>
        <Button size="sm" variant="primary" icon={Target} className="!bg-violet-600 hover:!bg-violet-700" onClick={() => setGoalOpen(true)}>Giao mục tiêu</Button>
        <Button size="sm" variant={halted ? "success" : "secondary"} icon={OctagonPause} className={halted ? "" : "!border-rose-300 !text-rose-600"} onClick={() => (halted ? setKill("all", false) : setHaltOpen(true))}>{halted ? "Mở lại hệ thống" : "Tạm dừng hệ thống"}</Button>
        <Button size="sm" variant={sim ? "primary" : "secondary"} icon={FlaskConical} onClick={() => setSim(!sim)}>{sim ? "Tắt mô phỏng" : "Chế độ mô phỏng"}</Button>
      </div>

      {halted && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-700 dark:text-rose-300">Hệ thống đang TẠM DỪNG toàn bộ: agent không tạo tác động ra ngoài (đăng bài, quảng cáo, chat).</div>}
      {sim && <div className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-sm text-violet-700 dark:text-violet-300">Chế độ mô phỏng: minh hoạ đường đi của một mục tiêu qua 12 nhóm agent — không chạy thật, không tốn token.</div>}

      <div className="grid gap-4 min-[1800px]:grid-cols-[1fr_340px]">
        {/* Canvas */}
        <div ref={wrap} className="relative overflow-auto rounded-2xl border border-line bg-card shadow-sm scroll-thin" style={{ backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
          <div style={{ width: W * scale, height: H * scale }} className="relative mx-auto">
            <div className="absolute left-0 top-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
              <svg width={W} height={H} className="absolute inset-0">
                <defs>
                  {Object.entries(STATUS).map(([k, v]) => (
                    <marker key={k} id={`arr-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={v.edge} /></marker>
                  ))}
                </defs>
                {layout === "orbit" ? groups.map((g) => {
                  const p = pos[g.key];
                  if (!p) return null;
                  const end = { x: p.x + NW / 2, y: p.y + (p.y > CENTER.y ? 0 : p.y + NH < CENTER.y ? NH : NH / 2) };
                  if (p.y + NH >= CENTER.y - 40 && p.y <= CENTER.y + 40) end.x = p.x < CENTER.x ? p.x + NW : p.x;
                  const d = edgePath(CENTER, end, 100);
                  return <Edge key={g.key} id={g.key} d={d} status={g.status} flashing={Date.now() - (flash[g.key] ?? 0) < 4000} />;
                }) : ORDER.slice(0, -1).map((k, i) => {
                  const a = pos[k], b = pos[ORDER[i + 1]];
                  const sameRow = Math.abs(a.y - b.y) < 5;
                  const from = sameRow ? { x: a.x + (b.x > a.x ? NW : 0), y: a.y + NH / 2 } : { x: a.x + NW / 2, y: a.y + NH };
                  const to = sameRow ? { x: b.x + (b.x > a.x ? 0 : NW), y: b.y + NH / 2 } : { x: b.x + NW / 2, y: b.y };
                  const st = groups.find((g) => g.key === ORDER[i + 1])?.status ?? "idle";
                  return <Edge key={k} id={k} d={`M${from.x},${from.y} L${to.x},${to.y}`} status={st} flashing={Date.now() - (flash[ORDER[i + 1]] ?? 0) < 4000} />;
                })}
                {layout === "orbit" && (
                  <>
                    <path id="learnArc" d={`M${CENTER.x - 88},${CENTER.y + 70} A 110 110 0 0 0 ${CENTER.x + 88},${CENTER.y + 70}`} fill="none" />
                    <text className="fill-violet-500 text-[13px] font-semibold"><textPath href="#learnArc" startOffset="50%" textAnchor="middle">Vòng học từ kết quả</textPath></text>
                  </>
                )}
              </svg>

              {layout === "orbit" && (
                <div className="absolute" style={{ left: CENTER.x - 92, top: CENTER.y - 105 }}>
                  <div className={cx("relative grid h-[184px] w-[184px] place-items-center rounded-full border-4 border-violet-200 bg-gradient-to-b from-violet-50 to-white text-center shadow-[0_0_0_10px_rgba(139,92,246,0.06)] dark:border-violet-500/30 dark:from-violet-500/10 dark:to-card", anyRunning && "animate-[pulse_2.4s_ease-in-out_infinite]")}>
                    <div>
                      <button onClick={() => window.dispatchEvent(new CustomEvent("nguyet:ask", { detail: "Báo cáo nhanh: các agent đang làm gì, việc nào cần Sếp quyết?" }))} title="Hỏi Ngân Nguyệt" className="mx-auto block"><NguyetAvatar size={56} /></button>
                      <p className="mt-2 text-lg font-extrabold tracking-wide text-violet-800 dark:text-violet-200">AI ĐIỀU PHỐI</p>
                      <p className="text-xs text-violet-600">Ngân Nguyệt · Orchestrator</p>
                      <Link to="/approvals" className="mt-1 inline-block rounded-full border border-violet-200 bg-white px-3 py-0.5 text-[11px] font-medium text-violet-700 dark:border-violet-500/30 dark:bg-card">CEO duyệt quyết định{data?.summary?.pending ? ` · ${data.summary.pending}` : ""}</Link>
                    </div>
                  </div>
                </div>
              )}

              {groups.map((g) => {
                const p = pos[g.key];
                if (!p) return null;
                return <Node key={g.key} g={g} x={p.x} y={p.y} n={ORDER.indexOf(g.key) + 1} compact={compact} flashing={Date.now() - (flash[g.key] ?? 0) < 4000} onClick={() => setOpen(g)} />;
              })}
            </div>
          </div>
        </div>

        {/* CEO desk */}
        <aside className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-1">
          <section className="rounded-2xl border border-line bg-card p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-ink"><Crown className="h-5 w-5 text-violet-600" />Bàn điều hành CEO</h2>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat icon={Users} value={data?.summary?.groups ?? 12} label="nhóm agent" />
              <MiniStat icon={ListChecks} value={data?.summary?.running ?? 0} label="tác vụ đang chạy" live={anyRunning} />
            </div>
            <p className="mt-2 text-xs text-muted">Hôm nay hoàn thành {data?.summary?.doneToday ?? 0} tác vụ.</p>
          </section>

          <section className="rounded-2xl border border-line bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold text-ink"><Mail className="h-5 w-5 text-violet-600" />Hộp thư duyệt</h2><Link to="/approvals"><Button size="sm">Mở hộp thư</Button></Link></div>
            {!data?.inbox?.length ? (
              <div className="rounded-xl border border-dashed border-line p-5 text-center"><Inbox className="mx-auto h-6 w-6 text-violet-400" /><p className="mt-2 text-sm font-medium text-ink">Chưa có đề xuất chờ duyệt</p><p className="text-xs text-muted">Các đề xuất từ agent sẽ hiển thị ở đây.</p></div>
            ) : (
              <div className="space-y-1.5">{data.inbox.map((a: any) => (
                <Link key={a.id} to={`/approvals?id=${a.id}`} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-soft"><span className={cx("h-2 w-2 shrink-0 rounded-full", a.risk === "high" ? "bg-rose-500" : a.risk === "medium" ? "bg-amber-500" : "bg-emerald-500")} /><span className="min-w-0 flex-1 truncate text-ink">{a.title}</span><span className="text-[11px] text-muted">{timeAgo(a.created_at)}</span></Link>
              ))}</div>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-card p-4 shadow-sm">
            <h2 className="mb-2 flex items-center gap-2 font-bold text-ink"><Radio className={cx("h-5 w-5 text-violet-600", anyRunning && "animate-pulse")} />Luồng sự kiện trực tiếp</h2>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1 scroll-thin">
              {feed.length === 0 ? <p className="text-xs text-muted">Chưa có sự kiện.</p> : feed.slice(0, 30).map((e) => (
                <button key={e.id} onClick={() => { const g = groups.find((x) => x.key === e.group); if (g) setOpen(g); }} className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-soft">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR[e.group]?.stroke ?? "#8b5cf6" }} />
                  <span className="min-w-0 flex-1 text-ink">{e.text}</span>
                  <span className="shrink-0 tabular-nums text-muted">{hhmm(e.at)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-card p-4 shadow-sm">
            <h2 className="mb-2 flex items-center gap-2 font-bold text-ink"><ChevronsUpDown className="h-5 w-5 text-violet-600" />Mức tự chủ</h2>
            <div className="space-y-1.5">{Object.entries(AUTONOMY).map(([k, a]) => (
              <div key={k} className="flex items-center gap-2 rounded-lg bg-soft/60 px-2.5 py-1.5 text-xs"><span className={cx("h-3 w-3 rounded-full", a.dot)} /><b className="w-36 text-ink">{k} · {a.label}</b><span className="text-muted">{a.desc}</span></div>
            ))}</div>
            <Link to="/agents" className="mt-2 inline-block text-xs text-violet-600">Đổi mức tự chủ từng agent →</Link>
          </section>

          {/* Chiếm trọn hàng (col-span-full): chỉ số bên trái, công tắc dừng khẩn cấp bên phải, nhật ký ở góc tiêu đề. */}
          <section className="rounded-2xl border border-line bg-card p-4 shadow-sm md:col-span-full md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-bold text-ink"><ShieldCheck className="h-5 w-5 text-violet-600" />Giới hạn vận hành</h2>
              <Link to="/ads/logs" className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-line px-3.5 py-1.5 text-sm font-medium text-ink transition hover:bg-soft"><FileClock className="h-4 w-4 text-muted" />Xem nhật ký<ChevronRight className="h-4 w-4 text-muted" /></Link>
            </div>
            <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              {/* Hai chỉ số cùng khuôn: nhãn một dòng → số lớn → dòng phụ / thanh tiến độ, nên luôn thẳng hàng */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col justify-start gap-1 rounded-xl bg-soft/60 px-4 py-3.5">
                  <p className="truncate text-xs text-muted">Trần quảng cáo/ngày</p>
                  <p className="truncate text-xl font-bold leading-tight tabular-nums text-ink">{data ? vnd(data.limits.maxDailyAdBudget) : "—"}</p>
                  <p className="truncate text-[11px] text-muted">Tối đa mỗi ngày</p>
                </div>
                <div className="flex min-w-0 flex-col justify-start gap-1 rounded-xl bg-soft/60 px-4 py-3.5">
                  <p className="truncate text-xs text-muted">Token AI hôm nay</p>
                  <p className="truncate text-xl font-bold leading-tight tabular-nums text-ink">{data ? num(data.limits.aiTokensToday) : "—"}<span className="text-xs font-medium text-muted"> / {data ? num(data.limits.aiTokenBudget) : "—"}</span></p>
                  <div role="progressbar" aria-label="Token AI đã dùng hôm nay" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data?.limits?.aiTokenBudget ? Math.min(100, Math.round((data.limits.aiTokensToday / data.limits.aiTokenBudget) * 100)) : 0} className="mt-[3px] h-1.5 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${data?.limits?.aiTokenBudget ? Math.min(100, (data.limits.aiTokensToday / data.limits.aiTokenBudget) * 100) : 0}%` }} />
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-col">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Dừng khẩn cấp</p>
                <div className="grid flex-1 grid-cols-3 gap-3">
                  {(["publish", "ads", "chat"] as const).map((k) => (
                    <button key={k} onClick={() => setKill(k, !ks[k])} aria-pressed={!!ks[k]}
                      className={cx("flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-center text-sm font-semibold leading-tight transition", ks[k] ? "border-rose-500 bg-rose-500 text-white hover:bg-rose-600" : "border-rose-300 bg-rose-500/5 text-rose-600 hover:bg-rose-500/10 dark:border-rose-500/40")}>
                      <OctagonPause className="h-5 w-5" aria-hidden />
                      <span>{ks[k] ? "Mở lại" : "Dừng"} {KILL_LABEL[k]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {/* Platforms + legend */}
      <section className="rounded-2xl border border-line bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-ink">Nền tảng tích hợp</h2><Link to="/ads/integrations" className="text-xs text-violet-600">Quản lý kết nối →</Link></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
          {(data?.platforms ?? []).map((p: any) => (
            <Link key={p.key} to={p.state === "soon" ? "#" : `/ads/integrations?p=${p.key === "messenger" ? "meta" : p.key}`} className={cx("rounded-xl border border-line px-3 py-2 text-sm", p.state === "soon" && "pointer-events-none opacity-50")}>
              <p className="truncate font-medium text-ink">{p.name}</p>
              <span className={cx("mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium", p.state === "live" ? "bg-emerald-500/10 text-emerald-600" : p.state === "sandbox" ? "bg-amber-500/10 text-amber-600" : p.state === "error" ? "bg-rose-500/10 text-rose-600" : "bg-soft text-muted")}>{PLATFORM_STATE[p.state]}</span>
            </Link>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 pb-2 text-xs text-muted">
        <b className="text-ink">Chú thích trạng thái agent:</b>
        {(Object.keys(STATUS) as Status[]).map((s) => <span key={s} className="flex items-center gap-1.5"><span className={cx("h-2.5 w-2.5 rounded-full", STATUS[s].dot)} />{STATUS[s].label}</span>)}
        <span className="ml-auto">Token đầu vào: {data ? num(data.tokens.in) : "--"} · Token đầu ra: {data ? num(data.tokens.out) : "--"} · Claude: {data?.ai?.provider === "claude_cli" ? "CLI" : data?.ai?.provider ?? "--"} · Jev: {data?.ai?.jev ? "LIVE" : "heuristic"}</span>
      </div>

      {/* Group drawer */}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? <span className="flex items-center gap-2"><span className={cx("grid h-8 w-8 place-items-center rounded-lg", COLOR[open.key]?.soft, COLOR[open.key]?.text)}><Bot className="h-5 w-5" /></span>{open.label}</span> : ""}
        footer={open && <><Button onClick={() => setOpen(null)}>Đóng</Button><Button variant="primary" onClick={() => { const l = open.link; setOpen(null); nav(l); }}>Mở màn hình làm việc</Button></>}>
        {open && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">{open.sub}</p>
            <div className="flex flex-wrap gap-2"><span className={cx("rounded-lg px-2 py-0.5 text-xs font-medium", AUTONOMY[open.autonomy]?.cls)}>{open.autonomy} · {AUTONOMY[open.autonomy]?.label}</span><Badge tone={open.status === "running" ? "blue" : open.status === "done" ? "green" : open.status === "approval" ? "amber" : open.status === "error" ? "red" : "gray"}>{STATUS[open.status].label}</Badge></div>
            {open.current && <p className="rounded-xl bg-soft p-3 text-ink">{open.current}</p>}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-soft p-2"><p className="text-lg font-bold text-ink">{open.running}</p><p className="text-xs text-muted">đang chạy</p></div>
              <div className="rounded-xl bg-soft p-2"><p className="text-lg font-bold text-ink">{open.queued}</p><p className="text-xs text-muted">hàng đợi</p></div>
              <div className="rounded-xl bg-soft p-2"><p className="text-lg font-bold text-ink">{open.doneToday}</p><p className="text-xs text-muted">xong hôm nay</p></div>
            </div>
            <p className="text-xs text-muted">Agent trong nhóm: {open.agents.join(", ")}{open.approvals ? ` · ${open.approvals} mục chờ duyệt` : ""}</p>
            <div className="space-y-1">{feed.filter((e) => e.group === open.key).slice(0, 8).map((e) => <p key={e.id} className="text-xs text-muted">{hhmm(e.at)} · {e.text}</p>)}</div>
          </div>
        )}
      </Modal>

      <GoalModal open={goalOpen} onClose={() => setGoalOpen(false)} onDone={() => { setGoalOpen(false); reload(); }} />

      <Modal open={haltOpen} onClose={() => setHaltOpen(false)} title="Tạm dừng toàn hệ thống?"
        footer={<><Button onClick={() => setHaltOpen(false)}>Hủy</Button><Button variant="danger" icon={OctagonPause} onClick={() => { setHaltOpen(false); void setKill("all", true); }}>Tạm dừng</Button></>}>
        <p className="text-sm text-muted">Mọi agent ngừng tác động ra ngoài: không đăng bài, không đổi/tạo quảng cáo, chat chuyển hết cho người. Thao tác TẮT quảng cáo vẫn được phép để cắt lỗ. Sếp mở lại bất cứ lúc nào.</p>
      </Modal>
    </div>
  );
}

// ---------------- Pieces ----------------
const SIM_TEXT: Record<string, string> = {
  dna: "chuẩn hoá mục tiêu thành KPI", research: "quét đối thủ & insight khách", strategy: "lập chiến lược — chờ CEO duyệt", content: "viết bài + kịch bản video",
  media: "dựng video trên Flow", review: "chấm điểm — chờ CEO duyệt", publish: "lên lịch & đăng bài", scan: "quét bài, chọn bài tiềm năng",
  ads: "chạy ads từ bài tốt nhất", chat: "tư vấn & follow-up khách", analytics: "đo từ bài → ads → đơn", learn: "rút bài học cho vòng sau",
};
const KILL_LABEL: Record<string, string> = { publish: "đăng bài", ads: "quảng cáo", chat: "chat", all: "toàn hệ thống" };
const PLATFORM_STATE: Record<string, string> = { live: "Đã kết nối", sandbox: "Mô phỏng", error: "Lỗi kết nối", none: "Chưa kết nối", soon: "Giai đoạn sau" };

function guessGroup(type: string, p: any): string | null {
  const byAgent: Record<string, string> = { dna_intake: "dna", brief: "dna", market_research: "research", strategy: "strategy", content: "content", video_script: "content", seo_web: "content", creative: "media", publishing: "publish", post_scanner: "scan", ads: "ads", analytics: "analytics", chat: "chat", follow_up: "chat", feedback: "learn", review: "review" };
  if (p?.agent && byAgent[p.agent]) return byAgent[p.agent];
  if (type.startsWith("review.")) return "review";
  if (type === "post.published") return "publish";
  if (type.startsWith("post.")) return "scan";
  if (type.startsWith("creative.")) return "media";
  if (type.startsWith("conversation.") || type.startsWith("lead.")) return "chat";
  if (type.startsWith("action.") || type.startsWith("metrics.") || type.startsWith("automation.")) return "ads";
  if (type.startsWith("proposal.")) return "learn";
  if (type === "goal.created") return "dna";
  return null;
}

/** Curved edge from the orchestrator ring to a node. */
function edgePath(c: { x: number; y: number }, e: { x: number; y: number }, r: number) {
  const dx = e.x - c.x, dy = e.y - c.y, len = Math.hypot(dx, dy) || 1;
  const s = { x: c.x + (dx / len) * r, y: c.y + (dy / len) * r };
  const m = { x: (s.x + e.x) / 2 - (dy / len) * 22, y: (s.y + e.y) / 2 + (dx / len) * 22 };
  return `M${s.x},${s.y} Q${m.x},${m.y} ${e.x},${e.y}`;
}

function Edge({ id, d, status, flashing }: { id: string; d: string; status: Status; flashing: boolean }) {
  const active = status === "running" || flashing;
  const color = flashing && status === "idle" ? "#8b5cf6" : STATUS[status].edge;
  return (
    <g>
      <path id={`e-${id}`} d={d} fill="none" stroke={color} strokeWidth={active ? 2.4 : 1.6} strokeDasharray={active ? "7 6" : "5 6"} markerEnd={`url(#arr-${status})`} markerStart={`url(#arr-${status})`} opacity={status === "idle" && !flashing ? 0.9 : 1}>
        {active && <animate attributeName="stroke-dashoffset" from="26" to="0" dur="0.8s" repeatCount="indefinite" />}
      </path>
      {active && (
        <circle r="5" fill={color}>
          <animateMotion dur="1.6s" repeatCount="indefinite"><mpath href={`#e-${id}`} /></animateMotion>
        </circle>
      )}
    </g>
  );
}

function Node({ g, x, y, n, compact, flashing, onClick }: { g: Group; x: number; y: number; n: number; compact: boolean; flashing: boolean; onClick: () => void }) {
  const c = COLOR[g.key] ?? COLOR.strategy;
  const a = AUTONOMY[g.autonomy] ?? AUTONOMY.L1;
  const st = STATUS[g.status];
  return (
    <button onClick={onClick} style={{ left: x, top: y, width: NW, minHeight: compact ? 64 : NH }}
      className={cx("absolute overflow-hidden rounded-2xl border bg-card text-left shadow-[0_4px_16px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-lg",
        g.status === "running" ? "border-indigo-400 ring-4 ring-indigo-500/15" : g.status === "error" ? "border-rose-400" : g.status === "approval" ? "border-amber-400" : "border-line",
        flashing && "ring-4 ring-violet-500/25")}>
      <span className={cx("absolute inset-x-0 top-0 h-1.5", c.bar)} />
      <span className="absolute right-2 top-3 grid h-5 w-5 place-items-center rounded-full bg-soft text-[10px] font-bold text-muted" title="Thứ tự trong luồng">{n}</span>
      <div className="flex gap-3 px-3 pt-4">
        <span className={cx("relative grid h-11 w-11 shrink-0 place-items-center rounded-xl", c.soft, c.text)}>
          <Bot className="h-7 w-7" />
          {g.status === "running" && <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-indigo-500" />}
        </span>
        <div className="min-w-0 pr-4">
          <p className="line-clamp-2 text-[14.5px] font-bold leading-snug text-ink">{g.label}</p>
          {!compact && <p className="truncate text-xs text-muted">{g.sub}</p>}
          {!compact && <span className={cx("mt-1.5 inline-block rounded-lg px-2 py-0.5 text-xs font-semibold", a.cls)}>{g.autonomy} · {a.label}</span>}
        </div>
      </div>
      <div className="mt-2 border-t border-line px-3 py-1.5">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <span className={cx("h-2 w-2 shrink-0 rounded-full", st.dot, g.status === "running" && "animate-pulse")} />
          <span className="truncate">{g.status === "idle" ? (g.current ?? st.label) : g.current ?? st.label}</span>
        </p>
        {g.status === "running" && g.progress != null && <div className="mt-1 h-1 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(8, Math.min(100, g.progress * 100))}%` }} /></div>}
      </div>
    </button>
  );
}

function MiniStat({ icon: Icon, value, label, live }: { icon: any; value: number; label: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line p-3">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-600"><Icon className="h-5 w-5" /></span>
      <div><p className={cx("text-xl font-bold text-ink", live && "text-indigo-600")}>{value}</p><p className="text-xs text-muted">{label}</p></div>
    </div>
  );
}

function GoalModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ title: "", description: "", template: "weekly_content", budgetAds: 0, dueDate: "" });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post("goals", { ...f, budgetAds: Number(f.budgetAds) || 0, dueDate: f.dueDate || undefined });
      toast("Đã giao mục tiêu — các agent bắt đầu chạy, theo dõi trên bản đồ");
      setF({ title: "", description: "", template: "weekly_content", budgetAds: 0, dueDate: "" });
      onDone();
    } catch (e: any) { toast(e.details?.[0]?.message ?? e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} wide title="Giao mục tiêu cho đội AI Agent"
      footer={<><Button onClick={onClose}>Hủy</Button><Button variant="primary" icon={Target} loading={busy} disabled={f.title.length < 3 || f.description.length < 3} onClick={submit}>Giao mục tiêu</Button></>}>
      <div className="space-y-4">
        <Field label="Mục tiêu"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="VD: Tuyển sinh AI Business System tháng 11 — 300 lead, CPL ≤ 150.000đ" /></Field>
        <Field label="Mô tả / yêu cầu"><textarea className={cx(inputCls, "min-h-24")} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Đối tượng, sản phẩm chủ lực, kênh ưu tiên, lưu ý thương hiệu…" /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Kiểu chiến dịch"><select className={inputCls} value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}><option value="weekly_content">Nội dung hằng tuần</option><option value="launch_campaign">Chiến dịch ra mắt / tuyển sinh</option></select></Field>
          <Field label="Ngân sách ads (VNĐ)"><input type="number" step={1_000_000} className={inputCls} value={f.budgetAds} onChange={(e) => setF({ ...f, budgetAds: Number(e.target.value) })} /></Field>
          <Field label="Hạn chót"><input type="date" className={inputCls} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-muted">Luồng: DNA → Nghiên cứu → Chiến lược (Sếp duyệt) → Nội dung → Kiểm duyệt → Đăng → Quét → Ads → Chat → Đo lường → Học. Mọi bước L1 đều chờ Sếp duyệt.</p>
      </div>
    </Modal>
  );
}
