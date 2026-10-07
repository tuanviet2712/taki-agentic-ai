import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown, ArrowRight, CheckCircle2, CircleAlert, CircleX, Clock, Pause, Pin, Play, PlaneTakeoff, RefreshCw, Save, Scale, Send, ShieldCheck, Telescope, Zap,
} from "lucide-react";
import { ApiError, api, useApi } from "../lib/api";
import { hhmm, timeAgo } from "../lib/format";
import { Badge, Button, Card, Loading, PageHeader, PlatformIcon, Toggle, cx, inputCls, useToast } from "../components/ui";

type Platform = "facebook" | "instagram" | "tiktok";
type Settings = {
  enabled: boolean; platforms: { platform: Platform; postsPerDay: number }[]; products: string[]; cadence: number;
  videoMode: "free_auto" | "suggest" | "none"; useScout: boolean; autoStrategy: boolean; approvalGate: boolean;
  postWhenApproved: "next_slot" | "now"; maxGoalsPerDay: number; notifyTelegram: boolean; productWeights: Record<string, number>;
};
type Alloc = { key: string; name: string; share: number; mode: "manual" | "exploit" | "explore" | "new" | "even"; reason: string; posts: number };
type AllocationPlan = { window: number; metric: "money" | "leads" | "score" | "none"; products: Alloc[]; notes: string[] };
type Coverage = { target: number; scheduled: number; publishedToday: number; awaiting: number; inProduction: number; waitingVideo: number; total: number };
type Run = { at: string; ran: boolean; reason?: string; message: string; created: { goalId: string; title: string; platform: string; product: string; reason?: string; scout?: string }[]; autoApproved: number; videosStarted: number };
type Stage = { key: string; title: string; href: string; count: number; label: string; detail: string; need: { text: string; href: string } | null };
type Recent = { id: string; title: string; status: string; created_at: string; platform: Platform; items: number; posts: number };
type Status = {
  settings: Settings; state: { lastRun: Run | null }; nextTickAt: string | null; platforms: Platform[];
  coverage: Record<string, Coverage>; products: { key: string; name: string; price: number | null; verified: boolean }[];
  pipeline: Stage[]; allocation: AllocationPlan; recent: Recent[];
};
type Prereq = { key: string; title: string; status: "ok" | "warn" | "fail"; detail: string; action?: { label: string; href: string } };

const METRIC_LABEL = { money: "doanh thu mỗi bài", leads: "lead mỗi bài (chưa đủ đơn)", score: "điểm bài (chưa đủ lead)", none: "chưa có số liệu — chia đều" } as const;
const MODE_TONE = { manual: "amber", exploit: "green", explore: "blue", new: "violet", even: "gray" } as const;
const MODE_LABEL = { manual: "Sếp ghim", exploit: "Theo kết quả", explore: "Thăm dò", new: "Mới", even: "Chia đều" } as const;
const PLATFORM_LABEL: Record<Platform, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok" };
const VIDEO_MODES = [
  { value: "free_auto", title: "Video tự động miễn phí", desc: "Kịch bản Sếp đã duyệt → tự dựng video (cảnh + giọng đọc + phụ đề). Kịch bản cần người thật / Flow vẫn chờ Sếp bấm." },
  { value: "suggest", title: "Chờ Sếp bấm làm video", desc: "Kịch bản đã duyệt nằm sẵn ở Sản xuất video, đã chọn đúng skill — Sếp bấm Tạo video khi muốn." },
  { value: "none", title: "Không làm video", desc: "Chỉ bài viết + ảnh trên Facebook / Instagram (TikTok vẫn cần video)." },
] as const;
const PRE_ICON = { ok: CheckCircle2, warn: CircleAlert, fail: CircleX } as const;
const PRE_COLOR = { ok: "text-emerald-600 dark:text-emerald-400", warn: "text-amber-600 dark:text-amber-400", fail: "text-rose-600 dark:text-rose-400" } as const;
const GOAL_TONE: Record<string, "green" | "blue" | "gray" | "red"> = { active: "blue", done: "green", cancelled: "gray", stalled: "red" };
const GOAL_LABEL: Record<string, string> = { active: "Đang chạy", done: "Xong", cancelled: "Đã huỷ", stalled: "Kẹt" };
const REFRESH = ["autopilot.", "goal.", "task.", "approval.", "post.", "creative.", "conversation."];

