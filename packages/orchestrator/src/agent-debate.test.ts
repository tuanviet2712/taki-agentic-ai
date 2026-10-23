import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, type Row } from "@dotaka/db";

/**
 * Phòng tranh luận ở chế độ THẬT với model giả: generate() trả lời theo kịch bản từng lượt (không gọi CLI thật),
 * để kiểm vòng chạy, đồng thuận 2 chiều, chen ngang, dừng giữa lượt và việc không bao giờ dùng lời mẫu thay model thật.
 */
type Call = { agentKey: string; provider: string; model: string; system: string; user: string; effort?: string; suffixLen: number };
type Step = Row | ((req: any) => Row | Promise<Row>);
const calls: Call[] = [];
let script: Step[] = [];
let sandboxNext = false;

const turn = (o: Row = {}) => ({ message: "m", rebuttals: [], position: "p", concessions: [], openIssues: [], agreement: 0, agree: false, jointAnswer: "", ...o });

vi.mock("@dotaka/llm-gateway", async (orig) => {
  const real = await orig<typeof import("@dotaka/llm-gateway")>();
  return {
    ...real,
    providerReadiness: () => ({ ready: true }),
    generate: vi.fn(async (req: any) => {
      calls.push({ agentKey: req.agentKey, provider: req.providerOverride, model: req.model, system: req.system, user: req.user, effort: req.effort, suffixLen: (req.systemSuffix ?? "").length });
      if (sandboxNext) {
        // Như generate() thật khi Claude CLI mất đăng nhập: tự chuyển sang hàm sandbox của nơi gọi.
        sandboxNext = false;
        return { output: req.schema.parse(req.sandbox()), model: "sandbox", source: "sandbox", provider: "sandbox", usage: { input: 0, output: 0, cached: 0, costMicros: 0 } };
      }
      const step = script.shift() ?? turn();
      const out = typeof step === "function" ? await step(req) : step;
      return { output: req.schema.parse(out), model: req.model, source: "claude", provider: req.providerOverride, usage: { input: 10, output: 20, cached: 0, costMicros: 0 } };
    }),
  };
});

const { advanceDebate, createDebate, getDebate, sayToDebate, stopDebate } = await import("./agent-debate.ts");

let bizId: string;
beforeAll(() => {
  openDb(":memory:");
  bizId = insert("biz", { name: "Debate live", settings: { ...DEFAULT_SETTINGS, llm: { provider: "claude_cli" } } }).id;
});
afterAll(() => closeDb());
beforeEach(() => {
  calls.length = 0;
  script = [];
  sandboxNext = false;
});

const turnsOf = (d: any) => d.messages.filter((m: any) => m.role === "debater_a" || m.role === "debater_b");
const LIVE = { a: { model: "claude-opus-5" }, b: { model: "grok-4.6" }, mode: "live" as const };

