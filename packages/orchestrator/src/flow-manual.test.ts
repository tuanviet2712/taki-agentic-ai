import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import type { TerminalRunOptions } from "@dotaka/llm-gateway";

const fake = vi.hoisted(() => ({
  run: vi.fn(), preflight: vi.fn(), generate: vi.fn(), bins: vi.fn(), ensure: vi.fn(), accounts: vi.fn(), source: vi.fn(), sync: vi.fn(), config: vi.fn(), openLogin: vi.fn(), open: vi.fn(),
  subprocess: vi.fn(() => { throw new Error("Unexpected external process in isolated manual Flow test"); }),
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<Record<string, unknown>>()), spawn: fake.subprocess, spawnSync: fake.subprocess, execFile: fake.subprocess, execFileSync: fake.subprocess,
}));
vi.mock("@dotaka/llm-gateway", async (original) => ({
  ...(await original<Record<string, unknown>>()), effectiveProvider: () => ({ provider: "claude_cli" }), modelFor: () => "test-video-model",
  runClaudeInTerminal: fake.run, generate: fake.generate,
}));
vi.mock("./claude-chrome.ts", async (original) => ({ ...(await original<Record<string, unknown>>()), claudeChromePreflight: fake.preflight }));
vi.mock("./flow-browser.ts", async (original) => ({
  ...(await original<Record<string, unknown>>()), ensureFlowBrowser: fake.ensure, flowAccounts: fake.accounts, flowSource: fake.source,
  syncFlowProfile: fake.sync, flowMcpConfig: fake.config, openFlowLogin: fake.openLogin, openInFlowChrome: fake.open,
}));
vi.mock("./video-ai.ts", async (original) => ({ ...(await original<Record<string, unknown>>()), ensureVideoBins: fake.bins }));

const prefix = join(tmpdir(), "flow-manual-");
const temp = mkdtempSync(prefix);
const { CreativeInput, MANUAL_FACE_ROLE, MANUAL_NEEDS_CHROME, MANUAL_TOOL, PLATFORM_RISK_MSG, PLATFORM_RISK_RE, finishManualFlowJob, friendlyFlowError, openManualProject, resumeManualFlow, runVideoJob, waitAndFinishManual } = await import("./creative.ts");
const { FLOW_COLLECT } = await import("./video-ai.ts");
const { MAX_SCENE_WORDS, approvedScript, composePrompts, countWords, customScenes, fitScenes, manualPreview, planFile } = await import("./flow-manual.ts");
const SCRIPT = [
  "HOOK: Khách hỏi giá rồi im lặng? | Mất khách vì trả lời chậm",
  "[0-3s] Cận mặt nhìn thẳng camera",
  "🎙 Khách hỏi giá rồi im lặng, anh chị có biết vì sao không?",
  "🅣 Vì sao khách im lặng?",
  "[3-12s] Ngồi bàn làm việc, cầm điện thoại",
  "🎙 Phần lớn là do mình trả lời chậm. Khách nhắn lúc mười giờ tối, sáng hôm sau mình mới đọc thì khách đã mua chỗ khác rồi.",
  "[12-20s] Đứng trước màn hình máy tính",
  "🎙 Trợ lý AI trả lời khách ngay trong năm giây, kể cả lúc nửa đêm, đúng giọng thương hiệu của anh chị.",
  "CTA: Nhắn \"AI\" để nhận bản dùng thử",
  "Caption: Đừng để khách chờ. #AI #banhang",
].join("\n");

const deviceId = "manual-local-device";
const preflightResult = { deviceId, label: "Selected Chrome (Windows)", profile: { channel: "chrome", dir: "Profile 1" }, browser: { deviceId } };
const blockedResult = { status: "blocked", finalPath: "", durationSec: 0, scenes: 0, redoneScenes: [], script: [], caption: "", notes: "Hết tín dụng Flow" };
let bizId: string;
let scriptId: string;
let face: string;

const planOut = (n: number) => ({
  concept: { name: "Chủ shop nói thẳng", why: "Kịch bản là lời nói trực tiếp.", setting: "small shop counter", style: "natural", wardrobe: "white shirt", lighting: "daylight", voice: "warm northern Vietnamese female voice" },
  character: "A Vietnamese woman in her thirties with shoulder-length black hair.",
  scenes: Array.from({ length: n }, (_, i) => ({ n: i + 1, shot: "medium close-up", image: `Scene ${i + 1} frame.`, motion: `Scene ${i + 1} slow push-in.` })),
  caption: "Đừng để khách chờ. #AI",
});

