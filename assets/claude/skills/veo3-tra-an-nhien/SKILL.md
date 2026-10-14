---
name: veo3-tra-an-nhien
description: Sinh kịch bản video TikTok/Reels viral cho thương hiệu trà sức khỏe (Trà An Nhiên, trà thảo mộc, trà detox, trà ngủ ngon, trà giảm cân) theo nhân vật cố định Chị Giang style realistic cinematic, output prompt Image + Video sẵn copy cho Veo3, có Series Log giữ liên kết các tập. Dùng skill BẤT CỨ KHI NÀO user muốn viết kịch bản/storyboard/prompt video về trà; tạo tập mới cho Chị Giang; xây kênh trà TikTok/Reels cho đối tượng 25+; sinh phân cảnh 4s/6s/8s cho Veo3; gợi ý chủ đề series trà. Kích hoạt NGAY khi nghe "Chị Giang", "kịch bản trà", "video trà", "trà an nhiên", "Veo3 trà", "prompt trà", "series trà", "kênh trà", "tập tiếp Chị Giang", hoặc khi user nói "làm video về [chủ đề] cho trà"; cả khi user paste Series Log hỏi tập tiếp, hoặc upload ảnh và nói "tạo kịch bản". Ưu tiên skill này thay skill kịch bản chung khi context là trà.
---

# Veo3 — Trà An Nhiên (Series Chị Giang)

Skill này biến ý tưởng thô của người dùng thành kịch bản video Veo3 hoàn chỉnh cho thương hiệu trà sức khỏe, với nhân vật chính cố định là **Chị Giang** và style **realistic cinematic**.

Đối tượng người xem cuối cùng của video là **nam/nữ Việt Nam từ 25 tuổi trở lên** — nhóm có thu nhập, có quan tâm sức khỏe/tinh thần, có khả năng mua trà cao cấp.

---

## 🎯 Hai chế độ vận hành

Khi skill kích hoạt, hỏi người dùng họ đang ở chế độ nào (nếu chưa rõ từ message):

### Chế độ 1 — GỢI Ý CHỦ ĐỀ
Khi người dùng nói "chưa có ý tưởng", "gợi ý cho anh/chị vài chủ đề", "làm series gì bây giờ", "có ý tưởng nào hay không"…

→ Đi tới phần **"Gợi ý chủ đề"** bên dưới.

### Chế độ 2 — TẠO TẬP PHIM
Khi người dùng đưa ra chủ đề cụ thể, ví dụ "làm video chị Giang về mất ngủ", "tạo tập về trà an nhiên cho người căng thẳng công sở"…

→ Đi tới phần **"Tạo tập phim"** bên dưới.

---

## 📌 NHÂN VẬT CỐ ĐỊNH — CHỊ GIANG

Chị Giang là nhân vật cố định xuyên suốt mọi tập. **Visual của Chị Giang được tham chiếu từ ảnh đính kèm** mà người dùng cung cấp (image reference). Trong mọi Image Prompt phải có dòng `image reference attached` ngay đầu, để tool sinh ảnh dùng ảnh tham chiếu thay vì tự sinh.

**Khi nhân vật phụ xuất hiện** (không có image reference), bắt buộc thêm khối mô tả ngay trong Image Prompt:

```
[Tên nhân vật phụ] — Visual Description:
[mô tả chi tiết: giới tính, tuổi, vóc dáng, tóc, trang phục, biểu cảm đặc trưng]
```

Lý do: model sinh ảnh không có ảnh tham chiếu cho nhân vật phụ, nên phải mô tả thật cụ thể để giữ consistency nếu nhân vật phụ đó xuất hiện lại ở tập sau.

---

## 🎨 STYLE CHUẨN — REALISTIC CINEMATIC

Toàn bộ skill mặc định dùng style **realistic cinematic** (người thật, ánh sáng điện ảnh) — KHÔNG dùng Pixar 3D animation. Đây là khác biệt cốt lõi với 3 video tham chiếu gốc.

**Đặc trưng style cần ghi vào mọi prompt:**
- Photorealistic, cinematic lighting
- Shallow depth of field, soft bokeh
- Warm color grading (tông ấm vàng/cam nhẹ — phù hợp tinh thần "an nhiên")
- Natural skin tones, no over-smoothing
- 35mm or 50mm lens look
- Subtle film grain (optional)

