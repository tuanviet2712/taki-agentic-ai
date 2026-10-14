import { audit, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { REJECTION_REASONS } from "@dotaka/jev";
import { AppError } from "@dotaka/shared";
import { latestDaily, sumMetrics } from "./ads.ts";
import { applySalesFlowProposal } from "./chat-insight.ts";

/**
 * Feedback loop (spec §13). Agents learn by changing data and versions, never code:
 * metrics -> lesson -> change_proposal -> review/approval -> apply (versioned) -> revert.
 * Every numeric claim in a lesson carries its evidence rows.
 */
export const AUTO_APPLY_POLICY = {
  allow: [
    { targetType: "exemplar", maxPerWeek: 50 },
    { targetType: "posting_schedule", boundsHours: [7, 22], requiresCanary: true },
    { targetType: "rule_threshold", maxRelativeChangePct: 15, requiresDryRun: true },
  ],
  alwaysHuman: ["dna", "strategy", "budget_cap", "permissions", "bot_boundaries", "core_prompt", "knowledge", "content_playbook", "sales_flow"],
};

/** opts.human: luôn đưa vào hộp Duyệt dù chính sách cho tự áp dụng. */
export function propose(bizId: string, p: { target_type: string; target_id?: string | null; title: string; diff: Row; rationale: string; risk: string; lessonIds?: string[] }, opts: { human?: boolean } = {}) {
  if (q.get("SELECT id FROM change_proposal WHERE biz_id = ? AND title = ? AND status IN ('draft','awaiting_approval','testing')", bizId, p.title)) return null;
  const auto = !opts.human && AUTO_APPLY_POLICY.allow.some((a) => a.targetType === p.target_type) && !AUTO_APPLY_POLICY.alwaysHuman.includes(p.target_type);
  const row = insert("change_proposal", { biz_id: bizId, target_type: p.target_type, target_id: p.target_id ?? null, title: p.title, diff: p.diff, rationale: p.rationale, lesson_ids: p.lessonIds ?? [], risk: p.risk, status: auto ? "draft" : "awaiting_approval", auto_apply_allowed: auto ? 1 : 0 });
  if (!auto) {
    insert("approval", { biz_id: bizId, subject_type: "change_proposal", subject_id: row.id, agent_key: "feedback", title: p.title, risk: p.risk, status: "pending", preview: { diff: p.diff, rationale: p.rationale } });
    emit(bizId, "approval.created", { title: p.title });
  }
  emit(bizId, "proposal.created", { proposalId: row.id, title: p.title });
  return row;
}

export function learnDaily(bizId: string) {
  const since14 = new Date(Date.now() - 14 * 86400_000).toISOString();
  const created: string[] = [];

  // 1) CEO feedback on drafts -> playbook rule proposals
  const reasons = q.all<Row>("SELECT outcome, COUNT(*) n FROM exemplar WHERE biz_id = ? AND kind IN ('avoid','ceo_edit') AND created_at >= ? GROUP BY outcome", bizId, since14);
  for (const r of reasons) {
    if (r.n < 2 || r.outcome === "other") continue;
    const label = REJECTION_REASONS[r.outcome as keyof typeof REJECTION_REASONS] ?? r.outcome;
    const lesson = insert("lesson", { biz_id: bizId, agent_key: "content", statement: `CEO đã sửa/từ chối ${r.n} bản nháp vì: ${label}. Kiểm tra kỹ điểm này trước khi gửi duyệt.`, evidence: { source: "exemplar", reason: r.outcome, count: r.n, window: "14d" }, status: "candidate", review_at: new Date(Date.now() + 30 * 86400_000).toISOString() });
    const p = propose(bizId, { target_type: "content_playbook", title: `Bổ sung quy tắc viết: tránh "${label}"`, diff: { addRule: lesson.statement }, rationale: `${r.n} phản hồi của CEO trong 14 ngày cùng nhóm lý do (Jev phân loại).`, risk: "low", lessonIds: [lesson.id] });
    if (p) created.push(p.id);
  }

  // 2) Chat questions the knowledge base could not answer -> knowledge proposals
  const gaps = q.all<Row>("SELECT c.id, c.customer_name, c.last_preview, c.analysis FROM conversation c WHERE c.biz_id = ? AND c.state IN ('handoff_pending','human_active') AND c.updated_at >= ?", bizId, since14)
    .filter((c) => (c.analysis?.handoff?.reasons ?? []).some((x: string) => x.includes("ngoài kho tri thức")));
  if (gaps.length >= 1) {
    const p = propose(bizId, { target_type: "knowledge", title: `Bổ sung ${gaps.length} câu trả lời còn thiếu cho Chat Agent`, diff: { questions: gaps.map((g) => g.last_preview) }, rationale: "Khách hỏi những câu này nhưng kho tri thức không đủ để trả lời, bot đã phải chuyển người.", risk: "low" });
    if (p) created.push(p.id);
  }

  // 3) Ads: CPA by post format (only with >=2 ads per group, evidence attached)
  const rows = q.all<Row>("SELECT a.id, p.kind FROM ad a JOIN post p ON p.id = a.post_id WHERE a.biz_id = ?", bizId);
  const byKind: Record<string, { spend: number; results: number; n: number }> = {};
  for (const r of rows) {
    const m = sumMetrics(latestDaily(bizId, r.id, new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)));
    const g = (byKind[r.kind] ??= { spend: 0, results: 0, n: 0 });
    g.spend += m.spend; g.results += m.results; g.n++;
  }
  const kinds = Object.entries(byKind).filter(([, g]) => g.n >= 2 && g.results > 0).map(([k, g]) => ({ k, cpa: g.spend / g.results, n: g.n }));
  if (kinds.length >= 2) {
    kinds.sort((a, b) => a.cpa - b.cpa);
    const [best, worst] = [kinds[0], kinds.at(-1)!];
    if (worst.cpa / best.cpa > 1.2) {
      const statement = `Ads từ bài dạng ${best.k} có CPA ${Math.round(best.cpa).toLocaleString("vi-VN")}đ, thấp hơn ${Math.round((1 - best.cpa / worst.cpa) * 100)}% so với dạng ${worst.k} (7 ngày).`;
      if (!q.get("SELECT id FROM lesson WHERE biz_id = ? AND statement = ?", bizId, statement)) {
        insert("lesson", { biz_id: bizId, agent_key: null, statement, evidence: { byKind, window: "7d" }, status: "active", review_at: new Date(Date.now() + 14 * 86400_000).toISOString() });
      }
    }
  }

  // 4) Winning content -> exemplars (auto-apply allowed within policy)
  const winners = q.all<Row>(`SELECT p.title, p.body, MAX(s.score) score FROM post p JOIN post_score s ON s.post_id = p.id WHERE p.biz_id = ? GROUP BY p.id HAVING score >= 80 ORDER BY score DESC LIMIT 3`, bizId);
  for (const w of winners) {
    if (q.get("SELECT id FROM exemplar WHERE biz_id = ? AND kind = 'winner' AND text LIKE ?", bizId, `${w.title}%`)) continue;
    insert("exemplar", { biz_id: bizId, agent_key: "content", kind: "winner", text: `${w.title}\n${String(w.body).slice(0, 600)}`, outcome: `post_score ${w.score}` });
  }

  // 5) Rules the CEO keeps reverting -> threshold proposal (dry-run first)
  const reverted = q.all<Row>(`SELECT r.id, r.name, COUNT(*) n FROM action a JOIN rule_run rr ON rr.id = a.rule_run_id JOIN rule r ON r.id = rr.rule_id WHERE a.biz_id = ? AND a.status = 'reverted' AND a.created_at >= ? GROUP BY r.id HAVING n >= 2`, bizId, since14);
  for (const r of reverted) {
    const p = propose(bizId, { target_type: "rule_threshold", target_id: r.id, title: `Nới ngưỡng rule "${r.name}" 15%`, diff: { relativeChangePct: 15 }, rationale: `CEO đã hoàn tác ${r.n} hành động của rule này trong 14 ngày.`, risk: "medium" });
    if (p) created.push(p.id);
  }

  audit(bizId, "feedback_agent", "learn.daily", undefined, { proposals: created.length });
  return { proposals: created.length };
}

