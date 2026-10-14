import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import type { Connector } from "@dotaka/connectors";
import {
  HUMAN_ON_PAGE_MINUTES, OUTSIDE_24H_MESSAGE, conversationOptedOut, detectOptOut, handleIncoming, plainChatText, recordConversationOptOut,
  replyAsHuman, replyWindow, sendBotMessage, setConversationConnector,
} from "./index.ts";

/**
 * Độ tin cậy của bot chat (Messenger thật): thử lại sau lỗi vẫn trả lời, không markdown, bot nhường khi người trả lời trên
 * Facebook, cửa sổ 24 giờ chặn TRƯỚC khi đổi trạng thái, khách báo không nhận tin thì bot im lặng. Facebook là connector giả.
 */
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
  B = insert("biz", { name: "Shop thử lại", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
});
afterAll(() => { setConversationConnector(() => null); closeDb(); });
beforeEach(() => { sent.length = 0; setConversationConnector(() => fakeLive()); });

const outCount = (convId: string) => q.scalar<number>("SELECT COUNT(*) FROM message WHERE conversation_id = ? AND direction = 'out'", convId);
const mkConv = (ext: string, extra: Row = {}) =>
  insert("conversation", { biz_id: B, channel: "messenger", external_id: ext, customer_ref: `cust_${ext}`, customer_name: "Khách A", state: "new", tags: [], unread: 1, ext: { pageId: "PAGE1" }, ...extra });

