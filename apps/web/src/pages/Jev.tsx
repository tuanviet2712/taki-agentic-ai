import { useState, type ReactNode } from "react";
import { Activity, ChevronDown, CircleDollarSign, Play, ShieldAlert, Sparkles, Timer, Zap } from "lucide-react";
import { api, useApi } from "../lib/api";
import { INTENT, LEAD, hhmm, ddmm, num } from "../lib/format";
import { Badge, Button, Card, Empty, JevBadge, Loading, Modal, PageHeader, ProbBar, Progress, Stat, Tabs, cx, inputCls, platformName, useToast } from "../components/ui";

// ---------- Vietnamese labels for question keys & choice options ----------
const Q_LABEL: Record<string, string> = {
  intent: "Ý định khách", lead_temperature: "Độ nóng lead", wants_human: "Muốn gặp người thật", serious_complaint: "Phàn nàn nghiêm trọng",
  negotiating: "Đang mặc cả giá", injection: "Prompt injection", opt_out: "Từ chối nhận tin", heard_from: "Biết đến qua", product_interest: "Khóa học quan tâm",
  guarantees_outcome: "Cam kết kết quả", unsupported_fact: "Thông tin không có căn cứ", leaks_internal: "Lộ thông tin nội bộ", answers_question: "Trả lời đúng câu hỏi",
  tone: "Giọng điệu", audience_fit: "Đúng chân dung CEO/SME", brand_voice: "Đúng giọng thương hiệu", hook_strength: "Sức mạnh hook", cta_clarity: "CTA rõ ràng",
  specificity: "Giá trị cụ thể", outcome_guarantee: "Hứa hẹn kết quả tài chính", ad_policy_risk: "Rủi ro chính sách quảng cáo", answerable: "Đủ thông tin để trả lời",
  fit: "Độ khớp mục tiêu", reason: "Lý do từ chối",
};
const qLabel = (k: string) => Q_LABEL[k] ?? (/^c\d+$/.test(k) ? `Bình luận #${+k.slice(1) + 1}` : /^p\d+$/.test(k) ? `Đoạn tri thức #${+k.slice(1) + 1}` : k);
const OPT: Record<string, string> = {
  ...INTENT, purchase_intent: "Muốn mua", question: "Hỏi thông tin", praise: "Khen / đồng tình", negative: "Tiêu cực", spam: "Spam",
  not_mentioned: "Không nhắc tới", off_brand_tone: "Lệch giọng thương hiệu", factual_error: "Sai thông tin", off_strategy: "Lệch chiến lược",
  too_long_or_weak: "Dài / yếu", policy_risk: "Rủi ro chính sách", none: "Không có",
};
const optLabel = (o: string) => OPT[o] ?? (platformName(o) !== o ? platformName(o) : o);
export const usd = (micros?: number | null) => {
  const v = (micros ?? 0) / 1e6;
  return v === 0 ? "$0" : v < 0.0001 ? `$${v.toFixed(6)}` : `$${v.toFixed(4)}`;
};

// ---------- Answer renderer (Noul / Choice / Score) ----------
function levelsOf(a: any) { return Object.keys(a.probabilities ?? {}).sort((x, y) => +x - +y); }
function normScore(a: any) { const n = levelsOf(a).length; return n > 1 ? a.score / (n - 1) : 0; }