beforeEach(() => {
  vi.clearAllMocks();
  openDb(":memory:");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network in isolated manual Flow test"); }));
  fake.preflight.mockResolvedValue(preflightResult);
  fake.bins.mockReturnValue(join(temp, "bin"));
  fake.run.mockResolvedValue(blockedResult);
  fake.ensure.mockResolvedValue({});
  fake.accounts.mockResolvedValue(["flow@example.test"]);
  fake.source.mockReturnValue({ channel: "chrome", dir: "Profile 1" });
  fake.sync.mockResolvedValue({});
  fake.openLogin.mockResolvedValue({});
  fake.open.mockResolvedValue(undefined);
  fake.config.mockImplementation((raw: string) => ({ mcpServers: { flow: { command: "fake-playwright", args: ["--output-dir", raw] } } }));
  fake.generate.mockImplementation(async (req: { user: string }) => ({ output: planOut((req.user.match(/^\d+\. \(/gm) ?? []).length) }));
  bizId = insert("biz", { name: "Manual Flow test shop", settings: { ...DEFAULT_SETTINGS, flow: { chromeChannel: "chrome", chromeProfileDir: "Profile 1", browserDeviceId: deviceId, timeoutMin: 75 } } }).id;
  scriptId = insert("content_item", { biz_id: bizId, agent_key: "video", kind: "video_script", channel: "tiktok", title: "Khách im lặng", body: SCRIPT, status: "approved" }).id;
  const uploads = mkdtempSync(join(temp, "up-"));
  face = join(uploads, "face.jpg");
  writeFileSync(face, "not-a-real-jpeg");
});
afterEach(async () => {
  await new Promise<void>((done) => setImmediate(done));
  closeDb();
  vi.unstubAllGlobals();
});
afterAll(() => {
  if (!temp.startsWith(prefix)) throw new Error("Unexpected cleanup path");
  rmSync(temp, { recursive: true, force: true });
});

const words = (t: string) => t.split(/\s+/).filter(Boolean);

describe("chia cảnh theo nhịp nói", () => {
  it("đếm chữ tiếng Việt, bỏ dấu câu đứng riêng", () => {
    expect(countWords("Xin chào, các bạn — hôm nay 10 giờ!")).toBe(8);
    expect(countWords("  ")).toBe(0);
  });

  it("giữ nguyên văn + thứ tự, mỗi cảnh không quá trần chữ của clip 8 giây", () => {
    const voices = [
      "Câu một có đúng sáu chữ thôi. Câu hai cũng ngắn gọn như vậy.",
      Array.from({ length: 70 }, (_, i) => `từ${i}`).join(" "),
      "Cuối cùng là lời kêu gọi hành động rõ ràng cho khách hàng.",
    ];
    const scenes = fitScenes(voices);
    expect(scenes.every((s) => s.words <= MAX_SCENE_WORDS && s.seconds === 8)).toBe(true);
    expect(words(scenes.map((s) => s.voice).join(" "))).toEqual(words(voices.join(" ")));
    expect(scenes.map((s) => s.n)).toEqual(scenes.map((_, i) => i + 1));
  });

  it("chia cân đối: không để lẻ một cảnh vài chữ như \"Việc 3, tổng hợp báo cáo.\"", () => {
    const voices = [
      "Bạn đang trả lương cho 3 việc mà AI làm xong trong 10 phút, nếu biết cách thiết lập đúng. Việc 1, trả lời khách.",
      "Một chủ shop thời trang để AI chốt 15 tin nhắn trong lúc đang họp, không khách nào phải chờ quá 1 phút. Việc 2, dựng nội dung.",
      "Thay vì thuê designer chờ 1 ngày cho 1 bộ ảnh, AI ra 10 mẫu ảnh và caption trong chưa đầy 3 phút. Việc 3, tổng hợp báo cáo.",
      "Dữ liệu bán hàng từ 5 kênh được AI gộp thành 1 báo cáo doanh thu, xong trước khi nhân viên kịp mở file Excel.",
      "Trong khi một bên chỉ cần đọc kết quả AI gửi sẵn mỗi sáng, bên kia vẫn đang ngồi gõ số liệu đến khuya cho cùng một việc.",
      "Muốn AI làm thay 3 việc này cho doanh nghiệp bạn, comment ngay từ khóa HETHONG.",
    ];
    const scenes = fitScenes(voices);
    expect(scenes.every((s) => s.words <= MAX_SCENE_WORDS)).toBe(true);
    expect(Math.min(...scenes.map((s) => s.words))).toBeGreaterThanOrEqual(10);
    expect(words(scenes.map((s) => s.voice).join(" "))).toEqual(words(voices.join(" ")));
  });

  it("Omni 1.1 Flash cho cảnh tới 35 chữ (clip 10 giây)", () => {
    const voice = Array.from({ length: 33 }, (_, i) => `t${i}`).join(" ") + ".";
    expect(fitScenes([voice])).toHaveLength(2);
    const [s] = fitScenes([voice], "Omni 1.1 Flash");
    expect(s).toMatchObject({ words: 33, seconds: 10 });
  });

  it("Sếp chỉnh ranh giới cảnh tự do nhưng lời phải nguyên văn và không quá trần chữ", () => {
    const voices = ["Câu một ngắn. Câu hai ngắn.", "Câu ba ngắn."];
    expect(customScenes(["Câu một ngắn.", "Câu hai ngắn. Câu ba ngắn."], voices).map((s) => s.words)).toEqual([3, 6]);
    expect(() => customScenes(["Câu một ngắn.", "Câu hai dài."], voices)).toThrow(/nguyên văn/);
    expect(() => customScenes([Array.from({ length: 30 }, () => "a").join(" ")], [Array.from({ length: 30 }, () => "a").join(" ")])).toThrow(/quá 28 chữ/);
  });

  it("gộp câu ngắn liền nhau vào một cảnh", () => {
    const scenes = fitScenes(["Chào cả nhà.", "Hôm nay mình review nhanh.", "Xem hết nhé."]);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].voice).toBe("Chào cả nhà. Hôm nay mình review nhanh. Xem hết nhé.");
  });

  it("prompt video chứa NGUYÊN VĂN lời thoại do hệ thống chèn, không phụ thuộc AI chép lại", () => {
    const scenes = fitScenes(["Khách nhắn lúc mười giờ tối, sáng hôm sau mình mới đọc."]);
    const [s] = composePrompts(planOut(1) as never, scenes);
    expect(s.videoPrompt).toContain(`"${scenes[0].voice}"`);
    expect(s.imagePrompt).toContain("9:16");
    expect(s.imagePrompt).toContain("reference image");
    expect(() => composePrompts({ ...planOut(1), scenes: [] } as never, scenes)).toThrow(/thiếu cảnh 1/);
  });
});

