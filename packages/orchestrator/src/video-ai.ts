import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { activeDna, byId, emit, insert, update, type Row } from "@dotaka/db";
import { effectiveProvider, generate } from "@dotaka/llm-gateway";
import { AppError, nowIso } from "@dotaka/shared";

/**
 * Local video AI next to Google Flow (installed by scripts/install-video-ai.mjs into services/video-ai, not in Git):
 *  - MoneyPrinterTurbo (MIT): script → stock / own clips + Vietnamese voice-over (Edge TTS) + subtitles → finished short.
 *    Driven through its CLI with OUR script (written by Claude CLI), so it never calls another LLM.
 *  - LivePortrait (MIT; face detection swapped from InsightFace to MediaPipe for commercial use): animate a portrait
 *    photo with the expressions of a driving video.
 *  - faster-whisper (MIT, tools/video/stt.py): transcripts + .srt subtitles.  - Edge TTS: Vietnamese voices.
 * Heavy jobs run one at a time (queue lock "video-ai") — the Mac has 8 GB RAM.
 */
export const VIDEO_AI_ROOT = resolve(process.env.VIDEO_AI_ROOT ?? "services/video-ai");
const MPT = join(VIDEO_AI_ROOT, "MoneyPrinterTurbo");
const LP = join(VIDEO_AI_ROOT, "LivePortrait");
/** Remotion project for the news-to-video skill (blank template + @remotion/media + @remotion/google-fonts). */
export const REMOTION_NEWS = join(VIDEO_AI_ROOT, "remotion-news");
export const NEWS_SKILL_DIR = resolve("assets/claude/skills/news-to-video");
const TOOLS = resolve("tools/video");
const OUT = resolve("data/creative/video-ai");
export const VI_VOICES = [
  { id: "vi-VN-HoaiMyNeural-Female", label: "Hoài My — nữ, miền Bắc" },
  { id: "vi-VN-NamMinhNeural-Male", label: "Nam Minh — nam, miền Bắc" },
];
const py = (dir: string) => join(dir, ".venv", "bin", "python");

// ---------------- Status & settings ----------------
const tomlPath = () => join(MPT, "config.toml");
function readKeys(name: string): string[] {
  try {
    const m = readFileSync(tomlPath(), "utf8").match(new RegExp(`^\\s*${name}\\s*=\\s*\\[([^\\]]*)\\]`, "m"));
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  } catch { return []; }
}
const mask = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "••••");
export function videoAiStatus() {
  const whisper = existsSync(py(TOOLS)) && existsSync(join(TOOLS, "stt.py"));
  const drivingDir = join(LP, "assets", "examples", "driving");
  const free = (() => { try { return Number(execFileSync("df", ["-k", resolve(".")], { encoding: "utf8" }).trim().split("\n").pop()!.split(/\s+/)[3]) * 1024; } catch { return null; } })();
  return {
    moneyprinter: { installed: existsSync(py(MPT)) && existsSync(join(MPT, "cli.py")), pexels: readKeys("pexels_api_keys").map(mask), pixabay: readKeys("pixabay_api_keys").map(mask) },
    liveportrait: {
      installed: existsSync(py(LP)) && existsSync(join(LP, "pretrained_weights", "liveportrait", "landmark.onnx")),
      mediapipe: existsSync(join(LP, "src", "utils", "face_analysis_mediapipe.py")) && existsSync(join(LP, "pretrained_weights", "mediapipe", "face_landmarker.task")),
      presets: existsSync(drivingDir) ? readdirSync(drivingDir).filter((f) => f.endsWith(".mp4")).sort((a, b) => a.localeCompare(b, "en", { numeric: true })) : [],
    },
    whisper: { installed: whisper },
    remotion: { installed: existsSync(join(REMOTION_NEWS, "node_modules", "@remotion", "cli")) && existsSync(join(REMOTION_NEWS, "node_modules", ".remotion", "chrome-headless-shell")) },
    tts: { installed: existsSync(join(MPT, ".venv", "bin", "edge-tts")), voices: VI_VOICES },
    fishSpeech: { installed: false, note: "Thay bằng Edge TTS: bản S2-Pro cần GPU/RAM lớn và giấy phép Fish Audio cấm dùng thương mại." },
    freeDiskGB: free ? Math.round(free / 1e9) : null,
  };
}
/** Stock-footage keys live only in MoneyPrinterTurbo's config.toml (gitignored) — entered by the CEO in the UI. */
export function setStockKeys(p: { pexels?: string[]; pixabay?: string[] }) {
  if (!existsSync(tomlPath())) throw new AppError("NOT_INSTALLED", "MoneyPrinterTurbo chưa cài (pnpm video-ai:install)");
  let t = readFileSync(tomlPath(), "utf8");
  const put = (name: string, keys: string[]) => {
    const line = `${name} = [${keys.map((k) => JSON.stringify(k.trim())).filter((k) => k !== '""').join(", ")}]`;
    t = new RegExp(`^\\s*${name}\\s*=`, "m").test(t) ? t.replace(new RegExp(`^\\s*${name}\\s*=\\s*\\[[^\\]]*\\]`, "m"), line) : `${line}\n${t}`;
  };
  if (p.pexels) put("pexels_api_keys", p.pexels);
  if (p.pixabay) put("pixabay_api_keys", p.pixabay);
  writeFileSync(tomlPath(), t, { mode: 0o600 });
  return videoAiStatus().moneyprinter;
}

