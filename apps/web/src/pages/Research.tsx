import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clapperboard, Eye, Flame, Pencil, Plus, Radar, RefreshCw, Settings2, Sparkles, Trash2, TrendingUp, Trophy, UserRound } from "lucide-react";
import { api, useApi } from "../lib/api";
import { num, timeAgo } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, PlatformIcon, Stat, Tabs, Toggle, cx, inputCls, useToast } from "../components/ui";

/** Research đối thủ · Radar xu hướng: kênh thêm tay → AI quét số liệu thật → video bùng nổ, decode, clone cho kênh mình. */
type Tab = "rising" | "channels" | "weekly";
const PLAT_NAME: Record<string, string> = { tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube", instagram: "Instagram" };
const mult = (m: number | null | undefined) => (m == null ? "—" : `${m >= 10 ? Math.round(m) : m}×`);
const ago = (iso?: string | null) => (iso ? timeAgo(iso) : "chưa rõ ngày đăng");
const TASK_ST: Record<string, string> = { ready: "đang chờ viết", running: "đang viết", done: "xong · vào Duyệt", awaiting_approval: "chờ Sếp duyệt", review: "đang review", failed: "lỗi", rejected: "bị từ chối" };

export function Research() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("rising");
  const [days, setDays] = useState(30);
  const [group, setGroup] = useState("");
  const { data: d, reload } = useApi<any>(`research?days=${days}${group ? `&group=${encodeURIComponent(group)}` : ""}`, ["research.", "task.", "approval."]);
  const [add, setAdd] = useState<any | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast(ok(r)); reload(); return r; } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const myGroups = useMemo(() => [...new Set((d?.channels ?? []).filter((c: any) => c.owner === "mine").map((c: any) => c.group_name))] as string[], [d]);
  const cloneGroups = myGroups.length ? myGroups : (d?.groups ?? []);
  if (!d) return <Loading />;
  const k = d.kpi;
  const scanText = d.settings.scanTimes.length ? `tự quét ${d.settings.scanTimes.join(" · ")} mỗi ngày` : "chưa bật tự quét";

  return (
    <div className="space-y-6">
      <PageHeader title="Research đối thủ"
        subtitle={`Radar xu hướng: video của mình và đối thủ đang lên bất thường so với trung vị kênh, có decode khuôn và gợi ý clone. ${d.lastScan ? `Quét lần cuối ${timeAgo(d.lastScan)}` : "Chưa quét lần nào"} · ${scanText}.`}
        actions={<>
          <Button icon={Settings2} onClick={() => setSettings({ ...d.settings, scanTimesText: d.settings.scanTimes.join(", ") })}>Cài đặt quét</Button>
          <Button icon={RefreshCw} loading={busy === "scan" || d.busy} disabled={!d.channels.length} onClick={() => run("scan", () => api.post("research/scan"), (r) => `Đã xếp quét ${r.queued} kênh — AI Agent chạy lần lượt trên Chrome Flow`)}>{d.busy ? "Đang quét…" : "Quét ngay"}</Button>
          <Button variant="primary" icon={Plus} onClick={() => setAdd({ url: "", owner: "competitor", group: group || d.groups[0] || "", name: "", notes: "" })}>Thêm kênh</Button>
        </>} />

      {d.boom.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-800 dark:text-rose-200">
          <Flame className="h-5 w-5 shrink-0" />
          <p className="flex-1 font-medium">{d.boom.length} video đối thủ đang bùng nổ (gấp ≥ {d.settings.boomMultiple} lần trung vị, đăng ≤ {d.settings.boomDays} ngày) · nên clone</p>
          <Button size="sm" variant="danger" onClick={() => setTab("rising")}>Xem & clone</Button>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { value: "rising", label: `Video đang lên (${d.rising.length})` }, { value: "channels", label: `Kênh theo dõi (${d.channels.length})` }, { value: "weekly", label: "So sánh kênh tuần" },
        ]} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Khoảng:</span>
          {[7, 30, 90].map((n) => <button key={n} onClick={() => setDays(n)} className={cx("rounded-xl border px-3 py-1.5", days === n ? "border-blue-500 bg-blue-500/10 font-medium text-blue-700 dark:text-blue-300" : "border-line text-ink hover:bg-soft")}>{n} ngày</button>)}
          <span className="ml-2 text-muted">Nhóm kênh:</span>
          {["", ...d.groups].map((g: string) => <button key={g || "all"} onClick={() => setGroup(g)} className={cx("rounded-xl border px-3 py-1.5", group === g ? "border-blue-500 bg-blue-500/10 font-medium text-blue-700 dark:text-blue-300" : "border-line text-ink hover:bg-soft")}>{g || "Tất cả"}</button>)}
        </div>
      </div>

      {!d.channels.length ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Radar className="h-12 w-12 text-blue-500" />
            <p className="text-lg font-semibold text-ink">Chưa theo dõi kênh nào</p>
            <p className="max-w-xl text-sm text-muted">Thêm link kênh TikTok / Facebook / YouTube / Instagram của đối thủ (và kênh của mình để so sánh). AI Agent mở trang công khai bằng Chrome Flow, đọc lượt xem từng video, tìm video vượt trung vị kênh và decode khuôn để Sếp clone.</p>
            <Button variant="primary" icon={Plus} onClick={() => setAdd({ url: "", owner: "competitor", group: "", name: "", notes: "" })}>Thêm kênh đầu tiên</Button>
          </div>
        </Card>
      ) : tab === "rising" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={Flame} tone="red" label="Video đối thủ đang nổi" value={num(k.hotCompetitor)} sub={`gấp ≥ ${d.settings.hotMultiple} lần trung vị, ${days} ngày`} />
            <Stat icon={UserRound} tone="blue" label="Video của mình theo dõi" value={num(k.myTracked)} sub={k.myAvgMultiple != null ? `TB gấp ${k.myAvgMultiple}× trung vị kênh` : "Thêm kênh của mình để so sánh"} />
            <Stat icon={TrendingUp} tone="amber" label="Bật mạnh nhất" value={k.strongest ? mult(k.strongest.multiple) : "—"}
              sub={k.strongest ? <span>{k.strongest.channel.handle ?? k.strongest.channel.name} · {num(k.strongest.views)} view · <a href={k.strongest.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Xem video</a></span> : "Chưa có dữ liệu"} />
            <Stat icon={Trophy} tone="violet" label="Khuôn hook thắng nhiều nhất" value={<span className="text-lg">{k.topFormat?.name ?? "—"}</span>} sub={k.topFormat ? `${k.topFormat.count}/${k.topFormat.of} video nổi` : "Decode video nổi để thấy khuôn thắng"} />
          </div>

          <Card title={<span className="flex items-center gap-2"><Flame className="h-4 w-4 text-rose-500" />Video đang bùng nổ · nên clone</span>}>
            <p className="-mt-1 mb-4 text-xs text-muted">Video của kênh đối thủ gấp ≥ {d.settings.boomMultiple} lần trung vị kênh và đăng trong {d.settings.boomDays} ngày. Bấm “Clone ngay” để Video Agent viết kịch bản theo khuôn này cho kênh đã chọn (góc riêng, không chép), xong vào Duyệt & Phê duyệt.</p>
            {d.boom.length === 0 ? <Empty>Chưa có video bùng nổ trong {d.settings.boomDays} ngày gần đây.</Empty> : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {d.boom.map((v: any) => <BoomCard key={v.id} v={v} groups={cloneGroups} busy={busy} onOpen={() => setDetail(v)}
                  onDecode={() => run(`dec:${v.id}`, () => api.post(`research/videos/${v.id}/decode`), () => "Đã decode video")}
                  onClone={(g) => run(`clone:${v.id}`, () => api.post(`research/videos/${v.id}/clone`, { group: g }), (r) => (r.already ? "Video này đã giao kịch bản rồi" : `Đã giao Video Agent viết kịch bản cho ${g}`))} />)}
              </div>
            )}
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Top 10 theo mức gấp trung vị kênh">
              {d.top10.length === 0 ? <Empty>Chưa có video đối thủ trong kỳ.</Empty> : (
                <div className="space-y-2.5">
                  {d.top10.map((v: any) => (
                    <button key={v.id} onClick={() => setDetail(v)} className="flex w-full items-center gap-3 text-left text-sm hover:opacity-80">
                      <span className="w-[46%] min-w-0 truncate text-ink"><b>{v.channel.handle ?? v.channel.name}</b> · {v.title || v.coverText || "(không có tiêu đề)"}</span>
                      <span className="h-2.5 flex-1 rounded-full bg-soft"><span className="block h-2.5 rounded-full bg-rose-400" style={{ width: `${Math.max(4, ((v.multiple ?? 0) / (d.top10[0].multiple || 1)) * 100)}%` }} /></span>
                      <span className="w-14 text-right font-semibold tabular-nums text-ink">{mult(v.multiple)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Mình so với đối thủ">
              {d.compare.length === 0 ? <Empty>Chưa có nhóm kênh.</Empty> : (
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full min-w-[460px] text-sm">
                    <thead><tr className="border-b border-line text-left text-xs text-muted">{["Nhóm kênh", "Lượt xem · mình", "Lượt xem · đối thủ nổi", "Mình gấp trung vị"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-line">
                      {d.compare.map((c: any) => (
                        <tr key={c.group}>
                          <td className="px-2 py-2.5 font-medium text-ink">{c.group}<p className="text-xs font-normal text-muted">{c.myChannels} kênh mình · {c.competitors} đối thủ</p></td>
                          <td className="px-2 py-2.5 tabular-nums">{c.myViews == null ? "—" : num(c.myViews)}</td>
                          <td className="px-2 py-2.5 tabular-nums">{num(c.theirHotViews)}</td>
                          <td className={cx("px-2 py-2.5 tabular-nums font-semibold", c.myMultiple != null && c.myMultiple < 1 ? "text-rose-500" : "text-ink")}>{c.myMultiple == null ? "—" : `${c.myMultiple}×`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card title={`Video đang lên (${d.rising.length})`}>
            {d.rising.length === 0 ? <Empty>Chưa có video trong kỳ — bấm “Quét ngay”.</Empty> : (
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full min-w-[820px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted">{["Video", "Kênh", "Lượt xem", "Gấp trung vị", "Đăng", "Decode / clone"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {d.rising.map((v: any) => (
                      <tr key={v.id} className="cursor-pointer hover:bg-soft" onClick={() => setDetail(v)}>
                        <td className="max-w-[300px] px-2 py-2.5"><p className="truncate text-ink">{v.title || v.coverText || "(không có tiêu đề)"}</p>{v.isNew && <Badge tone="blue">Mới</Badge>}</td>
                        <td className="px-2 py-2.5"><span className="flex items-center gap-1.5"><PlatformIcon p={v.channel.platform} size={16} />{v.channel.handle ?? v.channel.name}</span><p className="text-xs text-muted">{v.channel.owner === "mine" ? "Kênh mình" : "Đối thủ"} · {v.channel.group}</p></td>
                        <td className="px-2 py-2.5 tabular-nums">{num(v.views)}</td>
                        <td className="px-2 py-2.5"><Badge tone={(v.multiple ?? 0) >= d.settings.boomMultiple ? "red" : (v.multiple ?? 0) >= d.settings.hotMultiple ? "amber" : "gray"}>{mult(v.multiple)}</Badge></td>
                        <td className="px-2 py-2.5 text-xs text-muted">{ago(v.postedAt)}</td>
                        <td className="px-2 py-2.5 text-xs">{v.cloneTask ? <span className="text-emerald-600">✓ Đã giao {v.cloneGroup}</span> : v.decode ? <span className="text-violet-600">Đã decode</span> : <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : tab === "channels" ? (
        <Card title="Kênh theo dõi" action={<Button size="sm" icon={Plus} onClick={() => setAdd({ url: "", owner: "competitor", group: group || d.groups[0] || "", name: "", notes: "" })}>Thêm kênh</Button>}>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">{["Kênh", "Loại", "Nhóm kênh", "Người theo dõi", "Trung vị view", "Video đã quét", "Quét lần cuối", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {d.channels.filter((c: any) => !group || c.group_name === group).map((c: any) => (
                  <tr key={c.id} className="align-top">
                    <td className="px-2 py-2.5"><a href={c.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-medium text-ink hover:underline"><PlatformIcon p={c.platform} size={20} />{c.name}</a><p className="text-xs text-muted">{PLAT_NAME[c.platform]} · {c.handle}</p>{c.notes && <p className="text-xs text-muted">{c.notes}</p>}</td>
                    <td className="px-2 py-2.5"><Badge tone={c.owner === "mine" ? "blue" : "red"}>{c.owner === "mine" ? "Kênh mình" : "Đối thủ"}</Badge>{!c.enabled && <Badge tone="gray" className="ml-1">tạm tắt</Badge>}</td>
                    <td className="px-2 py-2.5 text-ink">{c.group_name}</td>
                    <td className="px-2 py-2.5 tabular-nums">{c.followers == null ? "—" : num(c.followers)}</td>
                    <td className="px-2 py-2.5 tabular-nums">{c.median_views == null ? "—" : num(c.median_views)}</td>
                    <td className="px-2 py-2.5 tabular-nums">{c.video_count}</td>
                    <td className="px-2 py-2.5 text-xs">{c.scanning ? <Badge tone="blue">đang quét…</Badge> : c.last_scan_at ? <span className="text-muted">{timeAgo(c.last_scan_at)}</span> : <span className="text-muted">chưa quét</span>}{c.last_error && <p className="mt-1 max-w-[220px] text-rose-500">{c.last_error}</p>}</td>
                    <td className="px-2 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy === `scan:${c.id}`} onClick={() => run(`scan:${c.id}`, () => api.post("research/scan", { channelIds: [c.id] }), () => `Đã xếp quét ${c.name}`)}>Quét</Button>
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setAdd({ id: c.id, url: c.url, owner: c.owner, group: c.group_name, name: c.name, notes: c.notes ?? "", enabled: !!c.enabled })} />
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => { if (confirm(`Bỏ theo dõi ${c.name}? Số liệu đã quét của kênh này sẽ bị xoá.`)) void run(`del:${c.id}`, () => api.del(`research/channels/${c.id}`), () => "Đã bỏ theo dõi kênh"); }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">AI Agent mở trang CÔNG KHAI bằng Chrome Flow (chỉ đọc: không theo dõi, không thích, không bình luận). Trung vị tính trên video không ghim của lần quét gần nhất. Facebook / Instagram có thể bắt đăng nhập — khi đó kênh báo lỗi “bị chặn”.</p>
        </Card>
      ) : (
        <Card title="So sánh kênh tuần này với tuần trước">
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">{["Kênh", "Nhóm", "Video tuần này", "View tuần này", "Video tuần trước", "View tuần trước", "Thay đổi view", "Bật nhất tuần"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {d.weekly.map((w: any) => {
                  const ch = w.lastWeek.views ? Math.round(((w.thisWeek.views - w.lastWeek.views) / w.lastWeek.views) * 100) : null;
                  return (
                    <tr key={w.id}>
                      <td className="px-2 py-2.5"><span className="flex items-center gap-1.5 font-medium text-ink"><PlatformIcon p={w.platform} size={16} />{w.name}</span><p className="text-xs text-muted">{w.owner === "mine" ? "Kênh mình" : "Đối thủ"}</p></td>
                      <td className="px-2 py-2.5">{w.group}</td>
                      <td className="px-2 py-2.5 tabular-nums">{w.thisWeek.videos}</td>
                      <td className="px-2 py-2.5 tabular-nums font-medium text-ink">{num(w.thisWeek.views)}</td>
                      <td className="px-2 py-2.5 tabular-nums">{w.lastWeek.videos}</td>
                      <td className="px-2 py-2.5 tabular-nums">{num(w.lastWeek.views)}</td>
                      <td className={cx("px-2 py-2.5 tabular-nums font-medium", ch == null ? "text-muted" : ch >= 0 ? "text-emerald-600" : "text-rose-500")}>{ch == null ? "—" : `${ch > 0 ? "+" : ""}${ch}%`}</td>
                      <td className="px-2 py-2.5 tabular-nums">{mult(w.thisWeek.best)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Tính theo ngày đăng của video đã quét (TikTok lấy chính xác từ mã video; nền tảng khác theo ngày trang hiển thị).</p>
        </Card>
      )}

      <ChannelModal value={add} groups={d.groups} onClose={() => setAdd(null)} onSaved={() => { setAdd(null); reload(); }} />
      <SettingsModal value={settings} onClose={() => setSettings(null)} onSaved={() => { setSettings(null); reload(); }} />
      <VideoModal v={detail} groups={cloneGroups} busy={busy} onClose={() => setDetail(null)}
        onDecode={(v) => run(`dec:${v.id}`, () => api.post(`research/videos/${v.id}/decode`), () => "Đã decode video").then(() => setDetail(null))}
        onClone={(v, g) => run(`clone:${v.id}`, () => api.post(`research/videos/${v.id}/clone`, { group: g }), (r) => (r.already ? "Video này đã giao kịch bản rồi" : `Đã giao Video Agent viết kịch bản cho ${g}`)).then(() => setDetail(null))} />
    </div>
  );
}

function BoomCard({ v, groups, busy, onOpen, onDecode, onClone }: { v: any; groups: string[]; busy: string | null; onOpen: () => void; onDecode: () => void; onClone: (g: string) => void }) {
  const [g, setG] = useState<string>(v.cloneGroup ?? v.channel.group ?? groups[0] ?? "");
  return (
    <div className={cx("flex flex-col gap-2 rounded-2xl border p-4", v.isNew ? "border-rose-300 bg-rose-500/5 dark:border-rose-500/40" : "border-line")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5"><Badge tone="red">🔥 Bùng nổ</Badge>{v.isNew && <Badge tone="blue">Mới</Badge>}{v.views >= 500_000 ? <Badge tone="green">Chuẩn clone 500K+</Badge> : v.views < 300_000 ? <Badge tone="gray">Dưới 300K</Badge> : null}</div>
        <span className="text-2xl font-bold text-rose-500">{mult(v.multiple)}</span>
      </div>
      <button onClick={onOpen} className="text-left font-semibold text-ink hover:underline">“{v.title || v.coverText || "(không có tiêu đề)"}”</button>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted"><PlatformIcon p={v.channel.platform} size={14} /><b className="text-ink">{v.channel.handle ?? v.channel.name}</b> {num(v.views)} view · trung vị kênh {num(v.channel.median)}</p>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">đăng {ago(v.postedAt)} <Badge tone="violet">{v.channel.group}</Badge></p>
      {v.decode ? <button onClick={onOpen} className="line-clamp-4 text-left text-sm text-ink" title="Xem decode đầy đủ"><b>Gợi ý clone:</b> {v.decode.cloneIdea}</button>
        : <Button size="sm" variant="soft" icon={Sparkles} loading={busy === `dec:${v.id}`} onClick={onDecode}>Decode khuôn video</Button>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
        <a href={v.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-soft"><Eye className="h-3.5 w-3.5" />Xem video</a>
        {v.cloneTask ? <span className="rounded-xl border border-line px-3 py-1.5 text-xs text-emerald-600">✓ Đã giao {v.cloneGroup} · {TASK_ST[v.cloneTask.status] ?? v.cloneTask.status}</span> : <>
          <select aria-label="Clone cho nhóm kênh" className={cx(inputCls, "h-8 w-auto py-0 text-xs")} value={g} onChange={(e) => setG(e.target.value)}>{groups.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <Button size="sm" variant="primary" icon={Clapperboard} disabled={!g} loading={busy === `clone:${v.id}`} onClick={() => onClone(g)}>Clone ngay</Button>
        </>}
      </div>
    </div>
  );
}

function VideoModal({ v, groups, busy, onClose, onDecode, onClone }: { v: any; groups: string[]; busy: string | null; onClose: () => void; onDecode: (v: any) => void; onClone: (v: any, g: string) => void }) {
  const [g, setG] = useState("");
  if (!v) return null;
  const dc = v.decode;
  const grp = g || v.cloneGroup || v.channel.group || groups[0] || "";
  return (
    <Modal open onClose={onClose} wide title={<span className="flex items-center gap-2"><PlatformIcon p={v.channel.platform} size={20} />{v.title || v.coverText || "Video"}</span>}
      footer={<div className="flex flex-wrap items-center gap-2">
        <a href={v.url} target="_blank" rel="noreferrer"><Button icon={Eye}>Xem video</Button></a>
        <Button icon={Sparkles} loading={busy === `dec:${v.id}`} onClick={() => onDecode(v)}>{dc ? "Decode lại" : "Decode khuôn"}</Button>
        {v.cloneTask ? <Link to="/approvals"><Button variant="ghost">✓ Đã giao {v.cloneGroup} — xem Duyệt</Button></Link> : <>
          <select aria-label="Clone cho nhóm kênh" className={cx(inputCls, "w-auto")} value={grp} onChange={(e) => setG(e.target.value)}>{groups.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <Button variant="primary" icon={Clapperboard} disabled={!grp} loading={busy === `clone:${v.id}`} onClick={() => onClone(v, grp)}>Clone ngay</Button>
        </>}
      </div>}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone="red">Gấp {mult(v.multiple)} trung vị</Badge><Badge>{num(v.views)} view</Badge>{v.likes != null && <Badge>{num(v.likes)} thích</Badge>}{v.comments != null && <Badge>{num(v.comments)} bình luận</Badge>}
          <Badge tone="violet">{v.channel.handle ?? v.channel.name} · {v.channel.owner === "mine" ? "kênh mình" : "đối thủ"} · {v.channel.group}</Badge><Badge tone="gray">đăng {ago(v.postedAt)}</Badge>
        </div>
        {!dc ? <Empty>Chưa decode — bấm “Decode khuôn” để AI Agent mở video (chỉ đọc), đọc caption, chữ trên màn hình, bình luận nổi rồi phân tích.</Empty> : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Info label="Hook" value={dc.hookText} sub={dc.hookType} />
              <Info label="Khuôn nội dung" value={dc.format} />
              <div className="rounded-xl border border-line p-3"><p className="text-xs text-muted">Cấu trúc</p><ol className="mt-1 list-decimal space-y-0.5 pl-5 text-ink">{(dc.structure ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ol></div>
              <Info label="Vì sao nổ" value={dc.whyItWorks} sub={[dc.emotion, dc.audienceInsight].filter(Boolean).join(" · ")} />
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"><p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Gợi ý clone (góc riêng, không chép)</p><p className="mt-1 font-semibold text-ink">{dc.cloneTitle}</p><p className="mt-1 text-ink">{dc.cloneIdea}</p></div>
              {dc.cautions && <Info label="Lưu ý" value={dc.cautions} />}
              {dc.detail && <div className="rounded-xl border border-line p-3 text-xs text-muted"><p className="font-medium text-ink">Dữ liệu đọc từ trang</p>{dc.detail.caption && <p className="mt-1 line-clamp-4">Caption: {dc.detail.caption}</p>}{dc.detail.onScreenText && <p className="mt-1">Chữ trên màn hình: {dc.detail.onScreenText}</p>}{dc.detail.topComments?.length > 0 && <p className="mt-1">Bình luận nổi: {dc.detail.topComments.join(" · ")}</p>}</div>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
function Info({ label, value, sub }: { label: string; value?: string; sub?: string }) {
  return <div className="rounded-xl border border-line p-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-ink">{value || "—"}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</div>;
}

function ChannelModal({ value, groups, onClose, onSaved }: { value: any | null; groups: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const cur = f && value && f._for === value ? f : value ? { ...value, _for: value } : null;
  if (!cur) return null;
  const set = (p: any) => setF({ ...cur, ...p });
  const save = async () => {
    setBusy(true);
    try {
      if (cur.id) await api.put(`research/channels/${cur.id}`, { owner: cur.owner, group: cur.group, name: cur.name, notes: cur.notes || null, enabled: cur.enabled });
      else await api.post("research/channels", { url: cur.url, owner: cur.owner, group: cur.group, name: cur.name || undefined, notes: cur.notes || undefined });
      toast(cur.id ? "Đã lưu kênh" : "Đã thêm kênh — bấm “Quét” để AI Agent lấy số liệu");
      setF(null); onSaved();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={() => { setF(null); onClose(); }} title={cur.id ? "Sửa kênh theo dõi" : "Thêm kênh theo dõi"}
      footer={<><Button onClick={() => { setF(null); onClose(); }}>Huỷ</Button><Button variant="primary" loading={busy} disabled={!cur.url || !cur.group} onClick={save}>{cur.id ? "Lưu" : "Thêm kênh"}</Button></>}>
      <div className="space-y-3">
        <Field label="Link kênh" hint="TikTok (tiktok.com/@kênh), Facebook Page, YouTube (@kênh), Instagram"><input className={inputCls} value={cur.url} disabled={!!cur.id} onChange={(e) => set({ url: e.target.value })} placeholder="https://www.tiktok.com/@giangkita" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Loại kênh"><select className={inputCls} value={cur.owner} onChange={(e) => set({ owner: e.target.value })}><option value="competitor">Đối thủ</option><option value="mine">Kênh của mình</option></select></Field>
          <Field label="Nhóm kênh" hint="Kênh mình + các đối thủ cùng chủ đề chung 1 nhóm (vd Tư Duy Gia Đình)">
            <input className={inputCls} list="research-groups" value={cur.group} onChange={(e) => set({ group: e.target.value })} placeholder="Tư Duy Làm Giàu" />
            <datalist id="research-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          </Field>
        </div>
        <Field label="Tên hiển thị (tuỳ chọn)"><input className={inputCls} value={cur.name} onChange={(e) => set({ name: e.target.value })} placeholder="Tự lấy tên kênh khi quét" /></Field>
        <Field label="Ghi chú (tuỳ chọn)"><input className={inputCls} value={cur.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Vd: đối thủ chính mảng tài chính gia đình" /></Field>
        {cur.id && <label className="flex items-center justify-between rounded-xl border border-line p-3 text-sm"><span>Tự quét kênh này</span><Toggle checked={!!cur.enabled} onChange={(v) => set({ enabled: v })} /></label>}
      </div>
    </Modal>
  );
}

function SettingsModal({ value, onClose, onSaved }: { value: any | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const cur = f && value && f._for === value ? f : value ? { ...value, _for: value } : null;
  if (!cur) return null;
  const set = (p: any) => setF({ ...cur, ...p });
  const save = async () => {
    const times = String(cur.scanTimesText ?? "").split(/[,\s]+/).map((x: string) => x.trim()).filter(Boolean);
    if (times.some((t: string) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return toast("Giờ quét dạng HH:MM, cách nhau dấu phẩy (vd 06:59, 12:59)", "err");
    setBusy(true);
    try {
      await api.put("research/settings", { scanTimes: times, hotMultiple: Number(cur.hotMultiple), boomMultiple: Number(cur.boomMultiple), boomDays: Number(cur.boomDays), autoDecode: !!cur.autoDecode, maxDecodePerScan: Number(cur.maxDecodePerScan) });
      toast("Đã lưu cài đặt quét"); setF(null); onSaved();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={() => { setF(null); onClose(); }} title="Cài đặt Radar đối thủ" footer={<><Button onClick={() => { setF(null); onClose(); }}>Huỷ</Button><Button variant="primary" loading={busy} onClick={save}>Lưu</Button></>}>
      <div className="space-y-3">
        <Field label="Giờ tự quét mỗi ngày (giờ Việt Nam)" hint="Cách nhau dấu phẩy · để trống = chỉ quét khi bấm. Mỗi kênh mất vài phút trên Chrome Flow."><input className={inputCls} value={cur.scanTimesText} onChange={(e) => set({ scanTimesText: e.target.value })} placeholder="06:59, 12:59, 18:59" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="“Đang nổi” khi gấp ≥"><input type="number" step={0.5} className={inputCls} value={cur.hotMultiple} onChange={(e) => set({ hotMultiple: e.target.value })} /></Field>
          <Field label="“Bùng nổ” khi gấp ≥"><input type="number" step={0.5} className={inputCls} value={cur.boomMultiple} onChange={(e) => set({ boomMultiple: e.target.value })} /></Field>
          <Field label="… và đăng trong (ngày)"><input type="number" className={inputCls} value={cur.boomDays} onChange={(e) => set({ boomDays: e.target.value })} /></Field>
        </div>
        <label className="flex items-center justify-between rounded-xl border border-line p-3 text-sm"><span><b className="text-ink">Tự decode video bùng nổ</b><span className="block text-xs text-muted">Sau mỗi lần quét, tối đa {cur.maxDecodePerScan} video / kênh</span></span><Toggle checked={!!cur.autoDecode} onChange={(v) => set({ autoDecode: v })} /></label>
        <Field label="Số video decode tối đa mỗi kênh / lượt quét"><input type="number" className={inputCls} value={cur.maxDecodePerScan} onChange={(e) => set({ maxDecodePerScan: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
