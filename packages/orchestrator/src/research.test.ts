import { describe, expect, it } from "vitest";
import { parseChannelUrl, parseCount, postedAtOf } from "./research.ts";

describe("research: đọc số liệu trang công khai", () => {
  it("parses view counts in VN/EN formats", () => {
    expect(parseCount("3,4M")).toBe(3_400_000);
    expect(parseCount("3,4 Tr")).toBe(3_400_000);
    expect(parseCount("215,9K")).toBe(215_900);
    expect(parseCount("1,2 N")).toBe(1_200);
    expect(parseCount("12.345")).toBe(12_345);
    expect(parseCount("6,2K lượt xem")).toBe(6_200);
    expect(parseCount("1.2B")).toBe(1_200_000_000);
    expect(parseCount("")).toBeNull();
  });
  it("reads the TikTok post time from the video id", () => {
    const at = postedAtOf("tiktok", "https://www.tiktok.com/@a/video/7272003454321111327");
    expect(at?.slice(0, 7)).toBe("2023-08");
  });
  it("falls back to relative dates", () => {
    const at = Date.parse(postedAtOf("youtube", "https://youtube.com/shorts/x", "2 ngày trước")!);
    expect(Math.round((Date.now() - at) / 86400_000)).toBe(2);
  });
  it("detects platform + handle from pasted links", () => {
    expect(parseChannelUrl("tiktok.com/@giangkita?lang=vi")).toMatchObject({ platform: "tiktok", url: "https://www.tiktok.com/@giangkita", handle: "@giangkita" });
    expect(parseChannelUrl("https://www.youtube.com/@abc/shorts").platform).toBe("youtube");
    expect(parseChannelUrl("https://facebook.com/tuduylamgiau").platform).toBe("facebook");
    expect(() => parseChannelUrl("https://example.com/x")).toThrow();
  });
});
