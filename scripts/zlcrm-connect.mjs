// Nối ZL-CRM local vào TAKI Agentic AI (tạo Public API key + kết nối "ZL-CRM local"). Không in bí mật ra màn hình.
// Tự chạy bởi `pnpm dev` khi chưa có kết nối; chạy tay: `pnpm zlcrm:connect`
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ZL = "http://127.0.0.1:3000";
const API = `http://127.0.0.1:${process.env.API_PORT || 8787}`;

function readEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) { // .env có thể là CRLF (Windows)
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return env;
}
async function call(url, body, headers = {}) {
  const r = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message ?? data.error ?? `HTTP ${r.status}`);
  return data;
}
const up = (url) => fetch(url, { signal: AbortSignal.timeout(3000) }).then(() => true, () => false);

export async function connectZlcrm({ quiet = false, waitSeconds = 0 } = {}) {
  const envFile = resolve("services/zl-crm/backend/.env");
  if (!existsSync(envFile)) return { skipped: "ZL-CRM chưa cài (chạy pnpm bootstrap)" };
  for (let i = 0; i <= waitSeconds && !((await up(`${ZL}/api/public/zalo-accounts`)) && (await up(`${API}/v1/system`))); i++) {
    if (i === waitSeconds) return { skipped: "ZL-CRM hoặc API chưa chạy" };
    await new Promise((r) => setTimeout(r, 1000));
  }
  const existing = await call(`${API}/v1/connections?platform=zlcrm`);
  if (existing.length) return { skipped: "Đã có kết nối ZL-CRM" };
  const env = readEnv(envFile);
  const { token } = await call(`${ZL}/api/v1/auth/login`, { identifier: env.BOOTSTRAP_ADMIN_PHONE, password: env.BOOTSTRAP_ADMIN_PASSWORD });
  const { key } = await call(`${ZL}/api/v1/settings/api-key/generate`, {}, { authorization: `Bearer ${token}` });
  const conn = await call(`${API}/v1/connections`, { platform: "zlcrm", mode: "live", name: "ZL-CRM local (TAKI)", credentials: { api_key: key }, config: { base_url: "http://localhost:3000", web_url: "http://localhost:5174" } });
  if (!quiet) console.log(`✓ Đã nối ZL-CRM vào Agentic AI (${conn.display_name})`);
  return { connected: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  connectZlcrm({ waitSeconds: 5 }).then((r) => r.skipped && console.log(`• ${r.skipped}`)).catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
