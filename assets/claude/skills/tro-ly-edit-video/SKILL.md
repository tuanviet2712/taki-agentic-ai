---
name: tro-ly-edit-video
description: Trợ lý dựng video dọc tiếng Việt cho TikTok/Reels/Shorts trên Mac. Nhận một hoặc nhiều file quay thô, tự nhận dạng giọng nói, cắt khoảng lặng theo năng lượng âm thanh, viết kịch bản dựng, làm phụ đề có dấu chuẩn, title chồng lớp cắt khuyết, cảnh trám kiểu giao diện, nhạc và tiếng động cân theo mức đo được, kiểm tra lỗi 3 lượt, rồi bàn giao video kèm ảnh bìa vào thư mục riêng. Dùng khi người dùng đưa file quay và bảo "edit", "dựng", "hoàn thiện", "làm video", hoặc yêu cầu ảnh bìa/thumbnail. Toàn bộ chạy cục bộ, không upload video đi đâu.
---

# Trợ lý dựng video dọc tiếng Việt

Thư mục skill: `~/.claude/skills/tro-ly-edit-video`.
Người dùng mới → `BAT-DAU.md`. Cài đặt và tự chỉnh → `CAI-DAT.md`.
Kho tài nguyên → `reference/kho-tai-nguyen.md`. Máy yếu → `reference/may-yeu.md`.

**Đọc `cau-hinh.json` trước khi dựng** — font, màu nhấn, logo, tốc độ, mức âm thanh,
khung ảnh bìa, nơi trả file đều lấy từ đó, mỗi người một khác. Trong script dùng
`config.lay(...)` và `kit.find(...)`, **không viết đường dẫn hay thông số cứng**.

Soát trước khi bắt đầu:
```bash
python3 scripts/kit.py       # kho có đủ không
python3 scripts/config.py    # cấu hình đang hiệu lực
python3 scripts/che_do.py    # sức máy, chế độ nhanh/chuẩn/kỹ
```
Thiếu thứ gì thì **báo người dùng ngay**, đừng lặng lẽ thay bằng font hệ thống.
Chưa có kho thì bảo họ chạy `python3 scripts/dung_kho.py ~/Movies/VideoKit-Free`.

Thư viện mẫu dựng sẵn, đọc bằng `kit.preset(...)`:
`kieu-chu` (kiểu chữ) · `chuyen-canh` (chuyển cảnh) · `canh-tram` (cảnh trám).
Chọn mẫu từ đó thay vì bịa thông số mới mỗi lần.

## Quy trình 5 bước — làm đủ, không bỏ bước

### 1. ĐỌC

- Chép file quay vào `<kho>/nguon/` bằng `ffmpeg -map 0:v:0 -map 0:a:0 -c copy`.
  **Bắt buộc**: nhiều máy (DJI Pocket, GoPro) nhét luồng thứ 3 là ảnh thu nhỏ mjpeg khiến
  CapCut và vài công cụ bắt nhầm kích thước khung. Và CapCut sandbox chỉ đọc được `~/Movies`.
- Trích tiếng 16 kHz mono, nhận dạng bằng `mlx-whisper`. Model lấy từ
  `che_do.hien_tai()["model"]` (theo `may.che_do`), **không ghi cứng**.
  Tham số: `language="vi"`, `word_timestamps=True`, `condition_on_previous_text=False`.
- **Xem hình trước khi dựng.** Lấy 6–12 khung rải đều rồi nhìn. Quay màn hình và nói trực tiếp
  phải dựng khác nhau — xem bước 2.
- Đọc kỹ bản chữ: tìm đoạn nói sai nói lại, câu bỏ dở, tiếng "ừm", đoạn loay hoay.

### 2. BIÊN KỊCH

Viết ra trước khi dựng, dựa vào **bối cảnh hình ảnh** đã xem:

