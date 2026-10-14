import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, insert, openDb } from "@dotaka/db";
import type { Dna } from "@dotaka/agents";

/** Kiểm duyệt MKT (model) chấm 75 → với rubric đạt ở 72 thì KHÔNG ép sửa nữa (trước đây cứng < 80 → vòng sửa thừa). */
const mkt = { score: 75, verdict: "dat", issues: [], dnaViolations: [] as string[], aiTraces: [], fix: "" };
const systems: string[] = [];
vi.mock("@dotaka/llm-gateway", async (orig) => {
  const real = await orig<typeof import("@dotaka/llm-gateway")>();
  return {
    ...real,
    effectiveProvider: () => ({ provider: "anthropic" }),
    generate: async (req: any) => {
      if (req.agentKey === "review") { systems.push(req.system); return { output: mkt, usage: { input: 0, output: 0, cached: 0, costMicros: 0 }, model: "fake" }; }
      return real.generate({ ...req, bizId: req.bizId });
    },
  };
});
vi.mock("@dotaka/skills", async (orig) => {
  const real = await orig<typeof import("@dotaka/skills")>();
  return { ...real, agentPlaybook: (biz: string, key: string) => (key === "review" ? { text: "skill kiểm duyệt", parts: [] } : real.agentPlaybook(biz, key)) };
});

const dna = {
  company: { name: "Shop", brand: "Shop", website: "shop.vn", industry: "x", ceo: "A", scale: "nhỏ" },
  positioning: "p", mission: "m", audience: [{ name: "Mẹ", pains: ["mệt"], goals: ["khỏe"] }],
  products: [{ key: "sua-x", name: "Sữa X", summary: "s", format: "Affiliate", price: 250_000 }],
  offers: [], voice: { style: ["gần gũi"], do: [], dont: [], sample: "" }, differentiators: [], forbiddenClaims: [], channels: [],
  goals: { yearTarget: 0, currentRunRate: 0, painPoint: "", competitors: [] },
} as unknown as Dna;

describe("ngưỡng Kiểm duyệt MKT = ngưỡng đạt của rubric", () => {
  beforeAll(() => { process.env.DB_PATH = ":memory:"; openDb(":memory:"); });
  afterAll(() => closeDb());

  it("điểm MKT 75 ≥ ngưỡng 72 → không bị ép 'revise' vì MKT; prompt báo đúng ngưỡng", async () => {
    const { reviewOutput } = await import("./review.ts");
    const biz = insert("biz", { name: "R", settings: { llm: { provider: "sandbox" } } }).id;
    const body = "Mẹ nào cũng mệt khi con biếng ăn. Sữa X ít đường, vị dịu, bé dễ uống hơn. Pha 1 cốc mỗi sáng, mẹ nhẹ người hẳn. ".repeat(3);
    const output = { channel: "facebook", format: "text", title: "Sữa X", variants: [{ key: "A", hook: "Bé biếng ăn?", body, cta: "Xem link dưới bình luận", hashtags: ["#suax"] }, { key: "B", hook: "Mẹ mệt?", body, cta: "Inbox", hashtags: [] }], facts: [], productRefs: ["sua-x"], openQuestions: [] };
    const r = await reviewOutput({ bizId: biz, subjectType: "task", subjectId: "t", rubricKey: "content_social", output, dna, contentView: { title: "Sữa X", hook: "Bé biếng ăn?", body, cta: "Xem link", channel: "facebook" } });
    expect(systems.at(-1)).toContain(">=72");
    expect(r.criteria.some((c) => c.key === "mkt_qa")).toBe(true);
  });

  it("luật MKT: 75 với ngưỡng 72 vẫn 'pass'; dưới ngưỡng hoặc vi phạm DNA → 'revise'; không nâng bậc bản chưa đạt", async () => {
    const { applyMktRule } = await import("./review.ts");
    expect(applyMktRule("pass", { score: 75, dnaViolations: [] }, 72)).toBe("pass"); // trước đây: revise (cứng < 80)
    expect(applyMktRule("pass", { score: 71, dnaViolations: [] }, 72)).toBe("revise");
    expect(applyMktRule("pass", { score: 95, dnaViolations: ["giá lạ"] }, 72)).toBe("revise");
    expect(applyMktRule("revise", { score: 95, dnaViolations: [] }, 72)).toBe("revise");
    expect(applyMktRule("pass", null, 72)).toBe("pass");
  });
});
