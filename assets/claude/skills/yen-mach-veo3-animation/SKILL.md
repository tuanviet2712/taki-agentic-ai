---
name: yen-mach-veo3-animation
description: Tạo bộ kịch bản + prompt Veo 3 cho video animation 2D kiểu Pixar mini về sản phẩm yến mạch (TikTok/Reels dọc 9:16, 15-30s). Output 3 phần (1) bảng storyboard 4 cột theo phân cảnh (2) Character Sheet prompt tạo mascot nhất quán (3) chuỗi prompt Veo 3 Image-to-Video có lời thoại tiếng Việt. Dùng skill này BẤT CỨ KHI NÀO người dùng muốn tạo video animation 2D bán yến mạch, ngũ cốc, bữa sáng healthy, viết kịch bản hoạt hình Pixar-style cho oat, oatmeal, granola, yến mạch cán dẹt, yến mạch ăn liền, tạo prompt Veo 3 cho video yến mạch, làm content affiliate/branding yến mạch dạng animation thay vì quay thật, viết kịch bản mascot hạt yến mạch biết nói. Kích hoạt khi nghe "video yến mạch", "animation yến mạch", "hoạt hình yến mạch", "Veo 3 yến mạch", "kịch bản yến mạch", "mascot yến mạch", "prompt Veo 3 oat", "video TikTok yến mạch", "quảng cáo yến mạch Pixar", kể cả khi người dùng chỉ gửi tên sản phẩm yến mạch kèm yêu cầu làm video.
---

# Yến Mạch Veo 3 Animation - 2D Pixar Mini Style

Skill này tạo bộ kịch bản + prompt Veo 3 hoàn chỉnh cho video hoạt hình 2D kiểu Pixar mini, chuyên về sản phẩm yến mạch, định dạng TikTok/Reels dọc 9:16 độ dài 15-30s. Output có thể mang thẳng vào Veo 3 để sinh video có lời thoại tiếng Việt.

## QUY TRÌNH BẮT BUỘC

### BƯỚC 1: Thu thập 4 input từ người dùng

Dùng tool `ask_user_input_v0` nếu người dùng chưa cung cấp đủ. Các câu hỏi:

**1. Sản phẩm yến mạch cụ thể:**
- Tên thương hiệu + dòng sản phẩm (ví dụ: "Quaker Oats cán dẹt", "Yến mạch Úc Vitalite", "yến mạch nguyên chất Organic nhà mình"...)
- USP chính (ví dụ: "giảm cân", "tim mạch", "no lâu", "không đường", "cho mẹ bầu", "trẻ em ăn dặm")
- Đối tượng chính (ví dụ: dân văn phòng, mẹ bỉm, người tập gym, người tiểu đường)

**2. Mascot nhân vật chính** (chọn 1):
- `A. Oaty Hạt Vàng` — một hạt yến mạch tròn vàng ươm, mắt to, miệng cười, tay chân mũm mĩm (mặc định — viral nhất, giống Gudetama/Pokémon)
- `B. Chị Bowl Oat` — một bát yến mạch biết nói, có mặt trên bề mặt sữa, tóc là trái cây (chuối/dâu), nữ tính đáng yêu
- `C. Ông Thần Yến Mạch` — ông tiên tóc bạc làm từ sợi yến mạch, cầm thìa phép, phong cách Kung Fu Panda
- `D. Cặp đôi Oat & Milk` — hạt yến mạch vàng + giọt sữa trắng, đôi bạn thân diễn đôi
- `E. Cả 3 nhân vật A+B+D` — cho video có tương tác nhóm

**3. Phong cách kịch bản** (chọn 1):
- `1. Before/After` — người mệt mỏi/bụng to → ăn yến mạch → khỏe đẹp (classic, chuyển đổi cao)
- `2. Giải Cứu` — mascot bay đến cứu người đang đói bụng / ăn vặt không lành mạnh
- `3. Trận Chiến` — Oaty đánh nhau với "ác nhân" (Đường, Mỡ, Junk Food) và thắng
- `4. Ngày Trong Đời` — kể một ngày của mascot từ sáng đến tối, ai cũng cần Oaty
- `5. Bí Mật Nhà Máy` — hé lộ quá trình yến mạch được làm ra (phù hợp branding)

**4. Số phân cảnh** (chọn 1):
- `3 cảnh × 5s = 15s` — Reels ngắn, hook mạnh
- `4 cảnh × 6s = 24s` — chuẩn viral TikTok
- `5 cảnh × 6s = 30s` — đủ kể chuyện + CTA (khuyến nghị)

