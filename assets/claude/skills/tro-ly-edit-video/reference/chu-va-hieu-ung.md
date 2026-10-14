# Chữ và hiệu ứng

## Font dùng được cho tiếng Việt
Font theo vai trò khai ở `chu.*` trong `cau-hinh.json`, mặc định toàn font OFL có sẵn trong `kho/fonts`:
phụ đề **Be Vietnam Pro Black**, title **Anton**, bìa **Barlow Condensed Black**,
chữ thân **Be Vietnam Pro Bold**, serif **Lora Italic**. Script đọc qua `kit.ten_font(...)`
và `kit.ten_ass(...)` — **không ghi cứng tên font trong script**.
Muốn dùng font riêng đã mua: chép vào `kho/fonts` rồi sửa `cau-hinh.json`.

Cấm:
- **Poppins, Bebas Neue** — thiếu dấu tiếng Việt, chữ vỡ dấu.
- **SVN-Nexa Rush, UTM-Impact, SVN-Newton, SVN-Square** — bản dùng thử, có nhúng chữ
  quảng cáo hiện đè lên video.

Luôn thử vẽ một dòng có đủ dấu (`ẫ ự ỡ ằ Đ`) rồi nhìn trước khi dùng font mới.

## Title chồng lớp cắt khuyết (kiểu đang hot)
Chữ to màu vàng, chữ nhỏ trắng **cắt khuyết xuyên qua giữa** chữ to.

Người dùng đã chê bản đầu: "dạng trên dưới chứ ko phải đè giữa… dạng này trông hơi xấu".
Hình học đúng:
- `sy = by + 0,58 × (bs − ss)` — chữ nhỏ cắt qua khoảng giữa chữ to, không nằm trên/dưới.
- Bề rộng chữ nhỏ **≤ 0,72 × bề rộng chữ to**, nếu không trông như hai dòng chồng.

Cách làm bằng ffmpeg: `alphaextract` chữ nhỏ → `blend=all_mode=subtract` khỏi mặt nạ
chữ to → `alphamerge`. **Lưu ý: `alphamerge` đọc độ sáng của ảnh thứ hai, không đọc kênh
alpha** — từng viết dốc màu vào alpha và bị làm mờ cả khung hình. Phải vẽ dốc xám.

## Công thức lấy từ kho "Edit không khó"
Đọc sâu bên trong file .rar (149 tổ hợp, 126 lớp chữ, 32 mẫu có tên trong `key_value.json`):

1. **Viền chồng nhiều lớp, độ dày giảm dần** — mẫu CARTOON xếp 3 lớp viền 17% / 13% / 7%.
   Đây là thứ tạo cảm giác dày, nổi khối.
2. **Chữ to có màu + chữ nhỏ trắng lệch chéo** — không lệch thẳng đứng.
3. **Ánh sáng loé KHÔNG nằm trong mẫu chữ.** Nó là hiệu ứng clip **`Brillo 2` / `Loé
   sáng 2`** áp lên 37 trong 55 clip. Bắt chước bằng mẫu chữ là không ra.


## Phụ đề
ASS, font `chu.phu_de` (mặc định Be Vietnam Pro Black), đặt thấp hơn giữa khung, tránh vùng TikTok đè nút. Chip bước
(`BƯỚC 1 · …`) đặt góc trên cho video quay màn hình.

## Bẫy drawtext
- Dấu `%` phải kèm `expansion=none`, không thì ffmpeg báo "Stray %".
- Chữ dài nên dùng `textfile=` thay vì `text=` để khỏi vật lộn với ký tự thoát.
