import { describe, expect, it } from "vitest";
import { cleanNote, parseVideoScript } from "./script-video.ts";
import { pickStockSource } from "./video-ai.ts";

const body = `HOOK: Bạn vừa thuê thêm 3 người? | Bạn làm việc như trâu.

[0-3s] Kiểm ngồi bàn làm việc, nhìn thẳng vào camera.
  🎙 Bạn vừa thuê thêm 3 người tháng trước.
  🅣 THUÊ THÊM 3 NGƯỜI?
[3-10s] Cắt sang laptop. (Ghi chú nội bộ sản xuất: số liệu cần Steve xác nhận trước khi duyệt đăng bản final.)
  🎙 Vấn đề không phải thiếu người.
  🅣 THIẾU HỆ THỐNG ⚠️

CTA: Đăng ký AI Plus
Caption: Bạn vừa thuê thêm 3 người.

#TAKI`;

describe("parseVideoScript", () => {
  it("splits hooks, scenes, CTA, caption", () => {
    const s = parseVideoScript(body)!;
    expect(s.hooks).toEqual(["Bạn vừa thuê thêm 3 người?", "Bạn làm việc như trâu."]);
    expect(s.scenes.map((x) => [x.from, x.to, x.voice])).toEqual([[0, 3, "Bạn vừa thuê thêm 3 người tháng trước."], [3, 10, "Vấn đề không phải thiếu người."]]);
    expect(s.cta).toBe("Đăng ký AI Plus");
    expect(s.caption).toBe("Bạn vừa thuê thêm 3 người.\n\n#TAKI");
  });
  it("drops internal notes and ⚠️ from what goes into the video", () => {
    const s = parseVideoScript(body)!;
    expect(s.scenes[1].visual).toBe("Cắt sang laptop.");
    expect(s.scenes[1].onScreen).toBe("THIẾU HỆ THỐNG");
    expect(cleanNote("A (chờ Steve chốt bản công bố) B")).toBe("A B");
  });
  it("rejects text that is not a scene script", () => {
    expect(parseVideoScript("Bài viết thường, không có cảnh")).toBeNull();
  });
});

describe("pickStockSource — chỉ cần 1 trong 2 khóa Pexels / Pixabay", () => {
  it("chỉ có khóa Pixabay → dùng Pixabay dù nguồn mặc định là Pexels", () => {
    expect(pickStockSource("pexels", { pexels: 0, pixabay: 1 })).toBe("pixabay");
  });
  it("chỉ có khóa Pexels → dùng Pexels dù đã chọn Pixabay", () => {
    expect(pickStockSource("pixabay", { pexels: 2, pixabay: 0 })).toBe("pexels");
  });
  it("có cả hai thì giữ đúng nguồn đã chọn; không có khóa nào thì giữ nguồn chọn (để báo thiếu khóa)", () => {
    expect(pickStockSource("pixabay", { pexels: 1, pixabay: 1 })).toBe("pixabay");
    expect(pickStockSource("pexels", { pexels: 0, pixabay: 0 })).toBe("pexels");
  });
});
