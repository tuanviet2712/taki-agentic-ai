---
name: video-viral-dao-ly-trung-quoc
description: >
  Tạo kịch bản video talking-head "đạo lý" dài hơi (30s-6 phút) theo công thức viral: HOOK loss-aversion + số liệu sốc, REFRAME bằng khung uy tín có sẵn, 2-3 LUẬN ĐIỂM có ẩn dụ, TWIST kể thất bại thật, GIẢI PHÁP chủ động, CTA ẩn dụ. Có sẵn hệ thống chấm điểm viral 0-100 điểm. Dùng khi nghe: "kịch bản đạo lý", "video đạo lý Trung Quốc", "kịch bản talking head dài", "video chia sẻ kinh nghiệm bài học", "kịch bản kể chuyện thất bại xây trust", "video 1 shot không cắt cảnh", "video insight kinh doanh tài chính tư duy", "chấm điểm video viral", hoặc khi chỉ đưa 1 chủ đề ngắn muốn làm video dài chia sẻ quan điểm.
---

# Skill: Video Viral Đạo Lý Trung Quốc (Talking-Head Dài Hơi)

## NGUỒN GỐC CÔNG THỨC

Công thức này được rút ra từ phân tích chi tiết 1 video thật đã viral trên Facebook (5 phút 32 giây, 1 shot tĩnh, không cắt cảnh, không nhạc nền, không text overlay, chủ đề "tài khoản mạng xã hội mới là tài sản thật sự"). Video thắng 100% nhờ kịch bản lời nói, không nhờ hình ảnh. Đây là dạng "trust content" khác hoàn toàn content bán hàng/quảng cáo — mục tiêu là xây uy tín cá nhân dài hạn, không chốt đơn ngay.

**Nguyên tắc bất biến của định dạng:** 1 người nói, 1 khung hình tĩnh, không nhạc nền, không B-roll, không text overlay rối mắt. Toàn bộ sức nặng dồn vào lời thoại và nhịp kể chuyện.

---

## QUY TRÌNH VẬN HÀNH — 4 BƯỚC BẮT BUỘC THEO THỨ TỰ

### BƯỚC 1 — ĐỀ XUẤT CHỦ ĐỀ + ĐỐI TƯỢNG NGƯỜI ĐỌC

**Nếu người dùng chưa có chủ đề rõ ràng**, đề xuất ngay 8-10 chủ đề theo các nhóm sau, mỗi chủ đề kèm đối tượng mục tiêu cụ thể (không đề xuất chung chung):

| Nhóm | Chủ đề mẫu | Đối tượng mục tiêu | Nỗi đau/khao khát chạm tới |
|---|---|---|---|
| Tài chính cá nhân | "Tài sản thật sự không phải là nhà, là xe" | Người 25-40 tuổi đang tích lũy, chưa giàu | Sợ làm cả đời vẫn nghèo, hoang mang không biết đầu tư gì |
| Sự nghiệp & công sở | "Chức vụ, danh xưng không phải của bạn, là của công ty" | Nhân viên văn phòng, quản lý cấp trung | Sợ mất việc, sợ giá trị bản thân gắn hết vào công ty |
| Kinh doanh & khởi nghiệp | "Doanh thu không phải là lãi, đừng nhầm 2 thứ này" | Chủ shop nhỏ, chủ hộ kinh doanh mới mở | Làm cả năm không biết tiền đi đâu, sợ phá sản |
| Tư duy làm giàu | "Người giàu không tiết kiệm để giàu, họ đầu tư để giàu" | Người mới đi làm, thu nhập thấp-trung bình | Cảm giác cố gắng mãi không khá lên được |
| Gia đình & cha mẹ | "Bạn đang nuôi con ngoan hay nuôi con sợ hãi" | Cha mẹ có con nhỏ 3-12 tuổi | Sợ làm sai cách, áy náy khi la mắng con |
| Lòng người & mối quan hệ | "Người tốt với bạn nhất chưa chắc là người ở lại lâu nhất" | Người 25-45 tuổi từng bị phản bội/tổn thương | Mất niềm tin vào người khác, sợ trao lòng tin sai chỗ |
| Sức khỏe & thời gian | "Bạn đang bán thời gian trẻ để mua bệnh tật lúc già" | Dân văn phòng làm việc quá sức | Lo sợ đánh đổi sức khỏe không đáng |
| AI & công nghệ | "Không phải AI cướp việc bạn, người biết dùng AI mới cướp việc bạn" | Chủ doanh nghiệp SME, nhân viên lo bị thay thế | Sợ bị bỏ lại phía sau, hoang mang không biết bắt đầu học AI từ đâu |

