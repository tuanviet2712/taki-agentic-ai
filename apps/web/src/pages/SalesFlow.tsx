import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bot, Check, Filter, Inbox, Lightbulb, Link2, Repeat, SlidersHorizontal, MessageCircle, Pause, Play, Plus, RefreshCw, RotateCcw, Save, Send, Sparkles, Trash2, UserRound, Users, Wand2, X } from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Button, Card, Empty, Field, Loading, PageHeader, Tabs, cx, inputCls, useToast } from "../components/ui";

/**
 * Kịch bản chốt đơn (Messenger + Zalo): mỗi sản phẩm 1 quy trình nhắn tin 7 bước, mục tiêu xin SĐT hoặc chốt đơn.
 * AI soạn từ sản phẩm + DNA → Sếp sửa → Chat thử (không gửi cho ai) → Bật: bot đi theo kịch bản ở mọi hội thoại về sản phẩm đó.
 */
type Stage = { key: string; goal: string; sayLike: string[]; nextWhen: string };
type Flow = { mode?: "auto" | "suggest"; objective: "link" | "phone_order" | "phone_consult"; objectiveNote: string; stages: Stage[]; objections: { q: string; a: string }[]; followUps: { afterHours: number; text: string }[] };
const STATUS: Record<string, [string, any]> = { none: ["Chưa có", "gray"], draft: ["Nháp", "amber"], active: ["Đang bật", "green"], paused: ["Tạm tắt", "gray"] };
const OBJECTIVE: Record<Flow["objective"], string> = { link: "Chốt bằng link đăng ký / mua", phone_order: "Xin SĐT + địa chỉ, lên đơn COD (sản phẩm giao hàng)", phone_consult: "Xin SĐT để tư vấn viên gọi (khoá học / dịch vụ)" };

export function SalesFlow() {
  const list = useApi<any[]>("sales-flows");
  const [key, setKey] = useState<string | null>(null);
  const [tab, setTab] = useState<"flow" | "insight">("flow");
  useEffect(() => { if (!key && list.data?.length) setKey(list.data[0].key); }, [list.data, key]);
  return (
    <div className="space-y-6">
      <PageHeader title="Kịch bản chốt đơn" subtitle="Quy trình nhắn tin Messenger & Zalo theo từng sản phẩm trong DNA (Mục tiêu & DNA): chào → khai thác → tư vấn → xử lý từ chối → xin SĐT → chốt → chăm lại. AI soạn từ sản phẩm + DNA, Sếp sửa rồi bật — bot đi theo kịch bản ở mọi hội thoại về sản phẩm đó." />
      <Tabs tabs={[{ value: "flow", label: "Kịch bản theo sản phẩm" }, { value: "insight", label: <span className="inline-flex items-center gap-1"><Lightbulb className="h-4 w-4" />Thấu hiểu khách & tối ưu</span> }]} value={tab} onChange={setTab} />
      {tab === "insight" ? <ChatInsight /> : list.loading && !list.data ? <Loading /> : !list.data?.length ? (
        <Empty>Chưa có sản phẩm nào trong DNA. Thêm sản phẩm ở <Link to="/dna" className="font-medium text-blue-600 underline dark:text-blue-400">Mục tiêu & DNA</Link> (mục Sản phẩm) trước.</Empty>
      ) : (
        <div className="grid items-start gap-6 wide:grid-cols-[240px_minmax(0,1fr)]">
          <Card title="Sản phẩm" className="wide:sticky wide:top-4">
            <div className="space-y-1.5">
              {list.data.map((p) => (
                <button key={p.key} onClick={() => setKey(p.key)} className={cx("w-full rounded-xl border p-2.5 text-left text-sm transition", key === p.key ? "border-violet-500/60 bg-violet-500/5" : "border-line hover:bg-soft")}>
                  <div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate font-medium text-ink">{p.name}</span><Badge tone={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0]}</Badge></div>
                  <p className="mt-0.5 text-[11px] text-muted">{OBJECTIVE[p.objective as Flow["objective"]]}</p>
                </button>
              ))}
            </div>
          </Card>
          {key && <FlowEditor key={key} productKey={key} onChanged={list.reload} />}
        </div>
      )}
    </div>
  );
}

