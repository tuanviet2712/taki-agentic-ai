import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, BarChart3, CheckCircle2, Copy, Eye, FileText, Globe, ListOrdered, Mail, Pause, Plus, RefreshCw, Send, ShieldCheck, Sparkles, Trash2, Upload, Users, Wand2, XCircle,
} from "lucide-react";
import { api, useApi } from "../lib/api";
import { num, timeAgo, vnd, type Tone } from "../lib/format";
import { Alert, Badge, Button, Card, ConfirmDialog, Empty, Field, Loading, Modal, PageHeader, Stat, Tabs, cx, inputCls, useToast } from "../components/ui";
import { EmailComposer } from "../components/email/EmailComposer";

/**
 * Email marketing (kênh Email qua Resend — chép mô hình auto-funnel): tổng quan & kết nối, liên hệ + phân khúc,
 * chiến dịch (gửi qua mục Duyệt), chuỗi tự động (AI viết + chấm điểm + duyệt kích hoạt), mẫu, chất lượng gửi.
 */
type Tab = "overview" | "contacts" | "campaigns" | "sequences" | "templates" | "quality";
const EV = ["email.", "approval."];
const CAMPAIGN: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Nháp", tone: "gray" }, awaiting_approval: { label: "Chờ duyệt", tone: "amber" }, scheduled: { label: "Đã lên lịch", tone: "blue" },
  sending: { label: "Đang gửi", tone: "violet" }, sent: { label: "Đã gửi", tone: "green" }, cancelled: { label: "Đã dừng", tone: "gray" },
};
const SEQ: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Nháp", tone: "gray" }, awaiting_approval: { label: "Chờ duyệt kích hoạt", tone: "amber" }, active: { label: "Đang chạy", tone: "green" }, paused: { label: "Tạm dừng", tone: "gray" },
};
const MSG: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Đang gửi", tone: "gray" }, sent: { label: "Đã gửi", tone: "blue" }, delivered: { label: "Đã tới hộp thư", tone: "blue" }, opened: { label: "Đã mở", tone: "green" },
  clicked: { label: "Đã bấm link", tone: "green" }, bounced: { label: "Bounce", tone: "red" }, complained: { label: "Khiếu nại spam", tone: "red" }, skipped: { label: "Bỏ qua", tone: "gray" }, failed: { label: "Lỗi", tone: "red" },
};
const SKIP: Record<string, string> = {
  not_connected: "chưa kết nối", sandbox: "kết nối mô phỏng", kill_switch: "khoá khẩn cấp", unsubscribed: "đã hủy nhận", opt_out: "ngừng nhận đa kênh", consent: "chỉ thư giao dịch",
  suppressed: "bị loại trừ", stopped: "đang ngắt gửi", daily_limit: "hết hạn mức ngày", throttled: "giảm tốc", no_public_url: "chưa có địa chỉ công khai", missing_var: "thiếu biến",
};
const CONTACT: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Đang nhận", tone: "green" }, unsubscribed: { label: "Đã hủy nhận", tone: "gray" }, bounced: { label: "Bounce", tone: "red" }, complained: { label: "Khiếu nại", tone: "red" },
};
const CONSENT: Record<string, string> = { opt_in: "Đồng ý nhận tin", unknown: "Tự để lại (chat / đơn)", transactional: "Chỉ thư giao dịch" };
const TRIGGER: Record<string, string> = { manual: "Thủ công (chọn người ghi danh)", contact_created: "Có liên hệ mới", tag_added: "Liên hệ được gắn thẻ", order_created: "Khách có đơn hàng" };

function useRun() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T,>(key: string, fn: () => Promise<T>, ok?: (r: T) => string | null | undefined): Promise<T | undefined> => {
    setBusy(key);
    try { const r = await fn(); const m = ok?.(r); if (m) toast(m); return r; } catch (e: any) { toast(e.message, "err"); return undefined; } finally { setBusy(null); }
  };
  return { busy, run };
}

export function EmailPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "overview";
  const { data: st, reload } = useApi<any>("email/status", EV);
  if (!st) return <Loading />;
  return (
    <div className="space-y-6">
      <PageHeader title="Email marketing" subtitle="Gửi email thật qua Resend: chiến dịch, chuỗi tự động, mẫu soạn theo khối / kéo thả. Mọi thư gửi khách đều qua Duyệt; tự loại bounce, khiếu nại và người hủy nhận."
        meta={<>{st.connected ? <Badge tone={st.live ? "green" : "amber"} dot>{st.live ? `${st.fromName} <${st.fromAddress}>` : "Kết nối mô phỏng"}</Badge> : <Badge tone="red" dot>Chưa kết nối</Badge>}
          {st.state !== "active" && <Badge tone={st.state === "stopped" ? "red" : "amber"}>{st.state === "stopped" ? "ĐANG NGẮT GỬI" : "Đang giảm tốc"}</Badge>}
          {st.killSwitch && <Badge tone="red">Khoá khẩn cấp Email đang bật</Badge>}</>} />
      <Tabs value={tab} onChange={(v) => setSp({ tab: v })} tabs={[
        { value: "overview", label: "Tổng quan" }, { value: "contacts", label: "Liên hệ & phân khúc" }, { value: "campaigns", label: "Chiến dịch" },
        { value: "sequences", label: "Chuỗi tự động" }, { value: "templates", label: "Mẫu email" }, { value: "quality", label: "Chất lượng gửi" },
      ]} />
      {tab === "overview" && <Overview st={st} reload={reload} />}
      {tab === "contacts" && <Contacts />}
      {tab === "campaigns" && <Campaigns st={st} />}
      {tab === "sequences" && <Sequences />}
      {tab === "templates" && <Templates />}
      {tab === "quality" && <Quality st={st} />}
    </div>
  );
}

