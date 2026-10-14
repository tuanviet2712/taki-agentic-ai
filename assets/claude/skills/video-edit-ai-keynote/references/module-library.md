# Thư viện khối đồ hoạ

Mười bốn khối, đủ dựng gần như mọi ý trong một video bán hàng hoặc đào tạo.
Mỗi khối nhận các trường chung sau, ngoài các trường riêng ghi trong từng mục:

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `module` | có | Tên khối |
| `t` | có | Giây bắt đầu hiện ra |
| `out` | nên có | Giây bắt đầu biến mất; bỏ trống thì giữ đến hết video |
| `x` | | Số px, hoặc `"center"` để căn giữa; mặc định căn giữa |
| `y` | có | Toạ độ đỉnh trên, tính bằng px |
| `w` | | Số px hoặc `"auto"`; mặc định 584 |
| `align` | | `left` / `center` / `right`, cho nội dung bên trong |
| `stagger` | | Giây giữa các mục con hiện ra; mặc định 0,55 |
| `dur_in` | | Thời gian hiện ra, mặc định 0,30 giây |

Quy ước chung: với khối có nhiều mục, đặt `stagger` bằng đúng khoảng cách giữa các ý
trong lời nói. Nếu người nói liệt kê ba thứ trong ba giây thì `stagger` là 1,0.

---

## 1. `tag` — nhãn chương mục

Viên thuốc viền vàng có chấm tròn đầu dòng, dùng để đặt tên cho đoạn nội dung đang nói.
Đây là khối dùng nhiều thứ hai sau `rows`, và gần như luôn đi kèm một cụm khác bên dưới.

```json
{ "module": "tag", "text": "Người làm văn phòng", "t": 12.0, "out": 21.0,
  "x": 68, "y": 700, "w": "auto" }
```

Chữ tự viết hoa. Giữ dưới bốn từ. Luôn đặt `w` là `"auto"`.

## 2. `chips` — hàng thẻ ngang

Các thẻ nhỏ nằm ngang, hiện lần lượt. Dùng khi người nói liệt kê nhanh vài hạng mục
ngắn không cần giải thích.

```json
{ "module": "chips", "items": ["Văn phòng", "Kinh doanh", "Xây kênh"],
  "t": 30.0, "out": 36.0, "x": 68, "y": 60, "stagger": 0.7 }
```

Tối đa bốn mục một hàng, mỗi mục dưới ba từ, nếu không sẽ tự xuống dòng và vỡ bố cục.

## 3. `qchips` — thẻ câu hỏi

Giống `chips` nhưng mỗi thẻ có dấu hỏi vàng ở cuối. Dùng ở đoạn mở đầu khi nêu những
điều người xem đang băn khoăn.

```json
{ "module": "qchips", "items": ["Kiếm được tiền", "Dòng thu nhập"],
  "t": 3.2, "out": 7.5, "x": 68, "y": 120, "stagger": 1.1 }
```

## 4. `iconrow` — hàng biểu tượng

Hàng ô vuông chứa biểu tượng, không có chữ. Dùng khi nhắc đến công cụ hoặc ứng dụng.

```json
{ "module": "iconrow", "items": ["spark", "img", "vid", "bolt"],
  "t": 76.0, "out": 82.0, "x": 68, "y": 60, "stagger": 0.5 }
```

Bộ biểu tượng có sẵn: `doc` `img` `vid` `chart` `clock` `bolt` `user` `shop` `link`
`check` `folder` `phone` `laptop` `spark` `gear`.

## 5. `rows` — danh sách thẻ dọc

Khối quan trọng nhất. Các thẻ xếp dọc, hiện lần lượt, có biểu tượng bên trái. Đặt
`active` để một dòng chuyển nền vàng — dùng cho dòng đang được nói tới hoặc dòng cần nhấn.