describe("chat: thử lại sau lỗi", () => {
  it("lượt 1 lỗi sau khi lưu tin → job thử lại trả lời đúng 1 lần; gửi trùng lần nữa → bỏ qua", async () => {
    const conv = mkConv("PSID_RETRY");
    insert("message", { biz_id: B, conversation_id: conv.id, direction: "in", sender: "customer", body: { text: "Shop ơi giá bao nhiêu?" }, external_id: "m_retry_1", sent_at: new Date().toISOString() });
    const msg = { channel: "messenger" as const, externalConversationId: "PSID_RETRY", customerName: "Khách A", text: "Shop ơi giá bao nhiêu?", messageId: "m_retry_1" };
    const r1 = await handleIncoming(B, msg);
    expect(r1.replied).toBe(true);
    expect(outCount(conv.id)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(q.scalar<number>("SELECT COUNT(*) FROM message WHERE conversation_id = ? AND direction = 'in'", conv.id)).toBe(1); // không lưu trùng
    const r2 = await handleIncoming(B, msg);
    expect(r2.replied).toBe(false);
    expect(outCount(conv.id)).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("tin cũ hơn 15 phút → không trả lời lại", async () => {
    const conv = insert("conversation", { biz_id: B, channel: "zalo", external_id: "Z_OLD", customer_ref: "cust_Z_OLD", customer_name: "Khách B", state: "new", tags: [], unread: 1, ext: {} });
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    insert("message", { biz_id: B, conversation_id: conv.id, direction: "in", sender: "customer", body: { text: "Còn hàng không?" }, external_id: "z_old_1", sent_at: old, created_at: old });
    const r = await handleIncoming(B, { channel: "zalo", externalConversationId: "Z_OLD", customerName: "Khách B", text: "Còn hàng không?", messageId: "z_old_1" });
    expect(r.replied).toBe(false);
    expect(outCount(conv.id)).toBe(0);
  });
});

describe("tin gửi khách không có markdown", () => {
  it("bỏ **đậm**, tiêu đề, gạch đầu dòng → chữ thường", () => {
    expect(plainChatText("Học phí **12.000.000đ**\n\n\n## Lịch học\n- Thứ 7\n* Chủ nhật")).toBe("Học phí 12.000.000đ\n\nLịch học\n• Thứ 7\n• Chủ nhật");
  });
});

describe("SĐT do khách cung cấp", () => {
  it("không lấy số trong thông báo Facebook hoặc tin của Trang để chuyển lead nóng", async () => {
    const c = mkConv("PSID_NOTICE_PHONE");
    insert("message", { biz_id: B, conversation_id: c.id, direction: "out", sender: "page",
      body: { text: "Tìm hiểu thêm https://www.facebook.com/help/messenger-app/564030381383143. Shop: 0912 345 678" },
      sent_at: new Date(Date.now() - 35 * 60_000).toISOString() });
    const r = await handleIncoming(B, { channel: "messenger", externalConversationId: c.external_id, customerName: "Khách A", text: "hello", messageId: "m_notice_phone" });
    expect(q.get<Row>("SELECT phone FROM lead WHERE conversation_id = ?", c.id)!.phone).toBeNull();
    expect(r.decision?.handoffReasons).not.toContain("Lead nóng — chuyển đội sales chốt");
    expect(r.replied).toBe(true);
  });

  it("không lấy mã trong link khách gửi hoặc giá tiền làm SĐT", async () => {
    const c = mkConv("PSID_CUSTOMER_LINK");
    const r = await handleIncoming(B, { channel: "messenger", externalConversationId: c.external_id, customerName: "Khách A",
      text: "hello https://example.test/0912345678 giá 390.000.000đ", messageId: "m_customer_link" });
    expect(q.get<Row>("SELECT phone FROM lead WHERE conversation_id = ?", c.id)!.phone).toBeNull();
    expect(r.decision?.leadScore).toBeLessThan(85);
  });

  it("nhận số di động khách gửi có khoảng trắng và chuẩn hoá mã quốc gia", async () => {
    const c = mkConv("PSID_CUSTOMER_PHONE");
    await handleIncoming(B, { channel: "messenger", externalConversationId: c.external_id, customerName: "Khách A",
      text: "hello số của mình +84 912 345 678", messageId: "m_customer_phone" });
    expect(q.get<Row>("SELECT phone FROM lead WHERE conversation_id = ?", c.id)!.phone).toBe("0912345678");
  });
});

describe("bot nhường khi người vừa trả lời trên Facebook", () => {
  it(`có tin 'page' (Meta Business Suite) trong ${HUMAN_ON_PAGE_MINUTES} phút → bot không trả lời tin mới của khách; quá hạn → trả lời lại`, async () => {
    const first = await handleIncoming(B, { channel: "messenger", externalConversationId: "PSID_NHUONG", customerName: "Khách A", text: "Shop ơi còn hàng không", messageId: "m_n1", pageExternalId: "PAGE1" });
    const conv = byId<Row>("conversation", first.conversationId)!;
    insert("message", { biz_id: B, conversation_id: conv.id, direction: "out", sender: "page", body: { text: "Còn chị ơi, em gửi ảnh nhé" }, external_id: "m_page1", meta: {}, sent_at: new Date().toISOString() });
    const botOut = () => q.scalar<number>("SELECT COUNT(*) FROM message WHERE conversation_id = ? AND direction = 'out' AND sender != 'page'", conv.id);
    const before = botOut();
    const r = await handleIncoming(B, { channel: "messenger", externalConversationId: "PSID_NHUONG", customerName: "Khách A", text: "Giá bao nhiêu vậy", messageId: "m_n2", pageExternalId: "PAGE1" });
    expect(r.replied).toBe(false);
    expect(botOut()).toBe(before);
    // Người trả lời đã quá 30 phút → bot được nói lại
    q.run("UPDATE message SET sent_at = ? WHERE external_id = 'm_page1'", new Date(Date.now() - (HUMAN_ON_PAGE_MINUTES + 5) * 60_000).toISOString());
    const r2 = await handleIncoming(B, { channel: "messenger", externalConversationId: "PSID_NHUONG", customerName: "Khách A", text: "Cho mình xin giá nhé", messageId: "m_n3", pageExternalId: "PAGE1" });
    expect(r2.replied).toBe(true);
  });
});

describe("cửa sổ 24 giờ", () => {
  const old = () => new Date(Date.now() - 25 * 3600_000).toISOString();
  it("quá 24 giờ: replyWindow khoá, nhân viên trả lời bị chặn TRƯỚC khi đổi trạng thái, không gọi Facebook", async () => {
    const c = mkConv("PSID_24H", { state: "awaiting_customer", last_customer_at: old() });
    const w = replyWindow(c);
    expect(w).toMatchObject({ canReply: false, limited: true, replyWindowEndsAt: expect.any(String) });
    await expect(replyAsHuman(B, c.id, "Dạ shop chào chị")).rejects.toMatchObject({ code: "OUTSIDE_24H", message: OUTSIDE_24H_MESSAGE, status: 409 });
    expect(byId<Row>("conversation", c.id)!.state).toBe("awaiting_customer"); // bị chặn thì bot vẫn giữ hội thoại
    expect(sent).toHaveLength(0);
    // Bot cũng không gửi chủ động ngoài cửa sổ
    await expect(sendBotMessage(B, c.id, "Nhắc nhẹ ạ", { kind: "x" }, "k1")).rejects.toMatchObject({ code: "OUTSIDE_24H" });
    expect(sent).toHaveLength(0);
  });

  it("trong 24 giờ: trả lời được, nhân viên tiếp quản; chưa có Fanpage thật → không giới hạn 24h nhưng cũng KHÔNG đổi trạng thái khi gửi thất bại", async () => {
    const c = mkConv("PSID_IN", { state: "awaiting_customer", last_customer_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    expect(replyWindow(c)).toMatchObject({ canReply: true, limited: true });
    await replyAsHuman(B, c.id, "Dạ shop chào chị");
    expect(sent).toHaveLength(1);
    expect(byId<Row>("conversation", c.id)!.state).toBe("human_active");

    setConversationConnector(() => null); // không có Trang thật
    const c2 = mkConv("PSID_NOPAGE", { state: "awaiting_customer", last_customer_at: new Date().toISOString() });
    expect(replyWindow(c2)).toMatchObject({ canReply: true, limited: false });
    await expect(replyAsHuman(B, c2.id, "Dạ shop chào chị")).rejects.toThrow(/Fanpage thật/);
    expect(byId<Row>("conversation", c2.id)!.state).toBe("awaiting_customer");
  });
});

describe("khách báo không nhận tin (opt-out)", () => {
  it("nhận diện tất định: lời từ chối rõ → true; câu hỏi / câu bình thường → false", () => {
    for (const t of ["đừng nhắn nữa", "Thôi đừng gửi tin nữa nhé", "không muốn nhận tin quảng cáo", "hủy đăng ký", "STOP", "spam quá"]) expect(detectOptOut(t), t).toBe(true);
    for (const t of ["sao shop không nhắn nữa vậy?", "giá bao nhiêu vậy shop", "mình muốn đăng ký học", "có ship COD không?"]) expect(detectOptOut(t), t).toBe(false);
  });

  it("bot ghi danh sách + xác nhận 1 lần + dừng follow-up; tin sau đó bot im lặng; nhân viên vẫn trả lời tay được", async () => {
    const r = await handleIncoming(B, { channel: "messenger", externalConversationId: "PSID_STOP", customerName: "Khách S", text: "Chào shop", messageId: "m_s1", pageExternalId: "PAGE1" });
    const convId = r.conversationId;
    insert("follow_up_plan", { biz_id: B, conversation_id: convId, step: 0, next_at: new Date().toISOString(), status: "active", template: "sau_hoi_gia" });
    sent.length = 0;

    const stop = await handleIncoming(B, { channel: "messenger", externalConversationId: "PSID_STOP", customerName: "Khách S", text: "Đừng nhắn nữa nhé", messageId: "m_s2", pageExternalId: "PAGE1" });
    expect(stop.state).toBe("opted_out");
    expect(sent).toHaveLength(1); // đúng 1 câu xác nhận
    expect(conversationOptedOut(convId)).toBeTruthy();
    expect(q.scalar<number>("SELECT COUNT(*) FROM contact_optout WHERE biz_id = ? AND channel = 'messenger' AND external_id = 'PSID_STOP'", B)).toBe(1);
    expect(q.scalar<number>("SELECT COUNT(*) FROM follow_up_plan WHERE conversation_id = ? AND status = 'active'", convId)).toBe(0);

    sent.length = 0;
    const later = await handleIncoming(B, { channel: "messenger", externalConversationId: "PSID_STOP", customerName: "Khách S", text: "Cho mình hỏi thêm giá", messageId: "m_s3", pageExternalId: "PAGE1" });
    expect(later.replied).toBe(false);
    expect(sent).toHaveLength(0);
    await expect(sendBotMessage(B, convId, "Dạ em nhắn lại ạ", { kind: "x" }, "k2")).rejects.toMatchObject({ code: "OPTED_OUT" });

    await replyAsHuman(B, convId, "Dạ em xin lỗi anh/chị ạ"); // nhân viên vẫn được trả lời
    expect(sent).toHaveLength(1);
  });

  it("recordConversationOptOut gom mọi danh tính (hội thoại + SĐT băm), không lưu SĐT thật", () => {
    const c = mkConv("PSID_PH");
    insert("lead", { biz_id: B, conversation_id: c.id, name: "Khách", phone: "0912345678", grade: "warm", score: 50, reasons: [] });
    recordConversationOptOut(B, c, { reason: "test", source: "auto" });
    const rows = q.all<Row>("SELECT channel, external_id, phone_masked FROM contact_optout WHERE biz_id = ? AND conversation_id = ?", B, c.id);
    expect(rows.map((r) => r.channel).sort()).toEqual(["messenger", "phone"]);
    expect(JSON.stringify(rows)).not.toContain("0912345678");
    expect(conversationOptedOut(c)).toBeTruthy();
  });
});
