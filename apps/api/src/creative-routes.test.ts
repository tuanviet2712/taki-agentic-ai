import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, type Row } from "@dotaka/db";
import { FLOW_TOOLS } from "@dotaka/orchestrator";
import { errorHandler } from "./http.ts";
import { creativeRoutes } from "./routes/creative.ts";

/**
 * Sản xuất video (Flow): danh sách công cụ kèm link mặc định, đặt / xoá link Tool bản sao, và chỉ nhận tệp phiên âm trong
 * data/uploads | data/creative. DB :memory:, không chạy whisper / Chrome / Flow.
 */
let B: string, app: FastifyInstance;
const api = (method: "GET" | "PUT" | "POST", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { "x-biz-id": B } });

beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  creativeRoutes(app);
  await app.ready();
});
afterAll(async () => { await app.close(); closeDb(); });

describe("lựa chọn cơ chế Chrome", () => {
  it("mặc định Chrome Flow; cần xác nhận rõ ràng để bật Claude in Chrome", async () => {
    expect((await api("GET", "/v1/creative/settings")).json().engine).toBe("chrome-flow");
    const denied = await api("PUT", "/v1/creative/settings", { engine: "claude-in-chrome" });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().code).toBe("CHROME_CONSENT_REQUIRED");
    const enabled = await api("PUT", "/v1/creative/settings", { engine: "claude-in-chrome", chromeAutoApprove: true });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({ engine: "claude-in-chrome", chromeAutoApprove: true });
    const off = await api("PUT", "/v1/creative/settings", { engine: "chrome-flow" });
    expect(off.json()).toMatchObject({ engine: "chrome-flow", chromeAutoApprove: false });
  });
  it("agent không được tự bật cơ chế hay ghép Chrome", async () => {
    for (const [method, url, payload] of [["PUT", "/v1/creative/settings", { engine: "claude-in-chrome", chromeAutoApprove: true }], ["POST", "/v1/creative/browsers/pair", {}]] as const) {
      const r = await app.inject({ method, url, payload, headers: { "x-biz-id": B, "x-taki-actor": "agent" } });
      expect(r.statusCode).toBe(403);
    }
  });
});

describe("nhật ký quyền Chrome của tác vụ", () => {
  it("đọc approver.jsonl của đúng tác vụ, bỏ dòng hỏng, không lộ tệp khác", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-chrome-log-"));
    try {
      writeFileSync(join(dir, "approver.jsonl"), [JSON.stringify({ at: "2026-10-11T01:00:00Z", tool: "chrome.navigate", decision: "allow", reason: "ok", host: "flow.google.com" }), "không phải json", JSON.stringify({ at: "2026-10-11T01:00:05Z", tool: "chrome.file_upload", decision: "deny", reason: "tệp nhạy cảm (.env)" })].join(String.fromCharCode(10)));
      const job = insert("creative_job", { biz_id: B, tool: "nhan-hieu", title: "t", input: {}, status: "done", log: [], workdir: dir });
      const r = await api("GET", `/v1/creative/jobs/${job.id}/chrome-log`);
      expect(r.statusCode).toBe(200);
      expect(r.json().entries).toHaveLength(2);
      expect(r.json().entries[1]).toMatchObject({ decision: "deny", reason: "tệp nhạy cảm (.env)" });
      const other = insert("biz", { name: "Khác", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
      const denied = await app.inject({ method: "GET", url: `/v1/creative/jobs/${job.id}/chrome-log`, headers: { "x-biz-id": other } });
      expect(denied.statusCode).toBe(404);
      const none = insert("creative_job", { biz_id: B, tool: "nhan-hieu", title: "t2", input: {}, status: "done", log: [] });
      expect((await api("GET", `/v1/creative/jobs/${none.id}/chrome-log`)).json().entries).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("link Tool Flow bản sao", () => {
  const tool = async (key: string) => ((await api("GET", "/v1/creative/tools")).json() as Row[]).find((t) => t.key === key)!;

  it("GET /v1/creative/tools: toolUrl đang dùng + defaultToolUrl (link mặc định)", async () => {
    const list = (await api("GET", "/v1/creative/tools")).json() as Row[];
    expect(list.map((t) => t.key)).toEqual(Object.keys(FLOW_TOOLS));
    const nh = list.find((t) => t.key === "nhan-hieu")!;
    expect(nh.toolUrl).toBe(FLOW_TOOLS["nhan-hieu"].toolUrl);
    expect(nh.defaultToolUrl).toBe(FLOW_TOOLS["nhan-hieu"].toolUrl);
    expect(list.find((t) => t.key === "cinematic")).toMatchObject({ toolUrl: null, defaultToolUrl: null });
  });

  it("PUT settings: dán link bản sao → thay link mặc định; gửi \"\" → về link mặc định; công cụ khác giữ nguyên", async () => {
    const a = "https://flow.google.com/project/p1/tool/t1";
    const b = "https://flow.google.com/project/p2/tool/t2";
    expect((await api("PUT", "/v1/creative/settings", { toolUrls: { "nhan-hieu": a } })).statusCode).toBe(200);
    expect((await api("PUT", "/v1/creative/settings", { toolUrls: { "review-gia-dung": b } })).statusCode).toBe(200);
    expect(await tool("nhan-hieu")).toMatchObject({ toolUrl: a, defaultToolUrl: FLOW_TOOLS["nhan-hieu"].toolUrl });
    expect(await tool("review-gia-dung")).toMatchObject({ toolUrl: b });
    expect((await api("PUT", "/v1/creative/settings", { toolUrls: { "nhan-hieu": "" } })).statusCode).toBe(200);
    expect((await tool("nhan-hieu")).toolUrl).toBe(FLOW_TOOLS["nhan-hieu"].toolUrl);
    expect((await tool("review-gia-dung")).toolUrl).toBe(b);
    const settings = (await api("GET", "/v1/creative/settings")).json();
    expect(settings.toolUrls).toEqual({ "review-gia-dung": b });
  });

  it("PUT settings: link lạ hoặc công cụ không có → 400, không đổi gì", async () => {
    const before = (await api("GET", "/v1/creative/settings")).json().toolUrls;
    expect((await api("PUT", "/v1/creative/settings", { toolUrls: { "nhan-hieu": "https://evil.example/project/a/tool/b" } })).statusCode).toBe(400);
    expect((await api("PUT", "/v1/creative/settings", { toolUrls: { "khong-co": "https://flow.google.com/project/p/tool/t" } })).statusCode).toBe(400);
    expect((await api("GET", "/v1/creative/settings")).json().toolUrls).toEqual(before);
  });
});

describe("POST /v1/video-ai/transcribe", () => {
  it("tệp ngoài data/uploads | data/creative bị từ chối (cả đường dẫn kiểu Windows)", async () => {
    for (const path of [process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd", "../../package.json", "data/uploads/../../package.json"]) {
      const r = await api("POST", "/v1/video-ai/transcribe", { path });
      expect(r.statusCode, path).toBe(400);
      expect(r.json().code, path).toBe("PATH_NOT_ALLOWED");
    }
  });
});
