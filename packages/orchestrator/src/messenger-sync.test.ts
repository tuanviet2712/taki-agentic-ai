import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { handleIncoming, setConversationConnector } from "@dotaka/chat-engine";
import { encryptSecret } from "@dotaka/shared";
import { ensureBizSchedules } from "./business.ts";
import { liveMessengerConnector } from "./connections.ts";
import { HANDLERS } from "./index.ts";
import { messengerSyncStatus, setMessengerBot, syncMessenger } from "./messenger-sync.ts";

/**
 * Đồng bộ Messenger (Fanpage THẬT; Graph API là fetch giả): kéo tin cũ chỉ lưu, tin mới đi đúng đường webhook (job chat.ingest),
 * bot Messenger TẮT thì chỉ chấm lead (noReply), không trùng với job đang chờ / chăm khách, bot nhường khi người trả lời trên
 * Facebook, ảnh/tệp mang theo đính kèm, lỗi token / lỗi tạm, lịch 1 phút.
 */
type Call = { url: string; method: string; body: string; auth: string };
let calls: Call[] = [];
type GAtt = Row;
type GMsg = { id: string; text?: string; fromPage?: boolean; minAgo: number; attachments?: GAtt[]; sticker?: string };
let threads: Record<string, { psid: string; name: string; msgs: GMsg[] }> = {};
let sendSeq = 0;
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString().replace("Z", "+0000");

function graphThreads(pageId: string) {
  return Object.entries(threads).map(([id, t]) => {
    const msgs = [...t.msgs].sort((a, b) => a.minAgo - b.minAgo); // mới trước
    return {
      id, updated_time: iso(msgs[0]?.minAgo ?? 0),
      participants: { data: [{ id: pageId, name: "Shop Lan" }, { id: t.psid, name: t.name }] },
      messages: {
        data: msgs.map((m) => ({
          id: m.id, ...(m.text ? { message: m.text } : {}), created_time: iso(m.minAgo),
          from: m.fromPage ? { id: pageId, name: "Shop Lan" } : { id: t.psid, name: t.name },
          ...(m.attachments ? { attachments: { data: m.attachments } } : {}), ...(m.sticker ? { sticker: m.sticker } : {}),
        })),
      },
    };
  });
}
function mockGraph(opts: { fail?: () => Response } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: String(init?.method ?? "GET"), body: String(init?.body ?? ""), auth: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "") });
    if (opts.fail) return opts.fail();
    const m = u.match(/graph\.facebook\.com\/v[\d.]+\/([^/?]+)\/conversations/);
    if (m) return new Response(JSON.stringify({ data: graphThreads(m[1]) }), { status: 200 });
    if (/\/messages$/.test(u) && init?.method === "POST") return new Response(JSON.stringify({ recipient_id: "x", message_id: `m_sent_${++sendSeq}` }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  }));
}
const graphGets = () => calls.filter((c) => c.method === "GET" && c.url.includes("graph.facebook.com"));
const sends = () => calls.filter((c) => c.method === "POST" && /\/messages$/.test(c.url));
const ingestJobs = (mid?: string) => q.all<Row>(`SELECT * FROM job WHERE name = 'chat.ingest' ${mid ? "AND idempotency_key = ?" : ""}`, ...(mid ? [`ingest:messenger:${mid}`] : []));
const conv = (psid: string, biz = B) => q.get<Row>("SELECT * FROM conversation WHERE biz_id = ? AND channel = 'messenger' AND external_id = ?", biz, psid);
const msgCount = (mid: string) => q.scalar<number>("SELECT COUNT(*) FROM message WHERE external_id = ?", mid);
const msgByMid = (mid: string) => q.get<Row>("SELECT * FROM message WHERE external_id = ?", mid)!;
/** Chạy các job chat.ingest đang chờ bằng đúng handler của hàng đợi. */
async function runIngest() {
  for (const job of q.all<Row>("SELECT * FROM job WHERE name = 'chat.ingest' AND status = 'queued'")) {
    update("job", job.id, { status: "running" });
    await HANDLERS[job.name](job.payload, job);
    update("job", job.id, { status: "done" });
  }
}
const setCursor = (minAgo: number) => update("channel", liveCh.id, { meta: { ...(byId<Row>("channel", liveCh.id)!.meta ?? {}), messengerSyncedAt: new Date(Date.now() - minAgo * 60_000).toISOString(), messengerBackfillAt: new Date().toISOString() } });
const setVision = (on: boolean) => update("biz", B, { settings: { ...byId<Row>("biz", B)!.settings, chat: { vision: on } } });

