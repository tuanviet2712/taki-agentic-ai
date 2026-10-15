import { ConnectorError } from "./errors.ts";

/**
 * Resend (gửi email) + Cloudflare (DNS của domain gửi) — gọi bằng fetch thuần như auto-funnel, không SDK.
 * Khoá chỉ đi trong header Authorization, không bao giờ trên URL.
 */
const RS = "https://api.resend.com";
const CF = "https://api.cloudflare.com/client/v4";

export type ResendCreds = { api_key: string };
export type ResendDomain = { id: string; name: string; status: string; records?: { record: string; name: string; type: string; value: string; priority?: number; status?: string }[] };

async function rs<T>(key: string, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ ok: boolean; status: number; j: T & { message?: string; name?: string } }> {
  let r: Response;
  try {
    r = await fetch(`${RS}${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new ConnectorError("Transient", `Resend: không kết nối được (${e instanceof Error ? e.message : e})`);
  }
  return { ok: r.ok, status: r.status, j: (await r.json().catch(() => ({}))) as T & { message?: string } };
}

function rsError(status: number, msg?: string): ConnectorError {
  if (status === 401 || status === 403) return new ConnectorError("AuthError", `Resend từ chối khoá (${status}): ${msg ?? ""}. Khoá phải là loại Full access.`);
  if (status === 429) return new ConnectorError("RateLimited", "Resend: gửi quá nhanh (429) — thử lại sau ít giây");
  if (status >= 500) return new ConnectorError("Transient", `Resend lỗi máy chủ (${status})`);
  return new ConnectorError("InvalidRequest", `Resend (${status}): ${msg ?? "yêu cầu không hợp lệ"}`);
}

/** Kiểm khoá + domain của địa chỉ gửi: domain phải có trên Resend (verified mới gửi được cho người ngoài). */
export async function resendTest(cr: ResendCreds, fromAddress: string): Promise<{ domain: string; domainId: string | null; status: string; all: string[] }> {
  if (!cr.api_key?.startsWith("re_")) throw new ConnectorError("InvalidRequest", "API key Resend bắt đầu bằng re_");
  const domain = String(fromAddress ?? "").split("@")[1]?.trim().toLowerCase();
  if (!domain) throw new ConnectorError("InvalidRequest", "Địa chỉ gửi phải có dạng ten@domain-cua-ban.vn");
  const r = await rs<{ data?: ResendDomain[] }>(cr.api_key, "/domains");
  if (!r.ok) throw rsError(r.status, r.j.message);
  const list = r.j.data ?? [];
  const hit = list.find((d) => d.name.toLowerCase() === domain);
  return { domain, domainId: hit?.id ?? null, status: hit?.status ?? "not_added", all: list.map((d) => `${d.name} (${d.status})`) };
}

export async function resendDomains(key: string): Promise<ResendDomain[]> {
  const r = await rs<{ data?: ResendDomain[] }>(key, "/domains");
  if (!r.ok) throw rsError(r.status, r.j.message);
  return r.j.data ?? [];
}
export async function resendCreateDomain(key: string, name: string): Promise<ResendDomain> {
  const r = await rs<ResendDomain>(key, "/domains", { method: "POST", body: { name } });
  if (!r.ok) throw rsError(r.status, r.j.message);
  return r.j;
}
export async function resendDomain(key: string, id: string): Promise<ResendDomain> {
  const r = await rs<ResendDomain>(key, `/domains/${encodeURIComponent(id)}`);
  if (!r.ok) throw rsError(r.status, r.j.message);
  return r.j;
}
export async function resendVerifyDomain(key: string, id: string): Promise<void> {
  await rs(key, `/domains/${encodeURIComponent(id)}/verify`, { method: "POST" });
}
export async function resendWebhooks(key: string): Promise<{ id: string; endpoint: string }[]> {
  const r = await rs<{ data?: { id: string; endpoint: string }[] }>(key, "/webhooks");
  return r.ok ? r.j.data ?? [] : [];
}
export async function resendCreateWebhook(key: string, endpoint: string, events: string[]): Promise<{ id?: string; signing_secret?: string; error?: string }> {
  const r = await rs<{ id?: string; signing_secret?: string }>(key, "/webhooks", { method: "POST", body: { endpoint, events } });
  return r.ok ? r.j : { error: `${r.status}: ${r.j.message ?? "không trả khoá ký"}` };
}

export type ResendEmail = { from: string; to: string; subject: string; html: string; headers?: Record<string, string>; replyTo?: string; tags?: { name: string; value: string }[] };
/** Gửi 1 thư. idempotencyKey: Resend bỏ qua yêu cầu trùng trong 24 giờ (không gửi 2 lần khi thử lại). */
export async function resendSend(key: string, m: ResendEmail, idempotencyKey?: string): Promise<{ id: string }> {
  const r = await rs<{ id?: string }>(key, "/emails", {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey.slice(0, 256) } : {},
    body: { from: m.from, to: m.to, subject: m.subject, html: m.html, ...(m.headers ? { headers: m.headers } : {}), ...(m.replyTo ? { reply_to: m.replyTo } : {}), ...(m.tags ? { tags: m.tags } : {}) },
  });
  if (!r.ok || !r.j.id) throw rsError(r.status, r.j.message);
  return { id: r.j.id };
}

// ---------------- Cloudflare DNS ----------------
async function cf<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; result: T; err: string }> {
  try {
    const r = await fetch(`${CF}${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; result: T; errors?: { message: string }[] };
    return { ok: r.ok && j.success !== false, result: j.result, err: (j.errors ?? []).map((e) => e.message).join("; ") || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, result: undefined as T, err: `Cloudflare: không kết nối được (${e instanceof Error ? e.message : e})` };
  }
}
export type CfRecord = { id?: string; type: string; name: string; content: string; priority?: number };
export async function cloudflareZoneId(token: string, zone: string): Promise<string> {
  const r = await cf<{ id: string }[]>(token, `/zones?name=${encodeURIComponent(zone)}`);
  if (!r.ok) throw new ConnectorError("AuthError", `Cloudflare từ chối token: ${r.err}`);
  const id = r.result?.[0]?.id;
  if (!id) throw new ConnectorError("InvalidRequest", `Token Cloudflare không thấy zone ${zone}. Tạo lại token, ở «Zone Resources» chọn ${zone}.`);
  return id;
}
export async function cloudflareRecords(token: string, zoneId: string, name: string, type?: string): Promise<CfRecord[]> {
  const r = await cf<CfRecord[]>(token, `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}${type ? `&type=${type}` : ""}&per_page=100`);
  return r.ok ? r.result ?? [] : [];
}
export async function cloudflareUpsertRecord(token: string, zoneId: string, rec: CfRecord, replaceId?: string): Promise<string | null> {
  const body = { type: rec.type, name: rec.name, content: rec.content, ttl: 1, proxied: false, ...(rec.priority !== undefined ? { priority: rec.priority } : {}) };
  const r = replaceId ? await cf(token, `/zones/${zoneId}/dns_records/${replaceId}`, { method: "PUT", body }) : await cf(token, `/zones/${zoneId}/dns_records`, { method: "POST", body });
  return r.ok ? null : r.err;
}
