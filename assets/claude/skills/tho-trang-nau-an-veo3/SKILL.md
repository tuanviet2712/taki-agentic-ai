---
name: tho-trang-nau-an-veo3
description: >-
  Tạo bộ prompt Veo 3 (ảnh keyframe + video) cho series video nấu ăn faceless với nhân vật cố định thỏ trắng "Bông" đội nón lá, phong cách 3D Pixar, bối cảnh "Bunny Farm" bên sông miền Tây. Mỗi tập theo công thức "Seed to Snack": thỏ Bông lấy nguyên liệu từ vườn (có cây/trái biết nói), chế biến từng bước với công thức nấu THẬT có thông số, kết bằng người thật thưởng thức. Chia kịch bản thành phân cảnh 8 giây (mặc định 5 = 40s), mỗi phân cảnh xuất 1 prompt tạo ảnh + 1 prompt tạo video image-to-video (lời thoại giọng nữ miền Tây nhúng sẵn). Dùng skill này BẤT CỨ KHI NÀO người dùng muốn tạo kịch bản/prompt video nấu ăn với thỏ trắng, làm tập mới cho kênh Bunny Farm / thỏ Bông, tạo video dạy nấu món (đặc biệt món sấy dẻo, mứt, đồ ăn vặt từ trái cây rau củ) bằng Veo 3, hoặc chỉ đưa TÊN MỘT MÓN kèm ý muốn làm video hoạt hình dạy nấu. Kích hoạt khi nghe "video nấu ăn thỏ trắng", "kịch bản thỏ Bông", "prompt Veo3 thỏ nấu ăn", "video [món] sấy dẻo", "làm video dạy nấu [món]", "tập tiếp Bunny Farm".
metadata:
  author: user
  version: "1.0.0"
---

# Thỏ Trắng Bông Hướng Dẫn Nấu Ăn — Veo 3 Prompt Generator

Skill này sinh ra kịch bản + bộ prompt Veo 3 cho một tập video nấu ăn faceless
với nhân vật cố định là thỏ trắng **Bông**. Người dùng đưa tên món, Claude trả
về kịch bản chia phân cảnh 8 giây và, với MỖI phân cảnh, hai prompt: một để tạo
**ảnh keyframe**, một để tạo **video image-to-video** trên Veo 3.

`<args>`$ARGUMENTS`</args>`

## Vì sao khung này chạy (đừng phá lõi)

Công thức gốc thắng KHÔNG phải vì con vật dễ thương, mà vì nó **dạy người xem
một thứ họ muốn lưu lại (công thức làm theo được), gói trong lớp vỏ hoạt hình
chặn lướt**. Bốn cơ chế chồng lên nhau, giữ nguyên cả bốn:

1. **Nhân vật mascot + nguyên liệu biết nói** → chặn lướt trong 3 giây đầu.
2. **Quy trình từng bước có thông số thật** → giữ xem hết + tăng lượt LƯU BÀI.
3. **Giọng nữ miền Tây ấm + tiếng ASMR** → cảm xúc, gần gũi.
4. **Người thật ăn thành phẩm ở cuối** → bắc cầu từ thế giới ảo sang sản phẩm
   thật, tạo thèm + tin.

Nếu bỏ lớp 2 (công thức thật) hoặc lớp 4 (người thật) thì chỉ còn video dễ
thương vô hồn. Luôn giữ đủ.

## KHÓA NHÂN VẬT & BỐI CẢNH (dán nguyên văn, không đổi giữa các tập)

Đây là mô tả cố định để giữ nhất quán toàn series. LUÔN nhúng đúng đoạn tiếng
Anh này vào MỌI prompt ảnh và prompt video. Không diễn đạt lại, không rút gọn.

**RABBIT_LOCK** (nhân vật):
```
Bông, a plump upright-standing white rabbit with snow-white fluffy fur, big
round dark glossy eyes, tiny pink nose, long soft floppy-tipped ears, wearing
a traditional Vietnamese conical straw hat (nón lá), a gentle friendly smile,
soft rounded Pixar-style proportions, wearing a simple little apron.
```

**WORLD_LOCK** (bối cảnh):
```
Bunny Farm, a cozy riverside farm in the Mekong Delta of Vietnam, rustic bamboo
and weathered-wood structures, lush tropical greenery, a calm slow river in the
background, warm golden sunlight, soft global illumination, Pixar-style 3D
animated environment, high detail, shallow depth of field.
```

