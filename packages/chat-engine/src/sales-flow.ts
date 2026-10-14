import { z } from "zod";
import { activeDna, audit, byId, insert, q, update, type Row } from "@dotaka/db";
import { forbiddenHits, type ChatDecision } from "@dotaka/jev";
import { generate } from "@dotaka/llm-gateway";
import { AppError } from "@dotaka/shared";

/**
 * Kịch bản chốt đơn (luồng nhắn tin Messenger + Zalo) theo TỪNG sản phẩm trong DNA (trang "Mục tiêu & DNA" → Sản phẩm),
 * soạn từ sản phẩm + DNA: Chào → Khai thác nhu cầu → Tư vấn → Xử lý từ chối → Xin SĐT → Chốt → Chăm lại.
 * Mục tiêu tự đặt theo sản phẩm: sản phẩm giao hàng xin SĐT + địa chỉ để lên đơn; khoá học / dịch vụ xin SĐT để tư vấn viên
 * gọi; hoặc chốt bằng link (đổi ở trang kịch bản).
 * Sếp soạn bằng AI (hoặc mẫu chuẩn), sửa, rồi Bật → Chat Agent đi theo kịch bản mỗi lượt (vẫn qua bộ chặn sự thật / câu cấm).
 * Nội dung kịch bản đang BẬT được coi là dữ kiện Sếp đã duyệt.
 * Hai chế độ: "auto" (AI tự trả lời) và "suggest" (bot chỉ soạn gợi ý ghim trên hội thoại, nhân viên bấm gửi — không bao giờ tự gửi).
 */
export const FLOW_STAGES = ["chao", "khai_thac", "tu_van", "xu_ly_tu_choi", "xin_sdt", "chot", "cham_lai"] as const;
export type FlowStageKey = (typeof FLOW_STAGES)[number];
export const STAGE_LABEL: Record<FlowStageKey, string> = {
  chao: "Chào & bắt nhu cầu", khai_thac: "Khai thác nhu cầu", tu_van: "Tư vấn theo nỗi đau", xu_ly_tu_choi: "Xử lý từ chối",
  xin_sdt: "Xin số điện thoại", chot: "Chốt đơn", cham_lai: "Chăm lại khi khách im",
};

export const SalesFlow = z.object({
  /** auto = AI Agent tự trả lời; suggest = bot soạn sẵn câu trả lời để nhân viên tham khảo / bấm gửi (không tự gửi). */
  mode: z.enum(["auto", "suggest"]).default("auto"),
  objective: z.enum(["link", "phone_order", "phone_consult"]),
  objectiveNote: z.string().max(300),
  stages: z.array(z.object({
    key: z.enum(FLOW_STAGES), goal: z.string().min(3).max(300),
    sayLike: z.array(z.string().min(3).max(400)).min(1).max(4),
    nextWhen: z.string().max(300),
  })).length(FLOW_STAGES.length),
  objections: z.array(z.object({ q: z.string().min(2).max(200), a: z.string().min(3).max(500) })).max(8),
  followUps: z.array(z.object({ afterHours: z.number().int().min(1).max(168), text: z.string().min(3).max(400) })).max(3),
});
export type SalesFlow = z.infer<typeof SalesFlow>;

const price = (v: unknown) => (v == null || v === "" ? null : Number(v) === 0 ? "miễn phí" : `${Number(v).toLocaleString("vi-VN")}đ`);
const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
/** Sản phẩm cần giao hàng? Khoá học / chương trình / dịch vụ / phần mềm … thì không (xin SĐT để tư vấn, không xin địa chỉ). */
const ships = (p: Row) => !/khoa hoc|lop hoc|course|dich vu|saas|cong dong|online|offline|su kien|workshop|hoi thao|coaching|tu van|dao tao|chuong trinh|training|membership|phan mem|ung dung|website|camp\b/
  .test(plain(`${p.format ?? ""} ${p.summary ?? ""} ${p.name ?? ""}`));
