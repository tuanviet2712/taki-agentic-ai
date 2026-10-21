import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeftRight, ChevronDown, Copy, FastForward, Handshake, History, Loader2, Pause, Play, Plus, Send, Square, StepForward, Swords, Trash2, TriangleAlert,
} from "lucide-react";
import { api, useApi } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, Button, ConfirmDialog, Toggle, cx, inputCls, useToast } from "../components/ui";

/**
 * Phòng tranh luận AI: người dùng đặt 1 câu hỏi bất kỳ, 2 model / agent của hệ thống phản biện qua lại
 * (A trả lời → B phản biện & trả lời → A phản biện lại…) tới khi cùng ký 1 phương án chung.
 * Mọi lượt nói hiện ra ngay khi xong (sự kiện agent_debate.updated); người dùng chen ngang, cho nói từng lượt, tạm dừng.
 * Máy chủ: packages/orchestrator/src/agent-debate.ts.
 */

type Side = "a" | "b";
type Seat = { agentKey: string; model: string; stance: string };
type ProviderInfo = { id: string; label: string; short: string; ready: boolean; reason: string | null; models: { id: string; label: string; note?: string }[] };
type Meta = {
  agents: { key: string; label: string; description: string }[];
  stances: string[];
  providers: ProviderInfo[];
  defaults: { a: Seat; b: Seat; maxTurns: number; consensusThreshold: number };
  hasDna: boolean;
};

const SIDE: Record<Side, { name: string; text: string; chip: string; bubble: string; avatar: string; bar: string; ring: string }> = {
  a: {
    name: "Bên A",
    text: "text-violet-700 dark:text-violet-300",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    bubble: "border-violet-500/25 bg-violet-500/[0.05]",
    avatar: "from-violet-500 to-fuchsia-500",
    bar: "bg-violet-500",
    ring: "border-violet-500/35",
  },
  b: {
    name: "Bên B",
    text: "text-amber-700 dark:text-amber-300",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    bubble: "border-amber-500/30 bg-amber-500/[0.05]",
    avatar: "from-amber-500 to-orange-500",
    bar: "bg-amber-500",
    ring: "border-amber-500/40",
  },
};

const STATUS: Record<string, { label: string; tone: "blue" | "amber" | "green" | "red" | "gray" | "violet" }> = {
  running: { label: "Đang tranh luận", tone: "blue" },
  waiting: { label: "Chờ bạn", tone: "amber" },
  consensus: { label: "Đã đồng thuận", tone: "green" },
  max_turns: { label: "Chưa thống nhất", tone: "violet" },
  stopped: { label: "Đã dừng", tone: "gray" },
  failed: { label: "Lỗi", tone: "red" },
  interrupted: { label: "Bị gián đoạn", tone: "gray" },
};

const QUICK_QUESTIONS = [
  "Tôi có 500 triệu: nên trả bớt khoản vay lãi 12%/năm hay dồn vào mở rộng kho hàng?",
  "Có nên thay đội telesale 5 người bằng chatbot AI trả lời 24/7 không?",
  "Mở chi nhánh thứ 2 hay dồn ngân sách chạy kênh online trong 6 tháng tới?",
  "Nên tuyển 1 marketer giỏi lương cao hay 3 bạn mới ra trường kèm công cụ AI?",
  "0,999… (lặp vô hạn) có bằng 1 không? Hãy chứng minh.",
];

