# Plan: Thêm kênh Email vào Agentic AI (lấy từ auto-funnel)

> Nguồn: `D:\Git\auto-funnel` (Next.js + MongoDB). Đích: repo này (Fastify + node:sqlite + orchestrator queue).
> Nguyên tắc chung: **chép phần logic thuần (`core/`), viết lại phần hạ tầng** theo kiểu của Agentic AI. Không mang MongoDB, kho `voiKho`, hàng đợi Mongo, server action của Next sang.

## 0. Hiện trạng

| | auto-funnel | Agentic AI |
|---|---|---|
| Gửi email | Resend (fetch thuần), cổng gửi duy nhất `services/gui-tin.ts` `guiEmailNgay` | Chưa có. Enum `Channel` trong `packages/contracts` đã có `"email"` nhưng không dùng |
| Nhận email | **Không có** (inbox của nó là Messenger/Zalo) | Chưa có |
| Dữ liệu | Mongo: `tin_nhan`, `loai_tru_gui`, `tu_choi_nhan`, `cai_dat_email`, `chien_dich_email`, `chuoi_email`, `email_chuoi`, `ghi_danh_chuoi`, `phan_khuc`, `mau_email_khoi`, `kho_lien_ket`, `luong_tu_dong`, `su_kien` | SQLite: `conversation`, `message`, `lead`, `nurture_lead`, `contact_optout`, `approval`, `track_link`, `attribution_link`… **Không có bảng khách hàng chung** |
| Hàng đợi | Mongo queue tự viết + cron 1–2 phút | `enqueue()` + bảng `schedule` (`SCHEDULES` trong `business.ts`) |
| Mẫu email | 3 chế độ: văn bản (`core/email.ts`), khối maily.to, kéo thả (waypoint) | Không có |
| Uy tín gửi | Warmup cap/ngày, `giam_toc`, kill-switch bounce/complaint, DNS SPF/DKIM/DMARC, kết nối domain 1 chạm (Resend + Cloudflare) | Có `killSwitch`, `caps`, `quietHours` trong `bizSettings` |

## 1. Quyết định kiến trúc

1. **Nhà cung cấp:** Resend (giống auto-funnel), gọi bằng `fetch`, không dùng SDK. Thiết kế qua interface connector để sau này thêm SMTP/Gmail.
2. **Real-or-nothing:** bỏ chế độ "giả lập rồi đánh dấu đã gửi" của auto-funnel. Chưa có kết nối Resend live → `ConnectorError("PolicyRejected", "Chưa kết nối email…")`. Connector sandbox chỉ dùng trong test/mô phỏng và ghi rõ `simulated`.
3. **Bí mật:** API key Resend/Cloudflare lưu mã hoá trong `connection.token_ciphertext` (`encryptSecret`), **không** ghi vào `.env.local` như auto-funnel. Webhook secret lưu trong `channel.secret_ciphertext`.
4. **Một cổng gửi duy nhất:** `packages/orchestrator/src/email/send.ts` `sendEmail()`. Mọi luồng (chiến dịch, chuỗi, nurture, follow-up, agent, trả lời thủ công) đều đi qua đây.
5. **Danh tính email:** thêm bảng `email_contact` làm "sổ liên hệ email". Nó nối với `conversation`, `lead`, `nurture_lead`, `orders` bằng khoá. Đây cũng là nền cho việc gộp khách đa kênh sau này. Địa chỉ email được băm (`emailHash` = sha256 lowercase/trim) để dùng trong opt-out và log; không gửi email thô vào LLM/log (giống quy tắc che SĐT).
6. **Email là một kênh hội thoại:** thư khách trả lời tạo `conversation(channel="email")` và đi qua `handleIncoming` như Messenger/Zalo, nên dùng chung inbox, Jev, chốt đơn, lead, opt-out.
7. **Không tự bật:** gửi chiến dịch, kích hoạt chuỗi, bật bot trả lời email đều mặc định tắt và cần người duyệt (theo HANDOFF). Auto-approve không áp dụng cho email gửi khách.

## 2. Mô hình dữ liệu (SQLite, thêm vào `SCHEMA` trong `packages/db/src/schema.ts`)

Mọi bảng có `id`, `biz_id`, `created_at`, `updated_at`. Cột JSON phải thêm vào `JSON_COLS`.

