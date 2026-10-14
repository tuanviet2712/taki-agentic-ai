import { renameSync, rmSync } from "node:fs";
import type { Dna } from "@dotaka/agents";
import type { Row } from "@dotaka/db";
import { generate, generateImageFile } from "@dotaka/llm-gateway";
import { AppError, logger } from "@dotaka/shared";
import { flowImageFile } from "./flow-image.ts";
import { imageEngineReady, imageSettings, postImageEngine, type ImageEngine } from "./image-engine.ts";
import { COMMON_RULES, DesignOut, POST_IMAGE, chatgptImagePrompt, claudeDesignPrompt, renderDesign, reviewDesign, safeDesignHtml, type Frame } from "./post-image.ts";

/** Tạo ảnh bằng công cụ đã chọn (image-engine.ts) — dùng chung cho ảnh bài mạng xã hội và ảnh trong bài SEO. Tách khỏi image-engine để không nạp vòng với post-image. */
const clip = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/**
 * Tạo 1 ảnh vào `png` bằng công cụ đã chọn. Công cụ vẽ (ChatGPT / Gemini) lỗi mà bật dự phòng → AI viết bài thiết kế ảnh thay;
 * kết quả ghi công cụ thật đã dùng + lý do chuyển (để mục duyệt nói rõ).
 */
export async function makeAiImage(o: { bizId: string; ci: Row; dna: Dna | undefined; note?: string; frame?: Frame; extra?: string[]; png: string; taskRunId?: string }): Promise<{ engine: ImageEngine; model?: string; alt?: string; headline?: string; textInImage: boolean; qa?: Row; fallbackFrom?: ImageEngine; fallbackError?: string }> {
  const frame = o.frame ?? POST_IMAGE;
  const pick = postImageEngine(o.bizId);
  if (!pick.engine) throw new AppError("IMAGE_AI_OFF", pick.reason ?? "Chưa có công cụ tạo ảnh", 400);
  const fallback = pick.engine !== pick.chosen ? { fallbackFrom: pick.chosen, fallbackError: pick.reason } : {};
  if (pick.engine !== "claude") {
    try {
      const p = chatgptImagePrompt(o.ci, o.dna, o.note, frame, o.extra);
      if (pick.engine === "chatgpt") {
        const r = await generateImageFile({ bizId: o.bizId, agentKey: "content", taskRunId: o.taskRunId, system: p.system, prompt: p.prompt, outFile: o.png, accountId: imageSettings(o.bizId).codexAccountId });
        return { engine: "chatgpt", model: r.model, textInImage: false };
      }
      const r = await flowImageFile({ bizId: o.bizId, prompt: flowPromptOf(p), outFile: o.png, frame });
      return { engine: "gemini_flow", model: r.model, textInImage: false };
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (!imageSettings(o.bizId).fallback || !imageEngineReady(o.bizId, "claude").ready) throw e;
      logger.warn("ai_image.fallback", { engine: pick.engine, error: why.slice(0, 300) });
      return { ...(await claudeImage(o.bizId, o.ci, o.dna, o.note, frame, o.extra ?? [], o.png, o.taskRunId)), fallbackFrom: pick.engine, fallbackError: clip(why, 300) };
    }
  }
  return { ...(await claudeImage(o.bizId, o.ci, o.dna, o.note, frame, o.extra ?? [], o.png, o.taskRunId)), ...fallback };
}
/** Gemini trên Flow chỉ có 1 ô prompt: gộp đề bài + quy tắc, bỏ thẻ <untrusted> (Flow không có vai hệ thống). */
export const flowPromptOf = (p: { system: string; prompt: string }) => [p.prompt.replace(/<\/?untrusted>/g, ""), "Quy tắc:", ...COMMON_RULES.slice(0, 2)].join("\n");

async function claudeImage(bizId: string, ci: Row, dna: Dna | undefined, note: string | undefined, frame: Frame, extra: string[], png: string, taskRunId?: string) {
  const p = claudeDesignPrompt(ci, dna, note, frame, extra);
  const r = await generate({
    bizId, agentKey: "content", tier: "medium", taskRunId, system: p.system, user: p.user, schema: DesignOut,
    sandbox: () => { throw new AppError("IMAGE_AI_OFF", "Đang ở chế độ sandbox nên không tạo ảnh", 400); },
  });
  await renderDesign(safeDesignHtml(r.output.html, frame), png, frame);
  let qa: Row = { fixed: false };
  // Soát bằng mắt 1 vòng: có lỗi dàn trang thì dựng lại bản đã sửa (bước này hỏng thì giữ ảnh đầu).
  try {
    const fix = await reviewDesign(bizId, r.output.html, png, taskRunId, frame);
    if (fix) {
      const v2 = png.replace(/\.png$/i, "-v2.png");
      await renderDesign(safeDesignHtml(fix.html, frame), v2, frame);
      rmSync(png, { force: true });
      renameSync(v2, png);
      qa = { fixed: true, issues: fix.issues };
    }
  } catch (e) {
    logger.warn("post_image.qa_failed", { contentItemId: ci.id, error: String(e).slice(0, 300) });
  }
  return { engine: "claude" as const, model: r.model, headline: clip(r.output.headline, 200), alt: clip(r.output.alt, 300), textInImage: true, qa };
}
