---
name: ong-ban-sua-veo3
description: Tạo prompt Veo3 cho kênh affiliate sữa công thức "Ông Bán Gạo Bán Sữa" theo công thức viral "Hyper-Authentic Rural Vietnamese". Output gồm 2 prompt chuyên biệt (Character Consistency Prompt + Image-to-Video Prompt có lời thoại tiếng Việt) dựa trên 3 input người dùng (phong cách video, số phân cảnh, nội dung sản phẩm). Dùng skill này BẤT CỨ KHI NÀO người dùng muốn -  Tạo video Veo3 bán sữa công thức kiểu "ông quê chợ quê" cho kênh affiliate - Viết prompt nhân vật nhất quán cho kênh TikTok/Facebook về sữa công thức - Chuyển ý tưởng sản phẩm sữa thành kịch bản Veo3 đầy đủ (ảnh + video + lời thoại) - Tạo content viral theo phong cách "prop overload + bối cảnh quê + power-up moment" - Kênh affiliate mẹ & bé, đặc biệt sản phẩm Similac, Aptamil, Meiji, NAN, Friso, Glico, Morinaga. Kích hoạt khi nghe "tạo video ông bán sữa", "prompt Veo3 sữa công thức", "kênh affiliate sữa", "video viral sữa mẹ bỉm", "ông bán gạo bán sữa", "prompt Veo3 mẹ bé", "kịch bản sữa công thức kiểu chợ quê", "video affiliate sữa cho mẹ bỉm".
---

# Ông Bán Sữa - Veo3 Viral Prompt Generator

Skill này tạo bộ prompt Veo3 hoàn chỉnh cho kênh affiliate sữa công thức theo công thức viral "Hyper-Authentic Rural Vietnamese" (cụ ông/bà quê + prop overload + bối cảnh chợ quê + power-up moment + CTA xưng hô thân thuộc).

## QUY TRÌNH BẮT BUỘC

**Bước 1: Hỏi 3 input từ người dùng (bằng tool `ask_user_input_v0` nếu thiếu):**

1. **Phong cách video** (chọn 1):
   - `A. Chợ Quê Sáng` - ông đứng giữa chợ quê, nắng vàng, nhiều extras mua bán (mặc định - viral nhất)
   - `B. Quầy Gạo Bụi Bặm` - ông ngồi/đứng bên quầy gạo, bao gạo chất cao, cân tay treo
   - `C. Bếp Củi Nhà Gỗ` - ông ngồi trong nhà gỗ có bếp lửa, ấm cúng, phù hợp đoạn pha sữa
   - `D. Sân Nhà Tre Trúc` - sân vườn có giàn bầu, chum nước, võng - yên bình
   - `E. Hỗn Hợp 2 Bối Cảnh` - cảnh 1 chợ + cảnh cuối bếp củi (chuẩn video gốc 1M view)

2. **Số phân cảnh** (chọn 1):
   - `2 cảnh` - video 15-20s (Reels ngắn)
   - `3 cảnh` - video 25-30s (cân bằng)
   - `4 cảnh` - video 35-40s (chuẩn video gốc viral)
   - `5 cảnh` - video 45-60s (cho YouTube Shorts dài)

3. **Nội dung sản phẩm** - hỏi người dùng:
   - Tên sữa cụ thể (ví dụ: Similac Total Comfort, Aptamil Profutura, Meiji số 1...)
   - Đối tượng mẹ (ví dụ: con táo bón / con nhẹ cân / con hay trớ / mẹ thiếu sữa)
   - USP nổi bật nhất của sữa đó (ví dụ: "không táo bón", "tăng cân", "gần sữa mẹ")
   - Mức giá (để ước lượng positioning)

**Bước 2: Sau khi có đủ 3 input, BẮT BUỘC đọc references/character-library.md** để lấy chân dung nhân vật chuẩn và references/scene-templates.md cho template phân cảnh.

**Bước 3: Tạo 2 prompt đầu ra:**

### PROMPT 1 - CHARACTER CONSISTENCY (Image Generation)

Mục đích: Tạo ảnh gốc nhân vật "Ông Bán Sữa" để làm frame đầu cho Veo3 Image-to-Video. Ảnh này dùng LẠI cho mọi video → giữ nhân vật nhất quán qua các tập.

Format prompt bằng **tiếng Anh** (Veo3/Midjourney/Nano Banana đều nhận tốt hơn), chi tiết theo cấu trúc sau:

