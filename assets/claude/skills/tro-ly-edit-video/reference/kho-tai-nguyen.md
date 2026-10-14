# Kho tài nguyên

Đường dẫn lấy từ `cau-hinh.json` → `kho.duong_dan` (mặc định `~/Movies/VideoKit`),
biến môi trường `VIDEOKIT` ghi đè được. Tra file bằng `scripts/kit.py`:

```python
import kit
kit.find("BeVietnamPro-Black.ttf")   # tìm khắp các thư mục con
kit.font("phu_de")              # lấy theo vai trò trong cau-hinh.json
kit.kiem_tra()                  # soát thiếu trước khi dựng
```

Không viết đường dẫn cứng trong script — mỗi người một kho khác nhau.

## Dựng kho
```bash
python3 scripts/dung_kho.py ~/Movies/VideoKit-Free      # đầy đủ
python3 scripts/dung_kho.py ~/Movies/VideoKit-Free --nhanh   # ít biến thể, nhanh hơn
```
Font tải từ Google Fonts (OFL) rồi **tự kiểm dấu tiếng Việt bằng cách đọc bảng cmap** —
font thiếu `ẫ ự ỡ ằ Đ ệ ợ ỹ` bị xoá ngay, nên trong kho không còn font vỡ dấu.
Mọi thứ còn lại do thuật toán tổng hợp, không dính bản quyền ai.

## Từng thư mục dùng làm gì

| Thư mục | Nội dung | Dùng ở đâu |
|---|---|---|
| `fonts/` | Font có dấu tiếng Việt | phụ đề, title, bìa |
| `sfx/` | Tiếng động ngắn | nhấn chuyển đoạn, click giao diện |
| `music/` | Nhạc nền, tên `nen-<mood>-<nhịp>[-cao\|-trầm]` | nền suốt video, vào sau câu hook |
| `grids/` | Ảnh nền lưới | nền card toàn khung |
| `overlays/` | Hạt phim, loé sáng | phủ nhẹ lên đoạn chuyển |
| `luts/` | `.cube` | **chỉ khi quay D-Log** |
| `characters/` | Ảnh tách nền | hiếm dùng — xem cảnh báo dưới |
| `titles/` | Mẫu title | tham khảo |
| `cards/` | `cards.py` tự sinh | cảnh trám |
| `nguon/` | File quay thô đã chép vào | đầu vào |
| `presets/` | Thư viện mẫu JSON | xem dưới |
| `kho-goc/` | Kho gốc chưa lọc (tuỳ chọn) | tra cứu |

## presets/ — thư viện mẫu
Đọc bằng `kit.preset("kieu-chu")`. **Chọn mẫu từ đây thay vì bịa thông số mới mỗi lần.**

| File | Nội dung |
|---|---|
| `kieu-chu.json` | Viền chồng nhiều lớp, cắt khuyết, lệch chéo, nền khối, phụ đề, chip bước |
| `chuyen-canh.json` | Kiểu `xfade` kèm thời lượng và tiếng động đi cùng |
| `canh-tram.json` | Danh sách mẫu cảnh trám |
| `do-am-luong.json` | **Số đo sẵn của từng file sfx/music**: thời lượng, RMS, đỉnh |

`do-am-luong.json` quan trọng: mọi file đã chuẩn hoá RMS về −20 dBFS nên hệ số trộn tính
thẳng được `gain_dB = mức_đích − (−20)`. **Đừng đo LUFS lại lúc dựng** — tiếng ngắn dưới
0,4 s sẽ ra −70 LUFS, xem `am-thanh.md`.

## Cảnh báo đã trả giá

- **Icon/nhân vật vector chung chung làm video xấu đi.** Đã bị người dùng bác thẳng.
  Cảnh trám phải vẽ đúng thứ đang nói — xem `canh-tram.md`.
- **Font bản dùng thử nhúng chữ quảng cáo** hiện đè lên video. Trong bộ SVN, các font
  Nexa Rush / Newton / Square và UTM-Impact đã dính lỗi này. Luôn vẽ thử một dòng
  đủ dấu (`ẫ ự ỡ ằ Đ`) rồi nhìn trước khi đưa vào dùng thật.
- **Kho "LUT" thường không phải LUT.** Trong bộ đã kiểm, 868 file gắn nhãn LUT thì chỉ
  119 là `.cube` thật; 689 file còn lại là preset Lightroom, CapCut và ffmpeg đều không đọc được.
- **SFX chênh nhau tới 50 dB.** Không bao giờ dùng thẳng — đo LUFS rồi mới trộn,
  xem `am-thanh.md`.
- Kho phải nằm trong `~/Movies` vì sandbox của CapCut — xem `capcut-mac.md`.