```json
{ "module": "rows", "t": 62.0, "out": 72.0, "x": 68, "y": 700, "w": 584,
  "stagger": 1.0, "active": 3,
  "items": [ { "text": "Nội dung", "icon": "doc" },
             { "text": "Hình ảnh", "icon": "img" },
             { "text": "Video", "icon": "vid" },
             { "text": "Tự động hoá", "icon": "bolt" } ] }
```

Mỗi dòng cao 62px, cách nhau 8px, nên chiều cao cả khối là `n × 70 − 8`. Tính trước
con số này để chọn `y` cho khỏi đè dải phụ đề ở 1010. Tối đa năm dòng.

Có thể viết `items` dạng chuỗi thuần nếu không cần biểu tượng riêng.

## 6. `pill` — viên thuốc tổng kết

Viên vàng đặc, dùng để chốt lại một cụm. Thường đặt ngay dưới `rows` hoặc cuối một `flow`.
Thêm `"ghost": true` để chuyển thành viền vàng nền rỗng, nhẹ hơn.

```json
{ "module": "pill", "text": "Tối ưu hoá công việc", "sub": "làm một lần dùng mãi",
  "t": 20.0, "out": 24.0, "x": "center", "y": 980, "w": "auto" }
```

## 7. `flow` — chuỗi mũi tên

Các viên thuốc nối nhau bằng mũi tên, thể hiện trình tự hoặc quan hệ nhân quả.

```json
{ "module": "flow", "items": ["Dự án", "Xây kênh", "Thu nhập"],
  "t": 80.0, "out": 86.0, "x": 68, "y": 640, "stagger": 0.8 }
```

Tối đa ba mắt xích, mỗi mắt dưới ba từ, vì hàng không tự xuống dòng.

## 8. `bigtype` — chữ lớn nhấn mạnh

Con số hoặc từ khoá cỡ lớn kèm dòng dẫn và dòng phụ. Dùng cho khoảnh khắc cần dừng lại,
thường ở đoạn mở đầu hoặc khi nêu một con số quyết định.

```json
{ "module": "bigtype", "kicker": "Chỉ cần", "big": "1 phút",
  "sub": "xem hết |video này|", "t": 8.5, "out": 12.0, "x": 68, "y": 110, "w": 584 }
```

Dòng `sub` hỗ trợ tô vàng bằng `|…|`. Cả khối cao khoảng 200px.

## 9. `lockup` — cụm tiêu đề chương trình

Cụm ba dòng có gạch chân vàng, dùng đúng một lần trong video, ở thời điểm giới thiệu
sản phẩm hoặc chương trình.

```json
{ "module": "lockup", "l1": "Chương trình", "l2": "ĐÀO TẠO", "l3": "MIỄN PHÍ",
  "rule": 210, "t": 52.0, "out": 60.0, "x": 68, "y": 60, "w": 584 }
```

`rule` là chiều dài gạch chân tính bằng px. Cả khối cao khoảng 220px.

## 10. `steps` — lộ trình đánh số

Các vòng tròn số nối bằng đường ngang, kèm nhãn dưới mỗi vòng. Dùng khi trình bày lộ
trình hoặc các buổi học.

```json
{ "module": "steps", "items": ["Tối 1", "Tối 2", "Tối 3"],
  "t": 55.0, "out": 62.0, "x": 68, "y": 300, "w": 584, "stagger": 0.6 }
```

Ba mục là đẹp nhất, tối đa bốn. Nhãn dưới hai từ. Cả khối cao khoảng 85px.

## 11. `chart` — biểu đồ đường đi lên

Thẻ chứa đường cong vàng tự vẽ dần. Dùng khi nói về tăng trưởng, lượt xem hay doanh thu.

```json
{ "module": "chart", "kicker": "Tăng đều", "label": "Lượt view",
  "h": 90, "draw": 1.4, "t": 38.0, "out": 45.0, "x": 68, "y": 660, "w": 584 }
```