```
[CHARACTER APPEARANCE - exhaustive detail]
+ [PROP OVERLOAD - liệt kê từng món treo trên người]
+ [BACKGROUND - chi tiết bối cảnh đã chọn]
+ [CAMERA - góc máy, ống kính]
+ [LIGHTING - ánh sáng, giờ trong ngày]
+ [COLOR GRADE - tông màu]
+ [STYLE - photoreal, skin texture emphasis]
+ [NEGATIVE - tránh: cartoon, anime, CGI, young, clean]
```

### PROMPT 2 - IMAGE-TO-VIDEO (Veo3)

Mục đích: Nhập ảnh từ Prompt 1 + prompt này vào Veo3 để ra video có lời thoại tiếng Việt + chuyển động + hiệu ứng power-up.

Format cấu trúc:

```
SCENE [N]/[TOTAL]: [tên cảnh]
DURATION: [X seconds]
CHARACTER ACTION: [chuyển động cụ thể của ông]
CAMERA MOVEMENT: [static / slow push-in / handheld slight shake]
DIALOGUE (Vietnamese, male elderly voice, Northern/Central Vietnamese accent):
"[lời thoại đầy đủ]"
SUBTITLE OVERLAY (Vietnamese, yellow-highlighted keywords): "[text hiện trên màn hình]"
AMBIENT SOUND: [chợ quê / bếp củi / gà gáy / rao chợ]
SPECIAL FX: [nếu có - hào quang vàng / ánh sáng phát / bụi bay]
TRANSITION TO NEXT: [hard cut / cut with sound match]
```

**Mỗi phân cảnh phải có đầy đủ 8 yếu tố trên.** Số lượng block SCENE = số phân cảnh người dùng chọn.

## NGUYÊN TẮC VIẾT LỜI THOẠI VIRAL

Đọc `references/dialogue-patterns.md` để lấy template cụ thể. Nguyên tắc chung:

1. **Giây 0-3: HOOK pain point** - nói thẳng nỗi đau: "Con táo bón 3 ngày một lần hả mẹ?", "Con không tăng cân hả con dâu?"
2. **Xưng hô thân thuộc**: "con", "cháu", "con dâu", "bà nhà tôi" - KHÔNG dùng "bạn", "khách hàng", "các bậc phụ huynh"
3. **Câu ngắn, ngắt vụn**: Mỗi câu 5-10 từ, nghỉ giữa câu
4. **Khẳng định bằng kinh nghiệm cá nhân, không y khoa**: "Ông bán 30 năm rồi", "Cháu nội tôi uống đây" - TRÁNH "bác sĩ khuyên", "nghiên cứu cho thấy"
5. **Kết bằng CTA xưng hô thân thuộc**: "Ông để link dưới comment", "Con bấm cho bà nhé", "Mẹ nào cần ông gửi bảng so sánh"

## CẤU TRÚC PHÂN CẢNH CHUẨN THEO SỐ CẢNH

Đọc `references/scene-templates.md` để lấy template đầy đủ. Tóm tắt:

**2 cảnh (15-20s):**
- Cảnh 1 (0-10s): HOOK + PITCH (chợ quê, cầm hộp sữa)
- Cảnh 2 (10-18s): POWER-UP + CTA (hào quang vàng khi ông đổ sữa ra)

**3 cảnh (25-30s):**
- Cảnh 1 (0-10s): HOOK pain point
- Cảnh 2 (10-20s): DEMO (close-up đổ sữa vào ly)
- Cảnh 3 (20-28s): POWER-UP + CTA

**4 cảnh (35-40s) - chuẩn viral:**
- Cảnh 1 (0-10s): HOOK + pitch
- Cảnh 2 (10-18s): Close-up demo (đong muỗng sữa)
- Cảnh 3 (18-28s): Chuyển bối cảnh - bếp củi (pha sữa cho cháu)
- Cảnh 4 (28-38s): Quay lại chợ - POWER-UP + CTA

**5 cảnh (45-60s):**
- Thêm 1 cảnh testimonial: con dâu/cháu gái bế em bé cười tươi ở giữa

## CÔNG THỨC "PROP OVERLOAD" CHO SỮA CÔNG THỨC

