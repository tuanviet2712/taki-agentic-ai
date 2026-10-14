---
name: me-bim-cho-que
description: Tạo prompt Veo3 cho kênh affiliate mẹ & bé "Mẹ Bỉm Chợ Quê" theo công thức viral "Hyper-Authentic Rural Vietnamese" - bao phủ 10 ngành hàng (bỉm, sữa công thức 2+ tuổi, ăn dặm, đồ gỗ em bé, đồ sơ sinh, đồ chơi giáo dục, xe đẩy, tã vải, vitamin mẹ bầu, bình sữa). Output 2 prompt (Character Consistency + Image-to-Video có lời thoại tiếng Việt) dựa trên 3 input user (phong cách video, số phân cảnh, nội dung sản phẩm). Kích hoạt khi nghe "video Mẹ Bỉm Chợ Quê", "prompt Veo3 mẹ bé", "kịch bản affiliate mẹ bỉm", "video viral bỉm sữa", "bà nội đeo bỉm", "ông bán sữa công thức", "bà mụ sơ sinh", "cụ đồ dạy con", "bà lái đò xe đẩy", "cô bán xôi tã vải", "cụ lang y vitamin bầu", "anh thợ mộc giường cũi", "cụ bà nồi cháo ăn dặm", "ông già bình sữa", "content kênh mẹ bé chợ quê", "tạo video affiliate mẹ bỉm".
---

# Mẹ Bỉm Chợ Quê - Veo3 Viral Prompt Generator

Skill này tạo bộ prompt Veo3 hoàn chỉnh cho kênh affiliate mẹ & bé **"Mẹ Bỉm Chợ Quê"** của Steve (Nguyễn Tất Kiểm - TAKI Academy), áp dụng công thức viral đã phân tích từ video 1M+ view:

> **Nhân vật quê mùa + Prop overload + Bối cảnh thật + Power-up moment + CTA xưng hô thân thuộc**

Bao phủ 10 ngành hàng: **bỉm, sữa công thức, đồ ăn dặm, đồ gỗ em bé, đồ sơ sinh, đồ chơi giáo dục, xe đẩy/ghế ô tô, tã vải/đồ vệ sinh, vitamin mẹ bầu, phụ kiện mẹ bé**.

---

## QUY TRÌNH BẮT BUỘC

### Bước 1: Hỏi 3 input qua `ask_user_input_v0` (nếu user chưa cung cấp đủ)

**Input 1 - Phong cách video (chọn 1):**
- `A. Chợ Quê Sáng` - nắng vàng 8-9h sáng, extras đông, rao hàng (viral default)
- `B. Sân Vườn Tre Trúc` - yên bình, võng, giàn bầu, chum nước
- `C. Bếp Củi Nhà Gỗ` - ấm cúng, lửa than hồng, phù hợp demo pha chế
- `D. Xưởng/Quầy Làm Nghề` - xưởng mộc, tiệm thuốc bắc, đò sông, chợ xôi (theo ngành hàng)
- `E. Hỗn Hợp 2 Bối Cảnh` - 60% ngoài + 40% trong nhà (cấu trúc video gốc 1M view)

**Input 2 - Số phân cảnh (chọn 1):**
- `2 cảnh` - Reels 15-20s (hook + CTA)
- `3 cảnh` - TikTok 25-30s (cân bằng)
- `4 cảnh` - Viral chuẩn 35-40s (khuyến nghị cho video flagship)
- `5 cảnh` - YouTube Shorts 45-60s (thêm testimonial)

**Input 3 - Nội dung sản phẩm (hỏi thông tin):**
- Ngành hàng cụ thể (1 trong 10 ngành)
- Tên sản phẩm cụ thể (ví dụ: "Bỉm Merries quần size L", "PediaSure Grow & Gain")
- Đối tượng mẹ (con biếng ăn / táo bón / quấy đêm / mẹ sau sinh...)
- USP nổi bật nhất (ví dụ: "khô thoáng 12h", "tăng cân trong 30 ngày")
- Mức giá (để positioning đúng)

### Bước 2: Chọn nhân vật phù hợp ngành hàng

BẮT BUỘC đọc `references/character-library.md` để chọn 1 trong 10 nhân vật đã build sẵn, mỗi nhân vật khớp 1 ngành hàng. Không tự chế nhân vật mới.

### Bước 3: Chọn template phân cảnh

BẮT BUỘC đọc `references/scene-templates.md` cho template số cảnh đã chọn.

### Bước 4: Viết lời thoại

BẮT BUỘC đọc `references/dialogue-patterns.md` để lấy hook + demo + CTA phù hợp ngành hàng.

### Bước 5: Kiểm tra compliance

