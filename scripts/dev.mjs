// Chạy API (8787) + giao diện (5173) cùng lúc: `pnpm dev`
// Nếu có services/zl-crm (đã cấu hình backend/.env) thì chạy kèm ZL-CRM: backend :3000 + giao diện :5174.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const kids = [];
const run = (name, cmd, args, opts = {}) => {
  const p = spawn(cmd, args, { stdio: opts.log ? ["ignore", "pipe", "pipe"] : "inherit", shell: process.platform === "win32", cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) } });
  if (opts.log) {
    const out = createWriteStream(opts.log, { flags: "a" });
    p.stdout.pipe(out);
    p.stderr.pipe(out);
  }
  p.on("exit", (code) => {
    console.log(`[${name}] thoát (${code})`);
    if (!opts.optional) shutdown(code ?? 0); // ZL-CRM dừng không kéo sập hệ thống chính
  });
  kids.push(p);
  return p;
};
const shutdown = (code = 0) => { for (const k of kids) k.kill(); process.exit(code); };

run("api", "pnpm", ["dev:api"]);
run("web", "pnpm", ["dev:web"]);

const zl = resolve("services/zl-crm");
if (existsSync(resolve(zl, "backend/.env")) && existsSync(resolve(zl, "backend/node_modules"))) {
  mkdirSync(resolve(zl, "data"), { recursive: true });
  // PostgreSQL riêng của ZL-CRM (cổng 5433) — máy dùng PostgreSQL hệ thống thì bỏ qua (không có data/pgdata)
  const pg = await (await import("./zlcrm-pg.mjs")).ensureZlcrmPostgres();
  if (pg.skipped) console.log(`  ! ${pg.skipped}`);
  // PORT/HOST xoá khỏi env kế thừa để ZL-CRM đọc đúng cổng 3000 trong backend/.env
  const env = { PORT: "", HOST: "" };
  run("zl-crm", "npx", ["tsx", "--env-file=.env", "src/app.ts"], { cwd: resolve(zl, "backend"), log: resolve(zl, "data/backend.log"), optional: true, env: { ...env, PORT: "3000", HOST: "127.0.0.1" } });
  run("zl-crm-web", "npx", ["vite", "--port", "5174", "--strictPort", "--host", "127.0.0.1"], { cwd: resolve(zl, "frontend"), log: resolve(zl, "data/frontend.log"), optional: true, env: { VITE_API_PROXY_TARGET: "http://127.0.0.1:3000", PORT: "" } });
  console.log("  👉 ZL-CRM (Zalo):   http://localhost:5174  (log: services/zl-crm/data/*.log)");
  // Máy mới: tự tạo API key ZL-CRM và nối vào Agentic AI khi cả hai đã chạy (bỏ qua nếu đã nối).
  import("./zlcrm-connect.mjs").then(({ connectZlcrm }) => connectZlcrm({ waitSeconds: 90 }))
    .then((r) => r?.connected && console.log("  ✓ Đã tự nối ZL-CRM vào Agentic AI"))
    .catch((e) => console.log(`  ! Chưa tự nối được ZL-CRM: ${e.message} — chạy lại: pnpm zlcrm:connect`));
}

for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => shutdown(0));
console.log("\n  👉 Mở giao diện: http://localhost:5173\n");
