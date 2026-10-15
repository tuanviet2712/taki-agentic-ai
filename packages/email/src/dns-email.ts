// F-028 — Đọc và ĐÁNH GIÁ bản ghi SPF / DKIM / DMARC. THUẦN, test được.
// Trước Đợt 29 chỉ kiểm «có bản ghi TXT hay không»: domain có SPF nhưng thiếu include của nhà
// cung cấp gửi vẫn được báo ĐẠT, thư vào spam mà bảng điều khiển vẫn xanh.

export type MucDat = "dat" | "canh_bao" | "thieu";
export type KetQuaBanGhi = { muc: MucDat; chiTiet: string; giaTri?: string };

/** Nhà cung cấp gửi hiện dùng và chuỗi include phải có trong SPF. */
export const INCLUDE_NHA_CUNG_CAP: Record<string, string[]> = {
  resend: ["amazonses.com", "_spf.resend.com", "spf.resend.com"],
  sendgrid: ["sendgrid.net"],
  mailgun: ["mailgun.org"],
  ses: ["amazonses.com"],
};

const layTxt = (ds: string[], dauHieu: string): string | undefined => ds.find((t) => t.trim().toLowerCase().startsWith(dauHieu));

/**
 * SPF: phải có đúng MỘT bản ghi v=spf1, có include của nhà cung cấp đang dùng, và kết thúc bằng
 * ~all hoặc -all (+all coi như không bảo vệ gì).
 */
export function danhGiaSpf(txt: string[], nhaCungCap = "resend"): KetQuaBanGhi {
  const ds = txt.filter((t) => t.trim().toLowerCase().startsWith("v=spf1"));
  if (!ds.length) return { muc: "thieu", chiTiet: "Chưa có bản ghi SPF (v=spf1)." };
  if (ds.length > 1) return { muc: "canh_bao", chiTiet: `Có ${ds.length} bản ghi SPF — chuẩn chỉ cho phép một, các nhà cung cấp sẽ coi là lỗi permerror.`, giaTri: ds[0] };
  const spf = ds[0].trim();
  const thap = spf.toLowerCase();
  const can = INCLUDE_NHA_CUNG_CAP[nhaCungCap] ?? [];
  const coInclude = can.length === 0 || can.some((c) => thap.includes(c.toLowerCase()));
  const duoi = /[~\-+?]all\b/.exec(thap)?.[0];
  if (!coInclude) return { muc: "canh_bao", chiTiet: `SPF chưa uỷ quyền cho ${nhaCungCap} — thêm «include:${can[0]}» vào bản ghi, nếu không thư gửi qua ${nhaCungCap} sẽ trượt SPF.`, giaTri: spf };
  if (!duoi) return { muc: "canh_bao", chiTiet: "SPF thiếu cơ chế kết thúc (~all hoặc -all) — nơi nhận sẽ không biết phải làm gì với thư giả mạo.", giaTri: spf };
  if (duoi === "+all") return { muc: "canh_bao", chiTiet: "SPF đang là «+all» — cho phép BẤT KỲ ai gửi thay domain của bạn. Đổi sang ~all hoặc -all.", giaTri: spf };
  return { muc: "dat", chiTiet: `SPF hợp lệ, đã uỷ quyền cho ${nhaCungCap} và kết thúc bằng «${duoi}».`, giaTri: spf };
}

/** DKIM: bản ghi selector phải có khoá công khai p= không rỗng. */
export function danhGiaDkim(txt: string[], selector = "resend"): KetQuaBanGhi {
  const bg = layTxt(txt, "v=dkim1") ?? txt[0];
  if (!bg) return { muc: "thieu", chiTiet: `Chưa có bản ghi DKIM tại «${selector}._domainkey» — thư sẽ không có chữ ký.` };
  const p = /(?:^|;)\s*p\s*=\s*([^;]*)/i.exec(bg)?.[1]?.trim();
  if (!p) return { muc: "canh_bao", chiTiet: "Bản ghi DKIM không có khoá công khai (p=).", giaTri: bg };
  if (p.length < 100) return { muc: "canh_bao", chiTiet: "Khoá DKIM đã bị THU HỒI (p= rỗng hoặc quá ngắn) — nhà cung cấp coi như chưa ký.", giaTri: bg };
  return { muc: "dat", chiTiet: `DKIM hợp lệ tại selector «${selector}».`, giaTri: bg };
}

/** DMARC: có bản ghi và chính sách. p=none chỉ để quan sát, chưa bảo vệ được gì. */
export function danhGiaDmarc(txt: string[]): KetQuaBanGhi & { chinhSach: "none" | "quarantine" | "reject" | null } {
  const bg = layTxt(txt, "v=dmarc1");
  if (!bg) return { muc: "thieu", chiTiet: "Chưa có bản ghi DMARC tại «_dmarc» — Gmail và Yahoo hạ uy tín người gửi hàng loạt không có DMARC.", chinhSach: null };
  const p = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(bg)?.[1]?.toLowerCase() as "none" | "quarantine" | "reject" | undefined;
  if (!p) return { muc: "canh_bao", chiTiet: "Bản ghi DMARC thiếu chính sách p=.", giaTri: bg, chinhSach: null };
  if (p === "none") return { muc: "canh_bao", chiTiet: "DMARC đang ở «p=none» — chỉ quan sát, chưa chặn ai giả mạo domain. Chuyển dần sang quarantine khi báo cáo đã sạch.", giaTri: bg, chinhSach: p };
  return { muc: "dat", chiTiet: `DMARC đang ở «p=${p}» — đã bảo vệ domain.`, giaTri: bg, chinhSach: p };
}

/** Tổng kết cho bảng điều khiển: chỉ ĐẠT khi cả ba đều đạt. */
export function tongKetXacThuc(v: { spf: KetQuaBanGhi; dkim: KetQuaBanGhi; dmarc: KetQuaBanGhi }): {
  dat: boolean; canSua: string[];
} {
  const canSua = [
    v.spf.muc !== "dat" ? `SPF: ${v.spf.chiTiet}` : null,
    v.dkim.muc !== "dat" ? `DKIM: ${v.dkim.chiTiet}` : null,
    v.dmarc.muc !== "dat" ? `DMARC: ${v.dmarc.chiTiet}` : null,
  ].filter((x): x is string => !!x);
  return { dat: canSua.length === 0, canSua };
}
