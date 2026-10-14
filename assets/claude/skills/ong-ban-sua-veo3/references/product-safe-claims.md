# Product Safe Claims - Hướng Dẫn An Toàn Theo Sản Phẩm

Check list claim an toàn cho từng dòng sữa công thức phổ biến ở Việt Nam. Dùng khi người dùng đưa tên sản phẩm cụ thể.

---

## NGUYÊN TẮC CHUNG (áp dụng cho MỌI sản phẩm)

### Tuổi đối tượng (bắt buộc check)
- **Sữa 0-6 tháng**: ❌ CẤM QUẢNG CÁO hoàn toàn (Nghị định 100/2014)
- **Sữa 6-12 tháng**: ❌ CẤM QUẢNG CÁO trên social media/internet
- **Sữa 1-2 tuổi**: ⚠️ Hạn chế - chỉ được quảng cáo với nội dung "sữa dinh dưỡng công thức tiếp theo" (follow-up)
- **Sữa trên 2 tuổi**: ✅ AN TOÀN - quảng cáo tự do
- **Sữa người lớn / bà bầu**: ✅ AN TOÀN hoàn toàn

**Quy tắc vàng**: Nếu người dùng KHÔNG rõ tuổi sản phẩm, HỎI RÕ trước khi tạo prompt. Mặc định khuyến khích chọn sữa **trên 2 tuổi** để tránh rủi ro.

---

## DANH SÁCH SẢN PHẨM AN TOÀN (sữa 2+ tuổi)

Các sản phẩm này được phép quảng cáo công khai:

### Nhóm sữa tăng trưởng bé 2+ tuổi
- **Similac Total Comfort** (số 3, 4) - Abbott
- **Similac Eye-Q Plus** (số 3, 4) - Abbott  
- **PediaSure** (trên 1 tuổi) - Abbott
- **Aptamil Profutura** (số 3, 4) - Danone
- **Aptamil Gold+** (số 3, 4) - Danone
- **Meiji Milk Formula** (số 9 - cho bé từ 1-3 tuổi)
- **Friso Gold** (số 3, 4) - FrieslandCampina
- **Nan Optipro** (số 3, 4) - Nestlé
- **Nan Supreme Pro** (số 3, 4) - Nestlé
- **Glico Icreo** (số 3 - cho bé trên 1 tuổi)
- **Morinaga Chilmil** (cho bé 1-3 tuổi)
- **Wakodo Gun Gun** (sữa bé lớn)
- **Enfagrow** (Mead Johnson) - bé trên 1 tuổi
- **Dielac Alpha Gold** (Vinamilk) - bé 2+ tuổi
- **Vinamilk Optimum Gold** (số 3, 4)

### Nhóm sữa bầu / sau sinh (cho mẹ)
- Similac Mom
- Enfamama A+
- Anmum Materna
- Frisomum Gold
- Wakodo Mama Milk

---

## USP AN TOÀN THEO BRAND

### Similac
- ✅ "Tăng cường hệ tiêu hóa" (thay vì "chữa táo bón")
- ✅ "Bổ sung DHA, lutein, vitamin E"
- ✅ "Hỗ trợ phát triển trí não và thị lực"
- ❌ Không nói "thông minh hơn", "giỏi hơn"

### Aptamil
- ✅ "Công thức Synbiotic"
- ✅ "Hỗ trợ miễn dịch"
- ✅ "Gần gũi với sữa mẹ về thành phần" (KHÔNG nói "tốt như/hơn sữa mẹ")

### Meiji
- ✅ "Công thức Nhật Bản"
- ✅ "Vị nhạt, bé dễ uống"
- ✅ "Không đường mía, không chất tạo mùi"

### Friso / NAN
- ✅ "Dinh dưỡng cân bằng"
- ✅ "Công thức 2'-FL HMO hỗ trợ đề kháng"

### Glico / Morinaga / Wakodo
- ✅ "Hương vị Nhật nhẹ nhàng"
- ✅ "Ít gây dị ứng" (KHÔNG nói "không gây dị ứng")

