#!/usr/bin/env node
// Ngân Nguyệt's tool server (MCP over stdio), started by `claude -p` for each chat turn.
// Every tool calls the TAKI Agentic AI API on this machine, signed "Ngân Nguyệt" (audit log).
// Reads and starting work that still passes review/approval run immediately; anything that changes the outside
// world goes through /v1/assistant/actions → a confirm card the CEO clicks (or runs at once if the CEO enabled it).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API = process.env.TAKI_API ?? "http://127.0.0.1:8787";
const THREAD = process.env.TAKI_THREAD ?? null;
const ACTOR = process.env.TAKI_ACTOR ?? "Ngân Nguyệt (trợ lý)";
const MAX = 14_000;

async function call(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "x-taki-actor": encodeURIComponent(ACTOR), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message ?? `HTTP ${r.status}`);
  return data;
}
const get = (path) => call("GET", path);
const text = (data) => {
  const s = typeof data === "string" ? data : JSON.stringify(data);
  return { content: [{ type: "text", text: s.length > MAX ? `${s.slice(0, MAX)}… (cắt bớt, ${s.length} ký tự — lọc hẹp hơn nếu cần)` : s }] };
};
const fail = (e) => ({ content: [{ type: "text", text: `LỖI: ${e instanceof Error ? e.message : e}` }], isError: true });
const pick = (rows, keys, n = 40) => (Array.isArray(rows) ? rows.slice(0, n).map((r) => Object.fromEntries(keys.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]))) : rows);
/** Sensitive change → confirm card (or immediate when the CEO enabled auto mode — decided by the API). */
const confirm = async (title, summary, method, path, body) => {
  const a = await call("POST", "/v1/assistant/actions", { threadId: THREAD, title, summary, request: { method, path, body } });
  return a.status === "pending"
    ? `Đã tạo THẺ XÁC NHẬN "${title}" (mã ${a.id}) trong khung chat. Việc CHƯA được thực hiện — chờ Sếp bấm Xác nhận.`
    : `Đã thực hiện ngay (Sếp bật chế độ tự thực hiện): ${a.status}. Kết quả: ${JSON.stringify(a.result).slice(0, 1500)}`;
};
const dispatched = (kind, refType, refId, title) => call("POST", "/v1/assistant/dispatches", { threadId: THREAD, kind, refType, refId, title }).catch(() => null);

const server = new McpServer({ name: "taki", version: "1.0.0" });
const tool = (name, description, shape, fn) =>
  server.registerTool(name, { description, inputSchema: shape }, async (args) => { try { return text(await fn(args ?? {})); } catch (e) { return fail(e); } });

// ---------------- Đọc / báo cáo ----------------
tool("tong_quan", "Tổng quan hệ thống ngay lúc này: chỉ số chính, mục chờ duyệt, kill switch, các vấn đề cần chú ý (Phát hiện). Dùng đầu tiên khi Sếp hỏi 'hôm nay thế nào', 'có gì cần để ý'.", {}, async () => {
  const [overview, approvals, system, findings] = await Promise.all([get("/v1/overview"), get("/v1/approvals/stats"), get("/v1/system"), get("/v1/assistant/findings")]);
  return { overview, approvals, killSwitch: system.killSwitch ?? system.settings?.killSwitch, llm: system.llm, findings };
});
tool("ds_agent", "Danh sách các agent: bật/tắt, mức tự chủ, model, số tác vụ, token hôm nay.", {}, async () =>
  (await get("/v1/agents")).map((a) => ({ key: a.key, label: a.label, enabled: !!a.config?.enabled, autonomy: a.config?.autonomy ?? a.autonomy, model: a.model, tasks: a.tasks, done: a.done, avgReview: a.avgReview, tokensToday: a.tokensToday })));
