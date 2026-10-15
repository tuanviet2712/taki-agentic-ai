import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { byId, type Row } from "@dotaka/db";
import {
  addSuppressionManual, campaignOf, campaignStats, cancelCampaign, createCampaign, createSequence, deleteCampaign, deleteContact, deleteSegment, deleteSequence,
  deleteStep, deleteTemplate, deliverability, duplicateTemplate, emailStatus, enqueue, enroll, generateStep, importContacts, listCampaigns, listContacts,
  listSegments, listSequences, listTemplates, messageHtml, pauseSequence, presetList, previewCampaign, previewContent, recentMessages, recheckDomain, removeSuppression,
  reopenSending, reorderSteps, requestCampaignApproval, requestSequenceActivation, saveSegment, saveStep, saveTemplate, scoreSequence, segmentMembers,
  SKIP_REASONS, sendTestEmail, sequenceDetail, setEmailConfig, stepOf, setupDomain, updateCampaign, updateContact, updateSequence, upsertContact, type EmailContent,
} from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { currentBizId, routes } from "../http.ts";

const Mode = z.enum(["text", "blocks", "dnd"]);
const Content = z.object({ subject: z.string().max(200), preheader: z.string().max(200).nullish(), mode: Mode, body: z.string().max(100_000).optional(), data: z.unknown().optional() });
const toContent = (c: z.infer<typeof Content>): EmailContent =>
  c.mode === "text" ? { mode: "text", subject: c.subject, body: c.body ?? "", preheader: c.preheader } : ({ mode: c.mode, subject: c.subject, data: c.data, preheader: c.preheader } as EmailContent);
const Campaign = z.object({
  name: z.string().max(160).optional(), segmentId: z.string().nullish(), subject: z.string().max(200).optional(), subjectB: z.string().max(200).nullish(),
  abPct: z.number().min(0).max(50).optional(), preheader: z.string().max(200).nullish(), mode: Mode.optional(), body: z.string().max(100_000).optional(),
  data: z.unknown().optional(), scheduledAt: z.string().nullish(), resendAfterHours: z.number().nullish(), resendSubject: z.string().max(200).nullish(),
});
const Rule = z.object({ field: z.string(), op: z.string(), value: z.unknown() });
const Trigger = z.object({ type: z.enum(["manual", "contact_created", "tag_added", "order_created"]), source: z.string().nullish(), tag: z.string().optional(), productKey: z.string().nullish() });
const SeqConfig = z.object({ trigger: Trigger, goal: z.object({ type: z.enum(["none", "purchase"]) }).optional() });

