import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateGoal, DecideApproval } from "@dotaka/contracts";
import { retrieve } from "@dotaka/chat-engine";
import { activeDna, audit, byId, insert, q, update, type Row } from "@dotaka/db";
import { judge, norm, passageHeuristic, passageQuestions } from "@dotaka/jev";
import { approvalChannelReadiness, approveTask, assertPublishable, publishChannelFor, assignAgentTask, assignedOverview, recordDispatch, blankDna, continueGoal, createGoal, decideApproval, documentText, editedTextIssues, draftDnaFromText, dnaSourceText, enqueuePublishNow, findLinkProduct, learnDaily, linkCommentPreview, regenerateContent, reopenContentApproval, retryPublishJob, changePublishChannel, deleteContent, resyncRefusedJobs, retryTask, saveDna, schedulePublish, createPostImage, postImageView, removePostImage, setPostImageFromUpload, queueSeoImages, inferGoalRequest, autoApprovePending, autoApproveView, setAutoApprove, seoImagesView, buildSeoExport, syncSeoFeatured, isSeoArticle, publishWebsiteDraft, websiteDraftOf } from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { currentBizId, routes } from "../http.ts";

const DNA_SECTIONS = ["company", "positioning", "audience", "products", "offers", "voice", "spokesperson", "cta", "differentiators", "channels", "goals", "forbiddenClaims"];

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
  r.put("/v1/dna", ({ bizId, body, actor }) => saveDna(bizId, z.record(z.string(), z.unknown()).parse(body.data ?? body), actor));
  // Nạp DNA cho doanh nghiệp bất kỳ: tài liệu (dán / tải file) → DNA Agent soạn bản nháp → Sếp xem rồi mới lưu.
  r.post("/v1/dna/draft", async ({ bizId, body }) => {
    const p = z.object({ text: z.string().max(200_000).optional(), path: z.string().optional(), website: z.string().max(300).optional() }).parse(body);
    const text = [p.path ? documentText(p.path) : "", p.text ?? ""].filter(Boolean).join("\n\n");
    // Link website → tải nội dung thật các trang chính (trước đây AI chỉ nhận được chuỗi URL).
    const src = await dnaSourceText(text, p.website);
    return { ...(await draftDnaFromText(bizId, src.text)), pages: src.pages };
  });
  r.post("/v1/dna/import", ({ bizId, body, actor }) => {
    const p = z.object({ data: z.record(z.string(), z.unknown()), replace: z.boolean().default(true), source: z.string().max(60).optional() }).parse(body);
    return saveDna(bizId, (p.data.dna ?? p.data) as Row, actor, { replace: p.replace, source: p.source ?? "import" });
  });
  r.post("/v1/dna/blank", ({ bizId, actor }) => saveDna(bizId, blankDna(), actor, { replace: true, source: "blank" }));
  r.get("/v1/dna/export", ({ bizId }) => ({ kind: "agentic-dna", version: 1, exportedAt: new Date().toISOString(), dna: activeDna(bizId)?.data ?? {} }));

  // ---------------- Goals, plans, calendar ----------------
  r.get("/v1/goals", ({ bizId }) => q.all<Row>("SELECT * FROM goal WHERE biz_id = ? ORDER BY created_at DESC", bizId).map((g) => ({
    ...g,
    tasks: q.all("SELECT id, agent_key, title, status, progress, step, revisions, updated_at FROM task WHERE goal_id = ? ORDER BY created_at", g.id),
    strategy: q.get<Row>("SELECT output FROM task WHERE goal_id = ? AND agent_key = 'strategy' AND output IS NOT NULL", g.id)?.output ?? null,
    brief: q.get<Row>("SELECT output FROM task WHERE goal_id = ? AND agent_key = 'brief' AND output IS NOT NULL", g.id)?.output ?? null,
  })));
  r.post("/v1/goals", ({ bizId, body, actor }) => {
    const { stopAfter, product, contentCount, contentKind, ...p } = CreateGoal.parse(body);
    // "10 bài SEO", "10 kịch bản video"…: số lượng + loại nội dung lấy từ yêu cầu của Sếp nếu không điền riêng.
    const asked = inferGoalRequest(`${p.title}
${p.description}`);
    if (stopAfter === "market_research" && p.template !== "launch_campaign") throw new AppError("BAD_STOP", "Mẫu Nội dung tuần không có bước Nghiên cứu — chọn mẫu Ra mắt chiến dịch hoặc dừng sau Brief / Kế hoạch");
    // Sản phẩm của chiến dịch (tuỳ chọn): lưu KEY sản phẩm trong DNA → link dưới bình luận của bài thuộc chiến dịch này.
    let productKey: string | undefined;
    if (product) {
      const hit = findLinkProduct(bizId, product);
      if (!hit) throw new AppError("BAD_PRODUCT", "Sản phẩm không có trong Mục tiêu & DNA — chọn lại hoặc để trống");
      productKey = hit.key;
    }
    return createGoal(bizId, { ...p, contentCount: contentCount ?? asked.count, contentKind: contentKind ?? asked.kind, params: { ...(stopAfter ? { stopAfter } : {}), ...(productKey ? { product: productKey } : {}) } }, actor);
  });
  r.post("/v1/goals/:id/continue", ({ bizId, params, actor }) => continueGoal(bizId, params.id, actor));
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
  // Giao việc riêng cho từng agent (xong bước đó là dừng) — trang Agent & Tác vụ + Ngân Nguyệt (giao_viec_rieng).
  r.get("/v1/agents/assigned", ({ bizId }) => assignedOverview(bizId));
  r.post("/v1/agents/assign", async ({ bizId, body, actor }) => {
    const r0 = await assignAgentTask(bizId, body, actor);
    const threadId = (body as Row)?.threadId;
    if (r0.kind === "task") recordDispatch(bizId, { threadId: typeof threadId === "string" ? threadId : null, kind: r0.agent, refType: "task", refId: r0.taskId, title: r0.title });
    return r0;
  });
  r.post("/v1/tasks/:id/retry", ({ bizId, params, actor }) => retryTask(bizId, params.id, actor));
  r.post("/v1/tasks/:id/cancel", ({ bizId, params, actor }) => {
    const t = byId<Row>("task", params.id);
    if (!t || t.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy task", 404);
    update("task", t.id, { status: "cancelled", step: null });
    audit(bizId, actor, "task.cancelled", { type: "task", id: t.id });
  });

  // ---------------- Approvals ----------------
  // channelBlocked: kênh sẽ đăng chưa sẵn sàng → hộp Duyệt báo trước "duyệt xong CHƯA lên kênh".
  r.get("/v1/approvals", ({ bizId, query }) => q.all<Row>(
    `SELECT a.*, r.total review_total, r.verdict review_verdict FROM approval a LEFT JOIN review_score r ON r.id = a.review_score_id
     WHERE a.biz_id = ? AND a.status = ? ${query.type ? "AND a.subject_type = ?" : ""} ORDER BY a.created_at DESC LIMIT 100`,
    ...(query.type ? [bizId, query.status ?? "pending", query.type] : [bizId, query.status ?? "pending"]),
  ).map((a) => (a.status === "pending" ? { ...a, ...approvalChannelReadiness(a) } : a)));
  r.get("/v1/approvals/stats", ({ bizId }) => ({
    pending: q.scalar("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'pending'", bizId),
    approved: q.scalar("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status IN ('approved','edited')", bizId),
    rejected: q.scalar("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'rejected'", bizId),
    avgMinutes: q.scalar("SELECT AVG((julianday(decided_at) - julianday(created_at)) * 1440) FROM approval WHERE biz_id = ? AND decided_at IS NOT NULL", bizId),
    byType: q.all("SELECT subject_type, COUNT(*) n FROM approval WHERE biz_id = ? AND status = 'pending' GROUP BY 1", bizId),
  }));
  // Tự động phê duyệt nội dung / video đạt ngưỡng điểm (Sếp bật tay). Chỉ mục duyệt MỚI; mục đang chờ thì bấm "Duyệt ngay".
  r.get("/v1/auto-approve", ({ bizId }) => autoApproveView(bizId));
  r.put("/v1/auto-approve", ({ bizId, body, actor }) => {
    const p = z.object({ enabled: z.boolean().optional(), minScore: z.number().min(70).max(100).optional() }).refine((v) => v.enabled !== undefined || v.minScore !== undefined, "Thiếu giá trị cần đổi").parse(body);
    return setAutoApprove(bizId, p, actor);
  });
  r.post("/v1/auto-approve/run", async ({ bizId, actor }) => {
    const out = await autoApprovePending(bizId);
    audit(bizId, actor, "auto_approve.run_pending", { type: "biz", id: bizId }, { approved: out.approved, skipped: out.skipped.length });
    return { ...out, view: autoApproveView(bizId) };
  });
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
    } else if (a.subject_type === "order_draft") {
      // Đơn nháp chốt từ chat: hội thoại + hồ sơ khách + vài tin gần nhất để Sếp điền phiếu lên đơn (cùng dữ liệu trang Chat đã có).
      subject = {
        conversation: byId("conversation", a.subject_id), lead: q.get("SELECT * FROM lead WHERE conversation_id = ?", a.subject_id),
        messages: q.all("SELECT direction, sender, body, sent_at FROM message WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 8", a.subject_id),
      };
    } else subject = { proposal: byId("change_proposal", a.subject_id) };
    // Lượt đăng / đăng nháp lỗi của nội dung này: hiện ngay trên mục duyệt (vì sao bài chưa lên kênh).
    const ciId = (subject?.content as Row | undefined)?.id;
    // Bình luận link sản phẩm sẽ được TỰ gắn sau khi đăng (Facebook + biết sản phẩm): Sếp thấy trước khi duyệt.
    if (subject && a.status === "pending" && subject.content) subject.linkComment = linkCommentPreview(subject.content as Row);
    // Ảnh đi kèm bài viết: Sếp duyệt cả chữ lẫn ảnh (đọc bản mới nhất của bài, không phải ảnh lúc tạo mục duyệt).
    if (subject?.content) { subject.image = postImageView(subject.content as Row); subject.seoImages = seoImagesView(subject.content as Row); }
    if (subject && ciId) subject.publishErrors = q.all(`SELECT p.id, p.status, p.mode, p.error, c.platform, c.name FROM publish_job p JOIN channel c ON c.id = p.channel_id
      WHERE p.content_item_id = ? AND p.status IN ('failed','needs_check','needs_setup') AND p.error IS NOT NULL ORDER BY p.created_at DESC LIMIT 5`, ciId);
    const review = a.review_score_id ? byId<Row>("review_score", a.review_score_id) : null;
    const jevId = review ? q.get<Row>("SELECT id FROM jev_judgment WHERE subject_id = ? AND purpose = 'review.content' ORDER BY created_at DESC LIMIT 1", review.subject_id)?.id : null;
    return {
      ...a, ...(a.status === "pending" ? approvalChannelReadiness(a) : {}), subject, review, jevJudgment: jevId ? byId("jev_judgment", jevId) : null,
      history: q.all("SELECT at, actor, event, data FROM audit_log WHERE biz_id = ? AND ref_id IN (?, ?) ORDER BY at", bizId, a.subject_id, a.id),
    };
  });
  r.post("/v1/approvals/:id/decide", async ({ bizId, params, body, actor }) => {
    const p = DecideApproval.parse(body);
    return decideApproval(bizId, params.id, p.decision, p.note, typeof p.editedOutput === "string" ? p.editedOutput : undefined, actor, { orderForm: p.orderForm });
  });
  r.post("/v1/approvals/bulk-decide", async ({ bizId, body, actor }) => {
    const p = z.object({ ids: z.array(z.string()).min(1).max(50), decision: z.enum(["approve", "reject"]), note: z.string().optional() }).parse(body);
    const out: Row[] = [];
    for (const id of p.ids) {
      // Đơn nháp cần phiếu lên đơn (tên, địa chỉ, giá…) — không duyệt hàng loạt.
      if (byId<Row>("approval", id)?.subject_type === "order_draft") { out.push({ id, error: "Đơn nháp cần phiếu lên đơn — mở từng đơn để duyệt" }); continue; }
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
    return { ...c, image: postImageView(c), seoImages: seoImagesView(c), review: c.review_score_id ? byId("review_score", c.review_score_id) : null, task: c.task_id ? byId("task", c.task_id) : null, approval: q.get("SELECT id, status FROM approval WHERE subject_id = ? ORDER BY created_at DESC LIMIT 1", c.task_id) };
  });
  // Ảnh đi kèm bài viết. POST: tạo (lại) bằng kết nối AI đang chọn — Claude thiết kế / ChatGPT tạo ảnh (chờ ~1 phút), kèm góp ý nếu có.
  // PUT: dùng ảnh Sếp tự tải lên (đường dẫn trả về từ /v1/uploads). DELETE: gỡ ảnh, bài chỉ còn chữ.
  r.post("/v1/content/:id/image", async ({ bizId, params, body, actor }) => {
    const note = z.object({ note: z.string().max(1000).optional() }).parse(body ?? {}).note?.trim();
    await createPostImage(bizId, params.id, { note: note || undefined, actor });
    return postImageView(byId<Row>("content_item", params.id));
  });
  r.put("/v1/content/:id/image", ({ bizId, params, body, actor }) => {
    const p = z.object({ path: z.string().min(1).max(1000) }).parse(body);
    setPostImageFromUpload(bizId, params.id, p.path, actor);
    return postImageView(byId<Row>("content_item", params.id));
  });
  r.del("/v1/content/:id/image", ({ bizId, params, actor }) => {
    removePostImage(bizId, params.id, actor);
    return postImageView(byId<Row>("content_item", params.id));
  });
  // Bài SEO: 4 ảnh / 1000 chữ, đặt ở vị trí tối ưu SEO. POST: tạo ảnh còn thiếu (replaceAll = tạo lại toàn bộ) — chạy nền vài phút,
  // tiến độ qua sự kiện content.image_progress. GET export: tải .zip (html + md + images/ đặt tên theo từ khoá) để đưa lên website.
  r.post("/v1/content/:id/seo-images", ({ bizId, params, body, actor }) => {
    const p = z.object({ replaceAll: z.boolean().optional(), note: z.string().max(600).optional() }).parse(body ?? {});
    queueSeoImages(bizId, params.id, { replaceAll: p.replaceAll, note: p.note?.trim() || undefined, actor });
    return seoImagesView(byId<Row>("content_item", params.id));
  });
  app.get("/v1/content/:id/export", async (req, reply) => {
    const c = byId<Row>("content_item", (req.params as Row).id);
    if (!c || c.biz_id !== currentBizId(req) || !isSeoArticle(c)) return reply.status(404).send({ code: "NOT_FOUND", message: "Không thấy bài SEO" });
    const x = await buildSeoExport(c.id);
    reply.header("content-disposition", `attachment; filename="${x.filename}"`).type("application/zip");
    return reply.send(x.zip);
  });
  // Xóa nội dung khỏi "Bài chờ / sắp đăng" (trang Đăng bài): bỏ nội dung + các lượt đăng chưa lên bài. Không đụng tới bài đã đăng / đang đăng.
  r.del("/v1/content/:id", ({ bizId, params, actor }) => deleteContent(bizId, params.id, actor));
  r.put("/v1/content/:id", async ({ bizId, params, body, actor }) => {
    const c = byId<Row>("content_item", params.id);
    if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
    const p = z.object({ title: z.string().optional(), body: z.string().min(1), approve: z.boolean().optional() }).parse(body);
    const { approve, ...edit } = p;
    if (edit.body !== c.body || (edit.title && edit.title !== c.title)) {
      update("content_item", c.id, edit);
      syncSeoFeatured(c.id); // bản sửa có thể đã bỏ / đổi ảnh đầu bài
      insert("exemplar", { biz_id: bizId, agent_key: c.agent_key, kind: "ceo_edit", text: `${c.title}\nTRƯỚC: ${String(c.body).slice(0, 400)}\nSAU: ${p.body.slice(0, 400)}`, outcome: "manual_edit" }); // edit = learning signal
      audit(bizId, actor, "content.edited", { type: "content_item", id: c.id });
      // Lượt đăng đã bị từ chối vì nội dung (vd còn câu nhắc nội bộ) → kiểm tra lại với bản vừa sửa: hết lỗi thì bỏ thông báo lỗi cũ ở trang Đăng bài.
      resyncRefusedJobs(bizId, c.id);
    }
    // "Lưu & duyệt": bản sửa phải qua lại kiểm tra cứng (câu cấm, giá DNA, ký tự cấm) rồi mới duyệt như hộp Duyệt.
    if (approve) {
      const dna = activeDna(bizId)?.data;
      const issues = dna ? editedTextIssues(`${edit.title ?? c.title}\n${edit.body}`, dna as any) : [];
      if (issues.length) throw new AppError("STILL_BLOCKED", `Đã lưu bản sửa nhưng chưa duyệt được — ${issues.join("; ")}`);
      const t = c.task_id ? byId<Row>("task", c.task_id) : undefined;
      if (t) {
        q.run("UPDATE approval SET status = 'expired' WHERE subject_type = 'task' AND subject_id = ? AND status = 'pending'", t.id);
        await approveTask(t, actor);
      } else update("content_item", c.id, { status: "approved" });
      audit(bizId, actor, "content.approved_after_edit", { type: "content_item", id: c.id });
    }
    return byId("content_item", c.id);
  });
  // Khâu không ra bài (brief, nghiên cứu, chiến lược…): Sếp sửa trực tiếp kết quả.
  r.put("/v1/tasks/:id/output", ({ bizId, params, body, actor }) => {
    const t = byId<Row>("task", params.id);
    if (!t || t.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy task", 404);
    const output = z.object({ output: z.record(z.string(), z.unknown()) }).parse(body).output;
    update("task", t.id, { output });
    audit(bizId, actor, "task.output_edited", { type: "task", id: t.id }, { keys: Object.keys(output) });
    return byId("task", t.id);
  });
  // Tạo lại: mọi trạng thái (kể cả khâu đã xong) — viết lại tại chỗ, hoặc khâu mới nếu bài đã lên lịch/đã đăng. Kèm góp ý của Sếp (nếu có).
  r.post("/v1/content/:id/regenerate", ({ bizId, params, body, actor }) => {
    const note = z.object({ note: z.string().max(2000).optional() }).parse(body ?? {}).note?.trim();
    return regenerateContent(bizId, params.id, actor, note || undefined);
  });
  // Mở lại nội dung hết hạn duyệt → tạo lại mục duyệt cũ (vẫn chờ Sếp duyệt, không đăng gì, không viết lại).
  r.post("/v1/content/:id/reopen", ({ bizId, params, actor }) => reopenContentApproval(bizId, params.id, actor));
  r.post("/v1/content/:id/publish-now", async ({ bizId, params, actor }) => {
    const c = byId<Row>("content_item", params.id);
    if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
    // draft_on_channel: video đã duyệt và đã lên NHÁP trên kênh — bấm "Đăng ngay" để đăng công khai.
    if (!["approved", "scheduled", "manual_publish", "draft_on_channel"].includes(c.status)) throw new AppError("NOT_APPROVED", "Chỉ đăng được nội dung đã duyệt");
    // Bài website đang nháp / chờ duyệt trên WordPress → công khai ĐÚNG bài đó (không tạo bài thứ 2).
    if (c.status === "draft_on_channel" && websiteDraftOf(c)) return publishWebsiteDraft(bizId, c.id, actor);
    assertPublishable(c); // kịch bản video chưa có video → 400 rõ ràng, không xếp lượt đăng rồi mới lỗi
    const last = q.get<Row>("SELECT * FROM publish_job WHERE content_item_id = ? AND mode != 'draft' ORDER BY created_at DESC LIMIT 1", c.id);
    if (last?.status === "scheduled") { enqueuePublishNow(bizId, last); return last; }
    // Lượt đăng cũ của bài này đã có (mã lượt đăng là duy nhất theo bài + kênh) → dùng lại thay vì tạo lượt mới.
    const sameChannel = last && last.channel_id === publishChannelFor(bizId, c.channel)?.id;
    if (last && sameChannel && ["failed", "needs_setup"].includes(last.status)) return retryPublishJob(bizId, last.id, actor);
    if (last && sameChannel && ["needs_check", "posting", "verifying"].includes(last.status)) throw new AppError("MAY_BE_LIVE", "Lượt đăng trước có thể ĐÃ lên bài — kiểm tra kênh, nếu chưa có thì bấm Đăng lại ở trang Đăng bài", 409);
    return schedulePublish(bizId, c.id, { now: true });
  });
  // "Đăng lại" sau khi Sếp kiểm tra kênh chưa có bài (lượt "Cần kiểm tra"), hoặc lượt lỗi / chờ thiết lập kênh.
  r.post("/v1/publish-jobs/:id/retry", ({ bizId, params, actor }) => retryPublishJob(bizId, params.id, actor));
  // Đổi kênh đăng của lượt chưa lên bài (vd TikTok chưa nối → Fanpage đã nối); lượt lỗi/chờ kết nối thì đăng lại ngay trên kênh mới.
  r.post("/v1/publish-jobs/:id/channel", ({ bizId, params, body, actor }) => changePublishChannel(bizId, params.id, z.object({ channelId: z.string().min(1) }).parse(body).channelId, actor));
  // Nền tảng = của KÊNH lượt đăng (1 bài có thể đăng nhiều nền tảng; Sếp đổi kênh được), không phải trường channel của bài.
  // Tự chữa: lượt "Lỗi" do nội dung bị từ chối mà nội dung đã được sửa (bằng cách nào cũng được) thì không còn báo lỗi cũ.
  r.get("/v1/publish-jobs", ({ bizId }) => { resyncRefusedJobs(bizId); return q.all(`SELECT j.*, c.title, COALESCE(ch.platform, c.channel) AS channel, ch.name AS channel_name, c.body, c.kind FROM publish_job j JOIN content_item c ON c.id = j.content_item_id LEFT JOIN channel ch ON ch.id = j.channel_id WHERE j.biz_id = ? ORDER BY j.scheduled_at DESC LIMIT 50`, bizId); });

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