describe("agent-debate (chế độ thật, model giả)", () => {
  it("routes each seat to its own CLI, makes B rebut A's real words, and ends only when both sides sign", async () => {
    script = [
      turn({ message: "A: nên làm X", position: "Làm X" }),
      turn({ message: "B: X thiếu dữ liệu", rebuttals: ["thiếu dữ liệu"], position: "Làm Y", agreement: 30, agree: true /* lượt 2 không được chốt */ }),
      turn({ message: "A: đồng ý Y có điều kiện", position: "Y có điều kiện", agreement: 85, agree: true, jointAnswer: "Chốt: Y có điều kiện" }),
      turn({ message: "B: ký", position: "Y có điều kiện", agreement: 90, agree: true, jointAnswer: "Chốt: Y có điều kiện (đã ký)" }),
    ];
    const d = await createDebate(bizId, { question: "Chọn X hay Y?", ...LIVE, wait: true });
    expect(d.status).toBe("consensus");
    expect(calls.map((c) => c.provider)).toEqual(["claude_cli", "grok_cli", "claude_cli", "grok_cli"]);
    expect(calls.every((c) => c.agentKey === "debate")).toBe(true);
    // Tốc độ: lượt thảo luận chạy mức suy luận thấp, skill playbook cắt gọn (đo thật: Claude 56s → 22s mỗi lượt)
    expect(calls.every((c) => c.effort === "low" && c.suffixLen <= 5000)).toBe(true);
    expect(calls[0].system).toContain("NGẮN GỌN");
    expect(calls[1].user).toContain("BẮT BUỘC phản biện");
    expect(calls[1].user).toMatch(/<untrusted_context>\s*A: nên làm X/);
    expect(turnsOf(d)[1].result.agree).toBe(false);
    expect(d.result.conclusion).toBe("Chốt: Y có điều kiện (đã ký)");
    expect(d.messages.at(-1)?.meta.consensus).toBe(true);
  });

  it("never substitutes canned simulation text for a live seat whose CLI silently fell back to sandbox", async () => {
    script = [turn({ message: "A mở lời" })];
    const first = await createDebate(bizId, { question: "Câu hỏi khó", ...LIVE, pace: "step", wait: true });
    expect(first.status).toBe("waiting");
    sandboxNext = true;
    const d = await advanceDebate(bizId, first.id, { steps: "one", wait: true });
    expect(d.status).toBe("failed");
    expect(d.result.error).toContain("chưa sẵn sàng");
    const t = turnsOf(d);
    expect(t.at(-1).status).toBe("failed");
    expect(d.messages.some((m: any) => m.role === "verdict")).toBe(false);
  });

  it("still records consensus when the user presses stop while the second signature is being written", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    script = [
      turn(),
      turn({ agreement: 40 }),
      turn({ agreement: 85, agree: true, jointAnswer: "Phương án chung" }),
      async () => {
        await gate;
        return turn({ agreement: 92, agree: true, jointAnswer: "Phương án chung" });
      },
    ];
    const created = await createDebate(bizId, { question: "Dừng giữa chừng?", ...LIVE });
    await vi.waitFor(() => expect(calls.length).toBe(4));
    expect(stopDebate(bizId, created.id).status).toBe("stopped");
    release();
    await vi.waitFor(() => expect(getDebate(bizId, created.id).status).toBe("consensus"));
  });

  it("feeds an interjection made mid-turn into the next speaker's prompt and does not count earlier signatures", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    script = [
      async () => {
        await gate;
        return turn({ message: "A mở lời" });
      },
      turn({ message: "B trả lời người dùng" }),
    ];
    const created = await createDebate(bizId, { question: "Có nên mở rộng?", ...LIVE, pace: "step" });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    await sayToDebate(bizId, created.id, { text: "Ngân sách tối đa 200 triệu", to: "both" });
    release();
    await vi.waitFor(() => expect(getDebate(bizId, created.id).turnsDone).toBe(2));
    await vi.waitFor(() => expect(getDebate(bizId, created.id).status).toBe("waiting"));
    expect(calls[1].user).toContain("Người dùng hỏi tiếp · gửi cả đội");
    expect(calls[1].user).toContain("Ngân sách tối đa 200 triệu");
  });

  it("re-examining a settled answer gets enough turns and its first turn cannot just re-sign", async () => {
    script = [turn(), turn(), turn({ agreement: 85, agree: true, jointAnswer: "J" }), turn({ agreement: 90, agree: true, jointAnswer: "J" })];
    const d = await createDebate(bizId, { question: "Soi lại?", ...LIVE, maxTurns: 4, wait: true });
    expect(d.status).toBe("consensus");
    script = [
      turn({ agreement: 95, agree: true, jointAnswer: "J" }), // bị ép agree=false: lượt đầu sau kết luận phải soi lại
      turn({ agreement: 90, agree: true, jointAnswer: "J2" }),
      turn({ agreement: 92, agree: true, jointAnswer: "J2" }),
    ];
    const again = await advanceDebate(bizId, d.id, { steps: "auto", wait: true });
    expect(again.max_rounds).toBeGreaterThanOrEqual(7);
    expect(calls.at(-3)?.user).toContain("đào sâu thêm");
    const t = turnsOf(again);
    expect(t[4].result.agree).toBe(false);
    expect(again.status).toBe("consensus");
    expect(again.result.conclusion).toBe("J2");
  });
});
