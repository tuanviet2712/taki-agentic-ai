import { describe, expect, it } from "vitest";
import { commentHeuristic } from "./questions.ts";

/** Nhãn mà bộ phân loại dự phòng (không cần khoá Jev) gán cho từng bình luận. */
function labelOf(text: string): string {
  const out = commentHeuristic({ comments: [{ text }] });
  return out.c0.choice;
}

describe("phân loại bình luận (dự phòng khi chưa có khoá Jev)", () => {
  it("câu hỏi tiếng Việt không có dấu ? vẫn là câu hỏi (trước đây bị coi là khen → không được trả lời)", () => {
    for (const t of ["hay quá, có hướng dẫn ko ạ", "cái này có hướng dẫn không", "làm sao để học vậy ạ", "bán ở đâu vậy", "dùng như thế nào"]) {
      expect(labelOf(t), t).toBe("question");
    }
  });
  it("muốn mua → purchase_intent", () => {
    for (const t of ["bao nhiêu inbox", "bao nhiêu vậy shop", "còn hàng không ạ", "cho mình đặt hàng", "ship về Hà Nội được không"]) {
      expect(labelOf(t), t).toBe("purchase_intent");
    }
  });
  it("khen thuần tuý vẫn là praise (không bị trả lời)", () => {
    for (const t of ["hay quá", "hay ghê", "tuyệt vời", "cảm ơn shop nhiều"]) expect(labelOf(t), t).toBe("praise");
  });
  it("chê và spam không bị nhầm thành câu hỏi", () => {
    expect(labelOf("lừa đảo à?")).toBe("negative");
    expect(labelOf("vay tiền nhanh http://x.vn")).toBe("spam");
  });
});