/** System commands the Flow agent uses, pointing at THIS repo (prepended to its PATH). */
export function ensureVideoBins() {
  const dir = resolve("data/bin");
  mkdirSync(dir, { recursive: true });
  const w = (name: string, cmd: string) => { const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n# TAKI Agentic AI (${resolve(".")})\nexec ${cmd} "$@"\n`); chmodSync(p, 0o755); };
  w("taki-video-finish", `"${py(TOOLS)}" "${join(TOOLS, "finish.py")}"`);
  w("taki-video-stt", `"${py(TOOLS)}" "${join(TOOLS, "stt.py")}"`);
  w("taki-flow-save", `"${process.execPath}" "${resolve("packages/orchestrator/bin/flow-save.mjs")}"`);
  w("taki-flow-wait", `"${process.execPath}" "${resolve("packages/orchestrator/bin/flow-wait.mjs")}"`);
  const sh = (name: string, body: string) => { const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n# TAKI Agentic AI (${resolve(".")})\n${body}\n`); chmodSync(p, 0o755); };
  // Edge TTS sometimes answers "No audio was received" and succeeds on the next call: retry up to 3 times.
  if (existsSync(join(MPT, ".venv", "bin", "edge-tts"))) sh("taki-tts", `for i in 1 2 3; do "${join(MPT, ".venv", "bin", "edge-tts")}" "$@" && exit 0; echo "taki-tts: thử lại ($i)" >&2; sleep 2; done\nexit 1`);
  // news-to-video skill helpers (scripts ship inside the skill folder; taki-news-fetch = step 1 without ad-hoc parsing).
  w("taki-news-fetch", `"${process.execPath}" "${resolve("packages/orchestrator/bin/news-fetch.mjs")}"`);
  w("taki-news-transcribe", `"${py(TOOLS)}" "${join(NEWS_SKILL_DIR, "scripts", "transcribe.py")}"`);
  sh("taki-news-chunks", `# taki-news-chunks <sents.json> <exportName> <out.ts>\n[ $# -eq 3 ] || { echo "Dùng: taki-news-chunks <sents.json> <tênExport> <file.ts>" >&2; exit 2; }\n"${py(TOOLS)}" "${join(NEWS_SKILL_DIR, "scripts", "chunkgen.py")}" "$1" "$2" > "$3"`);
  // Vbee (paid voices) only when the CEO put credentials in ~/.vbee.env — the token never reaches the agent.
  sh("taki-vbee-tts", `if [ "$1" = "--check" ]; then [ -f "$HOME/.vbee.env" ] && echo "co cau hinh Vbee" && exit 0; echo "khong co ~/.vbee.env — dung taki-tts"; exit 1; fi\n[ -f "$HOME/.vbee.env" ] || { echo "Khong co ~/.vbee.env — dung taki-tts" >&2; exit 1; }\nset -a; . "$HOME/.vbee.env"; set +a\nexec "${py(TOOLS)}" "${join(NEWS_SKILL_DIR, "scripts", "vbee_tts.py")}" "$@"`);
  return dir;
}

// ---------------- Small tools: voice-over, transcript ----------------
function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; onLine?: (l: string) => void; signal?: AbortSignal; timeoutMs?: number } = {}) {
  return new Promise<{ code: number; out: string }>((res, rej) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let buf = "";
    const onData = (d: Buffer) => {
      out += d; buf += d;
      let nl;
      buf = buf.replace(/\r/g, "\n"); // tqdm progress bars redraw with \r
      while ((nl = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, nl).replace(/\x1b\[[0-9;]*m/g, "").trim(); buf = buf.slice(nl + 1); if (l) opts.onLine?.(l); }
      if (out.length > 400_000) out = out.slice(-200_000);
    };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    const kill = () => { try { child.kill("SIGTERM"); } catch { /* gone */ } };
    opts.signal?.addEventListener("abort", kill);
    const t = setTimeout(kill, opts.timeoutMs ?? 30 * 60_000);
    child.on("error", (e) => { clearTimeout(t); rej(e); });
    child.on("close", (code) => { clearTimeout(t); res({ code: code ?? 1, out }); });
  });
}
const durationOf = (f: string) => { try { return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim()) || 0; } catch { return 0; } };

