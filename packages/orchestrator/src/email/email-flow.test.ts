import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, emit, insert, openDb, q, update, type Row } from "@dotaka/db";
import { encryptSecret } from "@dotaka/shared";
import { decideApproval } from "../approvals.ts";
import { recordClick, setPublicGateway } from "../tracking.ts";
import {
  campaignStats, campaignTick, createCampaign, createSequence, emailHash, enroll, extractEmails, handleResendWebhook, importContacts, registerEmailHooks,
  requestCampaignApproval, requestSequenceActivation, saveSegment, saveStep, sendEmail, sequenceTick, unsubscribeByToken, upsertContact, type EmailContent,
} from "./index.ts";

/**
 * Luồng email đầu-cuối trên DB thật (SQLite :memory:) với Resend giả lập bằng fetch: cổng gửi + mọi lý do bỏ qua, footer / link hủy /
 * link đo click, webhook có chữ ký (bounce → loại trừ), hủy nhận một chạm, chiến dịch qua mục duyệt [ĐỎ], chuỗi + trigger + mục tiêu mua.
 */
let B: string;
const SECRET = "whsec_" + Buffer.from("khoa-webhook-thu").toString("base64");
const sent: { url: string; body: Row; headers: Record<string, string> }[] = [];
let fail = false;
let seq = 0;
const realFetch = globalThis.fetch;
// 10:00 giờ VN ngày mai — trong khung giờ gửi, sau mọi mốc hẹn tạo trong test
const day10 = new Date(`${new Date(Date.now() + 31 * 3600_000).toISOString().slice(0, 10)}T03:00:00Z`);

const text = (subject: string, body: string): EmailContent => ({ mode: "text", subject, body });
const sign = (raw: string, id = `msg_${Math.random()}`) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`${id}.${ts}.${raw}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` };
};
const tick = () => new Promise((r) => setImmediate(r));

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "TAKI Academy", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  insert("connection", {
    biz_id: B, platform: "resend", external_account_id: "mail.taki.vn", display_name: "TAKI <hello@mail.taki.vn>", scopes: [], status: "active", mode: "live",
    token_ciphertext: encryptSecret(JSON.stringify({ api_key: "re_test", webhook_secret: SECRET })),
    config: { from_name: "TAKI Academy", from_address: "hello@mail.taki.vn", domain: "mail.taki.vn", domain_status: "verified", daily_limit: "100" },
  });
  process.env.PUBLIC_BASE_URL = "https://go.taki.vn";
  setPublicGateway({ listening: true, port: 9999 });
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (fail) return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
    if (u.startsWith("https://api.resend.com/emails")) {
      sent.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")), headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ id: `re_${++seq}` }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  registerEmailHooks();
});
afterAll(() => { globalThis.fetch = realFetch; delete process.env.PUBLIC_BASE_URL; setPublicGateway({ listening: false }); closeDb(); });
beforeEach(() => { sent.length = 0; fail = false; });

