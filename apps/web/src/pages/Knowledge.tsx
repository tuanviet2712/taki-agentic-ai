import { useEffect, useState } from "react";
import { BookOpen, FileWarning, Layers, Lightbulb, Pencil, Plus, Search } from "lucide-react";
import { api, useApi } from "../lib/api";
import { AGENT_LABEL, timeAgo } from "../lib/format";
import type { Tone } from "../lib/format";
import { Badge, Button, Card, Empty, Field, JevBadge, Loading, Modal, PageHeader, PlatformIcon, ProbBar, Stat, cx, inputCls, useToast } from "../components/ui";

const KINDS: Record<string, { label: string; tone: Tone }> = {
  faq: { label: "FAQ", tone: "blue" }, policy: { label: "Chính sách", tone: "violet" }, product: { label: "Sản phẩm", tone: "green" },
  schedule: { label: "Lịch khai giảng", tone: "amber" }, doc: { label: "Tài liệu", tone: "gray" },
};
const kindOf = (k: string) => KINDS[k] ?? { label: k, tone: "gray" as Tone };
const SOURCES = [
  { p: "sheets", name: "Google Sheets", note: "Lịch khai giảng, FAQ" }, { p: "google", name: "Google Drive / Docs", note: "Học phí, chính sách" },
  { p: "website", name: "Website taki.vn", note: "Trang khóa học" }, { p: "notion", name: "Notion", note: "Quy trình nội bộ" },
];
const EMPTY_FORM = { title: "", kind: "faq", source: "Tải lên trực tiếp", tags: "", body: "" };