Biển hiệu (wooden sign) đổi theo chức năng từng khu nhưng luôn cùng vũ trụ:
`BUNNY FARM` → `BUNNY FARM KITCHEN` → `DRYING STATION` (hoặc khu chế biến phù
hợp món) → `BUNNY FARM RIVERSIDE CAFE`.

## Cấu trúc "Seed to Snack" — 5 phân cảnh 8 giây (mặc định)

Veo 3 tạo clip 8 giây là tối ưu, nên mỗi phân cảnh khớp đúng 1 clip. Mặc định
**5 phân cảnh = 40 giây**. Vai từng phân cảnh cố định; chỉ đổi nội dung chế biến
theo món:

| PC | Giây | Vai | Nội dung |
|----|------|-----|----------|
| 1 | 0–8s | **HOOK — Nguồn gốc** | Thỏ Bông chăm/hái nguyên liệu trong vườn. Một cây hoặc trái **biết nói, có mặt người**, cho Bông nguyên liệu. |
| 2 | 8–16s | **Sơ chế** | Gọt/rửa/cắt/ngâm — bước làm sạch và chuẩn bị nguyên liệu. |
| 3 | 16–24s | **Tẩm ướp + bắt đầu nấu** | Ướp gia vị + đổ vào chảo/nồi bắt đầu chế biến nhiệt. |
| 4 | 24–32s | **Hoàn thiện chế biến** | Sên/nấu tới đạt + bước cuối (sấy/nướng/hong) tạo thành phẩm. |
| 5 | 32–40s | **PAYOFF — Người thật** | Một người thật ngồi ở Bunny Farm Riverside Cafe ăn thành phẩm, biểu cảm thích thú; thỏ Bông ngồi cạnh. |

**Số phân cảnh khác 5?** Điều chỉnh theo quy tắc: PC1 luôn là HOOK nguồn gốc,
PC cuối luôn là PAYOFF người thật. Các phân cảnh giữa là các bước chế biến, co
giãn cho khớp. Ví dụ 4 phân cảnh = gộp sơ chế + ướp vào 1 PC; 6 phân cảnh = tách
riêng bước sấy/hong thành 1 PC độc lập.

## Quy trình làm việc

**Bước 1 — Nhận input.** Lấy tên món từ `$ARGUMENTS`. Nếu chưa rõ món, hỏi
ngắn: "Anh muốn làm món gì, và mấy phân cảnh (mặc định 5)?" Nếu người dùng đã
nói rõ món thì làm luôn, không hỏi lại.

**Bước 2 — Lập công thức nấu THẬT.** Đây là bước quan trọng nhất, quyết định
lượt lưu. Tra `references/recipe-library.md` xem món đã có chưa. Có → dùng đúng
thông số. Chưa có → tự soạn công thức chính xác từ kiến thức nấu ăn, phải có
**thông số thật**: nhiệt độ, thời gian, tỉ lệ (vd 1kg nguyên liệu : bao nhiêu
đường), độ dày lát cắt. Không được nói chung chung kiểu "nấu cho chín". Người
xem làm theo được thì mới lưu.

**Bước 3 — Viết kịch bản chia phân cảnh.** Map công thức vào 5 phân cảnh theo
bảng trên. Với mỗi phân cảnh viết: bối cảnh, hành động, và **lời thoại giọng
miền Tây** (theo quy tắc bên dưới). Xuất bảng kịch bản gọn để người dùng nắm
mạch trước khi đọc prompt.

**Bước 4 — Xuất prompt.** Với MỖI phân cảnh, xuất theo đúng thứ tự:
- **Prompt tạo ảnh** (dùng template IMAGE_PROMPT)
- **Prompt tạo video** (dùng template VIDEO_PROMPT, nhúng lời thoại)

Xem chi tiết template và ví dụ đầy đủ ở phần dưới.

## Template PROMPT TẠO ẢNH (keyframe)

Điền vào khung này cho từng phân cảnh. Luôn mở đầu bằng style + tỉ lệ, luôn
nhúng RABBIT_LOCK (trừ phân cảnh payoff dùng cả người thật + thỏ), luôn có
WORLD_LOCK và biển hiệu phù hợp:

