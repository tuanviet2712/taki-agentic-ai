import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronRight, Layers, Lightbulb, Microscope, Pencil, Plus, RefreshCw, Settings2, Telescope, Trash2, Waves } from "lucide-react";
import { api, useApi } from "../lib/api";
import { num, timeAgo } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, PlatformIcon, Toggle, cx, inputCls, useToast } from "../components/ui";

/**
 * Trinh sát nội dung: Sếp thêm nguồn quan sát (kênh đối thủ + kênh của mình, chia theo chủ đề) → AI Agent cập nhật số liệu
 * thật → bắt "tín hiệu" (video vượt mức thường của kênh) → decode khuôn → phát triển thành ý tưởng cho kênh của Sếp.
 */
type View = "signals" | "sources" | "rhythm";
const PLAT: Record<string, string> = { tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube", instagram: "Instagram" };
const times = (m: number | null | undefined) => (m == null ? "—" : `×${m >= 10 ? Math.round(m) : m}`);
const when = (iso?: string | null) => (iso ? timeAgo(iso) : "chưa rõ ngày đăng");
const TASK: Record<string, string> = { ready: "đang chờ viết", running: "đang viết", done: "đã có kịch bản", awaiting_approval: "chờ Sếp duyệt", review: "đang review", failed: "lỗi", rejected: "bị từ chối" };

export function Scout() {
  const toast = useToast();
  const [view, setView] = useState<View>("signals");
  const [days, setDays] = useState(30);
  const [topic, setTopic] = useState("");
  const [strongOnly, setStrongOnly] = useState(true);
  const { data: d, reload } = useApi<any>(`research?days=${days}${topic ? `&group=${encodeURIComponent(topic)}` : ""}`, ["research.", "task.", "approval."]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sort, setSort] = useState<"strength" | "views" | "newest">("strength");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<any | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast(ok(r)); reload(); return r; } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const signals: any[] = useMemo(() => {
    if (!d) return [];
    const base: any[] = strongOnly ? d.boom : d.rising.filter((v: any) => v.channel.owner === "competitor");
    const k = search.trim().toLowerCase();
    const list = k ? base.filter((v) => `${v.title ?? ""} ${v.coverText ?? ""} ${v.channel.handle ?? ""} ${v.channel.name}`.toLowerCase().includes(k)) : base;
    const by = sort === "views" ? (a: any, b: any) => b.views - a.views : sort === "newest" ? (a: any, b: any) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "") : (a: any, b: any) => (b.multiple ?? 0) - (a.multiple ?? 0);
    return [...list].sort(by);
  }, [d, strongOnly, search, sort]);
  const opened = openId ? [...(d?.rising ?? []), ...(d?.boom ?? [])].find((v: any) => v.id === openId) ?? null : null;
  const myTopics = useMemo(() => [...new Set((d?.channels ?? []).filter((c: any) => c.owner === "mine").map((c: any) => c.group_name))] as string[], [d]);
  const devTopics = myTopics.length ? myTopics : (d?.groups ?? []);
  const patterns = useMemo(() => {
    const m = new Map<string, { n: number; best: number }>();
    for (const v of d?.rising ?? []) {
      const f = v.decode?.format; if (!f || v.channel.owner !== "competitor") continue;
      const x = m.get(f) ?? { n: 0, best: 0 }; x.n++; x.best = Math.max(x.best, v.multiple ?? 0); m.set(f, x);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n || b[1].best - a[1].best).slice(0, 6);
  }, [d]);
  if (!d) return <Loading />;
  const newSource = () => setSource({ url: "", owner: "competitor", group: topic || d.groups[0] || "", name: "", notes: "" });
  const dissect = (v: any) => run(`dx:${v.id}`, () => api.post(`research/videos/${v.id}/decode`), () => "Đã decode video");
  const develop = (v: any, g: string) => run(`dv:${v.id}`, () => api.post(`research/videos/${v.id}/clone`, { group: g }), (r) => (r.already ? "Video này đã được phát triển ý tưởng" : `Video Agent đang viết kịch bản cho chủ đề “${g}”`));

  return (
    <div className="space-y-5">
      <PageHeader title="Trinh sát nội dung" subtitle="Quan sát kênh cùng chủ đề, bắt tín hiệu video vượt mức thường của kênh, decode khuôn và phát triển thành ý tưởng riêng cho kênh của Sếp."
        actions={<>
          <Button variant="ghost" icon={Settings2} onClick={() => setSettings({ ...d.settings, scanTimesText: d.settings.scanTimes.join(", ") })} aria-label="Lịch & ngưỡng" />
          <Button icon={RefreshCw} loading={busy === "sync" || d.busy} disabled={!d.channels.length} onClick={() => run("sync", () => api.post("research/scan"), (r) => `AI Agent sẽ cập nhật lần lượt ${r.queued} nguồn`)}>{d.busy ? "Đang cập nhật" : "Cập nhật ngay"}</Button>
          <Button variant="primary" icon={Plus} onClick={newSource}>Thêm nguồn</Button>
        </>} />

      {/* Dải tóm tắt — một dòng, không phải ô số liệu */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-card px-5 py-4 text-base">
        <span className="flex items-center gap-2"><span className="relative flex h-2.5 w-2.5"><span className={cx("absolute inline-flex h-full w-full rounded-full opacity-60", d.boom.length && "animate-ping bg-emerald-400")} /><span className={cx("relative inline-flex h-2.5 w-2.5 rounded-full", d.boom.length ? "bg-emerald-500" : "bg-slate-300")} /></span><b className="text-ink">{d.boom.length}</b><span className="text-muted">tín hiệu mạnh</span></span>
        <span className="text-muted"><b className="text-ink">{d.kpi.hotCompetitor}</b> video vượt ×{d.settings.hotMultiple} trong {days} ngày</span>
        {d.kpi.strongest && <span className="text-muted">Cao nhất <b className="text-ink">{times(d.kpi.strongest.multiple)}</b> · {d.kpi.strongest.channel.handle ?? d.kpi.strongest.channel.name}</span>}
        {d.kpi.topFormat && <span className="max-w-md truncate text-muted" title={d.kpi.topFormat.name}>Khuôn chiếm ưu thế: <b className="text-ink">{d.kpi.topFormat.name.split(/\s[–-]\s/)[0]}</b></span>}
        <span className="ml-auto text-xs text-muted">{d.lastScan ? `Cập nhật ${timeAgo(d.lastScan)}` : "Chưa cập nhật"} · lịch {d.settings.scanTimes.join(", ") || "tắt"}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full bg-soft p-1.5 text-base">
          {([["signals", "Tín hiệu", Lightbulb], ["sources", `Nguồn quan sát · ${d.channels.length}`, Telescope], ["rhythm", "Nhịp tuần", Waves]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => setView(k)} className={cx("flex items-center gap-2 rounded-full px-6 py-2.5 transition", view === k ? "bg-card font-semibold text-ink shadow-sm" : "text-muted hover:text-ink")}><I className="h-5 w-5" />{l}</button>
          ))}
        </div>
        <div className="w-56"><select aria-label="Khoảng thời gian" className={cx(inputCls, "h-12 text-base")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90].map((n) => <option key={n} value={n}>{n} ngày gần đây</option>)}
        </select></div>
      </div>

      {!d.channels.length ? (
        <Card>
          <div className="grid items-center gap-6 py-6 md:grid-cols-[1fr_1.2fr]">
            <div className="grid place-items-center"><span className="grid h-24 w-24 place-items-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-lg"><Telescope className="h-12 w-12" /></span></div>
            <div className="space-y-3">
              <p className="text-lg font-semibold text-ink">Bắt đầu bằng 1 nguồn quan sát</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
                <li>Dán link kênh TikTok / Facebook / YouTube / Instagram cùng chủ đề với Sếp.</li>
                <li>AI Agent mở trang công khai, ghi lượt xem từng video và tính <b>mức thường</b> của kênh.</li>
                <li>Video vượt mức thường thành <b>tín hiệu</b> — decode khuôn rồi phát triển ý tưởng cho kênh mình.</li>
              </ol>
              <Button variant="primary" icon={Plus} onClick={newSource}>Thêm nguồn đầu tiên</Button>
            </div>
          </div>
        </Card>
      ) : view === "signals" ? (
        <div className="space-y-4">
          {/* Thanh lọc gọn: loại tín hiệu · chủ đề · sắp xếp · tìm */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card p-4">
            <div className="inline-flex rounded-xl bg-soft p-1.5 text-base">
              {([[true, `Tín hiệu mạnh · ${d.boom.length}`], [false, "Mọi video đối thủ"]] as const).map(([v, l]) => (
                <button key={String(v)} onClick={() => setStrongOnly(v)} className={cx("rounded-lg px-5 py-2.5", strongOnly === v ? "bg-card font-semibold text-ink shadow-sm" : "text-muted hover:text-ink")}>{l}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["", ...d.groups].map((g: string) => <button key={g || "all"} onClick={() => setTopic(g)} className={cx("rounded-full border px-5 py-2.5 text-base", topic === g ? "border-emerald-500 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300" : "border-line text-ink hover:bg-soft")}>{g || "Mọi chủ đề"}</button>)}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <div className="w-52"><select aria-label="Sắp xếp" className={cx(inputCls, "h-12 text-base")} value={sort} onChange={(e) => setSort(e.target.value as any)}><option value="strength">Vượt chuẩn cao nhất</option><option value="views">Nhiều lượt xem nhất</option><option value="newest">Mới đăng nhất</option></select></div>
              <div className="w-64"><input className={cx(inputCls, "h-12 text-base")} placeholder="Tìm theo tiêu đề, kênh…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            </div>
          </div>

          {signals.length === 0 ? <Card><Empty>{strongOnly ? "Chưa có tín hiệu mạnh — chọn “Mọi video đối thủ” hoặc bấm Cập nhật ngay." : search ? "Không có video khớp từ khoá." : "Chưa có video đối thủ trong khoảng này."}</Empty></Card> : (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {signals.map((v) => <SignalCard key={v.id} v={v} topics={devTopics} busy={busy} boom={d.settings.boomMultiple} onOpen={() => setOpenId(v.id)} onDissect={() => dissect(v)} onDevelop={(g) => develop(v, g)} />)}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={<span className="flex items-center gap-2"><Layers className="h-4 w-4 text-violet-500" />Bản đồ khuôn đang thắng</span>}>
              {patterns.length === 0 ? <p className="text-sm text-muted">Decode vài video để thấy khuôn nào đang thắng.</p> : (
                <div className="flex flex-wrap gap-2">{patterns.map(([f, x]) => <span key={f} className="rounded-xl border border-line px-3 py-2 text-sm" title={f}><b className="text-ink">{f.split(/\s[–-]\s/)[0]}</b><span className="block text-xs text-muted">{x.n} video · cao nhất {times(x.best)}</span></span>)}</div>
              )}
            </Card>
            <Card title="Sức bật kênh của Sếp">
              {d.compare.length === 0 ? <p className="text-sm text-muted">Chưa có chủ đề.</p> : (
                <div className="space-y-3">{d.compare.map((c: any) => (
                  <div key={c.group} className="text-sm">
                    <div className="flex justify-between"><span className="font-medium text-ink">{c.group}</span><span className="text-muted">{c.myMultiple == null ? "chưa thêm kênh của Sếp" : `kênh Sếp ${c.myMultiple}× mức thường`}</span></div>
                    <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-soft">
                      <span className="bg-emerald-500" style={{ width: `${c.myViews ? Math.min(100, (c.myViews / Math.max(1, c.myViews + c.theirHotViews)) * 100) : 0}%` }} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">Sếp {c.myViews == null ? "—" : num(c.myViews)} · đối thủ (video vượt chuẩn) {num(c.theirHotViews)}</p>
                  </div>))}</div>
              )}
            </Card>
          </div>
        </div>
      ) : view === "sources" ? (
        <div className="space-y-6">
          {(d.groups as string[]).filter((g) => !topic || g === topic).map((g) => (
            <section key={g}>
              <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold text-ink">{g}</h3><button onClick={() => setSource({ url: "", owner: "competitor", group: g, name: "", notes: "" })} className="text-sm text-emerald-600 hover:underline">+ Thêm nguồn vào chủ đề này</button></div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {(d.channels as any[]).filter((c) => c.group_name === g).map((c) => (
                  <div key={c.id} className="rounded-2xl border border-line bg-card p-4">
                    <div className="flex items-start gap-3">
                      <PlatformIcon p={c.platform} size={36} />
                      <div className="min-w-0 flex-1">
                        <a href={c.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-ink hover:underline"><span className="truncate">{c.name}</span><ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted" /></a>
                        <p className="text-xs text-muted">{PLAT[c.platform]} · {c.owner === "mine" ? "kênh của Sếp" : "đối thủ"}{!c.enabled && " · tạm ngưng"}</p>
                      </div>
                      <span className={cx("mt-1 h-2.5 w-2.5 rounded-full", c.scanning ? "animate-pulse bg-sky-500" : c.last_error ? "bg-rose-500" : c.last_scan_at ? "bg-emerald-500" : "bg-slate-300")} title={c.scanning ? "đang cập nhật" : c.last_error ?? (c.last_scan_at ? "ổn" : "chưa cập nhật")} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-soft p-2 text-center text-xs">
                      <div><p className="font-semibold text-ink">{c.followers == null ? "—" : num(c.followers)}</p><p className="text-muted">theo dõi</p></div>
                      <div><p className="font-semibold text-ink">{c.median_views == null ? "—" : num(c.median_views)}</p><p className="text-muted">mức thường</p></div>
                      <div><p className="font-semibold text-ink">{c.video_count}</p><p className="text-muted">video</p></div>
                    </div>
                    <p className={cx("mt-2 line-clamp-2 text-xs", c.last_error ? "text-rose-500" : "text-muted")}>{c.scanning ? "AI Agent đang cập nhật…" : c.last_error ? c.last_error : c.last_scan_at ? `Cập nhật ${timeAgo(c.last_scan_at)}` : "Chưa cập nhật"}</p>
                    <div className="mt-2 flex gap-1 border-t border-line pt-2">
                      <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy === `s:${c.id}`} onClick={() => run(`s:${c.id}`, () => api.post("research/scan", { channelIds: [c.id] }), () => `Đã xếp cập nhật ${c.name}`)}>Cập nhật</Button>
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setSource({ id: c.id, url: c.url, owner: c.owner, group: c.group_name, name: c.name, notes: c.notes ?? "", enabled: !!c.enabled })}>Sửa</Button>
                      <Button size="sm" variant="ghost" icon={Trash2} className="ml-auto" onClick={() => { if (confirm(`Bỏ quan sát ${c.name}? Số liệu đã ghi của nguồn này sẽ bị xoá.`)) void run(`r:${c.id}`, () => api.del(`research/channels/${c.id}`), () => "Đã bỏ nguồn"); }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <p className="text-xs text-muted">AI Agent chỉ đọc trang công khai bằng Chrome Flow (không theo dõi, không thích, không bình luận). Mức thường = trung vị lượt xem các video không ghim. Facebook / Instagram có thể yêu cầu đăng nhập trong Chrome Flow.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(d.weekly as any[]).length === 0 ? <Card><Empty>Chưa có nguồn.</Empty></Card> : (d.weekly as any[]).map((w) => {
            const top = Math.max(1, w.thisWeek.views, w.lastWeek.views);
            const ch = w.lastWeek.views ? Math.round(((w.thisWeek.views - w.lastWeek.views) / w.lastWeek.views) * 100) : null;
            return (
              <div key={w.id} className="grid items-center gap-3 rounded-2xl border border-line bg-card p-4 md:grid-cols-[240px_1fr_120px]">
                <div className="flex items-center gap-2"><PlatformIcon p={w.platform} size={24} /><div className="min-w-0"><p className="truncate font-medium text-ink">{w.name}</p><p className="text-xs text-muted">{w.group} · {w.owner === "mine" ? "kênh của Sếp" : "đối thủ"}</p></div></div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2"><span className="w-20 text-muted">Tuần trước</span><span className="h-2 flex-1 rounded-full bg-soft"><span className="block h-2 rounded-full bg-slate-400" style={{ width: `${(w.lastWeek.views / top) * 100}%` }} /></span><span className="w-28 text-right tabular-nums text-muted">{num(w.lastWeek.views)} · {w.lastWeek.videos} video</span></div>
                  <div className="flex items-center gap-2"><span className="w-20 text-muted">Tuần này</span><span className="h-2 flex-1 rounded-full bg-soft"><span className="block h-2 rounded-full bg-emerald-500" style={{ width: `${(w.thisWeek.views / top) * 100}%` }} /></span><span className="w-28 text-right tabular-nums font-medium text-ink">{num(w.thisWeek.views)} · {w.thisWeek.videos} video</span></div>
                </div>
                <div className="text-right"><span className={cx("inline-block rounded-full px-3 py-1 text-sm font-semibold", ch == null ? "bg-soft text-muted" : ch >= 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-600")}>{ch == null ? "—" : `${ch > 0 ? "+" : ""}${ch}%`}</span>{w.thisWeek.best && <p className="mt-1 text-xs text-muted">đỉnh tuần {times(w.thisWeek.best)}</p>}</div>
              </div>
            );
          })}
          <p className="text-xs text-muted">Theo ngày đăng của video đã ghi nhận (TikTok lấy chính xác từ mã video).</p>
        </div>
      )}

      <Modal open={!!opened} onClose={() => setOpenId(null)} wide title="Decode">
        {opened && <Dossier v={opened} topics={devTopics} busy={busy} onDissect={dissect} onDevelop={develop} />}
      </Modal>
      <SourceModal value={source} topics={d.groups} onClose={() => setSource(null)} onSaved={() => { setSource(null); reload(); }} />
      <RulesModal value={settings} onClose={() => setSettings(null)} onSaved={() => { setSettings(null); reload(); }} />
    </div>
  );
}

/** Thẻ tín hiệu: đủ thông tin + thao tác ngay trên thẻ (xem video, decode, phát triển ý tưởng). */
function SignalCard({ v, topics, busy, boom, onOpen, onDissect, onDevelop }: { v: any; topics: string[]; busy: string | null; boom: number; onOpen: () => void; onDissect: () => void; onDevelop: (g: string) => void }) {
  const [g, setG] = useState("");
  const topic = g || v.cloneGroup || (topics.includes(v.channel.group) ? v.channel.group : topics[0]) || "";
  const dc = v.decode;
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-card p-4 transition hover:border-emerald-300 hover:shadow-sm">
      <div className="flex gap-3">
        <Dial value={v.multiple} boom={boom} />
        <div className="min-w-0 flex-1">
          <button onClick={onOpen} className="line-clamp-2 text-left text-lg font-semibold text-ink hover:text-emerald-700 dark:hover:text-emerald-300">{v.title || v.coverText || "(không có tiêu đề)"}</button>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted"><PlatformIcon p={v.channel.platform} size={14} /><b className="text-ink">{v.channel.handle ?? v.channel.name}</b> · {when(v.postedAt)}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-soft p-3 text-center text-sm">
        <div><p className="text-lg font-bold text-ink">{num(v.views)}</p><p className="text-muted">lượt xem</p></div>
        <div><p className="text-lg font-bold text-ink">{num(v.channel.median)}</p><p className="text-muted">mức thường</p></div>
        <div><p className="text-lg font-bold text-emerald-600">{times(v.multiple)}</p><p className="text-muted">vượt chuẩn</p></div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <span className="rounded-md bg-soft px-1.5 py-0.5 text-[11px] text-muted">{v.channel.group}</span>
        {v.isNew && <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-700 dark:text-sky-300">vừa phát hiện</span>}
        {v.views >= 500_000 && <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">500K+ lượt xem</span>}
      </div>
      {dc ? (
        <div className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"><Lightbulb className="h-3.5 w-3.5" />Hướng phát triển</p>
          <p className="mt-1 font-medium text-ink">{dc.cloneTitle}</p>
          <p className="mt-0.5 line-clamp-3 text-ink/80">{dc.cloneIdea}</p>
          <button onClick={onOpen} className="mt-1 text-xs font-medium text-amber-700 hover:underline dark:text-amber-300">Xem Decode đầy đủ →</button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-dashed border-line p-3 text-sm text-muted">
          <span>Chưa decode video này</span>
          <Button icon={Microscope} loading={busy === `dx:${v.id}`} onClick={onDissect}>Decode</Button>
        </div>
      )}
      <div className="mt-auto space-y-2 border-t border-line pt-3" style={{ marginTop: "0.75rem" }}>
        <div className="flex gap-2">
          <a href={v.url} target="_blank" rel="noreferrer" className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 py-2.5 text-base font-medium text-ink hover:bg-soft"><ArrowUpRight className="h-5 w-5" />Xem video</a>
          <button onClick={onOpen} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-violet-500/5 px-3 py-2.5 text-base font-medium text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"><Microscope className="h-5 w-5" />Decode</button>
        </div>
        {v.cloneTask ? (
          <Link to="/approvals" className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-4 py-3 text-base text-emerald-700 dark:text-emerald-300"><span>✓ Đã phát triển cho “{v.cloneGroup}” · {TASK[v.cloneTask.status] ?? v.cloneTask.status}</span><ChevronRight className="h-4 w-4" /></Link>
        ) : (
          <div className="flex flex-col gap-2">
            <select aria-label="Phát triển cho chủ đề" className={cx(inputCls, "h-11 w-full text-base")} value={topic} onChange={(e) => setG(e.target.value)}>{topics.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            <Button variant="primary" icon={Lightbulb} className="h-11 w-full text-base" disabled={!topic} loading={busy === `dv:${v.id}`} onClick={() => onDevelop(topic)}>Phát triển ý tưởng</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Vòng đo độ mạnh: thang log của mức vượt chuẩn (×1 → rỗng, ≥ ×100 → đầy). */
function Dial({ value, boom }: { value: number | null; boom: number }) {
  const v = value ?? 0;
  const pct = Math.max(0.06, Math.min(1, Math.log10(Math.max(1, v)) / 2));
  const r = 22, c = 2 * Math.PI * r;
  const color = v >= boom * 4 ? "#059669" : v >= boom ? "#10b981" : v >= 3 ? "#f59e0b" : "#94a3b8";
  return (
    <span className="relative grid h-14 w-14 shrink-0 place-items-center">
      <svg width="56" height="56" className="-rotate-90"><circle cx="28" cy="28" r={r} fill="none" stroke="var(--soft)" strokeWidth="5" /><circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} /></svg>
      <span className="absolute text-[13px] font-bold tabular-nums text-ink">{times(value)}</span>
    </span>
  );
}

function Dossier({ v, topics, busy, onDissect, onDevelop }: { v: any; topics: string[]; busy: string | null; onDissect: (v: any) => void; onDevelop: (v: any, g: string) => void }) {
  const [g, setG] = useState("");
  const dc = v.decode;
  const topic = g || v.cloneGroup || (topics.includes(v.channel.group) ? v.channel.group : topics[0]) || "";
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="bg-gradient-to-br from-emerald-500/15 to-teal-500/5 p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"><Microscope className="h-3.5 w-3.5" />Decode</p>
        <p className="mt-1 font-semibold text-ink">{v.title || v.coverText || "(không có tiêu đề)"}</p>
        <a href={v.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline dark:text-emerald-300"><PlatformIcon p={v.channel.platform} size={14} />{v.channel.handle ?? v.channel.name} · mở video<ArrowUpRight className="h-3 w-3" /></a>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[["Lượt xem", num(v.views)], ["Mức thường", num(v.channel.median)], ["Vượt chuẩn", times(v.multiple)]].map(([l, x]) => <div key={l} className="rounded-xl bg-card/80 p-2"><p className="text-base font-bold text-ink">{x}</p><p className="text-[11px] text-muted">{l}</p></div>)}
        </div>
      </div>
      <div className="space-y-4 p-4 text-sm">
        {!dc ? (
          <div className="rounded-xl border border-dashed border-line p-4 text-center text-muted">
            <p>Chưa decode. AI Agent sẽ mở video (chỉ đọc), đọc caption, chữ trên màn hình, bình luận nổi rồi phân tích khuôn.</p>
            <Button className="mt-3" icon={Microscope} loading={busy === `dx:${v.id}`} onClick={() => onDissect(v)}>Decode</Button>
          </div>
        ) : (
          <>
            <Row label="Câu mở đầu" text={dc.hookText} note={dc.hookType} />
            <Row label="Khuôn" text={dc.format} />
            {dc.structure?.length > 0 && (
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Diễn biến</p>
                <ol className="mt-2 space-y-2 border-l-2 border-emerald-500/30 pl-4">{dc.structure.map((s: string, i: number) => <li key={i} className="relative text-ink"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-emerald-500" />{s}</li>)}</ol>
              </div>
            )}
            <Row label="Vì sao thu hút" text={dc.whyItWorks} note={[dc.emotion, dc.audienceInsight].filter(Boolean).join(" · ")} />
            <div className="rounded-xl bg-amber-500/10 p-3"><p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"><Lightbulb className="h-3.5 w-3.5" />Hướng phát triển cho kênh Sếp</p><p className="mt-1 font-semibold text-ink">{dc.cloneTitle}</p><p className="mt-1 text-ink">{dc.cloneIdea}</p></div>
            {dc.cautions && <Row label="Lưu ý" text={dc.cautions} />}
            {dc.detail?.topComments?.length > 0 && <Row label="Người xem nói gì" text={dc.detail.topComments.join(" · ")} />}
          </>
        )}
      </div>
      <div className="space-y-2 border-t border-line p-4">
        {v.cloneTask ? <Link to="/approvals" className="block rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">✓ Đã phát triển cho “{v.cloneGroup}” · {TASK[v.cloneTask.status] ?? v.cloneTask.status} → xem Duyệt</Link> : (
          <div className="flex gap-2">
            <select aria-label="Chủ đề phát triển" className={cx(inputCls, "min-w-0 flex-1")} value={topic} onChange={(e) => setG(e.target.value)}>{topics.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            <Button variant="primary" icon={Lightbulb} disabled={!topic} loading={busy === `dv:${v.id}`} onClick={() => onDevelop(v, topic)}>Phát triển ý tưởng</Button>
          </div>
        )}
        {dc && <button onClick={() => onDissect(v)} className="text-xs text-muted hover:text-ink">{busy === `dx:${v.id}` ? "Đang decode lại…" : "Decode lại"}</button>}
        <p className="text-[11px] text-muted">Video Agent giữ khuôn, đổi chủ đề và ví dụ theo DNA của Sếp — không dùng lại lời, tên, hình ảnh của kênh khác.</p>
      </div>
    </div>
  );
}
function Row({ label, text, note }: { label: string; text?: string; note?: string }) {
  return <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p><p className="mt-1 text-ink">{text || "—"}</p>{note && <p className="mt-0.5 text-xs text-muted">{note}</p>}</div>;
}

function SourceModal({ value, topics, onClose, onSaved }: { value: any | null; topics: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const cur = f && value && f._for === value ? f : value ? { ...value, _for: value } : null;
  if (!cur) return null;
  const set = (p: any) => setF({ ...cur, ...p });
  const close = () => { setF(null); onClose(); };
  const save = async () => {
    setBusy(true);
    try {
      if (cur.id) await api.put(`research/channels/${cur.id}`, { owner: cur.owner, group: cur.group, name: cur.name, notes: cur.notes || null, enabled: cur.enabled });
      else await api.post("research/channels", { url: cur.url, owner: cur.owner, group: cur.group, name: cur.name || undefined, notes: cur.notes || undefined });
      toast(cur.id ? "Đã lưu nguồn" : "Đã thêm nguồn — bấm “Cập nhật” để AI Agent ghi số liệu");
      setF(null); onSaved();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={close} title={cur.id ? "Sửa nguồn quan sát" : "Thêm nguồn quan sát"} footer={<><Button onClick={close}>Huỷ</Button><Button variant="primary" loading={busy} disabled={!cur.url || !cur.group} onClick={save}>{cur.id ? "Lưu" : "Thêm nguồn"}</Button></>}>
      <div className="space-y-3">
        <Field label="Link kênh" hint="TikTok (tiktok.com/@kênh) · Facebook Page · YouTube (@kênh) · Instagram"><input className={inputCls} value={cur.url} disabled={!!cur.id} onChange={(e) => set({ url: e.target.value })} placeholder="https://www.tiktok.com/@..." /></Field>
        <div className="grid grid-cols-2 gap-2">
          {[["competitor", "Kênh đối thủ", "Bắt tín hiệu để học khuôn"], ["mine", "Kênh của Sếp", "Đo sức bật để so sánh"]].map(([k, l, h]) => (
            <button key={k} onClick={() => set({ owner: k })} className={cx("rounded-xl border p-3 text-left text-sm", cur.owner === k ? "border-emerald-500 bg-emerald-500/10" : "border-line hover:bg-soft")}><b className="text-ink">{l}</b><span className="block text-xs text-muted">{h}</span></button>
          ))}
        </div>
        <Field label="Chủ đề" hint="Kênh của Sếp và các đối thủ cùng nội dung để chung 1 chủ đề">
          <input className={inputCls} list="scout-topics" value={cur.group} onChange={(e) => set({ group: e.target.value })} placeholder="Vd: Tài chính gia đình" />
          <datalist id="scout-topics">{topics.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="Tên hiển thị (tuỳ chọn)"><input className={inputCls} value={cur.name} onChange={(e) => set({ name: e.target.value })} placeholder="Tự lấy tên kênh khi cập nhật" /></Field>
        <Field label="Ghi chú (tuỳ chọn)"><input className={inputCls} value={cur.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        {cur.id && <label className="flex items-center justify-between rounded-xl border border-line p-3 text-sm"><span>Tự cập nhật nguồn này theo lịch</span><Toggle checked={!!cur.enabled} onChange={(x) => set({ enabled: x })} /></label>}
      </div>
    </Modal>
  );
}

function RulesModal({ value, onClose, onSaved }: { value: any | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const cur = f && value && f._for === value ? f : value ? { ...value, _for: value } : null;
  if (!cur) return null;
  const set = (p: any) => setF({ ...cur, ...p });
  const close = () => { setF(null); onClose(); };
  const save = async () => {
    const list = String(cur.scanTimesText ?? "").split(/[,\s]+/).map((x: string) => x.trim()).filter(Boolean);
    if (list.some((t: string) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return toast("Giờ dạng HH:MM, cách nhau dấu phẩy (vd 07:00, 19:00)", "err");
    setBusy(true);
    try {
      await api.put("research/settings", { scanTimes: list, hotMultiple: Number(cur.hotMultiple), boomMultiple: Number(cur.boomMultiple), boomDays: Number(cur.boomDays), autoDecode: !!cur.autoDecode, maxDecodePerScan: Number(cur.maxDecodePerScan) });
      toast("Đã lưu lịch & ngưỡng"); setF(null); onSaved();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={close} title="Lịch cập nhật & ngưỡng tín hiệu" footer={<><Button onClick={close}>Huỷ</Button><Button variant="primary" loading={busy} onClick={save}>Lưu</Button></>}>
      <div className="space-y-3">
        <Field label="Giờ tự cập nhật mỗi ngày (giờ Việt Nam)" hint="Cách nhau dấu phẩy · để trống = chỉ cập nhật khi bấm. Mỗi nguồn mất vài phút trên Chrome Flow."><input className={inputCls} value={cur.scanTimesText} onChange={(e) => set({ scanTimesText: e.target.value })} placeholder="07:00, 19:00" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tín hiệu: vượt ×"><input type="number" step={0.5} className={inputCls} value={cur.hotMultiple} onChange={(e) => set({ hotMultiple: e.target.value })} /></Field>
          <Field label="Tín hiệu mạnh: vượt ×"><input type="number" step={0.5} className={inputCls} value={cur.boomMultiple} onChange={(e) => set({ boomMultiple: e.target.value })} /></Field>
          <Field label="… đăng trong (ngày)"><input type="number" className={inputCls} value={cur.boomDays} onChange={(e) => set({ boomDays: e.target.value })} /></Field>
        </div>
        <label className="flex items-center justify-between rounded-xl border border-line p-3 text-sm"><span><b className="text-ink">Tự decode tín hiệu mạnh</b><span className="block text-xs text-muted">Sau mỗi lần cập nhật, tối đa {cur.maxDecodePerScan} video / nguồn</span></span><Toggle checked={!!cur.autoDecode} onChange={(x) => set({ autoDecode: x })} /></label>
        <Field label="Số video decode tối đa mỗi nguồn / lần"><input type="number" className={inputCls} value={cur.maxDecodePerScan} onChange={(e) => set({ maxDecodePerScan: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
