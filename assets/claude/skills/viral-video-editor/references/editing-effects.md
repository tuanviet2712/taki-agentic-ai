# Playbook hiệu ứng và kỹ thuật dựng

## Hệ thống nhịp hình

Mỗi beat phải phục vụ một trong bốn việc: **hiểu**, **tin**, **cảm**, **tiếp tục xem**. Chọn hiệu ứng sau khi xác định danh từ, động từ hoặc quan hệ cần minh họa; không bắt đầu từ danh sách preset.

| Tình huống | Xử lý ưu tiên | Tránh |
|---|---|---|
| Câu hook | cold open, punch-in, keyword lớn, impact nhẹ | logo intro |
| Nêu vấn đề | close-up hoặc crop chặt, giảm nhạc | montage không liên quan |
| Liệt kê 3 ý | card lần lượt, icon tối giản, nhịp click | đổ cả danh sách một lần |
| Thao tác phần mềm | zoom vùng click, cursor emphasis, step label | quay toàn giao diện quá nhỏ |
| Before/after | split screen, wipe có chủ đích, A/B label | transition che mất khác biệt |
| Dữ kiện quan trọng | number card, freeze 6–12 frame, ding nhẹ | chữ dài kín màn hình |
| Câu chuyển ý | hard cut + đổi crop/B-roll | whoosh mọi lần |
| Payoff | giữ shot đủ lâu, giảm overlay, nâng nhạc nhẹ | cắt quá nhanh không kiểm chứng được |
| CTA | layout sạch, 1 keyword/action | 4 CTA cùng lúc |

## Caption hấp dẫn nhưng dễ đọc

- Base: chữ trắng/off-white, weight 700–900, shadow mềm hoặc plate đen 55–75%.
- Accent: một màu hồng, vàng hoặc cyan; dùng nhất quán.
- Hiệu ứng vào: scale 0.92→1 hoặc translateY 20→0 trong 5–9 frame.
- Keyword pop: scale 1→1.08→1 trong 4–6 frame, chỉ ở từ quan trọng.
- Caption page đổi theo cụm nghĩa 700–1400 ms; không flash nhanh hơn khả năng đọc.
- Không animate từng ký tự bằng opacity. Typewriter dùng string slicing.

## Punch-in và reframing

- 100%: phát biểu nền/giải thích.
- 112%: nhấn câu mới hoặc loại bỏ jump cut.
- 125%: hook, phản ứng hoặc punchline.
- Dịch crop theo hướng mắt để tạo không gian nhìn.
- Tránh zoom ra/vào luân phiên như metronome; dùng theo ý nghĩa.

## B-roll

- B-roll nên bắt đầu ngay trước hoặc đúng danh từ/hành động mà nó minh họa.
- Giữ 0,8–2,5 giây cho proof nhanh; 2–5 giây cho thao tác cần đọc.
- Có thể đặt A-roll dạng picture-in-picture khi biểu cảm người nói còn quan trọng.
- Với screen recording, crop tới vùng thao tác và làm nổi cursor/click; không phóng quá mức làm mất ngữ cảnh.

## Pattern interrupts

Chọn tối đa 3 nhóm phù hợp video:

- crop/punch-in;
- B-roll hoặc proof;
- text/card/diagram;
- background/world transformation;
- freeze frame hoặc speed ramp nhẹ;
- split screen/before-after;
- thay đổi âm nhạc/SFX có chủ đích.

Ba nhóm là ba **họ ngôn ngữ hình ảnh**, không phải ba preset lặp lại. Trong một họ text/card có thể đổi cấu trúc giữa keyword, number card, danh sách lần lượt, A/B, quote, timeline và sơ đồ quan hệ. Đọc [effect-strategy.md](effect-strategy.md) khi cần thiết kế mật độ cao mà vẫn đa dạng.

## Transition

- Hard cut: mặc định.
- Fade 6–12 frame: đổi thời gian/tông cảm xúc.
- Slide/wipe 8–15 frame: so sánh hoặc di chuyển logic.
- Whip 4–8 frame: năng lượng cao, chuyển footage tương đồng.
- Light leak: montage/lifestyle; dùng hiếm.
- Glitch: chỉ hợp chủ đề lỗi/công nghệ; tối đa vài lần.

## Sound design map

- Hook: impact/sub hit rất ngắn nếu hợp tông.
- Text/card xuất hiện: pop/click nhẹ.
- Swipe/split reveal: whoosh duy nhất đồng bộ chuyển động.
- Thành công/payoff: ding hoặc music lift.
- Lỗi/cảnh báo: error tone nhỏ; tránh meme sound nếu phá thương hiệu.
- Nhạc nền phải duck dưới voice; fade đầu/cuối, không cắt đột ngột.

## Ba phong cách hình ảnh rút ra từ bộ mẫu

### Tech dark

Nền đen/texture, trắng + cyan/hồng, UI cards, lưới mảnh, shadow/glow có kiểm soát. Hợp demo AI và screen recording.

### Editorial clean

Nền sáng/kem, sans-serif đậm kết hợp serif tinh tế, một màu accent. Hợp talking head giáo dục và thought leadership.

### Documentary collage

Giấy cũ, ảnh cắt lớp, texture in, red string/stamp, pan/parallax nhẹ, voice bí ẩn. Hợp lịch sử và storytelling; không dùng cho tutorial cần giao diện rõ.
