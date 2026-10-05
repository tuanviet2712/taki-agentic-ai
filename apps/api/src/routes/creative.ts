import type { FastifyInstance } from "fastify";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { audit, bizSettings, byId, defaultBizId, q, update, type Row } from "@dotaka/db";
import {
  FLOW_TOOLS, FLOW_URL, UPLOAD_DIR, cancelVideoJob, connectFlowProfile, flowBrowserStatus, flowSettings, listChromeProfiles, openFlowLogin, openInProfile,
  profileAvatarPath, makeVideoFromScript, planVideoFromScript, scriptsAwaitingVideo, setStockKeys, setWindowState, startVideoJob, toolUrlFor, transcribe, videoAiFile, videoAiStatus, voiceOver, drivingPreset,
} from "@dotaka/orchestrator";
import { AppError, uuidv7 } from "@dotaka/shared";
import { routes } from "../http.ts";

export function creativeRoutes(app: FastifyInstance) {
  const r = routes(app);

  // ---- Kịch bản đã duyệt → đúng skill tạo video (script-video.ts) ----
  r.get("/v1/video-scripts", ({ bizId }) => scriptsAwaitingVideo(bizId));
  r.get("/v1/content/:id/video-plan", ({ bizId, params }) => planVideoFromScript(bizId, params.id));
  r.post("/v1/content/:id/make-video", ({ bizId, params, actor }) => makeVideoFromScript(bizId, params.id, actor));

  // ---- Local video AI (MoneyPrinterTurbo, LivePortrait, faster-whisper, Edge TTS) ----
  r.get("/v1/video-ai/status", () => videoAiStatus());
  r.put("/v1/video-ai/stock-keys", (c) => {
    if (c.req.headers["x-taki-actor"]) throw new AppError("FORBIDDEN", "Chỉ Sếp nhập khóa trên giao diện", 403);
    const p = z.object({ pexels: z.string().max(200).optional(), pixabay: z.string().max(200).optional() }).parse(c.body);
    const split = (v?: string) => (v === undefined ? undefined : v.split(/[\s,]+/).filter(Boolean));
    const out = setStockKeys({ pexels: split(p.pexels), pixabay: split(p.pixabay) });
    audit(c.bizId, c.actor, "video_ai.stock_keys_changed", undefined, { pexels: out.pexels.length, pixabay: out.pixabay.length });
    return out;
  });
  r.post("/v1/video-ai/tts", async ({ body }) => {
    const p = z.object({ text: z.string().min(1).max(5000), voice: z.string().max(60).optional(), rate: z.number().min(0.6).max(1.6).optional() }).parse(body);
    return voiceOver(p);
  });
  r.post("/v1/video-ai/transcribe", async ({ body }) => {
    const p = z.object({ path: z.string().min(3), lang: z.string().max(8).optional() }).parse(body);
    if (!p.path.startsWith(UPLOAD_DIR) && !p.path.includes("/data/creative/")) throw new AppError("FORBIDDEN", "Chỉ nhận tệp đã tải lên hệ thống");
    return transcribe(p.path, p.lang ?? "vi");
  });
  app.get("/v1/video-ai/file", async (req, reply) => {
    const abs = videoAiFile(String((req.query as Row).path ?? ""));
    reply.type(abs.endsWith(".mp3") ? "audio/mpeg" : abs.endsWith(".srt") ? "text/plain; charset=utf-8" : "application/octet-stream");
    if ((req.query as Row).download) reply.header("content-disposition", `attachment; filename="${basename(abs)}"`);
    return reply.send(createReadStream(abs));
  });
  app.get("/v1/video-ai/driving/:name", async (req, reply) => {
    reply.type("video/mp4").header("cache-control", "max-age=3600");
    return reply.send(createReadStream(drivingPreset(String((req.params as Row).name))));
  });

  r.get("/v1/creative/tools", ({ bizId }) => Object.entries(FLOW_TOOLS).map(([key, t]) => ({
    key, ...t, toolUrl: toolUrlFor(flowSettings(bizId), key), skillVersion: q.get<Row>("SELECT version FROM skill WHERE biz_id = ? AND key = ?", bizId, t.skill)?.version ?? null,
  })));
  r.get("/v1/creative/settings", ({ bizId }) => flowSettings(bizId));
  r.put("/v1/creative/settings", ({ bizId, body, actor }) => {
    const p = z.object({
      browserDeviceId: z.string().nullable().optional(), browserLabel: z.string().nullable().optional(), timeoutMin: z.number().int().min(15).max(180).optional(),
      chromeChannel: z.string().nullable().optional(), chromeProfileDir: z.string().nullable().optional(), chromeProfileName: z.string().nullable().optional(), chromeProfileEmail: z.string().nullable().optional(),
      toolUrls: z.record(z.string(), z.string().regex(/^https:\/\/(flow\.google\.com|labs\.google)\/.+\/tool\/[\w-]+/, "Link Tool Flow không hợp lệ")).optional(),
    }).parse(body);
    // Picking a new profile forgets the old device mapping (re-learned by "Kiểm tra kết nối" or the first run).
    if (p.chromeProfileDir !== undefined && p.browserDeviceId === undefined) { p.browserDeviceId = null; p.browserLabel = null; }
    const s = bizSettings(bizId) as any;
    const flow = { ...flowSettings(bizId), ...p };
    update("biz", bizId, { settings: { ...s, flow } });
    audit(bizId, actor, "creative.settings_changed", { type: "biz", id: bizId }, flow);
    return flow;
  });
  // ---- Chrome Flow: the dedicated Chrome the agent drives (Playwright) ----
  r.get("/v1/creative/flow-browser", () => flowBrowserStatus());
  r.post("/v1/creative/flow-browser/login", async ({ bizId }) => {
    const fs = flowSettings(bizId);
    await openFlowLogin({ channel: fs.chromeChannel, dir: fs.chromeProfileDir });
    return { ok: true };
  });
  r.post("/v1/creative/flow-browser/window", async ({ body }) => {
    const p = z.object({ state: z.enum(["parked", "normal"]) }).parse(body);
    await setWindowState(p.state);
    return { ok: true };
  });

  // ---- Chrome profiles: every profile on this machine; pick the one logged into Flow ----
  r.get("/v1/creative/chrome-profiles", () => ({ profiles: listChromeProfiles(), flowUrl: FLOW_URL }));
  r.post("/v1/creative/chrome-profiles/open", ({ body, actor, bizId }) => {
    const p = z.object({ channel: z.string(), dir: z.string(), target: z.enum(["flow"]) }).parse(body);
    openInProfile(p.channel, p.dir, FLOW_URL);
    audit(bizId, actor, "creative.chrome_profile_opened", undefined, { dir: p.dir, target: p.target });
    return { ok: true };
  });
  r.post("/v1/creative/chrome-profiles/verify", ({ bizId, body }) => {
    const p = z.object({ channel: z.string(), dir: z.string() }).parse(body);
    return connectFlowProfile(bizId, p.channel, p.dir);
  });
  app.get("/v1/creative/chrome-profiles/avatar", async (req, reply) => {
    const { channel, dir } = req.query as Row;
    const file = profileAvatarPath(String(channel ?? ""), String(dir ?? ""));
    if (!file) return reply.status(404).send({ code: "NOT_FOUND", message: "Không có ảnh" });
    reply.type("image/png").header("cache-control", "max-age=3600");
    return reply.send(createReadStream(file));
  });
  r.get("/v1/creative/jobs", ({ bizId }) => q.all("SELECT id, tool, title, status, step, error, asset_id, content_item_id, model, cost_micros, started_at, ended_at, created_at FROM creative_job WHERE biz_id = ? ORDER BY created_at DESC LIMIT 50", bizId));
  r.get("/v1/creative/jobs/:id", ({ bizId, params }) => {
    const j = byId<Row>("creative_job", params.id);
    if (!j || j.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy job", 404);
    return {
      ...j, asset: j.asset_id ? byId("creative_asset", j.asset_id) : null,
      content: j.content_item_id ? byId("content_item", j.content_item_id) : null,
      drafts: j.content_item_id ? q.all("SELECT p.id, p.status, p.draft_url, p.error, p.simulated, c.platform, c.name FROM publish_job p JOIN channel c ON c.id = p.channel_id WHERE p.content_item_id = ? AND p.mode = 'draft'", j.content_item_id) : [],
      approval: q.get("SELECT id, status FROM approval WHERE subject_type = 'creative_job' AND subject_id = ? ORDER BY created_at DESC LIMIT 1", j.id),
    };
  });
  r.post("/v1/creative/jobs", ({ bizId, body, actor }) => startVideoJob(bizId, body, actor));
  r.post("/v1/creative/jobs/:id/cancel", ({ bizId, params, actor }) => cancelVideoJob(bizId, params.id, actor));

  // Image upload (base64 JSON keeps the stack dependency-free); files live in data/uploads.
  app.post("/v1/uploads", { bodyLimit: 90 * 1024 * 1024 }, async (req) => {
    const p = z.object({ name: z.string().min(1).max(200), data: z.string().min(10) }).parse(req.body);
    const safe = basename(p.name).replace(/[^\w.\-]+/g, "_").slice(-80);
    if (!/\.(png|jpe?g|webp|heic|mp4|mov|m4v|webm|mp3|wav|m4a|docx?|txt|md|json|rtf|html?|odt|pdf|csv)$/i.test(safe)) throw new AppError("BAD_TYPE", "Chỉ nhận ảnh (png/jpg/webp/heic), video (mp4/mov/webm), âm thanh (mp3/wav/m4a) hoặc tài liệu (docx/txt/md/json/rtf/html/pdf)");
    mkdirSync(UPLOAD_DIR, { recursive: true });
    const path = join(UPLOAD_DIR, `${uuidv7().slice(-12)}_${safe}`);
    writeFileSync(path, Buffer.from(p.data.replace(/^data:[^;]+;base64,/, ""), "base64"));
    audit(defaultBizId(), "CEO", "upload.file", undefined, { path });
    return { path, size: statSync(path).size };
  });

  // Large raw footage (AI tự edit từ video gốc): raw binary body streamed straight to disk — no base64, up to 4 GB.
  app.addContentTypeParser("application/octet-stream", (_req, payload, done) => done(null, payload));
  app.put("/v1/uploads/stream", { bodyLimit: 4 * 1024 * 1024 * 1024 }, async (req) => {
    const name = String((req.query as Row).name ?? "");
    const safe = basename(name).replace(/[^\w.\-]+/g, "_").slice(-80);
    if (!/\.(mp4|mov|m4v|webm|mkv|avi|mp3|m4a|wav)$/i.test(safe)) throw new AppError("BAD_TYPE", "Chỉ nhận video (mp4/mov/m4v/webm/mkv/avi) hoặc âm thanh (mp3/m4a/wav)");
    mkdirSync(UPLOAD_DIR, { recursive: true });
    const path = join(UPLOAD_DIR, `${uuidv7().slice(-12)}_${safe}`);
    await pipeline(req.body as NodeJS.ReadableStream, createWriteStream(path));
    audit(defaultBizId(), "CEO", "upload.file", undefined, { path, size: statSync(path).size });
    return { path, size: statSync(path).size };
  });

  // Video streaming with HTTP Range so the <video> player can seek.
  app.get("/v1/media/:id", async (req, reply) => {
    const a = byId<Row>("creative_asset", (req.params as Row).id);
    if (!a || !existsSync(a.path)) return reply.status(404).send({ code: "NOT_FOUND", message: "Không thấy tệp" });
    const size = statSync(a.path).size;
    const range = req.headers.range;
    reply.header("accept-ranges", "bytes").type(a.mime);
    if ((req.query as Row).download) reply.header("content-disposition", `attachment; filename="${basename(a.path)}"`);
    if (range) {
      const [s, e] = range.replace("bytes=", "").split("-");
      const start = Number(s);
      const end = e ? Number(e) : size - 1;
      reply.status(206).header("content-range", `bytes ${start}-${end}/${size}`).header("content-length", end - start + 1);
      return reply.send(createReadStream(a.path, { start, end }));
    }
    reply.header("content-length", size);
    return reply.send(createReadStream(a.path));
  });
}
