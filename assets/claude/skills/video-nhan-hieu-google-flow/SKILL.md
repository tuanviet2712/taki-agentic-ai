---
name: "video-nhan-hieu-google-flow"
description: "Sản xuất video nhân hiệu nói chuyện đạo lý (gia đình, hôn nhân, cha mẹ con cái) bằng Google Flow từ ảnh nhân vật, rồi ghép các cảnh thành 1 video hoàn chỉnh."
---

# Video nhân hiệu bằng Google Flow

Kết quả cuối: 1 file video dọc 9:16, nhân vật (từ ảnh tham chiếu của người dùng) vừa đi bộ vừa nói một kịch bản đạo lý viral, ghép từ nhiều cảnh ~8 giây.

## Đầu vào cần hỏi (nếu chưa có)
- Ảnh nhân vật (đã có trong dự án Flow, hoặc file trên máy).
- Chủ đề: mặc định gia đình, họ hàng, đạo lý cuộc sống, hôn nhân, quan hệ bố mẹ – con cái.
- Số kịch bản muốn viết (mặc định 5) và kịch bản nào sẽ làm video (mặc định kịch bản 1).

## Bước 1 — Viết kịch bản (Claude tự viết, không cần ChatGPT)
Viết N kịch bản tiếng Việt theo đúng công thức viral:
1. **Hook gây sốc** – 1 câu phủ định niềm tin phổ biến ("Đừng nghĩ cứ… thì…").
2. **Lật lại suy nghĩ quen thuộc** – nêu điều nhiều người vẫn tin, rồi "Nhưng sự thật là…".
3. **Mặt trái trong quan hệ** – phần thực tế ít ai nói.
4. **Kết luận cay nhưng đời** – 1 câu chốt đáng chia sẻ.
Mỗi kịch bản có tiêu đề + 4–5 đoạn ngắn. Giọng khuyên nhủ, tự nhiên, không lên lớp. Gửi cho người dùng chọn.

## Bước 2 — Chia cảnh
Chia kịch bản đã chọn thành các đoạn nói, mỗi đoạn ≈ 1 cảnh:
- ≤ ~35 âm tiết → cảnh 8 giây; 36–45 âm tiết → cảnh 10 giây. Không cắt giữa câu.
- Thường ra 4–5 cảnh cho ~30–40 giây.

## Bước 3 — Câu lệnh Flow cho từng cảnh
Mẫu (giữ nguyên, chỉ thay lời thoại):
```
tạo video nhân vật vừa đi bộ chậm rãi vừa nói, góc máy selfie, nhân vật chiếm 80% khung hình
biểu cảm nhân vật tự nhiên như đang nói chuyện khuyên nhủ, cử chỉ tay tự nhiên theo nhịp điệu câu nói
nhân vật nói: "<LỜI THOẠI CẢNH>"
```

## Bước 4 — Tạo video trên Google Flow (Claude in Chrome)
Nạp công cụ Chrome trong MỘT lần ToolSearch (tabs_context_mcp, tabs_create_mcp, navigate, computer, read_page, find, file_upload). Mở tab mới tới https://flow.google.com.
- Mở/tạo dự án; nếu ảnh nhân vật chưa có thì tải lên (Tệp tải lên / Tải nội dung lên).
- Với mỗi cảnh: chọn ảnh nhân vật → "Thêm vào câu lệnh"; cài đặt: **Video · Thành phần · 9:16 · Omni 1.1 Flash · 720p · 8 giây (hoặc 10 giây) · x1**; dán câu lệnh; gửi. Có thể gửi liên tiếp các cảnh, không cần đợi.
- Chờ tất cả render xong (kiểm tra % trên thẻ). Xem nhanh từng cảnh; nếu lời thoại sai/méo mặt → dùng "Sử dụng lại câu lệnh" để tạo lại cảnh đó.
- Tải về: menu ⋮ → Tải xuống → **720p (kích thước gốc)**. Tải **theo đúng thứ tự cảnh (cảnh 1 trước)** để timestamp trong tên file khớp thứ tự.
Không dùng 4K (tốn 50 tín dụng) trừ khi người dùng yêu cầu.

## Nếu không dùng được Chrome/thư mục
- Chưa bật Claude in Chrome → đưa người dùng bộ câu lệnh Flow đã chia cảnh để tự dán.

## Kết thúc
Báo tên file, tổng thời lượng, số tín dụng Flow đã dùng (~12 tín dụng/cảnh 8s 720p).