BẮT BUỘC đọc `references/compliance-safety.md` khi sản phẩm thuộc các nhóm:
- Sữa công thức (Nghị định 100/2014)
- Vitamin / TPCN mẹ bầu (claim y khoa)
- Đồ sơ sinh (an toàn trẻ em)
- Đồ chơi giáo dục (claim IQ)

### Bước 6: Output 2 prompt theo format chuẩn

Xem `references/example-output.md` để copy format. Output cuối cùng là **1 artifact markdown duy nhất** có:

1. **PROMPT 1 - Tạo ảnh nhân vật** (tiếng Anh, ~250-350 từ)
2. **PROMPT 2 - Image-to-Video Veo3** (mỗi cảnh 8 yếu tố bắt buộc)
3. **Checklist trước khi render**
4. **Caption & hashtag gợi ý**

---

## 10 NGÀNH HÀNG → 10 NHÂN VẬT CỐ ĐỊNH

Đây là bảng match nhanh. Chi tiết ở `character-library.md`:

| # | Ngành hàng | Nhân vật | Prop overload chính |
|---|-----------|----------|---------------------|
| 1 | Bỉm | Bà Nội Đeo Bỉm | hàng chục bịch bỉm treo trên người |
| 2 | Máy hút sữa, bình sữa | Ông Già Bình Sữa | vòng bình sữa, máy hút sữa điện |
| 3 | Đồ ăn dặm | Cụ Bà Nồi Cháo | nồi cháo khói, thìa, bát silicone |
| 4 | Giường cũi, đồ gỗ | Anh Thợ Mộc | núm ti, xúc xắc gỗ, giường cũi |
| 5 | Đồ sơ sinh tổng hợp | Bà Mụ Sơ Sinh | dây phơi đồ, chậu tắm, khăn xô |
| 6 | Đồ chơi giáo dục | Cụ Đồ Nho | bảng chữ cái, flashcard, xếp hình |
| 7 | Xe đẩy, ghế ô tô | Bà Lái Đò | xe đẩy xếp trên đò, địu vải |
| 8 | Sữa công thức 2+ tuổi | Ông Bán Gạo | hộp sữa làm giáp, lon sữa đội đầu |
| 9 | Tã vải, đồ vệ sinh | Cô Bán Xôi | tã vải thúng, khăn ướt, kem hăm |
| 10 | Vitamin mẹ bầu | Cụ Lang Y | lọ vitamin treo, cân đòn thuốc bắc |

**Quy tắc cố định nhân vật**: Mỗi ngành hàng DÙNG ĐÚNG 1 nhân vật đã build. Không mix. Mục đích: Giữ face recognition cho người xem - "à đây là kênh Mẹ Bỉm Chợ Quê có cụ đồ dạy đồ chơi".

---

## CẤU TRÚC PROMPT 1 - TẠO ẢNH NHÂN VẬT

Format tiếng Anh, 8 block bắt buộc:

```
[CHARACTER APPEARANCE - từ character-library.md, copy NGUYÊN VĂN phần Visual DNA]
+
[PROP OVERLOAD - 8-12 món prop của ngành hàng đó, treo khắp người]
+
[CLOTHING - quần áo cũ, tạp dề có vết bột/đất, dép sờn]
+
[BACKGROUND - theo phong cách A/B/C/D/E đã chọn]
+
[CAMERA - medium shot / low angle / 50mm]
+
[LIGHTING - warm morning golden hour / firelight / soft afternoon]
+
[COLOR GRADE - earth tones, muted, cinematic]
+
[STYLE - photorealistic, hyper-detailed skin, documentary]
+
[NEGATIVE PROMPT - young, handsome, CGI, studio, clean, urban]
```

**QUAN TRỌNG**: Copy phần "Visual DNA" NGUYÊN VĂN từ character-library.md - không paraphrase. Lý do: giữ nhân vật nhất quán qua nhiều video.

---

## CẤU TRÚC PROMPT 2 - IMAGE-TO-VIDEO VEO3

Mỗi cảnh PHẢI có đủ 8 yếu tố:

```
SCENE [N]/[TOTAL]: [tên cảnh theo template]
DURATION: [X seconds]
LOCATION: [bối cảnh cụ thể]

CHARACTER ACTION: [chuyển động cụ thể: cầm gì, chỉ đâu, cười thế nào]

CAMERA MOVEMENT: [static / slow push-in / slight handheld / tilt]

DIALOGUE (Vietnamese, [gender] [age] voice, [accent: Northern/Central/Southern] 
Vietnamese accent, [tone: warm rural grandfather/grandmother/craftsman]):
"[lời thoại đầy đủ - không dịch sang tiếng Anh]"

SUBTITLE OVERLAY (Vietnamese, bold sans-serif, yellow-highlighted keywords):
[Title lớn đầu cảnh nếu có]
[Body subtitle - từ khóa bôi vàng]

AMBIENT SOUND: [tiếng chợ / bếp củi / gà / đò / xưởng mộc]

SPECIAL FX: [power-up aura / warm glow / none tùy cảnh]

TRANSITION TO NEXT: [hard cut / sound match cut / end of video]
```