export function Knowledge() {
  const toast = useToast();
  const { data: docs, reload } = useApi<any[]>("knowledge/docs");
  const { data: lessons } = useApi<any[]>("lessons");
  const { data: exemplars } = useApi<any[]>("exemplars");
  const [kind, setKind] = useState("all");
  const [selId, setSelId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("Học phí khóa CEO Vận Hành Tự Động bao nhiêu?");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => { if (docs?.length && !selId) setSelId(docs[0].id); }, [docs, selId]);
  if (!docs) return <Loading />;

  const kinds = [...new Set(docs.map((d) => d.kind))];
  const filtered = kind === "all" ? docs : docs.filter((d) => d.kind === kind);
  const sel = docs.find((d) => d.id === selId) ?? null;
  const drafts = docs.filter((d) => d.status === "draft").length;
  const activeLessons = (lessons ?? []).filter((l) => l.status === "active").length;

  const saveEdit = async () => {
    if (!sel) return;
    setSaving(true);
    try { await api.put(`knowledge/docs/${sel.id}`, { body: editBody }); toast("Đã lưu và chia lại đoạn tri thức"); setEditOpen(false); reload(); }
    catch (e: any) { toast(e.message, "err"); } finally { setSaving(false); }
  };
  const addDoc = async () => {
    setSaving(true);
    try {
      const d = await api.post("knowledge/docs", { title: form.title, kind: form.kind, source: form.source, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean), body: form.body });
      toast("Đã thêm tài liệu vào kho tri thức"); setAddOpen(false); setForm(EMPTY_FORM); setSelId(d.id); reload();
    } catch (e: any) { toast(e.message, "err"); } finally { setSaving(false); }
  };
  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try { setResult(await api.post("knowledge/search", { query })); } catch (e: any) { toast(e.message, "err"); } finally { setSearching(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Kho tri thức" subtitle="Quản lý, kết nối và tổ chức tri thức doanh nghiệp để AI Agent hiểu, học hỏi và trả lời chính xác."
        actions={<Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>Thêm tài liệu</Button>} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat icon={BookOpen} tone="blue" label="Tài liệu" value={docs.length} sub={`${kinds.length} loại tài liệu`} />
        <Stat icon={Layers} tone="violet" label="Đoạn tri thức" value={docs.reduce((s, d) => s + (d.chunks ?? 0), 0)} sub="bot chỉ trả lời theo các đoạn này" />
        <Stat icon={FileWarning} tone="amber" label="Tài liệu nháp cần điền" value={drafts} sub={drafts ? "Bot chưa dùng được cho tới khi điền" : "Không có tài liệu nháp"} />
        <Stat icon={Lightbulb} tone="green" label="Bài học đang hiệu lực" value={activeLessons} sub="rút ra từ dữ liệu & phản hồi của Sếp" />
      </div>

      <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="Thư viện tri thức">
          <div className="mb-3 flex flex-wrap gap-2">
            {["all", ...kinds].map((k) => (
              <button key={k} onClick={() => setKind(k)} className={cx("rounded-full border px-3 py-1 text-xs font-medium transition", kind === k ? "border-blue-600 bg-blue-600 text-white" : "border-line text-muted hover:text-ink")}>
                {k === "all" ? `Tất cả (${docs.length})` : `${kindOf(k).label} (${docs.filter((d) => d.kind === k).length})`}
              </button>
            ))}
          </div>
          {filtered.length === 0 ? <Empty>Chưa có tài liệu. Bấm “Thêm tài liệu” để bắt đầu.</Empty> : (
            <div className="divide-y divide-line">
              {filtered.map((d) => (
                <button key={d.id} onClick={() => setSelId(d.id)} className={cx("flex w-full flex-col gap-1 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-soft", selId === d.id && "bg-soft")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink">{d.title}</p>
                    <Badge tone={kindOf(d.kind).tone}>{kindOf(d.kind).label}</Badge>
                    {d.status === "draft" ? <Badge tone="amber">Cần điền câu trả lời</Badge> : <Badge tone="green">Đã xử lý</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span className="max-w-[22rem] truncate" title={d.source}>{String(d.source ?? "").replace(/^brain:[0-9a-f-]+:\d+\.\s*/i, "")}</span><span>·</span><span>{d.chunks} đoạn</span><span>·</span><span>cập nhật {timeAgo(d.updated_at)}</span>
                    {(d.tags ?? []).map((t: string) => <Badge key={t} tone="gray" className="!px-2 !py-0 text-[11px]">#{t}</Badge>)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="wide:sticky wide:top-4 wide:max-h-[calc(100vh-7rem)] wide:overflow-y-auto scroll-thin" title="Chi tiết tài liệu" action={sel && <Button size="sm" icon={Pencil} onClick={() => { setEditBody(sel.body ?? ""); setEditOpen(true); }}>Chỉnh sửa</Button>}>
          {!sel ? <Empty>Chọn một tài liệu để xem nội dung.</Empty> : (
            <div className="space-y-3">
              <div>
                <p className="font-semibold text-ink">{sel.title}</p>
                <p className="text-xs text-muted">{kindOf(sel.kind).label} · {sel.source} · {sel.chunks} đoạn tri thức</p>
              </div>
              {sel.status === "draft" && <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">Tài liệu nháp: Sếp cần điền câu trả lời chính xác, bot sẽ không dùng cho tới khi được xử lý.</p>}
              <ol className="max-h-[420px] space-y-2 overflow-auto scroll-thin">
                {(sel.body ?? "").split(/\n+/).filter((s: string) => s.trim()).map((line: string, i: number) => (
                  <li key={i} className="flex gap-2 rounded-xl bg-soft p-2.5 text-sm text-ink"><span className="shrink-0 text-xs tabular-nums text-muted">#{i}</span><span>{line}</span></li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 wide:grid-cols-[minmax(0,1fr)_380px]">
        <Card title={<span className="flex items-center gap-2">Tìm kiếm ngữ nghĩa {result?.source && <JevBadge source={result.source} />}</span>}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className={inputCls} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Ví dụ: Lịch khai giảng khóa CEO ở Hà Nội?" />
            <Button variant="primary" icon={Search} loading={searching} onClick={search} className="shrink-0">Tìm</Button>
          </div>
          {result && (
            <div className="mt-4 space-y-3">
              {typeof result.answerable === "number" && (
                <div className="rounded-xl border border-line p-3">
                  <ProbBar label={<span className="font-medium">Jev đánh giá đủ thông tin để trả lời: {Math.round(result.answerable * 100)}%</span>} p={result.answerable} tone={result.answerable >= 0.5 ? "green" : "amber"} />
                  {result.answerable < 0.5 && <p className="mt-2 text-xs text-amber-600">Kho tri thức có thể còn thiếu — bot sẽ chuyển câu hỏi dạng này cho đội sales.</p>}
                </div>
              )}
              {result.results.length === 0 ? <Empty>Không tìm thấy đoạn tri thức liên quan.</Empty> : result.results.map((r: any, i: number) => (
                <div key={r.ref} className="space-y-2 rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted"><span>#{i + 1} · {r.ref}</span><span>độ tự tin {Math.round((r.confidence ?? 0) * 100)}%</span></div>
                  <p className="text-sm text-ink">{r.text}</p>
                  <ProbBar label="Mức liên quan" p={(r.relevance ?? 0) / 100} tone={r.relevance >= 60 ? "green" : r.relevance >= 30 ? "blue" : "gray"} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Nguồn dữ liệu" action={<Badge tone="amber">sandbox — chưa kết nối thật</Badge>}>
          <div className="space-y-3">
            {SOURCES.map((s) => (
              <div key={s.name} className="flex items-center gap-3 rounded-xl border border-line p-3">
                {s.p === "notion" ? <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-xs font-bold text-card">N</span> : <PlatformIcon p={s.p} size={28} />}
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink">{s.name}</p><p className="text-xs text-muted">{s.note}</p></div>
                <Badge tone="gray">Sandbox</Badge>
              </div>
            ))}
            <p className="text-xs text-muted">Hiện tại Sếp thêm tài liệu thủ công. Đồng bộ tự động sẽ bật khi kết nối thật được cấu hình.</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Bài học AI đã rút ra">
          {!lessons ? <Loading /> : lessons.length === 0 ? <Empty>Chưa có bài học nào.</Empty> : (
            <div className="space-y-3">
              {lessons.map((l) => (
                <div key={l.id} className="rounded-xl border border-line p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="blue">{AGENT_LABEL[l.agent_key] ?? l.agent_key}</Badge><Badge tone={l.status === "active" ? "green" : "gray"}>{l.status === "active" ? "Đang hiệu lực" : l.status}</Badge></div>
                  <p className="text-sm text-ink">{l.statement}</p>
                  <p className="mt-1 text-xs text-muted">{l.evidence?.note}{l.review_at ? ` · xem lại ${timeAgo(l.review_at)}` : ""}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Mẫu tham chiếu (exemplar)">
          {!exemplars ? <Loading /> : exemplars.length === 0 ? <Empty>Chưa có mẫu tham chiếu. Khi Sếp duyệt/từ chối nội dung, hệ thống sẽ lưu mẫu tại đây.</Empty> : (
            <div className="space-y-3">
              {exemplars.map((x) => (
                <div key={x.id} className="rounded-xl border border-line p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone={x.kind === "avoid" ? "red" : "green"}>{x.kind === "avoid" ? "Nên tránh" : "Nên học theo"}</Badge><Badge tone="gray">{AGENT_LABEL[x.agent_key] ?? x.agent_key}</Badge><span className="text-xs text-muted">{timeAgo(x.created_at)}</span></div>
                  <p className="whitespace-pre-line text-sm text-ink">{x.text}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} wide title={`Chỉnh sửa: ${sel?.title ?? ""}`}
        footer={<><Button onClick={() => setEditOpen(false)}>Hủy</Button><Button variant="primary" loading={saving} disabled={editBody.trim().length < 10} onClick={saveEdit}>Lưu</Button></>}>
        <Field label="Nội dung" hint="Mỗi dòng là một đoạn tri thức; giá & lịch phải chính xác vì bot chỉ trả lời theo đây.">
          <textarea className={cx(inputCls, "min-h-72 font-mono text-[13px]")} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} wide title="Thêm tài liệu"
        footer={<><Button onClick={() => setAddOpen(false)}>Hủy</Button><Button variant="primary" loading={saving} disabled={form.title.trim().length < 2 || form.body.trim().length < 10} onClick={addDoc}>Thêm vào kho</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tiêu đề"><input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="VD: Học phí khóa Startup Launchpad 2026" /></Field>
          <Field label="Loại tài liệu">
            <select className={inputCls} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Nguồn"><input className={inputCls} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
          <Field label="Thẻ" hint="Cách nhau bằng dấu phẩy"><input className={inputCls} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Học phí, CEO" /></Field>
          <div className="sm:col-span-2">
            <Field label="Nội dung" hint="Mỗi dòng là một đoạn tri thức; giá & lịch phải chính xác vì bot chỉ trả lời theo đây.">
              <textarea className={cx(inputCls, "min-h-48")} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={"Học phí Startup Launchpad là 6.900.000đ cho 6 tuần online.\nĐăng ký trước 14 ngày giảm 10%."} />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
