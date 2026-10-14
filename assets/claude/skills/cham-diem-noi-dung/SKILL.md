---
name: cham-diem-noi-dung
description: Chấm điểm chuyên dụng cho kịch bản video và video Lê Nga — output của skill le-nga-content-system — với trọng tâm là HIỆU QUẢ CHUYỂN ĐỔI BÁN HÀNG (50đ). Skill đánh giá 4 nhóm — Conversion Power (50đ - Hook, Pain/Desire, Trust, Scarcity, CTA, Năng lượng), DNA Thương hiệu (25đ - pass gate), Sản phẩm chính xác (15đ - chống nhầm CDT/CDD), Cấu trúc tuyến (10đ). Hỗ trợ chấm kịch bản text và video MP4 với 3 chế độ V1/V2/V3. Mục tiêu là phân loại kịch bản nào sẽ RA LEAD/ĐƠN khi chạy ads, không phải "DNA đẹp". Dùng skill này BẤT CỨ KHI NÀO người dùng muốn chấm kịch bản Lê Nga, review script bán hàng còi xe tải, đánh giá conversion kịch bản, predict CPL của video, duyệt kịch bản chạy ads Mess WIN, chấm video Lê Nga, so sánh A/B test video. Kích hoạt khi nghe "chấm điểm kịch bản Lê Nga", "kịch bản này có win ads không", "chấm video Lê Nga", "đánh giá conversion", "duyệt script chạy ads", "audit content Lê Nga".
---

# Chấm Điểm Nội Dung Lê Nga — Trục Conversion

Skill này chấm điểm **kịch bản** và **video** cho thương hiệu **Phụ tùng ô tô Lê Nga**, là output của skill `le-nga-content-system`.

**Triết lý cốt lõi (đã xoay trục):** Mục đích cuối của kịch bản là RA LEAD/ĐƠN khi chạy ads. Skill này chấm điểm để PREDICT khả năng đó. Trọng số 50đ đặt vào Conversion Power, 25đ DNA (pass-gate), 15đ Sản phẩm, 10đ Cấu trúc.

Một kịch bản DNA chuẩn 100% nhưng Hook yếu + CTA mờ = ads thua lỗ → skill này phải bắt được điều đó.

---

## QUY TRÌNH SỬ DỤNG

### BƯỚC 1 — XÁC ĐỊNH LOẠI INPUT
```
Anh muốn em chấm điểm cho:
A) Kịch bản dạng text/bảng (chưa quay)
B) Video MP4 đã quay xong (upload file)
C) Video + Kịch bản gốc (so sánh thực tế với kịch bản — BEST MODE)
```

### BƯỚC 2 — XÁC ĐỊNH TUYẾN & SẢN PHẨM

Nếu kịch bản đã ghi rõ trong header → tự đọc. Chưa có thì hỏi:
```
Em cần biết:
1. Tuyến nội dung: 1 Conversion / 2-10
2. Sản phẩm chính: CDT (Combo Đường Trường) / CDD (Combo Đường Dài) / Khác / Không cụ thể
```

### BƯỚC 3 — CHẤM THEO 4 NHÓM TIÊU CHÍ (THỨ TỰ MỚI)

**Thứ tự chấm:**
1. Nhóm B (DNA) — Pass-gate. Nếu < 18/25 → STOP, viết lại
2. Nhóm A (Conversion) — Đánh giá kỹ nhất, 50% thời gian
3. Nhóm C (Sản phẩm) — Check không nhầm CDT/CDD
4. Nhóm D (Cấu trúc) — Check đủ block

### BƯỚC 4 — XUẤT BÁO CÁO

Theo template `assets/template-bao-cao.md`.

---

## TRỌNG SỐ ĐIỂM MỚI (XOAY TRỤC THEO CONVERSION)

| Nhóm | Trọng số | Vai trò | File |
|---|---|---|---|
| **A — Conversion Power** | **50đ** | **Cốt lõi — predict ra lead/đơn** | `references/tieu-chi-conversion-power.md` |
| **B — DNA Thương hiệu** | **25đ** | Pass-gate (cần ≥18/25) | `references/tieu-chi-dna.md` |
| **C — Sản phẩm chính xác** | **15đ** | Chống nhầm CDT/CDD | `references/tieu-chi-san-pham.md` |
| **D — Cấu trúc theo tuyến** | **10đ** | Check đủ block | `references/tieu-chi-cau-truc-tuyen.md` |
| **Tổng** | **100đ** | | |

---

## NHÓM A — CONVERSION POWER (50 ĐIỂM) — CỐT LÕI

Đây là nhóm CHIẾM 50% TỔNG ĐIỂM vì nó quyết định kịch bản có RA LEAD/ĐƠN khi chạy ads hay không.