describe("kịch bản đã duyệt", () => {
  it("xem trước số cảnh, thời lượng và hook/CTA từ kịch bản", () => {
    const p = manualPreview(bizId, scriptId);
    expect(p.scenes.length).toBeGreaterThan(0);
    expect(p.durationSec).toBe(p.scenes.length * 8);
    expect(p.hookTitle).toBe("Vì sao khách im lặng?");
    expect(p.cta).toContain("dùng thử");
  });

  it("từ chối kịch bản chưa duyệt", () => {
    update("content_item", scriptId, { status: "in_review" });
    expect(() => approvedScript(bizId, scriptId)).toThrow(/chưa được duyệt/);
  });

  it("chặn kịch bản còn ý chờ xác nhận như mọi cách làm video khác", () => {
    update("content_item", scriptId, { body: SCRIPT.replace("đúng giọng thương hiệu", "đúng giọng thương hiệu ⚠️ cần chốt giá") });
    expect(() => approvedScript(bizId, scriptId)).toThrow(/chờ xác nhận/);
  });
});

function job() {
  const workdir = mkdtempSync(join(temp, "job-"));
  mkdirSync(join(workdir, "clips"));
  const input = CreativeInput.parse({ tool: MANUAL_TOOL, title: "Khách im lặng", brief: "Lời thoại từ kịch bản đã duyệt", brand: "other", channels: ["tiktok"], sourceContentId: scriptId, images: [{ path: face, role: MANUAL_FACE_ROLE }] });
  const row = insert("creative_job", { biz_id: bizId, tool: input.tool, title: input.title, status: "queued", input, log: [], workdir, source_content_id: scriptId });
  return { id: row.id as string, workdir };
}
function extension() {
  const settings = byId<Row>("biz", bizId)!.settings;
  update("biz", bizId, { settings: { ...settings, flow: { ...settings.flow, engine: "claude-in-chrome", chromeAutoApprove: true } } });
}

