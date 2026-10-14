---
name: flow-anh-chan-dung-cu-dong
description: Người dùng đưa 1 ảnh chân dung rõ mặt + người trong ảnh nói gì / cảm xúc thế nào (tuỳ chọn câu thoại) → Claude tự làm trên Google Flow bằng chế độ tạo video từ ảnh (khung đầu → video, Veo) → ảnh "sống dậy" thành clip ngắn 8 giây (chớp mắt, cười, nói) → hậu kỳ nhẹ (phụ đề + CTA nếu có) → trả clip MP4 dọc 9:16.
---

# Ảnh chân dung cử động qua Google Flow (ảnh → video)

## Luồng chạy tổng quan (bắt buộc tuân theo)

```
[1] NGUỒN DỮ LIỆU: người dùng đưa trong Claude
     (1 ảnh chân dung rõ mặt, người đó nói gì / cảm xúc, câu thoại nếu muốn có tiếng, giọng)
        ↓
[2] CLAUDE TỰ XỬ LÝ TRÊN GOOGLE FLOW — trình tạo gốc của Flow, KHÔNG dùng Tool riêng
     Project Flow → chế độ video từ ảnh (Frames to Video) → ảnh chân dung làm khung đầu → prompt cử động → tạo → tải clip
        ↓
[3] HẬU KỲ: phụ đề câu thoại (nếu có) + CTA
        ↓
[4] TRẢ VỀ: 1 clip MP4 khoảng 8 giây, dọc 9:16
```

Nguyên tắc:
- **Chỉ dùng ảnh thật người dùng đưa.** Không có ảnh chân dung → dừng, báo "blocked". Không tự tạo người giả, không đổi mặt.
- **Giữ đúng người trong ảnh:** khuôn mặt, kiểu tóc, trang phục, bối cảnh như ảnh gốc. Chỉ thêm cử động nhẹ, tự nhiên.
- **Không làm giả người khác:** ảnh phải là của chính người dùng hoặc người đã đồng ý. Ảnh người nổi tiếng / chính trị gia / trẻ em → dừng, báo "blocked".
- **Lời thoại trung thực:** chỉ nói điều người dùng đưa, không thêm hứa hẹn, số liệu.
- Mỗi lần tạo tốn tín dụng Flow: tối đa 2 lần tạo lại.

## 0. Nhận dữ liệu

| Trường | Bắt buộc | Mặc định |
|---|---|---|
| Ảnh chân dung (chính diện, rõ mặt, 1 người, ánh sáng tốt) | Có | — |
| Cảm xúc / hành động | Không | Mỉm cười thân thiện, chớp mắt, gật đầu nhẹ |
| Câu thoại (tiếng Việt, ≤ 20 từ cho 8 giây) | Không | Không có thoại, chỉ âm thanh nền nhẹ |
| Giọng | Không | Theo giới tính trong ảnh, giọng miền Bắc, ấm áp |
| Model | Không | Veo 3.1 - Fast (hoặc model trong đề bài) |

Câu thoại dài hơn 20 từ thì rút gọn giữ ý chính và ghi vào notes.

## 1. Mở Flow

- Mở `https://labs.google/fx/vi/tools/flow` (hoặc flow.google.com). Chưa đăng nhập → dừng, báo "blocked". **Không bao giờ nhập mật khẩu Google.**
- Tạo project mới ("New project" / "Dự án mới"), hoặc dùng một project trống. Không xoá project hay nội dung cũ.

## 2. Tạo video từ ảnh

1. Ô nhập ở chân trang ("What do you want to create?" / "Bạn muốn tạo gì?"). Bấm chip cài đặt bên cạnh:
   - chế độ **video từ khung hình** ("Frames to Video" / "Khung hình thành video"; bản mới có thể là "Ingredients to Video" — chọn chế độ nhận ảnh làm khung đầu);
   - tỉ lệ **9:16**, số kết quả **x1**, model theo đề bài.
2. Thêm ảnh chân dung làm **khung đầu**: bấm ô khung đầu / nút + → hộp chọn nội dung của Flow → "Upload media" / "Tải lên" → tải đúng tệp ảnh người dùng. Không thêm khung cuối.
3. Viết prompt tiếng Anh, 1 đoạn, theo mẫu:
   `The person in the photo comes to life: natural blinking, a warm smile, slight head tilt, subtle breathing. Keep the exact same face, hairstyle, outfit and background as the photo. Camera almost static, soft natural light. No extra people, no text, no logos.`
   - Có câu thoại → thêm: `The person looks at the camera and says in Vietnamese, with a <giọng> voice: "<câu thoại>". Lip-sync to the speech.`
   - Không có câu thoại → thêm: `Ambient room tone only, no speech.`
   - Cảm xúc người dùng đưa (vui, xúc động, tự tin…) → thay phần "a warm smile" cho phù hợp.
4. Bấm tạo. Chờ clip (thường 1–3 phút); kiểm tra bằng ảnh chụp màn hình khoảng 30 giây một lần, không chờ mù.

## 3. Soát chất lượng

Xem clip (mở clip, chụp 2–3 khung hình ở đầu, giữa, cuối):
- **Mặt giống ảnh gốc** — không biến thành người khác, không méo mắt/miệng.
- Không mọc thêm tay, ngón tay, người lạ; không có chữ hay logo lạ.
- Cử động tự nhiên, không giật.
- Có câu thoại: chạy `taki-video-stt` trên clip đã tải để soát lời nói đúng tiếng Việt, đúng câu.

Sai thì sửa prompt (nhấn mạnh "keep the exact same face") rồi tạo lại, **tối đa 2 lần**. Vẫn sai → trả "failed", ghi lý do.

## 4. Tải clip

- Mở clip → nút tải xuống ("Download" / "Tải xuống") → bản gốc (720p) MP4 → tệp vào thư mục Downloads.
- Chép vào thư mục clips của job thành `scene_01.mp4`.

## 5. Hậu kỳ và trả thành phẩm

- Ghi `script.json`: `[{"canh":1,"loi_thoai":"<câu thoại hoặc chuỗi rỗng>"}]`.
- Chạy công cụ hậu kỳ theo hướng dẫn môi trường chạy (ghép 1 clip + phụ đề + tiêu đề hook + CTA nếu có).
- Báo: thời lượng, model, số lần tạo lại, có thoại hay không.
- Caption ngắn: 1 câu hook + CTA + 3–5 hashtag.

## Tín dụng Flow (ước tính)

- 1 clip 8 giây theo model đã chọn, cộng số lần tạo lại (tối đa 2).

## Xử lý sự cố

- **Chưa đăng nhập / hết tín dụng:** dừng, status "blocked", ghi rõ lý do.
- **Lỗi chính sách (policy) khi tải ảnh hoặc tạo video:** thường do ảnh trẻ em, người nổi tiếng, hoặc câu thoại nhạy cảm. Bỏ từ nhạy cảm khỏi prompt, thử lại 1 lần; vẫn bị chặn → dừng, status "blocked", ghi câu báo lỗi. Không tìm cách lách chính sách.
- **Không thấy chế độ video từ ảnh:** giao diện Flow có thể đổi tên; tìm chế độ nhận ảnh làm khung đầu trong chip cài đặt. Không có → dừng, status "blocked".
- **Nút tải xuống không ra tệp:** thử lại 1 lần sau 20 giây; vẫn không có → status "failed".
- **"Usage limit" / hết lượt model:** đổi sang model Veo còn lại 1 lần; vẫn báo hết → status "blocked".
