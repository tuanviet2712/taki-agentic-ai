# Âm thanh — số đo, không phải cảm tính

Người dùng đã phàn nàn: "nhạc nền to hơn lời (em cần xác định giọng anh như nào rồi
hẵng cho nhạc nền)". Từ đó mọi mức đều đo trước.

## Mức chuẩn (LUFS)
| Lớp | Mức |
|---|---|
| Giọng | −16 |
| Nhạc nền | −34 |
| Tiếng nhấn (hit, subdrop) | −27 |
| Tiếng chuyển cảnh | −30 |
| Tiếng giao diện (click) | −29 |

Trộn xong: `loudnorm=I=-15.5:TP=-2.0:LRA=11` rồi `alimiter=limit=0.79:level=disabled`.
Thành phẩm đo được ≈ −15,5…−15,7 LUFS, đỉnh thật ≈ −2 dBFS.

## Ba bẫy đã mất thời gian
1. **`alimiter` mặc định `level=enabled`** → tự kéo lại về 0 dB, cộng thêm ~2 dB sau
   loudnorm nên đỉnh luôn dính 0 dBFS. **Bắt buộc ghi `level=disabled`.**
2. **LUFS tích hợp vô dụng với tiếng ngắn.** EBU R128 đo theo khối 400 ms và có cổng
   chặn im lặng, nên một tiếng click 0,05 s đo ra **−70 LUFS** dù nghe rất rõ. Cứ tin
   con số đó mà tính hệ số thì cần khuếch đại +50 dB, và luật "bỏ file cần khuếch đại
   quá 6×" sẽ vứt sạch mọi tiếng click, tiếng gõ phím.
   → **Tiếng dưới 0,4 s: dùng RMS, không dùng LUFS.** Kho tự sinh đã chuẩn hoá RMS về
   −20 dBFS và ghi sẵn số đo ở `presets/do-am-luong.json` — đọc từ đó, đừng đo lại.

3. **SFX trong kho lệch nhau tới 50 dB.** Subdrop/Cinematic Hit đo −19,5/−20,1 LUFS
   (to ngang giọng −19,0) còn Swoosh/Mouse Click −57…−70 LUFS (không nghe thấy gì).
   → Đo từng file bằng `ebur128`, tính hệ số về mức đích. **File nào cần khuếch đại
   quá 6× thì bỏ**, vì kéo lên chỉ toàn tiếng ồn nền.

## Nhạc nền
Chọn theo mood đã ghi ở bước biên kịch, vào sau câu hook, hạ xuống ở đoạn cao trào lời nói.
Kho nhạc ở `<kho>/music`, tên theo `nen-<mood>-<nhịp>[-cao|-trầm].wav`:
`binh-yen` · `tap-trung` · `nang-luong` · `suy-tu` · `hoi-hop` · `tuoi-sang`,
mỗi mood ba nhịp (`cham` 58 · `vua` 74 · `nhanh` 96) và ba cao độ.

Tất cả đã chuẩn hoá RMS −20 dBFS, nên hệ số về mức đích tính thẳng được:
`gain_dB = mức_đích_LUFS − (−20)`, ví dụ nhạc nền −34 → hạ 14 dB.