/** Mục tiêu mặc định theo sản phẩm (đổi được ở trang kịch bản). */
export function objectiveOf(p: Row): SalesFlow["objective"] {
  return ships(p) ? "phone_order" : "phone_consult";
}
const OBJECTIVE_NOTE: Record<SalesFlow["objective"], string> = {
  link: "Chốt bằng link đăng ký / mua: khách bấm link; xin SĐT/Zalo để báo ưu đãi nếu khách chưa chốt ngay.",
  phone_order: "Xin SĐT + địa chỉ để lên đơn COD (đơn chờ nhân viên / Sếp xác nhận).",
  phone_consult: "Xin SĐT (hoặc Zalo) để tư vấn viên gọi xác nhận, hướng dẫn đăng ký / thanh toán.",
};

/** Kịch bản mẫu chuẩn (không cần AI): chỉ dùng dữ kiện có thật của sản phẩm. `objective` = mục tiêu Sếp đã chọn (mặc định theo sản phẩm). */
export function defaultFlow(p: Row, _dna?: Row, objective?: SalesFlow["objective"]): SalesFlow {
  const name = String(p.name ?? "sản phẩm");
  const points = (Array.isArray(p.sellingPoints) ? p.sellingPoints : String(p.summary ?? "").split(/\s*;\s*/)).map(String).filter((x: string) => x && x !== name).slice(0, 3);
  const pr = price(p.price);
  const offer = p.offer ? ` đang có ưu đãi ${p.offer}` : "";
  const obj = objective ?? objectiveOf(p);
  const link = String(p.link ?? "").trim();
  const close = obj === "link" && link
    ? [`Dạ anh/chị đăng ký / đặt ${name} tại đây nhé ạ: ${link}. Xong anh/chị nhắn em để em kiểm tra giúp ạ.`]
    : obj === "phone_order"
      ? [`Dạ em lên đơn ${name}${pr ? ` (${pr})` : ""} cho anh/chị nhé. Anh/chị cho em xin tên, số điện thoại và địa chỉ nhận hàng ạ?`, "Dạ em xác nhận lại đơn: [sản phẩm] · [số lượng] · giao tới [địa chỉ]. Anh/chị kiểm tra giúp em đúng chưa ạ?"]
      : [`Dạ em ghi nhận đăng ký ${name} cho anh/chị ạ. Anh/chị cho em xin số điện thoại và khung giờ tiện nghe máy để tư vấn viên gọi xác nhận nhé ạ?`];
  return {
    mode: "auto", objective: obj, objectiveNote: OBJECTIVE_NOTE[obj],
    stages: [
      { key: "chao", goal: "Chào thân thiện, cảm ơn khách đã nhắn, hỏi 1 câu mở về nhu cầu.", sayLike: [`Dạ em chào anh/chị ạ, cảm ơn anh/chị đã quan tâm ${name}. Anh/chị đang tìm hiểu cho bản thân hay cho người nhà ạ?`], nextWhen: "Khách nói nhu cầu hoặc hỏi thông tin." },
      { key: "khai_thac", goal: "Hỏi tối đa 2 câu ngắn để hiểu đúng nhu cầu / nỗi đau (dùng cho, vấn đề đang gặp, đã dùng sản phẩm tương tự chưa).", sayLike: [`Dạ anh/chị dùng ${name} cho mục đích gì là chính ạ?`, "Trước giờ anh/chị đã dùng loại nào tương tự chưa ạ, thấy chưa ưng ở điểm nào ạ?"], nextWhen: "Đã rõ nhu cầu chính của khách." },
      { key: "tu_van", goal: "Nối 1–2 điểm nổi bật đúng với nhu cầu khách vừa nói; báo giá/ưu đãi khi khách hỏi; kết bằng 1 câu hỏi dẫn tới bước tiếp.", sayLike: [`Dạ với nhu cầu của anh/chị thì ${name} hợp vì ${points[0] ?? "đúng nhu cầu anh/chị nêu"}${points[1] ? `, ${points[1]}` : ""} ạ.${pr ? ` Giá ${pr}${offer}.` : offer ? ` Hiện${offer}.` : ""} Anh/chị muốn em gửi thêm thông tin hay giữ ưu đãi luôn ạ?`], nextWhen: "Khách quan tâm, hỏi giá / cách mua, hoặc băn khoăn." },
      { key: "xu_ly_tu_choi", goal: "Đồng cảm trước, trả lời đúng băn khoăn bằng dữ kiện thật (không hứa hẹn quá), rồi đề xuất bước nhỏ dễ đồng ý.", sayLike: ["Dạ em hiểu anh/chị cân nhắc là đúng ạ. [trả lời băn khoăn bằng dữ kiện thật]. Anh/chị cứ để lại số, khi nào cần em báo ưu đãi tốt nhất cho mình nhé ạ?"], nextWhen: "Khách đỡ băn khoăn hoặc đồng ý bước tiếp." },
      { key: "xin_sdt", goal: "Xin SĐT/Zalo kèm LÝ DO có lợi cho khách (gửi ưu đãi, tư vấn kỹ, giữ suất), chỉ xin 1 lần mỗi lượt, không ép.", sayLike: [`Dạ anh/chị cho em xin số điện thoại (hoặc Zalo) để em gửi${offer ? " ưu đãi" : " thông tin chi tiết"} và tư vấn kỹ hơn cho mình nhé ạ?`], nextWhen: "Khách gửi SĐT hoặc nói muốn mua." },
      { key: "chot", goal: OBJECTIVE_NOTE[obj], sayLike: close, nextWhen: "Đơn / đăng ký đã ghi nhận → cảm ơn và dặn bước tiếp theo." },
      { key: "cham_lai", goal: "Khách im lặng: nhắc nhẹ 1–2 lần, nhắc đúng nhu cầu khách đã nêu, để ngỏ, không hỏi dồn.", sayLike: [`Dạ em hỏi thăm lại anh/chị ạ, ${name}${offer} anh/chị cần em giữ phần hay tư vấn thêm không ạ?`], nextWhen: "Khách nhắn lại → quay lại bước phù hợp; khách từ chối → dừng." },
    ],
    objections: [
      { q: "Giá hơi cao / đắt", a: `Dạ em hiểu ạ.${pr ? ` ${name} giá ${pr}` : ""}${offer ? `, hiện${offer}` : ""}. Anh/chị so sánh giúp em với nhu cầu mình cần nhé ạ, cần em tư vấn gói phù hợp hơn không ạ?` },
      { q: "Để suy nghĩ thêm / hỏi người nhà", a: "Dạ vâng ạ, anh/chị cứ cân nhắc thoải mái. Em gửi tóm tắt thông tin để anh/chị tham khảo cùng người nhà nhé, cần gì anh/chị nhắn em ạ." },
      { q: "Có hiệu quả thật không?", a: `Dạ em chia sẻ đúng thông tin sản phẩm: ${points.join("; ") || name}. Em không dám hứa kết quả giống nhau cho mọi người, anh/chị muốn em gửi thêm thông tin chi tiết không ạ?` },
    ],
    followUps: [
      { afterHours: 4, text: `Dạ anh/chị ơi, ${name}${offer} anh/chị cần em giữ phần hoặc tư vấn thêm không ạ?` },
      { afterHours: 22, text: `Dạ em hỏi thăm lại ạ, khi nào cần thông tin về ${name} anh/chị nhắn em nhé ạ.` },
    ],
  };
}