```
3D Pixar-style animated scene, vertical 9:16 aspect ratio, cinematic lighting,
high detail. [RABBIT_LOCK], [hành động cụ thể của phân cảnh với nguyên liệu/
dụng cụ]. [Chi tiết tiền cảnh: nguyên liệu, dụng cụ bếp mộc mạc]. Background:
[WORLD_LOCK rút gọn cho cảnh này] with a rustic wooden sign reading "[BIỂN HIỆU]".
Warm golden [thời điểm] light, cozy appetizing mood, Pixar animation quality.
```

Phân cảnh 1 thêm: trái/cây biết nói có mặt người (anthropomorphized, cute
friendly cartoon face). Phân cảnh 5 thay thỏ-làm-chính bằng: người thật +
thỏ ngồi cạnh (xem ví dụ).

## Template PROMPT TẠO VIDEO (image-to-video)

Đây là prompt đưa vào Veo 3 kèm ảnh keyframe vừa tạo. Lo chuyển động, âm thanh,
và lời thoại. Cấu trúc bắt buộc gồm 3 phần: động tác + âm thanh, lời thoại
tiếng Việt, và dòng chặn phụ đề:

```
Animate this 3D Pixar-style scene, 8 seconds, vertical 9:16. [Mô tả chuyển
động cụ thể: nhân vật làm gì, camera di chuyển thế nào]. [Âm thanh ASMR khớp
hành động + soft acoustic background music].
A warm gentle female voice speaking Southern Vietnamese (Mekong Delta accent)
says [tone]: "[LỜI THOẠI TIẾNG VIỆT]"
No subtitles, no on-screen text, no captions, no watermark.
```

Dòng cuối "No subtitles..." là bắt buộc để Veo không tự chèn chữ méo. Phụ đề
đẹp sẽ tự thêm ở CapCut sau (xem phần Hậu kỳ).

## Quy tắc LỜI THOẠI (giọng miền Tây)

- Giọng **nữ miền Tây / Nam Bộ** đậm chất dì-trong-bếp: dùng "nghen", "nha",
  "vô", "hà", "á", "ghê luôn", "đỡ", "chừng", "liền". Ấm, mộc, không phải giọng
  phát thanh chuẩn Bắc.
- Mỗi phân cảnh **1 tới 2 câu ngắn**. Câu dài Veo dễ đọc sai. Nếu bước phức tạp,
  tách thành câu ngắn liền mạch.
- Lời thoại phải **chứa thông số thật** của công thức (nhiệt độ, thời gian, tỉ
  lệ, độ dày). Đây là thứ khiến người xem lưu bài. Ví dụ đúng: "Sấy sáu chục độ,
  tám tiếng là dẻo ngon nghen." Ví dụ sai (thiếu số, vô dụng): "Sấy cho khô là
  được."
- Phân cảnh 1 (hook): lời thoại là Bông **nói chuyện với cây/trái biết nói**,
  xin nguyên liệu. Tạo pattern interrupt.
- Phân cảnh cuối (payoff): lời thoại mô tả **vị thành phẩm** đầy thèm thuồng,
  chốt bằng cảm thán (vd "chua ngọt dẻo dai, thơm nức mũi, ghiền luôn á!").
- **Không dùng dấu gạch ngang em-dash** trong lời thoại và trong toàn bộ output.

## Quy tắc KỸ THUẬT khi chạy Veo 3

- **Giữ nhân vật nhất quán:** tạo ảnh phân cảnh 1 trước, rồi dùng CHÍNH ảnh con
  thỏ đó làm reference image khi tạo ảnh các phân cảnh sau. Đừng gen 5 ảnh độc
  lập, con thỏ sẽ lệch màu, lệch dáng, lệch nón.
- **Negative / tránh:** deformed hands, extra fingers, warped text on signs,
  inconsistent character proportions, creepy realistic animal face, human with
  extra limbs. (Veo 3 thường méo chữ biển hiệu và tay, nên biển hiệu để ngắn
  gọn và ưu tiên phụ đề thật ở hậu kỳ.)
- Nếu Veo **phát âm sai từ miền Tây** (hay gặp ở "nghen", "á", "hà"): tách câu
  ngắn hơn, hoặc thay bằng âm chuẩn hơn rồi ghép, đừng để nguyên câu dài.

