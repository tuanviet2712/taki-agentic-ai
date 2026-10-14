import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Eye, FileSpreadsheet, Heart, ShoppingBag, Wallet } from "lucide-react";
import { useApi } from "../lib/api";
import { ddmm, num, pct, vnd, vndFull } from "../lib/format";
import { Badge, Button, Card, Empty, Loading, PageHeader, PlatformIcon, Ring, Stat, cx, inputCls, platformName, useToast } from "../components/ui";

const TT = { borderRadius: 12, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)" };
const FUNNEL_COLORS = ["#3b82f6", "#6366f1", "#8b5cf6", "#f59e0b", "#22c55e"];
const METHOD: Record<string, string> = {
  referral: "Mã giới thiệu / tham số ref", click_id: "Click ID quảng cáo", utm: "Tham số UTM", asked: "Hỏi trực tiếp khách", coupon: "Mã giảm giá", time_window: "Khung thời gian", ad_referral: "Referral từ ad",
};
const KIND: Record<string, string> = { reel: "Reel", image: "Ảnh", text: "Bài chữ", article: "Bài SEO", video: "Video", carousel: "Carousel" };

export function Reports() {
  const toast = useToast();
  const [days, setDays] = useState(7);
  const { data: s, loading } = useApi<any>(`reports/summary?days=${days}`, ["metrics.", "post.", "conversation.", "lead."]);
  const { data: met } = useApi<any>(`metrics/ads?days=${days}`, ["metrics."]);
  const { data: ov } = useApi<any>("overview", ["metrics.", "post."]);

  const series = (met?.series ?? []).map((d: any) => ({ ...d, label: ddmm(d.day) }));
  const channels = (ov?.channels ?? []).map((c: any) => ({ ...c, name: platformName(c.channel) }));

  const exportCsv = () => {
    if (!s) return;
    const esc = (v: any) => { const t = v == null ? "" : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const rows: any[][] = [
      [`Báo cáo, ${days} ngày gần nhất`, new Date().toLocaleString("vi-VN")], [],
      ["TỔNG QUAN"], ["Chỉ số", "Giá trị"],
      ["Lượt tiếp cận", s.totals.reach], ["Tương tác", s.totals.engaged], ["Hội thoại mới", s.totals.conversations], ["Lead ấm/nóng", s.totals.leads],
      ["Đơn hàng", s.totals.orders], ["Chi phí quảng cáo (đ)", s.totals.spend], ["Click", s.totals.clicks], ["Kết quả ads", s.totals.results],
      ["CPA (đ)", s.totals.cpa], ["Chi phí/đơn (đ)", s.totals.costPerOrder], [],
      ["PHỄU"], ["Giai đoạn", "Số lượng", "% so với đầu phễu"], ...s.funnel.map((f: any) => [f.stage, f.value, s.funnel[0]?.value ? (f.value / s.funnel[0].value * 100).toFixed(3) + "%" : ""]), [],
      ["DOANH THU THEO NGUỒN"], ["Nguồn", "Đơn", "Doanh thu (đ)"], ...s.revenueBySource.map((r: any) => [platformName(r.source), r.orders, r.revenue]), [],
      ["TOP BÀI VIẾT"], ["Bài", "Kênh", "Điểm", "Tiếp cận"], ...s.topPosts.map((p: any) => [p.title, platformName(p.platform), p.score, p.metrics?.reach]), [],
      ["TRUY VẾT"], ["Mục tiêu", "Nội dung", "Bài đăng", "Quảng cáo", "Hội thoại", "Đơn", "Doanh thu (đ)"], ...s.trace.map((t: any) => [t.goal, t.content, t.post, t.ad, t.conversations, t.orders, t.revenue]), [],
      ["CHI PHÍ ADS THEO NGÀY"], ["Ngày", "Chi phí (đ)", "Kết quả", "Doanh thu (đ)", "ROAS"], ...(met?.series ?? []).map((d: any) => [d.day, d.spend, d.results, d.revenue, d.roas]),
    ];
    const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `dotaka-bao-cao-${days}ngay-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast("Đã xuất báo cáo CSV");
  };

  const t = s?.totals;
  const first = s?.funnel?.[0]?.value || 0;
  const att = s?.attribution;

  return (
    <div className="space-y-6">
      <PageHeader title="Đo lường & Báo cáo" subtitle="Hiệu quả marketing đa kênh — từ bài viết, quảng cáo đến hội thoại và đơn hàng."
        actions={<>
          <select className={cx(inputCls, "w-auto")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 30].map((d) => <option key={d} value={d}>{d} ngày gần nhất</option>)}
          </select>
          <Button variant="primary" icon={Download} disabled={!s} onClick={exportCsv}>Xuất báo cáo</Button>
          <span title="Cần kết nối Sheets thật"><Button icon={FileSpreadsheet} disabled>Xuất Google Sheets</Button></span>
        </>} />

      {!s && loading ? <Loading /> : !s ? <Empty>Không tải được báo cáo.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat icon={Eye} tone="violet" label="Lượt tiếp cận" value={num(t.reach)} sub="Bài tự nhiên + quảng cáo" />
            <Stat icon={Heart} tone="pink" label="Tương tác" value={num(t.engaged)} sub={`${num(t.conversations)} hội thoại mới`} />
            <Stat icon={ShoppingBag} tone="green" label="Khách hàng mới (đơn)" value={num(t.orders)} sub={t.costPerOrder ? `Chi phí/đơn ${vnd(t.costPerOrder)}` : undefined} />
            <Stat icon={Wallet} tone="amber" label="Chi phí quảng cáo" value={vnd(t.spend)} sub={t.cpa ? `CPA ${vnd(t.cpa)} · ${num(t.results)} kết quả` : undefined} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={`Xu hướng quảng cáo ${days} ngày`}>
              {!met ? <Loading /> : (
                <div className="h-72">
                  <ResponsiveContainer>
                    <LineChart data={series}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="l" tickFormatter={(v) => num(v)} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={44} />
                      <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => num(v)} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={36} />
                      <Tooltip contentStyle={TT} formatter={(v: any, n: any) => (n === "Kết quả" ? num(v) : vndFull(v))} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line yAxisId="l" dataKey="spend" name="Chi phí" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line yAxisId="l" dataKey="revenue" name="Doanh thu" stroke="#22c55e" strokeWidth={2} dot={false} />
                      <Line yAxisId="r" dataKey="results" name="Kết quả" stroke="#6366f1" strokeWidth={2} strokeDasharray="4 3" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="Phễu chuyển đổi">
              <div className="space-y-2">
                {s.funnel.map((f: any, i: number) => {
                  const ratio = first ? f.value / first : 0;
                  const w = first && f.value > 0 ? 28 + 72 * (Math.log10(f.value) / Math.log10(Math.max(first, 10))) : 28;
                  const prev = i > 0 ? s.funnel[i - 1].value : null;
                  return (
                    <div key={f.stage} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_minmax(0,11rem)]">
                      <span className="truncate text-[13px] font-medium text-ink" title={f.stage}>{f.stage}</span>
                      <div className="h-8 rounded-lg bg-soft">
                        <div className="flex h-full min-w-10 items-center justify-end rounded-lg px-2.5 text-white transition-[width]" style={{ width: `${Math.min(100, w)}%`, background: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }}>
                          <span className="text-[13px] font-semibold tabular-nums">{num(f.value)}</span>
                        </div>
                      </div>
                      <span className="col-span-2 text-[11px] leading-tight text-muted sm:col-span-1 sm:text-right">{i === 0 ? "100% · đầu phễu" : `${pct(ratio, ratio < 0.01 ? 3 : 1)} từ đầu phễu`}{prev ? ` · ${pct(f.value / prev, 1)} bước trước` : ""}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] text-muted">Độ rộng thanh theo thang log để các giai đoạn nhỏ vẫn nhìn thấy được.</p>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Hiệu quả theo kênh">
              {!ov ? <Loading /> : channels.length === 0 ? <Empty>Chưa có dữ liệu kênh.</Empty> : (
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={channels}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="l" tickFormatter={num} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={40} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={28} />
                      <Tooltip contentStyle={TT} formatter={(v: any) => num(v)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar yAxisId="l" dataKey="reach" name="Tiếp cận" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="l" dataKey="engagement" name="Tương tác" fill="#22c55e" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="r" dataKey="orders" name="Đơn hàng" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="Top bài viết hiệu quả">
              {s.topPosts.length === 0 ? <Empty>Chưa có bài nào được chấm điểm.</Empty> : (
                <div className="divide-y divide-line">
                  {s.topPosts.map((p: any, i: number) => (
                    <div key={p.id} className="flex items-center gap-3 py-2.5">
                      <span className="w-5 text-center text-sm font-bold text-muted">{i + 1}</span>
                      <PlatformIcon p={p.platform} size={24} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{p.title}</p>
                        <p className="text-xs text-muted">{KIND[p.kind] ?? p.kind} · {num(p.metrics?.reach)} tiếp cận · {num(p.metrics?.comments)} bình luận</p>
                      </div>
                      <Badge tone={p.score >= 70 ? "green" : p.score >= 40 ? "amber" : "gray"}>{Math.round(p.score)} điểm</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card title="Chuỗi truy vết bài → ad → hội thoại → đơn">
            {s.trace.length === 0 ? <Empty>Chưa có dữ liệu truy vết.</Empty> : (
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted">{["Mục tiêu", "Bài đăng", "Quảng cáo", "Hội thoại", "Đơn", "Doanh thu"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {s.trace.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-line">
                        <td className="max-w-[220px] px-2 py-2.5 text-xs text-muted">{r.goal ?? "—"}</td>
                        <td className="max-w-[260px] px-2 py-2.5 text-ink">{r.post}</td>
                        <td className="px-2 py-2.5">{r.ad ? <Badge tone="blue">{r.ad}</Badge> : <span className="text-xs text-muted">Tự nhiên</span>}</td>
                        <td className="px-2 py-2.5 tabular-nums">{r.conversations}</td>
                        <td className="px-2 py-2.5 tabular-nums">{r.orders}</td>
                        <td className="px-2 py-2.5 tabular-nums font-medium text-ink">{r.revenue ? vnd(r.revenue) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Độ phủ attribution">
              <div className="flex flex-col items-center gap-5 sm:flex-row">
                <Ring value={(att?.coverage ?? 0) * 100} color={att?.coverage >= 0.5 ? "#10b981" : "#f59e0b"}>
                  <div><p className="text-2xl font-bold text-ink">{pct(att?.coverage)}</p><p className="text-xs text-muted">hội thoại có nguồn</p></div>
                </Ring>
                <div className="w-full flex-1 space-y-2">
                  {(att?.byMethod ?? []).length === 0 ? <p className="text-sm text-muted">Chưa có liên kết attribution.</p> : att.byMethod.map((m: any) => (
                    <div key={m.method} className="flex items-center justify-between gap-2 rounded-lg bg-soft px-3 py-2 text-sm">
                      <span className="text-ink">{METHOD[m.method] ?? m.method}</span>
                      <span className="flex items-center gap-2 text-xs text-muted">{m.n} liên kết <Badge tone={m.conf >= att.minConfidence ? "green" : "gray"}>tin cậy {pct(m.conf)}</Badge></span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-4 text-xs text-muted">Báo cáo chỉ tính các liên kết nguồn có độ tin cậy ≥ {pct(att?.minConfidence)}. Liên kết yếu hơn vẫn được lưu nhưng không cộng vào doanh thu của bài/quảng cáo để tránh "tô hồng" số liệu.</p>
            </Card>

            <Card title="Doanh thu theo nguồn">
              {s.revenueBySource.length === 0 ? <Empty>Chưa có đơn hàng trong kỳ.</Empty> : (() => {
                const total = s.revenueBySource.reduce((a: number, r: any) => a + (r.revenue ?? 0), 0);
                return (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 font-medium">Nguồn</th><th className="px-2 text-right font-medium">Đơn</th><th className="px-2 text-right font-medium">Doanh thu</th><th className="pl-2 text-right font-medium">Tỷ trọng</th></tr></thead>
                    <tbody>
                      {s.revenueBySource.map((r: any) => (
                        <tr key={r.source} className="border-b border-line">
                          <td className="py-2.5"><span className="flex items-center gap-2 text-ink"><PlatformIcon p={r.source} size={18} />{platformName(r.source)}</span></td>
                          <td className="px-2 text-right tabular-nums">{r.orders}</td>
                          <td className="px-2 text-right tabular-nums font-medium text-ink">{vnd(r.revenue)}</td>
                          <td className="pl-2 text-right text-xs text-muted">{total ? `${Math.round((r.revenue / total) * 100)}%` : "—"}</td>
                        </tr>
                      ))}
                      <tr><td className="py-2.5 font-semibold text-ink">Tổng</td><td className="px-2 text-right font-semibold">{s.revenueBySource.reduce((a: number, r: any) => a + r.orders, 0)}</td><td className="px-2 text-right font-semibold text-ink">{vnd(total)}</td><td /></tr>
                    </tbody>
                  </table>
                );
              })()}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