tool("ds_tac_vu", "Danh sách tác vụ của các agent (mới nhất trước). Lọc theo trạng thái (ready, running, in_review, revising, awaiting_approval, done, failed, blocked, cancelled) và/hoặc agent.", {
  trang_thai: z.string().optional(), agent: z.string().optional(), so_luong: z.number().int().min(1).max(100).optional(),
}, async ({ trang_thai, agent, so_luong }) => {
  const rows = await get(`/v1/tasks${trang_thai ? `?status=${encodeURIComponent(trang_thai)}` : ""}`);
  return pick(rows.filter((t) => !agent || t.agent_key === agent), ["id", "agent_key", "title", "status", "step", "progress", "error", "goal_id", "updated_at"], so_luong ?? 30);
});
tool("chi_tiet_tac_vu", "Chi tiết 1 tác vụ: đầu vào, đầu ra, lỗi, các lần chạy, review.", { id: z.string() }, async ({ id }) => get(`/v1/tasks/${encodeURIComponent(id)}`));
tool("ds_cho_duyet", "Các mục đang chờ duyệt (hoặc theo trạng thái khác): bài, video, quảng cáo, follow-up, đề xuất.", { trang_thai: z.enum(["pending", "approved", "rejected", "expired"]).optional() }, async ({ trang_thai }) =>
  pick(await get(`/v1/approvals?status=${trang_thai ?? "pending"}`), ["id", "title", "subject_type", "agent_key", "risk", "status", "created_at", "expires_at"], 40));
tool("chi_tiet_duyet", "Chi tiết 1 mục duyệt (nội dung, điểm review, lịch sử).", { id: z.string() }, async ({ id }) => get(`/v1/approvals/${encodeURIComponent(id)}`));
tool("ds_noi_dung", "Danh sách nội dung (bài, kịch bản, video) theo trạng thái.", { trang_thai: z.string().optional() }, async ({ trang_thai }) =>
  pick(await get(`/v1/content${trang_thai ? `?status=${encodeURIComponent(trang_thai)}` : ""}`), ["id", "title", "kind", "channel", "status", "agent_key", "created_at"], 40));
tool("chi_tiet_noi_dung", "Toàn văn + review của 1 nội dung.", { id: z.string() }, async ({ id }) => get(`/v1/content/${encodeURIComponent(id)}`));
tool("quang_cao", "Dữ liệu quảng cáo: tong_hop (tóm tắt agent ads), ads (danh sách quảng cáo + chỉ số), chi_so (chỉ số theo ngày), de_xuat (bài đề xuất chạy ads), thao_tac (thay đổi ads đã/đang đề xuất), bao_cao_moi (báo cáo ads gần nhất).", {
  xem: z.enum(["tong_hop", "ads", "chi_so", "de_xuat", "thao_tac", "bao_cao_moi"]),
}, async ({ xem }) => get({ tong_hop: "/v1/ads-agent/summary", ads: "/v1/ads", chi_so: "/v1/metrics/ads", de_xuat: "/v1/candidates", thao_tac: "/v1/actions", bao_cao_moi: "/v1/ads/report/latest" }[xem]));
tool("bao_cao", "Báo cáo tổng hợp phễu bài → ads → hội thoại → đơn trong N ngày.", { so_ngay: z.number().int().min(1).max(90).optional() }, async ({ so_ngay }) => get(`/v1/reports/summary?days=${so_ngay ?? 7}`));
tool("video_flow", "Các lần sản xuất video Google Flow (hoặc chi tiết 1 job nếu có id).", { id: z.string().optional() }, async ({ id }) => id ? get(`/v1/creative/jobs/${encodeURIComponent(id)}`) : get("/v1/creative/jobs"));
tool("hoi_thoai", "Hội thoại khách hàng: lọc handoff (chờ người), unread, hot; hoặc chi tiết 1 hội thoại theo id.", { loc: z.enum(["handoff", "unread", "hot", "tat_ca"]).optional(), id: z.string().optional() }, async ({ loc, id }) =>
  id ? get(`/v1/conversations/${encodeURIComponent(id)}`) : get(`/v1/conversations${loc && loc !== "tat_ca" ? `?filter=${loc}` : ""}`));