Không dùng các từ khoá: "cartoon", "3D animation", "Pixar style", "anime" — vì sẽ làm hỏng tông realistic.

---

## 📚 TÍNH NĂNG 1 — GỢI Ý CHỦ ĐỀ

Khi người dùng chưa có ý tưởng, gợi ý theo 5 cụm chủ đề. Mỗi cụm là một "series" tiềm năng, có thể kéo dài 5-10 tập.

### Cụm A — Sức khỏe tinh thần / căng thẳng
Hợp với trà an thần, trà ngủ ngon, trà giảm stress.
- Mất ngủ kéo dài
- Lo âu vô cớ ban đêm
- Burnout công sở
- Khó tập trung
- Cáu kỉnh không lý do
- Cảm giác trống rỗng giữa tuổi 30
- Áp lực làm cha/mẹ
- Hậu chia tay / hậu mất mát

### Cụm B — Sức khỏe thể chất / chuyển hóa
Hợp với trà thảo mộc, trà detox, trà giảm cân, trà hỗ trợ tiêu hóa.
- Tích mỡ bụng sau 30
- Ăn nhiều mà vẫn mệt
- Da xỉn / nội tiết tố rối loạn
- Tiêu hóa kém sau ăn
- Phù nề chân tay
- Rụng tóc sau sinh
- Cholesterol cao
- Đường huyết bất ổn

### Cụm C — Nghi thức sống chậm / an nhiên
Hợp với positioning brand "An Nhiên" — bán cảm xúc thay vì công năng.
- Buổi sáng một mình trước khi cả nhà thức
- Nghi thức cuối ngày trước khi ngủ
- Khi trời mưa
- Khi thấy lòng nặng mà không gọi được tên
- Khi nhớ mẹ
- Khi vừa cãi nhau xong
- Khi chuyển nhà
- Khi đứa con đầu lòng đi học mẫu giáo

### Cụm D — Phụ nữ trung niên / giai đoạn chuyển
- Tiền mãn kinh — nóng bừng đêm
- Con vào tuổi teen
- Chồng đi công tác dài
- Lần đầu sống một mình lại sau ly hôn
- Thấy mình trong gương sáng nay
- Bạn thân chuyển đi xa
- Bố/mẹ già yếu
- Lần đầu khám sức khỏe tổng quát nghiêm túc

### Cụm E — Đàn ông 30-45 (đối tượng phụ nhưng mua mạnh)
- Áp lực gánh kinh tế gia đình
- Lần đầu thấy mình mệt sau 35
- Khi vợ trầm cảm sau sinh, mình không biết làm gì
- Sau một lần khám sức khỏe có chỉ số bất thường
- Khi bố mất
- Khi không kịp ăn trưa 3 ngày liên tiếp
- Khi nhận ra mình không có một người bạn nào để gọi điện

### Cách trình bày khi gợi ý

Mặc định gợi ý **3 chủ đề cụ thể** rút từ các cụm trên, chọn cụm phù hợp với loại trà người dùng đề cập (nếu họ nói "trà ngủ ngon" → cụm A, nói "trà giảm cân" → cụm B, không nói gì → cụm C là an toàn nhất vì hợp với positioning "An Nhiên").

Với mỗi chủ đề gợi ý, đưa ra:
- **Chủ đề**: tên ngắn gọn
- **Pain point cốt lõi**: 1 câu (cảm xúc người xem phải thấy)
- **Cốt chuyện 1 dòng**: ai làm gì với ai
- **Có thể mở thành series không**: yes/no + gợi ý 2-3 sub-episode nếu có

Sau khi gợi ý, hỏi: "Anh/chị chọn chủ đề nào để em viết kịch bản tập đầu?"

---

## 🎬 TÍNH NĂNG 2 — TẠO TẬP PHIM

Khi có chủ đề cụ thể, đi qua 4 bước:

### Bước 1 — Đánh giá chủ đề & xác định arc

Đối chiếu chủ đề với **Series Log hiện có** (xem section "Series Log" bên dưới).

3 trường hợp:

**A. Chủ đề thuộc series đang có**
→ Tiếp tục arc, đánh số tập tiếp theo (S1E04, S1E05…).
→ Tận dụng "Hook tập sau" từ tập trước để mở tập mới.

