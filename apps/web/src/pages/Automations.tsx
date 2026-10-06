import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, ChartNoAxesColumn, ChevronRight, CirclePause, Database, Download, FileText, FlaskConical, FolderOpen, History, Pencil, Play, Plus, Search, Trash2, X } from "lucide-react";
import { api, useApi } from "../lib/api";
import { ddmm, hhmm, timeAgo, vndFull } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PlatformIcon, Toggle, cx, inputCls, useToast } from "../components/ui";
import { PlatformNotReady, PlatformTabs, pfLabel, useAdsPlatform, usePlatformStatus, type AdsPf } from "../components/AdsPlatform";

/** Nền tảng của 1 luồng: cấu hình ghi rõ → theo quảng cáo được chọn → "Đăng bài → quảng cáo" là Facebook → mọi nền tảng. */
function platformOf(a: any, opts: any): string {
  const c = a.config ?? {};
  if (a.type === "metrics_pull") return "any";
  if (c.platform && c.platform !== "any") return c.platform;
  if (a.type === "auto_run") {
    if (c.mode !== "schedule") return "meta";
    const ad = (opts?.ads ?? []).find((x: any) => (c.adIds ?? []).includes(x.id));
    return ad?.platform ?? "any";
  }
  return "any";
}

type AType = "metrics_pull" | "auto_off" | "budget" | "auto_run";
export const TYPES: Record<AType, { label: string; short: string; icon: any; color: string; bg: string; desc: string; title: string; subtitle: string; empty: string }> = {
  metrics_pull: { label: "Đồng bộ dữ liệu", short: "Đồng bộ", icon: Database, color: "text-violet-600", bg: "bg-violet-500/10", desc: "Đưa số liệu Facebook/TikTok Ads về Google Sheets theo lịch", title: "Đồng bộ dữ liệu", subtitle: "Đưa số liệu Facebook Ads về Google Sheets.", empty: "Tạo luồng đầu tiên để bắt đầu đồng bộ dữ liệu." },
  auto_off: { label: "Dừng theo điều kiện", short: "Tạm dừng", icon: CirclePause, color: "text-orange-500", bg: "bg-orange-500/10", desc: "Tự tạm dừng quảng cáo khi chạm điều kiện (chi tiêu, kết quả, CPA…)", title: "Dừng theo điều kiện", subtitle: "Tự tạm dừng quảng cáo lỗ theo điều kiện — chạy thử trước, bật LIVE khi đã yên tâm.", empty: "Tạo luồng đầu tiên để tự dừng quảng cáo kém hiệu quả." },
  budget: { label: "Điều chỉnh chi tiêu", short: "Chi tiêu", icon: ChartNoAxesColumn, color: "text-emerald-600", bg: "bg-emerald-500/10", desc: "Tăng/giảm ngân sách ngày theo hiệu quả, có trần và thời gian chờ", title: "Điều chỉnh chi tiêu", subtitle: "Tự tăng ngân sách quảng cáo thắng, giảm quảng cáo đắt — luôn có trần và thời gian chờ.", empty: "Tạo luồng đầu tiên để tự điều chỉnh ngân sách." },
  auto_run: { label: "Khởi chạy theo lịch", short: "Lịch chạy", icon: CalendarDays, color: "text-indigo-600", bg: "bg-indigo-500/10", desc: "Bật/tắt theo khung giờ, hoặc tự tạo quảng cáo từ bài viết điểm cao", title: "Khởi chạy theo lịch", subtitle: "Bật/tắt quảng cáo theo khung giờ, hoặc tự đề xuất quảng cáo từ bài viết đạt điểm.", empty: "Tạo luồng đầu tiên để chạy quảng cáo theo lịch." },
};
const METRICS: Record<string, { label: string; unit: "vnd" | "num" | "pct" }> = {
  spend: { label: "Chi tiêu", unit: "vnd" }, results: { label: "Kết quả", unit: "num" }, cpa: { label: "Chi phí/kết quả (CPA)", unit: "vnd" },
  ctr: { label: "CTR", unit: "pct" }, cpm: { label: "CPM", unit: "vnd" }, impressions: { label: "Hiển thị", unit: "num" }, clicks: { label: "Click", unit: "num" }, reach: { label: "Reach", unit: "num" },
};
const WINDOWS: Record<string, string> = { today: "hôm nay", "3d": "3 ngày", "7d": "7 ngày" };
const EVERY = [[5, "5 phút"], [15, "15 phút"], [30, "30 phút"], [60, "1 giờ"], [180, "3 giờ"], [360, "6 giờ"], [1440, "1 ngày"]] as const;
const RANGES: Record<string, string> = { today: "Hôm nay", yesterday: "Hôm qua", last_3d: "3 ngày gần nhất", last_7d: "7 ngày gần nhất", last_30d: "30 ngày gần nhất" };
const DAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const everyText = (m: number) => EVERY.find(([v]) => v === m)?.[1] ?? `${m} phút`;
const fmtVal = (metric: string, v?: number) => (v == null ? "?" : METRICS[metric]?.unit === "vnd" ? vndFull(v) : METRICS[metric]?.unit === "pct" ? `${Math.round(v * 10000) / 100}%` : String(v));
const condText = (c: any) => `${METRICS[c.metric]?.label ?? c.metric} ${WINDOWS[c.window] ?? c.window} ${c.op} ${c.ref ? `${c.ref === "target_cpa" ? "CPA mục tiêu" : c.ref} × ${c.factor ?? 1}` : fmtVal(c.metric, c.value)}${c.consecutiveDays ? ` (${c.consecutiveDays} ngày liên tiếp)` : ""}`;

