---
name: video-edit-ai-keynote
description: Dựng và RENDER RA FILE MP4 hoàn chỉnh cho video talking-head dọc 9:16 theo phong cách "AI Dark Keynote" — nền đen ấm có lưới mờ và quầng vàng, mặt người nằm trong thẻ bo góc đổi khung liên tục, phụ đề chạy 1 giây một dòng có bôi vàng từ khoá, và đồ hoạ giao diện dựng dần theo lời nói. Skill tự sinh storyboard, tự kiểm tra bố cục rồi tự render bằng ffmpeg và Chromium, không chỉ viết brief. PHẢI dùng skill này khi người dùng yêu cầu "edit video bằng AI", "dựng video giống video mẫu này", "làm video có phụ đề bôi vàng", "video nền đen chữ vàng", "thêm motion graphic vào video talking head", "biến video quay sẵn thành video chuyên nghiệp", "làm video bán khóa học từ clip quay điện thoại", "tự động edit video dọc", "làm video kiểu keynote tối", "render video có đồ hoạ chạy theo lời nói", "cắt im lặng jump cut video", "tạo phụ đề động cho video", "làm skill edit video". Kể cả khi người dùng chỉ upload một clip talking-head rồi nói "edit giúp tôi cho đẹp" hoặc "làm giống video kia" — PHẢI dùng skill này ngay.
---

# Video AI Dark Keynote

Skill này biến một clip talking-head quay thô thành video dọc 9:16 hoàn chỉnh theo
phong cách đang chạy tốt trên Reels và TikTok ở mảng đào tạo, phần mềm và bán khoá học.
Điểm khác biệt so với các skill video khác trong thư viện: skill này **render ra file
MP4 thật**, không dừng ở kịch bản hay brief cho editor.

## Bộ máy gồm những gì

```
scripts/
  prep.py              cắt im lặng (jump cut) + chuẩn hoá âm lượng
  srt_to_captions.py   đổi file .srt sang mảng phụ đề đúng nhịp
  check_layout.py      soi bố cục trước khi render, bắt lỗi đè chồng
  render.py            dựng và xuất file MP4 cuối
  overlay_engine.html  hệ thiết kế sống, nơi mọi khối đồ hoạ được vẽ ra
assets/fonts/          Be Vietnam Pro (đủ dấu tiếng Việt)
references/
  design-system.md     màu, toạ độ, cỡ chữ, khung hình dựng sẵn
  module-library.md    14 khối đồ hoạ, tham số và cách dùng đúng chỗ
examples/
  storyboard.example.json
```

Môi trường cần có `ffmpeg`, `python3`, thư viện `playwright` kèm Chromium và `Pillow`.
Kiểm tra nhanh bằng `python3 -c "import playwright, PIL"` và `ffmpeg -version`.

## Đặc điểm của phong cách này

Những con số dưới đây đo trực tiếp từ video mẫu, không phải ước lượng. Bám vào chúng
thì ra đúng chất, lệch đi thì ra một video khác.

| Yếu tố | Chuẩn |
|---|---|
| Khung hình | 720×1280, 30 hình/giây |
| Nhịp phụ đề | 0,8–1,3 giây một dòng, trung bình 1,05 giây; 3–6 từ |
| Tỷ lệ bôi vàng | 60–80% số dòng có ít nhất một từ khoá vàng |
| Đổi khung thẻ video | 5–8 giây một lần |
| Đồ hoạ | Dựng dần từng phần tử, mỗi phần tử cách nhau 0,5–1,1 giây |
| Vòng đời một cụm đồ hoạ | 6–12 giây rồi thay cụm mới |
| Âm lượng | chuẩn hoá về −14 LUFS |

Nguyên tắc chi phối toàn bộ: **mỗi ý trong lời nói phải có một phần tử đồ hoạ tương ứng
hiện lên đúng lúc câu đó được nói**. Người xem tắt tiếng vẫn hiểu được nội dung. Đồ hoạ
không phải để trang trí mà để minh hoạ lời nói theo thời gian thực.

## Quy trình sáu bước

### Bước 1 — Nhận đầu vào và xác định thiếu gì