| # | Tiêu chí | Điểm | Vai trò |
|---|---|---|---|
| **A1** | Hook Stopping Power | **12** | Dừng scroll trong 3 giây đầu |
| **A2** | Pain Point & Desire | **10** | Chạm đau + khơi khao khát đúng tệp |
| **A3** | Trust & Credibility | **10** | Giảm rủi ro tâm lý (BH, test, social proof) |
| **A4** | Urgency / Scarcity | **6** | Cảm giác phải hành động NGAY |
| **A5** | CTA Power | **8** | 1 action, friction thấp, lợi ích rõ |
| **A6** | Persuasion Energy | **4** | Có "lửa" thuyết phục |

**Quy tắc chấm cốt lõi:**
- Hook + CTA = 20/50đ = 40% nhóm A (2 yếu tố sống còn)
- Pain/Desire phải CỤ THỂ (có khoảnh khắc, tình huống) — không chấm cao cho generic
- Trust signal phải THẬT (BH 1 đổi 1, test khi nhận) — KHÔNG tính cliché ("uy tín 100%")
- **Red flag:** Tuyến 1 dùng "Mua ngay" thay vì "Để lại SĐT" → A5 = 0/8 ngay lập tức

→ Chi tiết từng tiêu chí + ví dụ đúng/sai trong `references/tieu-chi-conversion-power.md`

---

## NHÓM B — DNA THƯƠNG HIỆU (25 ĐIỂM) — PASS-GATE

Đây là điều kiện CẦN. DNA mất = không phải kịch bản Lê Nga.

| # | Tiêu chí | Điểm |
|---|---|---|
| B1 | Cặp xưng hô đúng (em / anh em) | 5 |
| B2 | Ngữ vựng nghề (≥3 từ) | 4 |
| B3 | Filler tự nhiên (đấy/nhá) | 3 |
| B4 | Vật thể trên tay | 4 |
| B5 | Số liệu cụ thể | 3 |
| B6 | Setting xưởng/xe | 3 |
| B7 | Không từ cấm (trải nghiệm/đẳng cấp...) | 3 |

**Ngưỡng PASS:** ≥ 18/25 (72%).
**Nếu fail:** STOP, không tiếp tục chấm các nhóm khác. Báo cáo "FAIL DNA — viết lại từ đầu".

→ Chi tiết trong `references/tieu-chi-dna.md`

---

## NHÓM C — SẢN PHẨM CHÍNH XÁC (15 ĐIỂM)

Chống nhầm lẫn giữa 2 sản phẩm chủ lực cùng giá 1.950.000đ.

| # | Tiêu chí | Điểm |
|---|---|---|
| C1 | Định danh combo đúng | 5 |
| C2 | USP đúng sản phẩm | 5 |
| C3 | Rơ le đúng (Sihai vs Kiwon) | 2 |
| C4 | Tone âm thanh đúng (trầm vs đanh) | 2 |
| C5 | Tệp khách đúng (Bắc Nam vs nội đô) | 1 |

**Khi không có sản phẩm cụ thể (T2/T3/T6):** Bỏ Nhóm C, redistribute 15đ → A+9, B+4, D+2.

→ Chi tiết trong `references/tieu-chi-san-pham.md`

---

## NHÓM D — CẤU TRÚC THEO TUYẾN (10 ĐIỂM)

Chỉ check có đủ block của tuyến không + thời lượng + năng lượng. (Chất lượng từng block đã đánh giá ở Nhóm A.)

| # | Tiêu chí | Điểm |
|---|---|---|
| D1 | Đủ block của tuyến | 6 |
| D2 | Thời lượng phù hợp | 2 |
| D3 | Năng lượng phù hợp tuyến | 2 |

→ Chi tiết trong `references/tieu-chi-cau-truc-tuyen.md`

---

## THANG ĐIỂM TỔNG

| Điểm | Xếp hạng | Hành động ngay |
|---|---|---|
| **90–100** | 🏆 WIN — Đi quay & chạy ads | Scale ngay, có thể là template |
| **75–89** | ⭐ Tốt — Sửa nhỏ rồi chạy | Cải thiện 1-2 yếu tố nhóm A, rồi đi quay |
| **60–74** | 📝 Khá — Sửa lớn | Nâng cấp Hook/CTA/Trust, viết lại 1-2 block |
| **<60** | ❌ FAIL — Viết lại | Không pass — viết lại từ đầu, output kịch bản chỉnh sửa |

**Ngưỡng PASS bắt buộc:**
- Ads conversion: **≥ 85**
- Organic: **≥ 75**
- Test/A-B: **≥ 70**

---

