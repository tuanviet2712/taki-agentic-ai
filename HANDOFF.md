# Bàn giao Claude → Codex · 11/10/2026

Đã đọc toàn bộ yêu cầu người dùng trong phiên Claude `813e6aad-dadf-43c7-8104-d49a4490c29c`, memory Windows, hai tài liệu quy tắc port và chín báo cáo thực thi. Claude dừng lúc 23:56 ngày 10/10 vì hết hạn mức tuần, giữa bước cuối Claude in Chrome.

| Yêu cầu đã giao | Trạng thái tiếp quản |
| --- | --- |
| Cài repo, chạy localhost, Claude CLI, ZL-CRM, video AI và hậu kỳ trên Windows | Giữ các bản vá Windows; đã khởi động lại API/web/ZL-CRM bằng `scripts/dev.mjs` |
| Cập nhật video Flow, Chat Page, Chat Comment, tạo bài và đăng bài từ bản Affiliate | Đã có trong bản Claude; các test được kiểm tra lại |
| Trang Kịch bản chốt đơn, gợi ý cho nhân viên và vòng lặp thấu hiểu khách | Đã có; chế độ gợi ý không gửi tin cho khách |
| Pancake/đơn hàng | Đã có; đẩy đơn cần duyệt rõ ràng và mapping sản phẩm |
| Instagram/TikTok API, OAuth Facebook | Đã có; bổ sung kiểm tra state hết hạn ngay tại callback OAuth |
| Link dưới bình luận tích hợp vào sản phẩm/dịch vụ ở Mục tiêu & DNA | Đã có; không tạo trang sản phẩm affiliate riêng |
| Skill phụ | Đã đồng bộ 27 skill mới vào DB thật, 113 bindings, không thiếu skill trong danh sách đã gắn |
| Claude in Chrome | Codex hoàn tất CLI, bộ duyệt quyền, preflight máy/profile, video, kiểm tra đăng nhập, đăng bài và lựa chọn trên giao diện |

## Phần Codex hoàn thiện

- Chạy headless Chrome qua bộ duyệt MCP; nối lại cùng phiên có giới hạn; bảo toàn prompt qua tệp/stdin, detached process và hủy tiến trình trên Windows.
- Giới hạn quyền theo công cụ, host, thiết bị và đường dẫn; chặn tệp nhạy cảm và symlink/junction thoát thư mục; từ chối nếu không ghi được nhật ký.
- Kiểm tra thiết bị đúng profile trên máy này, làm mới danh sách trước mỗi tác vụ, yêu cầu `inUse` khi có nhiều Chrome; không tự chuyển sang cơ chế khác khi bị lỗi.
- Discovery chỉ đọc danh sách; ghép profile chỉ dùng `select_browser(deviceId)` đúng schema của CLI đã cài. Agent không được tự bật cơ chế hoặc ghép profile qua API.
- Đổi cơ chế cần kiểm tra lại đăng nhập kênh; lỗi thiết lập trước khi đăng được phân biệt với kết quả đăng chưa rõ, tránh đăng trùng.
- Nghiên cứu tiếp tục dùng Chrome Flow. Các công cụ video chạy tại máy không chịu ảnh hưởng của lựa chọn Chrome.
- Sửa tham chiếu DNA trên Windows cho Chat/Follow-up; cải thiện hiển thị lỗi hạn mức Claude, không gán nhầm thành lỗi đăng nhập.

## Kiểm tra và vận hành

- `pnpm verify`: typecheck sạch, **625 test / 68 file đạt**, build web thành công. Sau bổ sung hiển thị hạn mức trên trang video, typecheck/build và smoke giao diện kiểm tra lại đều đạt.
- Smoke test trình duyệt thật, profile kiểm thử riêng: Kênh đăng, Sản xuất video, Kịch bản chốt đơn, Mục tiêu & DNA, Duyệt; hộp chọn cơ chế trên hai trang; bố cục điện thoại. Không có lỗi JavaScript hoặc API thất bại.
- Giao diện: http://localhost:5173 · API: http://127.0.0.1:8787 · ZL-CRM: http://localhost:5174 (backend 3000, PostgreSQL riêng 5433).
- Bản sao DB/cấu hình và patch mã nguồn: `data/backups/takeover-2026-10-11/`. Log localhost: `data/takeover-dev.log`, `data/takeover-dev.err.log`. Ảnh/report giao diện: `data/takeover-qa/`.
- Cơ chế đang lưu vẫn là Chrome Flow; bot Messenger đang tắt theo cấu hình đã có. Không tự bật gửi tin, duyệt đơn hoặc đăng bài khi kiểm thử.

## Điều kiện kiểm thử dịch vụ thật

Đã xác nhận lại từ CLI thật khi khởi động: Claude bị hạn mức tuần, khôi phục **07:00 ngày 14/10/2026, giờ Việt Nam**. Trang video hiển thị thông báo và chưa cho chạy tác vụ cần Claude trong tình trạng này. Chưa thể xác nhận lượt Flow/Chrome AI mới thành công khi hạn mức còn chặn.

Pancake cần shop/mapping thật; OAuth cần App ID/Secret và khóa mã hóa thật; Instagram media và TikTok callback cần cổng HTTPS riêng. Jev hiện dùng heuristic vì chưa có TypeSafe key. Đây là điều kiện tài khoản/dịch vụ, không được tính là test live đã đạt.

Skill `nhan-ban-content-facebook` được Claude chủ động bỏ vì chứa hotline/domain của doanh nghiệp khác. Các skill phụ có thể bị rút gọn theo ngân sách prompt mỗi agent; Creative đọc riêng skill của công cụ được chọn. Giữ các giới hạn này theo phạm vi port đã thực hiện, không thêm thực thể affiliate, Docker hoặc luồng duyệt đăng thứ hai.

Mã chưa commit/push; giữ toàn bộ thay đổi có sẵn của Claude cùng phần hoàn thiện của Codex trong working tree.
