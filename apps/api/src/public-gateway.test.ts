import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { publicGatewayState, setPublicGateway, signMediaToken, trackedUrlFor, trackingBase } from "@dotaka/orchestrator";
import { buildPublicApp, startPublicGateway } from "./public-gateway.ts";
import { PUBLIC_ROUTES, throttled } from "./routes/public.ts";

/**
 * CỔNG CÔNG KHAI (instance riêng): chỉ /r/:code, /m/:token, callback OAuth, /healthz. Mọi thứ khác 404 — API chính không bao giờ
 * lộ ra cổng này. Chỉ khởi động khi đặt PUBLIC_PORT.
 */
let app: FastifyInstance, B: string, tmp: string, code: string, assetId: string, draftAssetId: string;
const UA = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17) AppleWebKit Mobile Safari" };

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  tmp = mkdtempSync(join(tmpdir(), "taki-pub-"));
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  const post = insert("post", { biz_id: B, channel_id: "c1", external_id: "e1", kind: "image", title: "Bài", body: "b", published_at: new Date().toISOString(), ad_status: "none" });
  trackedUrlFor({ bizId: B, url: "https://shopee.vn/sua-x", postId: post.id, channel: "facebook" });
  code = q.get<Row>("SELECT code FROM track_link LIMIT 1")!.code;
  const file = join(tmp, "v.mp4");
  writeFileSync(file, Buffer.from("0123456789".repeat(10)));
  const approved = insert("creative_asset", { biz_id: B, kind: "video", path: file, mime: "video/mp4", size: 100 });
  insert("content_item", { biz_id: B, agent_key: "content", kind: "video", channel: "instagram", title: "V", body: "b", status: "approved", asset_id: approved.id });
  assetId = approved.id;
  const draft = insert("creative_asset", { biz_id: B, kind: "video", path: file, mime: "video/mp4", size: 100 });
  insert("content_item", { biz_id: B, agent_key: "content", kind: "video", channel: "instagram", title: "V2", body: "b", status: "awaiting_approval", asset_id: draft.id });
  draftAssetId = draft.id;
  app = await buildPublicApp();
});
afterAll(async () => { await app.close(); closeDb(); rmSync(tmp, { recursive: true, force: true }); });

describe("cổng công khai: chỉ đúng những đường dẫn cho phép", () => {
  it("đúng 4 route GET + 2 route email (webhook Resend, hủy nhận), không /v1/* nào khác, không static", () => {
    for (const [m, u] of [["GET", "/healthz"], ["GET", "/r/:code"], ["GET", "/m/:token"], ["GET", "/v1/oauth/:provider/callback"], ["POST", "/hooks/email/resend"], ["GET", "/u/:token"], ["POST", "/u/:token"]] as const) expect(app.hasRoute({ method: m, url: u })).toBe(true);
    expect(PUBLIC_ROUTES).toHaveLength(6);
    const tree = app.printRoutes({ commonPrefix: false });
    for (const forbidden of ["approvals", "settings", "connections", "dna", "uploads", "media", "assistant", "hooks/:platform", "hooks/meta", "stream", "oauth/:provider/app", "oauth/:provider/start"]) {
      expect(tree, forbidden).not.toMatch(new RegExp(`/v1/${forbidden}|/${forbidden}\\b`));
    }
    expect(app.hasRoute({ method: "POST", url: "/v1/oauth/:provider/start" })).toBe(false);
    expect(app.hasRoute({ method: "PUT", url: "/v1/oauth/:provider/app" })).toBe(false);
  });

  it("mọi đường dẫn khác → 404 chữ thuần (không JSON, không giao diện)", async () => {
    for (const [method, url] of [["GET", "/"], ["GET", "/v1/approvals"], ["GET", "/v1/dna"], ["GET", "/v1/media/abc"], ["POST", "/hooks/meta"], ["GET", "/v1/stream"], ["PUT", "/v1/settings"], ["GET", "/index.html"], ["GET", "/v1/oauth"]] as const) {
      const r = await app.inject({ method, url });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(r.body).toBe("Not found");
    }
    expect((await app.inject({ method: "GET", url: "/healthz" })).json()).toEqual({ ok: true });
  });
});

