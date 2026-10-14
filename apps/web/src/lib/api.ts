import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

// ---------------- Doanh nghiệp đang chọn (nhiều doanh nghiệp) ----------------
// localStorage + cookie taki_biz (cookie để EventSource, <img>, <video>, tải tệp cũng mang theo). Máy chủ kiểm & tự về
// doanh nghiệp mặc định nếu id lạ / đã lưu trữ.
const BIZ_KEY = "taki_biz";
function bizCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)taki_biz=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
function writeBizCookie(id: string) {
  document.cookie = `${BIZ_KEY}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
export function currentBizId(): string | null {
  let id: string | null = null;
  try { id = localStorage.getItem(BIZ_KEY); } catch { /* storage unavailable */ }
  return id || bizCookie();
}
function rememberBiz(id: string) {
  try { localStorage.setItem(BIZ_KEY, id); } catch { /* storage unavailable */ }
  writeBizCookie(id);
}
/** Đổi doanh nghiệp → nạp lại toàn bộ trang (mọi dữ liệu / SSE theo doanh nghiệp mới). */
export function switchBiz(id: string, to = "/") {
  rememberBiz(id);
  window.location.assign(to);
}
{
  const id = currentBizId();
  if (id && bizCookie() !== id) writeBizCookie(id);
}

/** Full API path (for <img src>, downloads…) — same base as request() below. */
export const apiUrl = (p: string) => (p.startsWith("/") ? p : `/v1/${p}`);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { "idempotency-key": crypto.randomUUID() } : {}),
      ...(currentBizId() ? { "x-biz-id": currentBizId()! } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // Máy chủ báo doanh nghiệp thực dùng (id cũ đã lưu trữ → mặc định): ghi nhớ lại cho khớp.
  const used = res.headers.get("x-biz-id");
  if (used && used !== currentBizId()) rememberBiz(used);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.code ?? "HTTP", data.message ?? `Lỗi ${res.status}`, data.details);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, body: unknown = {}) => request<T>("POST", p, body),
  put: <T = any>(p: string, body: unknown = {}) => request<T>("PUT", p, body),
  del: <T = any>(p: string) => request<T>("DELETE", p),
};

// ---------------- Realtime: one SSE connection shared by all hooks ----------------
type Listener = (e: { type: string; payload: any }) => void;
const listeners = new Set<Listener>();
let es: EventSource | null = null;
function ensureStream() {
  if (es) return;
  es = new EventSource("/v1/stream");
  const types = [
    "task.updated", "approval.created", "approval.decided", "review.completed", "post.published", "post.scored",
    "action.executed", "conversation.message_in", "conversation.message_out", "conversation.handoff", "conversation.suggestion", "lead.graded", "messenger.synced", "chat_insight.updated", "order.created", "order.updated",
    "post.comment_linked", "metrics.updated", "alert.raised", "proposal.created", "proposal.applied", "goal.created", "creative.updated", "automation.ran", "assistant.updated", "brain.updated",
    "autopilot.ran", "autopilot.settings_changed", "autopilot.goal_created", "goal.updated", "llm.updated",
    "content.image", "content.image_progress", // ảnh bài viết / ảnh bài SEO vừa tạo xong · tiến độ tạo ảnh bài SEO
    // Chăm khách từ bình luận (packages/orchestrator/src/nurture.ts + chat-engine/optout.ts)
    "nurture.comment_in", "nurture.comments_classified", "nurture.lead_created", "nurture.dm_sent", "nurture.phone", "nurture.friend_requested", "nurture.friend_accepted",
    "nurture.following_up", "nurture.started", "nurture.needs_check", "nurture.review_skipped", "optout.added", "optout.removed",
  ];
  for (const t of types) es.addEventListener(t, (ev) => {
    const data = JSON.parse((ev as MessageEvent).data);
    listeners.forEach((l) => l({ type: t, payload: data.payload ?? data }));
  });
  es.onerror = () => {
    es?.close();
    es = null;
    setTimeout(ensureStream, 3000); // reconnect; hooks refetch on their next event
  };
}
export function useEvents(fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ensureStream();
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}

/** Fetch + auto-refresh when any of `refreshOn` events arrive (prefix match, e.g. "conversation."). */
export function useApi<T = any>(path: string | null, refreshOn: string[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api.get<T>(path);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);
  const timer = useRef<number | null>(null);
  useEvents((e) => {
    if (!refreshOn.some((p) => e.type.startsWith(p))) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), 250);
  });
  return { data, error, loading, reload: load, setData };
}
