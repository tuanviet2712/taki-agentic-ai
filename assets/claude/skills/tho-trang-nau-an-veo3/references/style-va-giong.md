# Style Token, Biến Thể, Xử Lý Giọng & Caption

## Style token (dán vào prompt ảnh khi cần siết đồng nhất)

- **Phong cách:** `3D Pixar-style animation, soft rounded shapes, subsurface
  scattering on fur, warm cinematic color grade, shallow depth of field`
- **Ánh sáng:** `warm golden hour sunlight, soft global illumination, gentle rim
  light` (giữ nhất quán mọi tập, đừng đổi sang lạnh/tối).
- **Tỉ lệ & khung:** luôn `vertical 9:16 aspect ratio`, chủ thể đặt vùng giữa,
  chừa khoảng trên đầu để hậu kỳ chèn phụ đề/badge số bước.
- **Bảng màu thương hiệu:** trắng (thỏ) + vàng nắng + xanh lá vườn + nâu gỗ mộc
  + xanh nước sông. Đây là nhận diện kênh, đừng lệch tông.

## Negative prompt (tránh lỗi Veo hay gặp)

```
deformed hands, extra fingers, warped or misspelled text on signs, inconsistent
character proportions, creepy realistic animal face, human with extra limbs or
distorted face, oversaturated colors, cluttered background, floating objects.
```

Veo hay méo chữ biển hiệu và bàn tay. Vì vậy: biển hiệu để ngắn (một cụm), và
mọi chữ QUAN TRỌNG (bước, thông số, CTA) thêm ở CapCut chứ không nhờ Veo.

## Giữ nhân vật nhất quán (quan trọng nhất của series)

1. Tạo ảnh phân cảnh 1, chọn frame con thỏ đẹp nhất.
2. Dùng chính ảnh đó làm **reference image** khi tạo ảnh PC2 tới PC5 (Veo 3,
   Imagen, Nano Banana đều cho gắn ảnh tham chiếu).
3. Nếu engine cho phép "character reference" riêng, khóa cả: màu lông trắng,
   dáng đứng thẳng mập, nón lá, mắt to đen, tạp dề nhỏ.
4. Đừng gen 5 ảnh độc lập từ text, con thỏ sẽ lệch giữa các cảnh.

## Xử lý giọng miền Tây trên Veo 3

- Veo đôi khi đọc sai/nuốt các từ đặc trưng: "nghen", "á", "hà", " vô". Cách xử lý:
  - Tách câu ngắn hơn, mỗi câu 1 ý.
  - Nếu vẫn sai, thay bằng âm chuẩn hơn ("nhé" thay "nghen", "vào" thay "vô")
    rồi ghép, hoặc thu voiceover riêng bằng TTS giọng Nam (nhiều bộ TTS tiếng
    Việt có giọng nữ miền Nam) và lồng lại ở hậu kỳ.
- Nếu muốn chắc chắn chuẩn giọng: tách audio ra làm riêng bằng TTS/voice thật,
  chỉ dùng Veo cho hình, rồi khớp khẩu hình gần đúng ở CapCut. Đánh đổi: tốn công
  hơn nhưng giọng đúng 100%.

## Biến thể món KHÔNG PHẢI sấy

Khung Seed to Snack vẫn chạy, chỉ đổi bước giữa:

- **Món mứt/kẹo (mứt dừa, kẹo chuối):** PC nguồn gốc → PC sơ chế → PC sên đường →
  PC tạo hình/đóng gói → PC người thật ăn.
- **Món nước/chè (chè, sinh tố):** PC hái trái → PC sơ chế → PC nấu/xay → PC múc
  ra ly trang trí → PC người thật thưởng thức.
- **Món mặn từ rau củ (dưa món, kim chi):** PC hái rau → PC sơ chế/phơi → PC trộn
  gia vị → PC ủ/xếp hũ → PC người thật ăn kèm cơm.

Lưu ý an toàn hình ảnh: chỉ nhân cách hóa (cho biết nói) **cây/trái/rau củ**.
KHÔNG cho con vật biết nói rồi bị chế biến thành món (phản cảm). Với món có
thịt/cá, bỏ yếu tố "nguyên liệu biết nói", thay bằng thỏ Bông đi chợ/nhận nguyên
liệu từ một nhân vật khác, giữ sự dễ thương và không gợn.

## Caption + hashtag mẫu để đăng bài

Mẫu caption (đổi [món] cho từng tập):

```
Bông làm [món] nè cả nhà ơi 🐰
Công thức đầy đủ trong video, lưu lại làm thử nghen!
Nguyên liệu nhà trồng, sạch từ vườn Bunny Farm 🌿

Ai muốn Bông làm món gì tiếp, comment cho Bông biết nha!
```

Bộ hashtag (giữ 3 nhóm: món + tổng quát + nhận diện kênh):
```
#[mon]sayd eo #anvatnhalam #congthucnauan #monngonmoingay
#dohandmade #bunnyfarm #thobong #nauancungtho #asmrcooking #douongvatvanh
```

Chốt cuối caption luôn có CTA đặt hàng nếu là kênh bán: "Đặt [món] tại [link]".
