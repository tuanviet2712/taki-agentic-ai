// Chép từ auto-funnel services/email-khoi.ts — render email KHỐI (maily.to, JSON Tiptap) và KÉO THẢ
// (@usewaypoint/email-builder) → HTML bảng + MSO, rồi chèn footer hủy nhận bắt buộc. Biến giữ cú pháp
// {{ten|dự phòng}} để cổng gửi cá nhân hoá từng người; truyền `bien` khi xem thử / gửi thử để thay ngay.
import { Maily, type JSONContent } from "@maily-to/render";
import { renderToStaticMarkup, type TReaderDocument } from "@usewaypoint/email-builder";
import { kiemNoiDungKhoi, themFooterBatBuoc, type KhoiJson } from "./email-khoi.ts";
import { GOC, kiemJsonKeoTha, type TaiLieuKeoTha } from "./email-keo-tha.ts";
import { renderCaNhan } from "./email.ts";

export type TuyChonRenderKhoi = {
  tenGui: string;
  diaChiGui?: string | null;
  /** Link hủy nhận thật; bỏ trống = giữ {{link_huy_nhan}} để cổng gửi thay lúc gửi. */
  linkHuyNhan?: string;
  preheader?: string | null;
  /** Giá trị biến thay ngay (xem thử / gửi thử). Không truyền = giữ {{bien|dự phòng}}. */
  bien?: Record<string, string | null | undefined>;
};

/** Màu chữ/nút theo nhận diện TAKI (cam #F97316 / navy #0F2A4A); font hệ thống để Outlook không tải web font. */
const THEME = {
  font: { fontFamily: "Segoe UI", fallbackFontFamily: ["Helvetica", "Arial", "sans-serif"] },
  colors: { heading: "#0f2a4a", paragraph: "#1f2937", footer: "#6b7280", horizontal: "#e5e7eb" },
  fontSize: { paragraph: { size: "15px", lineHeight: "25px" }, footer: { size: "13px", lineHeight: "20px" } },
  container: { backgroundColor: "#ffffff", maxWidth: "600px", minWidth: "300px", paddingTop: "28px", paddingRight: "26px", paddingBottom: "20px", paddingLeft: "26px", borderRadius: "12px", borderWidth: "1px", borderColor: "#e5e7eb" },
  body: { backgroundColor: "#f3f4f6", paddingTop: "24px", paddingRight: "12px", paddingBottom: "4px", paddingLeft: "12px" },
  button: { backgroundColor: "#f97316", color: "#ffffff", paddingTop: "12px", paddingRight: "26px", paddingBottom: "12px", paddingLeft: "26px" },
  link: { color: "#1e40af" },
};

const giaTriBien = (bien: Record<string, string | null | undefined>) => {
  const v: Record<string, string> = {};
  for (const [k, val] of Object.entries(bien)) if (val !== null && val !== undefined && String(val).trim()) v[k] = String(val);
  if (!v.ten && v.ho_ten) v.ten = v.ho_ten;
  return v;
};

/** JSON khối → HTML hoàn chỉnh (bảng, MSO, footer hủy nhận). Ném lỗi khi JSON không qua kiemNoiDungKhoi. */
export async function renderEmailKhoi(json: KhoiJson, t: TuyChonRenderKhoi): Promise<string> {
  const kiem = kiemNoiDungKhoi(json);
  if (!kiem.ok) throw new Error(kiem.loi.join(" · "));
  const m = new Maily(json as unknown as JSONContent);
  m.setHtmlProps({ lang: "vi", dir: "ltr" });
  m.setTheme(THEME as Parameters<Maily["setTheme"]>[0]);
  m.setVariableFormatter(({ variable, fallback }) => (fallback ? `{{${variable}|${fallback}}}` : `{{${variable}}}`));
  if (t.preheader?.trim()) m.setPreviewText(t.preheader.trim());
  if (t.bien) m.setVariableValues(giaTriBien(t.bien));
  const html = await m.render();
  return themFooterBatBuoc(html, { tenGui: t.tenGui, diaChi: t.diaChiGui ?? undefined, linkHuyNhan: t.linkHuyNhan ?? "{{link_huy_nhan}}" });
}

const thoatHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Tài liệu kéo thả → HTML hoàn chỉnh (bảng, max-width 600, preheader ẩn, biến, footer hủy nhận bắt buộc). */
export async function renderEmailKeoTha(json: TaiLieuKeoTha, t: TuyChonRenderKhoi): Promise<string> {
  const kiem = kiemJsonKeoTha(json);
  if (!kiem.ok) throw new Error(kiem.loi.join(" · "));
  let html = renderToStaticMarkup(json as unknown as TReaderDocument, { rootBlockId: GOC });
  html = html.replace(/<html>/i, '<html lang="vi" dir="ltr">')
    .replace(/<head>\s*<\/head>/i, '<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="x-apple-disable-message-reformatting"/></head>');
  if (t.preheader?.trim()) {
    const pre = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${thoatHtml(t.preheader.trim())}${"&#847;&zwnj;&nbsp;".repeat(30)}</div>`;
    html = html.replace(/<body([^>]*)>/i, (m) => `${m}${pre}`);
  }
  if (t.bien) html = renderCaNhan(html, giaTriBien(t.bien));
  return themFooterBatBuoc(html, { tenGui: t.tenGui, diaChi: t.diaChiGui ?? undefined, linkHuyNhan: t.linkHuyNhan ?? "{{link_huy_nhan}}" });
}