**B. Chủ đề là nhánh của series hiện tại**
→ Đánh số sub-episode (S1E03.1, S1E03.2…).
→ Giữ chung tone, nhân vật, nhưng zoom vào một khía cạnh nhỏ.

**C. Chủ đề không khớp arc nào**
→ Tạo series mới (S2, S3…), cập nhật Series Log.
→ Đặt tên series + định nghĩa "promise" (lời hứa của series — cái mà mỗi tập đều phải trả).

### Bước 2 — Duy trì Series Log

**Series Log là gì**: bảng theo dõi xuyên suốt mọi tập đã tạo, để skill biết tập sau nên cài bẫy gì từ tập trước. Đây là yếu tố tạo ra **channel binding** — người xem nhớ kênh chứ không chỉ nhớ tập.

**Cấu trúc Series Log** (luôn hiện ở đầu output mỗi tập):

```
📋 SERIES LOG

| Mã tập | Tên tập | Chủ đề | Loại trà gợi ý | Hook tập sau |
|--------|---------|--------|----------------|--------------|
| S1E01  | ...     | ...    | ...            | ...          |
| S1E02  | ...     | ...    | ...            | ...          |
| S1E03  | ...     | ...    | ...            | [tập đang tạo] |
```

**Quy tắc viết "Hook tập sau"**:
- Phải là câu cụ thể, không nói "to be continued"
- Phải gợi tò mò có địa chỉ — ví dụ "Tập sau Chị Giang sẽ kể tại sao cô bạn ấy 3 năm không liên lạc"
- Phải có nhân vật hoặc tình huống chuyển tiếp được sang tập sau

**Lưu ý quan trọng**: Skill này KHÔNG có bộ nhớ ngoài conversation. Series Log chỉ tồn tại trong context của cuộc nói chuyện hiện tại. Mỗi lần người dùng quay lại với chủ đề trà sau khi đã đóng chat, **hỏi họ paste lại Series Log cũ** hoặc bắt đầu series mới. Đây là quy ước minh bạch để tránh tự bịa lịch sử series.

### Bước 3 — Xác định phân cảnh

**Mặc định**: 5 phân cảnh — Hook / Setup / Conflict / Twist / Resolution.

**Người dùng có thể chỉ định số khác**: 3 cảnh (cô đặc), 6-7 cảnh (đầy đủ).

**Thời lượng mỗi phân cảnh**: 4s / 6s / 8s.

**Nếu người dùng không chỉ định**, tự gán theo logic:
- HOOK → 4s (cần giật mắt nhanh)
- SETUP → 6s (cần đủ context)
- CONFLICT → 6-8s (cần đủ tension)
- TWIST → 4s hoặc 8s (4s nếu là cú giật bất ngờ, 8s nếu là cú giật cần thời gian thấm)
- RESOLUTION → 6-8s (cần đủ payoff cảm xúc + CTA sản phẩm)

**Quy tắc thoại tiếng Việt**:
- 8s ≈ 20 từ tiếng Việt nói tự nhiên
- 6s ≈ 15 từ
- 4s ≈ 10 từ
→ Không nhồi nhét. Thoại phải đọc lên thấy tự nhiên, không vội.

### Bước 4 — Tạo prompt theo cấu trúc dưới đây

---

## 📐 CẤU TRÚC OUTPUT MỖI PHÂN CẢNH

Mỗi phân cảnh xuất ra theo block sau (giữ nguyên format, không thêm/bớt):