export function applyProposal(bizId: string, proposalId: string, actor: string) {
  const p = byId<Row>("change_proposal", proposalId);
  if (!p || p.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy đề xuất", 404);
  switch (p.target_type) {
    case "content_playbook":
      for (const id of p.lesson_ids) update("lesson", id, { status: "active" });
      break;
    case "knowledge":
      insert("knowledge_doc", { biz_id: bizId, title: "FAQ bổ sung từ hội thoại (cần điền câu trả lời)", kind: "faq", source: "feedback_agent", tags: ["FAQ", "Chat"], body: (p.diff.questions as string[]).map((x) => `H: ${x}\nĐ: (CEO điền)`).join("\n\n"), status: "draft" });
      break;
    case "rule_threshold": {
      const rule = byId<Row>("rule", p.target_id)!;
      const def = structuredClone(rule.definition);
      const bump = (node: any) => {
        if (node.metric && typeof node.value === "number") node.value = Math.round(node.value * (1 + p.diff.relativeChangePct / 100));
        (node.all ?? node.any ?? []).forEach(bump);
      };
      bump(def.conditions);
      update("rule", rule.id, { definition: def, version: rule.version + 1, mode: "dry_run" }); // new version must re-earn live via dry-run
      break;
    }
    case "sales_flow": // Vòng lặp Thấu hiểu khách (bước Tối ưu) → thêm băn khoăn / mẫu câu / tin nhắc lại vào kịch bản chốt đơn
      applySalesFlowProposal(bizId, p, actor);
      break;
  }
  update("change_proposal", p.id, { status: "applied" });
  audit(bizId, actor, "proposal.applied", { type: "change_proposal", id: p.id }, { target: p.target_type });
  emit(bizId, "proposal.applied", { proposalId: p.id });
}