const SETUP_KEY = "debate.setup";
const loadSetup = (): Partial<{ a: Seat; b: Seat; maxTurns: number; threshold: number; pace: "auto" | "step"; useDna: boolean }> => {
  try {
    return JSON.parse(localStorage.getItem(SETUP_KEY) ?? "{}");
  } catch {
    return {};
  }
};
const saveSetup = (v: unknown) => {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

const isTurn = (m: any) => m.role === "debater_a" || m.role === "debater_b";
const sideOf = (m: any): Side => (m.role === "debater_b" ? "b" : "a");

export function Debate() {
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  const [showList, setShowList] = useState(false);
  const meta = useApi<Meta>("agent-debates/meta", ["llm."]);
  const list = useApi<any[]>("agent-debates", ["agent_debate."]);
  const current = useApi<any>(id ? `agent-debates/${id}` : null, ["agent_debate."]);
  const debate = current.data?.id === id ? current.data : null;

  const open = (next: string | null) => {
    setParams(next ? { id: next } : {});
    setShowList(false);
  };

  // Cuộc tranh luận đã bị xóa → về màn hình tạo mới. Hỏi lại đúng id hiện tại trước khi chuyển: lỗi của useApi có thể là
  // của id trước đó (chưa kịp xóa khi vừa đổi id).
  useEffect(() => {
    if (!id || !current.error) return;
    let alive = true;
    api.get(`agent-debates/${id}`).then(
      () => alive && void current.reload(),
      (e) => alive && e?.code === "NOT_FOUND" && setParams({}),
    );
    return () => {
      alive = false;
    };
  }, [id, current.error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dự phòng khi mất kết nối sự kiện: hỏi lại nhẹ nhàng trong lúc 2 bên đang nói.
  const live = Boolean(debate?.running || debate?.status === "running");
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => void current.reload(), 4000);
    return () => window.clearInterval(t);
  }, [live, current.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink sm:text-[22px]">
            <Swords className="h-6 w-6 text-violet-600" aria-hidden /> Phòng tranh luận AI
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
            Đặt 1 câu hỏi bất kỳ, 2 model hoặc 2 agent phản biện qua lại tới khi cùng thống nhất. Bạn đọc từng lời, chen ngang hoặc cho nói từng lượt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="lg:hidden" icon={History} onClick={() => setShowList((v) => !v)}>
            Lịch sử
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => open(null)} data-testid="debate-new">
            Cuộc mới
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className={cx("min-w-0 lg:block", showList ? "block" : "hidden")}>
          <HistoryList items={list.data ?? []} currentId={id} onSelect={open} onDeleted={(gone) => { list.reload(); if (gone === id) open(null); }} />
        </aside>
        <section className="min-w-0">
          {meta.error && !meta.data ? (
            <div className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger-ink">Không tải được Phòng tranh luận: {meta.error}</div>
          ) : !meta.data ? (
            <div className="grid h-60 place-items-center rounded-2xl border border-line bg-card text-sm text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : id ? (
            debate ? (
              <DebateRoom debate={debate} reload={current.reload} />
            ) : (
              <div className="grid h-60 place-items-center rounded-2xl border border-line bg-card text-sm text-muted">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )
          ) : (
            <NewDebateForm meta={meta.data} onCreated={(newId) => { list.reload(); open(newId); }} />
          )}
        </section>
      </div>
    </div>
  );
}

// ==================== Lịch sử ====================

