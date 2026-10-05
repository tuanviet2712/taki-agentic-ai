---
name: flow-review-nha-hang-shop
description: Người dùng đưa ảnh mặt tiền + không gian của nhà hàng / quán ăn / cà phê / shop / spa / gym (+ ảnh người review nếu có), tên, địa chỉ, ý tưởng và điểm nổi bật trong Claude → Claude tự chạy công cụ "TOOL TẠO VIDEO REVIEW NHÀ HÀNG - QUÁN XÁ" trên Google Flow (kịch bản theo đoạn 8 giây → ảnh từng cảnh với người review tại đúng địa điểm → clip có lời thoại tiếng Việt) → lấy clip, ghép, chèn chữ (tiêu đề + phụ đề + địa chỉ + CTA) → trả video review địa điểm thành phẩm.
---

# Video review nhà hàng / quán ăn / shop qua Google Flow

## Luồng chạy tổng quan (bắt buộc tuân theo)

```
[1] NGUỒN DỮ LIỆU: người dùng đưa trong Claude
     (ảnh mặt tiền, ảnh không gian, ảnh người review nếu có, tên, địa chỉ, loại hình, ý tưởng, món/dịch vụ nổi bật, giá, ưu đãi)
        ↓
[2] CLAUDE TỰ XỬ LÝ TRÊN GOOGLE FLOW — đúng công cụ "TOOL TẠO VIDEO REVIEW NHÀ HÀNG - QUÁN XÁ"
     Thiết lập Review → (1) Tạo kịch bản → sửa từng đoạn → (2) Tạo N ảnh → (3) Tạo N clip → lấy clip
        ↓
[3] HẬU KỲ: ghép clip theo thứ tự + tiêu đề hook, phụ đề, địa chỉ, CTA
        ↓
[4] TRẢ VỀ: 1 file MP4 (mặc định 32 giây = 4 đoạn × 8 giây)
```

Nguyên tắc:
- **Chỉ dùng đúng công cụ "TOOL TẠO VIDEO REVIEW NHÀ HÀNG - QUÁN XÁ"**. Không dùng công cụ khác, không tự viết prompt Veo ngoài công cụ.
- **Chỉ làm video cho địa điểm của chính người dùng hoặc khách hàng đã đồng ý.** Đây là video quảng cáo của địa điểm, không phải đánh giá của khách thật. Không làm video chê hay so sánh với quán đối thủ.
- **Đúng địa điểm thật:** ảnh mặt tiền và không gian phải là ảnh thật của nơi đó. Thiếu thì hỏi người dùng (hoặc dừng khi chạy tự động), không để AI vẽ một quán không có thật.
- **Lời review trung thực:** chỉ nói món/dịch vụ, giá, giờ mở cửa, ưu đãi người dùng đưa. Không bịa món, giá, giải thưởng hay "đông nhất khu vực". Không nêu tên người thật.
- Kết quả cuối là video đã nối + đã chèn chữ.

## 0. Nhận dữ liệu

| Trường | Bắt buộc | Mặc định |
|---|---|---|
| Ảnh **mặt tiền** (bên ngoài, thấy biển hiệu/cửa) | Có | — (dùng cho cảnh 1) |
| Ảnh **không gian** bên trong | Có | — (dùng cho các cảnh 2 → N) |
| Ảnh người review (KOC) | Không | "Tạo Nhân vật ảo" — người review ảo, ghi chú "nhân vật do AI tạo" |
| Tên cửa hàng/quán, địa chỉ cụ thể | Có | — |
| Loại hình | Không | Chọn gần nhất trong 11 loại (Nhà hàng, Cà phê, Cửa hàng thời trang, Siêu thị mini, Spa & Beauty, Pub & Lounge, Quán nhậu, Tiệm bánh, Trà sữa, Fine Dining, Phòng Gym) |
| Ý tưởng kịch bản | Có | Tự viết từ thông tin người dùng (xem mục 2) |
| Giọng văn | Không | "Khen ngợi nồng nhiệt"; quán bình dân dùng "Hài hước", fine dining dùng "Chuyên nghiệp" |
| Thời lượng | Không | 32 giây (4 đoạn); chọn được 8–64 giây, bước 8 giây |
| Khung hình | Không | 9:16 |
| Model video | Không | Veo 3.1 - Lite (rẻ nhất); Omni Flash là mặc định của Tool |

## 1. Mở công cụ

- Mở link Tool trong dự án: `flow.google.com/project/<id>/tool/159cfd94-4f1a-481a-bd77-9e297bd1ae24`. Link chia sẻ `flow.google.com/shared/tool/159cfd94-…` chỉ dùng khi chưa có trong dự án: bấm "Try in a project / Dùng thử trong một dự án" → chọn dự án có sẵn → "Open / Mở".
- Tool không lưu phiên. Tải lại trang là mất hết.
- Bố cục 3 cột:
  - **trái "Thiết lập Review"**;
  - **giữa** có 3 tab: Kịch bản / Ảnh / Video;
  - **phải "Quy trình Sản xuất"** có 3 nút theo thứ tự.

## 2. Cột trái — Thiết lập Review

1. **Thông tin địa điểm:** "Tên cửa hàng/quán", "Địa chỉ cụ thể".
2. **Ý tưởng & Model AI:**
   - **"Ý tưởng kịch bản"**: ô duy nhất mang nội dung vào kịch bản (cùng tên, địa chỉ, loại hình, giọng văn). Viết 1–3 câu đủ ý. Ví dụ: `Review quán bún chả gia truyền 30 năm, chả nướng than hoa, nước chấm đậm đà, suất 45k, mở 6h–14h, đang tặng trà đá cho khách check-in` — chỉ ghi điều người dùng đã đưa. Ô trống thì Tool hiện hộp thoại báo lỗi.
   - "Tổng thời lượng" (8s → 64s, mặc định 32s): số đoạn = thời lượng ÷ 8.
   - "Khung hình" (9:16).
   - "Model Ảnh": các model Nano Banana, Tool ghi miễn phí.
   - "Model Video": Omni Flash / Veo 3.1 Lite / Fast / Quality, kèm mức tín dụng ghi ngay trong ô chọn.
