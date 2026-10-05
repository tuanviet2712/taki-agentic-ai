#!/usr/bin/env node
// Cài TAKI Agentic AI trên máy mới — chạy 1 lần sau khi clone:  node scripts/bootstrap.mjs   (hoặc: pnpm bootstrap)
// Idempotent: chạy lại an toàn, không ghi đè .env / database / skill đã có.
//   --no-zlcrm         bỏ qua cài ZL-CRM (Zalo)
//   --no-video         bỏ qua công cụ hậu kỳ video Flow (Python) + video AI
//   --no-video-ai      bỏ qua công cụ video AI (MoneyPrinterTurbo, LivePortrait) — nặng ~3 GB
//   --no-skills-home   không chép skill vào ~/.claude (chỉ dùng bản trong repo)
//   --force-skills     ghi đè skill trong ~/.claude bằng bản trong repo
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = new Set(process.argv.slice(2));
const hex = (n) => randomBytes(n).toString("hex");
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const step = (m) => console.log(`\n▶ ${m}`);
const has = (cmd, a = ["--version"]) => spawnSync(cmd, a, { stdio: "ignore", shell: platform() === "win32" }).status === 0;
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: "inherit", cwd: ROOT, shell: platform() === "win32", ...opts });
const out = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: "utf8", cwd: ROOT, shell: platform() === "win32", ...opts }).trim();
const notes = [];

console.log("TAKI Agentic AI — cài đặt máy mới\n");

// 1) Runtime -------------------------------------------------------------------------------------
step("Kiểm tra môi trường");
const [major] = process.versions.node.split(".").map(Number);
if (major < 24) { console.error(`  ✗ Cần Node.js 24 trở lên (đang có ${process.versions.node}). Cài: https://nodejs.org hoặc nvm install 24`); process.exit(1); }
ok(`Node.js ${process.versions.node}`);
const pnpmWanted = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).packageManager?.split("@")[1];
if (!has("pnpm", ["-v"])) {
  warn("Chưa có pnpm — bật qua corepack");
  try { run("corepack", ["enable"]); run("corepack", ["prepare", `pnpm@${pnpmWanted}`, "--activate"]); } catch { console.error("  ✗ Không bật được pnpm. Chạy: npm i -g pnpm@" + pnpmWanted); process.exit(1); }
}
ok(`pnpm ${out("pnpm", ["-v"])}${pnpmWanted ? ` (repo khoá ${pnpmWanted})` : ""}`);
if (has("claude")) ok(`Claude Code CLI ${out("claude", ["--version"]).split("\n")[0]}`);
else { warn("Chưa có Claude Code CLI — agent sẽ chạy chế độ sandbox. Cài: npm i -g @anthropic-ai/claude-code rồi chạy `claude` để đăng nhập."); notes.push("Cài và đăng nhập Claude Code CLI (lệnh `claude`)."); }

// 2) Packages (lockfile khoá phiên bản → giao diện/chức năng giống hệt) -------------------------------
step("Cài thư viện (theo pnpm-lock.yaml, không nâng phiên bản)");
run("pnpm", ["install", "--frozen-lockfile"]);
ok("Đã cài thư viện hệ thống");

// 3) .env ------------------------------------------------------------------------------------------
step("Cấu hình .env");
const envPath = join(ROOT, ".env");
if (!existsSync(envPath)) {
  let env = readFileSync(join(ROOT, ".env.example"), "utf8");
  env = env.replace(/^TOKEN_ENCRYPTION_KEY=.*$/m, `TOKEN_ENCRYPTION_KEY=${hex(32)}`).replace(/^WEBHOOK_SECRET=.*$/m, `WEBHOOK_SECRET=${hex(24)}`);
  // --new-business: cài cho doanh nghiệp khác (DNA trống / DNA_FILE), không mang DNA + cấu hình của TAKI.
  if (!/^SEED_MODE=/m.test(env)) env += args.has("--new-business")
    ? "\n# Lần chạy đầu: fresh = doanh nghiệp mới, DNA trống (Nạp DNA trong giao diện) — DNA_FILE=đường/dẫn/dna.json để nạp sẵn\nSEED_MODE=fresh\n"
    : "\n# Lần chạy đầu: blank = DNA + skill + cấu hình TAKI, không có dữ liệu mẫu (cài cho doanh nghiệp khác: SEED_MODE=fresh)\nSEED_MODE=blank\n";
  writeFileSync(envPath, env, { mode: 0o600 });
  ok("Tạo .env (khóa mã hóa token sinh ngẫu nhiên cho máy này)");
  notes.push("Điền TYPESAFE_API_KEY vào .env nếu muốn Jev chạy thật (để trống = heuristic).");
} else ok(".env đã có — giữ nguyên");
mkdirSync(join(ROOT, "data"), { recursive: true });