/** Kênh Email (Resend): tình trạng, liên hệ, phân khúc, mẫu, chiến dịch, chuỗi, chất lượng gửi. Route công khai (webhook / hủy nhận) ở routes/public.ts. */
export function emailRoutes(app: FastifyInstance) {
  const r = routes(app);

  // ---- Tình trạng + cài đặt ----
  r.get("/v1/email/status", ({ bizId }) => emailStatus(bizId));
  r.put("/v1/email/settings", ({ bizId, body, actor }) => {
    const p = z.object({ dailyLimit: z.number().optional(), fromName: z.string().max(80).optional(), replyTo: z.string().max(254).nullish() }).parse(body);
    return setEmailConfig(bizId, p, actor);
  });
  r.post("/v1/email/reopen", ({ bizId, actor }) => reopenSending(bizId, actor));
  r.post("/v1/email/domain/setup", async ({ bizId, body, actor }) => setupDomain(bizId, actor, z.object({ cloudflareToken: z.string().max(200).optional() }).parse(body ?? {})));
  r.post("/v1/email/domain/check", async ({ bizId, actor }) => recheckDomain(bizId, actor));
  r.post("/v1/email/test", async ({ bizId, body, actor }) => {
    const p = z.object({ to: z.string().email("Email nhận thử không hợp lệ"), content: Content }).parse(body);
    const res = await sendTestEmail(bizId, p.to, toContent(p.content), actor);
    if (res.status !== "sent") throw new AppError("EMAIL_NOT_SENT", `Chưa gửi được: ${SKIP_REASONS[res.reason?.split(":")[0] ?? ""] ?? res.reason ?? res.status}`, 400);
    return res;
  });
  r.get("/v1/email/deliverability", ({ bizId }) => deliverability(bizId));
  r.get("/v1/email/messages", ({ bizId, query }) => recentMessages(bizId, { contactId: query.contactId, status: query.status, sourceKind: query.sourceKind, sourceId: query.sourceId, limit: Number(query.limit) || 100 }));
  r.get("/v1/email/messages/:id/html", ({ bizId, params }) => {
    const html = messageHtml(bizId, params.id);
    if (html == null) throw new AppError("NOT_FOUND", "Không có nội dung thư", 404);
    return { html };
  });
  r.post("/v1/email/suppression", ({ bizId, body, actor }) => addSuppressionManual(bizId, z.object({ email: z.string() }).parse(body).email, actor));
  r.del("/v1/email/suppression/:id", ({ bizId, params, actor }) => removeSuppression(bizId, params.id, actor));

  // ---- Liên hệ ----
  r.get("/v1/email/contacts", ({ bizId, query }) => listContacts(bizId, { search: query.search, status: query.status, tag: query.tag, limit: Number(query.limit) || 100, offset: Number(query.offset) || 0 }));
  r.post("/v1/email/contacts", ({ bizId, body, actor }) => {
    const p = z.object({ email: z.string(), name: z.string().max(120).nullish(), tags: z.array(z.string()).max(50).optional(), consent: z.enum(["opt_in", "unknown", "transactional"]).default("opt_in") }).parse(body);
    return upsertContact(bizId, { ...p, source: "manual" }, actor).contact;
  });
  r.post("/v1/email/contacts/import", ({ bizId, body, actor }) => {
    const p = z.object({ csv: z.string().max(10_000_000), consent: z.enum(["opt_in", "unknown", "transactional"]), tags: z.array(z.string()).max(20).optional() }).parse(body);
    return importContacts(bizId, p.csv, { consent: p.consent, tags: p.tags }, actor);
  });
  r.put("/v1/email/contacts/:id", ({ bizId, params, body, actor }) => updateContact(bizId, params.id, z.object({ name: z.string().max(120).nullish(), tags: z.array(z.string()).max(50).optional(), consent: z.enum(["opt_in", "unknown", "transactional"]).optional() }).parse(body), actor));
  r.del("/v1/email/contacts/:id", ({ bizId, params, actor }) => deleteContact(bizId, params.id, actor));

  // ---- Phân khúc ----
  r.get("/v1/email/segments", ({ bizId }) => listSegments(bizId));
  r.post("/v1/email/segments", ({ bizId, body, actor }) => saveSegment(bizId, z.object({ id: z.string().optional(), name: z.string(), definition: z.object({ match: z.enum(["all", "any"]), rules: z.array(Rule).max(20) }) }).parse(body) as any, actor));
  r.post("/v1/email/segments/preview", ({ bizId, body }) => {
    const p = z.object({ segmentId: z.string().nullish() }).parse(body ?? {});
    const m = segmentMembers(bizId, p.segmentId ?? null);
    return { count: m.length, sample: m.slice(0, 20).map((c: Row) => ({ id: c.id, email: c.email, name: c.name })) };
  });
  r.del("/v1/email/segments/:id", ({ bizId, params, actor }) => deleteSegment(bizId, params.id, actor));

  // ---- Mẫu ----
  r.get("/v1/email/templates", ({ bizId, query }) => listTemplates(bizId, query.mode));
  r.post("/v1/email/templates", ({ bizId, body, actor }) => saveTemplate(bizId, z.object({ id: z.string().optional(), name: z.string(), grp: z.string().optional(), subject: z.string(), preheader: z.string().nullish(), mode: Mode, body: z.string().optional(), data: z.unknown().optional() }).parse(body), actor));
  r.post("/v1/email/templates/:id/duplicate", ({ bizId, params, actor }) => duplicateTemplate(bizId, params.id, actor));
  r.del("/v1/email/templates/:id", ({ bizId, params, actor }) => deleteTemplate(bizId, params.id, actor));
  /** Xem trước nội dung bất kỳ (soạn thảo) — HTML như người nhận thấy, link hủy là link mẫu. */
  r.post("/v1/email/preview", async ({ bizId, body }) => {
    const c = Content.parse(body);
    return previewContent(bizId, { subject: c.subject, preheader: c.preheader ?? null, mode: c.mode, body: c.body ?? "", data: c.data ?? {} });
  });

  // ---- Chiến dịch ----
  r.get("/v1/email/campaigns", ({ bizId }) => listCampaigns(bizId));
  r.post("/v1/email/campaigns", ({ bizId, body, actor }) => createCampaign(bizId, Campaign.parse(body), actor));
  r.get("/v1/email/campaigns/:id", ({ bizId, params }) => ({ ...campaignOf(bizId, params.id), stats: campaignStats(bizId, params.id) }));
  r.put("/v1/email/campaigns/:id", ({ bizId, params, body, actor }) => updateCampaign(bizId, params.id, Campaign.parse(body), actor));
  r.del("/v1/email/campaigns/:id", ({ bizId, params, actor }) => deleteCampaign(bizId, params.id, actor));
  // HTML thô cho <iframe> ở trang Duyệt (không bọc JSON).
  app.get("/v1/email/campaigns/:id/preview-html", async (req, reply) => {
    const p = await previewCampaign(currentBizId(req), String((req.params as { id: string }).id));
    return reply.header("cache-control", "no-store").header("content-security-policy", "script-src 'none'").type("text/html; charset=utf-8").send(p.html);
  });
  r.get("/v1/email/campaigns/:id/preview",({ bizId, params, query }) => previewCampaign(bizId, params.id, query.variant === "b" ? "b" : "a"));
  r.post("/v1/email/campaigns/:id/submit", ({ bizId, params, actor }) => requestCampaignApproval(bizId, params.id, actor));
  r.post("/v1/email/campaigns/:id/cancel", ({ bizId, params, actor }) => cancelCampaign(bizId, params.id, actor));
  r.post("/v1/email/campaigns/:id/test", async ({ bizId, params, body, actor }) => {
    const c = campaignOf(bizId, params.id);
    const to = z.object({ to: z.string().email("Email nhận thử không hợp lệ") }).parse(body).to;
    const content: EmailContent = c.mode === "text" ? { mode: "text", subject: c.subject, body: c.body, preheader: c.preheader } : ({ mode: c.mode, subject: c.subject, data: c.data, preheader: c.preheader } as EmailContent);
    const res = await sendTestEmail(bizId, to, content, actor);
    if (res.status !== "sent") throw new AppError("EMAIL_NOT_SENT", `Chưa gửi được: ${SKIP_REASONS[res.reason?.split(":")[0] ?? ""] ?? res.reason ?? res.status}`, 400);
    return res;
  });

  // ---- Chuỗi ----
  r.get("/v1/email/sequence-presets", () => presetList());
  r.get("/v1/email/sequences", ({ bizId }) => listSequences(bizId));
  r.post("/v1/email/sequences", ({ bizId, body, actor }) => createSequence(bizId, z.object({ name: z.string().max(160).optional(), kind: z.string().optional(), productKey: z.string().nullish(), config: SeqConfig.optional(), steps: z.number().int().min(1).max(20).optional() }).parse(body) as any, actor));
  r.get("/v1/email/sequences/:id", ({ bizId, params }) => sequenceDetail(bizId, params.id));
  r.put("/v1/email/sequences/:id", ({ bizId, params, body, actor }) => updateSequence(bizId, params.id, z.object({ name: z.string().max(160).optional(), productKey: z.string().nullish(), config: SeqConfig.optional() }).parse(body) as any, actor));
  r.del("/v1/email/sequences/:id", ({ bizId, params, actor }) => deleteSequence(bizId, params.id, actor));
  r.post("/v1/email/sequences/:id/steps", ({ bizId, params, body, actor }) => saveStep(bizId, params.id, z.object({
    id: z.string().optional(), title: z.string().max(160).optional(), delayDays: z.number().optional(), subject: z.string().max(200).optional(), preheader: z.string().max(200).nullish(),
    mode: Mode.optional(), body: z.string().max(100_000).optional(), data: z.unknown().optional(), noHardSell: z.boolean().optional(),
  }).parse(body), actor));
  r.del("/v1/email/steps/:id", ({ bizId, params, actor }) => deleteStep(bizId, params.id, actor));
  r.get("/v1/email/steps/:id/preview", ({ bizId, params }) => previewContent(bizId, stepOf(bizId, params.id)));
  r.post("/v1/email/sequences/:id/reorder", ({ bizId, params, body, actor }) => reorderSteps(bizId, params.id, z.object({ ids: z.array(z.string()) }).parse(body).ids, actor));
  r.post("/v1/email/steps/:id/generate", async ({ bizId, params, body, actor }) => generateStep(bizId, params.id, actor, z.object({ note: z.string().max(600).optional() }).parse(body ?? {}).note));
  r.post("/v1/email/sequences/:id/generate-all", ({ bizId, params, actor }) => {
    sequenceDetail(bizId, params.id);
    enqueue("agent", "email.generate", { sequenceId: params.id, actor }, { bizId, idempotencyKey: `email-gen:${params.id}:${Date.now()}`, maxAttempts: 1 });
    return { queued: true };
  });
  r.post("/v1/email/sequences/:id/score", ({ bizId, params, actor }) => scoreSequence(bizId, params.id, actor));
  r.post("/v1/email/sequences/:id/submit", ({ bizId, params, actor }) => requestSequenceActivation(bizId, params.id, actor));
  r.post("/v1/email/sequences/:id/pause", ({ bizId, params, actor }) => pauseSequence(bizId, params.id, actor));
  r.post("/v1/email/sequences/:id/enroll", ({ bizId, params, body, actor }) => {
    const ids = z.object({ contactIds: z.array(z.string()).max(5000) }).parse(body).contactIds;
    let added = 0;
    for (const id of ids) if (byId<Row>("email_contact", id) && enroll(bizId, params.id, id, actor)) added++;
    return { added };
  });
}