## 3 NÂNG CẤP HẬU KỲ (vá đúng 3 lỗi của bản gốc — luôn nhắc người dùng)

Bản video gốc thiếu 3 thứ; luôn dặn người dùng thêm ở khâu dựng (CapCut):

1. **Phụ đề kinetic + số bước.** 70–80% người lướt Facebook xem tắt tiếng, mà
   giá trị "lưu bài" nằm trong lời thoại. Thêm phụ đề chạy theo giọng + badge số
   góc trên: `Bước 1 · Sơ chế` → `Bước 2 · Ướp` → `Bước 3 · Sên` → `Bước 4 ·
   Sấy`. Đây là thứ kéo lượt lưu mạnh nhất. (Không nhúng vào prompt Veo vì chữ
   AI hay méo — thêm thủ công cho sạch.)
2. **Nhạc nền xuyên suốt.** Một lớp lofi/acoustic nhẹ dưới tiếng ASMR, chống tụt
   năng lượng ở đoạn sên/sấy (thường là khúc giữa dễ bị lướt nhất).
3. **Card CTA 1 giây ở cuối.** Sau câu payoff, chèn logo Bunny Farm + dòng "Đặt
   [món] tại [handle/link]". Bản gốc thiếu hẳn cái này, để tiền trên bàn.

## Ví dụ đầy đủ (dứa sấy dẻo — dùng làm chuẩn tham chiếu)

Đây là output mẫu cho MỘT phân cảnh, thể hiện đúng định dạng cần xuất. Làm
tương tự cho cả 5 phân cảnh của mọi món.

**PHÂN CẢNH 1 (0–8s) — Hook nguồn gốc**

*Prompt tạo ảnh:*
```
3D Pixar-style animated scene, vertical 9:16 aspect ratio, cinematic lighting,
high detail. Bông, a plump upright-standing white rabbit with snow-white fluffy
fur, big round dark glossy eyes, tiny pink nose, long soft floppy-tipped ears,
wearing a traditional Vietnamese conical straw hat, a gentle friendly smile,
soft rounded Pixar-style proportions, wearing a simple little apron, standing in
a lush green pineapple garden holding a small metal watering can, gently watering
a large pineapple plant. One ripe golden pineapple on the plant has a cute
friendly cartoon face with warm eyes and a smile. A woven basket of pineapples
on the ground. Background: a cozy riverside farm in the Mekong Delta, rustic
bamboo and wood, a calm river, a wooden sign reading "BUNNY FARM". Warm golden
afternoon light, cozy cheerful mood, Pixar animation quality.
```

*Prompt tạo video:*
```
Animate this 3D Pixar-style scene, 8 seconds, vertical 9:16. The white rabbit
Bông gently tilts the watering can, sparkling water pours onto the pineapple
plant. The anthropomorphized golden pineapple blinks its cartoon eyes and smiles
warmly. Bông looks up hopefully, ears perking up. Slow gentle dolly-in on the
rabbit and the smiling pineapple. Audio: soft farm ambience, birds chirping,
trickling water SFX, light cheerful acoustic background music.
A warm gentle female voice speaking Southern Vietnamese (Mekong Delta accent)
says softly: "Uống nước cho ngọt trái nha, Thơm ơi! Mát rượi hà. Vậy cho Bông
xin một trái chín vàng nghen!"
No subtitles, no on-screen text, no captions, no watermark.
```

Bộ prompt đầy đủ 5 phân cảnh của dứa sấy dẻo nằm ở
`references/vi-du-dua-say-deo.md` — đọc khi cần xem mẫu trọn tập.

## File tham chiếu

- `references/recipe-library.md` — Công thức nấu THẬT có thông số cho ~14 món
  sấy dẻo / mứt / đồ ăn vặt phổ biến. Tra trước ở Bước 2. Có mục lục ở đầu file.
- `references/vi-du-dua-say-deo.md` — Ví dụ trọn bộ 5 phân cảnh (dứa sấy dẻo),
  gồm cả prompt ảnh và prompt video, để đối chiếu định dạng chuẩn.
- `references/style-va-giong.md` — Chi tiết style token, bảng biến thể món khác
  (không phải sấy), hướng dẫn xử lý giọng miền Tây trên Veo, và caption + hashtag
  mẫu để đăng bài.
