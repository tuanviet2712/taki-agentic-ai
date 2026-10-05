import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q, type Row } from "@dotaka/db";
import {
  NURTURE_DEFAULTS, liveZl, refreshZlNicks, listNurtureLeads, nurtureFunnel, nurtureLeadDetail, nurtureSettings, nurtureTick, pollBizComments, resendDm,
  saveNurtureSettings, setPhoneManual, stopLead, tryFriendRequest,
} from "@dotaka/orchestrator";
import { routes } from "../http.ts";

/** Chăm khách từ bình luận (trang /nurture): cài đặt, phễu, danh sách khách + thao tác tay. */
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
      pages: pages.map((p) => ({ ...p, live: Boolean(p.live) })),
      zalo: zl ? { connected: true, mode: zl.mode, accounts: zl.config?.accounts ?? [] } : { connected: false, mode: null, accounts: [] },
    };
  });
  r.put("/v1/nurture/settings", ({ bizId, body, actor }) => saveNurtureSettings(bizId, body, actor));
  r.get("/v1/nurture/leads", ({ bizId, query }) => listNurtureLeads(bizId, { stage: typeof query.stage === "string" && query.stage ? query.stage : undefined }));
  r.get("/v1/nurture/leads/:id", ({ bizId, params }) => nurtureLeadDetail(bizId, params.id));
  r.post("/v1/nurture/leads/:id/resend", ({ bizId, params, actor }) => resendDm(bizId, params.id, actor));
  r.post("/v1/nurture/leads/:id/phone", ({ bizId, params, body, actor }) => setPhoneManual(bizId, params.id, z.object({ phone: z.string().min(6).max(30) }).parse(body).phone, actor));
  r.post("/v1/nurture/leads/:id/friend", ({ bizId, params }) => tryFriendRequest(bizId, params.id, { force: true }));
  r.post("/v1/nurture/leads/:id/stop", ({ bizId, params, actor }) => stopLead(bizId, params.id, actor));
  r.post("/v1/nurture/run", async ({ bizId }) => ({ poll: await pollBizComments(bizId), tick: await nurtureTick(bizId) }));
}
