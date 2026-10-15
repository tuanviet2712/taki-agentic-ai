// Đợt H (nhánh 5) — 10 MẪU EMAIL KÉO THẢ hệ thống (JSON @usewaypoint/email-builder), cùng chủ đề 10 mẫu khối F2,
// giọng TAKI: xưng anh/chị, thực chiến, không gạch ngang dài, không hứa thu nhập, luôn có nút CTA, ≥4 mẫu dùng cột.
// Id khối TẤT ĐỊNH theo mã mẫu (seed chạy lại không sinh id mới). Chỗ phải điền để trong [NGOẶC].
import type { NhomMauKhoi } from "./mau-email-khoi.ts";
import { DEM_MAC_DINH, GOC, type KhoiKeoTha, type TaiLieuKeoTha } from "./email-keo-tha.ts";

export type MauEmailKeoTha = { ma: string; nhom: NhomMauKhoi; ten: string; tieuDe: string; preheader: string; noiDungKeoTha: TaiLieuKeoTha };

// ---------- bộ dựng ----------
type Muc = KhoiKeoTha | { cot: Muc[][]; gap?: number } | { khung: Muc[]; nen?: string };
const CAM = "#f97316", NAVY = "#0f2a4a", CHU = "#1f2937", MO = "#6b7280", VIEN = "#e5e7eb";
const dem = (top = 12, bottom = 12, left = 24, right = 24) => ({ top, bottom, left, right });

const h = (text: string, level: "h1" | "h2" | "h3" = "h2"): KhoiKeoTha => ({ type: "Heading", data: { props: { text, level }, style: { color: NAVY, textAlign: "left", fontWeight: "bold", padding: dem(20, 8) } } });
const p = (text: string): KhoiKeoTha => ({ type: "Text", data: { props: { text, markdown: true }, style: { color: CHU, fontSize: 15, fontWeight: "normal", textAlign: "left", padding: dem(6, 6) } } });
const pNho = (text: string, mau = MO): KhoiKeoTha => ({ type: "Text", data: { props: { text, markdown: true }, style: { color: mau, fontSize: 13, fontWeight: "normal", textAlign: "left", padding: dem(4, 4, 12, 12) } } });
const nut = (text: string, url: string, canGiua = false): KhoiKeoTha => ({ type: "Button", data: { props: { text, url, buttonBackgroundColor: CAM, buttonTextColor: "#ffffff", buttonStyle: "rounded", size: "medium", fullWidth: false }, style: { textAlign: canGiua ? "center" : "left", fontWeight: "bold", padding: dem(14, 14) } } });
const ke = (): KhoiKeoTha => ({ type: "Divider", data: { props: { lineColor: VIEN, lineHeight: 1 }, style: { padding: dem(10, 10) } } });
const cach = (height = 16): KhoiKeoTha => ({ type: "Spacer", data: { props: { height } } });
const chanTrang = (): KhoiKeoTha => ({ type: "Text", data: { props: { text: "**Nguyễn Tất Kiểm**  \nFounder TAKI Academy · Tỉnh trước. Tiền sau.", markdown: true }, style: { color: MO, fontSize: 12, fontWeight: "normal", textAlign: "left", padding: dem(12, 8) } } });
const so = (n: string, t: string): KhoiKeoTha => ({ type: "Text", data: { props: { text: `**${n}**  \n${t}`, markdown: true }, style: { color: CHU, fontSize: 14, fontWeight: "normal", textAlign: "left", padding: dem(8, 8, 12, 12) } } });
const cot = (...cacCot: Muc[][]): Muc => ({ cot: cacCot });
const khung = (nen: string, ...muc: Muc[]): Muc => ({ khung: muc, nen });

function dung(ma: string, tieuDe: string, muc: Muc[]): TaiLieuKeoTha {
  let soKhoi = 0;
  const doc: TaiLieuKeoTha = { [GOC]: { type: "EmailLayout", data: { backdropColor: "#f3f4f6", canvasColor: "#ffffff", textColor: CHU, fontFamily: "MODERN_SANS", borderColor: VIEN, borderRadius: 12, childrenIds: [] } } };
  const them = (m: Muc): string => {
    const id = `${ma}_${++soKhoi}`;
    if ("cot" in m) {
      const columns = [0, 1, 2].map((i) => ({ childrenIds: (m.cot[i] ?? []).map(them) }));
      doc[id] = { type: "ColumnsContainer", data: { props: { columnsCount: m.cot.length === 3 ? 3 : 2, columnsGap: m.gap ?? 16, contentAlignment: "top", columns }, style: { padding: { ...DEM_MAC_DINH, top: 8, bottom: 8 } } } };
    } else if ("khung" in m) {
      doc[id] = { type: "Container", data: { props: { childrenIds: m.khung.map(them) }, style: { backgroundColor: m.nen ?? "#fff7ed", borderColor: VIEN, borderRadius: 12, padding: { top: 8, bottom: 8, left: 12, right: 12 } } } };
    } else doc[id] = m;
    return id;
  };
  doc[GOC].data.childrenIds = muc.map(them);
  void tieuDe;
  return doc;
}

