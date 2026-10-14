import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, insert, openDb, update, type Row } from "@dotaka/db";

/** Công cụ tạo ảnh độc lập với model viết bài: Claude thiết kế / ChatGPT vẽ / Gemini trên Flow, có dự phòng. Không gọi AI / trình duyệt thật. */
const fake = vi.hoisted(() => ({ codexReady: true, provider: "claude_cli", flowFail: false, generate: vi.fn(), image: vi.fn(), flow: vi.fn() }));
vi.mock("@dotaka/llm-gateway", async (orig) => ({
  ...(await orig<typeof import("@dotaka/llm-gateway")>()),
  effectiveProvider: () => ({ provider: fake.provider, ready: true }),
  codexReadiness: (_b: string, accountId?: string | null) => (fake.codexReady ? { ready: true, account: { id: accountId ?? "acc" } } : { ready: false, reason: "Hồ sơ ChatGPT chưa đăng nhập", account: null }),
  generate: fake.generate,
  generateImageFile: fake.image,
}));
vi.mock("./flow-image.ts", async (orig) => ({ ...(await orig<typeof import("./flow-image.ts")>()), flowImageFile: fake.flow }));
vi.mock("./post-image.ts", async (orig) => ({
  ...(await orig<typeof import("./post-image.ts")>()),
  renderDesign: async (_h: string, out: string) => { writeFileSync(out, Buffer.alloc(4000, 1)); },
  reviewDesign: async () => null,
}));

const cwd = process.cwd();
const work = mkdtempSync(join(tmpdir(), "taki-imgengine-"));
let eng: typeof import("./image-engine.ts");
let ai: typeof import("./ai-image.ts");
let fl: typeof import("./flow-image.ts");
let B = "";
beforeAll(async () => {
  openDb(":memory:");
  process.chdir(work);
  eng = await import("./image-engine.ts");
  ai = await import("./ai-image.ts");
  fl = await import("./flow-image.ts");
});
afterAll(() => { process.chdir(cwd); rmSync(work, { recursive: true, force: true }); });
beforeEach(() => {
  vi.clearAllMocks();
  fake.codexReady = true; fake.provider = "claude_cli"; fake.flowFail = false;
  fake.generate.mockResolvedValue({ output: { headline: "Tiêu đề", alt: "Ảnh minh hoạ", html: "<!doctype html><html><body>x</body></html>" }, model: "claude-test" });
  fake.image.mockImplementation(async (r: { outFile: string }) => { writeFileSync(r.outFile, Buffer.alloc(4000, 2)); return { path: r.outFile, model: "gpt-image", provider: "codex_cli" }; });
  fake.flow.mockImplementation(async (r: { outFile: string }) => { if (fake.flowFail) throw new Error("Quá 5 phút Flow chưa tạo xong ảnh"); writeFileSync(r.outFile, Buffer.alloc(4000, 3)); return { path: r.outFile, model: "gemini-flow:Nano Banana 2.1" }; });
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, flow: { chromeProfileDir: "Profile 1" } } }).id;
});
const setEngine = (content: Row) => { const s = byId<Row>("biz", B)!.settings; update("biz", B, { settings: { ...s, content: { ...(s.content ?? {}), ...content } } }); };
const ci = { id: "c1", biz_id: "", title: "TOFU · AI cho doanh nghiệp", body: "Nội dung bài về AI.", channel: "facebook" } as Row;
const png = () => join(work, `img-${Math.random().toString(36).slice(2)}.png`);

describe("chọn công cụ tạo ảnh", () => {
  it("tự động: đi theo kết nối AI (Claude → thiết kế, ChatGPT → vẽ)", () => {
    expect(eng.postImageEngine(B)).toMatchObject({ engine: "claude", chosen: "claude" });
    fake.provider = "codex_cli";
    expect(eng.postImageEngine(B)).toMatchObject({ engine: "chatgpt" });
  });

  it("ChatGPT vẽ ảnh khi đội AI viết bằng Claude, dùng đúng hồ sơ ChatGPT của ảnh", async () => {
    setEngine({ imageEngine: "chatgpt", imageCodexAccountId: "acc-img" });
    const r = await ai.makeAiImage({ bizId: B, ci, dna: undefined, png: png() });
    expect(r).toMatchObject({ engine: "chatgpt", model: "gpt-image", textInImage: false });
    expect(fake.image.mock.calls[0][0]).toMatchObject({ accountId: "acc-img" });
    expect(fake.generate).not.toHaveBeenCalled();
  });

  it("Gemini trên Flow: prompt 1 ô (không thẻ untrusted), đúng khung; Flow lỗi → Claude thiết kế thay và ghi lý do", async () => {
    mkdirSync(join(work, "data", "flow-chrome", "Default"), { recursive: true });
    setEngine({ imageEngine: "gemini_flow" });
    const ok = await ai.makeAiImage({ bizId: B, ci, dna: undefined, png: png(), frame: { width: 1200, height: 675 } });
    expect(ok).toMatchObject({ engine: "gemini_flow", model: "gemini-flow:Nano Banana 2.1" });
    const call = fake.flow.mock.calls[0][0];
    expect(call.frame).toEqual({ width: 1200, height: 675 });
    expect(call.prompt).not.toMatch(/untrusted/);
    expect(call.prompt).toContain("KHÔNG có bất kỳ chữ");
    fake.flowFail = true;
    const fb = await ai.makeAiImage({ bizId: B, ci, dna: undefined, png: png() });
    expect(fb).toMatchObject({ engine: "claude", fallbackFrom: "gemini_flow", fallbackError: expect.stringContaining("Quá 5 phút") });
  });

  it("công cụ chưa sẵn sàng: dự phòng bật → Claude kèm lý do; tắt → không tạo ảnh", () => {
    setEngine({ imageEngine: "chatgpt" });
    fake.codexReady = false;
    expect(eng.postImageEngine(B)).toMatchObject({ engine: "claude", chosen: "chatgpt", reason: expect.stringContaining("chưa đăng nhập") });
    setEngine({ imageFallback: false });
    expect(eng.postImageEngine(B)).toMatchObject({ engine: null, reason: "Hồ sơ ChatGPT chưa đăng nhập" });
    expect(eng.imageEngineStatus(B).engines).toMatchObject({ claude: { ready: true }, chatgpt: { ready: false } });
  });

  it("tỉ lệ Flow gần nhất với khung ảnh", () => {
    expect(fl.flowAspect({ width: 1080, height: 1350 })).toBe("3:4");
    expect(fl.flowAspect({ width: 1200, height: 675 })).toBe("16:9");
    expect(fl.flowAspect({ width: 1000, height: 1000 })).toBe("1:1");
  });
});