function FlowEditor({ productKey, onChanged }: { productKey: string; onChanged: () => void }) {
  const d = useApi<any>(`sales-flows/${productKey}`);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const toast = useToast();
  useEffect(() => { if (d.data?.flow) { setFlow(d.data.flow); setDirty(false); } }, [d.data]);
  if (!d.data || !flow) return <Card><Loading /></Card>;
  const labels: Record<string, string> = d.data.stageLabels ?? {};
  const edit = (f: (x: Flow) => Flow) => { setFlow((x) => (x ? f(structuredClone(x)) : x)); setDirty(true); };
  const run = async (k: string, fn: () => Promise<any>, ok: string) => {
    setBusy(k);
    try { const r = await fn(); if (r?.flow) { setFlow(r.flow); setDirty(false); } toast(ok); d.reload(); onChanged(); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const status = d.data.status as string;
  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <Card title={<span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-violet-600" />{d.data.product.name}</span>}
          action={<Badge tone={STATUS[status]?.[1]}>{STATUS[status]?.[0]}{d.data.updatedAt ? ` · ${timeAgo(d.data.updatedAt)}` : ""}</Badge>}>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[240px_1fr]">
              <Field label="Mục tiêu cuối">
                <select className={inputCls} value={flow.objective} onChange={(e) => edit((x) => ({ ...x, objective: e.target.value as Flow["objective"] }))}>
                  {Object.entries(OBJECTIVE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Ghi chú mục tiêu (bot đọc)"><input className={inputCls} value={flow.objectiveNote} onChange={(e) => edit((x) => ({ ...x, objectiveNote: e.target.value }))} /></Field>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Cách bot dùng kịch bản</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ["auto", Bot, "AI tự động hoàn toàn", "Bot tự trả lời khách theo kịch bản (vẫn qua bộ chặn sự thật, câu cấm; đơn thật chờ duyệt)."],
                  ["suggest", UserRound, "Gợi ý cho nhân viên tự chat", "Bot KHÔNG tự gửi: soạn sẵn câu trả lời + mẫu câu từng bước ở trang Chat để nhân viên tham khảo, sửa rồi gửi. Dùng được cả khi nút \"Bot tự trả lời\" ở trang Chat đang TẮT (không gửi gì cho khách)."],
                ] as const).map(([m, Icon, title, desc]) => {
                  const on = (flow.mode ?? "auto") === m;
                  return (
                    <button key={m} type="button" disabled={busy === "mode"} onClick={() => !on && run("mode", () => api.put(`sales-flows/${productKey}`, { flow: { ...flow, mode: m }, status: status === "none" ? "draft" : status }), m === "suggest" ? "Đã chuyển sang Gợi ý: bot soạn sẵn câu trả lời ở trang Chat, nhân viên bấm gửi" : "Đã chuyển sang Tự động: bot tự trả lời khách theo kịch bản")}
                      className={cx("rounded-xl border p-3 text-left transition", on ? "border-violet-500/60 bg-violet-500/5 ring-1 ring-violet-500/30" : "border-line hover:bg-soft")}>
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-violet-600" />{title}{on && <Check className="ml-auto h-4 w-4 text-violet-600" />}</p>
                      <p className="mt-1 text-xs text-muted">{desc}</p>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted">Cả 2 chế độ đều ghi lại hội thoại cho Vòng lặp Thấu hiểu khách: câu nhân viên dùng / sửa gợi ý, chỗ khách rơi, băn khoăn mới → đề xuất tối ưu kịch bản ở tab Thấu hiểu khách.</p>
            </div>
            {status === "none" && <p className="rounded-xl bg-soft p-3 text-xs text-muted">Đây là <b className="text-ink">mẫu chuẩn</b> dựng từ thông tin sản phẩm (chưa lưu). Bấm <b className="text-ink">AI soạn từ sản phẩm & DNA</b> để có bản sát giọng thương hiệu hơn, hoặc sửa trực tiếp rồi Lưu / Bật.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <input className={cx(inputCls, "min-w-0 flex-1")} placeholder="Dặn AI thêm (tuỳ chọn): vd ưu tiên xin Zalo, khách hay hỏi ship tỉnh…" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button icon={Wand2} loading={busy === "gen"} onClick={() => run("gen", () => api.post(`sales-flows/${productKey}/generate`, { note: note || undefined, objective: flow.objective }), "AI đã soạn kịch bản (bản nháp) — xem, sửa rồi Bật")}>AI soạn từ sản phẩm & DNA</Button>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button icon={Save} loading={busy === "save"} onClick={() => run("save", () => api.put(`sales-flows/${productKey}`, { flow, status: status === "active" ? "active" : "draft" }), status === "active" ? "Đã lưu — bot dùng bản mới ngay" : "Đã lưu nháp")}>{status === "active" ? "Lưu (đang bật)" : "Lưu nháp"}</Button>
              {status !== "active"
                ? <Button variant="success" icon={Play} loading={busy === "on"} onClick={() => run("on", () => api.put(`sales-flows/${productKey}`, { flow, status: "active" }), "Đã bật — bot Messenger & Zalo đi theo kịch bản này")}>Bật cho Messenger & Zalo</Button>
                : <Button icon={Pause} loading={busy === "off"} onClick={() => run("off", () => api.post(`sales-flows/${productKey}/status`, { status: "paused" }), "Đã tạm tắt — bot trả lời như bình thường")}>Tạm tắt</Button>}
              {dirty && <Button variant="ghost" icon={RotateCcw} onClick={() => { setFlow(d.data.flow); setDirty(false); }}>Bỏ thay đổi</Button>}
              {dirty && <span className="self-center text-xs text-amber-600">Có thay đổi chưa lưu</span>}
            </div>
          </div>
        </Card>

        {flow.stages.map((s, i) => (
          <Card key={s.key} title={<span className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-violet-600 text-xs font-bold text-white">{i + 1}</span>{labels[s.key] ?? s.key}</span>}>
            <div className="space-y-3">
              <Field label="Mục tiêu bước này"><input className={inputCls} value={s.goal} onChange={(e) => edit((x) => { x.stages[i].goal = e.target.value; return x; })} /></Field>
              <Field label="Mẫu câu (mỗi dòng 1 mẫu, bot diễn đạt tự nhiên theo tin khách)">
                <textarea rows={Math.max(2, s.sayLike.length + 1)} className={inputCls} value={s.sayLike.join("\n")} onChange={(e) => edit((x) => { x.stages[i].sayLike = e.target.value.split("\n").slice(0, 4); return x; })} />
              </Field>
              <Field label="Sang bước tiếp khi"><input className={inputCls} value={s.nextWhen} onChange={(e) => edit((x) => { x.stages[i].nextWhen = e.target.value; return x; })} /></Field>
            </div>
          </Card>
        ))}

        <Card title="Băn khoăn thường gặp & cách trả lời" action={flow.objections.length < 8 && <Button size="sm" icon={Plus} onClick={() => edit((x) => ({ ...x, objections: [...x.objections, { q: "", a: "" }] }))}>Thêm</Button>}>
          <div className="space-y-3">
            {!flow.objections.length && <Empty>Chưa có.</Empty>}
            {flow.objections.map((o, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[220px_1fr_auto]">
                <input className={inputCls} placeholder="Khách nói…" value={o.q} onChange={(e) => edit((x) => { x.objections[i].q = e.target.value; return x; })} />
                <textarea rows={2} className={inputCls} placeholder="Em trả lời…" value={o.a} onChange={(e) => edit((x) => { x.objections[i].a = e.target.value; return x; })} />
                <Button variant="ghost" icon={Trash2} aria-label="Xoá" onClick={() => edit((x) => ({ ...x, objections: x.objections.filter((_, k) => k !== i) }))} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Tin nhắc lại khi khách im" action={flow.followUps.length < 3 && <Button size="sm" icon={Plus} onClick={() => edit((x) => ({ ...x, followUps: [...x.followUps, { afterHours: 22, text: "" }] }))}>Thêm</Button>}>
          <p className="mb-3 text-xs text-muted">Messenger chỉ cho nhắn trong 24 giờ kể từ tin cuối của khách — hệ tự dừng khi quá hạn. Zalo: tin nhắc do AI soạn bám theo mẫu này và chờ Sếp duyệt (tuỳ cài đặt).</p>
          <div className="space-y-3">
            {flow.followUps.map((f, i) => (
              <div key={i} className="grid items-start gap-2 rounded-xl border border-line p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">Lần {i + 1} · sau<input type="number" min={1} max={168} className={cx(inputCls, "h-9 w-16 px-2")} value={f.afterHours} onChange={(e) => edit((x) => { x.followUps[i].afterHours = Math.max(1, Math.min(168, Number(e.target.value) || 1)); return x; })} />giờ</label>
                <textarea rows={2} className={inputCls} value={f.text} onChange={(e) => edit((x) => { x.followUps[i].text = e.target.value; return x; })} />
                <Button variant="ghost" icon={Trash2} aria-label="Xoá" onClick={() => edit((x) => ({ ...x, followUps: x.followUps.filter((_, k) => k !== i) }))} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <TryChat productKey={productKey} flow={flow} />
    </div>
  );
}

/** Sếp đóng vai khách để thử kịch bản (dùng bản đang sửa, kể cả chưa lưu) — không gửi tin cho ai. */
function TryChat({ productKey, flow }: { productKey: string; flow: Flow }) {
  const [msgs, setMsgs] = useState<{ from: "customer" | "bot"; text: string; label?: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    const next = [...msgs, { from: "customer" as const, text: t }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const r = await api.post(`sales-flows/${productKey}/try`, { flow, messages: next.map(({ from, text }) => ({ from, text })) });
      setMsgs([...next, { from: "bot", text: r.reply, label: `Bước ${r.step} · ${r.label}` }]);
    } catch (e: any) { toast(e.message, "err"); setMsgs(msgs); setText(t); } finally { setBusy(false); }
  };
  return (
    <div className="2xl:sticky 2xl:top-0 2xl:self-start">
      <Card title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-violet-600" />Chat thử (đóng vai khách)</span>} action={msgs.length > 0 && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setMsgs([])}>Làm lại</Button>}>
        <p className="mb-3 text-xs text-muted">Thử bản đang sửa (kể cả chưa lưu). <b className="text-ink">Không gửi tin cho khách nào.</b></p>
        <div className="max-h-[480px] min-h-[200px] space-y-2 overflow-y-auto rounded-xl bg-soft p-3 scroll-thin">
          {!msgs.length && <p className="pt-10 text-center text-xs text-muted">Gõ thử như khách, vd "shop ơi sản phẩm này giá bao nhiêu?"</p>}
          {msgs.map((m, i) => m.from === "customer"
            ? <div key={i} className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-violet-600 px-3 py-2 text-sm text-white">{m.text}</div></div>
            : <div key={i} className="mr-6"><p className="mb-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">{m.label}</p><div className="whitespace-pre-wrap rounded-2xl rounded-tl-md bg-card px-3 py-2 text-sm text-ink">{m.text}</div></div>)}
          {busy && <p className="flex items-center gap-1.5 text-xs text-muted"><Sparkles className="h-3.5 w-3.5 animate-pulse" />Bot đang soạn theo kịch bản…</p>}
          <div ref={end} />
        </div>
        <div className="mt-3 flex gap-2">
          <input className={cx(inputCls, "min-w-0 flex-1")} placeholder="Tin nhắn của khách…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
          <Button variant="primary" icon={Send} loading={busy} onClick={send}>Gửi</Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------- Vòng lặp Thấu hiểu khách: 7 bước ----------------
const STEP_META = [
  { k: "collect", icon: Inbox, title: "1. Lắng nghe", sub: "Chat · Facebook · Đơn hàng" },
  { k: "clean", icon: Filter, title: "2. Sàng lọc", sub: "Bỏ rác · Gộp trùng · Che SĐT" },
  { k: "mapping", icon: Link2, title: "3. Nối dữ liệu", sub: "SĐT · Mã khách · Nguồn nội dung (bài viết / video)" },
  { k: "persona", icon: Users, title: "4. Phân nhóm", sub: "Chân dung hành vi" },
  { k: "insight", icon: Lightbulb, title: "5. Thấu hiểu", sub: "Số liệu · Hành động" },
  { k: "optimize", icon: SlidersHorizontal, title: "6. Tối ưu", sub: "Đề xuất · Duyệt · Áp dụng" },
  { k: "loop", icon: Repeat, title: "7. Feedback Loop", sub: "Đo lại · Học tiếp" },
] as const;
const delta = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`);
const CHANGE_LABEL: Record<string, string> = { objection: "Băn khoăn mới", stage_line: "Mẫu câu mới", follow_up: "Tin nhắc lại" };
const STAGE_VI: Record<string, string> = { chao: "Chào & bắt nhu cầu", khai_thac: "Khai thác nhu cầu", tu_van: "Tư vấn theo nỗi đau", xu_ly_tu_choi: "Xử lý từ chối", xin_sdt: "Xin số điện thoại", chot: "Chốt đơn", cham_lai: "Chăm lại khi khách im" };

/**
 * Vòng lặp Thấu hiểu khách: Lắng nghe → Sàng lọc → Nối dữ liệu → Phân nhóm → Thấu hiểu (khách cần gì · vì sao chưa chốt · nên làm gì ngay)
 * → Tối ưu (đề xuất sửa kịch bản, học cả câu nhân viên sửa gợi ý; Sếp duyệt mới áp dụng) → Feedback Loop (đo lại so với lần trước, quay về bước 1).
 * Tự chạy hằng tuần, bấm chạy ngay được.
 */
function ChatInsight() {
  const d = useApi<any>("chat-insights/latest", ["chat_insight.", "approval.", "proposal."]);
  const [days, setDays] = useState(30);
  const [includeTest, setIncludeTest] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const runNow = async () => {
    setBusy("run");
    try { const r = await api.post<any>("chat-insights/run", { days, includeTest }); toast(r.pending?.length ? `Xong vòng lặp — có ${r.pending.length} đề xuất sửa kịch bản chờ Sếp duyệt` : "Xong vòng lặp — xem phần Thấu hiểu bên dưới"); d.reload(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusy(id);
    try { await api.post(`approvals/${id}/decide`, { decision }); toast(decision === "approve" ? "Đã áp dụng vào kịch bản — bot dùng bản mới ngay" : "Đã bỏ qua đề xuất"); d.reload(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(null); }
  };
  const ins = d.data?.insight;
  const st = ins?.steps;
  const stepNums: Record<string, [string, string][]> = st ? {
    collect: [["Hội thoại", st.collect.conversations], ["Tin nhắn", st.collect.messages], ["Đơn hàng", st.collect.orders]],
    clean: [["Giữ lại", st.clean.kept], ["Bỏ (thử/rỗng/spam)", st.clean.removed.test + st.clean.removed.empty + st.clean.removed.spam], ["Gộp khách trùng", st.clean.removed.merged]],
    mapping: [["Có SĐT", st.mapping.withPhone], ["Có nguồn nội dung", st.mapping.withContent ?? st.mapping.withSource], ["Theo kịch bản", st.mapping.withFlow]],
    persona: st.persona.segments.slice(0, 3).map((x: any) => [x.label, `${x.count}`]),
    insight: [["Để lại SĐT", `${ins.stats.totals.phoneRate}%`], ["Ra đơn", `${ins.stats.totals.orderRate}%`], ["Việc nên làm", st.insight.actionsNow.length]],
    optimize: [["Đề xuất lần này", d.data.optimize.proposed], ["Chờ Sếp duyệt", d.data.optimize.pending], ["Đã áp dụng", d.data.optimize.appliedTotal]],
    loop: [["Số lần đã học", d.data.loop.runs], ["SĐT so lần trước", delta(d.data.loop.phoneRateDelta)], ["Đơn so lần trước", delta(d.data.loop.orderRateDelta)]],
  } : {};
  return (
    <div className="space-y-4">
      <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600" />Vòng lặp Thấu hiểu khách</span>}
        action={ins && <span className="text-xs text-muted">Lần chạy: {timeAgo(ins.createdAt)} · {ins.model === "sandbox" ? "tự tính (chưa dùng AI)" : "AI phân tích"}</span>}>
        <p className="text-sm text-muted">Mỗi tuần hệ tự đọc lại toàn bộ hội thoại Messenger & Zalo, ghép với đơn hàng và nguồn bài/quảng cáo, chia nhóm khách theo hành vi rồi rút ra: <b className="text-ink">khách cần gì, vì sao chưa chốt, nên làm gì ngay</b>. Bước <b className="text-ink">Tối ưu</b> đề xuất sửa kịch bản (học cả câu nhân viên sửa/viết lại để nói tự nhiên hơn), chờ Sếp duyệt; bước <b className="text-ink">Feedback Loop</b> đo lại kết quả sau khi áp dụng rồi quay về bước 1 ở lần chạy tới. Dữ liệu cá nhân (SĐT, tên, email) được che trước khi gửi AI.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="w-44"><select className={cx(inputCls, "h-9")} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90].map((n) => <option key={n} value={n}>{n} ngày gần nhất</option>)}</select></div>
          <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />Tính cả hội thoại mô phỏng / thử</label>
          <Button variant="primary" icon={RefreshCw} loading={busy === "run"} onClick={runNow}>Chạy vòng lặp ngay</Button>
        </div>
      </Card>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {STEP_META.map((m, i) => (
          <div key={m.k} className={cx("relative rounded-2xl border bg-card p-3", m.k === "optimize" || m.k === "loop" ? "border-violet-500/40" : "border-line")}>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink"><m.icon className="h-4 w-4 text-violet-600" />{m.title}</p>
            <p className="text-[11px] text-muted">{m.sub}</p>
            <div className="mt-2 space-y-0.5 text-xs">
              {st ? (stepNums[m.k] ?? []).map(([l, v]) => <p key={l} className="flex justify-between gap-2"><span className="truncate text-muted">{l}</span><b className="text-ink">{v}</b></p>) : <p className="text-muted">Chưa chạy</p>}
            </div>
            {i < STEP_META.length - 1 && <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rounded-full bg-card text-violet-500 2xl:block" />}
            {m.k === "loop" && st && <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-violet-600 dark:text-violet-300">↺ Quay về bước 1{d.data.loop.nextRunAt ? ` · lần tới ${timeAgo(d.data.loop.nextRunAt)}` : ""}</p>}
          </div>
        ))}
      </div>

      {d.loading && !d.data ? <Loading /> : !ins ? <Empty>Chưa có bản insight nào. Bấm <b>Chạy vòng lặp ngay</b> (cần có hội thoại khách thật, hoặc tick "Tính cả hội thoại mô phỏng" để thử).</Empty> : (
        <>
          <Card title="5. Thấu hiểu: hành động">
            <p className="mb-3 text-sm">{st.insight.summary}</p>
            <div className="grid gap-3 md:grid-cols-3">
              {([["Khách cần gì", st.insight.needs, "blue"], ["Vì sao chưa chốt", st.insight.whyNotClose, "amber"], ["Nên làm gì ngay", st.insight.actionsNow, "green"]] as const).map(([t, items, tone]) => (
                <div key={t} className="rounded-xl border border-line p-3">
                  <Badge tone={tone}>{t}</Badge>
                  {items.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">{items.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul> : <p className="mt-2 text-xs text-muted">Chưa đủ dữ liệu.</p>}
                </div>
              ))}
            </div>
          </Card>

          <Card title={`6. Tối ưu: đề xuất sửa kịch bản chờ duyệt (${d.data.pending.length})`}>
            {!d.data.pending.length ? <Empty>Không có đề xuất mới. Kịch bản đang ổn hoặc chưa đủ hội thoại để học.</Empty> : (
              <div className="space-y-3">
                {d.data.pending.map((p: any) => (
                  <div key={p.approval_id} className="rounded-xl border border-line p-3">
                    <p className="font-medium text-ink">{p.title}</p>
                    <div className="mt-2 space-y-1.5">
                      {(p.diff?.changes ?? []).map((c: any, i: number) => (
                        <div key={i} className="rounded-lg bg-soft p-2 text-sm">
                          <p className="text-xs"><Badge tone="violet">{CHANGE_LABEL[c.type] ?? c.type}</Badge>{c.stage ? <span className="ml-1 text-muted">Bước: {STAGE_VI[c.stage] ?? c.stage}</span> : null}{c.type === "follow_up" ? <span className="ml-1 text-muted">sau {c.afterHours ?? 24} giờ</span> : null}</p>
                          {c.type === "objection" ? <p className="mt-1"><b>Khách:</b> {c.q}<br /><b>Trả lời:</b> {c.a}</p> : <p className="mt-1">{c.text}</p>}
                          <p className="mt-1 text-xs text-muted">Vì sao: {c.why}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="success" icon={Check} loading={busy === p.approval_id} onClick={() => decide(p.approval_id, "approve")}>Duyệt & áp dụng</Button>
                      <Button size="sm" variant="ghost" icon={X} disabled={busy === p.approval_id} onClick={() => decide(p.approval_id, "reject")}>Bỏ qua</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="4. Phân nhóm: chân dung hành vi">
              {!st.persona.segments.length ? <Empty>Chưa có.</Empty> : (
                <div className="space-y-2">
                  {st.persona.segments.map((x: any) => (
                    <div key={x.key}>
                      <div className="flex justify-between text-sm"><Link to={x.sampleIds?.[0] ? `/chat?id=${x.sampleIds[0]}` : "/chat"} className="hover:text-blue-600">{x.label}</Link><span className="text-muted">{x.count} · {x.pct}%</span></div>
                      <div className="mt-1 h-2 rounded-full bg-soft"><div className="h-2 rounded-full bg-violet-500" style={{ width: `${Math.max(3, x.pct)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Phễu theo bước kịch bản">
              {!ins.stats.funnelByProduct.length ? <Empty>Chưa có hội thoại đi theo kịch bản (bật kịch bản cho sản phẩm trước).</Empty> : ins.stats.funnelByProduct.map((f: any) => (
                <div key={f.productKey} className="mb-3 last:mb-0">
                  <p className="text-sm font-medium text-ink">{f.productName} <span className="text-xs font-normal text-muted">· {f.conversations} hội thoại · {f.phone} SĐT · {f.orders} đơn</span></p>
                  <div className="mt-1.5 space-y-1">
                    {f.stages.map((s: any) => (
                      <div key={s.key} className="grid grid-cols-[150px_1fr_32px] items-center gap-2 text-xs">
                        <span className="truncate text-muted">{s.label}</span>
                        <div className="h-2 rounded-full bg-soft"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${f.conversations ? Math.max(2, (s.reached / f.conversations) * 100) : 0}%` }} /></div>
                        <b className="text-right">{s.reached}</b>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
            <Card title="Băn khoăn khách hay nói">
              {!ins.stats.topConcerns.length ? <Empty>Chưa thấy.</Empty> : <div className="flex flex-wrap gap-1.5">{ins.stats.topConcerns.map((c: any) => <Badge key={c.word} tone="amber">"{c.word}" · {c.n}</Badge>)}</div>}
            </Card>
            <Card title="Nguồn nội dung kéo khách (bài viết / video) & gợi ý nhân viên">
              <div className="space-y-1.5 text-sm">
                {!(ins.stats.byContent ?? []).length && <p className="text-xs text-muted">Chạy lại vòng lặp để xem theo bài viết / video.</p>}
                {(ins.stats.byContent ?? []).map((x: any, i: number) => (
                  <div key={i} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      {x.kind && <Badge tone={x.kind === "video" ? "violet" : "blue"}>{x.kind === "video" ? "Video" : "Bài viết"}</Badge>}{" "}
                      {x.link ? <a href={x.link} target="_blank" rel="noopener noreferrer" className="break-words text-blue-600 hover:underline dark:text-blue-400">{x.title}</a> : <span className="text-muted">{x.title}</span>}
                    </span>
                    <span className="shrink-0 text-xs">{x.n} khách · {x.phone} SĐT · {x.orders} đơn</span>
                  </div>
                ))}
                <p className="mt-2 border-t border-line pt-2 text-xs text-muted">Gợi ý AI: dùng nguyên <b className="text-ink">{ins.stats.suggestionStats.used}</b> · nhân viên sửa <b className="text-ink">{ins.stats.suggestionStats.edited}</b> · nhân viên tự viết <b className="text-ink">{ins.stats.suggestionStats.staffOnly}</b></p>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
