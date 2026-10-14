import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Clapperboard, Clock, ExternalLink, Eye, ListChecks, RotateCcw, Send, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api";
import { CONTENT_STATUS, KIND_LABEL, ddmm, hhmm, num, timeAgo, type Tone } from "../lib/format";
import { Badge, Button, Card, Empty, JevBadge, Loading, Modal, PageHeader, PlatformIcon, cx, platformName, useToast } from "../components/ui";
import { ExistingPostLinkCard, LinkCommentCell, LinkCommentSettingsCard } from "../components/LinkComment";

const PLATFORMS = ["facebook", "instagram", "tiktok", "zalo", "website"];
const CH_LABEL: Record<string, string> = { zalo: "Zalo OA", website: "Website" };
const CH_COLOR: Record<string, string> = { facebook: "#1877F2", instagram: "#dc2743", tiktok: "#111827", zalo: "#0068FF", website: "#f97316" };
const WINDOWS = [
  { t: "08:00 – 10:00", note: "CEO đọc tin đầu ngày — hợp bài chia sẻ kinh nghiệm", w: 72 },
  { t: "11:00 – 13:00", note: "Nghỉ trưa — hợp video ngắn, case study", w: 58 },
  { t: "19:00 – 21:00", note: "Buổi tối — tương tác & bình luận hỏi học phí cao nhất", w: 90 },
];
const COMMENT_LABEL: Record<string, { label: string; tone: Tone }> = {
  purchase_intent: { label: "Ý định mua", tone: "green" }, question: { label: "Câu hỏi", tone: "blue" }, praise: { label: "Khen", tone: "violet" },
  negative: { label: "Tiêu cực", tone: "red" }, spam: { label: "Spam", tone: "gray" },
};
const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: "Đã lên lịch", tone: "blue" }, queued: { label: "Trong hàng đợi", tone: "blue" }, running: { label: "Đang đăng", tone: "violet" },
  done: { label: "Đã đăng", tone: "green" }, failed: { label: "Lỗi", tone: "red" }, cancelled: { label: "Đã hủy", tone: "gray" },
  posting: { label: "Đang đăng", tone: "violet" }, verifying: { label: "Đang xác minh", tone: "violet" },
  needs_check: { label: "Cần kiểm tra kênh", tone: "amber" }, // có thể ĐÃ lên bài — không tự đăng lại
  needs_setup: { label: "Chờ kết nối kênh", tone: "amber" }, // kênh chưa kết nối — CHƯA đăng gì
};
/** Lượt đăng cần Sếp xử lý: hiện lỗi + nút "Đăng lại" (đăng lại đúng lượt đó, không tạo bài trùng). */
const RETRYABLE = ["needs_check", "failed", "needs_setup"];
const scoreTone = (s: number): Tone => (s >= 70 ? "green" : s >= 40 ? "amber" : "gray");
const chName = (p: string) => CH_LABEL[p] ?? platformName(p);

type QueueItem = { key: string; contentId: string; kind?: string; title: string; channel: string; body?: string; at?: string | null; status: { label: string; tone: Tone }; jobId?: string; jobStatus?: string; mode?: string; error?: string | null; contentStatus?: string };

/** Một dòng trong "Bài chờ / sắp đăng": kênh · tiêu đề · trạng thái + giờ · hành động; lỗi/chờ kết nối hiện thành khối riêng bên dưới. */
/** Lượt chưa lên bài (chờ kết nối / lỗi chắc chắn chưa đăng / chờ giờ đăng) → Sếp đổi được kênh đăng. */
const MOVABLE = ["needs_setup", "failed", "scheduled"];

