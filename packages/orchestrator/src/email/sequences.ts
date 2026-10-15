import { activeDna, audit, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { generate } from "@dotaka/llm-gateway";
import { agentPlaybook } from "@dotaka/skills";
import { LOAI_CHUOI, SchemaEmailSinh, chamChuoi, chamEmail, duocKichHoat, khoiSangVanBan, keoThaSangVanBan, kiemCtaBan, type EmailChua } from "@dotaka/email";
import { AppError, logger, nowIso, untrusted } from "@dotaka/shared";
import { approvalExpiresAt } from "../runtime.ts";
import { contentErrors, contentOf, type Mode } from "./campaigns.ts";
import { sendEmail } from "./send.ts";
import { emailStatus, nextSendTime } from "./settings.ts";

/**
 * Chuỗi email tự động (chép auto-funnel F-109/F-102/F-110/F-023): dựng khung theo loại chuỗi mẫu (Soap Opera, Ascension…)
 * hoặc tự tạo; AI viết từng email theo DNA (tập "cấm bán" tự kiểm CTA bán, vi phạm thì viết lại 1 vòng); chấm điểm 2 tầng;
 * KÍCH HOẠT phải qua mục duyệt [ĐỎ]. Ghi danh theo trigger (liên hệ mới / gắn thẻ / có đơn / thủ công); con trỏ riêng
 * từng người; email.tick gửi thư đến hạn trong khung giờ gửi. Mục tiêu "mua hàng": khách có đơn → dừng chuỗi (goal_met).
 */
export type Trigger =
  | { type: "manual" }
  | { type: "contact_created"; source?: string | null }
  | { type: "tag_added"; tag: string }
  | { type: "order_created"; productKey?: string | null };
export type SeqConfig = { trigger: Trigger; goal?: { type: "none" | "purchase" } };

export function sequenceOf(bizId: string, id: string): Row {
  const s = byId<Row>("email_sequence", id);
  if (!s || s.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy chuỗi email", 404);
  return s;
}
export function stepOf(bizId: string, id: string): Row {
  const s = byId<Row>("email_sequence_step", id);
  if (!s || s.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy email trong chuỗi", 404);
  return s;
}
const stepsOf = (seqId: string) => q.all<Row>("SELECT * FROM email_sequence_step WHERE sequence_id = ? ORDER BY position", seqId);

export function presetList() {
  return Object.entries(LOAI_CHUOI).map(([key, v]) => ({ key, name: v.ten, description: v.moTa, steps: v.tap.length }));
}

function validConfig(cfg: SeqConfig | undefined): SeqConfig {
  const t = cfg?.trigger ?? { type: "manual" };
  if (!["manual", "contact_created", "tag_added", "order_created"].includes(t.type)) throw new AppError("INVALID", "Trigger không hợp lệ");
  if (t.type === "tag_added" && !String((t as { tag?: string }).tag ?? "").trim()) throw new AppError("INVALID", "Trigger gắn thẻ cần tên thẻ");
  return { trigger: t, goal: { type: cfg?.goal?.type === "purchase" ? "purchase" : "none" } };
}

/** Tạo chuỗi: từ loại mẫu (khung N email theo vai trò) hoặc trống (custom). */
export function createSequence(bizId: string, input: { name?: string; kind?: string; productKey?: string | null; config?: SeqConfig; steps?: number }, actor: string) {
  const preset = input.kind && input.kind !== "custom" ? LOAI_CHUOI[input.kind] : undefined;
  if (input.kind && input.kind !== "custom" && !preset) throw new AppError("INVALID", "Loại chuỗi chưa hỗ trợ");
  const s = insert("email_sequence", {
    biz_id: bizId, name: String(input.name ?? "").trim().slice(0, 160) || (preset ? preset.ten : "Chuỗi email mới"), kind: preset ? input.kind : "custom", status: "draft",
    product_key: input.productKey ?? null, config: validConfig(input.config), result: {},
  });
  const tap = preset ? (input.steps && input.steps > 0 ? preset.tap.slice(0, input.steps) : preset.tap) : [];
  tap.forEach((t, i) => insert("email_sequence_step", {
    biz_id: bizId, sequence_id: s.id, position: i, role: t.vaiTro, title: t.ten, delay_days: t.choNgay, subject: "", options: [], mode: "text", body: "", data: {},
    no_hard_sell: t.camCtaBan ? 1 : 0, status: "draft", meta: { task: t.nhiemVu },
  }));
  audit(bizId, actor, "email.sequence_created", { type: "email_sequence", id: s.id }, { kind: s.kind, steps: tap.length });
  return sequenceDetail(bizId, s.id);
}

export function updateSequence(bizId: string, id: string, input: { name?: string; productKey?: string | null; config?: SeqConfig }, actor: string) {
  const s = sequenceOf(bizId, id);
  const p: Row = {};
  if (input.name !== undefined) p.name = String(input.name).trim().slice(0, 160) || s.name;
  if (input.productKey !== undefined) p.product_key = input.productKey || null;
  if (input.config !== undefined) p.config = validConfig(input.config);
  update("email_sequence", s.id, p);
  audit(bizId, actor, "email.sequence_updated", { type: "email_sequence", id: s.id });
  return sequenceDetail(bizId, s.id);
}

export function deleteSequence(bizId: string, id: string, actor: string) {
  const s = sequenceOf(bizId, id);
  if (s.approval_id) q.run("UPDATE approval SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'", nowIso(), s.approval_id);
  q.run("UPDATE email_enrollment SET status = 'stopped', stop_reason = 'sequence_deleted', updated_at = ? WHERE sequence_id = ? AND status = 'active'", nowIso(), s.id);
  q.run("DELETE FROM email_sequence_step WHERE sequence_id = ?", s.id);
  q.run("DELETE FROM email_sequence WHERE id = ?", s.id);
  audit(bizId, actor, "email.sequence_deleted", { type: "email_sequence", id: s.id }, { name: s.name });
  return { ok: true };
}

/** Sửa chuỗi đang chạy / chờ duyệt → điểm cũ hết hiệu lực; đang chờ duyệt thì huỷ mục duyệt (nội dung duyệt phải đúng nội dung gửi). */
function invalidate(s: Row) {
  const p: Row = { result: {} };
  if (s.status === "awaiting_approval") {
    if (s.approval_id) q.run("UPDATE approval SET status = 'expired', decision_note = 'Chuỗi đã bị sửa sau khi gửi duyệt', updated_at = ? WHERE id = ? AND status = 'pending'", nowIso(), s.approval_id);
    p.status = "draft"; p.approval_id = null;
  }
  update("email_sequence", s.id, p);
}

export function saveStep(bizId: string, seqId: string, input: { id?: string; title?: string; delayDays?: number; subject?: string; preheader?: string | null; mode?: Mode; body?: string; data?: unknown; noHardSell?: boolean }, actor: string) {
  const s = sequenceOf(bizId, seqId);
  const p: Row = {};
  if (input.title !== undefined) p.title = String(input.title).slice(0, 160);
  if (input.delayDays !== undefined) { const d = Number(input.delayDays); if (!(d >= 0 && d <= 365)) throw new AppError("INVALID", "Số ngày chờ từ 0 đến 365"); p.delay_days = d; }
  if (input.subject !== undefined) p.subject = String(input.subject).slice(0, 200);
  if (input.preheader !== undefined) p.preheader = input.preheader ? String(input.preheader).slice(0, 200) : null;
  if (input.mode !== undefined) { if (!["text", "blocks", "dnd"].includes(input.mode)) throw new AppError("INVALID", "Chế độ soạn không hợp lệ"); p.mode = input.mode; }
  if (input.body !== undefined) p.body = String(input.body).slice(0, 100_000);
  if (input.data !== undefined) p.data = input.data ?? {};
  if (input.noHardSell !== undefined) p.no_hard_sell = input.noHardSell ? 1 : 0;
  let id = input.id;
  if (id) {
    const st = stepOf(bizId, id);
    if (st.sequence_id !== s.id) throw new AppError("INVALID", "Email không thuộc chuỗi này");
    update("email_sequence_step", id, { ...p, status: "ready", last_error: null });
  } else {
    const pos = (q.scalar<number>("SELECT MAX(position) FROM email_sequence_step WHERE sequence_id = ?", s.id) ?? -1) + 1;
    id = insert("email_sequence_step", { biz_id: bizId, sequence_id: s.id, position: pos, role: "custom", title: `Email ${pos + 1}`, delay_days: pos === 0 ? 0 : 1, subject: "", options: [], mode: "text", body: "", data: {}, no_hard_sell: 0, status: "ready", meta: {}, ...p }).id;
  }
  invalidate(s);
  audit(bizId, actor, "email.sequence_step_saved", { type: "email_sequence_step", id: id! });
  return sequenceDetail(bizId, s.id);
}

export function deleteStep(bizId: string, stepId: string, actor: string) {
  const st = stepOf(bizId, stepId);
  const s = sequenceOf(bizId, st.sequence_id);
  q.run("DELETE FROM email_sequence_step WHERE id = ?", st.id);
  stepsOf(s.id).forEach((x, i) => { if (x.position !== i) update("email_sequence_step", x.id, { position: i }); });
  invalidate(s);
  audit(bizId, actor, "email.sequence_step_deleted", { type: "email_sequence", id: s.id });
  return sequenceDetail(bizId, s.id);
}

/** Đổi thứ tự: danh sách id theo thứ tự mới (giữ liên tục 0..n-1). */
export function reorderSteps(bizId: string, seqId: string, ids: string[], actor: string) {
  const s = sequenceOf(bizId, seqId);
  const cur = stepsOf(s.id);
  if (ids.length !== cur.length || !cur.every((x) => ids.includes(x.id))) throw new AppError("INVALID", "Danh sách email không khớp chuỗi");
  ids.forEach((id, i) => update("email_sequence_step", id, { position: i }));
  invalidate(s);
  audit(bizId, actor, "email.sequence_reordered", { type: "email_sequence", id: s.id });
  return sequenceDetail(bizId, s.id);
}

const stepText = (st: Row) => (st.mode === "blocks" ? khoiSangVanBan(st.data) : st.mode === "dnd" ? keoThaSangVanBan(st.data) : String(st.body ?? ""));

export function sequenceDetail(bizId: string, id: string): Row {
  const s = sequenceOf(bizId, id);
  const steps = stepsOf(s.id);
  const stats = q.all<Row>(`SELECT step, SUM(CASE WHEN status NOT IN ('skipped','failed','queued') THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked, SUM(revenue) AS revenue
    FROM email_message WHERE source_kind = 'sequence' AND source_id = ? GROUP BY step`, s.id);
  const enroll = q.get<Row>(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'goal_met' THEN 1 ELSE 0 END) AS goal_met, SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END) AS stopped FROM email_enrollment WHERE sequence_id = ?`, s.id);
  let cum = 0;
  return {
    ...s, preset: s.kind !== "custom" ? LOAI_CHUOI[s.kind]?.ten ?? null : null,
    steps: steps.map((st) => { cum += Number(st.delay_days ?? 0); return { ...st, day: cum, stats: stats.find((x) => x.step === st.position) ?? null, errors: contentErrors(st), ctaViolations: st.no_hard_sell ? kiemCtaBan(`${st.subject} ${stepText(st)}`) : [] }; }),
    enrollments: enroll ?? {},
  };
}

export function listSequences(bizId: string) {
  return q.all<Row>("SELECT * FROM email_sequence WHERE biz_id = ? ORDER BY created_at DESC", bizId).map((s) => ({
    ...s, steps: q.scalar<number>("SELECT COUNT(*) FROM email_sequence_step WHERE sequence_id = ?", s.id) ?? 0,
    active: q.scalar<number>("SELECT COUNT(*) FROM email_enrollment WHERE sequence_id = ? AND status = 'active'", s.id) ?? 0,
    sent: q.scalar<number>("SELECT COUNT(*) FROM email_message WHERE source_kind = 'sequence' AND source_id = ? AND status NOT IN ('skipped','failed','queued')", s.id) ?? 0,
  }));
}

// ---------------- AI viết email (F-109) ----------------
function dnaFacts(bizId: string, productKey?: string | null): { brand: string; facts: string } {
  const dna = activeDna(bizId)?.data as Row | undefined;
  const brand = dna?.company?.brand ?? dna?.company?.name ?? q.get<Row>("SELECT name FROM biz WHERE id = ?", bizId)?.name ?? "chúng tôi";
  const products = (dna?.products ?? []) as Row[];
  const p = productKey ? products.find((x) => x.key === productKey) : undefined;
  const pick = (o: unknown) => JSON.stringify(o ?? null).slice(0, 1500);
  const facts = [
    `THƯƠNG HIỆU: ${brand}`,
    dna?.company ? `DOANH NGHIỆP: ${pick(dna.company)}` : "",
    dna?.voice || dna?.brandVoice || dna?.tone ? `GIỌNG VĂN: ${pick(dna.voice ?? dna.brandVoice ?? dna.tone)}` : "",
    dna?.audience || dna?.customers || dna?.persona ? `CHÂN DUNG KHÁCH: ${pick(dna.audience ?? dna.customers ?? dna.persona)}` : "",
    p ? `SẢN PHẨM CỦA CHUỖI: ${pick(p)}` : products.length ? `SẢN PHẨM: ${products.slice(0, 5).map((x) => `${x.name}: ${String(x.summary ?? "").slice(0, 160)}`).join(" | ")}` : "",
  ].filter(Boolean).join("\n");
  return { brand, facts };
}

/** AI viết (hoặc viết lại) 1 email của chuỗi. Tập cấm bán: kiểm CTA bán, vi phạm thì tự viết lại 1 vòng. */
export async function generateStep(bizId: string, stepId: string, actor: string, note?: string) {
  const st = stepOf(bizId, stepId);
  const s = sequenceOf(bizId, st.sequence_id);
  const before = stepsOf(s.id).filter((x) => x.position < st.position);
  const preset = s.kind !== "custom" ? LOAI_CHUOI[s.kind] : undefined;
  const task = String(st.meta?.task ?? preset?.tap[st.position]?.nhiemVu ?? "Viết email tiếp theo của chuỗi, nối mạch với các email trước.");
  const { brand, facts } = dnaFacts(bizId, s.product_key);
  update("email_sequence_step", st.id, { status: "generating", last_error: null });
  let playbook = "";
  try { playbook = agentPlaybook(bizId, "email").text; } catch { /* chưa đồng bộ skill: viết theo luật trong prompt */ }
  const call = (violation?: string) => generate({
    bizId, agentKey: "email", tier: "medium", schema: SchemaEmailSinh, systemSuffix: playbook || undefined,
    system: [
      `Bạn là copywriter email marketing của ${brand}. Viết email tiếng Việt trong một chuỗi email nhiều tập, đúng giọng thương hiệu.`,
      "Chỉ dùng thông tin trong FACTS; không bịa giá, ưu đãi, số liệu, lời chứng thực. Không hứa kết quả cụ thể.",
      "Xưng hô với người đọc bằng {{ho_ten|bạn}} (giữ nguyên cú pháp biến). Nội dung 150–350 từ, đoạn ngắn 1–3 câu, dễ đọc trên điện thoại.",
      "Link (nếu có) để dạng URL đầy đủ https://… trong FACTS; không tự tạo link. Không viết footer/hủy đăng ký (hệ thống tự chèn).",
      "Trả JSON: phuong_an_tieu_de (2–3 tiêu đề 8–90 ký tự), preheader (15–120 ký tự), noi_dung (văn bản thuần, đoạn cách nhau 1 dòng trống).",
    ].join("\n"),
    user: [
      `FACTS:\n${facts}`,
      `CHUỖI: «${s.name}»${preset ? ` (${preset.ten})` : ""}`,
      `EMAIL CẦN VIẾT: ${st.title || `Email ${st.position + 1}`} — vị trí ${st.position + 1}`,
      `NHIỆM VỤ: ${task}`,
      before.length ? `CÁC EMAIL TRƯỚC (giữ mạch, không lặp ý): ${before.map((b) => `#${b.position + 1} «${b.subject || b.title}»`).join("; ")}` : "Đây là email đầu tiên của chuỗi.",
      st.no_hard_sell ? "TUYỆT ĐỐI KHÔNG chào bán / nhắc giá / kêu gọi mua ở email này." : "",
      violation ? `BẢN TRƯỚC VI PHẠM: dùng cụm bán hàng «${violation}» trong email cấm bán — viết lại sạch hoàn toàn.` : "",
      note ? `YÊU CẦU THÊM CỦA NGƯỜI DUYỆT: ${untrusted("ceo_note", note.slice(0, 600))}` : "",
    ].filter(Boolean).join("\n\n"),
    sandbox: () => ({
      phuong_an_tieu_de: [`${st.title || "Thư từ " + brand}`.slice(0, 80).padEnd(10, "."), `Gửi {{ho_ten|bạn}}: điều ${brand} muốn chia sẻ`.slice(0, 85)],
      preheader: `Một điều nhỏ nhưng quan trọng từ ${brand} dành cho bạn hôm nay.`.slice(0, 118),
      noi_dung: `Chào {{ho_ten|bạn}},\n\n${task}\n\nĐây là bản nháp mô phỏng (chưa bật AI thật) — hãy sửa lại nội dung trước khi kích hoạt chuỗi. Bản nháp giữ đúng cấu trúc: mở đầu ngắn, một ý chính, một bước tiếp theo rõ ràng cho người đọc.\n\nThân mến,\n${brand}`.padEnd(210, " "),
    }),
  });
  try {
    let out = (await call()).output;
    let viol = st.no_hard_sell ? kiemCtaBan(`${out.phuong_an_tieu_de.join(" ")} ${out.noi_dung}`) : [];
    if (viol.length) {
      out = (await call(viol.join(", "))).output;
      viol = st.no_hard_sell ? kiemCtaBan(`${out.phuong_an_tieu_de.join(" ")} ${out.noi_dung}`) : [];
    }
    update("email_sequence_step", st.id, {
      subject: out.phuong_an_tieu_de[0], options: out.phuong_an_tieu_de, preheader: out.preheader, mode: "text", body: out.noi_dung.trim(),
      status: "ready", last_error: null, meta: { ...(st.meta ?? {}), ctaViolations: viol, generatedAt: nowIso() },
    });
    invalidate(s);
    audit(bizId, actor, "email.step_generated", { type: "email_sequence_step", id: st.id }, { violations: viol.length });
  } catch (e) {
    update("email_sequence_step", st.id, { status: "error", last_error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) });
    throw e;
  }
  return sequenceDetail(bizId, s.id);
}

/** Viết lần lượt mọi email còn trống (nền: job email.generate để không giữ request lâu). */
export async function generateAllSteps(bizId: string, seqId: string, actor: string) {
  const s = sequenceOf(bizId, seqId);
  for (const st of stepsOf(s.id)) {
    if (st.body?.trim() || st.mode !== "text") continue;
    try { await generateStep(bizId, st.id, actor); } catch (e) { logger.warn("email.generate_failed", { stepId: st.id, error: String(e).slice(0, 200) }); }
  }
  emit(bizId, "email.sequence_generated", { sequenceId: s.id });
  return sequenceDetail(bizId, s.id);
}

// ---------------- Chấm điểm 2 tầng + kích hoạt (F-110) ----------------
export function scoreSequence(bizId: string, seqId: string, actor: string) {
  const s = sequenceOf(bizId, seqId);
  const steps = stepsOf(s.id);
  if (!steps.length) throw new AppError("INVALID", "Chuỗi chưa có email nào");
  const ds: EmailChua[] = steps.map((st) => ({ vi_tri: st.position, vai_tro: st.role, tieu_de: st.subject ?? "", noi_dung: stepText(st), cam_cta_ban: Boolean(st.no_hard_sell) }));
  const perEmail = ds.map((e) => ({ ...chamEmail(e), vi_tri: e.vi_tri }));
  const chain = chamChuoi(ds, perEmail);
  const gate = duocKichHoat(chain);
  update("email_sequence", s.id, { result: { chain, perEmail, gate, at: nowIso() } });
  audit(bizId, actor, "email.sequence_scored", { type: "email_sequence", id: s.id }, { total: chain.tong, ok: gate.duoc });
  return { chain, perEmail, gate };
}

export function requestSequenceActivation(bizId: string, seqId: string, actor: string) {
  const s = sequenceOf(bizId, seqId);
  if (!["draft", "paused"].includes(s.status)) throw new AppError("INVALID", "Chuỗi đang chạy hoặc đang chờ duyệt");
  const steps = stepsOf(s.id);
  if (!steps.length) throw new AppError("INVALID", "Chuỗi chưa có email nào");
  const bad = steps.map((st) => ({ st, err: contentErrors(st) })).filter((x) => x.err.length);
  if (bad.length) throw new AppError("CONTENT_INVALID", `Email #${bad[0].st.position + 1}: ${bad[0].err.join(" · ")}`);
  for (const st of steps) {
    const v = st.no_hard_sell ? kiemCtaBan(`${st.subject} ${stepText(st)}`) : [];
    if (v.length) throw new AppError("HARD_SELL", `Email #${st.position + 1} thuộc nhóm cấm bán nhưng có CTA bán («${v.join(", ")}»)`);
  }
  const score = scoreSequence(bizId, s.id, actor);
  if (!score.gate.duoc) throw new AppError("SCORE_LOW", `Chưa đạt điểm kích hoạt: ${score.gate.lyDo} Sửa các email yếu (hoặc bấm AI viết lại) rồi gửi duyệt lại.`);
  const st = emailStatus(bizId);
  if (!st.connected || !st.live) throw new AppError("EMAIL_NOT_CONNECTED", "Chưa kết nối Email (Resend) thật");
  if (!st.trackingBase) throw new AppError("NO_PUBLIC_URL", "Chưa có địa chỉ công khai ổn định (PUBLIC_BASE_URL + PUBLIC_PORT) cho link hủy nhận");
  const cfg = (s.config ?? {}) as SeqConfig;
  const ap = insert("approval", {
    biz_id: bizId, subject_type: "email_sequence", subject_id: s.id, title: `Kích hoạt chuỗi email: ${s.name}`, agent_key: "email", risk: "high", status: "pending",
    preview: { kind: "email_sequence", name: s.name, trigger: cfg.trigger, goal: cfg.goal, score: score.chain.tong,
      steps: steps.map((x) => ({ position: x.position, title: x.title, subject: x.subject, delayDays: x.delay_days, noHardSell: Boolean(x.no_hard_sell), excerpt: stepText(x).slice(0, 280) })) },
    expires_at: approvalExpiresAt(bizId),
  });
  update("email_sequence", s.id, { status: "awaiting_approval", approval_id: ap.id });
  emit(bizId, "approval.created", { approvalId: ap.id, subjectType: "email_sequence" });
  audit(bizId, actor, "email.sequence_submitted", { type: "email_sequence", id: s.id });
  return { approvalId: ap.id };
}

export function decideSequenceApproval(bizId: string, ap: Row, decision: "approve" | "edit" | "reject", actor: string) {
  const s = byId<Row>("email_sequence", ap.subject_id);
  if (!s) return;
  if (decision === "reject") { update("email_sequence", s.id, { status: "draft", approval_id: null }); return; }
  if (s.status !== "awaiting_approval" || s.approval_id !== ap.id) throw new AppError("STALE", "Chuỗi đã đổi sau khi gửi duyệt — gửi duyệt lại", 409);
  update("email_sequence", s.id, { status: "active" });
  audit(bizId, actor, "email.sequence_activated", { type: "email_sequence", id: s.id });
  emit(bizId, "email.sequence_activated", { sequenceId: s.id });
}

export function pauseSequence(bizId: string, seqId: string, actor: string) {
  const s = sequenceOf(bizId, seqId);
  if (s.status !== "active") throw new AppError("INVALID", "Chuỗi không chạy");
  update("email_sequence", s.id, { status: "paused" });
  audit(bizId, actor, "email.sequence_paused", { type: "email_sequence", id: s.id });
  return sequenceDetail(bizId, s.id);
}

// ---------------- Ghi danh + gửi ----------------
/** Ghi danh 1 liên hệ (bỏ qua nếu đã từng vào chuỗi này). Chuỗi chưa chạy thì không ghi danh. */
export function enroll(bizId: string, seqId: string, contactId: string, actor = "system"): Row | null {
  const s = sequenceOf(bizId, seqId);
  if (s.status !== "active") throw new AppError("INACTIVE", "Chuỗi chưa được kích hoạt");
  const c = byId<Row>("email_contact", contactId);
  if (!c || c.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không tìm thấy liên hệ", 404);
  if (c.status !== "active" || c.consent === "transactional") return null;
  if (q.get("SELECT id FROM email_enrollment WHERE sequence_id = ? AND contact_id = ?", s.id, c.id)) return null;
  const first = stepsOf(s.id)[0];
  if (!first) return null;
  const e = insert("email_enrollment", { biz_id: bizId, sequence_id: s.id, contact_id: c.id, cursor: 0, next_at: nextSendTime(bizId, new Date(Date.now() + Number(first.delay_days ?? 0) * 86_400_000)).toISOString(), status: "active" });
  audit(bizId, actor, "email.enrolled", { type: "email_sequence", id: s.id }, { contactId: c.id });
  return e;
}

/** Trigger: chạy mọi chuỗi đang chạy khớp sự kiện. */
export function fireTrigger(bizId: string, ev: { type: "contact_created"; contactId: string; source?: string } | { type: "tag_added"; contactId: string; tags: string[] } | { type: "order_created"; contactId: string; productKey?: string | null }) {
  let n = 0;
  for (const s of q.all<Row>("SELECT * FROM email_sequence WHERE biz_id = ? AND status = 'active'", bizId)) {
    const t = (s.config?.trigger ?? { type: "manual" }) as Trigger;
    const hit = t.type === ev.type && (
      (t.type === "contact_created" && (!t.source || t.source === (ev as { source?: string }).source)) ||
      (t.type === "tag_added" && (ev as { tags: string[] }).tags.includes(t.tag)) ||
      (t.type === "order_created" && (!t.productKey || t.productKey === (ev as { productKey?: string | null }).productKey)));
    if (!hit) continue;
    try { if (enroll(bizId, s.id, ev.contactId, `trigger:${ev.type}`)) n++; } catch (e) { logger.warn("email.enroll_failed", { sequenceId: s.id, error: String(e).slice(0, 200) }); }
  }
  return n;
}

/** Khách đã mua: dừng chuỗi có mục tiêu "mua hàng". */
export function markGoalPurchase(contactId: string) {
  q.run(`UPDATE email_enrollment SET status = 'goal_met', stop_reason = 'purchase', updated_at = ? WHERE contact_id = ? AND status = 'active'
    AND sequence_id IN (SELECT id FROM email_sequence WHERE json_extract(config, '$.goal.type') = 'purchase')`, nowIso(), contactId);
}

/** email.tick: gửi các thư chuỗi đến hạn, tiến con trỏ từng người. */
export async function sequenceTick(bizId: string, now = new Date(), limit = 100) {
  let sent = 0;
  const due = q.all<Row>(`SELECT e.* FROM email_enrollment e JOIN email_sequence s ON s.id = e.sequence_id
    WHERE e.biz_id = ? AND e.status = 'active' AND s.status = 'active' AND e.next_at <= ? ORDER BY e.next_at LIMIT ?`, bizId, now.toISOString(), limit);
  for (const en of due) {
    const steps = stepsOf(en.sequence_id);
    const st = steps[en.cursor];
    if (!st) { update("email_enrollment", en.id, { status: "done", next_at: null }); continue; }
    const at = nextSendTime(bizId, now);
    if (at.getTime() > now.getTime()) { update("email_enrollment", en.id, { next_at: at.toISOString() }); continue; } // giờ yên lặng
    const r = await sendEmail({ bizId, contactId: en.contact_id, content: contentOf(st), source: { kind: "sequence", id: en.sequence_id, step: st.position } });
    // Hết hạn mức / ngắt / khoá: xoá dòng bỏ qua, thử lại sau 1 giờ (không mất thư, không gửi trùng).
    if (r.status === "skipped" && ["daily_limit", "throttled", "stopped", "kill_switch", "not_connected", "sandbox", "no_public_url"].includes(r.reason ?? "")) {
      q.run("DELETE FROM email_message WHERE id = ?", r.messageId);
      update("email_enrollment", en.id, { next_at: new Date(now.getTime() + 3600_000).toISOString() });
      continue;
    }
    if (r.status === "skipped" && ["unsubscribed", "opt_out", "suppressed", "consent"].includes(r.reason ?? "")) {
      update("email_enrollment", en.id, { status: "stopped", stop_reason: r.reason, next_at: null });
      continue;
    }
    if (r.status === "failed") {
      // Lỗi Resend tạm thời: thử lại sau 30 phút, tối đa 3 lần cho cùng 1 thư rồi mới bỏ qua sang thư kế.
      const fails = q.scalar<number>("SELECT COUNT(*) FROM email_message WHERE contact_id = ? AND source_kind = 'sequence' AND source_id = ? AND step = ? AND status = 'failed'", en.contact_id, en.sequence_id, st.position) ?? 0;
      if (fails < 3) { update("email_enrollment", en.id, { next_at: new Date(now.getTime() + 30 * 60_000).toISOString() }); continue; }
    }
    if (r.status === "sent") sent++;
    const next = steps[en.cursor + 1];
    if (!next) update("email_enrollment", en.id, { cursor: en.cursor + 1, status: "done", next_at: null });
    else update("email_enrollment", en.id, { cursor: en.cursor + 1, next_at: nextSendTime(bizId, new Date(now.getTime() + Number(next.delay_days ?? 1) * 86_400_000)).toISOString() });
  }
  return sent;
}
