import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { bizSettings, type Row } from "@dotaka/db";
import { codexReadiness, effectiveProvider } from "@dotaka/llm-gateway";

/**
 * Công cụ tạo ảnh (Cài đặt → Tạo ảnh bằng), ĐỘC LẬP với model viết bài — dùng chung cho ảnh bài mạng xã hội (post-image.ts)
 * và ảnh trong bài SEO (seo-images.ts):
 *  - "claude": AI viết bài THIẾT KẾ ảnh bằng HTML/SVG có tiêu đề tiếng Việt (Claude, hoặc ChatGPT nếu đội AI chạy ChatGPT);
 *  - "chatgpt": công cụ vẽ ảnh của ChatGPT (Codex CLI, 1 hồ sơ ChatGPT đã đăng nhập) — dùng được khi đội AI viết bằng Claude;
 *  - "gemini_flow": Gemini (Nano Banana) trên Google Flow qua Chrome Flow (flow-image.ts);
 *  - "auto": như trước — đi theo kết nối AI đang chọn (ChatGPT → vẽ ảnh, Claude → thiết kế).
 * fallback (mặc định bật): công cụ đã chọn chưa sẵn sàng / tạo lỗi → AI viết bài thiết kế ảnh thay, ghi rõ lý do.
 */
export type ImageEngine = "claude" | "chatgpt" | "gemini_flow";
export const IMAGE_ENGINE_LABEL: Record<ImageEngine, string> = { claude: "Claude thiết kế", chatgpt: "ChatGPT vẽ ảnh", gemini_flow: "Gemini trên Google Flow" };

export function imageSettings(bizId: string) {
  const c = ((bizSettings(bizId) as Row).content ?? {}) as Row;
  const engine = ["claude", "chatgpt", "gemini_flow"].includes(c.imageEngine) ? (c.imageEngine as ImageEngine) : "auto" as const;
  return { engine, fallback: c.imageFallback !== false, codexAccountId: (c.imageCodexAccountId as string | undefined) || null, flowModel: (c.flowImageModel as string | undefined) || null, flowProject: (c.flowImageProject as string | undefined) || null };
}
/** Công cụ này dùng được ngay không (kiểm tra nhanh, không mở trình duyệt, không gọi AI). */
export function imageEngineReady(bizId: string, engine: ImageEngine): { ready: boolean; reason?: string } {
  if (engine === "chatgpt") { const r = codexReadiness(bizId, imageSettings(bizId).codexAccountId); return { ready: r.ready, ...(r.reason ? { reason: r.reason } : {}) }; }
  if (engine === "gemini_flow") {
    const flow = ((bizSettings(bizId) as Row).flow ?? {}) as Row;
    if (!flow.chromeProfileDir) return { ready: false, reason: "Chưa chọn profile Chrome có tài khoản Google Flow (Sản xuất video → Trình duyệt)" };
    if (!existsSync(join(resolve(process.cwd(), "data"), "flow-chrome", "Default"))) return { ready: false, reason: "Chrome Flow chưa thiết lập — mở Sản xuất video và đăng nhập Chrome Flow 1 lần" };
    return { ready: true };
  }
  const e = effectiveProvider(bizId);
  if (e.provider === "sandbox") return { ready: false, reason: e.reason ?? "Đang ở chế độ sandbox (không gọi AI) nên không tạo ảnh" };
  return e.ready === false ? { ready: false, reason: e.reason ?? "Kết nối AI chưa sẵn sàng" } : { ready: true };
}
/** Công cụ sẽ tạo ảnh — để giao diện nói rõ ảnh do ai tạo, và lý do khi phải dùng dự phòng. */
export function postImageEngine(bizId: string): { engine: ImageEngine | null; chosen: ImageEngine; reason?: string } {
  const s = imageSettings(bizId);
  const chosen: ImageEngine = s.engine === "auto" ? (effectiveProvider(bizId).provider === "codex_cli" ? "chatgpt" : "claude") : s.engine;
  const r = imageEngineReady(bizId, chosen);
  if (r.ready) return { engine: chosen, chosen };
  if (s.fallback && chosen !== "claude" && imageEngineReady(bizId, "claude").ready) {
    return { engine: "claude", chosen, reason: `${IMAGE_ENGINE_LABEL[chosen]} chưa sẵn sàng (${r.reason}) — tạm dùng ${IMAGE_ENGINE_LABEL.claude}` };
  }
  return { engine: null, chosen, ...(r.reason ? { reason: r.reason } : {}) };
}
/** Trạng thái cho trang Cài đặt: lựa chọn, công cụ thực dùng, độ sẵn sàng của từng công cụ. */
export function imageEngineStatus(bizId: string) {
  const s = imageSettings(bizId);
  const pick = postImageEngine(bizId);
  return {
    setting: s.engine, fallback: s.fallback, codexAccountId: s.codexAccountId, flowModel: s.flowModel, flowProject: s.flowProject,
    engine: pick.engine, chosen: pick.chosen, reason: pick.reason ?? null,
    engines: Object.fromEntries((["claude", "chatgpt", "gemini_flow"] as ImageEngine[]).map((e) => [e, imageEngineReady(bizId, e)])),
  };
}

