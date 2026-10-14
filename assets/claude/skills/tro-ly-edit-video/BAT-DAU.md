# Bắt đầu trong 5 phút

## Cài
1. Giải nén thư mục `tro-ly-edit-video` vào `~/.claude/skills/`
2. Mở Terminal, chạy ba dòng:
```bash
brew install ffmpeg uv
uv venv --python 3.12 ~/.claude/skills/tro-ly-edit-video/.venv
uv pip install --python ~/.claude/skills/tro-ly-edit-video/.venv/bin/python mlx-whisper
```
3. Kho tài nguyên:

   **Nếu bản bạn tải về đã có sẵn thư mục `kho/`** — xong rồi, không cần làm gì,
   skill tự nhận. Muốn dùng chung với CapCut thì chuyển nó vào `~/Movies`:
```bash
mv ~/.claude/skills/tro-ly-edit-video/kho ~/Movies/VideoKit-Free
```
   **Nếu chưa có** — tự dựng, khoảng 10–20 phút, sạch bản quyền:
```bash
python3 ~/.claude/skills/tro-ly-edit-video/scripts/dung_kho.py ~/Movies/VideoKit-Free
```
4. Mở Claude Code, kéo file quay vào, gõ: **"dựng video này"**

Xong. Chi tiết ở `CAI-DAT.md`.

## Nói thế nào cho ra việc

Cứ nói tiếng Việt bình thường, không cần cú pháp gì.

| Muốn gì | Nói |
|---|---|
| Dựng một video | "dựng video này" |
| Dựng nhiều video | "làm 4 video này, chia ra thư mục, thumb làm luôn" |
| Cắt kỹ hơn | "cắt kỹ nhất, bỏ hết ừm à với chỗ nói lại" |
| Chỉ cắt, không hiệu ứng | "chỉ cắt khoảng lặng thôi, đừng thêm gì" |
| Đổi phong cách | "làm nhanh gọn, ít chữ" · "nhiều hiệu ứng vào" |
| Chỉ làm ảnh bìa | "làm ảnh bìa cho video này" |
| Sửa chỗ cụ thể | "đoạn 1p17–1p20 còn lặng, cắt đi" |
| Xem trước ý tưởng | "biên kịch trước cho anh xem rồi hẵng dựng" |
| Máy yếu, cần nhanh | "làm chế độ nhanh" |
| Kiểm lại | "kiểm tra lỗi lại 3 lần trước khi giao" |

Không vừa ý thì nói thẳng — "chữ xấu", "nhạc to hơn lời", "cảnh trám không có" —
rồi bảo làm lại. Nói rõ chỗ sai luôn nhanh hơn tả chung chung.

## Nó sẽ làm gì
1. **Đọc** — nhận dạng giọng nói, xem hình, tìm chỗ nói lại và khoảng lặng
2. **Biên kịch** — chốt hook, các phần, cảnh trám, nhạc, chữ trên bìa
3. **Dựng** — cắt, phụ đề, title, cảnh trám, nhạc và SFX cân theo số đo
4. **Kiểm 3 lượt** — đồng bộ hình/tiếng · hình · âm lượng
5. **Giao** — thư mục riêng, video + ảnh bìa

Toàn bộ chạy **trên máy bạn**. Video không được gửi đi đâu.

## Tự chỉnh theo kênh mình
Sửa `cau-hinh.json`: tên kênh, font, màu nhấn, logo, tốc độ nói, mức âm lượng,
khung ảnh bìa, nơi trả file. Xem cấu hình đang chạy:
```bash
python3 ~/.claude/skills/tro-ly-edit-video/scripts/config.py
python3 ~/.claude/skills/tro-ly-edit-video/scripts/che_do.py
```

## Hỏng thì xem đâu
| Triệu chứng | Chỗ xem |
|---|---|
| Báo thiếu font / thiếu kho | chạy `scripts/kit.py` |
| Nhận dạng giọng lỗi | `CAI-DAT.md` mục 2 — phải Python 3.12 |
| Máy chậm, nóng | đổi `may.che_do` thành `nhanh` |
| CapCut mở dự án bị thoát | `reference/capcut-mac.md` |
| Chữ vỡ dấu tiếng Việt | `reference/chu-va-hieu-ung.md` |
| Nhạc át lời | `reference/am-thanh.md` |