export function AnswerView({ k, a, q }: { k: string; a: any; q?: any }) {
  const head = (extra?: ReactNode) => (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium text-ink" title={q?.instructions}>{qLabel(k)} <span className="text-xs font-normal text-muted">· {a.type === "noul" ? "Có/Không" : a.type === "choice" ? "Chọn một" : "Chấm điểm"}</span></p>
      {extra}
    </div>
  );
  const conf = a.confidence != null && <Badge tone={a.confidence >= 0.6 ? "blue" : "amber"}>độ tự tin {Math.round(a.confidence * 100)}%</Badge>;
  if (a.type === "noul") return (
    <div className="rounded-xl border border-line p-3">{head()}<ProbBar label="Xác suất “Có”" p={a.noul} tone={a.noul >= 0.5 ? "amber" : "green"} /></div>
  );
  if (a.type === "choice") {
    const opts = Object.entries(a.probabilities ?? {}).sort((x: any, y: any) => y[1] - x[1]) as [string, number][];
    return (
      <div className="rounded-xl border border-line p-3">
        {head(<span className="flex items-center gap-2"><Badge tone="violet">{optLabel(a.choice)}</Badge>{conf}</span>)}
        <div className="space-y-1.5">
          {opts.map(([o, p]) => <ProbBar key={o} label={<span className={cx(o === a.choice && "font-semibold text-violet-600 dark:text-violet-300")}>{o === a.choice ? "✓ " : ""}{optLabel(o)}</span>} p={p} tone={o === a.choice ? "violet" : "gray"} hint={q?.criteria?.[o]} />)}
        </div>
      </div>
    );
  }
  if (a.type === "score") {
    const lv = levelsOf(a);
    const best = lv.reduce((m, l) => (a.probabilities[l] > a.probabilities[m] ? l : m), lv[0]);
    return (
      <div className="rounded-xl border border-line p-3">
        {head(<span className="flex items-center gap-2"><Badge tone="blue">{a.score?.toFixed(2)} / {lv.length - 1} · {Math.round(normScore(a) * 100)}%</Badge>{conf}</span>)}
        <div className="space-y-1.5">
          {lv.map((l) => {
            const desc = a.legend?.[l] ?? q?.criteria?.[+l];
            return <ProbBar key={l} label={<span className={cx(l === best && "font-semibold")}>Mức {l}{desc && !/^level \d+$/.test(desc) ? <span className="font-normal text-muted"> — {desc}</span> : null}</span>} p={a.probabilities[l]} tone={l === best ? "blue" : "gray"} />;
          })}
        </div>
      </div>
    );
  }
  return <pre className="rounded-xl bg-soft p-3 text-xs">{JSON.stringify(a, null, 2)}</pre>;
}

function answerChips(answers: any) {
  const e = Object.entries(answers ?? {}) as [string, any][];
  const chips = [
    ...e.filter(([, a]) => a.type === "choice").slice(0, 2).map(([k, a]) => `${qLabel(k)}: ${optLabel(a.choice)}`),
    ...e.filter(([, a]) => a.type === "score").slice(0, 2).map(([k, a]) => `${qLabel(k)}: ${Math.round(normScore(a) * 100)}%`),
    ...e.filter(([, a]) => a.type === "noul" && a.noul >= 0.5).slice(0, 2).map(([k, a]) => `${qLabel(k)} ${Math.round(a.noul * 100)}%`),
  ];
  return chips.slice(0, 3);
}
function decisionText(purpose: string, d: any): { text: string; tone: "green" | "red" | "amber" | "blue" | "gray" } {
  if (!d) return { text: "—", tone: "gray" };
  switch (purpose) {
    case "chat.turn":
      if (d.injection) return { text: "Chặn prompt injection", tone: "red" };
      if (d.optOut) return { text: "Khách từ chối nhận tin", tone: "red" };
      return { text: `${LEAD[d.leadGrade]?.label ?? d.leadGrade ?? "Lead"}${d.handoff ? " · chuyển người" : " · bot trả lời"}`, tone: d.handoff ? "amber" : "green" };
    case "chat.guard": return d.pass ? { text: "Cho gửi", tone: "green" } : { text: `Chặn: ${(d.reasons ?? []).join(", ")}`, tone: "red" };
    case "review.content": return { text: `${d.total}đ · ${d.verdict === "pass" ? "đạt" : d.verdict === "block" ? "chặn" : d.verdict}`, tone: d.verdict === "pass" ? "green" : d.verdict === "block" ? "red" : "amber" };
    case "rag.select": return { text: `Chọn ${d.selected?.length ?? 0} đoạn${d.answerable ? "" : " · thiếu thông tin"}`, tone: d.answerable ? "blue" : "amber" };
    case "comments.classify": return { text: `${Object.keys(d.labels ?? {}).length} bình luận${d.hiddenSpam ? ` · ẩn ${d.hiddenSpam} spam` : ""}`, tone: "blue" };
    case "post.fit": return { text: `Điểm bài ${d.postScore}`, tone: "blue" };
    case "feedback.rejection": return { text: optLabel(d.reason), tone: "amber" };
    default: return { text: JSON.stringify(d).slice(0, 60), tone: "gray" };
  }
}