function HistoryList({ items, currentId, onSelect, onDeleted }: { items: any[]; currentId: string | null; onSelect: (id: string) => void; onDeleted: (id: string) => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await api.del(`agent-debates/${confirm.id}`);
      onDeleted(confirm.id);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  return (
    <div className="rounded-2xl border border-line bg-card p-2">
      <p className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Các cuộc tranh luận</p>
      {!items.length ? (
        <p className="px-2 py-6 text-center text-xs text-muted">Chưa có cuộc nào. Đặt câu hỏi đầu tiên ở bên phải.</p>
      ) : (
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto scroll-thin lg:max-h-[calc(100dvh-14rem)]">
          {items.map((d) => {
            const st = STATUS[d.status] ?? STATUS.stopped;
            return (
              <li key={d.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(d.id)}
                  onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && onSelect(d.id)}
                  className={cx(
                    "group flex cursor-pointer items-start gap-2 rounded-xl px-2.5 py-2 text-left transition",
                    currentId === d.id ? "bg-violet-500/10" : "hover:bg-soft",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{d.title}</p>
                    <p className="mt-1 truncate text-[11px] text-muted">
                      {d.config?.a?.label ?? "A"} ⚔ {d.config?.b?.label ?? "B"}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                      <Badge tone={st.tone} dot className="!px-2 !py-0 !text-[10.5px]">
                        {d.running && <Loader2 className="mr-1 inline h-3 w-3 animate-spin align-[-2px]" />}
                        {st.label}
                      </Badge>
                      <span>{timeAgo(d.updated_at)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Xóa cuộc tranh luận"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirm(d);
                    }}
                    className="rounded-lg p-1.5 text-muted opacity-60 transition hover:bg-danger-soft hover:text-danger-ink group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog open={Boolean(confirm)} title="Xóa cuộc tranh luận?" tone="danger" confirmLabel="Xóa" loading={busy} onConfirm={() => void remove()} onCancel={() => setConfirm(null)}>
        Toàn bộ lời thoại của “{confirm?.title}” sẽ bị xóa vĩnh viễn.
      </ConfirmDialog>
    </div>
  );
}

// ==================== Thiết lập cuộc mới ====================

function NewDebateForm({ meta, onCreated }: { meta: Meta; onCreated: (id: string) => void }) {
  const toast = useToast();
  const saved = useMemo(loadSetup, []);
  const [question, setQuestion] = useState("");
  const [a, setA] = useState<Seat>({ ...meta.defaults.a, ...saved.a });
  const [b, setB] = useState<Seat>({ ...meta.defaults.b, ...saved.b });
  const [maxTurns, setMaxTurns] = useState(saved.maxTurns ?? meta.defaults.maxTurns);
  const [threshold, setThreshold] = useState(saved.threshold ?? meta.defaults.consensusThreshold);
  const [pace, setPace] = useState<"auto" | "step">(saved.pace ?? "auto");
  const [useDna, setUseDna] = useState(saved.useDna ?? true);
  const [simulate, setSimulate] = useState(false);
  const [busy, setBusy] = useState(false);

  const providerOf = useCallback((model: string) => meta.providers.find((p) => p.models.some((m) => m.id === model)), [meta.providers]);
  const blocked = [a, b].map((s) => providerOf(s.model)).filter((p) => p && !p.ready) as ProviderInfo[];
  const canStart = question.trim().length >= 3 && (simulate || blocked.length === 0) && !busy;

  const start = async () => {
    if (!canStart) return;
    setBusy(true);
    saveSetup({ a, b, maxTurns, threshold, pace, useDna });
    try {
      const d = await api.post("agent-debates", {
        question: question.trim(),
        a: { agentKey: a.agentKey, model: a.model, stance: a.stance.trim() },
        b: { agentKey: b.agentKey, model: b.model, stance: b.stance.trim() },
        maxTurns,
        consensusThreshold: threshold,
        pace,
        useDna,
        mode: simulate ? "simulate" : "live",
      });
      onCreated(d.id);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div>
        <label htmlFor="debate-q" className="text-sm font-semibold text-ink">
          Câu hỏi / vấn đề bạn muốn 2 bên tranh luận
        </label>
        <textarea
          id="debate-q"
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void start();
          }}
          placeholder="Hỏi bất cứ điều gì: kinh doanh, tài chính, nhân sự, kỹ thuật, kiến thức… 2 bên sẽ phản biện tới khi thống nhất."
          className={cx(inputCls, "mt-1.5 resize-y")}
          data-testid="debate-question"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_QUESTIONS.map((qq) => (
            <button
              key={qq}
              type="button"
              onClick={() => setQuestion(qq)}
              className="rounded-full border border-line bg-soft/60 px-2.5 py-1 text-left text-[12px] text-ink/80 transition hover:border-violet-500/40 hover:bg-violet-500/5"
            >
              {qq}
            </button>
          ))}
        </div>
      </div>

      <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <SeatPicker side="a" seat={a} onChange={setA} meta={meta} />
        <div className="flex items-center justify-center">
          <Button
            variant="ghost"
            icon={ArrowLeftRight}
            aria-label="Đổi chỗ 2 bên"
            title="Đổi chỗ 2 bên"
            onClick={() => {
              setA(b);
              setB(a);
            }}
          />
        </div>
        <SeatPicker side="b" seat={b} onChange={setB} meta={meta} />
      </div>
      <datalist id="debate-stances">
        {meta.stances.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="grid gap-3 rounded-xl bg-soft/50 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-muted">
          Số lượt nói tối đa
          <select value={maxTurns} onChange={(e) => setMaxTurns(Number(e.target.value))} className={cx(inputCls, "mt-1 !min-h-9 !py-1.5")}>
            {[4, 6, 8, 10, 12, 16, 20].map((n) => (
              <option key={n} value={n}>
                {n} lượt ({n / 2} lượt mỗi bên)
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Ngưỡng đồng thuận
          <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className={cx(inputCls, "mt-1 !min-h-9 !py-1.5")}>
            {[70, 75, 80, 85, 90, 95].map((n) => (
              <option key={n} value={n}>
                ≥ {n}/100 {n >= 90 ? "(rất khắt khe)" : n <= 70 ? "(dễ chốt)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="text-xs text-muted">
          Nhịp tranh luận
          <div className="mt-1 grid grid-cols-2 gap-1 rounded-xl bg-card p-1">
            {(
              [
                ["auto", "Tự chạy"],
                ["step", "Từng lượt"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setPace(v)}
                aria-pressed={pace === v}
                className={cx("rounded-lg px-2 py-1.5 text-xs font-medium transition", pace === v ? "bg-violet-600 text-white" : "text-muted hover:text-ink")}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2 text-xs text-muted">
          <label className="flex items-center justify-between gap-2">
            <span title={meta.hasDna ? "" : "Chưa có DNA doanh nghiệp"}>Dùng bối cảnh doanh nghiệp (DNA)</span>
            <Toggle size="sm" checked={useDna && meta.hasDna} disabled={!meta.hasDna} onChange={setUseDna} label="Dùng bối cảnh doanh nghiệp" />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>Chạy thử mô phỏng (không gọi AI)</span>
            <Toggle size="sm" checked={simulate} onChange={setSimulate} label="Chạy thử mô phỏng" />
          </label>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        <b className="font-medium text-ink">Cách chốt:</b> Bên A mở lời, Bên B bắt buộc phản biện rồi đưa phương án của mình, sau đó luân phiên. Cuộc tranh luận kết thúc khi 2 lượt liên tiếp của 2 bên cùng
        “đồng ý chốt” và cùng chấm mức đồng thuận ≥ ngưỡng — hoặc khi hết lượt. {pace === "step" ? "Nhịp “Từng lượt”: sau mỗi lời nói, hệ thống chờ bạn bấm cho bên kia nói tiếp." : "Nhịp “Tự chạy”: 2 bên nói liên tục, bạn xem trực tiếp và có thể tạm dừng bất cứ lúc nào."}
      </p>

      {!simulate && blocked.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn-ink">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {blocked.map((p) => `${p.short}: ${p.reason ?? "chưa sẵn sàng"}`).join(" · ")}. Chọn model đã sẵn sàng, kết nối ở Cài đặt → Kết nối AI, hoặc bật “Chạy thử mô phỏng”.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-muted">Ctrl + Enter để bắt đầu</span>
        <Button variant="primary" size="lg" icon={Swords} loading={busy} disabled={!canStart} onClick={() => void start()} data-testid="debate-start">
          Bắt đầu tranh luận
        </Button>
      </div>
    </div>
  );
}

function SeatPicker({ side, seat, onChange, meta }: { side: Side; seat: Seat; onChange: (s: Seat) => void; meta: Meta }) {
  const s = SIDE[side];
  const agent = meta.agents.find((x) => x.key === seat.agentKey) ?? meta.agents[0];
  const provider = meta.providers.find((p) => p.models.some((m) => m.id === seat.model));
  return (
    <div className={cx("space-y-2.5 rounded-2xl border bg-card p-3.5", s.ring)}>
      <div className="flex items-center gap-2">
        <SeatAvatar side={side} size={28} />
        <span className={cx("text-sm font-semibold", s.text)}>{s.name}</span>
        <span className="text-[11px] text-muted">{side === "a" ? "· mở lời" : "· phản biện trước"}</span>
      </div>
      <label className="block text-xs text-muted">
        Ai ngồi ghế này
        <select value={seat.agentKey} onChange={(e) => onChange({ ...seat, agentKey: e.target.value })} className={cx(inputCls, "mt-1 !min-h-9 !py-1.5")}>
          {meta.agents.map((x) => (
            <option key={x.key} value={x.key}>
              {x.key === "free" ? "🧠 Model tự do (không vai trò)" : `🤖 ${x.label}`}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] leading-snug">{agent?.description}</span>
      </label>
      <label className="block text-xs text-muted">
        Model AI
        <select value={seat.model} onChange={(e) => onChange({ ...seat, model: e.target.value })} className={cx(inputCls, "mt-1 !min-h-9 !py-1.5")}>
          {meta.providers.map((p) => (
            <optgroup key={p.id} label={`${p.short}${p.ready ? "" : " · chưa sẵn sàng"}`}>
              {p.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {provider && !provider.ready && <span className="mt-1 block text-[11px] text-warn-ink">⚠ {provider.reason ?? "Chưa sẵn sàng"}</span>}
      </label>
      <label className="block text-xs text-muted">
        Góc nhìn / lập trường <span className="opacity-70">(tuỳ chọn)</span>
        <input
          list="debate-stances"
          value={seat.stance}
          maxLength={300}
          onChange={(e) => onChange({ ...seat, stance: e.target.value })}
          placeholder="VD: CFO thận trọng — ưu tiên dòng tiền"
          className={cx(inputCls, "mt-1 !min-h-9 !py-1.5")}
        />
      </label>
    </div>
  );
}

function SeatAvatar({ side, size = 32 }: { side: Side; size?: number }) {
  return (
    <span
      className={cx("grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-bold text-white shadow-sm", SIDE[side].avatar)}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {side.toUpperCase()}
    </span>
  );
}

// ==================== Phòng tranh luận ====================

function DebateRoom({ debate, reload }: { debate: any; reload: () => void }) {
  const toast = useToast();
  const cfg = debate.config ?? {};
  const msgs: any[] = debate.messages ?? [];
  const res = debate.result ?? {};
  const st = STATUS[debate.status] ?? STATUS.stopped;
  const running = Boolean(debate.running);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [to, setTo] = useState<"both" | Side>("both");

  // Lượt vừa nói xong trong lúc đang xem → hiện dần như đang gõ (lượt cũ trong lịch sử hiện ngay).
  // Quyết định ngay trong lúc render vì bong bóng chỉ chọn "gõ hay không" một lần khi mới hiện.
  const seen = useRef<{ id: string; ids: Set<string> } | null>(null);
  if (!seen.current || seen.current.id !== debate.id) {
    seen.current = { id: debate.id, ids: new Set(msgs.filter((m) => isTurn(m) && m.status === "done").map((m) => m.id)) };
  }
  const seenIds = seen.current.ids;
  useEffect(() => {
    for (const m of msgs) if (isTurn(m) && m.status === "done") seenIds.add(m.id);
  }, [msgs, seenIds]);

  // Tự cuộn xuống khi có lời mới — trừ khi người dùng đang kéo lên đọc lại.
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const scrollDown = useCallback(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(() => {
    stick.current = true;
    requestAnimationFrame(scrollDown);
  }, [debate.id, scrollDown]);
  const lastKey = `${msgs.length}:${msgs.at(-1)?.status ?? ""}`;
  useEffect(() => {
    requestAnimationFrame(scrollDown);
  }, [lastKey, scrollDown]);

  const anyThinking = msgs.some((m) => m.status === "streaming");
  const now = useNow(anyThinking);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      reload();
      if (ok) toast(ok, "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  };
  const say = () => {
    const v = text.trim();
    if (!v || busy) return;
    void act("say", async () => {
      await api.post(`agent-debates/${debate.id}/say`, { text: v, to });
      setText("");
    });
  };
  const advance = (steps: "one" | "auto", extra?: Record<string, unknown>) =>
    act(`advance-${steps}`, () => api.post(`agent-debates/${debate.id}/advance`, { steps, ...extra }));

  const nextLabel = debate.nextSide ? cfg[debate.nextSide]?.label ?? SIDE[debate.nextSide as Side].name : "";
  const agreeA = res.agreement?.a;
  const agreeB = res.agreement?.b;

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[480px] flex-col sm:h-[calc(100dvh-15.5rem)] sm:min-h-[520px] overflow-hidden rounded-2xl border border-line bg-card" data-testid="debate-room">
      {/* Đầu phòng: câu hỏi, 2 ghế, trạng thái, mức đồng thuận */}
      <div className="space-y-2.5 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={st.tone} dot>
            {running && <Loader2 className="mr-1 inline h-3 w-3 animate-spin align-[-2px]" />}
            {st.label}
          </Badge>
          <span className="text-xs text-muted">
            Lượt {debate.turnsDone ?? 0}/{debate.max_rounds} · chốt khi ≥ {debate.pass_threshold}/100
          </span>
          {cfg.pace === "step" && <Badge tone="gray">Từng lượt</Badge>}
          {cfg.mode === "simulate" && (
            <Badge tone="amber" title={cfg.simulatedReason || ""}>
              Mô phỏng
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <SeatChip side="a" seat={cfg.a} agreement={agreeA} />
          <Swords className="mx-auto hidden h-4 w-4 text-muted sm:block" aria-hidden />
          <SeatChip side="b" seat={cfg.b} agreement={agreeB} align="right" />
        </div>
      </div>

      {cfg.mode === "simulate" && (
        <div className="border-b border-warn/25 bg-warn-soft px-4 py-1.5 text-[11.5px] text-warn-ink">
          Đang chạy MÔ PHỎNG: lời thoại là mẫu dựng sẵn để xem thử luồng, không phải AI thật{cfg.simulatedReason ? ` (${cfg.simulatedReason})` : ""}.
        </div>
      )}

      {/* Lời thoại */}
      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        }}
        className="flex-1 space-y-4 overflow-y-auto scroll-thin bg-soft/30 px-3 py-4 sm:px-5"
        aria-live="polite"
      >
        {msgs.map((m, i) => {
          if (m.role === "user") return <UserNote key={m.id} msg={m} cfg={cfg} />;
          if (m.role === "verdict") return <VerdictCard key={m.id} msg={m} cfg={cfg} before={msgs.slice(0, i)} />;
          if (!isTurn(m)) return null;
          if (m.status === "streaming") return <ThinkingBubble key={m.id} msg={m} cfg={cfg} now={now} />;
          return <TurnBubble key={m.id} msg={m} cfg={cfg} animate={!seenIds.has(m.id)} onGrow={scrollDown} />;
        })}
        {debate.status === "failed" && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger-ink">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">Lượt nói bị lỗi: {res.error ?? "không rõ"}. Bấm “Thử lại” để cho bên đó nói lại.</span>
          </div>
        )}
        {debate.status === "interrupted" && (
          <p className="text-center text-xs text-muted">Cuộc tranh luận bị gián đoạn (máy chủ khởi động lại). Bấm “Tiếp tục” để 2 bên nói tiếp.</p>
        )}
      </div>

      {/* Điều khiển + chen ngang */}
      <div className="space-y-2 border-t border-line bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <>
              <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600" />
                {debate.pendingSteps === 1 ? "Sẽ dừng chờ bạn sau lượt này" : "2 bên đang tranh luận trực tiếp"}
              </span>
              {debate.pendingSteps !== 1 && (
                <Button size="sm" icon={Pause} loading={busy === "pause"} onClick={() => void act("pause", () => api.post(`agent-debates/${debate.id}/pause`))}>
                  Tạm dừng sau lượt này
                </Button>
              )}
              <Button size="sm" variant="dangerSoft" icon={Square} loading={busy === "stop"} onClick={() => void act("stop", () => api.post(`agent-debates/${debate.id}/stop`))}>
                Dừng hẳn
              </Button>
            </>
          ) : debate.status === "waiting" ? (
            <>
              <span className="mr-auto text-xs text-muted">Đang chờ bạn: cho nói tiếp hoặc chen ngang bên dưới.</span>
              <Button size="sm" variant="primary" icon={StepForward} loading={busy === "advance-one"} onClick={() => void advance("one")} data-testid="debate-next">
                Cho {nextLabel} nói tiếp
              </Button>
              <Button size="sm" icon={FastForward} loading={busy === "advance-auto"} onClick={() => void advance("auto", { pace: "auto" })}>
                Tự chạy tới khi chốt
              </Button>
            </>
          ) : debate.status === "consensus" ? (
            <>
              <span className="mr-auto text-xs text-muted">Đã chốt. Hỏi tiếp bên dưới, hoặc yêu cầu 2 bên soi lại kết luận.</span>
              <Button size="sm" icon={Swords} loading={busy === "advance-auto"} onClick={() => void advance("auto", { extraTurns: 4 })}>
                Phản biện sâu thêm
              </Button>
            </>
          ) : debate.status === "max_turns" ? (
            <>
              <span className="mr-auto text-xs text-muted">Hết lượt mà chưa thống nhất.</span>
              <Button size="sm" variant="primary" icon={Play} loading={busy === "advance-auto"} onClick={() => void advance("auto", { extraTurns: 4 })}>
                Tranh luận thêm 4 lượt
              </Button>
            </>
          ) : (
            <>
              <span className="mr-auto text-xs text-muted">
                {debate.status === "failed"
                  ? "Lượt gần nhất bị lỗi."
                  : debate.finishingTurn
                    ? "Đã dừng. Lượt đang soạn dở vẫn được ghi lại khi xong."
                    : "Đang tạm dừng."}
              </span>
              <Button size="sm" icon={StepForward} loading={busy === "advance-one"} onClick={() => void advance("one")}>
                Cho {nextLabel} nói 1 lượt
              </Button>
              <Button size="sm" variant="primary" icon={Play} loading={busy === "advance-auto"} onClick={() => void advance("auto")}>
                {debate.status === "failed" ? "Thử lại" : "Tiếp tục"}
              </Button>
            </>
          )}
        </div>
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-soft/50 p-1.5 focus-within:border-violet-500/60 focus-within:bg-card">
          <select
            value={to}
            onChange={(e) => setTo(e.target.value as "both" | Side)}
            aria-label="Gửi cho"
            className="h-9 max-w-[9.5rem] shrink-0 rounded-xl bg-card px-2 text-xs font-medium text-ink outline-none ring-1 ring-line"
          >
            <option value="both">Gửi cả hai</option>
            <option value="a">Chỉ {cfg.a?.label ?? "Bên A"}</option>
            <option value="b">Chỉ {cfg.b?.label ?? "Bên B"}</option>
          </select>
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                say();
              }
            }}
            placeholder={running ? "Chen ngang: góp ý, bổ sung dữ kiện, đặt thêm câu hỏi… (2 bên đọc ở lượt kế)" : "Hỏi tiếp hoặc giao thêm yêu cầu cho 2 bên…"}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1.5 py-2 text-sm text-ink placeholder:text-muted focus:outline-none"
            data-testid="debate-say"
          />
          <Button size="sm" variant="primary" icon={Send} aria-label="Gửi" loading={busy === "say"} disabled={!text.trim()} onClick={say} />
        </div>
      </div>
    </div>
  );
}

function SeatChip({ side, seat, agreement, align }: { side: Side; seat: any; agreement?: number | null; align?: "right" }) {
  const s = SIDE[side];
  return (
    <div className={cx("flex min-w-0 items-center gap-2", align === "right" && "flex-row-reverse text-right")}>
      <SeatAvatar side={side} size={30} />
      <div className="min-w-0 flex-1">
        <p className={cx("truncate text-sm font-semibold", s.text)}>{seat?.label ?? s.name}</p>
        <p className="truncate text-[11px] text-muted">
          <span className="font-mono">{seat?.model}</span>
          {seat?.stance ? ` · ${seat.stance}` : ""}
        </p>
        {typeof agreement === "number" && (
          <div className={cx("mt-1 flex items-center gap-1.5", align === "right" && "flex-row-reverse")}>
            <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-soft sm:w-24">
              <div className={cx("h-full rounded-full transition-all", s.bar)} style={{ width: `${agreement}%` }} />
            </div>
            <span className="whitespace-nowrap text-[10.5px] text-muted">
              <span className="hidden sm:inline">đồng thuận </span>
              <span className="sm:hidden" aria-hidden>🤝 </span>
              {agreement}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function UserNote({ msg, cfg }: { msg: any; cfg: any }) {
  if (msg.meta?.kind === "question") {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Câu hỏi của bạn</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{msg.text}</p>
      </div>
    );
  }
  const to = msg.meta?.to === "a" || msg.meta?.to === "b" ? cfg[msg.meta.to]?.label : "cả hai";
  return (
    <div className="flex justify-center">
      <div className="max-w-[85%] rounded-2xl bg-emerald-600 px-3.5 py-2 text-white shadow-2xs sm:max-w-[70%]">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-white/80">Bạn chen ngang → {to}</p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</p>
      </div>
    </div>
  );
}

function ThinkingBubble({ msg, cfg, now }: { msg: any; cfg: any; now: number }) {
  const side = sideOf(msg);
  const s = SIDE[side];
  const started = msg.meta?.startedAt ? new Date(msg.meta.startedAt).getTime() : now;
  const secs = Math.max(0, Math.round((now - started) / 1000));
  const verb = msg.round === 1 ? "đang soạn câu trả lời mở đầu" : "đang đọc và phản biện";
  return (
    <div className={cx("flex items-end gap-2.5", side === "b" && "flex-row-reverse")}>
      <SeatAvatar side={side} />
      <div className={cx("rounded-2xl border px-3.5 py-2.5", s.bubble, side === "a" ? "rounded-bl-md" : "rounded-br-md")}>
        <p className="flex items-center gap-2 text-xs text-muted">
          <span className="inline-flex gap-1" aria-hidden>
            {[0, 150, 300].map((d) => (
              <span key={d} className={cx("h-1.5 w-1.5 animate-bounce rounded-full", s.bar)} style={{ animationDelay: `${d}ms` }} />
            ))}
          </span>
          <span>
            <b className={cx("font-semibold", s.text)}>{cfg[side]?.label ?? msg.agent_label}</b> {verb}… {secs}s
          </span>
        </p>
      </div>
    </div>
  );
}

function TurnBubble({ msg, cfg, animate, onGrow }: { msg: any; cfg: any; animate: boolean; onGrow: () => void }) {
  const side = sideOf(msg);
  const s = SIDE[side];
  const peer = cfg[side === "a" ? "b" : "a"];
  const r = msg.result ?? {};
  const failed = msg.status === "failed";
  const body = String(r.message ?? msg.text ?? "");
  const shown = useTypewriter(body, animate && !failed, onGrow);
  const typing = shown.length < body.length;
  const [details, setDetails] = useState(false);
  const secs = msg.meta?.durationMs ? Math.round(msg.meta.durationMs / 1000) : null;

  return (
    <div className={cx("flex items-start gap-2.5", side === "b" && "flex-row-reverse")}>
      <SeatAvatar side={side} />
      <div className={cx("flex min-w-0 max-w-[92%] flex-col sm:max-w-[80%]", side === "b" && "items-end")}>
        <div className={cx("mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[11px] text-muted", side === "b" && "justify-end")}>
          <span className={cx("font-semibold", s.text)}>{msg.agent_label}</span>
          <span className={cx("rounded px-1.5 py-0.5 font-mono text-[10px]", s.chip)}>{msg.model}</span>
          <span>· Lượt {msg.round}</span>
          {secs != null && <span>· {secs}s</span>}
          {msg.meta?.simulated && <Badge tone="gray" className="!px-1.5 !py-0 !text-[10px]">mô phỏng</Badge>}
        </div>
        <div className={cx("w-full rounded-2xl border px-3.5 py-2.5 shadow-2xs", failed ? "border-danger/30 bg-danger-soft" : s.bubble, side === "a" ? "rounded-tl-md" : "rounded-tr-md")}>
          {failed ? (
            <p className="break-words text-xs text-danger-ink">⚠ {msg.text}</p>
          ) : typing ? (
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
              {shown}
              <span className={cx("ml-0.5 inline-block h-3.5 w-1.5 animate-pulse align-middle", s.bar)} />
            </p>
          ) : (
            <Md text={body} />
          )}

          {!failed && !typing && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line/70 pt-2 text-[11px] text-muted">
              {msg.round > 1 && typeof r.agreement === "number" && (
                <span className="inline-flex items-center gap-1.5">
                  Đồng thuận với {peer?.label ?? "đối phương"}:
                  <span className="h-1.5 w-14 overflow-hidden rounded-full bg-soft">
                    <span className={cx("block h-full rounded-full", s.bar)} style={{ width: `${r.agreement}%` }} />
                  </span>
                  <b className="text-ink">{r.agreement}</b>
                </span>
              )}
              {r.agree && (
                <Badge tone="green" className="!px-2 !py-0 !text-[10.5px]">
                  <Handshake className="mr-1 inline h-3 w-3 align-[-2px]" />Đồng ý chốt
                </Badge>
              )}
              {(r.rebuttals?.length || r.concessions?.length || r.openIssues?.length || r.position) && (
                <button type="button" onClick={() => setDetails((v) => !v)} className="ml-auto inline-flex items-center gap-0.5 font-medium hover:text-ink" aria-expanded={details}>
                  Chi tiết lập luận <ChevronDown className={cx("h-3 w-3 transition", details && "rotate-180")} />
                </button>
              )}
            </div>
          )}

          {details && !typing && (
            <div className="mt-2 space-y-2.5 text-[12px]">
              <PointList title="⚔ Phản biện" items={r.rebuttals} className="text-rose-700 dark:text-rose-300" />
              <PointList title="✓ Đã tiếp thu từ đối phương" items={r.concessions} className="text-emerald-700 dark:text-emerald-300" />
              <PointList title="⚠ Còn bất đồng" items={r.openIssues} className="text-amber-700 dark:text-amber-300" />
              {r.position && (
                <div>
                  <p className="font-semibold text-ink">📌 Phương án hiện tại của {msg.agent_label}</p>
                  <div className="mt-1 rounded-xl bg-card/80 p-2.5">
                    <Md text={r.position} small />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PointList({ title, items, className }: { title: string; items?: string[]; className?: string }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className={cx("font-semibold", className)}>{title}</p>
      <ul className="mt-1 space-y-0.5 pl-4 text-ink/85">
        {items.map((it, i) => (
          <li key={i} className="list-disc">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerdictCard({ msg, cfg, before }: { msg: any; cfg: any; before: any[] }) {
  const toast = useToast();
  if (msg.meta?.consensus) {
    return (
      <div className="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/[0.09] to-teal-500/[0.04] p-4" data-testid="debate-verdict">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-600 text-white">
            <Handshake className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">Hai bên đã đồng thuận sau {msg.round} lượt</p>
            <p className="text-[11px] text-muted">
              {cfg.a?.label} và {cfg.b?.label} cùng ký phương án dưới đây
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={Copy}
            onClick={() => {
              void navigator.clipboard?.writeText(msg.text).then(
                () => toast("Đã sao chép kết luận", "ok"),
                () => toast("Không sao chép được", "err"),
              );
            }}
          >
            Sao chép
          </Button>
        </div>
        <div className="mt-3 rounded-xl bg-card/80 p-3">
          <Md text={msg.text} />
        </div>
      </div>
    );
  }
  const last = (side: Side) => [...before].reverse().find((m) => isTurn(m) && m.status === "done" && sideOf(m) === side);
  const issues: string[] = msg.result?.openIssues ?? [];
  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.04] p-4">
      <p className="text-sm font-bold text-ink">Chưa thống nhất sau {msg.round} lượt</p>
      {issues.length > 0 && <PointList title="Điểm còn bất đồng" items={issues} className="text-amber-700 dark:text-amber-300" />}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {(["a", "b"] as Side[]).map((side) => {
          const t = last(side);
          return (
            <div key={side} className={cx("rounded-xl border bg-card p-3", SIDE[side].ring)}>
              <p className={cx("mb-1 text-xs font-semibold", SIDE[side].text)}>Phương án cuối của {cfg[side]?.label}</p>
              {t?.result?.position ? <Md text={t.result.position} small /> : <p className="text-xs text-muted">—</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Md({ text, small }: { text: string; small?: boolean }) {
  return (
    <div className={cx("brain-md break-words text-ink [&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-sm [&_p]:my-1.5", small ? "text-[12.5px] leading-relaxed" : "text-[13.5px] leading-relaxed")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(u) => (/^(https?:|mailto:|#)/i.test(u) ? u : "")}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Hiện dần văn bản như người đang gõ (0,6–2,5 giây tuỳ độ dài). Tính theo thời gian đã trôi qua chứ không theo số nhịp,
 * nên tab chạy nền (trình duyệt hãm setInterval) quay lại là hiện đủ ngay.
 */
function useTypewriter(text: string, active: boolean, onTick?: () => void) {
  const [n, setN] = useState(active ? 0 : text.length);
  const done = useRef(!active);
  useEffect(() => {
    if (done.current) {
      setN(text.length);
      return;
    }
    const started = Date.now();
    const duration = Math.min(2500, Math.max(600, text.length * 6));
    const t = window.setInterval(() => {
      const next = Math.min(text.length, Math.ceil((text.length * (Date.now() - started)) / duration));
      if (next >= text.length) {
        done.current = true;
        window.clearInterval(t);
      }
      setN(next);
      onTick?.();
    }, 30);
    return () => window.clearInterval(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return text.slice(0, n);
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}
