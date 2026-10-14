import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { handleIncoming, setConversationConnector } from "@dotaka/chat-engine";
import { decryptSecret, encryptSecret, extractVnPhone, extractVnPhones, maskPhone, maskPhonesInText, normalizeVnPhone } from "@dotaka/shared";
import { liveMessengerConnector } from "./connections.ts";
import { HANDLERS } from "./index.ts";
import { ensureBizSchedules } from "./business.ts";
import {
  NURTURE_DEFAULTS, checkFriendAccepted, fillTemplate, friendCheckInterval, listNurtureLeads, maybeRemind, nurtureFunnel, nurtureSettings, nurtureTick, pollBizComments,
  pollPostComments, processNurtureComment, resendDm, saveNurtureSettings, setPhoneManual, truncateGreeting, tryFriendRequest,
} from "./nurture.ts";

/**
 * Chăm khách từ bình luận (Fanpage THẬT; Facebook / ZL-CRM là fetch giả, DB :memory:): trả lời công khai + Private Reply →
 * bắt SĐT trong Messenger → kết bạn Zalo qua ZL-CRM → đồng ý → follow-up Zalo. Cộng các hồi quy an toàn: lead kẹt, gửi không rõ
 * kết quả (hết thời gian chờ KHÔNG bao giờ gửi lại), chạy chồng, tuổi bình luận, tắt giữa chừng, chống trùng người bình luận,
 * lỗi ZL-CRM, lịch quét 1 phút. (Port từ AI Affiliate OS, bỏ webhook/mô phỏng/Instagram.)
 */
type Call = { url: string; method: string; body: string; headers: Record<string, string> };
let calls: Call[] = [];
function mockFetch(route: (url: string, body: string) => unknown) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    calls.push({ url: String(url), method: String(init?.method ?? "GET"), body, headers: (init?.headers ?? {}) as Record<string, string> });
    const out = route(String(url), body);
    return out instanceof Response ? out : new Response(JSON.stringify(out ?? {}), { status: 200 });
  }));
}
const form = (c: Call) => new URLSearchParams(c.body);
const NOW = new Date("2026-10-02T03:00:00Z"); // 10:00 giờ VN

