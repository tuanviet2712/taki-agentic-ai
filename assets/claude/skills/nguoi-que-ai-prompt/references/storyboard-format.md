# Format Storyboard Chuẩn (Tiếng Việt)

Format block văn bản — KHÔNG dùng bảng — phù hợp video triết lý có chiều sâu.

## Cấu trúc tổng thể 1 script

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📽️ KỊCH BẢN VIDEO NGƯỜI QUE — [Chủ đề]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 CHỦ ĐỀ: [Ngắn gọn]
⏱️  ĐỘ DÀI: [XX giây]
🎨 ẨN DỤ GỐC: [Hình tượng xuyên suốt — VD: cây bạch dương, dòng sông]
💡 BÀI HỌC: [1 câu tóm tắt]
🎵 TONE NHẠC: [Trầm lắng / Hy vọng / Tĩnh tại]
🎬 AI TOOL ĐỀ XUẤT: [Veo3 / Runway / Sora / Kling]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Các cảnh theo format block bên dưới]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 LỜI BÀN (đọc chậm, có độ dừng):

"[2-3 câu ẩn dụ đúc kết]"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 CTA (text overlay cuối):

▶ [Hành động cụ thể]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Format block 1 cảnh

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 CẢNH [N] | [mm:ss – mm:ss] | "[Tên cảnh gợi hình]"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▶ HÌNH ẢNH CHÍNH:
[Mô tả hành động người que + bối cảnh + đạo cụ.
Ngắn gọn — chi tiết sẽ có trong prompt tiếng Anh.]

▶ VOICE-OVER (giọng [nam/nữ] [trầm/nhẹ]):
"[Câu thoại tiếng Việt — 2-2.5 từ/giây]"

▶ TEXT OVERLAY (user thêm khi edit):
[Nội dung: "CHỮ CỤ THỂ"]
[Vị trí: trên/giữa/dưới]
[Thời điểm: giây thứ X]

▶ CẢM XÚC MỤC TIÊU:
[Tò mò / đồng cảm / suy tư / xúc động / giác ngộ]

▶ TRANSITION VÀO CẢNH SAU:
[Fade / cut / slide + lý do]
```

## Tại sao format này?

### Lý do dùng BLOCK thay vì BẢNG
- **Bảng** chỉ hiển thị tốt khi có đủ cột thông tin kỹ thuật (thường dùng cho video bán hàng, info-dense)
- **Block** đọc tự nhiên hơn cho video storytelling/triết lý — có chỗ thở, có khoảng lặng giữa các thông tin
- User có thể đọc từng block như đọc truyện, hình dung được trước khi đưa vào prompt

### Lý do tách VOICE-OVER và TEXT OVERLAY riêng
- Voice-over → user thu sau (hoặc dùng TTS)
- Text overlay → user thêm trong CapCut/edit tool
- Cả 2 đều không tạo bởi AI video tool — nên tách ra để không nhầm lẫn

### Lý do có "CẢM XÚC MỤC TIÊU"
- Hướng dẫn user khi edit — biết cảnh nào cần nhạc dồn dập, cảnh nào cần lặng
- Hướng dẫn Claude khi viết prompt tiếng Anh — keyword `mood` phải match

## Ví dụ 1 cảnh hoàn chỉnh

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 CẢNH 3 | 0:08 – 0:13 | "Ngã dưới cơn giông"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▶ HÌNH ẢNH CHÍNH:
Người que đứng giữa trời mưa bão, gió thổi ngang từ trái sang phải
mạnh đến mức thân hình nghiêng 30 độ. Hai tay ôm chặt trước ngực,
đầu cúi xuống. Vài chiếc lá khô bay ngang khung hình.
Tia chớp lấp lóe phía trên.

▶ VOICE-OVER (giọng nữ trầm, chậm):
"Cơn bão chưa từng hỏi người ta đã sẵn sàng hay chưa..."

▶ TEXT OVERLAY:
Nội dung: "CHƯA TỪNG HỎI"
Vị trí: góc dưới bên phải
Thời điểm: xuất hiện giây thứ 10, fade in 0.5s
Font: Playfair Display, trắng

▶ CẢM XÚC MỤC TIÊU:
Bị tổn thương, cảm thông, suy tư

▶ TRANSITION VÀO CẢNH SAU:
Fade to black 0.3s → mở ra cảnh tĩnh lặng sau bão
```

