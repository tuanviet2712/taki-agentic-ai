// F-023/F-024 — Render email HTML chuẩn thương hiệu: footer BẮT BUỘC (định danh người gửi + link hủy đăng ký,
// không xóa được vì thêm lúc render), bọc link để đo click, kiểm CTA bán cứng cho các tập đầu Soap Opera (F-102).
type BienVanBan = Record<string, string | null | undefined>;

const thoat = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Văn bản thuần (đoạn cách nhau dòng trống, URL tự thành link) → HTML email đơn giản, an toàn. */
export function vanBanSangHtml(text: string): string {
  return text.trim().split(/\n{2,}/).map((doan) => {
    const dong = thoat(doan).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2563eb">$1</a>').replace(/\n/g, "<br/>");
    return `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#1f2937">${dong}</p>`;
  }).join("\n");
}

export type TuyChonRender = {
  tieuDe: string;
  noiDung: string;             // văn bản thuần (có thể chứa URL)
  preheader?: string | null;
  tenNguoiGui: string;         // định danh người gửi (bắt buộc — F-024)
  linkHuy: string;             // link hủy đăng ký (bắt buộc — footer không xóa được)
  mauChinh?: string;
};

/** Render email hoàn chỉnh. Footer định danh + hủy đăng ký LUÔN được chèn lúc render (tiêu chí F-024). */
/**
 * Khung email dựng bằng BẢNG (table) chứ không phải div.
 * Outlook trên Windows render bằng engine của Word: div + max-width bị bỏ qua, khối tràn hết chiều
 * ngang và nút mất bo góc. Bảng cố định bề rộng là cách duy nhất chạy đúng trên mọi client.
 * Khối MSO (điều kiện <!--[if mso]>) đặt lại bề rộng riêng cho Outlook.
 */
export function renderEmail(t: TuyChonRender): string {
  const nen = "#f3f4f6", the = "#ffffff", vien = "#e5e7eb", chu = "#1f2937", mo = "#6b7280";
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
  return `<!doctype html>
<html lang="vi" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<meta name="color-scheme" content="light dark"/>
<title>${thoat(t.tieuDe)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  @media only screen and (max-width:600px){
    .khung{width:100%!important}
    .dem{padding:20px 16px!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${nen};-webkit-font-smoothing:antialiased">
${t.preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${thoat(t.preheader)}</div><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${nen}">
<tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="khung" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background:${the};border:1px solid ${vien};border-radius:12px">
  <tr><td class="dem" style="padding:28px 26px;font-family:${font}">
    <h1 style="margin:0 0 16px;font-size:19px;line-height:1.35;color:#111827;font-weight:700">${thoat(t.tieuDe)}</h1>
    ${vanBanSangHtml(t.noiDung)}
  </td></tr>
</table>
<table role="presentation" class="khung" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px">
  <tr><td style="padding:14px 26px 0;text-align:center;font-family:${font};font-size:12px;line-height:1.6;color:${mo}">
    Thư gửi từ ${thoat(t.tenNguoiGui)}.<br/>
    Không muốn nhận nữa? <a href="${t.linkHuy}" style="color:${mo};text-decoration:underline">Hủy đăng ký tại đây</a>.
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body></html>`.replace(/\n\s*\n/g, "\n");
}

/**
 * Nút CTA dạng bảng — «bulletproof button»: Outlook không hiểu padding trên thẻ <a>, phải bọc
 * trong ô bảng có bo góc riêng thì nút mới ra hình khối ở mọi client.
 */
export function nutCta(nhan: string, url: string, mau = "#2563eb"): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0">
<tr><td align="center" bgcolor="${mau}" style="border-radius:8px">
<a href="${url}" style="display:inline-block;padding:12px 24px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${thoat(nhan)}</a>
</td></tr></table>`;
}


/** F-102: kiểm tự động CTA bán cứng cho các tập cấm bán (tập 1–2 của Soap Opera). */
const MAU_CTA_BAN = /(mua ngay|đặt hàng|thanh toán|chốt đơn|giá chỉ|ưu đãi kết thúc|giảm \d+%|đăng ký mua|link thanh toán|bấm mua)/i;
export function kiemCtaBan(text: string): string[] {
  const khop = text.match(new RegExp(MAU_CTA_BAN.source, "gi"));
  return khop ? [...new Set(khop.map((k) => k.toLowerCase()))] : [];
}

/** Bọc mọi URL trong nội dung bằng link đo click (map url → url ngắn). Trả nội dung mới. */
export function bocLinkDoClick(text: string, doi: (url: string) => string): string {
  return text.replace(/https?:\/\/[^\s<)]+/g, (url) => doi(url));
}

/** Trích các URL trong nội dung (để tạo short link trước khi bọc). */
export function trichUrl(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<)]+/g) ?? [])];
}

// ---------- GĐ2 Đợt 9 · F-025 — cá nhân hóa biến động ----------
export type BoiCanhRender = { daMua?: boolean; the?: string[] };

function khopDieuKien(dk: string, bc: BoiCanhRender): boolean {
  if (dk === "da_mua") return !!bc.daMua;
  if (dk === "chua_mua") return !bc.daMua;
  if (dk.startsWith("the:")) return (bc.the ?? []).includes(dk.slice(4));
  return false;
}

/**
 * F-025: render từng người tại thời điểm gửi — {{bien|dự phòng}} + khối điều kiện
 * [[neu:da_mua]]…[[khac]]…[[het]] (điều kiện: da_mua / chua_mua / the:<tên thẻ>).
 * Biến thiếu giá trị VÀ không có dự phòng thì GIỮ NGUYÊN để soatBien chặn gửi.
 */
export function renderCaNhan(text: string, bien: Record<string, string | number | null | undefined>, boiCanh: BoiCanhRender = {}): string {
  let kq = text.replace(/\[\[neu:([a-z_0-9:-]+)\]\]([\s\S]*?)(?:\[\[khac\]\]([\s\S]*?))?\[\[het\]\]/gi,
    (_g, dk: string, coA: string, coB?: string) => (khopDieuKien(dk, boiCanh) ? coA : (coB ?? "")));
  kq = kq.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|([^}]*))?\}\}/gi, (goc, ten: string, duPhong?: string) => {
    const v = bien[ten];
    if (v !== null && v !== undefined && String(v).trim()) return String(v);
    return duPhong !== undefined ? duPhong : goc;
  });
  return kq;
}

/** F-025: biến KHÔNG có dự phòng và không có giá trị → danh sách lỗi (chặn gửi chiến dịch). */
export function soatBien(text: string, bien: Record<string, string | number | null | undefined>): string[] {
  const loi = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi)) {
    const v = bien[m[1]];
    if (v === null || v === undefined || !String(v).trim()) loi.add(m[1]);
  }
  return [...loi];
}