function Collapsible({ title, data }: { title: string; data: any }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-ink">{title}<ChevronDown className={cx("h-4 w-4 transition", open && "rotate-180")} /></button>
      {open && <pre className="max-h-72 overflow-auto border-t border-line bg-soft p-3 text-xs text-ink scroll-thin">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
function AnswerGrid({ answers, questions }: { answers: any; questions?: any }) {
  return <div className="grid gap-3 md:grid-cols-2">{Object.entries(answers ?? {}).map(([k, a]) => <AnswerView key={k} k={k} a={a} q={questions?.[k]} />)}</div>;
}

// ---------- Console presets ----------
const PRESETS = {
  "chat.turn": { label: "Tin nhắn khách", example: "Anh muốn đăng ký khóa CEO đợt Hà Nội, học phí bao nhiêu em? Số anh 0912345678" },
  "chat.guard": { label: "Câu trả lời của bot", example: "Dạ khóa CEO cam kết tăng doanh thu x2 sau 3 tháng ạ" },
  "review.content": { label: "Nội dung bài viết (dòng 1 là hook)", example: "3 việc CEO nên ngừng tự làm ngay tuần này\nPhần lớn chủ doanh nghiệp 20–50 nhân sự vẫn tự duyệt từng đơn, tự trả lời khách, tự chấm lương.\nChương trình CEO Vận Hành Tự Động giúp chuẩn hóa quy trình và giao việc trong 3 ngày.\nBình luận VẬN HÀNH để nhận checklist miễn phí." },
  "comments.classify": { label: "Danh sách bình luận (mỗi dòng 1 bình luận)", example: "Học phí AI Business System bao nhiêu ạ?\nĐăng ký cho em 1 suất đợt tháng 11\nBài hay quá, cảm ơn DOTAKA\nHọc xong chẳng áp dụng được gì\nVay tiền nhanh 5 phút inbox" },
} as const;
type Preset = keyof typeof PRESETS;

function Console() {
  const toast = useToast();
  const [preset, setPreset] = useState<Preset>("chat.turn");
  const [text, setText] = useState<string>(PRESETS["chat.turn"].example);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const run = async () => {
    setBusy(true);
    try { setRes(await api.post("jev/try", { preset, text })); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const d = res?.decision ? decisionText(preset, res.decision) : null;
  return (
    <Card title={<span className="flex items-center gap-2"><Zap className="h-4 w-4 text-violet-500" />Thử Jev</span>}>
      <div className="grid gap-3 md:grid-cols-[240px_1fr]">
        <select className={inputCls} value={preset} onChange={(e) => { const p = e.target.value as Preset; setPreset(p); setText(PRESETS[p].example); setRes(null); }}>
          {(Object.keys(PRESETS) as Preset[]).map((p) => <option key={p} value={p}>{PRESETS[p].label}</option>)}
        </select>
        <textarea className={cx(inputCls, "min-h-28")} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="mt-3 flex justify-end"><Button variant="primary" icon={Play} loading={busy} onClick={run} disabled={text.trim().length < 2}>Chạy bộ câu hỏi</Button></div>
      {res && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <JevBadge source={res.judgment.source} /><span>{res.judgment.model}</span><span>· {res.judgment.latencyMs} ms</span>
            {d && <Badge tone={d.tone}>Code quyết định: {d.text}</Badge>}
          </div>
          {res.comments && <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted">{res.comments.map((c: string, i: number) => <li key={i}>{c}</li>)}</ol>}
          <AnswerGrid answers={res.judgment.answers} />
          {res.decision && <Collapsible title="Quyết định (decision JSON)" data={res.decision} />}
        </div>
      )}
    </Card>
  );
}

const TAG: Record<string, { label: string; tone: "green" | "amber" | "red" | "violet" | "gray" }> = {
  happy: { label: "thông thường", tone: "green" }, hard: { label: "khó", tone: "amber" }, adversarial: { label: "tấn công", tone: "red" }, regression: { label: "hồi quy", tone: "violet" },
};
function EvalCard() {
  const toast = useToast();
  const { data: history, reload } = useApi<any[]>("evals");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const run = async () => {
    setBusy(true);
    try { const r = await api.post("evals/chat"); setRes(r); reload(); toast(r.ok ? `Eval đạt ${r.passed}/${r.cases}` : `Eval chưa đạt ngưỡng: ${r.passed}/${r.cases}`, r.ok ? "ok" : "err"); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Card title="Bộ kiểm thử (eval) chat" action={<Button size="sm" variant="primary" icon={Play} loading={busy} onClick={run}>{busy ? "Đang chạy…" : "Chạy eval"}</Button>}>
      <p className="mb-3 text-xs text-muted">12 tình huống tin nhắn mẫu (hỏi giá, đăng ký, phàn nàn, prompt injection…) chạy qua Jev + code định tuyến; cần đạt ≥ 80% trước khi nâng quyền tự chủ Chat Agent.</p>
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div>
          {!res ? <Empty>Bấm “Chạy eval” để kiểm thử (mất khoảng 10 giây khi dùng Jev thật).</Empty> : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-2xl font-bold text-ink">{res.passed}/{res.cases}</p>
                <Badge tone={res.ok ? "green" : "red"}>{res.ok ? "Đạt" : "Chưa đạt"} · {Math.round(res.score * 100)}% / ngưỡng {Math.round(res.threshold * 100)}%</Badge>
                <JevBadge source={res.source} />
              </div>
              <Progress value={res.score * 100} tone={res.ok ? "green" : "red"} />
              <div className="max-h-80 divide-y divide-line overflow-auto scroll-thin">
                {res.rows.map((r: any) => (
                  <div key={r.id} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={r.ok ? "green" : "red"}>{r.ok ? "✓ Đạt" : "✗ Sai"}</Badge>
                      {(r.tags ?? []).map((t: string) => <Badge key={t} tone={TAG[t]?.tone ?? "gray"}>{TAG[t]?.label ?? t}</Badge>)}
                      <span className="font-mono text-[11px] text-muted">{r.id}</span>
                    </div>
                    <p className="text-sm text-ink">{r.text}</p>
                    {r.fails?.length > 0 && <p className="text-xs text-rose-600">{r.fails.join(" · ")}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">Lịch sử chạy</p>
          {!history?.length ? <p className="text-xs text-muted">Chưa có lần chạy nào.</p> : (
            <div className="space-y-1.5">
              {history.slice(0, 8).map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-2 rounded-lg bg-soft px-2.5 py-1.5 text-xs">
                  <span className="tabular-nums text-muted">{hhmm(h.created_at)} {ddmm(h.created_at)}</span>
                  <JevBadge source={h.source} />
                  <Badge tone={h.avg_score >= 80 ? "green" : "red"}>{h.passed}/{h.cases} · {Math.round(h.avg_score)}%</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function Jev() {
  const { data: stats } = useApi<any>("jev/stats", ["conversation.", "review.", "post.", "approval.decided"]);
  const [purpose, setPurpose] = useState("all");
  const { data: list, loading } = useApi<any[]>(`jev/judgments${purpose === "all" ? "" : `?purpose=${purpose}`}`, ["conversation.", "review.", "post."]);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: detail } = useApi<any>(openId ? `jev/judgments/${openId}` : null);
  if (!stats) return <Loading />;

  const purposes: Record<string, string> = stats.purposes ?? {};
  const rows: any[] = stats.byPurpose ?? [];
  const totalN = rows.reduce((s, r) => s + r.n, 0) || 1;
  const avgLatency = rows.reduce((s, r) => s + (r.latency ?? 0) * r.n, 0) / totalN;
  const totalCost = rows.reduce((s, r) => s + (r.cost_micros ?? 0), 0);
  const o = stats.outcomes ?? {};
  const shown = detail && detail.id === openId ? detail : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Jev · System One" subtitle="Lớp phán đoán nhanh của hệ thống: Jev trả lời câu hỏi có kiểu (Có/Không, Chọn một, Chấm điểm) kèm xác suất — code quyết định hành động theo ngưỡng." />

      <div className={cx("flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center", stats.enabled ? "border-violet-500/30 bg-violet-500/5" : "border-amber-500/30 bg-amber-500/5")}>
        <Sparkles className={cx("h-5 w-5 shrink-0", stats.enabled ? "text-violet-500" : "text-amber-500")} />
        {stats.enabled
          ? <p className="text-sm text-ink"><Badge tone="green">LIVE</Badge> <span className="ml-1">Đang gọi Jev thật qua TypeSafe · model <b>{stats.model}</b>. Các phán đoán cũ có nhãn “heuristic” được tạo trước khi bật key.</span></p>
          : <p className="text-sm text-ink"><Badge tone="amber">Heuristic</Badge> <span className="ml-1">Chưa có khóa TypeSafe — hệ thống dùng luật heuristic trả về cùng định dạng. Đặt <code className="rounded bg-soft px-1">TYPESAFE_API_KEY</code> trong file <code className="rounded bg-soft px-1">.env</code> rồi khởi động lại API để dùng Jev thật.</span></p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat icon={Activity} tone="violet" label="Tổng phán đoán" value={num(stats.total)} sub={`${Object.keys(purposes).length} mục đích sử dụng`} />
        <Stat icon={Timer} tone="blue" label="Độ trễ trung bình" value={`${Math.round(avgLatency)} ms`} sub="mỗi lần hỏi một bộ câu hỏi" />
        <Stat icon={CircleDollarSign} tone="green" label="Tổng chi phí Jev" value={usd(totalCost)} sub={`${num(rows.reduce((s, r) => s + (r.tokens ?? 0), 0))} token đầu vào`} />
        <Stat icon={ShieldAlert} tone="amber" label="Guardrail đã kích hoạt" value={num((o.handoffs ?? 0) + (o.injections ?? 0) + (o.guardBlocked ?? 0) + (o.reviewBlocked ?? 0))}
          sub={<span>{o.handoffs} chuyển người · {o.injections} chặn injection · {o.guardBlocked} chặn câu trả lời · {o.reviewBlocked} chặn bài · {o.hotLeads} lead nóng</span>} />
      </div>

      <div className="grid gap-6 wide:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Theo mục đích sử dụng">
          {rows.length === 0 ? <Empty>Chưa có phán đoán nào.</Empty> : (
            <div className="divide-y divide-line">
              {rows.map((r) => (
                <div key={r.purpose + r.source} className="grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 sm:grid-cols-[1fr_90px_80px_110px]">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{purposes[r.purpose] ?? r.purpose}</p><p className="text-xs text-muted">{r.purpose}{r.errors ? ` · ${r.errors} lỗi` : ""}</p></div>
                  <JevBadge source={r.source} />
                  <p className="hidden text-sm tabular-nums text-ink sm:block">{r.n} lần</p>
                  <p className="hidden text-xs tabular-nums text-muted sm:block">{Math.round(r.latency ?? 0)} ms · {usd(r.cost_micros)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Cách đọc câu trả lời của Jev">
          <ul className="space-y-3 text-sm text-ink">
            <li><Badge tone="amber">Có/Không</Badge> <span className="text-muted">— xác suất câu trả lời là “Có” (0–100%). Code so với ngưỡng, ví dụ injection ≥ 50% thì chặn.</span></li>
            <li><Badge tone="violet">Chọn một</Badge> <span className="text-muted">— một phương án được chọn, xác suất cho từng phương án và độ tự tin.</span></li>
            <li><Badge tone="blue">Chấm điểm</Badge> <span className="text-muted">— vị trí trên các mức có thứ tự (0 = thấp nhất), xác suất từng mức và giá trị chuẩn hóa 0–100%.</span></li>
            <li className="rounded-xl bg-soft p-3 text-xs text-muted">Lưu ý: <b className="text-ink">độ tự tin ≠ độ chính xác</b>. Độ tự tin cho biết phân phối xác suất tập trung đến đâu; kết quả vẫn cần đối chiếu dữ liệu thật và ý kiến của Sếp.</li>
          </ul>
        </Card>
      </div>

      <Console />

      <EvalCard />

      <Card title="Nhật ký phán đoán">
        <Tabs value={purpose} onChange={setPurpose} tabs={[{ value: "all", label: "Tất cả" }, ...Object.entries(purposes).map(([k, v]) => ({ value: k, label: v.replace(/\s*\(.*\)/, "") }))]} />
        <div className="mt-3">
          {loading && !list ? <Loading /> : !list?.length ? <Empty>Chưa có phán đoán cho mục này.</Empty> : (
            <div className="max-h-[560px] divide-y divide-line overflow-auto scroll-thin">
              {list.map((j) => {
                const d = decisionText(j.purpose, j.decision);
                return (
                  <button key={j.id} onClick={() => setOpenId(j.id)} className="grid w-full grid-cols-1 gap-2 px-1 py-3 text-left hover:bg-soft sm:grid-cols-[70px_1fr_auto] sm:items-center">
                    <p className="text-xs tabular-nums text-muted">{hhmm(j.created_at)} · {ddmm(j.created_at)}</p>
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">{purposes[j.purpose] ?? j.purpose}<JevBadge source={j.source} />{j.error && <Badge tone="red">lỗi</Badge>}</p>
                      <div className="flex flex-wrap gap-1">{answerChips(j.answers).map((c) => <span key={c} className="rounded-md bg-soft px-1.5 py-0.5 text-[11px] text-muted">{c}</span>)}</div>
                    </div>
                    <Badge tone={d.tone} className="max-w-[260px] truncate">{d.text}</Badge>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Modal open={!!openId} onClose={() => setOpenId(null)} wide title={shown ? <span className="flex flex-wrap items-center gap-2">{purposes[shown.purpose] ?? shown.purpose}<JevBadge source={shown.source} /></span> : "Đang tải…"}>
        {!shown ? <Loading /> : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted">
              <span>{new Date(shown.created_at).toLocaleString("vi-VN")}</span><span>· {shown.model}</span><span>· {shown.latency_ms} ms</span><span>· {num(shown.tokens_in)} token</span><span>· {usd(shown.cost_micros)}</span>
            </div>
            {shown.error && <p className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600">{shown.error}</p>}
            {shown.decision && (() => { const d = decisionText(shown.purpose, shown.decision); return <div className="flex items-center gap-2 text-sm text-ink">Code đã quyết định: <Badge tone={d.tone}>{d.text}</Badge></div>; })()}
            <AnswerGrid answers={shown.answers} questions={shown.questions} />
            <Collapsible title="Quyết định (decision JSON)" data={shown.decision} />
            <Collapsible title="Trạng thái đầu vào (state JSON)" data={shown.state} />
            {shown.purpose === "review.content" && shown.decision?.total != null && <div><p className="mb-1 text-xs text-muted">Tổng điểm review</p><Progress value={shown.decision.total} tone={shown.decision.total >= 70 ? "green" : "amber"} /></div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
