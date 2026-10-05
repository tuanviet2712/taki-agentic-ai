---
name: flow-review-gia-dung
description: Người dùng đưa ảnh đồ gia dụng (1–3 ảnh) + thông tin sản phẩm, thương hiệu, ưu đãi trong Claude → Claude tự chạy công cụ "TOOL REVIEW GIA DỤNG" trên Google Flow (ảnh showroom gốc có KOC cầm sản phẩm → kịch bản KOC 5 cảnh → 5 clip 8 giây) → lấy clip, ghép, chèn chữ (tiêu đề + phụ đề + CTA) → trả video review đồ gia dụng khoảng 40 giây.
---

# Video review đồ gia dụng qua Google Flow (TOOL REVIEW GIA DỤNG)

## Luồng chạy tổng quan (bắt buộc tuân theo)

```
[1] NGUỒN DỮ LIỆU: người dùng đưa trong Claude
     (ảnh sản phẩm 1–3, công dụng – tính năng – thông số – ưu đãi, tên thương hiệu, ảnh KOC nếu có)
        ↓
[2] CLAUDE TỰ XỬ LÝ TRÊN GOOGLE FLOW — đúng công cụ "TOOL REVIEW GIA DỤNG"
     Ảnh sản phẩm + thông tin + KOC + thương hiệu + model → TẠO SHOWROOM GỐC → LÊN KỊCH BẢN KOC → SẢN XUẤT TOÀN BỘ CLIPS → lấy clip
        ↓
[3] HẬU KỲ: ghép 5 clip theo thứ tự + tiêu đề hook, phụ đề, CTA
        ↓
[4] TRẢ VỀ: 1 file MP4 khoảng 40 giây
```

Nguyên tắc:
- **Chỉ dùng đúng công cụ "TOOL REVIEW GIA DỤNG"**. Không dùng công cụ khác, không tự viết prompt Veo ngoài công cụ.
- **Giữ đúng sản phẩm thật:** hình dáng, màu, nút bấm, chi tiết trong ảnh showroom phải khớp ảnh sản phẩm.
- **Lời thoại trung thực:** chỉ nói công dụng, thông số, giá/ưu đãi người dùng đưa. Không bịa con số (công suất, dung tích, bảo hành…), không hứa "tốt nhất", "số 1" khi không có căn cứ.
- **Thương hiệu đúng:** ô "Tên Thương Hiệu" mặc định là "GIA DỤNG VIỆT" và tên này đi vào lời thoại. Luôn đổi thành thương hiệu người dùng đưa. Không có thì ghi tên shop/kênh, hoặc tên sản phẩm.
- Kết quả cuối là video đã nối + đã chèn chữ.

## 0. Nhận dữ liệu

| Trường | Bắt buộc | Mặc định |
|---|---|---|
| Ảnh sản phẩm (1–3: tổng thể, chi tiết, phụ kiện/màu khác) | Có (ít nhất 1) | — |
| Thông tin sản phẩm (công dụng, tính năng, thông số, giá/ưu đãi) | Có | Tự viết từ ảnh + lời người dùng, chỉ những gì chắc chắn |
| Tên thương hiệu / shop | Không | Tên shop/kênh người dùng, hoặc tên sản phẩm |
| Ảnh KOC / người review | Không | "AI Tự Sinh": nữ dẫn chương trình châu Á, áo polo nâu + tạp dề |
| Model video | Không | Veo 3.1 - Lite (mặc định của Tool) |

Ảnh người dùng gửi được tải lên qua hộp chọn ảnh của Flow.

## 1. Mở công cụ

- Mở link Tool trong dự án: `flow.google.com/project/<id>/tool/c126d178-1bd0-49e8-bc27-c6b53870a42b`. Link chia sẻ `flow.google.com/shared/tool/c126d178-…` chỉ dùng khi chưa có trong dự án: bấm "Try in a project / Dùng thử trong một dự án" → chọn dự án có sẵn → "Open / Mở".
- Màn chào "TOOL REVIEW GIA DỤNG" → bấm **Bắt đầu sản xuất**.
- Tool không lưu phiên. Tải lại trang là mất hết.

## 2. Cột trái "AI STUDIO" — từ trên xuống

1. **Hình ảnh Sản phẩm:** 3 ô vuông (+). Bấm ô → hộp chọn ảnh của Flow → tải ảnh lên hoặc chọn ảnh có sẵn. Ảnh 1 là ảnh tổng thể rõ nhất.
2. **Thông tin sản phẩm** (ô chữ nhiều dòng): viết gọn nhưng đủ, vì đây là nguồn duy nhất của kịch bản, và kịch bản **không sửa tay được** trong Tool. Mẫu:
   `Nồi chiên không dầu 6L, công suất 1500W, lòng chống dính, hẹn giờ 60 phút, 8 chế độ nấu sẵn. Giá 1.290.000đ, đang giảm còn 990.000đ, freeship, bảo hành 12 tháng.`
   Không ghi thứ người dùng không xác nhận.