Nếu người dùng đã có chủ đề cụ thể → xác nhận lại đối tượng mục tiêu bằng 1 câu hỏi duy nhất (dùng `ask_user_input_v0` nếu có sẵn) hoặc tự suy luận đối tượng hợp lý nhất rồi nói rõ giả định trước khi làm tiếp.

---

### BƯỚC 2 — HỎI VỀ ĐỘ DÀI CLIP

Luôn hỏi bước này trước khi viết kịch bản đầy đủ (dùng `ask_user_input_v0` nếu có sẵn để người dùng chọn nhanh):

> **Clip này anh muốn dài bao nhiêu?**
> - Ngắn (30-60s) — hook nhanh, 1 luận điểm, twist rút gọn, hợp TikTok/Reels
> - Trung (90-150s) — hook + reframe + 2 luận điểm + twist + CTA, hợp Facebook Reels/Shorts
> - Dài (3-6 phút) — đầy đủ 6 phase như bài mẫu gốc, hợp Facebook feed video, tối ưu watch-time

Độ dài quyết định số luận điểm và độ chi tiết của phần twist thất bại — **không rút ngắn bằng cách cắt hook hay cắt twist**, chỉ rút ngắn bằng cách giảm số luận điểm và giảm độ dài phần lý thuyết.

---

### BƯỚC 3 — GỢI Ý 10 HOOK MỞ ĐẦU VIDEO

Dựa theo chủ đề đã chốt ở Bước 1, sinh đúng 10 hook mở đầu (câu đầu tiên trong 3-15 giây), theo các khung mẫu sau (điền vào chỗ trống bằng nội dung thật của chủ đề, không để nguyên khung mẫu):

1. **Số liệu sốc + phủ định niềm tin cũ:** "[X]% mọi người chưa nhận ra, [niềm tin phổ biến A/B] không phải là [thứ đúng], mà là [thứ khác hẳn]"
2. **Twist cá nhân ngay lập tức:** "Mình vừa mất [con số/hậu quả cụ thể] vì [sai lầm cụ thể], hôm nay muốn kể thật cho mọi người nghe"
3. **Bác bỏ niềm tin số đông:** "Rất nhiều người coi [A] là [B], đây là một hiểu lầm rất lớn"
4. **Trải nghiệm + thời gian:** "Sau [số năm/số lần thất bại] làm [lĩnh vực], mình nhận ra 1 điều không ai nói thẳng cho bạn nghe"
5. **Cảnh báo trực tiếp:** "Nếu bạn đang [hành động phổ biến của đối tượng], dừng lại 30 giây nghe cái này"
6. **Nhóm đối tượng + sai lầm chung:** "[Con số]% người [đối tượng cụ thể] đang làm sai điều này mà không hề biết"
7. **Cái giá phải trả:** "Đây là sai lầm khiến mình mất [thứ cụ thể — tiền, thời gian, follow, khách hàng], đừng lặp lại như mình"
8. **Đối lập 3 vế:** "Không phải [A], không phải [B], thứ thật sự quyết định [kết quả mong muốn] là [C]"
9. **Thành thật gây chú ý:** "Hôm nay mình nói thật, kể cả khi điều này khiến vài người thất vọng về mình"
10. **Lật lại chính mình trong quá khứ:** "[X năm] trước mình từng tin điều này là đúng, giờ mình biết mình đã sai hoàn toàn"

Trình bày 10 hook thành danh sách đánh số, mỗi hook viết thành câu hoàn chỉnh sẵn dùng (không để dạng khung), để người dùng chọn 1 rồi mới viết kịch bản đầy đủ. Nếu người dùng nói "viết luôn kịch bản đầy đủ" thì tự chọn hook mạnh nhất (ưu tiên loại 1 hoặc 2 — có số liệu + twist cá nhân) và tiến hành viết.

---

### BƯỚC 4 — VIẾT KỊCH BẢN ĐẦY ĐỦ THEO KHUNG 6 PHASE

