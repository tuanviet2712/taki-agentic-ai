import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import {
  appendUtm, clicksForPost, ensureTrackLink, isBotUserAgent, isQuickTunnelHost, mediaBase, publicBaseUrl, publicStatus, recordClick, setPublicGateway,
  trackedUrlFor, trackingBase,
} from "./tracking.ts";

/** Link đo click: UTM / sub-id, link /r/ chỉ khi có địa chỉ ổn định + cổng công khai chạy, click (IP băm, bot, trùng). */
let B: string;
const post = (extra: Row = {}) => insert("post", { biz_id: B, channel_id: "ch1", external_id: `e${Math.random().toString(36).slice(2, 8)}`, kind: "image", title: "Bài", body: "b", published_at: new Date().toISOString(), ad_status: "none", ...extra });

beforeAll(() => {
  process.env.DB_PATH = ":memory:";
  openDb(":memory:");
  B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
});
afterEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.PUBLIC_PORT;
  setPublicGateway({ listening: false });
});
afterAll(() => closeDb());

describe("appendUtm", () => {
  it("thêm UTM, giữ nguyên UTM / tham số sẵn có", () => {
    const u = new URL(appendUtm("https://shop.vn/sp?a=1&utm_source=zalo", { channel: "facebook", campaign: "tuan-1", content: "p1" }));
    expect(u.searchParams.get("a")).toBe("1");
    expect(u.searchParams.get("utm_source")).toBe("zalo"); // không ghi đè
    expect(u.searchParams.get("utm_medium")).toBe("social");
    expect(u.searchParams.get("utm_campaign")).toBe("tuan-1");
    expect(u.searchParams.get("utm_content")).toBe("p1");
  });
  it("sub-id chỉ gắn cho sàn / mạng affiliate quen; link thường không bị thêm sub-id", () => {
    expect(appendUtm("https://shopee.vn/abc", { channel: "facebook", subId: "Xk3" })).toContain("sub_id=Xk3");
    expect(appendUtm("https://s.shopee.vn/abc", { subId: "Xk3" })).toContain("sub_id=Xk3"); // link rút gọn cùng sàn vẫn được gắn sub-id
    expect(appendUtm("https://lazada.vn/x", { subId: "Zz9" })).toContain("sub_aff_id=Zz9");
    expect(appendUtm("https://taki.vn/khoa-hoc", { channel: "facebook", subId: "Xk3" })).not.toMatch(/sub/);
    expect(appendUtm("https://shopee.vn/abc?sub_id=co-san", { subId: "Xk3" })).toContain("sub_id=co-san"); // không ghi đè
  });
});

describe("địa chỉ công khai", () => {
  it("/r/ chỉ khi có PUBLIC_BASE_URL https ỔN ĐỊNH và cổng công khai đang chạy; tunnel nhanh không bao giờ dùng cho /r/", () => {
    expect(trackingBase()).toBeUndefined();
    process.env.PUBLIC_BASE_URL = "https://link.taki.vn/";
    expect(publicBaseUrl()).toBe("https://link.taki.vn");
    expect(trackingBase()).toBeUndefined(); // chưa có cổng công khai
    setPublicGateway({ listening: true, port: 8788 });
    expect(trackingBase()).toBe("https://link.taki.vn");
    expect(mediaBase()).toBe("https://link.taki.vn");
    process.env.PUBLIC_BASE_URL = "https://abc-def.trycloudflare.com";
    expect(isQuickTunnelHost(process.env.PUBLIC_BASE_URL)).toBe(true);
    expect(trackingBase()).toBeUndefined();
    expect(mediaBase()).toBe("https://abc-def.trycloudflare.com"); // media Instagram dùng tạm được
    process.env.PUBLIC_BASE_URL = "http://link.taki.vn"; // http không dùng
    expect(publicBaseUrl()).toBeUndefined();
  });
  it("publicStatus nói rõ vì sao chưa đo được click", () => {
    expect(publicStatus().clickTracking).toBe(false);
    expect(publicStatus().clickTrackingNote).toMatch(/PUBLIC_PORT/);
    process.env.PUBLIC_PORT = "8788";
    expect(publicStatus().clickTrackingNote).toMatch(/chưa chạy/);
    setPublicGateway({ listening: true, port: 8788 });
    expect(publicStatus().clickTrackingNote).toMatch(/PUBLIC_BASE_URL/);
    process.env.PUBLIC_BASE_URL = "https://abc.trycloudflare.com";
    expect(publicStatus().clickTrackingNote).toMatch(/tunnel nhanh/);
    process.env.PUBLIC_BASE_URL = "https://link.taki.vn";
    expect(publicStatus()).toMatchObject({ clickTracking: true, stable: true, clickTrackingNote: null });
  });
});

