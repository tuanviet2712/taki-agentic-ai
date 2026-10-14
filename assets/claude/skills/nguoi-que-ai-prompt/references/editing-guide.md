# Hướng Dẫn Ghép Video Trong CapCut

Sau khi có các clips từ AI tool, workflow ghép thành video hoàn chỉnh.

## Công cụ khuyến nghị

### Miễn phí
- **CapCut** (Mobile + Desktop) — DỄ NHẤT cho người không chuyên
- **DaVinci Resolve** — Pro level, miễn phí
- **Clipchamp** (Windows 11) — đơn giản, có sẵn Windows

### Trả phí
- **Adobe Premiere Pro** — tiêu chuẩn công nghiệp
- **Final Cut Pro** (Mac)

Hướng dẫn này dùng **CapCut Desktop** (có tiếng Việt, miễn phí, đủ tính năng).

## Workflow 7 bước

### Bước 1: Chuẩn bị tài nguyên

Tạo 1 folder project, bỏ vào đó:
- Các clips AI (VD: `scene1.mp4`, `scene2.mp4`...)
- File voice-over (nếu đã thu): `voiceover.mp3`
- File nhạc nền: `music.mp3`
- File storyboard tham khảo

### Bước 2: Import vào CapCut

1. Mở CapCut Desktop
2. Click **New Project**
3. Set tỷ lệ **9:16** (click vào tỷ lệ dưới video preview)
4. Import tất cả clips bằng cách drag-drop vào timeline

### Bước 3: Sắp xếp clips theo thứ tự storyboard

Drag các clips vào timeline theo thứ tự:
```
[Scene 1] [Scene 2] [Scene 3] [Scene 4] [Scene 5]
```

**Mẹo**: Đặt tên file rõ ràng trước khi import (`01_setup.mp4`, `02_conflict.mp4`...) để dễ sắp xếp.

### Bước 4: Thêm transition giữa các clips

CapCut có sẵn nhiều transition. Cho video triết lý, dùng:

1. Click giữa 2 clips (sẽ thấy icon transition xuất hiện)
2. Chọn tab **Transitions** bên phải
3. Pick:
   - **Fade** (0.3-0.5s) — phổ biến, mượt
   - **Dissolve** — mềm mại hơn
   - **Cross Dissolve** — chuyên nghiệp

**Không dùng**:
- Transition zoom nhanh (không hợp triết lý)
- Transition có effect (cube, flip...)
- Hard cut nếu 2 cảnh khác tone

### Bước 5: Thêm voice-over

**Cách A: Đã có file voice-over**
1. Drag file MP3 vào track audio thứ 2 (dưới video)
2. Kéo đúng vị trí khớp với cảnh
3. Điều chỉnh volume 100%

**Cách B: Thu trực tiếp trong CapCut**
1. Click **Audio** → **Record**
2. Đọc lời thoại theo storyboard
3. CapCut tự tạo track voice-over

**Cách C: AI TTS (khuyến nghị cho người không muốn thu)**
Dùng:
- **ElevenLabs** — giọng tiếng Việt tự nhiên (trả phí, chất lượng cao nhất)
- **FPT AI** — giọng Việt miễn phí (chất lượng trung bình)
- **Google Text-to-Speech** — miễn phí trong Google Cloud

Upload file MP3 vào CapCut như Cách A.

### Bước 6: Thêm nhạc nền

1. Chọn nhạc phù hợp tone video (xem bảng bên dưới)
2. Drag vào track audio thứ 3
3. **Quan trọng**: Giảm volume nhạc xuống 20-30% để không át voice-over
4. Dùng feature **Auto Ducking** (CapCut có): nhạc tự động nhỏ lại khi có voice

**Nguồn nhạc free**:
- Pixabay Music (`pixabay.com/music`)
- YouTube Audio Library
- Free Music Archive

**Keyword tìm nhạc**:
- "Emotional piano" — cảm xúc, buồn
- "Cinematic ambient" — triết lý, trầm
- "Acoustic guitar meditation" — nhẹ nhàng
- "Zen chill" — yên bình
- "Uplifting soft piano" — hy vọng

### Bước 7: Thêm text overlay

1. Click **Text** → **Add Text**
2. Gõ nội dung (VD: "CÀNG CAO — GIÓ CÀNG LỚN")
3. Style:
   - Font: **Playfair Display** hoặc **Merriweather** (có sẵn trong CapCut)
   - Size: 48-72px (tùy text)
   - Color: Trắng hoặc vàng (cho nền tối) / Đen (cho nền sáng)
4. Position: Drag đến vị trí theo storyboard (trên/giữa/dưới)
5. Animation:
   - **Fade In** (0.3s): Trang trọng, hợp triết lý
   - **Typewriter**: Tăng sự chú ý
   - **Slide Up**: Năng động
6. Duration: Chọn thời gian hiển thị (thường 2-4s)

## Nhạc nền gợi ý theo tone

### Video tone TRẦM LẮNG / SUY TƯ

**Thể loại**: Emotional piano, cinematic ambient

