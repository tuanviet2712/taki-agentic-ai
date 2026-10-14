import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { bizSettings, byId, q, update, type Row } from "@dotaka/db";
import { AppError, logger } from "@dotaka/shared";
import type { Frame } from "./post-image.ts";

/**
 * Ảnh bằng Gemini (Nano Banana) trên Google Flow — chạy bằng mã (bin/flow-image.mjs) trong 1 tab riêng của Chrome Flow, không cần
 * AI điều khiển trình duyệt. Mọi ảnh bài viết nằm trong MỘT dự án Flow riêng (content.flowImageProject, tự tạo lần đầu).
 * Mỗi lần 1 ảnh (hàng đợi trong máy chủ); khi Chrome Flow đang dựng video thì báo bận để nơi gọi dùng công cụ dự phòng.
 */
export const FLOW_IMAGE_BIN = resolve("packages/orchestrator/bin/flow-image.mjs");
export const FLOW_IMAGE_MODELS = ["Nano Banana 2.1", "Nano Banana Pro", "Nano Banana 2 Lite"] as const;
const execFileAsync = promisify(execFile);
let chain: Promise<unknown> = Promise.resolve();

/** Tỉ lệ khung Flow gần nhất với khung ảnh cần (Flow có 16:9, 4:3, 1:1, 3:4, 9:16). */
export function flowAspect(frame: Frame): "16:9" | "4:3" | "1:1" | "3:4" | "9:16" {
  const r = frame.width / frame.height;
  const options = [["16:9", 16 / 9], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 3 / 4], ["9:16", 9 / 16]] as const;
  return options.reduce((best, o) => (Math.abs(o[1] - r) < Math.abs(best[1] - r) ? o : best))[0];
}

/** Chrome Flow đang chạy agent dựng video (agent đó đóng tab lạ) → không chen vào. */
function flowBusy(bizId: string): boolean {
  return q.all<Row>("SELECT tool FROM creative_job WHERE biz_id = ? AND status = 'running'", bizId).some((j) => !/^(auto-video|news-video|edit-source|portrait)$/.test(String(j.tool)));
}

export async function flowImageFile(o: { bizId: string; prompt: string; outFile: string; frame: Frame; model?: string }): Promise<{ path: string; model: string }> {
  const run = chain.then(() => flowImageOnce(o));
  chain = run.catch(() => undefined);
  return run;
}

async function flowImageOnce(o: { bizId: string; prompt: string; outFile: string; frame: Frame; model?: string }): Promise<{ path: string; model: string }> {
  if (flowBusy(o.bizId)) throw new AppError("FLOW_BUSY", "Chrome Flow đang dựng video — chưa tạo ảnh bằng Gemini lúc này", 409);
  const { chromeFlowAccount, flowSettings } = await import("./creative.ts"); // nạp muộn: creative.ts nặng và nạp vòng
  await chromeFlowAccount(flowSettings(o.bizId));
  const content = ((bizSettings(o.bizId) as Row).content ?? {}) as Row;
  const model = String(o.model || content.flowImageModel || FLOW_IMAGE_MODELS[0]);
  const aspect = flowAspect(o.frame);
  const tmp = mkdtempSync(join(tmpdir(), "taki-flowimg-"));
  const raw = join(tmp, "flow.jpg");
  try {
    const promptFile = join(tmp, "prompt.txt");
    writeFileSync(promptFile, o.prompt.slice(0, 4000), "utf8");
    let out: Row;
    try {
      const r = await execFileAsync(process.execPath, [FLOW_IMAGE_BIN, "--prompt-file", promptFile, "--out", raw, "--aspect", aspect, "--model", model,
        ...(content.flowImageProject ? ["--project", String(content.flowImageProject)] : [])], { timeout: 8 * 60_000, windowsHide: true, maxBuffer: 1024 * 1024 });
      out = JSON.parse(String(r.stdout).trim().split("\n").at(-1) ?? "{}");
    } catch (e) {
      const stdout = String((e as { stdout?: string }).stdout ?? "").trim().split("\n").at(-1) ?? "";
      try { out = JSON.parse(stdout); } catch { out = { error: e instanceof Error ? e.message : String(e) }; }
    }
    if (out.projectUrl && out.projectUrl !== content.flowImageProject) saveProject(o.bizId, String(out.projectUrl));
    if (out.error || !existsSync(raw)) throw new AppError("FLOW_IMAGE_FAILED", `Gemini trên Flow chưa tạo được ảnh: ${String(out.error ?? "không có tệp").slice(0, 300)}`, 502);
    // Cắt giữa về đúng tỉ lệ khung (vd 3:4 → 4:5 của bài mạng xã hội), giữ nguyên độ phân giải gốc.
    mkdirSync(resolve(o.outFile, ".."), { recursive: true });
    await execFileAsync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", `crop='min(iw,ih*${o.frame.width}/${o.frame.height})':'min(ih,iw*${o.frame.height}/${o.frame.width})'`, o.outFile], { timeout: 60_000, windowsHide: true });
    if (!existsSync(o.outFile) || statSync(o.outFile).size < 2000) throw new AppError("FLOW_IMAGE_FAILED", "Không cắt được ảnh Gemini về đúng khung", 502);
    return { path: o.outFile, model: `gemini-flow:${out.model ?? model}` };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { logger.warn("flow_image.tmp_cleanup", { error: String(e) }); }
  }
}

function saveProject(bizId: string, url: string) {
  const biz = byId<Row>("biz", bizId);
  if (!biz) return;
  const s = (biz.settings ?? {}) as Row;
  update("biz", bizId, { settings: { ...s, content: { ...(s.content ?? {}), flowImageProject: url } } });
}
