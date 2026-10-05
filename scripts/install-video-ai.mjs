#!/usr/bin/env node
// Cài bộ công cụ video AI chạy trên máy cho TAKI Agentic AI (idempotent — chạy lại an toàn):  pnpm video-ai:install
//   • MoneyPrinterTurbo (MIT)  — video tự động: kịch bản → cảnh (Pexels/Pixabay/clip của Sếp) + giọng đọc Edge TTS + phụ đề
//   • LivePortrait (MIT)       — ảnh chân dung cử động; TAKI thay dò mặt InsightFace (phi thương mại) bằng MediaPipe (Apache-2.0)
//   • faster-whisper (MIT)     — nhận dạng lời thoại / phụ đề (tools/video, cùng Pillow cho hậu kỳ)
//   • Remotion                 — video tin tức từ link bài báo (skill news-to-video): phụ đề karaoke, đồ hoạ động.
//                                LƯU Ý GIẤY PHÉP: miễn phí cho cá nhân / công ty ≤ 3 người; công ty lớn hơn cần Remotion Company License.
//   • fish-speech: KHÔNG cài — bản S2-Pro (4B) cần GPU/RAM lớn và giấy phép Fish Audio cấm dùng thương mại; dùng Edge TTS.
// Cờ: --skip-moneyprinter  --skip-liveportrait  --skip-whisper  --skip-remotion
// Mã nguồn tải về services/video-ai/ (không đưa lên Git); phiên bản khóa theo commit bên dưới để mọi máy giống nhau.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIR = join(ROOT, "services/video-ai");
const PATCHES = join(ROOT, "services/video-ai-patches");
const args = new Set(process.argv.slice(2));
const PINS = {
  MoneyPrinterTurbo: { repo: "https://github.com/harry0703/MoneyPrinterTurbo.git", commit: "2e1b30396e059e55939cc802c60faac2061e4d41" },
  LivePortrait: { repo: "https://github.com/KlingAIResearch/LivePortrait.git", commit: "9b294b3d0536135442ea73cb01e6cb3ca7029dd3" },
};
const LP_PKGS = ["torch==2.3.0", "torchvision==0.18.0", "onnxruntime==1.19.2", "mediapipe==0.10.14", "huggingface_hub>=0.25"];
const MP_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

const ok = (m) => console.log(`  ✓ ${m}`);
const step = (m) => console.log(`\n▶ ${m}`);
const has = (cmd, a = ["--version"]) => spawnSync(cmd, a, { stdio: "ignore" }).status === 0;
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: "inherit", ...opts });

console.log("TAKI Agentic AI — cài công cụ video AI\n");
for (const [cmd, how] of [["git", "xcode-select --install"], ["uv", "brew install uv  (hoặc curl -LsSf https://astral.sh/uv/install.sh | sh)"], ["ffmpeg", "brew install ffmpeg"]]) {
  if (!has(cmd, cmd === "ffmpeg" ? ["-version"] : ["--version"])) { console.error(`  ✗ Thiếu ${cmd}. Cài: ${how}`); process.exit(1); }
}
const freeGB = (() => { try { const s = statfsSync(ROOT); return (s.bavail * s.bsize) / 1e9; } catch { return 99; } })();
if (freeGB < 6) { console.error(`  ✗ Đĩa còn ${freeGB.toFixed(1)} GB — cần ít nhất 6 GB (PyTorch + trọng số ~3 GB).`); process.exit(1); }
mkdirSync(DIR, { recursive: true });

function checkout(name) {
  const { repo, commit } = PINS[name];
  const dest = join(DIR, name);
  if (!existsSync(join(dest, ".git"))) { mkdirSync(dest, { recursive: true }); run("git", ["init", "-q"], { cwd: dest }); run("git", ["remote", "add", "origin", repo], { cwd: dest }); }
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dest, encoding: "utf8" }).stdout?.trim();
  if (head !== commit) {
    run("git", ["fetch", "-q", "--depth", "1", "origin", commit], { cwd: dest });
    run("git", ["checkout", "-q", "--force", "FETCH_HEAD"], { cwd: dest });
  }
  ok(`${name} @ ${commit.slice(0, 7)}`);
  return dest;
}

