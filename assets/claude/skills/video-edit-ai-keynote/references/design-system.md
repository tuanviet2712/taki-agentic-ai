# Hệ thiết kế — AI Dark Keynote

Toàn bộ số liệu dưới đây đo trực tiếp từ khung hình video mẫu ở độ phân giải 720×1280.
Mọi toạ độ trong storyboard dùng đúng hệ này.

## Màu

| Vai trò | Mã | Dùng ở đâu |
|---|---|---|
| Nền canvas | `#0F0E0C` | Nền toàn khung, đen ngả ấm chứ không đen tuyệt đối |
| Vàng chủ đạo | `#F7D33B` | Viền, số, biểu đồ, nút, dòng đang chọn |
| Vàng chữ sáng | `#FFF160` | Chữ trong thẻ nhãn, chữ phụ dưới nút |
| Vàng trầm | `#C9A93A` | Chi tiết phụ, ít dùng |
| Nền thẻ | `#1F1C13` | Thẻ danh sách, chip, khối biểu đồ |
| Đường viền | `rgba(255,241,150,.14)` | Viền mọi thẻ, rất mảnh |
| Chữ trắng | `#F4F2E5` | Trắng ngả kem, không dùng trắng tinh |
| Đỏ phủ định | `#FF4D3D` | Chỉ dùng cho gạch bỏ trong khối `myth` |
| Nền phụ đề | `rgba(9,9,12,.60)` | Tấm nền bo góc sau chữ phụ đề |

Nền không phẳng. Có hai lớp phủ lên màu nền:

- **Lưới mờ**: ô vuông 90px, màu `rgb(150,145,120)` ở độ đậm khoảng 10%
- **Quầng sáng vàng**: hai vùng tròn nhoè mạnh, một ở góc trên trái (tâm 28%/20%,
  bán kính 55% chiều rộng) và một ở dưới phải (86%/78%, bán kính 45%)

Cả hai được `render.py` vẽ tự động. Chỉnh qua `theme` trong storyboard:

```json
"theme": { "grid": 90, "bg_rgb": [15,14,12], "glow_rgb": [150,132,40],
           "glows": [[0.28,0.20,0.55,74],[0.86,0.78,0.45,40]] }
```

Đặt `"grid": 0` để tắt lưới.

## Chữ

Font **Be Vietnam Pro**, đủ dấu tiếng Việt, đã đóng gói sẵn trong `assets/fonts`.

| Hạng mục | Cỡ | Đậm | Ghi chú |
|---|---|---|---|
| Phụ đề | 44px | 700 | Căn giữa, giãn dòng 1.24, rộng tối đa 610px |
| Chữ trong thẻ danh sách | 26px | 600 | |
| Chữ trong chip | 20px | 600 | |
| Nhãn `tag` | 18px | 800 | Viết hoa, giãn chữ 0.13em |
| Số lớn `bigtype` | 96px | 800 | Giãn chữ âm 0.02em |
| Dòng chính `lockup` | 56px | 800 | |
| Dòng vàng `lockup` | 62px | 800 | |
| Chữ trên nút `cta` | 31px | 800 | |
| Chữ phụ dưới nút | 18px | 500 | |

## Lưới bố cục

- Lề an toàn hai bên: **68px**, tức chiều rộng nội dung **584px**
- Dải phụ đề chiếm **y 1010 → 1105**, không đặt đồ hoạ vào đây khi đang có phụ đề
- Vùng an toàn dọc: **y 24 → 1180**

## Khung hình dựng sẵn

Chọn theo lượng đồ hoạ cần chỗ. Cột "chỗ trống" cho biết vùng y còn dùng được.

| Tên | x, y, rộng, cao, bo góc | Chỗ trống | Dùng khi |
|---|---|---|---|
| `full` | 0, 0, 720, 1280, 0 | không | Câu chốt mạnh, không đồ hoạ, hoặc lúc gọi hành động |
| `tall` | 68, 150, 584, 880, 44 | 24–140 | Kể chuyện liền mạch, đồ hoạ tối thiểu |
| `tall-low` | 68, 300, 584, 760, 44 | 24–290 | Có một cụm đồ hoạ phía trên |
| `hero` | 68, 80, 584, 584, 40 | 680–1000 | Khung dùng nhiều nhất, đồ hoạ dựng bên dưới |
| `hero-low` | 68, 330, 584, 584, 40 | 24–320 | Đồ hoạ dựng bên trên |
| `mid` | 170, 430, 380, 470, 34 | 24–420 và 910–1000 | Đồ hoạ cả trên lẫn dưới |
| `mini-left` | 68, 560, 210, 280, 26 | 24–550 | Đồ hoạ chiếm gần hết màn hình |
| `mini-center` | 255, 560, 210, 280, 26 | 24–550 | như trên |
| `mini-right` | 442, 560, 210, 280, 26 | như trên | như trên |

Tự đặt khung riêng bằng cách ghi thẳng `x`, `y`, `w`, `h`, `r` thay cho `preset`.

Hai tham số tinh chỉnh khác trong mỗi mục `framing`:

- `pan_y` (mặc định 0.42) — vị trí cắt theo chiều dọc. Giảm xuống 0.30 nếu mặt bị cắt
  mất trán, tăng lên 0.55 nếu thừa nhiều khoảng trống trên đầu.
- `zoom` (mặc định 1.0) — phóng thêm. Đặt 1.15 để tạo cảm giác đẩy máy gần vào.

Đặt `"no_frame": true` để bỏ viền và quầng sáng quanh thẻ.

## Chuyển động

| Loại | Thời gian | Đường cong |
|---|---|---|
| Phần tử hiện ra | 0,30 giây, trượt lên 16px | ease-out bậc ba |
| Phần tử biến mất | 0,22 giây, trượt lên 8px | tuyến tính |
| Từng mục trong cụm | 0,26 giây, trượt 12px, phóng 0.94→1 | ease-out bậc ba |
| Phụ đề đổi dòng | 0,09 giây | tuyến tính |
| Biểu đồ vẽ đường | 1,4 giây | ease-out bậc ba |
| Gạch đỏ `myth` | 0,45 giây | ease-out bậc ba |

## Ba bảng màu thay thế

Sửa trong khối `:root` của `overlay_engine.html`, đồng thời chỉnh `theme.glow_rgb`.

**Xanh dương công nghệ** — hợp phần mềm, tài chính, B2B
`--gold:#4DA3FF; --gold-bright:#8FC7FF; --card:#121A26; --ink:#080B10;`
`"glow_rgb": [40,90,170]`

**Đỏ cam năng lượng** — hợp thể thao, bán hàng nhanh, sự kiện
`--gold:#FF6B35; --gold-bright:#FFA173; --card:#231411; --ink:#0E0907;`
`"glow_rgb": [150,60,30]`

**Xanh lá sức khoẻ** — hợp y tế, thực phẩm, nông nghiệp
`--gold:#4ADE80; --gold-bright:#8FF0B4; --card:#101C15; --ink:#070C09;`
`"glow_rgb": [40,140,80]`

Khi đổi màu, giữ nguyên độ tương phản: chữ trên nền màu chủ đạo phải là màu tối
`#0B0A08`, không dùng chữ trắng trên nền vàng hay nền xanh lá.
