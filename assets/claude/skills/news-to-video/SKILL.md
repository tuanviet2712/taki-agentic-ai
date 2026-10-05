---
name: news-to-video
description: Biến 1 link bài viết tin tức thành video dọc 9:16 hoàn chỉnh bằng Remotion - tự fetch nội dung + ảnh trong bài + màu thương hiệu website, viết script voice-over, tạo giọng đọc TTS tiếng Việt, đo word-timestamp bằng whisper, sinh phụ đề karaoke highlight theo từ, dựng motion graphic theo 2 hệ phong cách (năng động cho tin thường / tưởng niệm cho đề tài trang nghiêm), render MP4 và master audio đúng chuẩn -14 LUFS. Dùng khi người dùng đưa link bài báo và yêu cầu "tạo video từ bài này", "dựng video tin tức", "làm video từ link", "/news-to-video". Kể cả khi chỉ dán link kèm chữ "làm video" - PHẢI dùng skill này.
---

# NEWS-TO-VIDEO — Từ link bài viết ra video 9:16 hoàn chỉnh

Skill này được đúc kết từ pipeline đã chạy thật qua 4 video (review công nghệ, tưởng niệm liệt sĩ x2, chứng khoán, tin đồn smartphone). Mọi quy tắc bên dưới đều đã kiểm chứng bằng sản phẩm render thật.

## QUY TẮC BẤT BIẾN

- Giao tiếp và output: **TIẾNG VIỆT**
- **KHÔNG bịa số liệu.** Mọi con số trong script/đồ họa phải lấy từ bài viết
- **KHÔNG bịa timing.** Mọi mốc giây tính từ word-timestamp whisper đo trên file voice thật
- Ảnh lấy từ bài viết **phải ghi nguồn** (chip caption "Ảnh: ... / tên báo") — tôn trọng bản quyền
- Phụ đề karaoke: **2-3 từ/chunk**, highlight quét từng từ khớp giọng đọc
- Đề tài trang nghiêm (liệt sĩ, tang lễ, thiên tai, tai nạn chết người) → **BẮT BUỘC dùng hệ tưởng niệm**, không dùng màu vui nhộn, không flash cut, không sticker, không câu hỏi tương tác kiểu giải trí
- Blueprint xong phải render ra file thật — sản phẩm cuối là MP4, không phải mô tả

## YÊU CẦU MÔI TRƯỜNG (cài 1 lần)

```bash
# Node 18+ và ffmpeg phải có sẵn
pip install --user --break-system-packages faster-whisper edge-tts
```

Kiểm tra: `python3 -c "import faster_whisper, edge_tts; print('OK')"` và `ffmpeg -version`.

## QUY TRÌNH 8 BƯỚC

### Bước 1 — Fetch bài viết + ảnh + màu thương hiệu

```bash
curl -sL -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36" "URL" -o /tmp/article.html
```

Trích từ HTML:
- **Nội dung**: vùng `id="article_body"` (hoặc WebFetch để lấy text sạch — nhớ yêu cầu "liệt kê TOÀN BỘ đoạn văn theo thứ tự, không tóm tắt")
- **Ảnh trong bài**: regex `(?:data-original|data-src|src)="(https://...upload/...\.(jpg|jpeg|png|webp))"` trong article_body; fallback: og:image (thử biến thể `_schema_article` để lấy bản không crop). Loại thumbnail nhỏ (`255x170`, `width<300`)
- **Chú thích ảnh**: `<p class="...img_chu_thich...">` (tên class tùy báo)
- **Blog/newsletter** (beehiiv, substack...): không có article_body — trích text từ các thẻ `h1|h2|h3|p|li`, ảnh nằm ở CDN riêng (media.beehiiv.com...)
- **⚠️ BẪY ĐÃ GẶP — kiểm tra NỘI DUNG từng ảnh trước khi gán vào cảnh** (Read ảnh sau khi tải): ảnh đầu trong HTML thường là ảnh bìa og:image chứ không phải ảnh minh họa mục 1, gán theo thứ tự sẽ lệch toàn bộ. Có ảnh hợp với cảnh khác hẳn vị trí của nó trong bài (vd screenshot dialog membership → cảnh mẹo kiếm tiền, screenshot giao diện tool → cảnh công thức). Mục nào không có ảnh → dùng icon panel fallback thay vì nhét ảnh sai
- **Màu thương hiệu**: KHÔNG đoán theo trí nhớ. Tải logo hiện tại của site + grep hex màu lặp nhiều trong CSS (màu hover link, màu tag). Ví dụ đã kiểm chứng: 24h.com.vn = xanh `#78B43D` + đỏ tag `#E60000` + đen `#252525`, font Roboto — dù logo cũ màu đỏ
- Ảnh webp → convert jpg bằng ffmpeg. Ảnh có watermark báo khác → vẫn dùng được nhưng ghi đúng nguồn gốc trong caption