| Bảng | Từ auto-funnel | Cột chính |
|---|---|---|
| `email_contact` | `khach_hang` (phần email) | `email`, `email_hash` UNIQUE(biz_id,email_hash), `name`, `conversation_id`, `lead_id`, `nurture_lead_id`, `source` (form/chat/nurture/order/import), `consent` (opt_in/transactional/unknown), `tags` JSON, `status` (active/unsubscribed/bounced/complained), `attrs` JSON, `last_open_at`, `last_click_at` |
| `email_message` | `tin_nhan` | `contact_id`, `conversation_id`, `to_addr`, `subject`, `html`, `text`, `source_kind` (campaign/sequence/nurture/follow_up/reply/test/transactional), `source_id`, `step`, `status` (queued/sent/failed/skipped/delivered/opened/clicked/bounced/complained), `reason`, `provider_id`, `message_id_header`, `in_reply_to`, `sent_at`, `opened_at`, `clicked_at`, `simulated` |
| `email_suppression` | `loai_tru_gui` | `email_hash`, `reason` (hard_bounce/complaint/manual), UNIQUE |
| `email_template` | `mau_email_khoi` | `name`, `group`, `subject`, `preheader`, `mode` (text/blocks/dnd), `body` JSON, `system` bool |
| `email_segment` | `phan_khuc` | `name`, `definition` JSON, `member_count`, `computed_at` |
| `email_campaign` | `chien_dich_email` | `name`, `segment_id`, `subject`, `subject_b`, `preheader`, `template_id`, `body` JSON, `status` (draft/awaiting_approval/scheduled/sending/sent/cancelled), `scheduled_at`, `resend_after_hours`, `stats` JSON, `approval_id` |
| `email_sequence` | `chuoi_email` | `name`, `kind` (welcome/nurture/post_purchase/winback/custom), `status` (draft/active/paused), `trigger` JSON, `goal` JSON, `product_key` |
| `email_sequence_step` | `email_chuoi` | `sequence_id`, `position`, `delay_minutes`, `subject`, `preheader`, `body` JSON, `no_hard_sell` bool, `channel` (email; sau có thể zalo) |
| `email_enrollment` | `ghi_danh_chuoi` | `sequence_id`, `contact_id`, `cursor`, `next_at`, `status` (active/done/stopped/goal_met), UNIQUE(sequence_id,contact_id) |

**Dùng lại bảng có sẵn, không tạo mới:**
- Opt-out: `contact_optout` với `channel="email"`, `external_id=email_hash`.
- Link click: `track_link`/`track_click` (`tracking.ts` `trackedUrlFor`) thay cho `kho_lien_ket`; ghi thêm ngữ cảnh `email_message_id`.
- Cài đặt gửi (tên/địa chỉ người gửi, domain, hạn mức warmup, `gui_hom_nay`, trạng thái `active/throttled/stopped`): đặt trong `connection.config` của kết nối email, thay cho bảng `cai_dat_email`.
- Webhook thô: `raw_event` (dedupe theo svix id).
- Sự kiện: `emit(bizId, "email.*", …)` + `audit()` thay cho `su_kien`.

## 3. Bản đồ chuyển code

| auto-funnel | Đích trong Agentic AI | Cách làm |
|---|---|---|
| `core/email.ts` (`renderEmail`, `nutCta`, `vanBanSangHtml`) | `packages/email/src/render.ts` | Chép, đổi tên sang tiếng Anh, giữ comment tiếng Việt |
| `core/email-khoi.ts` (biến, footer bắt buộc, bọc link) | `packages/email/src/blocks.ts` | Chép |
| `renderCaNhan`, `soatBien`, `kiemCtaBan` | `packages/email/src/personalize.ts` | Chép + test |
| `core/dns-email.ts`, `core/ket-noi-email.ts` | `packages/email/src/dns.ts`, `domain-setup.ts` | Chép phần thuần |
| `core/chu-ky-webhook.ts` `kiemSvix` | `packages/connectors/src/email/svix.ts` | Chép |
| `taoTokenHuy`/`docTokenHuy`, `headerHuyDangKy` | `packages/email/src/unsubscribe.ts` | Chép; khoá HMAC lấy từ `TOKEN_ENCRYPTION_KEY` (dẫn xuất riêng) |
| `services/gui-tin.ts` `guiEmailNgay` | `orchestrator/src/email/send.ts` `sendEmail` | **Viết lại** trên SQLite, giữ đúng thứ tự kiểm tra |
| `services/ket-noi-email.ts` | `orchestrator/src/connections.ts` `discover()` case `email` | Viết lại, lưu secret vào connection |
| `services/email-chien-dich.ts` | `orchestrator/src/email/campaigns.ts` | Viết lại trên `enqueue` |
| `services/chuoi.ts` (ghi danh, quét gửi, ưu tiên bán/nuôi) | `orchestrator/src/email/sequences.ts` | Viết lại |
| `quetUyTin`, kill-switch trong webhook | `orchestrator/src/email/reputation.ts` | Viết lại |
| `core/phan-khuc.khopKhach` | `orchestrator/src/email/segments.ts` | Viết lại theo cột của `email_contact` |
| `sinhEmailTiep`, `cham-chuoi.ts` (AI soạn + chấm) | `orchestrator/src/email/ai.ts` qua `llm-gateway generate` + `activeDna` | Viết lại; prompt lấy DNA của Agentic AI |
| Editor khối maily.to / kéo thả | `apps/web` | Giai đoạn 5, tuỳ chọn |
| `luong_tu_dong` (workflow canvas) | **Không chuyển** ở plan này | Dùng chuỗi + rule; xem xét sau |

