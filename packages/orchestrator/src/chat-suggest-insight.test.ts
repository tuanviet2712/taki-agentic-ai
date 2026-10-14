import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import type { Connector } from "@dotaka/connectors";
import { flowHelpFor, generateSalesFlow, getSalesFlow, handleIncoming, replyAsHuman, saveSalesFlow, setConversationConnector } from "@dotaka/chat-engine";
import { encryptSecret } from "@dotaka/shared";
import { decideApproval } from "./approvals.ts";
import { ensureBizSchedules } from "./business.ts";
import { latestChatInsight, runChatInsight } from "./chat-insight.ts";
import { liveMessengerConnector } from "./connections.ts";
import { HANDLERS } from "./index.ts";
import { applyProposal } from "./learning.ts";
import { setMessengerBot, syncMessenger } from "./messenger-sync.ts";

/**
 * Kịch bản chat 2 chế độ: "Gợi ý" (bot soạn sẵn, nhân viên gửi) / "Tự động"; Gợi ý hoạt động cả khi nút "Bot tự trả lời" TẮT
 * (đường suggestOnly: soạn gợi ý, KHÔNG gửi gì cho khách) + vòng học 7 bước (Lắng nghe → … → Feedback) → đề xuất sửa kịch bản chờ duyệt.
 * Chạy offline: LLM sandbox, Jev heuristic, Fanpage là connector giả / Graph là fetch giả.
 */
const DNA = {
  company: { name: "Học viện Mẫu", brand: "Mẫu Academy", industry: "Đào tạo kỹ năng số" },
  voice: { style: ["Thực chiến"], dont: ["Đại ngôn"], selfPronoun: "em", customerPronoun: "anh/chị" },
  audience: [{ name: "Chủ doanh nghiệp nhỏ", pains: ["Chi phí marketing cao"] }],
  offers: [], forbiddenClaims: ["cam kết kết quả", "làm giàu nhanh"], bannedChars: ["—"],
};
const KH = { key: "khoa-ai", name: "Khóa AI Marketing", aliases: ["AI Marketing"], summary: "Khóa học offline 3 ngày ứng dụng AI vào marketing", price: 12_000_000, link: "https://khoa.example.vn/ai", format: "Offline" };

// ---- Fanpage giả: đếm MỌI lần hệ thống đòi connector để gửi, và mọi tin thật sự gửi đi.
const sent: { conversationExternalId: string; text: string }[] = [];
let resolverCalls = 0;
const fakeLive = (): Connector => ({
  platform: "meta", mode: "live", limits: { requestsPerMinute: 60, concurrency: 2 },
  health: async () => ({ ok: true, detail: "fake" }),
  sendMessage: async (spec) => { sent.push({ conversationExternalId: spec.conversationExternalId, text: spec.text }); return { externalId: `m_out_${sent.length}` }; },
});
const outCount = (convId: string) => q.scalar<number>("SELECT COUNT(*) FROM message WHERE conversation_id = ? AND direction = 'out'", convId) ?? 0;
const convOf = (ext: string) => q.get<Row>("SELECT * FROM conversation WHERE external_id = ?", ext)!;

let B: string;
beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Học viện Mẫu", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "test", data: { ...DNA, products: [KH] } });
  const g = await generateSalesFlow(B, KH.key, "Sếp");
  saveSalesFlow(B, KH.key, { flow: { ...g.flow, mode: "suggest" }, status: "active" }, "Sếp");
});
beforeEach(() => { sent.length = 0; resolverCalls = 0; setConversationConnector(() => { resolverCalls++; return fakeLive(); }); });
afterEach(() => vi.unstubAllGlobals());
afterAll(() => { setConversationConnector(() => null); closeDb(); });