**Gợi ý track** (tìm trên Pixabay):
- "Emotional cinematic piano"
- "Sad reflective piano"
- "Melancholic ambient"

### Video tone HY VỌNG / GIÁC NGỘ

**Thể loại**: Uplifting strings, warm piano

**Gợi ý**:
- "Hopeful inspiring piano"
- "Warm acoustic uplifting"
- "Epic inspirational"

### Video tone TĨNH TẠI / THIỀN

**Thể loại**: Zen, meditation, ambient

**Gợi ý**:
- "Zen meditation music"
- "Peaceful nature ambient"
- "Calm meditation piano"

### Video tone TRIUMPHANT / KẾT CỤC

**Thể loại**: Epic orchestral nhẹ

**Gợi ý**:
- "Triumphant cinematic"
- "Victory inspirational"
- "Epic emotional finale"

## Cấu trúc nhạc theo arc 4 hồi

| Hồi | Loại nhạc | Volume |
|---|---|---|
| Setup | Piano nhẹ, chậm | 30% |
| Conflict (early) | Strings căng dần | 40% |
| Conflict (peak) | Cao trào nhạc | 50% (short moment) |
| Insight | Piano + strings ấm | 30% |
| Lời bàn | Nhạc dâng chậm rồi nhẹ | 30% → 40% |

**Tip**: Dùng 1 bài nhạc dài 1-2 phút cho toàn video, chỉnh volume theo curve.

## Xử lý các vấn đề thường gặp

### Vấn đề: Clips AI có chất lượng khác nhau
- Một số tool render 720p, một số 1080p
- **Fix**: Export cuối ở 1080p → CapCut tự scale

### Vấn đề: Màu giữa các clips không khớp
- **Fix**: Dùng tab **Adjust** trong CapCut
- Chỉnh Temperature + Tint giống nhau cho tất cả clips
- Hoặc dùng LUT preset (filter)

### Vấn đề: Clip AI có logo watermark
- Một số tool free có watermark
- **Fix**: Upgrade trả phí, hoặc crop 2-3% cạnh có watermark

### Vấn đề: Voice-over không khớp với cảnh
- **Fix**: Dùng **Speed** feature trong CapCut
- Tăng/giảm speed voice-over 0.9x - 1.1x
- Hoặc cắt voice-over thành segments, align từng segment

### Vấn đề: Nhạc kết thúc đột ngột
- **Fix**: Dùng **Fade Out** ở 2-3 giây cuối
- Click audio → tab Audio → Fade Out slider

## Export cuối

### Setting export khuyến nghị cho TikTok/Reels

- **Resolution**: 1080 x 1920
- **Frame rate**: 30fps
- **Format**: MP4 (H.264)
- **Quality**: High
- **Audio**: AAC 128kbps

### Cách export
1. Click **Export** (góc trên phải)
2. Chọn preset **TikTok** (CapCut có sẵn) hoặc tùy chỉnh theo setting trên
3. Chọn folder lưu
4. Click **Export**

### Thời gian export
- Video 15-30s thường mất 30 giây - 2 phút
- Tùy máy và setting

## Checklist trước khi đăng TikTok

- [ ] Video đúng tỷ lệ 9:16
- [ ] Độ dài đúng như dự kiến (15/20/25/30s)
- [ ] Voice-over rõ, không bị lẫn vào nhạc
- [ ] Nhạc nền không át voice-over
- [ ] Text overlay đọc được trên mọi thiết bị (không quá nhỏ)
- [ ] Transition mượt giữa các cảnh
- [ ] Không có watermark AI tool
- [ ] Có CTA rõ ở cuối
- [ ] Chất lượng 1080p
- [ ] Đã xem preview từ đầu tới cuối ít nhất 2 lần

## Caption + Hashtag cho TikTok

Khi đăng, dùng format:

```
[Câu hook gợi tò mò phù hợp video]

[Lời bàn ngắn từ video]

[Tag bạn bè / CTA]

#triethoc #dacnhantam #bailife #tiktokvietnam 
#nhansinh #trietnhan #suytu #cuocsong 
#nguoique #stickfigure #baihoc
```

**Ví dụ** (cho video "Cây cao gió lớn"):
```
Càng lên cao, càng lẻ loi 🌳

"Sức mạnh thật không ở độ cao — mà ở chiều sâu."

Tag người bạn cần đọc điều này 💛

#triethoc #dacnhantam #bailifcuocsong 
#suytu #nhansinh #trietnhan #nguoique
#taki #mentorkiemnguyen
```

## Quy trình tối ưu thời gian

Nếu làm nhiều video (VD: series triết lý):

### Làm 1 lần, dùng nhiều lần:

1. **Template CapCut** (save project đã setup xong)
   - Tỷ lệ 9:16
   - Font, màu text overlay đã chuẩn
   - Nhạc nền đã chọn 2-3 bài

2. **Voice preset ElevenLabs**
   - Chọn 1 voice actor phù hợp
   - Save setting giọng (tone, pace)

3. **Prompt template chuẩn** (Claude đã tạo)
   - Chỉ thay nội dung cụ thể mỗi video

→ Video sau chỉ mất 1/3 thời gian video đầu.