Sau khi có hook + độ dài, viết kịch bản đầy đủ theo khung timestamp dưới đây (co giãn theo độ dài đã chọn ở Bước 2):

```
PHASE 1 — HOOK (5-10% thời lượng đầu)
  Hook đã chọn ở Bước 3 + 1 câu hứa hẹn giá trị ("chia sẻ kinh nghiệm đắt giá này")
  KHÔNG mở đầu bằng câu chào hỏi/giới thiệu bản thân

PHASE 2 — REFRAME (15-20% thời lượng)
  Nêu niềm tin sai phổ biến → bác bỏ ngắn gọn → định nghĩa lại bằng 1 khung
  tư duy có sẵn uy tín (mượn 1 mô hình/câu nói nổi tiếng trong lĩnh vực đó
  để tăng độ tin) → đối lập rõ 2 vế (A là nợ/rủi ro, B mới là đúng)

PHASE 3 — LUẬN ĐIỂM (30-40% thời lượng, chia 2-3 luận điểm)
  Mỗi luận điểm PHẢI có 1 ẩn dụ cụ thể dễ hình dung (không nói lý thuyết suông)
  Độ dài: video ngắn = 1 luận điểm, trung = 2 luận điểm, dài = 3 luận điểm

PHASE 4 — TWIST: KỂ THẤT BẠI THẬT (15-20% thời lượng)
  Chuyển giọng: "còn về phần kinh nghiệm cá nhân của mình..."
  Kể chi tiết CỤ THỂ (số liệu, nguyên nhân rõ ràng), tự nhận sai, không đổ lỗi
  hoàn cảnh/người khác. Đây là đoạn quan trọng nhất, không được viết chung chung.

PHASE 5 — GIẢI PHÁP CHỦ ĐỘNG (10-15% thời lượng)
  Ngay sau khi thừa nhận sai, chuyển sang thế chủ động: "may mắn là mình có
  phương án dự phòng..." — biến từ nạn nhân thành người có hệ thống

PHASE 6 — CTA ẨN DỤ (5-8% thời lượng cuối)
  Preframe lý do biện minh của người xem ("bạn đi làm, bạn bận...") rồi bác bỏ
  luôn, chốt bằng 1 câu ẩn dụ/tục ngữ dễ nhớ, dễ trích dẫn để share
  KHÔNG dùng CTA kiểu "follow/like/comment mình đi"
```

**Quy tắc lời thoại bắt buộc:**
- Câu ngắn, trung bình 2-3 giây/câu khi đọc (khoảng 6-10 từ/câu)
- Ngôn ngữ đời thường, không sáo rỗng, không giáo điều
- Luôn có số liệu cụ thể (%, số tiền, số năm, số lần) — số liệu mơ hồ giết chết độ tin cậy
- Phần Twist (Phase 4) bắt buộc phải cụ thể tới mức chi tiết kỹ thuật/nguyên nhân, không nói chung chung "mình đã sai"

**Output kịch bản gồm:**
1. Bảng timestamp (giây bắt đầu-kết thúc | Phase | Lời thoại đầy đủ)
2. Ghi chú sản xuất: 1 shot tĩnh, không nhạc nền, không cắt cảnh, bối cảnh đời thường (không phông nền thương hiệu), ánh sáng tự nhiên
3. Cảnh báo rủi ro định dạng: định dạng 1-shot dài rất kén người nói — nếu người lên hình không giữ được nhịp câu ngắn liên tục và ánh mắt hút, nên test bản ngắn (30-60s) trước khi làm bản dài

---

## HỆ THỐNG CHẤM ĐIỂM VIDEO VIRAL — THANG 0-100 (BẮT BUỘC CHẠY CUỐI MỌI KỊCH BẢN)

Sau khi hoàn thành kịch bản (dù là kịch bản mới viết hay kịch bản người dùng đưa sẵn để chấm), luôn chấm điểm theo 4 tiêu chí, mỗi tiêu chí tối đa 25 điểm. Trình bày kết quả dưới dạng bảng + nhận xét cụ thể từng tiêu chí + rewrite mẫu cho tiêu chí yếu nhất.