function detail(a: any, opts: any): string {
  const c = a.config ?? {};
  const accName = (ids: string[]) => (ids?.length ? ids.map((id) => opts?.adAccounts?.find((x: any) => x.id === id)?.name ?? "?").join(", ") : "Tất cả tài khoản");
  switch (a.type as AType) {
    case "metrics_pull": return `${accName(c.accountIds)} · ${RANGES[c.range]} · cấp ${c.level === "campaign" ? "chiến dịch" : "quảng cáo"} → tab "${c.tab}" (${c.writeMode === "append" ? "nối thêm" : "ghi đè"}) · mỗi ${everyText(c.everyMinutes)}`;
    case "auto_off": return `${(c.conditions ?? []).map(condText).join(c.match === "any" ? " HOẶC " : " VÀ ")} → tạm dừng · ${accName(c.accountIds)} · mỗi ${everyText(c.everyMinutes)}`;
    case "budget": return `${(c.conditions ?? []).map(condText).join(c.match === "any" ? " HOẶC " : " VÀ ")} → ${c.pct > 0 ? "tăng" : "giảm"} ${Math.abs(c.pct)}% (trần ${vndFull(c.maxBudget)}) · ${accName(c.accountIds)}`;
    case "auto_run": return c.mode === "schedule"
      ? `${c.adIds?.length ?? 0} quảng cáo · bật ${c.onTime} – tắt ${c.offTime} · ${(c.days ?? []).length === 7 ? "mỗi ngày" : (c.days ?? []).map((d: number) => DAYS[d]).join(", ")}`
      : `Bài điểm ≥ ${c.minScore} → ${c.requireApproval ? "đề xuất chờ duyệt" : "tạo ads ngay"} · ${vndFull(c.dailyBudget)}/ngày · tối đa ${c.maxPerDay}/ngày`;
  }
}

