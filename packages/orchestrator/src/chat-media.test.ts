import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import { sendImageAsHuman, setConversationConnector } from "@dotaka/chat-engine";
import { encryptSecret } from "@dotaka/shared";
import {
  CHAT_MEDIA_MAX, chatMediaDir, chatMediaFile, downloadChatMedia, isAllowedMediaUrl, queueChatMediaByExternal, removeChatMediaFile,
  saveOutboundChatImage, sniffImageMime,
} from "./chat-media.ts";
import { liveMessengerConnector } from "./connections.ts";
import { HANDLERS } from "./index.ts";
import { zlAttachments } from "./zalo-followup.ts";

/**
 * Ảnh/tệp trong hội thoại Messenger: job tải ảnh về máy (chỉ ảnh Facebook, đúng kiểu, ≤ 8MB), xem ảnh theo đúng doanh nghiệp,
 * nhân viên gửi ảnh (multipart filedata, token ở header, không cần link công khai), cửa sổ 24 giờ chặn trước khi gửi.
 * Facebook luôn là fetch giả; dữ liệu ghi vào thư mục tạm (DATA_DIR), không đụng data/ thật.
 */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const IMG_URL = "https://scontent.xx.fbcdn.net/v/t1/abc.jpg?_nc_token=SECRET_TOKEN";
type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
let calls: Call[] = [];
let sendSeq = 0;

function mockFetch(opts: { cdn?: () => Response } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: String(init?.method ?? "GET"), body: init?.body, headers: (init?.headers ?? {}) as Record<string, string> });
    if (u.includes("fbcdn.net")) return opts.cdn ? opts.cdn() : new Response(PNG, { status: 200, headers: { "content-type": "image/png", "content-length": String(PNG.length) } });
    if (/\/messages$/.test(u) && init?.method === "POST") return new Response(JSON.stringify({ recipient_id: "x", message_id: `m_sent_${++sendSeq}` }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  }));
}
const sends = () => calls.filter((c) => c.method === "POST" && /\/messages$/.test(c.url));

let B: string, B2: string, tmp: string;
const mkConv = (psid: string, extra: Row = {}) =>
  insert("conversation", { biz_id: B, channel: "messenger", external_id: psid, customer_ref: `cust_${psid}`, customer_name: "Khách", state: "awaiting_customer", tags: [], unread: 0, ext: { pageId: "PAGE1" }, last_customer_at: new Date().toISOString(), ...extra });