tool("leads", "Danh sách lead đã chấm điểm (cao trước).", {}, async () => pick(await get("/v1/leads"), ["id", "name", "grade", "score", "product_interest", "channel", "state", "updated_at"], 40));
tool("zalo", "Follow-up Zalo (ZL-CRM): tổng quan, kế hoạch follow-up, hội thoại.", { xem: z.enum(["tong_quan", "follow_up", "hoi_thoai"]).optional() }, async ({ xem }) =>
  get({ tong_quan: "/v1/zalo", follow_up: "/v1/zalo/followups", hoi_thoai: "/v1/zalo/conversations" }[xem ?? "tong_quan"]));
tool("luong_tu_dong", "Các luồng vận hành tự động (đồng bộ số liệu, tắt ads theo điều kiện, ngân sách, chạy theo lịch) + lần chạy gần nhất.", {}, async () => get("/v1/automations"));
tool("lich_dang", "Lịch đăng bài + các lượt đăng gần đây.", {}, async () => ({ calendar: await get("/v1/calendar"), publishJobs: pick(await get("/v1/publish-jobs"), ["id", "title", "channel", "status", "scheduled_at", "error"], 30) }));
tool("ket_noi", "Trạng thái các kết nối nền tảng (Meta, TikTok, Zalo, Sheets…).", {}, async () => pick(await get("/v1/connections"), ["id", "platform", "display_name", "status", "mode", "last_health_at"], 40));
tool("tri_thuc", "Tìm trong kho tri thức (sản phẩm, chính sách, FAQ).", { cau_hoi: z.string() }, async ({ cau_hoi }) => call("POST", "/v1/knowledge/search", { query: cau_hoi }));
tool("nhat_ky", "Nhật ký hoạt động gần đây của hệ thống (ai làm gì, lúc nào).", { so_luong: z.number().int().min(1).max(200).optional() }, async ({ so_luong }) =>
  pick(await get(`/v1/audit-log?limit=${so_luong ?? 40}`), ["at", "actor", "event", "ref_type", "ref_id"], so_luong ?? 40));
tool("viec_da_giao", "Những việc Ngân Nguyệt đã giao cho các agent và trạng thái hiện tại.", {}, async () => get("/v1/assistant/dispatches"));

// ---------------- Agentic Brain (trí nhớ công ty — ghi chú Markdown) ----------------
const FOLDERS_HINT = "1. Tổng quan · 2. Hộp thư · 3. Nhật ký vận hành (Ngày/Tuần/Tháng) · 4. Mục tiêu & kế hoạch · 5. Thương hiệu & DNA · 6. Khách hàng & thị trường (Chân dung khách hàng/Đối thủ/Nghiên cứu) · 7. Chiến dịch · 8. Nội dung (Bài viết/SEO/Thư viện bài thắng) · 9. Video (Kịch bản/Video Flow/Kho hook/Thư viện video thắng) · 10. Quảng cáo (Báo cáo/Quyết định) · 11. Bán hàng & chăm sóc · 12. Review & kiểm duyệt · 13. Feedback loop (Bài học/Sếp từ chối/Đề xuất thay đổi/Thử nghiệm) · 14. Số liệu & báo cáo · 15. Tri thức (Chat Agent dùng trả lời khách) · 16. Sổ tay quy trình (Kỹ năng/Mẫu ghi chú) · 17. Đội AI · 18. Ý tưởng & hội thoại · 19. Lưu trữ · 20. Tệp & hình ảnh";
tool("brain_tim", "Tìm trong Agentic Brain (ghi chú, nhật ký, dự án, quy trình, tri thức, hội thoại cũ). Tìm theo nội dung (mặc định) hoặc theo tiêu đề. Không dấu cũng tìm được.", {
  cau_hoi: z.string().min(1), theo: z.enum(["noi_dung", "ten"]).optional(),
}, async ({ cau_hoi, theo }) => get(`/v1/brain/active/search?q=${encodeURIComponent(cau_hoi)}&mode=${theo === "ten" ? "name" : "content"}&limit=20`));
tool("brain_doc", "Đọc toàn văn 1 ghi chú trong Agentic Brain (đường dẫn dạng '3. Nhật ký vận hành/Ngày/2026-10-01.md'), kèm liên kết & ghi chú nhắc tới nó.", { path: z.string().min(4) }, async ({ path }) => {
  const n = await get(`/v1/brain/active/note?path=${encodeURIComponent(path)}`);
  return { path: n.path, title: n.title, tags: n.tags, content: n.content, links: n.links, backlinks: n.backlinks };
});
tool("brain_ghi", `Tạo ghi chú MỚI trong Agentic Brain (mặc định "2. Hộp thư"). Dùng [[Tên ghi chú]] để liên kết. Thư mục: ${FOLDERS_HINT}.`, {
  tieu_de: z.string().min(1).max(160), noi_dung: z.string().min(1), thu_muc: z.string().optional(),
}, async (a) => call("POST", "/v1/brain/active/note", { title: a.tieu_de, content: a.noi_dung, folder: a.thu_muc }));
tool("brain_them", "Ghi THÊM vào cuối 1 ghi chú có sẵn (không xóa nội dung cũ), ví dụ thêm ý vào nhật ký hôm nay.", { path: z.string().min(4), noi_dung: z.string().min(1) }, async (a) =>
  call("POST", "/v1/brain/active/append", { path: a.path, text: a.noi_dung }));
