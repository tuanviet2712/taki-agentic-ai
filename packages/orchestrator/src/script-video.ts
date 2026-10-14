import { activeDna, byId, q, type Row } from "@dotaka/db";
import { AppError } from "@dotaka/shared";
import { existsSync } from "node:fs";
import { FLOW_TOOLS, startVideoJob, type CreativeInput } from "./creative.ts";
import { videoAiStatus } from "./video-ai.ts";
import { spokespersonOf } from "./dna-intake.ts";

/**
 * Kịch bản video đã duyệt (Video Agent) → đúng skill tạo video, đầu vào sạch:
 *   HOOK: a | b / [0-3s] hình ảnh · 🎙 lời đọc · 🅣 chữ trên màn hình / CTA: … / Caption: …
 * Chỉ lời đọc (🎙) vào ô kịch bản của Tool; hình ảnh từng cảnh làm gợi ý; ghi chú nội bộ / ⚠️ bị bỏ.
 * Video xong → nối ngược về kịch bản gốc (creative.ts completeVideoJob): caption đã duyệt, kịch bản thôi nằm hàng chờ đăng.
 */
export type ScriptScene = { from: number; to: number; visual: string; voice: string; onScreen: string };
export type ParsedScript = { hooks: string[]; scenes: ScriptScene[]; cta: string; caption: string };

/** Bỏ ghi chú nội bộ "(Ghi chú nội bộ …)", "(cần … xác nhận …)" và dấu ⚠️ — không bao giờ đưa vào video. */
export function cleanNote(t: string) {
  return t.replace(/\((?:[^()]*?)(ghi chú nội bộ|xác nhận|chờ [^()]*chốt|TODO)(?:[^()]*?)\)/gi, "").replace(/⚠️/g, "").replace(/[ \t]{2,}/g, " ").trim();
}

export function parseVideoScript(body: string): ParsedScript | null {
  const text = String(body ?? "");
  const hookLine = /^HOOK:\s*(.+)$/m.exec(text)?.[1] ?? "";
  const scenes: ScriptScene[] = [];
  const re = /^\[(\d+)\s*-\s*(\d+)s\]\s*(.*)$/gm;
  const heads = [...text.matchAll(re)];
  heads.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index ?? text.length : text.search(/\n\s*CTA:|\n\s*Caption:/) > start ? text.search(/\n\s*CTA:|\n\s*Caption:/) : text.length;
    const block = text.slice(start, end);
    scenes.push({
      from: Number(m[1]), to: Number(m[2]), visual: cleanNote(m[3]),
      voice: cleanNote(/🎙\s*(.+)/.exec(block)?.[1] ?? ""), onScreen: cleanNote(/🅣\s*(.+)/.exec(block)?.[1] ?? ""),
    });
  });
  if (!scenes.length || !scenes.some((s) => s.voice)) return null;
  return {
    hooks: hookLine.split("|").map((h) => cleanNote(h)).filter(Boolean),
    scenes,
    cta: cleanNote(/^CTA:\s*(.+)$/m.exec(text)?.[1] ?? ""),
    caption: (/(?:^|\n)Caption:\s*([\s\S]+)$/.exec(text)?.[1] ?? "").trim(),
  };
}

const ON_CAMERA = /(nhìn thẳng (vào )?camera|cận (cảnh )?mặt|khung hình cận|ngồi bàn|đứng trước|nói với camera|talking head|quay lại nhìn)/i;
const FOOD = /(món ăn|đồ ăn|ăn vặt|nhà hàng|quán ăn|bánh|nấu)/i;
const FASHION = /(thời trang|áo|váy|quần|outfit|phối đồ)/i;

/** Ảnh chân dung nhân hiệu đã dùng ở lần chạy "Video nhân hiệu" gần nhất (còn trên máy). */
function lastBrandPortrait(bizId: string): string | null {
  for (const j of q.all<Row>("SELECT input FROM creative_job WHERE biz_id = ? AND tool = 'nhan-hieu' ORDER BY (status = 'done') DESC, created_at DESC LIMIT 20", bizId)) {
    const img = ((j.input?.images ?? []) as { path: string; role: string }[]).find((i) => i.role === "Chân dung nhân hiệu" && existsSync(i.path));
    if (img) return img.path;
  }
  return null;
}

export type VideoPlan = {
  contentId: string; title: string; tool: string; toolLabel: string; engine: string; reason: string;
  /** Thiếu gì thì chưa chạy được (Sếp bổ sung ở trang Sản xuất video). */
  missing: string[]; paidCredits: boolean; minutes: number; input: CreativeInput; scenes: number; durationSec: number;
  job: { id: string; status: string; step: string | null } | null;
};