/** Câu cấm (DNA) còn sót trong kịch bản — chặn khi Bật. */
export function flowIssues(flow: SalesFlow, dna?: Row): string[] {
  const all = [flow.objectiveNote, ...flow.stages.flatMap((s) => [s.goal, ...s.sayLike, s.nextWhen]), ...flow.objections.flatMap((o) => [o.q, o.a]), ...flow.followUps.map((f) => f.text)].join("\n");
  const hits = forbiddenHits(all, (dna?.forbiddenClaims ?? []) as string[]);
  const chars = ((dna?.bannedChars ?? []) as string[]).filter((c) => all.includes(c));
  return [...(hits.length ? [`Có câu cấm trong DNA: ${hits.join(", ")}`] : []), ...(chars.length ? [`Có ký tự cấm: ${chars.join(" ")}`] : [])];
}

// ---------------- Lưu trữ ----------------
const productOf = (bizId: string, key: string) => ((activeDna(bizId)?.data?.products ?? []) as Row[]).find((p) => p.key === key);
function mustProduct(bizId: string, key: string) {
  const p = productOf(bizId, key);
  if (!p) throw new AppError("NOT_FOUND", "Không thấy sản phẩm trong DNA", 404);
  return p;
}
const getSalesFlowRow = (bizId: string, productKey: string) => q.get<Row>("SELECT * FROM sales_flow WHERE biz_id = ? AND product_key = ?", bizId, productKey);
export function getSalesFlow(bizId: string, productKey: string) {
  const p = mustProduct(bizId, productKey);
  const row = getSalesFlowRow(bizId, productKey);
  return { product: { key: p.key, name: p.name, price: p.price ?? null, link: p.link ?? null, format: p.format ?? null },
    status: (row?.status ?? "none") as "none" | "draft" | "active" | "paused", source: row?.source ?? null, updatedAt: row?.updated_at ?? null,
    flow: (row?.data as SalesFlow | undefined) ?? defaultFlow(p, activeDna(bizId)?.data), stageLabels: STAGE_LABEL };
}
export function listSalesFlows(bizId: string) {
  const rows = new Map(q.all<Row>("SELECT product_key, status, updated_at, data FROM sales_flow WHERE biz_id = ?", bizId).map((r) => [r.product_key, r]));
  return ((activeDna(bizId)?.data?.products ?? []) as Row[]).map((p) => ({
    key: p.key, name: p.name, objective: (rows.get(p.key)?.data?.objective ?? objectiveOf(p)) as SalesFlow["objective"],
    mode: (rows.get(p.key)?.data?.mode ?? "auto") as SalesFlow["mode"],
    status: rows.get(p.key)?.status ?? "none", updatedAt: rows.get(p.key)?.updated_at ?? null,
  }));
}
export function saveSalesFlow(bizId: string, productKey: string, input: { flow: unknown; status?: "draft" | "active" | "paused" }, actor: string, source = "manual") {
  mustProduct(bizId, productKey);
  const flow = SalesFlow.parse(input.flow);
  // Thứ tự bước cố định: Chào → … → Chăm lại.
  flow.stages.sort((a, b) => FLOW_STAGES.indexOf(a.key) - FLOW_STAGES.indexOf(b.key));
  const status = input.status ?? "draft";
  if (status === "active") {
    const issues = flowIssues(flow, activeDna(bizId)?.data);
    if (issues.length) throw new AppError("FLOW_BLOCKED", `Chưa bật được kịch bản — ${issues.join("; ")}`);
  }
  const row = q.get<Row>("SELECT id FROM sales_flow WHERE biz_id = ? AND product_key = ?", bizId, productKey);
  if (row) update("sales_flow", row.id, { data: flow, status, source });
  else insert("sales_flow", { biz_id: bizId, product_key: productKey, data: flow, status, source });
  audit(bizId, actor, `sales_flow.${status === "active" ? "activated" : "saved"}`, { type: "sales_flow", id: productKey }, { status, source });
  return getSalesFlow(bizId, productKey);
}
export function setSalesFlowStatus(bizId: string, productKey: string, status: "active" | "paused", actor: string) {
  const cur = getSalesFlow(bizId, productKey);
  return saveSalesFlow(bizId, productKey, { flow: cur.flow, status }, actor, cur.source ?? "manual");
}