3. **Tài nguyên Visual**, mỗi ô bấm vào mở hộp chọn ảnh của Flow:
   - "ẢNH NHÂN VẬT THAM CHIẾU": ảnh người review. Không có thì bấm **Tạo Nhân vật ảo (FREE)**.
   - "MẶT TIỀN": ảnh ngoài quán, dùng cho **cảnh 1**.
   - "KHÔNG GIAN": ảnh trong quán, dùng cho **cảnh 2 trở đi**.
4. **Thông tin bổ sung:** "Loại hình kinh doanh", "Giọng văn / Phong cách". "Mức độ đánh giá" (1–5 sao) chỉ để hiển thị, không ảnh hưởng kịch bản.

## 3. Cột phải — Quy trình Sản xuất

1. **Tạo kịch bản** → tab **Kịch bản** hiện các thẻ "Đoạn 1 (8s)", "Đoạn 2 (8s)"… Với từng đoạn, bấm nút sửa (biểu tượng bút) để mở ô sửa, rồi sửa thành **câu nói liền mạch** khoảng 16–22 từ cho 8 giây:
   - bỏ phần mô tả cảnh hoặc chú thích trong ngoặc;
   - bỏ tên người thật;
   - bỏ các thông tin không có trong ô ý tưởng.
   Mạch nên là: Đoạn 1 chào + giới thiệu quán ở mặt tiền → món hoặc dịch vụ nổi bật, không gian → giá/ưu đãi → địa chỉ + lời mời.
   **KHÔNG bấm nút micro "Ghi âm"**: nút này thu tiếng từ micro máy tính.
   Lưu lời thoại các đoạn vào `script.json`.
2. **Tạo N ảnh** → tab **Ảnh**: tạo lần lượt từng ảnh. Cảnh 1 gắn nhãn "NGOÀI QUÁN", các cảnh sau "TRONG QUÁN". Chụp màn hình soát:
   - cùng một người review ở mọi cảnh;
   - đúng mặt tiền và không gian thật, không có chữ hay logo lạ.
   Ảnh sai thì bấm tạo lại riêng ảnh đó, tối đa 2 lần mỗi ảnh.
3. **Tạo N clip** → tab **Video**: quay lần lượt từng đoạn, 8 giây, khung đầu là ảnh của đoạn, lời thoại tiếng Việt khớp khẩu hình.
   - Clip lỗi → bấm "Thử lại", tối đa 2 lần.
   - Clip sai lời hoặc méo mặt → nút làm lại (biểu tượng refresh), tối đa 1 lần.
   - Khung đỏ ở cột phải là thông báo lỗi chung.
4. Ở tab Video còn nút tải từng clip, tải qua trình duyệt nên có thể bị chặn. Lấy clip theo hướng dẫn môi trường chạy **khi đang ở tab Video** (tab khác không hiện video).

## 4. Hậu kỳ

1. Lấy đủ N clip theo thứ tự đoạn, mỗi clip khoảng 8 giây, có audio. Soát lời thoại thực tế, cập nhật `script.json`.
2. Ghép và chèn chữ:
   - **Tiêu đề hook** 0–3 giây, ví dụ "<TÊN QUÁN> – CÓ ĐÁNG GHÉ?".
   - **Phụ đề** đặt nửa dưới, không che mặt người review hay món.
   - **CTA suốt đoạn cuối:** địa chỉ ngắn gọn + giờ mở cửa / ưu đãi.
3. Trích 3 khung hình (đoạn đầu, giữa, cuối) để soát người review nhất quán, đúng quán, chữ dễ đọc.

## 5. Trả thành phẩm

- File: `review_<ten-quan>_final.mp4`.
- Báo: thời lượng, số đoạn, model, đoạn nào làm lại, người review là ảnh thật hay nhân vật AI.
- Caption: hook + 2–3 điểm nổi bật + giá/ưu đãi + địa chỉ + giờ mở cửa + 3–5 hashtag (#review<khuvuc> #anngon … hoặc theo loại hình).

## Tín dụng Flow (ước tính, N = thời lượng ÷ 8)

- **Ảnh:** N ảnh, cộng 1 ảnh nếu tạo nhân vật ảo (model Nano Banana, Tool ghi miễn phí).
- **Clip:** N clip 8 giây theo model đã chọn. Mức tín dụng ghi ngay trong ô chọn model, Veo 3.1 Lite rẻ nhất.

## Xử lý sự cố

- **Chưa đăng nhập / hết tín dụng / không mở được Tool:** dừng và báo.
- **Hộp thoại "Vui lòng nhập ý tưởng kịch bản!" hoặc "Vui lòng sản xuất ảnh mẫu trước!":** bấm đồng ý, bổ sung bước còn thiếu.
- **Nút mờ:** "Tạo N ảnh" cần kịch bản, "Tạo N clip" cần đủ ảnh.
- **Ảnh không giống quán thật:** kiểm tra đúng ảnh đã chọn vào ô MẶT TIỀN / KHÔNG GIAN chưa, rồi tạo lại ảnh đó.
- **Lỡ tải lại trang:** mất hết, làm lại. Ảnh đã tải vẫn còn trong mục ảnh của Flow, chọn lại từ đó.