/** Chọn skill + dựng đầu vào cho 1 kịch bản. Không chạy gì. */
export function planVideoFromScript(bizId: string, contentId: string, opts: { footage?: boolean } = {}): VideoPlan {
  const ci = byId<Row>("content_item", contentId);
  if (!ci || ci.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
  if (ci.kind !== "video_script") throw new AppError("NOT_SCRIPT", "Nội dung này không phải kịch bản video");
  const s = parseVideoScript(ci.body);
  if (!s) throw new AppError("BAD_SCRIPT", "Kịch bản chưa đúng định dạng (cần các cảnh [a-bs] có lời đọc 🎙)");
  const all = s.scenes.map((x) => x.visual).join(" ");
  // Người đại diện + giọng đọc từ DNA (Mục tiêu & DNA → Người đại diện), không gắn cứng 1 người.
  const sp = spokespersonOf(bizId);
  const owner = sp.name || "người đại diện thương hiệu";
  const ownerFirst = sp.name.split(/\s+/).at(-1) ?? "";
  const onCamera = ON_CAMERA.test(all) || (ownerFirst.length > 1 && new RegExp(`(^|[^\\p{L}])${ownerFirst}([^\\p{L}]|$)`, "iu").test(all));
  const voiceAll = s.scenes.map((x) => x.voice).filter(Boolean).join("\n");
  const realSec = s.scenes.at(-1)!.to;
  const durationSec = Math.min(120, Math.max(15, realSec));
  const channel = ["facebook", "tiktok", "youtube", "instagram"].includes(ci.channel) ? ci.channel : "facebook";
  const base = {
    title: String(ci.title).slice(0, 120), durationSec, hookTitle: (s.scenes[0]?.onScreen || s.hooks[0] || "").slice(0, 120),
    cta: s.cta.slice(0, 160), channels: [channel], brand: "taki" as const, sourceContentId: ci.id, veoModel: "Veo 3.1 - Fast" as const,
  };
  const visuals = s.scenes.map((x) => `[${x.from}-${x.to}s] ${x.visual}${x.onScreen ? ` · chữ: ${x.onScreen}` : ""}`).join("\n");
  let tool: string, reason: string;
  const missing: string[] = [];
  let input: CreativeInput;
  if (onCamera) {
    tool = "nhan-hieu";
    reason = `Kịch bản là ${owner} nói trực tiếp trước camera → Video nhân hiệu (BrandUp) giữ đúng gương mặt từ ảnh chân dung thật.`;
    const portrait = lastBrandPortrait(bizId);
    if (!portrait) missing.push("Ảnh chân dung rõ mặt của người đứng tên nhân hiệu");
    input = {
      ...base, tool: "nhan-hieu", product: "",
      voice: sp.voice,
      brief: [
        "KỊCH BẢN LỜI THOẠI ĐÃ DUYỆT — dán NGUYÊN VĂN vào ô kịch bản của Tool (bước 5), không viết lại:",
        voiceAll, "", "HÌNH ẢNH GỢI Ý THEO CẢNH (bối cảnh / camera, không phải lời đọc):", visuals,
      ].join("\n").slice(0, 6000),
      images: portrait ? [{ path: portrait, role: "Chân dung nhân hiệu" }] : [],
    } as CreativeInput;
  } else if (FOOD.test(all) || FASHION.test(all)) {
    tool = FOOD.test(all) ? "review-do-an-vat" : "review-thoi-trang";
    reason = "Kịch bản review sản phẩm → tool review tương ứng (cần ảnh sản phẩm).";
    input = { ...base, tool, product: String(ci.title).slice(0, 200), voice: "", brief: [voiceAll, "", visuals].join("\n").slice(0, 6000), images: [] } as CreativeInput;
  } else {
    tool = "auto-video";
    reason = "Kịch bản dạng minh hoạ (không cần người thật trước camera) → Video tự động: cảnh + giọng đọc + phụ đề, không tốn tín dụng Flow.";
    const st = videoAiStatus().moneyprinter;
    // Có video thô của Sếp (tải lên) thì dựng từ chính video đó, không cần kho Pexels/Pixabay.
    if (!opts.footage && !st.pexels.length && !st.pixabay.length) missing.push("Video thô của Sếp (tải lên để AI dựng) hoặc khóa Pexels/Pixabay (miễn phí)");
    input = { ...base, tool: "auto-video", product: "", voice: "", brief: voiceAll.slice(0, 6000), images: [], video: { source: !st.pexels.length && st.pixabay.length ? "pixabay" : "pexels", scriptReady: true, aspect: "9:16", voiceName: "vi-VN-NamMinhNeural-Male", bgm: "random" } } as CreativeInput;
  }
  missing.push(...scriptBlockers(bizId, ci, s));
  const job = q.get<Row>("SELECT id, status, step FROM creative_job WHERE biz_id = ? AND source_content_id = ? AND status NOT IN ('cancelled','failed','blocked') ORDER BY created_at DESC LIMIT 1", bizId, ci.id);
  const def = FLOW_TOOLS[tool];
  return {
    contentId: ci.id, title: ci.title, tool, toolLabel: def.label, engine: def.engine ?? "flow", reason, missing,
    paidCredits: (def.engine ?? "flow") === "flow", minutes: def.minutes, input, scenes: s.scenes.length, durationSec,
    job: job ? { id: job.id, status: job.status, step: job.step ?? null } : null,
  };
}

/** Lý do NỘI DUNG khiến kịch bản chưa được làm video (áp cho mọi cách làm video, kể cả làm thủ công trên Flow). */
export function scriptBlockers(bizId: string, ci: Row, s: ParsedScript): string[] {
  const out: string[] = [];
  const realSec = s.scenes.at(-1)!.to;
  // Kịch bản chưa hợp làm video ngắn → nói rõ, không chạy (Flow tốn tín dụng).
  if (realSec > 120) out.push(`Kịch bản dài ${realSec} giây (quá 2 phút của video ngắn) — rút gọn kịch bản trước`);
  const pending = String(ci.body).match(/[^.\n]{0,60}⚠️[^.\n]{0,40}|ghi chú nội bộ[^)\n]{0,80}/gi);
  // Số liệu công bố (số doanh nghiệp / học viên / năm) khi DNA còn ghi "Bộ số liệu công bố" chờ chốt → không đưa vào video.
  const statsPending = ((activeDna(bizId)?.data?.pendingConfirmations ?? []) as unknown[]).some((x) => /số liệu công bố/i.test(String(x)));
  const spoken = s.scenes.map((x) => `${x.voice} ${x.onScreen}`).join(" ");
  const stat = statsPending ? /\d[\d.,]*\s*(k|nghìn|ngàn)?\s*\+?\s*(doanh nghiệp|học viên|năm kinh nghiệm)/i.exec(spoken) : null;
  if (stat) out.push(`Kịch bản dùng số liệu công bố đang chờ chốt trong DNA ("${stat[0].trim()}") — xác nhận số hoặc bỏ câu đó trước khi làm video`);
  if (pending) out.push(`Kịch bản còn ý đang chờ xác nhận (${pending[0].replace(/\s+/g, " ").trim().slice(0, 90)}) — xác nhận hoặc bỏ ý đó trước khi làm video`);
  return out;
}

