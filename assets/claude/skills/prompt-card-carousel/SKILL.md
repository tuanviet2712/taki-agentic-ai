---
name: prompt-card-carousel
description: >-
  Tạo bộ ảnh carousel "thẻ prompt AI" theo phong cách thương hiệu Nguyễn Tất Kiểm / Scale Mentor —
  1 ảnh bìa hook (nền navy, viền vàng, chữ trắng-vàng xen kẽ) + N ảnh thẻ prompt (nền kem caro,
  badge số đỏ, thanh PROMPT đỏ, nội dung prompt in nghiêng, footer thương hiệu). Render ra file PNG
  1080x1350 (4:5) dùng ngay để đăng Facebook/Instagram/TikTok. DÙNG SKILL NÀY BẤT CỨ KHI NÀO người dùng
  muốn: tạo content ảnh prompt, content ảnh text prompt, bộ thẻ prompt, carousel prompt AI, ảnh chia sẻ
  prompt, infographic prompt, "N prompts giúp...", biến danh sách prompt thành ảnh đăng bài, tạo ảnh
  prompt theo mẫu Nguyễn Tất Kiểm / Minh Trí / Scale Mentor. Kích hoạt khi nghe "tạo ảnh prompt",
  "content ảnh prompt", "thẻ prompt", "carousel prompt", "5 prompts về [chủ đề]", "ảnh prompt AI",
  "làm ảnh chia sẻ prompt", "infographic prompt", "bộ ảnh prompt đăng bài", kể cả khi người dùng chỉ
  dán 1 danh sách prompt và nói "làm thành ảnh giúp anh".
---

# Prompt Card Carousel

Tạo bộ ảnh carousel chia sẻ prompt AI, render thẳng ra PNG sắc nét theo đúng bộ nhận diện
Nguyễn Tất Kiểm / Scale Mentor (đỏ – vàng – kem). Đầu vào là một chủ đề + tool + số lượng prompt,
HOẶC một danh sách prompt người dùng đưa sẵn. Đầu ra là N+1 file PNG 1080×1350 sẵn sàng đăng.

## Khi nào dùng

- Người dùng muốn biến một bộ prompt thành ảnh đăng bài (Facebook/IG/TikTok carousel).
- Người dùng nói "5 prompts giúp...", "bộ prompt về [chủ đề]", "content ảnh prompt", "thẻ prompt".
- Người dùng dán sẵn danh sách prompt và muốn ra ảnh theo mẫu.

## Đầu ra

- `slide_01.png` = ảnh **bìa** (hook).
- `slide_02.png` … `slide_0N+1.png` = mỗi ảnh một **thẻ prompt**.
- Tất cả 1080×1350px, đủ font tiếng Việt + emoji, nền + viền + badge đúng brand.

---

## QUY TRÌNH 5 BƯỚC

### Bước 1 — Chốt input

Cần đủ 3 thứ. Nếu thiếu thì hỏi gọn 1 lần, đừng hỏi lan man:

1. **Tool/chủ đề**: prompt dùng cho tool nào (ChatGPT, Gemini, Claude...) và phục vụ việc gì
   (họp, viết content, bán hàng, học tiếng Anh...).
2. **Số prompt N**: mặc định **5**. Cho phép 3–10.
3. **Prompt content**: hoặc người dùng đưa sẵn danh sách prompt, hoặc nhờ tự soạn theo chủ đề.

Nếu người dùng đã đưa đủ (ví dụ dán sẵn 5 prompt) thì bỏ qua hỏi, làm luôn.

### Bước 2 — Viết nội dung (quan trọng nhất)

Viết theo đúng giọng brand. **Luật nội dung bắt buộc:**

- Tiếng Việt đời thường, cụ thể, không sáo rỗng.
- **KHÔNG dùng dấu gạch ngang em-dash (—).** Được dùng en-dash có khoảng trắng `" – "` đúng như mẫu brand (ví dụ "nghe – hiểu – tổng hợp").
- Mỗi prompt phải **dùng được ngay**, viết như câu lệnh ra lệnh cho AI, có cấu trúc rõ.
- Tiêu đề thẻ viết IN HOA, ngắn, mô tả đúng việc prompt làm.

**Công thức ẢNH BÌA (4 dòng):**

1. Emoji + headline trắng nêu **kết quả mong muốn** (ví dụ "📄 Họp xong là có biên bản ngay,").
2. Dòng VÀNG IN HOA đập vào **nỗi đau cũ bị xóa bỏ** (ví dụ "KHÔNG CẦN GHI CHÉP TAY.").
3. Dòng trắng (cỡ nhỏ hơn) nêu **giá trị**: "[Tool] nghe – hiểu – ... còn chuẩn hơn cả [vai trò]".
4. Dòng VÀNG IN HOA là **CTA**: "[N] PROMPTS GIÚP [làm gì] TRONG VÀI PHÚT 👇👇👇".

**Công thức THẺ PROMPT (mỗi prompt 1 thẻ):**