Bắt buộc prompt phải yêu cầu nhân vật có:
- **Ít nhất 8-12 hộp sữa công thức** treo trên người (giả như vest giáp)
- **1 lon sữa khổng lồ** đội trên đầu THAY nón lá (hoặc nón lá gắn hộp sữa mini)
- **Dây chuyền bình sữa em bé** quanh cổ (4-6 bình đủ màu)
- **Tay cầm 1 muỗng inox cỡ lớn** (muỗng gạo cũ)
- **Tạp dề bám bột trắng** (bột sữa) - detail nhỏ nhưng tăng authenticity

## POWER-UP MOMENT BẮT BUỘC

Mỗi video PHẢI có 1 khoảnh khắc "phép màu" kéo dài 2-3 giây:
- **Option A (phổ biến nhất)**: Ông múc muỗng sữa → sữa biến thành em bé mũm mĩm bay lên cười → hào quang vàng kem
- **Option B**: Ông đổ sữa vào ly → ly sáng rực như kho báu → hào quang vàng
- **Option C**: Ông nếm thử 1 muỗng → thân ông phát sáng → râu rung lên vì khỏe
- **Option D**: Ông lắc hộp sữa → tiếng "ting ting" như báu vật → từng hạt sữa bay ra như vàng

## NHỮNG ĐIỀU KHÔNG ĐƯỢC LÀM (tránh bị Meta/TikTok hạn chế)

- ❌ **KHÔNG claim y khoa**: "chữa", "trị", "100% an toàn", "bác sĩ chứng nhận"
- ❌ **KHÔNG so sánh với sữa mẹ**: "tốt hơn sữa mẹ", "thay thế sữa mẹ" - vi phạm luật quảng cáo sữa Việt Nam
- ❌ **KHÔNG nói về trẻ dưới 6 tháng**: Luật Việt Nam cấm quảng cáo sữa công thức cho trẻ 0-6 tháng
- ❌ **KHÔNG dùng em bé thật** trong prompt - chỉ em bé AI/stock
- ❌ **KHÔNG miệt thị mẹ thiếu sữa**: tránh "mẹ nào không đủ sữa"
- ✅ **DÙNG**: "trẻ trên 1 tuổi", "bé lớn", "bé chậm tăng cân", "con ăn không ngon"
- ✅ **DÙNG**: "kinh nghiệm ông", "bà nhà tôi hay dùng", "mẹ bỉm truyền tai"

## OUTPUT FINAL

Sau khi hỏi đủ 3 input, Claude trả ra 1 artifact markdown duy nhất có cấu trúc:

```
# VIDEO AFFILIATE: [tên sản phẩm sữa]
## Phong cách: [A/B/C/D/E]
## Số cảnh: [N]

## 🎨 PROMPT 1 - TẠO ẢNH NHÂN VẬT (Image Generation)
[prompt tiếng Anh ~200-300 từ]

## 🎬 PROMPT 2 - IMAGE TO VIDEO (Veo3)

### SCENE 1/[N]: [tên]
[đầy đủ 8 yếu tố]

### SCENE 2/[N]: [tên]
[đầy đủ 8 yếu tố]

...

## 📋 CHECKLIST TRƯỚC KHI RENDER
- [ ] Ảnh nhân vật đã có đủ prop overload (8-12 hộp sữa)
- [ ] Lời thoại không claim y khoa
- [ ] Có 1 power-up moment rõ ràng
- [ ] CTA cuối có xưng hô thân thuộc ("con nhé", "cháu ơi")
- [ ] Subtitle đã bật, từ khóa highlight màu vàng
```

## KHI NÀO ĐỌC REFERENCES

- **character-library.md**: LUÔN đọc trước khi viết Prompt 1 - chứa 5 biến thể ông bán sữa
- **scene-templates.md**: LUÔN đọc khi số cảnh ≥ 3 - chứa template chi tiết
- **dialogue-patterns.md**: LUÔN đọc trước khi viết lời thoại - chứa 15 template hook + CTA mẫu
- **product-safe-claims.md**: Đọc khi người dùng cho biết sản phẩm sữa cụ thể - kiểm tra claim an toàn
- **example-output.md**: Đọc lần đầu tiên chạy skill để xem mẫu output hoàn chỉnh - copy format từ đây

## GHI CHÚ CUỐI

Skill này được thiết kế riêng cho **Steve (Nguyễn Tất Kiểm) - TAKI Academy** để triển khai kênh affiliate mẹ & bé. Không dùng cho mục đích quảng cáo sữa công thức cho trẻ dưới 1 tuổi vì vi phạm pháp luật Việt Nam (Nghị định 100/2014/NĐ-CP).
