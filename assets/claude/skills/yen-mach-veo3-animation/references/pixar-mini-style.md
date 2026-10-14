# Pixar Mini Style — Quy chuẩn hình ảnh

Tham chiếu chi tiết cho phong cách animation 2D "Pixar mini" dùng trong skill yen-mach-veo3-animation.

## ĐỊNH NGHĨA

"Pixar mini" = phong cách 2D có DNA của Pixar short (Kung Fu Panda: Secrets of the Scroll, Inside Out emoji, Gudetama, SpongeBob hiện đại) nhưng:
- 2D flat shading chứ không 3D render
- Tối giản chi tiết, đậm tính biểu cảm
- Phù hợp video dọc ngắn 15-30s

## PALETTE MÀU CHUẨN CHO YẾN MẠCH

**Màu chủ đạo:**
- Vàng kem yến mạch: `#F4C430`
- Vàng ươm đậm (accent): `#E6A817`
- Trắng sữa: `#FFFAF0`
- Xanh lá tươi (healthy cue): `#7CB342`
- Nâu oat milk: `#D4B896`

**Màu cảm xúc hỗ trợ:**
- Hồng má mascot: `#FFB3BA`
- Xanh dương mát lạnh (cảnh sáng sớm): `#A8DADC`
- Cam bình minh (hào quang): `#FF8C42`
- Đỏ cảnh báo (cho "ác nhân" Đường/Mỡ): `#E63946`

**Nguyên tắc**: saturation 80-90%, KHÔNG dùng màu pastel nhạt (trôi trên feed TikTok), KHÔNG dùng màu dark (không hợp sản phẩm bữa sáng).

## LIGHTING

- **Key light**: soft global illumination, hướng từ trên-trái
- **Rim light**: vàng cam `#FF8C42` viền quanh mascot để tách nền
- **Ambient**: ấm (warm) cho cảnh kitchen/morning, mát (cool) cho cảnh "trước khi dùng sản phẩm"
- **Hào quang (aura)**: khi mascot "phát động sức mạnh", dùng radial gradient vàng → trắng sáng
- **Shadow**: soft drop shadow dưới chân mascot, opacity 20-30%, không dùng hard shadow

## SHAPE LANGUAGE

**Nhân vật:**
- Tỷ lệ đầu/thân: 1:1 (chibi) hoặc 2:1 (tối đa)
- Mắt: to, tròn, có 2-3 highlight trắng
- Miệng: cong đơn giản (khi cười), oval khi nói
- Tay chân: mũm mĩm, không khớp ngón rõ
- KHÔNG dùng: góc cạnh sắc, răng lộ nhiều, mắt hẹp dữ tợn

**Môi trường:**
- Bàn/bếp: bo góc tròn
- Ly/tô: form đơn giản, không hoa văn phức tạp
- Cây/lá: flat shape, 2-3 tone xanh

## MOTION PRINCIPLES

Áp dụng 12 nguyên tắc Disney/Pixar cô đọng:

1. **Squash & Stretch**: mascot nén xuống trước khi nhảy, giãn ra khi bật lên
2. **Anticipation**: trước mỗi hành động lớn, có 3-6 frame "lấy đà"
3. **Follow Through**: sau khi dừng, các phần phụ (tay, tai, chùm trang trí) còn rung nhẹ
4. **Exaggeration**: biểu cảm phóng đại — vui thì mắt tỏa sáng, sốc thì mắt thành chấm nhỏ
5. **Secondary Action**: khi mascot đi, sprinkle vàng rải phía sau
6. **Timing**: hành động nhanh cho comedy, chậm cho emotional beat

**Mascot yến mạch PHẢI có:**
- Bounce nhẹ (up-down 2-3px) khi đang nói
- Blink mỗi 3-4 giây
- Tay/chân vung nhẹ khi thoại (không đứng như tượng)

## COMPOSITION CHO 9:16

- **Mascot chính**: đặt trong khoảng 1/3 giữa khung, tâm khuôn mặt ở đường 1/3 trên
- **Text overlay**: vùng an toàn — chừa top 15% và bottom 20% cho UI TikTok
- **Sản phẩm**: luôn xuất hiện ở cảnh cuối, full frame center, bao bì đọc rõ
- **Rule of thirds**: nhân vật mới vào cảnh từ cạnh, di chuyển đến giao điểm

## BACKGROUND TEMPLATES

**Kitchen sáng** (cảnh ăn sáng):
- Cửa sổ vuông phía sau, ánh nắng vàng chéo
- Bàn gỗ nâu nhạt, khăn kẻ caro đỏ/trắng
- Tô yến mạch + ly sữa + quả chuối trang trí

**Floating Oat World** (cảnh mascot giới thiệu sản phẩm):
- Nền gradient vàng kem → trắng sữa
- Hạt yến mạch bay lơ lửng xung quanh
- Sparkles + bokeh light

**Gym/Office** (cảnh pain point):
- Background monochrome xám nhạt để cảm giác "thiếu năng lượng"
- Nhân vật người (nếu có) vẽ đơn giản, mặt mệt mỏi
- Đồng hồ hiện 7:00 hoặc 15:00 (giờ dễ đói)

**Battle Arena** (cảnh trận chiến với ác nhân):
- Nền xoáy đỏ-cam như anime shounen
- Speed lines
- Mascot cầm thìa phép hoặc tô phát sáng

## NEGATIVE PROMPT (luôn chèn vào image gen)

```
no photorealistic, no 3D CGI render, no anime manga style, no realistic human skin,
no dark/horror tones, no complex detailed background, no text artifacts,
no extra limbs, no distorted face, no low quality, no blurry
```

## VOICE CASTING CHO VEO 3 (2D character lip-sync)

Veo 3 cần chỉ định rõ voice type để lip-sync tiếng Việt chuẩn:

- **Oaty Hạt Vàng**: young cheerful male voice, 25-30 tuổi, giọng Bắc chuẩn hoặc Nam nhẹ
- **Chị Bowl Oat**: warm female voice, 22-28 tuổi, giọng Nam nhẹ nhàng
- **Ông Thần Yến Mạch**: wise elderly male voice, giọng Bắc trầm ấm, tốc độ chậm
- **Cặp Oat & Milk**: 2 giọng tương phản — nam trẻ năng lượng + nữ dịu dàng

Luôn thêm chỉ dẫn `(lip-sync to Vietnamese, clear articulation)` trong prompt Veo 3.
