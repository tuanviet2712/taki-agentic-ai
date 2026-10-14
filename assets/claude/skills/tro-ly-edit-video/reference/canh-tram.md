# Cảnh trám

Người dùng đã bác bản đầu: "cảnh trám ko có, cảnh trám pixcel ko có, lại đi lấy cái ảnh
icon trông xấu quá em ạ".

**Luật: cảnh trám phải vẽ đúng thứ đang được nói tới**, dựng như một mảnh giao diện thật.
Không dùng icon nhân vật vector chung chung.

Các cảnh đã dựng và dùng được (`scripts/cards.py`):
- So sánh font trước/sau
- Tường chữ đối lại slide có dẫn chứng
- Lưới ảnh gom về một khối
- Biểu đồ cột mọc dần
- Sơ đồ tư duy toả nhánh
- Gạch đầu dòng hiện theo từng cú nhấp
- So sánh Canva với Google Slides

Cách dựng: PNG toàn khung 1080×1920, nền lưới (`grids/`) đổi màu theo phần, chồng lên
bằng `zoompan` cho có chuyển động chậm. Ảnh chèn phải ≤ 1400 px cạnh dài.

Video quay màn hình thì **không** dùng card toàn khung — nó che mất thứ người xem cần thấy.