describe("link dưới bình luận", () => {
  it("không có địa chỉ công khai: link gốc + UTM (+ sub-id sàn), mỗi (bài, link) đúng 1 mã", () => {
    const p = post();
    const a = trackedUrlFor({ bizId: B, url: "https://shopee.vn/sua-x", postId: p.id, channel: "facebook", productKey: "sua-x" });
    const b = trackedUrlFor({ bizId: B, url: "https://shopee.vn/sua-x", postId: p.id, channel: "facebook", productKey: "sua-x" });
    expect(a).toBe(b);
    expect(a).toMatch(/^https:\/\/shopee\.vn\/sua-x\?utm_source=facebook&utm_medium=social/);
    expect(a).toContain(`utm_content=${p.id}`);
    expect(q.all("SELECT id FROM track_link WHERE post_id = ?", p.id)).toHaveLength(1);
    const code = q.get<Row>("SELECT code FROM track_link WHERE post_id = ?", p.id)!.code;
    expect(a).toContain(`sub_id=${code}`);
  });
  it("có địa chỉ ổn định + cổng công khai: ${PUBLIC_BASE_URL}/r/<mã>", () => {
    process.env.PUBLIC_BASE_URL = "https://link.taki.vn";
    setPublicGateway({ listening: true, port: 8788 });
    const url = trackedUrlFor({ bizId: B, url: "https://taki.vn/khoa", postId: post().id, channel: "facebook" });
    expect(url).toMatch(/^https:\/\/link\.taki\.vn\/r\/[A-Za-z0-9]{8}$/);
  });
  it("link tạo trước khi có bài (Chrome) được gắn vào bài sau khi đăng", () => {
    const ci = insert("content_item", { biz_id: B, agent_key: "content", kind: "social_post", channel: "facebook", title: "T", body: "b", status: "approved" });
    const link = ensureTrackLink({ bizId: B, url: "https://taki.vn/x", contentItemId: ci.id });
    expect(link.post_id).toBeNull();
    expect(ensureTrackLink({ bizId: B, url: "https://taki.vn/x", contentItemId: ci.id }).id).toBe(link.id);
    const p = post({ content_item_id: ci.id });
    const hit = recordClick(link.code, { ip: "1.2.3.4", ua: "Mozilla/5.0 Chrome" });
    expect(hit?.url).toContain("taki.vn/x");
    expect(clicksForPost(p)).toBe(1);
  });
});

describe("ghi click", () => {
  it("IP băm (không lưu IP thô), bot xem trước link không tính, bấm lại trong 10 giây không tính thêm", () => {
    const p = post();
    const url = trackedUrlFor({ bizId: B, url: "https://taki.vn/khoa", postId: p.id, channel: "facebook" });
    const code = q.get<Row>("SELECT code FROM track_link WHERE post_id = ?", p.id)!.code;
    expect(url).toContain("taki.vn");
    const human = { ip: "203.0.113.7", ua: "Mozilla/5.0 (iPhone) AppleWebKit Mobile Safari" };
    expect(recordClick(code, human)?.counted).toBe(true);
    expect(recordClick(code, human)?.counted).toBe(false); // trùng trong 10 giây
    expect(recordClick(code, { ip: "198.51.100.9", ua: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" })?.counted).toBe(false);
    expect(recordClick(code, { ip: "198.51.100.10", ua: "Mozilla/5.0 (compatible; Googlebot/2.1)" })?.counted).toBe(false);
    expect(recordClick(code, { ip: "192.0.2.5", ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/120" })?.counted).toBe(true);
    expect(clicksForPost(p)).toBe(2); // 2 khách thật
    const rows = q.all<Row>("SELECT * FROM track_click");
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7"); // IP thô không nằm trong DB
    expect(rows.every((r) => !r.ip_hash || /^[0-9a-f]{32}$/.test(r.ip_hash))).toBe(true);
    expect(rows.filter((r) => r.is_bot === 1).length).toBe(2); // bot vẫn được chuyển hướng + ghi nhận để biết
  });
  it("mã lạ / sai định dạng → không có đích", () => {
    expect(recordClick("khong-co", { ip: "1.1.1.1", ua: "Mozilla" })).toBeUndefined();
    expect(recordClick("../etc", { ip: "1.1.1.1", ua: "Mozilla" })).toBeUndefined();
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Macintosh) AppleWebKit Safari")).toBe(false);
  });
});