const mkImgMsg = (convId: string, url: string) =>
  insert("message", { biz_id: B, conversation_id: convId, direction: "in", sender: "customer", body: { text: "[Ảnh]" }, meta: { attachments: [{ type: "image", url }] }, sent_at: new Date().toISOString() });

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "taki-chat-media-"));
  process.env.DATA_DIR = tmp;
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" }, chat: { vision: false } } }).id;
  B2 = insert("biz", { name: "Shop Khác", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  const conn = insert("connection", { biz_id: B, platform: "meta", external_account_id: "u1", token_ciphertext: encryptSecret("{}"), status: "active", mode: "live", config: {} });
  insert("channel", { biz_id: B, platform: "facebook", kind: "page", name: "Shop Lan", external_id: "PAGE1", connection_id: conn.id, enabled: 1, secret_ciphertext: encryptSecret("PAGE_TOKEN"), meta: {} });
  setConversationConnector(liveMessengerConnector);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  setConversationConnector(() => null);
  closeDb();
  delete process.env.DATA_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

describe("tải ảnh khách gửi về máy", () => {
  it("ảnh Facebook hợp lệ → lưu tệp trong DATA_DIR, ghi stored/mime/size; xem đúng doanh nghiệp, chống lệch đường dẫn", async () => {
    mockFetch();
    const c = mkConv("PSID_A");
    const m = mkImgMsg(c.id, IMG_URL);
    expect(await downloadChatMedia(B, m.id)).toEqual({ saved: 1, failed: 0 });
    const saved = byId<Row>("message", m.id)!.meta.attachments[0];
    expect(saved).toMatchObject({ type: "image", url: IMG_URL, stored: expect.stringMatching(/\.png$/), mime: "image/png", size: PNG.length });
    const file = join(chatMediaDir(B), saved.stored);
    expect(file.startsWith(tmp)).toBe(true);
    expect(readFileSync(file).equals(PNG)).toBe(true);
    expect(chatMediaFile(B, m.id, 0)).toMatchObject({ mime: "image/png", path: file });
    expect(chatMediaFile(B2, m.id, 0)).toBeNull(); // doanh nghiệp khác
    expect(chatMediaFile(B, m.id, 3)).toBeNull();
    expect(chatMediaFile(B, "../../x", 0)).toBeNull();
    // đã tải rồi → không tải lại
    mockFetch();
    expect(await downloadChatMedia(B, m.id)).toEqual({ saved: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("link ngoài Facebook → không tải (chống SSRF)", async () => {
    mockFetch();
    const m = mkImgMsg(mkConv("PSID_B").id, "https://evil.example/x.png");
    expect(await downloadChatMedia(B, m.id)).toEqual({ saved: 0, failed: 1 });
    expect(calls).toHaveLength(0);
    expect(byId<Row>("message", m.id)!.meta.attachments[0].fetchError).toBeTruthy();
    expect(isAllowedMediaUrl("http://scontent.xx.fbcdn.net/a.jpg")).toBe(false); // không https
    expect(isAllowedMediaUrl("https://fbcdn.net.evil.example/a.jpg")).toBe(false);
    expect(isAllowedMediaUrl(IMG_URL)).toBe(true);
  });

  it("không phải ảnh / quá 8MB / link hết hạn → ghi lỗi, không lưu tệp", async () => {
    const c = mkConv("PSID_C");
    mockFetch({ cdn: () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }) });
    expect((await downloadChatMedia(B, mkImgMsg(c.id, IMG_URL).id)).failed).toBe(1);
    mockFetch({ cdn: () => new Response(PNG, { status: 200, headers: { "content-type": "image/png", "content-length": String(CHAT_MEDIA_MAX + 1) } }) });
    expect((await downloadChatMedia(B, mkImgMsg(c.id, IMG_URL).id)).failed).toBe(1);
    mockFetch({ cdn: () => new Response("gone", { status: 403 }) });
    const m = mkImgMsg(c.id, IMG_URL);
    expect((await downloadChatMedia(B, m.id)).failed).toBe(1);
    expect(byId<Row>("message", m.id)!.meta.attachments[0].fetchError).toMatch(/hết hạn/);
  });

  it("lỗi mạng tạm thời → ném lỗi để hàng đợi thử lại", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(downloadChatMedia(B, mkImgMsg(mkConv("PSID_D").id, IMG_URL).id)).rejects.toThrow();
  });

  it("job chat.ingest có đính kèm → xếp job tải ảnh (chat.media) theo mã tin; chữ + ảnh: bot không thấy link", async () => {
    mkConv("PSID_E");
    const msg = { channel: "messenger", externalConversationId: "PSID_E", customerName: "Khách", text: "Mẫu này còn không shop", messageId: "m_e1", pageExternalId: "PAGE1", noReply: true, attachments: [{ type: "image", url: IMG_URL }] };
    await HANDLERS["chat.ingest"]({ bizId: B, msg }, { biz_id: B } as Row);
    const m = q.get<Row>("SELECT * FROM message WHERE external_id = 'm_e1'")!;
    expect(m.meta.attachments).toEqual([{ type: "image", url: IMG_URL }]);
    expect(q.get("SELECT id FROM job WHERE name = 'chat.media' AND idempotency_key = ?", `chat.media:${m.id}`)).toBeTruthy();
    for (const j of q.all<Row>("SELECT state FROM jev_judgment WHERE biz_id = ?", B)) expect(JSON.stringify(j.state)).not.toContain("fbcdn");
    expect(queueChatMediaByExternal(B, "messenger", "PSID_E", undefined)).toBeNull();
  });
});

describe("ảnh nhân viên gửi", () => {
  it("nhận diện ảnh theo byte đầu tệp; không phải ảnh / rỗng / quá lớn → từ chối", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImageMime(Buffer.from("<script>alert(1)</script>"))).toBeNull();
    expect(() => saveOutboundChatImage(B, Buffer.from("<script>alert(1)</script>"))).toThrowError(expect.objectContaining({ code: "BAD_TYPE" }));
    expect(() => saveOutboundChatImage(B, Buffer.alloc(0))).toThrowError(expect.objectContaining({ code: "EMPTY" }));
    expect(() => saveOutboundChatImage(B, Buffer.alloc(CHAT_MEDIA_MAX + 1))).toThrowError(expect.objectContaining({ code: "TOO_LARGE" }));
  });

  it("Send API multipart (filedata, token ở header), lưu tin + mã tin Facebook, nhân viên tiếp quản", async () => {
    mockFetch();
    const c = mkConv("PSID_S1", { state: "bot_active" });
    const img = saveOutboundChatImage(B, PNG);
    const r = await sendImageAsHuman(B, c.id, { path: img.path, mime: img.mime, name: "ảnh mẫu.png", size: img.size, stored: img.name }, "Sếp");
    expect(sends()).toHaveLength(1);
    const call = sends()[0];
    expect(new URL(call.url).pathname).toMatch(/\/PAGE1\/messages$/);
    expect(call.url).not.toContain("PAGE_TOKEN");
    expect(call.headers.Authorization).toBe("Bearer PAGE_TOKEN");
    const form = call.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(JSON.parse(String(form.get("recipient")))).toEqual({ id: "PSID_S1" });
    expect(form.get("messaging_type")).toBe("RESPONSE");
    expect(JSON.parse(String(form.get("message")))).toEqual({ attachment: { type: "image", payload: { is_reusable: true } } });
    const blob = form.get("filedata") as Blob;
    expect(blob.type).toBe("image/png");
    expect(Buffer.from(await blob.arrayBuffer()).equals(PNG)).toBe(true);
    expect(form.get("source")).toBeNull();

    const m = byId<Row>("message", r.messageId)!;
    expect(m).toMatchObject({ sender: "human", external_id: `m_sent_${sendSeq}`, body: { text: "[Ảnh]" } });
    expect(m.meta.attachments[0]).toMatchObject({ type: "image", mime: "image/png", stored: img.name, name: "ảnh mẫu.png" });
    expect(JSON.stringify(m.meta)).not.toContain(tmp); // không lưu đường dẫn máy
    expect(byId<Row>("conversation", c.id)!.state).toBe("human_active");
    expect(chatMediaFile(B, m.id, 0)).toMatchObject({ mime: "image/png" });
  });

  it("quá 24 giờ kể từ tin cuối của khách → chặn trước khi gọi Facebook, không đổi trạng thái, API dọn tệp mồ côi", async () => {
    mockFetch();
    const c = mkConv("PSID_S2", { last_customer_at: new Date(Date.now() - 30 * 3600_000).toISOString() });
    const img = saveOutboundChatImage(B, PNG);
    await expect(sendImageAsHuman(B, c.id, { path: img.path, mime: img.mime, stored: img.name })).rejects.toMatchObject({ code: "OUTSIDE_24H", status: 409 });
    expect(sends()).toHaveLength(0);
    expect(byId<Row>("conversation", c.id)!.state).toBe("awaiting_customer");
    removeChatMediaFile(B, img.name);
    expect(existsSync(img.path)).toBe(false);
    expect(readdirSync(chatMediaDir(B)).includes(img.name)).toBe(false);
  });

  it("chưa có Fanpage thật / kênh không phải Messenger → từ chối, không đổi trạng thái", async () => {
    mockFetch();
    const noPage = insert("conversation", { biz_id: B, channel: "messenger", external_id: "sim_1", customer_ref: "cust_sim_1", customer_name: "Khách thử", state: "bot_active", tags: [], unread: 0, ext: { pageId: "KHAC" }, last_customer_at: new Date().toISOString() });
    const img = saveOutboundChatImage(B, PNG);
    await expect(sendImageAsHuman(B, noPage.id, { path: img.path, mime: img.mime })).rejects.toThrow(/Fanpage thật/);
    expect(byId<Row>("conversation", noPage.id)!.state).toBe("bot_active");
    const zalo = insert("conversation", { biz_id: B, channel: "zalo", external_id: "z1", customer_ref: "cust_z1", customer_name: "Khách Z", state: "bot_active", tags: [], unread: 0, ext: {} });
    await expect(sendImageAsHuman(B, zalo.id, { path: img.path, mime: img.mime })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(sendImageAsHuman(B2, noPage.id, { path: img.path, mime: img.mime })).rejects.toMatchObject({ code: "NOT_FOUND" }); // doanh nghiệp khác
    expect(sends()).toHaveLength(0);
    update("conversation", noPage.id, { state: "bot_active" });
  });
});

describe("Zalo (ZL-CRM): link ảnh/tệp trong content", () => {
  it("bóc link http(s) từ JSON hoặc link trần; tin chữ / link lạ → không có đính kèm", () => {
    const base = { id: "z1", senderType: "contact", senderName: null, sentAt: new Date().toISOString() } as const;
    const msg = (contentType: string, content: string) => ({ ...base, contentType, content }) as any;
    expect(zlAttachments(msg("photo", JSON.stringify({ hdUrl: "https://r2.example/a.jpg", title: "" })))).toEqual([{ type: "image", url: "https://r2.example/a.jpg" }]);
    expect(zlAttachments(msg("file", JSON.stringify({ href: "https://r2.example/b.pdf", title: "bao-gia.pdf" })))).toEqual([{ type: "file", url: "https://r2.example/b.pdf", name: "bao-gia.pdf" }]);
    expect(zlAttachments(msg("video", "https://r2.example/c.mp4"))).toEqual([{ type: "video", url: "https://r2.example/c.mp4" }]);
    expect(zlAttachments(msg("text", "https://shopee.vn/x"))).toEqual([]);
    expect(zlAttachments(msg("image", JSON.stringify({ href: "javascript:alert(1)" })))).toEqual([]);
  });
});