/** AI soạn kịch bản từ sản phẩm + DNA (giọng, khách hàng, điều cấm). Không có model → mẫu chuẩn. Lưu dạng nháp. */
export async function generateSalesFlow(bizId: string, productKey: string, actor: string, note?: string, wantObjective?: SalesFlow["objective"]) {
  const p = mustProduct(bizId, productKey);
  const dna = (activeDna(bizId)?.data ?? {}) as Row;
  const stored = getSalesFlowRow(bizId, productKey)?.data as SalesFlow | undefined;
  // Mục tiêu: Sếp vừa chọn trên trang → đã lưu → mặc định theo sản phẩm. Soạn lại không đổi mục tiêu Sếp đã chọn.
  const objective = wantObjective ?? stored?.objective ?? objectiveOf(p);
  const base = defaultFlow(p, dna, objective);
  const generalOffers = (Array.isArray(dna.offers) ? dna.offers : []).map(String).filter(Boolean).slice(0, 4);
  const facts = [
    `Sản phẩm: ${p.name}`, price(p.price) ? `Giá: ${price(p.price)}` : "Giá: (không có — không được tự đưa giá)",
    p.offer ? `Ưu đãi: ${p.offer}` : "", p.summary ? `Điểm bán: ${p.summary}` : "", Array.isArray(p.sellingPoints) && p.sellingPoints.length ? `Điểm nổi bật: ${p.sellingPoints.join("; ")}` : "",
    p.audience ? `Khách hàng mục tiêu: ${p.audience}` : "", p.policy ? `Chính sách: ${p.policy}` : "", p.link ? `Link: ${p.link}` : "",
    p.format ? `Hình thức: ${p.format}` : "",
    ...(generalOffers.length ? [`Ưu đãi / chính sách chung của doanh nghiệp: ${generalOffers.join(" | ")}`] : []),
  ].filter(Boolean);
  const res = await generate({
    bizId, agentKey: "chat", tier: "medium", schema: SalesFlow,
    system: [
      "Bạn là trưởng nhóm sales chat (Messenger + Zalo) ở Việt Nam. Viết KỊCH BẢN NHẮN TIN 7 bước cho 1 sản phẩm để nhân viên/bot đi theo, mục tiêu xin được SĐT hoặc chốt đơn.",
      `7 bước đúng thứ tự key: ${FLOW_STAGES.join(", ")} (${FLOW_STAGES.map((k) => STAGE_LABEL[k]).join(" → ")}).`,
      `Mục tiêu (objective) bắt buộc = "${base.objective}": ${OBJECTIVE_NOTE[base.objective]}`,
      "Mỗi bước: goal (mục tiêu 1 câu), sayLike (1–3 mẫu câu, mỗi câu 1–3 câu ngắn, xưng 'em' gọi 'anh/chị', kết bằng câu hỏi dễ trả lời), nextWhen (khi nào sang bước sau).",
      "objections: 3–6 băn khoăn thường gặp với ĐÚNG sản phẩm này + câu trả lời đồng cảm. followUps: 2 tin nhắc khi khách im (sau ~4 giờ và ~22 giờ; Messenger chỉ được nhắn trong 24 giờ).",
      "CHỈ dùng dữ kiện trong SẢN PHẨM; không có giá thì không đưa giá; không bịa số liệu, đánh giá, khách hàng, khuyến mãi. Có thể để chỗ trống dạng [tên khách] / [địa chỉ].",
      `Giọng thương hiệu: ${(dna.voice?.style ?? []).join(", ") || "thân thiện, chuyên nghiệp"}. Tránh: ${(dna.voice?.dont ?? []).join("; ") || "đại ngôn"}. TUYỆT ĐỐI không dùng: ${(dna.forbiddenClaims ?? []).join("; ") || "cam kết kết quả"}. Không dùng ký tự: ${(dna.bannedChars ?? []).join(" ") || "—"}.`,
    ].join("\n"),
    user: `SẢN PHẨM:\n${facts.join("\n")}\n\nDOANH NGHIỆP: ${dna.company?.brand ?? dna.company?.name ?? ""} · ${dna.company?.industry ?? ""}\nKHÁCH HÀNG (DNA): ${(dna.audience ?? []).map((a: Row) => `${a.name}${a.pains?.length ? ` (nỗi đau: ${a.pains.join(", ")})` : ""}`).join("; ") || "(chưa có)"}${note ? `\n\nSẾP DẶN THÊM: ${note}` : ""}\n\nViết kịch bản.`,
    sandbox: () => base,
  });
  // Ký tự cấm trong DNA (vd gạch dài) → thay dấu phẩy trước khi lưu, để Sếp không bị chặn khi Bật.
  const banned = (dna.bannedChars ?? []) as string[];
  const clean = (t: string) => banned.reduce((x, c) => x.split(c).join(","), t);
  const out = res.output;
  const flow: SalesFlow = {
    ...out, mode: stored?.mode ?? "auto", objective: base.objective, objectiveNote: clean(out.objectiveNote),
    stages: out.stages.map((st) => ({ ...st, goal: clean(st.goal), sayLike: st.sayLike.map(clean), nextWhen: clean(st.nextWhen) })),
    objections: out.objections.map((o) => ({ q: clean(o.q), a: clean(o.a) })), followUps: out.followUps.map((f) => ({ ...f, text: clean(f.text) })),
  };
  return { ...saveSalesFlow(bizId, productKey, { flow, status: "draft" }, actor, res.model === "sandbox" ? "template" : "ai"), model: res.model };
}

