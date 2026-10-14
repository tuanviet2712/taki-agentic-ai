# So Sánh 4 AI Video Tool + Keyword Tối Ưu

Hiểu đặc điểm từng tool để chọn đúng công cụ + viết prompt phù hợp.

## Bảng so sánh tổng quan (Tính đến 2026)

| Tiêu chí | Veo3 (Google) | Runway Gen-3 | Sora (OpenAI) | Kling (Kuaishou) |
|---|---|---|---|---|
| **Chất lượng hình** | Rất cao | Cao | Cao nhất | Cao |
| **Motion nhất quán** | Rất tốt | Tốt | Rất tốt | Tốt |
| **Hiểu prompt tiếng Việt** | Không | Không | Có (giới hạn) | Không |
| **Stick figure quality** | Khá | Rất tốt | Tốt | Trung bình |
| **Max duration/clip** | 8s | 10s | 20s | 10s |
| **Giá** | Cao | Trung bình | Cao nhất | Rẻ nhất |
| **Truy cập VN** | Dễ (qua VPN) | Dễ | Khó (waitlist) | Dễ |
| **Tốc độ render** | Nhanh | Nhanh | Trung bình | Rất nhanh |
| **Text rendering** | Yếu | Yếu | Trung bình | Yếu |

## Khi nào dùng tool nào?

### Dùng Veo3 khi:
- User có gói Google AI Pro/Ultra
- Cần chất lượng hình ảnh cao cho branding/ads
- Làm video có nhiều cảnh nature (cây, mây, nước)
- Prompt tương đối dài, chi tiết

### Dùng Runway Gen-3 khi:
- Cần kiểm soát camera chính xác (pan, zoom, dolly)
- Làm stick figure animation (Runway render tốt nhất cho loại này)
- Muốn dùng feature Image-to-Video (upload ảnh reference)
- Budget trung bình

### Dùng Sora khi:
- Cần cảnh phức tạp có nhiều elements
- User ở US / có quyền truy cập Sora
- Làm video có physics phức tạp
- Prompt viết natural language, kể chuyện

### Dùng Kling khi:
- Budget thấp, cần số lượng nhiều clip
- Cần motion người/vật tự nhiên
- Prompt ngắn gọn
- User ở Trung Quốc / Việt Nam (dễ truy cập)

## Keyword tối ưu cho từng tool

### VEO3 - Keyword Prefer

Veo3 hiểu ngôn ngữ điện ảnh rất tốt. Dùng:

**Shot types**:
- "Medium shot", "Wide shot", "Close-up"
- "Dolly in", "Dolly out", "Pedestal up"
- "Over-the-shoulder", "Point-of-view"

**Motion keywords**:
- "Smooth tracking", "Steady cam", "Handheld"
- "Slow motion", "Real-time", "Time lapse"

**Quality boost**:
- "Cinematic", "Professional cinematography"
- "Wes Anderson style symmetry" (cho triết lý)
- "Studio Ghibli minimalism" (cho stick figure ấm áp)

**Veo3 template structure**:
```
[SHOT TYPE] of [SUBJECT] [ACTION]. 
Style: [artistic style].
Camera: [camera movement + lens description].
Lighting: [specific lighting setup].
Mood: [emotional keywords].
Duration: [X] seconds.
```

### RUNWAY GEN-3 - Keyword Prefer

Runway thích prompt structured, JSON-like:

**Structured keywords**:
- "Camera: locked-off", "Camera: slow pan left"
- "Lighting: key light from 45 degrees"
- "Subject: [very specific description]"

**Motion control**:
- "Physics-based motion"
- "Deliberate slow movement"
- "Gentle organic motion"

**Style keywords**:
- "2D hand-drawn animation"
- "Whiteboard illustration style"
- "Minimalist line art"

**Runway template structure**:
```
Subject: [detailed character description]
Action: [specific action verb + modifiers]
Setting: [background description]
Style: [art style]
Camera: [movement + angle]
Lighting: [type + direction]
Mood: [keywords]
Duration: [X] seconds
Aspect ratio: 9:16
```

### SORA - Keyword Prefer

