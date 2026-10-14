import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q, type Row } from "@dotaka/db";
import { addOptOutManual, listOptOuts, removeOptOut } from "@dotaka/chat-engine";
import {
  NURTURE_DEFAULTS, liveZl, refreshZlNicks, listNurtureLeads, nurtureFunnel, nurtureLeadDetail, nurtureReviewStatus, nurtureSettings, nurtureTick,
  pollBizComments, previewTemplates, reclassifyComments, resendDm, saveNurtureSettings, setPhoneManual, skipNurtureReview, stopLead, tryFriendRequest,
} from "@dotaka/orchestrator";
import { routes } from "../http.ts";

/** Chăm khách từ bình luận (trang /nurture): cài đặt, phễu, danh sách khách + thao tác tay, xem trước mẫu, duyệt trước, khách không nhận tin. */
export function nurtureRoutes(app: FastifyInstance) {
  const r = routes(app);

  r.get("/v1/nurture", async ({ bizId, query }) => {
    const zl0 = liveZl(bizId);
    const zl = zl0 ? await refreshZlNicks(zl0) : undefined;
    const pages = q.all<Row>(`SELECT ch.id, ch.name, ch.external_id, (ch.secret_ciphertext IS NOT NULL AND c.mode = 'live' AND c.status != 'revoked') live
      FROM channel ch LEFT JOIN connection c ON c.id = ch.connection_id WHERE ch.biz_id = ? AND ch.platform = 'facebook' AND ch.enabled = 1 ORDER BY ch.name`, bizId);
    return {
      settings: nurtureSettings(bizId),
      defaults: NURTURE_DEFAULTS,
      funnel: nurtureFunnel(bizId, Number(query.days ?? 30) || 30),
      review: nurtureReviewStatus(bizId),
      optoutCount: q.scalar<number>("SELECT COUNT(DISTINCT COALESCE(conversation_id, channel || ':' || external_id)) FROM contact_optout WHERE biz_id = ?", bizId),
      pages: pages.map((p) => ({ ...p, live: Boolean(p.live) })),
      zalo: zl ? { connected: true, mode: zl.mode, accounts: zl.config?.accounts ?? [] } : { connected: false, mode: null, accounts: [] },
    };
  });
  r.put("/v1/nurture/settings", ({ bizId, body, actor }) => saveNurtureSettings(bizId, body, actor));
  /** Xem trước mẫu câu với dữ liệu mẫu (khách "Lan", sản phẩm + link đầu tiên) — đúng hàm điền mẫu lúc gửi thật. */
  r.post("/v1/nurture/preview", ({ bizId, body }) => {
    const b = z.object({ template: z.string().max(4000).optional(), templates: z.array(z.string().max(4000)).max(60).optional() }).parse(body);
    const out = previewTemplates(bizId, b.templates ?? [b.template ?? ""]);
    return { vars: out.vars, items: out.items, text: out.items[0] ?? "" };
  });
  r.post("/v1/nurture/review/skip", ({ bizId, actor }) => skipNurtureReview(bizId, actor));
  r.get("/v1/nurture/leads", ({ bizId, query }) => listNurtureLeads(bizId, { stage: typeof query.stage === "string" && query.stage ? query.stage : undefined }));
  r.get("/v1/nurture/comments", ({ bizId }) => q.all(`SELECT c.id, c.author, c.text, c.label, c.replied_at, c.dm_sent_at,
    c.external_created_at, c.created_at, p.title post_title, p.permalink post_permalink, ch.name channel_name
    FROM post_comment c JOIN post p ON p.id = c.post_id JOIN channel ch ON ch.id = p.channel_id
    WHERE c.biz_id = ? AND c.source IN ('poll','webhook') AND COALESCE(c.label_source,'') != 'system'
    ORDER BY COALESCE(c.external_created_at,c.created_at) DESC LIMIT 50`, bizId));
  // Explicit collection remains available while automatic replies are off; no nurture tick or send jobs.
  r.post("/v1/nurture/scan", ({ bizId }) => pollBizComments(bizId, { full: true, scanOnly: true }));
  // Phân loại lại bình luận gán nhãn heuristic (sau khi sửa bộ phân loại) rồi đưa vào hàng chăm khách.
  r.post("/v1/nurture/reclassify", ({ bizId }) => reclassifyComments(bizId));
  r.get("/v1/nurture/leads/:id", ({ bizId, params }) => nurtureLeadDetail(bizId, params.id));
  r.post("/v1/nurture/leads/:id/resend", ({ bizId, params, actor }) => resendDm(bizId, params.id, actor));
  r.post("/v1/nurture/leads/:id/phone", ({ bizId, params, body, actor }) => setPhoneManual(bizId, params.id, z.object({ phone: z.string().min(6).max(30) }).parse(body).phone, actor));
  r.post("/v1/nurture/leads/:id/friend", ({ bizId, params }) => tryFriendRequest(bizId, params.id, { force: true }));
  r.post("/v1/nurture/leads/:id/stop", ({ bizId, params, actor }) => stopLead(bizId, params.id, actor));
  // "Quét ngay": quét đủ bài 14 ngày (không chỉ bài mới trong 48 giờ).
  r.post("/v1/nurture/run", async ({ bizId }) => ({ poll: await pollBizComments(bizId, { full: true }), tick: await nurtureTick(bizId) }));

  // Khách không nhận tin (opt-out): danh sách (SĐT chỉ hiện dạng che), thêm tay, bỏ khỏi danh sách.
  r.get("/v1/nurture/optouts", ({ bizId, query }) => listOptOuts(bizId, typeof query.search === "string" ? query.search.slice(0, 80) : undefined));
  r.post("/v1/nurture/optouts", ({ bizId, body, actor }) => {
    const b = z.object({
      phone: z.string().max(30).optional(), name: z.string().max(120).optional(), reason: z.string().max(300).optional(),
      leadId: z.string().max(80).optional(), conversationId: z.string().max(80).optional(),
    }).parse(body);
    const row = addOptOutManual(bizId, b, actor);
    return { ok: true, id: row.id };
  });
  r.del("/v1/nurture/optouts/:id", ({ bizId, params, actor }) => removeOptOut(bizId, params.id, actor));
}