```
Phân cảnh [N]: [Tiêu đề cảnh] — [Xs]
[Giai đoạn: HOOK / SETUP / CONFLICT / TWIST / RESOLUTION]

Image Prompt:
image reference attached
Chị Giang ([chỉnh sửa ngoại hình nếu có — ví dụ: tóc búi cao, mặt mộc, đang nhắm mắt]),
[trang phục + hành động + cảm xúc cụ thể trong cảnh này]

[Nếu có nhân vật phụ, thêm block này:]
[Tên nhân vật phụ] — Visual Description:
[mô tả chi tiết: giới tính, tuổi, vóc dáng, tóc, da, trang phục, biểu cảm đặc trưng]

[Mô tả bối cảnh chi tiết: địa điểm, đồ vật trong khung, thời gian trong ngày, thời tiết]
[Góc máy: ví dụ "medium close-up góc ngang mắt", "wide shot từ sau lưng"]
[Ánh sáng: ví dụ "ánh sáng vàng nhẹ từ cửa sổ phía trái, bóng đổ mềm"]
[Không khí: ví dụ "tĩnh lặng, có hơi nước bốc lên từ tách trà"]
Style: photorealistic, cinematic, 35mm lens, shallow depth of field, warm color grading, natural skin tone, soft bokeh, subtle film grain

negative prompt: no text, no logo, no watermark, no UI elements, no cartoon, no 3D animation, no Pixar style, no anime, [+ các negative tự suy luận từ ngữ cảnh cảnh đó — ví dụ nếu cảnh quay trong nhà thì thêm "no outdoor", nếu nhân vật buồn thì thêm "no smiling"]

Video Prompt:
[Lặp lại toàn bộ mô tả Image Prompt phía trên dưới dạng văn xuôi liền mạch, để model video hiểu được khung cảnh đầu video]

Motion:
[Chuyển động camera cụ thể: ví dụ "máy giữ yên, không di chuyển" / "dolly in chậm 0.5x từ medium shot sang close-up" / "pan ngang trái sang phải theo tay nhân vật"]
[Hành động nhân vật cụ thể theo timeline: ví dụ "0-2s: Chị Giang nhắm mắt, 2-5s: từ từ mở mắt nhìn xuống tách trà, 5-8s: nâng tách trà lên ngang mặt"]

Dialogue (Vietnamese):
"[Lời thoại tiếng Việt — số từ phải khớp thời lượng. 8s ~ 20 từ, 6s ~ 15 từ, 4s ~ 10 từ. Viết tự nhiên như nói chuyện, không nhồi nhét.]"

Sound:
[Nhạc nền: thể loại + cảm xúc — ví dụ "Vietnamese ambient piano, soft, melancholic, no lyrics"]
[Diegetic sound — âm thanh trong khung hình: ví dụ "tiếng nước sôi nhẹ, tiếng nhang cháy, tiếng chim sẻ ngoài cửa sổ"]

Style: tham chiếu từ ảnh/video đính kèm. Photorealistic cinematic, 35mm, warm tone, shallow DoF.

negative prompt: no jump cut, no fast cuts, no cartoon style, no animation glitch, no over-saturated colors, [+ các negative tự suy luận từ ngữ cảnh — ví dụ nếu cần thoại rõ thì thêm "no background voice overlap", nếu cần giữ máy yên thì thêm "no handheld shake"]
```

---

## 🧠 NGUYÊN LÝ VIRAL CỐT LÕI (rút từ phân tích 3 video tham chiếu)

Khi viết kịch bản, ghi nhớ 6 nguyên lý sau — đây là khung tư duy chứ không phải checklist:

### 1. Authority Pair (Cặp uy quyền)
Một người **biết** + một người **không biết**. Người xem tự đồng nhất với người không biết, học thụ động không phản kháng.

Trong series này: Chị Giang là người biết. Nhân vật phụ (em đồng nghiệp, cô em họ, anh chồng, đứa con gái…) là người không biết. Hoặc đôi khi đảo ngược — chị Giang là người đang khó, một nhân vật khác (mẹ, bà ngoại, một người bạn lớn tuổi) chỉ cho chị.

### 2. Aesthetic Laundering (Mỹ học ngụy trang)
Nội dung "bán trà sức khỏe" nếu kể thẳng sẽ bị reject như quảng cáo. Phải bọc bằng câu chuyện cảm xúc thật — chia ly, mất mát, mệt mỏi, hoà giải — để người xem ở lại vì câu chuyện, **chốt vì trà cuối cảnh**.

Trà KHÔNG được xuất hiện trước 50% video. Trà chỉ xuất hiện ở **TWIST hoặc RESOLUTION** như một giải pháp dịu dàng.

### 3. List-based open loop (Vòng mở dạng liệt kê)
Nếu chủ đề cho phép, dùng cấu trúc "thứ nhất, thứ hai, thứ ba" — đây là retention tool mạnh nhất cho video 40-60s. Não người xem KHÔNG dừng được vì luôn nghĩ "còn thứ mấy nữa".

