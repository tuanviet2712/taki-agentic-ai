import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Globe as Chrome, KeyRound, Loader2, LogIn, MonitorCheck, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, PlatformIcon, Toggle, cx, inputCls, useToast, Fold } from "../components/ui";
import { BrowserEngineControl, BrowserPicker } from "./VideoFlow";

// Ported from AI Affiliate OS "Kênh đăng". No simulated route: a channel either posts for real (API / Chrome) or the
// post is refused with the reason.
const ROUTE: Record<string, [string, any, string]> = {
  api: ["Đăng thật qua API", "green", "Dùng token Trang đã nối ở Trung tâm tích hợp."],
  browser: ["Đăng thật qua Chrome", "blue", "Agent điều khiển Chrome Flow (mang đăng nhập của Sếp) để đăng."],
  none: ["Chưa đăng được", "amber", "Chưa liên kết API và chưa thiết lập Chrome — bài duyệt xong sẽ báo CHƯA đăng."],
};
const API_HINT: Record<string, string> = {
  facebook: "Đăng nhập Facebook bằng nút (Cách 1) hoặc dán token System User (có pages_manage_posts) ở Trung tâm tích hợp → Facebook: hệ thống tự lấy các Fanpage và đăng chữ, ảnh, video, bản nháp video qua API.",
  instagram: "Instagram không cần đăng nhập riêng: nối Facebook (nút đăng nhập, hoặc token System User có instagram_basic + instagram_content_publish) — tài khoản Instagram Business gắn với Trang tự hiện ở đây. Đăng ảnh/Reels qua API cần địa chỉ công khai (PUBLIC_BASE_URL + PUBLIC_PORT) để Instagram tải media; chưa có thì đăng qua Chrome.",
  tiktok: "Bấm \"Kết nối TikTok\" ở Cách 1: bản nháp video gửi vào hộp thư TikTok qua API (app chưa được duyệt vẫn dùng được). Đăng CÔNG KHAI qua API chỉ khi app đã được TikTok duyệt — chưa duyệt thì dùng Cách 2 · Đăng qua Chrome.",
  website: "Bấm \"Thêm kênh\" → Website (WordPress), nhập địa chỉ website + tên đăng nhập + mật khẩu ứng dụng: bài SEO đã duyệt tự đăng lên website (ảnh trong bài có alt, ảnh đại diện, mô tả ngắn, đường dẫn theo từ khoá).",
};
const PLATFORMS = [["facebook", "Facebook (Fanpage)"], ["tiktok", "TikTok"], ["instagram", "Instagram"], ["website", "Website (WordPress) — đăng bài SEO"]] as const;
type AddForm = { platform: string; name: string; profileUrl: string; siteUrl: string; username: string; appPassword: string; postStatus: string; categoryId: string };
const NEW_CHANNEL: AddForm = { platform: "tiktok", name: "", profileUrl: "", siteUrl: "", username: "", appPassword: "", postStatus: "publish", categoryId: "" };

