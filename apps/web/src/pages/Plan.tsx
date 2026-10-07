import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Lightbulb, Plus, RefreshCw, Target, Wand2 } from "lucide-react";
import { api, useApi } from "../lib/api";
import { TaskResult } from "../components/TaskResult";
import { AGENT_LABEL, CONTENT_STATUS, TASK_STATUS, ddmm, hhmm, num, timeAgo, vnd } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, PlatformIcon, Progress, cx, inputCls, platformName, useToast } from "../components/ui";

const TEMPLATE_LABEL: Record<string, string> = { launch_campaign: "Ra mắt chiến dịch (đủ 9 khâu)", weekly_content: "Nội dung tuần" };
const GOAL_STATUS: Record<string, { label: string; tone: any }> = {
  active: { label: "Đang chạy", tone: "green" }, done: { label: "Hoàn thành", tone: "blue" }, paused: { label: "Tạm dừng", tone: "amber" }, cancelled: { label: "Đã hủy", tone: "gray" },
};
const FUNNEL: Record<string, { label: string; tone: any }> = { tofu: { label: "TOFU · Nhận biết", tone: "blue" }, mofu: { label: "MOFU · Cân nhắc", tone: "violet" }, bofu: { label: "BOFU · Chốt đơn", tone: "green" } };
const DAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const EMPTY_FORM = { title: "", description: "", template: "launch_campaign", budgetAds: "", dueDate: "", stopAfter: "" };
/** Chạy chuỗi đến bước nào thì dừng (Sếp bấm "Triển khai tiếp" khi muốn đi tiếp). */
const STOP_LABEL: Record<string, string> = { "": "Chạy hết chuỗi (đến khi ra bài / kịch bản)", brief: "Dừng sau Brief", market_research: "Dừng sau Nghiên cứu thị trường", strategy: "Dừng sau Kế hoạch (chưa viết bài)" };
const STOP_SHORT: Record<string, string> = { brief: "Brief", market_research: "Nghiên cứu", strategy: "Kế hoạch" };