tool("brain_nhat_ky", "Nhật ký 1 ngày trong Agentic Brain (mặc định hôm nay): hệ thống tự ghi việc các agent đã làm, số liệu, ghi chú sinh ra trong ngày.", { ngay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }, async ({ ngay }) => {
  const { path } = await call("POST", "/v1/brain/active/daily", ngay ? { date: ngay } : {});
  return (await get(`/v1/brain/active/note?path=${encodeURIComponent(path)}`)).content;
});
tool("brain_gan_day", "Các ghi chú vừa tạo/sửa gần đây trong Agentic Brain.", {}, async () => get("/v1/brain/active/recent?limit=25"));
tool("tao_nhac_viec", "Tạo nhắc việc cho Sếp (lưu ở \"4. Mục tiêu & kế hoạch/Nhắc việc\" trong Agentic Brain, đến giờ hệ thống báo trên máy + trong app). Thời gian theo giờ Việt Nam, dạng 'YYYY-MM-DD HH:mm'.", {
  tieu_de: z.string().min(2).max(160), thoi_gian: z.string().min(10), ghi_chu: z.string().optional(),
}, async (a) => call("POST", "/v1/brain/reminders", { title: a.tieu_de, due: a.thoi_gian, note: a.ghi_chu }));
tool("ds_nhac_viec", "Danh sách nhắc việc sắp tới (chưa xong).", {}, async () => get("/v1/brain/reminders"));