// ---------------- Tổng quan ----------------
function Overview({ st, reload }: { st: any; reload: () => void }) {
  const { busy, run } = useRun();
  const [limit, setLimit] = useState(String(st.dailyLimit || 50));
  const [cf, setCf] = useState("");
  const [setup, setSetup] = useState<any>(null);
  const [test, setTest] = useState({ to: "", subject: "Thư thử từ {{ten_thuong_hieu}}", body: "Chào {{ho_ten|bạn}},\n\nĐây là thư thử để kiểm tra đường gửi email. Link thử: https://taki.vn\n\nThân mến." });
  const { data: d } = useApi<any>("email/deliverability", EV);
  useEffect(() => setLimit(String(st.dailyLimit || 50)), [st.dailyLimit]);

  if (!st.connected) return (
    <Card>
      <div className="py-10 text-center">
        <Mail className="mx-auto h-10 w-10 text-blue-500" />
        <p className="mt-3 text-lg font-semibold text-ink">Chưa kết nối Email</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-muted">Cần API key Resend (Full access) + tên và địa chỉ gửi thuộc domain của bạn (nên là subdomain riêng, vd. hello@mail.taki.vn).</p>
        <Link to="/ads/integrations?p=resend" className="mt-4 inline-block"><Button variant="primary">Kết nối Email (Resend)</Button></Link>
      </div>
    </Card>
  );
  return (
    <div className="space-y-6">
      {st.state === "stopped" && <Alert tone="danger" title="Gửi email đang bị NGẮT tự động" action={<Button size="sm" loading={busy === "reopen"} onClick={() => run("reopen", () => api.post("email/reopen"), () => { reload(); return "Đã mở lại gửi"; })}>Mở lại gửi</Button>}>{st.stateReason}</Alert>}
      {st.state === "throttled" && <Alert tone="warn" title="Đang giảm tốc 50%">{st.stateReason}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Send} tone="blue" label="Đã gửi hôm nay" value={`${num(st.sentToday)} / ${num(st.dailyLimit)}`} sub="hạn mức warm-up" />
        <Stat icon={Users} tone="violet" label="Liên hệ đang nhận" value={num(d?.contacts?.active ?? 0)} sub={`${num(d?.contacts?.total ?? 0)} tổng`} />
        <Stat icon={Eye} tone="green" label="Tỉ lệ mở (7 ngày)" value={`${d?.week?.rates?.opened ?? 0}%`} sub={`${num(d?.week?.sent ?? 0)} thư`} />
        <Stat icon={BarChart3} tone="amber" label="Doanh thu từ email (7 ngày)" value={vnd(d?.week?.revenue ?? 0)} sub="quy last-touch theo click" />
      </div>
      <Card title="Sẵn sàng gửi thật" icon={ShieldCheck} description="Đủ 5 mục dưới đây thì chiến dịch / chuỗi mới gửi được tới khách.">
        <ul className="space-y-2 text-sm">
          {st.checklist.map((c: any) => (
            <li key={c.key} className="flex items-start gap-2">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
              <span><span className="font-medium text-ink">{c.label}</span>{c.hint && <span className="text-muted"> — {c.hint}</span>}</span>
            </li>
          ))}
        </ul>
        {st.webhookUrl && <p className="mt-3 text-xs text-muted">Webhook Resend: <code className="rounded bg-soft px-1">{st.webhookUrl}</code></p>}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Domain gửi & DNS" icon={Globe} description="Tự thêm domain trên Resend, đẩy SPF / DKIM / DMARC sang Cloudflare (nếu có token), xin xác minh, tạo webhook.">
          <div className="space-y-3">
            <p className="text-sm">Domain: <b>{st.domain || "—"}</b> <Badge tone={st.domainStatus === "verified" ? "green" : "amber"}>{st.domainStatus ?? "?"}</Badge></p>
            {st.dns && <p className="text-xs text-muted">SPF {st.dns.spf?.muc === "dat" ? "✓" : "✗"} · DKIM {st.dns.dkim?.muc === "dat" ? "✓" : "✗"} · DMARC {st.dns.dmarc?.muc === "dat" ? "✓" : "✗"} · kiểm {timeAgo(st.dns.at)}</p>}
            {!st.hasCloudflareToken && <Field label="Cloudflare API token" optional hint="Mẫu «Edit zone DNS», chọn zone của domain gửi. Bỏ trống: hệ thống chỉ hiện bản ghi để bạn thêm tay."><input className={inputCls} type="password" value={cf} onChange={(e) => setCf(e.target.value)} /></Field>}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={Wand2} loading={busy === "setup"} onClick={() => run("setup", () => api.post("email/domain/setup", cf ? { cloudflareToken: cf } : {}), (r: any) => { setSetup(r); reload(); return r.ok ? "Thiết lập xong" : "Thiết lập còn bước chưa đạt — xem chi tiết"; })}>Thiết lập tự động</Button>
              <Button icon={RefreshCw} loading={busy === "check"} onClick={() => run("check", () => api.post("email/domain/check"), (r: any) => { setSetup((s: any) => ({ ...(s ?? {}), records: r.records, check: r })); reload(); return `Domain: ${r.status}`; })}>Kiểm lại</Button>
            </div>
            {setup?.steps && <ul className="space-y-1 text-xs">{setup.steps.map((s: any, i: number) => <li key={i} className={s.ok ? "text-emerald-700" : "text-red-600"}>{s.ok ? "✓" : "✗"} <b>{s.name}</b>: {s.detail}</li>)}</ul>}
            {setup?.records?.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-line text-xs">
                <table className="w-full"><thead className="bg-soft text-left"><tr><th className="p-2">Loại</th><th className="p-2">Tên</th><th className="p-2">Giá trị</th><th className="p-2">TT</th></tr></thead>
                  <tbody>{setup.records.map((r: any, i: number) => <tr key={i} className="border-t border-line"><td className="p-2">{r.type}</td><td className="p-2 font-mono">{r.name}</td><td className="max-w-xs break-all p-2 font-mono">{r.value}{r.priority ? ` (ưu tiên ${r.priority})` : ""}</td><td className="p-2">{r.status}</td></tr>)}</tbody></table>
              </div>
            )}
          </div>
        </Card>
        <Card title="Hạn mức & gửi thử" icon={Send}>
          <div className="space-y-3">
            <Field label="Hạn mức gửi/ngày (warm-up)" hint="Domain mới: 50/ngày, tăng ×2 mỗi tuần khi bounce < 2%.">
              <div className="flex gap-2"><input className={inputCls} type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
                <Button loading={busy === "limit"} onClick={() => run("limit", () => api.put("email/settings", { dailyLimit: Number(limit) }), () => { reload(); return "Đã lưu hạn mức"; })}>Lưu</Button></div>
            </Field>
            <Field label="Gửi thử tới"><input className={inputCls} placeholder="email-cua-ban@gmail.com" value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} /></Field>
            <Field label="Tiêu đề"><input className={inputCls} value={test.subject} onChange={(e) => setTest({ ...test, subject: e.target.value })} /></Field>
            <Field label="Nội dung"><textarea className={cx(inputCls, "min-h-28")} value={test.body} onChange={(e) => setTest({ ...test, body: e.target.value })} /></Field>
            <Button variant="primary" icon={Send} loading={busy === "test"} disabled={!test.to} onClick={() => run("test", () => api.post("email/test", { to: test.to, content: { mode: "text", subject: test.subject, body: test.body } }), () => "Đã gửi thư thử — kiểm tra hộp thư (cả mục Spam)")}>Gửi thư thử</Button>
          </div>
        </Card>
      </div>
      <RecentMessages />
    </div>
  );
}

function RecentMessages({ query = "" }: { query?: string }) {
  const { data } = useApi<any[]>(`email/messages?limit=50${query}`, EV);
  const [view, setView] = useState<string | null>(null);
  const { data: html } = useApi<any>(view ? `email/messages/${view}/html` : null);
  return (
    <Card title="Thư gần đây" icon={Mail}>
      {!data ? <Loading /> : !data.length ? <Empty title="Chưa có thư nào" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-2">Người nhận</th><th>Tiêu đề</th><th>Nguồn</th><th>Trạng thái</th><th>Lúc</th><th /></tr></thead>
            <tbody>{data.map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className="py-2 pr-2">{m.to_masked}</td><td className="max-w-xs truncate pr-2">{m.subject}</td>
                <td className="pr-2 text-xs text-muted">{m.source_kind}{m.transactional ? " · giao dịch" : ""}</td>
                <td className="pr-2"><Badge tone={MSG[m.status]?.tone ?? "gray"}>{MSG[m.status]?.label ?? m.status}</Badge>{m.reason && <span className="ml-1 text-xs text-muted">{SKIP[m.reason] ?? m.reason.slice(0, 60)}</span>}</td>
                <td className="whitespace-nowrap pr-2 text-xs text-muted">{timeAgo(m.sent_at ?? m.created_at)}</td>
                <td>{m.status !== "skipped" && <Button size="sm" variant="ghost" icon={Eye} onClick={() => setView(m.id)} />}</td>
              </tr>))}</tbody></table>
        </div>
      )}
      <Modal open={Boolean(view)} onClose={() => setView(null)} title="Nội dung thư đã gửi" size="lg">
        {html?.html ? <iframe title="email" sandbox="" srcDoc={html.html} className="h-[70vh] w-full rounded-xl border border-line bg-white" /> : <Loading />}
      </Modal>
    </Card>
  );
}