**Số lượng block SCENE = số phân cảnh user chọn** (2/3/4/5).

---

## 5 POWER-UP MOMENT (BẮT BUỘC 1 MOMENT/VIDEO)

Mỗi video phải có **1 khoảnh khắc "phép màu"** 2-3 giây. Chọn 1 trong 5 pattern:

1. **Golden Aura Pulse** (phổ biến nhất, giống video gốc): hào quang vàng/màu ngành hàng bao quanh thân → cười tít mắt
2. **Product Transformation**: sản phẩm biến thành em bé mũm mĩm cười bay lên
3. **Sparkle Burst**: hạt sparkle màu ngành hàng nổ tỏa ra từ sản phẩm
4. **Light Beam**: tia sáng phát ra từ sản phẩm, cầu vồng nhỏ
5. **Action Success**: hành động thành công bất ngờ (vỗ bỉm → bỉm khô rang + tiếng "ting")

**Màu hào quang theo ngành hàng:**
- Bỉm: xanh lá (sạch sẽ, khô thoáng)
- Sữa công thức: vàng kem (dinh dưỡng)
- Đồ ăn dặm: cam (ấm cúng)
- Đồ gỗ: nâu gỗ (an toàn)
- Đồ sơ sinh: trắng (tinh khiết)
- Đồ chơi giáo dục: xanh dương (trí tuệ)
- Xe đẩy: xanh nước (êm ái)
- Tã vải: pastel cầu vồng (nhẹ nhàng)
- Vitamin bầu: tím hoa oải hương (thanh lọc)
- Bình sữa/máy hút: hồng (mẹ và bé)

---

## NGUYÊN TẮC VIẾT LỜI THOẠI

Đọc `references/dialogue-patterns.md` để lấy template chi tiết. Nguyên tắc vàng:

1. **Giây 0-3 HOOK**: Pain point trực tiếp - "Con táo bón hả mẹ?", "Bé không chịu ăn dặm?"
2. **Xưng hô thân thuộc**: "con", "cháu", "mẹ bỉm", "con dâu" - TRÁNH "bạn", "khách hàng", "các bậc phụ huynh"
3. **Câu ngắn 5-10 từ**: Không trau chuốt, có ngắt nghỉ
4. **Authority = kinh nghiệm cá nhân**: "Ông bán 30 năm", "Cháu nội bà dùng" - TRÁNH "bác sĩ khuyên", "nghiên cứu cho thấy"
5. **CTA kết = xưng hô**: "Con nhé", "Cháu ơi", "Mẹ bỉm bấm cho ông", "Bà để link dưới"

---

## CỐT LÕI CHIẾN LƯỢC KÊNH

Steve triển khai theo lộ trình:

**Tháng 1-2 (khởi động)**: Test 3 nhân vật phổ biến nhất:
- Bà Nội Đeo Bỉm (ngành bỉm - AOV thấp, chuyển đổi cao)
- Cụ Bà Nồi Cháo (ăn dặm - emotional)
- Ông Bán Gạo (sữa công thức 2+ tuổi - doanh thu cao)

**Tháng 3-4 (mở rộng)**: Thêm 3-4 nhân vật tiếp theo dựa trên performance

**Tháng 5+ (scale)**: Triển khai đủ 10 nhân vật, mỗi nhân vật 1-2 video/tuần

**Cadence đăng bài khuyến nghị**: 3-4 video/tuần, MỖI video 1 nhân vật/ngành khác nhau để đa dạng feed nhưng giữ "universe Mẹ Bỉm Chợ Quê" nhất quán.

---

## KHI NÀO ĐỌC REFERENCES

- **character-library.md**: LUÔN đọc trước khi viết Prompt 1 - chứa 10 nhân vật với Visual DNA nguyên văn
- **scene-templates.md**: LUÔN đọc khi số cảnh ≥ 3 - template chi tiết từng cảnh
- **dialogue-patterns.md**: LUÔN đọc trước khi viết lời thoại - template hook/demo/CTA theo 10 ngành
- **compliance-safety.md**: BẮT BUỘC đọc với sản phẩm sữa, vitamin, đồ sơ sinh, đồ chơi giáo dục
- **example-output.md**: Đọc lần đầu dùng skill để xem format output mẫu

---

## LƯU Ý CUỐI

Skill này được design riêng cho **kênh "Mẹ Bỉm Chợ Quê"** của Steve. Nhân vật, giọng điệu, prop đã được chọn lọc để tạo **universe nhất quán** - khi người xem thấy 1 video là nhớ ngay "à, kênh Mẹ Bỉm Chợ Quê đây". Không dùng skill này cho kênh khác hoặc ngành khác ngoài mẹ & bé.
