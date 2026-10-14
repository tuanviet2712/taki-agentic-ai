import { audit, q, update, type Row } from "@dotaka/db";

/**
 * Kế hoạch "10 bài SEO" / "10 kịch bản video" phải ra ĐÚNG số lượng và đúng loại. Trước đây số 10 chỉ nằm trong tiêu đề, hệ thống
 * không đọc nên Chiến lược chỉ lập 4–5 mục (mặc định của mẫu) và "10 bài SEO" lại ra bài đa kênh + 1 bài SEO.
 */
export type GoalKind = "mixed" | "seo" | "video";
export const MAX_GOAL_PIECES = 30;
/** Ước lượng token cho 1 bài kể cả các vòng sửa + chấm (đo thực tế: kịch bản ≈ 65.000, bài SEO / bài viết tương đương). */
export const TOKENS_PER_PIECE = 80_000;
const TOKEN_CAP = 6_000_000;

/** Đọc số lượng + loại nội dung từ câu yêu cầu của Sếp. count = tổng các số đứng trước "bài / kịch bản / video / bài SEO…". */
export function inferGoalRequest(text: string): { count?: number; kind: GoalKind } {
  let post = 0, seo = 0, video = 0;
  const re = /(?<![\d.,])(\d{1,3})\s*(bài\s*viết|bài\s*seo|bài|kịch\s*bản|video|clip|reel|nội\s*dung)([^\n]{0,14})/gi;
  for (const m of String(text ?? "").matchAll(re)) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase().replace(/\s+/g, " ");
    if (/seo/.test(unit) || (/^bài( viết)?$/.test(unit) && /^\s*(chuẩn\s*)?seo\b/i.test(m[3]))) seo += n;
    else if (/kịch|video|clip|reel/.test(unit)) video += n;
    else post += n;
  }
  const total = post + seo + video;
  const kind: GoalKind = seo && !post && !video ? "seo" : video && !post && !seo ? "video" : "mixed";
  return { ...(total > 0 ? { count: Math.min(MAX_GOAL_PIECES, total) } : {}), kind };
}

/**
 * Trần token/ngày của agent viết nội dung phải đủ cho số bài Sếp giao, nếu không các bài cuối bị chặn (TOKEN_BUDGET_EXCEEDED) và
 * kế hoạch "đứng" giữa chừng. Chỉ NÂNG trần (không bao giờ hạ), có ghi nhật ký; tối đa 6 triệu token/ngày/agent.
 */
export function ensureTokenBudgets(bizId: string, kind: GoalKind, count: number, actor = "orchestrator"): { agent: string; from: number; to: number }[] {
  const agents = kind === "seo" ? ["seo_web"] : kind === "video" ? ["video_script"] : ["content", "video_script", "seo_web"];
  const need = Math.min(TOKEN_CAP, count * TOKENS_PER_PIECE);
  const raised: { agent: string; from: number; to: number }[] = [];
  for (const agent of agents) {
    const cfg = q.get<Row>("SELECT id, token_budget_day FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, agent);
    if (!cfg || Number(cfg.token_budget_day) >= need) continue;
    update("agent_config", cfg.id, { token_budget_day: need });
    raised.push({ agent, from: Number(cfg.token_budget_day), to: need });
  }
  if (raised.length) audit(bizId, actor, "agent.token_budget_raised", { type: "biz", id: bizId }, { reason: `Kế hoạch ${count} bài`, raised });
  return raised;
}

/** Kế hoạch (goal) này đã nêu rõ số bài chưa — dùng để quyết định có thêm 1 bài SEO phụ của mẫu "Ra mắt chiến dịch" hay không. */
export const goalHasExplicitCount = (goal: Row | undefined) => goal?.params?.contentCount != null;