const TEN = "{{ho_ten|anh/chị}}";

export const MAU_EMAIL_KEO_THA: MauEmailKeoTha[] = [
  {
    ma: "kt-chao-mung", nhom: "chao_mung", ten: "Chào mừng vào danh sách (kéo thả)",
    tieuDe: "Chào mừng {{ho_ten|anh/chị}} đến với TAKI Academy",
    preheader: "Ba thứ anh/chị sẽ nhận, và một việc nên làm ngay hôm nay",
    noiDungKeoTha: dung("kt_chao_mung", "Chào mừng", [
      h(`Chào ${TEN}, anh/chị đã ở đúng chỗ.`),
      p("Tôi là Nguyễn Tất Kiểm, founder TAKI Academy. Thư này ngắn thôi, vì tôi biết chủ doanh nghiệp không có nhiều thời gian đọc email."),
      p("Ở đây anh/chị sẽ nhận được ba thứ:"),
      cot(
        [so("1. Bài học thực chiến", "Mỗi tuần một bài, rút từ việc đã làm với khách thật, không lý thuyết suông.")],
        [so("2. Công cụ dùng ngay", "Kịch bản chốt sale 4 bước, checklist phễu, bảng tính ngân sách quảng cáo.")],
        [so("3. Lời mời sớm", "Vào các buổi chia sẻ trực tuyến, chỗ ngồi có hạn.")],
      ),
      p("Việc đầu tiên nên làm: xem bản đồ phễu 4 tầng mà TAKI đang dùng cho chính mình. Đọc 6 phút, áp được trong tuần."),
      nut("Xem bản đồ phễu 4 tầng", "https://taki.vn/ban-do-pheu"),
      p("Có câu hỏi gì, anh/chị cứ trả lời thẳng thư này. Tôi đọc hết."),
      chanTrang(),
    ]),
  },
  {
    ma: "kt-tang-tai-lieu", nhom: "chao_mung", ten: "Tặng tài liệu đã đăng ký (kéo thả)",
    tieuDe: "Tài liệu anh/chị vừa đăng ký đây",
    preheader: "Checklist 21 điểm kiểm tra phễu, kèm cách dùng cho nhanh",
    noiDungKeoTha: dung("kt_tang_tai_lieu", "Tặng tài liệu", [
      h(`Tài liệu của ${TEN} đây`),
      p("Như đã hứa, đây là bộ **Checklist 21 điểm kiểm tra phễu bán khoá học** mà đội TAKI đi qua trước mỗi lần bật quảng cáo."),
      nut("Tải checklist", "https://taki.vn/tai-lieu/checklist-pheu"),
      khung("#fff7ed",
        pNho("**Cách dùng cho nhanh:** in ra, đi từng dòng với phễu hiện tại của anh/chị, đánh dấu chỗ chưa có. Thường sau 20 phút sẽ lộ ra vài lỗ hổng mà trước giờ không để ý.", CHU),
      ),
      p("Ngày mai tôi gửi tiếp cách vá lỗ hổng phổ biến nhất: trang cảm ơn để trống, khách đăng ký xong không biết làm gì tiếp."),
      chanTrang(),
    ]),
  },
  {
    ma: "kt-moi-webinar", nhom: "webinar", ten: "Mời webinar (kéo thả)",
    tieuDe: "Mời anh/chị: Xây phễu bán khoá học bằng AI, [thứ Năm] 20:00",
    preheader: "90 phút làm trực tiếp trên màn hình, có hỏi đáp, miễn phí",
    noiDungKeoTha: dung("kt_moi_webinar", "Mời webinar", [
      h("[Thứ Năm] tuần này, 20:00: tôi mở màn hình dựng phễu trực tiếp"),
      p("Trong 90 phút, tôi dựng một phễu bán khoá học từ trang đầu tới chuỗi email theo sau, ngay trên màn hình, bằng bộ công cụ AI mà TAKI đang dùng hằng ngày."),
      cot(
        [so("Thời gian", "[Thứ Năm, ngày/tháng] · 20:00 đến 21:30 (giờ Việt Nam)")],
        [so("Hình thức", "Trực tuyến qua Zoom · có phần hỏi đáp trực tiếp · miễn phí")],
      ),
      p("Anh/chị sẽ thấy rõ: cách chọn sản phẩm mở ví đầu tiên, cấu trúc trang đăng ký đạt tỷ lệ cao, và chuỗi 5 email theo sau mà không cần biết code."),
      nut("Giữ chỗ cho tôi", "https://taki.vn/webinar/dang-ky", true),
      pNho("Phòng giới hạn 300 người. Đăng ký xong anh/chị nhận link vào phòng riêng, không chia sẻ được."),
      chanTrang(),
    ]),
  },
  {
    ma: "kt-nhac-webinar-1h", nhom: "webinar", ten: "Nhắc webinar còn 1 giờ (kéo thả)",
    tieuDe: "Còn 1 giờ nữa: phòng mở lúc 19:50",
    preheader: "Link vào phòng của riêng anh/chị ở trong thư",
    noiDungKeoTha: dung("kt_nhac_webinar", "Nhắc 1 giờ", [
      h(`${TEN} ơi, còn 1 giờ nữa là bắt đầu`, "h3"),
      p("Phòng mở lúc **19:50**, buổi bắt đầu đúng **20:00**. Anh/chị chuẩn bị sẵn giấy bút, vì phần dựng phễu trực tiếp đi khá nhanh."),
      nut("Vào phòng ngay", "https://taki.vn/webinar/vao", true),
      ke(),
      pNho("Link này gắn với email của anh/chị để điểm danh, đừng chuyển tiếp cho người khác. Không vào được thì trả lời thư này, đội TAKI hỗ trợ trong 5 phút."),
      chanTrang(),
    ]),
  },
  {
    ma: "kt-mo-ban", nhom: "ban_hang", ten: "Mở bán (kéo thả)",
    tieuDe: "Mở đăng ký [TÊN KHOÁ]: 5 ngày, [SỐ] chỗ",
    preheader: "Dành cho chủ doanh nghiệp muốn tự xây phễu bằng AI trong 6 tuần",
    noiDungKeoTha: dung("kt_mo_ban", "Mở bán", [
      h("Hôm nay tôi mở đăng ký [TÊN KHOÁ]"),
      p(`${TEN} đã theo dõi loạt thư tuần qua, nên tôi nói thẳng: khoá này dành cho người muốn **tự tay** dựng hệ thống bán khoá học bằng AI, không thuê ngoài, không phụ thuộc kỹ thuật.`),
      cot(
        [khung("#f8fafc", so("Gói Tự học", "[GIÁ] · 6 tuần · toàn bộ bài giảng và bộ mẫu phễu, email, quảng cáo."))],
        [khung("#fff7ed", so("Gói Có mentor", "[GIÁ] · như Tự học + 6 buổi sửa bài trực tiếp với đội TAKI."))],
      ),
      p("Đăng ký mở trong **5 ngày**, nhận **[SỐ] chỗ** cho gói Có mentor vì đội sửa bài chỉ kham được chừng đó."),
      nut("Xem chi tiết và đăng ký", "https://taki.vn/khoa-hoc"),
      p("Anh/chị còn phân vân điểm nào, trả lời thư này, tôi trả lời trong ngày."),
      chanTrang(),
    ]),
  },
  {
    ma: "kt-dong-ban-24h", nhom: "ban_hang", ten: "Đóng bán còn 24 giờ (kéo thả)",
    tieuDe: "Còn 24 giờ: đóng đăng ký [TÊN KHOÁ]",
    preheader: "Sau 23:59 ngày mai, gói Có mentor đóng hẳn tới đợt sau",
    noiDungKeoTha: dung("kt_dong_ban", "Đóng bán", [
      h("Còn 24 giờ, rồi đóng"),
      p(`${TEN}, đúng 23:59 ngày mai tôi đóng đăng ký [TÊN KHOÁ]. Không gia hạn, vì lớp sau đã có lịch riêng.`),
      p("Ba câu hỏi tôi nhận nhiều nhất hai ngày qua:"),
      p("**Tôi không biết code, học được không?** Được. Toàn bộ khoá không cần gõ một dòng code.\n\n**Bận quá, không theo kịp thì sao?** Bài giảng xem lại không giới hạn, mentor sửa bài theo tiến độ của anh/chị.\n\n**Học xong có chắc bán được không?** Tôi không hứa doanh số. Tôi hứa anh/chị có một hệ thống chạy được, và biết cách sửa nó."),
      nut("Giữ chỗ trước khi đóng", "https://taki.vn/khoa-hoc", true),
      chanTrang(),
    ]),
  },
  {
    ma: "kt-sau-mua", nhom: "cham_soc", ten: "Sau mua: bước đầu tiên (kéo thả)",
    tieuDe: "Cảm ơn anh/chị. Bước đầu tiên làm trong 15 phút",
    preheader: "Tài khoản đã mở, bài 1 đã sẵn, và một việc nhỏ nên làm ngay",
    noiDungKeoTha: dung("kt_sau_mua", "Sau mua", [
      h(`Cảm ơn ${TEN} đã tin TAKI`),
      p("Tài khoản học đã mở. Đừng cố xem hết trong một tối. Hãy làm đúng ba bước này trước:"),
      cot(
        [so("Bước 1 · 5 phút", "Đăng nhập, đổi mật khẩu, lưu link lớp học vào thanh dấu trang.")],
        [so("Bước 2 · 10 phút", "Xem bài 1, điền bảng «Sản phẩm mở ví» ngay trong bài.")],
        [so("Bước 3 · 1 câu", "Trả lời thư này: anh/chị đang bán gì, cho ai. Tôi đọc để mentor bám đúng.")],
      ),
      nut("Vào lớp học", "https://taki.vn/hoc"),
      chanTrang(),
    ]),
  },
  {
    ma: "kt-ban-tin", nhom: "ban_tin", ten: "Bản tin tuần (kéo thả)",
    tieuDe: "Tuần này ở TAKI: [CHỦ ĐỀ CHÍNH]",
    preheader: "Một chuyện thật, một bài học, một việc nên thử",
    noiDungKeoTha: dung("kt_ban_tin", "Bản tin", [
      h("Bản tin TAKI tuần [SỐ]"),
      p(`Chào ${TEN}. Tuần này tôi kể một chuyện thật từ buổi coaching với một chủ shop mỹ phẩm: [TÓM TẮT CHUYỆN 2 CÂU].`),
      cot(
        [so("Bài học", "[MỘT BÀI HỌC NGẮN, CỤ THỂ, ÁP DỤNG ĐƯỢC TRONG TUẦN]")],
        [so("Việc nên thử", "[MỘT VIỆC NHỎ LÀM ĐƯỢC TRONG 30 PHÚT]")],
      ),
      ke(),
      p("Đọc thêm bài đầy đủ, có ảnh chụp số liệu thật:"),
      nut("Đọc bài tuần này", "https://taki.vn/blog"),
      chanTrang(),
    ]),
  },
  {
    ma: "kt-phuc-hoi-gio-hang", nhom: "cham_soc", ten: "Phục hồi giỏ hàng (kéo thả)",
    tieuDe: "Anh/chị để quên [TÊN SẢN PHẨM] trong giỏ",
    preheader: "Đơn còn giữ 48 giờ, thanh toán lại chỉ mất 1 phút",
    noiDungKeoTha: dung("kt_phuc_hoi_gio", "Phục hồi giỏ", [
      h(`${TEN} để quên một thứ trong giỏ`, "h3"),
      p("Hôm qua anh/chị đã chọn **[TÊN SẢN PHẨM]** nhưng chưa hoàn tất thanh toán. Có thể mạng chập chờn, có thể anh/chị còn cân nhắc. Cả hai đều bình thường."),
      khung("#f8fafc",
        pNho("Đơn còn giữ nguyên giá trong **48 giờ**. Quét mã QR ở trang thanh toán, tiền về là tài khoản mở ngay, không chờ duyệt tay.", CHU),
      ),
      nut("Hoàn tất thanh toán", "https://taki.vn/mua"),
      p("Nếu anh/chị dừng vì còn câu hỏi, trả lời thư này, tôi trả lời thẳng, không ép mua."),
      chanTrang(),
    ]),
  },
  {
    ma: "kt-xin-danh-gia", nhom: "cham_soc", ten: "Xin đánh giá (kéo thả)",
    tieuDe: "Xin anh/chị 2 phút: khoá học giúp được gì?",
    preheader: "Ba câu hỏi ngắn, dùng để sửa khoá cho lớp sau",
    noiDungKeoTha: dung("kt_xin_danh_gia", "Xin đánh giá", [
      h(`${TEN} đã đi được nửa chặng`, "h3"),
      p("Tôi muốn nghe thật, kể cả chê. Ba câu, 2 phút:"),
      p("1. Bài nào giúp anh/chị nhiều nhất?\n2. Chỗ nào khó hiểu hoặc thừa?\n3. Anh/chị đã làm được việc gì mới nhờ khoá này?"),
      nut("Gửi nhận xét", "https://taki.vn/danh-gia", true),
      pNho("Nhận xét được dùng để sửa khoá cho lớp sau. Nếu anh/chị đồng ý cho đăng công khai, tôi sẽ hỏi lại riêng, không tự ý dùng."),
      chanTrang(),
    ]),
  },
];

export const timMauEmailKeoTha = (ma: string): MauEmailKeoTha | null => MAU_EMAIL_KEO_THA.find((m) => m.ma === ma) ?? null;