> Gợi ý: tạo package mới `packages/email` (`@dotaka/email`) chỉ chứa code thuần, không I/O, để test dễ như `core/` bên auto-funnel.

## 4. Kết nối với các phần khác

| Phần có sẵn | Email nối vào thế nào |
|---|---|
| **Connectors / Integrations** | Thêm `"email"` vào `PlatformKey`; mục `resend` trong `catalog.ts` (category `messaging`, fields: API key (secret), tên người gửi, địa chỉ gửi, domain, Cloudflare token (secret, tuỳ chọn), hạn mức/ngày). Trang Connections tự hiện form. `live.emailConnector(creds)` + `emailTest`. Đăng ký proxy kiểu `registerZaloProxy()` → `registerEmailProxy()` |
| **chat-engine** | Thêm `"email"` vào `IncomingMessage.channel` và `CHANNEL_PLATFORM`. `sendBotMessage`/`replyAsHuman` trên hội thoại email gọi `sendEmail(source_kind="reply")`, giữ `In-Reply-To`/`References` trong `conversation.ext`. `replyWindow` không giới hạn với email. Thêm `extractEmail(text)` (giống `extractVnPhone`): khách để lại email trong chat → tạo `email_contact` (consent `unknown`, chỉ gửi giao dịch cho đến khi có opt-in) |
| **Opt-out** | `identitiesOf()` thêm `email_hash`. Khách nói "ngừng gửi" ở bất kỳ kênh nào → `recordConversationOptOut` ghi luôn email. Bấm hủy trong email → ghi `contact_optout` + dừng mọi `email_enrollment` + dừng nurture/follow-up của hội thoại liên quan |
| **Nurture** (`nurture.ts`) | Thêm bước tuỳ chọn "xin email" song song với xin SĐT; có email → ghi danh chuỗi `nurture`. Thêm vào `NURTURE_DEFAULTS` (mặc định tắt) và stage trên trang Nurture |
| **Follow-up** | `runFollowUps` hỗ trợ hội thoại `email` (tôn trọng quiet hours); bước follow-up có thể chọn kênh email khi khách có email mà không còn trong cửa sổ 24h Messenger |
| **Approvals** | `subject_type` mới: `email_campaign` (duyệt trước khi gửi hàng loạt), `email_sequence_activate`, `email_send` (thư lẻ do agent soạn). `decideApproval` thêm case. Trang Approvals thêm preview HTML (iframe sandbox) |
| **Orders** | Đơn mới có email → `email_contact` + gửi thư giao dịch (xác nhận đơn, bỏ qua opt-out marketing trừ khi khách hủy "tất cả") + ghi danh chuỗi `post_purchase`. Doanh thu đơn gán ngược về `email_message` qua UTM/track link |
| **Attribution / tracking** | Mọi link trong email đi qua `trackedUrlFor` với `appendUtm({channel:"email", campaign, content})`. Khách vào chat từ link email → `attribution_link(source="email")` |
| **Goals / Agents / Skills** | Agent content soạn email (Channel `"email"` đã có). Agent `follow_up` được thêm tool `email.send` (luôn qua approval). Thêm skill `assets/claude/skills/email-copywriting` và `email-deliverability`, gắn vào agent qua `TEAM`/`LLM_AGENTS` |
| **Assistant / assign** | `ASSIGNABLE` + tool `email.draft`, `email.campaign_create` |
| **MCP server** | Scope `email` trong `MCP_SCOPES`; tool `email_stats`, `email_campaigns_list`, `email_contacts_search`; tool ghi (`email_campaign_schedule`) cần `confirm=true` |
| **bizSettings** | `killSwitch.email`; `caps.emailPerDay`; quiet hours dùng chung 22:00–07:00 cho thư marketing (thư giao dịch được gửi ngay) |
| **Scheduler** (`SCHEDULES`) | `email.sequence_tick` (1 phút, `chat`), `email.campaign_tick` (1 phút), `email.reputation` (60 phút), `email.inbound_sync` (2 phút, chỉ khi bật IMAP) |
| **dev.mjs / bootstrap** | Không cần service riêng. `pnpm bootstrap` thêm `PUBLIC_BASE_URL` (để link hủy/click/webhook đúng) |