// ---------------- Liên hệ & phân khúc ----------------
const RULE_FIELDS: { value: string; label: string; op: string; kind: "text" | "bool" | "days" | "grade" | "select"; options?: { value: string; label: string }[] }[] = [
  { value: "tag", label: "Có thẻ", op: "has", kind: "text" }, { value: "tag!", label: "Không có thẻ", op: "not", kind: "text" },
  { value: "source", label: "Nguồn là", op: "=", kind: "select", options: ["manual", "import", "chat", "order", "nurture", "form", "api"].map((v) => ({ value: v, label: v })) },
  { value: "consent", label: "Đồng ý nhận là", op: "=", kind: "select", options: Object.entries(CONSENT).map(([value, label]) => ({ value, label })) },
  { value: "purchased", label: "Đã mua hàng", op: "is", kind: "bool" }, { value: "has_conversation", label: "Đã chat với shop", op: "is", kind: "bool" },
  { value: "lead_grade", label: "Hạng lead (chat)", op: "in", kind: "grade" },
  { value: "opened_within", label: "Đã mở thư trong (ngày)", op: "days", kind: "days" }, { value: "not_opened_within", label: "KHÔNG mở thư trong (ngày)", op: "days", kind: "days" },
  { value: "clicked_within", label: "Đã bấm link trong (ngày)", op: "days", kind: "days" }, { value: "created_within", label: "Mới thêm trong (ngày)", op: "days", kind: "days" },
];

