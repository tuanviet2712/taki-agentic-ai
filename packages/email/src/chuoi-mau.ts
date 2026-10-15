// F-102 + F-109 — Cấu trúc vai trò từng tập của loại chuỗi (Soap Opera GĐ1; các loại khác GĐ2)
// và schema đầu ra AI cho máy sinh trọn chuỗi.
import { z } from "zod";

export type VaiTroTap = {
  vaiTro: string;
  ten: string;
  nhiemVu: string;       // đưa vào prompt cho AI (F-109: sinh đúng nhiệm vụ từng tập)
  choNgay: number;       // gửi sau N ngày kể từ email trước
  camCtaBan: boolean;    // F-102: các tập đầu cấm CTA bán cứng (kiểm tự động)
};

export const SOAP_OPERA: VaiTroTap[] = [
  { vaiTro: "giao_qua", ten: "Tập 1 · Giao quà + móc câu chuyện", choNgay: 0, camCtaBan: true,
    nhiemVu: "Giao quà/xác nhận đã nhận, cảm ơn; hé lộ một câu chuyện sẽ kể ở thư sau (cliffhanger). TUYỆT ĐỐI không chào bán, không nhắc giá." },
  { vaiTro: "dong_cam", ten: "Tập 2 · Câu chuyện đồng cảm", choNgay: 1, camCtaBan: true,
    nhiemVu: "Kể câu chuyện thật tạo đồng cảm: bối cảnh khó khăn và «vực sâu» — đúng nỗi đau của chân dung khách trong DNA. Kết bằng móc sang thư sau. Không chào bán." },
  { vaiTro: "pha_niem_tin", ten: "Tập 3 · Phá niềm tin sai", choNgay: 1, camCtaBan: false,
    nhiemVu: "Chỉ ra MỘT niềm tin sai phổ biến của thị trường khiến khách kẹt (lấy từ phản đối trong DNA), phá bằng lập luận + ví dụ. Nhắc nhẹ rằng có cách làm khác." },
  { vaiTro: "epiphany", ten: "Tập 4 · Mở giải pháp (epiphany)", choNgay: 1, camCtaBan: false,
    nhiemVu: "Khoảnh khắc «à ra thế»: trình bày cơ chế/giải pháp cốt lõi mà sản phẩm đại diện; nối giải pháp với sản phẩm một cách tự nhiên, mời tìm hiểu." },
  { vaiTro: "chao_ban_1", ten: "Tập 5 · Chào bán + deadline", choNgay: 1, camCtaBan: false,
    nhiemVu: "Chào bán trực tiếp sản phẩm với lời hứa từ hồ sơ, nêu deadline ưu đãi (dùng chữ «trong hạn ưu đãi của bạn» — deadline thật do hệ thống quản). CTA rõ ràng." },
  { vaiTro: "chao_ban_2", ten: "Tập 6 · Xử lý phản đối + CTA", choNgay: 1, camCtaBan: false,
    nhiemVu: "Trả lời 2–3 phản đối lớn nhất (từ hồ sơ sản phẩm/DNA) dạng hỏi–đáp ngắn, kết bằng CTA và nhắc hạn ưu đãi." },
  { vaiTro: "dong_gio", ten: "Tập 7 · Đóng giỏ", choNgay: 1, camCtaBan: false,
    nhiemVu: "Thư cuối trước khi hết hạn: ngắn, thẳng, nhấn điều khách mất nếu bỏ qua (không dọa nạt), CTA cuối cùng." },
];