describe("chế độ Gợi ý khi bot TRẢ LỜI đang BẬT", () => {
  it("bot KHÔNG gửi cho khách, chỉ ghim gợi ý + mẫu câu bước hiện tại; trạng thái hội thoại không đổi", async () => {
    const r = await handleIncoming(B, { channel: "messenger", externalConversationId: "fb_101", customerName: "Chị Hoa", text: "Khóa AI Marketing học phí bao nhiêu shop?", messageId: "s1", pageExternalId: "PAGE1" });
    expect(r.replied).toBe(false);
    expect(outCount(r.conversationId)).toBe(0);
    expect(sent).toHaveLength(0);
    const c = byId<Row>("conversation", r.conversationId)!;
    expect(c.state).toBe("bot_active");
    expect(c.ext.flow).toMatchObject({ productKey: KH.key, stage: "tu_van", mode: "suggest" });
    expect(c.ext.suggestion.text).toBeTruthy();
    expect(c.ext.suggestion.label).toBe("Tư vấn theo nỗi đau");
    expect(flowHelpFor(B, c)).toMatchObject({ mode: "suggest", stage: "tu_van", step: 3 });
    expect(flowHelpFor(B, c)!.samples.length).toBeGreaterThan(0);
  });

  it("nhân viên gửi nguyên gợi ý → 'dùng nguyên'; khách nhắn tiếp → vẫn gợi ý dù nhân viên đang giữ; sửa gợi ý → 'đã sửa'", async () => {
    const conv = convOf("fb_101");
    await replyAsHuman(B, conv.id, conv.ext.suggestion.text, "NV Mai");
    let c = byId<Row>("conversation", conv.id)!;
    expect(c.state).toBe("human_active");
    expect(c.ext.suggestion).toBeUndefined();
    expect(sent).toHaveLength(1); // chỉ tin của nhân viên
    expect(q.get<Row>("SELECT meta FROM message WHERE conversation_id = ? AND sender = 'human'", conv.id)!.meta).toMatchObject({ staff: "NV Mai", fromSuggestion: true });
    expect(q.scalar("SELECT COUNT(*) FROM exemplar WHERE biz_id = ? AND kind = 'chat_suggestion_used'", B)).toBe(1);

    await handleIncoming(B, { channel: "messenger", externalConversationId: "fb_101", customerName: "Chị Hoa", text: "hơi đắt nhỉ", messageId: "s2", pageExternalId: "PAGE1" });
    c = byId<Row>("conversation", conv.id)!;
    expect(c.ext.flow.stage).toBe("xu_ly_tu_choi");
    expect(c.ext.suggestion?.text).toBeTruthy();
    expect(outCount(conv.id)).toBe(1); // vẫn chỉ tin nhân viên đã gửi
    expect(c.state).toBe("human_active");

    await replyAsHuman(B, conv.id, "Dạ tính ra mỗi buổi chưa tới một bữa ăn nhà hàng mà có thực hành thật chị ạ, chị tham gia thử buổi đầu nhé?", "NV Mai");
    const ex = q.get<Row>("SELECT * FROM exemplar WHERE biz_id = ? AND kind = 'chat_suggestion_edited'", B)!;
    expect(ex.text).toMatch(/BƯỚC: Xử lý từ chối/);
    expect(ex.text).toMatch(/NHÂN VIÊN GỬI: Dạ tính ra/);
  });

  it("chuyển về Tự động khi nhân viên đang giữ hội thoại → bot im, không gợi ý, tôn trọng nhân viên; hội thoại mới → bot tự trả lời", async () => {
    const f = getSalesFlow(B, KH.key).flow;
    saveSalesFlow(B, KH.key, { flow: { ...f, mode: "auto" }, status: "active" }, "Sếp");
    const conv = convOf("fb_101");
    const before = outCount(conv.id);
    sent.length = 0;
    const r = await handleIncoming(B, { channel: "messenger", externalConversationId: "fb_101", customerName: "Chị Hoa", text: "ok để chị xem", messageId: "s3", pageExternalId: "PAGE1" });
    expect(r.replied).toBe(false);
    expect(outCount(conv.id)).toBe(before);
    expect(byId<Row>("conversation", conv.id)!.ext.suggestion).toBeUndefined();
    expect(sent).toHaveLength(0);
    const r2 = await handleIncoming(B, { channel: "messenger", externalConversationId: "fb_102", customerName: "Anh Tùng", text: "Khóa AI Marketing học phí bao nhiêu?", messageId: "s4", pageExternalId: "PAGE1" });
    expect(r2.replied).toBe(true);
    expect(sent).toHaveLength(1);
    // trả về Gợi ý cho các test sau
    saveSalesFlow(B, KH.key, { flow: { ...f, mode: "suggest" }, status: "active" }, "Sếp");
  });
});

