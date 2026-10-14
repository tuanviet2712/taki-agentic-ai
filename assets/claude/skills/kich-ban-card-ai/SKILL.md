---
name: kich-ban-card-ai
description: >
  Tạo kịch bản video Reels/TikTok/Shorts dạng TEXT-CARD FACELESS về AI (phong cách
  "Hoàng Anh AI 5 Phút" / "AI Ứng Dụng"): không người nói, chỉ card chữ nền tối, voice-over,
  karaoke subtitle, keyword highlight đỏ/vàng. Output 3 phần: bảng card-by-card 5 cột,
  voice-over liền mạch, caption + checklist dựng. Hỗ trợ 4 dạng: Listicle tool ("14 con AI
  thay cả team"), Bộ prompt ("7 prompt tạo thuyết trình"), Tutorial setup ("Claude Code +
  Antigravity trong 2 phút"), Workflow chain ("Gemini làm video như cả ekip"). Dùng BẤT CỨ
  KHI NÀO muốn: viết kịch bản video card chữ / faceless về AI tool, prompt, workflow; kịch
  bản kiểu "Hoàng Anh AI", "AI Ứng Dụng"; chuyển bài viết / danh sách prompt thành kịch bản
  video card. Kích hoạt khi nghe: "kịch bản card AI", "video card chữ", "kịch bản faceless
  AI", "video danh sách tool", "kịch bản bộ prompt", "video text card", "làm video về [N]
  tool AI", "kịch bản AI Ứng Dụng".

---

# Kịch Bản Video Text-Card AI Faceless

Skill tạo kịch bản video ngắn dọc 9:16 (60–130 giây) dạng **text-card faceless**: không người nói, không footage quay, chỉ gồm chuỗi card chữ động trên nền tối + voice-over + karaoke subtitle. Format đã được kiểm chứng viral trên Reels/TikTok mảng AI tại Việt Nam.

Trước khi viết, đọc `references/format-mau.md` để nắm 4 kịch bản mẫu đã phân tích từ video thật (bắt buộc đọc khi tạo kịch bản lần đầu trong hội thoại).

## Bước 0 — Thu thập input

Cần 3 thông tin. Nếu thiếu, hỏi gọn trong 1 câu (không hỏi quá 1 lần):

1. **Chủ đề + dạng video** (nếu user chưa nói rõ, tự suy ra từ chủ đề):
   - **Dạng A — Listicle tool**: danh sách N tool AI theo nhóm công việc
   - **Dạng B — Bộ prompt**: N prompt sẵn dùng cho 1 mục tiêu
   - **Dạng C — Tutorial setup**: hướng dẫn cài/kết hợp tool theo bước, kèm ví dụ ứng dụng
   - **Dạng D — Workflow chain**: chuỗi prompt biến 1 tool thành "cả ekip"
2. **Tên kênh** (mặc định: "AI Ứng Dụng" nếu user không nói; nếu user từng nêu kênh khác trong hội thoại thì dùng kênh đó)
3. **CTA mong muốn** (mặc định: theo dõi kênh + bấm link dưới bình luận nhận tài liệu/prompt)

Nếu user dán sẵn tài liệu (bài viết, danh sách prompt, file), KHÔNG hỏi — chuyển thẳng nội dung đó thành kịch bản.

## Cấu trúc kịch bản chuẩn

```
HOOK CARD (0–6s) → [BODY: 4–8 CARD nội dung] → OUTRO CARD (CTA, 5–8s)
```

Thời lượng mục tiêu: 60–130s. Voice tiếng Việt đọc ~150 từ/phút → tổng voice-over **180–330 từ**. Mỗi card body: 10–18 giây, voice 25–45 từ.

### 1. HOOK CARD — chọn 1 trong 4 công thức

| Công thức | Mẫu | Khi nào dùng |
|---|---|---|
| **Phủ định** | "Đừng [cách làm sai phổ biến]. [N] [giải pháp] dưới đây [kết quả]." | Dạng A, B |
| **Tin nóng** | "TIN NÓNG: Nếu bạn kết hợp [Tool X] với [Tool Y] thì [kết quả tự động hóa]." | Dạng C |
| **So sánh ekip** | "[Tool] làm [việc] thay bạn như cả một ekip [N] người." | Dạng D |
| **Con số thời gian** | "[N] prompt tạo [kết quả chuyên nghiệp] trong [2 phút]." | Dạng B |

Quy tắc hook: dưới 20 từ voice, chứa ít nhất 1 con số, từ khóa mạnh nhất nằm trong 5 từ đầu. Trên card: số và từ khóa chính highlight **đỏ**, dòng phụ (sub-headline) màu **vàng**.

### 2. BODY CARD — theo dạng video

**Dạng A (Listicle tool)**: mỗi card = 1–2 tool. Cấu trúc card: `[Số đỏ]. [Tên tool]` + 2–3 bullet (mỗi bullet 3–7 từ: chức năng → lợi ích). Logo tool mờ giữa card. Nhóm tool theo cụm công việc (content, video, voice, research...) để có nhịp chuyển. Voice mỗi tool: 1 câu chức năng + 1 câu lợi ích, không đọc nguyên văn bullet.

**Dạng B (Bộ prompt)**: mỗi card = 1 prompt. Cấu trúc: `[Số đỏ]. [Tên prompt]` + label đỏ `Prompt:` + nội dung prompt rút gọn (có chỗ trống `[dán chủ đề]` highlight vàng) + label vàng `Bao gồm:`/`Tiêu chuẩn:` + 2–3 bullet. Voice đọc bản chất prompt, không đọc từng chữ.

**Dạng C (Tutorial setup)**: card theo `Bước [số đỏ]: [Tên bước]` + 2–3 bullet hành động đánh số. Sau các bước setup, BẮT BUỘC có 1–2 card `Ví dụ:` cho thấy ứng dụng thực tế (input người dùng → tool sẽ làm gì). Đây là phần giữ chân mạnh nhất của dạng C.

**Dạng D (Workflow chain)**: mỗi card = 1 mắt xích, đặt tên theo động từ kết quả ("Viết kịch bản", "Biến kịch bản thành shot list", "Tạo voice-over tự động"...). Card có label đỏ `Prompt:` + câu prompt mẫu, label vàng `Yêu cầu:` + tiêu chí. Card kết trước CTA: tổng kết "Đây là workflow biến [tool] thành [vai trò]" với sub-headline vàng.

### 3. OUTRO CARD

- Text card: dòng lớn trắng "Giữ kết nối" (hoặc biến thể), dưới là tên kênh màu vàng
- Voice CTA chuẩn: "Theo dõi [tên kênh] và bấm vào link dưới bình luận để [nhận trọn bộ prompt / cập nhật kiến thức AI liên tục]."
- Nếu kênh có khung giờ đăng, thêm: "[giờ] hằng ngày."

## Quy tắc ngôn ngữ voice-over

- Đời thường, nói chuyện 1-1, xưng "bạn". Không sáo rỗng, không "trong thời đại 4.0".
- Câu ngắn 6–14 từ. Mỗi card ít nhất 1 con số cụ thể (thời gian, %, số bước, số tiền).
- Thuật ngữ AI giữ tiếng Anh (prompt, workflow, tool, extension, voice-over).
- KHÔNG dùng dấu gạch ngang em-dash trong toàn bộ output.
- Chuyển card có từ nối nhịp: "Tiếp theo", "Chưa hết", "Quan trọng nhất", "Cuối cùng".
- Cài 1 câu "giữ chân" ở khoảng 60–70% video: "Cái số [N] cuối mới là thứ thay đổi cuộc chơi" hoặc tương đương.

## Spec thiết kế card (đưa vào output cho editor)

- Khung dọc 9:16 (1080x1920), nền đen/xanh đậm gradient + particle bokeh mờ trôi chậm
- Header trên cùng: tên kênh, chữ trắng nhỏ, luôn cố định
- Tiêu đề card: sans-serif bold trắng (kiểu Inter/Poppins ExtraBold), cỡ lớn; số thứ tự và keyword chính màu đỏ `#FF3B30`; sub-headline màu vàng `#FFC53D` có gạch chân mảnh
- Bullet: chấm tròn đỏ/vàng xen kẽ + đường kẻ dọc mảnh bên trái, text trắng, hiện lần lượt theo voice
- Label bên trái bullet (`Prompt:`, `Yêu cầu:`, `Bao gồm:`): đỏ hoặc vàng, đậm
- Logo tool: đặt giữa/dưới card, opacity 25–40%
- Karaoke subtitle đáy màn: trắng đậm, từ đang đọc nhuộm đỏ, tối đa 5–6 từ/dòng
- Nhạc nền: lo-fi/ambient tech nhẹ, volume dưới voice

## Format output (luôn đủ 3 phần)

**PHẦN 1 — Bảng kịch bản card-by-card** (bảng 5 cột):

| # Card | Thời lượng | Text trên card | Voice-over | Visual/Note |

Trong cột "Text trên card": ghi rõ phần nào đỏ `[đỏ]...[/đỏ]`, phần nào vàng `[vàng]...[/vàng]`, label và bullet xuống dòng đúng như hiển thị.

**PHẦN 2 — Voice-over liền mạch**: toàn bộ lời đọc nối lại thành 1 khối để thu âm/đưa vào TTS, kèm tổng số từ và thời lượng ước tính.

**PHẦN 3 — Caption + checklist**: caption đăng bài (hook lại + CTA comment từ khóa nhận tài liệu + 4–6 hashtag), checklist dựng 5 dòng cho editor.

Sau output, hỏi đúng 1 câu: có muốn tạo biến thể hook A/B hoặc nhân bản sang chủ đề khác không.
