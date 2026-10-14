---
name: nguoi-que-ai-prompt
description: Tạo kịch bản video người que (stick figure) TikTok/Reels 15-30 giây triết lý nhân sinh — phong cách Đắc Nhân Tâm — KÈM prompt tiếng Anh sẵn dùng cho AI video tool Veo3, Runway Gen-3, Sora, Kling. Output 3 phần gồm storyboard tiếng Việt, prompts tiếng Anh chi tiết cho từng cảnh có đủ camera/lighting/motion/duration, và hướng dẫn ghép video trong CapCut. Ẩn dụ sâu sắc, ngôn ngữ Hán-Việt cổ điển, leo thang cảm xúc, kết bằng lời bàn. Kích hoạt BẤT CỨ KHI NÀO người dùng muốn tạo video người que bằng AI, cần prompt Veo3/Runway/Sora/Kling cho video triết lý, kịch bản AI video Đắc Nhân Tâm, làm video hoạt hình triết lý không cần code. Từ khóa "prompt Veo3 người que", "prompt Sora stick figure", "prompt Runway triết lý", "video AI người que", "kịch bản AI video nhân sinh", "prompt Kling người que", "video Đắc Nhân Tâm AI".
---

# Kịch Bản + Prompt AI Video Người Que (Triết Lý)

Skill chuyên biệt: Tạo video TikTok/Reels 15-30 giây về triết lý nhân sinh bằng cách viết kịch bản + prompt cho AI video tool.

**Claude KHÔNG tự tạo video.** Claude tạo:
1. Storyboard tiếng Việt (để user review)
2. Prompt tiếng Anh cho từng cảnh (để paste vào Veo3/Runway/Sora/Kling)

User mang prompt về tool AI → render → ghép lại → thêm voice-over + nhạc = video hoàn chỉnh.

## Khi nào dùng skill này

- User muốn làm video ngắn nhưng không biết code / không có designer
- User đã có gói Veo3, Runway, Sora, Kling — cần prompt chất lượng
- Chủ đề triết lý nhân sinh, Đắc Nhân Tâm, bài học cuộc sống
- Video ngắn 15-30 giây TikTok/Reels/Shorts

Nếu user muốn video dài hơn → gợi ý chia thành series.
Nếu user muốn chủ đề khác (AI, bán hàng) → tùy chỉnh nhưng giữ format prompt.

## Quy trình 4 bước

### Bước 1: Khai thác thông tin

Hỏi user (nếu chưa đủ):

1. **Thông điệp/bài học** muốn truyền tải là gì? (VD: "cây cao gió lớn", "tĩnh lặng là sức mạnh", "chọn bạn mà chơi")
2. **Độ dài**: 15s / 20s / 25s / 30s?
3. **Tool AI user đang dùng**: Veo3 (Google) / Runway Gen-3 / Sora (OpenAI) / Kling (Kuaishou) / Tất cả?
4. **Style người que mong muốn**: tối giản thuần túy (black line trên white bg) / có màu nhẹ / whiteboard animation?
5. **Có voice-over không?** (nếu có, user sẽ thu sau) — ảnh hưởng việc giữ khoảng lặng trong video
6. **CTA cuối**: Tag bạn / Follow / Comment / không có?

Nếu user đã cung cấp đủ → bỏ qua bước hỏi.

### Bước 2: Viết storyboard (tiếng Việt)

Dùng format block văn bản (KHÔNG bảng), cấu trúc 4 hồi Đắc Nhân Tâm:

```
HỒI 1 — SETUP      (15-20%) → Giới thiệu nhân vật
HỒI 2 — CONFLICT   (35-40%) → Biến cố/thử thách
HỒI 3 — INSIGHT    (30-35%) → Khoảnh khắc tỉnh thức
HỒI 4 — LỜI BÀN    (15-20%) → Đúc kết triết lý
```

Format storyboard cho từng cảnh:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 CẢNH [N] | [mm:ss – mm:ss] | "[Tên gợi hình]"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▶ HÌNH ẢNH CHÍNH:
[Mô tả hành động người que + bối cảnh + đạo cụ. 
Ngắn gọn vì sẽ có prompt tiếng Anh chi tiết bên dưới.]