// ---------------- Giao việc ngay (đi qua review / duyệt như bình thường) ----------------
tool("giao_viec", "Giao NGAY 1 việc cho agent nội dung: content (bài mạng xã hội), video_script (kịch bản video ngắn), seo_web (bài blog SEO). Kết quả qua Review Agent rồi vào hộp Duyệt.", {
  agent: z.enum(["content", "video_script", "seo_web"]),
  yeu_cau: z.string().min(5).describe("Yêu cầu đầy đủ của Sếp: chủ đề, góc, sản phẩm, ưu đãi, giọng…"),
  kenh: z.enum(["facebook", "instagram", "tiktok", "zalo", "website", "youtube"]).optional(),
  dinh_dang: z.enum(["text", "image", "video", "reel", "article"]).optional(),
  tu_khoa: z.string().optional().describe("Từ khóa SEO (cho seo_web)"),
  pheu: z.enum(["tofu", "mofu", "bofu"]).optional(),
}, async (a) => call("POST", "/v1/assistant/agent-task", { threadId: THREAD, agent: a.agent, instruction: a.yeu_cau, channel: a.kenh, format: a.dinh_dang, keyword: a.tu_khoa, funnel: a.pheu }));
tool("tao_chien_dich", "Tạo mục tiêu → chuỗi agent tự chạy: brief → (nghiên cứu thị trường) → chiến lược (Sếp duyệt) → nội dung từng kênh. launch_campaign = ra mắt/chiến dịch có nghiên cứu; weekly_content = lịch nội dung tuần.", {
  tieu_de: z.string().min(3), mo_ta: z.string().min(5), loai: z.enum(["launch_campaign", "weekly_content"]), ngan_sach_ads: z.number().int().min(0).optional(), han: z.string().optional().describe("YYYY-MM-DD"),
}, async (a) => {
  const g = await call("POST", "/v1/goals", { title: a.tieu_de, description: a.mo_ta, template: a.loai, budgetAds: a.ngan_sach_ads ?? 0, dueDate: a.han });
  await dispatched(a.loai, "goal", g.id, a.tieu_de);
  return { goalId: g.id, status: g.status, ghiChu: "Brief Agent bắt đầu ngay; Chiến lược sẽ chờ Sếp duyệt rồi mới sinh nội dung." };
});
tool("chay_bao_cao_ads", "Yêu cầu Ads Agent làm báo cáo quảng cáo 7 ngày NGAY (đề xuất scale/tắt đi vào hộp Duyệt).", {}, async () => {
  const t = await call("POST", "/v1/ads/report", {});
  if (t?.id) await dispatched("ads_report", "task", t.id, "Báo cáo quảng cáo 7 ngày");
  return t;
});
tool("dong_bo_so_lieu", "Kéo số liệu quảng cáo mới nhất từ các nền tảng ngay.", {}, async () => call("POST", "/v1/metrics/sync", {}));
tool("dong_bo_zalo", "Đồng bộ hội thoại Zalo từ ZL-CRM ngay.", {}, async () => call("POST", "/v1/zalo/sync", {}));
tool("thu_lai_tac_vu", "Chạy lại 1 tác vụ lỗi/bị chặn.", { id: z.string() }, async ({ id }) => call("POST", `/v1/tasks/${encodeURIComponent(id)}/retry`, {}));
tool("chay_thu_luong", "Chạy THỬ (không tác động thật) 1 luồng tự động để xem kết quả.", { id: z.string() }, async ({ id }) => call("POST", `/v1/automations/${encodeURIComponent(id)}/run`, { dryRun: true }));

// ---------------- Can thiệp nhạy cảm → thẻ xác nhận ----------------
tool("duyet", "Duyệt hoặc từ chối 1 mục trong hộp Duyệt (duyệt bài có thể dẫn tới đăng lên kênh). Tạo thẻ xác nhận.", {
  id: z.string(), quyet_dinh: z.enum(["approve", "reject"]), ghi_chu: z.string().optional(), tieu_de_muc: z.string().optional(),
}, async (a) => confirm(`${a.quyet_dinh === "approve" ? "Duyệt" : "Từ chối"}: ${a.tieu_de_muc ?? a.id}`, a.ghi_chu ?? "", "POST", `/v1/approvals/${encodeURIComponent(a.id)}/decide`, { decision: a.quyet_dinh, note: a.ghi_chu }));
tool("huy_tac_vu", "Hủy 1 tác vụ đang chờ/chạy. Tạo thẻ xác nhận.", { id: z.string(), ly_do: z.string().optional(), tieu_de: z.string().optional() }, async (a) =>
  confirm(`Hủy tác vụ: ${a.tieu_de ?? a.id}`, a.ly_do ?? "", "POST", `/v1/tasks/${encodeURIComponent(a.id)}/cancel`, {}));
