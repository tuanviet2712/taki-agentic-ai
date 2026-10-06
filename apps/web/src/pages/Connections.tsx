import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, CheckCircle2, CircleHelp, Download, LayoutGrid, Link2, Plug, Plus, RefreshCw, Send, ShieldCheck, Sparkles, Unplug } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, Toggle, cx, inputCls, useToast } from "../components/ui";

type Platform = { key: string; name: string; status: "live" | "soon"; color: string; description: string; capabilities: string[]; fields: any[]; guide?: string[]; count: number; ai?: { claude: string; jev: boolean } };

/** Brand tile icon (letters on brand color — no external logos). */
const GLYPH: Record<string, string> = {
  meta: "f", zlcrm: "Z", tiktok: "♪", sheets: "▦", telegram: "✈", ai: "✦", pancake: "P", nhanh: "N", whitelist: "✓", bigquery: "BQ", postgres: "PG",
  google_ads: "G", ga4: "GA", sapo: "S", haravan: "H", kiotviet: "K", bitrix24: "24", zalo: "Z",
};
export function PlatformTileIcon({ p, size = 40, round }: { p: Pick<Platform, "key" | "color">; size?: number; round?: boolean }) {
  const g = GLYPH[p.key] ?? "?";
  return <span className={cx("grid shrink-0 place-items-center font-bold text-white shadow-sm", round ? "rounded-full" : "rounded-xl")} style={{ width: size, height: size, background: p.color, fontSize: size * (g.length > 1 ? 0.34 : 0.48) }}>{g}</span>;
}

const STATUS: Record<string, { label: string; tone: any }> = {
  active: { label: "Hoạt động", tone: "green" }, error: { label: "Lỗi", tone: "red" }, expired: { label: "Token hết hạn", tone: "red" }, revoked: { label: "Đã ngắt", tone: "gray" },
};