export async function voiceOver(p: { text: string; voice?: string; rate?: number }) {
  const bin = join(MPT, ".venv", "bin", "edge-tts");
  if (!existsSync(bin)) throw new AppError("NOT_INSTALLED", "Chưa cài công cụ giọng đọc (pnpm video-ai:install)");
  const id = randomUUID().slice(0, 12);
  const dir = join(OUT, "voice");
  mkdirSync(dir, { recursive: true });
  const voice = (p.voice ?? VI_VOICES[0].id).replace(/-(Female|Male)$/, "");
  const rate = Math.round(((p.rate ?? 1) - 1) * 100);
  const mp3 = join(dir, `${id}.mp3`), srt = join(dir, `${id}.srt`);
  const r = await run(bin, ["--voice", voice, `--rate=${rate >= 0 ? "+" : ""}${rate}%`, "--text", p.text, "--write-media", mp3, "--write-subtitles", srt], { timeoutMs: 120_000 });
  if (r.code !== 0 || !existsSync(mp3)) throw new AppError("TTS_FAILED", `Không tạo được giọng đọc: ${r.out.slice(-300)}`);
  return { mp3: `voice/${id}.mp3`, srt: `voice/${id}.srt`, duration: durationOf(mp3), voice };
}
export async function transcribe(file: string, lang = "vi") {
  if (!existsSync(file)) throw new AppError("NO_FILE", "Không thấy tệp");
  const dir = join(OUT, "transcripts");
  const r = await run(py(TOOLS), [join(TOOLS, "stt.py"), file, `--lang=${lang}`, `--srt=${dir}`], { timeoutMs: 15 * 60_000 });
  const json = r.out.split("\n").reverse().find((l) => l.trim().startsWith("["));
  if (r.code !== 0 || !json) throw new AppError("STT_FAILED", `Không nhận dạng được lời thoại: ${r.out.slice(-300)}`);
  const res = JSON.parse(json)[0];
  return { ...res, srt: `transcripts/${basename(file, extname(file))}.srt` };
}
/** Files under data/creative/video-ai (voice-overs, transcripts) — safe path only. */
export function videoAiFile(rel: string) {
  const abs = resolve(OUT, rel);
  if (!abs.startsWith(OUT + sep) || !existsSync(abs)) throw new AppError("NOT_FOUND", "Không thấy tệp", 404);
  return abs;
}
export function drivingPreset(name: string) {
  const abs = resolve(LP, "assets", "examples", "driving", basename(name));
  if (!existsSync(abs)) throw new AppError("NOT_FOUND", "Không thấy video mẫu", 404);
  return abs;
}