tool("thao_tac_quang_cao", "Đề xuất tạm dừng / chạy lại / đổi ngân sách ngày 1 quảng cáo (VND). Tạo thẻ xác nhận.", {
  ad_id: z.string(), hanh_dong: z.enum(["pause_ad", "resume_ad", "update_budget"]), ngan_sach: z.number().int().positive().optional(), ten_quang_cao: z.string().optional(), ly_do: z.string().optional(),
}, async (a) => confirm(`${{ pause_ad: "Tạm dừng", resume_ad: "Chạy lại", update_budget: `Đổi ngân sách ${a.ngan_sach?.toLocaleString("vi-VN")}đ` }[a.hanh_dong]} quảng cáo ${a.ten_quang_cao ?? a.ad_id}`, a.ly_do ?? "", "POST", `/v1/ads/${encodeURIComponent(a.ad_id)}/action`, { type: a.hanh_dong, amount: a.ngan_sach }));
tool("tao_video_flow", "Sản xuất video trên Google Flow (tốn tín dụng Flow, ~40 phút, chạy ngầm). Công cụ: review-do-an-vat (đồ ăn vặt) | review-thoi-trang (thời trang — KOC FASHION, 8 giây/cảnh) | nguoi-que-so-sanh (người que so sánh sản phẩm A vs B — ghi rõ 2 sản phẩm + tiêu chí trong noi_dung) | (Video KOC thời trang nữ, Review đồ gia dụng, Review nhà hàng/quán/shop cần ảnh thật nên KHÔNG tạo qua chat — mời Sếp mở trang Sản xuất video, chọn đúng thẻ và tải ảnh) | (Video nhân hiệu BrandUp cần ảnh chân dung thật của Sếp nên KHÔNG tạo qua chat — mời Sếp mở trang Sản xuất video, chọn "Video nhân hiệu · BrandUp" và tải ảnh) | cooking-director | cinematic. Tạo thẻ xác nhận.", {
  cong_cu: z.enum(["review-do-an-vat", "review-thoi-trang", "nguoi-que-so-sanh", "cooking-director", "cinematic"]), tieu_de: z.string().min(2), noi_dung: z.string().min(5), san_pham: z.string().optional(),
  thoi_luong: z.number().int().min(15).max(120).optional(), giong: z.string().optional(), hook: z.string().optional(), cta: z.string().optional(),
  kenh: z.array(z.enum(["tiktok", "facebook", "instagram"])).optional(), thuong_hieu: z.enum(["taki", "other"]).optional(),
}, async (a) => confirm(`Tạo video Flow: ${a.tieu_de}`, `${a.cong_cu} · ${a.thoi_luong ?? "mặc định"}s · tốn tín dụng Flow`, "POST", "/v1/creative/jobs", {
  tool: a.cong_cu, title: a.tieu_de, brief: a.noi_dung, product: a.san_pham, durationSec: a.thoi_luong, voice: a.giong, hookTitle: a.hook, cta: a.cta, channels: a.kenh ?? ["tiktok"], brand: a.thuong_hieu ?? "other", images: [],
}));
tool("tao_video_tu_dong", "Làm NGAY video ngắn tự động trên máy (không tốn tín dụng Flow): Claude CLI viết lời đọc tiếng Việt, MoneyPrinterTurbo ghép cảnh + giọng Edge TTS + phụ đề → Review → hộp Duyệt. Nguồn cảnh: flow (clip của 1 video Flow đã làm, cần flow_job_id), pexels/pixabay (kho miễn phí, cần khóa đã nhập), local (không dùng qua chat).", {
  tieu_de: z.string().min(2), noi_dung: z.string().min(5).describe("Chủ đề/thông tin sản phẩm, hoặc lời đọc có sẵn nếu loi_doc_co_san=true"), san_pham: z.string().optional(),
  thoi_luong: z.number().int().min(15).max(90).optional(), cta: z.string().optional(), nguon_canh: z.enum(["flow", "pexels", "pixabay"]).optional(), flow_job_id: z.string().optional(),
  loi_doc_co_san: z.boolean().optional(), giong: z.enum(["nu", "nam"]).optional(), khung: z.enum(["9:16", "16:9", "1:1"]).optional(), kenh: z.array(z.enum(["tiktok", "facebook", "instagram"])).optional(), thuong_hieu: z.enum(["taki", "other"]).optional(),
}, async (a) => {
  const j = await call("POST", "/v1/creative/jobs", {
    tool: "auto-video", title: a.tieu_de, brief: a.noi_dung, product: a.san_pham, durationSec: a.thoi_luong ?? 30, cta: a.cta, channels: a.kenh ?? ["tiktok"], brand: a.thuong_hieu ?? "other", images: [],
    video: { source: a.nguon_canh ?? (a.flow_job_id ? "flow" : "pexels"), flowJobId: a.flow_job_id, scriptReady: a.loi_doc_co_san, voiceName: a.giong === "nam" ? "vi-VN-NamMinhNeural-Male" : "vi-VN-HoaiMyNeural-Female", aspect: a.khung ?? "9:16" },
  });
  await dispatched("auto-video", "creative_job", j.id, a.tieu_de);
  return { jobId: j.id, status: j.status, ghiChu: "Đang dựng trên máy (~2-5 phút), xong vào hộp Duyệt. Theo dõi ở [Sản xuất video](/video-flow)." };
});
tool("anh_cu_dong", "Làm ảnh chân dung CỬ ĐỘNG (LivePortrait, chạy trên máy ~1 phút/giây clip) từ 1 ảnh đã tải lên hệ thống (đường dẫn file) + video biểu cảm mẫu (d0…d20), có thể lồng giọng đọc. Clip vào thư viện video, không tự đăng.", {
  tieu_de: z.string().min(2), anh: z.string().describe("Đường dẫn ảnh chân dung trên máy (từ uploads / Agentic Brain)"), mau: z.string().optional().describe("Tên video mẫu, vd d12.mp4"),
  giay: z.number().int().min(3).max(15).optional(), loi_long_tieng: z.string().max(2000).optional(), giong: z.enum(["nu", "nam"]).optional(),
}, async (a) => {
  const j = await call("POST", "/v1/creative/jobs", {
    tool: "portrait", title: a.tieu_de, brief: `${a.tieu_de} — ảnh chân dung cử động`, channels: ["tiktok"], images: [{ path: a.anh, role: "Nhân vật" }],
    video: { driving: a.mau ?? "d12.mp4", seconds: a.giay ?? 6, voiceText: a.loi_long_tieng, voiceName: a.giong === "nam" ? "vi-VN-NamMinhNeural-Male" : "vi-VN-HoaiMyNeural-Female" },
  });
  await dispatched("portrait", "creative_job", j.id, a.tieu_de);
  return { jobId: j.id, status: j.status };
});
tool("long_tieng", "Tạo file giọng đọc tiếng Việt (Edge TTS: nữ Hoài My / nam Nam Minh) + phụ đề .srt từ một đoạn văn. Trả link nghe/tải.", {
  van_ban: z.string().min(1).max(5000), giong: z.enum(["nu", "nam"]).optional(), toc_do: z.number().min(0.8).max(1.3).optional(),
}, async (a) => {
  const r = await call("POST", "/v1/video-ai/tts", { text: a.van_ban, voice: a.giong === "nam" ? "vi-VN-NamMinhNeural-Male" : "vi-VN-HoaiMyNeural-Female", rate: a.toc_do });
  return { thoiLuongGiay: Math.round(r.duration * 10) / 10, nghe: `[Nghe giọng đọc](/v1/video-ai/file?path=${encodeURIComponent(r.mp3)})`, phuDe: `[Tải .srt](/v1/video-ai/file?path=${encodeURIComponent(r.srt)}&download=1)` };
});
tool("trang_thai_video_ai", "Trạng thái công cụ video trên máy (MoneyPrinterTurbo, LivePortrait, faster-whisper, Edge TTS), khóa kho cảnh, video mẫu biểu cảm.", {}, async () => get("/v1/video-ai/status"));
tool("huy_video", "Dừng 1 job video Flow đang chạy. Tạo thẻ xác nhận.", { id: z.string(), tieu_de: z.string().optional() }, async (a) => confirm(`Dừng video Flow: ${a.tieu_de ?? a.id}`, "", "POST", `/v1/creative/jobs/${encodeURIComponent(a.id)}/cancel`, {}));
tool("tra_loi_khach", "Gửi tin nhắn trả lời 1 khách hàng (hội thoại) dưới danh nghĩa nhân viên. Tạo thẻ xác nhận.", { hoi_thoai_id: z.string(), noi_dung: z.string().min(1).max(2000), ten_khach: z.string().optional() }, async (a) =>
  confirm(`Trả lời khách ${a.ten_khach ?? a.hoi_thoai_id}`, a.noi_dung, "POST", `/v1/conversations/${encodeURIComponent(a.hoi_thoai_id)}/reply`, { text: a.noi_dung }));