// F-103 — Ascension sau mua Tripwire (Tầng 1 → 2). 48 GIỜ ĐẦU (2 tập đầu) CHỈ giao hàng +
// hướng dẫn thắng nhanh, CẤM chào bán tầng trên (kiểm tự động); cầu nối Core theo phễu đang có.
export const ASCENSION_TRIPWIRE: VaiTroTap[] = [
  { vaiTro: "giao_hang", ten: "Tập 1 · Giao sản phẩm + truy cập", choNgay: 0, camCtaBan: true,
    nhiemVu: "Xác nhận đơn, trao đường vào sản phẩm/khu học, nói rõ bước đầu tiên nên làm ngay hôm nay. TUYỆT ĐỐI không nhắc sản phẩm tầng trên, không nhắc giá." },
  { vaiTro: "thang_nhanh", ten: "Tập 2 · Thắng nhanh 24 giờ đầu", choNgay: 1, camCtaBan: true,
    nhiemVu: "Hướng dẫn đạt KẾT QUẢ NHỎ đầu tiên trong 24 giờ (checklist 3 bước cụ thể). Chỉ giúp khách dùng được món đã mua — không chào bán gì thêm." },
  { vaiTro: "xin_phan_hoi", ten: "Tập 3 · Khai thác kết quả nhỏ", choNgay: 2, camCtaBan: false,
    nhiemVu: "Hỏi khách đã làm được bước nào, xin một dòng phản hồi; củng cố quyết định mua là đúng (nhắc lại lợi ích họ vừa nhận). Chưa chào bán." },
  { vaiTro: "case_study", ten: "Tập 4 · Case study người đi tiếp", choNgay: 2, camCtaBan: false,
    nhiemVu: "Kể một khách đã dùng sản phẩm nhỏ rồi đi tiếp lên giải pháp lớn và kết quả họ đạt. Kết bằng câu hỏi mở về mục tiêu lớn hơn của người đọc." },
  { vaiTro: "cau_noi_core", ten: "Tập 5 · Cầu nối sang Core", choNgay: 2, camCtaBan: false,
    nhiemVu: "Chỉ ra khoảng cách giữa kết quả nhỏ vừa có và mục tiêu lớn; giới thiệu giải pháp Core như bước kế tiếp tự nhiên. CTA MỀM: mời xem trang/đăng ký buổi chia sẻ." },
  { vaiTro: "phan_doi_1", ten: "Tập 6 · Xử lý phản đối chính", choNgay: 2, camCtaBan: false,
    nhiemVu: "Trả lời 2 phản đối lớn nhất về Core lấy từ kho phản đối trong hồ sơ sản phẩm/DNA, dạng hỏi–đáp ngắn, kèm CTA." },
  { vaiTro: "phan_doi_2", ten: "Tập 7 · Phản đối còn lại + bằng chứng", choNgay: 2, camCtaBan: false,
    nhiemVu: "Xử lý phản đối còn lại (thời gian, năng lực, hợp ngành) kèm bằng chứng/bảo chứng; CTA rõ ràng." },
  { vaiTro: "chot_asc", ten: "Tập 8 · Lời mời cuối", choNgay: 2, camCtaBan: false,
    nhiemVu: "Thư chốt: tóm tắt hành trình khách đã đi, nêu điều họ mất nếu dừng ở tầng nhỏ, CTA cuối cùng sang Core (hoặc buổi webinar tùy cầu nối)." },
];

// F-128 — Kéo lại học viên rớt nhịp: động viên, gợi bài ngắn dễ, nhắc mục tiêu ban đầu.
export const KEO_LAI_HOC: VaiTroTap[] = [
  { vaiTro: "dong_vien", ten: "Tin 1 · Động viên + bài kế tiếp", choNgay: 0, camCtaBan: true,
    nhiemVu: "Nhắc nhẹ nhàng rằng khóa vẫn đang chờ, KHÔNG trách móc. Gợi ĐÚNG bài kế tiếp (dùng biến {{bai_ke_tiep|bài tiếp theo}}) và nói bài đó chỉ mất vài phút. Không chào bán gì." },
  { vaiTro: "nhac_muc_tieu", ten: "Tin 2 · Nhắc mục tiêu ban đầu", choNgay: 2, camCtaBan: true,
    nhiemVu: "Nhắc lý do khách đã mua khóa (mục tiêu ban đầu), kể một học viên khác cũng từng ngắt quãng rồi quay lại và đạt kết quả. Mời vào học lại một bài ngắn." },
  { vaiTro: "go_vuong", ten: "Tin 3 · Gỡ vướng + hỏi thẳng", choNgay: 3, camCtaBan: true,
    nhiemVu: "Hỏi thẳng khách đang vướng gì (khó, bận, hay không biết bắt đầu từ đâu), mời trả lời email để được hỗ trợ. Vẫn không chào bán." },
];

