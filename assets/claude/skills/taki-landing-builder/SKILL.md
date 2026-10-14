---
name: taki-landing-builder
description: Dựng landing page/mockup giao diện thật (file HTML hoàn chỉnh, có thể mở xem ngay) theo phong cách hiện đại chuẩn Apple/Stripe cho các sản phẩm của TAKI Group (khóa học TAKI Academy, chương trình AI Business System, trang TOMEC, trang sản phẩm Autovis/Remin, landing page dầu gội). BẮT BUỘC dùng skill này khi Steve nói "làm landing page", "thiết kế giao diện", "mockup web", "trang bán khóa học", "giao diện kiểu Apple/Stripe", "làm trang cho sản phẩm", hoặc mô tả 1 trang web/app cần dựng mà không nói rõ cần thiết kế viên riêng.
---

# TAKI Landing Builder

Skill này dựng ra file HTML/React THẬT chạy được ngay, không phải mô tả bằng lời. Trước khi code, đọc `/mnt/skills/public/frontend-design/SKILL.md` (design token, quy tắc dựng UI trong môi trường này) và nếu cần phong cách sâu hơn, đọc thêm `/mnt/skills/user/ui-ux-pro-max/SKILL.md` (đã có sẵn 50 style, 21 bảng màu, 50 cặp font, tham khảo shadcn/ui).

## Quy trình

1. Xác định sản phẩm/thương hiệu đích và mục tiêu trang (bán khóa học → cần giá + nút đăng ký rõ; landing lead gen → cần form bắt lead; trang giới thiệu sản phẩm SaaS như Autovis/Remin → cần demo/tính năng nổi bật).
2. Chọn bảng màu theo đúng thương hiệu:
   - TAKI Academy / Minh Trí Kinh Doanh: xanh dương chuyên nghiệp hoặc navy-đen accent cam-vàng (theo phong cách slide-master-minh-tri đã có)
   - TOMEC: tông y tế sạch, xanh dương nhạt/trắng, tạo cảm giác tin cậy
   - Autovis / Remin (SaaS công nghệ): tối giản kiểu Apple/Stripe — nền trắng/đen, nhiều khoảng trắng, gradient nhẹ, typography làm điểm nhấn thay vì màu mè
3. Cấu trúc trang chuẩn conversion (không bắt buộc theo đúng thứ tự nếu Steve muốn khác):
   Hero (headline + CTA chính) → Vấn đề/nỗi đau khách hàng → Giải pháp/tính năng → Bằng chứng (số liệu 320.000+ học viên, case study, testimonial) → Bảng giá/gói → FAQ → CTA cuối trang
4. Dựng bằng HTML thuần (CSS+JS trong cùng file) hoặc React theo skill frontend-design — ưu tiên HTML thuần nếu Steve chỉ cần xem/gửi khách xem nhanh, dùng React nếu cần tương tác phức tạp (form nhiều bước, tính toán giá động).
5. Lưu vào `/mnt/user-data/outputs`, dùng `present_files` để Steve xem trực tiếp trong artifact.

## Nguyên tắc thiết kế (tránh trang "AI-generated" nhìn rõ)

- Không dùng bố cục 3-cột-đối-xứng-hoàn-hảo mặc định — lệch tỷ lệ có chủ đích để trông có bàn tay thiết kế thật.
- Chọn 1 font accent có cá tính cho headline (không dùng system-ui mặc định), giữ font phụ trung tính cho phần đọc dài.
- Dùng số liệu thật của TAKI khi có (320.000+ học viên, 16+ năm kinh nghiệm, 300+ doanh nghiệp đã coaching) thay vì số liệu mẫu chung chung.
- Ảnh minh hoạ: nếu cần ảnh thật, phối hợp với skill `taki-brand-visual` (Canva/prompt ảnh AI) thay vì chèn ảnh placeholder xám xịt.

## Việc KHÔNG được làm

- Không tự publish/deploy lên domain thật của TAKI — chỉ dựng file, Steve tự upload.
- Không dùng logo/hình ảnh thương hiệu đối thủ hoặc bên thứ ba chưa xin phép để làm ví dụ minh hoạ trong trang thật (chỉ dùng cho mockup nội bộ có ghi chú rõ là ví dụ tham khảo).