describe("cổng gửi email", () => {
  it("gửi thật qua Resend: cá nhân hoá, footer + link hủy, link đo click mỗi thư, header một chạm, không lưu email thô ở thư", async () => {
    const c = upsertContact(B, { email: "Lan@Example.com", name: "Chị Lan", consent: "opt_in" }).contact;
    const r = await sendEmail({ bizId: B, contactId: c.id, content: text("Chào {{ho_ten|bạn}}", "Xin chào {{ho_ten|bạn}}.\n\nXem khoá học: https://taki.vn/khoa-hoc"), source: { kind: "transactional" } });
    expect(r.status).toBe("sent");
    expect(sent).toHaveLength(1);
    const m = sent[0].body;
    expect(m.to).toBe("lan@example.com");
    expect(m.from).toBe("TAKI Academy <hello@mail.taki.vn>");
    expect(m.subject).toBe("Chào Chị Lan");
    expect(m.html).toContain("Xin chào Chị Lan");
    expect(m.html).toMatch(/https:\/\/go\.taki\.vn\/r\/[A-Za-z0-9]{8}/);
    expect(m.html).not.toContain("https://taki.vn/khoa-hoc"); // link gốc đã được bọc
    expect(m.html).toMatch(/https:\/\/go\.taki\.vn\/u\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent[0].headers["Idempotency-Key"]).toContain(r.messageId);
    const row = byId<Row>("email_message", r.messageId)!;
    expect(row.status).toBe("sent");
    expect(row.to_masked).toBe("la***@example.com");
    expect(JSON.stringify({ ...row, html: "" })).not.toContain("lan@example.com");
    // link đo click → đích có UTM email, đánh dấu thư đã click
    const code = /\/r\/([A-Za-z0-9]{8})/.exec(m.html)![1];
    const hit = recordClick(code, { ip: "203.0.113.9", ua: "Mozilla/5.0 (iPhone)" });
    expect(hit?.url).toMatch(/^https:\/\/taki\.vn\/khoa-hoc\?utm_source=email&utm_medium=email/);
    expect(byId<Row>("email_message", r.messageId)!.status).toBe("clicked");
  });

  it("bỏ qua có lý do: chỉ giao dịch, đã hủy, bị loại trừ, khoá khẩn cấp, hạn mức, chưa có địa chỉ công khai; không gọi Resend", async () => {
    const t = upsertContact(B, { email: "tx@example.com", consent: "transactional" }).contact;
    expect((await sendEmail({ bizId: B, contactId: t.id, content: text("Tin", "Nội dung"), source: { kind: "campaign" } })).reason).toBe("consent");
    expect((await sendEmail({ bizId: B, contactId: t.id, content: text("Đơn hàng", "Xác nhận"), source: { kind: "transactional" }, transactional: true })).status).toBe("sent");

    const s = upsertContact(B, { email: "sup@example.com", consent: "opt_in" }).contact;
    insert("email_suppression", { biz_id: B, email_hash: emailHash("sup@example.com"), email_masked: "su***", reason: "hard_bounce" });
    expect((await sendEmail({ bizId: B, contactId: s.id, content: text("A", "B"), source: { kind: "campaign" }, transactional: true })).reason).toBe("suppressed");

    const k = upsertContact(B, { email: "kill@example.com", consent: "opt_in" }).contact;
    const biz = byId<Row>("biz", B)!;
    update("biz", B, { settings: { ...biz.settings, killSwitch: { ...DEFAULT_SETTINGS.killSwitch, email: true } } });
    expect((await sendEmail({ bizId: B, contactId: k.id, content: text("A", "B"), source: { kind: "campaign" } })).reason).toBe("kill_switch");
    update("biz", B, { settings: biz.settings });

    process.env.PUBLIC_BASE_URL = "";
    expect((await sendEmail({ bizId: B, contactId: k.id, content: text("A", "B"), source: { kind: "campaign" } })).reason).toBe("no_public_url");
    process.env.PUBLIC_BASE_URL = "https://go.taki.vn";

    const conn = q.get<Row>("SELECT * FROM connection WHERE biz_id = ? AND platform = 'resend'", B)!;
    update("connection", conn.id, { config: { ...conn.config, daily_limit: "1" } });
    expect((await sendEmail({ bizId: B, contactId: k.id, content: text("A", "B"), source: { kind: "campaign" } })).reason).toBe("daily_limit");
    update("connection", conn.id, { config: { ...conn.config, daily_limit: "100" } });

    update("connection", conn.id, { mode: "sandbox" });
    expect((await sendEmail({ bizId: B, contactId: k.id, content: text("A", "B"), source: { kind: "campaign" } })).reason).toBe("sandbox");
    update("connection", conn.id, { mode: "live" });
    expect(sent).toHaveLength(1); // chỉ thư giao dịch ở trên
  });

  it("lỗi Resend → failed (không 'đã gửi'), có lý do", async () => {
    const c = upsertContact(B, { email: "fail@example.com", consent: "opt_in" }).contact;
    fail = true;
    const r = await sendEmail({ bizId: B, contactId: c.id, content: text("A", "B"), source: { kind: "campaign" } });
    expect(r.status).toBe("failed");
    expect(byId<Row>("email_message", r.messageId)!.status).toBe("failed");
  });

  it("khách nói ngừng nhắn trong chat (opt-out đa kênh) → email cũng dừng, kể cả thư giao dịch", async () => {
    const conv = insert("conversation", { biz_id: B, channel: "messenger", external_id: "psid_9", customer_ref: "cust_psid_9", customer_name: "Hùng", state: "bot_active", unread: 0, tags: [] });
    insert("contact_optout", { biz_id: B, channel: "messenger", external_id: "psid_9", source: "chat", conversation_id: conv.id });
    const c = upsertContact(B, { email: "hung@example.com", consent: "opt_in", conversationId: conv.id }).contact;
    expect((await sendEmail({ bizId: B, contactId: c.id, content: text("A", "B"), source: { kind: "transactional" }, transactional: true })).reason).toBe("opt_out");
  });
});