// F-104 — Launch/Webinar bán Core: mốc NEO theo giờ suất (neoPhut âm = trước, dương = sau),
// nhánh riêng cho người THAM DỰ và người VẮNG.
export type TapWebinar = VaiTroTap & { neoPhut: number; nhanh?: "tham_du" | "vang" };
export const LAUNCH_WEBINAR: TapWebinar[] = [
  { vaiTro: "moi_dang_ky", ten: "Mời đăng ký", choNgay: 0, camCtaBan: false, neoPhut: -10080,
    nhiemVu: "Mời đăng ký buổi chia sẻ: nêu 3 điều người dự sẽ mang về, thời lượng, CTA giữ chỗ. Không bán sản phẩm ở thư này." },
  { vaiTro: "nhac_tham_du", ten: "Nhắc trước 24 giờ", choNgay: 0, camCtaBan: false, neoPhut: -1440,
    nhiemVu: "Nhắc buổi diễn ra sau 24 giờ, nhắc lại lợi ích chính và dặn chuẩn bị giấy bút; CTA vào link phòng cá nhân." },
  { vaiTro: "nhac_tham_du", ten: "Nhắc trước 1 giờ", choNgay: 0, camCtaBan: false, neoPhut: -60,
    nhiemVu: "Nhắc ngắn: còn 1 giờ, kèm link vào phòng. Tối đa 80 từ." },
  { vaiTro: "mo_gio", ten: "Mở giỏ (người tham dự)", choNgay: 0, camCtaBan: false, neoPhut: 60, nhanh: "tham_du",
    nhiemVu: "Cảm ơn đã dự; chốt lại giải pháp đã trình bày, trình bày offer stack đầy đủ và deadline thật; CTA mua." },
  { vaiTro: "gui_replay", ten: "Gửi replay (người vắng)", choNgay: 0, camCtaBan: false, neoPhut: 120, nhanh: "vang",
    nhiemVu: "Tiếc vì bạn lỡ buổi — gửi link replay có hạn, nêu rõ hạn xem, mời xem phần quan trọng nhất trước." },
  { vaiTro: "bang_chung", ten: "Bằng chứng xã hội", choNgay: 0, camCtaBan: false, neoPhut: 1440,
    nhiemVu: "Kể 2 kết quả học viên thật (từ hồ sơ sản phẩm/DNA), nhấn điểm chung với người đọc; CTA nhẹ." },
  { vaiTro: "xu_ly_phan_doi", ten: "Xử lý phản đối", choNgay: 0, camCtaBan: false, neoPhut: 2880,
    nhiemVu: "Trả lời 3 phản đối lớn nhất về Core lấy từ kho phản đối; mỗi phản đối 2–3 câu; CTA." },
  { vaiTro: "khan_hiem", ten: "Cảnh báo sắp đóng", choNgay: 0, camCtaBan: false, neoPhut: 4320,
    nhiemVu: "Nhắc thời hạn còn lại THẬT (dùng chữ «theo đồng hồ trên trang»), nêu điều mất nếu bỏ lỡ; CTA gấp nhưng lịch sự." },
  { vaiTro: "dong_gio", ten: "Đóng giỏ", choNgay: 0, camCtaBan: false, neoPhut: 5760,
    nhiemVu: "Thư cuối trước khi đóng: ngắn, thẳng, CTA cuối cùng; nói rõ sau giờ này link mua sẽ ngừng hoạt động." },
];

