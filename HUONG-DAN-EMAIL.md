# Hướng dẫn kết nối & dùng kênh Email (Resend)

Kênh Email gửi thư thật qua **Resend**, theo mô hình của auto-funnel: chiến dịch, chuỗi tự động, mẫu soạn theo văn bản / khối / kéo thả,
theo dõi giao – mở – click, tự loại bounce & khiếu nại, link hủy nhận một chạm. **Mọi thư gửi khách đều phải qua trang Duyệt.**

## Bước 1 — Chuẩn bị (làm 1 lần)

1. **Khoá mã hoá** — trong `.env` phải có `TOKEN_ENCRYPTION_KEY` (64 ký tự hex). Chưa có `.env`: chạy `pnpm bootstrap` (tự tạo).
   Khoá này mã hoá API key Resend / Cloudflare và ký link hủy nhận — **đừng đổi** sau khi đã gửi thư (link hủy cũ sẽ hỏng).
2. **Cổng công khai + tên miền cố định** (bắt buộc để gửi marketing): thêm vào `.env`
   ```
   PUBLIC_PORT=8788
   PUBLIC_BASE_URL=https://go.ten-mien-cua-ban.vn
   ```
   rồi trỏ tunnel **có tên cố định** (Cloudflare Named Tunnel / tên miền riêng) về `http://localhost:8788`
   — KHÔNG dùng `trycloudflare.com` (đổi địa chỉ mỗi lần bật → link hủy / click trong thư đã gửi sẽ chết), KHÔNG trỏ về 8787.
   Khởi động lại `pnpm dev`. Kiểm: mở `https://go.ten-mien-cua-ban.vn/healthz` phải ra `{"ok":true}`.
3. **Tài khoản Resend** (resend.com) → **API Keys → Create API Key → Full access** → chép khoá `re_…`.
4. **Chọn địa chỉ gửi** trên subdomain riêng cho email, vd. `hello@mail.ten-mien-cua-ban.vn` (không dùng domain chính để giữ uy tín).
5. (Tuỳ chọn, khuyên dùng) **Cloudflare API token** nếu DNS của domain nằm ở Cloudflare: My Profile → API Tokens → Create Token →
   mẫu **Edit zone DNS** → Zone Resources: chọn đúng zone → chép token. Có token thì hệ thống tự thêm SPF / DKIM / DMARC.

## Bước 2 — Kết nối trong Agentic AI

1. **Trung tâm tích hợp → Email (Resend) → Thêm kết nối**, chọn **Kết nối thật**, điền:
   API key · Tên người gửi · Địa chỉ gửi · (tuỳ chọn) Địa chỉ nhận trả lời, Hạn mức/ngày (mặc định 50), Cloudflare token.
2. Vào **Email marketing → Tổng quan → Thiết lập tự động**. Hệ thống:
   thêm domain trên Resend → đẩy bản ghi DNS sang Cloudflare (nếu có token; không thì hiện bảng bản ghi để bạn thêm tay)
   → xin Resend xác minh → **tạo webhook** `PUBLIC_BASE_URL/hooks/email/resend` và lưu khoá ký (mã hoá) → kiểm SPF/DKIM/DMARC.
3. DNS mới có thể mất vài phút đến 1 giờ: bấm **Kiểm lại** đến khi Domain = `verified`.
4. Mục **Sẵn sàng gửi thật** phải đủ 5 dấu ✓: Kết nối Resend · Kết nối thật · Domain đã xác minh · Địa chỉ công khai ổn định · Webhook.
5. **Gửi thư thử** tới hộp thư của bạn (xem cả mục Spam). Bấm link trong thư → tab Chất lượng gửi thấy "Đã bấm link".

Không có Cloudflare? Thêm tay các bản ghi trong bảng (MX + TXT SPF ở `send.<domain>`, TXT DKIM `resend._domainkey.<domain>`) và một bản ghi
`_dmarc.<domain>` TXT `v=DMARC1; p=quarantine; adkim=r; aspf=r; pct=100`. Webhook tạo tay: Resend → Webhooks → Add →
URL `PUBLIC_BASE_URL/hooks/email/resend`, chọn mọi sự kiện `email.*` → chép **Signing secret** (`whsec_…`) → Trung tâm tích hợp → sửa kết nối Email → ô Webhook signing secret.

