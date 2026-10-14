# Cài đặt

## 1. Chép skill vào máy
```
~/.claude/skills/tro-ly-edit-video/
```
Mở Claude Code, gõ `/tro-ly-edit-video` — nếu hiện tên là đã nhận.

## 2. Cần sẵn trên máy
| Thứ | Kiểm tra | Cài |
|---|---|---|
| ffmpeg + ffprobe | `ffmpeg -version` | `brew install ffmpeg` |
| uv | `uv --version` | `brew install uv` |
| Python 3.12 | | uv tự tải |

Nhận dạng giọng nói chạy **cục bộ** bằng MLX (chip Apple Silicon). Tạo một lần:
```bash
uv venv --python 3.12 ~/.claude/skills/tro-ly-edit-video/.venv
uv pip install --python ~/.claude/skills/tro-ly-edit-video/.venv/bin/python mlx-whisper
```
Phải là Python **3.12** — 3.14 chưa có bản mlx dựng sẵn, cài sẽ báo xung đột phụ thuộc.

Máy Intel hoặc không phải Mac: đổi sang `faster-whisper`, phần còn lại chạy nguyên.

## 3. Dựng kho tài nguyên
Skill **không kèm** font, nhạc, SFX, LUT — đó là hàng có bản quyền riêng, mỗi người
tự mua hoặc tự gom. Skill chỉ cần đúng cấu trúc thư mục:

```
~/Movies/VideoKit/
├── fonts/        font có dấu tiếng Việt (.otf .ttf)
├── sfx/          tiếng động ngắn (.mp3 .wav)
├── music/        nhạc nền
├── grids/        ảnh nền lưới cho card
├── overlays/     lớp phủ hạt phim, ánh sáng
├── luts/         .cube — chỉ dùng khi quay D-Log
├── characters/   ảnh nhân vật tách nền
├── titles/       mẫu title
├── cards/        cảnh trám script tự sinh ra
└── nguon/        file quay thô chép vào đây
```

**Phải để trong `~/Movies`.** CapCut trên Mac chạy sandbox, chỉ tự đọc được thư mục này;
để chỗ khác thì CapCut không thấy file.

Soát kho:
```bash
python3 ~/.claude/skills/tro-ly-edit-video/scripts/kit.py
```

### Gợi ý nguồn
- Font Việt miễn phí thương mại: Google Fonts (Be Vietnam Pro, Bricolage), Fonts.vn.
  **Đừng dùng font bản dùng thử** — nó nhúng chữ quảng cáo hiện đè lên video.
- SFX/nhạc: Pixabay, Mixkit, YouTube Audio Library (kiểm tra giấy phép trước khi bán video).
- Bộ preset trả phí (Edit không khó và tương tự) dùng được, nhưng chỉ cho chính mình,
  không phát tán lại.

## 4. Tự chỉnh theo mình
Sửa `cau-hinh.json`, **không sửa script**:

| Khoá | Sửa gì |
|---|---|
| `kenh.ten`, `kenh.seri` | Tên kênh, tên loạt video |
| `kho.duong_dan` | Kho ở chỗ khác thì đổi ở đây |
| `chu.*` | Font phụ đề / title / bìa |
| `mau.nhan` | Màu nhấn của thương hiệu |
| `logo.duong_dan` | Logo dán lên bìa, để trống nếu không có |
| `quay.profile_mau` | `thuong` = không LUT. Quay D-Log thì đổi `dlog` |
| `dung.toc_do` | 1.1 là nhanh vừa. 1.0 giữ nguyên |
| `am_thanh.*` | Mức LUFS từng lớp — xem `reference/am-thanh.md` trước khi đổi |
| `bia.*` | Khung an toàn ảnh bìa |
| `ban_giao.thu_muc` | Nơi trả video |

Xem cấu hình đang hiệu lực:
```bash
python3 ~/.claude/skills/tro-ly-edit-video/scripts/config.py
```

## 5. Dùng
Kéo file quay vào Claude Code rồi bảo "dựng video này". Skill tự chạy 5 bước:
đọc → biên kịch → triển khai → kiểm tra 3 lượt → bàn giao video kèm ảnh bìa.

## Giấy phép và bản quyền
Skill này gồm mã nguồn, quy trình và thông số. Font, nhạc, SFX, LUT, preset trong kho
của bạn giữ giấy phép riêng của chúng — **không được đóng gói bán lại kèm skill**.
Video làm ra phải tự kiểm giấy phép nhạc trước khi kiếm tiền.
