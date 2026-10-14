import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, FlaskConical, Layers, Rocket, SlidersHorizontal } from "lucide-react";
import { api, useApi } from "../lib/api";
import { ddmm, hhmm, timeAgo, vndFull, type Tone } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Fold, Loading, Modal, PageHeader, Toggle, cx, inputCls, useToast } from "../components/ui";
import { PlatformNotReady, PlatformTabs, pfLabel, useAdsPlatform, type AdsPf } from "../components/AdsPlatform";
import { QuickAdGoogle } from "../components/QuickAdGoogle";

const FIT_TONE: Record<string, Tone> = { good: "green", ok: "gray", warn: "amber", blocked: "red" };
const OBJ_LABEL: Record<string, string> = { messages: "Tin nhắn", engagement: "Tương tác", sales: "Chuyển đổi", traffic: "Truy cập" };
/** Công thức test mặc định: 1 chiến dịch · 3 nhóm quảng cáo · 3 bài (mỗi nhóm chạy cả 3 bài = 9 quảng cáo). */
const TEST = { adsets: 3, posts: 3 };
const MAX = { adsets: 10, posts: 10 };
type Mode = "test" | "custom";
const ST: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Đang xếp hàng", tone: "blue" }, publishing: { label: "Đang tạo", tone: "violet" }, published: { label: "Đã tạo", tone: "green" }, failed: { label: "Lỗi", tone: "red" },
};

/** Set quảng cáo theo nền tảng: Facebook tạo chiến dịch từ bài Fanpage; Google tạo chiến dịch Search theo mục tiêu; TikTok nói rõ trạng thái. */
export function QuickAd() {
  const [pf, setPf] = useAdsPlatform();
  if (pf === "google_ads") return <QuickAdGoogle tabs={<PlatformTabs value={pf} onChange={setPf} />} />;
  if (pf !== "meta") return (
    <div className="space-y-6">
      <PageHeader title={`Tạo chiến dịch · ${pfLabel(pf)}`} subtitle={`Set quảng cáo ${pfLabel(pf)} từ hệ thống.`} />
      <PlatformTabs value={pf} onChange={setPf} />
      <PlatformNotReady pf={pf as AdsPf} what="tạo chiến dịch" />
    </div>
  );
  return <QuickAdMeta tabs={<PlatformTabs value={pf} onChange={setPf} />} />;
}