## Bước 3 — Dùng

| Việc | Ở đâu |
|---|---|
| Liên hệ | Email marketing → Liên hệ: thêm tay, nhập CSV (bắt buộc chọn nguồn đồng ý). Tự thêm khi khách **gõ email trong chat** (Messenger / Zalo / website) và khi **đơn có email** (phiếu đơn có ô Email). |
| Phân khúc | Thẻ, nguồn, đã mua, đã chat, hạng lead, mở / click / mới trong N ngày. |
| Chiến dịch | Soạn (văn bản / khối / kéo thả / từ mẫu) → Xem trước → Gửi thử → **Gửi duyệt** → duyệt ở **Duyệt & Phê duyệt** → tự gửi trong khung giờ (ngoài giờ yên lặng), theo hạn mức ngày; hết hạn mức thì hôm sau gửi tiếp. A/B tiêu đề, gửi lại người chưa mở sau N giờ. |
| Chuỗi tự động | Chọn mẫu (Soap Opera, Ascension sau mua, Phục hồi giỏ…) → **AI viết tất cả** (theo DNA + skill email-marketing) → sửa → **Chấm điểm** (≥70) → **Gửi duyệt kích hoạt**. Trigger: liên hệ mới / gắn thẻ / có đơn / thủ công. Mục tiêu "mua hàng": khách có đơn → dừng chuỗi. |
| Mẫu | 60 mẫu hệ thống (10 khối, 10 kéo thả, 40 văn bản) — Nhân bản để chỉnh. |
| Chất lượng gửi | Tỉ lệ giao / mở / click / bounce / khiếu nại, danh sách loại trừ, nhật ký thư. |
| Khoá khẩn cấp | Cài đặt doanh nghiệp: `killSwitch.email` (hoặc tắt hết) — chặn mọi thư ngay. |
| MCP | Quyền "Email": `email_stats`, `email_campaigns_list`, `email_sequences_list`, `email_campaign_draft` (chỉ tạo nháp + gửi duyệt). |

## Tự bảo vệ uy tín gửi (giống auto-funnel)

- Bounce cứng / khiếu nại spam → địa chỉ vào **loại trừ** vĩnh viễn, dừng mọi chuỗi của người đó.
- 24 giờ (≥50 thư): bounce > 2,1% hoặc khiếu nại > 0,07% → **giảm tốc 50%**, tự mở lại khi hạ nhiệt;
  bounce > 3% hoặc khiếu nại > 0,1% → **NGẮT gửi**, bấm "Mở lại gửi" sau khi kiểm danh sách.
- Khách hủy nhận (link footer hoặc nút Unsubscribe của Gmail/Yahoo) → không nhận marketing nữa; thư giao dịch vẫn gửi.
  Khách nói "ngừng nhắn" trong chat → dừng **mọi** thư, kể cả giao dịch.
- Warm-up: domain mới 50 thư/ngày, tăng ×2 mỗi tuần khi bounce < 2%.
- Không có kết nối Resend thật → **không thư nào được ghi là "đã gửi"** (bỏ qua có lý do).

## Lỗi thường gặp

| Thông báo | Cách xử lý |
|---|---|
| Chưa có địa chỉ công khai ổn định | Đặt `PUBLIC_PORT` + `PUBLIC_BASE_URL` (https, tên miền cố định), khởi động lại. |
| Resend từ chối khoá (401/403) | Tạo lại API key loại **Full access**. |
| Domain `pending` / `not_started` | Đợi DNS lan (đến 1 giờ) rồi bấm Kiểm lại; kiểm bản ghi đúng tên (`send.`, `resend._domainkey.`). |
| Webhook 401 trong log | Khoá ký sai / chưa có: chạy lại Thiết lập tự động hoặc dán đúng Signing secret. |
| Chưa đạt điểm kích hoạt | Sửa các email yếu theo gợi ý dưới mỗi email, hoặc bấm ✨ để AI viết lại. |