tool("chay_follow_up_zalo", "Chạy vòng follow-up Zalo ngay (soạn tin chăm sóc; theo cài đặt có thể cần duyệt). Tạo thẻ xác nhận.", {}, async () => confirm("Chạy follow-up Zalo ngay", "Soạn/gửi tin follow-up theo kế hoạch", "POST", "/v1/zalo/run", {}));
tool("bat_tat_luong", "Bật hoặc tắt 1 luồng tự động. Tạo thẻ xác nhận.", { id: z.string(), bat: z.boolean(), ten: z.string().optional() }, async (a) =>
  confirm(`${a.bat ? "Bật" : "Tắt"} luồng ${a.ten ?? a.id}`, "", "POST", `/v1/automations/${encodeURIComponent(a.id)}/status`, { on: a.bat }));
tool("chay_luong_that", "Chạy THẬT 1 luồng tự động ngay (có tác động lên quảng cáo/dữ liệu). Tạo thẻ xác nhận.", { id: z.string(), ten: z.string().optional() }, async (a) =>
  confirm(`Chạy thật luồng ${a.ten ?? a.id}`, "", "POST", `/v1/automations/${encodeURIComponent(a.id)}/run`, { dryRun: false }));
tool("cau_hinh_agent", "Bật/tắt 1 agent, đổi mức tự chủ (L0-L3) hoặc model. Tạo thẻ xác nhận.", {
  agent: z.string(), bat: z.boolean().optional(), muc_tu_chu: z.enum(["L0", "L1", "L2", "L3"]).optional(), model: z.string().nullable().optional(),
}, async (a) => confirm(`Cấu hình agent ${a.agent}`, [a.bat != null ? (a.bat ? "bật" : "tắt") : "", a.muc_tu_chu ? `tự chủ ${a.muc_tu_chu}` : "", a.model !== undefined ? `model ${a.model ?? "mặc định"}` : ""].filter(Boolean).join(", "),
  "PUT", `/v1/agents/${encodeURIComponent(a.agent)}/config`, { enabled: a.bat, autonomy: a.muc_tu_chu, model: a.model }));
