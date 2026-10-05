import { describe, expect, it } from "vitest";
import { publishText } from "./publishing.ts";

const script = `HOOK: Bạn vừa thuê thêm 3 người | x

[0-3s] Kiểm ngồi bàn làm việc.
  🎙 Bạn vừa thuê thêm 3 người?
[10-20s] (Ghi chú nội bộ sản xuất: cần Steve xác nhận trước khi duyệt đăng bản final.)

CTA: Đăng ký AI Plus
Caption: Bạn vừa thuê thêm 3 người tháng trước.

Đăng ký tại nguyentatkiem.com.vn/aiplusntk

#TAKI #AIPlus`;

describe("publishText — only the caption ever reaches the channel", () => {
  it("never posts a video script without its video", () => {
    expect(publishText({ kind: "video_script", body: script }, false)).toHaveProperty("error");
  });
  it("posts only the Caption section with the video", () => {
    const r = publishText({ kind: "video_script", body: script }, true) as { text: string };
    expect(r.text).toBe("Bạn vừa thuê thêm 3 người tháng trước.\n\nĐăng ký tại nguyentatkiem.com.vn/aiplusntk\n\n#TAKI #AIPlus");
  });
  it("strips the spoken script from finished videos", () => {
    expect(publishText({ kind: "video", body: "Caption hay #ai\n\n---\nLời thoại:\n[Cảnh 1] ..." }, true)).toEqual({ text: "Caption hay #ai" });
  });
  it("refuses text still holding internal notes / unverified markers", () => {
    expect(publishText({ kind: "social_post", body: "Bài hay. (Ghi chú nội bộ: số liệu chưa chốt)" }, false)).toHaveProperty("error");
    expect(publishText({ kind: "social_post", body: "250+ doanh nghiệp ⚠️" }, false)).toHaveProperty("error");
    expect(publishText({ kind: "social_post", body: "Cần CEO xác nhận link trước khi lên lịch ads." }, false)).toHaveProperty("error");
  });
  it("passes a normal post untouched", () => {
    expect(publishText({ kind: "social_post", body: "Bạn thuê thêm 3 nhân sự.\n\n#AIBusinessSystem" }, false)).toEqual({ text: "Bạn thuê thêm 3 nhân sự.\n\n#AIBusinessSystem" });
  });
});