// F-105 — High-ticket Application (Tầng 3): chỉ contact đạt điều kiện lọc mới vào.
export const HIGH_TICKET_APPLICATION: VaiTroTap[] = [
  { vaiTro: "cau_chuyen_len_tang", ten: "Chạm 1 · Câu chuyện học viên lên tầng", choNgay: 0, camCtaBan: true,
    nhiemVu: "Kể một học viên đã đi từ Core lên chương trình cao hơn: bối cảnh, quyết định, kết quả. Chưa mời nộp đơn." },
  { vaiTro: "moi_nop_don", ten: "Chạm 2 · Mời nộp đơn", choNgay: 2, camCtaBan: false,
    nhiemVu: "Giải thích vì sao chương trình xét duyệt (giới hạn suất, cần đúng người), mô tả ai phù hợp; CTA nộp đơn." },
  { vaiTro: "xac_nhan_don", ten: "Chạm 3 · Xác nhận nhận đơn", choNgay: 1, camCtaBan: false,
    nhiemVu: "Xác nhận đã nhận đơn, nêu bước tiếp theo và thời gian phản hồi; CTA đặt lịch cuộc gọi." },
  { vaiTro: "nhac_lich_goi", ten: "Chạm 4 · Nhắc lịch cuộc gọi", choNgay: 1, camCtaBan: false,
    nhiemVu: "Nhắc lịch cuộc gọi đã đặt (hoặc mời đặt nếu chưa), nêu thời lượng và cách tham gia; ngắn gọn." },
  { vaiTro: "chuan_bi_goi", ten: "Chạm 5 · Chuẩn bị trước cuộc gọi", choNgay: 1, camCtaBan: true,
    nhiemVu: "Đặt kỳ vọng buổi gọi: sẽ trao đổi gì, cần chuẩn bị số liệu nào, tài liệu nên đọc trước. Không chào bán." },
  { vaiTro: "chua_dat_lich", ten: "Chạm 6 · Nhánh chưa đặt lịch", choNgay: 2, camCtaBan: false,
    nhiemVu: "Dành cho người đã nộp đơn nhưng chưa đặt lịch: hỏi vướng mắc, đề nghị 2 khung giờ cụ thể; CTA đặt lịch." },
];

// F-107 — Phục hồi doanh thu: giọng và ưu đãi PHÂN HÓA theo tầng giá.
export const PHUC_HOI_GIO_THAP: VaiTroTap[] = [
  { vaiTro: "nhac_gio", ten: "Nhắc giỏ (tầng thấp)", choNgay: 0, camCtaBan: false,
    nhiemVu: "Nhắc đơn còn dang dở, nhấn tính tiện lợi và giá trị nhanh; có thể nêu ưu đãi nhỏ còn hiệu lực; CTA khôi phục giỏ {{link_gio}}." },
  { vaiTro: "nhac_gio_2", ten: "Nhắc lần 2 + lý do nên hoàn tất", choNgay: 1, camCtaBan: false,
    nhiemVu: "Nêu 2 lợi ích cụ thể sẽ có ngay sau khi thanh toán, kèm bảo chứng hoàn tiền nếu có; CTA {{link_gio}}." },
];
export const PHUC_HOI_GIO_CAO: VaiTroTap[] = [
  { vaiTro: "nhac_gio_cao", ten: "Nhắc giỏ (tầng cao)", choNgay: 0, camCtaBan: false,
    nhiemVu: "KHÔNG giảm giá. Hỏi khách còn băn khoăn gì, nhấn giá trị và cam kết đồng hành; mời trao đổi 15 phút hoặc hoàn tất tại {{link_gio}}." },
  { vaiTro: "moi_trao_doi", ten: "Mời trao đổi 1-1", choNgay: 1, camCtaBan: false,
    nhiemVu: "Đề nghị một cuộc trao đổi ngắn để gỡ băn khoăn (không ép mua), nêu 2 khung giờ; giữ giọng tư vấn cấp cao." },
];
export const PHUC_HOI_THANH_TOAN_LOI: VaiTroTap[] = [
  { vaiTro: "thanh_toan_lai", ten: "Thanh toán chưa thành công", choNgay: 0, camCtaBan: false,
    nhiemVu: "Báo thanh toán chưa hoàn tất, hướng dẫn thao tác lại từng bước, nhấn ĐƠN VÀ GIÁ CŨ được giữ trong thời hạn; CTA link thanh toán lại." },
];
export const PHUC_HOI_XEM_NHIEU: VaiTroTap[] = [
  { vaiTro: "go_phan_doi", ten: "Gỡ phản đối cho người xem nhiều lần", choNgay: 0, camCtaBan: false,
    nhiemVu: "Nhận ra khách đang cân nhắc; trả lời 2 phản đối phổ biến nhất từ kho phản đối; CTA quay lại trang bán." },
];