`draw` là thời gian vẽ hết đường. Có thể thay đường cong bằng `"path"` theo cú pháp SVG
trên khung toạ độ 300×90. Cả thẻ cao khoảng `h + 90`px, tức 180px với `h` mặc định.

Đây là khối minh hoạ, không phải biểu đồ số liệu thật. Không dùng nó để trình bày dữ
liệu cần chính xác.

## 12. `gridfill` — lưới ô sáng dần kèm đếm số

Con số đếm lên cạnh một lưới ô vuông sáng dần. Dùng khi nói về nhân bản, số lượng kênh,
số học viên.

```json
{ "module": "gridfill", "kicker": "Nhân bản", "unit": "kênh", "total": 18,
  "count": 12, "draw": 1.6, "t": 33.0, "out": 40.0, "x": 68, "y": 640, "w": 584 }
```

`total` là số ô trong lưới, `count` là con số đếm tới. Lưới rộng 584px thì khối cao khoảng
205px — đây là khối cao hơn cảm giác nhìn, luôn chạy `check_layout.py` sau khi đặt nó.

## 13. `myth` — niềm tin sai bị gạch bỏ

Thẻ chữ hiện ra rồi bị một đường đỏ gạch ngang, chữ mờ đi. Đây là khối mạnh nhất về mặt
thuyết phục, dùng đúng một lần, ngay trước khi đưa ra lời giải.

```json
{ "module": "myth", "text": "Muốn dùng AI phải giỏi công nghệ",
  "strike_at": 44.5, "t": 42.5, "out": 47.0, "x": 68, "y": 60, "w": "auto" }
```

`strike_at` phải trùng đúng giây người nói phủ định điều đó. Chữ giữ trong một dòng,
dưới tám từ, vì thẻ không xuống dòng.

## 14. `cta` — nút gọi hành động

Nút vàng bo tròn kèm dòng chữ nhỏ bên dưới. Đặt ở cuối video.

```json
{ "module": "cta", "text": "ĐĂNG KÝ NGAY", "sub": "Link ngay bên dưới · miễn phí",
  "t": 91.0, "x": 68, "y": 860, "w": 584 }
```

Cả khối cao khoảng 102px. Nếu vẫn còn phụ đề chạy ở đoạn này, đặt `y` không quá 880 để
đáy khối dừng trước mốc 1010.

---

## `note` — dòng chữ phụ

Khối dự phòng, chỉ là một dòng chữ căn giữa, hỗ trợ tô vàng bằng `|…|`. Dùng khi cần
một câu chú thích mà không khối nào ở trên phù hợp.

```json
{ "module": "note", "text": "Áp dụng cho |50 người| đầu tiên",
  "t": 95.0, "x": 68, "y": 620, "w": 584 }
```

---

## Cách phối khối theo loại nội dung

| Người nói đang… | Dùng khối |
|---|---|
| Nêu một con số hoặc lời hứa | `bigtype` |
| Gọi tên một nhóm đối tượng | `tag` rồi `rows` bên dưới |
| Liệt kê việc AI làm được | `rows` với `stagger` khớp nhịp liệt kê |
| Chốt lại lợi ích của cả cụm | `pill` đặt ngay dưới `rows` |
| Nói về tăng trưởng | `chart` |
| Nói về số lượng, nhân bản | `gridfill` |
| Phủ định một hiểu lầm | `myth` với `strike_at` đúng giây |
| Giới thiệu chương trình | `lockup` rồi `steps` |
| Mô tả trình tự | `flow` |
| Kể tên công cụ | `iconrow` hoặc `chips` |
| Nêu câu hỏi trong đầu người xem | `qchips` |
| Kêu gọi hành động | `cta` |

Nếu một câu không rơi vào ô nào ở trên, để trống màn hình. Vài giây chỉ có mặt người và
phụ đề là nhịp nghỉ cần thiết, không phải lỗ hổng cần lấp.
