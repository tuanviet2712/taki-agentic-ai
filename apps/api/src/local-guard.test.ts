import { hostname } from "node:os";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb } from "@dotaka/db";
import { errorHandler } from "./http.ts";
import { allowedHost, registerLocalGuard } from "./local-guard.ts";
import { registerApiRoutes } from "./register-routes.ts";

/**
 * Lớp chặn Host lạ (DNS rebinding / vô tình tunnel cổng chính) + ghi chéo trang — KHÔNG được làm hỏng cách dùng hiện có:
 * giao diện web (localhost:5173 / 8787), MCP & Telegram (127.0.0.1), mạng nội bộ (IP / tên máy), webhook có chữ ký.
 */
let app: FastifyInstance;
beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } });
  app = Fastify({ logger: false });
  await app.register(cors, { origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });
  app.setErrorHandler(errorHandler);
  registerLocalGuard(app);
  registerApiRoutes(app); // đúng thứ tự như server.ts
  await app.ready();
});
afterAll(async () => { await app.close(); closeDb(); delete process.env.ALLOWED_HOSTS; });
const get = (host: string, url = "/v1/orders") => app.inject({ method: "GET", url, headers: { host } });

describe("Host", () => {
  it("cách dùng hiện có vẫn chạy: localhost, 127.0.0.1, [::1], IP mạng nội bộ, tên máy, có/không cổng", async () => {
    for (const h of ["localhost:5173", "localhost:8787", "127.0.0.1:8787", "127.0.0.1", "[::1]:8787", "192.168.1.20:8787", "10.0.0.5", `${hostname().toLowerCase()}:8787`, "app.localhost:8787", "DESKTOP-ABC:5173", "may-lan.local:8787"]) {
      expect((await get(h)).statusCode, h).toBe(200);
    }
  });
  it("tên miền lạ (rebinding / tunnel vào 8787) → 421; ALLOWED_HOSTS cho phép tên miền riêng", async () => {
    for (const h of ["evil.example.com", "abc.trycloudflare.com:443", "localhost.evil.com", "127.0.0.1.nip.io:8787", "evil.com:80:90"]) {
      const r = await get(h);
      expect(r.statusCode, h).toBe(421);
      expect(r.json().code).toBe("BAD_HOST");
    }
    expect(allowedHost("nas.taki.vn", ["nas.taki.vn"])).toBe(true);
    process.env.ALLOWED_HOSTS = "app.taki.vn, nas.taki.vn";
    expect((await get("nas.taki.vn:8787")).statusCode).toBe(200);
    delete process.env.ALLOWED_HOSTS;
    expect((await get("nas.taki.vn:8787")).statusCode).toBe(421);
  });
  it("/hooks/* (server → server, có chữ ký) và /healthz không bị chặn theo Host", async () => {
    const r = await app.inject({ method: "POST", url: "/hooks/meta", headers: { host: "abc.trycloudflare.com" }, payload: {} });
    expect(r.statusCode).not.toBe(421);
  });
});

describe("ghi chéo trang", () => {
  const post = (headers: Record<string, string>) => app.inject({ method: "POST", url: "/v1/settings/noop", headers: { host: "localhost:8787", ...headers }, payload: {} });
  it("web / MCP / công cụ cục bộ (không Origin hoặc Origin localhost) ghi bình thường", async () => {
    for (const h of [{} as Record<string, string>, { origin: "http://localhost:5173" }, { origin: "http://127.0.0.1:8787" }, { origin: "http://localhost:8787", "sec-fetch-site": "same-origin" }, { "sec-fetch-site": "same-site" }]) {
      expect((await post(h)).statusCode, JSON.stringify(h)).toBe(404); // tới được router (route không tồn tại) — không bị chặn
    }
  });
  it("trang web khác (Origin lạ / cross-site / null) ghi vào API → 403", async () => {
    for (const h of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { origin: "null" }, { origin: "http://localhost.evil.com" }] as Record<string, string>[]) {
      const r = await post(h);
      expect(r.statusCode, JSON.stringify(h)).toBe(403);
      expect(r.json().code).toBe("CROSS_SITE");
    }
  });
  it("đọc (GET) từ trang khác không bị lớp này chặn (CORS vẫn là hàng rào của trình duyệt)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/orders", headers: { host: "localhost:8787", origin: "https://evil.example" } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