function Contacts() {
  const { busy, run } = useRun();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const { data, reload } = useApi<any>(`email/contacts?search=${encodeURIComponent(search)}&tag=${encodeURIComponent(tag)}`, EV);
  const { data: segs, reload: reloadSegs } = useApi<any[]>("email/segments", EV);
  const [add, setAdd] = useState<any>(null);
  const [imp, setImp] = useState<any>(null);
  const [seg, setSeg] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const readFile = async (f: File) => setImp({ ...(imp ?? {}), csv: await f.text(), file: f.name });
  return (
    <div className="space-y-6">
      <Card title="Liên hệ email" icon={Users} description="Tự thêm khi khách gõ email trong chat, khi đơn có email, khi bạn nhập CSV hoặc thêm tay. Mọi thư marketing đều có link hủy nhận."
        action={<div className="flex gap-2"><Button icon={Upload} onClick={() => setImp({ csv: "", consent: "opt_in", tags: "" })}>Nhập CSV</Button><Button variant="primary" icon={Plus} onClick={() => setAdd({ email: "", name: "", tags: "", consent: "opt_in" })}>Thêm</Button></div>}>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className={cx(inputCls, "max-w-xs")} placeholder="Tìm email / tên" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className={cx(inputCls, "max-w-[12rem]")} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Mọi thẻ</option>{data?.tags?.map((t: any) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
          </select>
          <span className="self-center text-sm text-muted">{num(data?.total ?? 0)} liên hệ</span>
        </div>
        {!data ? <Loading /> : !data.contacts.length ? <Empty title="Chưa có liên hệ" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-2">Email</th><th>Tên</th><th>Thẻ</th><th>Nguồn / đồng ý</th><th>Trạng thái</th><th>Mở / click</th><th /></tr></thead>
              <tbody>{data.contacts.map((c: any) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-2 pr-2">{c.email}{c.purchased ? <Badge tone="green" className="ml-1">đã mua</Badge> : null}{c.conversation_id ? <Link to={`/chat?c=${c.conversation_id}`} className="ml-1 text-xs text-blue-600">chat</Link> : null}</td>
                  <td className="pr-2">{c.name ?? "—"}</td>
                  <td className="pr-2">{(c.tags ?? []).map((t: string) => <Badge key={t} className="mr-1">{t}</Badge>)}</td>
                  <td className="pr-2 text-xs text-muted">{c.source} · {CONSENT[c.consent] ?? c.consent}</td>
                  <td className="pr-2"><Badge tone={CONTACT[c.status]?.tone ?? "gray"}>{CONTACT[c.status]?.label ?? c.status}</Badge></td>
                  <td className="whitespace-nowrap pr-2 text-xs text-muted">{c.last_open_at ? timeAgo(c.last_open_at) : "—"} / {c.last_click_at ? timeAgo(c.last_click_at) : "—"}</td>
                  <td className="whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => setEdit({ id: c.id, name: c.name ?? "", tags: (c.tags ?? []).join(", "), consent: c.consent })}>Sửa</Button><Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(c)} /></td>
                </tr>))}</tbody></table>
          </div>
        )}
      </Card>

      <Card title="Phân khúc" icon={ListOrdered} description="Nhóm người nhận cho chiến dịch. Chỉ tính liên hệ đang nhận (không hủy / bounce / chỉ giao dịch)."
        action={<Button icon={Plus} onClick={() => setSeg({ name: "", definition: { match: "all", rules: [{ field: "tag", op: "has", value: "" }] } })}>Phân khúc mới</Button>}>
        {!segs ? <Loading /> : !segs.length ? <Empty title="Chưa có phân khúc — chiến dịch không chọn phân khúc sẽ gửi mọi liên hệ đang nhận" /> : (
          <ul className="divide-y divide-line">{segs.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span><b>{s.name}</b> <span className="text-muted">· {num(s.member_count)} người · {s.definition?.rules?.length ?? 0} điều kiện ({s.definition?.match === "any" ? "một trong" : "tất cả"})</span></span>
              <span><Button size="sm" variant="ghost" onClick={() => setSeg(s)}>Sửa</Button><Button size="sm" variant="ghost" icon={Trash2} onClick={() => run("dseg", () => api.del(`email/segments/${s.id}`), () => { reloadSegs(); return "Đã xoá phân khúc"; })} /></span>
            </li>))}</ul>
        )}
      </Card>

      <Modal open={Boolean(add)} onClose={() => setAdd(null)} title="Thêm liên hệ" footer={<Button variant="primary" loading={busy === "add"} onClick={() => run("add", () => api.post("email/contacts", { email: add.email, name: add.name || null, tags: add.tags.split(",").map((t: string) => t.trim()).filter(Boolean), consent: add.consent }), () => { setAdd(null); reload(); return "Đã thêm"; })}>Lưu</Button>}>
        {add && <div className="space-y-3">
          <Field label="Email" required><input className={inputCls} value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></Field>
          <Field label="Tên"><input className={inputCls} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
          <Field label="Thẻ" hint="Cách nhau dấu phẩy. Gắn thẻ có thể kích hoạt chuỗi email."><input className={inputCls} value={add.tags} onChange={(e) => setAdd({ ...add, tags: e.target.value })} /></Field>
          <Field label="Đồng ý nhận"><select className={inputCls} value={add.consent} onChange={(e) => setAdd({ ...add, consent: e.target.value })}>{Object.entries(CONSENT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>}
      </Modal>
      <Modal open={Boolean(imp)} onClose={() => setImp(null)} title="Nhập liên hệ từ CSV" description="Cột email bắt buộc; cột ten / name và tags (cách nhau |) tuỳ chọn. Hoặc mỗi dòng một email."
        footer={<Button variant="primary" loading={busy === "imp"} disabled={!imp?.csv} onClick={() => run("imp", () => api.post("email/contacts/import", { csv: imp.csv, consent: imp.consent, tags: imp.tags.split(",").map((t: string) => t.trim()).filter(Boolean) }), (r: any) => { setImp(null); reload(); return `Thêm ${r.added} · cập nhật ${r.updated} · không hợp lệ ${r.invalid}`; })}>Nhập</Button>}>
        {imp && <div className="space-y-3">
          <input type="file" accept=".csv,.txt" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
          <textarea className={cx(inputCls, "min-h-32 font-mono text-xs")} placeholder={"email,ten,tags\nan@vidu.vn,An,vip|moi"} value={imp.csv} onChange={(e) => setImp({ ...imp, csv: e.target.value })} />
          <Field label="Danh sách này đến từ đâu?" hint="Danh sách mua / không rõ nguồn: chọn «Chỉ thư giao dịch» để không gửi marketing — giữ uy tín domain.">
            <select className={inputCls} value={imp.consent} onChange={(e) => setImp({ ...imp, consent: e.target.value })}>{Object.entries(CONSENT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
          <Field label="Gắn thêm thẻ"><input className={inputCls} value={imp.tags} onChange={(e) => setImp({ ...imp, tags: e.target.value })} /></Field>
        </div>}
      </Modal>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title="Sửa liên hệ" footer={<Button variant="primary" loading={busy === "edit"} onClick={() => run("edit", () => api.put(`email/contacts/${edit.id}`, { name: edit.name || null, tags: edit.tags.split(",").map((t: string) => t.trim()).filter(Boolean), consent: edit.consent }), () => { setEdit(null); reload(); return "Đã lưu"; })}>Lưu</Button>}>
        {edit && <div className="space-y-3">
          <Field label="Tên"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Thẻ"><input className={inputCls} value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} /></Field>
          <Field label="Đồng ý nhận"><select className={inputCls} value={edit.consent} onChange={(e) => setEdit({ ...edit, consent: e.target.value })}>{Object.entries(CONSENT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>}
      </Modal>
      <ConfirmDialog open={Boolean(del)} title="Xoá liên hệ?" tone="danger" confirmLabel="Xoá" loading={busy === "del"} onCancel={() => setDel(null)}
        onConfirm={() => run("del", () => api.del(`email/contacts/${del.id}`), () => { setDel(null); reload(); return "Đã xoá"; })}>{del?.email} — dừng mọi chuỗi đang chạy của người này. Địa chỉ đã hủy / bounce vẫn nằm trong danh sách loại trừ.</ConfirmDialog>
      {seg && <SegmentModal seg={seg} onClose={() => setSeg(null)} onSaved={() => { setSeg(null); reloadSegs(); }} />}
    </div>
  );
}

function SegmentModal({ seg, onClose, onSaved }: { seg: any; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useRun();
  const [s, setS] = useState<any>(seg);
  const rules: any[] = s.definition.rules;
  const setRules = (r: any[]) => setS({ ...s, definition: { ...s.definition, rules: r } });
  const fieldKey = (r: any) => (r.field === "tag" && r.op === "not" ? "tag!" : r.field);
  return (
    <Modal open onClose={onClose} title={s.id ? "Sửa phân khúc" : "Phân khúc mới"} size="lg"
      footer={<Button variant="primary" loading={busy === "save"} onClick={() => run("save", () => api.post("email/segments", { id: s.id, name: s.name, definition: s.definition }), (r: any) => { onSaved(); return `Đã lưu — ${r.member_count} người`; })}>Lưu</Button>}>
      <div className="space-y-3">
        <Field label="Tên"><input className={inputCls} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
        <Field label="Khớp"><select className={inputCls} value={s.definition.match} onChange={(e) => setS({ ...s, definition: { ...s.definition, match: e.target.value } })}><option value="all">Tất cả điều kiện</option><option value="any">Một trong các điều kiện</option></select></Field>
        {rules.map((r, i) => {
          const def = RULE_FIELDS.find((f) => f.value === fieldKey(r))!;
          const set = (patch: any) => setRules(rules.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className={cx(inputCls, "max-w-[15rem]")} value={fieldKey(r)} onChange={(e) => {
                const f = RULE_FIELDS.find((x) => x.value === e.target.value)!;
                set({ field: f.value.replace("!", ""), op: f.op, value: f.kind === "bool" ? true : f.kind === "days" ? 30 : f.kind === "grade" ? ["hot"] : f.options?.[0]?.value ?? "" });
              }}>{RULE_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
              {def.kind === "text" && <input className={cx(inputCls, "max-w-[12rem]")} placeholder="tên thẻ" value={r.value} onChange={(e) => set({ value: e.target.value })} />}
              {def.kind === "select" && <select className={cx(inputCls, "max-w-[12rem]")} value={r.value} onChange={(e) => set({ value: e.target.value })}>{def.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
              {def.kind === "bool" && <select className={cx(inputCls, "max-w-[8rem]")} value={String(r.value)} onChange={(e) => set({ value: e.target.value === "true" })}><option value="true">Có</option><option value="false">Không</option></select>}
              {def.kind === "days" && <input type="number" min={1} className={cx(inputCls, "max-w-[8rem]")} value={r.value} onChange={(e) => set({ value: Number(e.target.value) })} />}
              {def.kind === "grade" && <input className={cx(inputCls, "max-w-[12rem]")} placeholder="hot, warm" value={(r.value ?? []).join(", ")} onChange={(e) => set({ value: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />}
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRules(rules.filter((_, j) => j !== i))} />
            </div>
          );
        })}
        <Button size="sm" icon={Plus} onClick={() => setRules([...rules, { field: "tag", op: "has", value: "" }])}>Thêm điều kiện</Button>
      </div>
    </Modal>
  );
}

// ---------------- Chiến dịch ----------------
function Campaigns({ st }: { st: any }) {
  const { busy, run } = useRun();
  const { data, reload } = useApi<any[]>("email/campaigns", EV);
  const [open, setOpen] = useState<string | "new" | null>(null);
  return (
    <div className="space-y-6">
      {!st.ready && <Alert tone="warn" title="Chưa đủ điều kiện gửi thật">Xem tab Tổng quan → «Sẵn sàng gửi thật». Vẫn soạn và gửi duyệt được; thư chỉ đi khi đủ điều kiện.</Alert>}
      <Card title="Chiến dịch email" icon={Send} description="Soạn → gửi thử → gửi duyệt (mục [ĐỎ] ở Duyệt & Phê duyệt) → được duyệt thì tự gửi trong khung giờ gửi, theo hạn mức ngày."
        action={<Button variant="primary" icon={Plus} onClick={() => setOpen("new")}>Chiến dịch mới</Button>}>
        {!data ? <Loading /> : !data.length ? <Empty title="Chưa có chiến dịch" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-2">Tên</th><th>Trạng thái</th><th>Gửi</th><th>Mở</th><th>Click</th><th>Bounce</th><th>Doanh thu</th><th /></tr></thead>
              <tbody>{data.map((c) => {
                const s = c.stats ?? {};
                const rate = (k: string) => (s.sent ? `${Math.round((s[k] / s.sent) * 100)}%` : "—");
                return (
                  <tr key={c.id} className="border-t border-line">
                    <td className="py-2 pr-2"><button className="text-left font-medium text-ink hover:underline" onClick={() => setOpen(c.id)}>{c.name}</button>{c.parent_id && <Badge className="ml-1">gửi lại</Badge>}<div className="text-xs text-muted">{c.subject}</div></td>
                    <td className="pr-2"><Badge tone={CAMPAIGN[c.status]?.tone}>{CAMPAIGN[c.status]?.label ?? c.status}</Badge>{c.summary?.pausedBy && <div className="text-xs text-muted">chờ: {SKIP[c.summary.pausedBy] ?? c.summary.pausedBy}</div>}</td>
                    <td className="pr-2">{num(s.sent ?? 0)}</td><td className="pr-2">{rate("opened")}</td><td className="pr-2">{rate("clicked")}</td><td className="pr-2">{rate("bounced")}</td><td className="pr-2">{vnd(s.revenue ?? 0)}</td>
                    <td className="whitespace-nowrap">
                      {["scheduled", "sending", "awaiting_approval"].includes(c.status) && <Button size="sm" variant="ghost" icon={Pause} loading={busy === `x${c.id}`} onClick={() => run(`x${c.id}`, () => api.post(`email/campaigns/${c.id}/cancel`), () => { reload(); return "Đã dừng"; })}>Dừng</Button>}
                    </td>
                  </tr>);
              })}</tbody></table>
          </div>
        )}
      </Card>
      {open && <CampaignEditor id={open === "new" ? null : open} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function CampaignEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { busy, run } = useRun();
  const { data: segs } = useApi<any[]>("email/segments");
  const { data: tpl } = useApi<any>("email/templates");
  const [c, setC] = useState<any>(id ? null : { name: "", segmentId: "", subject: "", subjectB: "", abPct: 0, preheader: "", mode: "text", body: "", data: null, scheduledAt: "", resendAfterHours: null, resendSubject: "", status: "draft" });
  const [cid, setCid] = useState<string | null>(id);
  const [preview, setPreview] = useState<any>(null);
  const [testTo, setTestTo] = useState("");
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    if (!id) return;
    api.get(`email/campaigns/${id}`).then((r: any) => {
      setStats(r.stats);
      setC({ name: r.name, segmentId: r.segment_id ?? "", subject: r.subject, subjectB: r.subject_b ?? "", abPct: r.ab_pct, preheader: r.preheader ?? "", mode: r.mode, body: r.body, data: r.mode === "text" ? null : r.data,
        scheduledAt: r.scheduled_at ? r.scheduled_at.slice(0, 16) : "", resendAfterHours: r.resend_after_hours, resendSubject: r.resend_subject ?? "", status: r.status });
    });
  }, [id]);
  if (!c) return <Modal open onClose={onClose} title="Chiến dịch"><Loading /></Modal>;
  const locked = !["draft", "awaiting_approval"].includes(c.status);
  const payload = () => ({ name: c.name, segmentId: c.segmentId || null, subject: c.subject, subjectB: c.subjectB || null, abPct: Number(c.abPct) || 0, preheader: c.preheader || null, mode: c.mode, body: c.body, data: c.data ?? {},
    scheduledAt: c.scheduledAt ? new Date(c.scheduledAt).toISOString() : null, resendAfterHours: c.resendAfterHours ? Number(c.resendAfterHours) : null, resendSubject: c.resendSubject || null });
  const save = async () => {
    const r: any = cid ? await api.put(`email/campaigns/${cid}`, payload()) : await api.post("email/campaigns", payload());
    setCid(r.id); setC((x: any) => ({ ...x, status: r.status }));
    return r;
  };
  const useTemplate = (tid: string) => {
    const t = tpl?.templates?.find((x: any) => x.id === tid);
    if (t) setC({ ...c, subject: t.subject, preheader: t.preheader ?? "", mode: t.mode, body: t.body, data: t.mode === "text" ? null : t.data });
  };
  return (
    <Modal open onClose={onClose} title={cid ? `Chiến dịch: ${c.name || "chưa đặt tên"}` : "Chiến dịch mới"} size="xl"
      footer={!locked && <div className="flex flex-wrap gap-2">
        <Button icon={Eye} loading={busy === "pv"} onClick={() => run("pv", async () => { const r = await save(); return api.get(`email/campaigns/${r.id}/preview`); }, (r: any) => { setPreview(r); return null; })}>Xem trước</Button>
        <Button loading={busy === "save"} onClick={() => run("save", save, () => "Đã lưu nháp")}>Lưu nháp</Button>
        <Button variant="primary" icon={CheckCircle2} loading={busy === "submit"} onClick={() => run("submit", async () => { const r = await save(); return api.post(`email/campaigns/${r.id}/submit`); }, (r: any) => { onClose(); return `Đã gửi duyệt — ${r.recipients} người nhận. Duyệt ở trang Duyệt & Phê duyệt.`; })}>Gửi duyệt</Button>
      </div>}>
      <div className="space-y-4">
        {locked && <Alert tone="info">Chiến dịch {CAMPAIGN[c.status]?.label?.toLowerCase()} — không sửa được nữa.</Alert>}
        {stats && <div className="grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">{["sent", "delivered", "opened", "clicked", "bounced", "skipped"].map((k) => <div key={k} className="rounded-xl bg-soft p-2"><div className="text-lg font-semibold">{num(stats.total[k] ?? 0)}</div><div className="text-xs text-muted">{({ sent: "gửi", delivered: "tới hộp thư", opened: "mở", clicked: "click", bounced: "bounce", skipped: "bỏ qua" } as any)[k]}</div></div>)}</div>}
        {stats?.skipReasons?.length > 0 && <p className="text-xs text-muted">Bỏ qua: {stats.skipReasons.map((s: any) => `${SKIP[s.reason] ?? s.reason} ${s.n}`).join(" · ")}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tên chiến dịch"><input className={inputCls} disabled={locked} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
          <Field label="Người nhận"><select className={inputCls} disabled={locked} value={c.segmentId} onChange={(e) => setC({ ...c, segmentId: e.target.value })}><option value="">Mọi liên hệ đang nhận</option>{segs?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.member_count})</option>)}</select></Field>
          <Field label="Tiêu đề" hint="Biến: {{ho_ten|bạn}}, {{ten_thuong_hieu}}. Biến khác phải có dự phòng."><input className={inputCls} disabled={locked} value={c.subject} onChange={(e) => setC({ ...c, subject: e.target.value })} /></Field>
          <Field label="Preheader (dòng xem trước)" optional><input className={inputCls} disabled={locked} value={c.preheader} onChange={(e) => setC({ ...c, preheader: e.target.value })} /></Field>
          <Field label="Tiêu đề B (A/B test)" optional><input className={inputCls} disabled={locked} value={c.subjectB} onChange={(e) => setC({ ...c, subjectB: e.target.value })} /></Field>
          <Field label="% người nhận bản B" hint="0–50"><input type="number" min={0} max={50} className={inputCls} disabled={locked} value={c.abPct} onChange={(e) => setC({ ...c, abPct: e.target.value })} /></Field>
          <Field label="Hẹn giờ gửi" optional hint="Trống = gửi ngay khi được duyệt (trong khung giờ gửi)."><input type="datetime-local" className={inputCls} disabled={locked} value={c.scheduledAt} onChange={(e) => setC({ ...c, scheduledAt: e.target.value })} /></Field>
          <Field label="Gửi lại người chưa mở sau (giờ)" optional hint="Cần webhook Resend. Tối thiểu 6 giờ, gửi lại 1 lần."><input type="number" min={6} className={inputCls} disabled={locked} value={c.resendAfterHours ?? ""} onChange={(e) => setC({ ...c, resendAfterHours: e.target.value })} /></Field>
        </div>
        {!locked && tpl && <Field label="Bắt đầu từ mẫu" optional><select className={inputCls} value="" onChange={(e) => useTemplate(e.target.value)}><option value="">— chọn mẫu —</option>{tpl.templates.map((t: any) => <option key={t.id} value={t.id}>{t.system ? "★ " : ""}{t.name} ({t.mode === "text" ? "văn bản" : t.mode === "blocks" ? "khối" : "kéo thả"})</option>)}</select></Field>}
        {!locked && <EmailComposer mode={c.mode} onModeChange={(m) => setC({ ...c, mode: m })} body={c.body} data={c.data} onBody={(b) => setC((x: any) => ({ ...x, body: b }))} onData={(d) => setC((x: any) => ({ ...x, data: d }))} />}
        {!locked && cid && <div className="flex flex-wrap items-end gap-2"><Field label="Gửi thử tới" className="min-w-[16rem] flex-1"><input className={inputCls} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="email-cua-ban@gmail.com" /></Field>
          <Button icon={Send} loading={busy === "test"} disabled={!testTo} onClick={() => run("test", async () => { await save(); return api.post(`email/campaigns/${cid}/test`, { to: testTo }); }, () => "Đã gửi thư thử")}>Gửi thử</Button></div>}
      </div>
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.subject ?? "Xem trước"} size="lg">
        {preview?.errors?.length > 0 && <Alert tone="danger" title="Chưa gửi duyệt được">{preview.errors.join(" · ")}</Alert>}
        {preview?.html && <iframe title="preview" sandbox="" srcDoc={preview.html} className="mt-2 h-[65vh] w-full rounded-xl border border-line bg-white" />}
      </Modal>
    </Modal>
  );
}

// ---------------- Chuỗi tự động ----------------
function Sequences() {
  const { busy, run } = useRun();
  const { data, reload } = useApi<any[]>("email/sequences", EV);
  const { data: presets } = useApi<any[]>("email/sequence-presets");
  const [create, setCreate] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <Card title="Chuỗi email tự động" icon={ListOrdered} description="Dựng theo mẫu (Soap Opera, Ascension sau mua, Phục hồi giỏ…), AI viết từng email theo DNA, chấm điểm 2 tầng, kích hoạt qua Duyệt. Ghi danh tự động theo trigger."
        action={<Button variant="primary" icon={Plus} onClick={() => setCreate({ name: "", kind: "soap_opera", trigger: "tag_added", tag: "", goal: "purchase" })}>Chuỗi mới</Button>}>
        {!data ? <Loading /> : !data.length ? <Empty title="Chưa có chuỗi" /> : (
          <ul className="divide-y divide-line">{data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <button className="text-left" onClick={() => setOpen(s.id)}><b className="text-ink hover:underline">{s.name}</b> <Badge tone={SEQ[s.status]?.tone}>{SEQ[s.status]?.label ?? s.status}</Badge>
                <div className="text-xs text-muted">{s.steps} email · {TRIGGER[s.config?.trigger?.type] ?? "?"}{s.config?.trigger?.tag ? ` «${s.config.trigger.tag}»` : ""} · {num(s.active)} đang trong chuỗi · {num(s.sent)} thư đã gửi</div></button>
              <Button size="sm" onClick={() => setOpen(s.id)}>Mở</Button>
            </li>))}</ul>
        )}
      </Card>
      <Modal open={Boolean(create)} onClose={() => setCreate(null)} title="Chuỗi mới"
        footer={<Button variant="primary" loading={busy === "create"} onClick={() => run("create", () => api.post("email/sequences", {
          name: create.name || undefined, kind: create.kind,
          config: { trigger: create.trigger === "tag_added" ? { type: "tag_added", tag: create.tag } : { type: create.trigger }, goal: { type: create.goal } },
        }), (r: any) => { setCreate(null); reload(); setOpen(r.id); return "Đã tạo khung chuỗi — bấm «AI viết tất cả» để có nội dung"; })}>Tạo</Button>}>
        {create && <div className="space-y-3">
          <Field label="Loại chuỗi"><select className={inputCls} value={create.kind} onChange={(e) => setCreate({ ...create, kind: e.target.value })}>
            {presets?.map((p) => <option key={p.key} value={p.key}>{p.name} ({p.steps} email)</option>)}<option value="custom">Tự soạn (trống)</option></select></Field>
          <p className="text-xs text-muted">{presets?.find((p) => p.key === create.kind)?.description}</p>
          <Field label="Tên" optional><input className={inputCls} value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} /></Field>
          <Field label="Ai được ghi danh"><select className={inputCls} value={create.trigger} onChange={(e) => setCreate({ ...create, trigger: e.target.value })}>{Object.entries(TRIGGER).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          {create.trigger === "tag_added" && <Field label="Thẻ"><input className={inputCls} value={create.tag} onChange={(e) => setCreate({ ...create, tag: e.target.value })} placeholder="vd. lead-moi" /></Field>}
          <Field label="Mục tiêu"><select className={inputCls} value={create.goal} onChange={(e) => setCreate({ ...create, goal: e.target.value })}><option value="purchase">Khách mua hàng → dừng chuỗi</option><option value="none">Không (chạy hết chuỗi)</option></select></Field>
        </div>}
      </Modal>
      {open && <SequenceEditor id={open} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function SequenceEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const { busy, run } = useRun();
  const { data: s, reload } = useApi<any>(`email/sequences/${id}`, ["email.sequence_generated"]);
  const { data: contacts } = useApi<any>("email/contacts?limit=500");
  const [step, setStep] = useState<any>(null);
  const [score, setScore] = useState<any>(null);
  const [enrollIds, setEnrollIds] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<any>(null);
  if (!s) return <Modal open onClose={onClose} title="Chuỗi email"><Loading /></Modal>;
  const editable = s.status !== "awaiting_approval";
  return (
    <Modal open onClose={onClose} size="xl" title={<span>{s.name} <Badge tone={SEQ[s.status]?.tone}>{SEQ[s.status]?.label}</Badge></span>}
      description={`${TRIGGER[s.config?.trigger?.type] ?? ""}${s.config?.trigger?.tag ? ` «${s.config.trigger.tag}»` : ""} · mục tiêu: ${s.config?.goal?.type === "purchase" ? "mua hàng" : "không"} · đang trong chuỗi ${s.enrollments?.active ?? 0}, xong ${s.enrollments?.done ?? 0}, đạt mục tiêu ${s.enrollments?.goal_met ?? 0}`}
      footer={<div className="flex flex-wrap gap-2">
        <Button icon={Sparkles} loading={busy === "genall"} disabled={!editable} onClick={() => run("genall", () => api.post(`email/sequences/${id}/generate-all`), () => "AI đang viết các email còn trống — trang tự cập nhật khi xong")}>AI viết tất cả</Button>
        <Button icon={BarChart3} loading={busy === "score"} onClick={() => run("score", () => api.post(`email/sequences/${id}/score`), (r: any) => { setScore(r); return `Điểm chuỗi ${r.chain.tong}/100`; })}>Chấm điểm</Button>
        {s.status === "active" ? <>
          <Button icon={Users} onClick={() => setEnrollIds([])}>Ghi danh thủ công</Button>
          <Button icon={Pause} loading={busy === "pause"} onClick={() => run("pause", () => api.post(`email/sequences/${id}/pause`), () => { reload(); return "Đã tạm dừng"; })}>Tạm dừng</Button>
        </> : <Button variant="primary" icon={CheckCircle2} loading={busy === "submit"} disabled={!editable} onClick={() => run("submit", () => api.post(`email/sequences/${id}/submit`), () => { reload(); return "Đã gửi duyệt kích hoạt — duyệt ở trang Duyệt & Phê duyệt"; })}>Gửi duyệt kích hoạt</Button>}
        <Button variant="ghost" icon={Trash2} loading={busy === "del"} onClick={() => run("del", () => api.del(`email/sequences/${id}`), () => { onClose(); return "Đã xoá chuỗi"; })}>Xoá</Button>
      </div>}>
      <div className="space-y-3">
        {score && <Alert tone={score.gate.duoc ? "ok" : "warn"} title={`Điểm chuỗi ${score.chain.tong}/100 — ${score.gate.duoc ? "đạt, kích hoạt được" : "chưa đạt"}`}>{[score.gate.lyDo, ...score.chain.loi].filter(Boolean).join(" · ")}</Alert>}
        <ol className="space-y-2">{s.steps.map((st: any, i: number) => {
          const sc = score?.perEmail?.[i];
          return (
            <li key={st.id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted">Ngày {st.day} · email {st.position + 1}{st.no_hard_sell ? " · cấm chào bán" : ""}{st.stats ? ` · gửi ${st.stats.sent}, mở ${st.stats.opened}, click ${st.stats.clicked}` : ""}{sc ? ` · điểm ${sc.tong}` : ""}</p>
                  <p className="font-medium text-ink">{st.subject || <span className="text-muted">({st.title || "chưa có tiêu đề"})</span>}</p>
                  <p className="line-clamp-2 text-xs text-muted">{st.mode === "text" ? st.body : `[${st.mode === "blocks" ? "khối" : "kéo thả"}]`}</p>
                  {st.status === "generating" && <Badge tone="violet">AI đang viết…</Badge>}{st.last_error && <Badge tone="red" wrap>{st.last_error}</Badge>}
                  {st.ctaViolations?.length > 0 && <Badge tone="red">CTA bán: {st.ctaViolations.join(", ")}</Badge>}
                  {st.errors?.length > 0 && st.body && <p className="text-xs text-red-600">{st.errors.join(" · ")}</p>}
                  {sc?.loi?.length > 0 && <p className="text-xs text-amber-700">{sc.loi.join(" · ")}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" icon={Eye} onClick={() => run("pv", () => api.get(`email/steps/${st.id}/preview`), (r) => { setPreview(r); return null; })} />
                  {editable && <Button size="sm" variant="ghost" icon={Sparkles} loading={busy === `g${st.id}`} onClick={() => run(`g${st.id}`, () => api.post(`email/steps/${st.id}/generate`), () => { reload(); return "AI đã viết lại"; })} />}
                  {editable && <Button size="sm" onClick={() => setStep({ id: st.id, title: st.title, delayDays: st.delay_days, subject: st.subject, preheader: st.preheader ?? "", mode: st.mode, body: st.body, data: st.mode === "text" ? null : st.data, noHardSell: Boolean(st.no_hard_sell), options: st.options })}>Sửa</Button>}
                  {editable && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => run("ds", () => api.del(`email/steps/${st.id}`), () => { reload(); return "Đã xoá email"; })} />}
                </div>
              </div>
            </li>);
        })}</ol>
        {editable && <Button icon={Plus} onClick={() => setStep({ title: "", delayDays: 1, subject: "", preheader: "", mode: "text", body: "", data: null, noHardSell: false })}>Thêm email</Button>}
      </div>
      {step && <Modal open onClose={() => setStep(null)} title={step.id ? "Sửa email" : "Email mới"} size="xl"
        footer={<Button variant="primary" loading={busy === "ss"} onClick={() => run("ss", () => api.post(`email/sequences/${id}/steps`, { ...step, delayDays: Number(step.delayDays), data: step.data ?? {}, options: undefined }), () => { setStep(null); reload(); return "Đã lưu"; })}>Lưu</Button>}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tên email"><input className={inputCls} value={step.title} onChange={(e) => setStep({ ...step, title: e.target.value })} /></Field>
            <Field label="Gửi sau (ngày)" hint="Tính từ email trước (email đầu: từ lúc ghi danh)"><input type="number" min={0} step={0.5} className={inputCls} value={step.delayDays} onChange={(e) => setStep({ ...step, delayDays: e.target.value })} /></Field>
            <Field label="Cấm chào bán"><select className={inputCls} value={String(step.noHardSell)} onChange={(e) => setStep({ ...step, noHardSell: e.target.value === "true" })}><option value="false">Không</option><option value="true">Có (kiểm CTA bán)</option></select></Field>
          </div>
          <Field label="Tiêu đề">{step.options?.length > 1 ? <select className={inputCls} value={step.subject} onChange={(e) => setStep({ ...step, subject: e.target.value })}>{[...new Set([step.subject, ...step.options])].map((o: string) => <option key={o} value={o}>{o}</option>)}</select> : null}
            <input className={cx(inputCls, step.options?.length > 1 && "mt-2")} value={step.subject} onChange={(e) => setStep({ ...step, subject: e.target.value })} /></Field>
          <Field label="Preheader" optional><input className={inputCls} value={step.preheader} onChange={(e) => setStep({ ...step, preheader: e.target.value })} /></Field>
          <EmailComposer mode={step.mode} onModeChange={(m) => setStep({ ...step, mode: m })} body={step.body} data={step.data} onBody={(b) => setStep((x: any) => ({ ...x, body: b }))} onData={(d) => setStep((x: any) => ({ ...x, data: d }))} />
        </div>
      </Modal>}
      {enrollIds && <Modal open onClose={() => setEnrollIds(null)} title="Ghi danh liên hệ vào chuỗi" size="lg"
        footer={<Button variant="primary" loading={busy === "en"} disabled={!enrollIds.length} onClick={() => run("en", () => api.post(`email/sequences/${id}/enroll`, { contactIds: enrollIds }), (r: any) => { setEnrollIds(null); reload(); return `Đã ghi danh ${r.added} người`; })}>Ghi danh {enrollIds.length}</Button>}>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto text-sm">{contacts?.contacts?.filter((c: any) => c.status === "active").map((c: any) => (
          <label key={c.id} className="flex items-center gap-2"><input type="checkbox" checked={enrollIds.includes(c.id)} onChange={(e) => setEnrollIds(e.target.checked ? [...enrollIds, c.id] : enrollIds.filter((x) => x !== c.id))} />{c.email} <span className="text-muted">{c.name}</span></label>))}</div>
      </Modal>}
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.subject ?? "Xem trước"} size="lg">
        {preview?.errors?.length > 0 && <Alert tone="warn">{preview.errors.join(" · ")}</Alert>}
        {preview?.html && <iframe title="preview" sandbox="" srcDoc={preview.html} className="mt-2 h-[65vh] w-full rounded-xl border border-line bg-white" />}
      </Modal>
    </Modal>
  );
}

// ---------------- Mẫu ----------------
function Templates() {
  const { busy, run } = useRun();
  const [mode, setMode] = useState("");
  const { data, reload } = useApi<any>(`email/templates${mode ? `?mode=${mode}` : ""}`);
  const [edit, setEdit] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const groups = useMemo(() => Object.fromEntries((data?.groups ?? []).map((g: any) => [g.key, g.name])), [data]);
  return (
    <Card title="Mẫu email" icon={FileText} description="★ = mẫu hệ thống (chép từ auto-funnel): 10 mẫu khối, 10 mẫu kéo thả, 40 email lẻ. Nhân bản để chỉnh."
      action={<div className="flex gap-2"><select className={cx(inputCls, "max-w-[10rem]")} value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Mọi kiểu</option><option value="text">Văn bản</option><option value="blocks">Khối</option><option value="dnd">Kéo thả</option></select>
        <Button variant="primary" icon={Plus} onClick={() => setEdit({ name: "", grp: "khac", subject: "", preheader: "", mode: "blocks", body: "", data: null })}>Mẫu mới</Button></div>}>
      {!data ? <Loading /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.templates.map((t: any) => (
          <div key={t.id} className="rounded-xl border border-line p-3 text-sm">
            <p className="font-medium text-ink">{t.system ? "★ " : ""}{t.name}</p>
            <p className="text-xs text-muted">{groups[t.grp] ?? t.grp} · {t.mode === "text" ? "văn bản" : t.mode === "blocks" ? "khối" : "kéo thả"}</p>
            <p className="mt-1 line-clamp-2 text-xs">{t.subject}</p>
            <div className="mt-2 flex gap-1">
              <Button size="sm" variant="ghost" icon={Eye} onClick={() => run("pv", () => api.post("email/preview", { subject: t.subject, preheader: t.preheader, mode: t.mode, body: t.body, data: t.data }), (r) => { setPreview(r); return null; })} />
              <Button size="sm" variant="ghost" icon={Copy} loading={busy === `d${t.id}`} onClick={() => run(`d${t.id}`, () => api.post(`email/templates/${t.id}/duplicate`), () => { reload(); return "Đã nhân bản"; })} />
              {!t.system && <Button size="sm" variant="ghost" onClick={() => setEdit({ ...t, data: t.mode === "text" ? null : t.data })}>Sửa</Button>}
              {!t.system && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => run("del", () => api.del(`email/templates/${t.id}`), () => { reload(); return "Đã xoá"; })} />}
            </div>
          </div>))}</div>
      )}
      {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? "Sửa mẫu" : "Mẫu mới"} size="xl"
        footer={<Button variant="primary" loading={busy === "save"} onClick={() => run("save", () => api.post("email/templates", { id: edit.id, name: edit.name, grp: edit.grp, subject: edit.subject, preheader: edit.preheader || null, mode: edit.mode, body: edit.body, data: edit.data ?? {} }), () => { setEdit(null); reload(); return "Đã lưu mẫu"; })}>Lưu</Button>}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tên mẫu"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Nhóm"><select className={inputCls} value={edit.grp} onChange={(e) => setEdit({ ...edit, grp: e.target.value })}>{data?.groups?.map((g: any) => <option key={g.key} value={g.key}>{g.name}</option>)}</select></Field>
            <Field label="Tiêu đề"><input className={inputCls} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
            <Field label="Preheader" optional><input className={inputCls} value={edit.preheader ?? ""} onChange={(e) => setEdit({ ...edit, preheader: e.target.value })} /></Field>
          </div>
          <EmailComposer mode={edit.mode} onModeChange={(m) => setEdit({ ...edit, mode: m })} body={edit.body} data={edit.data} onBody={(b) => setEdit((x: any) => ({ ...x, body: b }))} onData={(d) => setEdit((x: any) => ({ ...x, data: d }))} />
        </div>
      </Modal>}
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.subject ?? "Xem trước"} size="lg">
        {preview?.html && <iframe title="preview" sandbox="" srcDoc={preview.html} className="h-[65vh] w-full rounded-xl border border-line bg-white" />}
      </Modal>
    </Card>
  );
}

