import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, MessageCircle, Phone, Play, Power, RefreshCw, Save, Square, UserPlus } from "lucide-react";
import { api, useApi } from "../lib/api";
import { ddmm, hhmm, timeAgo, type Tone } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, Toggle, cx, inputCls, useToast } from "../components/ui";

/** Chăm khách từ bình luận: bình luận → trả lời + inbox → xin SĐT → kết bạn Zalo → follow-up. */
const STAGE: Record<string, { label: string; tone: Tone }> = {
  new: { label: "Chờ xử lý", tone: "gray" },
  replied: { label: "Đã trả lời bình luận", tone: "blue" },
  dm_sent: { label: "Đã nhắn inbox", tone: "blue" },
  asked_contact: { label: "Đang xin SĐT", tone: "blue" },
  has_phone: { label: "Có SĐT", tone: "violet" },
  needs_check: { label: "Cần Sếp kiểm tra", tone: "amber" },
  friend_requested: { label: "Đã gửi kết bạn", tone: "amber" },
  friend_accepted: { label: "Đã kết bạn", tone: "green" },
  following_up: { label: "Đang follow-up Zalo", tone: "green" },
  ordered: { label: "Có đơn", tone: "green" },
  no_zalo: { label: "SĐT chưa có Zalo", tone: "red" },
  no_response: { label: "Khách chưa phản hồi", tone: "gray" },
  failed: { label: "Lỗi", tone: "red" },
  skipped: { label: "Bỏ qua", tone: "gray" },
  stopped: { label: "Đã dừng", tone: "gray" },
};
/** Trạng thái lạ (máy chủ mới thêm) vẫn hiện được, không vỡ trang. */
const stageOf = (k?: string | null): { label: string; tone: Tone } =>
  (k && STAGE[k]) || { label: k ? `Khác (${k.replace(/_/g, " ")})` : "Chưa rõ", tone: "gray" };

/** Loại bình luận (nhãn AI phân loại). */
const LABEL: Record<string, string> = {
  purchase_intent: "muốn đăng ký", question: "hỏi thông tin", praise: "khen", spam: "spam", negative: "chê/tiêu cực", other: "khác",
};
const labelOf = (k?: string | null) => (k ? LABEL[k] ?? k.replace(/_/g, " ") : "chưa phân loại");
/** Vì sao hệ không chăm bình luận này. */
const SKIP: Record<string, string> = {
  off: "chăm khách từ bình luận đang TẮT — bấm Bật ở đầu trang",
  label: "loại bình luận này không nằm trong danh sách cần chăm (hoặc là spam/chê)",
  duplicate_author: "người này đã được nhắn từ một bình luận khác dưới cùng bài rồi",
  duplicate: "bình luận này đã được ghi nhận trước đó",
  platform: "kênh này chưa hỗ trợ tự trả lời + nhắn inbox",
  page_comment: "đây là bình luận của chính Trang",
  dm_in_progress: "đang có một lượt khác nhắn cho khách này",
  not_found: "không tìm thấy bình luận",
  no_post: "không tìm thấy bài viết hoặc Trang của bình luận",
  unknown_page: "bình luận thuộc Trang chưa kết nối",
  no_phone: "khách chưa có SĐT",
  stage: "khách chưa tới bước kết bạn Zalo (hoặc bước này đang tắt)",
  not_due: "chưa tới giờ hẹn",
};
/** Vì sao tạm hoãn (sẽ tự làm lại sau). Lý do máy chủ đã viết sẵn tiếng Việt thì giữ nguyên. */
const DEFER: Record<string, string> = {
  public_cap: "đã đủ số lượt trả lời công khai hôm nay",
  dm_cap: "đã đủ số tin inbox hôm nay",
  killed: "đang bật Dừng khẩn cấp chat",
  quiet: "đang giờ yên lặng — để sáng mai",
  no_connection: "chưa kết nối ZL-CRM (phần mềm quản lý Zalo)",
  no_nick: "ZL-CRM chưa có tài khoản Zalo nào",
  cap: "tài khoản Zalo đã đủ số lời mời kết bạn hôm nay",
  error: "gặp lỗi khi gửi — hệ sẽ thử lại sau",
};
const deferOf = (k: string) => DEFER[k] ?? k;
/** Trạng thái lượt follow-up Zalo. */
const FU: Record<string, string> = { active: "đang chờ gửi", awaiting_approval: "chờ Sếp duyệt", done: "đã gửi xong", stopped: "đã dừng" };