describe("/r/:code", () => {
  it("302 sang link sản phẩm + UTM, không cache; mã lạ / sai định dạng → 404; bot được chuyển hướng nhưng không tính", async () => {
    const r = await app.inject({ method: "GET", url: `/r/${code}`, headers: { ...UA, "cf-connecting-ip": "203.0.113.50" } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toMatch(/^https:\/\/shopee\.vn\/sua-x\?utm_source=facebook&utm_medium=social/);
    expect(r.headers.location).toContain(`sub_id=${code}`);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    const before = q.scalar<number>("SELECT COUNT(*) FROM track_click WHERE is_bot = 0");
    const bot = await app.inject({ method: "GET", url: `/r/${code}`, headers: { "user-agent": "facebookexternalhit/1.1", "cf-connecting-ip": "198.51.100.1" } });
    expect(bot.statusCode).toBe(302);
    expect(q.scalar<number>("SELECT COUNT(*) FROM track_click WHERE is_bot = 0")).toBe(before);
    expect((await app.inject({ method: "GET", url: "/r/khongco1" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/r/..%2F..%2Fetc" })).statusCode).toBe(404);
    expect(JSON.stringify(q.all("SELECT * FROM track_click"))).not.toContain("203.0.113.50"); // IP thô không được lưu
  });

  it("giới hạn 120 yêu cầu / phút / IP", () => {
    const key = "r:test-ip";
    let blocked = 0;
    for (let i = 0; i < 125; i++) if (throttled(key, 1_000_000)) blocked++;
    expect(blocked).toBe(5);
    expect(throttled(key, 1_000_000 + 61_000)).toBe(false); // sang phút mới
  });
});

describe("/m/:token (media ký sẵn)", () => {
  it("token hợp lệ + nội dung đã duyệt → tệp (hỗ trợ Range); chưa duyệt / sai chữ ký / hết hạn / rác → 404", async () => {
    const ok = await app.inject({ method: "GET", url: `/m/${signMediaToken(assetId)}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("video/mp4");
    expect(ok.headers["x-robots-tag"]).toBe("noindex");
    expect(ok.body).toHaveLength(100);
    const part = await app.inject({ method: "GET", url: `/m/${signMediaToken(assetId)}`, headers: { range: "bytes=10-19" } });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe("bytes 10-19/100");
    expect(part.body).toBe("0123456789");
    const t = signMediaToken(assetId);
    for (const bad of [signMediaToken(draftAssetId), `${t.slice(0, -2)}xx`, signMediaToken(assetId, -1000), "rác", `${t}.extra`, signMediaToken("khong-co-asset")]) {
      expect((await app.inject({ method: "GET", url: `/m/${bad}` })).statusCode, bad).toBe(404);
    }
  });
});

describe("callback OAuth", () => {
  it("chỉ chuyển hướng (302), không phản chiếu code / lỗi vào nội dung; nền tảng lạ → 404", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/oauth/facebook/callback?code=SECRETCODE&state=khong-co" });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toMatch(/oauth_error=/);
    expect(String(r.headers.location)).not.toContain("SECRETCODE");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body).toBe("");
    expect((await app.inject({ method: "GET", url: "/v1/oauth/zalo/callback?code=x" })).statusCode).toBe(404);
  });
});

describe("khởi động cổng", () => {
  it("không đặt PUBLIC_PORT → không có cổng nào (mặc định không đổi hành vi)", async () => {
    setPublicGateway({ listening: false });
    expect(await startPublicGateway({} as NodeJS.ProcessEnv, 8787)).toBeNull();
    expect(await startPublicGateway({ PUBLIC_PORT: "  " } as NodeJS.ProcessEnv, 8787)).toBeNull();
    expect(publicGatewayState().listening).toBe(false);
  });
  it("PUBLIC_PORT sai / trùng API_PORT → từ chối (không chạy chung cổng với API chính)", async () => {
    expect(await startPublicGateway({ PUBLIC_PORT: "abc" } as NodeJS.ProcessEnv, 8787)).toBeNull();
    expect(await startPublicGateway({ PUBLIC_PORT: "8787" } as NodeJS.ProcessEnv, 8787)).toBeNull();
    expect(publicGatewayState().listening).toBe(false);
  });
  it("đặt PUBLIC_PORT (cổng tạm) → lắng nghe 127.0.0.1, /healthz thật + /r/ thật; trackingBase dùng được khi có PUBLIC_BASE_URL ổn định", async () => {
    const pub = await startPublicGateway({ PUBLIC_PORT: "0" } as NodeJS.ProcessEnv, 8787);
    expect(pub).not.toBeNull();
    try {
      const port = (pub!.server.address() as { port: number }).port;
      expect(publicGatewayState()).toMatchObject({ listening: true, port });
      const h = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(await h.json()).toEqual({ ok: true });
      expect((await fetch(`http://127.0.0.1:${port}/v1/approvals`)).status).toBe(404);
      const r = await fetch(`http://127.0.0.1:${port}/r/${code}`, { redirect: "manual", headers: UA });
      expect(r.status).toBe(302);
      process.env.PUBLIC_BASE_URL = "https://link.taki.vn";
      expect(trackingBase()).toBe("https://link.taki.vn");
    } finally {
      delete process.env.PUBLIC_BASE_URL;
      await pub!.close();
      setPublicGateway({ listening: false });
    }
  });
});
