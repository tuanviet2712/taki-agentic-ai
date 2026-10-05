import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, Globe as Chrome, KeyRound, Loader2, LogIn, MonitorCheck, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, PlatformIcon, cx, inputCls, useToast } from "../components/ui";
import { BrowserPicker } from "./VideoFlow";

// Ported from AI Affiliate OS "Kênh đăng". No simulated route: a channel either posts for real (API / Chrome) or the
// post is refused with the reason.
const ROUTE: Record<string, [string, any, string]> = {
  api: ["Đăng thật qua API", "green", "Dùng token Trang đã nối ở Trung tâm tích hợp."],
  browser: ["Đăng thật qua Chrome", "blue", "Agent điều khiển Chrome Flow (mang đăng nhập của Sếp) để đăng."],
  none: ["Chưa đăng được", "amber", "Chưa liên kết API và chưa thiết lập Chrome — bài duyệt xong sẽ báo CHƯA đăng."],
};
const API_HINT: Record<string, string> = {
  facebook: "Dán token System User (có pages_manage_posts) ở Trung tâm tích hợp → Facebook: hệ thống tự lấy các Fanpage và đăng chữ, ảnh, video, bản nháp video qua API.",
  instagram: "Chưa có đường API trong hệ thống này — dùng Cách 2 · Đăng qua Chrome.",
  tiktok: "API đăng TikTok cần app được TikTok duyệt — dùng Cách 2 · Đăng qua Chrome.",
};
const PLATFORMS = [["facebook", "Facebook (Fanpage)"], ["tiktok", "TikTok"], ["instagram", "Instagram"]] as const;