▶ VOICE-OVER (user tự thu hoặc AI TTS):
"[Câu thoại tiếng Việt — 2-2.5 từ/giây]"

▶ TEXT OVERLAY (user tự thêm khi edit):
[Nội dung + vị trí + thời điểm xuất hiện]

▶ CẢM XÚC KHÁN GIẢ MỤC TIÊU:
[Tò mò / đồng cảm / suy tư / xúc động / giác ngộ]
```

Xem chi tiết template + ví dụ tại `references/storyboard-format.md`.

### Bước 3: Viết prompt AI video (tiếng Anh)

Đây là phần QUAN TRỌNG NHẤT. Mỗi cảnh = 1 prompt riêng biệt.

**Cấu trúc prompt chuẩn** (dùng được cho Veo3, Runway, Sora, Kling):

```
[SHOT TYPE] of [SUBJECT] [ACTION], [STYLE], [LIGHTING], 
[CAMERA MOVEMENT], [MOOD/ATMOSPHERE], [DURATION].

Style: minimalist black stick figure on [background], 
hand-drawn line art aesthetic, 2D animation style.

Motion: [describe specific animation — smooth, slow, dramatic, etc.]

Camera: [static / slow pan / zoom in / dolly / tracking]

Lighting: [flat white / warm golden / cool blue / dramatic contrast]

Duration: [X] seconds.

Mood: [contemplative / tense / hopeful / peaceful]