// ---------------- Dùng trong lượt chat ----------------
/** Kịch bản đang BẬT cho sản phẩm (null nếu chưa bật). */
export function activeFlow(bizId: string, productKey: string | null | undefined): { productKey: string; flow: SalesFlow } | null {
  if (!productKey) return null;
  const row = q.get<Row>("SELECT data FROM sales_flow WHERE biz_id = ? AND product_key = ? AND status = 'active'", bizId, productKey);
  return row ? { productKey, flow: row.data as SalesFlow } : null;
}
/** Sản phẩm khách đang nói tới: ý định lượt này → kịch bản hội thoại đang theo → kịch bản duy nhất đang bật. */
export function flowProductFor(bizId: string, conv: Row, interest: string | null | undefined): string | null {
  if (interest && activeFlow(bizId, interest)) return interest;
  const prev = conv.ext?.flow?.productKey as string | undefined;
  if (prev && activeFlow(bizId, prev)) return prev;
  const on = q.all<Row>("SELECT product_key FROM sales_flow WHERE biz_id = ? AND status = 'active'", bizId);
  return on.length === 1 ? on[0].product_key : null;
}
const stripVi = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Có cụm từ (đứng riêng). Tin CÓ dấu → so có dấu ("đắt" ≠ "đặt"); tin gõ KHÔNG dấu → so không dấu. */
export function hasViPhrase(text: string, words: string[]): boolean {
  const lower = text.normalize("NFC").toLowerCase();
  const unaccentedText = stripVi(text);
  const unaccented = unaccentedText === lower;
  return words.some((w) => {
    const [hay, needle] = unaccented ? [unaccentedText, stripVi(w)] : [lower, w.normalize("NFC").toLowerCase()];
    return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escRe(needle)}(?![\\p{L}\\p{M}\\p{N}])`, "u").test(hay);
  });
}
const OBJECTION_WORDS = ["đắt", "mắc", "cao quá", "giá cao", "suy nghĩ", "để xem", "hỏi chồng", "hỏi vợ", "hỏi người nhà", "chưa cần", "không biết có", "có hiệu quả", "có tốt không", "lừa", "sợ", "bên khác rẻ", "chỗ khác rẻ", "tham khảo thêm"];
/**
 * Khách đang ở bước nào (tất định, không tốn model): đã có SĐT / muốn mua → Chốt; băn khoăn → Xử lý từ chối;
 * còn lại theo số lượt bot đã trả lời: 0 → Chào/Khai thác, 1 → Khai thác, 2 → Tư vấn, ≥3 → Xin SĐT (chưa có số).
 */
export function flowStageFor(p: { botTurns: number; intent: ChatDecision["intent"]; text: string; phoneShared: boolean; objective: SalesFlow["objective"] }): FlowStageKey {
  if (p.phoneShared) return "chot";
  // Băn khoăn rõ ràng ("hơi đắt", "để suy nghĩ") thắng ý định mua đoán sai từ chữ bỏ dấu ("đắt" → "dat" ≈ "đặt").
  const objection = hasViPhrase(p.text, OBJECTION_WORDS);
  if (p.intent === "register" && !objection) return "chot";
  if (objection) return "xu_ly_tu_choi";
  if (p.intent === "ask_price") return p.botTurns >= 2 ? "xin_sdt" : "tu_van";
  if (p.botTurns === 0) return p.intent === "smalltalk" ? "chao" : "khai_thac";
  if (p.botTurns === 1) return "khai_thac";
  if (p.botTurns === 2) return "tu_van";
  return "xin_sdt";
}
/** Lời dặn cho model trả lời: bước hiện tại + mẫu câu + băn khoăn thường gặp (đây là dữ kiện Sếp đã duyệt). */
export function flowPrompt(flow: SalesFlow, stage: FlowStageKey, productName: string): string {
  const s = flow.stages.find((x) => x.key === stage) ?? flow.stages[0];
  const i = FLOW_STAGES.indexOf(s.key);
  const next = flow.stages[i + 1];
  return [
    `KỊCH BẢN CHỐT ĐƠN (Sếp đã duyệt) — sản phẩm ${productName}. Mục tiêu cuối: ${flow.objectiveNote}`,
    `BƯỚC HIỆN TẠI ${i + 1}/7 · ${STAGE_LABEL[s.key]}: ${s.goal}`,
    `Mẫu câu tham khảo (diễn đạt tự nhiên theo tin khách, không chép máy móc): ${s.sayLike.map((x) => `"${x}"`).join(" | ")}`,
    `Sang bước tiếp khi: ${s.nextWhen}${next ? ` → bước ${i + 2} · ${STAGE_LABEL[next.key]}` : ""}.`,
    flow.objections.length ? `Băn khoăn thường gặp & cách trả lời: ${flow.objections.map((o) => `[${o.q}] ${o.a}`).join(" · ")}` : "",
    "Vẫn chỉ 2–4 câu, chỉ dùng FACTS + kịch bản này; mỗi tin kết bằng 1 câu hỏi dẫn tới bước tiếp; chỉ xin SĐT 1 lần mỗi tin, không ép.",
    "KHÔNG tự khẳng định công dụng sức khoẻ hay đối tượng dùng (mẹ bầu, trẻ nhỏ, người bệnh, người dị ứng…) nếu FACTS không ghi rõ — nói thật là thông tin sản phẩm chưa ghi, khuyên hỏi ý kiến bác sĩ / chuyên gia, rồi tiếp tục bước hiện tại.",
  ].filter(Boolean).join("\n");
}
/** Dữ kiện từ kịch bản đang bật (cho bộ chặn sự thật không chặn nhầm câu Sếp đã duyệt). */
export function flowFacts(flow: SalesFlow, productKey: string): string[] {
  return [...flow.stages.flatMap((s) => s.sayLike), ...flow.objections.map((o) => o.a)].map((t) => `[flow:${productKey}] ${t}`);
}
/** Ghi bước hiện tại (+ các bước đã đi qua, chế độ) lên hội thoại — trang Chat hiện "Bước: …", vòng học đếm phễu theo bước. */
export function recordFlowStage(conv: Row, productKey: string, stage: FlowStageKey, mode: SalesFlow["mode"] = "auto") {
  const cur = (byId<Row>("conversation", conv.id)?.ext ?? conv.ext ?? {}) as Row;
  const reached = [...new Set([...((cur.flow?.productKey === productKey ? cur.flow?.reached : []) ?? []), stage])] as FlowStageKey[];
  const ext = { ...cur, flow: { productKey, stage, label: STAGE_LABEL[stage], mode, reached, at: new Date().toISOString() } };
  update("conversation", conv.id, { ext });
  conv.ext = ext;
}

/** Bảng hỗ trợ nhân viên trên trang Chat: chế độ, bước hiện tại, mẫu câu bước này + băn khoăn thường gặp (bấm để chèn). */
export function flowHelpFor(bizId: string, conv: Row) {
  const f = conv.ext?.flow as Row | undefined;
  const af = activeFlow(bizId, f?.productKey);
  if (!f || !af) return null;
  const stage = (f.stage ?? "chao") as FlowStageKey;
  const s = af.flow.stages.find((x) => x.key === stage) ?? af.flow.stages[0];
  return { productKey: af.productKey, mode: af.flow.mode ?? "auto", stage, label: STAGE_LABEL[stage], step: FLOW_STAGES.indexOf(stage) + 1,
    goal: s.goal, samples: s.sayLike, nextWhen: s.nextWhen, objections: af.flow.objections.slice(0, 6), reached: (f.reached ?? []) as FlowStageKey[] };
}

// ---------------- Chat thử (xem trước, KHÔNG gửi cho ai) ----------------
const PHONE_RE = /(0|\+84)\d{9,10}/;
/** Ý định thô cho chat thử (lượt thật dùng Jev). */
function roughIntent(text: string): ChatDecision["intent"] {
  if (hasViPhrase(text, ["mua", "đặt", "lấy", "chốt", "ship", "đăng ký", "order", "lên đơn"])) return "register";
  if (hasViPhrase(text, ["giá", "bao nhiêu", "nhiêu tiền", "bao tiền", "phí", "học phí"])) return "ask_price";
  if (hasViPhrase(text, ["chào", "hello", "hi", "alo", "cảm ơn"])) return "smalltalk";
  return "other";
}
/** Sếp đóng vai khách: trả về bước hiện tại + câu bot sẽ trả lời theo kịch bản (bản nháp hoặc đang bật). */
export async function previewFlowReply(bizId: string, productKey: string, input: { flow?: unknown; messages: { from: "customer" | "bot"; text: string }[] }) {
  const p = mustProduct(bizId, productKey);
  const flow = input.flow ? SalesFlow.parse(input.flow) : getSalesFlow(bizId, productKey).flow;
  const msgs = input.messages.slice(-12);
  const last = [...msgs].reverse().find((m) => m.from === "customer");
  if (!last) throw new AppError("INVALID", "Nhập tin nhắn của khách");
  const botTurns = msgs.filter((m) => m.from === "bot").length;
  const phoneShared = msgs.some((m) => m.from === "customer" && PHONE_RE.test(m.text.replace(/[\s.]/g, "")));
  const stage = flowStageFor({ botTurns, intent: roughIntent(last.text), text: last.text, phoneShared, objective: flow.objective });
  const dna = activeDna(bizId)?.data as Row | undefined;
  const facts = [`[dna:products.${p.key}] ${p.name}: ${p.summary ?? ""}; ${p.format ?? ""}; giá ${price(p.price) ?? "liên hệ tư vấn"}${p.offer ? `; ưu đãi ${p.offer}` : ""}${p.link ? `; link ${p.link}` : ""}`, ...flowFacts(flow, p.key)];
  const Reply = z.object({ reply: z.string() });
  const res = await generate({
    bizId, agentKey: "chat", tier: "small", schema: Reply,
    system: [
      `Bạn là trợ lý tư vấn của ${dna?.company?.brand ?? dna?.company?.name ?? "doanh nghiệp"}.`,
      "Xưng 'em', gọi khách 'anh/chị'. Trả lời ngắn (2–4 câu), ấm áp, đi thẳng vào vấn đề. Chỉ dùng FACTS. Không cam kết kết quả.",
      flowPrompt(flow, stage, String(p.name)),
    ].join("\n"),
    user: `FACTS:\n${facts.join("\n")}\n\nHỘI THOẠI:\n${msgs.map((m) => `${m.from === "customer" ? "Khách" : "Em"}: ${m.text}`).join("\n")}\n\nViết câu trả lời cho tin cuối của khách.`,
    sandbox: () => ({ reply: (flow.stages.find((s) => s.key === stage) ?? flow.stages[0]).sayLike[0] }),
  });
  return { stage, label: STAGE_LABEL[stage], step: FLOW_STAGES.indexOf(stage) + 1, reply: res.output.reply.replace(/—/g, ","), model: res.model, sent: false };
}