Cần ba thứ: clip gốc, lời thoại có mốc thời gian, và mục tiêu của video.
Nếu người dùng chưa đưa file phụ đề, hỏi họ xuất file `.srt` từ CapCut hoặc công cụ
tương tự — trong môi trường này không có sẵn mô hình nhận dạng giọng nói, nên đây là
cách lấy mốc thời gian chính xác nhất. Nếu họ chỉ có kịch bản chữ, vẫn làm được nhưng
phải tự canh mốc theo cách thủ công và độ khớp sẽ kém hơn.

### Bước 2 — Làm sạch clip

```bash
python3 scripts/prep.py raw.mp4 clean.mp4
```

Bước này cắt các khoảng lặng giữa câu và chuẩn hoá âm lượng. Nhịp dồn sau khi cắt chính
là thứ tạo cảm giác biên tập chặt. Lưu ý quan trọng: sau khi cắt thì toàn bộ mốc thời
gian thay đổi, nên phải làm phụ đề **từ file đã cắt**, không dùng lại phụ đề của bản gốc.

Nếu clip quay ngang hoặc quay 4:3, không cần xử lý trước — `render.py` tự cắt và căn
theo từng khung hình. Chỉ cần chỉnh `pan_y` nếu mặt bị lệch khỏi tâm.

### Bước 3 — Đọc lời thoại và chia đoạn nội dung

Đọc hết phụ đề rồi chia video thành các đoạn nội dung, mỗi đoạn là một ý lớn kéo dài
khoảng 6–12 giây. Mỗi đoạn sẽ dùng một cụm đồ hoạ riêng và thường đi kèm một lần đổi
khung hình. Đây là bước cần suy nghĩ nhiều nhất và cũng là bước quyết định video có
mạch hay không.

Cấu trúc thường gặp của thể loại bán hàng, dùng làm điểm xuất phát chứ không phải khuôn cứng:

1. **Mở** (0–8 giây) — nêu lời hứa, thường kèm một khối `bigtype` hoặc `tag` khẩn cấp
2. **Đối tượng** (8–45 giây) — liệt kê từng nhóm người và họ được gì, mỗi nhóm một cụm `tag` + `rows`
3. **Phá bỏ rào cản** (45–60 giây) — dùng `myth` gạch đỏ một niềm tin sai
4. **Chào chương trình** (60–75 giây) — `lockup` rồi `steps`
5. **Bóc từng phần** (75–90 giây) — mỗi phần một `tag` + `rows` hoặc `flow`
6. **Chốt** (90 giây–hết) — `rows` có dòng vàng đang chọn, rồi `cta`

### Bước 4 — Viết storyboard

Đây là đầu ra trí tuệ chính. Đọc `references/module-library.md` để chọn đúng khối và
`references/design-system.md` để lấy toạ độ. Xem `examples/storyboard.example.json`
làm mẫu.

```json
{
  "source": "clean.mp4",
  "output": "final.mp4",
  "fps": 30,
  "framing":  [ { "t": 0.0, "preset": "hero" } ],
  "captions": [ { "t": 0.0, "d": 1.0, "text": "Chỉ còn |vài suất| học" } ],
  "graphics": [ { "module": "tag", "text": "Ngày 1", "t": 2.0, "out": 9.0,
                  "x": 68, "y": 700, "w": "auto" } ]
}
```

Ba quy tắc phải giữ khi viết:

**Về phụ đề.** Bọc từ khoá trong dấu `|…|` để tô vàng. Chọn từ mang nghĩa — động từ
hành động, con số, tên công cụ, cái được lợi. Không tô mạo từ, liên từ hay giới từ.
Mỗi dòng tô một cụm là đủ, tô hai cụm trở lên thì mất tác dụng nhấn.

**Về khung hình.** Chọn khung theo lượng đồ hoạ cần chỗ, chứ không chọn ngẫu nhiên.
Không có đồ hoạ thì dùng `tall` hoặc `full`; có một cụm dưới thì `hero`; đồ hoạ chiếm
gần hết màn hình thì `mini-left` hoặc `mini-center`. Đổi khung ngay tại điểm chuyển ý,
không đổi giữa câu.

**Về đồ hoạ.** Mỗi phần tử phải có `t` trùng thời điểm ý đó được nói, sai số dưới 0,3 giây.
Với các khối nhiều mục, đặt `stagger` bằng khoảng thời gian giữa các ý trong lời nói,
thường là 0,8–1,1 giây. Luôn đặt `out` để cụm cũ biến mất trước khi cụm mới xuất hiện.

### Bước 5 — Soi bố cục