let B: string;
let liveCh: Row;

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  const conn = insert("connection", { biz_id: B, platform: "meta", external_account_id: "u1", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
  liveCh = insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Shop Lan", external_id: "PAGE1", connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
  setConversationConnector(liveMessengerConnector);
});
beforeEach(() => { setMessengerBot(B, false, "test"); });
afterEach(() => vi.unstubAllGlobals());
afterAll(() => { setConversationConnector(() => null); closeDb(); });

describe("kéo tin cũ (backfill)", () => {
  it("lưu thread + tin (cả tin Trang trả lời trên Business Suite), KHÔNG để bot trả lời; chạy lại không trùng", async () => {
    threads = {
      t_1: { psid: "PSID1", name: "Nguyễn Thu Hà", msgs: [{ id: "m_1a", text: "Shop còn hàng không ạ?", minAgo: 3 * 24 * 60 }, { id: "m_1b", text: "Dạ còn ạ", fromPage: true, minAgo: 3 * 24 * 60 - 5 }, { id: "m_1c", minAgo: 3 * 24 * 60 - 6, attachments: [{ id: "a1" }] }] },
      t_2: { psid: "PSID2", name: "Trần Minh Quân", msgs: [{ id: "m_2a", text: "Giá bao nhiêu vậy shop, sđt 0912345678", minAgo: 2 }] }, // mới 2 phút nhưng là lượt kéo lịch sử
    };
    mockGraph();
    const r = await syncMessenger(B, { mode: "backfill" });
    expect(r).toMatchObject({ channels: 1, conversations: 2, newMessages: 4, routed: 0, errors: [] });
    expect(graphGets()[0].url).toMatch(/\/PAGE1\/conversations\?/);
    expect(new URL(graphGets()[0].url).searchParams.get("platform")).toBe("messenger");
    expect(graphGets()[0].auth).toBe("Bearer PAGE_TOKEN"); // token ở header, không nằm trong URL
    expect(graphGets()[0].url).not.toContain("PAGE_TOKEN");
    expect(ingestJobs()).toHaveLength(0);
    expect(sends()).toHaveLength(0);
    const c1 = conv("PSID1")!;
    expect(c1).toMatchObject({ customer_name: "Nguyễn Thu Hà", state: "new" });
    expect(c1.ext).toMatchObject({ pageId: "PAGE1", threadId: "t_1" });
    expect(c1.last_customer_at).toBe(msgByMid("m_1c").sent_at); // tin khách cuối (tệp)
    const msgs = q.all<Row>("SELECT direction, sender, body FROM message WHERE conversation_id = ? ORDER BY sent_at", c1.id);
    expect(msgs.map((m) => [m.direction, m.sender, m.body.text])).toEqual([["in", "customer", "Shop còn hàng không ạ?"], ["out", "page", "Dạ còn ạ"], ["in", "customer", "[Tệp]"]]);
    // Tin lịch sử đã giữ chỗ chống trùng; raw_event không chứa SĐT
    expect(q.get("SELECT id FROM raw_event WHERE dedupe_key = 'meta:m_2a'")).toBeTruthy();
    expect(JSON.stringify(q.get<Row>("SELECT payload FROM raw_event WHERE dedupe_key = 'meta:m_2a'")!.payload)).not.toContain("0912345678");
    expect(byId<Row>("channel", liveCh.id)!.meta).toMatchObject({ messengerSyncedAt: expect.any(String), messengerBackfillAt: expect.any(String), messengerSync: { status: "ok" } });

    const before = q.scalar<number>("SELECT COUNT(*) FROM message");
    const again = await syncMessenger(B, { mode: "backfill" });
    expect(again).toMatchObject({ newMessages: 0, routed: 0 });
    expect(q.scalar<number>("SELECT COUNT(*) FROM message")).toBe(before);
    expect(q.scalar<number>("SELECT COUNT(*) FROM conversation WHERE external_id IN ('PSID1','PSID2')")).toBe(2);
  });
});