Sora hiểu natural language tốt nhất. Viết như kể chuyện:

**Narrative keywords**:
- "The scene shows..."
- "A solitary figure..."
- "As the wind picks up, the figure..."

**Emotional depth**:
- Mô tả trạng thái nội tâm: "with a sense of contemplation"
- Mô tả atmosphere: "the air feels heavy with anticipation"

**Physical details**:
- Sora render physics tốt → dùng keyword vật lý: "gravity", "weight", "balance"

**Sora template structure**:
```
The scene opens with [subject description]. 
[Action unfolds naturally over time].
The atmosphere conveys [mood].
Visual style: [art direction].
The camera [movement description].
Duration: [X] seconds in 9:16 vertical format.
```

### KLING - Keyword Prefer

Kling yêu prompt NGẮN GỌN. Tối đa 80-100 từ.

**Keyword cô đọng**:
- "Minimalist stick figure walks in rain"
- "Slow motion, dramatic mood"
- "2D black line art, white background"

**Câu ngắn, động từ mạnh**:
- "Figure falls", "Leaves scatter", "Light emerges"

**Kling template structure**:
```
[Subject] [action] in [setting].
Style: [1-2 style keywords].
Mood: [1 mood word].
Duration: [X]s.
Aspect: 9:16.
```

## Test & Iterate

Mỗi tool ra kết quả khác nhau. Workflow đề xuất:

### Bước 1: Test 1 cảnh trên 1-2 tool
Chọn cảnh quan trọng nhất (VD: cảnh Insight). Chạy trên 2 tool khác nhau, so sánh.

### Bước 2: Chọn tool phù hợp
Tool nào ra đúng style nhất → dùng tiếp cho các cảnh còn lại.

### Bước 3: Render batch
Dùng cùng 1 tool + cùng style prompt → video nhất quán.

### Bước 4: Ghép và refine
Ghép clips trong CapCut, xem có cảnh nào không hợp phải re-render.

## Mẹo tiết kiệm credit/tiền

### 1. Test với tool rẻ trước
- Kling render thử → nếu ok thì deploy Veo3/Runway cho final
- Hoặc dùng Runway Turbo (rẻ hơn Gen-3) test trước

### 2. Render nhiều lần với cùng seed
Hầu hết tool cho dùng cùng seed để giữ nhân vật nhất quán → đỡ phải prompt lại từ đầu.

### 3. Ngắn hơn tốt hơn
Clip 3-5s dễ render đúng ý hơn clip 8-10s. Chia cảnh dài thành 2 cảnh ngắn.

### 4. Dùng Image-to-Video
Vẽ frame đầu tiên (hoặc dùng Midjourney tạo) → upload làm start image → tool chỉ cần animate. Nhất quán hơn prompt-to-video.

## Prompt Generator — Format output chuẩn

Khi Claude trả output prompts cho user, format như sau:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 PROMPT CHO CẢNH [N] — [Tên cảnh]
Thời lượng: [X]s | Tool đề xuất: [Tên tool]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Toàn bộ prompt tiếng Anh ở đây]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 NEGATIVE PROMPT:
[Negative prompt ngắn, cụ thể]

📌 GHI CHÚ:
[Lưu ý gì đặc biệt cho cảnh này — seed, reference, v.v.]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

User copy nguyên block → paste vào AI tool.

## Không khuyến nghị

### Prompt "I want..."
❌ "I want a sad stick figure"
✅ "Medium shot of a minimalist stick figure sitting alone, head bowed, shoulders slumped..."

### Từ ngữ cảm xúc không cụ thể
❌ "Beautiful scene"
✅ "Warm golden sunset with long shadows"

### Yêu cầu text trong video
❌ "Show the word 'HOPE' appearing"
✅ Đừng yêu cầu — user sẽ thêm text overlay trong CapCut.

### Yêu cầu nhạc/voice-over
❌ "Play sad piano music"
✅ Đừng yêu cầu — AI video tool không tạo audio match tốt. User sẽ thêm sau.

### Prompt quá dài trên Kling
Kling >100 từ → bị cắt → render sai.
