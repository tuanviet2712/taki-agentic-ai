# Ảnh bìa

Mẫu **Bìa Hai Dòng**, font lấy từ `chu.bia` trong `cau-hinh.json` (mặc định Barlow Condensed Black). `scripts/thumb.py`.

## Khung an toàn
TikTok cắt ảnh bìa về **3:4**, tức chỉ còn y 240–1680 của khung 1080×1920.
- Chữ nằm trong khoảng **y 769–1580**.
- Chừa **100 px** mép dưới — phần dưới ảnh thường không quan trọng, đừng để chữ sát.
- Không để chữ gần đỉnh hay đáy khung gốc.

## Lớp mờ cho chữ nổi
Làm mờ từ y 880, chuyển tiếp mềm 230 px, cộng dốc tối tới alpha 226.
Không có lớp này chữ chìm vào nền.

## Logo
Tham số `logo=True` gắn logo Claude. **Chỉ bật khi video thật sự nói về Claude.**
Đã từng gắn nhầm lên bìa NotebookLM và bìa trang giọng nói AI — phải gỡ.

## Giao
Tên `thumb-<tên-video>.png`, để cùng thư mục với video.
