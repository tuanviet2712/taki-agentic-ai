import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, update, type Row } from "@dotaka/db";
import type { Connector } from "@dotaka/connectors";
import { PAYMENT_PROOF_ALERT, chatVisionEnabled, handleIncoming, setConversationConnector } from "@dotaka/chat-engine";
import { scrubVisionText } from "./chat-vision.ts"; // nạp module = tiêm bước "bot xem ảnh" vào chat-engine

/**
 * Bot xem ảnh khách gửi (Messenger): model xem ảnh là giả (vi.mock generate cho agent chat_vision); Facebook là fetch giả +
 * connector giả; dữ liệu ở thư mục tạm + DB :memory:. Không gọi Claude/Facebook thật.
 */
type VisionReq = { agentKey: string; system: string; user: string; images?: { path: string; mediaType: string }[] };
const visionCalls: VisionReq[] = [];
let visionOut: Row = { kind: "other", summary: "", relatedProductKey: null, needsHuman: false, reason: "" };

vi.mock("@dotaka/llm-gateway", async (orig) => {
  const real = await orig<typeof import("@dotaka/llm-gateway")>();
  return {
    ...real,
    generate: vi.fn(async (req: any) => {
      if (req.agentKey !== "chat_vision") return real.generate(req);
      visionCalls.push({ agentKey: req.agentKey, system: req.system, user: req.user, images: req.images });
      for (const img of req.images ?? []) expect(existsSync(img.path)).toBe(true); // ảnh đã tải về máy trước khi gọi model
      return { output: req.schema.parse(visionOut), model: "claude-haiku-4-5", source: "claude", provider: "claude_cli", usage: { input: 1, output: 1, cached: 0, costMicros: 0 } };
    }),
  };
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const IMG_URL = "https://scontent.xx.fbcdn.net/v/t1/abc.jpg?_nc_token=SECRET_TOKEN";
const CUSTOMER = "Nguyễn Thu Hà";
const PHONE = "0912345678";
const sent: string[] = [];
const fakeLive = (): Connector => ({
  platform: "meta", mode: "live", limits: { requestsPerMinute: 60, concurrency: 2 },
  health: async () => ({ ok: true, detail: "fake" }),
  sendMessage: async (spec) => { sent.push(spec.text); return { externalId: `m_out_${sent.length}` }; },
});

let B: string;
let tmp: string;
let seq = 0;
const msgByMid = (mid: string) => q.get<Row>("SELECT * FROM message WHERE external_id = ?", mid)!;
const conv = (psid: string) => q.get<Row>("SELECT * FROM conversation WHERE biz_id = ? AND channel = 'messenger' AND external_id = ?", B, psid)!;
const setVision = (on: boolean) => update("biz", B, { settings: { ...byId<Row>("biz", B)!.settings, chat: { vision: on } } });
const image = (url = IMG_URL) => [{ type: "image" as const, url }];
const incoming = (psid: string, mid: string, o: Row = {}) =>
  handleIncoming(B, { channel: "messenger", externalConversationId: psid, customerName: CUSTOMER, text: "[Ảnh]", messageId: mid, pageExternalId: "PAGE1", ...o } as any);

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "taki-chat-vision-"));
  process.env.DATA_DIR = tmp;
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop Lan", settings: { ...DEFAULT_SETTINGS, quietHours: [0, 0], llm: { provider: "sandbox" } } }).id;
  insert("dna_profile", {
    biz_id: B, version: 1, status: "active", created_by: "test",
    data: { company: { name: "Shop Lan", brand: "Shop Lan", website: "https://shoplan.vn" }, products: [{ key: "sua_x", name: "Sữa X", summary: "Sữa công thức", format: "Hộp 800g", price: 299000, link: "https://shoplan.vn/sua-x" }] },
  });
  setConversationConnector(() => fakeLive());
});
beforeEach(() => {
  visionCalls.length = 0;
  sent.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("fbcdn.net")) return new Response(PNG, { status: 200, headers: { "content-type": "image/png", "content-length": String(PNG.length) } });
    return new Response(JSON.stringify({}), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  setConversationConnector(() => null);
  closeDb();
  delete process.env.DATA_DIR;
  rmSync(tmp, { recursive: true, force: true });
});