describe("webhook Resend + hủy nhận", () => {
  it("bounce cứng có chữ ký → thư bounced, địa chỉ vào loại trừ, liên hệ bounced; sai chữ ký → 401, phát lại → bỏ qua", async () => {
    const c = upsertContact(B, { email: "bounce@example.com", consent: "opt_in" }).contact;
    const r = await sendEmail({ bizId: B, contactId: c.id, content: text("A", "B"), source: { kind: "campaign" } });
    const providerId = byId<Row>("email_message", r.messageId)!.provider_id;
    const raw = JSON.stringify({ type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: providerId, bounce: { type: "Permanent", message: "no such user" } } });
    expect(handleResendWebhook(raw, { ...sign(raw), "svix-signature": "v1,sai" }).status).toBe(401);
    const h = sign(raw, "evt_1");
    expect(handleResendWebhook(raw, h).status).toBe(200);
    expect(byId<Row>("email_message", r.messageId)!.status).toBe("bounced");
    expect(byId<Row>("email_contact", c.id)!.status).toBe("bounced");
    expect(q.get("SELECT id FROM email_suppression WHERE biz_id = ? AND email_hash = ?", B, c.email_hash)).toBeTruthy();
    expect(handleResendWebhook(raw, h).body.duplicate).toBe(true);
  });

  it("hủy nhận một chạm: liên hệ unsubscribed + opt-out kênh email + dừng chuỗi; token hỏng → không làm gì", async () => {
    const c = upsertContact(B, { email: "huy@example.com", consent: "opt_in" }).contact;
    await sendEmail({ bizId: B, contactId: c.id, content: text("A", "B"), source: { kind: "campaign" } });
    const token = /\/u\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.exec(sent.at(-1)!.body.html)![1];
    expect(unsubscribeByToken(token + "x").ok).toBe(false);
    expect(unsubscribeByToken(token, "one_click").ok).toBe(true);
    expect(byId<Row>("email_contact", c.id)!.status).toBe("unsubscribed");
    expect(q.get("SELECT id FROM contact_optout WHERE biz_id = ? AND channel = 'email' AND external_id = ?", B, c.email_hash)).toBeTruthy();
    expect((await sendEmail({ bizId: B, contactId: c.id, content: text("A", "B"), source: { kind: "campaign" } })).reason).toBe("unsubscribed");
  });
});

