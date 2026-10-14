import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EditPlan, alignWords, autoPlan, chunkCaptions, fitCuts, plannerPrompt, resolveEditPlan, sanitizePlan, type EditScriptScene, type SourceInfo } from "./pro-edit.ts";
import { toolsPython, TOOLS_DIR } from "./video-ai.ts";

const src = (index: number, duration: number, hasAudio = false, shots: [number, number][] = [[0, duration]]): SourceInfo => ({
  index, path: `C:/x/v${index}.mp4`, duration, width: 1080, height: 1920, hasAudio, shots: shots.map(([start, end], k) => ({ id: `${index}.${k}`, start, end })),
});
const SOURCES = [src(0, 20, false, [[0, 6], [6, 12], [12, 20]]), src(1, 10)];
const SCRIPT: EditScriptScene[] = [
  { from: 0, to: 4, voice: "Một hai ba bốn năm.", visual: "cảnh một", onScreen: "MỘT" },
  { from: 4, to: 8, voice: "Sáu bảy tám chín mười.", visual: "cảnh hai", onScreen: "" },
  { from: 8, to: 11, voice: "Kết thúc nhé.", visual: "cảnh ba", onScreen: "" },
];

describe("fitCuts — đoạn AI chọn luôn nằm trong video thật và vừa độ dài cần", () => {
  it("kẹp vào giới hạn video, bỏ chỉ số video lạ, chia độ dài cần theo tỉ lệ", () => {
    const r = fitCuts([{ src: 9, start: -5, end: 3 }, { src: 1, start: 4, end: 99 }], 6, SOURCES);
    expect(r[0]).toMatchObject({ src: 0, start: 0, end: 3 }); // video 9 không có → video 0
    expect(r[1]).toMatchObject({ src: 1, start: 4, end: 10 });
    expect(r.reduce((a, c) => a + c.target, 0)).toBeCloseTo(6, 2);
    expect(r.every((c) => c.end - c.start >= 0.5)).toBe(true);
  });
  it("đoạn gốc ngắn hơn cần → kéo dài đoạn cuối nếu video còn phim", () => {
    const [c] = fitCuts([{ src: 0, start: 1, end: 3 }], 5, SOURCES);
    expect(c.end).toBeGreaterThan(5.9); // 1 + 5 giây
    expect(c.target).toBeCloseTo(5, 2);
  });
});

describe("phụ đề từng từ", () => {
  it("gán mốc cho đúng chữ của lời (không phải chữ whisper nghe), liền mạch và không chồng", () => {
    const heard = [{ w: "mot", s: 0.1, e: 0.4 }, { w: "hai", s: 0.5, e: 0.8 }, { w: "ba", s: 1.0, e: 1.4 }];
    const w = alignWords("Một hai ba", heard, 10, 2);
    expect(w.map((x) => x.text)).toEqual(["Một", "hai", "ba"]);
    expect(w[0].t0).toBeCloseTo(10.1, 2);
    for (let i = 0; i < w.length - 1; i++) expect(w[i].t1).toBeLessThanOrEqual(w[i + 1].t0 + 1e-6);
    expect(w.every((x) => x.t1 - x.t0 >= 0.08)).toBe(true);
  });
  it("whisper không nghe được gì → chia theo độ dài chữ trong khoảng thời gian của lời", () => {
    const w = alignWords("xin chào các bạn", [], 5, 2);
    expect(w[0].t0).toBeCloseTo(5, 2);
    expect(w.at(-1)!.t1).toBeLessThanOrEqual(7.2);
  });
  it("nhóm cụm ≤ 5 chữ, ngắt ở dấu câu", () => {
    const words = "một hai ba, bốn năm sáu bảy tám chín mười".split(" ").map((text, i) => ({ text, t0: i * 0.3, t1: i * 0.3 + 0.28 }));
    const chunks = chunkCaptions(words);
    expect(chunks.every((c) => c.words.length <= 5)).toBe(true);
    expect(chunks[0].words.map((x) => x.text)).toEqual(["một", "hai", "ba,"]);
    expect(chunks.flatMap((c) => c.words).length).toBe(words.length);
  });
});

