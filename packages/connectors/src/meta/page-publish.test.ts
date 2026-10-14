import { afterEach, describe, expect, it, vi } from "vitest";
import { graphError } from "./graph.ts";
import { metaPageConnector } from "./page.ts";

/** Số liệu bài thật (video vs bài viết) + lời nhắn tiếng Việt cho lỗi đăng bài Facebook. Facebook = fetch giả. */
const calls: { url: string }[] = [];
afterEach(() => vi.unstubAllGlobals());
function stub(handler: (url: string) => unknown, status = 200) {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push({ url: String(url) });
    return new Response(JSON.stringify(handler(String(url))), { status });
  }));
}

describe("fetchPostMetrics", () => {
  it("video đăng qua /videos (mã không có '_') → hỏi trường của Video, không gọi reactions (từng lỗi #100)", async () => {
    stub((url) => (url.includes("video_insights")
      ? { data: [{ name: "total_video_impressions_unique", values: [{ value: 850 }] }] }
      : { likes: { summary: { total_count: 42 } }, comments: { summary: { total_count: 7 } } }));
    const m = await metaPageConnector("TKN", "PAGE1").fetchPostMetrics!({ externalId: "1589623636238312" } as any, "1h");
    expect(m).toEqual({ reach: 850, reactions: 42, comments: 7, shares: 0, saves: 0 });
    expect(calls.map((c) => decodeURIComponent(c.url)).join(" ")).not.toContain("reactions");
  });

  it("bài viết thường (PAGE_POST) → reactions/comments/shares + insights như cũ", async () => {
    stub((url) => (url.includes("/insights")
      ? { data: [{ name: "post_impressions_unique", values: [{ value: 1200 }] }] }
      : { reactions: { summary: { total_count: 30 } }, comments: { summary: { total_count: 5 } }, shares: { count: 2 } }));
    const m = await metaPageConnector("TKN", "PAGE1").fetchPostMetrics!({ externalId: "PAGE1_777" } as any, "1h");
    expect(m).toEqual({ reach: 1200, reactions: 30, comments: 5, shares: 2, saves: 0 });
    expect(decodeURIComponent(calls[0].url)).toContain("reactions.summary(true)");
  });

  it("mã không có '_' nhưng không phải video → rơi về cách hỏi bài viết", async () => {
    stub((url) => (/fields=likes/.test(decodeURIComponent(url).replace(/\+/g, "")) ? { error: { code: 100, message: "(#100) nonexisting field (likes)" } }
      : url.includes("/insights") ? { data: [] } : { reactions: { summary: { total_count: 3 } }, comments: { summary: { total_count: 1 } } }), 200);
    const m = await metaPageConnector("TKN", "PAGE1").fetchPostMetrics!({ externalId: "123456" } as any, "1h");
    expect(m).toMatchObject({ reactions: 3, comments: 1 });
  });
});

describe("graphError — lời nhắn tiếng Việt khi đăng bài", () => {
  const kindOf = (e: any) => (graphError(e, 400) as any).kind;
  const msgOf = (e: any) => graphError(e, 400).message;
  it("chưa được cấp quyền đăng với tư cách Trang → AuthError, bảo kết nối lại", () => {
    const e = { code: 100, error_subcode: 1404078, message: "Unpublished posts must be posted to a page as the page itself." };
    expect(kindOf(e)).toBe("AuthError");
    expect(msgOf(e)).toContain("kết nối lại và chọn đủ Trang");
  });
  it("ảnh quá lớn, vi phạm tiêu chuẩn cộng đồng, kiểm tra bảo mật, tệp không hợp lệ", () => {
    expect(msgOf({ code: 100, error_subcode: 1366046 })).toContain("nhỏ hơn 4MB");
    expect(kindOf({ code: 100, error_subcode: 1346003 })).toBe("PolicyRejected");
    expect(msgOf({ code: 368, error_subcode: 1404006 })).toContain("kiểm tra bảo mật");
    expect(kindOf({ code: 100, error_subcode: 2069019 })).toBe("InvalidRequest");
  });
  it("giữ nguyên cách phân loại cũ cho mã không có gợi ý", () => {
    expect(kindOf({ code: 190, message: "x" })).toBe("AuthError");
    expect(kindOf({ code: 4, message: "x" })).toBe("RateLimited");
    expect(kindOf({ code: 1, message: "x" })).toBe("Transient");
    expect(msgOf({ code: 100, message: "Invalid parameter" })).toContain("Invalid parameter");
  });
  it("khoá bảo mật 31/3858385 vẫn dùng hướng dẫn riêng", () => {
    expect(msgOf({ code: 31, error_subcode: 3858385, message: "x" })).toContain("System User");
  });
});
