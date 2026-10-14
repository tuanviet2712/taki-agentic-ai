# CapCut trên Mac

## Dự án nằm ở đâu
`~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<tên>/draft_info.json`
(bản Windows tên là `draft_content.json` — khác tên, cùng cấu trúc).
File đi kèm: `draft_meta_info.json`, `draft_agency_config.json`, `key_value.json`,
`draft_virtual_store.json`, `draft.extra` (đã mã hoá), `.locked`.

## Sandbox
CapCut chỉ có quyền `com.apple.security.assets.movies.read-write` → **tự đọc được mỗi
`~/Movies`**. File ở chỗ khác cần người dùng tự chọn để tạo bookmark
(`Config/com.lemon.lvoverseas.bookmark.plist`). Vì vậy mọi tài nguyên đều để trong
`~/Movies/VideoKit`.

## Nội bộ đã tìm hiểu được
- `materials.videos` chứa cả ảnh, kiểu `type:"photo"`, `duration: 10800000000`.
- Chế độ hoà trộn ở `/Applications/CapCut.app/Contents/Resources/MixMode/`;
  screen = `color_filter`, effectId 871339, resourceId 6758325170760323597.
- `unique_id` là vân tay nội dung — trùng id giữa các file gây lỗi.
- Kiểu chữ nằm trong `content`, đường viền ở `styles[0].strokes`.

## Lỗi CHƯA giải quyết
CapCut thoát đột ngột khi mở dự án do mình sinh ra **có lớp ảnh card/chèn**.
Người dùng chia đoạn kiểm tra: A không lỗi, **B lỗi**, **C lỗi**, D không lỗi, E không
lỗi — sập quanh giây thứ 34.

Đã thử và loại trừ, vẫn sập: hạ ảnh 52 MP xuống ≤1400 px; kẹp đoạn không chạm hết file;
dời hết media vào `~/Movies`; bỏ luồng mjpeg thứ 3 của DJI; xoá file sidecar cũ; tắt
`use_converter`; để ảnh toàn khung `scale = 1.0`; băm md5 riêng cho từng `unique_id`;
bỏ `loudnesses` trên đoạn ảnh; đổi MP3 sang AAC m4a.

**Cách đi vòng đang dùng: xuất thẳng MP4 bằng ffmpeg và giao file.** Dự án chỉ-cắt-ghép
(không card) thì mở bình thường.

Chưa có quyền Trợ năng (Accessibility) cho Claude nên không điều khiển được giao diện
CapCut — không mở, tua hay chụp màn hình dự án được.
