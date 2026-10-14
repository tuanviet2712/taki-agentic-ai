// PostgreSQL riêng cho ZL-CRM: dữ liệu nằm trong services/zl-crm/data/pgdata, chạy ở cổng 5433 (không đụng PostgreSQL hệ thống).
// Dùng bởi `pnpm dev` (tự bật khi chưa chạy). Chạy tay:  node scripts/zlcrm-pg.mjs [start|stop|status]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PG_PORT = 5433;
const DATA = resolve("services/zl-crm/data/pgdata");
const LOG = resolve("services/zl-crm/data/postgres.log");

const listening = () => new Promise((ok) => {
  const s = createConnection({ host: "127.0.0.1", port: PG_PORT });
  s.once("connect", () => { s.destroy(); ok(true); });
  s.once("error", () => ok(false));
  s.setTimeout(1500, () => { s.destroy(); ok(false); });
});

/** pg_ctl của bản PostgreSQL cài trên máy (PG_CTL, PATH, hoặc thư mục cài mặc định). */
function pgCtl() {
  if (process.env.PG_CTL && existsSync(process.env.PG_CTL)) return process.env.PG_CTL;
  // Bản PostgreSQL đóng gói kèm gói cài Windows (runtime/pgsql) — máy mới không cần cài PostgreSQL.
  const bundled = resolve("runtime/pgsql/bin", process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
  if (existsSync(bundled)) return bundled;
  if (spawnSync("pg_ctl", ["--version"], { stdio: "ignore" }).status === 0) return "pg_ctl";
  const roots = process.platform === "win32"
    ? [process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "PostgreSQL")]
    : ["/usr/lib/postgresql", "/opt/homebrew/opt", "/usr/local/opt"];
  for (const root of roots.filter(Boolean)) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root).sort((a, b) => b.localeCompare(a, "en", { numeric: true }))) {
      const p = join(root, v, "bin", process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export const pgInitialised = () => existsSync(join(DATA, "PG_VERSION"));

export async function ensureZlcrmPostgres({ log = console.log } = {}) {
  if (!pgInitialised()) return { skipped: "chưa có dữ liệu PostgreSQL của ZL-CRM" };
  if (await listening()) return { running: true };
  const bin = pgCtl();
  if (!bin) return { skipped: "không tìm thấy pg_ctl — cài PostgreSQL hoặc đặt PG_CTL" };
  log("  ▶ Bật PostgreSQL của ZL-CRM (cổng 5433)");
  const args = ["-D", DATA, "-l", LOG, "-o", `-p ${PG_PORT} -c listen_addresses=127.0.0.1`, "-w", "-t", "60", "start"];
  if (process.platform === "win32") {
    // Cửa sổ console ẩn RIÊNG: Ctrl+C / đóng cửa sổ `pnpm dev` không kéo sập PostgreSQL (nếu không, nó nhận cùng tín hiệu và dừng).
    const q = (s) => `'${s.replace(/'/g, "''")}'`;
    const ps = `Start-Process -WindowStyle Hidden -FilePath ${q(bin)} -ArgumentList @(${args.map((a) => q(a.includes(" ") ? `"${a}"` : a)).join(",")})`;
    spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", windowsHide: true }).unref();
  } else {
    // detached + không dùng ống: pg_ctl để server sống tiếp sau khi lệnh thoát
    spawn(bin, args, { detached: true, stdio: "ignore" }).unref();
  }
  for (let i = 0; i < 70; i++) {
    if (await listening()) return { running: true };
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { skipped: `PostgreSQL của ZL-CRM chưa lên — xem ${LOG}` };
}

export function stopZlcrmPostgres() {
  const bin = pgCtl();
  if (!bin || !pgInitialised()) return;
  spawnSync(bin, ["-D", DATA, "-m", "fast", "-w", "stop"], { stdio: "inherit" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const cmd = process.argv[2] ?? "start";
  if (cmd === "stop") stopZlcrmPostgres();
  else if (cmd === "status") console.log((await listening()) ? "running" : "stopped");
  else console.log(JSON.stringify(await ensureZlcrmPostgres()));
}