export function Plan() {
  const goals = useApi<any[]>("goals", ["task.", "goal.", "review.", "approval."]);
  const [weekOffset, setWeekOffset] = useState(0);
  const days = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + weekOffset * 7); // thứ Hai
    return Array.from({ length: 8 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [weekOffset]);
  const cal = useApi<any>(`calendar?from=${encodeURIComponent(days[0].toISOString())}&to=${encodeURIComponent(days[7].toISOString())}`, ["post.", "task.", "approval."]);
  const lessons = useApi<any[]>("lessons", ["proposal."]);
  const proposals = useApi<any[]>("change-proposals", ["proposal."]);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [learning, setLearning] = useState(false);

  const create = async () => {
    if (form.title.trim().length < 3 || form.description.trim().length < 3) return toast("Sếp nhập tiêu đề và mô tả (tối thiểu 3 ký tự)", "err");
    setBusy(true);
    try {
      await api.post("goals", { title: form.title.trim(), description: form.description.trim(), template: form.template, budgetAds: Math.max(0, Math.round(Number(form.budgetAds) || 0)), dueDate: form.dueDate || undefined, stopAfter: form.stopAfter || undefined });
      toast(form.stopAfter ? `Đội agent đã bắt đầu — sẽ dừng sau bước ${STOP_SHORT[form.stopAfter]}` : "Đội agent đã bắt đầu");
      setOpen(false); setForm(EMPTY_FORM); goals.reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const runLearn = async () => {
    setLearning(true);
    try {
      const r = await api.post("learn/run");
      toast(`Feedback loop xong · ${r?.proposals ?? 0} đề xuất thay đổi mới`);
      lessons.reload(); proposals.reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setLearning(false); }
  };

  const week = useMemo(() => {
    const entries = [
      ...(cal.data?.items ?? []).map((x: any) => ({ ...x, src: "item" })),
      ...(cal.data?.posts ?? []).map((x: any) => ({ ...x, src: "post", status: "published" })),
    ];
    return days.slice(0, 7).map((d) => ({ d, list: entries.filter((e) => new Date(e.at).toDateString() === d.toDateString()).sort((a, b) => a.at.localeCompare(b.at)) }));
  }, [cal.data, days]);

  return (
    <div className="space-y-6">
      <PageHeader title="Kế hoạch" subtitle="Giao mục tiêu cho đội Agent — họ tự lên brief, chiến lược, nội dung và lịch đăng." actions={<Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>Tạo kế hoạch mới</Button>} />

      {goals.loading && !goals.data ? <Loading /> : !goals.data?.length ? <Empty>Chưa có kế hoạch nào. Bấm “Tạo kế hoạch mới” để giao mục tiêu đầu tiên cho đội agent.</Empty> : (
        <div className="space-y-4">{goals.data.map((g) => <GoalCard key={g.id} g={g} />)}</div>
      )}

      <Card title="Lịch nội dung tuần" action={
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setWeekOffset((w) => w - 1)}>‹ Tuần trước</Button>
          {weekOffset !== 0 && <Button size="sm" variant="ghost" onClick={() => setWeekOffset(0)}>Tuần này</Button>}
          <Button size="sm" variant="ghost" onClick={() => setWeekOffset((w) => w + 1)}>Tuần sau ›</Button>
        </div>}>
        {cal.loading && !cal.data ? <Loading /> : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {week.map(({ d, list }) => {
              const today = d.toDateString() === new Date().toDateString();
              return (
                <div key={d.toISOString()} className={cx("min-h-28 rounded-xl border p-2", today ? "border-blue-500 bg-blue-500/5" : "border-line bg-page")}>
                  <p className={cx("mb-2 text-xs font-semibold", today ? "text-blue-600" : "text-muted")}>{DAYS[d.getDay()]} · {ddmm(d.toISOString())}</p>
                  <div className="space-y-1.5">
                    {list.length === 0 ? <p className="text-[11px] text-muted">—</p> : list.map((e: any) => (
                      <div key={e.src + e.id} className="rounded-lg border border-line bg-card p-1.5" title={e.title}>
                        <div className="flex items-center gap-1.5"><PlatformIcon p={e.channel} size={16} /><span className="text-[11px] text-muted">{hhmm(e.at)}</span></div>
                        <p className="mt-1 line-clamp-2 text-xs text-ink">{e.title}</p>
                        {CONTENT_STATUS[e.status] && <Badge tone={CONTENT_STATUS[e.status].tone} className="mt-1 !px-1.5 !text-[10px]">{CONTENT_STATUS[e.status].label}</Badge>}
                      </div>))}
                  </div>
                </div>);
            })}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-500" />Bài học đã rút ra</span>} action={<Button size="sm" variant="soft" icon={RefreshCw} loading={learning} onClick={runLearn}>Chạy feedback loop</Button>}>
          {!lessons.data ? <Loading /> : lessons.data.length === 0 ? <Empty>Chưa có bài học. Chạy feedback loop sau khi có số liệu bài đăng.</Empty> : (
            <div className="space-y-3">{lessons.data.map((l) => (
              <div key={l.id} className="rounded-xl border border-line p-3 text-sm">
                <p className="text-ink">{l.statement}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted"><Badge tone="blue">{AGENT_LABEL[l.agent_key] ?? l.agent_key}</Badge>{l.evidence?.note && <span>{l.evidence.note}</span>}<span>· {timeAgo(l.created_at)}</span></p>
              </div>))}</div>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Wand2 className="h-4 w-4 text-violet-500" />Đề xuất thay đổi</span>}>
          {!proposals.data ? <Loading /> : proposals.data.length === 0 ? <Empty>Chưa có đề xuất nào. Feedback loop sẽ tạo đề xuất khi phát hiện điểm cần cải thiện.</Empty> : (
            <div className="space-y-3">{proposals.data.map((p) => (
              <div key={p.id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex items-start justify-between gap-2"><p className="font-medium text-ink">{p.title}</p><Badge tone={p.status === "applied" ? "green" : p.status === "rejected" ? "red" : "amber"}>{PROP_STATUS[p.status] ?? p.status}</Badge></div>
                <p className="mt-1 text-xs text-muted">{p.rationale}</p>
                {p.risk && <p className="mt-1 text-xs text-muted">Rủi ro: {p.risk === "high" ? "cao" : p.risk === "medium" ? "trung bình" : "thấp"} · {timeAgo(p.created_at)}</p>}
              </div>))}</div>
          )}
        </Card>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Tạo kế hoạch mới"
        footer={<><Button onClick={() => setOpen(false)}>Hủy</Button><Button variant="primary" loading={busy} onClick={create}>Giao cho đội agent</Button></>}>
        <div className="space-y-3">
          <Field label="Tiêu đề mục tiêu"><input className={inputCls} placeholder="VD: Tuyển 120 học viên khóa CEO Vận Hành Tự Động đợt tháng 11" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Mô tả"><textarea rows={3} className={inputCls} placeholder="Bối cảnh, sản phẩm ưu tiên, kênh, ràng buộc…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mẫu quy trình"><select className={inputCls} value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value, stopAfter: e.target.value !== "launch_campaign" && form.stopAfter === "market_research" ? "" : form.stopAfter })}>{Object.entries(TEMPLATE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Chạy đến đâu" hint={form.stopAfter ? "Xong bước này là dừng — Sếp xem kết quả rồi bấm Triển khai tiếp" : "Chuỗi tự chạy, Kế hoạch vẫn chờ Sếp duyệt"}>
              <select className={inputCls} value={form.stopAfter} onChange={(e) => setForm({ ...form, stopAfter: e.target.value })}>
                {Object.entries(STOP_LABEL).filter(([v]) => v !== "market_research" || form.template === "launch_campaign").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ngân sách quảng cáo (VND)" hint={Number(form.budgetAds) ? vnd(Number(form.budgetAds)) : "Để trống nếu không chạy ads"}><input type="number" min={0} className={inputCls} value={form.budgetAds} onChange={(e) => setForm({ ...form, budgetAds: e.target.value })} /></Field>
            <Field label="Hạn hoàn thành"><input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
const PROP_STATUS: Record<string, string> = { draft: "Nháp", awaiting_approval: "Chờ duyệt", testing: "Đang thử", applied: "Đã áp dụng", rejected: "Bị từ chối", reverted: "Đã hoàn tác" };

function GoalCard({ g }: { g: any }) {
  const toast = useToast();
  const [continuing, setContinuing] = useState(false);
  const stopAt: string | null = g.params?.stopAfter ?? null;
  const goOn = async () => {
    setContinuing(true);
    try { await api.post(`goals/${g.id}/continue`); toast("Đã triển khai tiếp — các khâu sau bắt đầu chạy"); } catch (e: any) { toast(e.message, "err"); } finally { setContinuing(false); }
  };
  const [expanded, setExpanded] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const st = GOAL_STATUS[g.status] ?? { label: g.status, tone: "gray" };
  const tasks: any[] = g.tasks ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const s = g.strategy, b = g.brief;
  return (
    <Card>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><Target className="h-4 w-4 text-blue-600" /><h3 className="font-semibold text-ink">{g.title}</h3><Badge tone={st.tone}>{st.label}</Badge>{stopAt && <Badge tone="violet">Dừng sau: {STOP_SHORT[stopAt] ?? stopAt}</Badge>}</div>
          <p className="mt-1 text-sm text-muted">{g.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-4 text-sm">
          <div><p className="text-xs text-muted">Mẫu</p><p className="font-medium text-ink">{TEMPLATE_LABEL[g.template] ?? g.template}</p></div>
          <div><p className="text-xs text-muted">Ngân sách ads</p><p className="font-medium text-ink">{vnd(g.budget_ads)}</p></div>
          <div><p className="text-xs text-muted">Hạn</p><p className="font-medium text-ink">{g.due_date ? new Date(g.due_date).toLocaleDateString("vi-VN") : "—"}</p></div>
        </div>
      </div>
      {stopAt && g.status === "paused" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-violet-400/40 bg-violet-500/5 p-3">
          <p className="min-w-0 flex-1 basis-60 text-sm text-ink">Đã xong bước <b>{STOP_SHORT[stopAt] ?? stopAt}</b> và dừng theo yêu cầu. Bấm vào ô bên dưới để xem / sửa kết quả; khi ưng thì triển khai các khâu tiếp theo.</p>
          <Button size="sm" variant="primary" icon={Wand2} loading={continuing} onClick={goOn}>Triển khai tiếp</Button>
        </div>
      )}
      <div className="mt-4 flex items-center gap-3"><Progress value={tasks.length ? (done / tasks.length) * 100 : 0} tone="green" /><span className="whitespace-nowrap text-xs text-muted">{done}/{tasks.length} khâu xong</span></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {tasks.map((t, i) => {
          const ts = TASK_STATUS[t.status] ?? { label: t.status, tone: "gray" as const };
          return (
            <button key={t.id} onClick={() => setOpenTask(t.id)} title="Bấm để xem kết quả và chỉnh sửa" className="group rounded-xl border border-line bg-page p-3 text-left transition hover:border-blue-400 hover:shadow-sm">
              <div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-sm font-medium text-ink" title={t.title}>{i + 1}. {t.title}</p><Badge tone={ts.tone}>{ts.label}</Badge></div>
              <p className="mt-0.5 text-xs text-muted">{AGENT_LABEL[t.agent_key] ?? t.agent_key}{t.step ? ` · ${t.step}` : ""}</p>
              <div className="mt-2 flex items-center gap-2"><Progress value={(t.progress ?? 0) * 100} tone={ts.tone === "red" ? "red" : "blue"} className="h-1.5" /><span className="w-9 text-right text-[11px] text-muted">{Math.round((t.progress ?? 0) * 100)}%</span></div>
              <p className="mt-1.5 text-[11px] font-medium text-blue-600 opacity-70 group-hover:opacity-100">{ts.tone === "red" ? "Xem lý do & sửa →" : t.status === "done" || t.status === "awaiting_approval" ? "Xem kết quả & chỉnh sửa →" : "Xem chi tiết →"}</p>
            </button>);
        })}
      </div>
      <TaskResult id={openTask} onClose={() => setOpenTask(null)} />
      {(s || b) && (
        <button onClick={() => setExpanded(!expanded)} className="mt-4 flex items-center gap-1 text-sm font-medium text-blue-600">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}{expanded ? "Thu gọn" : "Xem brief & chiến lược"}
        </button>
      )}
      {expanded && (
        <div className="mt-4 space-y-5 border-t border-line pt-4 text-sm">
          {b?.kpis?.length > 0 && (
            <div><p className="mb-2 text-xs font-semibold uppercase text-muted">KPI từ Brief Agent</p>
              <div className="grid gap-2 sm:grid-cols-3">{b.kpis.map((k: any) => (
                <div key={k.metric} className="rounded-xl bg-soft p-3"><p className="text-xs text-muted">{k.metric}</p><p className="text-lg font-bold text-ink">{k.unit === "VND" ? vnd(k.target) : `${num(k.target)} ${k.unit}`}</p></div>))}</div>
              {b.feasibility?.notes && <p className="mt-2 text-xs text-muted">Khả thi: <Badge tone={b.feasibility.verdict === "ok" ? "green" : "amber"}>{b.feasibility.verdict === "ok" ? "Ổn" : "Cần xem lại"}</Badge> {b.feasibility.notes}</p>}
            </div>
          )}
          {s && (
            <>
              {s.positioning && <div><p className="mb-1 text-xs font-semibold uppercase text-muted">Định vị</p><p className="text-ink">{s.positioning}</p></div>}
              {s.funnel && (
                <div><p className="mb-2 text-xs font-semibold uppercase text-muted">Phễu</p>
                  <div className="grid gap-2 sm:grid-cols-3">{(["tofu", "mofu", "bofu"] as const).filter((k) => s.funnel[k]).map((k) => (
                    <div key={k} className="rounded-xl border border-line p-3"><Badge tone={FUNNEL[k].tone}>{FUNNEL[k].label}</Badge><p className="mt-2 text-ink">{s.funnel[k]}</p></div>))}</div>
                </div>
              )}
              {s.channelPlan?.length > 0 && (
                <div><p className="mb-2 text-xs font-semibold uppercase text-muted">Phân bổ kênh</p>
                  <div className="space-y-2">{s.channelPlan.map((c: any) => (
                    <div key={c.channel} className="grid grid-cols-[120px_1fr_40px] items-center gap-2 sm:grid-cols-[140px_1fr_48px_1fr]">
                      <span className="flex items-center gap-2 text-ink"><PlatformIcon p={c.channel} size={18} />{platformName(c.channel)}</span>
                      <Progress value={c.share * 100} /><span className="text-right text-xs text-muted">{Math.round(c.share * 100)}%</span>
                      <span className="col-span-3 text-xs text-muted sm:col-span-1">{c.role}</span>
                    </div>))}</div>
                </div>
              )}
              {s.options?.length > 0 && (
                <div><p className="mb-2 text-xs font-semibold uppercase text-muted">Phương án</p>
                  <div className="grid gap-2 sm:grid-cols-2">{s.options.map((o: any) => <div key={o.name} className="rounded-xl bg-soft p-3"><p className="font-medium text-ink">{o.name}</p><p className="text-xs text-muted">{o.tradeoffs}</p></div>)}</div>
                  {s.fallback && <p className="mt-2 text-xs text-muted">Phương án dự phòng: {s.fallback}</p>}
                </div>
              )}
              {s.contentPlan?.length > 0 && (
                <div><p className="mb-2 text-xs font-semibold uppercase text-muted">Kế hoạch nội dung</p>
                  <div className="divide-y divide-line rounded-xl border border-line">{s.contentPlan.map((c: any, i: number) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 p-2.5">
                      <PlatformIcon p={c.channel} size={18} /><span className="min-w-0 flex-1 text-ink">{c.topic}</span>
                      <span className="text-xs text-muted">{c.angle}</span>{FUNNEL[c.funnel] && <Badge tone={FUNNEL[c.funnel].tone}>{c.funnel.toUpperCase()}</Badge>}
                    </div>))}</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
