/**
 * @dotaka/email — phần THUẦN của kênh email, chép từ auto-funnel (core/*): render HTML an toàn cho Outlook, footer hủy nhận
 * bắt buộc, cá nhân hoá {{bien|dự phòng}}, soạn theo khối (maily.to) / kéo thả (waypoint), kiểm SPF/DKIM/DMARC,
 * đẩy DNS Resend → Cloudflare, chữ ký webhook svix, mẫu chuỗi + chấm điểm, mẫu email hệ thống.
 * Tên hàm giữ nguyên tiếng Việt như repo gốc để dễ đối chiếu. Không I/O trừ render-khoi (thư viện render).
 */
export * from "./email.ts";
export * from "./email-khoi.ts";
export * from "./email-keo-tha.ts";
export * from "./dns-email.ts";
export * from "./ket-noi-email.ts";
export * from "./ket-noi-domain.ts";
export * from "./chu-ky-webhook.ts";
export * from "./chuoi-mau.ts";
export * from "./cham-diem-noi-dung.ts";
export * from "./mau-email-khoi.ts";
export * from "./mau-email-keo-tha.ts";
export * from "./mau-email-le.ts";
export * from "./mui-gio.ts";
export * from "./luong.ts";
export * from "./unsubscribe.ts";
export * from "./ab.ts";
export * from "./render-khoi.ts";