### Bước 2 — Chọn hệ phong cách theo đề tài

| Đề tài | Hệ | Đặc điểm |
|---|---|---|
| Công nghệ, kinh doanh, giải trí, thể thao | **NĂNG ĐỘNG** | Màu thương hiệu site, nền sáng, tag/badge pop spring, beat chuyển chương màu đặc, counter số đếm, kết bằng câu hỏi tương tác |
| Liệt sĩ, tưởng niệm, tang lễ, thiên tai, tai nạn | **TƯỞNG NIỆM** | Nền than `#0F1114`, vàng đồng `#C9A227`, kem `#EAE3D2`, serif (Playfair), sao vàng, fade chậm, ambience trầm, kết lắng đọng |
| Chứng khoán/tài chính | NĂNG ĐỘNG + quy ước **xanh=tăng, đỏ=giảm** |

Nhịp cắt: năng động 3-5s/cảnh, tưởng niệm 4-8s/cảnh. Beat chuyển chương ("CHƯA HẾT.", "THÁNG 8 THÌ SAO?") chỉ dùng cho hệ năng động, 1-2 lần/video.

### Bước 3 — Viết script voice-over

- Độ dài mục tiêu: **50-95 giây** (tin nhanh ~55s, tin sâu/tưởng niệm ~65-95s)
- Cấu trúc: Hook 1 câu gây tò mò → thân theo mạch bài viết → kết (tin thường: câu hỏi tương tác "Bạn nghĩ sao?"; tưởng niệm: câu lắng đọng)
- **Viết số an toàn cho TTS**: "2,95%" → `2 phẩy 95 phần trăm`; "1.735" → `1735` (bỏ dấu chấm nghìn); "mAh" → `mi li am pe giờ` (lần đầu); "100W" → `100 oát`; "P/E" → `P E`
- Giữ nguyên: tên riêng, đơn vị quân đội, địa danh, mốc thời gian

### Bước 4 — Tạo voice TTS

```bash
python3 -m edge_tts --voice vi-VN-NamMinhNeural --rate=RATE \
  --file script.txt --write-media voice.mp3
ffprobe -v error -show_entries format=duration -of csv=p=0 voice.mp3
```

| Tone | Giọng | Rate |
|---|---|---|
| Tin công nghệ/giải trí | NamMinhNeural | `+8%` |
| Tin tài chính/thời sự | NamMinhNeural | `+5%` |
| Tưởng niệm | NamMinhNeural | `-8%` |
| Cần giọng nữ | HoaiMyNeural | tương tự |

**Tùy chọn Vbee AIVoice** (trả phí, ~700 giọng, đủ giọng Bắc/Trung/Nam — đã kiểm chứng chạy thật): nếu env có `VBEE_APP_ID` + `VBEE_TOKEN` thì dùng [scripts/vbee_tts.py](scripts/vbee_tts.py) thay edge-tts — các bước sau giữ nguyên vì pipeline chỉ cần file mp3.

