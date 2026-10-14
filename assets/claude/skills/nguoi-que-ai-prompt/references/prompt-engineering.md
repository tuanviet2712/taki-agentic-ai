# Prompt Engineering Nâng Cao — Consistency, Negative Prompt, Seed

Các tips giúp video ra đúng ý và nhất quán giữa các cảnh.

## 1. CHARACTER CONSISTENCY — Giữ nhân vật nhất quán

**Vấn đề**: AI render mỗi cảnh 1 kiểu — cảnh 1 người que gầy, cảnh 3 béo, cảnh 5 đội mũ.

**Giải pháp**: Copy-paste cùng 1 character description trong mọi prompt.

### Character block chuẩn

Viết 1 block mô tả người que, đặt vào ĐẦU mỗi prompt:

```
Character: A minimalist black stick figure with the following exact features:
- Round head (simple circle outline, no fill)
- Two small solid black eye dots (no other facial features)
- Single vertical thin line as body
- Two arms as thin lines extending from shoulders
- Two legs as thin lines extending from hip
- No clothing, no hair, no accessories
- Stroke width: 4px consistent throughout
- Pure black ink color
- Scale: medium (appears ~50% of frame height)
```

### Ví dụ áp dụng

**Cảnh 1**: 
```
[CHARACTER BLOCK]
Scene: The stick figure stands still in the center of a white empty frame, 
hands at sides, neutral posture...
```

**Cảnh 3**:
```
[CHARACTER BLOCK (SAME)]
Scene: The stick figure is now fallen on the ground, lying face-down, 
arms spread out, legs slightly bent...
```

Dùng cùng character block → AI render ra cùng 1 người que.

## 2. STYLE CONSISTENCY — Giữ phong cách nhất quán

### Style block chuẩn

Thêm vào mỗi prompt:

```
Style reference: hand-drawn 2D line art animation, black ink on white 
background, minimalist whiteboard animation aesthetic, 
extremely simplified forms, no gradients, no shadows, 
no color except black and white, uniform 4px stroke width throughout.
```

### Artistic reference (tùy chọn)

Nếu muốn tone cụ thể, tham khảo artist/style nổi tiếng:

- **"In the style of Keith Haring's figure work"** — nếu muốn hơi play, rounded
- **"Reminiscent of XKCD comic illustrations"** — nếu muốn đơn giản nhất
- **"Inspired by minimal Japanese sumi-e ink paintings"** — nếu muốn thiền, trầm
- **"Like Draw My Life YouTube videos"** — whiteboard animation chuẩn

**Tip**: Dùng 1 reference duy nhất xuyên suốt video.

## 3. NEGATIVE PROMPT — Chống render sai

AI video tool dễ render stick figure thành realistic human hoặc 3D. Negative prompt cực kỳ cần thiết.

### Negative prompt chuẩn cho stick figure triết lý

```
Negative prompt: realistic human, photorealistic, 3D rendered, 
detailed facial expressions, detailed face, muscular body, 
colored clothing, colored skin, hair, anime style, cartoon character, 
Disney style, Pixar style, detailed hands with fingers, detailed feet, 
textured surfaces, gradients, shadows on the figure, 
cluttered background, colorful scene, photographic quality, 
detailed environment, grass blades, individual leaves rendered, 
realistic lighting physics.
```

### Biến thể tùy loại cảnh

**Cho cảnh nature (cây, núi)**:
```
Negative prompt: ...realistic forest, individual leaves on trees, 
photographic mountains, detailed rocks, grass blade details.
```

**Cho cảnh weather (mưa, tuyết)**:
```
Negative prompt: ...individual raindrops, realistic water splashes, 
3D rain physics, detailed snowflakes, volumetric fog.
```

**Cho cảnh cô đơn/buồn**:
```
Negative prompt: ...multiple figures, crowd, characters in background, 
people talking, groups.
```

## 4. SEED — Giữ nhất quán giữa các lần render

Nhiều AI tool cho set SEED (số cố định) → cùng prompt + cùng seed = cùng output.

### Cách dùng seed

**Bước 1**: Render cảnh 1, note số seed tool trả về (VD: `seed: 42891`)

**Bước 2**: Render các cảnh sau, set seed = 42891

**Bước 3**: Nếu có cảnh không đạt, chỉ đổi seed cảnh đó

### Tool hỗ trợ seed

- **Runway Gen-3**: Có — advanced settings
- **Veo3**: Có — API parameter
- **Sora**: Không public seed
- **Kling**: Có trong bản Pro

### Lưu ý seed

Seed chỉ giữ nhất quán TRONG CÙNG 1 LẦN render. Nếu tool update version → seed cũ có thể không còn hiệu lực.

## 5. TRANSITION HINTS — Chuyển cảnh mượt

### End-of-scene hint

Thêm cuối mỗi prompt (trừ cảnh cuối):

```
The scene ends with [transition cue]:
- Camera slowly zooming out to reveal wider context
- Fade transition to white (bright)
- Figure walks out of frame to the right
- Camera tilts up toward sky
```

### Beginning-of-scene hint

Thêm đầu cảnh tiếp theo:

```
The scene begins with [transition cue]:
- Camera zoomed in from previous wide shot
- Fade in from white
- Figure walking into frame from the left
- Camera tilted down from sky view
```

### Ví dụ match cut

**Cảnh 3 kết**: "The scene ends with camera slowly tilting up toward the dark stormy sky."

