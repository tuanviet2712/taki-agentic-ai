// Đợt F (phần 2, BIG UPDATE 09/2026) — 10 MẪU EMAIL KHỐI hệ thống (JSON Tiptap của maily.to), giọng TAKI:
// xưng anh/chị, thực chiến, không sáo rỗng, không gạch ngang dài, không hứa thu nhập, CTA rõ, ví dụ là
// sản phẩm TAKI Academy. Chỗ phải điền để trong [NGOẶC] (cùng quy ước với 40 email lẻ). Seed bởi db/seed/mau-email-khoi.ts.
import type { KhoiJson } from "./email-khoi.ts";

export type NhomMauKhoi = "chao_mung" | "webinar" | "ban_hang" | "cham_soc" | "ban_tin" | "khac";
export const NHOM_MAU_KHOI: { ma: NhomMauKhoi; ten: string }[] = [
  { ma: "chao_mung", ten: "Chào mừng & tặng quà" },
  { ma: "webinar", ten: "Webinar & sự kiện" },
  { ma: "ban_hang", ten: "Mở bán & đóng bán" },
  { ma: "cham_soc", ten: "Sau mua & chăm sóc" },
  { ma: "ban_tin", ten: "Bản tin" },
  { ma: "khac", ten: "Khác" },
];

export type MauEmailKhoi = { ma: string; nhom: NhomMauKhoi; ten: string; tieuDe: string; preheader: string; noiDungKhoi: KhoiJson };

// ---------- bộ dựng khối gọn ----------
const chu = (text: string): KhoiJson => ({ type: "text", text });
const dam = (text: string): KhoiJson => ({ type: "text", text, marks: [{ type: "bold" }] });
const bien = (id: string, fallback: string): KhoiJson => ({ type: "variable", attrs: { id, label: id, fallback, required: false } });
const ten = () => bien("ho_ten", "anh/chị");
const doan = (...c: (KhoiJson | string)[]): KhoiJson => ({ type: "paragraph", attrs: { textAlign: "left" }, content: c.map((x) => (typeof x === "string" ? chu(x) : x)) });
const h2 = (...c: (KhoiJson | string)[]): KhoiJson => ({ type: "heading", attrs: { level: 2, textAlign: "left" }, content: c.map((x) => (typeof x === "string" ? chu(x) : x)) });
const h3 = (t: string): KhoiJson => ({ type: "heading", attrs: { level: 3, textAlign: "left" }, content: [chu(t)] });
const muc = (t: string): KhoiJson => ({ type: "listItem", content: [doan(t)] });
const cham = (...t: string[]): KhoiJson => ({ type: "bulletList", content: t.map(muc) });
const so = (...t: string[]): KhoiJson => ({ type: "orderedList", content: t.map(muc) });
const nut = (text: string, url: string): KhoiJson => ({
  type: "button",
  attrs: { text, url, alignment: "left", variant: "filled", borderRadius: "smooth", buttonColor: "#f97316", textColor: "#ffffff", isTextVariable: false, isUrlVariable: false },
});
const ke = (): KhoiJson => ({ type: "horizontalRule" });
const kyTen = (): KhoiJson[] => [
  doan(dam("Nguyễn Tất Kiểm")),
  { type: "footer", attrs: { textAlign: "left" }, content: [chu("Founder TAKI Academy · Tỉnh trước. Tiền sau.")] },
];
const doc = (...c: KhoiJson[]): KhoiJson => ({ type: "doc", content: c });

