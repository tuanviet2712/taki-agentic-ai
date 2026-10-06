import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Coins, Eye, MousePointerClick, RefreshCw, Target, TrendingUp, Wallet } from "lucide-react";
import { api, useApi } from "../lib/api";
import { ddmm, num, timeAgo, vnd, vndFull } from "../lib/format";
import { Badge, Button, Card, Empty, Loading, PageHeader, PlatformIcon, Stat, cx, platformName, useToast } from "../components/ui";
import { AdsReportCard } from "../components/AdsReportCard";
import { PLATFORMS, PlatformNotReady, PlatformTabs, pfLabel, useAdsPlatform, usePlatformStatus, type AdsPf } from "../components/AdsPlatform";

/** Báo cáo quảng cáo: tổng hiệu quả tất cả nền tảng + báo cáo riêng Facebook / TikTok / Google (số liệu thật đã đồng bộ). */
const PERIODS = [7, 14, 30, 90];
const COLOR: Record<string, string> = { meta: "#2563eb", tiktok: "#f43f5e", google_ads: "#f59e0b" };
const TT = { borderRadius: 12, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)" };
const pctTxt = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
const money = (v: number | null | undefined) => (v == null ? "—" : vndFull(Math.round(v)));
/** % thay đổi so với kỳ trước (null khi kỳ trước = 0 → không so được). */
const delta = (cur: number | null | undefined, prev: number | null | undefined) => (cur == null || !prev ? null : Math.round(((cur - prev) / prev) * 1000) / 10);
const icon = (p: string) => (p === "meta" ? "facebook" : p);

