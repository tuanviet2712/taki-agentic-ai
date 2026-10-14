---
name: "facebook-viral-script-factory"
description: "Phân tích fanpage Facebook để decode DNA viral vs flop, sản xuất kịch bản video + Google Flow/Veo3 prompts, rồi tự động mở Chrome submit vào Google Flow để tạo video thật."
---

# Facebook Viral Script Factory

## Mục tiêu
Decode công thức viral của một fanpage, sản xuất loạt kịch bản + prompt AI video, sau đó **tự động mở Google Flow trên Chrome và submit để tạo video thật**.

## Đầu vào (hỏi user nếu chưa có)
- URL fanpage hoặc profile Facebook
- Số kịch bản cần sản xuất (mặc định: 10)
- Mô tả nhân vật cho video (giọng, trang phục, bối cảnh)
- Ngách nội dung của page
- Có muốn tự động submit vào Google Flow không? (mặc định: có)

## Bước 1 — Fetch & đọc page
Dùng WebFetch để lấy nội dung trang Facebook. Nếu bị chặn (Facebook thường block fetch trực tiếp), yêu cầu user cung cấp:
- 5 đến 10 title/script video viral nhất (view cao)
- 5 đến 10 title/script video flop (view thấp)
Nếu user đã paste vào chat thì đọc trực tiếp từ đó.

## Bước 2 — Decode Viral DNA
Phân tích theo 8 tiêu chí, trình bày dạng bảng so sánh Viral vs Flop:

| Tiêu chí | Video Viral | Video Flop |
|---|---|---|
| Chủ đề | | |
| Điểm xuất phát | | |
| Hook | | |
| Conflict | | |
| Cảm xúc | | |
| Ngôn ngữ | | |
| Twist | | |
| Ending/CTA | | |

Sau bảng, viết 1 đoạn tóm tắt DNA cốt lõi cần giữ và 3 lỗi phổ biến khiến content flop.

**Lưu ý phân tích**: Phân biệt flop do content (DNA sai, hook yếu, giảng đạo thay vì kể chuyện) vs flop do distribution (format lặp, creative fatigue, original content bị hạn chế). KHÔNG kết luận shadowban nếu không có bằng chứng từ Professional Dashboard.

## Bước 3 — Sản xuất kịch bản batch
Áp dụng công thức: **Hook gây nhận diện → tình huống đời thường → bóc hành vi → twist → câu chốt có thể cắt thành quote**

Quy tắc viết:
- Câu ngắn, ngôn ngữ đời thường
- Kể chuyện trước, đạo lý tự rơi ra sau — KHÔNG giảng đạo rồi mới kể
- Tránh "đàn ông đều...", "phụ nữ vốn..." vì dễ thành content giáo điều
- Người xem phải tự đặt mình vào trong 2 giây đầu

Với mỗi kịch bản output gồm:
```
### KỊCH BẢN [N]: [TIÊU ĐỀ IN HOA]
**Text cover:** [câu hook ngắn gọn]
**Script:**
[Nội dung kịch bản — câu ngắn, xuống dòng nhiều, đời thường]
```

## Bước 4 — Tạo Google Flow / Veo3 Prompts
Với mỗi kịch bản, tạo 1 prompt hoàn chỉnh sẵn sàng copy-paste:

```
[GOOGLE FLOW PROMPT — Kịch bản N]
Tôi tạo video nhân vật [MÔ TẢ NHÂN VẬT: trang phục, hành động, bối cảnh], nhân vật chiếm 80% khung hình, góc máy selfie thẳng mặt. Nhân vật nói giọng [GIỌNG: nam trầm / nữ nhẹ / etc.], nhấn nhá tự nhiên. Nhân vật làm biểu cảm khuôn mặt tự nhiên, nhấn nhá vào các từ khoá quan trọng, giọng VANG THANH, KHÔNG RÈ KHÔNG ÒM ÒM.

YÊU CẦU CHẤT LƯỢNG HÌNH ẢNH FULL HD 16K KHÔNG CHỨA TEXT, HÌNH ẢNH VIDEO SẮC NÉT. Nhân vật nhìn thẳng, đi chậm rãi vừa đi vừa nói nhanh đủ nội dung: [SCRIPT]
```

## Bước 5 — Tự động submit vào Google Flow (nếu user đồng ý)

Load skill `claude-in-chrome` trước. Sau đó thực hiện theo trình tự:

### 5.1 — Kiểm tra trạng thái Chrome
```
Gọi: mcp__claude-in-chrome__tabs_context_mcp
→ Xem Chrome đang mở tab nào, user đã đăng nhập Google chưa
```

### 5.2 — Mở Google Flow
```
Gọi: mcp__claude-in-chrome__tabs_create_mcp
→ Tạo tab mới

Gọi: mcp__claude-in-chrome__navigate
→ url: "https://flow.google.com"
```

Sau khi trang load, chụp screenshot để xác nhận:
```
Gọi: mcp__claude-in-chrome__computer { action: "screenshot" }
```

**Các trường hợp có thể xảy ra:**
- Nếu trang yêu cầu đăng nhập Google: báo user đăng nhập thủ công trên Chrome rồi nhắn lại để tiếp tục
- Nếu trang hiện "Request access" / waitlist: báo user Google Flow chưa mở cho tài khoản này, gợi ý dùng VideoFX hoặc Veo3 API thay thế
- Nếu load thành công vào dashboard: tiếp tục bước 5.3

### 5.3 — Tạo project mới và nhập prompt

Dùng `mcp__claude-in-chrome__read_page` để đọc cấu trúc trang, tìm nút "New project" hoặc "Create".

```
Gọi: mcp__claude-in-chrome__find
→ Tìm nút tạo project mới ("New", "Create", "+", "New video")

Gọi: mcp__claude-in-chrome__computer { action: "left_click", coordinate: [x, y] }
→ Click vào nút đó
```

Khi hộp nhập prompt xuất hiện:
```
Gọi: mcp__claude-in-chrome__form_input hoặc computer type
→ Dán nội dung Google Flow Prompt đã tạo ở Bước 4
```

**Nếu có nhiều kịch bản (trên 1):**
Hỏi user muốn submit kịch bản nào trước, không submit hàng loạt cùng lúc để tránh tốn quota.

### 5.4 — Trigger generate và báo cáo

Tìm và click nút Generate / Run / Submit:
```
Gọi: mcp__claude-in-chrome__find → nút submit
Gọi: mcp__claude-in-chrome__computer { action: "left_click" }
```

Sau khi click, chụp screenshot xác nhận đã submit:
```
Gọi: mcp__claude-in-chrome__computer { action: "screenshot" }
```

Báo user:
- Prompt đã được submit thành công
- Google Flow thường render mất 2 đến 5 phút
- Link hoặc vị trí xem video khi xong (nếu trang hiển thị)

**Nếu trang thay đổi UI hoặc không tìm được nút:** Chụp screenshot, mô tả cho user thấy đang ở đâu và hỏi user click thủ công bước đó rồi báo lại để tiếp tục.

## Output cuối cùng
Xuất ra artifact HTML hoặc plain text với cấu trúc:
1. **Viral DNA Summary** (1 bảng + 1 đoạn tóm tắt)
2. **[N] Kịch bản** đầy đủ
3. **[N] Google Flow Prompts** sẵn copy-paste
4. **Trạng thái submit** — đã submit / chờ user đăng nhập / Flow chưa mở cho tài khoản

Nếu số kịch bản lớn hơn 5, hỏi user có muốn xuất file text/docx để dễ dán vào tool không.