export function Channels() {
  const { data, reload, loading } = useApi<any>("publish-channels", ["alert.", "post."]);
  const settings = useApi<any>("creative/settings");
  const [pick, setPick] = useState(false);
  const [add, setAdd] = useState<null | AddForm>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Quay về sau khi đăng nhập Facebook / TikTok: ?connected=facebook&name=… hoặc ?oauth_error=…
  const [qs, setQs] = useSearchParams();
  useEffect(() => {
    const ok = qs.get("connected"), err = qs.get("oauth_error"), warn = qs.get("warn");
    if (!ok && !err) return;
    if (ok) toast(`Đã kết nối ${ok === "facebook" ? "Facebook" : "TikTok"}: ${qs.get("name") ?? ""}${warn ? ` — ${warn}` : ""}`, warn ? "info" : "ok");
    else toast(err!, "err");
    setQs({}, { replace: true });
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);
  if (loading && !data) return <Loading />;
  const chromeOk = Boolean(data?.chrome?.profile);
  const isWeb = add?.platform === "website";
  const save = async () => {
    if (!add) return;
    setBusy(true);
    try {
      if (isWeb) {
        // Website WordPress: kết nối bằng mật khẩu ứng dụng (lưu mã hoá) → hệ thống kiểm tra quyền và tự tạo kênh "website".
        const c = await api.post<any>("connections", { platform: "wordpress", mode: "live", name: add.name.trim() || undefined, credentials: { app_password: add.appPassword },
          config: { site_url: add.siteUrl.trim(), username: add.username.trim(), post_status: add.postStatus, ...(add.categoryId.trim() ? { category_id: add.categoryId.trim() } : {}) } });
        toast(`Đã kết nối ${c.display_name} — bài SEO đã duyệt sẽ tự đăng lên website`);
      } else {
        const c = await api.post<any>("publish-channels", { platform: add.platform, name: add.name, profileUrl: add.profileUrl });
        toast(`Đã thêm kênh ${add.name}${c?.isDefault ? " (kênh đăng chính)" : ""} — bấm Kiểm tra ở thẻ kênh để agent xác nhận quyền đăng`);
      }
      setAdd(null); reload();
    }
    catch (e: any) { toast(e.details?.[0]?.message ?? e.message, "err"); } finally { setBusy(false); }
  };
  const canSave = isWeb ? Boolean(add?.siteUrl.trim() && add?.username.trim() && add?.appPassword.trim()) : Boolean(add?.name.trim() && add?.profileUrl.trim());
  return (
    <div className="space-y-6">
      <PageHeader title="Kênh đăng" subtitle="Mỗi kênh đăng thật bằng API (token) nếu liên kết được; không được thì agent đăng bằng Chrome Sếp đã đăng nhập. Bài vẫn phải qua hộp Duyệt trước khi lên kênh. Không có chế độ mô phỏng."
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdd({ ...NEW_CHANNEL })}>Thêm kênh</Button>} />

      <OAuthCard encryptionKey={data?.encryptionKey !== false} pub={data?.public} onChanged={reload} />
      <BrowserEngineControl current={settings.data} onSaved={() => { settings.reload(); reload(); }} />

      <Card title={<span className="flex items-center gap-2"><Chrome className="h-4 w-4" />Chrome dùng để đăng ({settings.data?.engine === "claude-in-chrome" ? "Claude in Chrome" : "Chrome Flow"})</span>}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Step n={1} done={chromeOk} />
          <span>{chromeOk ? <>Đang dùng profile <b>{data.chrome.name ?? data.chrome.profile}</b>{data.chrome.email ? ` (${data.chrome.email})` : ""}</> : "Chưa chọn Chrome"}</span>
          <Button size="sm" onClick={() => setPick(true)}>{chromeOk ? "Quét & đổi Chrome" : "Quét & chọn Chrome"}</Button>
          {!data?.chrome?.claudeCli && <Badge tone="amber">Cần Claude Code CLI đã đăng nhập (Cài đặt → Model Claude)</Badge>}
        </div>
        <p className="mt-2 text-xs text-muted">{settings.data?.engine === "claude-in-chrome" ? "AI thao tác trong tab mới của profile đã ghép với tiện ích Claude. Mở profile này, ghép Chrome rồi kiểm tra đăng nhập từng kênh." : "Đăng nhập của profile được nối vào Chrome Flow. Agent thao tác trong tab mới của cửa sổ Chrome riêng."}</p>
      </Card>

      {!data?.channels?.length ? <Empty>Chưa có kênh nào — nối Facebook ở Trung tâm tích hợp (Cách 1) hoặc bấm "Thêm kênh" để đăng qua Chrome.</Empty> : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {/* Kênh đang bật trước, kênh đã tắt (mờ, bấm "Bật kênh" để dùng lại) sau; kênh đã gỡ không hiện. */}
          {[...data.channels.filter((c: any) => c.enabled), ...data.channels.filter((c: any) => !c.enabled && !c.removed)].map((c: any) => (
            <ChannelCard key={c.id} c={c} chromeOk={chromeOk && data.chrome.claudeCli} siblings={data.channels.filter((o: any) => o.platform === c.platform && o.enabled).length} onChange={reload} />
          ))}
        </div>
      )}

      <BrowserPicker open={pick} current={settings.data} onClose={() => setPick(false)} onSaved={() => { setPick(false); reload(); settings.reload(); }} />
      <Modal open={!!add} onClose={() => setAdd(null)} title={isWeb ? "Kết nối website WordPress" : "Thêm kênh đăng qua Chrome"}
        footer={<><Button onClick={() => setAdd(null)}>Huỷ</Button><Button variant="primary" loading={busy} disabled={!canSave} onClick={save}>{isWeb ? "Kiểm tra & kết nối" : "Thêm"}</Button></>}>
        {add && (
          <div className="space-y-3">
            <Field label="Nền tảng"><select className={inputCls} value={add.platform} onChange={(e) => setAdd({ ...add, platform: e.target.value })}>{PLATFORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            {isWeb ? <WordpressFields add={add} setAdd={setAdd} encryptionKey={data?.encryptionKey !== false} /> : <>
            <Field label="Tên kênh" hint="Đúng tên hiển thị của trang / tài khoản"><input autoFocus className={inputCls} value={add.name} maxLength={120} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="VD: @takiacademy" /></Field>
            <Field label="Link trang / tài khoản" hint="Bắt buộc — agent mở đúng trang này để đăng, và hệ thống không thêm trùng cùng 1 trang"><input className={inputCls} value={add.profileUrl} maxLength={500} onChange={(e) => setAdd({ ...add, profileUrl: e.target.value })} placeholder={add.platform === "facebook" ? "https://www.facebook.com/takiacademy" : add.platform === "instagram" ? "https://www.instagram.com/takiacademy" : "https://www.tiktok.com/@takiacademy"} /></Field>
            <p className="text-xs text-muted">Kênh đầu tiên của mỗi nền tảng là <b>kênh đăng chính</b> (bài duyệt xong đăng vào đó); đổi ở thẻ kênh. Fanpage có token API thì không cần thêm tay — nối ở Trung tâm tích hợp là tự hiện.</p>
            </>}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Website WordPress: địa chỉ + tài khoản + mật khẩu ứng dụng (REST API lõi, không cần plugin). */
function WordpressFields({ add, setAdd, encryptionKey }: { add: AddForm; setAdd: (a: AddForm) => void; encryptionKey: boolean }) {
  return (
    <>
      <Field label="Địa chỉ website" hint="Trang chủ website, dùng https://"><input autoFocus className={inputCls} value={add.siteUrl} maxLength={300} onChange={(e) => setAdd({ ...add, siteUrl: e.target.value })} placeholder="https://taki.vn" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tên đăng nhập WordPress" hint="Vai trò Tác giả trở lên"><input className={inputCls} value={add.username} maxLength={120} autoComplete="off" onChange={(e) => setAdd({ ...add, username: e.target.value })} placeholder="admin" /></Field>
        <Field label="Mật khẩu ứng dụng" hint="KHÔNG phải mật khẩu đăng nhập"><input type="password" className={inputCls} value={add.appPassword} maxLength={200} autoComplete="new-password" onChange={(e) => setAdd({ ...add, appPassword: e.target.value })} placeholder="abcd EFGH 1234 ijkl MNOP 5678" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Đăng bài ở trạng thái">
          <select className={inputCls} value={add.postStatus} onChange={(e) => setAdd({ ...add, postStatus: e.target.value })}>
            <option value="publish">Công khai ngay (đã qua hộp Duyệt)</option>
            <option value="draft">Bản nháp — tự xuất bản trên WordPress</option>
            <option value="pending">Chờ duyệt trên WordPress</option>
          </select>
        </Field>
        <Field label="ID chuyên mục (tuỳ chọn)" hint="Trống = chuyên mục mặc định"><input className={inputCls} value={add.categoryId} maxLength={12} inputMode="numeric" onChange={(e) => setAdd({ ...add, categoryId: e.target.value.replace(/\D/g, "") })} placeholder="12" /></Field>
      </div>
      <Field label="Tên hiển thị (tuỳ chọn)"><input className={inputCls} value={add.name} maxLength={120} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="Để trống = tên website" /></Field>
      {!encryptionKey && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Chưa có <code>TOKEN_ENCRYPTION_KEY</code> trong .env — mật khẩu ứng dụng sẽ được mã hoá bằng khoá mặc định. Nên thêm khoá riêng trước khi kết nối (xem mục "Chưa có khóa mã hóa" ở Cách 1).</p>}
      <details className="rounded-lg bg-soft p-3 text-xs text-muted">
        <summary className="cursor-pointer font-medium text-ink">Cách tạo mật khẩu ứng dụng (1 phút)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Đăng nhập WordPress bằng tài khoản sẽ đứng tên bài viết.</li>
          <li>Vào <b>Thành viên → Hồ sơ</b> (Users → Profile), kéo xuống mục <b>Mật khẩu ứng dụng</b> (Application Passwords).</li>
          <li>Đặt tên "TAKI Agentic AI" → <b>Thêm mật khẩu ứng dụng mới</b> → chép dãy 24 ký tự (chỉ hiện 1 lần) dán vào ô trên.</li>
          <li>Không thấy mục này: website chưa có https, hoặc plugin bảo mật (Wordfence, iThemes…) đang tắt Application Passwords / chặn REST API.</li>
        </ol>
        <p className="mt-2">Hệ thống kiểm tra quyền đăng bài + tải ảnh ngay khi kết nối. Bài SEO đã duyệt sẽ tự đăng: tiêu đề, nội dung, ảnh trong bài (có alt), ảnh đầu bài làm ảnh đại diện, mô tả ngắn, đường dẫn theo từ khoá. Gỡ quyền bất cứ lúc nào bằng cách xoá mật khẩu ứng dụng trên WordPress.</p>
      </details>
    </>
  );
}

/**
 * Kết nối bằng nút đăng nhập (OAuth): Facebook (+ Instagram Business gắn với Trang) và TikTok — không phải dán token.
 * Giao diện gọn: mỗi nền tảng 1 dòng (tên · trạng thái · nút đăng nhập); mọi hướng dẫn dài nằm trong mục tự bung khi bấm.
 */
function OAuthCard({ encryptionKey, pub, onChanged }: { encryptionKey: boolean; pub: any; onChanged: () => void }) {
  const { data, reload } = useApi<any>("oauth");
  const toast = useToast();
  const [form, setForm] = useState<Record<string, { id: string; secret: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [ads, setAds] = useState(false); // "Gồm quyền quảng cáo" — mặc định TẮT
  if (!data) return null;
  const login = async (p: string) => {
    setBusy(p);
    try { const r = await api.post(`oauth/${p}/start`, { returnTo: `${window.location.origin}/channels`, ads: p === "facebook" ? ads : undefined }); window.location.href = r.url; }
    catch (e: any) { toast(e.message, "err"); setBusy(null); }
  };
  const saveApp = async (p: string) => {
    try { await api.put(`oauth/${p}/app`, form[p] ?? {}); toast("Đã lưu App ID/Secret (mã hoá)"); setForm({ ...form, [p]: { id: "", secret: "" } }); reload(); onChanged(); }
    catch (e: any) { toast(e.details?.[0]?.message ?? e.message, "err"); }
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast("Đã sao chép"), () => toast("Hãy bôi đen và copy", "err"));
  const all = Object.values(data) as any[];
  const configuredCount = all.filter((o) => o.configured).length;
  return (
    <Card collapsible="channels.oauth" defaultOpen={configuredCount === 0}
      summary={all.map((o) => `${o.name}: ${o.configured ? "đã có app" : "chưa cấu hình"}`).join(" · ")}
      title={<span className="flex items-center gap-2"><LogIn className="h-4 w-4 shrink-0" /><span className="truncate">Cách 1 · Đăng nhập để liên kết</span></span>}>
      <p className="mb-3 text-xs text-muted">Bấm đăng nhập, chọn tài khoản và cho phép — hệ thống tự lấy Fanpage (và Instagram Business gắn kèm). Mục nào cần làm thêm sẽ có dòng nhắc; bấm vào dòng để xem chi tiết.</p>
      {!encryptionKey && (
        <Fold flat className="mb-3" tone="amber" icon={AlertTriangle} title="Chưa có khóa mã hóa" summary="hệ thống chưa lưu token / App Secret" bodyClass="px-4 pb-3 pt-0">
          <p className="text-xs text-muted">Thiếu <code className="rounded bg-soft px-1">TOKEN_ENCRYPTION_KEY</code> nên hệ thống KHÔNG lưu token đăng nhập / App Secret (khóa mặc định là khóa công khai). Thêm dòng <code className="rounded bg-soft px-1">TOKEN_ENCRYPTION_KEY=&lt;64 ký tự hex&gt;</code> vào file .env (tạo bằng <code className="rounded bg-soft px-1">node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</code>) rồi khởi động lại — các kết nối cũ tự được chuyển sang khóa mới.</p>
        </Fold>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {Object.entries(data).map(([p, o]: [string, any]) => {
          const needsHttps = p === "tiktok" && !String(o.redirectUri).startsWith("https://");
          const name = p === "facebook" ? "Facebook + Instagram" : o.name;
          return (
            <div key={p} className="min-w-0 rounded-2xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformIcon p={p} size={22} />
                <p className="min-w-0 flex-1 font-semibold text-ink">{name}</p>
                <Badge tone={o.configured ? "green" : "amber"} dot>{o.configured ? "Đã có app" : "Cần thiết lập"}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="primary" loading={busy === p} disabled={!o.configured || !encryptionKey || needsHttps} onClick={() => login(p)} icon={LogIn}>{p === "facebook" ? "Đăng nhập Facebook" : "Kết nối TikTok"}</Button>
                <span className="min-w-0 flex-1 text-xs text-muted">
                  {!o.configured ? "Thiết lập app 1 lần ở mục bên dưới, rồi đăng nhập."
                    : needsHttps ? "Cần địa chỉ https công khai — xem mục Lưu ý."
                    : `App ${o.appId} · ${o.source === "env" ? "từ .env" : "đã lưu"}`}
                </span>
              </div>

              <div className="mt-3 space-y-2">
                {o.warning && (
                  <Fold flat tone="amber" icon={AlertTriangle} title="Lưu ý" summary={needsHttps ? "TikTok cần địa chỉ https" : "xem chi tiết"} bodyClass="px-4 pb-3 pt-0">
                    <p className="text-xs text-muted">{o.warning}</p>
                  </Fold>
                )}
                <Fold flat tone={o.configured ? "green" : "amber"} icon={KeyRound} title="Thiết lập app (làm 1 lần)" summary={o.configured ? "đã xong — bấm để xem lại" : "bấm để xem 3 bước"} bodyClass="px-4 pb-4 pt-1">
                  <ol className="space-y-3 text-xs text-muted">
                    <li><b className="text-ink">1. Tạo app</b> ở <a href={o.console} target="_blank" rel="noreferrer" className="font-medium text-ink underline">{String(o.console).replace("https://", "")}</a>, bật {p === "facebook" ? "Facebook Login (app ở chế độ Development, Sếp là Quản trị viên / Người thử nghiệm của app)" : "Login Kit + Content Posting API"}.</li>
                    <li><b className="text-ink">2. Dán Redirect URI</b> này vào app (phải khớp từng ký tự):
                      <div className="mt-1 flex gap-1"><code className="min-w-0 flex-1 truncate rounded bg-soft px-2 py-1 font-mono text-[11px]">{o.redirectUri}</code><Button size="sm" icon={Copy} onClick={() => copy(o.redirectUri)} aria-label="Sao chép" /></div>
                    </li>
                    <li><b className="text-ink">3. Điền khóa app</b> rồi bấm Lưu{o.configured ? " (điền lại chỉ khi muốn đổi app)" : ""}:
                      <div className="mt-1 grid gap-2 sm:grid-cols-2">
                        <Field label={p === "facebook" ? "App ID" : "Client key"}><input className={inputCls} value={form[p]?.id ?? ""} placeholder={o.configured ? "••••••" : ""} onChange={(e) => setForm({ ...form, [p]: { ...(form[p] ?? { secret: "" }), id: e.target.value } })} /></Field>
                        <Field label={p === "facebook" ? "App Secret" : "Client secret"}><input type="password" autoComplete="off" className={inputCls} value={form[p]?.secret ?? ""} placeholder={o.configured ? "••••••" : ""} onChange={(e) => setForm({ ...form, [p]: { ...(form[p] ?? { id: "" }), secret: e.target.value } })} /></Field>
                      </div>
                      <div className="mt-2"><Button size="sm" disabled={!encryptionKey || !(form[p]?.id && form[p]?.secret)} onClick={() => saveApp(p)}>Lưu</Button></div>
                    </li>
                  </ol>
                  <Fold flat className="mt-3" title="Quyền sẽ xin" summary={`${o.scopes.length} quyền`} bodyClass="px-4 pb-3 pt-0">
                    <p className="break-words text-[11px] text-muted">{o.scopes.join(", ")}</p>
                  </Fold>
                  <p className="mt-2 text-[11px] text-muted">Hoặc đặt trong file .env: {(o.envKeys ?? []).join(", ")}.</p>
                </Fold>
                {p === "facebook" && (
                  <Fold flat icon={ShieldCheck} title="Tùy chọn nâng cao" summary={ads ? "đang xin cả quyền quảng cáo" : "chỉ xin quyền đăng bài"} bodyClass="px-4 pb-3 pt-1">
                    <label className="flex items-start gap-2 text-xs text-muted"><Toggle checked={ads} onChange={setAds} /><span><b className="text-ink">Gồm quyền quảng cáo</b> ({(o.adsScopes ?? []).join(", ")}). Chỉ bật khi app có sản phẩm Marketing API, không thì hộp thoại đăng nhập báo lỗi. Quảng cáo vẫn chạy được bằng token System User ở Trung tâm tích hợp.</span></label>
                  </Fold>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Fold flat className="mt-3" icon={KeyRound} title="Không tạo được app / app chưa được duyệt?" summary="có cách khác" bodyClass="px-4 pb-3 pt-0">
        <p className="text-xs text-muted">
          Dùng <Link to="/ads/integrations?p=meta" className="font-medium text-ink underline">Trung tâm tích hợp → Facebook</Link> (dán token System User) hoặc <b>Cách 2 · Đăng qua Chrome</b> ở từng kênh bên dưới.
          {pub?.publicPortConfigured ? <> Cổng công khai: {pub.listening ? <b className="text-ink">đang chạy{pub.publicBaseUrl ? ` · ${pub.publicBaseUrl}` : " (chưa đặt PUBLIC_BASE_URL)"}</b> : "chưa chạy được"}.</> : <> Cổng công khai (PUBLIC_PORT) đang tắt — chỉ cần bật khi kết nối TikTok, đăng Instagram qua API hoặc đo click link.</>}
        </p>
      </Fold>
    </Card>
  );
}

function ChannelCard({ c, chromeOk, siblings, onChange }: { c: any; chromeOk: boolean; siblings: number; onChange: () => void }) {
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
  const setEnabled = (enabled: boolean) => run("enabled", async () => { await api.put(`publish-channels/${c.id}/enabled`, { enabled }); toast(enabled ? `Đã bật ${c.name}` : `Đã tắt ${c.name}`); onChange(); });
  const makeDefault = () => run("default", async () => { await api.put(`publish-channels/${c.id}/default`); toast(`Bài ${c.platform} duyệt xong sẽ đăng vào ${c.name}`); onChange(); });

  return (
    <Card className={cx(!c.enabled && "opacity-70")}>
      <div className="flex items-start gap-3">
        <PlatformIcon p={c.platform} size={32} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">{c.name}{c.isDefault && c.enabled ? <Badge tone="violet">Kênh đăng chính</Badge> : null}{!c.enabled && <Badge tone="gray">Đang tắt</Badge>}</p>
          <p className="text-xs text-muted">{c.platform} · {c.kind}{c.connection ? ` · kết nối ${c.connection.mode === "live" ? "API thật" : "demo"}` : " · thêm tay"}</p>
        </div>
        <Badge tone={route[1]}>{route[0]}</Badge>
        {!c.connection && <button onClick={remove} disabled={busy !== null} className="rounded-md p-1 text-muted hover:text-rose-600" title="Gỡ kênh" aria-label={`Gỡ ${c.name}`}><Trash2 className="h-4 w-4" /></button>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {c.enabled && !c.isDefault && siblings > 1 && <Button size="sm" loading={busy === "default"} onClick={makeDefault}>Đặt làm kênh đăng chính</Button>}
        <Button size="sm" variant="ghost" loading={busy === "enabled"} onClick={() => setEnabled(!c.enabled)}>{c.enabled ? "Tắt kênh" : "Bật kênh"}</Button>
      </div>
      <p className="mt-2 text-xs text-muted">{c.route === "none" ? c.reason : route[2]}</p>

      <Fold flat className="mt-3" icon={KeyRound} tone={c.api ? (c.apiBlock || c.connection?.status === "expired" ? "amber" : "green") : "gray"} title="Liên kết API" summary={c.connection?.status === "expired" ? "phiên hết hạn — cần đăng nhập lại" : c.api ? (c.apiBlock ? "đã liên kết · có lưu ý" : "đã liên kết") : "chưa liên kết"} bodyClass="px-4 pb-3 pt-0">
        {c.api ? (
          <>
            <p className="mt-1 text-xs text-muted">{c.platform === "tiktok" ? "Đã liên kết — video duyệt xong được gửi vào hộp thư TikTok (bản nháp) qua API; mở TikTok để đăng." : c.platform === "instagram" ? "Đã liên kết — đăng ảnh / Reels qua API (Instagram không có bản nháp qua API)." : "Đã liên kết — bài duyệt xong sẽ đăng thẳng qua API (chữ, ảnh, video; video duyệt xong lên bản nháp Trang)."}</p>
            {c.apiBlock && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{c.apiBlock}.</p>}
            {c.platform === "tiktok" && c.audited !== null && (
              <label className="mt-2 flex items-start gap-2 text-xs text-muted"><Toggle checked={Boolean(c.audited)} disabled={busy !== null} onChange={(v) => run("audited", async () => { await api.put(`publish-channels/${c.id}/tiktok-audited`, { audited: v }); toast(v ? "Đã đánh dấu app được TikTok duyệt — bài sẽ đăng công khai qua API" : "Đã tắt — bài đăng công khai đi qua Chrome, API chỉ gửi bản nháp"); onChange(); })} />
                <span><b className="text-ink">App đã được TikTok duyệt (audit)</b> — chỉ bật khi TikTok đã duyệt Content Posting API cho app. Chưa duyệt: TikTok chỉ cho đăng RIÊNG TƯ nên hệ thống không đăng công khai qua API.</span></label>
            )}
            {c.connection?.status === "expired" && <p className="mt-1 text-xs font-medium text-rose-600">Phiên hết hạn — bấm đăng nhập lại ở Cách 1.</p>}
          </>
        ) : <p className="mt-1 text-xs text-muted">{API_HINT[c.platform] ?? "Kênh này chưa có API đăng bài."}{c.connection?.status === "expired" ? <b className="text-rose-600"> Token hết hạn — kết nối lại.</b> : ""}</p>}
      </Fold>

      {c.browserSupported && (
        <Fold flat className="mt-2" icon={Chrome} tone={c.ready.ok ? "green" : c.api ? "gray" : "amber"} title="Cách 2 · Đăng qua Chrome" defaultOpen={c.enabled && !c.api && !c.ready.ok}
          summary={c.ready.ok ? `sẵn sàng${c.browser.account ? ` · ${c.browser.account}` : ""}` : c.api ? "dự phòng — chưa đăng nhập" : "cần đăng nhập 4 bước"} bodyClass="px-4 pb-3 pt-0">
          <p className="mt-1 text-xs text-muted">Dùng khi không liên kết được API (chưa có token, app chưa được duyệt…).</p>
          <ol className="mt-3 space-y-2 text-[13px]">
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
        </Fold>
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