## 5. Đường đi công khai (webhook, hủy, click)

Agentic AI khóa API vào localhost (`local-guard`). Email cần 3 đường mà Internet gọi tới, đặt trên **public gateway** (`apps/api/src/public-gateway.ts`, `routes/public.ts`):
- `POST /hooks/email/resend`: xác thực svix → `raw_event` (dedupe) → cập nhật `email_message.status` → bounce/complaint vào `email_suppression` → kiểm kill-switch (≥50 thư/ngày: bounce >3% hoặc complaint >0,1% → `stopped`).
- `GET|POST /u/:token`: trang hủy + one-click RFC 8058.
- Link click dùng lại `/r/<code>` có sẵn.

Không có URL công khai (chạy local thuần) → gửi được nhưng không theo dõi được trạng thái; UI phải báo rõ điều này, không được giả "đã mở".

## 6. Nhận email (inbound) — phần auto-funnel không có

Làm ở giai đoạn 4, chọn một:
- **A. Resend Inbound** (webhook `email.received`): dùng chung public gateway, đơn giản nhất nếu domain đã ở Resend.
- **B. IMAP polling** (Gmail app password / hộp thư doanh nghiệp): chạy được không cần URL công khai; theo mô hình `messenger-sync.ts`.

Cả hai đều đổ vào `handleIncoming({channel:"email", externalConversationId: <thread id từ References>, …, noReply: !emailBotEnabled})`. Bot trả lời email mặc định **tắt** (chỉ gợi ý, người bấm gửi).

## 7. Giao diện (`apps/web`)

Thêm mục **Email** trong sidebar (cạnh "Follow-up Zalo"), trang `pages/Email/*`:
1. **Tổng quan & Cài đặt:** trạng thái kết nối, domain/DNS (SPF/DKIM/DMARC), hạn mức warmup, trạng thái uy tín, nút "Mở lại gửi".
2. **Liên hệ & Phân khúc:** danh sách `email_contact`, nhập CSV (bắt buộc chọn nguồn consent), phân khúc.
3. **Chiến dịch:** soạn → gửi thử → gửi duyệt → hẹn giờ; A/B tiêu đề; gửi lại cho người chưa mở.
4. **Chuỗi:** timeline các bước, AI soạn bước tiếp theo, chấm điểm trước khi kích hoạt.
5. **Mẫu:** chế độ văn bản trước; khối/kéo thả ở giai đoạn 5.
6. **Chất lượng gửi:** tỉ lệ delivered/open/click/bounce/complaint 24h/7 ngày, danh sách loại trừ.

Sửa trang có sẵn: Chat (thêm kênh email, hiện tiêu đề/thread, ô trả lời), Approvals (preview email), Connections (tự có từ catalog), Nurture (bước xin email), Settings (kill switch email).

## 8. Các giai đoạn

Mỗi giai đoạn kết thúc bằng `pnpm verify` xanh và có test mới.

| GĐ | Nội dung | Xong khi |
|---|---|---|
| **1. Nền tảng gửi** | `packages/email` (render, cá nhân hoá, hủy, svix, DNS); bảng §2; catalog + `discover()` + `live.emailConnector`; `sendEmail()` với đủ kiểm tra; trang Email > Cài đặt; nút "Gửi thử" | Kết nối Resend thật, gửi thử tới hộp thư của mình, thấy `email_message` = sent. Không có kết nối → lỗi PolicyRejected rõ ràng |
| **2. Theo dõi & an toàn** | Public routes (webhook, hủy, click); suppression; reputation cron; kill-switch; opt-out đa kênh; `killSwitch.email` | Bounce giả bằng địa chỉ test Resend → vào loại trừ; bấm hủy → không gửi được nữa và dừng chuỗi |
| **3. Liên hệ, chiến dịch, chuỗi** | `email_contact` + nhập CSV + `extractEmail` từ chat/đơn; phân khúc; chiến dịch + approval; chuỗi + enrollment + scheduler; AI soạn qua DNA | Tạo chiến dịch → duyệt → gửi đúng phân khúc, đúng hạn mức; chuỗi welcome tự chạy theo thời gian |
| **4. Email là kênh hội thoại** | Inbound (A hoặc B); hội thoại email trong Chat; trả lời thủ công/bot gợi ý; nurture xin email; follow-up qua email; đơn hàng → chuỗi post-purchase; attribution | Khách trả lời email → hiện trong Chat, Jev phân loại, chốt đơn được như kênh khác |
| **5. Mở rộng** | Editor khối (maily.to) / kéo thả; MCP tools; skills; assistant tools; nút kết nối domain 1 chạm qua Cloudflare | Tuỳ chọn |