**Cảnh 4 bắt đầu**: "The scene begins with camera tilted toward the sky, now dawn-lit. Camera slowly tilts down to reveal the figure sitting peacefully."

→ 2 cảnh nối mượt như 1 camera liên tục.

## 6. MOOD CONTINUITY — Tone nhất quán

Mood keywords phải theo arc cảm xúc:

| Hồi | Mood keywords |
|---|---|
| Setup | "neutral, observant, quiet, everyday" |
| Conflict (early) | "tense, worried, struggling" |
| Conflict (peak) | "desperate, vulnerable, defeated" |
| Insight | "contemplative, dawning realization, tender" |
| Lời bàn | "peaceful, wise, transcendent, serene" |

Đừng bỏ bước — nếu chuyển từ "defeated" sang "serene" ngay lập tức sẽ gãy cảm xúc. Phải qua "contemplative" trước.

## 7. CAMERA DIRECTION — Chỉ đạo camera

### Các camera movement phù hợp video triết lý

- **Static (lock-off)**: Ổn định, chiêm nghiệm — dùng cho cảnh lặng
- **Slow pan**: Di chuyển trang trọng — dùng cho cảnh mở rộng
- **Slow push-in (dolly in)**: Zoom vào — dùng cho insight moment
- **Slow pull-out (dolly out)**: Zoom ra — dùng cho reveal, lời bàn
- **Tilt up/down**: Chuyển hướng nhìn — dùng cho transition giữa các hồi

### Nên tránh

- ❌ Camera shake quá nhiều (hợp action, không hợp triết lý)
- ❌ Fast cuts (video triết lý cần nhịp chậm)
- ❌ Dutch angle (nghiêng chéo) quá đà
- ❌ Handheld lắc lư (kém chuyên nghiệp)

## 8. LIGHTING DIRECTION — Lighting kể chuyện

Lighting trong video triết lý = ngôn ngữ cảm xúc:

| Giai đoạn | Lighting |
|---|---|
| Setup | "Flat neutral white lighting, no drama" |
| Conflict | "Darker gray tones, low key lighting, occasional stark contrast" |
| Peak conflict | "Very dark, barely visible, harsh shadows" |
| Insight | "Soft warm glow emerging, golden hour transition" |
| Lời bàn | "Full warm golden hour, soft and contemplative, long shadows" |

Dùng keyword rõ:
- "Key light from 45 degrees creating long shadows"
- "Backlit creating rim light silhouette"
- "Soft diffused overcast sky lighting"

## 9. DURATION CONTROL — Kiểm soát thời lượng

### Tool có giới hạn duration

- Kling: 5-10s (tùy plan)
- Runway: 4-10s
- Veo3: 4-8s
- Sora: đến 20s

### Nếu cảnh cần dài hơn giới hạn

**Cách 1**: Chia làm 2 prompt, cùng style, ghép sau:
```
Prompt 1A (0-5s): "Figure walking slowly... Scene ends with figure stopping."
Prompt 1B (5-10s): "Figure standing still looking forward... Continues from previous pose."
```

**Cách 2**: Dùng slow motion — render 5s nhưng chạy 0.5x speed = 10s:
```
"Duration: 5 seconds, to be played at 0.5x speed."
```
Khi edit trong CapCut, giảm speed xuống 50%.

## 10. PROMPT TESTING CHECKLIST

Trước khi gửi prompt cho user, Claude tự review:

- [ ] **Shot type** rõ ràng (wide/medium/close-up)?
- [ ] **Subject description** cụ thể (character block)?
- [ ] **Action verb** mạnh, không vague?
- [ ] **Style** có keyword nhất quán (hand-drawn, minimalist, 2D...)?
- [ ] **Camera movement** được chỉ định?
- [ ] **Lighting** mô tả rõ (flat/warm/cool...)?
- [ ] **Mood keywords** 2-3 từ?
- [ ] **Duration** khớp với storyboard?
- [ ] **Aspect ratio** có ghi (9:16 vertical)?
- [ ] **Negative prompt** đầy đủ để tránh realistic?

Nếu thiếu mục nào → bổ sung trước khi gửi.

## 11. DEBUGGING — Khi output AI không như ý

### Triệu chứng: Người que trông realistic, có chi tiết mặt
**Nguyên nhân**: Thiếu/yếu negative prompt.
**Fix**: Thêm vào negative: "realistic face, detailed eyes, mouth, skin texture, hair"

### Triệu chứng: Background quá rối
**Nguyên nhân**: Prompt mô tả environment quá nhiều.
**Fix**: Giảm mô tả environment, nhấn mạnh "plain empty white background"

### Triệu chứng: Motion giật, không mượt
**Nguyên nhân**: Duration quá dài so với action.
**Fix**: Giảm duration hoặc chia làm 2 cảnh.

### Triệu chứng: Người que biến mất giữa cảnh
**Nguyên nhân**: AI không hiểu subject đủ rõ.
**Fix**: Mở đầu prompt bằng character block đầy đủ.

### Triệu chứng: Màu sắc không mong muốn
**Nguyên nhân**: AI infer màu từ context.
**Fix**: Nhấn mạnh "monochrome black and white only, no color"

### Triệu chứng: Camera chuyển động loạn
**Nguyên nhân**: Không chỉ định camera.
**Fix**: Thêm "Camera: completely static lock-off shot, no movement"