### BƯỚC 2: Đọc references

Sau khi có đủ 4 input, **BẮT BUỘC** đọc 2 file sau trước khi viết output:
- `references/pixar-mini-style.md` — quy chuẩn hình ảnh 2D Pixar mini, màu sắc, lighting
- `references/vietnamese-dialogue-patterns.md` — mẫu lời thoại VN cho animation yến mạch

### BƯỚC 3: Tạo 3 output theo thứ tự

## OUTPUT 1 — BẢNG KỊCH BẢN STORYBOARD

Format bảng markdown 4 cột, mỗi hàng là 1 phân cảnh:

| # | Thời gian | Visual (mô tả cảnh) | Lời thoại tiếng Việt | Âm thanh / SFX |
|---|-----------|---------------------|----------------------|----------------|
| 1 | 0-5s | [mô tả nhân vật + hành động + bối cảnh] | "[lời thoại]" | [nhạc/SFX cụ thể] |
| 2 | 5-11s | ... | ... | ... |

**Yêu cầu bắt buộc cho bảng kịch bản:**
- Cảnh 1 (0-3s đầu): PHẢI có HOOK cực mạnh — câu hỏi trực tiếp ("Bụng bự vì ăn sáng sai hả?"), hoặc action dramatic (mascot rơi từ trời xuống, nổ tung), hoặc số liệu sốc ("87% dân văn phòng đang ăn sáng SAI cách!")
- Cảnh cuối: PHẢI có CTA rõ ràng + tên sản phẩm hiển thị + bao bì xuất hiện chính giữa khung hình
- Lời thoại: tiếng Việt tự nhiên, xưng "mình/bạn" hoặc "tớ/cậu", không dùng "quý khách hàng"
- Mỗi cảnh có ít nhất 1 hành động visual đáng nhớ (Oaty nhảy lên trời, biến hình, tỏa hào quang...)

## OUTPUT 2 — CHARACTER SHEET PROMPT (Image Generation)

Mục đích: Tạo ảnh gốc mascot để dùng làm frame đầu cho Veo 3 Image-to-Video. Ảnh này dùng LẠI cho mọi cảnh → giữ nhân vật nhất quán.

Format bằng **tiếng Anh** (Midjourney/Nano Banana/DALL-E nhận tốt hơn):

```
[CHARACTER IDENTITY]
A friendly anthropomorphic [mascot type] character named [name], designed in Pixar mini 2D style similar to Kung Fu Panda shorts, Inside Out emojis, Gudetama.

[PHYSICAL DESIGN]
- Body: [hình dáng cụ thể, tỷ lệ đầu/thân, chất liệu bề mặt]
- Face: [mắt to kawaii, đồng tử to, highlight sáng, miệng cười]
- Color palette: [màu chủ đạo - hex code]
- Texture: [soft 2D shading, subtle gradient, slight fabric/grain texture]

[STYLE REFERENCE]
2D cartoon animation style, Pixar mini short format, vibrant saturated colors, soft rim light, rounded shapes, no sharp edges, family-friendly, commercial-ready.

[COMPOSITION]
Full body character sheet, front view + 3/4 view + side view, neutral T-pose, white/light gradient background, high resolution.

[NEGATIVE PROMPT]
no realistic photo, no 3D render, no anime style, no scary features, no dark colors, no complex background, no text overlay.
```

## OUTPUT 3 — CHUỖI PROMPT VEO 3 IMAGE-TO-VIDEO

Mục đích: Nhập ảnh từ Character Sheet + prompt này vào Veo 3 → ra video có lời thoại tiếng Việt + chuyển động animation.

**Mỗi phân cảnh 1 block prompt, format cố định:**

