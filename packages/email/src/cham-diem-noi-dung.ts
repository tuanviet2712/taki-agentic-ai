// GĐ2 Đợt 12 — F-068 (lát mỏng dùng chung) + F-110 chấm điểm chuỗi trước khi kích hoạt.
// Phần ĐO ĐƯỢC chấm thuần ở đây (test được); phần cảm quan (hook, giọng) do AI chấm bổ sung.

export const NGUONG_DAT = 70;          // điểm tối thiểu để kích hoạt
export const TOI_DA_VONG_SUA = 3;      // dưới ngưỡng: tự sửa tối đa 3 vòng

export type EmailChua = { vi_tri: number; vai_tro: string; tieu_de: string; noi_dung: string; cam_cta_ban: boolean };
export type DiemEmail = {
  tong: number;
  tieu_de: number; cau_truc: number; cta: number; vai_tro: number;
  loi: string[];
};

const MAU_CTA = /(đăng ký|xem ngay|mua ngay|nhận ngay|tham gia|đặt lịch|bấm vào|tại đây|nhấn vào|giữ chỗ|vào học|thanh toán)/i;

/** Tách từ có nghĩa (bỏ dấu câu, từ dừng ngắn) để so trùng ý giữa các email. */
export function tachTu(text: string): string[] {
  const DUNG = new Set(["của", "và", "là", "có", "cho", "với", "được", "này", "đó", "một", "các", "những", "bạn", "anh", "chị", "em", "thì", "mà", "khi", "nếu", "để", "trong", "trên", "từ", "về", "như", "đã", "sẽ", "còn", "rất", "cũng", "nên"]);
  return text.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).filter((t) => t.length >= 3 && !DUNG.has(t));
}

/** Độ trùng ý giữa hai đoạn: Jaccard trên tập bigram từ (0 = khác hẳn, 1 = trùng khít). */
export function doTrungY(a: string, b: string): number {
  const bi = (t: string) => { const tu = tachTu(t); return new Set(tu.slice(0, -1).map((x, i) => `${x} ${tu[i + 1]}`)); };
  const A = bi(a), B = bi(b);
  if (!A.size || !B.size) return 0;
  let chung = 0;
  for (const x of A) if (B.has(x)) chung++;
  return chung / (A.size + B.size - chung);
}

/**
 * F-068 cấp EMAIL (phần đo được, 100 điểm): tiêu đề 25 · cấu trúc 30 · CTA 25 · đúng vai trò 20.
 * Trả kèm danh sách lỗi để vòng tự sửa nhắm đúng tiêu chí yếu.
 */
export function chamEmail(e: EmailChua): DiemEmail {
  const loi: string[] = [];
  // Tiêu đề: 8–70 ký tự, không TOÀN HOA, không quá nhiều dấu !
  let tieuDe = 25;
  const td = e.tieu_de.trim();
  if (td.length < 8) { tieuDe -= 15; loi.push("Tiêu đề quá ngắn (<8 ký tự)."); }
  else if (td.length > 70) { tieuDe -= 8; loi.push("Tiêu đề dài quá 70 ký tự — dễ bị cắt trên mobile."); }
  if (td === td.toUpperCase() && /\p{L}/u.test(td)) { tieuDe -= 10; loi.push("Tiêu đề viết TOÀN HOA — dễ vào spam."); }
  if ((td.match(/!/g) ?? []).length > 1) { tieuDe -= 5; loi.push("Tiêu đề nhiều dấu chấm than."); }

  // Cấu trúc: độ dài thân, có xuống dòng thành đoạn
  let cauTruc = 30;
  const tu = tachTu(e.noi_dung).length;
  const doan = e.noi_dung.split(/\n\s*\n|\n/).filter((d) => d.trim().length > 20).length;
  if (tu < 60) { cauTruc -= 18; loi.push("Thân email quá ngắn (<60 từ có nghĩa)."); }
  else if (tu > 700) { cauTruc -= 8; loi.push("Thân email quá dài (>700 từ)."); }
  if (doan < 2) { cauTruc -= 10; loi.push("Thiếu bố cục đoạn — nên tách ít nhất 2 đoạn."); }

  // CTA: đúng vai trò cấm/không cấm
  let cta = 25;
  const coCta = MAU_CTA.test(e.noi_dung);
  if (e.cam_cta_ban && coCta) { cta -= 25; loi.push("Tập này cấm CTA bán nhưng vẫn có lời kêu gọi mua/đăng ký."); }
  if (!e.cam_cta_ban && !coCta) { cta -= 15; loi.push("Thiếu CTA rõ ràng."); }

  // Đúng vai trò trong chuỗi: nội dung phải nhắc từ khóa của vai trò
  let vaiTro = 20;
  const goiY: Record<string, RegExp> = {
    giao_hang: /(truy cập|đăng nhập|nhận|hướng dẫn|bắt đầu)/i,
    thang_nhanh: /(bước|checklist|24 giờ|hôm nay|làm ngay)/i,
    case_study: /(học viên|khách hàng|câu chuyện|kết quả)/i,
    cau_noi_core: /(bước tiếp|giải pháp|hệ thống|nâng cấp|core)/i,
    moi_dang_ky: /(đăng ký|giữ chỗ|buổi|webinar|suất)/i,
    nhac_tham_du: /(sắp|giờ|nhắc|link vào|phòng)/i,
    gui_replay: /(replay|xem lại|bản ghi|hạn)/i,
    mo_gio: /(mở|ưu đãi|gói|đăng ký ngay|giỏ)/i,
    dong_gio: /(đóng|hết hạn|cuối cùng|kết thúc)/i,
  };
  const mau = goiY[e.vai_tro];
  if (mau && !mau.test(`${e.tieu_de} ${e.noi_dung}`)) {
    vaiTro -= 12;
    loi.push(`Nội dung chưa thể hiện vai trò «${e.vai_tro}» của tập này trong chuỗi.`);
  }

  const tong = Math.max(0, Math.min(100, tieuDe + cauTruc + cta + vaiTro));
  return { tong, tieu_de: Math.max(0, tieuDe), cau_truc: Math.max(0, cauTruc), cta: Math.max(0, cta), vai_tro: Math.max(0, vaiTro), loi };
}

