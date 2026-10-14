# Chạy trên máy nhẹ

`may.che_do` trong `cau-hinh.json` — xem máy đang hợp chế độ nào:
```bash
python3 scripts/che_do.py
```

| Chế độ | Nhận dạng | Xuất | Hợp với |
|---|---|---|---|
| `nhanh` | whisper-small | preset veryfast, crf 24 | Máy Intel, RAM ≤ 8 GB, cần gấp |
| `chuan` | whisper-large-v3-turbo | preset medium, crf 20 | Apple Silicon, RAM 16 GB |
| `ky` | whisper-large-v3-turbo | preset slow, crf 18 | RAM ≥ 32 GB, làm kỹ |

## Mẹo cho máy yếu
- Cắt trước, dựng sau. Video 10 phút mà chỉ dùng 3 phút thì cắt xong hãy làm hiệu ứng.
- `dung.toc_do` để 1.0 sẽ bớt một lần xử lý lại toàn bộ tiếng.
- Chế độ `nhanh` tắt lớp phủ nặng (hạt phim, loé sáng) — thứ tốn nhiều thời gian nhất
  mà người xem điện thoại gần như không thấy.
- Dựng kho gọn: `python3 scripts/dung_kho.py <kho> --nhanh` (ít biến thể, nhanh hơn nhiều).
- Máy Intel hoặc không phải Mac: `mlx-whisper` không chạy, đổi sang `faster-whisper`,
  phần còn lại giữ nguyên.

## Vì sao không dùng CapCut để dựng
CapCut trên Mac chạy sandbox và hay thoát đột ngột khi mở dự án sinh tự động có nhiều
lớp ảnh — đã dò được nhưng chưa khắc phục xong, chi tiết ở `capcut-mac.md`.
Nên skill này **xuất thẳng MP4 bằng ffmpeg**: nhẹ hơn, không phụ thuộc CapCut, và
không có bước mở dự án lên chờ. Ai muốn chỉnh tay thì vẫn nhập MP4 vào CapCut được.