export function Channels() {
  const { data, reload, loading } = useApi<any>("publish-channels", ["alert.", "post."]);
  const settings = useApi<any>("creative/settings");
  const [pick, setPick] = useState(false);
  const [add, setAdd] = useState<null | { platform: string; name: string; profileUrl: string }>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (loading && !data) return <Loading />;
  const chromeOk = Boolean(data?.chrome?.profile);
  const save = async () => {
    if (!add) return;
    setBusy(true);
    try { await api.post("publish-channels", add); toast(`Đã thêm kênh ${add.name}`); setAdd(null); reload(); }
    catch (e: any) { toast(e.details?.[0]?.message ?? e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Kênh đăng" subtitle="Mỗi kênh đăng thật bằng API (token) nếu liên kết được; không được thì agent đăng bằng Chrome Sếp đã đăng nhập. Bài vẫn phải qua hộp Duyệt trước khi lên kênh. Không có chế độ mô phỏng."
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdd({ platform: "tiktok", name: "", profileUrl: "" })}>Thêm kênh</Button>} />

      <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Cách 1 · Liên kết API (Facebook Fanpage)</span>}>
        <p className="text-sm text-muted">Vào <Link to="/ads/integrations?p=meta" className="font-medium text-ink underline">Trung tâm tích hợp → Facebook</Link>, dán <b>token System User</b> (Business Manager → Người dùng hệ thống → Tạo mã, tick pages_manage_posts, pages_read_engagement, pages_manage_engagement, pages_messaging). Các Fanpage được gán sẽ tự hiện bên dưới với nhãn "Đăng thật qua API".</p>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Chrome className="h-4 w-4" />Chrome dùng để đăng (Chrome Flow — chung với Sản xuất video)</span>}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Step n={1} done={chromeOk} />
          <span>{chromeOk ? <>Đang dùng profile <b>{data.chrome.name ?? data.chrome.profile}</b>{data.chrome.email ? ` (${data.chrome.email})` : ""}</> : "Chưa chọn Chrome"}</span>
          <Button size="sm" onClick={() => setPick(true)}>{chromeOk ? "Quét & đổi Chrome" : "Quét & chọn Chrome"}</Button>
          {!data?.chrome?.claudeCli && <Badge tone="amber">Cần Claude Code CLI đã đăng nhập (Cài đặt → Model Claude)</Badge>}
        </div>
        <p className="mt-2 text-xs text-muted">Hệ thống quét các profile Chrome trên máy; profile được chọn được chép đăng nhập sang <b>Chrome Flow</b> (cửa sổ Chrome riêng, cất ở mép màn hình). Agent chỉ thao tác trong tab mới của Chrome Flow, không bao giờ gõ mật khẩu, không đụng Chrome Sếp đang dùng.</p>
      </Card>

      {!data?.channels?.length ? <Empty>Chưa có kênh nào — nối Facebook ở Trung tâm tích hợp (Cách 1) hoặc bấm "Thêm kênh" để đăng qua Chrome.</Empty> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.channels.filter((c: any) => c.enabled).map((c: any) => <ChannelCard key={c.id} c={c} chromeOk={chromeOk && data.chrome.claudeCli} onChange={reload} />)}
        </div>
      )}

      <BrowserPicker open={pick} current={settings.data} onClose={() => setPick(false)} onSaved={() => { setPick(false); reload(); settings.reload(); }} />
      <Modal open={!!add} onClose={() => setAdd(null)} title="Thêm kênh đăng qua Chrome"
        footer={<><Button onClick={() => setAdd(null)}>Huỷ</Button><Button variant="primary" loading={busy} disabled={!add?.name.trim()} onClick={save}>Thêm</Button></>}>
        {add && (
          <div className="space-y-3">
            <Field label="Nền tảng"><select className={inputCls} value={add.platform} onChange={(e) => setAdd({ ...add, platform: e.target.value })}>{PLATFORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Tên kênh" hint="Đúng tên hiển thị của trang / tài khoản"><input autoFocus className={inputCls} value={add.name} maxLength={80} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="VD: @takiacademy" /></Field>
            <Field label="Địa chỉ trang (tuỳ chọn)" hint="Giúp agent mở đúng trang khi đăng"><input className={inputCls} value={add.profileUrl} onChange={(e) => setAdd({ ...add, profileUrl: e.target.value })} placeholder="https://www.tiktok.com/@takiacademy" /></Field>
            <p className="text-xs text-muted">Fanpage có token API thì không cần thêm tay — nối ở Trung tâm tích hợp là tự hiện.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ChannelCard({ c, chromeOk, onChange }: { c: any; chromeOk: boolean; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const route = ROUTE[c.route] ?? ROUTE.none;
  const run = async (k: string, fn: () => Promise<any>) => { setBusy(k); try { await fn(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); } };

  const openLogin = () => run("open", async () => {
    await api.post(`publish-channels/${c.id}/open-login`);
    setOpened(true);
    toast("Đã mở trang đăng nhập trong Chrome Flow — Sếp tự đăng nhập, xong quay lại bấm Kiểm tra", "info");
  });
  const check = () => run("check", async () => {
    const r = await api.post<any>(`publish-channels/${c.id}/check-login`);
    toast(r.loggedIn && r.canPost ? `Đã đăng nhập: ${r.account}` : `Chưa sẵn sàng: ${r.notes || "chưa đăng nhập"}`, r.loggedIn && r.canPost ? "ok" : "err");
    onChange();
  });
  const setVia = (via: string) => run(`via:${via}`, async () => { await api.put(`publish-channels/${c.id}/via`, { via }); onChange(); });
  const remove = () => run("del", async () => { await api.del(`publish-channels/${c.id}`); toast(`Đã gỡ kênh ${c.name}`); onChange(); });

  return (
    <Card>
      <div className="flex items-start gap-3">
        <PlatformIcon p={c.platform} size={32} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{c.name}</p>
          <p className="text-xs text-muted">{c.platform} · {c.kind}{c.connection ? ` · kết nối ${c.connection.mode === "live" ? "API thật" : "demo"}` : " · thêm tay"}</p>
        </div>
        <Badge tone={route[1]}>{route[0]}</Badge>
        {!c.connection && <button onClick={remove} disabled={busy !== null} className="rounded-md p-1 text-muted hover:text-rose-600" title="Gỡ kênh" aria-label={`Gỡ ${c.name}`}><Trash2 className="h-4 w-4" /></button>}
      </div>
      <p className="mt-2 text-xs text-muted">{c.route === "none" ? c.reason : route[2]}</p>

      <div className="mt-4 rounded-md border border-line p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-ink"><KeyRound className="h-4 w-4" />Liên kết API {c.api && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}</p>
        {c.api ? <p className="mt-1 text-xs text-muted">Đã liên kết — bài duyệt xong sẽ đăng thẳng qua API (chữ, ảnh, video; video duyệt xong lên bản nháp Trang).</p>
          : <p className="mt-1 text-xs text-muted">{API_HINT[c.platform] ?? "Kênh này chưa có API đăng bài."}{c.connection?.status === "expired" ? <b className="text-rose-600"> Token hết hạn — dán token mới.</b> : ""}</p>}
      </div>

      {c.browserSupported && (
        <div className="mt-3 rounded-md border border-line p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-ink"><Chrome className="h-4 w-4" />Cách 2 · Đăng qua Chrome {c.ready.ok && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}</p>
          <p className="mt-1 text-xs text-muted">Dùng khi không liên kết được API (chưa có token, app chưa được duyệt…).</p>
          <ol className="mt-3 space-y-2 text-sm">
            <li className="flex items-center gap-2"><Step n={1} done={chromeOk} /><span className="flex-1">Chọn Chrome (ở trên)</span></li>
            <li className="flex flex-wrap items-center gap-2"><Step n={2} done={opened || Boolean(c.browser.loggedIn)} /><span className="min-w-0 flex-1 basis-40">Mở trang đăng nhập trong Chrome Flow</span>
              <Button size="sm" icon={ExternalLink} loading={busy === "open"} disabled={!chromeOk} onClick={openLogin}>Mở Chrome</Button></li>
            <li className="flex items-center gap-2"><Step n={3} done={Boolean(c.browser.loggedIn)} /><span className="flex-1">Sếp <b>tự đăng nhập</b> tài khoản quản lý kênh (hệ thống không bao giờ hỏi mật khẩu)</span><LogIn className="h-4 w-4 text-muted" /></li>
            <li className="flex flex-wrap items-center gap-2"><Step n={4} done={Boolean(c.browser.loggedIn)} /><span className="min-w-0 flex-1 basis-40">Agent kiểm tra đăng nhập & quyền đăng</span>
              <Button size="sm" variant="primary" icon={busy === "check" ? Loader2 : MonitorCheck} disabled={!chromeOk || busy === "check"} onClick={check}>{busy === "check" ? "Đang kiểm tra (~1–2 phút)…" : "Kiểm tra"}</Button></li>
          </ol>
          {c.browser.checkedAt && (
            <p className={cx("mt-2 rounded-md p-2 text-xs", c.browser.loggedIn ? "bg-soft text-ink" : "bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
              {c.browser.loggedIn ? `Sẵn sàng · ${c.browser.account}` : "Chưa sẵn sàng"}{c.browser.notes ? ` — ${c.browser.notes}` : ""} · kiểm tra {timeAgo(c.browser.checkedAt)}
            </p>
          )}
          {!c.ready.ok && c.ready.reason && <p className="mt-1 text-xs text-muted">{c.ready.reason}</p>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <ShieldCheck className="h-3.5 w-3.5 text-muted" /><span className="text-muted">Cách đăng:</span>
        {[["auto", "Tự động (API → Chrome)"], ...(c.browserSupported ? [["browser", "Luôn qua Chrome"]] : [])].map(([v, l]) => (
          <button key={v} onClick={() => setVia(v)} disabled={busy !== null} className={cx("rounded-md border px-2 py-1", c.publishVia === v ? "border-blue-500/60 bg-blue-500/10 font-medium text-blue-700 dark:text-blue-300" : "border-line text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>
    </Card>
  );
}

function Step({ n, done }: { n: number; done: boolean }) {
  return <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold", done ? "bg-emerald-500 text-white" : "border border-line text-muted")}>{done ? "✓" : n}</span>;
}