describe("luồng làm thủ công trên Flow", () => {
  it("chạy được bằng Chrome Flow (cùng Chrome với luồng Tool): Playwright, tải clip bằng taki-flow-collect, không dùng Claude in Chrome", async () => {
    const j = job();
    await runVideoJob(j.id);
    expect(fake.preflight).not.toHaveBeenCalled();
    expect(fake.accounts).toHaveBeenCalled();
    expect(fake.generate).toHaveBeenCalledTimes(1);
    const o = fake.run.mock.calls[0][0] as TerminalRunOptions;
    expect(o).not.toHaveProperty("chrome");
    expect(o.mcpConfig).toEqual({ mcpServers: { flow: { command: "fake-playwright", args: ["--output-dir", join(j.workdir, "raw")] } } });
    expect(o.allowedTools).toEqual(expect.arrayContaining(["mcp__flow", "Bash(taki-flow-collect:*)", "Bash(taki-flow-wait:*)"]));
    expect(o.allowedTools).not.toContain("mcp__claude-in-chrome");
    expect(o.allowedTools).not.toContain("Bash(taki-flow-save:*)");
    expect(o.system).toContain("taki-flow-collect --project");
    expect(o.system).not.toContain("tabs_create_mcp");
    expect(byId<Row>("creative_job", j.id)!.status).toBe("blocked");
  });

  it("agent dừng khi còn thiếu clip → hệ thống tự chạy taki-flow-collect cho đúng cảnh thiếu, không gọi lại AI", async () => {
    const j = job();
    const scenes = fitScenes(approvedScript(bizId, scriptId).parsed.scenes.map((s) => s.voice));
    writeFileSync(planFile(j.workdir), JSON.stringify({ title: "Khách im lặng", concept: planOut(1).concept, character: "x", caption: "c", faceImage: face, veoModel: "Veo 3.1 - Fast", durationSec: scenes.length * 8, scenes: composePrompts(planOut(scenes.length) as never, scenes), createdAt: "2026-10-12T00:00:00Z" }));
    writeFileSync(join(j.workdir, "progress.json"), JSON.stringify({ projectUrl: "https://flow.google.com/project/abc-123" }));
    writeFileSync(join(j.workdir, "clips", "scene_01.mp4"), "clip");
    update("creative_job", j.id, { status: "running" });
    await finishManualFlowJob(j.id, { ...blockedResult, status: "failed", notes: "Chrome Flow bị đóng" } as never);
    expect(fake.accounts).toHaveBeenCalled();
    const call = (fake.subprocess.mock.calls as unknown[][]).find((c) => (c[1] as string[] | undefined)?.includes(FLOW_COLLECT));
    expect(call?.[1]).toEqual(expect.arrayContaining(["--project", "https://flow.google.com/project/abc-123", "--only", scenes.slice(1).map((s) => s.n).join(",")]));
    expect(fake.generate).not.toHaveBeenCalled();
    expect(fake.run).not.toHaveBeenCalled();
    expect(byId<Row>("creative_job", j.id)!.status).toBe("failed"); // collector mocked → vẫn thiếu clip → không ghép video hụt
  });

  it("chưa chọn profile Chrome → chặn trước khi gọi AI", async () => {
    const settings = byId<Row>("biz", bizId)!.settings;
    update("biz", bizId, { settings: { ...settings, flow: { ...settings.flow, chromeProfileDir: null } } });
    const j = job();
    await runVideoJob(j.id);
    expect(byId<Row>("creative_job", j.id)).toMatchObject({ status: "blocked", error: MANUAL_NEEDS_CHROME });
    expect(fake.generate).not.toHaveBeenCalled();
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("kiểm Chrome trước, lập plan.json rồi mở agent Claude in Chrome đúng thiết bị; thiếu clip thì không ghép", async () => {
    extension();
    const j = job();
    await runVideoJob(j.id);
    expect(fake.preflight.mock.invocationCallOrder[0]).toBeLessThan(fake.generate.mock.invocationCallOrder[0]);
    expect(fake.generate.mock.calls[0][0].images).toEqual([{ path: face, mediaType: "image/jpeg" }]);
    const plan = JSON.parse(readFileSync(planFile(j.workdir), "utf8"));
    expect(plan.scenes.length).toBeGreaterThan(0);
    expect(plan.faceImage).toBe(face);
    const o = fake.run.mock.calls[0][0] as TerminalRunOptions;
    expect(o).toMatchObject({ chrome: true, mcpConfig: { mcpServers: {} }, resultFile: join(j.workdir, "result.json"), approver: { deviceId, hosts: ["flow.google.com", "labs.google", "accounts.google.com"] } });
    expect(o.system).toContain(planFile(j.workdir));
    expect(o.system).toContain("Frames to Video");
    expect(o.system).toContain(deviceId);
    expect(o.system).not.toContain("taki-flow-save");
    expect(o.allowedTools).toEqual(expect.arrayContaining(["mcp__claude-in-chrome", "Bash(taki-video-stt:*)", "Bash(cp:*)"]));
    expect(o.allowedTools).not.toContain("Bash(taki-video-finish:*)");
    const done = byId<Row>("creative_job", j.id)!;
    expect(done.status).toBe("blocked");
    expect(done.error).toMatch(/Hết tín dụng Flow.*thiếu clip cảnh 1/);
    expect(fake.subprocess).not.toHaveBeenCalled(); // không gọi ffmpeg / finish.py khi thiếu cảnh
  });

  it("dùng lại plan.json đã lập (máy chủ khởi động lại giữa chừng) thay vì gọi AI lần nữa", async () => {
    extension();
    const j = job();
    const scenes = fitScenes(approvedScript(bizId, scriptId).parsed.scenes.map((s) => s.voice));
    writeFileSync(planFile(j.workdir), JSON.stringify({ title: "Khách im lặng", concept: planOut(1).concept, character: "x", caption: "c", faceImage: face, veoModel: "Veo 3.1 - Fast", durationSec: scenes.length * 8, scenes: composePrompts(planOut(scenes.length) as never, scenes), createdAt: "2026-10-12T00:00:00Z" }));
    await runVideoJob(j.id);
    expect(fake.generate).not.toHaveBeenCalled();
    expect(fake.run).toHaveBeenCalledTimes(1);
    expect(existsSync(planFile(j.workdir))).toBe(true);
  });
});

// Google Flow chặn bước TẠO VIDEO tự động ("We noticed some unusual activity"): không thử đi thử lại, Sếp bấm tạo rồi hệ thống tự chờ / tải / ghép.
describe("Flow chặn tạo video tự động (unusual activity)", () => {
  const RISK_NOTE = "projectUrl: https://flow.google.com/project/65c430ee-3a38-4be5-9ade-3882572290ef . Giai đoạn tạo VIDEO bị chặn hoàn toàn: mọi lần bấm Start generation đều trả về lỗi chung 'We noticed some unusual activity. Note that browser extensions that modify the page may cause issues'.";
  const withPlan = (progress = true) => {
    const j = job();
    const scenes = fitScenes(approvedScript(bizId, scriptId).parsed.scenes.map((s) => s.voice));
    writeFileSync(planFile(j.workdir), JSON.stringify({ title: "Khách im lặng", concept: planOut(1).concept, character: "x", caption: "c", faceImage: face, veoModel: "Veo 3.1 - Fast", durationSec: scenes.length * 8, scenes: composePrompts(planOut(scenes.length) as never, scenes), createdAt: "2026-10-12T00:00:00Z" }));
    if (progress) writeFileSync(join(j.workdir, "progress.json"), JSON.stringify({ projectUrl: "https://flow.google.com/project/abc-123" }));
    return { j, n: scenes.length };
  };

  it("nhận ra đúng lỗi và đổi thành hướng dẫn tiếng Việt (không nhầm với hết lượt / lỗi prompt)", () => {
    expect(PLATFORM_RISK_RE.test(RISK_NOTE)).toBe(true);
    expect(PLATFORM_RISK_RE.test("PLATFORM_RISK: projectUrl …")).toBe(true);
    expect(PLATFORM_RISK_RE.test("Hết tín dụng Flow")).toBe(false);
    expect(friendlyFlowError(RISK_NOTE)).toBe(PLATFORM_RISK_MSG);
    expect(PLATFORM_RISK_MSG).toMatch(/Mở dự án Flow[\s\S]*tự chờ & ghép/);
    expect(friendlyFlowError("Hết tín dụng Flow")).toBe("Hết tín dụng Flow");
  });

  it("agent được dặn dừng NGAY, không đổi model / thử lại, ghi PLATFORM_RISK", async () => {
    const { j } = withPlan(false);
    await runVideoJob(j.id);
    const o = fake.run.mock.calls[0][0] as TerminalRunOptions;
    expect(o.system).toContain("FLOW CHẶN TỰ ĐỘNG HOÁ");
    expect(o.system).toMatch(/KHÔNG bấm tạo lại, KHÔNG đổi model/);
    expect(o.system).toContain("PLATFORM_RISK:");
  });

  it("Flow chặn: KHÔNG dồn dập thử lại — nghỉ rồi tự thử lại (lần 1: 40 phút), dự án + ảnh storyboard giữ nguyên", async () => {
    const { j } = withPlan();
    update("creative_job", j.id, { status: "running" });
    const t0 = Date.now();
    await finishManualFlowJob(j.id, { ...blockedResult, notes: RISK_NOTE } as never);
    const row = byId<Row>("creative_job", j.id)!;
    expect(row.status).toBe("queued");
    expect(row.step).toMatch(/Flow đang chặn tạo video tự động \(đã có 0\/\d+ cảnh\) — hệ thống nghỉ rồi tự làm tiếp lúc .*từng cảnh một/);
    const queued = q.get<Row>("SELECT queue, name, run_at, lock_key FROM job WHERE name = 'creative.flow' AND json_extract(payload, '$.jobId') = ?", j.id)!;
    expect(queued).toMatchObject({ queue: "media", lock_key: "flow-chrome" });
    expect(new Date(queued.run_at).getTime() - t0).toBeGreaterThan(39 * 60_000);
    expect(new Date(queued.run_at).getTime() - t0).toBeLessThan(41 * 60_000);
    expect(fake.run).not.toHaveBeenCalled(); // không gọi lại agent ngay
  });

  it("lần thử lại chạy ở CHẾ ĐỘ THẬN TRỌNG (từng cảnh một, nghỉ giữa cảnh, gặp chặn là dừng); lần đầu thì chưa", async () => {
    const first = withPlan();
    await runVideoJob(first.j.id);
    expect((fake.run.mock.calls[0][0] as TerminalRunOptions).system).not.toContain("CHẾ ĐỘ THẬN TRỌNG");
    fake.run.mockClear();
    update("creative_job", first.j.id, { status: "queued", result: { ...blockedResult, notes: RISK_NOTE } });
    await runVideoJob(first.j.id);
    const o = fake.run.mock.calls[0][0] as TerminalRunOptions;
    expect(o.system).toContain("CHẾ ĐỘ THẬN TRỌNG");
    expect(o.system).toMatch(/ĐÚNG 1 cảnh mỗi lần[\s\S]*nghỉ thêm 2–3 phút[\s\S]*BỎ QUA/);
  });

  it("có tiến triển (thêm cảnh đã có clip) thì bộ đếm thất bại về 0: cứ nghỉ rồi làm tiếp từng đợt cho tới khi đủ cảnh", async () => {
    const { j, n } = withPlan();
    const clip = (k: number) => writeFileSync(join(j.workdir, "clips", `scene_${String(k).padStart(2, "0")}.mp4`), "clip");
    // Mỗi lượt Flow chặn sau khi làm thêm 1 cảnh: 6 lượt liên tiếp đều được hẹn lại (nhiều hơn mức 3 lần không tiến triển).
    for (let k = 1; k <= Math.min(5, n - 1); k++) {
      clip(k);
      update("creative_job", j.id, { status: "running" });
      await finishManualFlowJob(j.id, { ...blockedResult, notes: RISK_NOTE } as never);
      const row = byId<Row>("creative_job", j.id)!;
      expect(row.status).toBe("queued");
      expect(row.step).toContain(`đã có ${k}/${n} cảnh`);
      expect(row.step).not.toMatch(/không tiến triển/);
    }
    // rồi đứng yên (không thêm cảnh nào): 2 lượt đầu vẫn hẹn lại, lượt không tiến triển thứ 3 liên tiếp mới dừng
    for (let k = 0; k < 2; k++) {
      update("creative_job", j.id, { status: "running" });
      await finishManualFlowJob(j.id, { ...blockedResult, notes: RISK_NOTE } as never);
      expect(byId<Row>("creative_job", j.id)!.status).toBe("queued");
    }
    update("creative_job", j.id, { status: "running" });
    await finishManualFlowJob(j.id, { ...blockedResult, notes: RISK_NOTE } as never);
    expect(byId<Row>("creative_job", j.id)!.status).toBe("blocked");
  });

  it("hết 3 lần tự thử lại mà vẫn bị chặn → báo lỗi kèm hướng dẫn bấm tay (không thử mãi)", async () => {
    const { j } = withPlan();
    for (let k = 0; k < 3; k++) {
      update("creative_job", j.id, { status: "running" });
      await finishManualFlowJob(j.id, { ...blockedResult, notes: RISK_NOTE } as never);
      expect(byId<Row>("creative_job", j.id)!.status).toBe("queued");
    }
    update("creative_job", j.id, { status: "running" });
    await finishManualFlowJob(j.id, { ...blockedResult, notes: RISK_NOTE } as never);
    const row = byId<Row>("creative_job", j.id)!;
    expect(row.status).toBe("blocked");
    expect(row.error).toContain(PLATFORM_RISK_MSG);
    expect(q.all<Row>("SELECT id FROM job WHERE name = 'creative.flow' AND json_extract(payload, '$.jobId') = ?", j.id)).toHaveLength(3);
  });

  it("Sếp bấm \"Thử tự động lại ngay\": xếp lại bước tạo video ở hàng đợi media, dừng vòng tự chờ nếu đang chạy", () => {
    const { j } = withPlan();
    update("creative_job", j.id, { status: "blocked", result: { ...blockedResult, notes: RISK_NOTE } });
    expect(resumeManualFlow(bizId, j.id, "ceo")).toMatchObject({ status: "queued" });
    expect(q.get<Row>("SELECT queue FROM job WHERE name = 'creative.flow' AND json_extract(payload, '$.jobId') = ?", j.id)).toMatchObject({ queue: "media" });
    update("creative_job", j.id, { status: "running" });
    expect(() => resumeManualFlow(bizId, j.id, "ceo")).toThrow(/đang chạy/);
  });

  it("tự chờ & ghép: chỉ nhận việc bị chặn/lỗi có kế hoạch + dự án Flow; mở dự án Flow và chờ đủ video (không bấm gì)", async () => {
    const run = withPlan(false);
    update("creative_job", run.j.id, { status: "blocked", result: blockedResult });
    expect(() => waitAndFinishManual(bizId, run.j.id, "ceo")).toThrow(/chưa có dự án Flow/i);
    writeFileSync(join(run.j.workdir, "progress.json"), JSON.stringify({ projectUrl: "https://flow.google.com/project/abc-123" }));
    update("creative_job", run.j.id, { status: "running" });
    expect(() => waitAndFinishManual(bizId, run.j.id, "ceo")).toThrow(/không ở trạng thái lỗi/);
    update("creative_job", run.j.id, { status: "blocked" });

    const started = waitAndFinishManual(bizId, run.j.id, "ceo") as Row;
    expect(started).toMatchObject({ status: "running" });
    expect(String(started.step)).toMatch(new RegExp(`^Chờ Sếp bấm tạo video trong dự án Flow \\(0/${run.n}\\)`));
    expect(() => waitAndFinishManual(bizId, run.j.id, "ceo")).toThrow(/đang chờ|không ở trạng thái lỗi/i);
    await vi.waitFor(() => expect((fake.subprocess.mock.calls as unknown[][]).some((c) => (c[1] as string[] | undefined)?.includes("--videos"))).toBe(true));
    const waitCall = (fake.subprocess.mock.calls as unknown[][]).find((c) => (c[1] as string[] | undefined)?.includes("--videos"))!;
    expect(waitCall[1]).toEqual(expect.arrayContaining(["--videos", String(run.n)]));
    expect(fake.open).toHaveBeenCalledWith("https://flow.google.com/project/abc-123", expect.anything());
    expect(fake.run).not.toHaveBeenCalled();      // không gọi agent bấm tạo video
    expect(fake.generate).not.toHaveBeenCalled();
    update("creative_job", run.j.id, { status: "cancelled" }); // dừng vòng chờ
  });

  it("mở dự án Flow cho Sếp: dùng đúng link dự án đã lưu", async () => {
    const run = withPlan();
    update("creative_job", run.j.id, { status: "blocked", result: { ...blockedResult, notes: RISK_NOTE } });
    await expect(openManualProject(bizId, run.j.id)).resolves.toEqual({ projectUrl: "https://flow.google.com/project/abc-123" });
    expect(fake.open).toHaveBeenCalledWith("https://flow.google.com/project/abc-123", expect.anything());
  });
});