/** Kịch bản đã duyệt (chưa thành video) + kế hoạch video cho từng cái. */
export function scriptsAwaitingVideo(bizId: string) {
  return q.all<Row>("SELECT id FROM content_item WHERE biz_id = ? AND kind = 'video_script' AND status IN ('approved','manual_publish','scheduled') ORDER BY updated_at DESC", bizId)
    .map((r) => { try { return planVideoFromScript(bizId, r.id); } catch (e) { return { contentId: r.id, error: e instanceof Error ? e.message : String(e) }; } });
}

/** Sếp bấm "Tạo video": chạy đúng skill đã chọn (Flow tốn tín dụng → chỉ chạy khi Sếp bấm). Không chạy trùng. */
export function makeVideoFromScript(bizId: string, contentId: string, actor: string, override?: Partial<CreativeInput>, footage?: { materials: string[]; style?: "dynamic" | "smooth" | "clean"; music?: "auto" | "none" }) {
  const plan = planVideoFromScript(bizId, contentId, { footage: Boolean(footage?.materials.length) });
  const callerOverride = override; // chỉ lời gọi tường minh mới được bỏ qua kiểm tra thiếu gì; video thô vẫn phải qua kiểm tra số liệu chờ xác nhận
  if (footage?.materials.length) {
    // Kịch bản "minh hoạ" không làm được bằng Flow: dựng từ video thô Sếp tải lên (AI chọn đoạn, cắt cảnh, chuyển cảnh, zoom, chữ động, hiệu ứng âm thanh).
    if (plan.tool !== "auto-video") throw new AppError("NOT_FOOTAGE_SCRIPT", "Kịch bản này có tool riêng (người thật / review sản phẩm) — chỉ kịch bản minh hoạ mới dựng từ video thô");
    const ci = byId<Row>("content_item", contentId)!;
    const parsed = parseVideoScript(ci.body)!;
    override = {
      ...(override ?? {}), tool: "edit-source",
      hookTitle: (parsed.hooks[0] ?? plan.input.hookTitle ?? "").slice(0, 120), // câu mở đầu của kịch bản (chữ cảnh 1 đã hiện ở tiêu đề cảnh, tránh lặp)
      script: { scenes: parsed.scenes.map((x) => ({ from: x.from, to: x.to, voice: x.voice, visual: x.visual, onScreen: x.onScreen })) },
      video: { source: "local", materials: footage.materials, aspect: "9:16", style: footage.style ?? "dynamic", music: footage.music ?? "auto", scriptReady: true },
    };
    plan.missing = plan.missing.filter((m) => !/Pexels|Pixabay|video thô/i.test(m));
  }
  if (plan.job && ["queued", "running", "done"].includes(plan.job.status)) return { already: true, jobId: plan.job.id, status: plan.job.status };
  if (plan.missing.length && !callerOverride) throw new AppError("MISSING_INPUT", `Chưa đủ để tạo video: ${plan.missing.join(", ")} — mở trang Sản xuất video để bổ sung`);
  const job = startVideoJob(bizId, { ...plan.input, ...(override ?? {}), sourceContentId: contentId }, actor) as Row;
  return { already: false, jobId: job.id, status: job.status, tool: plan.toolLabel };
}
