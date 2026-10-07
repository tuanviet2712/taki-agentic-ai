import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BarChart3, ClipboardCheck, ExternalLink, FileText, Lightbulb, ListChecks, Megaphone, PenLine, Search, Send, Square, Target, Video } from "lucide-react";
import { api, useApi } from "../lib/api";
import { AGENT_LABEL, TASK_STATUS, timeAgo } from "../lib/format";
import { TaskResult } from "./TaskResult";
import { Badge, Button, Card, Field, Modal, Toggle, cx, inputCls, useToast } from "./ui";

type Spec = { kind: "task" | "action" | "page"; does: string; href?: string; needsText: boolean; example?: string };
type Overview = {
  agents: Record<string, Spec>;
  tasks: { id: string; agent_key: string; title: string; status: string; step: string | null; created_at: string }[];
  sources: { id: string; agent_key: string; title: string; updated_at: string; goal_title: string | null }[];
};

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Nghiên cứu & kế hoạch", keys: ["brief", "market_research", "strategy"] },
  { title: "Sáng tạo nội dung", keys: ["content", "video_script", "seo_web"] },
  { title: "Đo lường & tối ưu", keys: ["ads", "analytics", "feedback", "review"] },
  { title: "Agent có trang làm việc riêng", keys: ["dna_intake", "creative", "publishing", "post_scanner", "chat", "follow_up"] },
];
const ICON: Record<string, any> = {
  brief: Target, market_research: Search, strategy: ListChecks, content: PenLine, video_script: Video, seo_web: FileText,
  ads: Megaphone, analytics: BarChart3, feedback: Lightbulb, review: ClipboardCheck,
};
const TASK_NAME: Record<string, string> = {
  brief: "Chuẩn hóa brief", market_research: "Nghiên cứu", strategy: "Lập kế hoạch", content: "Viết bài", video_script: "Viết kịch bản", seo_web: "Viết bài SEO",
  ads: "Phân tích quảng cáo", analytics: "Báo cáo nhanh", feedback: "Rút bài học", review: "Chấm bài",
};
/** Kết quả nào làm đầu vào được cho agent nào. */
const INPUTS: Record<string, string[]> = {
  market_research: ["brief"], strategy: ["brief", "market_research"],
  content: ["strategy", "market_research", "brief"], video_script: ["strategy", "market_research", "brief"], seo_web: ["strategy", "market_research"],
};
/** "Giao bước tiếp" gợi ý sau khi 1 việc xong. */
const NEXT: Record<string, string> = { brief: "market_research", market_research: "strategy", strategy: "content" };
const PIECES = ["content", "video_script", "seo_web"];
const CHANNELS = [["facebook", "Facebook"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"], ["zalo", "Zalo"], ["website", "Website"]];

export type AssignRequest = { agent: string; basedOn?: string[] } | null;

/**
 * Giao việc riêng (tuỳ chọn, ngoài luồng tự động): bình thường các agent chạy theo chuỗi; khi cần, Sếp bấm "Giao việc riêng"
 * (nút đầu trang hoặc trên thẻ agent) → 1 agent làm đúng 1 việc rồi DỪNG. request.agent = "" → mở bảng chọn agent.
 * Thẻ "Việc đã giao riêng" chỉ hiện khi đã có việc.
 */
export function AssignWork({ request, onRequest }: { request: AssignRequest; onRequest: (r: AssignRequest) => void }) {
  const data = useApi<Overview>("agents/assigned", ["task.", "review.", "approval."]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const agents = data.data?.agents ?? {};
  const tasks = data.data?.tasks ?? [];

  return (
    <>
      {tasks.length > 0 && (
        <Card title="Việc đã giao riêng" action={<span className="text-xs text-muted">Chạy ngoài luồng tự động · xong bước đó là dừng</span>}>
          <ul className="-mx-5 -mb-5 divide-y divide-line">
            {tasks.slice(0, 8).map((t) => {
              const ts = TASK_STATUS[t.status] ?? { label: t.status, tone: "gray" as const };
              const next = t.status === "done" ? NEXT[t.agent_key] : undefined;
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                  <button onClick={() => setOpenTask(t.id)} className="min-w-0 flex-1 basis-60 text-left">
                    <p className="truncate text-sm font-medium text-ink hover:text-blue-600">{t.title}</p>
                    <p className="text-xs text-muted">{AGENT_LABEL[t.agent_key] ?? t.agent_key} · {timeAgo(t.created_at)}{t.step ? ` · ${t.step}` : ""}</p>
                  </button>
                  <Badge tone={ts.tone}>{ts.label}</Badge>
                  {next && <Button size="sm" variant="soft" icon={ArrowRight} onClick={() => onRequest({ agent: next, basedOn: [t.id] })}>Giao bước tiếp: {TASK_NAME[next]}</Button>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <TaskResult id={openTask} onClose={() => setOpenTask(null)} />
      <Modal open={request?.agent === ""} onClose={() => onRequest(null)} title="Giao việc riêng — chọn agent" wide>
        <div className="space-y-4">
          <p className="text-sm text-muted">Bình thường các agent tự chạy theo luồng (Kế hoạch / Lái tự động). Giao việc riêng = 1 agent làm đúng 1 việc rồi <b className="text-ink">dừng</b>, không mở khâu sau.</p>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {g.keys.filter((k) => agents[k]).map((k) => {
                  const sp = agents[k];
                  const Icon = ICON[k] ?? ExternalLink;
                  return (
                    <button key={k} type="button" onClick={() => onRequest({ agent: k })} title={sp.does}
                      className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-left text-sm transition hover:border-blue-400 hover:bg-blue-500/5">
                      <Icon className={cx("h-4 w-4 shrink-0", sp.kind === "page" ? "text-muted" : "text-blue-600")} />
                      <span className="min-w-0 flex-1 truncate"><b className="font-medium text-ink">{sp.kind === "page" ? AGENT_LABEL[k] : TASK_NAME[k]}</b><span className="text-muted"> · {sp.kind === "page" ? "mở trang" : AGENT_LABEL[k]}</span></span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Modal>
      <AssignModal request={request?.agent ? request : null} spec={request?.agent ? agents[request.agent] : undefined} sources={data.data?.sources ?? []}
        onClose={() => onRequest(null)} onDone={(taskId) => { data.reload(); if (taskId) setOpenTask(taskId); }} />
    </>
  );
}

function AssignModal({ request, spec, sources, onClose, onDone }: { request: AssignRequest; spec?: Spec; sources: Overview["sources"]; onClose: () => void; onDone: (taskId?: string) => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const agent = request?.agent ?? "";
  const [text, setText] = useState("");
  const [basedOn, setBasedOn] = useState<string[]>([]);
  const [channel, setChannel] = useState("");
  const [budget, setBudget] = useState("");
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    setText(""); setBasedOn(request.basedOn ?? []); setChannel(""); setBudget(""); setPublish(false); setResult(null);
    if (spec?.kind === "page" && spec.href) { onClose(); nav(spec.href); }
  }, [request?.agent, request?.basedOn?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!request || !spec || spec.kind === "page") return null;
  const usable = sources.filter((s) => (INPUTS[agent] ?? []).includes(s.agent_key));
  const isPiece = PIECES.includes(agent);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post("agents/assign", {
        agent, instruction: text.trim(), basedOn,
        ...(channel ? { channel } : {}), ...(budget ? { budgetAds: Math.max(0, Math.round(Number(budget) || 0)) } : {}),
        ...(isPiece ? { publishAfterApproval: publish } : {}),
      });
      if (r.kind === "action") { setResult(r.text); onDone(); return; }
      toast(`Đã giao cho ${AGENT_LABEL[agent] ?? agent}: ${r.title}`);
      onClose(); onDone(r.taskId);
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`${TASK_NAME[agent] ?? "Giao việc"} · ${AGENT_LABEL[agent] ?? agent}`} wide
      footer={result ? <Button variant="primary" onClick={onClose}>Đóng</Button> : <><Button onClick={onClose}>Hủy</Button><Button variant="primary" icon={Send} loading={busy} onClick={submit}>{spec.kind === "action" ? "Làm ngay" : "Giao việc"}</Button></>}>
      {result ? (
        <pre className="whitespace-pre-wrap rounded-xl bg-soft p-4 text-sm leading-relaxed text-ink">{result}</pre>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">{spec.does}</p>
          {spec.kind === "task" && (
            <p className="flex items-start gap-2 rounded-xl bg-blue-500/5 p-3 text-xs text-muted">
              <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
              <span>Làm xong bước này là <b className="text-ink">dừng</b>. Kết quả nằm ở “Việc đã giao riêng” — Sếp xem, sửa, rồi bấm “Giao bước tiếp” nếu muốn đi tiếp.</span>
            </p>
          )}
          {(spec.needsText || spec.kind === "task") && (
            <Field label={agent === "review" ? "Bài cần chấm" : "Yêu cầu của Sếp"}>
              <textarea rows={agent === "review" ? 10 : 5} className={inputCls} placeholder={spec.example ? `VD: ${spec.example}` : ""} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          )}
          {usable.length > 0 && (
            <Field label="Dựa trên kết quả đã có (tuỳ chọn)" hint="Agent đọc kết quả các việc này trước khi làm">
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                {usable.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-soft">
                    <input type="checkbox" className="mt-1 accent-blue-600" checked={basedOn.includes(s.id)}
                      onChange={(e) => setBasedOn(e.target.checked ? [...basedOn, s.id].slice(0, 5) : basedOn.filter((x) => x !== s.id))} />
                    <span className="min-w-0"><span className="block truncate text-ink">{s.title}</span><span className="text-xs text-muted">{AGENT_LABEL[s.agent_key]} · {s.goal_title ? `kế hoạch “${s.goal_title}”` : "việc riêng"} · {timeAgo(s.updated_at)}</span></span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          {(isPiece || agent === "review") && (
            <Field label="Kênh">
              <select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">{agent === "seo_web" ? "Website (mặc định)" : agent === "video_script" ? "TikTok (mặc định)" : "Facebook (mặc định)"}</option>
                {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          )}
          {["brief", "strategy"].includes(agent) && (
            <Field label="Ngân sách quảng cáo (VND, tuỳ chọn)"><input type="number" min={0} className={inputCls} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Để trống nếu không chạy ads" /></Field>
          )}
          {isPiece && (
            <div className="flex items-start gap-3">
              <Toggle checked={publish} onChange={setPublish} />
              <div>
                <p className="text-sm font-medium text-ink">Sếp duyệt xong thì lên lịch đăng</p>
                <p className="text-xs text-muted">{publish ? "Duyệt ở hộp Duyệt → tự lên lịch đăng kênh đã chọn." : "Tắt: chỉ viết, duyệt xong lưu ở Nội dung — không đăng."}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