## CHẾ ĐỘ CHẤM VIDEO UPLOAD

Skill hỗ trợ 3 chế độ chấm video:

| Chế độ | Input | Mô tả |
|---|---|---|
| **V1** | Chỉ video | Chấm output thực tế từ quan sát |
| **V2** | Video + kịch bản gốc | **BEST MODE** — so sánh thực tế vs kịch bản |
| **V3** | Nhiều video (A/B test) | Chấm từng cái + đề xuất scale/tắt |

Khi chấm video có thêm **Bonus ±20 điểm** (3 thành phần):
- **V-Production** (±5đ): Mic, ánh sáng, độ phân giải, chất lượng tiếng còi
- **V-Edit Hậu Kỳ** (±10đ): 7 nhóm tiêu chuẩn edit chuyên nghiệp (Hook visual, Pacing, Caption, Visual, Audio, Retention, Kỹ thuật) — file `references/tieu-chi-edit-hau-ky.md`
- **V-Authenticity** (±5đ): Khoảnh khắc "thật", background lộn xộn đúng, không bị "diễn quá"

→ Chi tiết workflow chấm video trong `references/cham-video-upload.md`
→ Chi tiết tiêu chí Edit Hậu Kỳ (mới) trong `references/tieu-chi-edit-hau-ky.md`

---

## CẤU TRÚC FILE TRONG SKILL

```
cham-diem-noi-dung/
├── SKILL.md                              (file này — router + tổng quan)
├── references/
│   ├── tieu-chi-conversion-power.md      ★ Nhóm A 50đ — CỐT LÕI
│   ├── tieu-chi-dna.md                   Nhóm B 25đ — pass-gate
│   ├── tieu-chi-san-pham.md              Nhóm C 15đ — chống nhầm CDT/CDD
│   ├── tieu-chi-cau-truc-tuyen.md        Nhóm D 10đ — đủ block
│   ├── tieu-chi-edit-hau-ky.md           ★ EDIT VIDEO ±10đ bonus — chỉ áp dụng cho video
│   └── cham-video-upload.md              Hướng dẫn V1/V2/V3
└── assets/
    └── template-bao-cao.md               Template báo cáo chấm điểm
```

**Thứ tự đọc file khi chấm 1 kịch bản (text):**
1. `references/tieu-chi-dna.md` (BẮT BUỘC trước — check pass-gate)
2. `references/tieu-chi-conversion-power.md` (BẮT BUỘC kỹ — quyết định win/lose)
3. `references/tieu-chi-san-pham.md` (nếu có SP cụ thể)
4. `references/tieu-chi-cau-truc-tuyen.md`
5. `assets/template-bao-cao.md` (format output)

**Thứ tự đọc file khi chấm VIDEO:**
1. `references/cham-video-upload.md` (workflow V1/V2/V3)
2. Tất cả 4 file tiêu chí Nhóm A-B-C-D như trên (chấm điểm chính 100đ)
3. `references/tieu-chi-edit-hau-ky.md` (★ BỔ SUNG — chấm bonus ±10đ Edit)
4. `assets/template-bao-cao.md`

---

## NGUYÊN TẮC CHẤM

### 1. Conversion trước, DNA sau
Khi user hỏi "kịch bản này tốt không", trả lời TỪ GÓC ĐỘ CHUYỂN ĐỔI: "Hook chưa đủ mạnh để dừng scroll, CTA mơ hồ — khả năng cao CPL sẽ cao." KHÔNG trả lời từ góc độ DNA trước: "Kịch bản dùng đúng cặp xưng hô em/anh em..."

### 2. Mọi feedback Hook/CTA phải KÈM ví dụ viết lại
Sai → chỉ rõ đoạn nào sai + đề xuất viết lại CỤ THỂ. KHÔNG nói "Hook cần mạnh hơn".

### 3. Khi điểm < 60, BẮT BUỘC xuất bản kịch bản viết lại
Không chỉ critique. Phải đưa kịch bản đã sửa theo template Lê Nga.

### 4. Đối với batch chấm điểm
Nếu user đưa 5-10 kịch bản cùng lúc → output bảng so sánh điểm trước, sau đó chi tiết từng cái. Phân loại nhanh: nên scale, sửa, hay bỏ.

### 5. Khi user pushback "sao chấm thấp thế"
KHÔNG hạ tiêu chuẩn. Giải thích cụ thể: "Em chấm thấp vì Hook đầu video là 'Chào anh em, hôm nay em giới thiệu...' — đây là pattern khiến viewer scroll qua trong 1 giây. Hook chuẩn WIN của Lê Nga là dạng phản biện hoặc social proof tức thời." → Đưa ví dụ cụ thể.
