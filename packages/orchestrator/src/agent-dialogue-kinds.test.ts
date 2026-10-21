import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dna } from "@dotaka/agents";
import { DEFAULT_SETTINGS, closeDb, insert, openDb } from "@dotaka/db";

/** Hội đồng ở chế độ thật với model giả: mỗi loại việc (bài MXH / video / SEO / chiến lược) phải viết & chấm theo đúng tiêu chí của nó. */
const calls: { agentKey: string; system: string; user: string }[] = [];
vi.mock("@dotaka/llm-gateway", async (orig) => {
  const real = await orig<typeof import("@dotaka/llm-gateway")>();
  return {
    ...real,
    providerReadiness: () => ({ ready: true }),
    generate: vi.fn(async (req: any) => {
      calls.push({ agentKey: req.agentKey, system: req.system, user: req.user });
      const writer = "replyToPeer" in req.schema.shape;
      const out = writer
        ? { replyToPeer: "Gửi giám khảo", title: "Tiêu đề", hook: "Mở đầu", body: "Nội dung đầy đủ", cta: "Nhắn tin ngay", hashtags: [], selfNotes: [] }
        : { replyToWriter: "Tốt", score: 90, verdict: "dat", criteriaBreakdown: [], strengths: [], issues: [], dnaViolations: [], aiTraces: [], rewriteDirective: "" };
      return { output: req.schema.parse(out), model: req.model, source: "claude", provider: req.providerOverride, usage: { input: 1, output: 1, cached: 0, costMicros: 0 } };
    }),
  };
});
const { createAndStartDialogue } = await import("./agent-dialogue.ts");

const DNA: Dna = {
  company: { name: "TAKI Academy", brand: "TAKI", website: "https://taki.vn", industry: "Đào tạo AI", ceo: "CEO", scale: "SME" },
  positioning: "Đào tạo AI thực chiến", mission: "", audience: [{ name: "Chủ shop", pains: ["tốn thời gian"], goals: ["tự động hóa"] }],
  products: [{ key: "ai", name: "Khóa AI", summary: "AI", format: "Online", price: 2990000 }], offers: [],
  voice: { style: ["Thực chiến"], do: [], dont: [], sample: "" }, differentiators: [], forbiddenClaims: [], channels: ["facebook"],
  goals: { yearTarget: 0, currentRunRate: 0, painPoint: "", competitors: [] },
};

let bizId: string;
beforeAll(() => {
  openDb(":memory:");
  bizId = insert("biz", { name: "kinds", settings: { ...DEFAULT_SETTINGS, llm: { provider: "claude_cli" } } }).id;
  insert("dna_profile", { biz_id: bizId, version: 1, status: "active", data: DNA, created_by: "ceo" });
});
afterAll(() => closeDb());
beforeEach(() => void (calls.length = 0));

const start = (scenario: string, writerAgent: string, reviewerAgent: string, channel?: string) =>
  createAndStartDialogue(bizId, {
    scenario, topic: "Đề bài thử", mode: "live", maxRounds: 1, ...(channel ? { channel } : {}),
    writer: { agentKey: writerAgent, model: "claude-sonnet-5-5" }, reviewer: { agentKey: reviewerAgent, model: "grok-4.6" },
  });

describe("Hội đồng: mỗi loại việc viết & chấm theo tiêu chí riêng", () => {
  it("video script: writer gets the scene format, reviewer scores hook/scene rhythm, channel kept", async () => {
    const d = await start("video_review", "video_script", "review", "tiktok");
    expect(d.config.kind).toBe("video_script");
    expect(d.channel).toBe("tiktok");
    const [w, r] = calls;
    expect(w.system).toContain("kịch bản video ngắn");
    expect(w.system).toContain("[0-3s] Hình:");
    expect(r.system).toContain("Nhịp cảnh & độ dài");
    expect(r.system).not.toContain("Đúng nỗi đau & ngôn ngữ ICP");
  });

  it("SEO article and strategy use their own criteria; a Facebook post keeps the social rubric", async () => {
    await start("seo_review", "seo_web", "review", "website");
    expect(calls[1].system).toContain("Đúng ý định tìm kiếm & từ khóa");
    calls.length = 0;
    const s = await start("strategy_debate", "strategy", "market_research");
    expect(s.config.kind).toBe("strategy");
    expect(calls[1].system).toContain("Rủi ro & phương án dự phòng");
    calls.length = 0;
    await start("content_review", "content", "review", "facebook");
    expect(calls[1].system).toContain("Hook 3 giây đầu");
  });
});