const STEPS: [key: string, label: string, hint: string][] = [
  ["replyComment", "Trả lời dưới bình luận", "Câu ngắn xoay vòng, đăng bằng chính Trang"],
  ["privateReply", "Nhắn inbox cho khách", "Tin nhắn riêng gửi từ bình luận — 1 lần / bình luận, trong 7 ngày"],
  ["askContact", "Xin SĐT/Zalo", "Tự nhận SĐT trong tin khách trả lời; nhắc 1 lần nếu chưa cho"],
  ["zaloFriend", "Kết bạn Zalo", "Qua ZL-CRM (phần mềm quản lý Zalo), dùng tài khoản Zalo chọn bên dưới"],
  ["zaloFollowUp", "Follow-up Zalo", "Theo cài đặt trang Follow-up Zalo (duyệt nếu bật)"],
];
const TPL: [key: string, label: string][] = [
  ["replyTemplates", "Trả lời bình luận (mỗi dòng 1 mẫu, xoay vòng)"],
  ["dmTemplates", "Tin inbox đầu tiên (mỗi dòng 1 mẫu; muốn xuống dòng trong mẫu thì viết \\n)"],
  ["friendGreetingTemplates", "Lời chào khi gửi kết bạn Zalo (mỗi dòng 1 mẫu, tối đa ~150 ký tự)"],
];
/** Ô số: [khoá, nhãn, nhỏ nhất, lớn nhất, bước, gợi ý] — khớp giới hạn máy chủ. */
const NUMS: [key: string, label: string, min: number, max: number, step: number, hint?: string][] = [
  ["maxPublicRepliesPerDay", "Trả lời công khai/ngày/Trang", 0, 500, 1, "0 = tạm ngưng trả lời"],
  ["maxPrivateRepliesPerDay", "Inbox/ngày/Trang", 0, 500, 1, "0 = tạm ngưng nhắn inbox"],
  ["maxFriendRequestsPerNickPerDay", "Kết bạn/ngày/tài khoản Zalo", 0, 60, 1, "Zalo dễ khoá tài khoản nếu quá ~20"],
  ["reminderAfterHours", "Nhắc xin SĐT sau (giờ)", 0.5, 23, 0.5],
  ["giveUpAfterHours", "Thôi chăm nếu chưa có SĐT sau (giờ)", 6, 336, 1],
  ["friendDelayMinMinutes", "Giãn cách kết bạn từ (phút)", 0, 240, 1],
  ["friendDelayMaxMinutes", "đến (phút)", 0, 1440, 1],
];
const toLines = (a: string[]) => (a ?? []).map((x) => x.replace(/\n/g, "\\n")).join("\n");
const fromLines = (s: string) => s.split("\n").map((x) => x.trim().replace(/\\n/g, "\n")).filter(Boolean);
const isWide = () => { try { return window.matchMedia("(min-width: 1280px)").matches; } catch { return true; } };

function ErrorBox({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
      <p className="font-medium">Không tải được dữ liệu.</p>
      <p className="mt-1 text-xs opacity-80">Chi tiết: {text}</p>
      <Button size="sm" className="mt-3" icon={RefreshCw} onClick={onRetry}>Thử lại</Button>
    </div>
  );
}