export function Automations() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const type = (params.get("type") as AType | null) ?? null;
  const [pf, setPf] = useAdsPlatform();
  const pst = usePlatformStatus();
  const scoped = !!type && type !== "metrics_pull"; // Tối ưu quảng cáo: chia theo nền tảng
  const notReady = scoped && pst.loaded && (pf === "google_ads" || !pst.of(pf as AdsPf).total);
  /** Đổi nhóm luồng mà giữ nền tảng đang chọn. */
  const go = (t: AType | null) => setParams((cur) => { const n = new URLSearchParams(cur); if (t) n.set("type", t); else n.delete("type"); return n; });
  const { data, reload } = useApi<any>("automations", ["action.", "metrics.", "automation."]);
  const { data: opts, reload: reloadOpts } = useApi<any>("automation-options", ["metrics.", "alert."]);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ a: any; r: any } | null>(null);
  const [runs, setRuns] = useState<{ a: any; list: any[] } | null>(null);
  const [liveAsk, setLiveAsk] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);

  const call = async (key: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast(ok); reload(); return r; }
    catch (e: any) { toast(e.message, "err"); return undefined; }
    finally { setBusy(null); }
  };
  const items = useMemo(() => (data?.items ?? []).filter((a: any) => (!type || a.type === type) && (!scoped || [pf, "any"].includes(platformOf(a, opts))) && (!search || a.name.toLowerCase().includes(search.toLowerCase()))), [data, type, search, scoped, pf, opts]);
  const head = type ? TYPES[type] : null;
  const counts = data?.counts ?? {};

  const total = (Object.values(counts) as number[]).reduce((a, b) => a + b, 0);
  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <aside className="h-fit rounded-2xl border border-line bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-ink">Luồng vận hành</h2>
        <div className="space-y-3">
          {(Object.keys(TYPES) as AType[]).map((t) => {
            const T = TYPES[t];
            return (
              <button key={t} onClick={() => go(t)} className={cx("flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition", type === t ? "border-blue-400 bg-blue-500/5 ring-2 ring-blue-500/15" : "border-line hover:border-blue-300")}>
                <span className={cx("grid h-12 w-12 shrink-0 place-items-center rounded-xl", T.bg, T.color)}><T.icon className="h-6 w-6" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm text-ink">{T.label}</span><span className={cx("text-3xl font-bold leading-tight", T.color)}>{counts[t] ?? 0}</span></span>
                <ChevronRight className="h-4 w-4 text-muted" />
              </button>
            );
          })}
          <button onClick={() => go(null)} className={cx("flex w-full items-center gap-4 rounded-2xl p-4 text-left transition", !type ? "bg-blue-500/15" : "bg-blue-500/10 hover:bg-blue-500/15")}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/15 text-blue-600"><FileText className="h-5 w-5" /></span>
            <span className="flex-1 font-medium text-blue-700 dark:text-blue-300">{total} cấu hình</span>
            <ChevronRight className="h-4 w-4 text-blue-600" />
          </button>
        </div>
      </aside>

      <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{head?.title ?? "Tất cả luồng vận hành"}{scoped && <span className="text-blue-600"> · {pfLabel(pf)}</span>}</h1>
          <p className="mt-1 text-sm text-muted md:text-base">{head?.subtitle ?? "Đồng bộ dữ liệu, dừng theo điều kiện, điều chỉnh chi tiêu, khởi chạy theo lịch — qua trần an toàn, whitelist và nhật ký."}</p>
        </div>
        {!notReady && <Button variant="primary" icon={Plus} className="h-12 px-6 text-base" onClick={() => setEdit({ type, name: "", config: null, platform: scoped ? pf : null })}>Tạo luồng mới</Button>}
      </div>
      {scoped && <PlatformTabs value={pf} onChange={setPf} />}
      {notReady ? <PlatformNotReady pf={pf as AdsPf} what="tối ưu quảng cáo tự động" /> : (

      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input className={cx(inputCls, "pl-9")} placeholder="Tìm luồng vận hành..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button onClick={() => go(null)} className={cx("rounded-xl border px-5 py-2.5 text-sm", !type ? "border-blue-200 bg-blue-500/10 text-blue-700 dark:text-blue-300" : "border-line text-ink")}>Tất cả</button>
          {(Object.keys(TYPES) as AType[]).map((t) => {
            const T = TYPES[t];
            return <button key={t} onClick={() => go(t)} className={cx("rounded-xl border px-5 py-2.5 text-sm", type === t ? "border-blue-200 bg-blue-500/10 text-blue-700 dark:text-blue-300" : "border-line text-ink")}>{T.short}</button>;
          })}
        </div>
        {!data ? <div className="p-5"><Loading /></div> : items.length === 0 ? (
          <div>
            <div className="mx-4 grid grid-cols-5 rounded-xl bg-soft/70 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">{["Tên luồng", "Nhóm tác vụ", "Thông tin", "Tình trạng", "Hành động"].map((h) => <span key={h}>{h}</span>)}</div>
            <div className="grid place-items-center gap-2 py-16 text-center">
              <span className="relative grid h-20 w-20 place-items-center text-blue-400"><FolderOpen className="h-14 w-14" strokeWidth={1.4} /><span className="absolute -left-1 top-1 text-blue-400">✦</span></span>
              <p className="text-lg font-semibold text-ink">Chưa có luồng vận hành</p>
              <p className="text-sm text-muted">{head?.empty ?? "Tạo luồng đầu tiên để bắt đầu tự động hoá quảng cáo."}</p>
              {(opts?.adAccounts?.length ?? 0) === 0 && <p className="mt-2 text-sm text-muted">Chưa có tài khoản quảng cáo — vào <Link to="/ads/integrations" className="text-blue-600 underline">Trung tâm tích hợp</Link> để liên kết Facebook/TikTok.</p>}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr className="bg-soft/70 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                {["Tên luồng", "Nhóm tác vụ", "Thông tin", "Tình trạng", "Hành động"].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-line">
                {items.map((a: any) => {
                  const T = TYPES[a.type as AType];
                  const isRule = !!a.rule_id;
                  return (
                    <tr key={a.id} className="align-top">
                      <td className="px-4 py-3"><p className="font-medium text-ink">{a.name}</p><p className="text-xs text-muted">tạo {ddmm(a.created_at)}</p></td>
                      <td className="px-4 py-3"><span className={cx("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium", T.bg, T.color)}><T.icon className="h-3.5 w-3.5" />{T.short}</span>
                        {a.type !== "metrics_pull" && (() => { const p = platformOf(a, opts); return <p className="mt-1.5 flex items-center gap-1 text-xs text-muted">{p === "any" ? "Mọi nền tảng" : <><PlatformIcon p={p === "meta" ? "facebook" : p} size={14} />{pfLabel(p)}</>}</p>; })()}</td>
                      <td className="max-w-[420px] px-4 py-3">
                        <p className="text-ink">{detail(a, opts)}</p>
                        {a.lastRun && <p className={cx("mt-1 text-xs", a.last_result?.error ? "text-rose-500" : "text-muted")}>Lần chạy {timeAgo(a.lastRun.at)}: {a.lastRun.text}</p>}
                        {a.last_result?.url && <a href={a.last_result.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">Mở Google Sheet</a>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2"><Toggle checked={a.status === "active"} disabled={busy === `s:${a.id}`} onChange={(v) => call(`s:${a.id}`, () => api.post(`automations/${a.id}/status`, { on: v }), v ? "Đã bật luồng" : "Đã tạm dừng luồng")} /><span className="text-xs text-muted">{a.status === "active" ? "Bật" : "Tắt"}</span></div>
                        {isRule && <div className="mt-1.5">{a.mode === "live" ? <Badge tone="red">LIVE</Badge> : <Badge tone="blue">Chạy thử</Badge>}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {(isRule || a.type === "auto_run") && <Button size="sm" icon={FlaskConical} loading={busy === `d:${a.id}`} onClick={async () => { const r = await call(`d:${a.id}`, () => api.post(`automations/${a.id}/run`, { dryRun: true })); if (r) setResult({ a, r }); }}>Chạy thử</Button>}
                          {!isRule && <Button size="sm" variant="soft" icon={Play} loading={busy === `r:${a.id}`} onClick={async () => { const r = await call(`r:${a.id}`, () => api.post(`automations/${a.id}/run`, {})); if (r) setResult({ a, r }); }}>Chạy ngay</Button>}
                          {isRule && (a.mode === "live"
                            ? <Button size="sm" variant="ghost" loading={busy === `l:${a.id}`} onClick={() => call(`l:${a.id}`, () => api.post(`automations/${a.id}/live`, { on: false }), "Đã về chế độ chạy thử")}>Về chạy thử</Button>
                            : <Button size="sm" variant="danger" onClick={() => setLiveAsk(a)}>Bật LIVE</Button>)}
                          {a.type === "metrics_pull" && a.last_result?.download && <a href={a.last_result.download}><Button size="sm" icon={Download}>CSV</Button></a>}
                          <Button size="sm" variant="ghost" icon={History} onClick={async () => { const list = await api.get(`automations/${a.id}/runs`); setRuns({ a, list }); }} aria-label="Lịch sử" />
                          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(a)} aria-label="Sửa" />
                          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(a)} aria-label="Xóa" />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      )}
      {edit && <Editor initial={edit} opts={opts} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); reloadOpts(); }} />}

      <Modal open={!!result} onClose={() => setResult(null)} title={result ? `${result.a.name} — kết quả` : ""} footer={<Button onClick={() => setResult(null)}>Đóng</Button>}>
        {result && (
          <div className="space-y-3 text-sm">
            <p className="text-ink">{result.r.text}</p>
            {(result.r.lines ?? []).length > 0 && <ul className="space-y-1.5">{result.r.lines.map((l: string, i: number) => <li key={i} className="rounded-lg bg-soft px-3 py-2 text-ink">{l}</li>)}</ul>}
            {(result.r.skipped ?? []).length > 0 && <div><p className="mb-1 text-xs font-semibold text-muted">Bỏ qua</p>{result.r.skipped.slice(0, 12).map((s: any, i: number) => <p key={i} className="text-xs text-muted">• {s.entityName}: {s.reason}</p>)}</div>}
            {result.r.download && <a href={result.r.download}><Button size="sm" icon={Download}>Tải file CSV</Button></a>}
            {result.r.url && <a href={result.r.url} target="_blank" rel="noreferrer"><Button size="sm">Mở Google Sheet</Button></a>}
            {result.a.rule_id && <p className="text-xs text-muted">Chạy thử không thay đổi gì thật — hành động đề xuất xem ở Tổng quan Ads › Nhật ký hành động.</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!runs} onClose={() => setRuns(null)} title={runs ? `Lịch sử chạy — ${runs.a.name}` : ""} footer={<Button onClick={() => setRuns(null)}>Đóng</Button>}>
        {runs && (runs.list.length === 0 ? <Empty>Chưa chạy lần nào.</Empty> : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto scroll-thin">
            {runs.list.map((r) => (
              <div key={r.id} className="rounded-xl border border-line p-3 text-sm">
                <p className="flex items-center justify-between"><span className="text-xs text-muted">{ddmm(r.created_at)} {hhmm(r.created_at)}</span><Badge tone={r.status === "error" ? "red" : r.status === "live" ? "red" : r.status === "dry_run" ? "blue" : "green"}>{r.status === "dry_run" ? "chạy thử" : r.status === "live" ? "LIVE" : r.status === "error" ? "lỗi" : "ok"}</Badge></p>
                <p className="mt-1 text-ink">{r.text}</p>
                {r.lines?.slice(0, 5).map((l: string, i: number) => <p key={i} className="text-xs text-muted">• {l}</p>)}
              </div>
            ))}
          </div>
        ))}
      </Modal>

      <Modal open={!!liveAsk} onClose={() => setLiveAsk(null)} title="Bật chế độ LIVE?"
        footer={<><Button onClick={() => setLiveAsk(null)}>Hủy</Button><Button variant="danger" loading={busy === "live"} onClick={() => call("live", () => api.post(`automations/${liveAsk.id}/live`, { on: true, confirm: true }), `"${liveAsk.name}" đã chạy LIVE`).then((r) => r && setLiveAsk(null))}>Tôi hiểu, bật LIVE</Button></>}>
        {liveAsk && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-700 dark:text-rose-300">Khi LIVE, cấu hình <b>"{liveAsk.name}"</b> sẽ {liveAsk.type === "auto_off" ? "tự tạm dừng quảng cáo thật" : "tự đổi ngân sách thật"} trên nền tảng mỗi {everyText(liveAsk.config.everyMinutes)}, không cần bấm duyệt từng lần (tuỳ mức tự chủ của Ads Agent).</div>
            <p className="text-muted">Vẫn luôn áp dụng: chỉ tài khoản trong whitelist, trần tổng ngân sách/ngày, bước tối đa, cooldown, nút Dừng khẩn cấp. Mọi thao tác ghi nhật ký và hoàn tác được.</p>
          </div>
        )}
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title="Xóa luồng?"
        footer={<><Button onClick={() => setDel(null)}>Hủy</Button><Button variant="danger" icon={Trash2} loading={busy === "del"} onClick={() => call("del", () => api.del(`automations/${del.id}`), "Đã xóa luồng").then(() => setDel(null))}>Xóa</Button></>}>
        {del && <p className="text-sm text-muted">Luồng <b className="text-ink">{del.name}</b> sẽ ngừng chạy và bị xóa. Lịch sử hành động đã thực hiện vẫn giữ trong nhật ký.</p>}
      </Modal>
      </div>
    </div>
  );
}

// =====================================================================================
// Editor
// =====================================================================================
const DEFAULTS: Record<AType, any> = {
  metrics_pull: { accountIds: [], level: "ad", range: "today", sheetConnectionId: null, spreadsheet: "", tab: "Chỉ số Ads", writeMode: "overwrite", everyMinutes: 60 },
  auto_off: { platform: "any", accountIds: [], nameFilter: null, match: "all", conditions: [{ metric: "spend", window: "today", op: ">", value: 300000 }, { metric: "results", window: "today", op: "<=", value: 0 }], minSpend: 0, notify: true, everyMinutes: 15, live: false },
  budget: { platform: "any", accountIds: [], nameFilter: null, match: "all", conditions: [{ metric: "cpa", window: "3d", op: "<", value: 150000 }], pct: 20, maxBudget: 10000000, minSpend: 500000, cooldownHours: 24, notify: true, everyMinutes: 60, live: false },
  auto_run: { mode: "schedule", adIds: [], onTime: "07:00", offTime: "23:00", days: [0, 1, 2, 3, 4, 5, 6] },
};
const POST_TO_AD = { mode: "post_to_ad", channelIds: [], minScore: 70, templateId: null, adAccountId: null, dailyBudget: 1000000, requireApproval: true, startPaused: false, maxPerDay: 2 };

function Editor({ initial, opts, onClose, onSaved }: { initial: any; opts: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<AType | null>(initial.type ?? null);
  const [name, setName] = useState<string>(initial.name || (initial.type ? TYPES[initial.type as AType].label : ""));
  const [c, setC] = useState<any>(() => {
    if (!initial.config) {
      if (!initial.type) return null;
      const d = structuredClone(DEFAULTS[initial.type as AType]);
      return initial.platform && "platform" in d ? { ...d, platform: initial.platform } : d;
    }
    const cfg = structuredClone(initial.config);
    // CTR is stored as a fraction; the form edits percent.
    cfg.conditions = cfg.conditions?.map((x: any) => (x.metric === "ctr" && x.value != null ? { ...x, value: Math.round(x.value * 10000) / 100 } : x));
    return cfg;
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: any) => setC({ ...c, ...patch });
  const pick = (t: AType) => { setType(t); setC(structuredClone(DEFAULTS[t])); if (!name) setName(TYPES[t].label); };

  const save = async () => {
    if (!type) return;
    const config = structuredClone(c);
    if (config.conditions) config.conditions = config.conditions.map((x: any) => {
      const y: any = { metric: x.metric, window: x.window, op: x.op };
      if (x.ref) { y.ref = x.ref; y.factor = Number(x.factor ?? 1); } else y.value = x.metric === "ctr" ? Number(x.value) / 100 : Number(x.value);
      if (x.consecutiveDays) y.consecutiveDays = x.consecutiveDays;
      return y;
    });
    if (config.nameFilter && !config.nameFilter.value) config.nameFilter = null;
    setBusy(true);
    try {
      await (initial.id ? api.put(`automations/${initial.id}`, { type, name, config }) : api.post("automations", { type, name, config }));
      toast(type === "auto_off" || type === "budget" ? "Đã lưu và chạy thử — xem kết quả ở cột Chi tiết" : "Đã lưu cấu hình");
      onSaved();
    } catch (e: any) {
      const issue = e.details?.[0];
      toast(issue ? `${issue.path?.join(".")}: ${issue.message}` : e.message, "err");
    } finally { setBusy(false); }
  };

  // Luồng của 1 nền tảng: chỉ hiện tài khoản / quảng cáo của nền tảng đó.
  const pfSel = c?.platform && c.platform !== "any" ? c.platform : initial.platform ?? null;
  const accounts = ((opts?.adAccounts ?? []) as any[]).filter((a) => !pfSel || a.platform === pfSel);
  const adsList = ((opts?.ads ?? []) as any[]).filter((a) => !pfSel || a.platform === pfSel);
  const toggleIn = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  return (
    <Modal open onClose={onClose} wide title={initial.id ? `Sửa luồng — ${TYPES[type!].label}` : type ? `Tạo luồng — ${TYPES[type].label}` : "Tạo luồng mới"}
      footer={type ? <><Button onClick={() => (initial.id || initial.type ? onClose() : setType(null))}>{initial.id || initial.type ? "Hủy" : "Quay lại"}</Button><Button variant="primary" loading={busy} onClick={save}>{initial.id ? "Lưu thay đổi" : "Tạo luồng"}</Button></> : <Button onClick={onClose}>Đóng</Button>}>
      {!type ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(TYPES) as AType[]).map((t) => {
            const T = TYPES[t];
            return (
              <button key={t} onClick={() => pick(t)} className="flex items-start gap-3 rounded-2xl border border-line p-4 text-left transition hover:border-blue-400 hover:bg-soft/50">
                <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", T.bg, T.color)}><T.icon className="h-5 w-5" /></span>
                <span><span className="block font-semibold text-ink">{T.label}</span><span className="text-xs text-muted">{T.desc}</span></span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-5">
          <Field label="Tên luồng"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Tắt ads lỗ ABS" /></Field>

          {type === "metrics_pull" && (
            <>
              <AccountPicker accounts={accounts} value={c.accountIds} onChange={(v) => set({ accountIds: v })} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Cấp độ"><select className={inputCls} value={c.level} onChange={(e) => set({ level: e.target.value })}><option value="ad">Quảng cáo</option><option value="campaign">Chiến dịch</option></select></Field>
                <Field label="Khoảng ngày"><select className={inputCls} value={c.range} onChange={(e) => set({ range: e.target.value })}>{Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Tần suất"><select className={inputCls} value={c.everyMinutes} onChange={(e) => set({ everyMinutes: Number(e.target.value) })}>{EVERY.filter(([v]) => v >= 15).map(([v, l]) => <option key={v} value={v}>Mỗi {l}</option>)}</select></Field>
              </div>
              <Field label="Kết nối Google Sheets" hint={(opts?.sheets ?? []).length ? undefined : "Chưa có — thêm ở Quản lý kết nối › Google Sheets (có chế độ mô phỏng ghi ra CSV)."}>
                <select className={inputCls} value={c.sheetConnectionId ?? ""} onChange={(e) => { const s = opts.sheets.find((x: any) => x.id === e.target.value); set({ sheetConnectionId: e.target.value || null, spreadsheet: c.spreadsheet || s?.defaultSpreadsheet || "" }); }}>
                  <option value="">— Chọn kết nối —</option>
                  {(opts?.sheets ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.mode === "sandbox" ? " (mô phỏng → CSV)" : ""}</option>)}
                </select>
              </Field>
              {opts?.sheets?.find((s: any) => s.id === c.sheetConnectionId)?.mode === "live" && (
                <Field label="Link Google Sheet" hint="Nhớ chia sẻ Sheet cho email service account (quyền Người chỉnh sửa)."><input className={inputCls} value={c.spreadsheet} onChange={(e) => set({ spreadsheet: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/..." /></Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tên tab"><input className={inputCls} value={c.tab} onChange={(e) => set({ tab: e.target.value })} /></Field>
                <Field label="Cách ghi"><select className={inputCls} value={c.writeMode} onChange={(e) => set({ writeMode: e.target.value })}><option value="overwrite">Ghi đè toàn bộ tab</option><option value="append">Nối thêm dòng mới</option></select></Field>
              </div>
            </>
          )}

          {(type === "auto_off" || type === "budget") && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Nền tảng"><select className={inputCls} value={c.platform} onChange={(e) => set({ platform: e.target.value })}><option value="any">Tất cả</option><option value="meta">Facebook</option><option value="tiktok">TikTok</option></select></Field>
                <Field label="Lọc theo tên ad"><select className={inputCls} value={c.nameFilter?.op ?? ""} onChange={(e) => set({ nameFilter: e.target.value ? { op: e.target.value, value: c.nameFilter?.value ?? "" } : null })}><option value="">Không lọc</option><option value="contains">Tên chứa</option><option value="notContains">Tên không chứa</option><option value="startsWith">Tên bắt đầu bằng</option></select></Field>
                <Field label="Từ khoá">{c.nameFilter ? <input className={inputCls} value={c.nameFilter.value} onChange={(e) => set({ nameFilter: { ...c.nameFilter, value: e.target.value } })} placeholder="VD: ABS" /> : <input className={inputCls} disabled placeholder="—" />}</Field>
              </div>
              <AccountPicker accounts={accounts} value={c.accountIds} onChange={(v) => set({ accountIds: v })} />
              <div className="space-y-2 rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">Điều kiện</p>
                  <select className={cx(inputCls, "!w-auto")} value={c.match} onChange={(e) => set({ match: e.target.value })}><option value="all">Thoả TẤT CẢ điều kiện</option><option value="any">Thoả MỘT trong các điều kiện</option></select>
                </div>
                {c.conditions.map((x: any, i: number) => (
                  <div key={i} className="grid grid-cols-[1fr_110px_70px_1fr_auto] items-center gap-2">
                    <select className={inputCls} value={x.metric} onChange={(e) => set({ conditions: c.conditions.map((y: any, j: number) => (j === i ? { ...y, metric: e.target.value } : y)) })}>{Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                    <select className={inputCls} value={x.window} onChange={(e) => set({ conditions: c.conditions.map((y: any, j: number) => (j === i ? { ...y, window: e.target.value } : y)) })}>{Object.entries(WINDOWS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <select className={inputCls} value={x.op} onChange={(e) => set({ conditions: c.conditions.map((y: any, j: number) => (j === i ? { ...y, op: e.target.value } : y)) })}>{[">", ">=", "<", "<="].map((o) => <option key={o}>{o}</option>)}</select>
                    {x.ref ? <span className="text-xs text-muted">CPA mục tiêu × {x.factor}</span>
                      : <input type="number" className={inputCls} value={x.value ?? ""} onChange={(e) => set({ conditions: c.conditions.map((y: any, j: number) => (j === i ? { ...y, value: e.target.value === "" ? "" : Number(e.target.value) } : y)) })} placeholder={METRICS[x.metric]?.unit === "vnd" ? "VNĐ" : METRICS[x.metric]?.unit === "pct" ? "%" : "số"} />}
                    <button onClick={() => set({ conditions: c.conditions.filter((_: any, j: number) => j !== i) })} disabled={c.conditions.length <= 1} className="rounded-lg p-2 text-muted hover:bg-soft disabled:opacity-30" aria-label="Xóa điều kiện"><X className="h-4 w-4" /></button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={Plus} onClick={() => set({ conditions: [...c.conditions, { metric: "cpa", window: "today", op: ">", value: 200000 }] })}>Thêm điều kiện</Button>
                <p className="text-xs text-muted">CTR nhập theo %. CPA chỉ tính khi đã có kết quả; ad chưa có kết quả được xét bằng điều kiện "Kết quả".</p>
              </div>
              {type === "budget" && (
                <div className="grid gap-4 sm:grid-cols-4">
                  <Field label="Hành động"><select className={inputCls} value={c.pct > 0 ? "up" : "down"} onChange={(e) => set({ pct: (e.target.value === "up" ? 1 : -1) * Math.abs(c.pct) })}><option value="up">Tăng ngân sách</option><option value="down">Giảm ngân sách</option></select></Field>
                  <Field label="Mức (%)" hint="Nên ≤ 20% để không reset học máy"><input type="number" min={1} max={50} className={inputCls} value={Math.abs(c.pct)} onChange={(e) => set({ pct: (c.pct > 0 ? 1 : -1) * Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
                  <Field label="Trần ngân sách/ad (VNĐ)"><input type="number" step={500000} className={inputCls} value={c.maxBudget} onChange={(e) => set({ maxBudget: Number(e.target.value) })} /></Field>
                  <Field label="Cooldown (giờ)"><input type="number" min={1} className={inputCls} value={c.cooldownHours} onChange={(e) => set({ cooldownHours: Number(e.target.value) })} /></Field>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Chỉ xét ad đã chi tối thiểu (VNĐ)" hint="Tránh kết luận khi dữ liệu còn ít"><input type="number" step={100000} className={inputCls} value={c.minSpend} onChange={(e) => set({ minSpend: Number(e.target.value) })} /></Field>
                <Field label="Kiểm tra mỗi"><select className={inputCls} value={c.everyMinutes} onChange={(e) => set({ everyMinutes: Number(e.target.value) })}>{EVERY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
                <Field label="Báo Telegram" hint={opts?.telegram ? "Gửi khi có hành động" : "Chưa kết nối Telegram"}><div className="pt-1"><Toggle checked={c.notify} onChange={(v) => set({ notify: v })} /></div></Field>
              </div>
              <label className="flex items-start gap-3 rounded-xl border border-line p-3">
                <input type="checkbox" className="mt-1" checked={c.live} onChange={(e) => set({ live: e.target.checked })} />
                <span className="text-sm"><b className="text-ink">Chạy LIVE ngay sau khi lưu</b><span className="block text-muted">Bỏ trống = chế độ chạy thử: hệ thống chỉ ghi "sẽ làm gì", không đụng tài khoản thật. Khuyến nghị chạy thử 1–2 ngày trước.</span></span>
              </label>
            </>
          )}

          {type === "auto_run" && (
            <>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-soft p-1">
                {([["schedule", "Bật/tắt theo khung giờ"], ["post_to_ad", "Tự tạo ads từ bài điểm cao"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setC(k === "schedule" ? structuredClone(DEFAULTS.auto_run) : structuredClone(POST_TO_AD))} className={cx("rounded-lg px-3 py-2 text-sm font-medium", c.mode === k ? "bg-card text-ink shadow-sm" : "text-muted")}>{l}</button>
                ))}
              </div>
              {c.mode === "schedule" ? (
                <>
                  <Field label={`Quảng cáo áp dụng (${c.adIds.length} đã chọn)`}>
                    <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-2 scroll-thin">
                      {adsList.length === 0 ? <p className="p-2 text-sm text-muted">Chưa có quảng cáo{pfSel ? ` ${pfLabel(pfSel)}` : ""} — kết nối và "Đồng bộ chiến dịch" trước.</p> : adsList.map((ad: any) => (
                        <label key={ad.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-soft">
                          <input type="checkbox" checked={c.adIds.includes(ad.id)} onChange={() => set({ adIds: toggleIn(c.adIds, ad.id) })} />
                          <span className="min-w-0 flex-1 truncate text-ink">{ad.name}</span><span className="text-xs text-muted">{ad.campaign}</span>
                        </label>
                      ))}
                    </div>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Bật lúc"><input type="time" className={inputCls} value={c.onTime} onChange={(e) => set({ onTime: e.target.value })} /></Field>
                    <Field label="Tắt lúc" hint="Giờ Việt Nam. Tắt < bật = chạy qua đêm."><input type="time" className={inputCls} value={c.offTime} onChange={(e) => set({ offTime: e.target.value })} /></Field>
                  </div>
                  <Field label="Ngày áp dụng">
                    <div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} onClick={() => set({ days: c.days.includes(d) ? c.days.filter((x: number) => x !== d) : [...c.days, d] })} className={cx("h-9 w-11 rounded-xl border text-sm font-medium", c.days.includes(d) ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300" : "border-line text-muted")}>{DAYS[d]}</button>)}</div>
                  </Field>
                  <p className="text-xs text-muted">Ad vừa bị rule "Tắt ads tự động" dừng (đang cooldown) sẽ không bị bật lại theo lịch.</p>
                </>
              ) : (
                <>
                  <Field label="Fanpage (bỏ trống = tất cả trong whitelist)">
                    <div className="flex flex-wrap gap-2">{(opts?.channels ?? []).filter((ch: any) => ch.platform === "facebook" || ch.platform === "tiktok").map((ch: any) => (
                      <button key={ch.id} onClick={() => set({ channelIds: toggleIn(c.channelIds, ch.id) })} className={cx("rounded-xl border px-3 py-1.5 text-sm", c.channelIds.includes(ch.id) ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300" : "border-line text-ink")}>{ch.name}</button>
                    ))}</div>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Điểm bài tối thiểu"><input type="number" min={0} max={100} className={inputCls} value={c.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} /></Field>
                    <Field label="Ngân sách/ngày (VNĐ)"><input type="number" step={100000} className={inputCls} value={c.dailyBudget} onChange={(e) => set({ dailyBudget: Number(e.target.value) })} /></Field>
                    <Field label="Tối đa ads/ngày"><input type="number" min={1} max={20} className={inputCls} value={c.maxPerDay} onChange={(e) => set({ maxPerDay: Number(e.target.value) })} /></Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Tài khoản quảng cáo"><select className={inputCls} value={c.adAccountId ?? ""} onChange={(e) => set({ adAccountId: e.target.value || null })}><option value="">Tự chọn tài khoản đầu tiên trong whitelist</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                    <Field label="Mẫu quảng cáo"><select className={inputCls} value={c.templateId ?? ""} onChange={(e) => set({ templateId: e.target.value || null })}><option value="">Mặc định (tin nhắn)</option>{(opts?.templates ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm"><span><b className="text-ink">Chờ Sếp duyệt</b><span className="block text-xs text-muted">Tạo mục trong "Duyệt & Phê duyệt"</span></span><Toggle checked={c.requireApproval} onChange={(v) => set({ requireApproval: v })} /></label>
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm"><span><b className="text-ink">Tạo ở trạng thái tạm dừng</b><span className="block text-xs text-muted">Sếp tự bật sau khi xem lại</span></span><Toggle checked={c.startPaused} onChange={(v) => set({ startPaused: v })} /></label>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function AccountPicker({ accounts, value, onChange }: { accounts: any[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label="Tài khoản quảng cáo" hint={accounts.length ? "Không chọn = tất cả tài khoản trong whitelist" : undefined}>
      {accounts.length === 0 ? <p className="rounded-xl border border-dashed border-line p-3 text-sm text-muted">Chưa có tài khoản. <Link to="/ads/integrations" className="text-blue-600 underline">Liên kết Facebook/TikTok</Link></p> : (
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <button key={a.id} onClick={() => onChange(value.includes(a.id) ? value.filter((x) => x !== a.id) : [...value, a.id])} className={cx("rounded-xl border px-3 py-1.5 text-sm", value.includes(a.id) ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300" : "border-line text-ink", !a.whitelisted && "opacity-60")}>
              {a.platform === "tiktok" ? "♪" : "f"} {a.name}{!a.whitelisted && " (ngoài whitelist)"}{a.mode === "sandbox" && " · demo"}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}