describe("Gợi ý khi bot Messenger TẮT (suggestOnly): soạn gợi ý, KHÔNG gửi gì cho khách", () => {
  const off = (ext: string, text: string, id: string, extra: Row = {}) =>
    handleIncoming(B, { channel: "messenger", externalConversationId: ext, customerName: "Khách A", text, messageId: id, pageExternalId: "PAGE1", noReply: true, suggestOnly: true, ...extra });

  it("flow ở chế độ Gợi ý + bot tắt → có gợi ý ghim + 'Bước', nhân viên giữ hội thoại, KHÔNG có tin gửi đi và connector không bao giờ bị gọi", async () => {
    const r = await off("off_1", "Khóa AI Marketing học phí bao nhiêu shop?", "o1");
    expect(r.replied).toBe(false);
    expect(sent).toHaveLength(0);
    expect(resolverCalls).toBe(0); // không một lần nào hệ thống đòi connector gửi
    expect(outCount(r.conversationId)).toBe(0);
    const c = byId<Row>("conversation", r.conversationId)!;
    expect(c.state).toBe("human_active"); // như mọi tin noReply: người trả lời
    expect(c.ext.flow).toMatchObject({ productKey: KH.key, stage: "tu_van", mode: "suggest" });
    expect(c.ext.suggestion.text).toBeTruthy();
    expect(c.lead_grade).toBeTruthy(); // vẫn chấm lead như noReply
    // Nhân viên bấm gửi → đi qua đường trả lời của nhân viên (đây mới là lần gửi duy nhất)
    await replyAsHuman(B, c.id, c.ext.suggestion.text, "NV Mai");
    expect(sent).toHaveLength(1);
    expect(q.scalar("SELECT COUNT(*) FROM exemplar WHERE biz_id = ? AND kind = 'chat_suggestion_used'", B)).toBeGreaterThanOrEqual(1);
  });

  it("nhiều lượt liên tiếp (gồm khách đòi gặp người, câu hỏi khó) vẫn không gửi gì; 'bot không chắc' → gợi ý trống + lý do", async () => {
    await off("off_2", "Khóa AI Marketing giá bao nhiêu?", "o2a");
    await off("off_2", "hơi đắt nhỉ", "o2b");
    const r = await off("off_2", "Cho mình nói chuyện với tư vấn viên nhé", "o2c");
    expect(sent).toHaveLength(0);
    expect(resolverCalls).toBe(0);
    expect(outCount(r.conversationId)).toBe(0);
    const c = byId<Row>("conversation", r.conversationId)!;
    expect(c.ext.suggestion).toMatchObject({ text: null, kind: "needs_human" });
    expect(c.ext.suggestion.reasons.length).toBeGreaterThan(0);
    expect(c.state).toBe("human_active"); // không chuyển handoff_pending, không báo Telegram: bot đang tắt
  });

  it("kịch bản ở chế độ Tự động + bot tắt → như noReply thường: không gợi ý, không gửi; không có suggestOnly (vd Zalo CRM) → không gợi ý", async () => {
    const f = getSalesFlow(B, KH.key).flow;
    saveSalesFlow(B, KH.key, { flow: { ...f, mode: "auto" }, status: "active" }, "Sếp");
    const r = await off("off_3", "Khóa AI Marketing học phí bao nhiêu shop?", "o3");
    expect(r.replied).toBe(false);
    expect(sent).toHaveLength(0);
    expect(resolverCalls).toBe(0);
    const c = byId<Row>("conversation", r.conversationId)!;
    expect(c.ext.suggestion).toBeUndefined();
    expect(c.ext.flow).toBeUndefined();
    expect(c.state).toBe("human_active");
    // quay lại Gợi ý nhưng tin KHÔNG mang suggestOnly (noReply "analyse only" của kênh khác) → vẫn chỉ chấm lead
    saveSalesFlow(B, KH.key, { flow: { ...f, mode: "suggest" }, status: "active" }, "Sếp");
    const z = await handleIncoming(B, { channel: "zalo", externalConversationId: "z_4", customerName: "Khách Z", text: "Khóa AI Marketing học phí bao nhiêu shop?", messageId: "z4", noReply: true });
    expect(z.replied).toBe(false);
    expect(byId<Row>("conversation", z.conversationId)!.ext?.suggestion).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(resolverCalls).toBe(0);
  });

  it("khách nói 'đừng nhắn nữa' → ghi danh sách không nhận tin, KHÔNG gợi ý, KHÔNG gửi xác nhận; không có kịch bản đang bật → như noReply", async () => {
    const r = await off("off_5", "Khóa AI Marketing ok, nhưng đừng nhắn tin cho mình nữa nhé", "o5");
    expect(sent).toHaveLength(0);
    const c = byId<Row>("conversation", r.conversationId)!;
    expect(c.state).toBe("opted_out");
    expect(c.ext.suggestion).toBeUndefined();
    // sản phẩm tạm tắt kịch bản → không gợi ý
    saveSalesFlow(B, KH.key, { flow: getSalesFlow(B, KH.key).flow, status: "paused" }, "Sếp");
    const r2 = await off("off_6", "Khóa AI Marketing học phí bao nhiêu shop?", "o6");
    expect(byId<Row>("conversation", r2.conversationId)!.ext?.suggestion).toBeUndefined();
    expect(sent).toHaveLength(0);
    saveSalesFlow(B, KH.key, { flow: getSalesFlow(B, KH.key).flow, status: "active" }, "Sếp");
  });

  it("đường nào cũng không gửi: ngay cả khi bot tắt và nhân viên chưa giữ, tin nhắc lại (follow-up) của hội thoại Gợi ý bị dừng", async () => {
    const { runFollowUps } = await import("@dotaka/chat-engine");
    const conv = convOf("off_1");
    q.run("UPDATE conversation SET state = 'awaiting_customer' WHERE id = ?", conv.id);
    const at = new Date(); at.setUTCHours(5, 0, 0, 0); // 12:00 giờ VN
    const old = new Date(at.getTime() - 5 * 3600_000).toISOString();
    q.run("UPDATE conversation SET last_customer_at = ? WHERE id = ?", old, conv.id);
    q.run("UPDATE message SET sent_at = ? WHERE conversation_id = ? AND direction = 'in'", old, conv.id);
    insert("follow_up_plan", { biz_id: B, conversation_id: conv.id, step: 0, next_at: old, status: "active", template: "sau_hoi_gia" });
    sent.length = 0;
    expect(await runFollowUps(B, at)).toBe(0);
    expect(sent).toHaveLength(0);
    expect(q.get<Row>("SELECT status, template FROM follow_up_plan WHERE conversation_id = ?", conv.id)).toMatchObject({ status: "stopped", template: expect.stringContaining("suggest_mode") });
  });
});

