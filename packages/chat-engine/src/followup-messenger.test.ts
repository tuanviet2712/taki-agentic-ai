import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import type { Connector } from "@dotaka/connectors";
import { FOLLOW_UP_GAP_MS, recordConversationOptOut, runFollowUps, setConversationConnector } from "./index.ts";

/**
 * Follow-up Messenger: nhắc 2 lần nhưng PHẢI trong 24 giờ kể từ tin cuối của khách; khách vừa nhắn thì dời lịch;
 * khách đã báo không nhận tin thì dừng; lời nhắc dùng cách xưng hô + ưu đãi từ DNA. Facebook là connector giả.
 */
const sent: { conversationExternalId: string; text: string }[] = [];
const fakeLive = (): Connector => ({
  platform: "meta", mode: "live", limits: { requestsPerMinute: 60, concurrency: 2 },
  health: async () => ({ ok: true, detail: "fake" }),
  sendMessage: async (spec) => { sent.push({ conversationExternalId: spec.conversationExternalId, text: spec.text }); return { externalId: `m_fu_${sent.length}` }; },
});

describe("follow-up Messenger", () => {
  let B: string;
  const H = 3600_000;
  const t0 = new Date("2026-10-06T02:00:00Z"); // 9:00 giờ VN
  beforeAll(() => {
    process.env.DB_PATH = ":memory:";
    openDb(":memory:");
  });
  afterAll(() => { setConversationConnector(() => null); closeDb(); });
  // Mỗi ca 1 doanh nghiệp riêng: runFollowUps quét mọi lịch đến hạn của doanh nghiệp, ca này không được dính lịch của ca khác.
  beforeEach(() => {
    sent.length = 0;
    setConversationConnector(() => fakeLive());
    B = insert("biz", { name: "Shop nhắc", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
  });

  const setup = (ext: string, lastCustomerAt: Date, nextAt: Date) => {
    const c = insert("conversation", { biz_id: B, channel: "messenger", external_id: ext, customer_ref: `cust_${ext}`, customer_name: "Khách", state: "awaiting_customer", tags: [], unread: 0, ext: { pageId: "P1" } });
    insert("message", { biz_id: B, conversation_id: c.id, direction: "in", sender: "customer", body: { text: "Giá bao nhiêu?" }, external_id: `${ext}:1`, sent_at: lastCustomerAt.toISOString() });
    const f = insert("follow_up_plan", { biz_id: B, conversation_id: c.id, step: 0, next_at: nextAt.toISOString(), status: "active", template: "sau_hoi_gia" });
    return { c, f };
  };
  const plan = (id: string) => q.get<Row>("SELECT * FROM follow_up_plan WHERE id = ?", id)!;
  const sentCount = (convId: string) => q.scalar<number>("SELECT COUNT(*) FROM message WHERE conversation_id = ? AND json_extract(meta, '$.kind') = 'follow_up'", convId);

  it("lần 1 sau 4 giờ, lần 2 trước hạn 24 giờ (23 giờ) — cả 2 lần đều gửi được", async () => {
    const { c, f } = setup("PSID_A", t0, new Date(t0.getTime() + 4 * H));
    expect(await runFollowUps(B, new Date(t0.getTime() + 4 * H + 60_000))).toBe(1);
    const p = plan(f.id);
    expect(p.step).toBe(1);
    expect(new Date(p.next_at).getTime()).toBe(t0.getTime() + 23 * H); // trước đây = 24h → luôn bị chặn
    expect(await runFollowUps(B, new Date(t0.getTime() + 23 * H + 60_000))).toBe(1);
    expect(plan(f.id).status).toBe("done");
    expect(sentCount(c.id)).toBe(2);
    expect(sent).toHaveLength(2);
  });

  it("khách vừa nhắn trước giờ nhắc → không nhắc ngay, dời tới 4 giờ sau tin mới nhất", async () => {
    const { c, f } = setup("PSID_B", t0, new Date(t0.getTime() + 4 * H));
    const reply = new Date(t0.getTime() + 3.5 * H);
    insert("message", { biz_id: B, conversation_id: c.id, direction: "in", sender: "customer", body: { text: "Để mình suy nghĩ" }, external_id: "PSID_B:2", sent_at: reply.toISOString() });
    expect(await runFollowUps(B, new Date(t0.getTime() + 4 * H + 60_000))).toBe(0);
    expect(new Date(plan(f.id).next_at).getTime()).toBe(reply.getTime() + FOLLOW_UP_GAP_MS);
    expect(sentCount(c.id)).toBe(0);
  });

  it("lần 1 gửi muộn (đã sát hạn 24 giờ) → không lập lần 2 sẽ bị chặn, kết thúc luôn", async () => {
    const { c, f } = setup("PSID_C", t0, new Date(t0.getTime() + 22 * H));
    await runFollowUps(B, new Date(t0.getTime() + 22 * H));
    expect(plan(f.id).status).toBe("done");
    expect(sentCount(c.id)).toBe(1);
  });

  it("quá 24 giờ kể từ tin cuối của khách → dừng (ngoài cửa sổ), không gọi Facebook", async () => {
    const { c, f } = setup("PSID_D", t0, new Date(t0.getTime() + 4 * H));
    expect(await runFollowUps(B, new Date(t0.getTime() + 25 * H))).toBe(0);
    expect(plan(f.id)).toMatchObject({ status: "stopped", template: "sau_hoi_gia:outside_window" });
    expect(sentCount(c.id)).toBe(0);
  });

  it("khách đã báo không nhận tin → dừng hẳn, không nhắc", async () => {
    const { c, f } = setup("PSID_E", t0, new Date(t0.getTime() + 4 * H));
    recordConversationOptOut(B, c, { reason: "Đừng nhắn nữa", source: "auto" });
    q.run("UPDATE follow_up_plan SET status = 'active' WHERE id = ?", f.id); // recordConversationOptOut đã dừng lịch → mở lại để kiểm cổng của runFollowUps
    expect(await runFollowUps(B, new Date(t0.getTime() + 4 * H + 60_000))).toBe(0);
    expect(plan(f.id)).toMatchObject({ status: "stopped", template: "sau_hoi_gia:opted_out" });
    expect(sent).toHaveLength(0);
  });

  it("lời nhắc xưng hô và nêu ưu đãi theo DNA của doanh nghiệp (không chữ cứng)", async () => {
    insert("dna_profile", { biz_id: B, version: 1, status: "active", created_by: "test", data: { company: { name: "Shop nhắc", brand: "Shop nhắc" }, voice: { selfPronoun: "mình", customerPronoun: "bạn" }, leadMagnet: "Bộ tài liệu mẫu (cửa vào phễu)", offers: [], products: [] } });
    const { f } = setup("PSID_F", t0, new Date(t0.getTime() + 4 * H));
    expect(await runFollowUps(B, new Date(t0.getTime() + 4 * H + 60_000))).toBe(1);
    expect(sent.at(-1)!.text).toBe("Dạ bạn Khách ơi, mình gửi bạn thông tin: Bộ tài liệu mẫu. Bạn có muốn mình tư vấn kỹ hơn không ạ?");
    expect(plan(f.id).step).toBe(1);
  });
});