// 4) Skills → ~/.claude (Claude CLI dùng khi chạy video Flow; hệ thống đọc bản trong repo) ----------------
if (!args.has("--no-skills-home")) {
  step("Cài skill Phòng Marketing vào ~/.claude");
  const src = join(ROOT, "assets/claude");
  let copied = 0, kept = 0;
  for (const kind of ["skills", "agents"]) {
    const dst = join(homedir(), ".claude", kind);
    mkdirSync(dst, { recursive: true });
    for (const n of readdirSync(join(src, kind))) {
      const target = join(dst, n);
      if (existsSync(target) && !args.has("--force-skills")) { kept++; continue; }
      cpSync(join(src, kind, n), target, { recursive: true });
      copied++;
    }
  }
  ok(`Chép ${copied} mục${kept ? `, giữ nguyên ${kept} mục đã có (dùng --force-skills để ghi đè)` : ""}`);
}

// 5) Video post-production (Flow) --------------------------------------------------------------------
if (!args.has("--no-video")) {
  step("Công cụ hậu kỳ video (Python + ffmpeg)");
  const py = ["python3", "python"].find((p) => has(p));
  if (!has("ffmpeg", ["-version"])) { warn("Chưa có ffmpeg (macOS: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg)"); notes.push("Cài ffmpeg để ghép video Flow."); }
  if (!py) { warn("Chưa có Python 3 — bỏ qua. Cài Python 3.11+ rồi chạy lại bootstrap."); notes.push("Cài Python 3 để dùng hậu kỳ video."); }
  else {
    const venv = join(ROOT, "tools/video/.venv");
    const vpy = join(venv, platform() === "win32" ? "Scripts/python.exe" : "bin/python");
    if (!existsSync(vpy)) run(py, ["-m", "venv", venv]);
    run(vpy, ["-m", "pip", "install", "-q", "-r", join(ROOT, "tools/video/requirements.txt")]);
    ok("Pillow (phụ đề, font Be Vietnam Pro đóng gói sẵn)");
    try { run(vpy, ["-m", "pip", "install", "-q", "-r", join(ROOT, "tools/video/requirements-stt.txt")]); ok("faster-whisper (soát lời thoại)"); }
    catch { warn("Không cài được faster-whisper — bước soát lời thoại sẽ bị bỏ qua"); }
    if (platform() !== "win32") {
      const bin = join(homedir(), ".local/bin");
      mkdirSync(bin, { recursive: true });
      for (const [name, file, desc] of [["taki-video-finish", "finish.py", "post-production for Google Flow clips"], ["taki-video-stt", "stt.py", "transcribe Flow clips"]]) {
        const p = join(bin, name);
        writeFileSync(p, `#!/bin/sh\n# TAKI Agentic AI: ${desc}.\nexec "${vpy}" "${join(ROOT, "tools/video", file)}" "$@"\n`);
        chmodSync(p, 0o755);
      }
      writeFileSync(join(bin, "taki-flow-save"), `#!/bin/sh\n# TAKI Agentic AI: save Flow Tool clips from Chrome Flow.\nexec "${process.execPath}" "${join(ROOT, "packages/orchestrator/bin/flow-save.mjs")}" "$@"\n`);
      chmodSync(join(bin, "taki-flow-save"), 0o755);
      ok(`Lệnh taki-video-finish / taki-video-stt / taki-flow-save trong ${bin}`);
      if (!(process.env.PATH ?? "").split(":").includes(bin)) notes.push(`Thêm ${bin} vào PATH (vd: echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc).`);
    }
  }
}