// ---- Đồng bộ Messenger thật (Graph = fetch giả): đường bot TẮT mang cờ suggestOnly và không POST /messages.
describe("đồng bộ Messenger: bot tắt + kịch bản Gợi ý", () => {
  let liveCh: Row;
  type Call = { url: string; method: string };
  let calls: Call[] = [];
  const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString().replace("Z", "+0000");
  let threads: Record<string, { psid: string; name: string; msgs: { id: string; text: string; minAgo: number; fromPage?: boolean }[] }> = {};
  const mockGraph = () => {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: String(init?.method ?? "GET") });
      const m = u.match(/graph\.facebook\.com\/v[\d.]+\/([^/?]+)\/conversations/);
      if (m) {
        return new Response(JSON.stringify({ data: Object.entries(threads).map(([id, t]) => ({
          id, updated_time: iso(t.msgs[0].minAgo),
          participants: { data: [{ id: m[1], name: "Shop Mẫu" }, { id: t.psid, name: t.name }] },
          messages: { data: t.msgs.map((x) => ({ id: x.id, message: x.text, created_time: iso(x.minAgo), from: x.fromPage ? { id: m[1], name: "Shop Mẫu" } : { id: t.psid, name: t.name } })) },
        })) }), { status: 200 });
      }
      if (/\/messages$/.test(u) && init?.method === "POST") return new Response(JSON.stringify({ recipient_id: "x", message_id: "m_sent_x" }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }));
  };
  const posts = () => calls.filter((c) => c.method === "POST");
  async function runIngest() {
    for (const job of q.all<Row>("SELECT * FROM job WHERE name = 'chat.ingest' AND status = 'queued'")) {
      update("job", job.id, { status: "running" });
      await HANDLERS[job.name](job.payload, job);
      update("job", job.id, { status: "done" });
    }
  }
  const prep = () => {
    update("channel", liveCh.id, { meta: { messengerSyncedAt: new Date(Date.now() - 60 * 60_000).toISOString(), messengerBackfillAt: new Date().toISOString() } });
  };

  beforeAll(() => {
    const conn = insert("connection", { biz_id: B, platform: "meta", external_account_id: "u1", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
    liveCh = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Shop Mẫu", external_id: "PAGE1", connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
    setConversationConnector(liveMessengerConnector);
  });
  beforeEach(() => { setConversationConnector(liveMessengerConnector); });

  it("bot tắt: job chat.ingest mang suggestOnly; gợi ý được ghim; không có yêu cầu POST nào tới Facebook", async () => {
    setMessengerBot(B, false, "test");
    prep();
    threads = { t_1: { psid: "PSID_S1", name: "Lê Hoa", msgs: [{ id: "m_s1", text: "Khóa AI Marketing học phí bao nhiêu shop?", minAgo: 2 }] } };
    mockGraph();
    const r = await syncMessenger(B);
    expect(r).toMatchObject({ routed: 1 });
    const job = q.get<Row>("SELECT payload FROM job WHERE name = 'chat.ingest' AND idempotency_key = 'ingest:messenger:m_s1'")!;
    expect(job.payload.msg).toMatchObject({ noReply: true, suggestOnly: true });
    await runIngest();
    expect(posts()).toHaveLength(0); // KHÔNG gửi gì cho khách
    const c = q.get<Row>("SELECT * FROM conversation WHERE external_id = 'PSID_S1'")!;
    expect(c.ext.suggestion.text).toBeTruthy();
    expect(c.ext.flow).toMatchObject({ mode: "suggest" });
    expect(q.scalar<number>("SELECT COUNT(*) FROM message WHERE conversation_id = ? AND direction = 'out'", c.id)).toBe(0);
  });

  it("bot tắt + kịch bản Tự động: không gợi ý, không gửi; bot BẬT + kịch bản Tự động: bot gửi đúng 1 lần như cũ", async () => {
    const f = getSalesFlow(B, KH.key).flow;
    saveSalesFlow(B, KH.key, { flow: { ...f, mode: "auto" }, status: "active" }, "Sếp");
    setMessengerBot(B, false, "test");
    prep();
    threads = { t_2: { psid: "PSID_S2", name: "Trần An", msgs: [{ id: "m_s2", text: "Khóa AI Marketing học phí bao nhiêu shop?", minAgo: 2 }] } };
    mockGraph();
    await syncMessenger(B);
    await runIngest();
    expect(posts()).toHaveLength(0);
    expect(q.get<Row>("SELECT ext FROM conversation WHERE external_id = 'PSID_S2'")!.ext.suggestion).toBeUndefined();

    setMessengerBot(B, true, "test");
    prep();
    threads = { t_3: { psid: "PSID_S3", name: "Phạm Bình", msgs: [{ id: "m_s3", text: "Khóa AI Marketing học phí bao nhiêu shop?", minAgo: 2 }] } };
    mockGraph();
    await syncMessenger(B);
    await runIngest();
    expect(posts().filter((p) => /\/messages$/.test(p.url))).toHaveLength(1);
    expect(q.get<Row>("SELECT payload FROM job WHERE name = 'chat.ingest' AND idempotency_key = 'ingest:messenger:m_s3'")!.payload.msg.noReply).toBeUndefined();
    // bot BẬT + kịch bản Gợi ý: gợi ý, không gửi
    saveSalesFlow(B, KH.key, { flow: { ...f, mode: "suggest" }, status: "active" }, "Sếp");
    prep();
    threads = { t_4: { psid: "PSID_S4", name: "Võ Chi", msgs: [{ id: "m_s4", text: "Khóa AI Marketing học phí bao nhiêu shop?", minAgo: 2 }] } };
    mockGraph();
    await syncMessenger(B);
    await runIngest();
    expect(posts().filter((p) => /\/messages$/.test(p.url))).toHaveLength(0);
    expect(q.get<Row>("SELECT ext FROM conversation WHERE external_id = 'PSID_S4'")!.ext.suggestion.text).toBeTruthy();
    setMessengerBot(B, false, "test");
  });

  it("lịch hằng tuần chat.insight được tạo cho doanh nghiệp", () => {
    ensureBizSchedules(B);
    expect(q.get<Row>("SELECT every_minutes, queue FROM schedule WHERE biz_id = ? AND name = 'chat.insight'", B)).toMatchObject({ every_minutes: 7 * 24 * 60, queue: "agent" });
  });
});

