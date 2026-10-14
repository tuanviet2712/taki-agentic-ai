import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import type { Connector } from "@dotaka/connectors";
import {
  activeFlow, defaultFlow, flowHelpFor, flowIssues, flowPrompt, flowStageFor, generateSalesFlow, getSalesFlow, handleIncoming, hasViPhrase,
  listSalesFlows, objectiveOf, previewFlowReply, runFollowUps, saveSalesFlow, setConversationConnector, setSalesFlowStatus,
} from "./index.ts";

/**
 * Kịch bản chốt đơn (Messenger + Zalo): quy trình 7 bước theo sản phẩm TRONG DNA, soạn từ sản phẩm + DNA; bật → bot đi theo kịch bản,
 * ghi bước hiện tại lên hội thoại, tin nhắc dùng mẫu Sếp duyệt. Chạy offline (LLM sandbox, Jev heuristic, Fanpage là connector giả).
 */
const DNA = {
  company: { name: "Học viện Mẫu", brand: "Mẫu Academy", industry: "Đào tạo kỹ năng số" },
  voice: { style: ["Thực chiến", "Thẳng"], dont: ["Đại ngôn"], selfPronoun: "em", customerPronoun: "anh/chị" },
  audience: [{ name: "Chủ doanh nghiệp nhỏ", pains: ["Không có thời gian", "Chi phí marketing cao"] }],
  offers: ["Khóa AI Plus miễn phí 5 buổi"],
  forbiddenClaims: ["cam kết kết quả", "làm giàu nhanh"],
  bannedChars: ["—"],
  leadMagnet: "Khóa AI Plus miễn phí 5 buổi",
};
const KH = { key: "khoa-ai", name: "Khóa AI Marketing", aliases: ["AI Marketing"], summary: "Khóa học offline 3 ngày ứng dụng AI vào marketing; có thực hành", price: 12_000_000, offer: "Giảm 10% đăng ký sớm", link: "https://khoa.example.vn/ai", format: "Offline", audience: "Chủ doanh nghiệp" };
const NOI = { key: "noi-chien", name: "Nồi chiên 5L", summary: "Chiên không dầu; dung tích 5L", price: 990_000, format: "Hàng gia dụng" };
const FREE = { key: "ai-plus", name: "AI Plus", summary: "Khóa AI miễn phí 5 buổi", price: 0, format: "Khóa học online" };

const sent: { conversationExternalId: string; text: string }[] = [];
const fakeLive = (): Connector => ({
  platform: "meta", mode: "live", limits: { requestsPerMinute: 60, concurrency: 2 },
  health: async () => ({ ok: true, detail: "fake" }),
  sendMessage: async (spec) => { sent.push({ conversationExternalId: spec.conversationExternalId, text: spec.text }); return { externalId: `m_out_${sent.length}` }; },
});

let B: string;
beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Học viện Mẫu", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "test", data: { ...DNA, products: [KH, NOI, FREE] } });
});
afterAll(() => { setConversationConnector(() => null); closeDb(); });
beforeEach(() => { sent.length = 0; setConversationConnector(() => fakeLive()); });