function QueueRow({ q, onPublish, onMove, onDelete }: { q: QueueItem; onPublish: () => void; onMove: () => void; onDelete: () => void }) {
  const [more, setMore] = useState(false);
  const retry = RETRYABLE.includes(q.jobStatus ?? "");
  const failed = q.jobStatus === "failed";
  const note = retry ? q.error : null;
  const longNote = (note?.length ?? 0) > 120 || (note?.split("\n").length ?? 0) > 2;
  const busyNow = q.jobStatus === "posting" || q.jobStatus === "verifying";
  return (
    <li className={cx("rounded-2xl border bg-card p-3.5 transition hover:shadow-sm sm:p-4", note ? (failed ? "border-danger/30" : "border-warn/40") : "border-line hover:border-line-strong")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-soft"><PlatformIcon p={q.channel} size={28} /></span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="line-clamp-2 break-words text-[15px] font-semibold leading-snug text-ink" title={q.title}>{q.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
            <Badge tone={q.status.tone} dot>{q.status.label}</Badge>
            {q.at && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden />{hhmm(q.at)} · {ddmm(q.at)}</span>}
            <span>{chName(q.channel)}</span>
          </div>
        </div>
        {busyNow ? null : (
          <div className="ml-auto flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="dangerSoft" icon={Trash2} onClick={onDelete} title="Xóa khỏi hàng đăng" aria-label={`Xóa "${q.title}"`}>Xóa</Button>
            {q.jobId && MOVABLE.includes(q.jobStatus ?? "") && <Button size="sm" variant="ghost" icon={ArrowLeftRight} onClick={onMove}>Đổi kênh</Button>}
            {q.kind === "video_script" && !retry
              ? <Link to={`/video-flow?from=${q.contentId}`}><Button size="sm" variant="soft" icon={Clapperboard}>Tạo video</Button></Link>
              : <Button size="sm" variant={retry ? "secondary" : "soft"} icon={retry ? RotateCcw : Send} onClick={onPublish}>{retry ? "Đăng lại" : "Đăng ngay"}</Button>}
          </div>
        )}
      </div>
      {note && (
        <div role="alert" className={cx("mt-3 flex items-start gap-2.5 rounded-xl border p-3 text-xs leading-relaxed", failed ? "border-danger/30 bg-danger-soft" : "border-warn/30 bg-warn-soft")}>
          <AlertTriangle className={cx("mt-0.5 h-4 w-4 shrink-0", failed ? "text-danger-ink" : "text-warn-ink")} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className={cx("whitespace-pre-line break-words text-ink", !more && "line-clamp-2")}>{note}</p>
            {longNote && <button type="button" onClick={() => setMore(!more)} className={cx("mt-1 font-medium hover:underline", failed ? "text-danger-ink" : "text-warn-ink")}>{more ? "Thu gọn" : "Xem đầy đủ"}</button>}
          </div>
        </div>
      )}
    </li>
  );
}

export function Publish() {
  const toast = useToast();
  const { data: channels } = useApi<any[]>("channels");
  const { data: posts, loading, reload: reloadPosts } = useApi<any[]>("posts", ["post."]);
  const { data: jobs, reload: reloadJobs } = useApi<any[]>("publish-jobs", ["post.", "task.", "approval."]);
  const { data: approved, reload: reloadApproved } = useApi<any[]>("content?status=approved", ["task.", "approval.", "post."]);
  // Video đã duyệt và đã lên NHÁP trên Fanpage (chưa công khai) vẫn phải nằm trong hàng đăng để Sếp bấm "Đăng ngay".
  const { data: drafted, reload: reloadDrafted } = useApi<any[]>("content?status=draft_on_channel", ["task.", "approval.", "post.", "creative."]);
  const { data: cal } = useApi<any>("calendar", ["post.", "task.", "approval."]);
  const { data: sys } = useApi<any>("system");
  const [confirm, setConfirm] = useState<QueueItem | null>(null);
  const [move, setMove] = useState<QueueItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<QueueItem | null>(null);
  const [delPost, setDelPost] = useState<any | null>(null);
  const moveTo = async (channel: any) => {
    if (!move?.jobId) return;
    setBusy(true);
    try {
      await api.post(`publish-jobs/${move.jobId}/channel`, { channelId: channel.id });
      toast(move.jobStatus === "scheduled" ? `Đã chuyển sang ${channel.name} — đăng đúng giờ đã hẹn` : `Đã chuyển sang ${channel.name} và đưa vào hàng đăng`);
      setMove(null);
      reloadJobs(); reloadApproved(); reloadDrafted();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  // Xóa nội dung khỏi hàng đăng (chưa lên bài): bỏ nội dung + lượt đăng chờ. Xóa bài đã đăng: chỉ ẨN khỏi danh sách, bài thật trên kênh giữ nguyên.
  const deleteQueued = async () => {
    if (!del) return;
    setBusy(true);
    try {
      await api.del(`content/${del.contentId}`);
      toast(`Đã xóa "${del.title}"`);
      setDel(null);
      reloadJobs(); reloadApproved(); reloadDrafted();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const deletePostRow = async () => {
    if (!delPost) return;
    setBusy(true);
    try {
      await api.del(`posts/${delPost.id}`);
      toast(`Đã xóa "${delPost.title}" khỏi danh sách`);
      setDelPost(null);
      reloadPosts();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const [detailId, setDetailId] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Chỉ bài HỆ THỐNG đã đăng công khai thành công (không gồm bài có sẵn trên Fanpage / bài mô phỏng), mới nhất trước.
  const published = (posts ?? []).filter((p) => p.content_item_id && !p.simulated && p.permalink && !p.meta?.draft); // bài nháp trên website chưa công khai
  const shown = showAll ? published : published.slice(0, 1);

  const queue = useMemo<QueueItem[]>(() => {
    const out: QueueItem[] = [];
    const seen = new Set<string>();
    for (const j of jobs ?? []) if (["scheduled", "queued", "running", "posting", "verifying", "failed", "needs_check", "needs_setup"].includes(j.status)) {
      seen.add(j.content_item_id);
      out.push({ key: j.id, contentId: j.content_item_id, kind: j.kind, title: j.title, channel: j.channel, body: j.body, at: j.scheduled_at, status: j.simulated && (j.status === "done" || j.status === "draft_uploaded") ? { label: "Mô phỏng · chưa đăng thật", tone: "amber" } : JOB_STATUS[j.status] ?? { label: j.status, tone: "gray" }, jobId: j.id, jobStatus: j.status, mode: j.mode, error: j.error });
    }
    for (const c of [...(approved ?? []), ...(drafted ?? [])]) if (!seen.has(c.id)) out.push({ key: c.id, contentId: c.id, kind: c.kind, title: c.title, channel: c.channel, body: c.body, at: c.scheduled_at ?? null, status: CONTENT_STATUS[c.status] ?? CONTENT_STATUS.approved, contentStatus: c.status });
    return out;
  }, [jobs, approved, drafted]);

  const publishNow = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      // Lượt đăng lỗi / "Cần kiểm tra" / chờ kết nối kênh → Đăng lại đúng lượt đó (Sếp đã kiểm tra kênh chưa có bài).
      if (confirm.jobId && RETRYABLE.includes(confirm.jobStatus ?? "")) await api.post(`publish-jobs/${confirm.jobId}/retry`);
      else await api.post(`content/${confirm.contentId}/publish-now`);
      toast(`Đã đưa "${confirm.title}" vào hàng đăng ngay`);
      setConfirm(null);
      reloadJobs(); reloadApproved(); reloadDrafted();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };

  const queueAttention = queue.filter((q) => RETRYABLE.includes(q.jobStatus ?? "")).length;
  const postCount = (p: string) => (posts ?? []).filter((x) => x.channel === p).length;
  const jevSource = sys?.jev?.enabled ? "jev" : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Trung tâm Đăng bài" subtitle="Lên lịch, quản lý và đăng nội dung đa kênh với Agentic AI." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {PLATFORMS.map((p) => {
          const ch = (channels ?? []).find((c) => c.platform === p);
          return (
            <div key={p} className="rounded-2xl border border-line bg-card p-4">
              <div className="flex items-center gap-2"><PlatformIcon p={p} size={28} /><p className="font-semibold text-ink">{chName(p)}</p></div>
              <p className="mt-2 truncate text-xs text-muted">{ch?.name ?? "Chưa kết nối"}</p>
              <div className="mt-2 flex items-center justify-between">
                {ch ? <Badge tone={!ch.enabled ? "gray" : ch.publishLive ? "green" : "amber"}>{!ch.enabled ? "Tạm tắt" : ch.publishLive ? "Đăng thật" : "Mô phỏng"}</Badge> : <Badge>Chưa có</Badge>}
                <span className="text-xs text-muted">{postCount(p)} bài</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="min-w-0 space-y-6">
        <MonthCalendar cal={cal} jobs={jobs ?? []} />
        <Card title="Bài chờ / sắp đăng" icon={ListChecks} description="Nội dung đã duyệt đang chờ tới giờ đăng hoặc cần bạn xử lý."
          action={<span className="flex items-center gap-2">
            {queueAttention > 0 && <Badge tone="amber" dot>{queueAttention} cần xử lý</Badge>}
            <Badge tone="blue">{queue.length}</Badge>
          </span>}>
          {!jobs && !approved ? <Loading /> : queue.length === 0 ? <Empty icon={ListChecks} title="Chưa có bài nào chờ đăng">Nội dung đã duyệt sẽ xuất hiện ở đây.</Empty> : (
            <ul className="space-y-2.5">
              {queue.map((q) => <QueueRow key={q.key} q={q} onPublish={() => setConfirm(q)} onMove={() => setMove(q)} onDelete={() => setDel(q)} />)}
            </ul>
          )}
        </Card>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card title={<span className="flex items-center gap-2"><Clock className="h-4 w-4 text-blue-600" />Khung giờ đăng gợi ý</span>}>
            <div className="space-y-3">
              {WINDOWS.map((w) => (
                <div key={w.t} className="space-y-1">
                  <div className="flex justify-between text-sm"><span className="font-semibold text-ink">{w.t}</span></div>
                  <p className="text-xs text-muted">{w.note}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Gợi ý chung theo thói quen đọc của chủ doanh nghiệp — CHƯA phải số đo từ kênh của Sếp (chưa có kênh thật nào được nối).</p>
          </Card>
          <LinkCommentSettingsCard />
        </div>
      </div>

      {((posts ?? []).some((p) => p.simulated) || (jobs ?? []).some((j) => j.simulated)) && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          <b>Đăng bài đang ở chế độ MÔ PHỎNG.</b> Các bài gắn nhãn "Mô phỏng" CHƯA lên Facebook / TikTok / Zalo / website thật — kênh chưa nối tài khoản thật nên hệ thống chỉ chạy thử luồng duyệt → đăng. Số tiếp cận và bình luận của những bài này là số giả lập.
        </div>
      )}
      <Card title={<span className="flex flex-wrap items-center gap-2">{showAll ? "Bài đã đăng công khai" : "Bài đăng công khai gần nhất"} <JevBadge source={jevSource} /></span>}
        action={published.length > 1 && <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Chỉ bài gần nhất" : `Xem tất cả (${published.length})`}</Button>}>
        <p className="-mt-1 mb-3 text-xs text-muted">Bình luận được Jev phân loại (ý định mua, câu hỏi, khen, tiêu cực, spam).</p>
        {loading ? <Loading /> : !published.length ? <Empty>Chưa có bài nào được hệ thống đăng công khai thành công.</Empty> : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">Bài viết</th><th className="px-3 font-medium">Đăng lúc</th><th className="px-3 font-medium">Tiếp cận</th>
                <th className="px-3 font-medium">Điểm</th><th className="px-3 font-medium">Bình luận (Jev)</th><th className="px-3 font-medium">Link dưới bình luận</th><th className="px-3" />
              </tr></thead>
              <tbody>
                {shown.map((p) => {
                  const m = p.metrics?.metrics ?? {};
                  const s = p.score;
                  const isOpen = open === p.id;
                  return (
                    <PostRow key={p.id} p={p} m={m} s={s} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : p.id)} onDetail={() => setDetailId(p.id)} onDelete={() => setDelPost(p)} onChanged={reloadPosts} />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ExistingPostLinkCard onChanged={reloadPosts} />

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Xác nhận đăng ngay"
        footer={<><Button onClick={() => setConfirm(null)}>Hủy</Button><Button variant="primary" icon={Send} loading={busy} onClick={publishNow}>Đăng lên {confirm && chName(confirm.channel)}</Button></>}>
        {confirm && (
          <div className="space-y-3">
            <div className="flex items-center gap-2"><PlatformIcon p={confirm.channel} size={24} />{confirm.channel === "website" && confirm.contentStatus === "draft_on_channel"
              ? <span className="text-sm text-muted">Bài đang là <b className="text-ink">bản nháp trên website</b> — sẽ chuyển chính bài đó sang <b className="text-ink">công khai</b> ngay bây giờ</span>
              : confirm.mode === "draft"
              ? <span className="text-sm text-muted">Sẽ tải lại <b className="text-ink">bản nháp video</b> lên <b className="text-ink">{chName(confirm.channel)}</b> (chưa đăng công khai)</span>
              : <span className="text-sm text-muted">Sẽ đăng công khai lên <b className="text-ink">{chName(confirm.channel)}</b> ngay bây giờ</span>}</div>
            <div className="rounded-xl border border-line bg-soft p-4">
              <p className="font-semibold text-ink">{confirm.title}</p>
              <p className="mt-2 max-h-60 overflow-auto whitespace-pre-line text-sm text-muted scroll-thin">{confirm.body || "(không có nội dung xem trước)"}</p>
            </div>
            {confirm.jobStatus === "needs_check" && <p className="rounded-lg border border-amber-600/30 bg-amber-500/[0.08] p-2 text-xs text-amber-700 dark:text-amber-300">Lần trước có thể ĐÃ đăng. Mở kênh {chName(confirm.channel)} kiểm tra — chỉ bấm Đăng lại khi chắc chắn chưa có bài (tránh đăng trùng).</p>}
            <p className="text-xs text-muted">Bài đăng lên kênh thật không thể thu hồi tự động. Hãy kiểm tra kỹ nội dung trước khi xác nhận.</p>
          </div>
        )}
      </Modal>
      <Modal open={!!del} onClose={() => setDel(null)} title="Xóa nội dung khỏi hàng đăng"
        footer={<><Button onClick={() => setDel(null)}>Hủy</Button><Button variant="danger" icon={Trash2} loading={busy} onClick={deleteQueued}>Xóa</Button></>}>
        {del && (
          <div className="space-y-3">
            <div className="flex items-center gap-2"><PlatformIcon p={del.channel} size={24} /><span className="text-sm text-muted">{chName(del.channel)} · {del.status.label}</span></div>
            <div className="rounded-xl border border-line bg-soft p-4">
              <p className="font-semibold text-ink">{del.title}</p>
              <p className="mt-2 max-h-40 overflow-auto whitespace-pre-line text-sm text-muted scroll-thin">{del.body || "(không có nội dung xem trước)"}</p>
            </div>
            <p className="text-sm text-ink">Nội dung và lượt đăng đang chờ của nó sẽ bị <b>xóa khỏi hệ thống</b> — hệ thống sẽ không đăng bài này nữa. Không thể hoàn tác.</p>
            {(del.mode === "draft" || del.contentStatus === "draft_on_channel") && <p className="rounded-lg border border-amber-600/30 bg-amber-500/[0.08] p-2 text-xs text-amber-700 dark:text-amber-300">Bản nháp đã tải lên {chName(del.channel)} (nếu có) vẫn còn trên kênh — hệ thống không xóa giúp, bạn tự xóa nháp đó trên kênh.</p>}
            {del.jobStatus === "needs_check" && <p className="rounded-lg border border-amber-600/30 bg-amber-500/[0.08] p-2 text-xs text-amber-700 dark:text-amber-300">Lượt đăng này "Cần kiểm tra" — bài có thể ĐÃ lên {chName(del.channel)}. Xóa ở đây không gỡ bài trên kênh.</p>}
          </div>
        )}
      </Modal>
      <Modal open={!!delPost} onClose={() => setDelPost(null)} title="Xóa bài khỏi danh sách"
        footer={<><Button onClick={() => setDelPost(null)}>Hủy</Button><Button variant="danger" icon={Trash2} loading={busy} onClick={deletePostRow}>Xóa khỏi danh sách</Button></>}>
        {delPost && (
          <div className="space-y-3">
            <div className="flex items-center gap-2"><PlatformIcon p={delPost.channel} size={24} /><span className="text-sm text-muted">{delPost.channel_name ?? chName(delPost.channel)} · đăng {timeAgo(delPost.published_at)}</span></div>
            <div className="rounded-xl border border-line bg-soft p-4"><p className="font-semibold text-ink">{delPost.title}</p></div>
            <p className="text-sm text-ink">Bài sẽ biến mất khỏi bảng này. <b>Bài thật trên {chName(delPost.channel)} vẫn còn</b> — muốn gỡ bài thật, bạn xóa trực tiếp trên kênh{delPost.permalink ? <> (<a href={delPost.permalink} target="_blank" rel="noreferrer" className="text-blue-600 underline">mở bài</a>)</> : null}.</p>
            <p className="text-xs text-muted">Số liệu, điểm bài và truy vết đơn hàng của bài này vẫn được giữ trong báo cáo.</p>
          </div>
        )}
      </Modal>
      <Modal open={!!move} onClose={() => setMove(null)} title="Đổi kênh đăng" footer={<Button onClick={() => setMove(null)}>Hủy</Button>}>
        {move && (
          <div className="space-y-3">
            <p className="text-sm text-muted"><b className="text-ink">{move.title}</b> · đang để {chName(move.channel)}. Chọn kênh mới{move.mode === "draft" ? " để tải bản nháp video" : ""}{move.jobStatus === "scheduled" ? " (giữ nguyên giờ đã hẹn)" : " — hệ thống đăng lại ngay trên kênh mới"}.</p>
            <ul className="space-y-2">
              {(channels ?? []).filter((c) => ["facebook", "instagram", "tiktok", "zalo", "website"].includes(c.platform)).map((c) => (
                <li key={c.id}>
                  <button type="button" disabled={busy} onClick={() => moveTo(c)} className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left hover:border-blue-500 hover:bg-blue-500/5 disabled:opacity-50">
                    <PlatformIcon p={c.platform} size={22} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{c.name}</span><span className="text-xs text-muted">{chName(c.platform)}</span></span>
                    <Badge tone={c.publishLive ? "green" : "amber"}>{c.publishLive ? "Đăng được" : "Chưa nối đăng"}</Badge>
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Kênh "Chưa nối đăng" vẫn chọn được, nhưng bài sẽ lại chờ kết nối — nối kênh ở trang <Link to="/channels" className="underline">Kênh đăng</Link>.</p>
          </div>
        )}
      </Modal>
      <PostDetail id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function PostRow({ p, m, s, isOpen, onToggle, onDetail, onDelete, onChanged }: { p: any; m: any; s: any; isOpen: boolean; onToggle: () => void; onDetail: () => void; onDelete: () => void; onChanged: () => void }) {
  return (
    <>
      <tr className="border-b border-line align-top hover:bg-soft/50">
        <td className="py-3 pr-3">
          <div className="flex gap-2">
            <PlatformIcon p={p.channel} size={22} />
            <div className="min-w-0"><p className="max-w-[280px] truncate font-medium text-ink">{p.title}</p><p className="text-xs text-muted">{KIND_LABEL[p.kind] ?? p.kind} · {p.channel_name}{p.content_item_id ? "" : " · bài có sẵn trên trang"}</p>{p.simulated ? <Badge tone="amber">Mô phỏng · chưa đăng thật</Badge> : p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">Xem bài công khai <ExternalLink className="h-3 w-3" /></a> : null}</div>
          </div>
        </td>
        <td className="px-3 py-3 text-xs text-muted">{timeAgo(p.published_at)}{p.metrics?.mark && <p>mốc đo {p.metrics.mark}</p>}</td>
        <td className="px-3 py-3 tabular-nums">{num(m.reach)}<p className="text-xs text-muted">{num((m.reactions ?? 0) + (m.comments ?? 0) + (m.shares ?? 0))} tương tác</p></td>
        <td className="px-3 py-3">
          {s ? (
            <button onClick={onToggle} title={(s.reasons ?? []).join("\n")} className="flex items-center gap-1">
              <Badge tone={scoreTone(s.score)}>{Math.round(s.score)}</Badge>
              {s.low_data ? <span className="text-[11px] text-muted">ít dữ liệu</span> : null}
              <ChevronRight className={cx("h-3.5 w-3.5 text-muted transition", isOpen && "rotate-90")} />
            </button>
          ) : <span className="text-xs text-muted">Chưa chấm</span>}
        </td>
        <td className="px-3 py-3">
          <div className="flex max-w-[260px] flex-wrap gap-1">
            {(p.comments ?? []).length === 0 ? <span className="text-xs text-muted">—</span> : p.comments.map((c: any) => (
              <Badge key={c.label} tone={COMMENT_LABEL[c.label]?.tone ?? "gray"}>{COMMENT_LABEL[c.label]?.label ?? c.label} {c.n}</Badge>
            ))}
          </div>
        </td>
        <td className="px-3 py-3"><LinkCommentCell p={p} onChanged={onChanged} /></td>
        <td className="px-3 py-3 text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" icon={Eye} onClick={onDetail}>Chi tiết</Button><Button size="sm" variant="dangerSoft" icon={Trash2} onClick={onDelete} title="Xóa khỏi danh sách" aria-label={`Xóa "${p.title}" khỏi danh sách`}>Xóa</Button></div></td>
      </tr>
      {isOpen && s && (
        <tr className="border-b border-line bg-soft/40">
          <td colSpan={7} className="px-4 py-3">
            <p className="mb-1 text-xs font-semibold text-ink">Vì sao bài được {Math.round(s.score)} điểm:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">{(s.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}</ul>
            {s.components && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries({ eng: "Tương tác", vel: "Tốc độ", intent: "Ý định mua", fmt: "Định dạng", fresh: "Độ mới", fit: "Khớp kế hoạch" }).map(([k, l]) => (
                  <span key={k} className="rounded-lg bg-card px-2 py-1 text-[11px] text-muted">{l}: <b className="text-ink">{Math.round((s.components[k] ?? 0) * 100)}%</b></span>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function MonthCalendar({ cal, jobs }: { cal: any; jobs: any[] }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState<string | null>(null);
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const events = useMemo(() => {
    const map = new Map<string, { title: string; channel: string; at: string; kind: string }[]>();
    const add = (at: string | null | undefined, e: { title: string; channel: string; kind: string }) => {
      if (!at) return;
      const k = key(new Date(at));
      map.set(k, [...(map.get(k) ?? []), { ...e, at }]);
    };
    for (const p of cal?.posts ?? []) add(p.at, { title: p.title, channel: p.channel, kind: "Đã đăng" });
    for (const i of cal?.items ?? []) if (!i.post_id && i.status !== "rejected") add(i.at, { title: i.title, channel: i.channel, kind: CONTENT_STATUS[i.status]?.label ?? i.status });
    for (const j of jobs) if (j.status === "scheduled" || j.status === "queued") add(j.scheduled_at, { title: j.title, channel: j.channel, kind: "Lịch đăng" });
    return map;
  }, [cal, jobs]);

  const start = new Date(cursor);
  start.setDate(1 - ((cursor.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const todayKey = key(new Date());
  const selEvents = sel ? events.get(sel) ?? [] : [];

  return (
    <Card title={<span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-600" />Lịch nội dung tháng {cursor.getMonth() + 1}/{cursor.getFullYear()}</span>}
      action={<div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="sm" variant="ghost" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
      </div>}>
      {!cal ? <Loading /> : (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted">{["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => <div key={d} className="py-1">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const k = key(d);
              const ev = events.get(k) ?? [];
              const inMonth = d.getMonth() === cursor.getMonth();
              return (
                <button key={k} onClick={() => setSel(sel === k ? null : k)} className={cx("flex min-h-[52px] flex-col items-start rounded-lg border p-1 text-left transition sm:min-h-[68px] sm:p-1.5",
                  sel === k ? "border-blue-500 bg-blue-500/5" : "border-line hover:bg-soft", !inMonth && "opacity-40")}>
                  <span className={cx("text-xs", k === todayKey ? "grid h-5 w-5 place-items-center rounded-full bg-blue-600 font-semibold text-white" : "text-ink")}>{d.getDate()}</span>
                  <div className="mt-auto flex flex-wrap gap-0.5">
                    {ev.slice(0, 6).map((e, i) => <span key={i} title={`${chName(e.channel)} · ${e.title}`} className="h-2 w-2 rounded-full" style={{ background: CH_COLOR[e.channel] ?? "#94a3b8" }} />)}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">{PLATFORMS.map((p) => <span key={p} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: CH_COLOR[p] }} />{chName(p)}</span>)}</div>
          {sel && (
            <div className="mt-3 space-y-2 rounded-xl bg-soft p-3">
              {selEvents.length === 0 ? <p className="text-xs text-muted">Không có nội dung trong ngày này.</p> : selEvents.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-sm"><PlatformIcon p={e.channel} size={18} /><span className="min-w-0 flex-1 truncate text-ink">{e.title}</span><span className="text-xs text-muted">{hhmm(e.at)}</span><Badge>{e.kind}</Badge></div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function PostDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: p } = useApi<any>(id ? `posts/${id}` : null, ["post."]);
  const marks = ["1h", "6h", "24h", "72h"];
  const ready = p && p.id === id;
  return (
    <Modal open={!!id} onClose={onClose} wide title={ready ? p.title : "Chi tiết bài đăng"}>
      {!ready ? <Loading /> : (
        <div className="space-y-5">
          {p.permalink && !p.simulated && (
            <a href={p.permalink} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 hover:bg-blue-500/15 dark:text-blue-300">
              <span className="min-w-0"><b>Bài công khai trên {p.channel_name ?? "kênh"}</b><span className="block truncate text-xs opacity-80">{p.permalink}</span></span>
              <ExternalLink className="h-4 w-4 shrink-0" />
            </a>
          )}
          {p.link?.state && p.link.state !== "none" && (
            <div className="rounded-xl border border-line p-3 text-sm">
              <p className="font-semibold text-ink">Link dưới bình luận</p>
              <p className="mt-1 text-xs text-muted">
                {p.link.state === "attached" ? "Đã gắn" : p.link.state === "pending" ? "Đang gắn…" : p.link.state === "needs_check" ? "Cần kiểm tra" : p.link.state === "skipped" ? "Bỏ qua" : "Lỗi"}
                {p.link.product?.name ? ` · ${p.link.product.name}` : ""} · <b className="text-ink">{num(p.clicks ?? 0)}</b> lượt bấm (khách thật{p.clicks ? "" : "; chỉ đo được khi cổng công khai đang chạy"})
              </p>
              {p.link.text && <p className="mt-1 whitespace-pre-line text-xs text-muted">{p.link.text}</p>}
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Chỉ số theo mốc thời gian</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {marks.map((mk) => {
                const snap = (p.snapshots ?? []).find((s: any) => s.mark === mk);
                return (
                  <div key={mk} className={cx("rounded-xl border border-line p-3", !snap && "opacity-50")}>
                    <p className="text-xs font-semibold text-muted">Sau {mk}</p>
                    {snap ? (
                      <div className="mt-1 space-y-0.5 text-xs text-muted">
                        <p><b className="text-base text-ink">{num(snap.metrics.reach)}</b> tiếp cận</p>
                        <p>{num(snap.metrics.reactions)} cảm xúc · {num(snap.metrics.comments)} bình luận</p>
                        <p>{num(snap.metrics.shares)} chia sẻ · {num(snap.metrics.saves)} lưu</p>
                      </div>
                    ) : <p className="mt-1 text-xs text-muted">Chưa đến mốc</p>}
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Bình luận ({p.comments?.length ?? 0}) — phân loại bởi Jev</p>
            {!p.comments?.length ? <Empty>Chưa có bình luận.</Empty> : (
              <div className="divide-y divide-line rounded-xl border border-line">
                {p.comments.map((c: any) => (
                  <div key={c.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1"><p className="text-xs text-muted">{c.author}{c.hidden ? " · đã ẩn" : ""}</p><p className="text-sm text-ink">{c.text}</p></div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge tone={COMMENT_LABEL[c.label]?.tone ?? "gray"}>{COMMENT_LABEL[c.label]?.label ?? c.label ?? "Chưa gắn"}</Badge>
                      {c.label_confidence != null && <span className="text-xs tabular-nums text-muted">{Math.round(c.label_confidence * 100)}%</span>}
                      <JevBadge source={c.label_source} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
