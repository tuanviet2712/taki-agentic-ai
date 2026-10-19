import { useState } from "react";
import { Bot, Send, CheckCircle2, Clock, Coins, Cpu, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { api, useApi } from "../lib/api";
import { TaskResult } from "../components/TaskResult";
import { AssignWork, type AssignRequest } from "../components/AssignWork";
import { AGENT_LABEL, TASK_STATUS, num, timeAgo } from "../lib/format";
import { Badge, Button, Card, Chevron, Collapse, Empty, Loading, Modal, PageHeader, Progress, Stat, Toggle, cx, inputCls, useOpen, useToast } from "../components/ui";

const AUTONOMY: Record<string, { label: string; hint: string }> = {
  L0: { label: "L0 · Gợi ý", hint: "Agent chỉ đề xuất, Sếp tự làm" },
  L1: { label: "L1 · Soạn sẵn chờ duyệt", hint: "Agent soạn, mọi thứ chờ Sếp duyệt trước khi ra ngoài" },
  L2: { label: "L2 · Tự làm trong giới hạn", hint: "Agent tự thực thi trong hạn mức đã đặt, vượt hạn mức mới hỏi" },
  L3: { label: "L3 · Tự chủ có giám sát", hint: "Agent tự quyết, Sếp xem báo cáo và có thể hoàn tác" },
};
const RETRYABLE = ["failed", "blocked"];
const CANCELLABLE = ["pending", "ready", "running", "in_review", "revising", "awaiting_approval", "blocked", "failed"];
const usd = (micros: number | null | undefined) => `$${((micros ?? 0) / 1e6).toFixed((micros ?? 0) < 1e6 ? 3 : 2)}`;

// Agents that call Claude through the LLM Gateway (others are deterministic code and/or Jev).
const LLM_AGENTS = new Set(["assistant", "brief", "market_research", "strategy", "content", "video_script", "seo_web", "chat", "ads", "review"]);

/** One agent as a compact row (name, status, on/off); settings drop down only when the row is opened. */
function AgentRow({ a, catalog, allCatalogs, putConfig, changeAutonomy, onAssign }: { a: any; catalog: any[]; allCatalogs?: Record<string, any[]>; putConfig: (key: string, patch: any, msg: string) => void; changeAutonomy: (agent: any, autonomy: string) => void; onAssign: () => void }) {
  const [open, toggleOpen] = useOpen(false);
  const cfg = a.config ?? {};
  const enabled = !!cfg.enabled;
  const autonomy = cfg.autonomy ?? a.autonomy;
  const budget = cfg.token_budget_day ?? a.tokenBudgetDay ?? 0;
  const usedPct = budget ? (a.tokensToday / budget) * 100 : 0;
  return (
    <div className={cx("border-b border-line", !enabled && "opacity-60")}>
      <div className="flex items-center gap-2 py-1">
        <button type="button" onClick={() => toggleOpen()} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-soft">
          <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", enabled ? "bg-blue-500/10 text-blue-600" : "bg-soft text-muted")}><Bot className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{a.label}</span>
            <span className="block truncate text-[11px] text-muted">{a.stage === 0 ? "Tổng điều phối" : `Khâu ${a.stage}`} · {a.done}/{a.tasks} tác vụ xong</span>
          </span>
          <Badge tone="gray" className="hidden shrink-0 sm:inline-flex" >{autonomy}</Badge>
          <Chevron open={open} />
        </button>
        <Toggle size="sm" checked={enabled} onChange={(v) => putConfig(a.key, { enabled: v }, `${a.label} đã ${v ? "bật" : "tắt"}`)} />
      </div>
      <Collapse open={open}>
        <div className="space-y-3 pb-4 pl-[3.25rem] pr-2 pt-1">
          <p className="text-xs leading-relaxed text-muted">{a.description}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1"><span className="text-[11px] font-medium text-muted">Mức tự chủ</span>
              <select className={cx(inputCls, "py-1.5 text-xs")} value={autonomy} onChange={(e) => changeAutonomy(a, e.target.value)} title={AUTONOMY[autonomy]?.hint}>
                {Object.entries(AUTONOMY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <div className="space-y-1"><span className="block text-[11px] font-medium text-muted">Model (tự kích hoạt CLI)</span>
              {LLM_AGENTS.has(a.key) ? (
                <select className={cx(inputCls, "py-1.5 text-xs")} value={a.modelOverride ?? ""} title={`Đang dùng: ${a.model}`}
                  onChange={(e) => putConfig(a.key, { model: e.target.value || null }, `${a.label}: ${e.target.value ? `dùng ${e.target.value} (đã kích hoạt CLI)` : "theo tầng mặc định"}`)}>
                  <option value="">Model theo tầng ({a.model})</option>
                  {allCatalogs ? (
                    Object.entries(allCatalogs).map(([prov, items]) => (
                      <optgroup key={prov} label={prov === "grok_cli" ? "Grok Bot (Grok CLI)" : prov === "claude_cli" ? "Claude (Claude Code CLI)" : prov === "codex_cli" ? "ChatGPT (Codex CLI)" : "Google Gemini (Gemini CLI)"}>
                        {(items ?? []).map((m: any) => <option key={`${prov}-${m.id}`} value={m.id}>{m.label} ({m.id})</option>)}
                      </optgroup>
                    ))
                  ) : (
                    catalog.map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)
                  )}
                </select>
              ) : <p className="rounded-xl bg-soft px-3 py-1.5 text-xs text-muted">Chạy bằng mã tất định{a.usesJev?.length ? " + Jev" : ""}</p>}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted"><span>Token hôm nay</span><span className="tabular-nums">{num(a.tokensToday)} / {num(budget)}</span></div>
            <Progress value={usedPct} tone={usedPct > 90 ? "red" : usedPct > 70 ? "amber" : "blue"} className="h-1.5" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {a.key !== "assistant" && (
              <Button size="sm" variant="soft" icon={Send} disabled={!enabled} title="Chạy riêng 1 việc ngoài luồng tự động — xong là dừng" onClick={onAssign}>Giao việc riêng</Button>
            )}
            {a.avgReview != null && <Badge tone={a.avgReview >= 80 ? "green" : a.avgReview >= 65 ? "amber" : "red"}>Review TB {a.avgReview}</Badge>}
            {a.usesJev?.length > 0 && <span title={a.usesJev.join(", ")} className="inline-flex max-w-full items-center gap-1 rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white"><Sparkles className="h-3 w-3 shrink-0" /><span className="truncate">Jev · {a.usesJev.join(", ")}</span></span>}
          </div>
        </div>
      </Collapse>
    </div>
  );
}

/** Task errors are stored as text or as an object ({ message }); never print "[object Object]". */
const errText = (e: unknown): string => (typeof e === "string" ? e : (e as any)?.message ?? (e as any)?.error ?? JSON.stringify(e));

/** One column template for header + rows: fixed widths so every row lines up and nothing spills out of the card. Agent column joins at xl. */
const TASK_COLS = "wide:grid-cols-[minmax(0,1fr)_104px_108px_92px_188px] xl:grid-cols-[minmax(0,1fr)_120px_104px_108px_92px_188px]";

export function Agents() {
  const agents = useApi<any[]>("agents", ["task.", "review.", "llm."]);
  const tasks = useApi<any[]>("tasks", ["task.", "review."]);
  const usage = useApi<any>("usage", ["task.", "review."]);
  const schedules = useApi<any[]>("schedules");
  const llm = useApi<any>("llm", ["llm."]);
  const toast = useToast();
  const [pending, setPending] = useState<{ agent: any; autonomy: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [assign, setAssign] = useState<AssignRequest>(null);

  const putConfig = async (key: string, patch: any, msg: string) => {
    try { await api.put(`agents/${key}/config`, patch); toast(msg); agents.reload(); } catch (e: any) { toast(e.message, "err"); }
  };
  const changeAutonomy = (agent: any, autonomy: string) => {
    const cur = agent.config?.autonomy ?? agent.autonomy;
    if (autonomy === cur) return;
    if (autonomy > cur) setPending({ agent, autonomy }); // raising autonomy is sensitive → confirm
    else void putConfig(agent.key, { autonomy }, `${agent.label}: hạ về ${AUTONOMY[autonomy].label}`);
  };
  const taskAction = async (id: string, action: "retry" | "cancel") => {
    try { await api.post(`tasks/${id}/${action}`); toast(action === "retry" ? "Đã chạy lại tác vụ" : "Đã hủy tác vụ"); tasks.reload(); } catch (e: any) { toast(e.message, "err"); }
  };
  const toggleSchedule = async (s: any, enabled: boolean) => {
    try { await api.put(`schedules/${s.id}`, { enabled }); toast(`${enabled ? "Đã bật" : "Đã tắt"}: ${s.label ?? s.name}`); schedules.reload(); } catch (e: any) { toast(e.message, "err"); }
  };

  const u = usage.data;
  const tokens = (u?.byAgent ?? []).reduce((a: number, r: any) => a + (r.tokens_in ?? 0) + (r.tokens_out ?? 0), 0);
  const cost = (u?.byAgent ?? []).reduce((a: number, r: any) => a + (r.cost_micros ?? 0), 0) + (u?.jev?.cost_micros ?? 0);
  const taskList = (tasks.data ?? []).filter((t) => !filter || t.status === filter);

  return (
    <div className="space-y-6">
      <PageHeader title="Agent & Tác vụ" subtitle="Bật/tắt từng agent, đặt mức tự chủ và theo dõi mọi tác vụ đội AI đang làm cho doanh nghiệp. Các agent tự chạy theo luồng; khi cần, giao việc riêng cho 1 agent — làm xong là dừng."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="soft" icon={Bot} className="whitespace-nowrap border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300" onClick={() => window.dispatchEvent(new CustomEvent("council:open"))}>Hội đồng Agent · Đa Model</Button>
            <Button variant="primary" icon={Send} className="whitespace-nowrap" onClick={() => setAssign({ agent: "" })}>Giao việc riêng</Button>
          </div>
        } />

      <div className="grid gap-4 sm:grid-cols-2 wide:grid-cols-5 sm:[&>*:last-child:nth-child(odd)]:col-span-2 wide:[&>*:last-child:nth-child(odd)]:col-span-1">
        <Stat icon={Cpu} tone="blue" label="Token (7 ngày)" value={num(tokens)} sub={`${(u?.byAgent ?? []).reduce((a: number, r: any) => a + r.calls, 0)} lượt gọi model`} />
        <Stat icon={Coins} tone="amber" label="Chi phí AI (7 ngày)" value={usd(cost)} sub="Model + Jev" />
        <Stat icon={CheckCircle2} tone="green" label="Tác vụ hoàn thành" value={num(u?.tasksDone ?? 0)} />
        <Stat icon={Clock} tone="violet" label="Thời gian TB/tác vụ" value={u?.avgTaskMinutes != null ? (u.avgTaskMinutes < 1 ? `${Math.max(1, Math.round(u.avgTaskMinutes * 60))} giây` : `${u.avgTaskMinutes.toFixed(1)} phút`) : "—"} />
        <Stat icon={Sparkles} tone="pink" label="Lượt Jev phán đoán" value={num(u?.jev?.calls ?? 0)} sub={u?.jev?.latency != null ? `độ trễ TB ${Math.round(u.jev.latency)} ms` : undefined} />
      </div>

      <Card title="Đội agent" bodyClass="p-3 pt-1" action={agents.data && <span className="text-xs text-muted">{agents.data.filter((a) => a.config?.enabled).length}/{agents.data.length} đang bật · bấm vào agent để chỉnh</span>}>
        {!agents.data ? <Loading /> : (
          <div className="grid items-start gap-x-4 lg:grid-cols-2">
            {agents.data.map((a) => (
              <AgentRow key={a.key} a={a} catalog={llm.data?.catalog ?? []} allCatalogs={llm.data?.allCatalogs} putConfig={putConfig} changeAutonomy={changeAutonomy} onAssign={() => setAssign({ agent: a.key })} />
            ))}
          </div>
        )}
      </Card>

      <AssignWork request={assign} onRequest={setAssign} />

      <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Tác vụ gần đây" action={
          <select className={cx(inputCls, "w-auto py-1.5 text-xs")} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Tất cả trạng thái</option>
            {Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>} bodyClass="px-0 pb-2">
          {!tasks.data ? <Loading /> : taskList.length === 0 ? <div className="px-5"><Empty>Không có tác vụ nào.</Empty></div> : (
            <div className="divide-y divide-line">
              <div className={cx("hidden gap-3 px-5 pb-2 text-xs font-medium text-muted wide:grid", TASK_COLS)}><span>Tác vụ</span><span className="hidden xl:block">Agent</span><span>Trạng thái</span><span>Tiến độ</span><span>Cập nhật</span><span className="text-right">Thao tác</span></div>
              {taskList.map((t) => {
                const st = TASK_STATUS[t.status] ?? { label: t.status, tone: "gray" as const };
                const lead: string = t.step ?? (t.error ? `Lỗi: ${errText(t.error)}` : "");
                return (
                  <div key={t.id} onClick={() => setDetailId(t.id)} className={cx("grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-5 py-3 hover:bg-soft", TASK_COLS)}>
                    <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{t.title}</p><p className="truncate text-xs text-muted">{lead}{lead && <span className="xl:hidden"> · </span>}<span className="xl:hidden">{AGENT_LABEL[t.agent_key] ?? t.agent_key}</span></p></div>
                    <span className="hidden truncate text-sm text-muted xl:block" title={AGENT_LABEL[t.agent_key] ?? t.agent_key}>{AGENT_LABEL[t.agent_key] ?? t.agent_key}</span>
                    <span><Badge tone={st.tone}>{st.label}</Badge></span>
                    <div className="flex min-w-0 items-center gap-2"><Progress value={(t.progress ?? 0) * 100} className="h-1.5" /><span className="w-9 shrink-0 text-right text-[11px] text-muted">{Math.round((t.progress ?? 0) * 100)}%</span></div>
                    <span className="truncate text-xs text-muted" title={timeAgo(t.updated_at)}>{timeAgo(t.updated_at)}</span>
                    <div className="col-span-2 flex min-w-0 justify-end gap-1.5 wide:col-span-1" onClick={(e) => e.stopPropagation()}>
                      {RETRYABLE.includes(t.status) && <Button size="sm" variant="soft" icon={RotateCcw} onClick={() => taskAction(t.id, "retry")}>Chạy lại</Button>}
                      {CANCELLABLE.includes(t.status) && <Button size="sm" variant="ghost" icon={XCircle} onClick={() => taskAction(t.id, "cancel")}>Hủy</Button>}
                    </div>
                  </div>);
              })}
            </div>
          )}
        </Card>

        <Card title="Kích hoạt tác vụ">
          <p className="mb-3 text-xs text-muted">Các tác vụ nền chạy định kỳ. Tắt khi Sếp muốn tạm dừng một mảng.</p>
          {!schedules.data ? <Loading /> : schedules.data.length === 0 ? <Empty>Chưa có lịch chạy.</Empty> : (
            <div className="divide-y divide-line">{schedules.data.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0"><p className="text-sm font-medium text-ink">{s.label ?? s.name}</p><p className="text-[11px] text-muted">{s.last_run_at ? `Lần chạy cuối ${timeAgo(s.last_run_at)}` : "Chưa chạy"}</p></div>
                <Toggle checked={!!s.enabled} onChange={(v) => toggleSchedule(s, v)} />
              </div>))}</div>
          )}
        </Card>
      </div>

      <Modal open={!!pending} onClose={() => setPending(null)} title="Nâng mức tự chủ của agent?"
        footer={<><Button onClick={() => setPending(null)}>Giữ nguyên</Button><Button variant="primary" onClick={() => { if (pending) void putConfig(pending.agent.key, { autonomy: pending.autonomy }, `${pending.agent.label}: đã chuyển sang ${AUTONOMY[pending.autonomy].label}`); setPending(null); }}>Xác nhận nâng quyền</Button></>}>
        {pending && (
          <div className="space-y-3 text-sm">
            <p className="text-ink"><b>{pending.agent.label}</b>: {AUTONOMY[pending.agent.config?.autonomy ?? pending.agent.autonomy]?.label} → <b>{AUTONOMY[pending.autonomy].label}</b></p>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">{AUTONOMY[pending.autonomy].hint}. Agent sẽ cần ít lần duyệt hơn — Sếp chỉ nên nâng khi điểm review đã ổn định.</div>
            {pending.agent.avgReview != null && <p className="text-xs text-muted">Điểm review trung bình hiện tại: {pending.agent.avgReview}/100</p>}
          </div>
        )}
      </Modal>

      <TaskResult id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