export type DiemChuoi = {
  tong: number; mach: number; lap_y: number; phan_bo_cta: number;
  loi: string[]; cap_email_dat: boolean; email_yeu: number[];
};

/**
 * F-110 cấp CHUỖI (100 điểm): mạch liền 35 · không lặp ý 35 · phân bố CTA hợp lý 30.
 * Kích hoạt CHỈ mở khi mọi email đạt VÀ điểm chuỗi đạt (hai tầng).
 */
export function chamChuoi(ds: EmailChua[], diemEmail: DiemEmail[]): DiemChuoi {
  const loi: string[] = [];
  const emailYeu = diemEmail.map((d, i) => ({ d, i })).filter((x) => x.d.tong < NGUONG_DAT).map((x) => ds[x.i]?.vi_tri ?? x.i);

  // Mạch liền: có đủ tập, thứ tự vai trò không trống, độ dài không nhảy vọt
  let mach = 35;
  if (ds.length < 3) { mach -= 20; loi.push("Chuỗi quá ngắn để tạo mạch câu chuyện (<3 tập)."); }
  const trong = ds.filter((e) => !e.noi_dung.trim() || !e.tieu_de.trim()).length;
  if (trong) { mach -= Math.min(25, trong * 10); loi.push(`${trong} tập chưa có nội dung/tiêu đề.`); }

  // Lặp ý: mọi cặp có độ trùng > 0.35 → trừ điểm
  let lapY = 35;
  const capTrung: string[] = [];
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const t = doTrungY(ds[i].noi_dung, ds[j].noi_dung);
      if (t > 0.35) capTrung.push(`tập ${ds[i].vi_tri + 1} ↔ ${ds[j].vi_tri + 1} (${Math.round(t * 100)}%)`);
    }
  }
  if (capTrung.length) {
    lapY -= Math.min(35, capTrung.length * 15);
    loi.push(`Lặp ý giữa các bản: ${capTrung.join(", ")}.`);
  }

  // Phân bố CTA: các tập cấm bán phải sạch CTA; phần còn lại ≥ 60% có CTA
  let phanBo = 30;
  const cam = ds.filter((e) => e.cam_cta_ban);
  const viPhamCam = cam.filter((e) => MAU_CTA.test(e.noi_dung)).length;
  if (viPhamCam) { phanBo -= Math.min(20, viPhamCam * 10); loi.push(`${viPhamCam} tập cấm bán nhưng có CTA.`); }
  const banDuoc = ds.filter((e) => !e.cam_cta_ban);
  const coCta = banDuoc.filter((e) => MAU_CTA.test(e.noi_dung)).length;
  if (banDuoc.length && coCta / banDuoc.length < 0.6) {
    phanBo -= 12;
    loi.push("Quá ít tập có CTA ở nửa sau chuỗi — mạch bán bị hụt.");
  }

  const tong = Math.max(0, Math.min(100, mach + lapY + phanBo));
  return {
    tong, mach: Math.max(0, mach), lap_y: Math.max(0, lapY), phan_bo_cta: Math.max(0, phanBo),
    loi, cap_email_dat: emailYeu.length === 0, email_yeu: emailYeu,
  };
}

/** Điều kiện MỞ nút kích hoạt: hai tầng cùng đạt (mọi email ≥ ngưỡng và điểm chuỗi ≥ ngưỡng). */
export function duocKichHoat(dc: DiemChuoi): { duoc: boolean; lyDo?: string } {
  if (!dc.cap_email_dat) return { duoc: false, lyDo: `Còn ${dc.email_yeu.length} email dưới ngưỡng (tập ${dc.email_yeu.map((v) => v + 1).join(", ")}).` };
  if (dc.tong < NGUONG_DAT) return { duoc: false, lyDo: `Điểm cấp chuỗi ${dc.tong}/100 < ngưỡng ${NGUONG_DAT}.` };
  return { duoc: true };
}
