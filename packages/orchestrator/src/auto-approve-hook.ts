import { bizSettings } from "@dotaka/db";
import { enqueue } from "./queue.ts";

/**
 * Mục duyệt mới của bài / kịch bản / bài SEO / video: nếu Sếp đang BẬT "Tự động phê duyệt" thì xếp việc kiểm tra điểm (auto-approve.ts).
 * Tách riêng file này (chỉ phụ thuộc db + queue) để runtime.ts / creative.ts gọi được mà không tạo vòng nhập với approvals.ts.
 * Chạy ở hàng đợi "review": mục duyệt vẫn được tạo như thường (Sếp thấy ngay), việc này chỉ duyệt nốt khi đủ điều kiện.
 */
export function queueAutoApprove(bizId: string, approvalId: string) {
  if (bizSettings(bizId).autoApprove?.enabled !== true) return;
  enqueue("review", "approval.auto", { approvalId }, { bizId, idempotencyKey: `autoapprove:${approvalId}` });
}
