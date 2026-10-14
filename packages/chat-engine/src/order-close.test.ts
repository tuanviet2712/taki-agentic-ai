import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import type { Connector } from "@dotaka/connectors";
import { generateSalesFlow, handleIncoming, needsShipping, saveSalesFlow, setConversationConnector } from "./index.ts";

/**
 * Bot chốt đơn: khách rõ ý mua + có SĐT + đúng sản phẩm DNA → đơn nháp [ĐỎ] chờ Sếp duyệt (KHÔNG đơn thật), câu chốt theo DNA.
 * Offline: LLM sandbox, Jev heuristic, Fanpage là connector giả.
 */
const DNA = {
  company: { name: "Học viện Mẫu", brand: "Mẫu Academy", industry: "Đào tạo kỹ năng số" },
  voice: { style: ["Thực chiến"], dont: [], selfPronoun: "mình", customerPronoun: "bạn" },
  offers: [], forbiddenClaims: ["cam kết kết quả"], bannedChars: [],
};
const COURSE = { key: "khoa-ai", name: "Khóa AI Marketing", aliases: ["AI Marketing"], summary: "Khóa học offline 3 ngày ứng dụng AI vào marketing", price: 12_000_000, format: "Offline", delivery: "none" };
const GOODS = { key: "may-loc", name: "Máy lọc không khí Mini", aliases: ["máy lọc"], summary: "Máy lọc không khí để bàn", price: 1_500_000, format: "Hàng hoá", delivery: "ship" };

const sent: string[] = [];
const fakeLive = (): Connector => ({
  platform: "meta", mode: "live", limits: { requestsPerMinute: 60, concurrency: 2 },
  health: async () => ({ ok: true, detail: "fake" }),
  sendMessage: async (spec) => { sent.push(spec.text); return { externalId: `m_out_${sent.length}` }; },
});
const drafts = (convId?: string) => q.all<Row>(`SELECT * FROM approval WHERE biz_id = ? AND subject_type = 'order_draft' ${convId ? "AND subject_id = ?" : ""} ORDER BY created_at`, ...(convId ? [B, convId] : [B]));
const msg = (ext: string, text: string, id: string, extra: Row = {}) =>
  ({ channel: "messenger" as const, externalConversationId: ext, customerName: "Chị Lan", text, messageId: id, pageExternalId: "PAGE1", ...extra });

let B: string;
beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Học viện Mẫu", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "test", data: { ...DNA, products: [COURSE, GOODS] } });
});
afterAll(() => { setConversationConnector(() => null); closeDb(); });
beforeEach(() => { sent.length = 0; setConversationConnector(() => fakeLive()); });

describe("needsShipping", () => {
  it("DNA delivery thắng; để trống thì nhận biết theo tên + hình thức; không rõ → giao hàng", () => {
    expect(needsShipping({ delivery: "none", name: "Áo thun" })).toBe(false);
    expect(needsShipping({ delivery: "ship", name: "Khoá học AI" })).toBe(true);
    expect(needsShipping({ name: "Khóa học AI Marketing", format: "Online" })).toBe(false);
    expect(needsShipping({ name: "Gói dịch vụ chạy ads" })).toBe(false);
    expect(needsShipping({ name: "Phần mềm quản lý bán hàng", format: "SaaS" })).toBe(false);
    expect(needsShipping({ name: "Ebook bán hàng" })).toBe(false);
    expect(needsShipping({ name: "Áo thun cotton", format: "Hàng hoá" })).toBe(true);
    expect(needsShipping({ name: "Sản phẩm bí ẩn" })).toBe(true);
  });
});