/** Hội thoại có sẵn tên + SĐT khách (để kiểm lời nhắn gửi model xem ảnh không chứa chúng). */
function seedCustomer(psid: string) {
  const c = insert("conversation", { biz_id: B, channel: "messenger", external_id: psid, customer_ref: `cust_${psid}`, customer_name: CUSTOMER, state: "awaiting_customer", tags: [], unread: 0, ext: { pageId: "PAGE1" }, last_customer_at: new Date().toISOString() });
  insert("message", { biz_id: B, conversation_id: c.id, direction: "in", sender: "customer", body: { text: `Em là ${CUSTOMER}, sđt ${PHONE}` }, sent_at: new Date(Date.now() - 60_000).toISOString() });
  return c;
}

describe("bot xem ảnh khách gửi", () => {
  it("chỉ gửi ảnh sản phẩm: tải ảnh, gọi model xem ảnh ĐÚNG 1 lần (không có tên/SĐT khách), bot trả lời đúng sản phẩm + giá DNA; lưu meta.vision", async () => {
    seedCustomer("PSID_P");
    visionOut = { kind: "product_photo", summary: `Ảnh hộp Sữa X 800g, có ghi sđt ${PHONE}`, relatedProductKey: "sua_x", needsHuman: false, reason: "Khách hỏi mẫu" };
    const r = await incoming("PSID_P", "m_p1", { attachments: image(), attachmentOnly: true });
    expect(r.replied).toBe(true);

    expect(visionCalls).toHaveLength(1);
    const call = visionCalls[0];
    expect(call.images).toHaveLength(1);
    expect(call.images![0].mediaType).toBe("image/png");
    const promptText = `${call.system}\n${call.user}`;
    expect(promptText).not.toContain(CUSTOMER);
    expect(promptText).not.toContain(PHONE);
    expect(promptText).not.toContain("fbcdn"); // không bao giờ đưa link ảnh
    expect(call.user).toContain("sua_x: Sữa X");

    const m = msgByMid("m_p1");
    expect(m.meta.vision).toMatchObject({ kind: "product_photo", relatedProductKey: "sua_x", images: 1 });
    expect(m.meta.vision.summary).not.toContain(PHONE); // mô tả đã che SĐT
    expect(m.meta.attachments[0].stored).toMatch(/\.png$/);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Sữa X");
    expect(sent[0]).toContain("299.000");
    expect(conv("PSID_P").state).toBe("awaiting_customer");
    expect(m.meta.attachments).toHaveLength(1);

    // Chạy lại (job thử lại) → không gọi model lần 2, không gửi trùng.
    await incoming("PSID_P", "m_p1", { attachments: image(), attachmentOnly: true });
    expect(visionCalls).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("ảnh chuyển khoản: KHÔNG xác nhận đã nhận tiền, chuyển người + cảnh báo khẩn", async () => {
    seedCustomer("PSID_PAY");
    visionOut = { kind: "payment_proof", summary: "Ảnh chụp chuyển khoản 299.000đ từ tài khoản 0123456789012", relatedProductKey: null, needsHuman: true, reason: "Chứng từ thanh toán" };
    await incoming("PSID_PAY", "m_pay1", { attachments: image(), attachmentOnly: true });

    expect(visionCalls).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toMatch(/đã nhận (được )?(tiền|thanh toán|chuyển khoản)|xác nhận đã|thanh toán thành công/i);
    expect(sent[0]).toContain("kiểm tra");
    const c = conv("PSID_PAY");
    expect(c.state).toBe("handoff_pending");
    expect(c.analysis.handoff.reasons).toContain(PAYMENT_PROOF_ALERT);
    const v = msgByMid("m_pay1").meta.vision;
    expect(v.kind).toBe("payment_proof");
    expect(v.summary).not.toContain("0123456789012"); // số tài khoản đã che
    expect(v.summary).toContain("299.000đ"); // số tiền giữ lại
    await new Promise((r) => setImmediate(r));
    const alerts = q.all<Row>("SELECT payload FROM outbox WHERE biz_id = ? AND type = 'alert.raised'", B).map((r) => r.payload);
    expect(alerts.some((p) => p.level === "urgent" && String(p.text).includes(PAYMENT_PROOF_ALERT))).toBe(true);
  });

  it("chữ + ảnh chuyển khoản ('em chuyển rồi'): vẫn không để model viết câu xác nhận — cảm ơn + chuyển người", async () => {
    seedCustomer("PSID_PAY2");
    visionOut = { kind: "payment_proof", summary: "Biên lai chuyển khoản", relatedProductKey: null, needsHuman: true, reason: "Chứng từ" };
    await incoming("PSID_PAY2", "m_pay2", { text: "Em chuyển khoản rồi nha shop", attachments: image() });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toMatch(/đã nhận (được )?(tiền|thanh toán)/i);
    expect(conv("PSID_PAY2").state).toBe("handoff_pending");
  });

  it("chữ + ảnh sản phẩm: mô tả ảnh vào ngữ cảnh Jev (không link ảnh), bot trả lời phần chữ", async () => {
    visionOut = { kind: "product_photo", summary: "Ảnh hộp Sữa X", relatedProductKey: "sua_x", needsHuman: false, reason: "" };
    await incoming("PSID_TX", "m_tx1", { text: "Mẫu này giá bao nhiêu shop?", attachments: image() });
    expect(visionCalls).toHaveLength(1);
    expect(sent).toHaveLength(1);
    const states = q.all<Row>("SELECT state FROM jev_judgment WHERE subject_id = ?", conv("PSID_TX").id).map((j) => JSON.stringify(j.state));
    expect(states.some((s) => s.includes("Ảnh hộp Sữa X"))).toBe(true);
    expect(states.join(" ")).not.toContain("fbcdn");
  });

  it("chỉ nhãn dán: không gọi model, bot không trả lời", async () => {
    await incoming("PSID_ST", "m_st1", { text: "[Nhãn dán]", attachments: [{ type: "sticker", url: "https://scontent.xx.fbcdn.net/sticker.png" }], attachmentOnly: true });
    expect(visionCalls).toHaveLength(0);
    expect(sent).toHaveLength(0);
    expect(msgByMid("m_st1").meta.vision).toMatchObject({ kind: "sticker", images: 0 });
  });

  it("tắt chat.vision → như cũ: không gọi model, ảnh chỉ lưu cho nhân viên, bot im lặng", async () => {
    setVision(false);
    try {
      expect(chatVisionEnabled(B)).toBe(false);
      await incoming("PSID_OFF", "m_off1", { attachments: image(), attachmentOnly: true });
      expect(visionCalls).toHaveLength(0);
      expect(sent).toHaveLength(0);
      expect(msgByMid("m_off1").meta.vision).toBeUndefined();
      expect(conv("PSID_OFF").unread).toBe(1);
    } finally { setVision(true); }
  });

  it("bot Messenger TẮT (noReply): kể cả có ảnh cũng KHÔNG gọi model xem ảnh, không trả lời", async () => {
    visionOut = { kind: "product_photo", summary: "x", relatedProductKey: null, needsHuman: false, reason: "" };
    await incoming("PSID_NR", "m_nr1", { text: "Mẫu này còn không shop", attachments: image(), noReply: true });
    expect(visionCalls).toHaveLength(0);
    expect(sent).toHaveLength(0);
    expect(msgByMid("m_nr1").meta.vision).toBeUndefined();
    // chỉ ảnh + noReply: dừng ngay, không chấm lead
    await incoming("PSID_NR", "m_nr2", { attachments: image(), attachmentOnly: true, noReply: true });
    expect(visionCalls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("dừng khẩn cấp chat → không gọi model xem ảnh, không trả lời", async () => {
    update("biz", B, { settings: { ...byId<Row>("biz", B)!.settings, killSwitch: { ...DEFAULT_SETTINGS.killSwitch, chat: true } } });
    try {
      await incoming("PSID_KILL", `m_kill_${++seq}`, { attachments: image(), attachmentOnly: true });
      expect(visionCalls).toHaveLength(0);
      expect(sent).toHaveLength(0);
    } finally { update("biz", B, { settings: { ...byId<Row>("biz", B)!.settings, killSwitch: DEFAULT_SETTINGS.killSwitch } }); }
  });

  it("che dữ liệu cá nhân trong mô tả: SĐT, số tài khoản, email; giữ số tiền", () => {
    const s = scrubVisionText("Chuyển 1.500.000đ từ STK 1903 4567 8901 2345, sđt 0987654321, mail a.b@gmail.com");
    expect(s).toContain("1.500.000đ");
    expect(s).not.toMatch(/1903|0987654321|gmail/);
  });
});