// ---------------- Chất lượng gửi ----------------
function Quality({ st }: { st: any }) {
  const { busy, run } = useRun();
  const { data, reload } = useApi<any>("email/deliverability", EV);
  const [sup, setSup] = useState("");
  if (!data) return <Loading />;
  const row = (label: string, w: any) => (
    <tr className="border-t border-line"><td className="py-2 pr-2 font-medium">{label}</td><td className="pr-2">{num(w.sent)}</td><td className="pr-2">{w.rates.delivered}%</td><td className="pr-2">{w.rates.opened}%</td><td className="pr-2">{w.rates.clicked}%</td>
      <td className={cx("pr-2", w.rates.bounced > 2 && "font-semibold text-red-600")}>{w.rates.bounced}%</td><td className={cx("pr-2", w.rates.complained > 0.07 && "font-semibold text-red-600")}>{w.rates.complained}%</td><td className="pr-2">{num(w.skipped)}</td><td>{vnd(w.revenue)}</td></tr>
  );
  return (
    <div className="space-y-6">
      <Card title="Chỉ số gửi" icon={BarChart3} description={`Tự giảm tốc 50% khi bounce > ${data.thresholds.throttleBounce}% hoặc khiếu nại > ${data.thresholds.throttleComplaint}% (24h, ≥50 thư); tự NGẮT khi bounce > ${data.thresholds.stopBounce}% hoặc khiếu nại > ${data.thresholds.stopComplaint}%.`}>
        {!st.hasWebhookSecret && <Alert tone="warn" className="mb-3">Chưa có webhook Resend — chưa đo được giao / mở / bounce / khiếu nại. Tab Tổng quan → Thiết lập tự động.</Alert>}
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-2" /><th>Gửi</th><th>Tới hộp thư</th><th>Mở</th><th>Click</th><th>Bounce</th><th>Khiếu nại</th><th>Bỏ qua</th><th>Doanh thu</th></tr></thead>
          <tbody>{row("24 giờ", data.day)}{row("7 ngày", data.week)}</tbody></table></div>
      </Card>
      <Card title="Danh sách loại trừ" icon={AlertTriangle} description="Bounce cứng, khiếu nại spam và địa chỉ thêm tay — không bao giờ gửi tới nữa.">
        <div className="mb-3 flex gap-2"><input className={cx(inputCls, "max-w-xs")} placeholder="email cần chặn" value={sup} onChange={(e) => setSup(e.target.value)} />
          <Button loading={busy === "sup"} disabled={!sup} onClick={() => run("sup", () => api.post("email/suppression", { email: sup }), () => { setSup(""); reload(); return "Đã thêm vào loại trừ"; })}>Thêm</Button></div>
        {!data.suppression.length ? <Empty title="Trống" /> : (
          <ul className="divide-y divide-line text-sm">{data.suppression.map((s: any) => (
            <li key={s.id} className="flex items-center justify-between py-2"><span>{s.email_masked} <Badge tone={s.reason === "manual" ? "gray" : "red"}>{({ hard_bounce: "bounce cứng", complaint: "khiếu nại", manual: "thêm tay" } as any)[s.reason] ?? s.reason}</Badge> <span className="text-xs text-muted">{timeAgo(s.created_at)}</span></span>
              {s.reason !== "complaint" && <Button size="sm" variant="ghost" onClick={() => run("rm", () => api.del(`email/suppression/${s.id}`), () => { reload(); return "Đã gỡ"; })}>Gỡ</Button>}</li>))}</ul>
        )}
      </Card>
      <RecentMessages />
    </div>
  );
}