describe("kịch bản chốt đơn theo sản phẩm trong DNA", () => {
  it("mục tiêu tự đặt theo sản phẩm; mẫu chuẩn đủ 7 bước, dùng đúng dữ kiện, không chứa câu cấm", () => {
    expect(objectiveOf(KH)).toBe("phone_consult"); // khoá offline: xin SĐT cho tư vấn viên gọi, không xin địa chỉ
    expect(objectiveOf(FREE)).toBe("phone_consult");
    expect(objectiveOf(NOI)).toBe("phone_order");
    const f = defaultFlow(KH);
    expect(f.stages.map((s) => s.key)).toEqual(["chao", "khai_thac", "tu_van", "xu_ly_tu_choi", "xin_sdt", "chot", "cham_lai"]);
    expect(f.stages.find((s) => s.key === "tu_van")!.sayLike[0]).toContain("12.000.000đ");
    expect(f.stages.find((s) => s.key === "chot")!.sayLike[0]).not.toContain("địa chỉ");
    expect(flowIssues(f, DNA)).toEqual([]);
    expect(defaultFlow(NOI).stages.find((s) => s.key === "chot")!.sayLike[0]).toMatch(/địa chỉ/);
    // mục tiêu "link" (Sếp chọn trên trang): câu chốt chứa link của sản phẩm trong DNA
    const link = defaultFlow(KH, DNA, "link");
    expect(link.objective).toBe("link");
    expect(link.stages.find((s) => s.key === "chot")!.sayLike[0]).toContain(KH.link);
  });

  it("chưa lưu → xem mẫu chuẩn; AI soạn (sandbox = mẫu) lưu nháp; có câu cấm → không cho Bật; Bật / Tạm tắt; soạn lại giữ mục tiêu đã chọn", async () => {
    expect(getSalesFlow(B, KH.key).status).toBe("none");
    expect(listSalesFlows(B).map((x) => [x.key, x.status, x.objective])).toEqual([[KH.key, "none", "phone_consult"], [NOI.key, "none", "phone_order"], [FREE.key, "none", "phone_consult"]]);
    const g = await generateSalesFlow(B, KH.key, "Sếp");
    expect(g).toMatchObject({ status: "draft", source: "template" });
    const bad = structuredClone(g.flow);
    bad.stages[2].sayLike = ["Học xong là cam kết kết quả 100% luôn ạ"];
    expect(() => saveSalesFlow(B, KH.key, { flow: bad, status: "active" }, "Sếp")).toThrow(/câu cấm/);
    expect(activeFlow(B, KH.key)).toBeNull();
    expect(saveSalesFlow(B, KH.key, { flow: g.flow, status: "active" }, "Sếp").status).toBe("active");
    expect(activeFlow(B, KH.key)?.flow.objective).toBe("phone_consult");
    expect(listSalesFlows(B).find((x) => x.key === KH.key)?.status).toBe("active");
    expect(setSalesFlowStatus(B, KH.key, "paused", "Sếp").status).toBe("paused");
    // Sếp đổi mục tiêu sang "link" rồi bấm AI soạn lại → giữ "link", câu chốt có link
    const re = await generateSalesFlow(B, KH.key, "Sếp", undefined, "link");
    expect(re.flow.objective).toBe("link");
    expect(re.flow.stages.find((s) => s.key === "chot")!.sayLike[0]).toContain(KH.link);
    const again = await generateSalesFlow(B, KH.key, "Sếp");
    expect(again.flow.objective).toBe("link");
    // sản phẩm không có trong DNA → 404
    expect(() => getSalesFlow(B, "khong-co")).toThrow(/Không thấy sản phẩm/);
  });

  it("ký tự cấm của DNA (gạch dài) bị thay dấu phẩy khi AI soạn; kịch bản vẫn Bật được", async () => {
    const g = await generateSalesFlow(B, NOI.key, "Sếp");
    expect(JSON.stringify(g.flow)).not.toContain("—");
    expect(flowIssues(g.flow, DNA)).toEqual([]);
  });

  it("xác định bước tất định: chào → khai thác → tư vấn → xin SĐT; băn khoăn → xử lý từ chối; có SĐT / muốn mua → chốt", () => {
    const st = (botTurns: number, text: string, intent: any = "other", phoneShared = false) => flowStageFor({ botTurns, intent, text, phoneShared, objective: "phone_consult" });
    expect(st(0, "chào shop", "smalltalk")).toBe("chao");
    expect(st(0, "cho mình hỏi khóa học")).toBe("khai_thac");
    expect(st(2, "mình làm chủ shop nhỏ")).toBe("tu_van");
    expect(st(1, "học phí bao nhiêu", "ask_price")).toBe("tu_van");
    expect(st(3, "ừ để xem")).toBe("xu_ly_tu_choi");
    expect(st(2, "hơi đắt nhỉ")).toBe("xu_ly_tu_choi");
    expect(st(4, "thế à")).toBe("xin_sdt");
    expect(st(1, "cho mình đăng ký", "register")).toBe("chot");
    expect(st(2, "0912345678", "other", true)).toBe("chot");
    // tin có dấu: "đắt" khác "đặt"; tin gõ không dấu: "dat" vẫn nhận ra
    expect(hasViPhrase("giá đắt quá", ["đắt"])).toBe(true);
    expect(hasViPhrase("mình muốn đặt chỗ", ["đắt"])).toBe(false);
    expect(hasViPhrase("gia dat qua", ["đắt"])).toBe(true);
  });

  it("chat thử: trả bước + câu trả lời theo kịch bản, KHÔNG gửi tin / tạo hội thoại nào", async () => {
    const before = q.scalar<number>("SELECT COUNT(*) FROM message") ?? 0;
    const convs = q.scalar<number>("SELECT COUNT(*) FROM conversation") ?? 0;
    const r = await previewFlowReply(B, KH.key, { messages: [{ from: "customer", text: "học phí khóa này bao nhiêu vậy shop" }] });
    expect(r).toMatchObject({ stage: "tu_van", step: 3, sent: false });
    expect(r.reply).toContain("12.000.000đ");
    const r2 = await previewFlowReply(B, KH.key, { messages: [{ from: "customer", text: "giá sao" }, { from: "bot", text: "a" }, { from: "customer", text: "hơi đắt" }] });
    expect(r2.stage).toBe("xu_ly_tu_choi");
    expect(q.scalar<number>("SELECT COUNT(*) FROM message")).toBe(before);
    expect(q.scalar<number>("SELECT COUNT(*) FROM conversation")).toBe(convs);
    expect(sent).toHaveLength(0);
    // lời dặn có chặn tự khẳng định công dụng sức khoẻ / đối tượng dùng khi FACTS không ghi
    expect(flowPrompt(defaultFlow(KH), "tu_van", KH.name)).toMatch(/KHÔNG tự khẳng định công dụng sức khoẻ/);
  });

  it("hội thoại Messenger: bot theo kịch bản đang bật, ghi bước lên hội thoại; khách gửi SĐT → bước Chốt", async () => {
    const f = getSalesFlow(B, KH.key).flow;
    saveSalesFlow(B, KH.key, { flow: { ...f, objective: "phone_consult" }, status: "active" }, "Sếp");
    const ext = "flow_conv_1";
    const r1 = await handleIncoming(B, { channel: "messenger", externalConversationId: ext, customerName: "Chị Lan", text: "Khóa AI Marketing học phí bao nhiêu shop?", messageId: "f1", pageExternalId: "PAGE1" });
    expect(r1.replied).toBe(true);
    expect(sent).toHaveLength(1);
    const c1 = byId<Row>("conversation", r1.conversationId)!;
    expect(c1.ext.flow).toMatchObject({ productKey: KH.key, stage: "tu_van", label: "Tư vấn theo nỗi đau", mode: "auto" });
    const r2 = await handleIncoming(B, { channel: "messenger", externalConversationId: ext, customerName: "Chị Lan", text: "sđt mình 0912345678 nhé", messageId: "f2", pageExternalId: "PAGE1" });
    expect(byId<Row>("conversation", r2.conversationId)!.ext.flow.stage).toBe("chot");
    expect(flowHelpFor(B, byId<Row>("conversation", r2.conversationId)!)).toMatchObject({ mode: "auto", stage: "chot", step: 6 });
  });

  it("tin nhắc Messenger dùng đúng mẫu trong kịch bản (thay tên khách), không dùng câu chung chung", async () => {
    const conv = q.get<Row>("SELECT * FROM conversation WHERE external_id = 'flow_conv_1'")!;
    q.run("UPDATE conversation SET state = 'awaiting_customer' WHERE id = ?", conv.id);
    // Đồng hồ giả: 12:00 giờ VN (ngoài giờ yên lặng); tin cuối của khách cách đó 5 giờ (quá 4 giờ, còn trong cửa sổ 24 giờ).
    const at = new Date(); at.setUTCHours(5, 0, 0, 0);
    const old = new Date(at.getTime() - 5 * 3600_000).toISOString();
    q.run("UPDATE message SET sent_at = ? WHERE conversation_id = ?", old, conv.id);
    q.run("UPDATE conversation SET last_customer_at = ? WHERE id = ?", old, conv.id);
    q.run("DELETE FROM follow_up_plan WHERE conversation_id = ?", conv.id);
    insert("follow_up_plan", { biz_id: B, conversation_id: conv.id, step: 0, next_at: old, status: "active", template: "sau_hoi_gia" });
    sent.length = 0;
    const n = await runFollowUps(B, at);
    expect(n).toBe(1);
    const want = getSalesFlow(B, KH.key).flow.followUps[0].text.replace(/\[(tên khách|ten khach|tên)\]/gi, "Chị Lan").replace(/\s+/g, " ").trim();
    expect(sent.at(-1)!.text).toBe(want);
    const last = q.get<Row>("SELECT body FROM message WHERE conversation_id = ? AND sender = 'bot' AND json_extract(meta, '$.kind') = 'follow_up' ORDER BY sent_at DESC LIMIT 1", conv.id);
    expect(last!.body.text).toBe(want);
  });
});