describe("chiến dịch qua mục duyệt", () => {
  it("nhập CSV → phân khúc theo thẻ → gửi duyệt [ĐỎ] → duyệt → email.tick gửi đúng người, A/B, không gửi trùng", async () => {
    const imp = importContacts(B, "email,ten,tags\nan@vidu.vn,An,vip\nbinh@vidu.vn,Bình,vip|moi\nchi@vidu.vn,Chi,moi\nkhong-phai-email,X,", { consent: "opt_in" }, "test");
    expect(imp).toMatchObject({ added: 3, invalid: 1 });
    const seg = saveSegment(B, { name: "VIP", definition: { match: "all", rules: [{ field: "tag", op: "has", value: "vip" }] } }, "test");
    expect(seg.member_count).toBe(2);
    const c = createCampaign(B, { name: "Ra mắt", segmentId: seg.id, subject: "Tin mới cho {{ho_ten|bạn}}", subjectB: "Bản B: {{ho_ten|bạn}} ơi", abPct: 50, body: "Nội dung https://taki.vn/ra-mat" }, "test");
    expect(() => requestCampaignApproval(B, createCampaign(B, { subject: "Xin chào {{ho_ten}}", body: "x" }, "t").id, "t")).toThrow(/dự phòng/);
    const { approvalId, recipients } = requestCampaignApproval(B, c.id, "test");
    expect(recipients).toBe(2);
    expect(byId<Row>("approval", approvalId)).toMatchObject({ subject_type: "email_campaign", risk: "high", status: "pending" });
    await campaignTick(B, day10);
    expect(sent).toHaveLength(0); // chưa duyệt thì không gửi
    await decideApproval(B, approvalId, "approve", undefined, undefined, "ceo");
    expect(byId<Row>("email_campaign", c.id)!.status).toBe("scheduled");
    await campaignTick(B, new Date(day10.getTime() + 13 * 3600_000)); // 23:00 VN — giờ yên lặng
    expect(sent).toHaveLength(0);
    await campaignTick(B, day10);
    expect(sent.map((s) => s.body.to).sort()).toEqual(["an@vidu.vn", "binh@vidu.vn"]);
    expect(byId<Row>("email_campaign", c.id)!.status).toBe("sent");
    expect(campaignStats(B, c.id).total.sent).toBe(2);
    await campaignTick(B, day10);
    expect(sent).toHaveLength(2);
  });
});