3. **Nhân vật KOC:** chọn "AI Tự Sinh" hoặc "Dùng KOC Mẫu". Chọn Dùng KOC Mẫu thì bấm ô "Tải ảnh KOC mẫu" → hộp chọn ảnh của Flow.
4. **Thiết lập AI:**
   - "Tên Thương Hiệu": sửa ngay, xoá "GIA DỤNG VIỆT".
   - "Model Video": Omni 1.1 Flash / Veo 3.1 - Lite / Fast / Quality.
5. **TẠO SHOWROOM GỐC** (Nano Banana Pro, 1 ảnh 9:16): KOC trong showroom kho gia dụng, cầm hoặc đứng cạnh sản phẩm. Chụp màn hình soát:
   - **có người review** — khi bị chặn vì chính sách, Tool tự tạo ảnh chỉ có sản phẩm, không có người, mà vẫn báo xong;
   - đúng sản phẩm (dáng, màu, chi tiết);
   - không có chữ hay logo lạ.
   Sai thì bấm tạo lại, tối đa 2 lần. Hộp đỏ "Lỗi Policy" → bỏ từ nhạy cảm khỏi ô thông tin (chữ "cam kết", "chữa", tên thương hiệu khác…) rồi tạo lại.
   **Cả 5 clip đều bắt đầu từ chính ảnh này**, nên phải chắc ảnh đẹp trước khi đi tiếp.
6. **LÊN KỊCH BẢN KOC:** 5 cảnh, giọng miền Bắc, mỗi câu tối đa 25 từ. Đọc 5 dòng "Kịch bản:" dưới 5 ô clip. Viết lại cả 5 cảnh (bấm lại nút này, tối đa 2 lần) nếu:
   - sai tên thương hiệu, sai giá;
   - có thông số không có trong ô thông tin;
   - lặp ý nhiều.
   Lưu lời thoại 5 cảnh vào `script.json`.
7. **SẢN XUẤT TOÀN BỘ CLIPS:** quay 5 clip 8 giây cùng lúc, bằng model đã chọn.
   - Tool không tự thử lại. Cảnh nào xong mà ô vẫn trống (nút quay về "TẠO CLIP") là cảnh lỗi → bấm **TẠO CLIP** ở cảnh đó, tối đa 2 lần.
   - Clip sai sản phẩm, méo tay, sai lời → **LÀM LẠI** tối đa 1 lần.
8. **TẢI GÓI ZIP** tải qua trình duyệt, có thể bị chặn. Lấy clip theo hướng dẫn môi trường chạy.

## 3. Hậu kỳ

1. Lấy đủ 5 clip theo thứ tự cảnh 1 → 5, mỗi clip khoảng 8 giây, có audio.
2. Soát lời thoại thực tế, cập nhật `script.json`. Cả 5 clip cùng khung đầu, nên khi ghép mỗi cảnh nên đổi khung (zoom/cắt nhẹ) nếu công cụ hậu kỳ hỗ trợ.
3. Ghép và chèn chữ:
   - **Tiêu đề hook** 0–3 giây, ví dụ "<TÊN SP> – CÓ ĐÁNG MUA?".
   - **Phụ đề** đặt nửa dưới, không che sản phẩm.
   - **CTA** suốt cảnh 5, ví dụ "BẤM GIỎ HÀNG – <ưu đãi>".
4. Trích 3 khung hình để soát: đúng sản phẩm, chữ không che sản phẩm, dấu tiếng Việt đúng.

## 4. Trả thành phẩm

- File: `review_gia_dung_<ten-san-pham>_final.mp4`.
- Báo: thời lượng, số cảnh, model, cảnh nào làm lại, KOC do AI sinh hay dùng ảnh mẫu.
- Caption: hook + 3 công dụng nổi bật + giá/ưu đãi + CTA + 3–5 hashtag (#giadung #reviewgiadung #nhabep …).

## Tín dụng Flow (ước tính)

- **Ảnh:** 1 ảnh showroom (cộng số lần tạo lại).
- **Clip:** 5 clip 8 giây theo model đã chọn (Veo 3.1 - Lite rẻ nhất).
- **Kịch bản:** mỗi lần viết là 1 lượt tạo chữ.

## Xử lý sự cố

- **Chưa đăng nhập / hết tín dụng / không mở được Tool:** dừng và báo.
- **Nút bị mờ:**
  - "TẠO SHOWROOM GỐC": cần ít nhất 1 ảnh sản phẩm.
  - "LÊN KỊCH BẢN KOC": cần ảnh showroom + ô thông tin sản phẩm có chữ.
  - "SẢN XUẤT TOÀN BỘ CLIPS": cần đủ kịch bản cả 5 cảnh, và không cảnh nào đang tạo.
- **Ảnh showroom không có người:** Tool đã tự dự phòng vì bị chặn. Sửa ô thông tin cho trung tính rồi tạo lại.
- **Lỡ tải lại trang:** mất hết, làm lại. Ảnh đã tải vẫn còn trong mục ảnh của Flow, chọn lại từ đó.
