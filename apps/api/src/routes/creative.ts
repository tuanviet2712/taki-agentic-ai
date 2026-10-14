import type { FastifyInstance } from "fastify";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { audit, bizSettings, byId, defaultBizId, q, update, type Row } from "@dotaka/db";
import {
  FLOW_TOOLS, FLOW_TOOL_URL_RE, FLOW_URL, UPLOAD_DIR, assertMediaInputPath, cancelVideoJob, connectFlowProfile, flowBrowserStatus, flowSettings, listChromeProfiles, openFlowLogin, openInProfile,
  profileAvatarPath, makeVideoFromScript, planVideoFromScript, scriptsAwaitingVideo, setStockKeys, setWindowState, startVideoJob, toolUrlFor, transcribe, videoAiFile, videoAiStatus, voiceOver, drivingPreset,
  claudeChromeProfiles, claudeChromePreflight, detectBrowsers, pairBrowser, flowEngine, manualPreview, readManualPlan, retryManualFinish,
  PLATFORM_RISK_RE, manualProjectUrl, openManualProject, resumeManualFlow, waitAndFinishManual,
} from "@dotaka/orchestrator";
import { AppError, uuidv7 } from "@dotaka/shared";
import { currentBizId, routes } from "../http.ts";

export function creativeRoutes(app: FastifyInstance) {
  const r = routes(app);

  // ---- Kịch bản đã duyệt → đúng skill tạo video (script-video.ts) ----
  r.get("/v1/video-scripts", ({ bizId }) => scriptsAwaitingVideo(bizId));
  r.get("/v1/content/:id/video-plan", ({ bizId, params }) => planVideoFromScript(bizId, params.id));
  // Làm thủ công trên Flow: xem trước cách chia cảnh 8 giây theo nhịp chữ/giây (chưa gọi AI, chưa tốn tín dụng).
  r.get("/v1/content/:id/flow-manual-preview", ({ bizId, params, query }) => manualPreview(bizId, params.id, (query as Row)?.model ? String((query as Row).model) : null));
  // Sếp tự chỉnh ranh giới cảnh: kiểm tra nguyên văn + trần chữ/cảnh theo model, trả lại cảnh + số giây.
  r.post("/v1/content/:id/flow-manual-preview", ({ bizId, params, body }) => {
    const p = z.object({ model: z.string().max(60).optional(), scenes: z.array(z.string().max(600)).max(24).optional() }).parse(body ?? {});
    return manualPreview(bizId, params.id, p.model ?? null, p.scenes ?? null);
  });
  // body (tuỳ chọn): { materials: [đường dẫn video thô đã tải lên], style, music } → dựng từ video thô của Sếp thay vì kho Pexels/Pixabay.
  r.post("/v1/content/:id/make-video", ({ bizId, params, body, actor }) => {
    const f = z.object({
      materials: z.array(z.string().min(1)).min(1).max(30).optional(), style: z.enum(["dynamic", "smooth", "clean"]).optional(), music: z.enum(["auto", "none"]).optional(),
    }).parse(body ?? {});
    return makeVideoFromScript(bizId, params.id, actor, undefined, f.materials ? { materials: f.materials.map((p) => assertMediaInputPath(p)), style: f.style, music: f.music } : undefined);
  });

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
    // data/uploads hoặc data/creative (đúng cả trên Windows: dấu \, khác hoa/thường) — không nhận tệp tùy ý trên máy.
    return transcribe(assertMediaInputPath(p.path), p.lang ?? "vi");
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

  r.get("/v1/creative/tools", ({ bizId }) => {
    const fs = flowSettings(bizId);
    return Object.entries(FLOW_TOOLS).map(([key, t]) => ({
      key, ...t,
      // Link Tool thực dùng (bản sao của Sếp nếu đã dán) + link mặc định để biết đang dùng bản nào.
      toolUrl: toolUrlFor(fs, key), defaultToolUrl: t.toolUrl,
      skillVersion: q.get<Row>("SELECT version FROM skill WHERE biz_id = ? AND key = ?", bizId, t.skill)?.version ?? null,
    }));
  });
  r.get("/v1/creative/settings", ({ bizId }) => flowSettings(bizId));
  r.put("/v1/creative/settings", ({ bizId, body, actor, req }) => {
    const p = z.object({
      engine: z.enum(["chrome-flow", "claude-in-chrome"]).optional(), chromeAutoApprove: z.boolean().optional(),
      browserDeviceId: z.string().nullable().optional(), browserLabel: z.string().nullable().optional(), timeoutMin: z.number().int().min(15).max(180).optional(),
      chromeChannel: z.string().nullable().optional(), chromeProfileDir: z.string().nullable().optional(), chromeProfileName: z.string().nullable().optional(), chromeProfileEmail: z.string().nullable().optional(),
      // Link Tool Flow bản sao theo từng công cụ ("" = quay về link mặc định).
      toolUrls: z.record(z.string(), z.union([z.literal(""), z.string().max(500).regex(FLOW_TOOL_URL_RE, "Link Tool Flow không hợp lệ — cần dạng https://flow.google.com/project/…/tool/…")])).optional(),
    }).parse(body);
    const old = flowSettings(bizId);
    if (p.engine !== undefined || p.chromeAutoApprove !== undefined) {
      if (req.headers["x-taki-actor"]) throw new AppError("FORBIDDEN", "Chỉ Sếp chọn cơ chế Chrome trên giao diện", 403);
      if (p.engine === "claude-in-chrome" && old.engine !== "claude-in-chrome" && p.chromeAutoApprove !== true) {
        throw new AppError("CHROME_CONSENT_REQUIRED", "Xác nhận cho phép AI thao tác trong profile Chrome đã chọn trước khi bật Claude in Chrome");
      }
      if (p.engine === "chrome-flow") p.chromeAutoApprove = false;
    }
    if (p.toolUrls) {
      const unknown = Object.keys(p.toolUrls).filter((k) => !(k in FLOW_TOOLS));
      if (unknown.length) throw new AppError("INVALID", `Không có công cụ ${unknown.join(", ")}`);
      const merged: Record<string, string> = { ...flowSettings(bizId).toolUrls };
      for (const [k, v] of Object.entries(p.toolUrls)) { if (v) merged[k] = v; else delete merged[k]; }
      p.toolUrls = merged;
    }
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
    if (flowEngine(bizId) === "claude-in-chrome") {
      if (!fs.chromeChannel || !fs.chromeProfileDir) throw new AppError("NO_BROWSER", "Chọn profile Chrome trước");
      openInProfile(fs.chromeChannel, fs.chromeProfileDir, FLOW_URL);
      return { ok: true };
    }
    await openFlowLogin({ channel: fs.chromeChannel, dir: fs.chromeProfileDir });
    return { ok: true };
  });
  r.post("/v1/creative/flow-browser/window", async ({ body }) => {
    const p = z.object({ state: z.enum(["parked", "normal"]) }).parse(body);
    await setWindowState(p.state);
    return { ok: true };
  });

  // ---- Chrome profiles: every profile on this machine; pick the one logged into Flow ----
  r.get("/v1/creative/chrome-profiles", () => {
    const extensionProfiles = claudeChromeProfiles();
    return { profiles: listChromeProfiles().map((p) => extensionProfiles.find((c) => c.channel === p.channel && c.dir === p.dir) ?? p), flowUrl: FLOW_URL };
  });
  r.post("/v1/creative/browsers", ({ bizId }) => detectBrowsers(bizId));
  r.post("/v1/creative/browsers/pair", ({ bizId, actor, req }) => {
    if (req.headers["x-taki-actor"]) throw new AppError("FORBIDDEN", "Chỉ Sếp ghép Chrome trên giao diện", 403);
    return pairBrowser(bizId, actor);
  });
  r.post("/v1/creative/chrome-profiles/open", ({ body, actor, bizId }) => {
    const p = z.object({ channel: z.string(), dir: z.string(), target: z.enum(["flow"]) }).parse(body);
    openInProfile(p.channel, p.dir, FLOW_URL);
    audit(bizId, actor, "creative.chrome_profile_opened", undefined, { dir: p.dir, target: p.target });
    return { ok: true };
  });
  r.post("/v1/creative/chrome-profiles/verify", async ({ bizId, body }) => {
    const p = z.object({ channel: z.string(), dir: z.string() }).parse(body);
    if (flowEngine(bizId) === "claude-in-chrome") {
      const fs = flowSettings(bizId);
      if (p.channel !== fs.chromeChannel || p.dir !== fs.chromeProfileDir) throw new AppError("BROWSER_NOT_SELECTED", "Hãy kiểm tra đúng profile Chrome đã chọn");
      const c = await claudeChromePreflight(bizId);
      return { found: true, accountEmail: fs.chromeProfileEmail ?? c.label, deviceId: c.deviceId };
    }
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
      // Làm thủ công trên Flow: concept + phân cảnh + prompt AI đã lập (để Sếp xem AI định làm gì).
      plan: FLOW_TOOLS[j.tool]?.manual ? readManualPlan(j.workdir) : null,
      // Flow chặn tạo video tự động: giao diện hướng dẫn Sếp bấm tạo trong dự án rồi để hệ thống tự chờ / tải / ghép.
      ...(FLOW_TOOLS[j.tool]?.manual ? { projectUrl: manualProjectUrl(j.workdir, (j.result as Row | null)?.notes), platformRisk: PLATFORM_RISK_RE.test(`${j.error ?? ""} ${(j.result as Row | null)?.notes ?? ""}`), waiting: String(j.step ?? "").startsWith("Chờ Sếp bấm"), riskRetryAt: String(j.step ?? "").startsWith("Flow đang chặn") ? j.step : null } : {}),
    };
  });
  // Audit trail of the Claude in Chrome permission approver for this job (read-only; last 200 decisions, no typed text).
  r.get("/v1/creative/jobs/:id/chrome-log", ({ bizId, params }) => {
    const j = byId<Row>("creative_job", params.id);
    if (!j || j.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy job", 404);
    const file = j.workdir ? join(String(j.workdir), "approver.jsonl") : "";
    if (!file || !existsSync(file) || statSync(file).size > 8 * 1024 * 1024) return { entries: [] };
    const entries = readFileSync(file, "utf8").split(String.fromCharCode(10)).filter(Boolean).slice(-200).flatMap((line) => {
      try { const e = JSON.parse(line); return [{ at: String(e.at ?? ""), tool: String(e.tool ?? ""), decision: String(e.decision ?? ""), reason: String(e.reason ?? ""), host: e.host ? String(e.host) : undefined, note: e.note ? String(e.note).slice(0, 200) : undefined }]; } catch { return []; }
    });
    return { entries };
  });
  r.post("/v1/creative/jobs", ({ bizId, body, actor }) => startVideoJob(bizId, body, actor));
  r.post("/v1/creative/jobs/:id/cancel", ({ bizId, params, actor }) => cancelVideoJob(bizId, params.id, actor));
  // Làm thủ công trên Flow bị dừng: tải clip đã có trong dự án Flow rồi ghép (không tạo lại video, không tốn tín dụng).
  r.post("/v1/creative/jobs/:id/manual-finish", ({ bizId, params, actor }) => retryManualFinish(bizId, params.id, actor));
  r.post("/v1/creative/jobs/:id/manual-retry", ({ bizId, params, actor }) => resumeManualFlow(bizId, params.id, actor));
  r.post("/v1/creative/jobs/:id/manual-wait", ({ bizId, params, actor }) => waitAndFinishManual(bizId, params.id, actor));
  r.post("/v1/creative/jobs/:id/open-project", ({ bizId, params }) => openManualProject(bizId, params.id));

  // Image upload (base64 JSON keeps the stack dependency-free); files live in data/uploads.
  app.post("/v1/uploads", { bodyLimit: 90 * 1024 * 1024 }, async (req) => {
    const p = z.object({ name: z.string().min(1).max(200), data: z.string().min(10) }).parse(req.body);
    const safe = basename(p.name).replace(/[^\w.\-]+/g, "_").slice(-80);
    if (!/\.(png|jpe?g|webp|heic|mp4|mov|m4v|webm|mp3|wav|m4a|docx?|txt|md|json|rtf|html?|odt|pdf|csv)$/i.test(safe)) throw new AppError("BAD_TYPE", "Chỉ nhận ảnh (png/jpg/webp/heic), video (mp4/mov/webm), âm thanh (mp3/wav/m4a) hoặc tài liệu (docx/txt/md/json/rtf/html/pdf)");
    mkdirSync(UPLOAD_DIR, { recursive: true });
    const path = join(UPLOAD_DIR, `${uuidv7().slice(-12)}_${safe}`);
    writeFileSync(path, Buffer.from(p.data.replace(/^data:[^;]+;base64,/, ""), "base64"));
    audit(currentBizId(req), "CEO", "upload.file", undefined, { path });
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
    audit(currentBizId(req), "CEO", "upload.file", undefined, { path, size: statSync(path).size });
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
