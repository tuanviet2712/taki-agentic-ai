import { describe, expect, it } from "vitest";
import { decideGuard, guardHeuristic, moneyValues } from "./questions.ts";

/** Bộ chặn câu trả lời chat (chế độ heuristic): không chặn nhầm giá đúng / "100% offline", vẫn chặn giá bịa & cam kết. */
describe("bộ chặn chat — heuristic", () => {
  const facts = ["AI Business System: học phí 12.000.000đ, offline 3 ngày", "AI Plus miễn phí 5 buổi"];
  const reasons = (r: string) => decideGuard(guardHeuristic({ draft_reply: r, approved_facts: facts }), []).reasons;
  it("quy đổi số tiền", () => {
    expect(moneyValues("hoc phi 12 trieu, 350k, 1,5 trieu, 12.000.000d")).toEqual([12_000_000, 350_000, 1_500_000, 12_000_000]);
  });
  it("giá đúng (mọi cách viết) + mô tả 100% offline → cho qua", () => {
    expect(reasons("Học phí **12.000.000đ**, chương trình 100% offline 3 ngày ạ.")).toEqual([]);
    expect(reasons("Học phí 12 triệu ạ")).toEqual([]);
    expect(reasons("Học phí 12tr ạ")).toEqual([]);
  });
  it("giá bịa, % khuyến mãi không có, cam kết kết quả → chặn", () => {
    expect(reasons("Học phí chỉ 9.900.000đ thôi ạ")).toContain("Giá/ngày/chính sách không có trong kho tri thức");
    expect(reasons("Giảm 30% hôm nay ạ")).toContain("Giá/ngày/chính sách không có trong kho tri thức");
    expect(reasons("Cam kết 100% hiệu quả ạ")).toContain("Cam kết kết quả (bị cấm theo DNA)");
    expect(reasons("Em đảm bảo anh ra đơn ngay ạ")).toContain("Cam kết kết quả (bị cấm theo DNA)");
  });
});
