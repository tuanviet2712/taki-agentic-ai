# Cắt ghép — luật đã kiểm chứng

## Tìm khoảng lặng bằng năng lượng, không bằng Whisper
Whisper hay gán cho một từ độ dài trùm cả khoảng lặng sau nó. Ở Phần 13, từ "lỗi" được
gán 3,56 giây nên cách cắt theo khoảng trống giữa các từ **không thấy** quãng lặng
3,16 giây (nguồn 97,94–101,10). Kết quả: chữ hiện trước 3 giây, người dùng bắt được lỗi.

Cách đúng — `scripts/plan.py`:
1. Vẽ đường bao RMS cửa sổ 20 ms.
2. Nền = phân vị 10, tiếng nói = phân vị 85.
3. Ngưỡng = nền + max(6, (tiếng − nền) × 0,28).
4. Quãng dưới ngưỡng > 0,33 s → rút còn 0,20 s (quãng > 1,2 s rút còn 0,28 s).
5. **Nắn** mốc từ của Whisper về biên tiếng nói gần nhất trước khi làm phụ đề.

Không cắt sạch khoảng lặng — 0,20 s giữ nhịp thở, cắt phẳng nghe như máy.

## Cắt hình phải là trim+concat
Đã sai: `select` giữ nguyên PTS gốc → hình 195,7 s trong khi tiếng 179,77 s, video đứng
hình rồi lệch tiếng vĩnh viễn. Người dùng báo: "video bị dừng hình sau vài giây".

- Nếu buộc dùng `select` thì phải kèm `setpts=N/(FRAME_RATE*SPEED)/TB` — **không** dùng
  `setpts=(PTS-STARTPTS)/SPEED`.
- Tốt hơn: cắt từng đoạn rồi `concat`. Đó là cách `build.py` đang làm.
- `concat` chỉ hình thì phải ghi `v=1:a=0`, không thì sinh chân audio treo.
- Ghép cuối thêm `-shortest`: cộng dồn làm tròn qua 42 đoạn từng lệch 3 khung (3871 vs 3874).
- Đoạn cuối phải kẹp về trước hết file nguồn, đọc chạm đúng mốc kết thúc làm CapCut sập.

## Tăng tốc và nhấn hình
- Tốc độ nói 1,1× (`speed`), tiếng dùng `atempo` cùng hệ số.
- Nhấn hình xoay vòng `PUNCH=[1.0, 1.05, 1.0, 1.035, 1.0, 1.045, 1.0, 1.03]` — mỗi đoạn
  một mức, nhìn có nhịp mà không chóng mặt.

## Tự kiểm ngay trong lúc dựng
`build.py` dừng hẳn nếu |dài hình − dài tiếng| > 0,30 s. Giữ nguyên bẫy này.
