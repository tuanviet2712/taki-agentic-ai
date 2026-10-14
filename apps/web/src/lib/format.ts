export function vnd(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${trim(n / 1e9, 2)} tỷ đ`;
  if (a >= 1e6) return `${trim(n / 1e6, 1)} triệu đ`;
  if (a >= 1e3) return `${Math.round(n).toLocaleString("vi-VN")} đ`;
  return `${n} đ`;
}
export function vndFull(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n).toLocaleString("vi-VN")}đ`;
}
export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${trim(n / 1e6, 1)}M`;
  if (a >= 1e3) return `${trim(n / 1e3, 1)}K`;
  return String(Math.round(n));
}
const trim = (v: number, d: number) => v.toFixed(d).replace(/\.?0+$/, "").replace(".", ",");
export const pct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return `sau ${fmtDur(-s)}`;
  if (s < 60) return "vừa xong";
  return `${fmtDur(s)} trước`;
}
function fmtDur(s: number) {
  if (s < 3600) return `${Math.round(s / 60)} phút`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ`;
  return `${Math.round(s / 86400)} ngày`;
}
export function hhmm(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
export function ddmm(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

export const AGENT_LABEL: Record<string, string> = {
  dna_intake: "DNA Agent", brief: "Brief Agent", market_research: "Research Agent", strategy: "Strategy Agent",
  content: "Content Agent", video_script: "Video Agent", seo_web: "SEO Agent", creative: "Creative Agent",
  publishing: "Publishing Agent", post_scanner: "Post Scanner", ads: "Ads Agent", analytics: "Analytics Agent",
  chat: "Chat Agent", chat_vision: "Chat · xem ảnh", follow_up: "Follow-up Agent", feedback: "Feedback Agent", review: "Review Agent",
};

export const TASK_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Chờ phụ thuộc", tone: "gray" }, ready: { label: "Sẵn sàng", tone: "blue" }, running: { label: "Đang chạy", tone: "green" },
  in_review: { label: "Đang review", tone: "violet" }, revising: { label: "Đang sửa", tone: "amber" }, awaiting_approval: { label: "Chờ duyệt", tone: "amber" },
  approved: { label: "Đã duyệt", tone: "green" }, executing: { label: "Đang thực thi", tone: "green" }, done: { label: "Hoàn thành", tone: "green" },
  failed: { label: "Thất bại", tone: "red" }, blocked: { label: "Bị chặn", tone: "red" }, cancelled: { label: "Đã hủy", tone: "gray" },
  rejected: { label: "Bị từ chối", tone: "red" }, expired: { label: "Hết hạn", tone: "gray" },
};
export const CONTENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  in_review: { label: "Đang review", tone: "violet" }, awaiting_approval: { label: "Chờ duyệt", tone: "amber" }, approved: { label: "Đã duyệt", tone: "blue" },
  scheduled: { label: "Đã lên lịch", tone: "blue" }, published: { label: "Đã xuất bản", tone: "green" }, rejected: { label: "Bị từ chối", tone: "red" },
  blocked: { label: "Bị chặn", tone: "red" }, manual_publish: { label: "Đăng thủ công", tone: "gray" },
  video_made: { label: "Đã thành video", tone: "green" },
  expired: { label: "Hết hạn duyệt", tone: "gray" }, cancelled: { label: "Đã hủy", tone: "gray" }, draft_on_channel: { label: "Nháp trên kênh", tone: "blue" },
};
export const CONV_STATE: Record<string, { label: string; tone: Tone }> = {
  new: { label: "Mới", tone: "blue" }, bot_active: { label: "Bot đang trả lời", tone: "violet" }, awaiting_customer: { label: "Chờ khách", tone: "gray" },
  handoff_pending: { label: "Cần người xử lý", tone: "amber" }, human_active: { label: "Nhân viên phụ trách", tone: "blue" }, dormant: { label: "Im lặng", tone: "gray" },
  resolved: { label: "Đã xử lý", tone: "green" }, opted_out: { label: "Đã từ chối nhận tin", tone: "red" },
};
export const LEAD: Record<string, { label: string; tone: Tone }> = {
  hot: { label: "Lead nóng", tone: "red" }, warm: { label: "Lead ấm", tone: "amber" }, cold: { label: "Lead lạnh", tone: "gray" },
};
export const INTENT: Record<string, string> = {
  ask_price: "Hỏi học phí", ask_schedule: "Hỏi lịch học", ask_program: "Hỏi nội dung", register: "Muốn đăng ký", complaint: "Phàn nàn",
  ask_human: "Muốn gặp người", smalltalk: "Chào hỏi", other: "Khác",
};
export const KIND_LABEL: Record<string, string> = {
  social_post: "Bài viết", social_video: "Video ngắn", video_script: "Kịch bản video", seo_article: "Bài SEO",
};
export type Tone = "green" | "blue" | "amber" | "red" | "violet" | "gray" | "pink";