// ---------------- Jobs ----------------
const Script = z.object({ script: z.string(), terms: z.array(z.string()).min(3).max(10), hook: z.string(), caption: z.string() });
async function writeScript(job: Row) {
  const input = job.input as Row;
  const o = (input.video ?? {}) as Row;
  const words = Math.round((input.durationSec ?? 30) * 3); // ~3 Vietnamese words per second of voice-over
  if (o.scriptReady && o.terms) return { script: input.brief, terms: String(o.terms).split(",").map((t: string) => t.trim()).filter(Boolean), hook: input.hookTitle ?? "", caption: "" };
  if (effectiveProvider(job.biz_id).provider === "sandbox") return { script: input.brief, terms: [input.product ?? input.title, "lifestyle", "business"].filter(Boolean), hook: input.hookTitle ?? "", caption: "" };
  const dna = input.brand === "taki" ? activeDna(job.biz_id)?.data as any : null;
  const r = await generate({
    bizId: job.biz_id, agentKey: "creative", tier: "medium", schema: Script,
    system: [
      "Bạn là biên kịch video ngắn (TikTok/Reels) tiếng Việt. Viết lời đọc (voice-over) tự nhiên, câu ngắn, có hook 3 giây đầu và kêu gọi hành động cuối.",
      "terms = 5-8 cụm từ khóa TIẾNG ANH ngắn (2-3 từ) để tìm cảnh quay stock phù hợp từng ý (vd: \"business meeting\", \"woman typing laptop\"). Không bịa số liệu.",
      dna ? `Thương hiệu: ${dna.company?.brand ?? ""}. Giọng: ${JSON.stringify(dna.voice ?? {})}. Claim bị cấm: ${(dna.forbiddenClaims ?? []).join("; ")}` : "Kênh khách hàng/affiliate: không nhắc thương hiệu TAKI.",
    ].join("\n"),
    user: `${o.scriptReady ? "KỊCH BẢN CÓ SẴN (giữ nguyên lời, chỉ đề xuất terms/hook/caption):" : `Viết lời đọc khoảng ${words} từ cho video:`}\nTiêu đề: ${input.title}\n${input.product ? `Sản phẩm: ${input.product}\n` : ""}Nội dung: ${input.brief}\n${input.cta ? `CTA: ${input.cta}\n` : ""}Trả JSON: script (lời đọc), terms, hook (tiêu đề ngắn), caption (≤300 ký tự, 3-5 hashtag).`,
    sandbox: () => ({ script: input.brief, terms: ["business", "office", "people"], hook: input.title, caption: "" }),
  });
  return o.scriptReady ? { ...r.output, script: input.brief } : r.output;
}

function materialsFor(job: Row): { source: string; materials: string[] } {
  const o = ((job.input as Row).video ?? {}) as Row;
  if (o.source === "flow" && o.flowJobId) {
    const f = byId<Row>("creative_job", o.flowJobId);
    const dir = f?.workdir ? join(f.workdir, "clips") : "";
    const clips = dir && existsSync(dir) ? readdirSync(dir).filter((x) => /\.(mp4|mov)$/i.test(x)).sort().map((x) => join(dir, x)) : [];
    if (!clips.length) throw new AppError("NO_CLIPS", "Video Flow đã chọn chưa có clip");
    return { source: "local", materials: clips };
  }
  if (o.source === "local") {
    const m = [...(o.materials ?? []), ...((job.input as Row).images ?? []).map((i: Row) => i.path)].filter((x: string) => existsSync(x));
    if (!m.length) throw new AppError("NO_MATERIALS", "Chưa có clip/ảnh để dựng (tải lên hoặc chọn nguồn khác)");
    return { source: "local", materials: m };
  }
  const src = o.source === "pixabay" ? "pixabay" : "pexels";
  if (!readKeys(`${src}_api_keys`).length) throw new AppError("NO_STOCK_KEY", `Chưa có khóa ${src === "pexels" ? "Pexels" : "Pixabay"} — nhập ở thẻ "Công cụ video AI" (miễn phí) hoặc chọn nguồn clip của Sếp`);
  return { source: src, materials: [] };
}