- `number`: "01", "02", ...
- `title`: tên việc, IN HOA, ngắn gọn.
- `intro`: câu mở "Hãy [làm gì]..., gồm:" / "Từ [input], hãy chỉ ra:".
- `bullets`: 3–5 gạch đầu dòng, mỗi cái là 1 thành phần prompt yêu cầu.
- `outro` (tùy chọn): câu ràng buộc cuối "Viết ngắn gọn...", "Trình bày dễ đọc...".

Giữ độ dài prompt vừa phải để chữ không tràn thẻ (script tự co chữ, nhưng đừng viết quá dài).

### Bước 3 — Dựng file `slides.json`

Tạo file JSON theo schema dưới. Xem `reference/slides.example.json` để có mẫu đầy đủ.

```json
{
  "config": {
    "width": 1080, "height": 1350, "scale": 2,
    "theme": "ntk",
    "brand_name": "NGUYEN TAT KIEM.COM",
    "brand_tagline": "SCALE MENTOR"
  },
  "slides": [
    {
      "type": "cover",
      "font_size": 58,
      "lines": [
        { "text": "📄 Dòng headline kết quả,", "accent": false },
        { "text": "DÒNG VÀNG NỖI ĐAU.", "accent": true },
        { "text": "Dòng giá trị cỡ nhỏ hơn, có thể dài.", "accent": false, "small": true },
        { "text": "N PROMPTS GIÚP ... 👇👇👇", "accent": true }
      ]
    },
    {
      "type": "card",
      "number": "01",
      "title": "TÊN VIỆC IN HOA",
      "intro": "Hãy ... , gồm:",
      "bullets": ["Ý 1", "Ý 2", "Ý 3"],
      "outro": "Câu ràng buộc cuối."
    }
  ]
}
```

Quy tắc field:
- `accent: true` = dòng chữ vàng. `accent: false` = chữ trắng. `small: true` = cỡ chữ nhỏ hơn (dùng cho dòng giá trị dài).
- `font_size` của cover: 52–62 tùy độ dài. Dài thì để nhỏ.
- Thẻ: `outro` bỏ được nếu prompt không có câu kết.
- Có thể thêm `bg_image` (đường dẫn ảnh) vào cover để chèn ảnh nền mờ phía sau.
- Có thể chỉnh `title_size` / `prompt_size` / `font_size` từng slide nếu cần ép cỡ chữ.

### Bước 4 — Render ra PNG

```bash
cd <thư mục skill>
python assets/render.py --data slides.json --out ./output --scale 2
```

Script tự: nạp JSON → chèn data + font vào template → mở Chromium (Playwright) →
chụp từng slide → hạ kích thước về đúng 1080×1350 (Pillow LANCZOS) → lưu `slide_01.png`...

Nếu Playwright/Chromium chưa có: `pip install playwright pillow && playwright install chromium`.

### Bước 5 — Giao file + gợi ý caption

- Dùng `present_files` đưa toàn bộ PNG cho người dùng (ảnh bìa trước).
- Kèm 1 caption ngắn để đăng bài + nhắc thứ tự slide (bìa → 01 → 02 ...).

---

## Tùy biến thương hiệu

**Mặc định = NTK** (đỏ #D81F26 / vàng #E9B84C / kem #F3F1EA, font Be Vietnam Pro). Không cần chỉnh gì.

**Đổi sang brand khác:**
- Đổi `brand_name` và `brand_tagline` trong `config`.
- Theme `"taki"`: nền xanh + Roboto (cho TAKI Academy). Set `"theme": "taki"`.
- Đổi màu sâu hơn: sửa biến CSS trong `assets/template.html` (khối `:root` cho ntk, `[data-theme="taki"]` cho taki). Biến hay dùng: `--accent` (đỏ: badge/thanh PROMPT/mũi tên), `--gold` (chữ vàng cover + viền bìa), `--navy-1`/`--navy-2` (gradient nền bìa), `--bg-card` (nền kem thẻ), `--title` (màu tiêu đề), `--prompt-text` (màu chữ prompt), `--bullet` (màu chấm đầu dòng).

**Đổi kích thước:** sửa `width`/`height` trong config (ví dụ 1080×1080 vuông). Script tự scale theo.

---

## Checklist chất lượng (kiểm trước khi giao)

- [ ] Cover: dòng 1 & 3 trắng, dòng 2 & 4 vàng, có emoji + 👇 cuối.
- [ ] Không có em-dash (—) ở bất kỳ đâu. En-dash có khoảng trắng `" – "` thì OK.
- [ ] Mỗi thẻ có badge số đỏ, thanh PROMPT đỏ + mũi tên →, chữ prompt in nghiêng, bullet đỏ.
- [ ] Footer đúng brand_name + tagline.
- [ ] Chữ tiếng Việt đủ dấu, không bị tràn ra ngoài thẻ.
- [ ] Đủ N+1 file PNG, đúng 1080×1350.

## Tham khảo

- `reference/slides.example.json` — bộ data mẫu đầy đủ (bìa + 5 thẻ, chủ đề biên bản họp Gemini).
- `assets/template.html` — template HTML + CSS 2 theme + JS co chữ tự động.
- `assets/render.py` — script render HTML → PNG.
- `assets/fonts/` — font Be Vietnam Pro (5 weight) + Roboto VF, đã nhúng sẵn, không cần mạng.