describe("đồng bộ định kỳ (incremental)", () => {
  it("bot Messenger TẮT: tin khách mới đi đúng đường webhook nhưng noReply (chỉ chấm lead), bot không gửi gì", async () => {
    setCursor(60);
    threads = { t_3: { psid: "PSID3", name: "Lê Hoa", msgs: [{ id: "m_3old", text: "Chào shop", minAgo: 40 }, { id: "m_3new", text: "Shop ơi tư vấn giúp em với", minAgo: 2 }] } };
    mockGraph();
    const r = await syncMessenger(B);
    expect(r).toMatchObject({ newMessages: 1, routed: 1 });
    expect(msgCount("m_3old")).toBe(1);
    expect(ingestJobs("m_3new")).toHaveLength(1);
    expect(ingestJobs("m_3new")[0].payload.msg).toMatchObject({ noReply: true, pageExternalId: "PAGE1", messageId: "m_3new", sentAt: expect.any(String) });
    expect(ingestJobs("m_3old")).toHaveLength(0);
    expect(conv("PSID3")!.unread).toBe(1);
    await runIngest();
    expect(msgCount("m_3new")).toBe(1);
    expect(sends()).toHaveLength(0);
    // Lượt sau: không job mới, không tin trùng
    const again = await syncMessenger(B);
    expect(again).toMatchObject({ newMessages: 0, routed: 0 });
    expect(ingestJobs("m_3new")).toHaveLength(1);
  });

  it("bot Messenger BẬT: tin mới đi đúng đường webhook → bot trả lời đúng 1 lần, thời gian tin = giờ của nền tảng", async () => {
    setMessengerBot(B, true, "test");
    setCursor(60);
    threads = { t_3b: { psid: "PSID3B", name: "Lê Hoa B", msgs: [{ id: "m_3bnew", text: "Chào shop, mình cần tư vấn", minAgo: 3 }] } };
    mockGraph();
    expect(await syncMessenger(B)).toMatchObject({ newMessages: 0, routed: 1 });
    expect(ingestJobs("m_3bnew")[0].payload.msg.noReply).toBeUndefined();
    await runIngest();
    expect(sends()).toHaveLength(1); // bot trả lời đúng 1 lần
    expect(new URL(sends()[0].url).pathname).toMatch(/\/PAGE1\/messages$/);
    expect(sends()[0].auth).toBe("Bearer PAGE_TOKEN");
    const sentAt = new Date(msgByMid("m_3bnew").sent_at).getTime();
    expect(Math.abs(sentAt - (Date.now() - 3 * 60_000))).toBeLessThan(30_000);
    expect(new Date(conv("PSID3B")!.last_customer_at).getTime()).toBe(sentAt);
    calls = [];
    await syncMessenger(B);
    expect(sends()).toHaveLength(0);
  });

  it("Trang đã trả lời sau tin khách (Business Suite) → không để bot chen vào", async () => {
    setMessengerBot(B, true, "test");
    setCursor(30);
    threads = { t_4: { psid: "PSID4", name: "Phạm An", msgs: [{ id: "m_4a", text: "Còn size M không?", minAgo: 5 }, { id: "m_4b", text: "Dạ còn ạ", fromPage: true, minAgo: 3 }] } };
    mockGraph();
    const r = await syncMessenger(B);
    expect(r).toMatchObject({ newMessages: 2, routed: 0 });
    expect(ingestJobs("m_4a")).toHaveLength(0);
    // Tin tiếp theo của khách trong 30 phút sau câu trả lời của người → bot nhường
    const out = await handleIncoming(B, { channel: "messenger", externalConversationId: "PSID4", customerName: "Phạm An", text: "Giá bao nhiêu vậy", messageId: "m_4c", pageExternalId: "PAGE1" });
    expect(out.replied).toBe(false);
  });

  it("job chat.ingest của webhook còn chờ → đồng bộ không chen; chạy xong rồi đồng bộ lại chỉ có 1 tin", async () => {
    setMessengerBot(B, true, "test");
    const { enqueue } = await import("./queue.ts");
    enqueue("chat", "chat.ingest", { bizId: B, msg: { channel: "messenger", externalConversationId: "PSID5", customerName: "Khách FB 000005", text: "Ship COD được không?", messageId: "m_5", pageExternalId: "PAGE1" } },
      { bizId: B, idempotencyKey: "ingest:messenger:m_5", lockKey: "conv:messenger:PSID5", maxAttempts: 3 });
    insert("raw_event", { platform: "meta", received_at: new Date().toISOString(), signature_ok: 1, payload: { messageId: "m_5" }, dedupe_key: "meta:m_5" }); // webhook đã nhận tin này
    setCursor(10);
    threads = { t_5: { psid: "PSID5", name: "Vũ Mai", msgs: [{ id: "m_5", text: "Ship COD được không?", minAgo: 1 }] } };
    mockGraph();
    expect(await syncMessenger(B)).toMatchObject({ newMessages: 0, routed: 0 }); // job còn chờ → không chen
    expect(ingestJobs("m_5")).toHaveLength(1);
    await runIngest();
    expect(msgCount("m_5")).toBe(1);
    expect(sends()).toHaveLength(1);
    await syncMessenger(B);
    expect(msgCount("m_5")).toBe(1);
    expect(sends()).toHaveLength(1);
    // Đồng bộ thay tên chung "Khách FB …" bằng tên thật, gắn thread id
    expect(conv("PSID5")).toMatchObject({ customer_name: "Vũ Mai" });
    expect(conv("PSID5")!.ext.threadId).toBe("t_5");
  });

  it("hội thoại do chăm khách tạo (external_id = PSID) được gộp, tin inbox của bot không bị nhân đôi", async () => {
    const c = insert("conversation", { biz_id: B, channel: "messenger", external_id: "PSID7", customer_ref: "cust_PSID7", customer_name: "Lan (bình luận)", state: "awaiting_customer", tags: ["Từ bình luận"], unread: 0, ext: { pageId: "PAGE1", nurtureLeadId: "L1" } });
    insert("message", { biz_id: B, conversation_id: c.id, direction: "out", sender: "bot", body: { text: "Chào Lan, shop gửi thông tin ạ" }, external_id: "m_7dm", meta: { kind: "nurture_dm" }, sent_at: new Date(Date.now() - 50 * 60_000).toISOString() });
    setCursor(60);
    threads = { t_7: { psid: "PSID7", name: "Nguyễn Thị Lan", msgs: [{ id: "m_7dm", text: "Chào Lan, shop gửi thông tin ạ", fromPage: true, minAgo: 50 }, { id: "m_7r", text: "Dạ em cảm ơn", minAgo: 40 }] } };
    mockGraph();
    await syncMessenger(B);
    expect(q.scalar<number>("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND external_id = 'PSID7'", B)).toBe(1);
    const after = byId<Row>("conversation", c.id)!;
    expect(after.ext).toMatchObject({ pageId: "PAGE1", nurtureLeadId: "L1", threadId: "t_7" });
    expect(after.customer_name).toBe("Lan (bình luận)"); // tên không chung chung → giữ
    expect(q.scalar<number>("SELECT COUNT(*) FROM message WHERE conversation_id = ? AND direction = 'out'", c.id)).toBe(1);
    expect(msgCount("m_7r")).toBe(1);
    expect(after.last_customer_at).toBeTruthy();
  });
});