describe("bot chốt đơn → đơn nháp [ĐỎ]", () => {
  it("khóa học (không giao): 1 đơn nháp high-risk, SĐT chỉ ở dạng che, câu chốt xưng hô theo DNA, xin email thay vì địa chỉ, nhắc 'sau hỏi giá' bị dừng", async () => {
    // hội thoại đang chạy, đã có nhắc "sau hỏi giá" 4 giờ nữa
    const pre = insert("conversation", { biz_id: B, channel: "messenger", external_id: "c_course", customer_ref: "cust_c_course", customer_name: "Chị Lan", state: "bot_active", tags: [], unread: 0, ext: { pageId: "PAGE1" } });
    insert("follow_up_plan", { biz_id: B, conversation_id: pre.id, step: 0, next_at: new Date(Date.now() + 4 * 3600_000).toISOString(), status: "active", template: "sau_hoi_gia" });
    const r = await handleIncoming(B, msg("c_course", "Mình muốn đăng ký Khóa AI Marketing, sđt 0912345678", "c2"));
    expect(r.replied).toBe(true);
    expect(r.state).toBe("awaiting_customer");
    const ds = drafts(r.conversationId);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ status: "pending", risk: "high", agent_key: "chat", subject_id: r.conversationId });
    expect(ds[0].preview).toMatchObject({ kind: "order_draft", product: COURSE.name, productKey: COURSE.key, total: 12_000_000, phoneMasked: "0912***678" });
    expect(JSON.stringify(ds[0])).not.toContain("0912345678");
    expect(ds[0].preview.phone).toBeUndefined();
    expect(new Date(ds[0].expires_at).getTime()).toBeGreaterThan(Date.now() + 70 * 3600_000);
    // lead giữ số thật (nội bộ), audit chỉ ghi số che
    expect(q.get<Row>("SELECT phone FROM lead WHERE conversation_id = ?", r.conversationId)!.phone).toBe("0912345678");
    const aud = q.all<Row>("SELECT data FROM audit_log WHERE biz_id = ? AND event = 'order.drafted'", B);
    expect(aud).toHaveLength(1);
    expect(JSON.stringify(aud[0].data)).not.toContain("0912345678");
    // câu chốt
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^Dạ mình ghi nhận đăng ký Khóa AI Marketing \(12\.000\.000đ\) cho bạn ạ\. Bạn cho mình xin email/);
    expect(sent[0]).not.toMatch(/địa chỉ nhận hàng/);
    expect(q.scalar("SELECT COUNT(*) FROM follow_up_plan WHERE conversation_id = ? AND status = 'active'", r.conversationId)).toBe(0);
    expect(q.scalar("SELECT COUNT(*) FROM orders WHERE biz_id = ?", B)).toBe(0); // CHƯA có đơn thật
  });

  it("khách nhắc lại 'đăng ký' → không lập thêm đơn nháp (chỉ nhắc đã ghi nhận)", async () => {
    sent.length = 0;
    const r = await handleIncoming(B, msg("c_course", "Mình muốn đăng ký Khóa AI Marketing nhé", "c3"));
    expect(r.replied).toBe(true);
    expect(drafts()).toHaveLength(1);
    expect(sent[0]).toMatch(/đã ghi nhận đăng ký Khóa AI Marketing/);
  });

  it("hàng cần giao: xin địa chỉ nhận hàng; thiếu SĐT → chưa lập đơn nháp", async () => {
    const noPhone = await handleIncoming(B, msg("c_goods0", "Mình muốn đăng ký mua Máy lọc không khí Mini", "g1"));
    expect(drafts(noPhone.conversationId)).toHaveLength(0); // chưa có SĐT → luồng cũ (chuyển người)
    sent.length = 0;
    const r = await handleIncoming(B, msg("c_goods", "Số mình 0987654321 nhé, chốt máy lọc không khí Mini đi", "g2"));
    const ds = drafts(r.conversationId);
    expect(ds).toHaveLength(1);
    expect(ds[0].preview).toMatchObject({ productKey: GOODS.key, total: 1_500_000 });
    expect(sent[0]).toMatch(/Dạ mình chốt đơn Máy lọc không khí Mini \(1\.500\.000đ\) cho bạn ạ\. Bạn cho mình xin địa chỉ nhận hàng/);
  });

  it("Sếp từ chối đơn nháp < 24 giờ → khách nhắc lại không lập lại đơn nháp (và bot không nói 'đã ghi nhận')", async () => {
    const conv = byId<Row>("conversation", drafts()[0].subject_id)!;
    update("approval", drafts(conv.id)[0].id, { status: "rejected", decided_at: new Date().toISOString() });
    sent.length = 0;
    await handleIncoming(B, msg("c_course", "Mình đăng ký Khóa AI Marketing đi, sđt 0912345678", "c4"));
    expect(drafts(conv.id)).toHaveLength(1);
    expect(sent.join(" ")).not.toMatch(/đã ghi nhận|ghi nhận đăng ký/);
  });

  it("settings.chat.closeOrders=false → không đơn nháp (về luồng cũ: chuyển người / trả lời)", async () => {
    const before = drafts().length;
    q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" }, chat: { closeOrders: false } }), B);
    await handleIncoming(B, msg("c_off", "Mình đăng ký Khóa AI Marketing, sđt 0933333333", "o1"));
    expect(drafts()).toHaveLength(before);
    q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } }), B);
  });

  it("dừng khẩn cấp chat → im lặng, không đơn nháp", async () => {
    const before = drafts().length;
    sent.length = 0;
    q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" }, killSwitch: { ...DEFAULT_SETTINGS.killSwitch, chat: true } }), B);
    await handleIncoming(B, msg("c_kill", "Mình đăng ký Khóa AI Marketing, sđt 0944444444", "k1"));
    expect(drafts()).toHaveLength(before);
    expect(sent.join(" ")).not.toMatch(/ghi nhận đăng ký/);
    q.run("UPDATE biz SET settings = ? WHERE id = ?", JSON.stringify({ ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } }), B);
  });

  it("khách từ chối nhận tin (opt-out) → không đơn nháp", async () => {
    const before = drafts().length;
    await handleIncoming(B, msg("c_stop", "Đừng nhắn tin cho mình nữa, mình đăng ký Khóa AI Marketing sđt 0955555555", "s1"));
    expect(drafts()).toHaveLength(before);
  });

  it("chế độ GỢI Ý (kịch bản 'chỉ gợi ý'): chỉ ghim gợi ý, KHÔNG tạo đơn nháp, không gửi gì cho khách", async () => {
    const g = await generateSalesFlow(B, COURSE.key, "Sếp");
    saveSalesFlow(B, COURSE.key, { flow: { ...g.flow, mode: "suggest" }, status: "active" }, "Sếp");
    const before = drafts().length;
    sent.length = 0;
    const r = await handleIncoming(B, msg("c_suggest", "Mình muốn đăng ký Khóa AI Marketing, sđt 0966666666", "sg1"));
    expect(r.replied).toBe(false);
    expect(sent).toHaveLength(0);
    expect(drafts()).toHaveLength(before);
    // bot Messenger TẮT + suggestOnly: cũng không đơn nháp
    const r2 = await handleIncoming(B, msg("c_suggest2", "Mình muốn đăng ký Khóa AI Marketing, sđt 0977777777", "sg2", { noReply: true, suggestOnly: true }));
    expect(r2.replied).toBe(false);
    expect(sent).toHaveLength(0);
    expect(drafts()).toHaveLength(before);
  });
});
