import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { changePublishChannel } from "./publishing.ts";

/** Đổi kênh đăng của lượt chưa lên bài (vd video tạo với TikTok chưa nối → chuyển sang Fanpage). DB :memory:, không gọi kênh thật. */
let bizId: string, tiktok: Row, fanpage: Row, ci: Row;
beforeEach(() => {
  openDb(":memory:");
  bizId = insert("biz", { name: "Shop", settings: DEFAULT_SETTINGS }).id;
  tiktok = insert("channel", { biz_id: bizId, platform: "tiktok", kind: "business", name: "@shop", external_id: "tt", enabled: 1, whitelisted: 1 });
  fanpage = insert("channel", { biz_id: bizId, platform: "facebook", kind: "page", name: "Fanpage Shop", external_id: "fb", enabled: 1, whitelisted: 1 });
  ci = insert("content_item", { biz_id: bizId, agent_key: "creative", kind: "video", channel: "tiktok", title: "Video", body: "Caption", status: "approved" });
});
afterEach(() => closeDb());

const job = (status: string, extra: Row = {}) => insert("publish_job", {
  biz_id: bizId, content_item_id: ci.id, channel_id: tiktok.id, scheduled_at: "2026-10-12T04:00:00.000Z", status, idempotency_key: `draft:x:${tiktok.id}:${status}`, mode: "draft", ...extra,
});

describe("đổi kênh đăng", () => {
  it("lượt chờ kết nối kênh → chuyển sang Fanpage, bài theo nền tảng mới và đưa lại vào hàng tải nháp", () => {
    const j = job("needs_setup", { error: "TikTok chưa nối" });
    const out = changePublishChannel(bizId, j.id, fanpage.id, "CEO");
    expect(out).toMatchObject({ channel_id: fanpage.id, status: "scheduled", error: null });
    expect(byId<Row>("content_item", ci.id)!.channel).toBe("facebook");
    expect(q.scalar<number>("SELECT COUNT(*) FROM job WHERE name = 'publish.draft'")).toBe(1);
  });

  it("lượt đang chờ giờ đăng → giữ nguyên giờ hẹn, không đăng ngay", () => {
    const j = job("scheduled");
    const out = changePublishChannel(bizId, j.id, fanpage.id, "CEO");
    expect(out).toMatchObject({ channel_id: fanpage.id, status: "scheduled", scheduled_at: "2026-10-12T04:00:00.000Z" });
    expect(q.scalar<number>("SELECT COUNT(*) FROM job")).toBe(0);
  });

  it("không đổi lượt có thể ĐÃ lên kênh cũ, và không tạo lượt trùng trên cùng kênh", () => {
    expect(() => changePublishChannel(bizId, job("needs_check").id, fanpage.id, "CEO")).toThrow(/ĐÃ lên kênh cũ/);
    const a = job("needs_setup");
    insert("publish_job", { biz_id: bizId, content_item_id: ci.id, channel_id: fanpage.id, scheduled_at: "2026-10-12T04:00:00.000Z", status: "draft_uploaded", idempotency_key: "draft:y", mode: "draft" });
    expect(() => changePublishChannel(bizId, a.id, fanpage.id, "CEO")).toThrow(/đã có lượt đăng/);
  });
});