describe("resolveEditPlan — mốc thời gian cho bộ dựng", () => {
  const plan: EditPlan = {
    hook: "Hook ngắn", cta: "Nhắn tin ngay",
    scenes: [
      { scriptIndex: 0, cuts: [{ src: 0, start: 0, end: 6 }], zoom: "in", onScreen: "MỘT" },
      { scriptIndex: 1, cuts: [{ src: 1, start: 0, end: 5 }, { src: 0, start: 6, end: 10 }], transition: "slideleft", sfx: ["whoosh", "pop"] },
      { scriptIndex: 2, cuts: [{ src: 0, start: 12, end: 18 }], transition: "circleopen" },
    ],
  };
  const voices = [3.2, 3.9, 1.5].map((duration, i) => ({ text: SCRIPT[i].voice, file: `C:/v${i}.mp3`, duration, heard: [] }));
  const r = resolveEditPlan({ mode: "voiceover", style: "dynamic", aspect: "9:16", sources: SOURCES, plan, voices, music: null });

  it("mỗi cảnh dài theo lời đọc, cảnh sau bắt đầu đúng chỗ cảnh trước kết thúc", () => {
    expect(r.scenes[0].start).toBe(0);
    for (let i = 0; i < 2; i++) expect(r.scenes[i + 1].start).toBeCloseTo(r.scenes[i].start + r.scenes[i].content, 2);
    expect(r.scenes[0].content).toBeCloseTo(3.2 + 0.12 + 0.32, 2);
    expect(r.total).toBeCloseTo(r.scenes.reduce((a, s) => a + s.content, 0), 2);
  });
  it("đoạn dựng dài hơn nội dung đúng bằng thời gian chuyển cảnh vào; tổng đoạn cắt = độ dài đoạn", () => {
    expect(r.scenes[0].trans).toBeNull();
    for (const s of r.scenes.slice(1)) {
      expect(s.segLen).toBeCloseTo(s.content + s.trans.dur, 2);
      expect(s.cuts.reduce((a: number, c: any) => a + c.target, 0)).toBeCloseTo(s.segLen, 2);
    }
    expect(r.scenes[1].trans).toMatchObject({ type: "slideleft", dur: 0.35 });
  });
  it("giọng đọc đặt sau khi chuyển cảnh xong; hook / CTA nằm trong video; chữ màn hình theo cảnh", () => {
    expect(r.scenes[1].audio).toMatchObject({ voice: "C:/v1.mp3" });
    expect(r.scenes[1].audio.voiceAt).toBeCloseTo(r.scenes[1].start + 0.12, 2);
    expect(r.hook).toMatchObject({ text: "Hook ngắn", t0: 0.2 });
    expect(r.cta!.t1).toBeCloseTo(r.total, 2);
    expect(r.cta!.t0).toBeLessThan(r.total);
    expect(r.scenes[0].onScreen).toBe("MỘT");
  });
  it("phong cách năng động tự thêm whoosh khi chuyển cảnh; hiệu ứng AI chọn được đặt đúng chỗ", () => {
    expect(r.scenes[2].sfx.map((x: any) => x.type)).toContain("whoosh");
    const whoosh = r.scenes[1].sfx.find((x: any) => x.type === "whoosh");
    expect(whoosh.at).toBeCloseTo(-0.35, 2);
    expect(r.scenes[1].sfx.some((x: any) => x.type === "pop")).toBe(true);
  });
  it("khung hình theo tỉ lệ", () => {
    expect(r).toMatchObject({ width: 1080, height: 1920 });
    expect(resolveEditPlan({ mode: "voiceover", style: "clean", aspect: "16:9", sources: SOURCES, plan, voices }).width).toBe(1920);
  });
  it("video thô không có tiếng → không dùng tiếng gốc (tránh lỗi ghép âm thanh)", () => {
    const p: EditPlan = { scenes: [{ cuts: [{ src: 0, start: 0, end: 3 }] }] };
    const s = resolveEditPlan({ mode: "speech", style: "dynamic", aspect: "9:16", sources: [src(0, 10, false)], plan: p, speech: [[]] });
    expect(s.scenes[0].audio).toEqual({});
  });
  it("chế độ lời người nói: cắt thẳng, giữ tiếng gốc làm giọng, phụ đề theo mốc whisper", () => {
    const talk = src(0, 30, true);
    const speech = [[{ w: "xin", s: 1.0, e: 1.3 }, { w: "chào", s: 1.35, e: 1.8 }, { w: "các", s: 2.0, e: 2.2 }, { w: "bạn", s: 2.25, e: 2.7 }]];
    const p: EditPlan = { scenes: [{ cuts: [{ src: 0, start: 0.9, end: 3 }], caption: "Xin chào các bạn" }, { cuts: [{ src: 0, start: 10, end: 14 }] }] };
    const s = resolveEditPlan({ mode: "speech", style: "dynamic", aspect: "9:16", sources: [talk], plan: p, speech });
    expect(s.scenes[1].trans).toMatchObject({ type: "fade", dur: 0.06 }); // cắt thẳng, không hiệu ứng chuyển
    expect(s.scenes[0].audio).toMatchObject({ source: true, sourceIsVoice: true, sourceVolume: 1 });
    expect(s.scenes[0].sfx).toEqual([]);
    expect(s.total).toBeCloseTo(2.1 + 4, 2);
    const words = s.captions.flatMap((c: any) => c.words);
    expect(words.map((w: any) => w.text)).toEqual(["Xin", "chào", "các", "bạn"]);
    expect(words[0].t0).toBeCloseTo(0.1, 1); // 1.0 − 0.9 mốc bắt đầu cắt
  });
});