// F-106 — Continuity Tầng 4: vòng đời hội viên. Welcome định hướng GIÁ TRỊ và THÓI QUEN dùng
// (không bán thêm); cứu churn khi có tín hiệu rủi ro; win-back PHÂN HÓA theo lý do hủy.
export const CONTINUITY_WELCOME: VaiTroTap[] = [
  { vaiTro: "chao_mung", ten: "Tin 1 · Chào mừng + đường vào", choNgay: 0, camCtaBan: true,
    nhiemVu: "Chào hội viên mới, trao đường vào khu thành viên và nói rõ MỘT việc nên làm trong 24 giờ đầu. Không chào bán gì thêm." },
  { vaiTro: "dinh_huong_gia_tri", ten: "Tin 2 · Giá trị nhận mỗi tháng", choNgay: 2, camCtaBan: true,
    nhiemVu: "Nêu cụ thể hội viên nhận gì theo nhịp (nội dung mới, buổi sinh hoạt, kho tài nguyên) và cách khai thác. Không bán." },
  { vaiTro: "thoi_quen", ten: "Tin 3 · Cài thói quen dùng", choNgay: 4, camCtaBan: true,
    nhiemVu: "Đề nghị một thói quen nhỏ, đo được (ví dụ 15 phút mỗi tuần vào thứ mấy) và cách đặt nhắc. Mời trả lời email nếu vướng." },
];
export const CONTINUITY_NHIP_TUAN: VaiTroTap[] = [
  { vaiTro: "diem_tin", ten: "Điểm tin tuần", choNgay: 0, camCtaBan: true,
    nhiemVu: "Điểm nội dung mới trong tuần dưới dạng danh sách ngắn kèm lý do nên xem; nhắc lịch sinh hoạt sắp tới. Không chào bán." },
];
export const CONTINUITY_CUU_CHURN: VaiTroTap[] = [
  { vaiTro: "canh_bao_nhe", ten: "Tin 1 · Báo trục trặc / vắng mặt", choNgay: 0, camCtaBan: true,
    nhiemVu: "Báo tình huống một cách bình thản: thẻ chưa thu được hoặc đã lâu không thấy hội viên. Nêu ĐÚNG một việc cần làm (cập nhật thẻ / vào lại khu thành viên). Không dọa cắt quyền, không chào bán." },
  { vaiTro: "nhac_gia_tri", ten: "Tin 2 · Nhắc thứ sắp mất", choNgay: 2, camCtaBan: false,
    nhiemVu: "Nhắc cụ thể hội viên đang có gì và sẽ mất gì nếu dừng (nói bằng lợi ích, không hù dọa). Nêu hạn ân hạn còn lại và CTA xử lý." },
  { vaiTro: "hoi_thang", ten: "Tin 3 · Hỏi thẳng + lối thoát", choNgay: 3, camCtaBan: false,
    nhiemVu: "Hỏi thẳng vướng ở đâu, mời trả lời email; đưa lối thoát mềm (tạm dừng gói thay vì hủy hẳn) nếu hội viên đang bận." },
];
export const CONTINUITY_WIN_BACK: VaiTroTap[] = [
  { vaiTro: "hoi_tham", ten: "Tin 1 · Hỏi thăm + cập nhật", choNgay: 0, camCtaBan: true,
    nhiemVu: "Hỏi thăm không nài nỉ; cập nhật NGẮN những gì đã thay đổi kể từ lúc họ rời. Không chào bán ở thư này." },
  { vaiTro: "offer_quay_lai", ten: "Tin 2 · Offer quay lại đúng lý do rời", choNgay: 2, camCtaBan: false,
    nhiemVu: "Đưa lời mời quay lại BÁM ĐÚNG lý do họ đã rời (biến {{offer_quay_lai|lời mời quay lại}}): rời vì giá thì chào bậc nhẹ hơn/kỳ ngắn; rời vì không dùng tới thì chào kèm dẫn dắt sử dụng, KHÔNG giảm giá. CTA rõ." },
];