// 5b) Công cụ video AI chạy trên máy (MoneyPrinterTurbo, LivePortrait + MediaPipe, faster-whisper) -------------------
if (!args.has("--no-video") && !args.has("--no-video-ai")) {
  step("Công cụ video AI (video tự động, ảnh cử động) — có thể mất 10-20 phút lần đầu");
  if (!has("uv")) { warn("Chưa có uv — bỏ qua. Cài: brew install uv rồi chạy: pnpm video-ai:install"); notes.push("Cài công cụ video AI: brew install uv && pnpm video-ai:install"); }
  else {
    try { run("node", ["scripts/install-video-ai.mjs"]); ok("Video AI sẵn sàng"); }
    catch { warn("Cài video AI chưa xong — chạy lại: pnpm video-ai:install"); notes.push("Chạy lại: pnpm video-ai:install"); }
  }
}

// 6) ZL-CRM (Zalo nhiều nick) — PostgreSQL local, không cần Docker ----------------------------------------
if (!args.has("--no-zlcrm")) {
  step("ZL-CRM (Zalo) — services/zl-crm");
  const zl = join(ROOT, "services/zl-crm");
  const benv = join(zl, "backend/.env");
  if (!has("psql") || !has("createdb")) {
    warn("Chưa có PostgreSQL — bỏ qua ZL-CRM. macOS: brew install postgresql@17 && brew services start postgresql@17 · Ubuntu: sudo apt install postgresql");
    notes.push("Cài PostgreSQL rồi chạy lại `pnpm bootstrap` để bật ZL-CRM.");
  } else {
    const psql = (sql) => out("psql", ["-d", "postgres", "-tAc", sql]);
    try {
      if (!existsSync(benv)) {
        const pw = hex(16);
        if (psql("SELECT 1 FROM pg_roles WHERE rolname='zlcrm'") === "1") psql(`ALTER ROLE zlcrm WITH LOGIN PASSWORD '${pw}'`);
        else psql(`CREATE ROLE zlcrm LOGIN PASSWORD '${pw}' CREATEDB`);
        if (psql("SELECT 1 FROM pg_database WHERE datname='zalocrm'") !== "1") run("createdb", ["-O", "zlcrm", "zalocrm"]);
        const tpl = readFileSync(join(zl, "backend/.env.taki.example"), "utf8");
        writeFileSync(benv, tpl
          .replace("__JWT_SECRET__", hex(32)).replace("__ENCRYPTION_KEY__", hex(32))
          .replace("__DB_PASSWORD__", pw).replace("__ADMIN_PASSWORD__", randomBytes(9).toString("base64url")), { mode: 0o600 });
        ok("Tạo database zalocrm + backend/.env (mật khẩu sinh ngẫu nhiên)");
        notes.push(`Đăng nhập ZL-CRM bằng BOOTSTRAP_ADMIN_PHONE / BOOTSTRAP_ADMIN_PASSWORD trong services/zl-crm/backend/.env, rồi quét QR nick Zalo.`);
      } else ok("backend/.env đã có — giữ nguyên");
      mkdirSync(join(zl, "data/files"), { recursive: true });
      run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: join(zl, "backend") });
      run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: join(zl, "frontend") });
      run("npx", ["prisma", "generate"], { cwd: join(zl, "backend") });
      run("npx", ["prisma", "db", "push"], { cwd: join(zl, "backend") });
      ok("ZL-CRM sẵn sàng — `pnpm dev` sẽ chạy kèm (giao diện http://localhost:5174) và tự nối vào Agentic AI");
    } catch (e) {
      warn(`Cài ZL-CRM chưa xong: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      notes.push("Linux: tạo role PostgreSQL cho user hiện tại (sudo -u postgres createuser -s $USER) rồi chạy lại bootstrap.");
    }
  }
}

// 7) Kiểm tra toàn vẹn ---------------------------------------------------------------------------------
step("Kiểm tra toàn vẹn (typecheck + test)");
try { run("pnpm", ["run", "typecheck"]); run("pnpm", ["run", "test"]); ok("Mã nguồn khớp phiên bản đã phát hành"); }
catch { warn("Kiểm tra chưa đạt — xem lỗi ở trên"); }

console.log("\n✅ Xong. Chạy hệ thống:  pnpm dev   →  http://localhost:5173");
if (notes.length) { console.log("\nViệc cần làm thêm:"); notes.forEach((n, i) => console.log(`  ${i + 1}. ${n}`)); }