describe("ảnh / tệp trong đồng bộ", () => {
  const IMG = "https://scontent.xx.fbcdn.net/v/t1/abc.jpg?_nc_token=SECRET_TOKEN";
  const thread = (id: string, psid: string, msgs: GMsg[]) => { threads = { [id]: { psid, name: "Lê Hoa", msgs } }; };

  it("ảnh + nhãn dán + tệp từ Graph → meta.attachments, chữ thay thế, xếp job tải ảnh (tệp chỉ giữ link)", async () => {
    thread("t_att", "PSID_ATT", [
      { id: "m_s3", minAgo: 1, attachments: [{ id: "f1", mime_type: "application/pdf", name: "bao-gia.pdf", size: 1200, file_url: "https://cdn.fbsbx.com/v/bao-gia.pdf" }] },
      { id: "m_s2", minAgo: 2, sticker: "https://scontent.xx.fbcdn.net/sticker.png" },
      { id: "m_s1", text: "Ảnh sản phẩm nè", minAgo: 3, attachments: [{ id: "a1", mime_type: "image/jpeg", image_data: { url: IMG, width: 800, height: 600 } }] },
    ]);
    mockGraph();
    const r = await syncMessenger(B, { mode: "backfill" });
    expect(r.errors).toEqual([]);
    const fields = new URL(calls.find((c) => /\/conversations\?/.test(c.url))!.url).searchParams.get("fields")!;
    expect(fields).toContain("image_data");
    expect(msgByMid("m_s1").meta.attachments).toEqual([{ type: "image", url: IMG, mime: "image/jpeg" }]);
    expect(msgByMid("m_s1").body.text).toBe("Ảnh sản phẩm nè");
    expect(msgByMid("m_s2")).toMatchObject({ body: { text: "[Nhãn dán]" } });
    expect(msgByMid("m_s2").meta.attachments).toEqual([{ type: "sticker", url: "https://scontent.xx.fbcdn.net/sticker.png" }]);
    expect(msgByMid("m_s3").body.text).toBe("[Tệp]");
    expect(msgByMid("m_s3").meta.attachments).toEqual([{ type: "file", url: "https://cdn.fbsbx.com/v/bao-gia.pdf", name: "bao-gia.pdf", mime: "application/pdf", size: 1200 }]);
    expect(q.get("SELECT id FROM job WHERE idempotency_key = ?", `chat.media:${msgByMid("m_s1").id}`)).toBeTruthy();
    expect(q.get("SELECT id FROM job WHERE idempotency_key = ?", `chat.media:${msgByMid("m_s3").id}`)).toBeFalsy();
  });

  it("chỉ gửi ảnh: bot TẮT → chỉ lưu cho nhân viên (không job); bot BẬT + bật xem ảnh → đi đường webhook kèm attachmentOnly; tắt xem ảnh → chỉ lưu", async () => {
    setCursor(60);
    // 1) bot tắt
    thread("t_i1", "PSID_I1", [{ id: "m_i1", minAgo: 2, attachments: [{ id: "a", mime_type: "image/png", image_data: { url: IMG } }] }]);
    mockGraph();
    expect(await syncMessenger(B)).toMatchObject({ newMessages: 1, routed: 0 });
    expect(ingestJobs("m_i1")).toHaveLength(0);
    expect(conv("PSID_I1")!.unread).toBe(1);
    // 2) bot bật + xem ảnh bật
    setMessengerBot(B, true, "test");
    setCursor(60);
    thread("t_i2", "PSID_I2", [{ id: "m_i2", minAgo: 2, attachments: [{ id: "a", mime_type: "image/png", image_data: { url: IMG } }] }]);
    mockGraph();
    expect(await syncMessenger(B)).toMatchObject({ newMessages: 0, routed: 1 });
    const msg = ingestJobs("m_i2")[0].payload.msg;
    expect(msg).toMatchObject({ attachmentOnly: true, text: "[Ảnh]" });
    expect(msg.noReply).toBeUndefined();
    expect(msg.attachments).toEqual([{ type: "image", url: IMG, mime: "image/png" }]);
    // 3) bot bật nhưng tắt xem ảnh
    setVision(false);
    try {
      setCursor(60);
      thread("t_i3", "PSID_I3", [{ id: "m_i3", minAgo: 2, attachments: [{ id: "a", mime_type: "image/png", image_data: { url: IMG } }] }]);
      mockGraph();
      expect(await syncMessenger(B)).toMatchObject({ newMessages: 1, routed: 0 });
      expect(ingestJobs("m_i3")).toHaveLength(0);
    } finally { setVision(true); }
  });

  it("chữ + ảnh: đi đường webhook với chữ (+ đính kèm); link ảnh không vào raw_event", async () => {
    setCursor(60);
    thread("t_i4", "PSID_I4", [{ id: "m_i4", text: "Mẫu này còn không shop", minAgo: 1, attachments: [{ id: "a", mime_type: "image/jpeg", image_data: { url: IMG } }] }]);
    mockGraph();
    expect(await syncMessenger(B)).toMatchObject({ routed: 1 });
    const msg = ingestJobs("m_i4")[0].payload.msg;
    expect(msg).toMatchObject({ text: "Mẫu này còn không shop", noReply: true });
    expect(msg.attachmentOnly).toBeUndefined();
    expect(msg.attachments).toHaveLength(1);
    expect(JSON.stringify(q.get<Row>("SELECT payload FROM raw_event WHERE dedupe_key = 'meta:m_i4'")!.payload)).not.toContain("fbcdn");
  });
});

