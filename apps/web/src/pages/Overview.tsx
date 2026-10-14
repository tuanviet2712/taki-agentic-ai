import { Link } from "react-router-dom";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, BarChart3, Eye, MessageSquareText, MousePointerClick, ShieldCheck, Sparkles } from "lucide-react";
import { api, useApi } from "../lib/api";
import { AGENT_LABEL, CONV_STATE, LEAD, TASK_STATUS, num, timeAgo, vnd } from "../lib/format";
import { Avatar, Badge, cx, Button, Card, Empty, Loading, PlatformIcon, Progress, Stat, platformName, useToast } from "../components/ui";

const STAGE_COLORS = ["#60a5fa", "#3b82f6", "#22c55e", "#f59e0b", "#f97316", "#f43f5e", "#a78bfa", "#6366f1", "#8b5cf6"];
const SOURCE_COLORS: Record<string, string> = { facebook: "#2563eb", tiktok: "#f43f5e", zalo: "#10b981", google_search: "#f59e0b", friend_referral: "#8b5cf6", event_or_seminar: "#06b6d4", khác: "#cbd5e1" };

export function Overview() {
  const { data: d, reload } = useApi<any>("overview", ["task.", "approval.", "conversation.", "lead.", "metrics.", "post.", "action."]);
  const { data: sys } = useApi<any>("system");
  const toast = useToast();
  if (!d) return <Loading />;

  const quickDecide = async (id: string, decision: "approve" | "reject") => {
    try {
      await api.post(`approvals/${id}/decide`, { decision, note: decision === "reject" ? "Từ chối nhanh từ trang tổng quan" : undefined });
      toast(decision === "approve" ? "Đã duyệt" : "Đã từ chối");
      reload();
    } catch (e: any) { toast(e.message, "err"); }
  };
  const goalPct = d.goal.yearTarget ? Math.round((d.goal.runRate / d.goal.yearTarget) * 100) : 0;
  const totalSources = d.sources.reduce((a: number, s: any) => a + s.n, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">Xin chào, {sys?.operator ?? "CEO"}! 👋</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">Đội AI Agent đang vận hành marketing và bán hàng cho {sys?.biz?.name ?? "doanh nghiệp"} hôm nay.</p>
        </div>
        <Card className="shrink-0 md:w-[400px]" bodyClass="p-4">
          {d.goal.yearTarget ? (
            <>
              <div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium">Tiến độ mục tiêu năm</span><span className="text-muted">run-rate {vnd(d.goal.runRate)} / {vnd(d.goal.yearTarget)}</span></div>
              <Progress value={goalPct} tone={goalPct >= 100 ? "green" : "blue"} />
              <p className="mt-2 text-xs text-muted">Đạt {goalPct}% nhịp cần thiết{d.goal.currentRunRate ? ` · xuất phát từ ${vnd(d.goal.currentRunRate)}/năm` : ""}</p>
            </>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="font-medium">DNA {sys?.brand ?? ""} chưa có mục tiêu doanh thu năm</p>
              <p className="text-xs text-muted">Run-rate hiện tại (14 ngày, sandbox): {vnd(d.goal.runRate)}/năm · {sys?.pendingConfirmations ?? 0} mục ⚠️ trong DNA chờ CEO xác nhận. <Link to="/dna" className="text-blue-600">Mở DNA →</Link></p>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat icon={BarChart3} tone="blue" label="Tổng doanh thu (7 ngày)" value={vnd(d.kpis.revenue.value)} delta={d.kpis.revenue.delta} />
        <Stat icon={MessageSquareText} tone="green" label="Khách hàng mới" value={num(d.kpis.newCustomers.value)} delta={d.kpis.newCustomers.delta} />
        <Stat icon={Eye} tone="violet" label="Lượt tiếp cận" value={num(d.kpis.reach.value)} delta={d.kpis.reach.delta} />
        <Stat icon={MousePointerClick} tone="amber" label="Chi phí quảng cáo" value={vnd(d.kpis.adSpend.value)} delta={d.kpis.adSpend.delta} invert />
      </div>

      <div className="grid gap-6 wide:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card title="Quy trình 9 khâu đang chạy" action={<Link to="/agents" className="flex items-center gap-1 text-sm text-blue-600">Xem chi tiết <ArrowRight className="h-4 w-4" /></Link>}>
            {(() => {
              const max = Math.max(1, ...d.stages.map((x: any) => Number(x.count) || 0));
              return (
                <ol className="grid gap-2 sm:grid-cols-3">
                  {d.stages.map((s: any, i: number) => {
                    const c = STAGE_COLORS[i % STAGE_COLORS.length];
                    const n = Number(s.count) || 0;
                    return (
                      <li key={s.key} className={cx("relative overflow-hidden rounded-xl border border-line bg-card px-2.5 pb-3 pt-2.5 transition-colors hover:bg-soft", n === 0 && "opacity-70")}>
                        <div className="flex items-center gap-2">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: c }}>{s.n}</span>
                          <p className="line-clamp-2 min-w-0 flex-1 text-[12px] font-medium leading-[1.25] text-ink" title={s.label}>{s.label}</p>
                          <p className="shrink-0 text-right leading-none"><span className="block text-lg font-bold tabular-nums text-ink">{n}</span><span className="mt-0.5 block text-[9px] text-muted">tác vụ</span></p>
                        </div>
                        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-soft" aria-hidden><span className="block h-full rounded-r-full" style={{ width: `${(n / max) * 100}%`, background: c }} /></span>
                      </li>
                    );
                  })}
                </ol>
              );
            })()}
          </Card>

          <Card title="Tác vụ đang chạy" action={<Link to="/agents" className="flex items-center gap-1 text-sm text-blue-600">Xem tất cả <ArrowRight className="h-4 w-4" /></Link>}>
            {d.runningTasks.length === 0 ? <Empty>Không có tác vụ nào đang chạy. Tạo mục tiêu mới ở trang Kế hoạch.</Empty> : (
              <div className="divide-y divide-line">
                {d.runningTasks.map((t: any) => {
                  const st = TASK_STATUS[t.status] ?? { label: t.status, tone: "gray" as const };
                  return (
                    <div key={t.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto_150px]">
                      <div className="min-w-0"><p className="truncate text-sm font-medium">{t.title}</p><p className="text-xs text-muted">{AGENT_LABEL[t.agent_key]}</p></div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <div className="hidden items-center gap-2 md:flex"><Progress value={(t.progress ?? 0) * 100} /><span className="w-10 text-right text-xs text-muted">{Math.round((t.progress ?? 0) * 100)}%</span></div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Hiệu quả theo nền tảng">
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={d.channels.map((c: any) => ({ ...c, name: platformName(c.channel) }))}>
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={num} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip formatter={(v: any) => num(v)} contentStyle={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--card)" }} />
                    <Bar dataKey="reach" name="Tiếp cận" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="engagement" name="Tương tác" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Nguồn đơn hàng (7 ngày)">
              <div className="flex items-center gap-4">
                <div className="relative h-44 w-44 shrink-0">
                  <ResponsiveContainer>
                    <PieChart><Pie data={d.sources} dataKey="n" nameKey="source" innerRadius={52} outerRadius={78} paddingAngle={2}>{d.sources.map((s: any) => <Cell key={s.source} fill={SOURCE_COLORS[s.source] ?? "#94a3b8"} />)}</Pie></PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 grid place-items-center text-center"><div><p className="text-2xl font-bold">{totalSources}</p><p className="text-xs text-muted">đơn hàng</p></div></div>
                </div>
                <div className="flex-1 space-y-2">
                  {d.sources.map((s: any) => (
                    <div key={s.source} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SOURCE_COLORS[s.source] ?? "#94a3b8" }} />{platformName(s.source)}</span>
                      <span className="text-muted">{Math.round((s.n / totalSources) * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          <Card title={<span className="flex items-center gap-2">Cần Sếp duyệt <Badge tone="red">{sys?.counts?.approvals ?? d.approvals.length}</Badge></span>} action={<Link to="/approvals" className="text-sm text-blue-600">Xem tất cả →</Link>}>
            {d.approvals.length === 0 ? <Empty>Không có gì chờ duyệt 🎉</Empty> : (
              <div className="space-y-4">
                {d.approvals.map((a: any) => (
                  <div key={a.id} className="space-y-2">
                    <Link to={`/approvals?id=${a.id}`} className="block text-sm font-medium hover:text-blue-600">{a.title}</Link>
                    <p className="text-xs text-muted">{AGENT_LABEL[a.agent_key] ?? a.agent_key} · {timeAgo(a.created_at)} {a.risk !== "low" && <Badge tone={a.risk === "high" ? "red" : "amber"} className="ml-1">Rủi ro {a.risk === "high" ? "cao" : "TB"}</Badge>}</p>
                    <div className="flex gap-2"><Button size="sm" variant="success" onClick={() => quickDecide(a.id, "approve")}>Duyệt</Button><Link to={`/approvals?id=${a.id}`}><Button size="sm">Xem & sửa</Button></Link></div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Hộp thư AI" action={<Link to="/chat" className="text-sm text-blue-600">Xem tất cả →</Link>}>
            <div className="space-y-3">
              {d.inbox.map((c: any) => (
                <Link key={c.id} to={`/chat?id=${c.id}`} className="flex gap-3 rounded-xl p-1 hover:bg-soft">
                  <div className="relative"><Avatar name={c.customer_name} /><span className="absolute -bottom-0.5 -right-0.5"><PlatformIcon p={c.channel === "pancake" ? "pancake" : c.channel} size={16} /></span></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2"><p className="truncate text-sm font-medium">{c.customer_name}</p><span className="text-xs text-muted">{timeAgo(c.last_message_at)}</span></div>
                    <p className="truncate text-xs text-muted">{c.last_preview}</p>
                    <div className="mt-1 flex gap-1"><Badge tone={CONV_STATE[c.state]?.tone}>{CONV_STATE[c.state]?.label}</Badge>{c.lead_grade && <Badge tone={LEAD[c.lead_grade]?.tone}>{LEAD[c.lead_grade]?.label}</Badge>}</div>
                  </div>
                </Link>
              ))}
            </div>
          </Card>

          <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600" />Jev đang gác cổng</span>} action={<Link to="/jev" className="text-sm text-blue-600">Chi tiết →</Link>}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <MiniStat label="Phán đoán 7 ngày" value={d.jev.judgments7d} />
              <MiniStat label="Chuyển sales/người" value={d.jev.handoffs} />
              <MiniStat label="Chặn chèn lệnh" value={d.jev.injections} icon />
              <MiniStat label="Câu trả lời bị chặn" value={d.jev.guardBlocks} icon />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: number; icon?: boolean }) {
  return (
    <div className="rounded-xl bg-soft p-3">
      <p className="flex items-center gap-1 text-xs text-muted">{icon && <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />}{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