```
=== SCENE [N]/[TOTAL] — [Tên cảnh] ===
DURATION: [X] seconds
ASPECT RATIO: 9:16 vertical
ANIMATION STYLE: 2D Pixar mini, smooth cartoon motion, 24fps feel

CHARACTER ACTION:
[Mô tả chi tiết chuyển động của mascot — bounce, squash & stretch, facial expression change, hand gestures. Phải có ít nhất 2-3 động tác nối tiếp trong X giây.]

BACKGROUND:
[Bối cảnh 2D — cartoon kitchen / floating oat clouds / bowl galaxy / animated sunrise. Luôn vibrant, saturated.]

CAMERA MOVEMENT:
[static / slow zoom-in on face / quick pan / bounce follow / dramatic push-in]

DIALOGUE (Vietnamese, [voice type]):
"[Lời thoại tiếng Việt đầy đủ đúng như bảng kịch bản]"

VOICE DIRECTION:
[Giọng cụ thể: young female cheerful / wise elderly warm / energetic young male / child-like playful. Emotion: excited/calming/urgent.]

SUBTITLE OVERLAY (Vietnamese):
"[Text hiện trên màn hình, KEYWORDS IN YELLOW BOLD]"

AMBIENT SOUND:
[Upbeat cartoon music / magical sparkle / kitchen foley / whoosh]

SPECIAL FX:
[Sparkles around mascot / golden aura / oat confetti / lightning burst / heart bubbles]

TRANSITION TO NEXT:
[Whip pan / oat-flake wipe / bounce cut / match cut on motion]
```

**Mỗi block scene PHẢI có đủ 10 yếu tố trên.** Số block = số phân cảnh người dùng đã chọn ở Bước 1.

## NGUYÊN TẮC VIẾT LỜI THOẠI VIRAL (yến mạch)

1. **Giây 0-3: HOOK thẳng vào pain point**
   - ❌ "Xin chào các bạn, hôm nay mình giới thiệu..."
   - ✅ "Bụng bự vì ăn sáng sai hả?" / "87% dân văn phòng đang BỎ BỮA SÁNG sai cách!"

2. **Xưng hô thân thuộc**: "mình/bạn", "tớ/cậu" (với mascot trẻ), "ông/con" (với mascot thần)

3. **Dùng từ cảm giác**: "béo ngậy", "thơm bơ", "dẻo mịn", "no căng", "nhẹ bụng" — KHÔNG dùng từ khô khan như "chứa beta-glucan cao"

4. **Câu thần chú Veo 3**: Cuối mỗi cảnh có dialogue, thêm `(speaking clearly, lip-sync to Vietnamese)` trong prompt để Veo 3 xử lý mõm đúng.

5. **CTA cuối**: luôn có 1 trong 3 dạng:
   - "Inbox ngay Oaty gửi cho cậu!"
   - "Link giỏ hàng dưới video đó nha!"
   - "Gõ 'YẾN MẠCH' vào comment, Oaty rep ngay!"

## NGUYÊN TẮC HÌNH ẢNH PIXAR MINI (tóm tắt, chi tiết xem references/pixar-mini-style.md)

- **Màu sắc**: luôn vibrant, saturation cao 80-90%. Chủ đạo vàng kem (#F4C430) + trắng sữa (#FFFAF0) + điểm nhấn xanh lá tươi (#7CB342)
- **Lighting**: soft global illumination, rim light hướng mặt trời từ trên-trái
- **Shape language**: tròn — không góc cạnh sắc. Character tỷ lệ đầu/thân = 1:1 hoặc 2:1 (big head cute)
- **Motion**: squash & stretch bắt buộc. Mascot bounce nhẹ mỗi khi nói chuyện, không đứng yên
- **Background**: ĐƠN GIẢN — 1-2 layer, blur nhẹ, không cạnh tranh với nhân vật

## CHECKLIST TRƯỚC KHI GIAO OUTPUT

- [ ] Đã hỏi đủ 4 input bằng `ask_user_input_v0`?
- [ ] Đã đọc 2 file reference?
- [ ] Bảng kịch bản có HOOK cảnh 1 + CTA cảnh cuối?
- [ ] Character Sheet có đủ 5 block (IDENTITY / DESIGN / STYLE / COMPOSITION / NEGATIVE)?
- [ ] Mỗi prompt Veo 3 có đủ 10 yếu tố?
- [ ] Lời thoại VN tự nhiên, có xưng hô thân thuộc?
- [ ] Tổng thời lượng khớp với lựa chọn (15 / 24 / 30s)?
- [ ] Tên sản phẩm + USP được lồng vào ít nhất 2 cảnh?

## GỢI Ý SAU KHI GIAO OUTPUT

Sau khi đưa đủ 3 output, hỏi người dùng:
> "Đã đủ bộ rồi nha. Bạn muốn mình làm tiếp gì trong các hướng sau?
> (a) Viết thêm caption TikTok + hashtag cho video này
> (b) Tạo 2-3 biến thể A/B hook khác để test
> (c) Viết tiếp kịch bản cho tập 2, tập 3 (series)
> (d) Hướng dẫn nhập prompt vào Veo 3 đúng thứ tự"
