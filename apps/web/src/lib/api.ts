import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/** Full API path (for <img src>, downloads…) — same base as request() below. */
export const apiUrl = (p: string) => (p.startsWith("/") ? p : `/v1/${p}`);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { "idempotency-key": crypto.randomUUID() } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
    "action.executed", "conversation.message_in", "conversation.message_out", "conversation.handoff", "lead.graded",
    "metrics.updated", "alert.raised", "proposal.created", "proposal.applied", "goal.created", "creative.updated", "automation.ran", "assistant.updated", "brain.updated",
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