Aspect ratio: 9:16 vertical.
```

Xem 3 template prompt chuyên biệt cho Veo3/Runway/Sora tại `references/prompt-templates.md`.

### Bước 4: Hướng dẫn ghép video cuối

Sau khi user có các clip từ AI tool, gợi ý workflow ghép:

1. **Tool edit**: CapCut (miễn phí, dễ dùng), Premiere Pro, DaVinci Resolve
2. **Thứ tự**: Ghép các clip theo đúng storyboard
3. **Voice-over**: Thu bằng mic ở nhà / dùng ElevenLabs TTS (giọng Việt tự nhiên)
4. **Nhạc nền**: Pixabay Music, Epidemic Sound, YouTube Audio Library
5. **Text overlay**: Thêm trong CapCut (có template sẵn)
6. **Transition**: Fade mềm 0.3-0.5s giữa các cảnh

Xem hướng dẫn chi tiết `references/editing-guide.md`.

## Nguyên tắc viết prompt cho 4 AI tool

Mỗi tool có quirks riêng. Skill này tối ưu cho cả 4:

### Veo3 (Google)
- **Mạnh**: Chuyển động mượt, nhất quán giữa các frame
- **Yếu**: Đôi khi quá realistic (không hợp stick figure)
- **Tip**: Nhấn mạnh "2D flat illustration", "NOT realistic"
- **Max duration**: 8 giây/clip

### Runway Gen-3
- **Mạnh**: Kiểm soát camera tốt, motion chính xác
- **Yếu**: Cần prompt cực cụ thể mới ra đúng ý
- **Tip**: Dùng structured prompt với nhiều keyword
- **Max duration**: 10 giây/clip

### Sora (OpenAI)
- **Mạnh**: Hiểu ngữ cảnh sâu, physics tốt
- **Yếu**: Giới hạn access, giá cao
- **Tip**: Viết natural language, mô tả cảm xúc
- **Max duration**: 20 giây/clip (version mới)

### Kling (Kuaishou)
- **Mạnh**: Motion người/vật rất tự nhiên
- **Yếu**: Prompt phải đơn giản, ngắn
- **Tip**: 1-2 câu mỗi prompt là đủ
- **Max duration**: 10 giây/clip

Xem bảng so sánh + keyword prefer cho mỗi tool tại `references/ai-tool-comparison.md`.

## Nguyên tắc viết prompt chất lượng cao

### 1. Luôn mở đầu bằng SHOT TYPE
```
Wide shot of... / Medium shot of... / Close-up of... / 
Extreme close-up of... / Over-the-shoulder shot of...
```

### 2. Mô tả SUBJECT rất cụ thể
❌ "A stick figure person"
✅ "A minimalist black stick figure with a round head, thin line body, no facial features except two small eye dots"

### 3. ACTION verb mạnh, cụ thể
❌ "walking"
✅ "walking slowly with head bowed, dragging feet through tall grass"

### 4. STYLE phải nhắc đi nhắc lại
Mỗi prompt phải có keyword:
- "minimalist 2D animation"
- "hand-drawn doodle style"
- "black ink line art"
- "whiteboard animation aesthetic"

### 5. Negative prompt để tránh realistic
```
Negative: realistic, 3D, photographic, detailed facial features, colorful, cluttered background
```

### 6. Duration phải khớp storyboard
Nếu cảnh 3 giây → prompt phải ghi `Duration: 3 seconds`.

Xem thêm tips nâng cao tại `references/prompt-engineering.md`.

## Tránh lỗi phổ biến

### Lỗi 1: Prompt quá vague
❌ "Stick figure sad in rain"
✅ "Medium shot of a minimalist black stick figure standing still in heavy rain, body tilted slightly forward, both hands crossed over chest, head bowed. White background. Rain drawn as diagonal dashed lines. Hand-drawn 2D animation style. Slow motion. Mood: lonely, contemplative. Duration: 4 seconds. 9:16 aspect ratio."

### Lỗi 2: Không nhất quán giữa các cảnh
- Mỗi prompt phải nhắc style chung (VD: "same minimalist black stick figure from previous scenes")
- Dùng cùng background color / lighting xuyên suốt
- Character description giống nhau 100%

### Lỗi 3: Prompt quá dài (Veo3/Kling sẽ cắt)
- Giới hạn 80-120 từ/prompt
- Ưu tiên: Shot type + Subject + Action + Style + Duration

### Lỗi 4: Quên aspect ratio
Luôn có `9:16 vertical aspect ratio` cho TikTok/Reels.

### Lỗi 5: Không có negative prompt
Stick figure rất dễ bị AI render thành người realistic. Luôn có negative:
```
Negative prompt: realistic human, 3D, photorealistic, detailed face, 
cluttered background, colorful, cartoon (non-minimalist)
```

## Thư viện tham khảo

- `references/storyboard-format.md` — Template storyboard tiếng Việt chi tiết
- `references/prompt-templates.md` — 10 template prompt cho 10 loại cảnh (đi bộ, thiền, bão, insight...)
- `references/ai-tool-comparison.md` — So sánh Veo3/Runway/Sora/Kling + keyword tối ưu cho từng tool
- `references/prompt-engineering.md` — Tips nâng cao: consistency, negative prompt, seed
- `references/loi-ban-templates.md` — 30 mẫu lời bàn Đắc Nhân Tâm
- `references/bieu-tuong-triet-ly.md` — 50 biểu tượng ẩn dụ (cây, nước, lửa, núi...)
- `references/editing-guide.md` — Hướng dẫn ghép video cuối trong CapCut
- `references/examples.md` — 3 project mẫu hoàn chỉnh (storyboard + prompts + hướng dẫn)

## Output cuối cùng

Mỗi lần user yêu cầu, Claude trả về 3 phần rõ ràng:

### Phần 1: STORYBOARD (tiếng Việt)

Toàn bộ kịch bản theo block từng cảnh, voice-over tiếng Việt, lời bàn.

### Phần 2: PROMPTS (tiếng Anh)

Mỗi cảnh 1 prompt block riêng, có comment ghi rõ:
- Số cảnh (để user biết thứ tự ghép)
- Thời lượng target
- Tool khuyến nghị (nếu có cảnh phù hợp 1 tool cụ thể)

### Phần 3: HƯỚNG DẪN GHÉP

Các bước ghép cuối + gợi ý nhạc nền + tips voice-over.

## Lưu ý quan trọng

- **Luôn làm phần 1 (Storyboard) trước**, confirm với user → rồi làm phần 2 (Prompts)
- **Nếu user chỉ muốn prompts** (đã có storyboard sẵn): cũng ok, nhảy thẳng sang phần 2
- **Prompt phải test được** — Claude tự review: đọc prompt có hình dung được cảnh không?
- **Ghi chú token limit**: Veo3/Kling ~100 từ, Runway/Sora có thể 200+ từ
- **Sau khi giao**, hỏi user có muốn: (a) điều chỉnh storyboard, (b) viết lại prompt theo tool khác, (c) tạo biến thể độ dài khác, (d) thêm caption + hashtag TikTok
