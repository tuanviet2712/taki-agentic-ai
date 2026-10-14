import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clapperboard, FileText, Lightbulb, Pencil, RefreshCw, Send, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { api, useApi } from "../lib/api";
import { CONTENT_STATUS, KIND_LABEL, num, timeAgo } from "../lib/format";
import { PostImage } from "../components/PostImage";
import { SeoImages } from "../components/SeoImages";
import { ArticleMarkdown } from "../components/ArticleMarkdown";
import { ExpandableText, Badge, Button, Card, Empty, Field, JevBadge, Loading, Modal, PageHeader, PlatformIcon, Progress, Stat, Tabs, cx, inputCls, platformName, useToast } from "../components/ui";

type Tab = "all" | "post" | "video" | "seo";
const TAB_KINDS: Record<Tab, string[] | null> = { all: null, post: ["social_post"], video: ["social_video", "video_script"], seo: ["seo_article"] };
const VERDICT: Record<string, { label: string; tone: "green" | "amber" | "red" | "violet" }> = { pass: { label: "Đạt", tone: "green" }, revise: { label: "Cần sửa", tone: "amber" }, block: { label: "Bị chặn", tone: "red" }, escalate: { label: "Cần Sếp xem", tone: "violet" } };
const SEVERITY: Record<string, { label: string; tone: "red" | "amber" | "gray" }> = { fatal: { label: "Nghiêm trọng", tone: "red" }, major: { label: "Quan trọng", tone: "amber" }, minor: { label: "Nhỏ", tone: "gray" } };
const FUNNEL_LABEL: Record<string, string> = { tofu: "TOFU", mofu: "MOFU", bofu: "BOFU" };
const scoreTone = (s: number | null | undefined) => (s == null ? "gray" : s >= 80 ? "green" : s >= 65 ? "amber" : "red") as "gray" | "green" | "amber" | "red";