| Kiểu quay | Dựng thế nào |
|---|---|
| **Quay màn hình** | Không được che màn hình. Dùng chip bước ở góc trên (`BƯỚC 1 · …`) và chú thích ngắn. Không card toàn khung. |
| **Nói trực tiếp** | Hình tĩnh suốt nên phải tạo biến hoá: title chồng lớp mỗi phần, card toàn khung nền lưới đổi màu, cảnh trám kiểu giao diện. |

Chốt: câu hook, các phần và mốc thời gian, cảnh trám nào ở câu nào, mood nhạc từng đoạn,
chữ trên ảnh bìa. **Cảnh trám phải vẽ đúng thứ đang nói** — xem `reference/canh-tram.md`.
Tuyệt đối không dùng icon nhân vật vector chung chung.

### 3. TRIỂN KHAI

`scripts/plan.py` cắt · `scripts/build.py` dựng · `scripts/cards.py` vẽ cảnh trám ·
`scripts/titles_demo.py` công thức chữ · `scripts/thumb.py` ảnh bìa.
Cờ xuất lấy từ `che_do.tham_so_xuat()`, đừng ghi cứng preset x264.
Luật bắt buộc ở `reference/cat-ghep.md` và `reference/am-thanh.md`.

### 4. KIỂM TRA 3 LƯỢT

`scripts/check.py` — chạy đủ 3 lượt cho **mỗi** video, không bỏ qua:

1. **Đồng bộ** — độ dài hình = tiếng = dự kiến (sai số 0,3s), số khung = độ dài × 30
2. **Hình** — không đứng hình ngoài card, không khung đen, đúng 1080×1920 / 30fps
3. **Tiếng** — âm lượng −17…−14 LUFS, đỉnh ≤ −1 dBFS, không còn quãng lặng > 0,75s

Xong ba lượt rồi chạy `python3 scripts/tu_kiem.py` để soát cả gói (tài liệu · mã · kho).

Lỗi nào cũng phải sửa rồi chạy lại, **không bàn giao khi còn lỗi**. Nếu quyết định không sửa
(ví dụ quãng nghỉ 0,5s là nhịp thở tự nhiên) thì phải nói rõ lý do cho người dùng.

### 5. BÀN GIAO

Mỗi video một thư mục riêng trong `<ban_giao.thu_muc>/<số>-<tên-không-dấu>/` chứa:
- `<tên>.mp4`
- `thumb-<tên>.png` — ảnh bìa 1080×1920, xem `reference/anh-bia.md`

Báo lại: độ dài trước/sau, cắt bao nhiêu giây, kết quả 3 lượt kiểm tra, và **nói thẳng
thứ gì chưa đạt hoặc cố ý không sửa**.

## Nguyên tắc

- **Đo, đừng đoán.** Khoảng lặng đo bằng năng lượng 20 ms, bề rộng chữ đo bằng cách
  vẽ thử rồi quét điểm ảnh. Âm lượng: tiếng dài đo LUFS, **tiếng ngắn dưới 0,4 s đo RMS**
  (LUFS trả về −70 vì cổng chặn EBU R128). Kho tự sinh đã đo sẵn ở
  `presets/do-am-luong.json` — đọc từ đó. Đặt thông số bằng cảm tính là sai.
- **Không tin nhãn thời gian từ của Whisper.** Nó hay kéo dài từ cuối trùm qua khoảng lặng.
- **Xem lại thành phẩm.** Trích khung ra nhìn trước khi bàn giao.
- **Không upload video của người dùng đi đâu.** Mọi thứ chạy cục bộ.
- **Tôn trọng bản quyền.** Nhạc/font/SFX người dùng tự thêm vào kho có giấy phép riêng;
  không đóng gói phát tán lại, và nhắc họ kiểm giấy phép trước khi kiếm tiền từ video.
- **Không áp LUT lên footage profile thường** — chỉ dùng khi quay D-Log. Đọc
  `quay.profile_mau` trong `cau-hinh.json`.
- **Hỏi khi thật sự cần.** Chưa có `cau-hinh.json` hoặc kho rỗng thì hướng dẫn người dùng
  qua `CAI-DAT.md` trước, đừng dựng bừa rồi giao ra thứ hỏng.
