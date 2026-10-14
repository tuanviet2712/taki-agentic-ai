import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { addOptOutManual, detectOptOut, handleIncoming, listOptOuts, removeOptOut, runFollowUps, sendBotMessage, setConversationConnector } from "@dotaka/chat-engine";
import {
  NURTURE_DEFAULTS, decideApproval, liveMessengerConnector, maybeRemind, nurtureReviewStatus, nurtureSettings, nurtureTick, previewTemplates, processNurtureComment,
  runNewLead, runZaloFollowUps, saveNurtureSettings, sendZaloFollowUp, setPhoneManual, skipNurtureReview, tryFriendRequest,
} from "@dotaka/orchestrator";
import { encryptSecret } from "@dotaka/shared";
import { errorHandler } from "./http.ts";
import { nurtureRoutes } from "./routes/nurture.ts";

/**
 * Chăm khách từ bình luận — (B2) xem trước mẫu câu, (B3) chế độ duyệt trước N khách đầu, (B4) danh sách khách không nhận tin.
 * Facebook / ZL-CRM thật được giả bằng fetch; DB trong bộ nhớ.
 */
type Call = { url: string; method: string; body: string };
let calls: Call[] = [];
function mockFetch(route: (url: string, body: string) => unknown) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    calls.push({ url: String(url), method: String(init?.method ?? "GET"), body });
    const out = route(String(url), body);
    return out instanceof Response ? out : new Response(JSON.stringify(out ?? {}), { status: 200 });
  }));
}
const form = (c: Call) => new URLSearchParams(c.body);
const NOW = new Date("2026-10-02T03:00:00Z"); // 10:00 giờ VN
let n = 0;
let bizN = 0;
const fbOk = (url: string) => (url.includes("/messages") ? { recipient_id: `PSID_${++n}`, message_id: `mid.${n}` } : { id: `r_${n}` });
const replies = () => calls.filter((c) => c.url.endsWith("/comments"));
const dms = () => calls.filter((c) => c.url.endsWith("/messages"));