export function Nurture() {
  const toast = useToast();
  const { data, error, reload } = useApi<any>("nurture", ["nurture.", "conversation.", "approval."]);
  const [stage, setStage] = useState("");
  const { data: leads, error: leadsError, reload: reloadLeads } = useApi<any[]>(`nurture/leads${stage ? `?stage=${stage}` : ""}`, ["nurture.", "conversation."]);
  const [f, setF] = useState<any>(null);
  const [tpl, setTpl] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirmOn, setConfirmOn] = useState(false);
  const [showSettings, setShowSettings] = useState(isWide);
  // Nạp form từ máy chủ — chỉ khi Sếp chưa sửa dở (dữ liệu tự làm mới theo tin nhắn không được xoá chữ đang gõ).
  useEffect(() => {
    if (!data || dirty) return;
    setF(data.settings);
    setTpl(Object.fromEntries(TPL.map(([k]) => [k, toLines(data.settings[k])])));
  }, [data, dirty]);
  const all = () => { void reload(); void reloadLeads(); };
  const run = async (key: string, fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast(ok(r)); all(); return r; } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  if (!data) return error ? <ErrorBox text={error} onRetry={() => void reload()} /> : <Loading />;
  if (!f) return <Loading />;
  const set = (k: string, v: any) => { setF({ ...f, [k]: v }); setDirty(true); };
  const fu = data.funnel;
  const enabled = Boolean(data.settings.enabled);
  const anyLive = data.pages.some((p: any) => p.live);

  /** Bật/tắt lưu ngay (không phụ thuộc nút Lưu của phần Cài đặt). */
  const setEnabled = (on: boolean) => run("enable", async () => { await api.put("nurture/settings", { enabled: on }); await reload(); },
    () => (on ? "Đã BẬT chăm khách từ bình luận" : "Đã TẮT chăm khách từ bình luận"));

  const save = async () => {
    const out: Record<string, number> = {};
    const notes: string[] = [];
    for (const [k, label, min, max] of NUMS) {
      const raw = String(f[k] ?? "").trim();
      if (raw === "") { out[k] = data.defaults?.[k] ?? data.settings[k]; notes.push(`"${label}" để trống → dùng mặc định ${out[k]}`); continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < min || n > max) return toast(`"${label}" phải từ ${min} đến ${max}`, "err");
      out[k] = n;
    }
    if (out.friendDelayMaxMinutes < out.friendDelayMinMinutes) return toast("Giãn cách kết bạn: số phút \"đến\" phải lớn hơn hoặc bằng số phút \"từ\"", "err");
    if (!f.labels?.length) return toast("Chọn ít nhất 1 loại bình luận cần chăm", "err");
    for (const [k, label] of TPL) if (!fromLines(tpl[k] ?? "").length) return toast(`Mục "${label.split(" (")[0]}" cần ít nhất 1 mẫu`, "err");
    setBusy("save");
    try {
      await api.put("nurture/settings", {
        steps: f.steps, labels: f.labels, confirmTemplate: f.confirmTemplate, reminderTemplate: f.reminderTemplate,
        ...Object.fromEntries(TPL.map(([k]) => [k, fromLines(tpl[k] ?? "")])),
        ...out,
        zaloAccountId: f.zaloAccountId || null,
      });
      await reload();
      setDirty(false); // → nạp lại form từ bản vừa lưu trên máy chủ
      toast(notes.length ? `Đã lưu cài đặt. ${notes.join("; ")}.` : "Đã lưu cài đặt", notes.length ? "info" : "ok");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };

  const runNow = () => {
    if (!enabled) return toast("Chăm khách từ bình luận đang TẮT — bấm \"Bật\" ở đầu trang trước khi chạy.", "info");
    void run("run", () => api.post("nurture/run"), (r) =>
      `Đã kiểm tra ${r.poll.posts} bài (${r.poll.added} bình luận mới) · nhắn inbox ${r.tick.started} khách · gửi ${r.tick.friendRequests} lời mời kết bạn Zalo · ${r.tick.accepted} khách đồng ý kết bạn`);
  };
  const funnel: [string, number][] = [
    ["Bình luận", fu.comments], ["Đã trả lời", fu.replied], ["Đã inbox", fu.dm], ["Khách trả lời", fu.customerReplied], ["Có SĐT", fu.phone],
    ["Đã gửi kết bạn", fu.friendRequested], ["Đã kết bạn", fu.friendAccepted], ["Đang follow-up", fu.followUp], ["Có đơn", fu.ordered],
  ];
  const top = Math.max(1, ...funnel.map(([, v]) => v));
  const zaloText = data.zalo.connected
    ? `ZL-CRM thật · ${data.zalo.accounts.length} tài khoản Zalo`
    : "chưa kết nối ZL-CRM thật (phần mềm quản lý Zalo)";

  return (
    <div className="space-y-6">
      <PageHeader title="Chăm khách từ bình luận" subtitle="Khách bình luận hỏi khóa học dưới bài Facebook → trả lời ngay dưới bình luận + nhắn inbox xin SĐT/Zalo → kết bạn Zalo → follow-up tự động. Chỉ chăm bình luận muốn đăng ký / hỏi, bỏ qua spam. Chỉ chạy với Fanpage + ZL-CRM thật."
        actions={<>
          <Button variant="primary" icon={Play} loading={busy === "run"} onClick={runNow}>Chạy ngay</Button>
        </>} />

      {/* Trạng thái bật/tắt — đặt trên cùng cho Sếp thấy ngay */}
      {enabled ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 sm:flex-row sm:items-center">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-300" />
          <div className="min-w-0 flex-1 text-sm text-emerald-900 dark:text-emerald-100">
            <p className="font-semibold">Chăm khách từ bình luận đang BẬT</p>
            <p className="text-emerald-800/80 dark:text-emerald-200/80">Hệ đang tự trả lời công khai dưới bình luận và nhắn inbox xin SĐT cho khách {anyLive ? "thật trên Fanpage" : "— nhưng chưa có Fanpage thật kết nối nên chưa làm gì"}.</p>
          </div>
          <Button icon={Power} loading={busy === "enable"} onClick={() => void setEnabled(false)}>Tắt</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
          <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-300" />
          <div className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100">
            <p className="font-semibold">Chăm khách từ bình luận đang TẮT</p>
            <p className="text-amber-800/90 dark:text-amber-200/80">Khi bật, hệ sẽ tự trả lời công khai dưới bình luận và nhắn inbox xin SĐT cho khách thật trên Fanpage. Đang tắt thì hệ chỉ phân loại bình luận, không nhắn ai.</p>
          </div>
          <Button variant="primary" icon={Power} loading={busy === "enable"} onClick={() => setConfirmOn(true)}>Bật</Button>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <MessageCircle className="hidden h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400 sm:block" />
          <div className="min-w-[220px] flex-1">
            <p className="font-medium text-ink">Fanpage: {data.pages.length ? data.pages.map((p: any) => `${p.name}${p.live ? "" : " (chưa liên kết API — bỏ qua)"}`).join(", ") : "chưa có"} · Zalo: {zaloText}</p>
            <p className="text-xs text-muted">Hôm nay: {fu.today.replied} trả lời · {fu.today.dm} inbox · {fu.today.friendRequested} lời mời kết bạn. Hệ quét bình luận mới trên các bài 14 ngày gần đây của Fanpage mỗi 5 phút (cả bài Sếp tự đăng).</p>
          </div>
          {!data.zalo.connected && <Link to="/ads/integrations?p=zlcrm"><Button size="sm">Kết nối ZL-CRM</Button></Link>}
        </div>
      </Card>

      <Card title={`Phễu ${fu.days} ngày qua`}>
        <div className="space-y-1.5">
          {funnel.map(([label, v], i) => (
            <div key={label} className="flex items-center gap-2 text-sm sm:gap-3">
              <span className="w-24 shrink-0 text-xs text-muted sm:w-32 sm:text-sm">{label}</span>
              <div className="h-6 min-w-0 flex-1 rounded bg-soft">
                {v > 0 && <div className="flex h-6 items-center rounded bg-blue-600 px-2 text-xs font-medium text-white" style={{ width: `${Math.max(8, (v / top) * 100)}%` }}>{v}</div>}
              </div>
              <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted sm:block">{i > 0 && funnel[i - 1][1] ? `${Math.round((v / funnel[i - 1][1]) * 100)}%` : ""}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card className="order-2 xl:order-1" title="Khách từ bình luận" action={
          <select aria-label="Lọc theo trạng thái" className={cx(inputCls, "w-auto py-1 text-xs")} value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Tất cả</option>
            {Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>}>
          {!leads ? (leadsError ? <ErrorBox text={leadsError} onRetry={() => void reloadLeads()} /> : <Loading />) : leads.length === 0 ? <Empty>Chưa có khách nào{stage ? " ở trạng thái này" : ""}. Khi có người bình luận hỏi giá / muốn đăng ký dưới bài Facebook, họ sẽ hiện ở đây.</Empty> : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs text-muted">{["Khách", "Bình luận", "Trạng thái", "SĐT", "Cập nhật", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {leads.map((l) => (
                    <tr key={l.id} className="cursor-pointer align-top hover:bg-soft" onClick={() => setOpen(l.id)}>
                      <td className="px-2 py-2.5"><p className="font-medium text-ink">{l.author_name}</p><p className="max-w-[180px] truncate text-xs text-muted">{l.post_title}</p></td>
                      <td className="max-w-[240px] px-2 py-2.5 text-xs text-muted"><span className="line-clamp-2">{l.comment_text}</span></td>
                      <td className="px-2 py-2.5"><Badge tone={stageOf(l.stage).tone}>{stageOf(l.stage).label}</Badge>{l.last_error && <p className="mt-1 line-clamp-2 max-w-[200px] text-xs text-muted" title={l.last_error}>Chi tiết: {l.last_error}</p>}</td>
                      <td className="px-2 py-2.5 tabular-nums text-ink">{l.phone_masked ?? "—"}</td>
                      <td className="px-2 py-2.5 text-xs text-muted">{timeAgo(l.updated_at)}</td>
                      <td className="px-2 py-2.5 text-right"><Button size="sm" variant="ghost">Xem</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Trên điện thoại: Cài đặt nằm trước danh sách khách, gập lại cho gọn */}
        <Card className="order-1 xl:order-2" title={
          <button type="button" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings} className="flex items-center gap-2">
            Cài đặt
            {dirty && <Badge tone="amber">Chưa lưu</Badge>}
            <ChevronDown className={cx("h-4 w-4 text-muted transition", showSettings && "rotate-180")} />
          </button>
        } action={(showSettings || dirty) && <Button size="sm" variant="primary" icon={Save} loading={busy === "save"} onClick={() => void save()}>Lưu</Button>}>
          {!showSettings ? (
            <p className="text-xs text-muted">Các bước chăm, mẫu tin nhắn, giới hạn mỗi ngày, tài khoản Zalo dùng để kết bạn. <button type="button" className="font-medium text-blue-600 dark:text-blue-400" onClick={() => setShowSettings(true)}>Mở cài đặt</button></p>
          ) : (
          <div className="space-y-4">
            <div className="space-y-2 rounded-lg border border-line bg-soft p-3">
              {STEPS.map(([k, label, hint]) => <Row key={k} label={label} hint={hint}><Toggle checked={f.steps[k]} onChange={(v) => set("steps", { ...f.steps, [k]: v })} /></Row>)}
            </div>
            <Field label="Chăm bình luận loại">
              <div className="flex flex-wrap gap-3 text-sm text-ink">
                {[["purchase_intent", "Muốn đăng ký / hỏi giá"], ["question", "Hỏi thông tin"], ["praise", "Khen"]].map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={f.labels.includes(k)} onChange={(e) => set("labels", e.target.checked ? [...f.labels, k] : f.labels.filter((x: string) => x !== k))} />{l}</label>
                ))}
              </div>
            </Field>
            <p className="text-xs text-muted">Biến trong mẫu: <code>{"{ten}"}</code> tên khách · <code>{"{san_pham}"}</code> chương trình (khớp tên trong bài, theo DNA) · <code>{"{link}"}</code> link chương trình (bỏ trống nếu chưa có) · <code>{"{shop}"}</code> tên Trang.</p>
            {TPL.map(([k, label]) => (
              <Field key={k} label={label}><textarea rows={4} className={cx(inputCls, "text-xs")} value={tpl[k] ?? ""} onChange={(e) => { setTpl({ ...tpl, [k]: e.target.value }); setDirty(true); }} /></Field>
            ))}
            <Field label="Xác nhận khi nhận SĐT"><textarea rows={2} className={cx(inputCls, "text-xs")} value={f.confirmTemplate} onChange={(e) => set("confirmTemplate", e.target.value)} /></Field>
            <Field label="Nhắc xin SĐT (1 lần)"><textarea rows={2} className={cx(inputCls, "text-xs")} value={f.reminderTemplate} onChange={(e) => set("reminderTemplate", e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              {NUMS.map(([k, label, min, max, step, hint]) => (
                <Field key={k} label={label} hint={hint}><input type="number" inputMode="decimal" min={min} max={max} step={step} className={inputCls} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></Field>
              ))}
            </div>
            <Field label="Tài khoản Zalo dùng để kết bạn">
              <select className={inputCls} value={f.zaloAccountId ?? ""} onChange={(e) => set("zaloAccountId", e.target.value || null)}>
                <option value="">Tài khoản Zalo đầu tiên đang kết nối</option>
                {data.zalo.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name ?? a.id}{a.status && a.status !== "connected" ? " (mất kết nối)" : ""}</option>)}
              </select>
            </Field>
            <p className="text-xs text-muted">Luôn áp dụng: giờ yên lặng của doanh nghiệp · nút Dừng khẩn cấp chat · mỗi người chỉ được nhắn 1 lần / bài · không nhắn bình luận spam/tiêu cực · SĐT lưu mã hoá, chỉ hiện dạng che.</p>
            {dirty && <div className="flex items-center justify-end gap-3"><span className="text-xs font-medium text-amber-600 dark:text-amber-300">Có thay đổi chưa lưu</span><Button size="sm" variant="primary" icon={Save} loading={busy === "save"} onClick={() => void save()}>Lưu</Button></div>}
          </div>
          )}
        </Card>
      </div>

      {open && <LeadModal id={open} live={anyLive} onClose={() => setOpen(null)} onChanged={all} />}

      <Modal open={confirmOn} onClose={() => setConfirmOn(false)} title="Bật chăm khách từ bình luận?" footer={<>
        <Button onClick={() => setConfirmOn(false)}>Để sau</Button>
        <Button variant="primary" icon={Power} loading={busy === "enable"} onClick={async () => { await setEnabled(true); setConfirmOn(false); }}>Bật ngay</Button>
      </>}>
        <div className="space-y-2 text-sm text-ink">
          <p>Từ giờ, khi khách bình luận muốn mua / hỏi dưới bài Facebook, hệ sẽ <b>tự trả lời công khai</b> dưới bình luận và <b>nhắn inbox xin SĐT</b> cho khách thật trên Fanpage.</p>
          <p className="text-muted">Tin đã gửi không thu hồi được. Sếp tắt lại bất cứ lúc nào bằng nút "Tắt" ở đầu trang. Vẫn tôn trọng giờ yên lặng và nút Dừng khẩn cấp.</p>
          {!anyLive && <p className="text-xs text-muted">Hiện chưa có Fanpage thật kết nối (page token) — bật rồi cũng chưa có gì để chăm.</p>}
        </div>
      </Modal>

    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-ink">{label}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>{children}</div>;
}

type LeadAction = "dm" | "fr" | "stop";

function LeadModal({ id, live, onClose, onChanged }: { id: string; live: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data: l, error, reload } = useApi<any>(`nurture/leads/${id}`, ["nurture.", "conversation."]);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<LeadAction | null>(null);
  const act = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); void reload(); onChanged(); return true; } catch (e: any) { toast(e.message, "err"); return false; } finally { setBusy(null); }
  };
  const closed = l && ["stopped", "ordered"].includes(l.stage);
  const who = l?.author_name ?? "khách này";
  const CONFIRM: Record<LeadAction, { title: string; body: string; btn: string; danger?: boolean; run: () => Promise<boolean> }> = {
    dm: {
      title: "Gửi lại tin inbox?", btn: "Gửi lại",
      body: `Hệ sẽ nhắn lại tin inbox cho ${who}${live ? " — đây là khách thật trên Fanpage" : ""}. Tin đã gửi không thu hồi được.`,
      run: () => act("dm", () => api.post(`nurture/leads/${id}/resend`), "Đã gửi lại inbox"),
    },
    fr: {
      title: "Kết bạn Zalo ngay?", btn: "Kết bạn ngay",
      body: `Gửi lời mời kết bạn Zalo tới SĐT ${l?.phone_masked ?? ""} ngay bây giờ, bỏ qua giới hạn số lời mời mỗi ngày và thời gian giãn cách. Gửi dồn dập dễ bị Zalo khoá tài khoản.`,
      run: () => act("fr", () => api.post(`nurture/leads/${id}/friend`), "Đã gửi lời mời kết bạn Zalo"),
    },
    stop: {
      title: "Dừng chăm khách này?", btn: "Dừng hẳn", danger: true,
      body: `Hệ sẽ ngừng mọi tin nhắn, lời mời kết bạn và follow-up tự động cho ${who}. Không bật lại được cho khách này.`,
      run: () => act("stop", () => api.post(`nurture/leads/${id}/stop`), "Đã dừng chăm khách này"),
    },
  };
  const c = ask ? CONFIRM[ask] : null;
  const st = stageOf(l?.stage);
  return (
    <Modal open onClose={onClose} wide title={l ? <span className="flex items-center gap-2">{l.author_name} <Badge tone={st.tone}>{st.label}</Badge></span> : "Khách"}
      footer={l && <div className="flex flex-wrap gap-2">
        <Button icon={RefreshCw} loading={busy === "dm"} disabled={closed} onClick={() => setAsk("dm")}>Gửi lại inbox</Button>
        <Button icon={UserPlus} loading={busy === "fr"} disabled={closed || !l.phone_masked || ["friend_requested", "friend_accepted", "following_up"].includes(l.stage)} onClick={() => setAsk("fr")}>Kết bạn ngay</Button>
        {l.conversation_id && <Link to={`/chat?id=${l.conversation_id}`}><Button variant="ghost">Mở hội thoại</Button></Link>}
        <Button variant="ghost" icon={Square} loading={busy === "stop"} disabled={closed} onClick={() => setAsk("stop")}>Dừng</Button>
      </div>}>
      {!l ? (error ? <ErrorBox text={error} onRetry={() => void reload()} /> : <Loading />) : (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-line bg-soft p-3">
              <p className="text-xs text-muted">Bình luận dưới “{l.post?.title}”</p>
              <p className="mt-1 text-ink">{l.comment_text}</p>
              {l.post?.permalink && <a className="mt-1 inline-block text-xs text-blue-600 dark:text-blue-400" href={l.post.permalink} target="_blank" rel="noreferrer">Mở bài ↗</a>}
            </div>
            <p className="text-ink"><Phone className="mr-1 inline h-4 w-4 text-muted" />SĐT: <b>{l.phone_masked ?? "chưa có"}</b>{l.zalo_account_id && <span className="text-muted"> · tài khoản Zalo {l.meta?.nickName ?? l.zalo_account_id}</span>}</p>
            {!["friend_requested", "friend_accepted", "following_up", "ordered"].includes(l.stage) && (
              <div className="flex gap-2">
                <input className={inputCls} aria-label="SĐT của khách" placeholder="Nhập SĐT tay, vd 0912 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <Button loading={busy === "ph"} disabled={!phone.trim()} onClick={() => void act("ph", () => api.post(`nurture/leads/${id}/phone`, { phone }), "Đã lưu SĐT")}>Lưu</Button>
              </div>
            )}
            {l.last_error && <p className="text-xs text-muted">Chi tiết: {l.last_error}</p>}
            {l.followUps?.length > 0 && <p className="text-xs text-muted">Follow-up Zalo: {l.followUps.map((p: any) => `lần ${p.step + 1} · ${FU[p.status] ?? p.status}`).join(", ")} — <Link to="/zalo" className="text-blue-600 dark:text-blue-400">xem trang Follow-up Zalo</Link></p>}
            <div>
              <p className="mb-2 text-xs font-medium text-muted">Dòng thời gian</p>
              <ol className="space-y-2 border-l border-line pl-3">
                {(l.log ?? []).map((e: any, i: number) => (
                  <li key={i} className="text-xs"><span className="text-muted">{ddmm(e.at)} {hhmm(e.at)}</span> <span className="text-ink">{e.text}</span></li>
                ))}
              </ol>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Tin nhắn Messenger</p>
            {l.messages?.length ? (
              <div className="max-h-[420px] space-y-2 overflow-y-auto scroll-thin">
                {l.messages.map((m: any, i: number) => (
                  <div key={i} className={cx("max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm", m.direction === "in" ? "bg-soft text-ink" : "ml-auto bg-blue-600 text-white")}>
                    {m.body?.text}
                    <p className={cx("mt-0.5 text-[10px]", m.direction === "in" ? "text-muted" : "text-white/70")}>{hhmm(m.sent_at)}</p>
                  </div>
                ))}
              </div>
            ) : <Empty>Chưa có tin nhắn.</Empty>}
          </div>
        </div>
      )}
      <Modal open={Boolean(c)} onClose={() => setAsk(null)} title={c?.title ?? ""} footer={c && <>
        <Button onClick={() => setAsk(null)}>Huỷ</Button>
        <Button variant={c.danger ? "danger" : "primary"} loading={busy === ask} onClick={async () => { if (await c.run()) setAsk(null); }}>{c.btn}</Button>
      </>}>
        <p className="text-sm text-ink">{c?.body}</p>
      </Modal>
    </Modal>
  );
}