export function Connections() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filter = params.get("p") ?? "all";
  const { data: platforms, reload: reloadPlatforms } = useApi<Platform[]>("platforms", ["alert.", "metrics."]);
  const { data: conns, reload } = useApi<any[]>("connections", ["alert.", "metrics."]);
  const [adding, setAdding] = useState<Platform | "pick" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCut, setConfirmCut] = useState<any | null>(null);

  const refresh = () => { reload(); reloadPlatforms(); };
  const run = async (key: string, fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast(ok(r)); refresh(); return r; }
    catch (e: any) { toast(e.message, "err"); return undefined; }
    finally { setBusy(null); }
  };

  const live = (platforms ?? []).filter((p) => p.status === "live");
  const soon = (platforms ?? []).filter((p) => p.status === "soon");
  const total = (conns ?? []).length;
  const shown = (conns ?? []).filter((c) => filter === "all" || c.platform === filter);

  const cur = platforms?.find((p) => p.key === filter);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-5">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-blue-500/10 text-blue-600"><Link2 className="h-8 w-8" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">Trung tâm tích hợp</h1>
          <p className="mt-1 text-muted">Kết nối nền tảng, tập trung dữ liệu.</p>
        </div>
        <Button variant="primary" icon={Plus} className="h-12 px-6 text-base" onClick={() => setAdding(cur?.fields.length ? cur : "pick")}>Liên kết nền tảng</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <aside className="h-fit rounded-2xl border border-line bg-card p-4 shadow-sm">
          <h2 className="mb-3 px-2 text-lg font-bold text-ink">Nguồn dữ liệu</h2>
          {!platforms ? <Loading /> : (
            <div className="space-y-1">
              <SourceRow active={filter === "all"} onClick={() => setParams({})} icon={<span className="grid h-8 w-8 place-items-center text-blue-600"><LayoutGrid className="h-5 w-5" /></span>} label="Tất cả nguồn" count={total} />
              {live.map((p) => <SourceRow key={p.key} active={filter === p.key} onClick={() => setParams({ p: p.key })} icon={<PlatformTileIcon p={p} size={32} round />} label={p.name} count={p.count} />)}
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {filter === "whitelist" ? <WhitelistPanel onChange={refresh} />
            : filter === "ai" ? <AiPanel p={cur} />
            : (
              <section className="rounded-2xl border border-line bg-card p-6 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div><h2 className="text-lg font-bold text-ink">{filter === "all" ? "Các nguồn đã liên kết" : `Nguồn ${cur?.name ?? ""} đã liên kết`}</h2><p className="text-sm text-muted">{shown.length} kết nối</p></div>
                  {filter !== "all" && cur?.fields.length ? <Button size="sm" icon={Plus} onClick={() => setAdding(cur)}>Liên kết {cur.name}</Button> : null}
                </div>
                {!conns ? <Loading /> : shown.length === 0 ? (
                  <div className="grid place-items-center gap-2 py-10 text-center">
                    <span className="grid h-28 w-28 place-items-center rounded-full border-2 border-dashed border-line text-ink/70"><Plug className="h-10 w-10" /></span>
                    <p className="mt-2 text-lg font-semibold text-ink">Chưa có nguồn dữ liệu</p>
                    <p className="text-sm text-muted">Chọn “Liên kết nền tảng” để bắt đầu. Chưa liên kết thì các kênh chạy chế độ mô phỏng.</p>
                  </div>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {shown.map((c) => {
                      const p = platforms?.find((x) => x.key === c.platform);
                      const st = STATUS[c.status] ?? { label: c.status, tone: "gray" };
                      const canImport = c.platform === "meta" || c.platform === "tiktok" || c.platform === "google_ads";
                      return (
                        <div key={c.id} className="rounded-2xl border border-line p-4">
                          <div className="flex items-start gap-3">
                            {p && <PlatformTileIcon p={p} size={42} />}
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-semibold text-ink">{c.display_name}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <Badge tone={st.tone}>{st.label}</Badge>
                                {c.mode === "live" ? <Badge tone="blue">Kết nối thật</Badge> : <Badge tone="amber">Mô phỏng</Badge>}
                                <span className="text-xs text-muted">kiểm tra {timeAgo(c.last_health_at)}</span>
                              </div>
                              {c.last_error && <p className="mt-1.5 rounded-lg bg-rose-500/10 px-2 py-1 text-xs text-rose-600">{c.last_error}</p>}
                            </div>
                          </div>
                          {(c.assets.adAccounts.length > 0 || c.assets.pages.length > 0) && (
                            <div className="mt-3 space-y-1.5 rounded-xl bg-soft/60 p-3 text-sm">
                              {c.assets.adAccounts.map((a: any) => (
                                <p key={a.id} className="flex items-center justify-between gap-2"><span className="truncate text-ink">💳 {a.name} <span className="text-xs text-muted">{a.external_id} · {a.currency}</span></span>{a.whitelisted ? <Badge tone="green">Whitelist</Badge> : <Badge tone="gray">Ngoài whitelist</Badge>}</p>
                              ))}
                              {c.assets.pages.map((pg: any) => (
                                <p key={pg.id} className="flex items-center justify-between gap-2"><span className="truncate text-ink">📄 {pg.name}</span>{pg.whitelisted ? <Badge tone="green">Whitelist</Badge> : <Badge tone="gray">Ngoài whitelist</Badge>}</p>
                              ))}
                              {canImport && <p className="text-xs text-muted">{c.ads} quảng cáo đã đồng bộ</p>}
                            </div>
                          )}
                          {c.platform === "telegram" && c.config?.chatTitle && <p className="mt-2 text-sm text-muted">Gửi về: <b className="text-ink">{c.config.chatTitle}</b></p>}
                          {c.platform === "sheets" && c.config?.spreadsheetTitle && <p className="mt-2 text-sm text-muted">Sheet mặc định: <b className="text-ink">{c.config.spreadsheetTitle}</b></p>}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" icon={CheckCircle2} loading={busy === `t:${c.id}`} onClick={() => run(`t:${c.id}`, () => api.post(`connections/${c.id}/test`), (r) => (r.ok ? `✓ ${r.detail}` : `✗ ${r.detail}`))}>Kiểm tra</Button>
                            {canImport && <Button size="sm" variant="primary" icon={Download} loading={busy === `i:${c.id}`} onClick={() => run(`i:${c.id}`, () => api.post(`connections/${c.id}/import`), (r) => `Đồng bộ xong: ${r.ads} ad mới, ${r.campaigns} chiến dịch mới${r.errors?.length ? ` · lỗi: ${r.errors[0]}` : ""}`)}>Đồng bộ chiến dịch</Button>}
                            {c.platform === "telegram" && <Button size="sm" icon={Send} loading={busy === `m:${c.id}`} onClick={() => run(`m:${c.id}`, () => api.post(`connections/${c.id}/telegram-test`), (r) => r.detail)}>Gửi tin thử</Button>}
                            <Button size="sm" variant="ghost" icon={Unplug} onClick={() => setConfirmCut(c)}>Ngắt kết nối</Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

          <section className="rounded-2xl border border-line bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-ink">Tích hợp sắp mở</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {soon.map((p) => (
                <div key={p.key} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5">
                  <PlatformTileIcon p={p} size={36} />
                  <span className="flex-1 truncate font-medium text-ink">{p.name}</span>
                  <span className="rounded-full bg-orange-500/10 px-2.5 py-1 text-xs font-semibold text-orange-600">Sắp mở</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {adding && <AddConnection platforms={live.filter((p) => p.fields.length)} initial={adding === "pick" ? null : adding} onClose={() => setAdding(null)} onDone={(c) => { setAdding(null); refresh(); setParams({ p: c.platform }); }} />}

      <Modal open={!!confirmCut} onClose={() => setConfirmCut(null)} title="Ngắt kết nối?"
        footer={<><Button onClick={() => setConfirmCut(null)}>Hủy</Button><Button variant="danger" icon={Unplug} loading={busy === "cut"} onClick={() => run("cut", () => api.del(`connections/${confirmCut.id}`), () => "Đã ngắt kết nối").then(() => setConfirmCut(null))}>Ngắt kết nối</Button></>}>
        {confirmCut && <p className="text-sm text-muted">Token của <b className="text-ink">{confirmCut.display_name}</b> sẽ bị xoá khỏi hệ thống. Dữ liệu quảng cáo đã đồng bộ vẫn được giữ để xem lại, nhưng các cấu hình tự động sẽ không tác động được tài khoản này nữa.</p>}
      </Modal>
    </div>
  );
}

function SourceRow({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button onClick={onClick} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition", active ? "bg-blue-500/10 font-semibold text-blue-700 dark:text-blue-300" : "text-ink hover:bg-soft")}>
      {icon}<span className="flex-1">{label}</span>
      <span className={cx("grid h-6 min-w-8 place-items-center rounded-full px-2 text-xs", active ? "bg-card text-blue-700 dark:text-blue-300" : "bg-soft text-muted")}>{count}</span>
    </button>
  );
}

function AddConnection({ platforms, initial, onClose, onDone }: { platforms: Platform[]; initial: Platform | null; onClose: () => void; onDone: (c: any) => void }) {
  const toast = useToast();
  const [p, setP] = useState<Platform | null>(initial);
  const [mode, setMode] = useState<"live" | "sandbox">("live");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const submit = async () => {
    if (!p) return;
    setBusy(true);
    try {
      const credentials: Record<string, string> = {};
      const config: Record<string, string> = {};
      for (const f of p.fields) if (vals[f.key]) (f.secret ? credentials : config)[f.key] = vals[f.key];
      const c = await api.post("connections", { platform: p.key, mode, name: name || undefined, credentials, config });
      toast(`Đã kết nối ${p.name}${c.assets.adAccounts.length ? ` · ${c.assets.adAccounts.length} tài khoản QC` : ""}${c.assets.pages.length ? ` · ${c.assets.pages.length} Fanpage` : ""}`);
      onDone(c);
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} wide title={p ? <span className="flex items-center gap-2"><PlatformTileIcon p={p} size={28} />Liên kết {p.name}</span> : "Liên kết nền tảng"}
      footer={p ? <><Button onClick={() => (initial ? onClose() : setP(null))}>{initial ? "Hủy" : "Quay lại"}</Button><Button variant="primary" loading={busy} onClick={submit}>{mode === "live" ? "Kiểm tra & kết nối" : "Tạo kết nối mô phỏng"}</Button></> : <Button onClick={onClose}>Đóng</Button>}>
      {!p ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {platforms.map((x) => (
            <button key={x.key} onClick={() => { setP(x); setVals(Object.fromEntries(x.fields.filter((f: any) => f.type === "select").map((f: any) => [f.key, f.options[0].value]))); }} className="flex items-start gap-3 rounded-2xl border border-line p-3 text-left transition hover:border-blue-400 hover:bg-soft/50">
              <PlatformTileIcon p={x} />
              <span><span className="block font-semibold text-ink">{x.name}</span><span className="text-xs text-muted">{x.description}</span></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">{p.description}</p>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-soft p-1">
            {([["live", "Kết nối thật"], ["sandbox", "Mô phỏng để test"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} className={cx("rounded-lg px-3 py-2 text-sm font-medium transition", mode === k ? "bg-card text-ink shadow-sm" : "text-muted")}>{l}</button>
            ))}
          </div>
          {mode === "sandbox" ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              Tạo tài khoản demo với số liệu mô phỏng{p.key === "meta" ? " (1 tài khoản quảng cáo + 1 Fanpage, bấm 'Đồng bộ chiến dịch' để có 5 quảng cáo mẫu)" : p.key === "sheets" ? " — 'Kéo chỉ số' sẽ ghi ra file CSV để tải về" : ""}. Không cần token, không tác động gì thật.
            </div>
          ) : (
            <>
              {p.guide && (
                <div className="rounded-xl border border-line">
                  <button onClick={() => setShowGuide(!showGuide)} className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600"><CircleHelp className="h-4 w-4" />Hướng dẫn lấy thông tin kết nối</button>
                  {showGuide && <ol className="list-decimal space-y-1 px-8 pb-3 text-sm text-muted">{p.guide.map((g) => <li key={g}>{g}</li>)}</ol>}
                </div>
              )}
              {p.fields.map((f: any) => (
                <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} hint={f.help}>
                  {f.type === "textarea" ? <textarea rows={5} className={cx(inputCls, "font-mono text-xs")} placeholder={f.placeholder} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                    : f.type === "select" ? <select className={inputCls} value={vals[f.key] ?? f.options[0].value} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>{f.options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    : <input type={f.type === "password" ? "password" : "text"} autoComplete="off" className={inputCls} placeholder={f.placeholder} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />}
                </Field>
              ))}
              <p className="flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />Token được mã hoá khi lưu và không hiển thị lại. Hệ thống gọi thử API để xác thực trước khi lưu.</p>
            </>
          )}
          <Field label="Tên hiển thị (tuỳ chọn)"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={`VD: ${p.name} TAKI Academy`} /></Field>
        </div>
      )}
    </Modal>
  );
}

function WhitelistPanel({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const { data, reload } = useApi<any>("whitelist", ["alert."]);
  const set = async (kind: "ad_account" | "page", id: string, on: boolean) => {
    try { await api.put("whitelist", { kind, id, on }); reload(); onChange(); toast(on ? "Đã thêm vào whitelist" : "Đã bỏ khỏi whitelist"); } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Tài khoản quảng cáo">
        <p className="mb-3 text-sm text-muted">Chỉ tài khoản bật whitelist mới được rule/cấu hình tự động tắt ads, đổi ngân sách hay tạo quảng cáo.</p>
        {!data ? <Loading /> : data.adAccounts.length === 0 ? <Empty>Chưa có tài khoản — kết nối Facebook hoặc TikTok trước.</Empty> : (
          <div className="divide-y divide-line">
            {data.adAccounts.map((a: any) => (
              <div key={a.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{a.name}</p><p className="text-xs text-muted">{a.platform === "meta" ? "Meta" : "TikTok"} · {a.external_id} · {a.ads} ad {a.mode === "sandbox" && "· mô phỏng"}</p></div>
                <Toggle checked={!!a.whitelisted} onChange={(v) => set("ad_account", a.id, v)} />
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Fanpage">
        <p className="mb-3 text-sm text-muted">Fanpage trong whitelist mới được dùng cho "Đăng quảng cáo nhanh" và tự động tạo ads từ bài viết.</p>
        {!data ? <Loading /> : data.pages.length === 0 ? <Empty>Chưa có Fanpage — kết nối Facebook trước.</Empty> : (
          <div className="divide-y divide-line">
            {data.pages.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{p.name}</p><p className="text-xs text-muted">{p.external_id} {p.mode === "sandbox" && "· mô phỏng"}</p></div>
                <Toggle checked={!!p.whitelisted} onChange={(v) => set("page", p.id, v)} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function AiPanel({ p }: { p?: Platform }) {
  return (
    <Card title="AI của hệ thống">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line p-4">
          <p className="flex items-center gap-2 font-medium text-ink"><Bot className="h-4 w-4 text-orange-500" />Claude</p>
          <p className="mt-1 text-sm text-muted">{p?.ai?.claude === "claude_cli" ? "Qua tài khoản Claude đã đăng nhập (Claude Code CLI)" : "Chưa bật — đang chạy sandbox"}</p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="flex items-center gap-2 font-medium text-ink"><Sparkles className="h-4 w-4 text-violet-600" />Jev · System One</p>
          <p className="mt-1 text-sm text-muted">{p?.ai?.jev ? "Đang chạy thật" : "Chế độ heuristic (thiếu TYPESAFE_API_KEY)"}</p>
        </div>
      </div>
      <Link to="/settings" className="mt-3 inline-block"><Button size="sm" icon={RefreshCw}>Đổi model trong Cài đặt chung</Button></Link>
    </Card>
  );
}