- Credentials để trong `~/.vbee.env` (`chmod 600`, source lúc chạy) — **không bao giờ dán token vào chat/code/git**
- Voice code đã test OK: `hn_female_ngochuyen_full_48k-fhg` (nữ HN, tin tức), `hn_male_phuthang_stor80dt_48k-fhg` (nam HN trầm, kể chuyện/hướng dẫn)
- Vbee đọc số kiểu Việt chuẩn hơn edge-tts ("2,3 triệu", "1.735 điểm" viết bình thường được); whisper bắt timestamp giọng Vbee rất sạch
- API trả `audio_link` trực tiếp trong ~5s; billing theo ký tự (script 65-75s ≈ 1.000-1.400 ký tự)
- Loudness ra ~-15.4 LUFS (edge-tts ~-17) → bước master cuối vẫn bắt buộc
- Speed: tin nhanh `1.05`, thời sự `1.0`, tưởng niệm `0.92`

### Bước 5 — Word timestamps bằng whisper

Chạy [scripts/transcribe.py](scripts/transcribe.py) → ra `words.json` + danh sách **khoảng nghỉ ≥0.4s = ranh giới câu**. Đây là xương sống của mọi timing: mốc cảnh, mốc badge bung, mốc chunk phụ đề.

Lưu ý: whisper sẽ sai chính tả một số từ (tên riêng, từ ghép) — **đối chiếu với script gốc để sửa**, chỉ lấy timing từ whisper.

### Bước 6 — Sinh chunk phụ đề karaoke

Chạy [scripts/chunkgen.py](scripts/chunkgen.py): nhập danh sách câu `(start, end, "TEXT ĐÃ SỬA")` lấy mốc từ Bước 5 → xuất `xxChunks.ts` cho Remotion. Thuật toán: chia 2-3 từ/chunk, timing nội suy đều trong câu (sai số <0.3s, chấp nhận được).

### Bước 7 — Dựng Remotion

Nếu chưa có project: `npx create-video@latest --yes --blank my-video && cd my-video && npm i && npx remotion add @remotion/media && npx remotion add @remotion/google-fonts`

Copy voice.mp3 + ảnh vào `public/`. Mỗi video = 1 thư mục `src/<slug>/` gồm 3 file: `<slug>Chunks.ts`, `<Slug>Graphics.tsx`, `<Slug>Main.tsx`, đăng ký thêm `<Composition>` trong Root.tsx (durationInFrames = ceil((voice + 2~3s đuôi) × 30), 1080x1920 @ 30fps).

**Pattern Main.tsx** — scene theo mốc giây thật:

```tsx
const f = (sec: number) => Math.round(sec * fps);
const Sc = ({ a, b, children }) => (
  <Sequence from={f(a)} durationInFrames={f(b) - f(a)} layout="none">
    <AbsoluteFill>{children}</AbsoluteFill>
  </Sequence>
);
// mốc phụ trợ truyền vào cảnh = (giây voice đọc từ đó − giây bắt đầu cảnh)
<Sc a={19.9} b={27.6}><Leak mathAt={[f(23.4-19.9), f(25.4-19.9)]} /></Sc>
<Captions />                       {/* trên cùng */}
<Audio src={staticFile("voice.mp3")} />
```

**Captions karaoke** (component mẫu trong [templates/Captions.tsx](templates/Captions.tsx)): tìm chunk theo `t = frame/fps`, highlight từ thứ `floor(progress × n)`; năng động = trắng + highlight màu brand + viền đen giả (multi text-shadow), fontSize ~68-72, y=80%; tưởng niệm = kem + highlight vàng, shadow mềm, fontSize ~56. **Ẩn captions** ở cảnh mà chữ trên hình trùng lời thoại (hook title, cảnh typographic, kết).