### Vinamilk / Dielac / Optimum
- ✅ "Sản phẩm Việt Nam"
- ✅ "Phù hợp khẩu vị trẻ Việt"
- ✅ "Giá hợp lý"

---

## TEMPLATE PROMPT SẢN PHẨM CỤ THỂ

Khi người dùng chọn 1 sản phẩm, thay thế vào:

```
SẢN PHẨM: [Tên đầy đủ]
ĐỐI TƯỢNG: Bé trên [X] tuổi / Mẹ bầu / Mẹ sau sinh
USP CHÍNH: [1 USP an toàn từ danh sách trên]
TAGLINE AN TOÀN: [câu ngắn]
GIÁ: [khoảng giá]
```

Ví dụ điền cho Similac Total Comfort:
```
SẢN PHẨM: Similac Total Comfort số 3 (900g)
ĐỐI TƯỢNG: Bé trên 1 tuổi (an toàn để quảng cáo)
USP CHÍNH: Công thức dễ tiêu, hỗ trợ tiêu hóa
TAGLINE AN TOÀN: "Bé ăn ngon, tiêu hóa nhẹ nhàng"
GIÁ: 650,000 - 750,000 VND
```

---

## CHECKLIST COMPLIANCE CUỐI CÙNG

Trước khi finalize prompt, kiểm tra:

- [ ] Sản phẩm dành cho bé trên 2 tuổi (hoặc mẹ bầu/sau sinh)
- [ ] Không có từ "chữa", "trị", "khỏi hẳn" trong lời thoại
- [ ] Không so sánh với sữa mẹ
- [ ] Không dùng hình ảnh trẻ dưới 2 tuổi trong video
- [ ] Không claim "tăng IQ" hoặc "thông minh hơn"
- [ ] Không claim "100% an toàn" / "không tác dụng phụ"
- [ ] CTA không dùng từ "cam kết", "đảm bảo 100%"
- [ ] Không dùng hình ảnh bác sĩ, y tá, bệnh viện làm endorsement

Nếu vi phạm bất kỳ check nào → quay lại sửa prompt TRƯỚC khi render.

---

## CẢNH BÁO RỦI RO PLATFORM

Các rủi ro thường gặp khi chạy video sữa công thức:

### Facebook/Meta
- Video có thể bị **giảm reach** nếu dùng từ "sữa công thức" ngay trên video
- **Giải pháp**: Dùng từ thay thế trong text overlay: "sữa bé lớn", "dinh dưỡng bé"
- Ads sữa công thức cho trẻ nhỏ **không được chạy ads** ở Việt Nam → chỉ organic

### TikTok
- TikTok Shop Việt Nam **cho phép bán sữa công thức trên 2 tuổi** nhưng không được gắn link trong video quảng cáo cho bé dưới 2 tuổi
- Video livestream bán sữa công thức **phải tuân thủ quy định Bộ Y tế**

### Shopee
- Link affiliate sữa công thức **được phép** nhưng content marketing phải tuân thủ
- Ưu tiên post affiliate ở **Shopee Feed** thay vì Facebook

---

## LỜI KHUYÊN CHIẾN LƯỢC

Với Steve (Nguyễn Tất Kiểm - TAKI Academy), để **tối ưu rủi ro vs reach**:

1. **Khởi động kênh bằng sản phẩm an toàn tuyệt đối**:
   - Sữa mẹ bầu (Similac Mom, Enfamama)
   - Sữa tăng trưởng bé 3+ tuổi (Pediasure, Dielac Alpha Gold)

2. **Sau khi có 10k followers**, test sang sản phẩm "ranh giới":
   - Sữa follow-up 1-2 tuổi - chỉ nói về "bé lớn", "bé đi học mẫu giáo"

3. **KHÔNG bao giờ** làm video sữa 0-12 tháng dù doanh thu cao

4. **Mix content**: 70% video sữa + 30% content phụ trợ (bình sữa, muỗng, ghế ăn dặm) để tránh bị flag "chỉ quảng cáo sữa"