### 1. HOOK CÓ THU HÚT KHÔNG (0-25đ)
| Điểm | Tiêu chuẩn |
|---|---|
| 20-25 | Có số liệu sốc HOẶC phủ định niềm tin cũ + twist cá nhân xuất hiện trong 3 câu đầu, không có lời chào/giới thiệu thừa |
| 12-19 | Có 1 trong 2 yếu tố (số liệu hoặc twist cá nhân) nhưng thiếu yếu tố còn lại, hoặc vào chậm sau câu 3 |
| 0-11 | Mở đầu chung chung kiểu "hôm nay mình muốn nói về...", có chào hỏi/giới thiệu trước khi vào vấn đề |

### 2. VIDEO CÓ CHẠM INSIGHT KHÁCH HÀNG KHÔNG (0-25đ)
Đối chiếu với đối tượng mục tiêu đã xác định ở Bước 1.
| Điểm | Tiêu chuẩn |
|---|---|
| 20-25 | Nói trúng nỗi sợ/khao khát cụ thể của đúng đối tượng, có ví dụ đời thường đối tượng tự liên hệ được ngay |
| 12-19 | Có chạm nhưng còn chung chung, chưa đủ cụ thể để đối tượng thấy "đang nói về mình" |
| 0-11 | Nội dung mang tính lý thuyết/đạo lý chung, không gắn với đời sống thật của đối tượng mục tiêu |

### 3. VIDEO CÓ KHIẾN TƯƠNG TÁC MẠNH (LIKE/SHARE/COMMENT) KHÔNG (0-25đ)
| Điểm | Tiêu chuẩn |
|---|---|
| 20-25 | Có ít nhất 1 câu "quotable" đủ mạnh để share riêng biệt, có góc nhìn gây tranh luận nhẹ (không cực đoan) |
| 12-19 | Nội dung hay nhưng không có câu chốt đủ sắc để trích dẫn/share |
| 0-11 | Nội dung an toàn, không có điểm gây tranh luận, không có câu nào đọng lại được |

### 4. VIDEO CÓ GIỮ CHÂN TỪ ĐẦU TỚI CUỐI KHÔNG (0-25đ)
| Điểm | Tiêu chuẩn |
|---|---|
| 20-25 | Có twist rõ ràng ở khoảng 55-70% thời lượng để duy trì tò mò, nhịp câu ngắn xuyên suốt, không đoạn nào lý thuyết dài quá 4 câu liên tục |
| 12-19 | Có twist nhưng đặt sai vị trí (quá sớm/quá muộn) hoặc có 1 đoạn bị chùng nhịp |
| 0-11 | Không có twist/cú rẽ ở giữa, đều đều từ đầu đến cuối, dễ bị lướt qua |

### CÁCH TÍNH VÀ KẾT LUẬN

```
TỔNG ĐIỂM = Hook + Insight + Tương tác + Giữ chân   (/100)

85-100đ  → Rất tiềm năng viral, sản xuất ngay
65-84đ   → Ổn, cần chỉnh 1-2 điểm yếu trước khi quay
Dưới 65đ → Cần viết lại theo đúng khung DNA ở Bước 4, chưa nên quay
```

Luôn kết thúc phần chấm điểm bằng: (1) bảng điểm 4 dòng, (2) 1-2 câu chẩn đoán điểm yếu nhất, (3) 1 đoạn rewrite mẫu cụ thể cho đúng phần yếu nhất đó (không rewrite toàn bộ kịch bản, chỉ đoạn cần sửa).

---

## LƯU Ý QUAN TRỌNG KHI DÙNG SKILL NÀY

- Không dùng công thức này cho content bán hàng trực tiếp/chạy ads chuyển đổi — định dạng này không có nhạc, không có text hook, không có CTA sản phẩm rõ ràng, chỉ hợp cho personal branding và nuôi phễu dài hạn.
- Phần Twist (Phase 4 — kể thất bại thật) là yếu tố quan trọng nhất tạo độ tin cậy. Nếu người dùng không có câu chuyện thất bại thật để kể, hỏi thẳng để lấy 1 câu chuyện thật thay vì tự bịa — thất bại bịa ra rất dễ bị nhận ra là giả, phản tác dụng.
- Nếu người dùng đưa sẵn 1 kịch bản/video có sẵn và chỉ muốn chấm điểm, bỏ qua Bước 1-3, chạy thẳng hệ thống chấm điểm ở cuối.
