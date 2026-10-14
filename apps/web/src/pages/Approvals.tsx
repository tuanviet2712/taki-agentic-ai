import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, CheckCircle2, Clock, FileText, Pencil, ShieldAlert, X, XCircle } from "lucide-react";
import { api, useApi } from "../lib/api";
import { AGENT_LABEL, timeAgo, vnd } from "../lib/format";
import { Badge, Button, Card, Empty, ExpandableText, JevBadge, Loading, Modal, PageHeader, PlatformIcon, ProbBar, Stat, Tabs, cx, inputCls, useToast } from "../components/ui";
import { OrderDraftPanel } from "../components/PancakeOrders";
import { PostImage } from "../components/PostImage";
import { SeoImages } from "../components/SeoImages";
import { ArticleMarkdown } from "../components/ArticleMarkdown";
import { AutoApprove } from "../components/AutoApprove";

const TYPES = [
  { value: "", label: "Tất cả" },
  { value: "task", label: "Nội dung & chiến lược" },
  { value: "ad_candidate", label: "Quảng cáo từ bài" },
  { value: "action", label: "Thay đổi ngân sách/ads" },
  { value: "creative_job", label: "Video Flow" },
  { value: "follow_up", label: "Follow-up Zalo" },
  { value: "nurture_send", label: "Chăm khách từ bình luận" },
  { value: "order_draft", label: "Đơn hàng" },
  { value: "change_proposal", label: "Đề xuất học" },
];
const RISK = { low: { label: "Rủi ro thấp", tone: "green" }, medium: { label: "Rủi ro trung bình", tone: "amber" }, high: { label: "Rủi ro cao", tone: "red" } } as const;
const EVENT_VI: Record<string, string> = {
  "task.status": "Đổi trạng thái", "approval.approved": "Đã duyệt", "approval.rejected": "Từ chối", "approval.edited": "Sửa & duyệt",
  "goal.created": "Tạo mục tiêu", "publish.scheduled": "Lên lịch đăng",
  "approval.auto_approved": "Tự động duyệt", "approval.auto_skipped": "Chưa tự duyệt được",
};