describe("lịch + trạng thái", () => {
  it("lịch 15 giây: doanh nghiệp mới được tạo 15 giây; lịch cũ 3 phút được nâng lên 15 giây; trạng thái có Trang, bot", () => {
    const B2 = insert("biz", { name: "Shop lịch", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
    insert("schedule", { biz_id: B2, name: "messenger.sync", queue: "chat", every_minutes: 3, enabled: 1, label: "cũ", last_run_at: new Date().toISOString() });
    ensureBizSchedules(B2);
    expect(q.get<Row>("SELECT every_minutes FROM schedule WHERE biz_id = ? AND name = 'messenger.sync'", B2)).toMatchObject({ every_minutes: 0.25 });
    ensureBizSchedules(B);
    expect(q.get<Row>("SELECT every_minutes FROM schedule WHERE biz_id = ? AND name = 'messenger.sync'", B)).toMatchObject({ every_minutes: 0.25 });
    const s = messengerSyncStatus(B);
    expect(s).toMatchObject({ livePages: 1, botReply: false, lastRunAt: expect.any(String) });
    expect(s.pages[0]).toMatchObject({ name: "Shop Lan", live: true, status: "ok" });
  });
});

describe("không có Trang thật / lỗi token", () => {
  it("doanh nghiệp chưa có Trang thật: không gọi Facebook, không tạo gì (không có Trang mô phỏng)", async () => {
    const B2 = insert("biz", { name: "Shop demo", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
    insert("channel", { biz_id: B2, platform: "facebook", kind: "page", name: "Trang demo", external_id: "page_demo_x", connection_id: null, enabled: 1, meta: {} });
    mockGraph();
    const r = await syncMessenger(B2);
    expect(r).toMatchObject({ channels: 0, skipped: expect.any(String) });
    await HANDLERS["messenger.sync"]({ bizId: B2 }, { biz_id: B2 } as Row);
    expect(calls).toHaveLength(0);
    expect(q.scalar<number>("SELECT COUNT(*) FROM conversation WHERE biz_id = ?", B2)).toBe(0);
  });

  it("token hết hạn → đánh dấu Trang + kết nối, báo 1 lần, không ném lỗi; lượt sau không gọi lại Facebook", async () => {
    const B3 = insert("biz", { name: "Shop hết hạn", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
    const conn = insert("connection", { biz_id: B3, platform: "meta", external_account_id: "u3", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
    const ch = insert("channel", { biz_id: B3, platform: "facebook", kind: "page", name: "Trang hết hạn", external_id: "PAGE3", connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("OLD"), meta: {} });
    mockGraph({ fail: () => new Response(JSON.stringify({ error: { message: "Error validating access token: Session has expired", code: 190 } }), { status: 400 }) });
    const r = await syncMessenger(B3);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/Session has expired/);
    expect(byId<Row>("channel", ch.id)!.meta.messengerSync).toMatchObject({ status: "error", error: expect.stringMatching(/Session has expired/) });
    expect(byId<Row>("connection", conn.id)).toMatchObject({ status: "expired", last_error: expect.stringMatching(/Session has expired/) });
    expect(q.scalar<number>("SELECT COUNT(*) FROM outbox WHERE biz_id = ? AND type = 'alert.raised'", B3)).toBe(1);
    expect(messengerSyncStatus(B3).pages[0]).toMatchObject({ status: "error" });
    calls = [];
    await HANDLERS["messenger.sync"]({ bizId: B3 }, { biz_id: B3 } as Row);
    expect(calls).toHaveLength(0);
  });

  it("lỗi tạm thời (502) → không đánh dấu hỏng, con trỏ không tiến, lượt sau thử lại", async () => {
    const B4 = insert("biz", { name: "Shop tạm", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
    const conn = insert("connection", { biz_id: B4, platform: "meta", external_account_id: "u4", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
    const ch = insert("channel", { biz_id: B4, platform: "facebook", kind: "page", name: "Trang 4", external_id: "PAGE4", connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("T4"), meta: {} });
    mockGraph({ fail: () => new Response("bad gateway", { status: 502 }) });
    const t = await syncMessenger(B4);
    expect(t.transient).toBe(1);
    expect(byId<Row>("channel", ch.id)!.meta.messengerSync.status).toBe("retrying");
    expect(byId<Row>("channel", ch.id)!.meta.messengerSyncedAt).toBeUndefined(); // con trỏ không tiến → lượt sau lấy lại
    expect(byId<Row>("connection", conn.id)!.status).toBe("active");
  }, 20_000);
});
