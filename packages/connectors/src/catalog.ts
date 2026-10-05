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
      "Bấm 'Tạo mã' → chọn app → tick ads_management, ads_read, business_management, pages_show_list, pages_read_engagement, pages_manage_ads, pages_manage_posts (đăng bài), pages_manage_engagement (trả lời bình luận), pages_messaging (Messenger) → hết hạn: Không bao giờ.",
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
    description: "Bot gửi cảnh báo tắt ads, đổi ngân sách, báo cáo sáng.",
    capabilities: ["Cảnh báo", "Báo cáo"],
    fields: [
      { key: "bot_token", label: "Bot token", type: "password", secret: true, required: true, placeholder: "123456:ABC-DEF...", help: "Tạo bot với @BotFather → /newbot." },
      { key: "chat_id", label: "Chat ID nhận thông báo", type: "text", required: true, placeholder: "-100123... hoặc 123456789", help: "Thêm bot vào nhóm, gửi 1 tin, rồi lấy chat id qua @RawDataBot hoặc getUpdates." },
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
    key: "ai", name: "AI", category: "ai", status: "live", color: "#7C3AED",
    description: "Claude (qua tài khoản CLI) + Jev System One — cấu hình trong Cài đặt.", capabilities: ["Claude CLI", "Jev"], fields: [],
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
    ["bigquery", "BigQuery", "#4285F4"], ["postgres", "PostgreSQL", "#336791"], ["google_ads", "Google Ads", "#FBBC04"], ["ga4", "GA4", "#F9AB00"],
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
  { platform: "agentic", name: "Agentic AI", desc: "Bài viết, hội thoại, mục chờ duyệt và luồng/rule của hệ thống.", perms: [
    { key: "read", title: "Đọc dữ liệu", label: "Xem" }, { key: "rules", title: "Chạy thử luồng", label: "Chạy thử" }] },
];
export type McpPermissions = { all?: boolean; scopes: Record<string, string[]>; write?: boolean };
export function mcpAllows(p: McpPermissions | null | undefined, platform: string, perm: string) {
  if (!p) return false;
  if (p.all) return true;
  return (p.scopes?.[platform] ?? []).includes(perm);
}