## 9. Kiểm thử

- `packages/email/*.test.ts`: chép và chuyển test `core/email-builder.test.ts`, `email-keo-tha`, `ket-noi-email`, `bao-mat-webhook` từ auto-funnel.
- **Bổ sung test mà auto-funnel thiếu:** `sendEmail` (từng lý do skip), route webhook Resend, route hủy.
- `apps/api/src/email-routes.test.ts` + thêm route email vào danh sách bắt buộc của `server-boot.test.ts`.
- Mock `fetch` cho Resend/Cloudflare như `zlcrm.test.ts`.
- Eval: thêm vài case chat có email trong `evals/chat/cases.json`.

## 10. Rủi ro

- **Domain & uy tín:** gửi lạnh số lượng lớn có thể làm hỏng domain chính. Khuyên dùng subdomain (`mail.<domain>`), warmup bắt đầu ~50 thư/ngày.
- **Consent:** danh sách nhập từ ngoài cần nguồn opt-in; nếu không, chỉ gửi thư giao dịch.
- **Không có URL công khai:** mất theo dõi mở/click/bounce, kill-switch không hoạt động. Phải có public gateway trước khi gửi hàng loạt (chặn gửi chiến dịch nếu chưa có).
- **Dữ liệu cá nhân:** email thô không vào prompt/log; chỉ `email_hash` hoặc dạng che `ng***@gmail.com`.

## 11. Đã chốt (2026-10-15)

1. **Nhà cung cấp:** Resend, như auto-funnel.
2. **Domain + URL công khai:** đã có → làm public gateway (§5) ngay ở GĐ 2.
3. **Nhận email:** giống auto-funnel = **không nhận thư trả lời**. Bỏ §6 và phần inbound của GĐ 4. Email là kênh *gửi đi*; tương tác của khách quay về qua click (track link → `attribution_link`), hủy nhận, và sự kiện Resend (mở/bounce/complaint). Không tạo `conversation(channel="email")` từ thư đến; Chat chỉ hiện lịch sử email đã gửi trong hồ sơ khách. Thêm sau nếu cần.
4. **Editor:** giống auto-funnel = đủ **3 chế độ** (văn bản, khối maily.to, kéo thả waypoint) → chuyển editor từ GĐ 5 lên GĐ 3. Phụ thuộc thêm cho `apps/web`: `@maily-to/core`, `@maily-to/render`, `@usewaypoint/email-builder`, `@dnd-kit/*`, `marked` (giữ đúng phiên bản auto-funnel).

**Lộ trình sau khi chốt:** GĐ1 gửi được → GĐ2 public gateway + theo dõi + an toàn → GĐ3 liên hệ, phân khúc, chiến dịch, chuỗi, 3 editor, AI soạn → GĐ4 nối nurture/follow-up/đơn hàng/attribution/agent/approval (không inbound) → GĐ5 MCP, skills, assistant, kết nối domain 1 chạm qua Cloudflare.

## 12. Trạng thái (2026-10-15): ĐÃ LÀM XONG GĐ 1–5

- `packages/email` (@dotaka/email): lõi chép từ auto-funnel + test (`/web` cho trình duyệt).
- `packages/orchestrator/src/email/*`: cổng gửi, liên hệ, phân khúc, chiến dịch, chuỗi, mẫu, domain, sự kiện, hook; test `email-flow.test.ts`.
- API `apps/api/src/routes/email.ts`; cổng công khai `/hooks/email/resend`, `/u/:token`.
- Web: trang `/email` (6 tab), editor khối + kéo thả (`components/email/*`), xem trước ở trang Duyệt, ô Email trên phiếu đơn.
- MCP: `email_stats`, `email_campaigns_list`, `email_sequences_list`, `email_campaign_draft`. Skill `email-marketing` (agent `email`).
- Chưa làm (theo chốt): nhận thư trả lời (auto-funnel không có). Hướng dẫn kết nối: `HUONG-DAN-EMAIL.md`.