// ---- Vòng lặp Thấu hiểu khách (7 bước)
describe("Vòng lặp Thấu hiểu khách", () => {
  it("bỏ hội thoại thử, nối SĐT/đơn/nguồn bài, phân nhóm, insight + đề xuất học câu nhân viên → duyệt thì vào kịch bản; đo lại lần sau", async () => {
    // kịch bản đang bật (Gợi ý) để có phễu theo bước
    const f = getSalesFlow(B, KH.key).flow;
    saveSalesFlow(B, KH.key, { flow: { ...f, mode: "suggest" }, status: "active" }, "Sếp");
    q.run("DELETE FROM exemplar WHERE biz_id = ?", B);
    q.run("DELETE FROM conversation WHERE biz_id = ?", B);
    q.run("DELETE FROM message WHERE biz_id = ?", B);
    q.run("DELETE FROM chat_insight WHERE biz_id = ?", B);
    sent.length = 0;

    const first = await handleIncoming(B, { channel: "messenger", externalConversationId: "fb_201", customerName: "Chị Hoa", text: "Khóa AI Marketing học phí bao nhiêu shop?", messageId: "i1", pageExternalId: "PAGE1" });
    const conv = byId<Row>("conversation", first.conversationId)!;
    await replyAsHuman(B, conv.id, conv.ext.suggestion.text, "NV Mai"); // dùng nguyên
    await handleIncoming(B, { channel: "messenger", externalConversationId: "fb_201", customerName: "Chị Hoa", text: "hơi đắt nhỉ", messageId: "i2", pageExternalId: "PAGE1" });
    await replyAsHuman(B, conv.id, "Dạ tính ra mỗi buổi chưa tới một bữa ăn nhà hàng mà có thực hành thật chị ạ, chị tham gia thử buổi đầu nhé?", "NV Mai"); // sửa

    await handleIncoming(B, { channel: "messenger", externalConversationId: "sim_1", customerName: "Khách thử nghiệm", text: "giá sao", messageId: "i3", pageExternalId: "PAGE1" });
    await handleIncoming(B, { channel: "messenger", externalConversationId: "fb_203", customerName: "Chị Ngọc", text: "Khóa AI Marketing có thực hành không, sđt chị 0987654321", messageId: "i4", pageExternalId: "PAGE1" });
    const c203 = convOf("fb_203");
    insert("orders", { biz_id: B, conversation_id: c203.id, customer_name: "Chị Ngọc", product: KH.name, total: 12_000_000, status: "approved", source: "chat" });
    const post = insert("post", { biz_id: B, channel_id: "fb_page", external_id: "v1", kind: "video", title: "Review khóa AI Marketing", body: "x", published_at: new Date().toISOString(), permalink: "https://facebook.com/reel/1" });
    insert("attribution_link", { biz_id: B, conversation_id: c203.id, post_id: post.id, source: "comment", method: "comment_to_inbox", confidence: 0.9 });

    const r = await runChatInsight(B, { useModel: false });
    const st = r.insight!.steps;
    expect(st.collect.conversations).toBeGreaterThanOrEqual(3);
    expect(st.clean.removed.test).toBe(1);
    expect(st.clean.kept).toBe(2);
    expect(st.mapping).toMatchObject({ withPhone: 1, withOrder: 1, withFlow: 2, withContent: 1 });
    expect(st.persona.segments.map((s: Row) => s.key)).toContain("buy_fast");
    expect(r.insight!.stats.funnelByProduct[0]).toMatchObject({ productKey: KH.key, conversations: 2, orders: 1 });
    expect(r.insight!.stats.byContent[0]).toMatchObject({ title: "Review khóa AI Marketing", link: "https://facebook.com/reel/1", kind: "video", n: 1, orders: 1 });
    expect(r.insight!.stats.suggestionStats).toMatchObject({ used: 1, edited: 1 });
    expect(JSON.stringify(r.insight)).not.toContain("0987654321"); // không lộ SĐT khách

    expect(r.pending).toHaveLength(1);
    expect(r.pending[0].diff.changes[0]).toMatchObject({ type: "stage_line", stage: "xu_ly_tu_choi" });
    const approval = byId<Row>("approval", r.pending[0].approval_id)!;
    expect(approval.status).toBe("pending"); // sales_flow luôn chờ Sếp duyệt
    await decideApproval(B, approval.id, "approve", undefined, undefined, "Sếp");
    const flow = getSalesFlow(B, KH.key);
    expect(flow.status).toBe("active");
    expect(flow.flow.mode).toBe("suggest"); // áp dụng đề xuất không đổi chế độ
    expect(flow.flow.stages.find((s) => s.key === "xu_ly_tu_choi")!.sayLike[0]).toMatch(/^Dạ tính ra mỗi buổi/);
    const after = latestChatInsight(B);
    expect(after.pending).toHaveLength(0);
    expect(after.optimize).toMatchObject({ proposed: 1, pending: 0, appliedTotal: 1 });
    expect(after.loop).toMatchObject({ runs: 1, appliedSincePrev: 1, phoneRateDelta: null });
    const again = await runChatInsight(B, { useModel: false });
    expect(again.loop.runs).toBe(2);
    expect(again.loop.phoneRateDelta).toBe(0);
  });

  it("đề xuất sales_flow luôn vào hộp Duyệt (không tự áp dụng) và applyProposal áp dụng cho đúng sản phẩm", () => {
    const row = insert("change_proposal", { biz_id: B, target_type: "sales_flow", target_id: KH.key, title: "Thêm băn khoăn", diff: { productKey: KH.key, changes: [{ type: "objection", q: "Học xong có việc làm không?", a: "Dạ chương trình đào tạo kỹ năng thực hành, em không dám hứa kết quả việc làm ạ." }] }, rationale: "x", lesson_ids: [], risk: "medium", status: "awaiting_approval", auto_apply_allowed: 0 });
    applyProposal(B, row.id, "Sếp");
    expect(getSalesFlow(B, KH.key).flow.objections[0].q).toBe("Học xong có việc làm không?");
    expect(byId<Row>("change_proposal", row.id)!.status).toBe("applied");
  });
});
