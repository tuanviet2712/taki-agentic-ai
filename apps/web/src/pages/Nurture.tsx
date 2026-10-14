import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDown, ArrowUp, BellOff, CheckCircle2, ChevronDown, ClipboardCheck, MessageCircle, Phone, Play, Plus, Power, RefreshCw, Save, Search, Square, Trash2, UserPlus } from "lucide-react";
import { api, useApi } from "../lib/api";
import { ddmm, hhmm, timeAgo, type Tone } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, PlatformIcon, Toggle, cx, inputCls, useToast } from "../components/ui";

/** Chăm khách từ bình luận: bình luận → trả lời + inbox → xin SĐT → kết bạn Zalo → follow-up. */
const STAGE: Record<string, { label: string; tone: Tone }> = {
  new: { label: "Chờ xử lý", tone: "gray" },
  replied: { label: "Đã trả lời bình luận", tone: "blue" },
  dm_sent: { label: "Đã nhắn inbox", tone: "blue" },
  asked_contact: { label: "Đang xin SĐT", tone: "blue" },
  has_phone: { label: "Có SĐT", tone: "violet" },
  needs_check: { label: "Cần Sếp kiểm tra", tone: "amber" },
  awaiting_review: { label: "Chờ Sếp duyệt", tone: "amber" },
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
  platform_off: "đang tắt chăm khách trên nền tảng này — bật ở mục Nền tảng trong Cài đặt",
  page_comment: "đây là bình luận của chính Trang",
  dm_in_progress: "đang có một lượt khác nhắn cho khách này",
  not_found: "không tìm thấy bình luận",
  no_post: "không tìm thấy bài viết hoặc Trang của bình luận",
  unknown_page: "bình luận thuộc Trang chưa kết nối",
  no_phone: "khách chưa có SĐT",
  stage: "khách chưa tới bước kết bạn Zalo (hoặc bước này đang tắt)",
  not_due: "chưa tới giờ hẹn",
  opted_out: "khách đã báo không muốn nhận tin (danh sách khách không nhận tin)",
};
/** Vì sao tạm hoãn (sẽ tự làm lại sau). Lý do máy chủ đã viết sẵn tiếng Việt thì giữ nguyên. */
const DEFER: Record<string, string> = {
  public_cap: "đã đủ số lượt trả lời công khai hôm nay",
  dm_cap: "đã đủ số tin inbox hôm nay",
  platform_off: "đang tắt chăm khách trên nền tảng này",
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
/** Các loại mẫu tin: mỗi mẫu là 1 ô riêng (Enter = xuống dòng thật). multi = nhiều mẫu xoay vòng, mỗi khách nhận 1 mẫu. */
type TplDef = { key: string; label: string; hint: string; multi: boolean; softMax?: number; needLink?: boolean; noLink?: boolean };
const TPLS: TplDef[] = [
  { key: "replyTemplates", label: "Trả lời công khai dưới bình luận", hint: "Ai cũng thấy câu này dưới bài. Nên ngắn, báo khách xem tin nhắn; không ghi giá/link.", multi: true, noLink: true },
  { key: "dmTemplates", label: "Tin inbox đầu tiên", hint: "Tin nhắn riêng gửi vào hộp thư của khách (Private Reply) — nên có link sản phẩm và câu xin SĐT/Zalo.", multi: true, needLink: true },
  { key: "confirmTemplate", label: "Xác nhận khi khách gửi SĐT", hint: "Gửi ngay khi khách nhắn SĐT trong Messenger.", multi: false },
  { key: "reminderTemplate", label: "Nhắc xin SĐT (1 lần)", hint: "Chỉ gửi 1 lần nếu khách đã trả lời inbox mà chưa cho SĐT.", multi: false },
  { key: "friendGreetingTemplates", label: "Lời chào khi gửi kết bạn Zalo", hint: "Đi kèm lời mời kết bạn Zalo.", multi: true, softMax: 150 },
];
const TPL_MAX = 600;
/** Biến chèn vào mẫu (bấm để chèn đúng chỗ con trỏ). */
const PH: [code: string, label: string][] = [["{ten}", "Tên khách"], ["{san_pham}", "Chương trình"], ["{link}", "Link chương trình"], ["{shop}", "Tên Trang"]];
/** Ô số: [khoá, nhãn, nhỏ nhất, lớn nhất, bước, gợi ý] — khớp giới hạn máy chủ. */
const NUMS: [key: string, label: string, min: number, max: number, step: number, hint?: string][] = [
  ["maxPublicRepliesPerDay", "Trả lời công khai/ngày/Trang", 0, 500, 1, "0 = tạm ngưng trả lời"],
  ["maxPrivateRepliesPerDay", "Inbox/ngày/Trang", 0, 500, 1, "0 = tạm ngưng nhắn inbox"],
  ["maxFriendRequestsPerNickPerDay", "Kết bạn/ngày/tài khoản Zalo", 0, 60, 1, "Zalo dễ khoá tài khoản nếu quá ~20"],
  ["reminderAfterHours", "Nhắc xin SĐT sau (giờ)", 0.5, 23, 0.5],
  ["giveUpAfterHours", "Thôi chăm nếu chưa có SĐT sau (giờ)", 6, 336, 1],
  ["friendDelayMinMinutes", "Giãn cách kết bạn từ (phút)", 0, 240, 1],
  ["friendDelayMaxMinutes", "đến (phút)", 0, 1440, 1],
  ["reviewFirst", "Duyệt trước bao nhiêu khách đầu", 0, 100, 1, "Khách đầu tiên chờ Sếp duyệt mới gửi · 0 = không cần duyệt"],
];
/** Mẫu từ máy chủ → danh sách ô (mẫu đơn = 1 ô). */
const tplBoxes = (settings: any): Record<string, string[]> =>
  Object.fromEntries(TPLS.map((d) => [d.key, d.multi ? [...(settings[d.key] ?? [])] : [String(settings[d.key] ?? "")]]));
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
  const comments = useApi<any[]>("nurture/comments", ["nurture."]);
  const [f, setF] = useState<any>(null);
  const [tpl, setTpl] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirmOn, setConfirmOn] = useState(false);
  const [showSettings, setShowSettings] = useState(isWide);
  const [confirmSkip, setConfirmSkip] = useState(false);
  // Nạp form từ máy chủ — chỉ khi Sếp chưa sửa dở (dữ liệu tự làm mới theo tin nhắn không được xoá chữ đang gõ).
  useEffect(() => {
    if (!data || dirty) return;
    setF(data.settings);
    setTpl(tplBoxes(data.settings));
  }, [data, dirty]);
  const all = () => { void reload(); void reloadLeads(); void comments.reload(); };
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
  const rv = data.review ?? { active: false, first: 0, approved: 0, remaining: 0, pending: 0 };

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
    const tplOut: Record<string, any> = {};
    for (const d of TPLS) {
      const list = (tpl[d.key] ?? []).map((x) => x.replace(/\r\n/g, "\n").trim()).filter(Boolean);
      if (!list.length) return toast(`"${d.label}" cần ít nhất 1 mẫu`, "err");
      const bad = list.find((x) => x.length < 3 || x.length > TPL_MAX);
      if (bad) return toast(`"${d.label}": mỗi mẫu từ 3 đến ${TPL_MAX} ký tự (có mẫu đang ${bad.length} ký tự)`, "err");
      if (list.length > 10) return toast(`"${d.label}": tối đa 10 mẫu`, "err");
      tplOut[d.key] = d.multi ? list : list[0];
    }
    setBusy("save");
    try {
      await api.put("nurture/settings", {
        steps: f.steps, labels: f.labels,
        ...tplOut,
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
      r.poll.errors?.length ? `Lượt quét có lỗi: ${r.poll.errors[0]}` : `Đã kiểm tra ${r.poll.posts} bài (${r.poll.added} bình luận mới) · nhắn inbox ${r.tick.started} khách · gửi ${r.tick.friendRequests} lời mời kết bạn Zalo · ${r.tick.accepted} khách đồng ý kết bạn`);
  };
  const scanComments = () => void run("scan", async () => {
    const r = await api.post<any>("nurture/scan");
    if (r.errors?.length) toast(`Đọc được ${r.posts} bài; có lỗi: ${r.errors[0]}`, "err");
    else toast(r.skipped ?? `Đã quét ${r.posts} bài, nhận ${r.added} bình luận mới. Lượt quét này chỉ đọc và phân loại.`);
    return r;
  });
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
          <Button icon={RefreshCw} loading={busy === "scan"} disabled={!!busy} onClick={scanComments}>Quét bình luận</Button>
          <Button variant="primary" icon={Play} loading={busy === "run"} disabled={!!busy} onClick={runNow}>Chạy ngay</Button>
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
            <p className="text-amber-800/90 dark:text-amber-200/80">Bấm “Quét bình luận” để đọc và phân loại bình luận khi đang tắt. Bật chăm khách để hệ soạn trả lời công khai và inbox theo chế độ duyệt đã chọn.</p>
          </div>
          <Button variant="primary" icon={Power} loading={busy === "enable"} onClick={() => setConfirmOn(true)}>Bật</Button>
        </div>
      )}

      {/* Chế độ duyệt trước: N khách đầu chờ Sếp duyệt rồi mới gửi */}
      {rv.active && (
        <div className="flex flex-col gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 sm:flex-row sm:items-center">
          <ClipboardCheck className="h-6 w-6 shrink-0 text-sky-600 dark:text-sky-300" />
          <div className="min-w-0 flex-1 text-sm text-sky-900 dark:text-sky-100">
            <p className="font-semibold">Chế độ duyệt trước: còn {rv.remaining}/{rv.first} khách cần Sếp duyệt</p>
            <p className="text-sky-800/90 dark:text-sky-200/80">
              {enabled ? "Với những khách này, hệ soạn sẵn câu trả lời + tin inbox nhưng CHƯA gửi — Sếp xem ở hộp Duyệt, bấm Phê duyệt (hoặc sửa) thì mới gửi." : "Khi bật, những khách đầu tiên sẽ chờ Sếp duyệt trước khi hệ trả lời/nhắn."}
              {" "}Duyệt đủ {rv.first} khách thì hệ tự chạy. {rv.pending > 0 && <b>Đang có {rv.pending} khách chờ duyệt.</b>} Đổi số khách ở phần Cài đặt.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/approvals"><Button variant="primary" size="sm" icon={ClipboardCheck}>Mở hộp Duyệt{rv.pending ? ` (${rv.pending})` : ""}</Button></Link>
            <Button size="sm" onClick={() => setConfirmSkip(true)}>Bỏ qua, chạy tự động</Button>
          </div>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <MessageCircle className="hidden h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400 sm:block" />
          <div className="min-w-[220px] flex-1">
            <p className="font-medium text-ink">Fanpage: {data.pages.length ? data.pages.map((p: any) => `${p.name}${p.live ? "" : " (chưa liên kết API — bỏ qua)"}`).join(", ") : "chưa có"} · Zalo: {zaloText}</p>
            <p className="text-xs text-muted">Hôm nay: {fu.today.replied}/{data.settings.maxPublicRepliesPerDay} trả lời · {fu.today.dm}/{data.settings.maxPrivateRepliesPerDay} inbox · {fu.today.friendRequested} lời mời kết bạn. Hệ kiểm tra bài mới (trong 48 giờ) mỗi phút và quét đủ các bài 14 ngày gần đây mỗi 5 phút (cả bài Sếp tự đăng) hoặc ngay khi bấm "Chạy ngay".</p>
          </div>
          {!data.zalo.connected && <Link to="/ads/integrations?p=zlcrm"><Button size="sm">Kết nối ZL-CRM</Button></Link>}
        </div>
      </Card>

      <Card title="Bình luận gần đây" action={<Button size="sm" icon={RefreshCw} disabled={!!busy} loading={busy === "scan"} onClick={scanComments}>Quét bình luận</Button>}>
        {comments.error ? <ErrorBox text={comments.error} onRetry={comments.reload} /> : !comments.data ? <Loading /> : !comments.data.length ? <Empty>Chưa nhận bình luận. Bấm “Quét bình luận” để đọc các bài trong 14 ngày gần đây trên Fanpage đã kết nối.</Empty> : (
          <div className="max-h-80 space-y-3 overflow-y-auto scroll-thin">
            {comments.data.map((c: any) => <div key={c.id} className="rounded-xl bg-soft p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><b>{c.author}</b><Badge tone="gray">{c.label ?? "Đang phân loại"}</Badge><span className="text-xs text-muted">{timeAgo(c.external_created_at ?? c.created_at)}</span></div>
              <p className="mt-1 whitespace-pre-wrap break-words">{c.text}</p>
              <p className="mt-1 text-xs text-muted">{c.channel_name} · {c.post_title}{c.replied_at ? " · Đã trả lời" : ""}{c.dm_sent_at ? " · Đã inbox" : ""}</p>
              {c.post_permalink && <a href={c.post_permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">Mở bài trên Facebook</a>}
            </div>)}
          </div>
        )}
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

      <div className="grid gap-6 wide:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="order-2 wide:order-1" title="Khách từ bình luận" action={
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
                      <td className="px-2 py-2.5"><p className="flex items-center gap-1.5 font-medium text-ink"><PlatformIcon p={l.platform ?? "facebook"} size={16} /><span className="truncate">{l.author_name}</span></p><p className="max-w-[180px] truncate text-xs text-muted">{l.post_title}</p></td>
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
        <Card className="order-1 wide:order-2" title={
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
            <p className="rounded-lg bg-soft px-3 py-2 text-xs text-muted">Mẫu tin nhắn (trả lời bình luận, inbox, nhắc SĐT, lời chào Zalo) sửa ở khung <b>Mẫu tin nhắn</b> bên dưới — có xem trước tin khách nhận.</p>
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

      {showSettings && (
        <TemplateEditor tpl={tpl} dirty={dirty} saving={busy === "save"} onSave={() => void save()}
          onChange={(k, list) => { setTpl({ ...tpl, [k]: list }); setDirty(true); }} />
      )}

      <OptOutCard count={data.optoutCount ?? 0} />

      {open && <LeadModal id={open} live={anyLive} onClose={() => setOpen(null)} onChanged={all} />}

      <Modal open={confirmSkip} onClose={() => setConfirmSkip(false)} title="Bỏ qua chế độ duyệt trước?" footer={<>
        <Button onClick={() => setConfirmSkip(false)}>Để sau</Button>
        <Button variant="primary" loading={busy === "skip"} onClick={async () => { const r = await run("skip", () => api.post("nurture/review/skip"), (x) => `Đã chuyển sang chạy tự động${x.released ? ` — ${x.released} khách đang chờ duyệt sẽ được gửi theo luật thường` : ""}`); if (r) { setConfirmSkip(false); setDirty(false); } }}>Chạy tự động luôn</Button>
      </>}>
        <div className="space-y-2 text-sm text-ink">
          <p>Từ giờ hệ sẽ <b>tự trả lời công khai + nhắn inbox</b> cho khách bình luận mà không chờ Sếp duyệt.</p>
          {rv.pending > 0 && <p>{rv.pending} khách đang chờ duyệt sẽ được gửi tự động (vẫn theo giờ yên lặng, giới hạn mỗi ngày, Dừng khẩn cấp và danh sách khách không nhận tin).</p>}
          <p className="text-muted">Muốn duyệt lại, đặt "Duyệt trước bao nhiêu khách đầu" trong phần Cài đặt.</p>
        </div>
      </Modal>

      <Modal open={confirmOn} onClose={() => setConfirmOn(false)} title="Bật chăm khách từ bình luận?" footer={<>
        <Button onClick={() => setConfirmOn(false)}>Để sau</Button>
        <Button variant="primary" icon={Power} loading={busy === "enable"} onClick={async () => { await setEnabled(true); setConfirmOn(false); }}>Bật ngay</Button>
      </>}>
        <div className="space-y-2 text-sm text-ink">
          <p>Từ giờ, khi khách bình luận muốn mua / hỏi dưới bài Facebook, hệ sẽ <b>tự trả lời công khai</b> dưới bình luận và <b>nhắn inbox xin SĐT</b> cho khách{anyLive ? " thật trên Fanpage" : ""}.</p>
          {rv.active && <p><b>{rv.remaining} khách đầu tiên</b> sẽ chờ Sếp duyệt ở hộp Duyệt trước khi gửi (xem đúng câu sẽ gửi, sửa được). Sau đó hệ tự chạy.</p>}
          <p className="text-muted">Tin đã gửi không thu hồi được. Sếp tắt lại bất cứ lúc nào bằng nút "Tắt" ở đầu trang. Vẫn tôn trọng giờ yên lặng, nút Dừng khẩn cấp và danh sách khách không nhận tin.</p>
          {!anyLive && <p className="text-xs text-muted">Hiện chưa có Fanpage thật kết nối (page token) — bật rồi cũng chưa có gì để chăm.</p>}
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-ink">{label}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>{children}</div>;
}

type LeadAction = "dm" | "fr" | "stop" | "optout";

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
    optout: {
      title: "Thêm vào danh sách không nhận tin?", btn: "Không nhắn khách này nữa", danger: true,
      body: `${who} sẽ không nhận thêm tin tự động nào (trả lời bình luận, inbox, nhắc SĐT, kết bạn Zalo, bot trả lời, follow-up). Nhân viên vẫn trả lời tay được. Bỏ khỏi danh sách ở mục "Khách không nhận tin".`,
      run: () => act("optout", () => api.post("nurture/optouts", { leadId: id }), "Đã thêm vào danh sách khách không nhận tin"),
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
        <Button variant="ghost" icon={BellOff} loading={busy === "optout"} onClick={() => setAsk("optout")}>Không nhắn nữa</Button>
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

// ---------------- Mẫu tin nhắn: mỗi mẫu 1 ô + xem trước tin khách nhận ----------------
/** Cảnh báo cho 1 mẫu (thiếu link, quá dài, biến lạ…). */
function tplWarnings(d: TplDef, raw: string, preview?: string): { text: string; tone: "red" | "amber" }[] {
  const t = raw.trim();
  const out: { text: string; tone: "red" | "amber" }[] = [];
  if (!t) return [{ text: "Ô trống — sẽ bị bỏ khi lưu", tone: "amber" }];
  if (t.length < 3) out.push({ text: "Quá ngắn (ít nhất 3 ký tự)", tone: "red" });
  if (t.length > TPL_MAX) out.push({ text: `Dài ${t.length} ký tự — tối đa ${TPL_MAX}, rút gọn mới lưu được`, tone: "red" });
  if (d.needLink && !t.includes("{link}")) out.push({ text: "Mẫu này không có {link} — khách sẽ không nhận được link sản phẩm", tone: "amber" });
  if (d.noLink && (t.includes("{link}") || /https?:\/\//.test(t))) out.push({ text: "Trả lời công khai có link dễ bị Facebook ẩn / coi là spam — nên để link trong tin inbox", tone: "amber" });
  if (d.softMax && (preview ?? t).length > d.softMax) out.push({ text: `Zalo chỉ gửi ${d.softMax} ký tự đầu — phần sau bị cắt`, tone: "amber" });
  const unknown = [...t.matchAll(/\{[^{}\s]{1,20}\}/g)].map((m) => m[0]).filter((x) => !PH.some(([code]) => code === x));
  if (unknown.length) out.push({ text: `Biến lạ ${[...new Set(unknown)].join(", ")} sẽ hiện nguyên văn cho khách — chỉ dùng ${PH.map(([c]) => c).join(" ")}`, tone: "amber" });
  return out;
}

function TemplateEditor({ tpl, onChange, dirty, saving, onSave }: { tpl: Record<string, string[]>; onChange: (key: string, list: string[]) => void; dirty: boolean; saving: boolean; onSave: () => void }) {
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [pv, setPv] = useState<{ vars: any; map: Record<string, string> } | null>(null);
  const [pvError, setPvError] = useState<string | null>(null);
  const flat = TPLS.flatMap((d) => tpl[d.key] ?? []);
  const sig = JSON.stringify(flat);
  // Xem trước bằng đúng hàm điền mẫu của máy chủ (chờ Sếp gõ xong 0,4 giây rồi mới hỏi).
  useEffect(() => {
    if (!flat.length) return;
    const h = setTimeout(async () => {
      try {
        const r = await api.post("nurture/preview", { templates: flat });
        const map: Record<string, string> = {};
        flat.forEach((t, i) => { map[t] = r.items[i]; });
        setPv({ vars: r.vars, map });
        setPvError(null);
      } catch (e: any) { setPvError(e.message); }
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const insert = (key: string, i: number, code: string) => {
    const el = refs.current[`${key}:${i}`];
    const list = [...(tpl[key] ?? [])];
    const cur = list[i] ?? "";
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    list[i] = cur.slice(0, start) + code + cur.slice(end);
    onChange(key, list);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(start + code.length, start + code.length); } });
  };
  const move = (key: string, i: number, dir: -1 | 1) => {
    const list = [...(tpl[key] ?? [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    onChange(key, list);
  };

  return (
    <Card title={<span className="flex items-center gap-2">Mẫu tin nhắn {dirty && <Badge tone="amber">Chưa lưu</Badge>}</span>}
      action={dirty && <Button size="sm" variant="primary" icon={Save} loading={saving} onClick={onSave}>Lưu</Button>}>
      <div className="space-y-5">
        <div className="rounded-lg border border-line bg-soft p-3 text-xs text-muted">
          <p>Mỗi mẫu là 1 ô riêng — bấm <b>Enter</b> để xuống dòng như soạn tin bình thường. Bấm nút <b>Tên khách</b>, <b>Sản phẩm</b>… để chèn vào chỗ con trỏ; hệ tự thay bằng thông tin thật của từng khách.</p>
          <p className="mt-1"><code>{"{san_pham}"}</code> là chương trình khớp với tên trong bài (theo DNA); <code>{"{link}"}</code> bỏ trống nếu chưa có link — câu chứa nó sẽ được lược đi.</p>
          <p className="mt-1">Có nhiều mẫu thì <b>mỗi khách chỉ nhận 1 mẫu</b> (hệ xoay vòng để tin không lặp y hệt nhau), không phải nhận tất cả.</p>
          {pv && <p className="mt-1">Xem trước với khách mẫu: <b className="text-ink">{pv.vars.ten}</b> · sản phẩm <b className="text-ink">{pv.vars.san_pham}</b> · link <span className="break-all text-ink">{pv.vars.link}</span> · Trang <b className="text-ink">{pv.vars.shop}</b>{pv.vars.example ? " (ví dụ — DNA chưa có sản phẩm nào kèm link)" : ""}.</p>}
          {pvError && <p className="mt-1 text-rose-600">Không xem trước được: {pvError}</p>}
        </div>
        {TPLS.map((d) => {
          const list = tpl[d.key] ?? [];
          return (
            <section key={d.key} className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{d.label}{d.multi && <span className="ml-1 font-normal text-muted">· {list.length} mẫu, xoay vòng</span>}</p>
                  <p className="text-xs text-muted">{d.hint}</p>
                </div>
                {d.multi && <Button size="sm" icon={Plus} disabled={list.length >= 10} onClick={() => onChange(d.key, [...list, ""])}>Thêm mẫu</Button>}
              </div>
              {list.map((val, i) => {
                const preview = pv?.map[val];
                const warns = tplWarnings(d, val, preview);
                const over = val.trim().length > TPL_MAX;
                return (
                  <div key={i} className="grid gap-3 rounded-xl border border-line p-3 lg:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted">{d.multi ? `Mẫu ${i + 1}` : "Nội dung"}</span>
                        {d.multi && (
                          <span className="flex items-center gap-1">
                            <button type="button" aria-label="Đưa mẫu lên" title="Đưa lên" disabled={i === 0} onClick={() => move(d.key, i, -1)} className="rounded p-1 text-muted hover:bg-soft disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                            <button type="button" aria-label="Đưa mẫu xuống" title="Đưa xuống" disabled={i === list.length - 1} onClick={() => move(d.key, i, 1)} className="rounded p-1 text-muted hover:bg-soft disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                            <button type="button" aria-label="Xoá mẫu" title={list.length <= 1 ? "Cần ít nhất 1 mẫu" : "Xoá mẫu"} disabled={list.length <= 1} onClick={() => onChange(d.key, list.filter((_, j) => j !== i))} className="rounded p-1 text-muted hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
                          </span>
                        )}
                      </div>
                      <textarea ref={(el) => { refs.current[`${d.key}:${i}`] = el; }} rows={Math.min(8, Math.max(3, val.split("\n").length + 1))}
                        aria-label={`${d.label}${d.multi ? ` — mẫu ${i + 1}` : ""}`} className={cx(inputCls, "text-sm", over && "border-rose-500")}
                        value={val} onChange={(e) => { const next = [...list]; next[i] = e.target.value; onChange(d.key, next); }} />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted">Chèn:</span>
                        {PH.map(([code, label]) => (
                          <button key={code} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(d.key, i, code)}
                            className="rounded-full border border-line bg-card px-2 py-0.5 text-xs text-ink hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400" title={`Chèn ${code}`}>{label}</button>
                        ))}
                        <span className={cx("ml-auto text-xs tabular-nums", over ? "font-semibold text-rose-600" : "text-muted")}>{val.trim().length}/{TPL_MAX} ký tự</span>
                      </div>
                      {warns.map((w) => <p key={w.text} className={cx("flex items-start gap-1 text-xs", w.tone === "red" ? "text-rose-600" : "text-amber-700 dark:text-amber-300")}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w.text}</p>)}
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-xs font-medium text-muted">Xem trước tin khách nhận</p>
                      <div className="max-w-[95%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm bg-blue-600 px-3 py-2 text-sm text-white">
                        {val.trim() ? (preview ?? "…") : <span className="opacity-70">(trống)</span>}
                      </div>
                      {preview && <p className="mt-1 text-[11px] text-muted">{preview.length} ký tự sau khi điền</p>}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
        {dirty && <div className="flex items-center justify-end gap-3"><span className="text-xs font-medium text-amber-600 dark:text-amber-300">Có thay đổi chưa lưu</span><Button size="sm" variant="primary" icon={Save} loading={saving} onClick={onSave}>Lưu</Button></div>}
      </div>
    </Card>
  );
}

// ---------------- Khách không nhận tin (opt-out) ----------------
const OPT_CH: Record<string, string> = { facebook: "Bình luận Facebook", messenger: "Messenger", zalo: "Zalo", phone: "SĐT", website: "Website" };

function OptOutCard({ count }: { count: number }) {
  const toast = useToast();
  const [openList, setOpenList] = useState(false);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const h = setTimeout(() => setTerm(search.trim()), 300); return () => clearTimeout(h); }, [search]);
  const { data, error, reload } = useApi<any[]>(openList ? `nurture/optouts${term ? `?search=${encodeURIComponent(term)}` : ""}` : null, ["optout.", "nurture."]);
  const [add, setAdd] = useState<{ phone: string; name: string; reason: string } | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const doAdd = async () => {
    if (!add?.phone.trim()) return toast("Nhập SĐT của khách", "err");
    setBusy(true);
    try { await api.post("nurture/optouts", { phone: add.phone, name: add.name || undefined, reason: add.reason || undefined }); toast("Đã thêm vào danh sách khách không nhận tin"); setAdd(null); setOpenList(true); void reload(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const doDel = async () => {
    setBusy(true);
    try { await api.del(`nurture/optouts/${del.id}`); toast("Đã bỏ khỏi danh sách — khách sẽ lại nhận tin tự động"); setDel(null); void reload(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Card title={<button type="button" onClick={() => setOpenList(!openList)} aria-expanded={openList} className="flex items-center gap-2"><BellOff className="h-4 w-4 text-muted" />Khách không nhận tin <Badge>{count}</Badge><ChevronDown className={cx("h-4 w-4 text-muted transition", openList && "rotate-180")} /></button>}
      action={<Button size="sm" icon={Plus} onClick={() => setAdd({ phone: "", name: "", reason: "" })}>Thêm khách</Button>}>
      <p className="text-xs text-muted">Khách nhắn kiểu "đừng nhắn nữa", "hủy đăng ký", "spam quá"… được hệ tự đưa vào đây (bot chỉ gửi 1 câu xác nhận rồi im lặng). Khách trong danh sách <b>không nhận tin tự động nào</b>: trả lời bình luận, inbox, nhắc SĐT, kết bạn Zalo, bot trả lời, follow-up. Nhân viên vẫn trả lời tay được.</p>
      {openList && (
        <div className="mt-3 space-y-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className={cx(inputCls, "pl-9")} aria-label="Tìm khách không nhận tin" placeholder="Tìm theo tên, SĐT, lý do" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!data ? (error ? <ErrorBox text={error} onRetry={() => void reload()} /> : <Loading />) : data.length === 0 ? <Empty>{term ? "Không thấy khách nào khớp." : "Chưa có khách nào báo không nhận tin."}</Empty> : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs text-muted">{["Khách", "SĐT", "Kênh", "Lý do / câu khách nhắn", "Thêm lúc", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {data.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-2 py-2.5"><p className="font-medium text-ink">{r.name ?? "Khách"}</p><p className="text-xs text-muted">{r.source === "manual" ? `Sếp thêm tay${r.created_by ? ` (${r.created_by})` : ""}` : "Hệ tự nhận ra"}</p></td>
                      <td className="px-2 py-2.5 tabular-nums text-ink">{r.phone_masked ?? "—"}</td>
                      <td className="px-2 py-2.5 text-xs text-muted">{(r.channels ?? [r.channel]).map((c: string) => OPT_CH[c] ?? c).join(", ")}</td>
                      <td className="max-w-[240px] px-2 py-2.5 text-xs text-muted"><span className="line-clamp-2">{r.reason ?? "—"}</span></td>
                      <td className="px-2 py-2.5 text-xs text-muted">{ddmm(r.created_at)} {hhmm(r.created_at)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right">
                        {r.conversation_id && !String(r.conversation_id).startsWith("lead:") && <Link to={`/chat?id=${r.conversation_id}`}><Button size="sm" variant="ghost">Hội thoại</Button></Link>}
                        <Button size="sm" variant="ghost" onClick={() => setDel(r)}>Bỏ khỏi danh sách</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <Modal open={Boolean(add)} onClose={() => setAdd(null)} title="Thêm khách không nhận tin" footer={<>
        <Button onClick={() => setAdd(null)}>Huỷ</Button>
        <Button variant="primary" icon={BellOff} loading={busy} onClick={() => void doAdd()}>Thêm vào danh sách</Button>
      </>}>
        {add && <div className="space-y-3">
          <p className="text-sm text-muted">Dùng khi khách báo qua điện thoại / kênh khác. Hệ chỉ lưu SĐT dạng mã hoá một chiều (không đọc lại được) và hiện dạng che.</p>
          <Field label="SĐT của khách"><input className={inputCls} inputMode="tel" placeholder="vd 0912 345 678" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></Field>
          <Field label="Tên (không bắt buộc)"><input className={inputCls} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
          <Field label="Lý do (không bắt buộc)"><input className={inputCls} placeholder="vd Khách gọi điện xin dừng nhắn" value={add.reason} onChange={(e) => setAdd({ ...add, reason: e.target.value })} /></Field>
        </div>}
      </Modal>
      <Modal open={Boolean(del)} onClose={() => setDel(null)} title="Bỏ khách khỏi danh sách?" footer={<>
        <Button onClick={() => setDel(null)}>Huỷ</Button>
        <Button variant="danger" loading={busy} onClick={() => void doDel()}>Bỏ khỏi danh sách</Button>
      </>}>
        <p className="text-sm text-ink">{del?.name ?? "Khách này"}{del?.phone_masked ? ` (${del.phone_masked})` : ""} sẽ <b>lại nhận tin tự động</b> (bot trả lời, follow-up…). Chỉ làm khi khách đã đồng ý nhận tin trở lại.</p>
        <p className="mt-2 text-xs text-muted">Hội thoại đang ở trạng thái "khách từ chối" sẽ chuyển cho nhân viên; muốn bot trả lời lại thì bấm "Trả cho bot" ở trang Hội thoại.</p>
      </Modal>
    </Card>
  );
}