let B: string;
let liveCh: Row;
let n = 0;
const livePost = (ext = `PAGE1_${++n}`) => insert("post", { biz_id: B, channel_id: liveCh.id, external_id: ext, content_item_id: null, kind: "image", title: "Bài thật", body: "x", published_at: new Date().toISOString(), permalink: null, ad_status: "none" });
const comment = (postId: string, extra: Row = {}) => insert("post_comment", { biz_id: B, post_id: postId, author: "Nguyễn Thị Lan", author_external_id: `U${++n}`, external_id: `cmt${n}`, text: "Giá bao nhiêu vậy shop, inbox mình nhé", label: "purchase_intent", hidden: 0, source: "webhook", ...extra });
const setBiz = (patch: Row) => { const b = byId<Row>("biz", B)!; update("biz", B, { settings: { ...b.settings, ...patch } }); };

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" }, nurture: { enabled: true, reviewFirst: 0 } } }).id;
  const conn = insert("connection", { biz_id: B, platform: "meta", external_account_id: "u1", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
  liveCh = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Shop Lan", external_id: "PAGE1", connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
  setConversationConnector(liveMessengerConnector);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => { closeDb(); });

describe("SĐT Việt Nam", () => {
  it("chuẩn hoá & tìm SĐT trong tin nhắn", () => {
    expect(extractVnPhone("sđt mình 0912 345 678 nha")).toBe("0912345678");
    expect(extractVnPhone("+84 912345678")).toBe("0912345678");
    expect(extractVnPhone("84912345678")).toBe("0912345678");
    expect(extractVnPhone("zalo 0912.345.678 ạ")).toBe("0912345678");
    expect(extractVnPhone("Zalo: 091-234-5678")).toBe("0912345678");
    expect(extractVnPhones("0912345678 hoặc 0987654321")).toEqual(["0912345678", "0987654321"]);
    expect(extractVnPhone("mua 2 hộp giá 350000")).toBeNull();
    expect(extractVnPhone("số bàn 0283 822 1234")).toBeNull();
    expect(normalizeVnPhone("912345678")).toBe("0912345678");
    expect(maskPhone("0912345678")).toBe("0912***678");
    expect(maskPhonesInText("zalo 0912 345 678 nhé")).toBe("zalo 0912***678 nhé");
  });
  it("mẫu câu mặc định: điền biến; không có link thì bỏ cụm chứa {link}", () => {
    const tpl = NURTURE_DEFAULTS.dmTemplates[0];
    expect(fillTemplate(tpl, { ten: "Lan", san_pham: "Sữa X", link: null })).toBe("Chào Lan, em gửi Lan thông tin Sữa X ạ. Lan để lại SĐT hoặc Zalo để bên em tư vấn kỹ hơn cho mình nhé!");
    expect(fillTemplate(tpl, { ten: "Lan", san_pham: "Sữa X", link: "https://x.vn/a" })).toContain("Chi tiết tại: https://x.vn/a\nLan để lại");
  });
});

describe("phân loại bình luận → xếp job chăm khách", () => {
  it("phân loại xong → xếp job cho bình luận muốn mua / hỏi (không cho spam)", async () => {
    const p = livePost();
    const a = insert("post_comment", { biz_id: B, post_id: p.id, author: "A", text: "Cho mình xin giá với", hidden: 0, source: "poll" });
    const s = insert("post_comment", { biz_id: B, post_id: p.id, author: "S", text: "Vay tiền nhanh lãi thấp liên hệ zalo", hidden: 0, source: "poll" });
    await HANDLERS["nurture.classify"]({ postId: p.id }, { biz_id: B } as Row);
    expect(q.get("SELECT id FROM job WHERE name = 'nurture.comment' AND idempotency_key = ?", `nurture:cmt:${a.id}`)).toBeTruthy();
    expect(q.get("SELECT id FROM job WHERE name = 'nurture.comment' AND idempotency_key = ?", `nurture:cmt:${s.id}`)).toBeUndefined();
  });
});

describe("trả lời bình luận + Private Reply (Facebook thật, fetch giả)", () => {
  let leadPsidConv: string;
  let leadId: string;

  it("trả lời công khai dưới bình luận rồi nhắn inbox bằng comment_id; nối hội thoại theo PSID", async () => {
    const p = livePost();
    const c = comment(p.id);
    mockFetch((url) => (url.includes("/messages") ? { recipient_id: "PSID5", message_id: "mid.1" } : { id: "reply_1" }));
    const r = await processNurtureComment(B, c.id, NOW);
    expect(r).toMatchObject({ stage: "asked_contact" });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toMatch(new RegExp(`graph\\.facebook\\.com/v[\\d.]+/${c.external_id}/comments$`));
    expect(form(calls[0]).get("message")).toMatch(/Lan.*(inbox|tin nhắn)|(inbox|tin nhắn).*Lan/);
    expect(calls[0].headers.Authorization).toBe("Bearer PAGE_TOKEN"); // token ở header, không nằm trong URL / body
    expect(calls[0].url).not.toContain("PAGE_TOKEN");
    expect(calls[1].url).toMatch(/graph\.facebook\.com\/v[\d.]+\/PAGE1\/messages$/);
    expect(JSON.parse(form(calls[1]).get("recipient")!)).toEqual({ comment_id: c.external_id });
    expect(JSON.parse(form(calls[1]).get("message")!).text).toMatch(/SĐT|Zalo/);
    const lead = q.get<Row>("SELECT * FROM nurture_lead WHERE comment_id = ?", c.id)!;
    expect(lead).toMatchObject({ stage: "asked_contact", psid: "PSID5" });
    const conv = byId<Row>("conversation", lead.conversation_id)!;
    expect(conv).toMatchObject({ channel: "messenger", external_id: "PSID5", state: "awaiting_customer" });
    expect(conv.ext.pageId).toBe("PAGE1");
    expect(byId<Row>("post_comment", c.id)).toMatchObject({ replied_at: expect.any(String), dm_sent_at: expect.any(String) });
    leadPsidConv = conv.id;
    leadId = lead.id;

    // Cùng người bình luận lần nữa trên cùng bài → VẪN trả lời công khai + inbox (mỗi bình luận đều được rep),
    // nhưng không lặp chuỗi xin SĐT/nhắc/kết bạn (lead "lặp" dừng ở stage replied, hội thoại vẫn gắn lead gốc).
    const again = comment(p.id, { author_external_id: c.author_external_id });
    mockFetch(fbOk);
    expect(await processNurtureComment(B, again.id, NOW)).toMatchObject({ stage: "replied" });
    expect(calls.filter((x) => x.url.endsWith("/comments"))).toHaveLength(1);
    expect(calls.filter((x) => x.url.endsWith("/messages"))).toHaveLength(1);
    expect(q.get<Row>("SELECT * FROM nurture_lead WHERE comment_id = ?", again.id)).toMatchObject({ stage: "replied", next_check_at: null });
    expect(byId<Row>("nurture_lead", q.get<Row>("SELECT id FROM nurture_lead WHERE comment_id = ?", again.id)!.id)!.meta).toMatchObject({ repeat: true, previousLeadId: leadId });
    expect(byId<Row>("conversation", leadPsidConv)!.ext.nurtureLeadId).toBe(leadId);
    // Chạy lại job (thử lại sau lỗi) → không gửi trùng
    mockFetch(() => ({}));
    expect(await processNurtureComment(B, c.id, NOW)).toMatchObject({ stage: "asked_contact" });
    expect(await processNurtureComment(B, again.id, NOW)).toMatchObject({ stage: "replied" });
    expect(calls).toHaveLength(0);
  });

  it("dừng khẩn cấp chat / giờ yên lặng → hoãn, không gọi Facebook; spam/tiêu cực → bỏ qua", async () => {
    const p = livePost();
    mockFetch(() => ({ id: "x", recipient_id: "P", message_id: "m" }));
    setBiz({ killSwitch: { ...DEFAULT_SETTINGS.killSwitch, chat: true } });
    const c1 = comment(p.id);
    expect(await processNurtureComment(B, c1.id, NOW)).toMatchObject({ deferred: expect.stringMatching(/dừng khẩn cấp/) });
    setBiz({ killSwitch: DEFAULT_SETTINGS.killSwitch, quietHours: [0, 24] });
    // Mặc định (replyAllDay) trả lời CẢ BAN ĐÊM; chỉ khi Sếp tắt replyAllDay thì giờ yên lặng mới hoãn.
    expect(nurtureSettings(B).replyAllDay).toBe(true);
    saveNurtureSettings(B, { replyAllDay: false }, "CEO");
    const c2 = comment(p.id);
    expect(await processNurtureComment(B, c2.id, NOW)).toMatchObject({ deferred: expect.stringMatching(/yên lặng/) });
    saveNurtureSettings(B, { replyAllDay: true }, "CEO");
    setBiz({ quietHours: [0, 0] });
    expect(calls).toHaveLength(0);
    expect(q.get<Row>("SELECT stage, last_error FROM nurture_lead WHERE comment_id = ?", c2.id)).toMatchObject({ stage: "new", last_error: expect.stringMatching(/yên lặng/) });
    const spam = comment(p.id, { label: "spam", hidden: 1 });
    const neg = comment(p.id, { label: "negative" });
    expect(await processNurtureComment(B, spam.id, NOW)).toMatchObject({ skipped: "label" });
    expect(await processNurtureComment(B, neg.id, NOW)).toMatchObject({ skipped: "label" });
    expect(calls).toHaveLength(0);
    // Hết hoãn → nurture.tick chạy tiếp
    const t = await nurtureTick(B, new Date(Date.now() + 26 * 3600_000));
    expect(t.started).toBeGreaterThanOrEqual(2);
  });

  it("hạn mức inbox/ngày theo Trang: đủ thì chỉ trả lời công khai, inbox để mai", async () => {
    const used = q.scalar<number>("SELECT COUNT(*) FROM nurture_lead WHERE channel_id = ? AND dm_sent_at IS NOT NULL", liveCh.id);
    saveNurtureSettings(B, { maxPrivateRepliesPerDay: used }, "test");
    const p = livePost();
    const c = comment(p.id);
    mockFetch(() => ({ id: "r" }));
    expect(await processNurtureComment(B, c.id, NOW)).toMatchObject({ deferred: "dm_cap" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(new RegExp(`/${c.external_id}/comments$`));
    saveNurtureSettings(B, { maxPrivateRepliesPerDay: 50 }, "test");
  });

  it("khách trả lời inbox kèm SĐT → lưu mã hoá + che, xác nhận trong Messenger, lên lịch kết bạn; SĐT không lọt ra model/nhật ký", async () => {
    mockFetch(() => ({ recipient_id: "PSID5", message_id: "mid.2" }));
    // Tin đầu chưa có SĐT → bot trả lời bình thường (SĐT trong lịch sử phải bị che khi gửi model)
    await handleIncoming(B, { channel: "messenger", externalConversationId: "PSID5", customerName: "Nguyễn Thị Lan", text: "Ship về Đà Nẵng được không shop", messageId: "m.a", pageExternalId: "PAGE1" });
    expect(q.get<Row>("SELECT customer_replied_at FROM nurture_lead WHERE id = ?", leadId)!.customer_replied_at).toBeTruthy();
    calls = [];
    const r = await handleIncoming(B, { channel: "messenger", externalConversationId: "PSID5", customerName: "Nguyễn Thị Lan", text: "zalo của mình 0912 345 678 nhé", messageId: "m.b", pageExternalId: "PAGE1" });
    expect(r.replied).toBe(true);
    const lead = byId<Row>("nurture_lead", leadId)!;
    expect(lead).toMatchObject({ stage: "has_phone", phone_masked: "0912***678" });
    expect(decryptSecret(lead.phone_cipher)).toBe("0912345678");
    // Sổ khách (bảng lead) giữ số thật để Sếp gọi lại; nhật ký / audit chỉ có số đã che
    expect(q.get<Row>("SELECT phone FROM lead WHERE conversation_id = ?", leadPsidConv)!.phone).toBe("0912345678"); // sổ khách của Sếp giữ số thật để gọi lại
    const last = q.get<Row>("SELECT body, meta FROM message WHERE conversation_id = ? AND direction = 'out' ORDER BY sent_at DESC LIMIT 1", leadPsidConv)!;
    expect(last.meta.kind).toBe("nurture_confirm");
    expect(last.body.text).toMatch(/đã nhận SĐT.*Zalo/);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(form(calls[0]).get("recipient")!)).toEqual({ id: "PSID5" }); // tin trả lời trong cửa sổ 24h → theo PSID
    expect(q.get("SELECT id FROM job WHERE name = 'nurture.zalo_friend' AND idempotency_key = ?", `nurture:friend:${leadId}`)).toBeTruthy();
    // PII: không có số thật trong audit / nhật ký lead / bộ chấm Jev
    for (const a of q.all<Row>("SELECT data FROM audit_log WHERE biz_id = ?", B)) expect(JSON.stringify(a.data)).not.toContain("912345678");
    expect(JSON.stringify(lead.log)).not.toContain("912345678");
    for (const j of q.all<Row>("SELECT state FROM jev_judgment WHERE biz_id = ?", B)) expect(JSON.stringify(j.state)).not.toMatch(/0912\s?345\s?678/);
  });

  it("kết bạn Zalo qua ZL-CRM: tìm theo SĐT rồi gửi lời mời kèm lời chào; giới hạn lời mời/nick/ngày", async () => {
    insert("connection", { biz_id: B, platform: "zlcrm", external_account_id: "http://zl.test", token_ciphertext: encryptSecret(JSON.stringify({ api_key: "zl_key" })), status: "active", mode: "live", config: { base_url: "http://zl.test", accounts: [{ id: "nick1", name: "Nick Shop", status: "connected" }] } });
    mockFetch((url) => (url.includes("lookup-by-phone") ? { found: true, uid: "zuid1", zaloName: "Lan" } : url.includes("/friends/request") ? { sent: true, uid: "zuid1" } : {}));
    const later = new Date(Date.now() + 3600_000);
    const r = await tryFriendRequest(B, leadId, { now: later });
    expect(r).toMatchObject({ stage: "friend_requested" });
    expect(calls.map((c) => c.url)).toEqual(["http://zl.test/api/public/friends/lookup-by-phone", "http://zl.test/api/public/friends/request"]);
    expect(JSON.parse(calls[0].body)).toEqual({ zaloAccountId: "nick1", phone: "0912345678" });
    const req = JSON.parse(calls[1].body);
    expect(req).toMatchObject({ zaloAccountId: "nick1", userId: "zuid1" });
    expect(req.message).toMatch(/kết bạn/);
    expect(calls[1].headers["x-api-key"]).toBe("zl_key");
    expect(byId<Row>("nurture_lead", leadId)).toMatchObject({ stage: "friend_requested", zalo_account_id: "nick1", zalo_uid: "zuid1" });

    // Nick đã đủ lời mời hôm nay → khách khác phải chờ mai (tự động: hoãn; bấm tay: báo lỗi)
    saveNurtureSettings(B, { maxFriendRequestsPerNickPerDay: 1 }, "test");
    const other = await (async () => { const p = livePost(); const c = comment(p.id); mockFetch((u) => (u.includes("/messages") ? { recipient_id: "PSID9", message_id: "m9" } : { id: "r9" })); await processNurtureComment(B, c.id, NOW); return q.get<Row>("SELECT * FROM nurture_lead WHERE comment_id = ?", c.id)!; })();
    setPhoneManual(B, other.id, "0987 654 321", "CEO");
    mockFetch(() => ({ found: true, uid: "zuid2" }));
    expect(await tryFriendRequest(B, other.id, { now: later })).toMatchObject({ deferred: "cap" });
    await expect(tryFriendRequest(B, other.id, { force: true })).rejects.toThrow(/đủ 1 lời mời/);
    expect(calls).toHaveLength(0);
    saveNurtureSettings(B, { maxFriendRequestsPerNickPerDay: 20 }, "test");
  });

  it("khách đồng ý kết bạn → hội thoại Zalo đúng nick + follow_up_plan (follow-up Zalo sẵn có)", async () => {
    mockFetch((url) => (url.includes("/friends/status") ? { isFriend: true, status: "accepted" } : {}));
    const lead = byId<Row>("nurture_lead", leadId)!;
    expect(await checkFriendAccepted(B, lead)).toBe(true);
    expect(calls[0].url).toBe("http://zl.test/api/public/friends/status?zaloAccountId=nick1&userId=zuid1");
    const fresh = byId<Row>("nurture_lead", leadId)!;
    expect(fresh).toMatchObject({ stage: "following_up" });
    const zconv = byId<Row>("conversation", fresh.zalo_conversation_id)!;
    expect(zconv).toMatchObject({ channel: "zalo", external_id: "zlu:nick1:zuid1", state: "awaiting_customer" });
    expect(zconv.ext).toMatchObject({ zaloAccountId: "nick1", threadId: "zuid1", threadType: "user" });
    const plan = q.get<Row>("SELECT * FROM follow_up_plan WHERE conversation_id = ?", zconv.id)!;
    expect(plan).toMatchObject({ status: "active", template: "zalo_followup" });
    expect(q.get<Row>("SELECT phone FROM lead WHERE conversation_id = ?", zconv.id)!.phone).toBe("0912345678"); // sổ khách giữ số thật (chỉ lưu trên máy)
    for (const a of q.all<Row>("SELECT data FROM audit_log WHERE biz_id = ?", B)) expect(JSON.stringify(a.data)).not.toContain("912345678");
  });
});

describe("mặc định an toàn", () => {
  it("doanh nghiệp mới: chăm khách từ bình luận TẮT cho tới khi Sếp bật; lịch quét/chăm 15 giây, nâng cấp lịch cũ 5 phút, giữ nguyên bật/tắt", () => {
    const fresh = insert("biz", { name: "Shop mới", settings: { ...DEFAULT_SETTINGS } }).id;
    expect(nurtureSettings(fresh).enabled).toBe(false);
    ensureBizSchedules(fresh);
    const sch = (name: string, biz = fresh) => q.get<Row>("SELECT * FROM schedule WHERE biz_id = ? AND name = ?", biz, name)!;
    expect(sch("nurture.poll")).toMatchObject({ every_minutes: 0.25, enabled: 1 });
    expect(sch("nurture.tick")).toMatchObject({ every_minutes: 0.25, enabled: 1 });
    // Bản cũ: 5 phút, Sếp đã tắt tick → lên 15 giây nhưng KHÔNG bật lại
    q.run("UPDATE schedule SET every_minutes = 5, enabled = 0 WHERE biz_id = ? AND name = 'nurture.tick'", fresh);
    q.run("UPDATE schedule SET every_minutes = 5 WHERE biz_id = ? AND name = 'nurture.poll'", fresh);
    ensureBizSchedules(fresh);
    expect(sch("nurture.tick")).toMatchObject({ every_minutes: 0.25, enabled: 0 });
    expect(sch("nurture.poll")).toMatchObject({ every_minutes: 0.25 });
    ensureBizSchedules(fresh);
    expect(sch("nurture.poll").every_minutes).toBe(0.25);
  });
});

describe("không nhắn trùng khi 2 lượt chạy cùng lúc", () => {
  it("job hàng đợi + quét định kỳ cùng xử lý 1 bình luận → chỉ 1 trả lời + 1 inbox", async () => {
    const t = liveBiz();
    const c = t.cmt(t.post().id, { author: "Lan Anh" });
    mockFetch(fbOk);
    const runs = await Promise.all([processNurtureComment(t.biz, c.id), processNurtureComment(t.biz, c.id), processNurtureComment(t.biz, c.id)]);
    expect(runs.filter((r: any) => r.stage === "asked_contact" && r.conversationId)).toHaveLength(1);
    const lead = q.get<Row>("SELECT * FROM nurture_lead WHERE comment_id = ?", c.id)!;
    expect(calls.filter((x) => x.url.endsWith("/messages"))).toHaveLength(1);
    expect(calls.filter((x) => x.url.endsWith("/comments"))).toHaveLength(1);
    expect(q.scalar<number>("SELECT COUNT(*) FROM message WHERE conversation_id = ? AND json_extract(meta, '$.kind') = 'nurture_dm'", lead.conversation_id)).toBe(1);
    expect(q.scalar<number>("SELECT COUNT(*) FROM audit_log WHERE event = 'nurture.dm_sent' AND ref_id = ?", lead.id)).toBe(1);
    expect(q.scalar<number>("SELECT COUNT(*) FROM nurture_lead WHERE post_id = ?", lead.post_id)).toBe(1);
  });
});

// ---------------- Hồi quy: các lỗi review (lead kẹt, gửi không rõ kết quả, chạy chồng, tuổi bình luận, tắt giữa chừng…) ----------------
let bizN = 0;
/** Doanh nghiệp riêng có Trang Facebook kết nối thật (fetch giả) — tách khỏi dữ liệu các test khác. */
function liveBiz(nurture: Row = {}) {
  const biz = insert("biz", { name: `Shop ${++bizN}`, settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" }, nurture: { enabled: true, ...nurture } } }).id;
  const conn = insert("connection", { biz_id: biz, platform: "meta", external_account_id: `u${bizN}`, token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
  const ch = insert("channel", { biz_id: biz, platform: "facebook", kind: "page", name: "Trang", external_id: `PG${bizN}`, connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
  const post = (extra: Row = {}) => insert("post", { biz_id: biz, channel_id: ch.id, external_id: `PG${bizN}_${++n}`, content_item_id: null, kind: "image", title: "Bài", body: "x", published_at: new Date().toISOString(), permalink: null, ad_status: "none", ...extra });
  const cmt = (postId: string, extra: Row = {}) => insert("post_comment", { biz_id: biz, post_id: postId, author: "Phạm Thu Trang", author_external_id: `A${++n}`, external_id: `x${n}`, text: "Giá sao shop", label: "purchase_intent", hidden: 0, source: "webhook", ...extra });
  const zl = () => insert("connection", { biz_id: biz, platform: "zlcrm", external_account_id: "http://zl.test", token_ciphertext: encryptSecret(JSON.stringify({ api_key: "k" })), status: "active", mode: "live", config: { base_url: "http://zl.test", accounts: [{ id: "nickA", name: "Nick A", status: "connected" }] } });
  return { biz, ch, post, cmt, zl };
}
const fbOk = (url: string) => (url.includes("/messages") ? { recipient_id: `PSID_${++n}`, message_id: `mid.${n}` } : { id: `r_${n}` });
const timeout = () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); };
const dropped = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } }); };
const refused = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const leadOf = (commentId: string) => q.get<Row>("SELECT * FROM nurture_lead WHERE comment_id = ?", commentId)!;
/** Lead có SĐT, sẵn sàng kết bạn (đến hạn ngay). */
async function leadWithPhone(t: ReturnType<typeof liveBiz>, phone = "0901 234 567") {
  const c = t.cmt(t.post().id);
  mockFetch(fbOk);
  await processNurtureComment(t.biz, c.id, NOW);
  const l = leadOf(c.id);
  setPhoneManual(t.biz, l.id, phone, "CEO");
  update("nurture_lead", l.id, { next_check_at: ago(60_000) });
  return l.id;
}

describe("1) lead kẹt sau khi tiến trình chết giữa chừng", () => {
  it("giữ chỗ inbox > 15 phút → needs_check (không gửi lại); giữ chỗ mới → dời lịch; tick không bị lead kẹt chặn", async () => {
    const t = liveBiz();
    const p = t.post();
    const mkLead = (c: Row, extra: Row) => insert("nurture_lead", { biz_id: t.biz, post_id: p.id, comment_id: c.id, channel_id: t.ch.id, author_name: c.author, author_external_id: c.author_external_id,
      comment_text: c.text, label: c.label, stage: "new", log: [], meta: {}, ...extra });
    const stuck = (claimAgoMs: number, i: number) => {
      const c = t.cmt(p.id, { replied_at: ago(claimAgoMs), dm_sent_at: ago(claimAgoMs) });
      mkLead(c, { public_replied_at: ago(claimAgoMs), dm_claimed_at: ago(claimAgoMs), next_check_at: ago(3600_000), created_at: ago(7200_000 - i) });
      return c;
    };
    const old = stuck(20 * 60_000, 0);
    const fresh = Array.from({ length: 40 }, (_, i) => stuck(2 * 60_000, i + 1));
    const normal = t.cmt(p.id);
    mkLead(normal, { next_check_at: ago(60_000) }); // lead mới, đến hạn sau cùng

    mockFetch(fbOk);
    await nurtureTick(t.biz, new Date());
    expect(leadOf(old.id)).toMatchObject({ stage: "needs_check" });
    expect(JSON.stringify(leadOf(old.id).log)).toMatch(/Không chắc đã nhắn inbox/);
    const sentFor = (c: Row) => calls.filter((x) => x.url.includes(`/${c.external_id}/`) || x.body.includes(String(c.external_id)));
    for (const c of [old, ...fresh]) expect(sentFor(c)).toHaveLength(0);
    for (const c of fresh) {
      const l = leadOf(c.id);
      expect(l.stage).toBe("new");
      if (l.next_check_at > new Date(Date.now() - 1800_000).toISOString()) expect(new Date(l.next_check_at).getTime()).toBeGreaterThan(Date.now());
    }
    // Lượt sau: lead kẹt đã được dời lịch → lead mới không bị bỏ đói
    await nurtureTick(t.biz, new Date());
    expect(leadOf(normal.id)).toMatchObject({ stage: "asked_contact" });
    expect(calls.filter((c) => c.url.endsWith("/messages"))).toHaveLength(1);
    for (const c of [old, ...fresh]) expect(sentFor(c)).toHaveLength(0);
    expect(q.scalar<number>("SELECT COUNT(*) FROM nurture_lead WHERE biz_id = ? AND stage = 'new'", t.biz)).toBe(40);
    expect(listNurtureLeads(t.biz, { stage: "needs_check" })).toHaveLength(1);
    expect(nurtureFunnel(t.biz).needsCheck).toBe(1);
  });
});

describe("2) gửi lỗi không rõ kết quả", () => {
  it("Private Reply hết thời gian chờ → giữ chỗ, needs_check, KHÔNG tự gửi lại; Sếp bấm gửi lại thì mới gửi", async () => {
    const t = liveBiz();
    const c = t.cmt(t.post().id);
    mockFetch((url) => (url.endsWith("/messages") ? timeout() : { id: "r1" }));
    expect(await processNurtureComment(t.biz, c.id, NOW)).toMatchObject({ stage: "needs_check" });
    expect(byId<Row>("post_comment", c.id)!.dm_sent_at).toBeTruthy(); // giữ chỗ
    expect(leadOf(c.id)).toMatchObject({ stage: "needs_check", public_replied_at: expect.any(String) });
    mockFetch(fbOk);
    await processNurtureComment(t.biz, c.id, NOW);
    await nurtureTick(t.biz, new Date(Date.now() + 3600_000));
    expect(calls).toHaveLength(0);
    // Sếp kiểm tra trên Facebook thấy chưa có → gửi lại: chỉ inbox, không trả lời công khai lần 2
    expect(await resendDm(t.biz, leadOf(c.id).id, "CEO")).toMatchObject({ stage: "asked_contact" });
    expect(calls.map((x) => x.url.split("/").pop())).toEqual(["messages"]);
  });

  it("trả lời công khai lỗi 5xx → needs_check, không nhắn inbox, không trả lời lại", async () => {
    const t = liveBiz();
    const c = t.cmt(t.post().id);
    mockFetch((url) => (url.endsWith("/comments") ? new Response("{}", { status: 502 }) : fbOk(url)));
    expect(await processNurtureComment(t.biz, c.id, NOW)).toMatchObject({ stage: "needs_check" });
    expect(calls).toHaveLength(1);
    expect(byId<Row>("post_comment", c.id)!.replied_at).toBeTruthy();
    mockFetch(fbOk);
    await nurtureTick(t.biz, new Date(Date.now() + 3600_000));
    expect(calls).toHaveLength(0);
  });

  it("không kết nối được (chắc chắn chưa gửi) → nhả chỗ, lần sau gửi đúng 1 lần", async () => {
    const t = liveBiz();
    const c = t.cmt(t.post().id);
    mockFetch((url) => (url.endsWith("/messages") ? refused() : { id: "r1" }));
    await expect(processNurtureComment(t.biz, c.id, NOW)).rejects.toThrow(/không nhận được phản hồi/);
    expect(byId<Row>("post_comment", c.id)!.dm_sent_at).toBeNull();
    expect(leadOf(c.id)).toMatchObject({ stage: "new", dm_claimed_at: null });
    expect(new Date(leadOf(c.id).next_check_at).getTime()).toBeGreaterThan(NOW.getTime());
    mockFetch(fbOk);
    expect(await processNurtureComment(t.biz, c.id, NOW)).toMatchObject({ stage: "asked_contact" });
    expect(calls.map((x) => x.url.split("/").pop())).toEqual(["messages"]); // đã trả lời công khai rồi → chỉ inbox
  });
});

describe("3) không gửi trùng khi 2 lượt chạy cùng lúc", () => {
  it("job kết bạn + tick / 2 lượt cùng lúc → đúng 1 lần tra SĐT + 1 lời mời", async () => {
    const t = liveBiz();
    t.zl();
    const id = await leadWithPhone(t);
    mockFetch((url) => (url.includes("lookup-by-phone") ? { found: true, uid: "zu1" } : url.includes("/friends/request") ? { sent: true, uid: "zu1" } : {}));
    const later = new Date(Date.now() + 3600_000);
    await Promise.all([tryFriendRequest(t.biz, id, { now: later }), tryFriendRequest(t.biz, id, { now: later }), nurtureTick(t.biz, later)]);
    expect(calls.filter((c) => c.url.includes("lookup-by-phone"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("/friends/request"))).toHaveLength(1);
    expect(byId<Row>("nurture_lead", id)).toMatchObject({ stage: "friend_requested", zalo_uid: "zu1" });
  });

  it("nhắc xin SĐT: 2 lượt cùng lúc / tick định kỳ + 'Chạy ngay' chồng nhau → chỉ 1 lời nhắc", async () => {
    const t = liveBiz();
    const c = t.cmt(t.post().id);
    mockFetch(fbOk);
    await processNurtureComment(t.biz, c.id, NOW);
    const l = leadOf(c.id);
    insert("message", { biz_id: t.biz, conversation_id: l.conversation_id, direction: "in", sender: "customer", body: { text: "ship không shop" }, meta: {}, sent_at: ago(5 * 3600_000) });
    insert("message", { biz_id: t.biz, conversation_id: l.conversation_id, direction: "out", sender: "bot", body: { text: "dạ có ạ" }, meta: {}, sent_at: ago(4.9 * 3600_000) });
    mockFetch(fbOk);
    const s = nurtureSettings(t.biz);
    await Promise.all([maybeRemind(t.biz, { ...l }, s, new Date()), maybeRemind(t.biz, { ...l }, s, new Date())]);
    expect(calls.filter((x) => x.url.endsWith("/messages"))).toHaveLength(1);
    // Tick chồng nhau: lượt thứ 2 thấy đang chạy → bỏ qua
    const [a, b] = await Promise.all([nurtureTick(t.biz, new Date()), nurtureTick(t.biz, new Date())]);
    expect([a.busy, b.busy].filter(Boolean)).toHaveLength(1);
    expect(calls.filter((x) => x.url.endsWith("/messages"))).toHaveLength(1);
    expect(q.scalar<number>("SELECT COUNT(*) FROM message WHERE conversation_id = ? AND json_extract(meta, '$.kind') = 'nurture_reminder'", l.conversation_id)).toBe(1);
  });
});

describe("0) Trang chưa có bài nào trong hệ thống", () => {
  it("quét thủ công khi chăm tự động tắt: lưu và phân loại bình luận, không tạo lead hay gửi tin", async () => {
    const t = liveBiz();
    saveNurtureSettings(t.biz, { enabled: false }, "test");
    const pageId = String(t.ch.external_id);
    mockFetch((url) => url.includes(`/${pageId}/posts`) ? { data: [{ id: `${pageId}_scan`, message: "Bài thật", created_time: ago(3600_000) }] }
      : url.includes("/comments") ? { data: [{ id: `${pageId}_comment`, from: { id: "scan-user", name: "Khách quét" }, message: "Giá bao nhiêu shop?", created_time: ago(60000) }] } : { data: [] });
    expect(await pollBizComments(t.biz)).toMatchObject({ posts: 0, added: 0, skipped: expect.any(String) });
    expect(calls).toHaveLength(0);
    expect(await pollBizComments(t.biz, { full: true, scanOnly: true })).toMatchObject({ posts: 1, added: 1, errors: [] });
    const job = q.get<Row>("SELECT * FROM job WHERE biz_id = ? AND name = 'nurture.classify'", t.biz)!;
    expect(job.payload.scanOnly).toBe(true);
    // Even if the switch changes before classification, this scan remains collection-only.
    saveNurtureSettings(t.biz, { enabled: true }, "test");
    await HANDLERS["nurture.classify"](job.payload, job);
    expect(q.get<Row>("SELECT label FROM post_comment WHERE biz_id = ?", t.biz)!.label).toBeTruthy();
    expect(q.scalar<number>("SELECT COUNT(*) FROM nurture_lead WHERE biz_id = ?", t.biz)).toBe(0);
    expect(q.scalar<number>("SELECT COUNT(*) FROM job WHERE biz_id = ? AND name = 'nurture.comment'", t.biz)).toBe(0);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    // A later automatic run after the user enables replies picks up collected comments without needing another comment.
    await pollBizComments(t.biz, { full: true });
    expect(q.scalar<number>("SELECT COUNT(*) FROM job WHERE biz_id = ? AND name = 'nurture.comment'", t.biz)).toBe(1);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("quét tự nhập bài đăng gần đây của Trang (kể cả đăng tay) rồi đọc bình luận — trước đây 0 bài = không bao giờ thấy bình luận", async () => {
    const t = liveBiz();
    expect(q.scalar<number>("SELECT COUNT(*) FROM post WHERE biz_id = ?", t.biz)).toBe(0);
    const pageId = String(t.ch.external_id);
    mockFetch((url) => {
      if (url.includes(`/${pageId}/posts`)) {
        const since = Number(new URL(url).searchParams.get("since") ?? 0) * 1000; // Graph chỉ trả bài từ mốc `since`
        return { data: [
          { id: `${pageId}_p1`, message: "Bài đăng tay hôm nay", created_time: ago(2 * 3600_000), permalink_url: "https://facebook.com/p1" },
          { id: `${pageId}_p0`, message: "Bài cũ 20 ngày", created_time: ago(20 * 24 * 3600_000) },
        ].filter((p) => new Date(p.created_time).getTime() >= since) };
      }
      return url.includes("/comments") ? { data: [{ id: "c1", from: { id: "F9", name: "Khách A" }, message: "Giá bao nhiêu shop", created_time: ago(60_000) }] } : {};
    });
    const r = await pollBizComments(t.biz);
    expect(calls.some((c) => c.url.includes(`${pageId}/posts`))).toBe(true);
    expect(r).toMatchObject({ posts: 1, added: 1 }); // chỉ bài ≤14 ngày; bình luận mới được lưu
    expect(q.all<Row>("SELECT external_id, permalink FROM post WHERE biz_id = ?", t.biz)).toEqual([{ external_id: `${pageId}_p1`, permalink: "https://facebook.com/p1" }]);
    expect(q.scalar<number>("SELECT COUNT(*) FROM post_comment WHERE biz_id = ?", t.biz)).toBe(1);
  });

  it("quét 2 tầng: lượt nhanh = 1 lệnh gộp/Trang (không gọi riêng từng bài); đủ 14 ngày 5 phút/lần hoặc khi bấm 'Quét ngay' (full)", async () => {
    const t = liveBiz();
    const hot = t.post({ published_at: ago(2 * 3600_000) });
    const old = t.post({ published_at: ago(6 * 24 * 3600_000) });
    const commentsFor = (u: string) => calls.filter((c) => c.method === "GET" && c.url.includes(`/${u}/comments`)).length;
    const fastCalls = () => calls.filter((c) => c.method === "GET" && c.url.includes(`/${t.ch.external_id}/posts`) && c.url.includes("comments"));
    mockFetch(() => ({ data: [] }));
    expect(await pollBizComments(t.biz)).toMatchObject({ posts: 2 }); // lượt đầu = quét đủ (chưa có mốc)
    expect(commentsFor(String(old.external_id))).toBe(1);
    // Lượt kế (ngay sau đó): MỘT lệnh gộp lấy bình luận của các bài mới nhất; bình luận mới được nhập luôn
    mockFetch(() => ({ data: [
      { id: String(hot.external_id), message: "bài", created_time: ago(2 * 3600_000), comments: { summary: { total_count: 1 }, data: [
        { id: `${hot.external_id}_fast1`, from: { id: "FQ1", name: "Khách Nhanh" }, message: "Giá bao nhiêu shop", created_time: ago(5_000) },
      ] } },
    ] }));
    expect(await pollBizComments(t.biz)).toMatchObject({ posts: 1, added: 1 });
    expect(fastCalls()).toHaveLength(1);
    expect(commentsFor(String(hot.external_id))).toBe(0); // KHÔNG gọi riêng từng bài
    expect(commentsFor(String(old.external_id))).toBe(0);
    expect(q.get<Row>("SELECT text FROM post_comment WHERE external_id = ?", `${hot.external_id}_fast1`)).toMatchObject({ text: "Giá bao nhiêu shop" });
    mockFetch(() => ({ data: [] }));
    expect(await pollBizComments(t.biz, { full: true })).toMatchObject({ posts: 2 }); // "Quét ngay"
    expect(commentsFor(String(old.external_id))).toBe(1);
  });

  it("lệnh gộp lỗi → quét kiểu cũ (riêng từng bài nóng) ngay lượt đó, không bỏ sót; bài mới Sếp đăng ngoài hệ thống được nhập luôn", async () => {
    const t = liveBiz();
    const hot = t.post({ published_at: ago(2 * 3600_000) });
    await pollBizComments(t.biz); // lượt đầu (đủ) để lượt sau là lượt nhanh
    const commentsFor = (u: string) => calls.filter((c) => c.method === "GET" && c.url.includes(`/${u}/comments`)).length;
    mockFetch((url) => (url.includes(`/${t.ch.external_id}/posts`) ? new Response(JSON.stringify({ error: { message: "boom", code: 2 } }), { status: 500 }) : { data: [] }));
    const r = await pollBizComments(t.biz);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(commentsFor(String(hot.external_id))).toBe(1); // dự phòng kiểu cũ
    // Bài Sếp đăng tay trên Fanpage xuất hiện ở lệnh gộp → có bản ghi bài + bình luận
    mockFetch(() => ({ data: [{ id: `${t.ch.external_id}_manual1`, message: "Bài đăng tay", created_time: ago(60_000), comments: { data: [{ id: "mc1", from: { id: "FM", name: "Khách A" }, message: "inbox giá nhé", created_time: ago(10_000) }] } }] }));
    expect(await pollBizComments(t.biz)).toMatchObject({ posts: 1, added: 1 });
    expect(q.get<Row>("SELECT id FROM post WHERE external_id = ?", `${t.ch.external_id}_manual1`)).toBeTruthy();
  });

  it("thiếu quyền đọc bài của 1 Trang → ghi log, không làm hỏng lượt quét", async () => {
    const t = liveBiz();
    mockFetch(() => new Response(JSON.stringify({ error: { message: "(#10) Requires pages_read_engagement", code: 10 } }), { status: 403 }));
    await expect(pollBizComments(t.biz)).resolves.toMatchObject({ posts: 0, added: 0, errors: [expect.stringContaining(t.ch.name)] });
  });
});

describe("4) tuổi bình luận theo giờ Facebook", () => {
  it("quét bù khi mới bật: lưu created_time của Facebook; bình luận > 24 giờ → bỏ qua (bình luận cũ), không trả lời", async () => {
    const t = liveBiz();
    const p = t.post({ published_at: ago(10 * 24 * 3600_000) });
    mockFetch(() => ({ data: [
      { id: `${p.external_id}_old`, from: { id: "F1", name: "Lê Văn A" }, message: "Giá bao nhiêu shop", created_time: ago(3 * 24 * 3600_000) },
      { id: `${p.external_id}_new`, from: { id: "F2", name: "Lê Văn B" }, message: "Giá bao nhiêu shop", created_time: ago(10 * 60_000) },
    ] }));
    expect(await pollPostComments(p)).toBe(2);
    expect(decodeURIComponent(calls[0].url)).toMatch(/fields=[^&]*created_time/);
    const old = q.get<Row>("SELECT * FROM post_comment WHERE external_id = ?", `${p.external_id}_old`)!;
    const fresh = q.get<Row>("SELECT * FROM post_comment WHERE external_id = ?", `${p.external_id}_new`)!;
    expect(new Date(old.external_created_at).getTime()).toBeLessThan(Date.now() - 2 * 24 * 3600_000);
    q.run("UPDATE post_comment SET label = 'purchase_intent' WHERE id IN (?, ?)", old.id, fresh.id);
    mockFetch(fbOk);
    expect(await processNurtureComment(t.biz, old.id)).toMatchObject({ skipped: "old_comment" });
    expect(leadOf(old.id)).toMatchObject({ stage: "skipped" });
    expect(JSON.stringify(leadOf(old.id).log)).toMatch(/Bình luận cũ/);
    expect(calls).toHaveLength(0);
    expect(await processNurtureComment(t.biz, fresh.id)).toMatchObject({ stage: "asked_contact" });
  });

  it("lead hoãn lâu, bình luận đã quá 7 ngày theo Facebook → bỏ cả trả lời công khai lẫn inbox", async () => {
    const t = liveBiz();
    const c = t.cmt(t.post().id);
    saveNurtureSettings(t.biz, { replyAllDay: false }, "CEO"); // cần giờ yên lặng thật để lead nằm chờ lâu
    const tb = byId<Row>("biz", t.biz)!;
    update("biz", t.biz, { settings: { ...tb.settings, quietHours: [0, 24] } });
    await processNurtureComment(t.biz, c.id, new Date());
    expect(leadOf(c.id).stage).toBe("new");
    update("biz", t.biz, { settings: { ...tb.settings, quietHours: [0, 0] } });
    q.run("UPDATE post_comment SET external_created_at = ? WHERE id = ?", ago(8 * 24 * 3600_000), c.id);
    mockFetch(fbOk);
    await nurtureTick(t.biz, new Date(Date.now() + 26 * 3600_000));
    expect(calls).toHaveLength(0);
    expect(leadOf(c.id)).toMatchObject({ stage: "skipped", public_replied_at: null });
  });
});

describe("5) tắt chăm khách giữa chừng", () => {
  it("job kết bạn / tin có SĐT đã xếp trước đó → không làm gì", async () => {
    const t = liveBiz();
    t.zl();
    const id = await leadWithPhone(t);
    const c2 = t.cmt(t.post().id);
    mockFetch(fbOk);
    await processNurtureComment(t.biz, c2.id, NOW);
    const l2 = leadOf(c2.id);
    const conv = byId<Row>("conversation", l2.conversation_id)!;
    saveNurtureSettings(t.biz, { enabled: false }, "CEO");
    mockFetch(() => ({ found: true, uid: "zz", sent: true, recipient_id: conv.external_id, message_id: "m" }));
    await HANDLERS["nurture.zalo_friend"]({ leadId: id }, { biz_id: t.biz } as Row);
    expect(byId<Row>("nurture_lead", id)!.stage).toBe("has_phone");
    await handleIncoming(t.biz, { channel: "messenger", externalConversationId: conv.external_id, customerName: conv.customer_name, text: "sđt em 0977 111 222", messageId: `m.off.${n}`, pageExternalId: t.ch.external_id });
    expect(leadOf(c2.id)).toMatchObject({ stage: "asked_contact", phone_cipher: null });
    expect(JSON.stringify(leadOf(c2.id).log)).toMatch(/đang tắt chăm khách/);
    expect(calls.filter((x) => x.url.includes("zl.test"))).toHaveLength(0);
    expect(q.get("SELECT id FROM message WHERE conversation_id = ? AND json_extract(meta, '$.kind') = 'nurture_confirm'", conv.id)).toBeUndefined();
  });
});

describe("6–7) người bình luận nhiều lần — MỌI bình luận đều được trả lời + inbox", () => {
  it("cùng người (id Facebook) bình luận ở bài khác → vẫn trả lời công khai + inbox, không lặp xin SĐT", async () => {
    const t = liveBiz();
    const a = t.cmt(t.post().id, { author_external_id: "SAME1" });
    mockFetch(fbOk);
    expect(await processNurtureComment(t.biz, a.id, NOW)).toMatchObject({ stage: "asked_contact" });
    const b = t.cmt(t.post().id, { author_external_id: "SAME1" });
    mockFetch(fbOk);
    expect(await processNurtureComment(t.biz, b.id, NOW)).toMatchObject({ stage: "replied" });
    expect(calls.filter((c) => c.url.endsWith("/comments"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/messages"))).toHaveLength(1);
    expect(leadOf(b.id)).toMatchObject({ stage: "replied", next_check_at: null, public_replied_at: expect.any(String), dm_sent_at: expect.any(String) });
    expect(JSON.stringify(leadOf(b.id).log)).toMatch(/đã được chăm trước đó/);
  });

  it("một người bình luận 6 lần liên tiếp → cả 6 bình luận đều được trả lời + inbox (không bị chặn bởi chống trùng người)", async () => {
    const t = liveBiz();
    const p = t.post();
    mockFetch(fbOk);
    for (let i = 0; i < 6; i++) {
      const c = t.cmt(p.id, { author_external_id: "SPAMMER-OK", label: ["purchase_intent", "question", "praise"][i % 3] });
      const r = await processNurtureComment(t.biz, c.id, NOW);
      expect(r, `lần ${i + 1}`).toMatchObject({ stage: i === 0 ? "asked_contact" : "replied" });
    }
    expect(calls.filter((c) => c.url.endsWith("/comments"))).toHaveLength(6);
    expect(calls.filter((c) => c.url.endsWith("/messages"))).toHaveLength(6);
    expect(q.scalar<number>("SELECT COUNT(*) FROM nurture_lead WHERE biz_id = ? AND author_external_id = 'SPAMMER-OK' AND stage = 'skipped'", t.biz)).toBe(0);
  });

  it("lời khen cũng được trả lời (nhãn mặc định gồm praise); spam / chê vẫn không bao giờ", async () => {
    const t = liveBiz();
    const p = t.post();
    mockFetch(fbOk);
    const praise = t.cmt(p.id, { label: "praise", author_external_id: "P1" });
    expect(await processNurtureComment(t.biz, praise.id, NOW)).toMatchObject({ stage: "asked_contact" });
    expect(await processNurtureComment(t.biz, t.cmt(p.id, { label: "spam" }).id, NOW)).toMatchObject({ skipped: "label" });
    expect(await processNurtureComment(t.biz, t.cmt(p.id, { label: "negative" }).id, NOW)).toMatchObject({ skipped: "label" });
  });

  it("bình luận viết SAU lúc bật vẫn được trả lời dù hệ thống chậm > 24 giờ; chỉ bình luận cũ trước lúc bật mới bị bỏ", async () => {
    const t = liveBiz();
    const p = t.post();
    saveNurtureSettings(t.biz, { enabled: false }, "CEO");
    saveNurtureSettings(t.biz, { enabled: true }, "CEO"); // ghi enabledAt = bây giờ
    const since = new Date(nurtureSettings(t.biz).enabledAt!).getTime();
    const later = new Date(since + 30 * 3600_000); // hệ thống xử lý 30 giờ sau (tắt máy / nghẽn)
    const after = t.cmt(p.id, { external_created_at: new Date(since + 60_000).toISOString() });
    const before = t.cmt(p.id, { external_created_at: new Date(since - 48 * 3600_000).toISOString() });
    mockFetch(fbOk);
    expect(await processNurtureComment(t.biz, after.id, later)).toMatchObject({ stage: "asked_contact" });
    expect(await processNurtureComment(t.biz, before.id, later)).toMatchObject({ skipped: "old_comment" });
  });

  it("không có id người viết + tên mặc định 'Khách Facebook' → mỗi bình luận là 1 khách riêng", async () => {
    const t = liveBiz();
    const p = t.post();
    const x = t.cmt(p.id, { author: "Khách Facebook", author_external_id: null });
    const y = t.cmt(p.id, { author: "Khách Facebook", author_external_id: null });
    mockFetch(fbOk);
    expect(await processNurtureComment(t.biz, x.id, NOW)).toMatchObject({ stage: "asked_contact" });
    expect(await processNurtureComment(t.biz, y.id, NOW)).toMatchObject({ stage: "asked_contact" });
    expect(calls.filter((c) => c.url.endsWith("/messages"))).toHaveLength(2);
    // Có tên thật (không có id) bình luận lần 2 → vẫn trả lời, là lead lặp
    const z1 = t.cmt(p.id, { author: "Đỗ Minh Khoa", author_external_id: null });
    const z2 = t.cmt(p.id, { author: "Đỗ Minh Khoa", author_external_id: null });
    await processNurtureComment(t.biz, z1.id, NOW);
    expect(await processNurtureComment(t.biz, z2.id, NOW)).toMatchObject({ stage: "replied" });
  });
});

describe("8) lỗi ZL-CRM khi kết bạn", () => {
  it("500 → giãn lịch, nhớ UID (không tra SĐT lại); 4xx cũng dời lịch; quá 5 lần → failed; lời chào cắt 150 ký tự đúng như đã gửi", async () => {
    const t = liveBiz({ friendGreetingTemplates: ["Chào {ten}, shop đây ạ. " + "Shop gửi bạn ưu đãi rất đặc biệt dành riêng cho khách quen của shop trong tháng này nhé. ".repeat(3) + "😀😀"] });
    t.zl();
    const id = await leadWithPhone(t);
    let now = new Date(Date.now() + 3600_000);
    const due = () => { now = new Date(new Date(byId<Row>("nurture_lead", id)!.next_check_at).getTime() + 1000); return now; };
    mockFetch((url) => (url.includes("lookup-by-phone") ? { found: true, uid: "zu9" } : new Response(JSON.stringify({ code: "FRIEND_OP_FAILED" }), { status: 500 })));
    expect(await tryFriendRequest(t.biz, id, { now })).toMatchObject({ deferred: "error" });
    let l = byId<Row>("nurture_lead", id)!;
    expect(l).toMatchObject({ stage: "has_phone", friend_attempts: 1, zalo_uid: "zu9", zalo_account_id: "nickA" });
    expect(new Date(l.next_check_at).getTime() - now.getTime()).toBe(30 * 60_000);
    const sent = JSON.parse(calls.find((c) => c.url.includes("/friends/request"))!.body).message as string;
    expect(sent.length).toBeLessThanOrEqual(150);
    // 4xx: vẫn dời lịch (không thử lại mỗi 5 phút), không tra SĐT lại
    mockFetch(() => new Response(JSON.stringify({ error: "bad" }), { status: 400 }));
    expect(await tryFriendRequest(t.biz, id, { now: due() })).toMatchObject({ deferred: "error" });
    expect(calls.map((c) => c.url)).toEqual(["http://zl.test/api/public/friends/request"]);
    l = byId<Row>("nurture_lead", id)!;
    expect(new Date(l.next_check_at).getTime() - now.getTime()).toBe(2 * 3600_000);
    expect(await tryFriendRequest(t.biz, id, { now: new Date(now.getTime() + 60_000) })).toMatchObject({ skipped: "not_due" });
    // 503 (phiên Zalo hết hạn) → thử lại, KHÔNG đánh dấu "chưa có Zalo"
    mockFetch(() => new Response(JSON.stringify({ code: "SESSION_EXPIRED" }), { status: 503 }));
    await tryFriendRequest(t.biz, id, { now: due() });
    await tryFriendRequest(t.biz, id, { now: due() });
    expect(byId<Row>("nurture_lead", id)!.stage).toBe("has_phone");
    await tryFriendRequest(t.biz, id, { now: due() });
    l = byId<Row>("nurture_lead", id)!;
    expect(l).toMatchObject({ stage: "failed", friend_attempts: 5, next_check_at: null });
    expect(JSON.stringify(l.log)).toMatch(/lỗi 5 lần — dừng/);
    expect(calls.filter((c) => c.url.includes("lookup-by-phone"))).toHaveLength(0);

    // Thành công: lời chào ghi lại đúng câu đã gửi (đã cắt)
    const id2 = await leadWithPhone(t, "0933 444 555");
    mockFetch((url) => (url.includes("lookup-by-phone") ? { found: true, uid: "zu10" } : { sent: true, uid: "zu10" }));
    await tryFriendRequest(t.biz, id2, { now: new Date(Date.now() + 3600_000) });
    const msg = JSON.parse(calls[1].body).message as string;
    expect(msg.length).toBeLessThanOrEqual(150);
    expect(byId<Row>("nurture_lead", id2)!.meta.greeting).toBe(msg);
    expect(truncateGreeting("a".repeat(149) + "😀")).toBe("a".repeat(149));
  });
});

describe("9) giãn nhịp kiểm tra đồng ý kết bạn", () => {
  it("20 phút trong 2 giờ đầu → mỗi giờ → 6 giờ sau 1 ngày; lỗi cũng dời lịch", async () => {
    expect(friendCheckInterval(30 * 60_000)).toBe(20 * 60_000);
    expect(friendCheckInterval(5 * 3600_000)).toBe(3600_000);
    expect(friendCheckInterval(30 * 3600_000)).toBe(6 * 3600_000);
    const t = liveBiz();
    t.zl();
    const id = await leadWithPhone(t);
    update("nurture_lead", id, { stage: "friend_requested", zalo_account_id: "nickA", zalo_uid: "zu1", friend_requested_at: ago(30 * 3600_000) });
    mockFetch(() => new Response("{}", { status: 500 }));
    const now = new Date();
    expect(await checkFriendAccepted(t.biz, byId<Row>("nurture_lead", id)!, now)).toBe(false);
    expect(new Date(byId<Row>("nurture_lead", id)!.next_check_at).getTime() - now.getTime()).toBe(6 * 3600_000);
  });
});

describe("11) hết thời gian chờ ở tầng Graph (graphPost) là 'không rõ kết quả' thật sự", () => {
  it("fetch bị TimeoutError / mất kết nối sau khi gửi → needs_check, tick sau KHÔNG gửi lại", async () => {
    const t = liveBiz();
    const c = t.cmt(t.post().id);
    let sends = 0;
    mockFetch((url) => { if (url.endsWith("/comments")) return { id: "r1" }; sends++; return timeout(); });
    expect(await processNurtureComment(t.biz, c.id, NOW)).toMatchObject({ stage: "needs_check" });
    expect(sends).toBe(1);
    // Các lượt sau (tick, chạy lại job) không gọi Facebook nữa
    mockFetch(() => { sends++; return { recipient_id: "P", message_id: "m" }; });
    await nurtureTick(t.biz, new Date(Date.now() + 3 * 3600_000));
    await processNurtureComment(t.biz, c.id, new Date(Date.now() + 3 * 3600_000));
    expect(sends).toBe(1);
    expect(calls).toHaveLength(0);

    // Mất kết nối giữa chừng (không phải lỗi "chưa gửi") cũng là không rõ kết quả
    const c2 = t.cmt(t.post().id);
    mockFetch((url) => (url.endsWith("/messages") ? dropped() : { id: "r2" }));
    expect(await processNurtureComment(t.biz, c2.id, NOW)).toMatchObject({ stage: "needs_check" });
    expect(leadOf(c2.id).stage).toBe("needs_check");
  });
});