export function AdsReports() {
  const [pf, setPf] = useAdsPlatform(true);
  const [days, setDays] = useState(7);
  const toast = useToast();
  const st = usePlatformStatus();
  const { data: d, reload, loading } = useApi<any>(`ads/performance?platform=${pf}&days=${days}`, ["metrics.", "action."]);
  const [syncing, setSyncing] = useState(false);
  const sync = async () => {
    setSyncing(true);
    try { const r = await api.post("metrics/sync"); toast(`Đã đồng bộ số liệu ${r.ads ?? 0} quảng cáo`); reload(); } catch (e: any) { toast(e.message, "err"); } finally { setSyncing(false); }
  };
  const single = pf !== "all";
  const notReady = single && st.loaded && !st.of(pf as AdsPf).total;
  const t = d?.totals, p = d?.prev;
  const sfx = `so với ${days} ngày trước`;
  const share = (d?.byPlatform ?? []).filter((x: any) => x.spend > 0);
  const errPlat = (d?.byPlatform ?? []).filter((x: any) => x.connectionError);
  const allPaused = d && (d.byPlatform ?? []).every((x: any) => !x.activeAds) && (d.byPlatform ?? []).some((x: any) => x.ads > 0);

  return (
    <div className="space-y-6">
      <PageHeader title={single ? `Báo cáo ${pfLabel(pf)} Ads` : "Báo cáo tổng hiệu quả quảng cáo"}
        subtitle={single ? `Hiệu quả riêng nền tảng ${pfLabel(pf)}: chi tiêu, kết quả, chi phí/kết quả, chiến dịch và quảng cáo nổi bật.` : "Gộp Facebook, TikTok, Google: tổng chi tiêu, kết quả, tỷ trọng và so sánh hiệu quả giữa các nền tảng."}
        actions={<Button icon={RefreshCw} loading={syncing} onClick={sync}>Đồng bộ số liệu</Button>} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PlatformTabs value={pf} onChange={setPf} allowAll />
        <div className="flex gap-1 rounded-xl border border-line p-1">
          {PERIODS.map((n) => <button key={n} onClick={() => setDays(n)} className={cx("rounded-lg px-3 py-1.5 text-sm", days === n ? "bg-blue-600 text-white" : "text-ink hover:bg-soft")}>{n} ngày</button>)}
        </div>
      </div>

      {notReady ? <PlatformNotReady pf={pf as AdsPf} what="xem báo cáo" /> : !d || loading && !d ? <Loading /> : (
        <>
          <p className="-mt-2 text-xs text-muted">Kỳ {ddmm(d.from)} → {ddmm(d.to)} · số liệu đồng bộ lần cuối {d.lastSync ? timeAgo(d.lastSync) : "chưa có"}</p>
          {errPlat.length > 0 && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <p>Kết nối {errPlat.map((x: any) => platformName(icon(x.platform))).join(", ")} đang báo lỗi lần kiểm tra gần nhất — số liệu có thể chưa mới. Bấm “Đồng bộ số liệu” hoặc kiểm tra ở <Link to="/ads/integrations" className="underline">Trung tâm tích hợp</Link>.</p>
            </div>
          )}
          {t.spend === 0 && (
            <div className="rounded-2xl border border-line bg-soft/60 p-4 text-sm text-muted">
              Không có chi tiêu trong {days} ngày qua{allPaused ? ` — ${(d.byPlatform ?? []).reduce((a: number, x: any) => a + x.ads, 0)} quảng cáo đều đang TẠM DỪNG` : ""}. Báo cáo sẽ có số khi quảng cáo chạy và số liệu được đồng bộ.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={Wallet} tone="blue" label="Chi tiêu" value={vnd(t.spend)} delta={delta(t.spend, p.spend)} suffix={sfx} />
            <Stat icon={Target} tone="green" label="Kết quả" value={num(t.results)} delta={delta(t.results, p.results)} suffix={sfx} />
            <Stat icon={Coins} tone="amber" label="Chi phí / kết quả (CPA)" value={money(t.cpa)} delta={delta(t.cpa, p.cpa)} invert suffix={sfx} />
            <Stat icon={TrendingUp} tone="violet" label="Doanh thu gán cho quảng cáo" value={vnd(t.revenue)} sub={t.roas != null ? `ROAS ${t.roas.toFixed(2)}` : "ROAS — (chưa có đơn gán)"} />
            <Stat icon={Eye} tone="gray" label="Hiển thị" value={num(t.impressions)} delta={delta(t.impressions, p.impressions)} suffix={sfx} />
            <Stat icon={MousePointerClick} tone="pink" label="Click · CTR" value={`${num(t.clicks)} · ${pctTxt(t.ctr)}`} delta={delta(t.clicks, p.clicks)} suffix={sfx} />
            <Stat icon={Coins} tone="gray" label="CPC (chi phí / click)" value={money(t.cpc)} delta={delta(t.cpc, p.cpc)} invert suffix={sfx} />
            <Stat icon={Coins} tone="gray" label="CPM (chi phí / 1.000 hiển thị)" value={money(t.cpm)} delta={delta(t.cpm, p.cpm)} invert suffix={sfx} />
          </div>

          <div className={cx("grid gap-6", !single && "xl:grid-cols-[1fr_380px]")}>
            <Card title="Chi tiêu & kết quả theo ngày">
              <div className="h-72">
                <ResponsiveContainer>
                  <ComposedChart data={d.series.map((x: any) => ({ ...x, label: ddmm(x.day) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} />
                    <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v) => vnd(v)} width={64} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "var(--muted)" }} width={36} />
                    <Tooltip contentStyle={TT} formatter={(v: any, n: any) => (n === "Chi tiêu" ? vndFull(v) : num(v))} />
                    <Bar yAxisId="l" dataKey="spend" name="Chi tiêu" fill={single ? COLOR[pf] : "#6366f1"} radius={[6, 6, 0, 0]} />
                    <Line yAxisId="r" dataKey="results" name="Kết quả" stroke="#10b981" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
            {!single && (
              <Card title="Tỷ trọng chi tiêu theo nền tảng">
                {share.length === 0 ? <Empty>Chưa có chi tiêu trong kỳ.</Empty> : (
                  <div className="h-56"><ResponsiveContainer><PieChart><Pie data={share} dataKey="spend" nameKey="platform" innerRadius={55} outerRadius={85} paddingAngle={2}>{share.map((x: any) => <Cell key={x.platform} fill={COLOR[x.platform]} />)}</Pie><Tooltip contentStyle={TT} formatter={(v: any, n: any) => [vndFull(v), pfLabel(n)]} /></PieChart></ResponsiveContainer></div>
                )}
                <div className="mt-3 space-y-2">
                  {(d.byPlatform ?? []).map((x: any) => (
                    <div key={x.platform} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR[x.platform] }} />{pfLabel(x.platform)}</span>
                      <span className="text-muted">{vnd(x.spend)}{t.spend ? ` · ${Math.round((x.spend / t.spend) * 100)}%` : ""}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          {!single && (
            <Card title="So sánh hiệu quả giữa các nền tảng">
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full min-w-[860px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted">{["Nền tảng", "Kết nối", "Quảng cáo (đang chạy)", "Chi tiêu", "Kết quả", "CPA", "CTR", "CPC", "CPM", "ROAS", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {(d.byPlatform ?? []).map((x: any) => {
                      const best = (k: string, low = true) => { const v = (d.byPlatform ?? []).filter((y: any) => y[k] != null).map((y: any) => y[k]); return v.length > 1 && x[k] === (low ? Math.min(...v) : Math.max(...v)); };
                      return (
                        <tr key={x.platform}>
                          <td className="px-3 py-2.5"><span className="flex items-center gap-2 font-medium text-ink"><PlatformIcon p={icon(x.platform)} size={20} />{pfLabel(x.platform)}</span></td>
                          <td className="px-3 py-2.5">{x.platform === "google_ads" && !x.accounts ? <Badge tone="gray">Sắp có</Badge> : x.connectionError ? <Badge tone="amber">Lỗi kết nối</Badge> : x.liveAccounts ? <Badge tone="green">{x.liveAccounts} tài khoản</Badge> : <Badge tone="gray">Chưa kết nối</Badge>}</td>
                          <td className="px-3 py-2.5 tabular-nums">{x.ads} ({x.activeAds})</td>
                          <td className="px-3 py-2.5 tabular-nums font-medium text-ink">{vnd(x.spend)}</td>
                          <td className="px-3 py-2.5 tabular-nums">{num(x.results)}</td>
                          <td className={cx("px-3 py-2.5 tabular-nums", best("cpa") && "font-semibold text-emerald-600")}>{money(x.cpa)}</td>
                          <td className={cx("px-3 py-2.5 tabular-nums", best("ctr", false) && "font-semibold text-emerald-600")}>{pctTxt(x.ctr)}</td>
                          <td className="px-3 py-2.5 tabular-nums">{money(x.cpc)}</td>
                          <td className="px-3 py-2.5 tabular-nums">{money(x.cpm)}</td>
                          <td className={cx("px-3 py-2.5 tabular-nums", best("roas", false) && "font-semibold text-emerald-600")}>{x.roas != null ? x.roas.toFixed(2) : "—"}</td>
                          <td className="px-3 py-2.5 text-right"><button onClick={() => setPf(x.platform)} className="text-xs font-medium text-blue-600 hover:underline">Báo cáo riêng →</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">Chữ xanh = tốt nhất giữa các nền tảng có số liệu (CPA thấp nhất, CTR/ROAS cao nhất). Doanh thu gán = đơn hàng từ hội thoại có gắn quảng cáo (đủ độ tin cậy).</p>
            </Card>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title={`Chiến dịch (${d.campaigns.length})`}>
              {d.campaigns.length === 0 ? <Empty>Chưa có chiến dịch nào có số liệu trong kỳ.</Empty> : (
                <MetricTable rows={d.campaigns} first="Chiến dịch" name={(c: any) => c.name} showPlatform={!single} />
              )}
            </Card>
            <Card title="Quảng cáo chi tiêu nhiều nhất">
              {d.topAds.length === 0 ? <Empty>Chưa có quảng cáo nào có số liệu trong kỳ.</Empty> : (
                <MetricTable rows={d.topAds} first="Quảng cáo" name={(a: any) => <span>{a.name}{a.status !== "active" && <Badge tone="gray" className="ml-1.5">tạm dừng</Badge>}</span>} showPlatform={!single} />
              )}
            </Card>
          </div>

          {d.actions.length > 0 && (
            <Card title="Tối ưu tự động trong kỳ">
              <div className="flex flex-wrap gap-2 text-sm">{d.actions.map((a: any) => <Badge key={`${a.type}${a.status}`} tone={a.status === "done" || a.status === "executed" ? "green" : a.status === "dry_run" ? "blue" : "gray"}>{a.type} · {a.status}: {a.n}</Badge>)}</div>
            </Card>
          )}

          {!single && <AdsReportCard />}
        </>
      )}
      <p className="text-xs text-muted">Nền tảng: {PLATFORMS.map((x) => `${x.label} ${st.of(x.key).live ? "đã kết nối" : x.key === "google_ads" ? "sắp có" : "chưa kết nối"}`).join(" · ")}</p>
    </div>
  );
}

function MetricTable({ rows, first, name, showPlatform }: { rows: any[]; first: string; name: (r: any) => any; showPlatform: boolean }) {
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[620px] text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted">{[first, "Chi tiêu", "Kết quả", "CPA", "CTR", "CPM"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={r.id ?? `${r.name}${i}`}>
              <td className="max-w-[260px] px-2 py-2.5"><span className="flex items-center gap-2 text-ink">{showPlatform && <PlatformIcon p={icon(r.platform)} size={16} />}<span className="truncate">{name(r)}</span></span></td>
              <td className="px-2 py-2.5 tabular-nums font-medium text-ink">{vnd(r.spend)}</td>
              <td className="px-2 py-2.5 tabular-nums">{num(r.results)}</td>
              <td className="px-2 py-2.5 tabular-nums">{money(r.cpa)}</td>
              <td className="px-2 py-2.5 tabular-nums">{pctTxt(r.ctr)}</td>
              <td className="px-2 py-2.5 tabular-nums">{money(r.cpm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
