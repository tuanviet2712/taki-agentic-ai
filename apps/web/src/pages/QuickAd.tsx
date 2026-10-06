import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Rocket } from "lucide-react";
import { api, useApi } from "../lib/api";
import { ddmm, hhmm, timeAgo, vndFull, type Tone } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, Toggle, cx, inputCls, useToast } from "../components/ui";
import { PlatformNotReady, PlatformTabs, pfLabel, useAdsPlatform, type AdsPf } from "../components/AdsPlatform";

const FIT_TONE: Record<string, Tone> = { good: "green", ok: "gray", warn: "amber", blocked: "red" };
const OBJ_LABEL: Record<string, string> = { messages: "Tin nhắn", engagement: "Tương tác", sales: "Chuyển đổi", traffic: "Truy cập" };
const ST: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Đang xếp hàng", tone: "blue" }, publishing: { label: "Đang tạo", tone: "violet" }, published: { label: "Đã tạo", tone: "green" }, failed: { label: "Lỗi", tone: "red" },
};

/** Set quảng cáo theo nền tảng: Facebook tạo chiến dịch từ bài Fanpage; TikTok / Google nói rõ trạng thái. */
export function QuickAd() {
  const [pf, setPf] = useAdsPlatform();
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
  const [post, setPost] = useState<any | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [budget, setBudget] = useState(1_000_000);
  const [name, setName] = useState("");
  const [startPaused, setStartPaused] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; live: boolean; note?: string; error?: string } | "loading" | null>(null);

  useEffect(() => { if (!accountId && accounts[0]) setAccountId(accounts[0].id); }, [accounts, accountId]);
  useEffect(() => { if (!channelId && pages[0]) setChannelId(pages[0].id); }, [pages, channelId]);
  useEffect(() => {
    if (!channelId) return;
    setPosts(null); setPost(null); setPostErr(null);
    api.get<any[]>(`pages/${channelId}/posts`).then(setPosts).catch((e) => { setPostErr(e.message); setPosts([]); });
  }, [channelId]);

  const tpl = (opts?.templates ?? []).find((t: any) => t.id === templateId);
  const objective = String(tpl?.definition?.objective ?? "messages");
  const fit = (p: any) => p?.fitness?.[objective === "traffic" ? "" : objective];
  const salesBlocked = objective === "sales" && fit(post)?.verdict === "blocked";
  // ads-os "Kiểm tra trước": Facebook validates the campaign step (validate_only) — nothing is created.
  useEffect(() => {
    if (!confirm || !post) { setCheck(null); return; }
    setCheck("loading");
    api.post<any>("ads/quick/check", { adAccountId: accountId, channelId, templateId: templateId || null, dailyBudget: budget, postExternalId: post.externalId, name: name || undefined })
      .then(setCheck).catch((e) => setCheck({ ok: false, live: true, error: e.message }));
  }, [confirm]); // eslint-disable-line react-hooks/exhaustive-deps
  const acc = accounts.find((a: any) => a.id === accountId);
  const page = pages.find((p: any) => p.id === channelId);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post("ads/quick", { adAccountId: accountId, channelId, templateId: templateId || null, dailyBudget: budget, post: { externalId: post.externalId, text: post.text, permalink: post.permalink, kind: post.kind }, name: name || undefined, startPaused, confirm: true });
      toast("Đã gửi lệnh tạo quảng cáo — cập nhật trạng thái bên dưới sau vài giây");
      setConfirm(false); setPost(null); setName("");
      setTimeout(reload, 2500);
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
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
      <PageHeader title="Tạo chiến dịch · Facebook" subtitle="Chọn bài trên Fanpage → tạo chiến dịch + nhóm + quảng cáo từ bài viết theo mẫu. Có trần ngân sách và nhật ký." />
      {tabs}
      {!opts ? <Loading /> : (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <Card title="1. Chọn bài viết">
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <Field label="Fanpage"><select className={inputCls} value={channelId} onChange={(e) => setChannelId(e.target.value)}>{pages.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Tài khoản quảng cáo"><select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}{a.mode === "sandbox" ? " (demo)" : ""}</option>)}</select></Field>
            </div>
            {postErr && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{postErr}</p>}
            {posts?.[0]?.pageNote && <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{posts[0].pageNote}</p>}
            {!posts ? <Loading /> : posts.length === 0 ? <Empty>Fanpage chưa có bài viết.</Empty> : (
              <div className="grid max-h-[560px] gap-3 overflow-y-auto pr-1 scroll-thin sm:grid-cols-2">
                {posts.map((p) => (
                  <button key={p.externalId} onClick={() => setPost(p)} className={cx("flex gap-3 rounded-xl border p-3 text-left transition", post?.externalId === p.externalId ? "border-blue-500 ring-2 ring-blue-500/20" : "border-line hover:border-blue-300")}>
                    {p.image ? <img src={p.image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-soft text-xl">📝</span>}
                    <span className="min-w-0"><span className="line-clamp-3 text-sm text-ink">{p.text}</span><span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">{timeAgo(p.createdAt)}{p.engagement != null && <span>· {p.engagement} tương tác</span>}{fit(p) && <span title={fit(p).reason}><Badge tone={FIT_TONE[fit(p).verdict] ?? "gray"}>{OBJ_LABEL[objective]}: {fit(p).label}</Badge></span>}</span></span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="2. Thiết lập quảng cáo">
            <div className="space-y-4">
              <Field label="Mẫu quảng cáo" hint={(opts.templates ?? []).length ? undefined : "Chưa có mẫu — dùng mặc định (tin nhắn, VN, 18–65)."}>
                <select className={inputCls} value={templateId} onChange={(e) => setTemplateId(e.target.value)}><option value="">Mặc định: Tin nhắn Messenger</option>{(opts.templates ?? []).filter((t: any) => t.platform === "meta").map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              </Field>
              <Field label="Ngân sách/ngày (VNĐ)" hint={vndFull(budget)}><input type="number" step={100000} min={50000} className={inputCls} value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></Field>
              <Field label="Tên quảng cáo (tuỳ chọn)" hint="Mặc định: {ngày}_{page}_{postId}_{mẫu}"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm"><span><b className="text-ink">Tạo ở trạng thái tạm dừng</b><span className="block text-xs text-muted">An toàn: Sếp kiểm tra trên Ads Manager rồi bật</span></span><Toggle checked={startPaused} onChange={setStartPaused} /></label>
              <Button variant="primary" icon={Rocket} className="w-full" disabled={!post || !accountId} onClick={() => setConfirm(true)}>{post ? "Tạo quảng cáo" : "Chọn 1 bài viết trước"}</Button>
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
                    <td className="max-w-[280px] px-2 py-2.5"><p className="truncate text-ink">{r.title}</p>{r.ad_name && <p className="truncate text-xs text-muted">{r.ad_name}</p>}</td>
                    <td className="px-2 py-2.5 text-xs text-muted">{r.page} · {r.account}</td>
                    <td className="px-2 py-2.5 tabular-nums">{vndFull(r.daily_budget)}</td>
                    <td className="px-2 py-2.5"><Badge tone={ST[r.status]?.tone ?? "gray"}>{ST[r.status]?.label ?? r.status}</Badge>{r.status === "published" && <span className="ml-1 text-xs text-muted">{r.ad_status === "paused" ? "· đang tạm dừng" : "· đang chạy"}</span>}{r.decision_note && <p className="mt-1 text-xs text-rose-500">{r.decision_note}</p>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Xác nhận tạo quảng cáo"
        footer={<><Button onClick={() => setConfirm(false)}>Hủy</Button><Button variant="primary" icon={Rocket} loading={busy} disabled={salesBlocked} onClick={submit}>Xác nhận tạo</Button></>}>
        {post && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-soft p-3"><p className="line-clamp-3 text-ink">{post.text}</p>{post.permalink && <a href={post.permalink} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600">Xem bài <ExternalLink className="h-3 w-3" /></a>}</div>
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-muted">Fanpage</dt><dd className="text-ink">{page?.name}</dd>
              <dt className="text-muted">Tài khoản</dt><dd className="text-ink">{acc?.name}{acc?.mode === "sandbox" && <Badge tone="amber" className="ml-1">demo</Badge>}</dd>
              <dt className="text-muted">Ngân sách/ngày</dt><dd className="font-semibold text-ink">{vndFull(budget)}</dd>
              <dt className="text-muted">Trạng thái khi tạo</dt><dd className="text-ink">{startPaused ? "Tạm dừng" : "Chạy ngay"}</dd>
              <dt className="text-muted">Mục tiêu</dt><dd className="text-ink">{OBJ_LABEL[objective] ?? objective}{fit(post) ? ` · ${fit(post).label}` : ""}</dd>
            </dl>
            {fit(post) && fit(post).verdict !== "ok" && <p className={cx("rounded-xl p-3 text-xs", fit(post).verdict === "good" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300")}>{fit(post).reason}</p>}
            {check === "loading" && <p className="rounded-xl bg-soft p-3 text-xs text-muted">Đang nhờ Facebook kiểm tra trước (không tạo gì)…</p>}
            {check && check !== "loading" && check.live && (check.ok
              ? <p className="rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">{check.note}</p>
              : <p className="whitespace-pre-line rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">Facebook từ chối: {check.error}</p>)}
            {acc?.mode === "live" && !startPaused && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-700 dark:text-rose-300">Quảng cáo sẽ chạy và tiêu tiền thật ngay khi tạo xong.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