export const MAU_EMAIL_KHOI: MauEmailKhoi[] = [
  {
    ma: "chao-mung", nhom: "chao_mung", ten: "Chào mừng vào danh sách",
    tieuDe: "Chào mừng {{ho_ten|anh/chị}} đến với TAKI Academy",
    preheader: "Ba thứ anh/chị sẽ nhận, và một việc nên làm ngay hôm nay",
    noiDungKhoi: doc(
      h2("Chào ", ten(), ", anh/chị đã ở đúng chỗ."),
      doan("Tôi là Nguyễn Tất Kiểm, founder TAKI Academy. Thư này ngắn thôi, vì tôi biết chủ doanh nghiệp không có nhiều thời gian đọc email."),
      doan("Ở đây anh/chị sẽ nhận được ba thứ:"),
      cham(
        "Mỗi tuần một bài học thực chiến, rút từ việc đã làm với khách thật, không lý thuyết suông.",
        "Bộ công cụ dùng ngay: kịch bản chốt sale 4 bước, checklist phễu, bảng tính ngân sách quảng cáo.",
        "Lời mời sớm vào các buổi chia sẻ trực tuyến, chỗ ngồi có hạn.",
      ),
      doan("Việc đầu tiên nên làm: xem bản đồ phễu 4 tầng mà TAKI đang dùng cho chính mình. Đọc 6 phút, áp được trong tuần."),
      nut("Xem bản đồ phễu 4 tầng", "https://taki.vn/ban-do-pheu"),
      doan("Có câu hỏi gì, anh/chị cứ trả lời thẳng thư này. Tôi đọc hết."),
      ...kyTen(),
    ),
  },
  {
    ma: "tang-tai-lieu", nhom: "chao_mung", ten: "Tặng tài liệu đã đăng ký",
    tieuDe: "Tài liệu anh/chị vừa đăng ký đây",
    preheader: "Checklist 21 điểm kiểm tra phễu, kèm cách dùng cho nhanh",
    noiDungKhoi: doc(
      h2("Tài liệu của ", ten(), " đây"),
      doan("Như đã hứa, đây là bộ «Checklist 21 điểm kiểm tra phễu bán khoá học» mà đội TAKI đi qua trước mỗi lần bật quảng cáo."),
      nut("Tải checklist", "https://taki.vn/tai-lieu/checklist-pheu"),
      doan("Cách dùng cho nhanh: in ra, đi từng dòng với phễu hiện tại của anh/chị, đánh dấu chỗ chưa có. Thường sau 20 phút sẽ lộ ra vài lỗ hổng mà trước giờ không để ý."),
      doan("Ngày mai tôi gửi tiếp cách vá lỗ hổng phổ biến nhất: trang cảm ơn để trống, khách đăng ký xong không biết làm gì tiếp."),
      ...kyTen(),
    ),
  },
  {
    ma: "moi-webinar", nhom: "webinar", ten: "Mời webinar",
    tieuDe: "Mời anh/chị: Xây phễu bán khoá học bằng AI, [thứ Năm] 20:00",
    preheader: "90 phút làm trực tiếp trên màn hình, có hỏi đáp, miễn phí",
    noiDungKhoi: doc(
      h2("[Thứ Năm] tuần này, 20:00: tôi mở màn hình dựng phễu trực tiếp"),
      doan("Trong 90 phút, tôi dựng một phễu bán khoá học từ trang đầu tới chuỗi email theo sau, ngay trên màn hình, bằng bộ công cụ AI mà TAKI đang dùng hằng ngày."),
      doan("Anh/chị sẽ thấy rõ:"),
      cham(
        "Chọn loại phễu hợp với sản phẩm đang bán, không chọn theo phong trào.",
        "Viết trang đăng ký và chuỗi email trong 30 phút.",
        "Ba lỗi khiến quảng cáo tốn tiền mà không ra khách.",
      ),
      doan("Buổi này miễn phí. Chỗ ngồi giới hạn [300] người vì cần hỏi đáp trực tiếp."),
      nut("Giữ chỗ cho tôi", "https://taki.vn/webinar"),
      doan("Không xem trực tiếp được thì vẫn đăng ký: bản ghi gửi trong 48 giờ, chỉ cho người đã đăng ký."),
      ...kyTen(),
    ),
  },
  {
    ma: "nhac-webinar-1h", nhom: "webinar", ten: "Nhắc webinar còn 1 giờ",
    tieuDe: "Còn 1 giờ nữa: buổi chia sẻ bắt đầu lúc 20:00",
    preheader: "Link vào phòng ở trong thư, bấm sớm 5 phút để thử âm thanh",
    noiDungKhoi: doc(
      h2("Còn 1 giờ nữa, ", ten()),
      doan("Buổi «Xây phễu bán khoá học bằng AI» bắt đầu lúc 20:00 hôm nay. Link vào phòng ở nút dưới, anh/chị bấm sớm 5 phút để kiểm tra âm thanh."),
      nut("Vào phòng ngay", "https://taki.vn/webinar/vao-phong"),
      doan("Chuẩn bị sẵn: tên sản phẩm anh/chị đang bán và mức giá hiện tại. Phần cuối tôi chọn vài phễu của người tham dự để góp ý trực tiếp."),
      doan("Hẹn gặp anh/chị đúng giờ."),
      ...kyTen(),
    ),
  },
  {
    ma: "mo-ban", nhom: "ban_hang", ten: "Mở bán",
    tieuDe: "Chính thức mở đăng ký: 10X Sales khoá mới",
    preheader: "Người trong danh sách email biết trước tiên, giữ chỗ trước [Chủ nhật]",
    noiDungKhoi: doc(
      h2("Mở đăng ký chương trình 10X Sales khoá mới"),
      doan("Sau ba tháng chỉ dạy nội bộ cho học viên cũ, hôm nay TAKI Academy mở đăng ký 10X Sales cho người mới. Như đã hứa, danh sách email biết trước tiên."),
      doan("Chương trình dành cho chủ doanh nghiệp đang tự bán hoặc có đội sale dưới 10 người, muốn có quy trình chốt sale 4 bước thay vì bán theo cảm hứng."),
      cham(
        "[8] buổi học trực tiếp cùng Nguyễn Tất Kiểm, mỗi buổi một việc làm ngay.",
        "Bộ 16 kịch bản xử lý từ chối, dùng được từ buổi thứ hai.",
        "Một buổi cố vấn 1-1 trên chính sản phẩm của anh/chị.",
      ),
      doan("Đợt này nhận [40] học viên để còn chấm bài từng người. Đăng ký trước [Chủ nhật] giữ mức học phí hiện tại."),
      nut("Xem chi tiết và đăng ký", "https://taki.vn/10x-sales"),
      doan("Còn băn khoăn có hợp với ngành mình không, trả lời thư này kể tôi nghe anh/chị đang bán gì, tôi trả lời thẳng."),
      ...kyTen(),
    ),
  },
  {
    ma: "dong-ban-24h", nhom: "ban_hang", ten: "Đóng bán còn 24 giờ",
    tieuDe: "Còn 24 giờ: cửa đăng ký 10X Sales đóng lúc 23:59 mai",
    preheader: "Không gia hạn, không mở lại. Ba băn khoăn hay gặp và câu trả lời",
    noiDungKhoi: doc(
      h2("24 giờ cuối, rồi đóng thật"),
      doan("Tối mai 23:59, hệ thống tự đóng đăng ký 10X Sales khoá này. Không gia hạn, không mở lại vì có người xin, vì như thế là không công bằng với người đã quyết định sớm."),
      doan("Nếu anh/chị đã đọc các thư trước mà còn phân vân, thường là một trong ba điều này:"),
      cham(
        "Sợ không có thời gian: mỗi tuần một buổi 2 tiếng, có bản ghi xem lại, bài tập làm ngay trong buổi.",
        "Sợ không hợp ngành mình: bài tập làm trên chính sản phẩm của anh/chị, có người chấm.",
        "Sợ chi phí: có phương án trả góp, ghi rõ trên trang đăng ký.",
      ),
      nut("Đăng ký trước khi đóng", "https://taki.vn/10x-sales"),
      doan("Còn câu hỏi nào khác, trả lời thư này trước 18:00 mai. Tôi trả lời trong ngày để anh/chị kịp quyết định."),
      ...kyTen(),
    ),
  },
  {
    ma: "sau-mua", nhom: "cham_soc", ten: "Sau mua: bước đầu tiên",
    tieuDe: "Cảm ơn anh/chị. Bước đầu tiên đây",
    preheader: "Tài khoản học đã mở, ba việc nên làm trong 48 giờ đầu",
    noiDungKhoi: doc(
      h2("Cảm ơn ", ten(), ", anh/chị đã có chỗ"),
      doan("Thanh toán đã ghi nhận. Tài khoản học đã mở, đăng nhập bằng đúng email đang nhận thư này."),
      nut("Vào lớp học", "https://taki.vn/hoc-vien"),
      doan("Ba việc nên làm trong 48 giờ đầu:"),
      so(
        "Xem bài 0 (15 phút) để biết cách học sao cho không bỏ dở giữa chừng.",
        "Điền phiếu thông tin doanh nghiệp để giảng viên chuẩn bị ví dụ đúng ngành của anh/chị.",
        "Vào nhóm Zalo của lớp, giới thiệu một câu về việc anh/chị đang làm.",
      ),
      doan("Gặp trục trặc đăng nhập, trả lời thư này. Đội hỗ trợ TAKI xử lý trong giờ hành chính."),
      ...kyTen(),
    ),
  },
  {
    ma: "ban-tin", nhom: "ban_tin", ten: "Bản tin tuần",
    tieuDe: "Bản tin tuần: một bài học, một công cụ, một câu hỏi",
    preheader: "Đọc 3 phút, có một thứ dùng được ngay",
    noiDungKhoi: doc(
      h2("Tuần này ở TAKI"),
      h3("Một bài học"),
      doan("[Kể một việc thật vừa làm với khách tuần này, 4 đến 6 câu, có chi tiết cụ thể. Kết bằng điều rút ra.]"),
      h3("Một công cụ"),
      doan("[Tên công cụ hoặc mẫu, dùng để làm gì, ai nên dùng.]"),
      nut("Lấy công cụ tuần này", "https://taki.vn/cong-cu"),
      h3("Một câu hỏi cho anh/chị"),
      doan("[Một câu hỏi khiến người đọc nhìn lại việc kinh doanh của mình. Mời trả lời thư, câu hay nhất lên bản tin kỳ sau.]"),
      ke(),
      doan("Hẹn anh/chị [thứ Ba] tuần sau, đúng giờ này."),
      ...kyTen(),
    ),
  },
  {
    ma: "phuc-hoi-gio-hang", nhom: "cham_soc", ten: "Phục hồi giỏ hàng",
    tieuDe: "Anh/chị để quên một thứ ở trang thanh toán",
    preheader: "Đơn giữ chỗ trong 48 giờ, hai câu hỏi hay gặp nhất có trả lời trong thư",
    noiDungKhoi: doc(
      h2(ten(), " chưa hoàn tất đăng ký"),
      doan("Hệ thống thấy anh/chị đã điền thông tin cho [TÊN SẢN PHẨM] nhưng chưa thanh toán. Có thể mạng chập chờn, có thể anh/chị còn cân nhắc. Cả hai đều bình thường."),
      doan("Nếu là cân nhắc, đây là câu trả lời cho hai câu hỏi hay gặp nhất:"),
      cham(
        "Không hợp thì sao? [Ghi chính sách hoàn phí thật của anh/chị, kèm điều kiện rõ ràng.]",
        "Bận thì sao? Bản ghi mở lâu dài, học theo nhịp của anh/chị, không bị trừ điểm vì học chậm.",
      ),
      nut("Hoàn tất đăng ký", "https://taki.vn/thanh-toan"),
      doan("Đơn giữ chỗ trong 48 giờ, sau đó suất được trả lại cho danh sách chờ."),
      ...kyTen(),
    ),
  },
  {
    ma: "xin-danh-gia", nhom: "cham_soc", ten: "Xin đánh giá",
    tieuDe: "Anh/chị cho tôi xin 2 phút",
    preheader: "Ba câu hỏi, đọc từng phản hồi, dùng để khoá sau tốt hơn",
    noiDungKhoi: doc(
      h2("Một câu hỏi thật lòng, ", ten()),
      doan("Anh/chị đã đi cùng [TÊN CHƯƠNG TRÌNH] được [4 tuần]. Tôi muốn biết: điều gì có ích nhất, và điều gì TAKI làm chưa tốt?"),
      doan("Chỉ ba câu hỏi, không quá 2 phút. Câu trả lời thẳng thắn giúp khoá sau tốt hơn, và tôi đọc từng phản hồi."),
      nut("Gửi phản hồi 2 phút", "https://taki.vn/danh-gia"),
      doan("Nếu anh/chị thấy chương trình đáng giới thiệu, xin phép trích một câu trong phản hồi. Có hỏi lại trước khi dùng."),
      ...kyTen(),
    ),
  },
];

export const timMauEmailKhoi = (ma: string): MauEmailKhoi | null => MAU_EMAIL_KHOI.find((m) => m.ma === ma) ?? null;
