/**
 * Platform catalogue for the Connections hub (UI tiles + "Thêm kết nối" form).
 * `fields` describe the credential form; `secret` fields are encrypted at rest and never returned.
 * Status "live" = real API adapter in live.ts; "soon" = shown as "Sắp ra mắt".
 */
export type FieldDef = {
  key: string; label: string; type: "text" | "password" | "textarea" | "select"; secret?: boolean; required?: boolean;
  placeholder?: string; help?: string; options?: { value: string; label: string }[];
};
export type PlatformDef = {
  key: string; name: string; category: "ads" | "data" | "messaging" | "commerce" | "ai" | "system";
  status: "live" | "soon"; color: string; description: string; capabilities: string[]; fields: FieldDef[]; guide?: string[];
};

export const PLATFORMS: PlatformDef[] = [
  {
    key: "meta", name: "Facebook", category: "ads", status: "live", color: "#1877F2",
    description: "Meta Ads + Fanpage: kéo chỉ số, bật/tắt ads, đổi ngân sách, tạo ads từ bài viết.",
    capabilities: ["Tài khoản quảng cáo", "Fanpage", "Insight", "Bật/tắt ads", "Ngân sách", "Tạo ads từ bài"],
    fields: [
      { key: "access_token", label: "Access token", type: "password", secret: true, required: true, placeholder: "EAAG...", help: "Nên dùng token System User (Business Manager) để không hết hạn." },
      { key: "result_action", label: "Tính 'kết quả' theo", type: "select", options: [
        { value: "auto", label: "Tự động theo mục tiêu của từng chiến dịch (khuyên dùng)" },
        { value: "messaging", label: "Tin nhắn bắt đầu (Messenger)" }, { value: "lead", label: "Khách hàng tiềm năng (Lead form)" },
        { value: "purchase", label: "Mua hàng (Pixel)" }, { value: "link_click", label: "Lượt click liên kết" },
      ] },
    ],
    guide: [
      "Vào business.facebook.com → Cài đặt doanh nghiệp → Người dùng hệ thống → Thêm (vai trò Quản trị viên).",
      "Gán tài sản: các Tài khoản quảng cáo + Trang (quyền toàn quyền).",
      "Bấm 'Tạo mã' → chọn app → tick ads_management, ads_read, business_management, pages_show_list, pages_read_engagement, pages_manage_ads, pages_manage_posts (đăng bài), pages_manage_engagement (trả lời bình luận), pages_messaging (Messenger), instagram_basic + instagram_content_publish (đăng Instagram, Trang phải gắn tài khoản Instagram Business) → hết hạn: Không bao giờ.",
      "Dán token vào đây. Hệ thống tự tìm tài khoản quảng cáo và Fanpage.",
    ],
  },
  {
    key: "tiktok", name: "TikTok", category: "ads", status: "live", color: "#111111",
    description: "TikTok Ads (Business API): kéo chỉ số, bật/tắt ads, đổi ngân sách nhóm quảng cáo.",
    capabilities: ["Advertiser", "Insight", "Bật/tắt ads", "Ngân sách"],
    fields: [
      { key: "access_token", label: "Access token (Business API)", type: "password", secret: true, required: true },
      { key: "advertiser_ids", label: "Advertiser ID", type: "text", required: true, placeholder: "7123456789012345678, 7234...", help: "Nhiều tài khoản cách nhau dấu phẩy." },
    ],
    guide: [
      "Tạo app tại business-api.tiktok.com (Developer) với quyền Ads Management + Reporting.",
      "Uỷ quyền app cho tài khoản quảng cáo → nhận long-term Access token.",
      "Lấy Advertiser ID trong TikTok Ads Manager (góc trên bên phải).",
    ],
  },
  {
    key: "tiktok_post", name: "TikTok (đăng video)", category: "messaging", status: "live", color: "#111111",
    description: "Đăng video lên kênh TikTok hoặc gửi bản nháp vào hộp thư TikTok (Content Posting API). Nên kết nối bằng nút đăng nhập ở trang Kênh đăng.",
    capabilities: ["Gửi bản nháp", "Đăng video", "Số liệu video"],
    fields: [
      { key: "access_token", label: "User access token", type: "password", secret: true, required: true, help: "Token OAuth của tài khoản TikTok với scope user.info.basic, video.upload, video.publish, video.list. Dùng nút đăng nhập ở trang Kênh đăng thì hệ thống tự gia hạn." },
    ],
    guide: [
      "Tạo app tại developers.tiktok.com → thêm sản phẩm Login Kit + Content Posting API.",
      "Xin scope: user.info.basic, video.upload (bản nháp), video.publish + video.list (đăng công khai, cần TikTok duyệt app).",
      "App CHƯA được TikTok duyệt: chỉ gửi được bản nháp vào hộp thư TikTok; đăng công khai dùng 'Đăng qua Chrome'. Khi app đã duyệt, bật 'App đã được TikTok duyệt' ở thẻ kênh.",
    ],
  },
  {
    key: "google_ads", name: "Google Ads", category: "ads", status: "live", color: "#FBBC04",
    description: "Google Ads API (theo ads-os): kéo chỉ số chiến dịch, bật/tắt chiến dịch, đổi ngân sách ngày. Kết nối bằng service account — không cần đăng nhập Google.",
    capabilities: ["Tài khoản + MCC", "Chỉ số chiến dịch", "Bật/tắt chiến dịch", "Ngân sách"],
    fields: [
      { key: "service_account_json", label: "Khoá service account (JSON)", type: "textarea", secret: true, required: true, placeholder: "{ \"type\": \"service_account\", \"client_email\": \"...@....iam.gserviceaccount.com\", ... }", help: "Dán nguyên nội dung file .json. Không dán file OAuth client (client_secret…json)." },
      { key: "customer_ids", label: "Chỉ dùng các Customer ID (tuỳ chọn)", type: "text", placeholder: "123-456-7890, 987-654-3210", help: "Để trống = mọi tài khoản service account được thêm vào (kể cả tài khoản con dưới MCC)." },
      { key: "developer_token", label: "Developer token (tuỳ chọn)", type: "password", secret: true, help: "Google đã bỏ bắt buộc từ 9/2026 — chỉ điền nếu project còn dùng." },
    ],
    guide: [
      "console.cloud.google.com → tạo / chọn project → APIs & Services → Library → Google Ads API → Enable.",
      "Trang Tổng quan Google Ads API của project: đăng ký cấp truy cập Explorer hoặc Basic (project mới chỉ có Test — chỉ gọi được tài khoản thử nghiệm).",
      "IAM & Admin → Service Accounts → Create → Keys → Add key → JSON → tải file khoá.",
      "Google Ads → Quản trị → Quyền truy cập và bảo mật → thêm email service account (…@….iam.gserviceaccount.com) quyền Chuẩn trở lên. Thêm vào MCC thì thấy luôn các tài khoản con.",
      "Dán nội dung file khoá vào đây. Hệ thống tự tìm tài khoản quảng cáo (kể cả dưới MCC) và báo rõ lý do nếu chưa dùng được.",
    ],
  },
  {
    key: "sheets", name: "Google Sheets", category: "data", status: "live", color: "#0F9D58",
    description: "Ghi chỉ số quảng cáo vào Google Sheets theo lịch (cấu hình 'Kéo chỉ số').",
    capabilities: ["Ghi đè / nối dòng", "Tự tạo tab"],
    fields: [
      { key: "service_account_json", label: "Service account JSON", type: "textarea", secret: true, required: true, placeholder: "{ \"type\": \"service_account\", ... }" },
      { key: "default_spreadsheet", label: "Link Google Sheet mặc định (tuỳ chọn)", type: "text", placeholder: "https://docs.google.com/spreadsheets/d/..." },
    ],
    guide: [
      "console.cloud.google.com → tạo project → bật Google Sheets API.",
      "IAM → Service accounts → tạo → Keys → Add key (JSON) → tải file JSON, dán toàn bộ nội dung vào đây.",
      "Mở Google Sheet cần ghi → Chia sẻ cho email service account (quyền Người chỉnh sửa).",
    ],
  },
  {
    key: "telegram", name: "Telegram", category: "messaging", status: "live", color: "#229ED9",
    description: "Bot gửi cảnh báo tắt ads, đổi ngân sách, báo cáo sáng — và nhắn trực tiếp với trợ lý Ngân Nguyệt (Cài đặt → Ngân Nguyệt trên Telegram).",
    capabilities: ["Cảnh báo", "Báo cáo", "Chat với Ngân Nguyệt"],
    fields: [
      { key: "bot_token", label: "Bot token", type: "password", secret: true, required: true, placeholder: "123456:ABC-DEF...", help: "Tạo bot với @BotFather → /newbot (hoặc dùng bot có sẵn: @BotFather → /mybots → API Token)." },
      { key: "chat_id", label: "Chat ID nhận thông báo (tuỳ chọn)", type: "text", placeholder: "-100123... hoặc 123456789", help: "Để trống: khi Sếp ghép nối Ngân Nguyệt trên Telegram, chat đó tự nhận cảnh báo. Nhóm: thêm bot vào nhóm rồi lấy chat id qua @RawDataBot." },
    ],
  },
  {
    key: "wordpress", name: "Website (WordPress)", category: "messaging", status: "live", color: "#21759B",
    description: "Đăng bài SEO lên website WordPress: tiêu đề, nội dung, ảnh trong bài (có alt), ảnh đại diện, mô tả ngắn, đường dẫn theo từ khoá.",
    capabilities: ["Đăng bài SEO", "Tải ảnh + alt", "Ảnh đại diện", "Bản nháp / công khai"],
    fields: [
      { key: "site_url", label: "Địa chỉ website", type: "text", required: true, placeholder: "https://taki.vn", help: "Trang chủ website WordPress, dùng https://." },
      { key: "username", label: "Tên đăng nhập WordPress", type: "text", required: true, placeholder: "admin", help: "Tài khoản có vai trò Tác giả / Biên tập viên / Quản trị (được đăng bài + tải ảnh)." },
      { key: "app_password", label: "Mật khẩu ứng dụng (Application Password)", type: "password", secret: true, required: true, placeholder: "abcd EFGH 1234 ijkl MNOP 5678", help: "KHÔNG phải mật khẩu đăng nhập. Tạo ở WordPress → Thành viên → Hồ sơ → Mật khẩu ứng dụng." },
      { key: "post_status", label: "Đăng bài ở trạng thái", type: "select", options: [
        { value: "publish", label: "Công khai ngay (bài đã qua hộp Duyệt)" }, { value: "draft", label: "Bản nháp — tự xuất bản trên WordPress" }, { value: "pending", label: "Chờ duyệt trên WordPress" },
      ] },
      { key: "category_id", label: "ID chuyên mục (tuỳ chọn)", type: "text", placeholder: "12", help: "WordPress → Bài viết → Chuyên mục → di chuột lên chuyên mục, số sau tag_ID=. Trống = chuyên mục mặc định." },
    ],
    guide: [
      "Đăng nhập WordPress bằng tài khoản sẽ đứng tên bài viết (vai trò Tác giả trở lên).",
      "Vào Thành viên → Hồ sơ (Users → Profile), kéo xuống mục \"Mật khẩu ứng dụng\" (Application Passwords).",
      "Đặt tên \"TAKI Agentic AI\" → Thêm mật khẩu ứng dụng mới → chép dãy 24 ký tự vừa hiện (chỉ hiện 1 lần).",
      "Dán địa chỉ website, tên đăng nhập và mật khẩu ứng dụng vào đây → Kết nối. Hệ thống tự kiểm tra quyền đăng bài + tải ảnh và tạo kênh \"website\".",
      "Không thấy mục Mật khẩu ứng dụng: website chưa có https, hoặc plugin bảo mật (Wordfence, iThemes…) đang tắt tính năng này / chặn REST API — bật lại trong plugin.",
    ],
  },
  {
    key: "zlcrm", name: "ZL-CRM (Zalo)", category: "messaging", status: "live", color: "#0068FF",
    description: "Nhiều nick Zalo cá nhân qua ZL-CRM: đọc hội thoại, chấm lead bằng Jev, follow-up khách im lặng.",
    capabilities: ["Hội thoại Zalo", "Follow-up", "Gửi tin qua nick"],
    fields: [
      { key: "base_url", label: "Địa chỉ ZL-CRM", type: "text", required: true, placeholder: "https://crm.taki.vn hoặc http://localhost:3000", help: "URL mở giao diện ZL-CRM (không kèm /api)." },
      { key: "api_key", label: "Public API key", type: "password", secret: true, required: true, help: "ZL-CRM → Cài đặt → API & Webhook → Tạo API key." },
      { key: "web_url", label: "Địa chỉ giao diện ZL-CRM (tuỳ chọn)", type: "text", placeholder: "http://localhost:5174", help: "Để hiện nút “Mở ZL-CRM” (quét QR nick Zalo, chat)." },
    ],
    guide: [
      "Mở ZL-CRM bằng tài khoản Owner/Admin → Cài đặt → API & Webhook → bấm 'Tạo API key'.",
      "Dán địa chỉ ZL-CRM và API key vào đây. Hệ thống gọi thử /api/public/zalo-accounts để xác thực.",
      "Chỉ tin nhắn mới SAU thời điểm kết nối mới được xử lý — lịch sử cũ không bị gửi follow-up.",
      "Để follow-up đúng nick khi dùng nhiều nick: cập nhật ZL-CRM bản có zaloAccountId trong /api/public/conversations.",
    ],
  },
  {
    key: "resend", name: "Email (Resend)", category: "messaging", status: "live", color: "#0F172A",
    description: "Gửi email thật qua Resend: chiến dịch, chuỗi tự động, thư giao dịch. Theo dõi giao/mở/click, tự loại bounce & khiếu nại, link hủy nhận một chạm.",
    capabilities: ["Gửi email", "Chiến dịch", "Chuỗi tự động", "Theo dõi mở/click", "Hủy nhận một chạm", "Tự bảo vệ uy tín"],
    fields: [
      { key: "api_key", label: "API key Resend", type: "password", secret: true, required: true, placeholder: "re_...", help: "Resend → API Keys → Create API Key → quyền Full access (để hệ thống tự thêm domain và webhook)." },
      { key: "from_name", label: "Tên người gửi", type: "text", required: true, placeholder: "TAKI Academy", help: "Hiện ở hộp thư khách, và trong footer định danh người gửi." },
      { key: "from_address", label: "Địa chỉ gửi", type: "text", required: true, placeholder: "hello@mail.taki.vn", help: "Phải thuộc domain đã thêm (và xác minh) trên Resend. Nên dùng subdomain riêng cho email, vd. mail.taki.vn." },
      { key: "reply_to", label: "Địa chỉ nhận trả lời (tuỳ chọn)", type: "text", placeholder: "cskh@taki.vn", help: "Khách bấm Trả lời sẽ gửi về đây (hộp thư của bạn)." },
      { key: "daily_limit", label: "Hạn mức gửi/ngày (warm-up)", type: "text", placeholder: "50", help: "Domain mới: bắt đầu 50/ngày, tăng dần ×2 mỗi tuần khi tỉ lệ bounce < 2%. Đổi được ở trang Email." },
      { key: "webhook_secret", label: "Webhook signing secret (tuỳ chọn)", type: "password", secret: true, placeholder: "whsec_...", help: "Để trống: bấm «Thiết lập tự động» ở trang Email, hệ thống tự tạo webhook và lưu khoá. Tạo tay: Resend → Webhooks → endpoint <PUBLIC_BASE_URL>/hooks/email/resend." },
      { key: "cloudflare_token", label: "Cloudflare API token (tuỳ chọn)", type: "password", secret: true, help: "Chỉ cần nếu muốn hệ thống tự thêm bản ghi DNS (SPF/DKIM/DMARC) lên Cloudflare. Mẫu token «Edit zone DNS», chọn đúng zone." },
    ],
    guide: [
      "Tạo tài khoản resend.com → Domains → Add Domain → nhập subdomain gửi (vd. mail.taki.vn). Hoặc để trống bước này và dùng nút «Thiết lập tự động» (cần Cloudflare token).",
      "Thêm các bản ghi DNS Resend yêu cầu (MX + TXT SPF ở send.<domain>, TXT DKIM resend._domainkey) và một bản ghi DMARC → bấm Verify trên Resend.",
      "API Keys → Create API Key → Full access → dán vào đây cùng tên và địa chỉ gửi.",
      "Bật cổng công khai (PUBLIC_PORT + PUBLIC_BASE_URL https) để nhận sự kiện giao/mở/bounce và cho link hủy nhận/click chạy từ hộp thư khách.",
      "Vào trang Email → Gửi thử tới hộp thư của bạn trước khi gửi khách.",
    ],
  },
  {
    key: "ai", name: "AI", category: "ai", status: "live", color: "#7C3AED",
    description: "Claude CLI, tài khoản ChatGPT qua Codex CLI và Jev System One — chọn hồ sơ tại Kết nối AI.", capabilities: ["Claude CLI", "ChatGPT / Codex CLI", "Nhiều hồ sơ ChatGPT", "Jev"], fields: [],
  },
  {
    key: "pancake", name: "Pancake", category: "commerce", status: "live", color: "#1DA1F2",
    description: "Pancake POS: đơn hàng, khách hàng để đo doanh thu từ ads.",
    capabilities: ["Đơn hàng", "Shop"],
    fields: [{ key: "api_key", label: "API key Pancake POS", type: "password", secret: true, required: true, help: "POS → Cấu hình → Ứng dụng → API KEY." }],
  },
  {
    key: "nhanh", name: "Nhanh.vn", category: "commerce", status: "live", color: "#E11D48",
    description: "Nhanh.vn: đơn hàng & sản phẩm (API v2, bản beta).",
    capabilities: ["Đơn hàng", "Sản phẩm"],
    fields: [
      { key: "app_id", label: "App ID", type: "text", required: true },
      { key: "business_id", label: "Business ID", type: "text", required: true },
      { key: "access_token", label: "Access token", type: "password", secret: true, required: true },
    ],
    guide: ["Đăng ký app tại open.nhanh.vn → uỷ quyền cho doanh nghiệp → nhận accessToken + businessId."],
  },
  {
    key: "whitelist", name: "Whitelist", category: "system", status: "live", color: "#F59E0B",
    description: "Chỉ những tài khoản quảng cáo / Fanpage trong whitelist mới được tự động hoá tác động.", capabilities: [], fields: [],
  },
  // ---- Sắp ra mắt ----
  ...([
    ["bigquery", "BigQuery", "#4285F4"], ["postgres", "PostgreSQL", "#336791"], ["ga4", "GA4", "#F9AB00"],
    ["sapo", "Sapo", "#16A34A"], ["haravan", "Haravan", "#1E40AF"], ["kiotviet", "KiotViet", "#0EA5E9"], ["bitrix24", "Bitrix24", "#2FC6F6"], ["zalo", "Zalo OA (chính thức)", "#0068FF"],
  ] as const).map(([key, name, color]) => ({ key, name, color, category: "data" as const, status: "soon" as const, description: "Sắp ra mắt", capabilities: [], fields: [] })),
];