## Chi tiết từng phần

### Tên cảnh
- 2-4 từ, gợi hình ảnh mạnh
- ✅ "Ngã dưới cơn giông", "Tỉnh thức dưới gốc cây"
- ❌ "Cảnh buồn", "Cảnh 3"

### HÌNH ẢNH CHÍNH
- 3-5 câu là đủ
- Mô tả: hành động người que + bối cảnh + đạo cụ nhỏ
- KHÔNG cần nêu góc máy, lighting ở đây — sẽ có trong prompt EN
- Dùng từ gợi hình: "nghiêng 30 độ", "cúi xuống", "bay ngang"

### VOICE-OVER
- Luôn trong ngoặc kép
- Ghi rõ giọng (nam/nữ) + tone (trầm/nhẹ/ấm)
- **Tiếng Việt triết lý: 2-2.5 từ/giây** (chậm hơn video thường)
- Cảnh 5s → khoảng 10-12 từ
- Nếu cảnh không có thoại → ghi `(không voice — chỉ hình ảnh + nhạc)`

### TEXT OVERLAY
3 thông tin bắt buộc:
1. **Nội dung** (chữ gì — dùng CAPS cho text triết lý)
2. **Vị trí** (trên / giữa / dưới + trái / giữa / phải)
3. **Thời điểm** (giây thứ mấy xuất hiện + duration)

### CẢM XÚC MỤC TIÊU
Giúp editor + nhạc nền khớp:
- Tò mò → nhạc mystery, piano nhỏ giọt
- Đồng cảm → acoustic nhẹ
- Suy tư → ambient, không nhạc mạnh
- Xúc động → strings rising
- Giác ngộ → peaceful, warm

### TRANSITION
Luôn ghi rõ chuyển cảnh:
- **Fade** (0.3-0.5s): phù hợp video triết lý
- **Cut**: phù hợp video năng động (không hợp triết lý)
- **Slide**: phù hợp video bán hàng
- **Match cut**: nâng cao — 2 cảnh có yếu tố giống nhau chuyển mượt

## Cấu trúc 4 hồi Đắc Nhân Tâm

### Hồi 1 — SETUP (15-20% thời lượng)
1 cảnh setup. Giới thiệu nhân vật trong hoàn cảnh bình thường.

**Ví dụ** (video 20s → 3-4 giây):
- Cảnh 1: Người que đi thong thả trên con đường

### Hồi 2 — CONFLICT (35-40%)
2-3 cảnh. Biến cố đến, nhân vật vật lộn.

**Ví dụ** (video 20s → 7-8 giây):
- Cảnh 2: Trời tối dần, mây đen kéo đến
- Cảnh 3: Mưa bão — người que ngã

### Hồi 3 — INSIGHT (30-35%)
1-2 cảnh. Khoảnh khắc "aha", tỉnh thức.

**Ví dụ** (video 20s → 6-7 giây):
- Cảnh 4: Người que ngồi dậy dưới gốc cây, chiêm nghiệm
- Cảnh 5: Ánh sáng lan tỏa — nhận ra điều gì đó

### Hồi 4 — LỜI BÀN (15-20%)
1 cảnh. Đúc kết triết lý + CTA.

**Ví dụ** (video 20s → 3-4 giây):
- Cảnh 6: Người que đứng thẳng, bình minh phía sau + lời bàn voice-over

## Checklist format

Trước khi chuyển sang viết prompt EN, kiểm tra storyboard:

- [ ] Mỗi cảnh có đầy đủ 5 mục: Hình ảnh / Voice-over / Text / Cảm xúc / Transition
- [ ] Tổng thời lượng các cảnh khớp độ dài yêu cầu
- [ ] Số từ voice-over hợp lý (2-2.5 từ/giây)
- [ ] Có 4 hồi đầy đủ: Setup → Conflict → Insight → Lời bàn
- [ ] Ẩn dụ gốc xuyên suốt (không đổi giữa chừng)
- [ ] Lời bàn cuối có 2-3 câu, ẩn dụ mạnh
- [ ] Có CTA rõ ràng
