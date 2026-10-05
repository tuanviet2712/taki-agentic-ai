import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateGoal, DecideApproval } from "@dotaka/contracts";
import { retrieve } from "@dotaka/chat-engine";
import { activeDna, audit, byId, insert, q, update, type Row } from "@dotaka/db";
import { judge, norm, passageHeuristic, passageQuestions } from "@dotaka/jev";
import { chromeLock, createGoal, decideApproval, enqueue, learnDaily, retryPublishJob, retryTask, schedulePublish } from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { routes } from "../http.ts";

const DNA_SECTIONS = ["company", "positioning", "audience", "products", "offers", "voice", "differentiators", "channels", "goals", "forbiddenClaims"];

export function workRoutes(app: FastifyInstance) {
  const r = routes(app);

  // ---------------- DNA (versioned) ----------------
  r.get("/v1/dna", ({ bizId }) => {
    const dna = activeDna(bizId);
    const data = dna?.data ?? {};
    const filled = DNA_SECTIONS.filter((k) => {
      const v = data[k];
      return Array.isArray(v) ? v.length > 0 : v && (typeof v !== "object" || Object.keys(v).length > 0);
    });
    const unverified = (data.products ?? []).filter((p: Row) => p.sample || p.verified === false).length;
    const pending = (data.pendingConfirmations ?? []) as string[];
    return {
      ...dna, sections: DNA_SECTIONS.map((k) => ({ key: k, done: filled.includes(k) })),
      completeness: Math.max(0, Math.round((filled.length / DNA_SECTIONS.length) * 100 - Math.min(30, pending.length * 4))),
      warnings: [
        ...(unverified ? [`${unverified} sản phẩm chưa có giá/mô tả xác nhận: agent sẽ ghi "liên hệ" thay vì đưa con số.`] : []),
        ...pending.map((x) => `⚠️ Cần CEO xác nhận: ${x}`),
      ],
      source: dna?.created_by ?? null,
      versions: q.all("SELECT id, version, status, created_by, created_at FROM dna_profile WHERE biz_id = ? ORDER BY version DESC", bizId),
    };
  });
  r.put("/v1/dna", ({ bizId, body, actor }) => {
    const cur = activeDna(bizId);
    const data = { ...(cur?.data ?? {}), ...z.record(z.string(), z.unknown()).parse(body.data ?? body) };
    q.run("UPDATE dna_profile SET status = 'archived' WHERE biz_id = ? AND status = 'active'", bizId);
    const row = insert("dna_profile", { biz_id: bizId, version: (cur?.version ?? 0) + 1, status: "active", data, created_by: actor });
    audit(bizId, actor, "dna.updated", { type: "dna_profile", id: row.id }, { version: row.version, sections: Object.keys(body.data ?? body) });
    return row;
  });

  // ---------------- Goals, plans, calendar ----------------
  r.get("/v1/goals", ({ bizId }) => q.all<Row>("SELECT * FROM goal WHERE biz_id = ? ORDER BY created_at DESC", bizId).map((g) => ({
    ...g,
    tasks: q.all("SELECT id, agent_key, title, status, progress, step, revisions, updated_at FROM task WHERE goal_id = ? ORDER BY created_at", g.id),
    strategy: q.get<Row>("SELECT output FROM task WHERE goal_id = ? AND agent_key = 'strategy' AND output IS NOT NULL", g.id)?.output ?? null,
    brief: q.get<Row>("SELECT output FROM task WHERE goal_id = ? AND agent_key = 'brief' AND output IS NOT NULL", g.id)?.output ?? null,
  })));
  r.post("/v1/goals", ({ bizId, body }) => createGoal(bizId, CreateGoal.parse(body)));
  r.get("/v1/calendar", ({ bizId, query }) => {
    const from = query.from ?? new Date(Date.now() - 7 * 86400_000).toISOString();
    const to = query.to ?? new Date(Date.now() + 21 * 86400_000).toISOString();
    return {
      items: q.all(`SELECT c.id, c.title, c.kind, c.channel, c.status, COALESCE(c.scheduled_at, p.published_at, c.created_at) at, p.id post_id
        FROM content_item c LEFT JOIN post p ON p.content_item_id = c.id WHERE c.biz_id = ? AND COALESCE(c.scheduled_at, p.published_at, c.created_at) BETWEEN ? AND ? ORDER BY at`, bizId, from, to),
      posts: q.all("SELECT p.id, p.title, p.kind, p.published_at at, c.platform channel FROM post p JOIN channel c ON c.id = p.channel_id WHERE p.biz_id = ? AND p.published_at BETWEEN ? AND ? ORDER BY p.published_at", bizId, from, to),
    };
  });

  // ---------------- Tasks ----------------
  r.get("/v1/tasks", ({ bizId, query }) => q.all(
    `SELECT t.*, (SELECT COUNT(*) FROM task_run r WHERE r.task_id = t.id) runs FROM task t WHERE t.biz_id = ? ${query.status ? "AND t.status = ?" : ""} ORDER BY t.updated_at DESC LIMIT 100`,
    ...(query.status ? [bizId, query.status] : [bizId]),
  ));
  r.get("/v1/tasks/:id", ({ bizId, params }) => {
    const t = byId<Row>("task", params.id);
    if (!t || t.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy task", 404);
    const ci = q.get<Row>("SELECT * FROM content_item WHERE task_id = ?", t.id);
    return {
      ...t, runs: q.all("SELECT * FROM task_run WHERE task_id = ? ORDER BY created_at", t.id),
      content: ci, review: ci?.review_score_id ? byId("review_score", ci.review_score_id) : q.get("SELECT * FROM review_score WHERE subject_id = ? ORDER BY created_at DESC LIMIT 1", t.id),
      history: q.all("SELECT * FROM audit_log WHERE ref_id = ? ORDER BY at", t.id),
    };
  });
  r.post("/v1/tasks/:id/retry", ({ bizId, params }) => retryTask(bizId, params.id));
  r.post("/v1/tasks/:id/cancel", ({ bizId, params, actor }) => {
    const t = byId<Row>("task", params.id);
    if (!t || t.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy task", 404);
    update("task", t.id, { status: "cancelled", step: null });
    audit(bizId, actor, "task.cancelled", { type: "task", id: t.id });
  });

  // ---------------- Approvals ----------------
  r.get("/v1/approvals", ({ bizId, query }) => q.all(
    `SELECT a.*, r.total review_total, r.verdict review_verdict FROM approval a LEFT JOIN review_score r ON r.id = a.review_score_id
     WHERE a.biz_id = ? AND a.status = ? ${query.type ? "AND a.subject_type = ?" : ""} ORDER BY a.created_at DESC LIMIT 100`,
    ...(query.type ? [bizId, query.status ?? "pending", query.type] : [bizId, query.status ?? "pending"]),
  ));
  r.get("/v1/approvals/stats", ({ bizId }) => ({
    pending: q.scalar("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'pending'", bizId),
    approved: q.scalar("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status IN ('approved','edited')", bizId),
    rejected: q.scalar("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'rejected'", bizId),
    avgMinutes: q.scalar("SELECT AVG((julianday(decided_at) - julianday(created_at)) * 1440) FROM approval WHERE biz_id = ? AND decided_at IS NOT NULL", bizId),
    byType: q.all("SELECT subject_type, COUNT(*) n FROM approval WHERE biz_id = ? AND status = 'pending' GROUP BY 1", bizId),
  }));
  r.get("/v1/approvals/:id", ({ bizId, params }) => {
    const a = byId<Row>("approval", params.id);
    if (!a || a.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy mục duyệt", 404);
    let subject: Row | undefined;
    if (a.subject_type === "task") {
      const t = byId<Row>("task", a.subject_id);
      subject = { task: t, content: q.get("SELECT * FROM content_item WHERE task_id = ?", a.subject_id) };
    } else if (a.subject_type === "ad_candidate") {
      const c = byId<Row>("ad_candidate", a.subject_id)!;
      subject = { candidate: c, post: byId("post", c.post_id), score: q.get("SELECT * FROM post_score WHERE post_id = ? ORDER BY computed_at DESC LIMIT 1", c.post_id), comments: q.all("SELECT text, label, label_source, label_confidence FROM post_comment WHERE post_id = ?", c.post_id) };
    } else if (a.subject_type === "action") subject = { action: byId("action", a.subject_id) };
    else if (a.subject_type === "creative_job") {
      const j = byId<Row>("creative_job", a.subject_id)!;
      subject = { job: j, asset: j.asset_id ? byId("creative_asset", j.asset_id) : null, content: j.content_item_id ? byId("content_item", j.content_item_id) : null };
    } else subject = { proposal: byId("change_proposal", a.subject_id) };
    const review = a.review_score_id ? byId<Row>("review_score", a.review_score_id) : null;
    const jevId = review ? q.get<Row>("SELECT id FROM jev_judgment WHERE subject_id = ? AND purpose = 'review.content' ORDER BY created_at DESC LIMIT 1", review.subject_id)?.id : null;
    return {
      ...a, subject, review, jevJudgment: jevId ? byId("jev_judgment", jevId) : null,
      history: q.all("SELECT at, actor, event, data FROM audit_log WHERE biz_id = ? AND ref_id IN (?, ?) ORDER BY at", bizId, a.subject_id, a.id),
    };
  });
  r.post("/v1/approvals/:id/decide", async ({ bizId, params, body, actor }) => {
    const p = DecideApproval.parse(body);
    return decideApproval(bizId, params.id, p.decision, p.note, typeof p.editedOutput === "string" ? p.editedOutput : undefined, actor);
  });
  r.post("/v1/approvals/bulk-decide", async ({ bizId, body, actor }) => {
    const p = z.object({ ids: z.array(z.string()).min(1).max(50), decision: z.enum(["approve", "reject"]), note: z.string().optional() }).parse(body);
    const out: Row[] = [];
    for (const id of p.ids) {
      try { out.push({ id, ...(await decideApproval(bizId, id, p.decision, p.note, undefined, actor)) }); } catch (e) { out.push({ id, error: String(e) }); }
    }
    return out;
  });

  // ---------------- Content ----------------
  r.get("/v1/content", ({ bizId, query }) => q.all(
    `SELECT c.*, r.total review_total, r.verdict review_verdict FROM content_item c LEFT JOIN review_score r ON r.id = c.review_score_id
     WHERE c.biz_id = ? ${query.status ? "AND c.status = ?" : ""} ${query.kind ? "AND c.kind = ?" : ""} ORDER BY c.updated_at DESC LIMIT 100`,
    ...[bizId, query.status, query.kind].filter(Boolean),
  ));
  r.get("/v1/content/stats", ({ bizId }) => ({
    ideas: q.scalar("SELECT COUNT(*) FROM task WHERE biz_id = ? AND agent_key IN ('content','video_script','seo_web')", bizId),
    drafts: q.scalar("SELECT COUNT(*) FROM content_item WHERE biz_id = ? AND status IN ('in_review','awaiting_approval','blocked')", bizId),
    approved: q.scalar("SELECT COUNT(*) FROM content_item WHERE biz_id = ? AND status IN ('approved','scheduled')", bizId),
    published: q.scalar("SELECT COUNT(*) FROM content_item WHERE biz_id = ? AND status = 'published'", bizId) + q.scalar("SELECT COUNT(*) FROM post WHERE biz_id = ? AND content_item_id IS NULL", bizId),
    pillars: q.all("SELECT json_extract(input,'$.item.funnel') funnel, COUNT(*) n FROM task WHERE biz_id = ? AND agent_key IN ('content','video_script') GROUP BY 1", bizId),
  }));
  r.get("/v1/content/:id", ({ bizId, params }) => {
    const c = byId<Row>("content_item", params.id);
    if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
    return { ...c, review: c.review_score_id ? byId("review_score", c.review_score_id) : null, task: c.task_id ? byId("task", c.task_id) : null, approval: q.get("SELECT id, status FROM approval WHERE subject_id = ? ORDER BY created_at DESC LIMIT 1", c.task_id) };
  });
  r.put("/v1/content/:id", ({ bizId, params, body, actor }) => {
    const c = byId<Row>("content_item", params.id);
    if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
    const p = z.object({ title: z.string().optional(), body: z.string().min(1) }).parse(body);
    update("content_item", c.id, p);
    insert("exemplar", { biz_id: bizId, agent_key: c.agent_key, kind: "ceo_edit", text: `${c.title}\nTRƯỚC: ${String(c.body).slice(0, 400)}\nSAU: ${p.body.slice(0, 400)}`, outcome: "manual_edit" }); // edit = learning signal
    audit(bizId, actor, "content.edited", { type: "content_item", id: c.id });
    return byId("content_item", c.id);
  });
  r.post("/v1/content/:id/regenerate", ({ bizId, params }) => {
    const c = byId<Row>("content_item", params.id);
    if (!c?.task_id) throw new AppError("NOT_FOUND", "Nội dung không gắn task", 404);
    const t = byId<Row>("task", c.task_id)!;
    if (["awaiting_approval"].includes(t.status)) {
      q.run("UPDATE approval SET status = 'cancelled' WHERE subject_id = ? AND status = 'pending'", t.id);
      update("task", t.id, { status: "failed" });
    }
    retryTask(bizId, t.id);
  });
  r.post("/v1/content/:id/publish-now", ({ bizId, params }) => {
    const c = byId<Row>("content_item", params.id);
    if (!c || !["approved", "scheduled", "manual_publish"].includes(c.status)) throw new AppError("NOT_APPROVED", "Chỉ đăng được nội dung đã duyệt");
    const existing = q.get<Row>("SELECT * FROM publish_job WHERE content_item_id = ? AND status = 'scheduled'", c.id);
    if (existing) { enqueue("publish", "publish.run", { publishJobId: existing.id }, { bizId, idempotencyKey: `pubnow:${existing.id}`, lockKey: chromeLock(byId<Row>("channel", existing.channel_id)!) }); return existing; }
    return schedulePublish(bizId, c.id, { now: true });
  });
  r.post("/v1/publish-jobs/:id/retry", ({ bizId, params, actor }) => retryPublishJob(bizId, params.id, actor));
  r.get("/v1/publish-jobs", ({ bizId }) => q.all(`SELECT j.*, c.title, c.channel, c.body, c.kind FROM publish_job j JOIN content_item c ON c.id = j.content_item_id WHERE j.biz_id = ? ORDER BY j.scheduled_at DESC LIMIT 50`, bizId));

  // ---------------- Knowledge (RAG) ----------------
  r.get("/v1/knowledge/docs", ({ bizId }) => q.all<Row>("SELECT * FROM knowledge_doc WHERE biz_id = ? ORDER BY updated_at DESC", bizId).map((d) => ({ ...d, chunks: q.scalar("SELECT COUNT(*) FROM knowledge_chunk WHERE doc_id = ?", d.id) })));
  r.post("/v1/knowledge/docs", ({ bizId, body, actor }) => {
    const p = z.object({ title: z.string().min(2), kind: z.string().default("doc"), source: z.string().default("Tải lên trực tiếp"), tags: z.array(z.string()).default([]), body: z.string().min(10), validUntil: z.string().optional() }).parse(body);
    const doc = insert("knowledge_doc", { biz_id: bizId, title: p.title, kind: p.kind, source: p.source, tags: p.tags, body: p.body, status: "processed" });
    p.body.split(/\n+/).map((s) => s.trim()).filter(Boolean).forEach((text, idx) => insert("knowledge_chunk", { biz_id: bizId, doc_id: doc.id, idx, text, source_ref: `${doc.id.slice(-6)}#${idx}`, valid_until: p.validUntil ?? null }));
    audit(bizId, actor, "knowledge.added", { type: "knowledge_doc", id: doc.id }, { title: p.title });
    return doc;
  });
  r.put("/v1/knowledge/docs/:id", ({ bizId, params, body, actor }) => {
    const d = byId<Row>("knowledge_doc", params.id);
    if (!d || d.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy tài liệu", 404);
    const text = z.object({ body: z.string().min(10) }).parse(body).body;
    update("knowledge_doc", d.id, { body: text, status: "processed" });
    q.run("DELETE FROM knowledge_chunk WHERE doc_id = ?", d.id);
    text.split(/\n+/).map((s) => s.trim()).filter(Boolean).forEach((t, idx) => insert("knowledge_chunk", { biz_id: bizId, doc_id: d.id, idx, text: t, source_ref: `${d.id.slice(-6)}#${idx}` }));
    audit(bizId, actor, "knowledge.updated", { type: "knowledge_doc", id: d.id });
    return byId("knowledge_doc", d.id);
  });
  r.post("/v1/knowledge/search", async ({ bizId, body }) => {
    const query = z.object({ query: z.string().min(2) }).parse(body).query;
    const cands = retrieve(bizId, query, 8);
    if (!cands.length) return { results: [], answerable: false };
    const j = await judge({ bizId, purpose: "rag.select", state: { question: query, passages: cands.map((c) => ({ ref: c.ref, text: c.text })) }, questions: passageQuestions(cands.length), heuristic: passageHeuristic });
    const results = cands.map((c, i) => ({ ...c, relevance: Math.round(norm((j.answers as any)[`p${i}`]) * 100), confidence: (j.answers as any)[`p${i}`].confidence })).sort((a, b) => b.relevance - a.relevance);
    return { results, answerable: (j.answers as any).answerable.noul, source: j.source, judgmentId: j.id };
  });

  // ---------------- Learning ----------------
  r.get("/v1/lessons", ({ bizId }) => q.all("SELECT * FROM lesson WHERE biz_id = ? ORDER BY created_at DESC", bizId));
  r.get("/v1/exemplars", ({ bizId }) => q.all("SELECT * FROM exemplar WHERE biz_id = ? ORDER BY created_at DESC LIMIT 50", bizId));
  r.get("/v1/change-proposals", ({ bizId }) => q.all("SELECT * FROM change_proposal WHERE biz_id = ? ORDER BY created_at DESC", bizId));
  r.post("/v1/learn/run", ({ bizId }) => learnDaily(bizId));
}