type JobCtx = { job: Row; log: (t: string, kind?: "text" | "tool") => void; signal: AbortSignal };
export async function runAutoVideo({ job, log, signal }: JobCtx) {
  if (!existsSync(py(MPT))) throw new AppError("NOT_INSTALLED", "MoneyPrinterTurbo chưa cài (pnpm video-ai:install)");
  const input = job.input as Row;
  const o = (input.video ?? {}) as Row;
  const { source, materials } = materialsFor(job);
  log(o.scriptReady ? "Dùng kịch bản có sẵn" : "Claude CLI đang viết lời đọc + từ khóa cảnh quay");
  const s = await writeScript(job);
  log(`Lời đọc ${s.script.split(/\s+/).length} từ · cảnh: ${s.terms.join(", ")}`);
  const taskId = randomUUID();
  const args = [
    "cli.py", "--video-script", s.script, "--video-subject", input.title, "--video-terms", s.terms.join(","), "--video-language", "vi-VN",
    "--video-source", source, ...(materials.length ? ["--video-materials", materials.join(",")] : []),
    "--video-aspect", o.aspect ?? "9:16", "--video-clip-duration", String(o.clipDuration ?? 4), "--video-count", "1",
    "--voice-name", o.voiceName ?? VI_VOICES[0].id, "--voice-rate", String(o.voiceRate ?? 1.0),
    "--bgm-type", o.bgm ?? "random", "--bgm-volume", "0.15", "--font-name", "BeVietnamPro-Bold.ttf", "--font-size", "64",
    "--subtitle-position", "bottom", "--stroke-width", "2", "--task-id", taskId,
  ];
  log(`MoneyPrinterTurbo dựng video (${source === "local" ? `${materials.length} clip/ảnh của Sếp` : `cảnh ${source}`}, giọng ${String(o.voiceName ?? VI_VOICES[0].id).split("-")[2]})`, "tool");
  const r = await run(py(MPT), args, { cwd: MPT, signal, timeoutMs: 40 * 60_000, onLine: (l) => { if (/\| (INFO|SUCCESS|ERROR)/.test(l) && !/^\s*$/.test(l)) log(l.replace(/^.*?\| (INFO|SUCCESS|ERROR)\s*\|\s*"[^"]*":\s*/, "").slice(0, 200), "tool"); } });
  const out = join(MPT, "storage", "tasks", taskId, "final-1.mp4");
  if (signal.aborted) throw new AppError("CANCELLED", "Đã hủy", 499);
  if (r.code !== 0 || !existsSync(out)) throw new AppError("MPT_FAILED", `MoneyPrinterTurbo lỗi: ${r.out.replace(/\x1b\[[0-9;]*m/g, "").slice(-500)}`);
  const final = join(job.workdir, "final.mp4");
  copyFileSync(out, final);
  const sentences: string[] = String(s.script).split(/(?<=[.!?…])\s+/).filter(Boolean);
  return {
    status: "done" as const, finalPath: final, durationSec: durationOf(final), scenes: sentences.length, redoneScenes: [],
    script: sentences.map((t, i) => ({ canh: i + 1, loi_thoai: t })), caption: s.caption || `${s.hook}`,
    notes: `Video tự động (MoneyPrinterTurbo, MIT): ${source === "local" ? `${materials.length} clip/ảnh của Sếp` : `cảnh stock ${source}`}, giọng Edge TTS, phụ đề tự động. Hook: ${s.hook}`,
  };
}

export async function runPortrait({ job, log, signal }: JobCtx) {
  if (!existsSync(py(LP))) throw new AppError("NOT_INSTALLED", "LivePortrait chưa cài (pnpm video-ai:install)");
  const input = job.input as Row;
  const o = (input.video ?? {}) as Row;
  const src = (input.images ?? [])[0]?.path;
  if (!src || !existsSync(src)) throw new AppError("NO_IMAGE", "Cần 1 ảnh chân dung rõ mặt");
  const fullDriving = o.drivingPath && existsSync(o.drivingPath) ? o.drivingPath : drivingPreset(o.driving ?? "d0.mp4");
  const outDir = join(job.workdir, "portrait");
  // M2 renders ~1 s of video per 30-40 s: animate only what is needed (voice-over length, else 6 s)
  let voice: Awaited<ReturnType<typeof voiceOver>> | null = null;
  if (o.voiceText) { log("Tạo giọng đọc Edge TTS", "tool"); voice = await voiceOver({ text: o.voiceText, voice: o.voiceName, rate: o.voiceRate }); }
  const want = Math.min(20, Math.max(3, Math.ceil(voice?.duration ?? o.seconds ?? 6)));
  const driving = join(job.workdir, `driving-${want}s.mp4`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-stream_loop", "-1", "-i", fullDriving, "-t", String(want), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", driving]);
  log(`LivePortrait (MediaPipe) làm ảnh cử động ${want} giây theo ${basename(fullDriving)} — GPU M2, khoảng ${Math.ceil(want * 0.6) + 1} phút`, "tool");
  let lastPct = -1;
  const r = await run(py(LP), ["inference.py", "-s", src, "-d", driving, "-o", outDir], {
    cwd: LP, signal, env: { PYTORCH_ENABLE_MPS_FALLBACK: "1" }, timeoutMs: 30 * 60_000,
    onLine: (l) => {
      const m = l.match(/(\d{1,3})%\|/);
      if (m && /Animating/i.test(l)) { const pct = Math.floor(Number(m[1]) / 20) * 20; if (pct !== lastPct) { lastPct = pct; log(`Đang làm ảnh cử động… ${m[1]}%`, "tool"); } return; }
      if (/Animated video:|No face|Error/.test(l)) log(l.slice(0, 200), "tool");
    },
  });
  if (signal.aborted) throw new AppError("CANCELLED", "Đã hủy", 499);
  const made = existsSync(outDir) ? readdirSync(outDir).find((f) => f.endsWith(".mp4") && !f.includes("_concat")) : null;
  if (r.code !== 0 || !made) throw new AppError("LP_FAILED", /No face/i.test(r.out) ? "Không thấy khuôn mặt trong ảnh — dùng ảnh chân dung chính diện, rõ mặt" : `LivePortrait lỗi: ${r.out.slice(-400)}`);
  let final = join(job.workdir, "final.mp4");
  copyFileSync(join(outDir, made), final);
  if (voice) {
    log("Lồng giọng đọc vào clip", "tool");
    const withVoice = join(job.workdir, "final-voice.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-stream_loop", "-1", "-i", final, "-i", join(OUT, voice.mp3), "-map", "0:v", "-map", "1:a", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", withVoice]);
    final = withVoice;
  }
  return { finalPath: final, durationSec: durationOf(final), driving: basename(fullDriving) };
}

/** Portrait clips are material (b-roll / intro), not posts: saved as an asset, no approval card. */
export function finishMaterialJob(jobId: string, res: { finalPath: string; durationSec: number; driving: string }) {
  const job = byId<Row>("creative_job", jobId)!;
  let meta: Row = {};
  try { meta = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", res.finalPath], { encoding: "utf8" })).streams?.[0] ?? {}; } catch { /* keep */ }
  const asset = insert("creative_asset", { biz_id: job.biz_id, job_id: jobId, kind: "video", path: res.finalPath, mime: "video/mp4", duration: res.durationSec, width: meta.width ?? null, height: meta.height ?? null, size: statSync(res.finalPath).size, meta: { tool: job.tool, driving: res.driving, material: true } });
  update("creative_job", jobId, { status: "done", step: "Đã xong — clip nằm trong thư viện video", asset_id: asset.id, ended_at: nowIso(), result: { status: "done", finalPath: res.finalPath, durationSec: res.durationSec, notes: `LivePortrait theo ${res.driving}` } });
  emit(job.biz_id, "creative.updated", { jobId, status: "done" });
  return asset;
}