export const platformDef = (key: string) => PLATFORMS.find((p) => p.key === key);

/** MCP key permission matrix (Quản lý MCP Server). `sensitive` = can change data → shield icon + confirm. */
export const MCP_SCOPES: { platform: string; name: string; desc: string; perms: { key: string; label: string; title: string; sensitive?: boolean }[] }[] = [
  { platform: "meta", name: "Meta Ads", desc: "Quản lý chiến dịch, nhóm quảng cáo, quảng cáo và xem báo cáo.", perms: [
    { key: "read", title: "Đọc dữ liệu", label: "Xem" }, { key: "write", title: "Chỉnh sửa", label: "Sửa", sensitive: true }, { key: "create", title: "Tạo mới", label: "Tạo", sensitive: true },
    { key: "insights", title: "Đọc chỉ số", label: "Xem Insight" }, { key: "pages", title: "Xem trang", label: "Xem Page" }] },
  { platform: "pancake", name: "Pancake POS", desc: "Quản lý sản phẩm, đơn hàng và dữ liệu bán hàng.", perms: [
    { key: "read", title: "Đọc dữ liệu", label: "Xem" }, { key: "write", title: "Chỉnh sửa", label: "Sửa", sensitive: true }] },
  { platform: "nhanh", name: "Nhanh.vn", desc: "Quản lý sản phẩm, tồn kho và đơn hàng.", perms: [
    { key: "read", title: "Đọc dữ liệu", label: "Xem" }, { key: "write", title: "Chỉnh sửa", label: "Sửa", sensitive: true }, { key: "create", title: "Tạo mới", label: "Tạo", sensitive: true }] },
  { platform: "tiktok", name: "TikTok Ads", desc: "Quản lý chiến dịch, nhóm quảng cáo, quảng cáo.", perms: [
    { key: "read", title: "Đọc dữ liệu", label: "Xem" }, { key: "write", title: "Chỉnh sửa", label: "Sửa", sensitive: true }] },
  { platform: "email", name: "Email", desc: "Liên hệ, chiến dịch, chuỗi email và số liệu gửi.", perms: [
    { key: "read", title: "Đọc dữ liệu", label: "Xem" }, { key: "write", title: "Tạo chiến dịch / gửi duyệt", label: "Sửa", sensitive: true }] },
  { platform: "agentic", name: "Agentic AI", desc: "Bài viết, hội thoại, mục chờ duyệt và luồng/rule của hệ thống.", perms: [
    { key: "read", title: "Đọc dữ liệu", label: "Xem" }, { key: "rules", title: "Chạy thử luồng", label: "Chạy thử" }] },
];
export type McpPermissions = { all?: boolean; scopes: Record<string, string[]>; write?: boolean };
export function mcpAllows(p: McpPermissions | null | undefined, platform: string, perm: string) {
  if (!p) return false;
  if (p.all) return true;
  return (p.scopes?.[platform] ?? []).includes(perm);
}
