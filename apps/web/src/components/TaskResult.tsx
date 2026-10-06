import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Pencil, RotateCcw, Sparkles, X, XCircle } from "lucide-react";
import { api, useApi } from "../lib/api";
import { AGENT_LABEL, CONTENT_STATUS, KIND_LABEL, TASK_STATUS, num, timeAgo } from "../lib/format";
import { Badge, Button, Empty, Loading, Modal, PlatformIcon, cx, inputCls, useToast } from "./ui";

/**
 * Bấm 1 khâu (Kế hoạch / Agent & Tác vụ) → xem KẾT QUẢ agent làm ra, sửa ngay tại chỗ:
 *  - khâu ra bài (content / kịch bản / SEO): sửa tiêu đề + nội dung → Lưu, hoặc Lưu & duyệt (kiểm tra lại câu cấm / giá DNA);
 *  - khâu khác (brief, nghiên cứu, chiến lược): sửa trực tiếp từng mục kết quả;
 *  - AI viết lại theo góp ý của Sếp; chạy lại / huỷ.
 */
const RETRYABLE = ["failed", "blocked", "rejected"];
const CANCELLABLE = ["pending", "ready", "running", "in_review", "revising", "awaiting_approval", "blocked", "failed"];
const KEY: Record<string, string> = {
  positioning: "Định vị", funnel: "Phễu", tofu: "Đầu phễu (TOFU)", mofu: "Giữa phễu (MOFU)", bofu: "Cuối phễu (BOFU)", channelPlan: "Phân bổ kênh", options: "Phương án",
  fallback: "Phương án dự phòng", kpis: "KPI", metric: "Chỉ số", target: "Mục tiêu", unit: "Đơn vị", by: "Hạn", feasibility: "Tính khả thi", verdict: "Đánh giá", notes: "Ghi chú",
  contentPlan: "Kế hoạch nội dung", channel: "Kênh", format: "Định dạng", topic: "Chủ đề", angle: "Góc tiếp cận", share: "Tỷ trọng", role: "Vai trò", name: "Tên", tradeoffs: "Đánh đổi",
  goal: "Mục tiêu", audience: "Khách hàng", insights: "Insight", competitors: "Đối thủ", opportunities: "Cơ hội", risks: "Rủi ro", summary: "Tóm tắt", hooks: "Hook", scenes: "Cảnh",
  title: "Tiêu đề", body: "Nội dung", cta: "CTA", caption: "Caption", keyword: "Từ khoá", metaDescription: "Mô tả meta", constraints: "Ràng buộc", assumptions: "Giả định",
  budget: "Ngân sách", timeline: "Lộ trình", messages: "Thông điệp", coreMessages: "Thông điệp chính", pillars: "Trụ cột nội dung", schedule: "Lịch",
  objective: "Mục tiêu", objectives: "Mục tiêu", segments: "Phân khúc", trends: "Xu hướng", recommendations: "Đề xuất", sources: "Nguồn", durationSec: "Thời lượng (giây)",
  platform: "Nền tảng", hashtags: "Hashtag", funnelStage: "Tầng phễu", deliverables: "Đầu ra", channels: "Kênh", kpi: "KPI", pains: "Nỗi đau", gains: "Mong muốn", sourceRef: "Nguồn", facts: "Dữ kiện", variants: "Biến thể",
};
const label = (k: string) => KEY[k] ?? k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function TaskResult({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const { data: t, reload } = useApi<any>(id ? `tasks/${id}` : null, ["task.", "review.", "approval."]);
  const show = !!id && t?.id === id;
  const [edit, setEdit] = useState<any | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setEdit(null); setNote(null); }, [id]);
  const run = async (key: string, fn: () => Promise<any>, ok: string, close = false) => {
    setBusy(key);
    try { await fn(); toast(ok); reload(); setEdit(null); if (close) onClose(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const st = show ? TASK_STATUS[t.status] ?? { label: t.status, tone: "gray" as const } : null;
  const c = show ? t.content : null;
  const review = t?.review?.result;
  const issues: string[] = review ? [
    ...(review.fatalFindings ?? []),
    ...(review.deterministic ?? []).filter((x: any) => !x.passed && x.severity !== "fatal").map((x: any) => `${x.check}${x.detail ? `: ${x.detail}` : ""}`),
  ] : [];
  const canApprove = c && !["approved", "scheduled", "published", "video_made"].includes(c.status);
  // task.error là JSON {code, message} (hoặc chuỗi ở dữ liệu cũ)
  const err: string | null = !show || !t.error ? null : typeof t.error === "string" ? t.error : String(t.error.message ?? t.error.code ?? JSON.stringify(t.error));

  return (
    <Modal open={!!id} onClose={onClose} wide title={show ? t.title : "Kết quả tác vụ"}
      footer={show ? <div className="flex w-full flex-wrap items-center gap-2">
        {RETRYABLE.includes(t.status) && <Button icon={RotateCcw} loading={busy === "retry"} onClick={() => run("retry", () => api.post(`tasks/${t.id}/retry`), "Đã cho agent chạy lại")}>Chạy lại</Button>}
        {CANCELLABLE.includes(t.status) && <Button variant="ghost" icon={XCircle} loading={busy === "cancel"} onClick={() => run("cancel", () => api.post(`tasks/${t.id}/cancel`), "Đã huỷ tác vụ", true)}>Huỷ tác vụ</Button>}
        <span className="flex-1" />
        <Button onClick={onClose}>Đóng</Button>
      </div> : undefined}>
      {!show ? <Loading /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={st!.tone}>{st!.label}</Badge><Badge tone="blue">{AGENT_LABEL[t.agent_key] ?? t.agent_key}</Badge>
            {review && <Badge tone={review.verdict === "pass" ? "green" : review.verdict === "block" ? "red" : "amber"}>Review {Math.round(review.total)}/100</Badge>}
            <span className="text-xs text-muted">sửa {t.revisions ?? 0} lần · cập nhật {timeAgo(t.updated_at)}</span>
          </div>

          {(err || issues.length > 0) && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-800 dark:text-rose-200">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{t.status === "blocked" ? "Vì sao bị chặn" : "Cần chú ý"}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{[...new Set([...(err ? [err] : []), ...issues])].map((x) => <li key={x}>{x}</li>)}</ul>
              {t.status === "blocked" && c && <p className="mt-2 text-xs opacity-80">Sửa các chỗ trên rồi bấm “Lưu & duyệt”, hoặc nhờ AI viết lại theo góp ý.</p>}
            </div>
          )}

          {c ? (
            <div className="rounded-2xl border border-line">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                {c.channel && <PlatformIcon p={c.channel} size={20} />}
                <Badge>{KIND_LABEL[c.kind] ?? c.kind}</Badge><Badge tone={CONTENT_STATUS[c.status]?.tone ?? "gray"}>{CONTENT_STATUS[c.status]?.label ?? c.status}</Badge>
                <span className="flex-1" />
                {!edit && <>
                  <Button size="sm" variant="primary" icon={Pencil} onClick={() => setEdit({ title: c.title, body: c.body })}>Chỉnh sửa</Button>
                  <Button size="sm" icon={Sparkles} onClick={() => setNote(note === null ? "" : null)}>AI viết lại</Button>
                </>}
              </div>
              {edit ? (
                <div className="space-y-3 p-4">
                  <input className={cx(inputCls, "text-base font-semibold")} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
                  <textarea rows={18} className={cx(inputCls, "font-mono text-[13px] leading-relaxed")} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" icon={Check} loading={busy === "save"} onClick={() => run("save", () => api.put(`content/${c.id}`, edit), "Đã lưu bản sửa")}>Lưu</Button>
                    {canApprove && <Button variant="success" icon={Check} loading={busy === "approve"} onClick={() => run("approve", () => api.put(`content/${c.id}`, { ...edit, approve: true }), c.kind === "video_script" ? "Đã lưu & duyệt kịch bản — vào Sản xuất video để tạo video" : "Đã lưu & duyệt — bài vào hàng chờ đăng")}>Lưu & duyệt</Button>}
                    <Button variant="ghost" icon={X} onClick={() => setEdit(null)}>Huỷ sửa</Button>
                  </div>
                  {canApprove && <p className="text-xs text-muted">“Lưu & duyệt” kiểm tra lại câu cấm, giá theo DNA, ký tự cấm trước khi duyệt; bài mạng xã hội đã duyệt sẽ vào hàng chờ đăng (Đăng bài).</p>}
                </div>
              ) : (
                <div className="space-y-2 p-4">
                  <p className="text-base font-semibold text-ink">{c.title}</p>
                  <div className="max-h-[50vh] overflow-y-auto whitespace-pre-line rounded-xl bg-soft p-4 leading-relaxed text-ink scroll-thin">{c.body}</div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {c.kind === "video_script" && <Link to={`/video-flow?from=${c.id}`} className="font-medium text-blue-600 hover:underline">Tạo video từ kịch bản →</Link>}
                    {t.status === "awaiting_approval" && <Link to="/approvals" className="font-medium text-blue-600 hover:underline">Mở hộp Duyệt →</Link>}
                  </div>
                </div>
              )}
              {note !== null && !edit && (
                <div className="space-y-2 border-t border-line p-4">
                  <p className="font-medium text-ink">Góp ý để AI viết lại</p>
                  <textarea rows={3} className={inputCls} placeholder="Vd: Bỏ câu cam kết kết quả, mở đầu bằng 1 con số, ngắn lại còn 150 chữ…" value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button variant="primary" icon={Sparkles} loading={busy === "regen"} disabled={!note.trim()} onClick={() => run("regen", () => api.post(`content/${c.id}/regenerate`, { note }), "Agent đang viết lại theo góp ý — kết quả mới hiện ở đây khi xong")}>Gửi cho agent viết lại</Button>
                </div>
              )}
            </div>
          ) : t.output ? (
            <div className="rounded-2xl border border-line">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="font-semibold text-ink">Kết quả</p>
                {!edit && <Button size="sm" variant="primary" icon={Pencil} onClick={() => setEdit(structuredClone(t.output))}>Chỉnh sửa</Button>}
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-4 scroll-thin">
                {edit ? <ValueEditor value={edit} onChange={setEdit} /> : <ValueView value={t.output} />}
              </div>
              {edit && (
                <div className="flex flex-wrap gap-2 border-t border-line p-4">
                  <Button variant="primary" icon={Check} loading={busy === "saveOut"} onClick={() => run("saveOut", () => api.put(`tasks/${t.id}/output`, { output: edit }), "Đã lưu kết quả đã sửa")}>Lưu</Button>
                  <Button variant="ghost" icon={X} onClick={() => setEdit(null)}>Huỷ sửa</Button>
                  <p className="w-full text-xs text-muted">Các khâu đã chạy sau khâu này không tự làm lại — muốn áp dụng thì bấm “Chạy lại” ở khâu sau.</p>
                </div>
              )}
            </div>
          ) : (
            <Empty>{["pending", "ready", "running", "in_review", "revising"].includes(t.status) ? "Agent đang làm — kết quả sẽ hiện ở đây khi xong." : "Khâu này chưa có kết quả."}</Empty>
          )}

          {t.runs?.length > 0 && (
            <details className="rounded-xl border border-line p-3 text-xs">
              <summary className="cursor-pointer font-medium text-ink">Lượt chạy ({t.runs.length})</summary>
              <ul className="mt-2 space-y-1">{t.runs.map((r: any) => <li key={r.id} className="text-muted">#{r.attempt} · {r.model ?? "—"} · {num(r.tokens_in)}/{num(r.tokens_out)} token · {TASK_STATUS[r.status]?.label ?? r.status}{r.error ? ` · ${typeof r.error === "string" ? r.error : r.error.message ?? ""}` : ""}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Xem kết quả dạng đọc được (không phải JSON thô). */
function ValueView({ value, depth = 0 }: { value: any; depth?: number }) {
  if (value == null || value === "") return <span className="text-muted">—</span>;
  if (typeof value === "number") return <span className="tabular-nums text-ink">{value > 0 && value <= 1 && !Number.isInteger(value) ? `${Math.round(value * 100)}%` : num(value)}</span>;
  if (typeof value === "boolean") return <span className="text-ink">{value ? "Có" : "Không"}</span>;
  if (typeof value === "string") return <span className="whitespace-pre-line text-ink">{value}</span>;
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x !== "object" || x == null)) return <ul className="list-disc space-y-0.5 pl-5">{value.map((x, i) => <li key={i}><ValueView value={x} depth={depth + 1} /></li>)}</ul>;
    return <div className="grid gap-2 md:grid-cols-2">{value.map((x, i) => <div key={i} className="rounded-xl border border-line p-3"><ValueView value={x} depth={depth + 1} /></div>)}</div>;
  }
  return (
    <div className={cx("space-y-3", depth > 0 && "space-y-1.5")}>
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className={cx(depth === 0 ? "" : "text-[13px]")}>
          <p className={cx("font-semibold uppercase tracking-wide text-muted", depth === 0 ? "mb-1 text-xs" : "text-[11px]")}>{label(k)}</p>
          <ValueView value={v} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

/** Sửa kết quả theo từng mục: chữ → ô nhập, danh sách chữ → mỗi dòng 1 mục, số → ô số, đối tượng → lồng nhau. */
function ValueEditor({ value, onChange, depth = 0 }: { value: any; onChange: (v: any) => void; depth?: number }) {
  if (typeof value === "string") return value.length > 80 || value.includes("\n")
    ? <textarea rows={Math.min(8, Math.max(2, Math.ceil(value.length / 90)))} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
    : <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />;
  if (typeof value === "number") return <input type="number" step="any" className={inputCls} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
  if (typeof value === "boolean") return <select className={inputCls} value={value ? "1" : "0"} onChange={(e) => onChange(e.target.value === "1")}><option value="1">Có</option><option value="0">Không</option></select>;
  if (value == null) return <input className={inputCls} value="" onChange={(e) => onChange(e.target.value)} />;
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === "string")) return <textarea rows={Math.min(10, Math.max(3, value.length + 1))} className={inputCls} value={value.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} placeholder="Mỗi dòng 1 mục" />;
    return (
      <div className="space-y-2">{value.map((x, i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-muted"><span>Mục {i + 1}</span><button onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-rose-500 hover:underline">Xoá mục</button></div>
          <ValueEditor value={x} depth={depth + 1} onChange={(nv) => onChange(value.map((y, j) => (j === i ? nv : y)))} />
        </div>))}
      </div>
    );
  }
  return (
    <div className="space-y-3">{Object.entries(value).map(([k, v]) => (
      <div key={k}>
        <p className={cx("mb-1 font-semibold text-muted", depth === 0 ? "text-xs uppercase tracking-wide" : "text-[11px]")}>{label(k)}</p>
        <ValueEditor value={v} depth={depth + 1} onChange={(nv) => onChange({ ...value, [k]: nv })} />
      </div>))}
    </div>
  );
}