/** Lái tự động: Sếp cấu hình 1 lần, hệ thống tự giữ đủ nội dung và chỉ dừng ở các cổng Sếp phải duyệt. */
export function Autopilot() {
  const toast = useToast();
  const { data, error, reload } = useApi<Status>("autopilot", REFRESH);
  const pre = useApi<{ items: Prereq[]; blockers: number }>("autopilot/prerequisites", ["autopilot.settings_changed"]);
  const [form, setForm] = useState<Settings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (data && !dirty) setForm(data.settings); }, [data, dirty]);

  if (!data || !form) return error ? <Card><p className="p-5 text-sm text-rose-600 dark:text-rose-400">Không gọi được máy chủ: {error}</p></Card> : <Loading />;
  const on = data.settings.enabled;
  const patch = (p: Partial<Settings>) => { setForm({ ...form, ...p }); setDirty(true); };

  const act = async (key: string, fn: () => Promise<any>, ok: (r: any) => string) => {
    setBusy(key);
    try {
      const r = await fn();
      toast(ok(r));
      setDirty(false);
      await Promise.all([reload(), pre.reload()]);
    } catch (e) {
      const blockers = e instanceof ApiError ? ((e.details as any)?.blockers as Prereq[] | undefined) : undefined;
      toast(blockers?.length ? `Chưa bật được — còn ${blockers.length} việc cần làm (xem mục Điều kiện)` : e instanceof Error ? e.message : String(e), "err");
      void pre.reload();
    } finally {
      setBusy(null);
    }
  };
  const save = () => act("save", () => api.put("autopilot/settings", {
    platforms: form.platforms, products: form.products, cadence: form.cadence, videoMode: form.videoMode, useScout: form.useScout,
    autoStrategy: form.autoStrategy, approvalGate: form.approvalGate, postWhenApproved: form.postWhenApproved,
    maxGoalsPerDay: form.maxGoalsPerDay, notifyTelegram: form.notifyTelegram, productWeights: form.productWeights ?? {},
  }), () => "Đã lưu cấu hình lái tự động");
  const weights = form.productWeights ?? {};
  const setWeight = (key: string, v: string) => {
    const next = { ...weights };
    if (v === "") delete next[key]; else next[key] = Number(v);
    patch({ productWeights: next });
  };
  const enable = async () => {
    if (dirty) await save();
    await act("enable", () => api.post("autopilot/enable"), (r) => `Đã bật lái tự động. ${r.run?.message ?? ""}`);
  };
  const last = data.state.lastRun;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lái tự động"
        subtitle="Cấu hình 1 lần: hệ thống tự chọn khóa học, mở chiến dịch, viết bài và kịch bản, làm video, lên lịch đăng. Chỉ dừng chờ Sếp ở bước không đảo ngược được: đăng công khai, chạy quảng cáo, sửa DNA/giá."
        actions={<>
          <Button size="sm" icon={RefreshCw} disabled={!on} loading={busy === "run"} onClick={() => act("run", () => api.post("autopilot/run"), (r) => r.run?.message ?? "Đã chạy")}>Chạy ngay</Button>
          {on
            ? <Button size="sm" icon={Pause} loading={busy === "pause"} onClick={() => act("pause", () => api.post("autopilot/pause"), () => "Đã tạm dừng lái tự động")}>Tạm dừng</Button>
            : <Button size="sm" variant="primary" icon={Play} loading={busy === "enable"} onClick={enable}>Bật lái tự động</Button>}
        </>}
      />

      {/* Trạng thái */}
      <section className={cx("overflow-hidden rounded-2xl border p-5 shadow-sm", on ? "border-blue-400/40 bg-gradient-to-br from-blue-500/10 via-violet-500/5 to-transparent" : "border-line bg-card")}>
        <div className="flex flex-wrap items-start gap-4">
          <div className={cx("grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white shadow-sm", on ? "bg-gradient-to-br from-sky-400 to-blue-600" : "bg-slate-400")}>
            <PlaneTakeoff className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1 basis-56">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-ink">{on ? "Đang chạy" : "Tạm dừng"}</h2>
              <Badge tone={on ? "blue" : "gray"}>{on ? "Lái tự động BẬT" : "Lái tự động TẮT"}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {on
                ? <>Lượt kiểm tra kế tiếp: <b className="text-ink">{data.nextTickAt ? `${hhmm(data.nextTickAt)} (${timeAgo(data.nextTickAt)})` : "theo lịch 15 phút"}</b></>
                : "Bấm Bật lái tự động khi các điều kiện bên dưới đã xong."}
            </p>
            {last && (
              <div className="mt-3 rounded-xl border border-line bg-card/70 p-3 text-sm">
                <p className="flex items-center gap-1.5 text-xs text-muted"><Clock className="h-3.5 w-3.5" />Lượt gần nhất {timeAgo(last.at)}</p>
                <p className="mt-1 break-words text-ink">
                  {last.message}
                  {last.autoApproved ? ` · tự chạy tiếp ${last.autoApproved} kế hoạch đạt chấm điểm` : ""}
                  {last.videosStarted ? ` · bắt đầu ${last.videosStarted} video tự động` : ""}
                </p>
                {last.created.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                    {last.created.map((c) => (
                      <li key={c.goalId} className="break-words">+ {c.title}{c.reason ? <span> — {c.reason}</span> : null}{c.scout ? <span className="text-violet-600 dark:text-violet-300"> · khuôn: {c.scout}</span> : null}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
        {data.settings.platforms.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {data.settings.platforms.map((p) => {
              const c = data.coverage[p.platform];
              if (!c) return null;
              const pct = c.target ? Math.min(100, Math.round((c.total / c.target) * 100)) : 0;
              return (
                <div key={p.platform} className="rounded-xl border border-line bg-card p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink"><PlatformIcon p={p.platform} size={18} />{PLATFORM_LABEL[p.platform]}
                    <span className="ml-auto tabular-nums text-muted">{c.total}/{c.target}</span></div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-soft"><div className={cx("h-full rounded-full transition-all", pct >= 100 ? "bg-emerald-500" : "bg-blue-500")} style={{ width: `${pct}%` }} /></div>
                  <p className="mt-1.5 text-xs text-muted">
                    Đủ {data.settings.cadence} ngày cần {c.target} bài: {c.scheduled} đã lên lịch · {c.publishedToday} đăng hôm nay · {c.awaiting} chờ duyệt · {c.inProduction} đang làm{c.waitingVideo ? ` · ${c.waitingVideo} kịch bản chờ video` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Chuỗi khâu */}
      <Card title="Toàn bộ chuỗi đang chạy" action={<span className="text-xs text-muted">Số liệu sống · bấm từng khâu để mở trang</span>}>
        <ol className="grid gap-0 sm:grid-cols-2 sm:gap-3 2xl:grid-cols-4">
          {data.pipeline.map((s, i) => (
            <li key={s.key} className="relative">
              <div className={cx("h-full rounded-xl border p-3.5", s.need ? "border-amber-400/50 bg-amber-500/5" : "border-line bg-card")}>
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-500/15 text-xs font-bold text-blue-600 dark:text-blue-300">{i + 1}</span>
                  <Link to={s.href} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink hover:text-blue-600">{s.title}</Link>
                  <Link to={s.href} aria-label={`Mở ${s.title}`} className="rounded-lg p-1 text-muted hover:bg-soft hover:text-blue-600"><ArrowRight className="h-4 w-4" /></Link>
                </div>
                <p className="mt-2 flex items-baseline gap-1.5"><span className="text-2xl font-bold tabular-nums text-ink">{s.count}</span><span className="text-xs text-muted">{s.label}</span></p>
                <p className="break-words text-xs text-muted">{s.detail}</p>
                {s.need && (
                  <Link to={s.need.href} className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-words">Cần Sếp: {s.need.text}</span>
                  </Link>
                )}
              </div>
              {i < data.pipeline.length - 1 && <div className="flex justify-center py-1 sm:hidden" aria-hidden><ArrowDown className="h-4 w-4 text-blue-500/60" /></div>}
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Vì sao chọn khóa học */}
        <Card title="Khóa học nào được nhiều bài" action={<span className="text-xs text-muted">Theo {METRIC_LABEL[data.allocation.metric]} · {data.allocation.window} ngày</span>}>
          <div>
            <p className="mb-3 flex items-start gap-2 text-xs text-muted">
              <Scale className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              Khóa học ra nhiều lead/đơn mỗi bài được nhiều bài hơn; khóa khác vẫn giữ tối thiểu 20% để thăm dò. Sếp có thể ghim tỉ trọng (nhớ bấm Lưu cấu hình).
            </p>
            {data.allocation.products.length === 0
              ? <p className="text-sm text-muted">DNA chưa có khóa học / sản phẩm — <Link to="/dna" className="text-blue-600 hover:underline">thêm ở Mục tiêu & DNA</Link>.</p>
              : <ul className="space-y-3">
                  {data.allocation.products.map((a) => (
                    <li key={a.key} className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 basis-40 break-words text-sm font-medium text-ink">{a.name}</span>
                        <Badge tone={MODE_TONE[a.mode]}>{MODE_LABEL[a.mode]}</Badge>
                        <span className="w-12 text-right text-sm font-bold tabular-nums text-ink">{Math.round(a.share * 100)}%</span>
                        <label className="flex items-center gap-1 text-xs text-muted">
                          <Pin className="h-3.5 w-3.5" />
                          <select aria-label={`Ghim tỉ trọng cho ${a.name}`} className={cx(inputCls, "w-auto py-1 text-xs")} value={weights[a.key] ?? ""} onChange={(e) => setWeight(a.key, e.target.value)}>
                            <option value="">Tự động</option>
                            {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => <option key={n} value={n}>{n}%</option>)}
                          </select>
                        </label>
                      </div>
                      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.round(a.share * 100)}%` }} /></div>
                      <p className="mt-1 break-words text-xs text-muted">{a.reason}</p>
                    </li>
                  ))}
                </ul>}
            {data.allocation.notes.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">{data.allocation.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
            )}
          </div>
        </Card>

        {/* Chiến dịch tự mở gần đây */}
        <Card title="Chiến dịch lái tự động đã mở" action={<Link to="/plan" className="text-xs font-medium text-blue-600 hover:underline">Mở Kế hoạch</Link>}>
          {data.recent.length === 0
            ? <p className="text-sm text-muted">Chưa có chiến dịch nào. Bật lái tự động — hệ thống sẽ mở chiến dịch khi nền tảng thiếu bài.</p>
            : <ul className="-mx-5 -mb-5 divide-y divide-line">
                {data.recent.map((g) => (
                  <li key={g.id}>
                    <Link to="/plan" className="flex items-center gap-3 px-5 py-3 hover:bg-soft">
                      <PlatformIcon p={g.platform} size={20} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{g.title}</p>
                        <p className="text-xs text-muted">{timeAgo(g.created_at)} · {g.items} nội dung · {g.posts} bài đã đăng thật</p>
                      </div>
                      <Badge tone={GOAL_TONE[g.status] ?? "gray"}>{GOAL_LABEL[g.status] ?? g.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>}
        </Card>
      </div>

      {/* Điều kiện */}
      <Card title="Điều kiện để chạy thật" action={pre.data ? <Badge tone={pre.data.blockers ? "red" : "green"}>{pre.data.blockers ? `Còn ${pre.data.blockers} việc bắt buộc` : "Đủ điều kiện"}</Badge> : undefined}>
        {!pre.data ? <Loading /> : (
          <ul className="-mx-5 -mb-5 divide-y divide-line">
            {pre.data.items.map((i) => {
              const Icon = PRE_ICON[i.status];
              return (
                <li key={i.key} className="flex gap-3 px-5 py-3">
                  <Icon className={cx("mt-0.5 h-5 w-5 shrink-0", PRE_COLOR[i.status])} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{i.title}</p>
                    <p className="break-words text-sm text-muted">{i.detail}</p>
                    {i.action && i.status !== "ok" && (
                      i.action.href.startsWith("/autopilot")
                        ? <a href="#settings" className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-500/20">{i.action.label}<ArrowRight className="h-3.5 w-3.5" /></a>
                        : <Link to={i.action.href} className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-500/20">{i.action.label}<ArrowRight className="h-3.5 w-3.5" /></Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Cấu hình */}
      <div id="settings" className="scroll-mt-20">
        <Card title="Cấu hình" action={<Button size="sm" variant="primary" icon={Save} disabled={!dirty} loading={busy === "save"} onClick={save}>Lưu cấu hình</Button>}>
          <div className="space-y-6">
            <fieldset>
              <legend className="text-sm font-medium text-ink">Đăng lên đâu, mỗi ngày mấy bài</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                {data.platforms.map((p) => {
                  const cur = form.platforms.find((x) => x.platform === p);
                  return (
                    <div key={p} className={cx("flex items-center gap-2 rounded-xl border p-3", cur ? "border-blue-400 bg-blue-500/5" : "border-line")}>
                      <input id={`pf-${p}`} type="checkbox" checked={Boolean(cur)} className="h-4 w-4 accent-blue-600"
                        onChange={(e) => patch({ platforms: e.target.checked ? [...form.platforms, { platform: p, postsPerDay: 1 }] : form.platforms.filter((x) => x.platform !== p) })} />
                      <label htmlFor={`pf-${p}`} className="flex min-w-[6.5rem] flex-1 items-center gap-1.5 text-sm text-ink"><PlatformIcon p={p} size={18} />{PLATFORM_LABEL[p]}</label>
                      {cur && (
                        <select aria-label={`Số bài mỗi ngày trên ${PLATFORM_LABEL[p]}`} value={cur.postsPerDay} className={cx(inputCls, "w-auto py-1")}
                          onChange={(e) => patch({ platforms: form.platforms.map((x) => (x.platform === p ? { ...x, postsPerDay: Number(e.target.value) } : x)) })}>
                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} bài/ngày</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-ink">Khóa học / sản phẩm xoay vòng</legend>
              <p className="text-xs text-muted">Không chọn = xoay vòng mọi khóa học trong DNA. Lấy từ Mục tiêu & DNA — đổi DNA là lái tự động đổi theo.</p>
              {data.products.length === 0
                ? <p className="mt-2 text-sm text-muted">DNA chưa có khóa học — <Link to="/dna" className="text-blue-600 hover:underline">thêm khóa học</Link>.</p>
                : <div className="mt-2 flex flex-wrap gap-2">
                    {data.products.map((p) => {
                      const sel = form.products.includes(p.key);
                      return (
                        <button key={p.key} type="button" aria-pressed={sel}
                          onClick={() => patch({ products: sel ? form.products.filter((k) => k !== p.key) : [...form.products, p.key] })}
                          className={cx("max-w-full rounded-full border px-3.5 py-2 text-left text-sm transition", sel ? "border-blue-600 bg-blue-600 text-white" : "border-line text-ink hover:border-blue-400")}>
                          <span className="break-words">{p.name}</span>{p.price ? <span className={sel ? "text-white/80" : "text-muted"}> · {p.price.toLocaleString("vi-VN")}đ</span> : null}
                        </button>
                      );
                    })}
                  </div>}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">Giữ sẵn nội dung cho</span>
                <select value={form.cadence} className={inputCls} onChange={(e) => patch({ cadence: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} ngày tới</option>)}
                </select>
                <span className="block text-xs text-muted">Thiếu bài cho số ngày này thì hệ tự mở chiến dịch mới.</span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">Tối đa chiến dịch tự mở mỗi ngày</span>
                <select value={form.maxGoalsPerDay} className={inputCls} onChange={(e) => patch({ maxGoalsPerDay: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} chiến dịch</option>)}
                </select>
                <span className="block text-xs text-muted">Mỗi chiến dịch ra 3 bài/kịch bản — giới hạn để không tốn lượt Claude.</span>
              </label>
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-ink">Video</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {VIDEO_MODES.map((m) => (
                  <label key={m.value} className={cx("cursor-pointer rounded-xl border p-3", form.videoMode === m.value ? "border-blue-500 bg-blue-500/5" : "border-line hover:border-blue-300")}>
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      <input type="radio" name="videoMode" className="accent-blue-600" checked={form.videoMode === m.value} onChange={() => patch({ videoMode: m.value })} />{m.title}
                    </span>
                    <span className="mt-1 block text-xs text-muted">{m.desc}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-ink">Khi Sếp duyệt một bài</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {([["next_slot", "Đăng vào khung giờ đẹp kế tiếp", "Theo khung giờ đăng đã cài (sáng, trưa, tối)."], ["now", "Đăng ngay", "Trừ giờ yên lặng hoặc khi kênh đã đủ số bài tối đa trong ngày."]] as const).map(([v, t, d]) => (
                  <label key={v} className={cx("cursor-pointer rounded-xl border p-3", form.postWhenApproved === v ? "border-blue-500 bg-blue-500/5" : "border-line hover:border-blue-300")}>
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      <input type="radio" name="postWhenApproved" className="accent-blue-600" checked={form.postWhenApproved === v} onChange={() => patch({ postWhenApproved: v })} />{t}
                    </span>
                    <span className="mt-1 block text-xs text-muted">{d}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-4">
              <SwitchRow icon={Telescope} checked={form.useScout} onChange={(v) => patch({ useScout: v })} title="Lấy khuôn đang thắng từ Trinh sát nội dung"
                desc={<>Mỗi chiến dịch mới học 1 khuôn video đối thủ đã Decode (vượt ≥ 2× trung vị kênh) — chỉ học hook/cấu trúc, không chép. Quản lý ở <Link to="/scout" className="text-blue-600 hover:underline">Trinh sát nội dung</Link>.</>} />
              <SwitchRow icon={Zap} checked={form.autoStrategy} onChange={(v) => patch({ autoStrategy: v })} title="Kế hoạch nội dung đạt chấm điểm thì tự chạy tiếp"
                desc="Kế hoạch của lái tự động không có ngân sách quảng cáo. Tắt = mỗi kế hoạch chờ Sếp duyệt như chiến dịch thường." />
              <SwitchRow icon={ShieldCheck} checked={form.approvalGate} onChange={(v) => patch({ approvalGate: v })} title="Mọi bài / kịch bản chờ Sếp duyệt trước khi đăng"
                desc="Nên giữ BẬT. Tắt = bài đạt chấm điểm có thể tự đăng theo mức tự chủ của agent viết bài (trang Agent & Tác vụ)." />
              <SwitchRow icon={Send} checked={form.notifyTelegram} onChange={(v) => patch({ notifyTelegram: v })} title="Báo Sếp qua Telegram (Ngân Nguyệt)"
                desc="Khi mở chiến dịch mới: tên chiến dịch, vì sao chọn khóa học, số mục đang chờ duyệt." />
            </div>

            <p className="flex items-start gap-2 rounded-xl bg-blue-500/5 p-3 text-xs text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              Lái tự động không tự chạy quảng cáo, không tự dùng tín dụng Google Flow, không sửa DNA/giá — các việc đó luôn nằm ở hộp Duyệt chờ Sếp.
              Dừng khẩn cấp đăng bài (Cài đặt) cũng dừng luôn việc mở chiến dịch mới.
            </p>
            {dirty && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" onClick={() => { setForm(data.settings); setDirty(false); }}>Bỏ thay đổi</Button>
                <Button size="sm" variant="primary" icon={Save} loading={busy === "save"} onClick={save}>Lưu cấu hình</Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SwitchRow({ icon: Icon, checked, onChange, title, desc }: { icon: any; checked: boolean; onChange: (v: boolean) => void; title: string; desc: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Toggle checked={checked} onChange={onChange} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink"><Icon className="h-4 w-4 text-blue-500" />{title}</p>
        <p className="text-xs text-muted">{desc}</p>
      </div>
    </div>
  );
}