describe("kế hoạch AI được làm sạch trước khi dựng", () => {
  it("lời đọc luôn là NGUYÊN VĂN kịch bản, đủ số cảnh, AI trả thiếu thì tự bù", () => {
    const ai: EditPlan = { scenes: [{ scriptIndex: 1, voice: "AI tự sửa lời!", cuts: [{ src: 0, start: 0, end: 3 }], onScreen: "HAI" }] };
    const p = sanitizePlan(ai, { mode: "voiceover", script: SCRIPT, sources: SOURCES });
    expect(p.scenes.map((s) => s.voice)).toEqual(SCRIPT.map((s) => s.voice));
    expect(p.scenes[1].onScreen).toBe("HAI");
    expect(p.scenes[0].onScreen).toBe("MỘT"); // chữ màn hình theo kịch bản khi AI không nêu
    expect(p.scenes.every((s) => s.cuts.length >= 1)).toBe(true);
  });
  it("kế hoạch tự động dùng các phân cảnh thật, đủ số cảnh kịch bản", () => {
    const p = autoPlan({ mode: "voiceover", sources: SOURCES, script: SCRIPT, durationSec: 30, title: "T" });
    expect(p.scenes).toHaveLength(3);
    expect(() => EditPlan.parse(p)).not.toThrow();
  });
  it("lời nhắc có bảng phân cảnh, lời kịch bản và cấm bịa", () => {
    const { system, user } = plannerPrompt({ mode: "voiceover", style: "dynamic", aspect: "9:16", title: "T", brief: "b", durationSec: 30, script: SCRIPT, sources: SOURCES, brand: "x" });
    expect(system).toMatch(/ĐÚNG 3 cảnh/); expect(system).toMatch(/không bịa/i); expect(system).toMatch(/Read/);
    expect(user).toContain("Video 0: 1080x1920, 20.0 giây"); expect(user).toContain("0.2 6.0-12.0".replace("0.2", "0.1"));
    expect(user).toContain("Một hai ba bốn năm.");
  });
});

// ---- Dựng thật bằng ffmpeg + Pillow (bỏ qua khi máy chưa cài công cụ video) ----
const haveTools = existsSync(toolsPython()) && (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const dir = mkdtempSync(join(tmpdir(), "taki-proedit-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
describe.skipIf(!haveTools)("pro_edit.py dựng thật", () => {
  it("dựng đủ độ dài kế hoạch (chuyển cảnh + chữ + âm thanh), không bị cắt cụt", () => {
    const a = join(dir, "a.mp4"), b = join(dir, "b.mp4");
    for (const [f, lavfi] of [[a, "testsrc2=s=640x360:r=30:d=6"], [b, "mandelbrot=s=360x640:r=30"]] as const) {
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", lavfi, "-f", "lavfi", "-i", "sine=f=300:d=6", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", f]);
    }
    const info = [src(0, 6, true), src(1, 6, true)].map((s, i) => ({ ...s, path: [a, b][i] }));
    const plan: EditPlan = { hook: "Xin chào", cta: "Gọi ngay", scenes: [
      { cuts: [{ src: 0, start: 0, end: 3 }], zoom: "in", onScreen: "Cảnh một" },
      { cuts: [{ src: 1, start: 0, end: 3 }], zoom: "punch", transition: "slideleft", sfx: ["whoosh", "pop"] },
      { cuts: [{ src: 0, start: 3, end: 6 }], zoom: "out", transition: "circleopen", sfx: ["ding"] },
    ] };
    const r = resolveEditPlan({ mode: "speech", style: "dynamic", aspect: "1:1", sources: info, plan, speech: [[], []], music: null });
    // thu nhỏ để chạy nhanh trong test
    const out = join(dir, "out.mp4");
    writeFileSync(join(dir, "plan.json"), JSON.stringify({ ...r, width: 360, height: 360, out, workdir: join(dir, "work") }));
    let res = "";
    try { res = execFileSync(toolsPython(), [join(TOOLS_DIR, "pro_edit.py"), "render", join(dir, "plan.json")], { encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } }); }
    catch (e: any) { throw new Error(`pro_edit.py: ${String(e.stdout ?? "").slice(-900)} ${String(e.stderr ?? "").slice(-400)}`); }
    const j = JSON.parse(res.trim().split("\n").at(-1)!);
    expect(j.ok).toBe(true);
    expect(j.duration).toBeGreaterThan(r.total - 0.4);
    expect(j.width).toBe(360);
    expect(j.hasAudio).toBe(true);
    const vd = Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", out], { encoding: "utf8" }).trim());
    expect(vd).toBeGreaterThan(r.total - 0.6);
  }, 180_000);
});