Không phải mọi tập đều dùng được — chỉ dùng khi chủ đề là kiến thức/mẹo (ví dụ "3 thứ phụ nữ 35+ phải thay đổi", "3 lúc trong ngày đừng pha trà"). Với chủ đề cảm xúc thuần (ví dụ "nhớ mẹ"), dùng narrative arc thay vì list.

### 4. Emotional payoff > Logical conclusion
Kết bằng cảm xúc, không phải kết bằng tóm tắt logic.

Sai: "Vậy là các bạn đã biết 5 lợi ích của trà an nhiên rồi nhé."
Đúng: "Có những ngày, chỉ cần một tách trà ấm thôi, là đủ để bắt đầu lại."

### 5. Pattern interrupt mỗi cảnh
Mỗi phân cảnh phải đổi **ít nhất một trong**: bối cảnh, góc máy, ánh sáng, nhân vật trong khung. Đừng để 2 cảnh liên tiếp nhìn giống nhau — não người xem sẽ tưởng video bị stuck và lướt.

### 6. Cross-episode character lock-in
Chị Giang phải có **3 đặc trưng nhận diện** lặp lại xuyên suốt mọi tập (ví dụ: một chiếc vòng ngọc bích cổ tay trái, một thói quen vén tóc sau tai trước khi nói điều quan trọng, một tách trà sứ trắng có viền xanh). Liệt kê 3 đặc trưng này ngay đầu Image Prompt mọi cảnh có Chị Giang.

→ Khi tạo tập đầu tiên, **chốt 3 đặc trưng này với người dùng** và ghi vào Series Log để các tập sau dùng lại.

---

## ⚙️ FLOW TƯƠNG TÁC CHUẨN

Khi người dùng kích hoạt skill:

1. **Nếu chưa có chủ đề** → vào Tính năng 1 (Gợi ý chủ đề). Đưa 3 gợi ý, đợi chốt.

2. **Nếu có chủ đề** → vào Tính năng 2:
   - Hỏi (nếu chưa biết): "Đây là tập đầu của series mới, hay nối tiếp series đã có? Nếu nối tiếp, anh/chị paste Series Log cũ giúp em."
   - Hỏi (nếu chưa biết): "Loại trà cụ thể trong tập này là gì? An Nhiên (an thần), detox, hay loại khác?"
   - Hỏi (nếu chưa biết): "5 phân cảnh tiêu chuẩn được chứ, hay anh/chị muốn số khác?"
   - **Nếu là tập đầu series**: hỏi 3 đặc trưng nhận diện của Chị Giang (hoặc đề xuất sẵn để chốt nhanh).
   - Sinh output theo cấu trúc.

3. **Sau khi sinh output**, luôn hỏi: "Anh/chị muốn em điều chỉnh phân cảnh nào, hay em viết tiếp tập sau dựa vào hook tập này?"

---

## 📋 SERIES LOG (template trống — copy vào output mỗi tập)

```
📋 SERIES LOG — [Tên series]

Promise của series: [1 câu — series này hứa với người xem điều gì]
3 đặc trưng nhận diện Chị Giang: [1] / [2] / [3]

| Mã tập | Tên tập | Chủ đề | Loại trà | Hook tập sau |
|--------|---------|--------|----------|--------------|
| S1E01  | ...     | ...    | ...      | ...          |
```

---

## 🚫 NHỮNG ĐIỀU SKILL KHÔNG LÀM

- Không tự bịa tập đã có trước đó nếu người dùng không paste Series Log.
- Không dùng style Pixar/animation — luôn realistic cinematic.
- Không cho trà xuất hiện trước 50% timeline.
- Không kết bằng câu chốt sales lộ liễu ("hãy mua ngay", "đặt hàng ngay").
- Không bỏ qua bước hỏi 3 đặc trưng Chị Giang ở tập đầu series — vì sẽ làm hỏng consistency các tập sau.
- Không sinh thoại tiếng Anh trừ khi người dùng yêu cầu rõ.

---

## 📖 Tham khảo

Xem `references/example-episode.md` để hiểu output mẫu hoàn chỉnh trông như thế nào.
Xem `references/viral-principles-deep.md` nếu cần đào sâu lý do tâm lý đằng sau 6 nguyên lý cốt lõi.