export function Approvals() {
  const [params, setParams] = useSearchParams();
  const [type, setType] = useState("");
  const list = useApi<any[]>(`approvals${type ? `?type=${type}` : ""}`, ["approval."]);
  const stats = useApi<any>("approvals/stats", ["approval."]);
  const selectedId = params.get("id") ?? list.data?.[0]?.id ?? null;
  const detail = useApi<any>(selectedId ? `approvals/${selectedId}` : null, ["approval.", "content.image"]);
  const [mode, setMode] = useState<null | "edit" | "reject">(null);
  const [note, setNote] = useState("");
  const [edited, setEdited] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => { setMode(null); setNote(""); }, [selectedId]);

  const decide = async (decision: "approve" | "edit" | "reject") => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.post(`approvals/${selectedId}/decide`, { decision, note: note || undefined, editedOutput: decision === "edit" ? edited : undefined });
      toast(decision === "approve" ? "Đã duyệt — agent tiếp tục quy trình" : decision === "edit" ? "Đã lưu bản sửa & duyệt" : "Đã từ chối — lý do được Jev phân loại để agent học");
      setMode(null); setNote("");
      const next = list.data?.find((a) => a.id !== selectedId);
      setParams(next ? { id: next.id } : {});
      list.reload(); stats.reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };

  const d = detail.data;
  const content = d?.subject?.content;
  const review = d?.review?.result;

  return (
    <div>
      <PageHeader title="Duyệt & Phê duyệt" subtitle="Xem xét và phê duyệt các nội dung, chiến dịch và thay đổi do Agent đề xuất." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat icon={FileText} tone="blue" label="Chờ phê duyệt" value={stats.data?.pending ?? "—"} sub="đang chờ Sếp" />
        <Stat icon={CheckCircle2} tone="green" label="Đã phê duyệt" value={stats.data?.approved ?? "—"} sub="tổng cộng" />
        <Stat icon={XCircle} tone="red" label="Đã từ chối" value={stats.data?.rejected ?? "—"} sub="lý do được dùng để học" />
        <Stat icon={Clock} tone="violet" label="Thời gian duyệt TB" value={stats.data?.avgMinutes != null ? `${Math.round(stats.data.avgMinutes)} phút` : "—"} sub="từ lúc đề xuất" />
      </div>

      <AutoApprove onChanged={() => { list.reload(); stats.reload(); }} />

      <Tabs tabs={TYPES.map((t) => ({ value: t.value, label: t.label }))} value={type} onChange={(v) => { setType(v); setParams({}); }} />

      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-3">
          {list.loading ? <Loading /> : !list.data?.length ? <Empty>Không có mục nào chờ duyệt. 🎉</Empty> : list.data.map((a) => {
            const r = RISK[a.risk as keyof typeof RISK] ?? RISK.low;
            return (
              <button key={a.id} onClick={() => setParams({ id: a.id })} className={cx("w-full rounded-2xl border bg-card p-3.5 text-left transition-colors hover:border-blue-300", a.id === selectedId ? "border-blue-500 ring-2 ring-blue-500/15" : "border-line")}>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs text-muted">{a.preview?.channel && <PlatformIcon p={a.preview.channel} size={16} />}{TYPES.find((t) => t.value === a.subject_type)?.label}</span>
                  <Badge tone={r.tone}>{r.label}</Badge>
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug">{a.title}</p>
                <p className="mt-1 text-xs text-muted">Do {AGENT_LABEL[a.agent_key] ?? a.agent_key} đề xuất · {timeAgo(a.created_at)}{a.review_total != null && <> · Review {Math.round(a.review_total)}/100</>}</p>
                {a.preview?.notPassed && <p className="mt-2 flex items-center gap-1 text-xs text-amber-600"><ShieldAlert className="h-3.5 w-3.5" />Chưa đạt review sau số vòng sửa tối đa</p>}
              </button>
            );
          })}
        </div>

        <div>
          {!selectedId ? null : !d ? <Loading /> : (
            <Card>
              <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm text-muted">{d.preview?.channel && <PlatformIcon p={d.preview.channel} />}{TYPES.find((t) => t.value === d.subject_type)?.label}</p>
                  <h2 className="mt-1 text-lg font-bold leading-snug">{d.title}</h2>
                  <p className="text-sm text-muted">Do {AGENT_LABEL[d.agent_key] ?? d.agent_key} đề xuất · {timeAgo(d.created_at)}{d.expires_at && <> · hết hạn {timeAgo(d.expires_at)}</>}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2"><Badge tone={(RISK[d.risk as keyof typeof RISK] ?? RISK.low).tone}>{(RISK[d.risk as keyof typeof RISK] ?? RISK.low).label}</Badge><Badge tone={d.status === "pending" ? "amber" : "green"}>{d.status === "pending" ? "Đang chờ duyệt" : d.status}</Badge></div>
              </div>

              <div className="mt-4 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0 space-y-4">
                  {d.subject_type === "order_draft" && d.status === "pending" ? (
                    <OrderDraftPanel approval={d} onDone={() => {
                      const next = list.data?.find((a) => a.id !== selectedId);
                      setParams(next ? { id: next.id } : {});
                      list.reload(); stats.reload(); detail.reload();
                    }} />
                  ) : <SubjectView d={d} onChange={detail.reload} />}
                  {d.status === "pending" && d.channelBlocked && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>{d.channelNote} Vẫn duyệt được — hệ thống không đăng giả: bài chờ ở trang Đăng bài cho tới khi kênh sẵn sàng.</p>
                    </div>
                  )}
                  {d.status === "pending" && d.subject?.linkComment && (
                    <div className="rounded-xl border border-line bg-soft p-3 text-xs text-muted">
                      <p className="font-medium text-ink">Sau khi đăng, hệ thống tự bình luận link sản phẩm ({d.subject.linkComment.product.name}) dưới bài trên {d.subject.linkComment.channel}:</p>
                      <p className="mt-1 whitespace-pre-line text-ink">{d.subject.linkComment.text}</p>
                      <p className="mt-1">Link thật được thêm UTM / mã đo. Tắt ở trang Đăng bài → "Link sản phẩm dưới bình luận".</p>
                    </div>
                  )}
                  {/* Lượt đăng / đăng nháp lỗi của nội dung này: vì sao bài chưa lên kênh. */}
                  {(d.subject?.publishErrors ?? []).map((x: any) => (
                    <div key={x.id} className="rounded-xl bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
                      <p className="flex items-center gap-1.5 font-medium"><PlatformIcon p={x.platform} size={14} />{x.mode === "draft" ? "Đăng nháp" : "Đăng bài"} lên {x.name} {x.status === "needs_check" ? "cần kiểm tra" : x.status === "needs_setup" ? "chờ kết nối kênh" : "bị lỗi"}</p>
                      <p className="mt-1 whitespace-pre-line">{x.error}</p>
                    </div>
                  ))}
                  {d.history?.length > 0 && (
                    <details>
                      <summary className="text-sm font-semibold">Lịch sử xử lý ({Math.min(8, d.history.length)})</summary>
                      <ol className="mt-2 space-y-2 border-l border-line pl-4">
                        {d.history.slice(-8).map((h: any, i: number) => (
                          <li key={i} className="text-xs"><span className="font-medium">{h.actor}</span> · {EVENT_VI[h.event] ?? h.event}{h.data?.to ? ` → ${h.data.to}` : ""}{h.event === "approval.auto_approved" && h.data?.score != null ? ` (điểm ${h.data.score} ≥ ${h.data.minScore})` : ""}{h.event === "approval.auto_skipped" && h.data?.reason ? `: ${h.data.reason}` : ""} <span className="text-muted">· {timeAgo(h.at)}</span></li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
                <div className="space-y-4">{review ? <ReviewPanel review={review} source={d.jevJudgment?.source} /> : d.subject_type === "ad_candidate" ? <CommentsPanel comments={d.subject?.comments ?? []} /> : null}</div>
              </div>

              {d.status === "pending" && d.subject_type !== "order_draft" && (
                <div className="mt-6 space-y-3 border-t border-line pt-4">
                  {mode && (
                    <div className="space-y-2">
                      {mode === "edit" && (d.subject_type === "follow_up" || d.subject_type === "nurture_send") && <textarea className={cx(inputCls, "min-h-28")} value={edited} onChange={(e) => setEdited(e.target.value)} />}
                      {mode === "edit" && content && <textarea className={cx(inputCls, "min-h-48 font-mono text-xs")} value={edited} onChange={(e) => setEdited(e.target.value)} />}
                      {mode === "edit" && d.subject_type === "ad_candidate" && <input className={inputCls} value={edited} onChange={(e) => setEdited(e.target.value)} placeholder="Ngân sách/ngày mới (VND), ví dụ 1500000" />}
                      <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "reject" ? "Lý do từ chối (bắt buộc) — ví dụ: văn phong chưa đúng giọng DOTAKA" : "Ghi chú cho agent (không bắt buộc)"} />
                    </div>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    {mode ? <Button variant="ghost" onClick={() => setMode(null)}>Hủy</Button> : (
                      <>
                        {(content || d.subject_type === "ad_candidate" || d.subject_type === "follow_up" || (d.subject_type === "nurture_send" && d.preview?.dmText)) && <Button icon={Pencil} onClick={() => { setMode("edit"); setEdited(d.subject_type === "follow_up" || d.subject_type === "nurture_send" ? String(d.preview?.text ?? "") : content?.body ?? String(d.subject?.candidate?.daily_budget ?? "")); }}>Chỉnh sửa</Button>}
                        <Button variant="danger" icon={X} onClick={() => setMode("reject")}>Từ chối</Button>
                      </>
                    )}
                    {mode === "reject" ? <Button variant="danger" loading={busy} disabled={!note.trim()} onClick={() => decide("reject")}>Xác nhận từ chối</Button>
                      : mode === "edit" ? <Button variant="success" loading={busy} icon={Check} onClick={() => decide("edit")}>Lưu bản sửa & duyệt</Button>
                      : <Button variant="success" loading={busy} icon={Check} onClick={() => decide("approve")}>Phê duyệt</Button>}
                  </div>
                  <p className="text-right text-xs text-muted">{approveHint(d)}</p>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function approveHint(d: any) {
  if (d.subject_type === "ad_candidate") return `Phê duyệt sẽ tạo quảng cáo thật từ bài với ${vnd(d.subject?.candidate?.daily_budget)}/ngày (qua trần ngân sách & kill switch).`;
  if (d.subject_type === "action") return "Phê duyệt sẽ đưa thay đổi vào hàng đợi thực thi; có thể hoàn tác ở trang Quảng cáo.";
  if (d.subject_type === "follow_up") return `Phê duyệt sẽ gửi tin này qua ZL-CRM bằng nick ${d.preview?.nick ?? "đang giữ hội thoại"}. Nếu khách nhắn lại trước đó, tin sẽ không gửi.`;
  if (d.subject_type === "nurture_send") return "Phê duyệt sẽ trả lời công khai dưới bình luận + nhắn inbox cho khách (Chỉnh sửa = sửa tin inbox). Từ chối = không nhắn khách này.";
  if (d.subject_type === "creative_job") return `Phê duyệt sẽ tải video lên ${(d.preview?.channels ?? []).join(", ")} dưới dạng BẢN NHÁP (chưa công khai).`;
  if (d.subject?.task?.agent_key === "strategy") return "Phê duyệt chiến lược sẽ kích hoạt các agent viết nội dung theo kế hoạch.";
  if (d.subject?.content?.channel) return "Phê duyệt sẽ lên lịch đăng bài theo khung giờ hiệu quả (dừng được bằng kill switch).";
  return "";
}

function SubjectView({ d, onChange }: { d: any; onChange?: () => void }) {
  const s = d.subject ?? {};
  if (d.subject_type === "follow_up") return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2"><Badge tone="blue">Zalo · {d.preview?.nick ?? "nick ?"}</Badge><Badge tone={d.preview?.grade === "hot" ? "red" : d.preview?.grade === "warm" ? "amber" : "gray"}>Lead {d.preview?.grade ?? "?"}</Badge><Badge>Lần {d.preview?.step}</Badge></div>
      <div><p className="mb-1 font-semibold">Hội thoại gần nhất</p><div className="space-y-1 rounded-xl bg-soft p-3 text-xs">{(d.preview?.recent ?? []).map((l: string, i: number) => <p key={i} className={l.startsWith("Khách") ? "text-ink" : "text-muted"}>{l}</p>)}</div></div>
      <div><p className="mb-1 font-semibold">Tin follow-up sẽ gửi</p><div className="whitespace-pre-wrap rounded-xl border border-blue-500/40 bg-blue-500/5 p-4 leading-relaxed text-ink">{d.preview?.text}</div></div>
      {d.preview?.conversationId && <a href={`/chat?id=${d.preview.conversationId}`} className="text-xs text-blue-600 underline">Mở hội thoại</a>}
    </div>
  );
  if (d.subject_type === "nurture_send") return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2"><Badge tone="blue">{d.preview?.channel === "instagram" ? "Instagram" : "Facebook"} · bình luận</Badge>{d.preview?.reviewFirst ? <Badge>Chế độ duyệt trước · khách {d.preview.reviewNo}/{d.preview.reviewFirst}</Badge> : null}{d.preview?.deadline && <Badge tone="amber">Hạn nhắn inbox: {new Date(d.preview.deadline).toLocaleString("vi-VN")}</Badge>}</div>
      <div><p className="mb-1 font-semibold">Bình luận của {d.preview?.author}{d.preview?.postTitle ? ` dưới “${d.preview.postTitle}”` : ""}</p><div className="whitespace-pre-wrap rounded-xl bg-soft p-3 text-ink">{d.preview?.comment}</div>{d.preview?.permalink && <a href={d.preview.permalink} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">Mở bài ↗</a>}</div>
      {d.preview?.replyText && <div><p className="mb-1 font-semibold">Trả lời công khai dưới bình luận</p><div className="whitespace-pre-wrap rounded-xl border border-line p-3 leading-relaxed text-ink">{d.preview.replyText}</div></div>}
      {d.preview?.dmText && <div><p className="mb-1 font-semibold">Tin inbox gửi riêng cho khách</p><div className="whitespace-pre-wrap rounded-xl border border-blue-500/40 bg-blue-500/5 p-4 leading-relaxed text-ink">{d.preview.dmText}</div></div>}
    </div>
  );
  if (d.subject_type === "order_draft") return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-2"><Badge tone="violet">{d.preview?.product}</Badge>{d.preview?.total > 0 && <Badge tone="blue">{vnd(d.preview.total)}</Badge>}{d.preview?.phoneMasked && <Badge>SĐT {d.preview.phoneMasked}</Badge>}</div>
      <p className="text-xs text-muted">Đơn nháp do bot chốt từ hội thoại với {d.preview?.customerName}. Đơn thật (nếu đã duyệt) hiện ở khối "Đơn hàng" trong trang Chat.</p>
      {d.preview?.conversationId && <a href={`/chat?id=${d.preview.conversationId}`} className="text-xs text-blue-600 underline">Mở hội thoại</a>}
    </div>
  );
  if (s.job) return (
    <div className="space-y-3 text-sm">
      {s.asset && <video src={`/v1/media/${s.asset.id}`} controls className="mx-auto max-h-[520px] rounded-xl bg-black" />}
      <p className="text-xs text-muted">{d.preview?.tool} · {s.asset?.duration?.toFixed(1)}s · {s.asset?.width}x{s.asset?.height} · <a className="text-blue-600" href={`/v1/media/${s.asset?.id}?download=1`}>Tải MP4</a></p>
      <div className="flex flex-wrap gap-2">{(d.preview?.tech ?? []).map((t: any) => <Badge key={t.check} tone={t.passed ? "green" : "red"}>{t.passed ? "✓" : "✗"} {t.check}{t.detail ? ` (${t.detail})` : ""}</Badge>)}</div>
      <div><p className="mb-1 font-semibold">Caption + lời thoại (sửa được khi bấm Chỉnh sửa)</p><div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-soft p-3 text-xs scroll-thin">{s.content?.body}</div></div>
      <p className="text-xs text-muted">Kênh sẽ đăng nháp: {(d.preview?.channels ?? []).join(", ")}{d.preview?.notes ? ` · Ghi chú agent: ${d.preview.notes}` : ""}</p>
    </div>
  );
  if (s.content) return (
    <div className="space-y-3">
      <div>
        <p className="mb-2 text-sm font-semibold">Nội dung đề xuất</p>
        {s.content.kind === "seo_article"
          ? <div className="max-h-[560px] overflow-auto rounded-xl border border-line bg-soft p-4 scroll-thin"><ArticleMarkdown body={s.content.body} /></div>
          : <div className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-soft p-4 text-sm leading-relaxed scroll-thin">{s.content.body}</div>}
      </div>
      {/* Bài SEO: 4 ảnh / 1000 chữ nằm trong thân bài; thiếu ảnh thì bấm "Tạo ảnh còn thiếu" trước khi duyệt. */}
      <SeoImages contentId={s.content.id} info={s.seoImages} error={d.status === "pending" ? d.preview?.imageError : null} onChange={onChange ?? (() => {})} />
      {/* Ảnh đăng kèm bài: Sếp duyệt cả chữ lẫn ảnh; tạo lại / đổi ảnh ngay tại đây trước khi bấm Duyệt. */}
      <PostImage contentId={s.content.id} image={s.image} error={d.status === "pending" ? d.preview?.imageError : null} onChange={onChange ?? (() => {})} />
    </div>
  );
  if (s.task?.agent_key === "strategy" && s.task.output) {
    const o = s.task.output;
    return (
      <div className="space-y-3 text-sm">
        <p><span className="font-semibold">Định vị:</span> {o.positioning}</p>
        <div className="grid gap-2 sm:grid-cols-3">{(["tofu", "mofu", "bofu"] as const).map((k) => <div key={k} className="rounded-xl bg-soft p-3"><p className="text-xs font-semibold uppercase text-muted">{k}</p><p>{o.funnel[k]}</p></div>)}</div>
        <p className="font-semibold">Phương án</p>
        <ul className="list-disc space-y-1 pl-5">{o.options.map((x: any) => <li key={x.name}><b>{x.name}</b> — {x.tradeoffs}</li>)}</ul>
        <p className="font-semibold">Phân bổ ngân sách ads</p>
        <div className="flex flex-wrap gap-2">{o.budgetSplit.adsByPlatform.map((b: any) => <Badge key={b.platform} tone="blue"><PlatformIcon p={b.platform} size={14} />{vnd(b.amount)}</Badge>)}</div>
        <p className="font-semibold">Kế hoạch nội dung ({o.contentPlan.length})</p>
        <ul className="space-y-1">{o.contentPlan.map((c: any, i: number) => <li key={i} className="flex items-center gap-2"><PlatformIcon p={c.channel} size={16} />{c.topic} <Badge>{c.funnel.toUpperCase()}</Badge></li>)}</ul>
      </div>
    );
  }
  if (s.candidate) return (
    <div className="space-y-3 text-sm">
      <div className="rounded-xl border border-line bg-soft p-4">
        <p className="font-semibold">{s.post?.title}</p>
        <p className="mt-1 whitespace-pre-wrap text-muted">{s.post?.body}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-soft p-3"><p className="text-xs text-muted">Điểm bài</p><p className="text-xl font-bold">{s.candidate.score}</p></div>
        <div className="rounded-xl bg-soft p-3"><p className="text-xs text-muted">Nền tảng</p><p className="flex items-center gap-1 font-semibold"><PlatformIcon p={s.candidate.platform} size={16} />{s.candidate.platform}</p></div>
        <div className="rounded-xl bg-soft p-3"><p className="text-xs text-muted">Ngân sách/ngày</p><p className="font-semibold">{vnd(s.candidate.daily_budget)}</p></div>
      </div>
      <p className="font-semibold">Lý do (sinh từ số liệu, không do AI viết)</p>
      <ul className="list-disc space-y-1 pl-5">{(s.candidate.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}</ul>
    </div>
  );
  if (s.action) return (
    <div className="space-y-2 text-sm">
      <p>{s.action.reason}</p>
      <div className="grid grid-cols-2 gap-3"><pre className="rounded-xl bg-soft p-3 text-xs">Trước: {JSON.stringify(s.action.before, null, 1)}</pre><pre className="rounded-xl bg-soft p-3 text-xs">Sau: {JSON.stringify(s.action.after, null, 1)}</pre></div>
    </div>
  );
  if (s.proposal) return (
    <div className="space-y-2 text-sm">
      <p><b>Lý do:</b> {s.proposal.rationale}</p>
      <pre className="whitespace-pre-wrap rounded-xl bg-soft p-3 text-xs">{JSON.stringify(s.proposal.diff, null, 2)}</pre>
    </div>
  );
  return <pre className="text-xs">{JSON.stringify(d.preview, null, 2)}</pre>;
}

function ReviewPanel({ review, source }: { review: any; source?: string }) {
  const verdict = { pass: ["Đạt", "green"], revise: ["Cần sửa", "amber"], block: ["Chặn", "red"], escalate: ["Cần người xem", "amber"] }[review.verdict as string] ?? [review.verdict, "gray"];
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between"><p className="font-semibold">Đánh giá từ Review Agent</p><JevBadge source={source} /></div>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-emerald-500/5 p-3">
        <p className="text-3xl font-bold">{Math.round(review.total)}</p>
        <div><Badge tone={verdict[1] as any}>{verdict[0]}</Badge><p className="mt-1 text-xs text-muted">Rubric {review.rubricKey} v{review.rubricVersion}</p></div>
      </div>
      {review.criteria?.length > 0 && <div className="mt-4 space-y-3">{review.criteria.map((c: any) => <ProbBar key={c.key} label={c.label} p={c.score} tone={c.score >= 0.7 ? "green" : c.score >= 0.5 ? "amber" : "red"} hint={c.evidence?.join(" · ")} />)}</div>}
      <p className="mt-4 text-sm font-semibold">Kiểm tra tất định</p>
      <ul className="mt-2 space-y-1.5">
        {review.deterministic.map((c: any) => (
          <li key={c.check} className="flex items-start gap-2 text-xs">
            {c.passed ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
            <div className="min-w-0 flex-1"><span>{c.check}</span>{c.detail && <ExpandableText lines={2} textClass="!text-xs text-muted">{c.detail}</ExpandableText>}</div>
          </li>
        ))}
      </ul>
      {review.criteria?.some((c: any) => c.fix) && (
        <div className="mt-4 rounded-xl bg-amber-500/10 p-3 text-xs">
          <p className="mb-1 font-semibold">Gợi ý cải thiện</p>
          <ul className="list-disc space-y-1 pl-4">{review.criteria.filter((c: any) => c.fix).map((c: any) => <li key={c.key}>{c.fix}</li>)}</ul>
        </div>
      )}
      {review.fatalFindings?.length > 0 && <p className="mt-3 text-xs text-rose-600">{review.fatalFindings.join("; ")}</p>}
    </div>
  );
}

const LABEL_VI: Record<string, [string, any]> = { purchase_intent: ["Ý định mua", "green"], question: ["Câu hỏi", "blue"], praise: ["Khen", "violet"], negative: ["Tiêu cực", "red"], spam: ["Spam (đã ẩn)", "gray"] };
function CommentsPanel({ comments }: { comments: any[] }) {
  const counts = useMemo(() => comments.reduce((a: Record<string, number>, c) => ((a[c.label] = (a[c.label] ?? 0) + 1), a), {}), [comments]);
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between"><p className="font-semibold">Bình luận đã phân loại</p><JevBadge source={comments[0]?.label_source} /></div>
      <div className="mt-2 flex flex-wrap gap-1">{Object.entries(counts).map(([k, n]) => <Badge key={k} tone={LABEL_VI[k]?.[1] ?? "gray"}>{LABEL_VI[k]?.[0] ?? k}: {n}</Badge>)}</div>
      <ul className="mt-3 max-h-80 space-y-2 overflow-auto scroll-thin">
        {comments.map((c, i) => <li key={i} className="flex items-start justify-between gap-2 text-xs"><span>“{c.text}”</span><Badge tone={LABEL_VI[c.label]?.[1] ?? "gray"}>{LABEL_VI[c.label]?.[0] ?? c.label}</Badge></li>)}
      </ul>
    </div>
  );
}
