import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Coins, FlaskConical, Megaphone, RefreshCw, RotateCcw, ShieldAlert, Target, TrendingUp, Wallet } from "lucide-react";
import { api, useApi } from "../lib/api";
import { ddmm, hhmm, num, pct, timeAgo, vnd, vndFull, type Tone } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, PlatformIcon, Stat, Toggle, cx, inputCls, platformName, useToast } from "../components/ui";
import { PlatformTabs, pfLabel, useAdsPlatform } from "../components/AdsPlatform";

const REFRESH = ["action.", "metrics.", "approval."];
const PLAT_COLOR: Record<string, string> = { meta: "#2563eb", tiktok: "#f43f5e", google_ads: "#f59e0b" };
const TT = { borderRadius: 12, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)" };
const ACT_TYPE: Record<string, string> = { pause_ad: "Tạm dừng ad", resume_ad: "Bật lại ad", update_budget: "Đổi ngân sách", notify: "Thông báo" };
const ACT_STATUS: Record<string, { label: string; tone: Tone }> = {
  proposed: { label: "Đề xuất", tone: "amber" }, approved: { label: "Đã duyệt", tone: "blue" }, queued: { label: "Trong hàng đợi", tone: "blue" },
  done: { label: "Đã thực hiện", tone: "green" }, failed: { label: "Lỗi", tone: "red" }, reverted: { label: "Đã hoàn tác", tone: "gray" }, blocked: { label: "Bị chặn", tone: "red" },
};
const CAND_STATUS: Record<string, { label: string; tone: Tone }> = {
  proposed: { label: "Chờ Sếp duyệt", tone: "amber" }, approved: { label: "Đã duyệt", tone: "blue" }, publishing: { label: "Đang tạo ad", tone: "violet" },
  published: { label: "Đang chạy", tone: "green" }, rejected: { label: "Bị từ chối", tone: "gray" }, failed: { label: "Không tạo được", tone: "red" },
};
const showState = (s: any) => (!s ? "—" : s.daily_budget != null && s.status == null ? `${vndFull(s.daily_budget)}/ngày` : s.status != null && s.daily_budget == null ? (s.status === "active" ? "Đang chạy" : "Tạm dừng") : `${s.status === "active" ? "Đang chạy" : "Tạm dừng"} · ${vndFull(s.daily_budget)}/ngày`);

type AdAct = { ad: any; type: "pause_ad" | "resume_ad" | "update_budget" };