tool("kill_switch", "Bật/tắt kill switch (dừng khẩn) cho publish | ads | chat | all. Tạo thẻ xác nhận.", { khu_vuc: z.enum(["publish", "ads", "chat", "all"]), bat: z.boolean() }, async (a) =>
  confirm(`${a.bat ? "BẬT" : "Tắt"} kill switch ${a.khu_vuc}`, a.bat ? "Dừng khẩn mọi tác vụ ở khu vực này" : "Cho chạy lại", "POST", "/v1/kill-switch", { area: a.khu_vuc, on: a.bat }));

// ---------------- Cửa sau cho mọi thứ còn lại ----------------
tool("goi_api", "Gọi bất kỳ API nào của hệ thống (/v1/...) khi không có tool riêng. GET chạy ngay; POST/PUT/DELETE tạo thẻ xác nhận.", {
  method: z.enum(["GET", "POST", "PUT", "DELETE"]), path: z.string().regex(/^\/v1\//), body: z.any().optional(), mo_ta: z.string().describe("Thao tác này làm gì (hiện cho Sếp)"),
}, async (a) => a.method === "GET" ? get(a.path) : confirm(a.mo_ta, `${a.method} ${a.path}`, a.method, a.path, a.body));

await server.connect(new StdioServerTransport());