function QuickAdMeta({ tabs }: { tabs: ReactNode }) {
  const toast = useToast();
  const { data: opts } = useApi<any>("automation-options", ["alert."]);
  const { data: recent, reload } = useApi<any[]>("ads/quick/recent", ["action.", "approval."]);
  const accounts = (opts?.adAccounts ?? []).filter((a: any) => a.platform === "meta" && a.whitelisted);
  const pages = (opts?.channels ?? []).filter((c: any) => c.platform === "facebook" && c.kind === "page" && c.whitelisted && c.connection_id);
  const [accountId, setAccountId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [posts, setPosts] = useState<any[] | null>(null);
  const [postErr, setPostErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<any[]>([]);
  const [mode, setMode] = useState<Mode>("test");
  const [adsetCount, setAdsetCount] = useState(TEST.adsets);
  const [adsetTpl, setAdsetTpl] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [budget, setBudget] = useState(300_000);
  const [name, setName] = useState("");
  const [startPaused, setStartPaused] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; live: boolean; note?: string; error?: string; offline?: boolean } | "loading" | null>(null);

  useEffect(() => { if (!accountId && accounts[0]) setAccountId(accounts[0].id); }, [accounts, accountId]);
  useEffect(() => { if (!channelId && pages[0]) setChannelId(pages[0].id); }, [pages, channelId]);
  useEffect(() => {
    if (!channelId) return;
    setPosts(null); setSelected([]); setPostErr(null);
    api.get<any[]>(`pages/${channelId}/posts`).then(setPosts).catch((e) => { setPostErr(e.message); setPosts([]); });
  }, [channelId]);

  const metaTemplates = (opts?.templates ?? []).filter((t: any) => t.platform === "meta");
  const tpl = metaTemplates.find((t: any) => t.id === templateId);
  const objective = String(tpl?.definition?.objective ?? "messages");
  const fit = (p: any) => p?.fitness?.[objective === "traffic" ? "" : objective];
  const post = selected[0] ?? null;
  const salesBlocked = objective === "sales" && selected.some((p) => fit(p)?.verdict === "blocked");
  // Mẫu riêng cho từng nhóm chỉ đổi nhắm mục tiêu → chỉ cho chọn mẫu cùng mục tiêu với chiến dịch.
  const sameObjective = metaTemplates.filter((t: any) => String(t.definition?.objective ?? "messages") === objective);
  const nAdsets = mode === "test" ? TEST.adsets : Math.min(MAX.adsets, Math.max(1, adsetCount || 1));
  const postLimit = mode === "test" ? TEST.posts : MAX.posts;
  const totalBudget = budget * nAdsets;
  const nAds = nAdsets * selected.length;
  const ready = mode === "test" ? selected.length === TEST.posts : selected.length >= 1;
  const toggle = (p: any) => setSelected((cur) => cur.some((x) => x.externalId === p.externalId)
    ? cur.filter((x) => x.externalId !== p.externalId)
    : cur.length >= postLimit ? cur : [...cur, p]);
  const pickMode = (m: Mode) => {
    setMode(m);
    if (m === "test") { setAdsetCount(TEST.adsets); setSelected((cur) => cur.slice(0, TEST.posts)); }
  };
  useEffect(() => { setAdsetTpl((cur) => cur.filter((id) => !id || sameObjective.some((t: any) => t.id === id))); }, [objective]); // eslint-disable-line react-hooks/exhaustive-deps
  // ads-os "Kiểm tra trước": Facebook validates the campaign step (validate_only) — nothing is created.
  // Lỗi HTTP không có nội dung JSON (502/503/504, mất kết nối) là máy chủ HỆ THỐNG không trả lời — không phải Facebook từ chối.
  const isOffline = (e: any) => e?.code === "HTTP" || e instanceof TypeError;
  const runCheck = () => {
    if (!post) return;
    setCheck("loading");
    api.post<any>("ads/quick/check", { adAccountId: accountId, channelId, templateId: templateId || null, dailyBudget: budget, postExternalId: post.externalId, name: name || undefined })
      .then(setCheck).catch((e) => setCheck({ ok: false, live: true, error: e.message, offline: isOffline(e) }));
  };
  useEffect(() => {
    if (!confirm || !post) { setCheck(null); return; }
    runCheck();
  }, [confirm]); // eslint-disable-line react-hooks/exhaustive-deps
  // Đang tạo trên Facebook (xếp hàng / đang tạo) → tự tải lại danh sách để thấy kết quả thật, không đứng ở "Đang tạo".
  const pending = (recent ?? []).some((r) => r.status === "approved" || r.status === "publishing");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [pending, reload]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const retry = async (id: string) => {
    setRetrying(id);
    try { await api.post(`ads/quick/${id}/retry`); toast("Đã gửi lệnh tạo lại — cập nhật trạng thái bên dưới"); reload(); }
    catch (e: any) { toast(e.message, "err"); } finally { setRetrying(null); }
  };
  const acc = accounts.find((a: any) => a.id === accountId);
  const page = pages.find((p: any) => p.id === channelId);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post("ads/quick", {
        adAccountId: accountId, channelId, templateId: templateId || null, dailyBudget: budget, mode,
        posts: selected.map((p) => ({ externalId: p.externalId, text: p.text, permalink: p.permalink, kind: p.kind })),
        adsets: Array.from({ length: nAdsets }, (_, i) => ({ dailyBudget: budget, templateId: adsetTpl[i] || null })),
        name: name || undefined, startPaused, confirm: true,
      });
      toast(`Đã gửi lệnh tạo chiến dịch ${nAdsets} nhóm × ${selected.length} bài — cập nhật trạng thái bên dưới sau vài giây`);
      setConfirm(false); setSelected([]); setName("");
      setTimeout(reload, 2500);
    } catch (e: any) {
      toast(isOffline(e) ? `Máy chủ hệ thống không phản hồi (${e.message}) — lệnh CHƯA được gửi, chưa tạo gì trên Facebook. Đợi vài giây rồi bấm lại.` : e.message, "err");
    } finally { setBusy(false); }
  };

  if (opts && (!accounts.length || !pages.length)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Tạo chiến dịch · Facebook" subtitle="Chọn bài trên Fanpage → tạo quảng cáo tin nhắn trong 1 phút." />
        {tabs}
        <Card>
          <div className="py-10 text-center">
            <Rocket className="mx-auto h-10 w-10 text-muted" />
            <p className="mt-3 font-medium text-ink">Cần liên kết Facebook trước</p>
            <p className="mt-1 text-sm text-muted">Cần ít nhất 1 tài khoản quảng cáo Meta và 1 Fanpage nằm trong whitelist.</p>
            <Link to="/ads/integrations?p=meta" className="mt-4 inline-block"><Button variant="primary">Mở Trung tâm tích hợp</Button></Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Tạo chiến dịch · Facebook" subtitle="Chọn một hoặc nhiều bài trên Fanpage → tạo 1 chiến dịch với nhiều nhóm quảng cáo, mỗi nhóm chạy các bài đã chọn. Mặc định test theo công thức 1:3:3. Có trần ngân sách và nhật ký." />
      {tabs}
      {!opts ? <Loading /> : (
        <div className="grid gap-6 wide:grid-cols-[minmax(0,1fr)_380px]">
          <Card title="1. Chọn bài viết" action={<Badge tone={ready ? "green" : "gray"}>Đã chọn {selected.length}/{postLimit}{mode === "test" ? " · cần đúng 3" : ""}</Badge>}>
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <Field label="Fanpage"><select className={inputCls} value={channelId} onChange={(e) => setChannelId(e.target.value)}>{pages.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Tài khoản quảng cáo"><select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}{a.mode === "sandbox" ? " (demo)" : ""}</option>)}</select></Field>
            </div>
            {postErr && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{postErr}</p>}
            {posts?.[0]?.pageNote && <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{posts[0].pageNote}</p>}
            {!posts ? <Loading /> : posts.length === 0 ? <Empty>Fanpage chưa có bài viết.</Empty> : (
              <div className="grid max-h-[560px] gap-3 overflow-y-auto pr-1 scroll-thin sm:grid-cols-2">
                {posts.map((p) => {
                  const idx = selected.findIndex((x) => x.externalId === p.externalId);
                  const on = idx >= 0;
                  const full = !on && selected.length >= postLimit;
                  return (
                  <button key={p.externalId} type="button" onClick={() => toggle(p)} aria-pressed={on} disabled={full} title={full ? `Đã đủ ${postLimit} bài — bỏ chọn một bài để đổi` : undefined}
                    className={cx("relative flex gap-3 rounded-xl border p-3 text-left transition", on ? "border-blue-500 bg-blue-500/[0.04] ring-2 ring-blue-500/20" : "border-line hover:border-blue-300", full && "cursor-not-allowed opacity-50")}>
                    <span className={cx("absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border text-xs font-bold", on ? "border-blue-600 bg-blue-600 text-white" : "border-line-strong bg-card text-transparent")}>{on ? idx + 1 : <Check className="h-3.5 w-3.5" />}</span>
                    {p.image ? <img src={p.image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-soft text-xl">📝</span>}
                    <span className="min-w-0 pr-6"><span className="line-clamp-3 text-sm text-ink">{p.text}</span><span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">{timeAgo(p.createdAt)}{p.engagement != null && <span>· {p.engagement} tương tác</span>}{fit(p) && <span title={fit(p).reason}><Badge tone={FIT_TONE[fit(p).verdict] ?? "gray"}>{OBJ_LABEL[objective]}: {fit(p).label}</Badge></span>}</span></span>
                  </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="2. Thiết lập chiến dịch">
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink">Cấu trúc chiến dịch</p>
                <div role="radiogroup" className="grid grid-cols-2 gap-2">
                  {([["test", FlaskConical, "Test 1:3:3", "1 chiến dịch · 3 nhóm · 3 bài"], ["custom", SlidersHorizontal, "Tự điều chỉnh", "Tự chọn số nhóm và số bài"]] as const).map(([m, Icon, label, hint]) => (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => pickMode(m)}
                      className={cx("flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition", mode === m ? "border-blue-500 bg-blue-500/[0.06] ring-2 ring-blue-500/20" : "border-line hover:border-blue-300")}>
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-blue-600 dark:text-blue-300" />{label}</span>
                      <span className="text-xs text-muted">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              {mode === "custom" && (
                <Field label="Số nhóm quảng cáo" hint={`Mỗi nhóm chạy tất cả bài đã chọn · tối đa ${MAX.adsets} nhóm, ${MAX.posts} bài`}>
                  <input type="number" min={1} max={MAX.adsets} className={inputCls} value={adsetCount} onChange={(e) => setAdsetCount(Math.min(MAX.adsets, Math.max(1, Number(e.target.value) || 1)))} />
                </Field>
              )}
              <Field label="Mẫu quảng cáo (mục tiêu chiến dịch)" hint={metaTemplates.length ? undefined : "Chưa có mẫu — dùng mặc định (tin nhắn, VN, 18–65)."}>
                <select className={inputCls} value={templateId} onChange={(e) => setTemplateId(e.target.value)}><option value="">Mặc định: Tin nhắn Messenger</option>{metaTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              </Field>
              <Field label="Ngân sách/ngày mỗi nhóm (VNĐ)" hint={`${vndFull(budget)} × ${nAdsets} nhóm = ${vndFull(totalBudget)}/ngày`}><input type="number" step={50000} min={50000} className={inputCls} value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></Field>
              <Fold flat title="Nhắm mục tiêu từng nhóm" summary={adsetTpl.slice(0, nAdsets).some(Boolean) ? "Có nhóm dùng mẫu riêng" : "Tất cả theo mẫu chiến dịch"}>
                <p className="mb-2 text-xs text-muted">Test 1:3:3 thường để 3 nhóm 3 tệp khác nhau. Chỉ hiện mẫu cùng mục tiêu với chiến dịch.</p>
                <div className="space-y-2">
                  {Array.from({ length: nAdsets }, (_, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-16 shrink-0 text-muted">Nhóm {i + 1}</span>
                      <select className={cx(inputCls, "min-w-0")} value={adsetTpl[i] ?? ""} onChange={(e) => setAdsetTpl((cur) => { const n = [...cur]; n[i] = e.target.value; return n; })}>
                        <option value="">Theo mẫu chiến dịch</option>
                        {sameObjective.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </Fold>
              <Field label="Tên chiến dịch (tuỳ chọn)" hint="Mặc định: {ngày}_{page}_{số nhóm}nhom_{số bài}bai_{mẫu}"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm"><span><b className="text-ink">Tạo ở trạng thái tạm dừng</b><span className="block text-xs text-muted">An toàn: Sếp kiểm tra trên Ads Manager rồi bật</span></span><Toggle checked={startPaused} onChange={setStartPaused} /></label>
              <div className="flex items-center gap-2.5 rounded-xl bg-soft/70 p-3 text-sm">
                <Layers className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-300" />
                <span className="min-w-0 text-ink">1 chiến dịch · <b>{nAdsets}</b> nhóm · <b>{selected.length || "—"}</b> bài{selected.length ? <> = <b>{nAds}</b> quảng cáo</> : null}</span>
              </div>
              <Button variant="primary" icon={Rocket} className="w-full" disabled={!ready || !accountId} onClick={() => setConfirm(true)}>
                {ready ? `Tạo chiến dịch ${nAdsets} nhóm × ${selected.length} bài` : mode === "test" ? `Chọn đủ 3 bài (đã chọn ${selected.length})` : "Chọn ít nhất 1 bài viết"}
              </Button>
              {mode === "test" && posts && posts.length > 0 && posts.length < TEST.posts && <p className="text-xs text-amber-700 dark:text-amber-300">Fanpage chỉ có {posts.length} bài — chuyển sang "Tự điều chỉnh" để chạy với số bài hiện có.</p>}
            </div>
          </Card>
        </div>
      )}

      <Card title="Chiến dịch tạo nhanh gần đây">
        {!recent ? <Loading /> : recent.length === 0 ? <Empty>Chưa có.</Empty> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">{["Thời gian", "Bài viết", "Fanpage · tài khoản", "Ngân sách", "Trạng thái"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-2 py-2.5 text-xs text-muted">{ddmm(r.created_at)} {hhmm(r.created_at)}</td>
                    <td className="max-w-[280px] px-2 py-2.5"><p className="truncate text-ink">{r.title}</p>{r.options?.structure ? <p className="truncate text-xs text-muted">{r.options.structure.mode === "test" ? "Test 1:3:3 · " : ""}{r.options.structure.adsets?.length} nhóm × {r.options.structure.postIds?.length} bài</p> : r.ad_name && <p className="truncate text-xs text-muted">{r.ad_name}</p>}</td>
                    <td className="px-2 py-2.5 text-xs text-muted">{r.page} · {r.account}</td>
                    <td className="px-2 py-2.5 tabular-nums">{vndFull(r.daily_budget)}</td>
                    <td className="px-2 py-2.5"><Badge tone={ST[r.status]?.tone ?? "gray"}>{ST[r.status]?.label ?? r.status}</Badge>{r.status === "published" && <span className="ml-1 text-xs text-muted">{r.ad_status === "paused" ? "· đang tạm dừng" : "· đang chạy"}</span>}{r.decision_note && <p className="mt-1 text-xs text-rose-500">{r.decision_note}</p>}{r.status === "failed" && <Button size="sm" variant="soft" className="mt-1.5" loading={retrying === r.id} onClick={() => retry(r.id)}>Tạo lại</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Xác nhận tạo chiến dịch"
        footer={<><Button onClick={() => setConfirm(false)}>Hủy</Button><Button variant="primary" icon={Rocket} loading={busy} disabled={salesBlocked} onClick={submit}>Xác nhận tạo</Button></>}>
        {post && (
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              {selected.map((p, i) => (
                <div key={p.externalId} className="flex items-start gap-2 rounded-xl bg-soft p-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue-600 text-[11px] font-bold text-white">{i + 1}</span>
                  <p className="line-clamp-2 min-w-0 flex-1 text-ink">{p.text}</p>
                  {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="shrink-0 text-blue-600" aria-label="Xem bài"><ExternalLink className="h-3.5 w-3.5" /></a>}
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-muted">Fanpage</dt><dd className="text-ink">{page?.name}</dd>
              <dt className="text-muted">Tài khoản</dt><dd className="text-ink">{acc?.name}{acc?.mode === "sandbox" && <Badge tone="amber" className="ml-1">demo</Badge>}</dd>
              <dt className="text-muted">Cấu trúc</dt><dd className="text-ink">{mode === "test" ? "Test 1:3:3 · " : ""}{nAdsets} nhóm × {selected.length} bài = {nAds} quảng cáo</dd>
              <dt className="text-muted">Ngân sách/ngày</dt><dd className="font-semibold text-ink">{vndFull(budget)}/nhóm · tổng {vndFull(totalBudget)}</dd>
              <dt className="text-muted">Trạng thái khi tạo</dt><dd className="text-ink">{startPaused ? "Tạm dừng" : "Chạy ngay"}</dd>
              <dt className="text-muted">Mục tiêu</dt><dd className="text-ink">{OBJ_LABEL[objective] ?? objective}</dd>
            </dl>
            {selected.filter((p) => fit(p) && ["warn", "blocked"].includes(fit(p).verdict)).map((p) => <p key={p.externalId} className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">Bài {selected.indexOf(p) + 1}: {fit(p).reason}</p>)}
            {check === "loading" && <p className="rounded-xl bg-soft p-3 text-xs text-muted">Đang nhờ Facebook kiểm tra trước (không tạo gì)…</p>}
            {check && check !== "loading" && check.live && (check.ok
              ? <p className="rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">{check.note}</p>
              : check.offline
                ? <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"><span className="min-w-0 flex-1 basis-56">Chưa kiểm tra được: máy chủ hệ thống không phản hồi ({check.error}), có thể đang khởi động lại. Facebook chưa nhận gì.</span><Button size="sm" onClick={runCheck}>Kiểm tra lại</Button></div>
                : <div className="flex flex-wrap items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300"><span className="min-w-0 flex-1 basis-56 whitespace-pre-line">Facebook từ chối: {check.error}</span><Button size="sm" onClick={runCheck}>Kiểm tra lại</Button></div>)}
            {acc?.mode === "live" && !startPaused && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-700 dark:text-rose-300">Quảng cáo sẽ chạy và tiêu tiền thật ngay khi tạo xong.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
