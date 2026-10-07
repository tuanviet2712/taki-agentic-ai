import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, activeBizIds, activeDna, defaultBizId, insert, isActiveBiz, openDb, q } from "@dotaka/db";
import { archiveBusiness, createBusiness, listBusinesses, restoreBusiness } from "./business.ts";
import { htmlToText, normalizeSiteUrl, readWebsite } from "./web-read.ts";

let MAIN = "";
beforeAll(() => {
  openDb(":memory:");
  MAIN = insert("biz", { name: "TAKI Group", timezone: "Asia/Ho_Chi_Minh", currency: "VND", settings: { ...DEFAULT_SETTINGS, llm: { provider: "claude_cli" } } }).id;
  insert("goal", { biz_id: MAIN, title: "x", description: "y", template: "weekly_content", status: "active", params: {} });
});

describe("nhiều doanh nghiệp", () => {
  it("tạo doanh nghiệp trống: DNA trống, đủ agent, lịch nền; không đụng doanh nghiệp cũ", () => {
    const b = createBusiness("Doanh nghiệp test", "test", MAIN);
    expect(activeDna(b.id)?.data.products).toEqual([]);
    expect(q.scalar<number>("SELECT COUNT(*) FROM agent_config WHERE biz_id = ?", b.id)).toBeGreaterThan(10);
    expect(q.scalar<number>("SELECT COUNT(*) FROM schedule WHERE biz_id = ? AND name = 'autopilot.tick'", b.id)).toBe(1);
    expect(q.get<any>("SELECT settings FROM biz WHERE id = ?", b.id).settings.llm.provider).toBe("claude_cli");
    const list = listBusinesses();
    expect(list.map((x) => x.name)).toEqual(["TAKI Group", "Doanh nghiệp test"]);
    expect(list[0].counts.goals).toBe(1);
    expect(list[1].counts.goals).toBe(0);
    expect(defaultBizId()).toBe(MAIN);
  });

  it("lưu trữ / khôi phục: ẩn khỏi danh sách, không lưu trữ doanh nghiệp cuối cùng", () => {
    const b = createBusiness("Tạm", "test");
    archiveBusiness(b.id, "test");
    expect(isActiveBiz(b.id)).toBe(false);
    expect(activeBizIds()).not.toContain(b.id);
    restoreBusiness(b.id, "test");
    expect(isActiveBiz(b.id)).toBe(true);
    for (const id of activeBizIds().filter((x) => x !== MAIN)) archiveBusiness(id, "test");
    expect(() => archiveBusiness(MAIN, "test")).toThrow(/cuối cùng/);
  });
});

describe("đọc website cho Nạp DNA", () => {
  it("bóc chữ, bỏ script/style, giữ tiêu đề + mô tả", () => {
    const r = htmlToText(`<html><head><title>Học viện A &amp; B</title><meta name="description" content="Đào tạo CEO"><style>.x{}</style></head>
      <body><script>alert(1)</script><h1>Khóa CEO</h1><p>Học phí&nbsp;12 triệu</p><p>Học phí&nbsp;12 triệu</p></body></html>`);
    expect(r.title).toBe("Học viện A & B");
    expect(r.description).toBe("Đào tạo CEO");
    expect(r.text).toContain("Khóa CEO");
    expect(r.text).not.toContain("alert");
    expect(r.text.match(/Học phí/g)).toHaveLength(1);
  });
  it("tự thêm https, chặn địa chỉ nội bộ", async () => {
    expect(normalizeSiteUrl("nguyentatkiem.com").href).toBe("https://nguyentatkiem.com/");
    await expect(readWebsite("http://127.0.0.1:8787")).rejects.toThrow(/nội bộ/);
    await expect(readWebsite("localhost")).rejects.toThrow(/nội bộ/);
    await expect(readWebsite("http://192.168.1.10")).rejects.toThrow(/nội bộ/);
    await expect(readWebsite("ftp://example.com")).rejects.toThrow(/http/);
  });
});