export const LOAI_CHUOI: Record<string, { ten: string; tap: VaiTroTap[]; moTa: string }> = {
  launch_webinar: { ten: "Launch / Webinar bán Core (Tầng 2)", tap: LAUNCH_WEBINAR, moTa: "9 email neo theo giờ suất webinar, nhánh riêng cho người tham dự và người vắng, đóng giỏ theo deadline thật (F-104)." },
  high_ticket_application: { ten: "High-ticket Application (Tầng 3)", tap: HIGH_TICKET_APPLICATION, moTa: "6 chạm chỉ dành contact đạt điều kiện lọc: kể chuyện → mời nộp đơn → xác nhận → nhắc lịch gọi → chuẩn bị (F-105)." },
  phuc_hoi_gio_thap: { ten: "Phục hồi giỏ — tầng thấp", tap: PHUC_HOI_GIO_THAP, moTa: "2 email nhắc giỏ tripwire, được phép nêu ưu đãi nhỏ (F-107)." },
  phuc_hoi_gio_cao: { ten: "Phục hồi giỏ — tầng cao", tap: PHUC_HOI_GIO_CAO, moTa: "2 email giỏ high-ticket: KHÔNG giảm giá, ưu tiên giá trị và mời trao đổi (F-107)." },
  phuc_hoi_thanh_toan: { ten: "Phục hồi thanh toán thất bại", tap: PHUC_HOI_THANH_TOAN_LOI, moTa: "Hướng dẫn thanh toán lại, giữ đúng đơn và giá cũ trong thời hạn (F-107)." },
  phuc_hoi_xem_nhieu: { ten: "Phục hồi xem nhiều chưa mua", tap: PHUC_HOI_XEM_NHIEU, moTa: "Gỡ phản đối cho người xem trang bán nhiều lần (F-107)." },
  keo_lai_hoc: { ten: "Kéo lại học viên rớt nhịp", tap: KEO_LAI_HOC, moTa: "3 tin động viên khi học viên im lặng quá ngưỡng; quay lại học là chuỗi dừng ngay (F-128)." },
  soap_opera: { ten: "Soap Opera (Tầng 0 → 1)", tap: SOAP_OPERA, moTa: "5–7 email kể chuyện nhiều tập sau khi nhận lead magnet, dẫn tới sản phẩm mở ví đầu tiên (F-102)." },
  ascension_tripwire: { ten: "Ascension sau Tripwire (Tầng 1 → 2)", tap: ASCENSION_TRIPWIRE, moTa: "8 email: giao hàng + thắng nhanh 24h (48 giờ đầu không chào bán) → khai thác kết quả → case study → cầu nối Core → xử lý phản đối → chốt (F-103)." },
  continuity_welcome: { ten: "Continuity · Welcome membership (Tầng 4)", tap: CONTINUITY_WELCOME, moTa: "3 tin định hướng giá trị và cài thói quen dùng ngay khi gói vào trạng thái hoạt động (F-106)." },
  continuity_nhip_tuan: { ten: "Continuity · Nhịp sinh hoạt hàng tuần", tap: CONTINUITY_NHIP_TUAN, moTa: "Điểm tin nội dung mới theo tuần; tuần không có nội dung mới thì BỎ kỳ chứ không gửi thư rỗng (F-106)." },
  continuity_cuu_churn: { ten: "Continuity · Cứu churn", tap: CONTINUITY_CUU_CHURN, moTa: "3 tin khi có tín hiệu rủi ro (thu tiền hỏng hoặc im lặng quá ngưỡng); ưu tiên đè mọi chuỗi khác (F-106)." },
  continuity_win_back: { ten: "Continuity · Win-back người đã hủy", tap: CONTINUITY_WIN_BACK, moTa: "2 tin ở mốc 30 và 90 ngày sau hủy, offer bám ĐÚNG lý do hủy (F-106)." },
};

export const SchemaEmailSinh = z.object({
  phuong_an_tieu_de: z.array(z.string().min(8).max(90)).min(2).max(3),
  preheader: z.string().min(15).max(120),
  noi_dung: z.string().min(200).max(3500),
});
export type EmailSinh = z.infer<typeof SchemaEmailSinh>;