**Thư viện motif đã kiểm chứng:**
- `PhotoCard`: ảnh bài viết trong card bo góc + ken-burns (scale 1.02→1.14 qua ~8s) + chip caption nguồn. Ảnh screenshot chữ nhiều → `objectFit: contain` nền trắng để không mất chữ
- Badge/tag pop bằng `spring({damping:12, stiffness:150})`, bung **đúng lúc voice đọc tới** (lấy mốc từ words.json)
- Counter số: `interpolate(frame, [a,b], [từ, đến])` + `Math.round` (50MP→200MP, 1485→1735 điểm)
- Chart: `<path strokeDasharray={L} strokeDashoffset={L·(1−draw)}>` vẽ dần; gauge % = arc cùng kỹ thuật
- Beat chuyển chương: AbsoluteFill màu đặc + chữ to pop (hệ năng động)
- Hệ tưởng niệm: `DarkBG` glow vàng nhấp nháy nhẹ (sin), `GoldStar` SVG 5 cánh, dòng chữ `Rise` (fade+translate 20 frames), scene bọc `Fade` in/out 12-14 frames
- Video nguồn có phụ đề baked-in → crop/zoom chỉ lấy vùng trên phụ đề (đo vị trí phụ đề bằng cách extract frame trước)

**Kiểm tra trước khi render full** (bắt buộc):
```bash
npx tsc --noEmit
npx remotion still <CompId> --scale=0.3 --frame=<N> /tmp/check.png  # 4-5 frame đại diện
```
Đọc ảnh kiểm: phụ đề có đè card không, ảnh có mất chữ không, badge có tràn không → sửa rồi mới render.

### Bước 8 — Render + master audio

```bash
npx remotion render <CompId> out/video.mp4 --codec=h264
# đo loudness
ffmpeg -i out/video.mp4 -af loudnorm=print_format=summary -f null - 2>&1 | grep Input
# master 2-pass (điền measured_* từ lệnh trên); tin thường I=-14, tưởng niệm I=-15
ffmpeg -y -i out/video.mp4 \
  -af "loudnorm=I=-14:TP=-1.5:LRA=6:measured_I=<đo>:measured_TP=<đo>:measured_LRA=<đo>:linear=true" \
  -ar 48000 -c:v copy -c:a aac -b:a 256k out/video-mastered.mp4
```

TTS edge thường ra ~-17 LUFS → luôn phải master. KHÔNG dùng volume+alimiter mạnh (AAC overshoot làm true peak vượt 0).

## CHECKLIST QC CUỐI (phải đạt hết mới giao)

- [ ] Tổng thời lượng video = voice + 2-3s đuôi; không cảnh nào "chết" >5s không có chuyển động
- [ ] Mọi số liệu trên đồ họa khớp bài viết gốc
- [ ] Ảnh bài viết có chip ghi nguồn; đề tài trang nghiêm dùng đúng hệ tưởng niệm
- [ ] Phụ đề: 2-3 từ/chunk, highlight chạy khớp giọng, không đè lên card/badge, ẩn ở cảnh chữ trùng lời
- [ ] Badge/counter/chart bung đúng mốc voice đọc (lệch <0.3s)
- [ ] Loudness: -14 LUFS (thường) / -15 (tưởng niệm), true peak ≤ -1 dBTP
- [ ] Cuối video có credit "Nguồn: <tên báo>" (+ tác giả ảnh nếu bài ghi)
- [ ] Đã xem 3-5 frame extract từ file MP4 cuối cùng, không lỗi layout

## GIỚI HẠN CẦN BIẾT

- Whisper small đôi khi sai tên riêng → luôn đối chiếu script gốc
- Timing chunk là nội suy đều trong câu, không phải từng-từ tuyệt đối (sai số <0.3s)
- edge-tts cần mạng; site chặn bot → thêm User-Agent, thử og:image nếu không lấy được ảnh body
- Nhạc nền: pipeline không kèm nhạc bản quyền; hệ tưởng niệm dùng ambience brown-noise lowpass tự sinh, hệ năng động để voice trần (hoặc người dùng tự thêm nhạc sau)
