/** Phần dùng được trong trình duyệt (apps/web): soạn khối / kéo thả, biến, mẫu, chấm CTA. Không node:crypto, không render máy chủ. */
export * from "./email-khoi.ts";
export * from "./email-keo-tha.ts";
export * from "./mau-email-khoi.ts";
export * from "./mau-email-keo-tha.ts";
export { kiemCtaBan, renderCaNhan, soatBien, vanBanSangHtml } from "./email.ts";