/** Doanh nghiệp riêng có Trang Facebook kết nối thật (fetch giả). */
function liveBiz(nurture: Row = {}) {
  const biz = insert("biz", { name: `Shop R${++bizN}`, settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" }, nurture: { enabled: true, ...nurture } } }).id;
  const conn = insert("connection", { biz_id: biz, platform: "meta", external_account_id: `ru${bizN}`, token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
  const ch = insert("channel", { biz_id: biz, platform: "facebook", kind: "page", name: "Trang Lan", external_id: `RPG${bizN}`, connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
  const post = () => insert("post", { biz_id: biz, channel_id: ch.id, external_id: `RPG${bizN}_${++n}`, content_item_id: null, kind: "image", title: "Bài", body: "x", published_at: new Date().toISOString(), permalink: null, ad_status: "none" });
  const cmt = (postId: string, extra: Row = {}) => insert("post_comment", { biz_id: biz, post_id: postId, author: "Phạm Thu Trang", author_external_id: `RA${++n}`, external_id: `rx${n}`, text: "Giá sao shop", label: "purchase_intent", hidden: 0, source: "webhook", ...extra });
  return { biz, ch, post, cmt };
}
const leadOf = (commentId: string) => q.get<Row>("SELECT * FROM nurture_lead WHERE comment_id = ?", commentId)!;
const approvalOf = (leadId: string) => q.get<Row>("SELECT * FROM approval WHERE subject_type = 'nurture_send' AND subject_id = ? ORDER BY created_at DESC LIMIT 1", leadId)!;

let app: FastifyInstance;
beforeAll(async () => {
  process.env.DB_PATH = ":memory:";
  delete process.env.PUBLIC_BASE_URL;
  openDb(":memory:");
  setConversationConnector(liveMessengerConnector);
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  nurtureRoutes(app);
  await app.ready();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await app.close(); closeDb(); });

// ---------------- B2: xem trước mẫu câu ----------------
describe("B2) xem trước mẫu câu", () => {
  it("API quét và xem bình luận dùng đúng doanh nghiệp, hoạt động khi chăm tự động tắt", async () => {
    const t = liveBiz();
    saveNurtureSettings(t.biz, { enabled: false }, "test");
    const post = t.post();
    mockFetch((url) => url.includes(`/${post.external_id}/comments`) ? { data: [{ id: "api-scan-comment", from: { id: "api-customer", name: "Khách API" }, message: "Inbox giá giúp mình", created_time: new Date().toISOString() }] } : { data: [] });
    const scan = await app.inject({ method: "POST", url: "/v1/nurture/scan", headers: { "x-biz-id": t.biz }, payload: {} });
    expect(scan.statusCode).toBe(200);
    expect(scan.json()).toMatchObject({ posts: 1, added: 1, errors: [] });
    const list = await app.inject({ method: "GET", url: "/v1/nurture/comments", headers: { "x-biz-id": t.biz } });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject([{ author: "Khách API", text: "Inbox giá giúp mình" }]);
    expect(JSON.stringify(list.json())).not.toMatch(/token|ciphertext|author_external_id/);
    const other = liveBiz();
    expect((await app.inject({ method: "GET", url: "/v1/nurture/comments", headers: { "x-biz-id": other.biz } })).json()).toEqual([]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(q.scalar<number>("SELECT COUNT(*) FROM nurture_lead WHERE biz_id = ?", t.biz)).toBe(0);
  });

  it("điền {ten} {san_pham} {link} {shop} bằng dữ liệu mẫu (sản phẩm affiliate đầu tiên), giữ xuống dòng", async () => {
    const t = liveBiz();
    insert("dna_profile", { biz_id: t.biz, version: 1, status: "active", created_by: "test", data: { products: [
      { key: "a", name: "Khoá học Excel", link: null },
      { key: "sua-x", name: "Sữa hạt X", link: "https://sua.vn/x", affiliate: true },
    ] } });
    const tpl = "Chào {ten}, shop {shop} gửi {ten} thông tin {san_pham} ạ.\nXem tại: {link}\nCho shop xin SĐT nhé!";
    const r = previewTemplates(t.biz, [tpl, NURTURE_DEFAULTS.replyTemplates[0]]);
    expect(r.vars).toMatchObject({ ten: "Lan", san_pham: "Sữa hạt X", link: "https://sua.vn/x", shop: "Trang Lan" });
    expect(r.items[0]).toBe("Chào Lan, shop Trang Lan gửi Lan thông tin Sữa hạt X ạ.\nXem tại: https://sua.vn/x\nCho shop xin SĐT nhé!");
    expect(r.items[1]).toContain("Lan");
    expect(r.items[1]).not.toContain("{ten}");

    // Qua API (cùng hàm điền mẫu như lúc gửi thật)
    const res = await app.inject({ method: "POST", url: "/v1/nurture/preview", headers: { "x-biz-id": t.biz }, payload: { template: "Dạ {ten} ơi\n\n{san_pham}: {link}" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.text.split("\n")).toHaveLength(3);
    expect(body.text).toMatch(/^Dạ Lan ơi\n\nSữa hạt X: https:\/\/sua\.vn\/x$/);
  });

  it("chưa có sản phẩm → dùng ví dụ; bỏ cụm {link} không xảy ra vì luôn có link mẫu", () => {
    const t = liveBiz();
    const r = previewTemplates(t.biz, ["{san_pham} — {link}"]);
    expect(r.vars.example).toBe(true);
    expect(r.items[0]).toContain("https://");
  });
});

// ---------------- B3: chế độ duyệt trước ----------------
describe("B3) chế độ duyệt trước N khách đầu", () => {
  it("bật lần đầu ở doanh nghiệp mới → duyệt trước 10 khách; doanh nghiệp đã bật từ trước → giữ chạy tự động", () => {
    const fresh = insert("biz", { name: "Shop mới", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
    saveNurtureSettings(fresh, { enabled: true }, "CEO");
    expect(nurtureReviewStatus(fresh)).toMatchObject({ active: true, first: 10, approved: 0, remaining: 10 });
    const legacy = liveBiz(); // settings.nurture = { enabled: true } (bật trước khi có tính năng)
    expect(nurtureReviewStatus(legacy.biz)).toMatchObject({ active: false, remaining: 0 });
  });

  it("đang duyệt trước: KHÔNG gửi, tạo mục duyệt đúng câu sẽ gửi; duyệt → gửi đúng 1 lần (giữ chỗ chống trùng); sửa → dùng bản sửa; từ chối → bỏ qua; đủ N → tự động", async () => {
    const t = liveBiz({ reviewFirst: 2, reviewApproved: 0 });
    const p = t.post();
    const [c1, c2, c3] = [t.cmt(p.id, { author: "Nguyễn Thị Lan" }), t.cmt(p.id), t.cmt(p.id)];
    mockFetch(fbOk);
    for (const c of [c1, c2, c3]) expect(await processNurtureComment(t.biz, c.id, NOW)).toMatchObject({ stage: "awaiting_review" });
    expect(calls).toHaveLength(0);
    for (const c of [c1, c2, c3]) expect(byId<Row>("post_comment", c.id)).toMatchObject({ replied_at: null, dm_sent_at: null }); // chưa giữ chỗ
    const l1 = leadOf(c1.id);
    const ap1 = approvalOf(l1.id);
    expect(ap1).toMatchObject({ status: "pending", risk: "medium", subject_type: "nurture_send" });
    expect(ap1.preview).toMatchObject({ author: "Nguyễn Thị Lan", comment: "Giá sao shop", replyText: expect.stringContaining("Lan"), dmText: expect.stringContaining("Lan") });
    expect(nurtureReviewStatus(t.biz)).toMatchObject({ active: true, remaining: 2, pending: 3 });
    // Tick không đụng tới lead chờ duyệt
    await nurtureTick(t.biz, NOW);
    expect(calls).toHaveLength(0);

    // Duyệt + tick + chạy lại cùng lúc → đúng 1 trả lời + 1 inbox
    mockFetch(fbOk);
    await Promise.all([decideApproval(t.biz, ap1.id, "approve", undefined, undefined, "CEO"), nurtureTick(t.biz, NOW), runNewLead(t.biz, l1, NOW)]);
    await runNewLead(t.biz, l1, NOW);
    expect(replies()).toHaveLength(1);
    expect(dms()).toHaveLength(1);
    expect(form(replies()[0]).get("message")).toBe(ap1.preview.replyText);
    expect(JSON.parse(form(dms()[0]).get("message")!).text).toBe(ap1.preview.dmText);
    expect(leadOf(c1.id).stage).toBe("asked_contact");
    await expect(decideApproval(t.biz, ap1.id, "approve", undefined, undefined, "CEO")).rejects.toThrow(/đã được xử lý/);
    expect(nurtureReviewStatus(t.biz)).toMatchObject({ approved: 1, remaining: 1 });

    // Sửa tin inbox rồi duyệt → gửi đúng bản sửa (giữ xuống dòng)
    const l2 = leadOf(c2.id);
    const edited = "Chào bạn, shop gửi ưu đãi riêng ạ.\nBạn cho shop xin SĐT nhé!";
    mockFetch(fbOk);
    await decideApproval(t.biz, approvalOf(l2.id).id, "edit", undefined, edited, "CEO");
    expect(dms()).toHaveLength(1);
    expect(JSON.parse(form(dms()[0]).get("message")!).text).toBe(edited);
    const conv2 = byId<Row>("conversation", leadOf(c2.id).conversation_id)!;
    expect(q.get<Row>("SELECT body FROM message WHERE conversation_id = ? AND json_extract(meta, '$.kind') = 'nurture_dm'", conv2.id)!.body.text).toBe(edited);
    expect(nurtureReviewStatus(t.biz)).toMatchObject({ active: false, approved: 2, remaining: 0 });

    // Từ chối → bỏ qua, không gửi gì
    mockFetch(fbOk);
    await decideApproval(t.biz, approvalOf(leadOf(c3.id).id).id, "reject", undefined, undefined, "CEO");
    expect(calls).toHaveLength(0);
    expect(leadOf(c3.id).stage).toBe("skipped");

    // Đủ N → khách mới chạy tự động như thường
    const c4 = t.cmt(p.id);
    mockFetch(fbOk);
    expect(await processNurtureComment(t.biz, c4.id, NOW)).toMatchObject({ stage: "asked_contact" });
    expect(replies()).toHaveLength(1);
    expect(dms()).toHaveLength(1);
    expect(q.scalar<number>("SELECT COUNT(*) FROM approval WHERE subject_type = 'nurture_send' AND subject_id = ?", leadOf(c4.id).id)).toBe(0);
  });

  it("duyệt quá 7 ngày sau bình luận → failed, ghi rõ lý do, không gửi; tắt chăm khách → mục duyệt mở lại", async () => {
    const t = liveBiz({ reviewFirst: 5, reviewApproved: 0 });
    const c = t.cmt(t.post().id);
    mockFetch(fbOk);
    await processNurtureComment(t.biz, c.id, NOW);
    const l = leadOf(c.id);
    const ap = approvalOf(l.id);

    saveNurtureSettings(t.biz, { enabled: false }, "CEO");
    await expect(decideApproval(t.biz, ap.id, "approve", undefined, undefined, "CEO")).rejects.toThrow(/TẮT/);
    expect(byId<Row>("approval", ap.id)!.status).toBe("pending");
    saveNurtureSettings(t.biz, { enabled: true }, "CEO");

    update("post_comment", c.id, { external_created_at: new Date(Date.now() - 8 * 24 * 3600_000).toISOString() });
    mockFetch(fbOk);
    await decideApproval(t.biz, ap.id, "approve", undefined, undefined, "CEO");
    expect(calls).toHaveLength(0);
    const after = leadOf(c.id);
    expect(after.stage).toBe("failed");
    expect(JSON.stringify(after.log)).toMatch(/quá 7 ngày/);
  });

  it("mục duyệt hết hạn → tick chuyển lead sang failed; Sếp bỏ qua chế độ duyệt → khách đang chờ chạy tự động", async () => {
    const t = liveBiz({ reviewFirst: 3, reviewApproved: 0 });
    const p = t.post();
    const [a, b] = [t.cmt(p.id), t.cmt(p.id)];
    mockFetch(fbOk);
    await processNurtureComment(t.biz, a.id, NOW);
    await processNurtureComment(t.biz, b.id, NOW);
    update("approval", approvalOf(leadOf(a.id).id).id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    await nurtureTick(t.biz, new Date());
    expect(leadOf(a.id).stage).toBe("failed");
    expect(calls).toHaveLength(0);

    const r = skipNurtureReview(t.biz, "CEO");
    expect(r.released).toBe(1);
    expect(nurtureSettings(t.biz).reviewFirst).toBe(0);
    expect(approvalOf(leadOf(b.id).id).status).toBe("expired");
    mockFetch(fbOk);
    await nurtureTick(t.biz, new Date());
    expect(leadOf(b.id).stage).toBe("asked_contact");
    expect(dms()).toHaveLength(1);
  });
});

// ---------------- B4: khách không nhận tin ----------------
describe("B4) nhận diện câu từ chối nhận tin (thận trọng)", () => {
  const yes = [
    "Đừng nhắn cho tôi nữa", "dung nhan cho toi nua", "Đừng nhắn tin nữa!", "STOP", "stop", "Hủy đăng ký", "huy dang ky nhan tin",
    "Không quan tâm nữa, đừng gửi", "khong quan tam nua, dung gui", "Spam quá", "spam qua", "Nhắn nữa là tôi chặn đấy", "tôi sẽ chặn page luôn",
    "Em không muốn nhận tin nhắn quảng cáo", "thôi khỏi nhắn nữa nhé", "Em không nhận tin nữa đâu", "ĐỪNG LÀM PHIỀN", "ngừng gửi tin nữa giúp mình",
  ];
  const no = [
    "không nhắn được cho shop", "Mình không nhắn được cho shop qua Zalo", "Sao shop không nhắn nữa vậy?", "shop không nhắn nữa à",
    "Đừng nhắn sai địa chỉ nha", "Hủy đăng ký khóa học giúp em", "Tôi chán quá", "mình dùng nhắn tin zalo được không", "Giá bao nhiêu shop",
    "đừng gửi hàng hôm nay nhé", "chặn cửa này dùng được không", "Không quan tâm", "ib mình nhé", "0912345678", "",
  ];
  for (const t of yes) it(`từ chối: "${t}"`, () => expect(detectOptOut(t)).toBe(true));
  for (const t of no) it(`KHÔNG phải từ chối: "${t}"`, () => expect(detectOptOut(t)).toBe(false));
});

describe("B4) khách không nhận tin → không tin tự động nào", () => {
  it("Messenger: khách nói 'đừng nhắn nữa' → 1 câu xác nhận rồi im lặng; vào danh sách; không nhắc SĐT, không trả lời bài khác, không follow-up", async () => {
    const t = liveBiz();
    const c = t.cmt(t.post().id);
    mockFetch(fbOk);
    await processNurtureComment(t.biz, c.id, NOW);
    const l = leadOf(c.id);
    const conv = byId<Row>("conversation", l.conversation_id)!;
    mockFetch(fbOk);
    const r = await handleIncoming(t.biz, { channel: "messenger", externalConversationId: conv.external_id, customerName: "Phạm Thu Trang", text: "Đừng nhắn cho tôi nữa", messageId: "o.1", pageExternalId: `RPG${bizN}` });
    expect(r).toMatchObject({ replied: true, state: "opted_out" });
    expect(dms()).toHaveLength(1);
    expect(JSON.parse(form(dms()[0]).get("message")!).text).toMatch(/không gửi tin chủ động/);
    expect(q.scalar<number>("SELECT COUNT(*) FROM contact_optout WHERE biz_id = ?", t.biz)).toBeGreaterThanOrEqual(2); // PSID + id người bình luận
    expect(leadOf(c.id).stage).toBe("stopped");

    // Khách nhắn tiếp → bot im lặng (tối đa 1 câu xác nhận)
    mockFetch(fbOk);
    expect(await handleIncoming(t.biz, { channel: "messenger", externalConversationId: conv.external_id, customerName: "Phạm Thu Trang", text: "alo", messageId: "o.2", pageExternalId: `RPG${bizN}` })).toMatchObject({ replied: false });
    // Nhắc xin SĐT / gửi tin bot → không gửi
    insert("message", { biz_id: t.biz, conversation_id: conv.id, direction: "out", sender: "bot", body: { text: "x" }, meta: {}, sent_at: new Date(Date.now() - 4.9 * 3600_000).toISOString() });
    await maybeRemind(t.biz, { ...leadOf(c.id), stage: "asked_contact" }, nurtureSettings(t.biz), new Date());
    await expect(sendBotMessage(t.biz, conv.id, "Nhắc nhẹ ạ", { kind: "nurture_reminder" }, "k1")).rejects.toThrow(/không muốn nhận tin/);
    expect(calls).toHaveLength(0);

    // Cùng người bình luận ở bài khác → không trả lời công khai, không inbox
    const other = t.cmt(t.post().id, { author_external_id: c.author_external_id });
    mockFetch(fbOk);
    await processNurtureComment(t.biz, other.id, NOW);
    expect(calls).toHaveLength(0);
    // Người trong danh sách (id Facebook) bình luận lần đầu → dừng ngay, không gửi gì
    insert("contact_optout", { biz_id: t.biz, channel: "facebook", external_id: "FB_OPT", source: "manual", name: "Khách" });
    const fresh = t.cmt(t.post().id, { author_external_id: "FB_OPT" });
    mockFetch(fbOk);
    expect(await processNurtureComment(t.biz, fresh.id, NOW)).toMatchObject({ stage: "stopped", skipped: "opted_out" });
    expect(calls).toHaveLength(0);
  });

  it("danh sách (không phụ thuộc trạng thái hội thoại): bot không trả lời, follow-up Messenger dừng", async () => {
    const t = liveBiz();
    const conv = insert("conversation", { biz_id: t.biz, channel: "messenger", external_id: "PS_LIST", customer_ref: "c", customer_name: "Lan", state: "awaiting_customer", tags: [], unread: 0, ext: { pageId: `RPG${bizN}` }, last_customer_at: new Date().toISOString() });
    insert("message", { biz_id: t.biz, conversation_id: conv.id, direction: "in", sender: "customer", body: { text: "giá?" }, meta: {}, sent_at: new Date(NOW.getTime() - 3600_000).toISOString() });
    const plan = insert("follow_up_plan", { biz_id: t.biz, conversation_id: conv.id, step: 0, next_at: new Date(NOW.getTime() - 1000).toISOString(), status: "active", template: "sau_hoi_gia" });
    insert("contact_optout", { biz_id: t.biz, channel: "messenger", external_id: "PS_LIST", source: "manual", name: "Lan" });
    mockFetch(fbOk);
    expect(await runFollowUps(t.biz, NOW)).toBe(0);
    expect(byId<Row>("follow_up_plan", plan.id)!.status).toBe("stopped");
    expect(await handleIncoming(t.biz, { channel: "messenger", externalConversationId: "PS_LIST", customerName: "Lan", text: "còn hàng không", messageId: "l.1" })).toMatchObject({ replied: false });
    expect(calls).toHaveLength(0);
  });

  it("thêm tay theo SĐT → không gửi kết bạn Zalo (tự động lẫn bấm tay); SĐT chỉ hiện dạng che; bỏ khỏi danh sách thì gửi lại được", async () => {
    const t = liveBiz();
    insert("connection", { biz_id: t.biz, platform: "zlcrm", external_account_id: "http://zl.test", token_ciphertext: encryptSecret(JSON.stringify({ api_key: "k" })), status: "active", mode: "live", config: { base_url: "http://zl.test", accounts: [{ id: "nickA", name: "Nick A", status: "connected" }] } });
    const c = t.cmt(t.post().id);
    mockFetch(fbOk);
    await processNurtureComment(t.biz, c.id, NOW);
    const l = leadOf(c.id);
    setPhoneManual(t.biz, l.id, "0901 234 567", "CEO");
    update("nurture_lead", l.id, { next_check_at: new Date(Date.now() - 60_000).toISOString() });

    addOptOutManual(t.biz, { phone: "0901234567", name: "Trang", reason: "Khách gọi điện xin dừng" }, "CEO");
    const list = listOptOuts(t.biz);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(list)).not.toContain("901234567");
    expect(JSON.stringify(list)).toContain("0901***567");
    expect(listOptOuts(t.biz, "0901 234 567").length).toBeGreaterThanOrEqual(1); // tìm theo SĐT (so mã băm)

    mockFetch(() => ({ found: true, uid: "zu1" }));
    update("nurture_lead", l.id, { stage: "has_phone" });
    await expect(tryFriendRequest(t.biz, l.id, { force: true })).rejects.toThrow(/không muốn nhận tin/);
    expect(await tryFriendRequest(t.biz, l.id, { now: new Date(Date.now() + 3600_000) })).toMatchObject({ skipped: "opted_out" });
    expect(calls).toHaveLength(0);

    for (const row of listOptOuts(t.biz)) removeOptOut(t.biz, row.id, "CEO");
    expect(listOptOuts(t.biz)).toHaveLength(0);
    update("nurture_lead", l.id, { stage: "has_phone", next_check_at: null });
    mockFetch((u) => (u.includes("lookup-by-phone") ? { found: true, uid: "zu1" } : { sent: true, uid: "zu1" }));
    expect(await tryFriendRequest(t.biz, l.id, { force: true })).toMatchObject({ stage: "friend_requested" });
  });

  it("follow-up Zalo: khách trong danh sách → không soạn/gửi, kể cả khi mục đã được duyệt", async () => {
    const t = liveBiz();
    insert("connection", { biz_id: t.biz, platform: "zlcrm", external_account_id: "http://zl.test", token_ciphertext: encryptSecret(JSON.stringify({ api_key: "k" })), status: "active", mode: "live", config: { base_url: "http://zl.test", accounts: [{ id: "nickA", name: "Nick A" }] } });
    const conv = insert("conversation", { biz_id: t.biz, channel: "zalo", external_id: "zlu:nickA:u77", customer_ref: "c", customer_name: "Hoa", state: "awaiting_customer", lead_grade: "hot", tags: [], unread: 0, ext: { zaloAccountId: "nickA", threadId: "u77", threadType: "user" } });
    const p1 = insert("follow_up_plan", { biz_id: t.biz, conversation_id: conv.id, step: 0, next_at: new Date(NOW.getTime() - 1000).toISOString(), status: "active", template: "zalo_followup", meta: {} });
    insert("contact_optout", { biz_id: t.biz, channel: "zalo", external_id: "zlu:nickA:u77", source: "auto", name: "Hoa" });
    mockFetch(() => ({}));
    expect(await runZaloFollowUps(t.biz, NOW)).toMatchObject({ drafted: 0, sent: 0, stopped: 1 });
    const p2 = insert("follow_up_plan", { biz_id: t.biz, conversation_id: conv.id, step: 0, next_at: null, status: "awaiting_approval", template: "zalo_followup", meta: {} });
    expect(await sendZaloFollowUp(t.biz, p2.id, "Dạ chị Hoa ơi", "CEO")).toMatchObject({ ok: false, skipped: "opted_out" });
    expect(calls).toHaveLength(0);
    expect(byId<Row>("follow_up_plan", p1.id)!.status).toBe("stopped");
    expect(byId<Row>("follow_up_plan", p2.id)!.status).toBe("stopped");
  });

  it("Zalo chỉ phân tích (noReply): khách từ chối → vào danh sách, không gửi gì", async () => {
    const t = liveBiz();
    mockFetch(() => ({}));
    const r = await handleIncoming(t.biz, { channel: "zalo", externalConversationId: "zl:x1", customerName: "Mai", text: "Đừng nhắn tin nữa", messageId: "z.1", noReply: true });
    expect(r).toMatchObject({ replied: false, state: "opted_out" });
    expect(q.get("SELECT id FROM contact_optout WHERE biz_id = ? AND channel = 'zalo' AND external_id = 'zl:x1'", t.biz)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

// ---------------- API: hình dạng dữ liệu mà trang /nurture cần ----------------
describe("API /v1/nurture (trang Chăm khách)", () => {
  it("GET trả cài đặt + mặc định + trạng thái duyệt trước + số khách không nhận tin + Fanpage; chỉ Facebook, không có cài đặt link/Instagram", async () => {
    const t = liveBiz({ reviewFirst: 3, reviewApproved: 1 });
    const res = await app.inject({ method: "GET", url: "/v1/nurture", headers: { "x-biz-id": t.biz } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.review).toMatchObject({ active: true, first: 3, approved: 1, remaining: 2, pending: 0 });
    expect(b.optoutCount).toBe(0);
    expect(b.defaults).toMatchObject({ enabled: false, reviewFirst: 10, reviewApproved: 0 });
    expect(b.pages).toEqual([expect.objectContaining({ name: "Trang Lan", live: true })]);
    expect(b.pages.every((p: any) => p.platform === undefined || p.platform === "facebook")).toBe(true);
    expect(b.settings).not.toHaveProperty("linkComment");
    expect(b.funnel).toHaveProperty("needsCheck");
  });

  it("opt-out qua API: thêm theo SĐT (hiện dạng che) → đếm → tìm → bỏ; SĐT sai bị từ chối", async () => {
    const t = liveBiz();
    const h = { "x-biz-id": t.biz };
    expect((await app.inject({ method: "POST", url: "/v1/nurture/optouts", headers: h, payload: { phone: "123" } })).statusCode).toBe(400);
    const add = await app.inject({ method: "POST", url: "/v1/nurture/optouts", headers: h, payload: { phone: "0912 345 678", name: "Hoa", reason: "gọi điện" } });
    expect(add.statusCode).toBe(200);
    const list = (await app.inject({ method: "GET", url: "/v1/nurture/optouts?search=Hoa", headers: h })).json();
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("912345678");
    expect((await app.inject({ method: "GET", url: "/v1/nurture", headers: h })).json().optoutCount).toBe(1);
    expect((await app.inject({ method: "DELETE", url: `/v1/nurture/optouts/${list[0].id}`, headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/nurture/optouts", headers: h })).json()).toHaveLength(0);
  });

  it("POST /v1/nurture/preview + /review/skip qua API", async () => {
    const t = liveBiz({ reviewFirst: 5, reviewApproved: 0 });
    const h = { "x-biz-id": t.biz };
    const pv = await app.inject({ method: "POST", url: "/v1/nurture/preview", headers: h, payload: { templates: ["Chào {ten} từ {shop}", "{san_pham}: {link}"] } });
    expect(pv.json().items).toHaveLength(2);
    expect(pv.json().items[0]).toBe("Chào Lan từ Trang Lan");
    const sk = await app.inject({ method: "POST", url: "/v1/nurture/review/skip", headers: h });
    expect(sk.json()).toMatchObject({ ok: true, released: 0 });
    expect((await app.inject({ method: "GET", url: "/v1/nurture", headers: h })).json().review.active).toBe(false);
  });
});