```bash
python3 scripts/check_layout.py storyboard.json
```

Script đo kích thước thật của từng khối bằng Chromium và báo bốn loại lỗi nghiêm trọng:
đồ hoạ đè lên thẻ video, đồ hoạ đè lên dải phụ đề, hai khối đồ hoạ đè nhau, và phụ đề
chồng thời gian. Nó cũng kiểm tra nhịp phụ đề, tỷ lệ bôi vàng và tần suất đổi khung.

**Chỉ chạy render khi số lỗi bằng 0.** Đây không phải hình thức: mỗi lỗi tương ứng với
một chỗ hỏng nhìn thấy được trên màn hình, và render lại tốn nhiều phút. Lưu ý thì có
thể cân nhắc bỏ qua nếu có lý do.

Lỗi hay gặp nhất là quên rằng một khối đồ hoạ sống lâu sẽ phải né **mọi** khung hình
xuất hiện trong khoảng thời gian đó, chứ không chỉ khung hình lúc nó vừa hiện ra.

### Bước 6 — Render và bàn giao

```bash
python3 scripts/render.py storyboard.json
```

Tốc độ khoảng 6–7 lần thời lượng video, tức clip 60 giây mất chừng 6–7 phút. Chạy nền
rồi theo dõi tiến độ thay vì chờ đồng bộ, vì lệnh đồng bộ sẽ bị ngắt do quá thời gian.

Render xong, lấy vài khung ở các thời điểm khác nhau để tự kiểm tra trước khi giao:

```bash
for t in 3 15 40 70; do ffmpeg -y -loglevel error -ss $t -i final.mp4 -frames:v 1 chk_$t.jpg; done
montage chk_*.jpg -tile 4x1 -geometry 300x+4+4 -background '#000' review.jpg
```

Nhìn ảnh ghép này để bắt các lỗi mà script không thấy được: mặt bị cắt cụt trong thẻ,
chữ tràn khỏi khối, đồ hoạ hiện lệch so với lời nói. Sau đó giao file bằng `present_files`.

## Bảng chấm trước khi giao

Tự chấm, dưới 90 điểm thì sửa rồi render lại, tối đa ba vòng.

| Tiêu chí | Điểm | Đạt khi |
|---|---|---|
| Khớp lời và hình | 30 | Mỗi phần tử đồ hoạ hiện đúng lúc ý đó được nói, sai số dưới 0,3 giây |
| Nhịp phụ đề | 20 | Trung bình 0,8–1,3 giây một dòng, không dòng nào quá 7 từ |
| Bôi vàng đúng chỗ | 15 | 60–80% số dòng có từ khoá, và từ được tô là từ mang nghĩa |
| Bố cục sạch | 15 | `check_layout.py` báo 0 lỗi, ảnh ghép không thấy chỗ chồng chéo |
| Nhịp khung hình | 10 | Đổi khung 5–8 giây một lần, đổi tại điểm chuyển ý |
| Chốt rõ | 10 | Có `cta` ở cuối, nêu được hành động cụ thể |

## Những chỗ hay sai

Đồ hoạ chỉ để cho đẹp mà không minh hoạ lời nói là lỗi nặng nhất, vì nó phá đúng thứ
làm nên phong cách này. Nếu không nghĩ ra khối nào minh hoạ được câu đang nói thì để
trống màn hình, chấp nhận vài giây chỉ có mặt người và phụ đề — như vậy vẫn tốt hơn là
nhồi một khối vô nghĩa.

Đặt tất cả đồ hoạ ở cùng một chỗ suốt video khiến người xem chán rất nhanh. Luân phiên
giữa trên thẻ, dưới thẻ và toàn màn hình.

Tô vàng quá nhiều từ làm mất hoàn toàn tác dụng nhấn. Nếu một dòng có ba từ được tô thì
thực chất không từ nào được nhấn cả.

Giữ một cụm đồ hoạ quá lâu, chẳng hạn hai mươi giây, khiến màn hình đứng hình dù lời
nói đã chuyển ý. Cứ 6–12 giây phải thay cụm.

## Đổi bảng màu

Phong cách gốc là đen ấm với vàng. Muốn đổi sang tông khác cho khách hàng khác, sửa các
biến trong `:root` của `overlay_engine.html` và `theme.glow_rgb` trong storyboard.
`references/design-system.md` có sẵn ba bảng màu thay thế đã cân độ tương phản.
