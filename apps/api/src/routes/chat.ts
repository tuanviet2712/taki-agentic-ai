import { createReadStream } from "node:fs";
import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IncomingMessage } from "@dotaka/contracts";
import {
  flowHelpFor, generateSalesFlow, getSalesFlow, handback, listSalesFlows, previewFlowReply, replyAsHuman, replyWindow, saveSalesFlow,
  sendImageAsHuman, setSalesFlowStatus, transition,
} from "@dotaka/chat-engine";
import { verifyWebhook } from "@dotaka/connectors";
import { audit, byId, insert, q, update, type Row } from "@dotaka/db";
import { CHAT_MEDIA_MAX, chatMediaFile, enqueue, latestChatInsight, publicOrder, removeChatMediaFile, runChatInsight, saveOutboundChatImage } from "@dotaka/orchestrator";
import { AppError, nowIso, sha256 } from "@dotaka/shared";
import { currentBizId, routes } from "../http.ts";

export function chatRoutes(app: FastifyInstance) {
  const r = routes(app);

  r.get("/v1/conversations", ({ bizId, query }) => {
    const f = query.filter as string | undefined;
    const where = f === "handoff" ? "AND state = 'handoff_pending'" : f === "unread" ? "AND unread > 0" : f === "hot" ? "AND lead_grade = 'hot'" : "";
    const ch = query.channel ? "AND channel = ?" : "";
    return q.all(`SELECT id, channel, customer_name, state, lead_grade, lead_score, intent, tags, unread, last_message_at, last_preview, json_extract(ext, '$.flow.label') flow_stage FROM conversation WHERE biz_id = ? ${where} ${ch} ORDER BY last_message_at DESC LIMIT 100`, ...(query.channel ? [bizId, query.channel] : [bizId]));
  });
  r.get("/v1/conversations/counts", ({ bizId }) => ({
    all: q.scalar("SELECT COUNT(*) FROM conversation WHERE biz_id = ?", bizId),
    unread: q.scalar("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND unread > 0", bizId),
    handoff: q.scalar("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND state = 'handoff_pending'", bizId),
    hot: q.scalar("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND lead_grade = 'hot'", bizId),
    byChannel: q.all("SELECT channel, COUNT(*) n FROM conversation WHERE biz_id = ? GROUP BY channel", bizId),
  }));
  r.get("/v1/conversations/:id", ({ bizId, params }) => {
    const c = byId<Row>("conversation", params.id);
    if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy hội thoại", 404);
    update("conversation", c.id, { unread: 0 });
    const w = replyWindow(c); // Messenger thật: chỉ trả lời được trong 24 giờ kể từ tin cuối của khách
    return {
      ...c,
      canReply: w.canReply, replyWindowEndsAt: w.replyWindowEndsAt, replyWindowLimited: w.limited,
      suggestion: c.ext?.suggestion ?? null, flowHelp: flowHelpFor(bizId, c),
      messages: q.all("SELECT id, direction, sender, body, meta, sent_at FROM message WHERE conversation_id = ? ORDER BY sent_at", c.id),
      lead: q.get("SELECT * FROM lead WHERE conversation_id = ?", c.id),
      attribution: q.all<Row>("SELECT al.*, a.name ad_name, p.title post_title FROM attribution_link al LEFT JOIN ad a ON a.id = al.ad_id LEFT JOIN post p ON p.id = al.post_id WHERE al.conversation_id = ? ORDER BY confidence DESC", c.id),
      // publicOrder: bỏ SĐT mã hoá (meta.shipping.phoneCipher) khỏi mọi phản hồi.
      orders: q.all<Row>("SELECT * FROM orders WHERE conversation_id = ? ORDER BY created_at DESC", c.id).map(publicOrder),
      followUps: q.all("SELECT * FROM follow_up_plan WHERE conversation_id = ?", c.id),
      judgments: q.all("SELECT id, purpose, source, model, answers, decision, latency_ms, created_at FROM jev_judgment WHERE subject_type = 'conversation' AND subject_id = ? ORDER BY created_at DESC LIMIT 12", c.id),
    };
  });
  r.post("/v1/conversations/:id/reply", async ({ bizId, params, body, actor }) => {
    const text = z.object({ text: z.string().min(1).max(2000) }).parse(body).text;
    await replyAsHuman(bizId, params.id, text, actor);
  });
  // ---------------- Ảnh trong hội thoại ----------------
  // Nhân viên gửi ảnh: thân yêu cầu = byte ảnh (image/*, ≤ 8MB, kiểm theo byte đầu tệp). Chỉ Messenger qua Fanpage thật.
  app.register(async (scope) => {
    // image/* only: `application/octet-stream` already has the app-wide streaming parser of the video upload (routes/creative.ts).
    scope.addContentTypeParser(["image/jpeg", "image/png", "image/gif", "image/webp"], { parseAs: "buffer", bodyLimit: CHAT_MEDIA_MAX }, (_req, body, done) => done(null, body));
    routes(scope).post("/v1/conversations/:id/image", async ({ bizId, params, body, query, actor }) => {
      const c = byId<Row>("conversation", params.id);
      if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy hội thoại", 404);
      if (!Buffer.isBuffer(body)) throw new AppError("BAD_BODY", "Gửi tệp ảnh (jpg, png, gif, webp) làm nội dung yêu cầu", 400);
      const img = saveOutboundChatImage(bizId, body);
      const name = typeof query?.name === "string" ? basename(query.name).slice(-80) : undefined;
      try {
        const r = await sendImageAsHuman(bizId, c.id, { path: img.path, mime: img.mime, name, size: img.size, stored: img.name }, actor);
        audit(bizId, actor, "chat.image_sent", { type: "conversation", id: c.id }, { size: img.size, mime: img.mime });
        return r;
      } catch (e) {
        removeChatMediaFile(bizId, img.name); // chưa gửi được → không giữ tệp mồ côi
        throw e;
      }
    });
  });
  // Xem ảnh đã lưu của 1 tin (ảnh khách gửi đã tải về / ảnh nhân viên gửi). Chỉ theo mã tin + thứ tự, đúng doanh nghiệp.
  app.get("/v1/chat/media/:messageId/:index", async (req, reply) => {
    const prm = req.params as Row;
    const f = chatMediaFile(currentBizId(req), String(prm.messageId), Number(prm.index));
    if (!f) return reply.status(404).send({ code: "NOT_FOUND", message: "Không thấy ảnh" });
    reply.type(f.mime).header("cache-control", "private, max-age=86400").header("x-content-type-options", "nosniff");
    return reply.send(createReadStream(f.path));
  });
  r.post("/v1/conversations/:id/handback", ({ bizId, params, actor }) => handback(bizId, params.id, actor));
  r.post("/v1/conversations/:id/resolve", ({ bizId, params, actor }) => {
    const c = byId<Row>("conversation", params.id);
    if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy hội thoại", 404);
    transition(c, "resolved", actor);
  });
  r.post("/v1/conversations/:id/order", ({ bizId, params, body, actor }) => {
    const c = byId<Row>("conversation", params.id);
    if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy hội thoại", 404);
    const p = z.object({ product: z.string(), total: z.number().int().nonnegative(), productKey: z.string().max(120).optional() }).parse(body);
    const src = q.get<Row>("SELECT source FROM attribution_link WHERE conversation_id = ? ORDER BY confidence DESC LIMIT 1", c.id);
    // Đơn ghi tay: chỉ là bản ghi nội bộ — không qua cổng duyệt nên KHÔNG BAO GIỜ được đẩy sang Pancake (thiếu meta.approvalId).
    const o = insert("orders", { biz_id: bizId, conversation_id: c.id, customer_name: c.customer_name, product: p.product, product_key: p.productKey ?? null, total: p.total, status: "pending", source: src?.source ?? null });
    audit(bizId, actor, "order.draft_created", { type: "orders", id: o.id }, p);
    return publicOrder(o);
  });
  r.get("/v1/leads", ({ bizId }) => q.all("SELECT l.*, c.channel, c.state FROM lead l JOIN conversation c ON c.id = l.conversation_id WHERE l.biz_id = ? ORDER BY l.score DESC", bizId));
  r.get("/v1/orders", ({ bizId }) => q.all<Row>("SELECT * FROM orders WHERE biz_id = ? ORDER BY created_at DESC LIMIT 100", bizId).map(publicOrder));

  // ---------------- Kịch bản chốt đơn (Messenger + Zalo) theo sản phẩm trong DNA ----------------
  r.get("/v1/sales-flows", ({ bizId }) => listSalesFlows(bizId));
  r.get("/v1/sales-flows/:key", ({ bizId, params }) => getSalesFlow(bizId, params.key));
  r.post("/v1/sales-flows/:key/generate", ({ bizId, params, body, actor }) => {
    const p = z.object({ note: z.string().max(1000).optional(), objective: z.enum(["link", "phone_order", "phone_consult"]).optional() }).parse(body ?? {});
    return generateSalesFlow(bizId, params.key, actor, p.note, p.objective);
  });
  r.put("/v1/sales-flows/:key", ({ bizId, params, body, actor }) => saveSalesFlow(bizId, params.key, z.object({ flow: z.unknown(), status: z.enum(["draft", "active", "paused"]).optional() }).parse(body), actor));
  r.post("/v1/sales-flows/:key/status", ({ bizId, params, body, actor }) => setSalesFlowStatus(bizId, params.key, z.object({ status: z.enum(["active", "paused"]) }).parse(body).status, actor));
  // Chat thử: Sếp đóng vai khách — KHÔNG gửi tin cho ai, không tạo hội thoại.
  r.post("/v1/sales-flows/:key/try", ({ bizId, params, body }) => previewFlowReply(bizId, params.key, z.object({
    flow: z.unknown().optional(), messages: z.array(z.object({ from: z.enum(["customer", "bot"]), text: z.string().min(1).max(2000) })).min(1).max(30),
  }).parse(body)));

  // Vòng lặp Thấu hiểu khách (7 bước) → insight + đề xuất sửa kịch bản (chờ duyệt ở hộp Duyệt / tab Thấu hiểu khách).
  r.get("/v1/chat-insights/latest", ({ bizId }) => latestChatInsight(bizId));
  r.post("/v1/chat-insights/run", ({ bizId, body, actor }) => {
    const p = z.object({ days: z.number().int().min(1).max(180).optional(), includeTest: z.boolean().optional() }).parse(body ?? {});
    return runChatInsight(bizId, { ...p, actor });
  });

  /** Dev helper: simulate an inbound customer message through the SAME webhook path. */
  r.post("/v1/simulate/message", ({ bizId, body }) => {
    const msg = IncomingMessage.parse({ ...body, messageId: body.messageId ?? `sim_${Date.now()}` });
    return ingest(bizId, "simulator", msg, true);
  });

  // ---------------- Webhook receiver (spec §6): verify -> raw_event -> ack -> queue ----------------
  app.post("/hooks/:platform", async (req, reply) => {
    const platform = (req.params as Row).platform as string;
    const raw = JSON.stringify(req.body ?? {});
    const ok = verifyWebhook(raw, req.headers["x-signature"] as string | undefined);
    const payload = req.body as Row;
    const dedupe = `${platform}:${payload?.messageId ?? sha256(raw)}`;
    if (q.get("SELECT id FROM raw_event WHERE dedupe_key = ?", dedupe)) return reply.send({ ok: true, duplicate: true });
    insert("raw_event", { platform, received_at: nowIso(), signature_ok: ok ? 1 : 0, payload, dedupe_key: dedupe });
    if (!ok) return reply.status(401).send({ code: "BAD_SIGNATURE", message: "Chữ ký webhook không hợp lệ" });
    const parsed = IncomingMessage.safeParse(payload);
    if (parsed.success) {
      const bizId = q.get<Row>("SELECT id FROM biz ORDER BY created_at LIMIT 1")!.id;
      ingest(bizId, platform, parsed.data, false);
    }
    return reply.send({ ok: true });
  });
}

function ingest(bizId: string, platform: string, msg: IncomingMessage, fromSimulator: boolean) {
  if (fromSimulator) insert("raw_event", { platform, received_at: nowIso(), signature_ok: 1, payload: msg, dedupe_key: `${platform}:${msg.messageId}` });
  // Per-conversation lock key => one turn at a time per conversation, parallel across conversations.
  const jobId = enqueue("chat", "chat.ingest", { bizId, msg }, { bizId, idempotencyKey: `ingest:${msg.channel}:${msg.messageId}`, lockKey: `conv:${msg.channel}:${msg.externalConversationId}`, maxAttempts: 3 });
  return { queued: true, jobId };
}