export function Ads() {
  const toast = useToast();
  const { data: allCamps, reload: reloadAds } = useApi<any[]>("ads", REFRESH);
  const [pf, setPf] = useAdsPlatform(true);
  const camps = allCamps ? allCamps.filter((c) => pf === "all" || c.platform === pf) : allCamps;
  const { data: met } = useApi<any>(`metrics/ads?days=14&platform=${pf}`, REFRESH);
  const { data: allCands } = useApi<any[]>("candidates", REFRESH);
  const cands = allCands ? allCands.filter((c) => pf === "all" || (c.platform ?? "meta") === pf) : allCands;
  const { data: rules, reload: reloadRules } = useApi<any[]>("rules", REFRESH);
  const { data: actions, reload: reloadActions } = useApi<any[]>("actions", REFRESH);
  const [act, setAct] = useState<AdAct | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dry, setDry] = useState<{ rule: any; res: any } | null>(null);
  const [liveRule, setLiveRule] = useState<any | null>(null);
  const [revert, setRevert] = useState<any | null>(null);

  const run = async (key: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast(ok); return r; }
    catch (e: any) { toast(e.code === "CAP_EXCEEDED" ? `Vượt trần ngân sách: ${e.message}` : e.message, "err"); return undefined; }
    finally { setBusy(null); }
  };

  const ads = (camps ?? []).flatMap((c) => c.ads ?? []);
  const spend7 = ads.reduce((a, x) => a + (x.m7?.spend ?? 0), 0);
  const results7 = ads.reduce((a, x) => a + (x.m7?.results ?? 0), 0);
  const attributed = ads.reduce((a, x) => a + (x.attributedRevenue ?? 0), 0);
  const series = (met?.series ?? []).map((d: any) => ({ ...d, label: ddmm(d.day) }));
  const seriesRev7 = series.slice(-7).reduce((a: number, d: any) => a + (d.revenue ?? 0), 0);
  const revenue = attributed || seriesRev7;
  const roas = spend7 ? revenue / spend7 : null;
  const byPlat = (met?.byPlatform ?? []).filter((p: any) => p.spend > 0 && (pf === "all" || p.platform === pf));
  const platTotal = byPlat.reduce((a: number, p: any) => a + p.spend, 0);

  const openAct = (ad: any, type: AdAct["type"]) => { setAct({ ad, type }); setAmount(String(ad.daily_budget ?? "")); };
  const submitAct = async () => {
    if (!act) return;
    const amt = Math.round(Number(amount));
    if (act.type === "update_budget" && (!amt || amt <= 0)) return toast("Ngân sách không hợp lệ", "err");
    const r = await run("act", () => api.post(`ads/${act.ad.id}/action`, { type: act.type, ...(act.type === "update_budget" ? { amount: amt } : {}) }), "Đã gửi lệnh vào hàng đợi — sẽ cập nhật sau vài giây");
    if (r) { setAct(null); reloadAds(); reloadActions(); }
  };
  const dryRun = async (rule: any) => {
    const res = await run(`dry:${rule.id}`, () => api.post(`rules/${rule.id}/dry-run`));
    if (res) { setDry({ rule, res }); reloadRules(); reloadActions(); }
  };
  const setMode = async (rule: any, mode: "live" | "dry_run") => {
    const r = await run(`mode:${rule.id}`, () => api.post(`rules/${rule.id}/mode`, mode === "live" ? { mode, confirm: true } : { mode }), mode === "live" ? `Rule "${rule.name}" đã chạy LIVE` : `Rule "${rule.name}" đã về dry-run`);
    if (r) { setLiveRule(null); reloadRules(); }
  };
  const setStatus = async (rule: any, on: boolean) => {
    const r = await run(`st:${rule.id}`, () => api.put(`rules/${rule.id}/status`, { status: on ? "active" : "paused" }), on ? "Đã bật rule" : "Đã tạm dừng rule");
    if (r) reloadRules();
  };
  const doRevert = async () => {
    const r = await run("revert", () => api.post(`actions/${revert.id}/revert`), "Đã gửi lệnh hoàn tác");
    if (r) { setRevert(null); reloadActions(); reloadAds(); }
  };

  const afterPreview = act ? (act.type === "update_budget" ? { status: act.ad.status, daily_budget: Math.round(Number(amount) || 0) } : { status: act.type === "pause_ad" ? "paused" : "active", daily_budget: act.ad.daily_budget }) : null;
  const delta = act?.type === "update_budget" && act.ad.daily_budget ? (Number(amount) - act.ad.daily_budget) / act.ad.daily_budget : null;

  return (
    <div className="space-y-6">
      <PageHeader title={`Quảng cáo đang chạy${pf === "all" ? "" : ` · ${pfLabel(pf)}`}`} subtitle="Theo dõi chi tiêu, bật/tắt, đổi ngân sách và để Ads Agent tối ưu theo rule — mọi thay đổi ngân sách đều qua xác nhận. Báo cáo đầy đủ ở mục Báo cáo."
        actions={<div className="flex flex-wrap gap-2"><Link to={`/ads/reports?pf=${pf}`}><Button icon={TrendingUp}>Xem báo cáo</Button></Link><Link to="/ads/quick"><Button icon={Megaphone}>Tạo chiến dịch</Button></Link><Button icon={RefreshCw} loading={busy === "sync"} onClick={() => run("sync", () => api.post("metrics/sync"), "Đã đồng bộ chỉ số quảng cáo").then(() => reloadAds())}>Đồng bộ chỉ số</Button></div>} />

      <PlatformTabs value={pf} onChange={setPf} allowAll />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Wallet} tone="amber" label="Ngân sách đã chi (7 ngày)" value={vnd(spend7)} sub={`${ads.filter((a) => a.status === "active").length}/${ads.length} ad đang chạy`} />
        <Stat icon={Coins} tone="green" label="Doanh thu từ quảng cáo" value={vnd(revenue)} sub={attributed ? "Theo liên kết attribution đủ tin cậy" : "Doanh thu đơn đã thanh toán 7 ngày"} />
        <Stat icon={TrendingUp} tone="blue" label="ROAS" value={roas == null ? "—" : `${roas.toFixed(1).replace(".", ",")}x`} sub="Doanh thu / chi phí quảng cáo" />
        <Stat icon={Target} tone="violet" label="Số kết quả (7 ngày)" value={num(results7)} sub={results7 ? `CPA TB ${vnd(spend7 / results7)}` : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Chi tiêu, doanh thu & ROAS (14 ngày)">
          {!met ? <Loading /> : (
            <div className="h-72">
              <ResponsiveContainer>
                <ComposedChart data={series}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" tickFormatter={(v) => num(v)} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={44} />
                  <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${v}x`} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={34} />
                  <Tooltip contentStyle={TT} formatter={(v: any, n: any) => (n === "ROAS" ? `${v}x` : vndFull(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="spend" name="Chi phí" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="l" dataKey="revenue" name="Doanh thu" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="r" dataKey="roas" name="ROAS" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Chi tiêu theo nền tảng (14 ngày)">
          {!met ? <Loading /> : byPlat.length === 0 ? <Empty>Chưa có chi tiêu.</Empty> : (
            <div className="flex flex-col items-center gap-4 sm:flex-row xl:flex-col">
              <div className="relative h-44 w-44 shrink-0">
                <ResponsiveContainer><PieChart><Pie data={byPlat} dataKey="spend" nameKey="platform" innerRadius={52} outerRadius={78} paddingAngle={2}>{byPlat.map((p: any) => <Cell key={p.platform} fill={PLAT_COLOR[p.platform] ?? "#94a3b8"} />)}</Pie><Tooltip contentStyle={TT} formatter={(v: any) => vndFull(v)} /></PieChart></ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><p className="text-lg font-bold text-ink">{vnd(platTotal)}</p><p className="text-xs text-muted">tổng chi</p></div></div>
              </div>
              <div className="w-full flex-1 space-y-2">
                {byPlat.map((p: any) => (
                  <div key={p.platform} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: PLAT_COLOR[p.platform] }} />{platformName(p.platform)}</span>
                    <span className="text-muted">{Math.round((p.spend / platTotal) * 100)}% · {num(p.results)} KQ</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Chiến dịch & quảng cáo">
        {!camps ? <Loading /> : camps.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">
            <p>Chưa có chiến dịch nào.</p>
            <p className="mt-1">Vào <Link to="/ads/integrations" className="text-blue-600 underline">Trung tâm tích hợp</Link> → liên kết Facebook/TikTok (thật hoặc mô phỏng) → bấm "Đồng bộ chiến dịch".</p>
          </div>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                {["Quảng cáo", "Ngân sách/ngày", "Chi 7 ngày", "Kết quả", "CPA", "CTR", "Trạng thái", ""].map((h, i) => <th key={i} className={cx("py-2 font-medium", i ? "px-3" : "pr-3")}>{h}</th>)}
              </tr></thead>
              {camps.map((c) => (
                <tbody key={c.id}>
                  <tr className="bg-soft/60"><td colSpan={8} className="px-3 py-2 text-xs font-semibold text-ink">
                    <span className="inline-flex items-center gap-2"><PlatformIcon p={c.platform} size={16} />{c.name}<Badge tone={c.status === "active" ? "green" : "gray"}>{c.status === "active" ? "Đang chạy" : "Tạm dừng"}</Badge>{c.target_cpa && <span className="font-normal text-muted">CPA mục tiêu {vnd(c.target_cpa)}</span>}</span>
                  </td></tr>
                  {(c.ads ?? []).map((a: any) => (
                    <tr key={a.id} className="border-b border-line">
                      <td className="py-2.5 pr-3"><span className="flex items-center gap-2"><PlatformIcon p={a.platform} size={20} /><span className="font-medium text-ink">{a.name}</span></span></td>
                      <td className="px-3 tabular-nums">{vnd(a.daily_budget)}</td>
                      <td className="px-3 tabular-nums">{vnd(a.m7?.spend)}</td>
                      <td className="px-3 tabular-nums">{num(a.m7?.results)}</td>
                      <td className={cx("px-3 tabular-nums", c.target_cpa && a.cost_per_result > c.target_cpa * 1.5 && "text-rose-500")}>{a.cost_per_result == null ? "—" : vnd(a.cost_per_result)}</td>
                      <td className="px-3 tabular-nums">{pct(a.ctr, 2)}</td>
                      <td className="px-3"><span className="flex items-center gap-2"><Toggle checked={a.status === "active"} onChange={(v) => openAct(a, v ? "resume_ad" : "pause_ad")} /><span className="text-xs text-muted">{a.status === "active" ? "Bật" : "Dừng"}</span></span></td>
                      <td className="px-3 text-right"><Button size="sm" icon={Wallet} onClick={() => openAct(a, "update_budget")}>Ngân sách</Button></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-blue-600" />Gợi ý quảng cáo từ bài viết</span>}>
          {!cands ? <Loading /> : cands.length === 0 ? <Empty>Chưa có bài nào đủ điểm để đề xuất chạy ads.</Empty> : (
            <div className="space-y-3">
              {cands.map((c) => {
                const st = CAND_STATUS[c.status] ?? { label: c.status, tone: "gray" as Tone };
                return (
                  <div key={c.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-start gap-3">
                      <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-white", c.score >= 70 ? "bg-emerald-500" : "bg-amber-500")}>{Math.round(c.score)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink">{c.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted"><PlatformIcon p={c.platform} size={14} />{platformName(c.platform)} · {vnd(c.daily_budget)}/ngày <Badge tone={st.tone}>{st.label}</Badge></p>
                      </div>
                    </div>
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">{(c.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}</ul>
                    {c.decision_note && <p className="mt-1 text-xs text-rose-500">{c.decision_note}</p>}
                    {c.status === "proposed" && c.approval_id && <Link to={`/approvals?id=${c.approval_id}`} className="mt-2 inline-block"><Button size="sm" variant="primary">Xem & duyệt</Button></Link>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-violet-600" />Rule tự động tối ưu</span>} action={<Link to="/ads/flows?type=auto_off"><Button size="sm" variant="soft">Quản lý luồng</Button></Link>}>
          {!rules ? <Loading /> : rules.length === 0 ? <Empty>Chưa có rule nào.</Empty> : (
            <div className="space-y-3">
              {rules.map((r) => (
                <div key={r.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 font-medium text-ink">{r.name}{r.mode === "live" ? <Badge tone="red">LIVE</Badge> : <Badge tone="blue">Dry-run</Badge>}<span className="text-xs font-normal text-muted">v{r.version}</span></p>
                      <p className="mt-0.5 text-xs text-muted">{r.description}</p>
                    </div>
                    <Toggle checked={r.status === "active"} disabled={busy === `st:${r.id}`} onChange={(v) => setStatus(r, v)} />
                  </div>
                  {r.lastRun && <p className="mt-2 text-xs text-muted">Lần chạy gần nhất ({r.lastRun.mode === "live" ? "live" : "dry-run"}) {timeAgo(r.lastRun.created_at)}: khớp {r.lastRun.matched}/{r.lastRun.evaluated} ad{r.lastRun.summary?.lines?.[0] ? ` — ${r.lastRun.summary.lines[0]}` : ""}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" icon={FlaskConical} loading={busy === `dry:${r.id}`} onClick={() => dryRun(r)}>Chạy thử (dry-run)</Button>
                    {r.mode === "live"
                      ? <Button size="sm" variant="ghost" loading={busy === `mode:${r.id}`} onClick={() => setMode(r, "dry_run")}>Về dry-run</Button>
                      : <Button size="sm" variant="danger" onClick={() => setLiveRule(r)}>Bật LIVE</Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Nhật ký hành động">
        {!actions ? <Loading /> : actions.length === 0 ? <Empty>Chưa có hành động nào.</Empty> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">{["Thời gian", "Hành động", "Quảng cáo", "Trước → Sau", "Lý do", "Trạng thái", ""].map((h, i) => <th key={i} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {actions.map((a) => {
                  const st = ACT_STATUS[a.status] ?? { label: a.status, tone: "gray" as Tone };
                  return (
                    <tr key={a.id} className="border-b border-line align-top">
                      <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted">{ddmm(a.created_at)} {hhmm(a.created_at)}<p>{a.actor === "rule" ? a.params?.ruleName ?? "Rule" : a.actor}</p></td>
                      <td className="px-2 py-2.5 text-ink">{ACT_TYPE[a.type] ?? a.type}{a.params?.dryRun && <Badge tone="blue" className="ml-1">dry-run</Badge>}</td>
                      <td className="px-2 py-2.5 text-ink">{a.target_name ?? "—"}</td>
                      <td className="px-2 py-2.5 text-xs text-muted">{showState(a.before)} → <b className="text-ink">{showState(a.after)}</b></td>
                      <td className="max-w-[240px] px-2 py-2.5 text-xs text-muted">{a.reason}</td>
                      <td className="px-2 py-2.5"><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td className="px-2 py-2.5 text-right">{a.status === "done" && !!a.reversible && <Button size="sm" icon={RotateCcw} onClick={() => setRevert(a)}>Hoàn tác</Button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!act} onClose={() => setAct(null)} title={act ? `${ACT_TYPE[act.type]}: ${act.ad.name}` : ""}
        footer={<><Button onClick={() => setAct(null)}>Hủy</Button><Button variant={act?.type === "pause_ad" ? "danger" : "primary"} loading={busy === "act"} onClick={submitAct}>Xác nhận</Button></>}>
        {act && (
          <div className="space-y-4">
            {act.type === "update_budget" && (
              <Field label="Ngân sách mới mỗi ngày (VNĐ)" hint={delta != null && Math.abs(delta) > 0.2 ? `Thay đổi ${Math.round(delta * 100)}% — lớn hơn bước an toàn 20%, thuật toán nền tảng có thể phải học lại.` : "Nên thay đổi tối đa ±20% mỗi lần để không làm reset quá trình học của nền tảng."}>
                <input type="number" min={0} step={100000} className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-soft p-3"><p className="text-xs text-muted">Hiện tại</p><p className="mt-1 font-semibold text-ink">{showState({ status: act.ad.status, daily_budget: act.ad.daily_budget })}</p></div>
              <div className="rounded-xl border border-blue-500/40 bg-blue-500/5 p-3"><p className="text-xs text-muted">Sau khi đổi</p><p className="mt-1 font-semibold text-ink">{showState(afterPreview)}</p></div>
            </div>
            <p className="text-xs text-muted">Lệnh này tác động tới tiền quảng cáo thật: được đưa vào hàng đợi, kiểm tra trần ngân sách và ghi vào nhật ký (có thể hoàn tác).</p>
          </div>
        )}
      </Modal>

      <Modal open={!!dry} onClose={() => setDry(null)} title={dry ? `Sẽ làm gì — ${dry.rule.name}` : ""} footer={<Button onClick={() => setDry(null)}>Đóng</Button>}>
        {dry && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Đã xét <b className="text-ink">{dry.res.evaluated}</b> quảng cáo, khớp điều kiện <b className="text-ink">{dry.res.matched}</b>. Chạy thử không thay đổi gì thật.</p>
            {(dry.res.lines ?? []).length === 0 ? <Empty>Không có hành động nào — tất cả quảng cáo đang ổn theo rule này.</Empty> : (
              <ul className="space-y-1.5">{dry.res.lines.map((l: string, i: number) => <li key={i} className="rounded-lg bg-soft px-3 py-2 text-ink">{l}</li>)}</ul>
            )}
            {(dry.res.skipped ?? []).length > 0 && (
              <div><p className="mb-1 text-xs font-semibold text-muted">Bỏ qua</p>{dry.res.skipped.map((s: any, i: number) => <p key={i} className="text-xs text-muted">• {s.entityName ?? ""}: {s.reason ?? String(s)}</p>)}</div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!liveRule} onClose={() => setLiveRule(null)} title="Bật chế độ LIVE?"
        footer={<><Button onClick={() => setLiveRule(null)}>Hủy</Button><Button variant="danger" loading={busy === `mode:${liveRule?.id}`} onClick={() => setMode(liveRule, "live")}>Tôi hiểu, bật LIVE</Button></>}>
        {liveRule && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-700 dark:text-rose-300">
              Khi LIVE, rule <b>"{liveRule.name}"</b> sẽ tự động tạm dừng ad hoặc đổi ngân sách thật trên nền tảng, không cần Sếp bấm duyệt từng lần (tuỳ mức tự chủ của Ads Agent).
            </div>
            <p className="text-muted">{liveRule.description}</p>
            <p className="text-xs text-muted">Yêu cầu: phiên bản v{liveRule.version} phải chạy dry-run ít nhất một lần. Giới hạn an toàn (bước tối đa, trần ngân sách, cooldown) vẫn luôn được áp dụng.</p>
          </div>
        )}
      </Modal>

      <Modal open={!!revert} onClose={() => setRevert(null)} title="Hoàn tác hành động?"
        footer={<><Button onClick={() => setRevert(null)}>Hủy</Button><Button variant="primary" icon={RotateCcw} loading={busy === "revert"} onClick={doRevert}>Hoàn tác</Button></>}>
        {revert && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">{ACT_TYPE[revert.type]} trên <b className="text-ink">{revert.target_name}</b> sẽ được đảo ngược:</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-soft p-3"><p className="text-xs text-muted">Hiện tại</p><p className="mt-1 font-semibold text-ink">{showState(revert.after)}</p></div>
              <div className="rounded-xl border border-blue-500/40 bg-blue-500/5 p-3"><p className="text-xs text-muted">Sau hoàn tác</p><p className="mt-1 font-semibold text-ink">{showState(revert.before)}</p></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