describe("chuỗi email + nối với chat / đơn hàng", () => {
  const BODIES = [
    "Chào {{ho_ten|bạn}}, cảm ơn bạn đã ghé TAKI Academy. Đây là thư đầu tiên trong loạt thư ngắn giúp bạn làm quen với cách chúng tôi dạy marketing thực chiến cho chủ shop nhỏ.\n\nTrong vài ngày tới, mỗi sáng bạn sẽ nhận một mẹo nhỏ áp dụng ngay vào fanpage của mình, không tốn tiền quảng cáo, chỉ cần mười lăm phút mỗi ngày.\n\nHẹn gặp lại bạn vào thư sau với câu chuyện của chị Hạnh, người bán bánh handmade ở Đà Nẵng.",
    "Chị Hạnh mở tiệm bánh nhỏ tại Đà Nẵng năm ngoái, đơn hàng lúc đầu chỉ vài cái mỗi tuần dù chị chăm chỉ đăng bài từng ngày trên fanpage.\n\nSau khi đổi cách viết tiêu đề và chụp ảnh sản phẩm dưới nắng sớm, lượng tin nhắn hỏi giá tăng gấp ba chỉ sau một tháng, khách quen giới thiệu thêm bạn bè.\n\nMuốn biết chị làm cụ thể thế nào? Bạn đăng ký xem buổi chia sẻ miễn phí tại https://taki.vn/buoi-chia-se nhé.",
    "Tuần này TAKI mở buổi học trực tuyến về quay video ngắn bằng điện thoại, phù hợp người mới chưa từng dựng video, thời lượng chín mươi phút tối thứ năm.\n\nGiảng viên hướng dẫn bố cục khung hình, ánh sáng tự nhiên, lồng tiếng và cắt ghép trên ứng dụng miễn phí, kèm bài tập thực hành có nhận xét riêng.\n\nSố chỗ có hạn, bạn giữ chỗ tại https://taki.vn/video-ngan để nhận đường dẫn phòng học sớm.",
  ];

  it("trigger thẻ → ghi danh, gửi từng thư theo lịch; email trong chat → liên hệ; đơn → dừng chuỗi mục tiêu mua", async () => {
    const s = createSequence(B, { name: "Chào mừng", kind: "custom", config: { trigger: { type: "tag_added", tag: "lead-moi" }, goal: { type: "purchase" } } }, "test");
    saveStep(B, s.id, { title: "Mở đầu", delayDays: 0, subject: "Chào mừng bạn đến với TAKI", body: BODIES[0], noHardSell: true }, "test");
    saveStep(B, s.id, { title: "Câu chuyện", delayDays: 1, subject: "Câu chuyện của một học viên", body: BODIES[1] }, "test");
    saveStep(B, s.id, { title: "Lời mời", delayDays: 1, subject: "Lời mời buổi chia sẻ tuần này", body: BODIES[2] }, "test");
    const { approvalId } = requestSequenceActivation(B, s.id, "test");
    await decideApproval(B, approvalId, "approve", undefined, undefined, "ceo");
    expect(byId<Row>("email_sequence", s.id)!.status).toBe("active");

    // Khách gõ email trong chat → liên hệ gắn hội thoại; gắn thẻ → trigger chuỗi
    const conv = insert("conversation", { biz_id: B, channel: "messenger", external_id: "psid_77", customer_ref: "cust_psid_77", customer_name: "Mai", state: "bot_active", unread: 0, tags: [] });
    insert("message", { biz_id: B, conversation_id: conv.id, direction: "in", sender: "customer", body: { text: "Email em là mai.nguyen@gmail.com nhé" }, sent_at: new Date().toISOString() });
    emit(B, "conversation.message_in", { conversationId: conv.id });
    await tick(); await tick();
    const contact = q.get<Row>("SELECT * FROM email_contact WHERE biz_id = ? AND conversation_id = ?", B, conv.id)!;
    expect(contact).toMatchObject({ email: "mai.nguyen@gmail.com", source: "chat" });
    upsertContact(B, { email: contact.email, tags: ["lead-moi"] });
    await tick(); await tick();
    const en = q.get<Row>("SELECT * FROM email_enrollment WHERE sequence_id = ? AND contact_id = ?", s.id, contact.id)!;
    expect(en.status).toBe("active");
    expect(enroll(B, s.id, contact.id)).toBeNull(); // không ghi danh 2 lần

    const t0 = new Date(Date.parse(en.next_at) + 60_000);
    const at10 = (d: Date) => new Date(`${new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)}T03:00:00Z`);
    await sequenceTick(B, at10(new Date(t0.getTime() + 86_400_000)));
    expect(sent.at(-1)!.body.subject).toBe("Chào mừng bạn đến với TAKI");
    await sequenceTick(B, at10(new Date(t0.getTime() + 3 * 86_400_000)));
    expect(sent.at(-1)!.body.subject).toBe("Câu chuyện của một học viên");

    // Có đơn → đã mua, dừng chuỗi mục tiêu mua hàng
    const o = insert("orders", { biz_id: B, conversation_id: conv.id, customer_name: "Mai", product: "Khoá học", total: 1_000_000, status: "pending" });
    emit(B, "order.created", { orderId: o.id, conversationId: conv.id });
    await tick(); await tick();
    expect(byId<Row>("email_contact", contact.id)!.purchased).toBe(1);
    expect(byId<Row>("email_enrollment", en.id)!.status).toBe("goal_met");
  });

  it("extractEmails bỏ tên tệp ảnh, chuẩn hoá chữ thường", () => {
    expect(extractEmails("Gửi A@B.VN và logo@2x.png nhé.")).toEqual(["a@b.vn"]);
  });
});