if (!args.has("--skip-moneyprinter")) {
  step("MoneyPrinterTurbo (video tự động)");
  const d = checkout("MoneyPrinterTurbo");
  run("uv", ["sync", "--frozen", "--quiet"], { cwd: d, env: { ...process.env, UV_PYTHON: "3.11" } });
  if (!existsSync(join(d, "config.toml"))) copyFileSync(join(d, "config.example.toml"), join(d, "config.toml"));
  ok("Môi trường Python 3.11 + config.toml (nhập khóa Pexels/Pixabay trên trang Sản xuất video)");
}

if (!args.has("--skip-liveportrait")) {
  step("LivePortrait (ảnh chân dung cử động) — thay InsightFace bằng MediaPipe");
  const d = checkout("LivePortrait");
  if (!existsSync(join(d, ".venv"))) run("uv", ["venv", "-q", "--python", "3.11", ".venv"], { cwd: d });
  const reqs = execFileSync("grep", ["-v", "-E", "^gradio", "requirements_base.txt"], { cwd: d, encoding: "utf8" }).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("-"));
  run("uv", ["pip", "install", "-q", ...reqs, ...LP_PKGS], { cwd: d, env: { ...process.env, VIRTUAL_ENV: join(d, ".venv") } });
  ok("PyTorch 2.3 (GPU Apple MPS), MediaPipe, ONNX Runtime");
  if (!existsSync(join(d, "pretrained_weights/liveportrait/landmark.onnx"))) {
    run(join(d, ".venv/bin/hf"), ["download", "KlingTeam/LivePortrait", "--local-dir", "pretrained_weights", "--include", "liveportrait/*"], { cwd: d });
  }
  ok("Trọng số người (~640 MB; bỏ qua chế độ động vật & InsightFace)");
  const mp = join(d, "pretrained_weights/mediapipe/face_landmarker.task");
  if (!existsSync(mp)) { mkdirSync(join(d, "pretrained_weights/mediapipe"), { recursive: true }); run("curl", ["-sSL", "-o", mp, MP_MODEL]); }
  run(join(d, ".venv/bin/python"), [join(PATCHES, "liveportrait/apply.py"), d]);
  ok("Mô hình MediaPipe FaceLandmarker + bản vá TAKI");
}

if (!args.has("--skip-whisper")) {
  step("faster-whisper + Pillow (tools/video)");
  const v = join(ROOT, "tools/video/.venv");
  if (!existsSync(v)) run("uv", ["venv", "-q", "--python", "3.12", v]);
  run("uv", ["pip", "install", "-q", "-r", join(ROOT, "tools/video/requirements.txt"), "-r", join(ROOT, "tools/video/requirements-stt.txt")], { env: { ...process.env, VIRTUAL_ENV: v } });
  ok("faster-whisper 1.2.1 (giải mã âm thanh bằng ffmpeg) + Pillow");
}

if (!args.has("--skip-remotion")) {
  step("Remotion (video tin tức từ link bài báo — skill news-to-video)");
  const d = join(DIR, "remotion-news");
  if (!existsSync(join(d, "package.json"))) run("npx", ["--yes", "create-video@latest", "--yes", "--blank", "remotion-news"], { cwd: DIR });
  run("npm", ["i", "--no-audit", "--no-fund"], { cwd: d });
  if (!existsSync(join(d, "node_modules", "@remotion", "media"))) run("npx", ["--yes", "remotion", "add", "@remotion/media"], { cwd: d });
  if (!existsSync(join(d, "node_modules", "@remotion", "google-fonts"))) run("npx", ["--yes", "remotion", "add", "@remotion/google-fonts"], { cwd: d });
  run("npx", ["remotion", "browser", "ensure"], { cwd: d });
  ok("Project remotion-news + Chrome Headless Shell (cần Remotion Company License nếu công ty > 3 người)");
}

console.log("\n✅ Xong. Mở Agentic AI → Sản xuất video → chọn \"Video tự động\" hoặc \"Ảnh chân dung cử động\".");