export function Content() {
  const refresh = ["task.", "review.", "approval.", "post.", "content.image"];
  const list = useApi<any[]>("content", refresh);
  const stats = useApi<any>("content/stats", refresh);
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("all");
  const [params] = useSearchParams();
  const [sel, setSel] = useState<string | null>(params.get("id")); // ?id= mở thẳng 1 nội dung
  const [editing, setEditing] = useState<{ title: string; body: string } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const items = (list.data ?? []).filter((c) => !TAB_KINDS[tab] || TAB_KINDS[tab]!.includes(c.kind));
  useEffect(() => {
    if (items.length && !items.some((c) => c.id === sel)) setSel(items[0].id);
  }, [items, sel]);
  const detail = useApi<any>(sel ? `content/${sel}` : null, refresh);
  const d = detail.data?.id === sel ? detail.data : null;

  const run = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); detail.reload(); list.reload(); stats.reload(); return true; } catch (e: any) { toast(e.message, "err"); return false; } finally { setBusy(null); }
  };
  const saveEdit = async () => {
    if (!d || !editing?.body.trim()) return toast("Nội dung không được để trống", "err");
    if (await run("edit", () => api.put(`content/${d.id}`, { title: editing.title, body: editing.body }), "Đã lưu chỉnh sửa — agent sẽ học từ bản sửa của Sếp")) setEditing(null);
  };
  const publish = async () => {
    if (!d) return;
    if (await run("publish", () => api.post(`content/${d.id}/publish-now`), `Đã đưa vào hàng đăng lên ${platformName(d.channel)}`)) setConfirmPublish(false);
  };

  const s = stats.data;
  const count = (t: Tab) => (list.data ?? []).filter((c) => !TAB_KINDS[t] || TAB_KINDS[t]!.includes(c.kind)).length;
  const review = d?.review?.result;
  // Kịch bản video chỉ là chữ ("HOOK / [0-4s]…") — phải làm thành video trước, không đăng thẳng. Video thì phải có tệp.
  const isScript = d?.kind === "video_script";
  const canPublish = d && ["approved", "scheduled", "draft_on_channel"].includes(d.status) && !isScript && !(d.kind === "video" && !d.asset_id);

  return (
    <div className="space-y-6">
      <PageHeader title="Nội dung" subtitle="Mọi bài viết, kịch bản video và bài SEO do agent soạn — đã được Jev chấm điểm trước khi đến tay Sếp." />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat icon={Lightbulb} tone="blue" label="Ý tưởng đã giao" value={num(s?.ideas ?? 0)} sub={s?.pillars?.length ? s.pillars.filter((p: any) => p.funnel).map((p: any) => `${FUNNEL_LABEL[p.funnel] ?? p.funnel} ${p.n}`).join(" · ") : undefined} />
        <Stat icon={FileText} tone="amber" label="Bản nháp / chờ duyệt" value={num(s?.drafts ?? 0)} />
        <Stat icon={CheckCircle2} tone="violet" label="Đã duyệt, chờ đăng" value={num(s?.approved ?? 0)} />
        <Stat icon={Send} tone="green" label="Đã xuất bản" value={num(s?.published ?? 0)} />
      </div>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: "all", label: `Tất cả (${count("all")})` }, { value: "post", label: `Bài viết (${count("post")})` },
        { value: "video", label: `Video (${count("video")})` }, { value: "seo", label: `SEO (${count("seo")})` },
      ]} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card bodyClass="p-2">
          {!list.data ? <Loading /> : items.length === 0 ? <div className="p-3"><Empty>Chưa có nội dung nào trong mục này.</Empty></div> : (
            <div className="space-y-1">{items.map((c) => {
              const st = CONTENT_STATUS[c.status] ?? { label: c.status, tone: "gray" as const };
              return (
                <button key={c.id} onClick={() => setSel(c.id)} className={cx("flex w-full items-start gap-3 rounded-xl p-3 text-left transition", sel === c.id ? "bg-blue-500/10 ring-1 ring-blue-500/30" : "hover:bg-soft")}>
                  <PlatformIcon p={c.channel} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium text-ink">{c.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span>{KIND_LABEL[c.kind] ?? c.kind}</span><span>·</span><span>{timeAgo(c.updated_at)}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                  </div>
                  {c.review_total != null && <Badge tone={scoreTone(c.review_total)} className="shrink-0 tabular-nums">{Math.round(c.review_total)}</Badge>}
                </button>);
            })}</div>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          {!sel ? <Empty>Chọn một nội dung để xem trước.</Empty> : !d ? <Card><Loading /></Card> : (
            <>
              <Card title={<span className="flex items-center gap-2"><PlatformIcon p={d.channel} />{KIND_LABEL[d.kind] ?? d.kind} · {platformName(d.channel)}</span>}
                action={<Badge tone={CONTENT_STATUS[d.status]?.tone ?? "gray"}>{CONTENT_STATUS[d.status]?.label ?? d.status}</Badge>}>
                <h3 className="text-lg font-semibold text-ink">{d.title}</h3>
                {d.scheduled_at && <p className="mt-1 text-xs text-muted">{d.status === "published" ? "Đăng lúc" : "Lịch đăng"}: {new Date(d.scheduled_at).toLocaleString("vi-VN")}</p>}
                {d.kind === "seo_article"
                  ? <div className="mt-3 max-h-[560px] overflow-auto rounded-xl bg-soft p-4 scroll-thin"><ArticleMarkdown body={d.body} /></div>
                  : <div className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-soft p-4 text-sm leading-relaxed text-ink scroll-thin">{d.body}</div>}
                {d.image?.supported && <div className="mt-3"><PostImage contentId={d.id} image={d.image} onChange={() => { detail.reload(); list.reload(); }} /></div>}
                {d.seoImages?.supported && <div className="mt-3"><SeoImages contentId={d.id} info={d.seoImages} onChange={() => { detail.reload(); list.reload(); }} /></div>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button icon={Pencil} onClick={() => setEditing({ title: d.title ?? "", body: d.body ?? "" })}>Chỉnh sửa</Button>
                  {isScript && <Link to={`/video-flow?from=${d.id}`}><Button variant={["approved", "scheduled"].includes(d.status) ? "success" : "soft"} icon={Clapperboard}>Làm video</Button></Link>}
                  {d.task_id && <Button icon={RefreshCw} loading={busy === "regen"} onClick={() => run("regen", () => api.post(`content/${d.id}/regenerate`), "Agent đang viết lại nội dung này")}>Tạo lại</Button>}
                  {canPublish && <Button variant="success" icon={Send} onClick={() => setConfirmPublish(true)}>Đăng ngay</Button>}
                  {d.status === "awaiting_approval" && d.approval?.id && d.approval.status === "pending" && <Link to={`/approvals?id=${d.approval.id}`}><Button variant="primary" icon={ShieldCheck}>Mở trang duyệt</Button></Link>}
                  {d.status === "expired" && <Button variant="primary" icon={ShieldCheck} loading={busy === "reopen"} onClick={() => run("reopen", () => api.post(`content/${d.id}/reopen`), "Đã mở lại mục duyệt — Sếp duyệt ở trang Duyệt")}>Mở lại để duyệt</Button>}
                </div>
              </Card>

              <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600" />Kết quả review</span>}
                action={review && <Badge tone={VERDICT[review.verdict]?.tone ?? scoreTone(review.total)}>{Math.round(review.total)}/100 · {VERDICT[review.verdict]?.label ?? review.verdict}</Badge>}>
                {!review ? <Empty>Nội dung này chưa được review.</Empty> : (
                  <div className="space-y-5">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted">Kiểm tra cứng</p>
                      <ul className="space-y-1.5">{(review.deterministic ?? []).map((c: any) => (
                        <li key={c.check} className="flex items-center gap-2 text-sm">
                          {c.passed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-rose-500" />}
                          <span className={cx("min-w-0 flex-1", c.passed ? "text-ink" : "font-medium text-rose-600")}>{c.check}</span>
                          <Badge tone={c.passed ? "gray" : SEVERITY[c.severity]?.tone ?? "gray"}>{SEVERITY[c.severity]?.label ?? c.severity}</Badge>
                        </li>))}</ul>
                    </div>
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase text-muted">Tiêu chí chất lượng</p>
                        <span className="flex items-center gap-1.5 text-xs text-muted">Chấm bởi <JevBadge source={(review.criteria ?? []).some((c: any) => c.source === "jev") ? "jev" : "heuristic"} /></span>
                      </div>
                      <div className="space-y-3">{(review.criteria ?? []).map((c: any) => (
                        <div key={c.key} className="space-y-1" title={(c.evidence ?? []).join("\n")}>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="flex min-w-0 items-center gap-1.5 text-ink"><span className="truncate">{c.label}</span><JevBadge source={c.source} /></span>
                            <span className="shrink-0 tabular-nums text-muted">{Math.round(c.score * 100)}%{c.confidence != null ? ` · tin cậy ${Math.round(c.confidence * 100)}%` : ""}</span>
                          </div>
                          <Progress value={c.score * 100} tone={c.score >= 0.8 ? "violet" : c.score >= 0.6 ? "amber" : "red"} />
                          {c.evidence?.length > 0 && <ExpandableText lines={2} textClass="!text-[11px] text-muted">{c.evidence.join(" · ")}</ExpandableText>}
                        </div>))}</div>
                    </div>
                    {review.fatalFindings?.length > 0 && (
                      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
                        <p className="font-medium">Lỗi nghiêm trọng</p>
                        <ul className="mt-1 list-disc pl-5">{review.fatalFindings.map((f: any, i: number) => <li key={i}>{typeof f === "string" ? f : f.check ?? f.message ?? JSON.stringify(f)}</li>)}</ul>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} wide title="Chỉnh sửa nội dung"
        footer={<><Button onClick={() => setEditing(null)}>Hủy</Button><Button variant="primary" loading={busy === "edit"} onClick={saveEdit}>Lưu</Button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label="Tiêu đề"><input className={inputCls} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            <Field label="Nội dung" hint={d?.kind === "seo_article" ? "Bài SEO: giữ nguyên các dòng ảnh (bắt đầu bằng ![ ) để ảnh vẫn nằm trong bài; xoá 1 dòng ảnh rồi bấm \"Tạo ảnh còn thiếu\" để làm lại ảnh đó." : "Bản sửa của Sếp được lưu làm ví dụ để agent học giọng viết."}><textarea rows={14} className={cx(inputCls, "font-mono text-[13px]")} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={confirmPublish && !!d} onClose={() => setConfirmPublish(false)} wide title="Xác nhận đăng ngay"
        footer={<><Button onClick={() => setConfirmPublish(false)}>Hủy</Button><Button variant="success" icon={Send} loading={busy === "publish"} onClick={publish}>Đăng lên {d ? platformName(d.channel) : ""}</Button></>}>
        {d && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">Nội dung sẽ được đăng công khai lên <b>{platformName(d.channel)}</b> ngay bây giờ. Sếp kiểm tra lại lần cuối nhé.</div>
            <div className="flex items-center gap-2"><PlatformIcon p={d.channel} /><p className="font-medium text-ink">{d.title}</p></div>
            {d.kind === "seo_article" ? <div className="max-h-72 overflow-auto rounded-xl bg-soft p-3 scroll-thin"><ArticleMarkdown body={d.body} /></div> : <div className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-soft p-3 text-ink scroll-thin">{d.body}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
