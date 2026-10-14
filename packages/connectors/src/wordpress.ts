import { readFileSync } from "node:fs";
import { ConnectorError } from "./errors.ts";
import type { Connector, WebArticle } from "./index.ts";

/**
 * Website WordPress (REST API lõi /wp/v2 — không cần plugin). Xác thực = Application Password của 1 tài khoản WordPress
 * (Hồ sơ → Application Passwords), gửi qua HTTP Basic. Chỉ nhận https (trừ localhost) vì mật khẩu ứng dụng đi trong header.
 *  - Ảnh trong bài: POST /wp/v2/media (tệp trên máy, tên tệp theo từ khoá) + alt_text → thay src trong HTML bằng link thật.
 *  - Ảnh đầu bài = ảnh đại diện (featured_media). Meta description → excerpt. Slug theo từ khoá.
 *  - Chống đăng trùng: id bài + id ảnh đã tải được lưu NGAY (onPending → publish_job.platform_state); lần chạy lại chỉ đọc lại bài.
 *  - Website không có số liệu tiếp cận chuẩn → fetchPostMetrics báo NotFound (hệ thống bỏ qua, không bịa số).
 * Permalink "Thuần" (không có /wp-json/) → dùng ?rest_route= (rest_mode "query").
 */
export type WordpressCreds = { site_url: string; username: string; app_password: string; post_status?: string; category_id?: string; rest_mode?: string };
const TIMEOUT = 30_000;
const UPLOAD_TIMEOUT = 120_000;

/** https://ten-mien (không dấu / ở cuối, không kèm /wp-admin, /wp-json). */
export function wpSiteUrl(raw: string): string {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); } catch { throw new ConnectorError("InvalidRequest", "Địa chỉ website không hợp lệ"); }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol !== "https:" && !local) throw new ConnectorError("InvalidRequest", "Website phải dùng https:// (mật khẩu ứng dụng không được gửi qua http)");
  const path = u.pathname.replace(/\/(wp-admin|wp-json|wp-login\.php).*$/i, "").replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path}`;
}

function wpError(status: number, body: any, text: string, label: string): ConnectorError {
  const code = String(body?.code ?? "");
  const msg = String(body?.message ?? text ?? "").replace(/<[^>]+>/g, "").slice(0, 200);
  if (status === 401 || status === 403 || /rest_(not_logged_in|cannot|forbidden)|incorrect_password|invalid_username|application_passwords_disabled/.test(code)) {
    return new ConnectorError("AuthError", `${label}: ${msg || "sai tài khoản hoặc mật khẩu ứng dụng"}${code ? ` (${code})` : ""}`);
  }
  if (status === 429) return new ConnectorError("RateLimited", `${label}: website đang giới hạn tần suất`);
  if (status >= 500) return new ConnectorError("Transient", `${label}: website lỗi máy chủ ${status}`);
  if (status === 404) return new ConnectorError(code === "rest_no_route" ? "InvalidRequest" : "NotFound", code === "rest_no_route" ? `${label}: website chưa bật REST API (/wp-json) — kiểm tra plugin bảo mật` : `${label}: ${msg || "không tìm thấy"}`);
  if (status === 413) return new ConnectorError("InvalidRequest", `${label}: tệp ảnh vượt giới hạn tải lên của website`);
  return new ConnectorError("InvalidRequest", `${label}: ${msg || `lỗi ${status}`}${code ? ` (${code})` : ""}`);
}

function client(c: WordpressCreds) {
  const base = wpSiteUrl(c.site_url);
  const auth = `Basic ${Buffer.from(`${c.username.trim()}:${c.app_password.replace(/\s+/g, "")}`).toString("base64")}`;
  const url = (route: string, qs: Record<string, string> = {}) => {
    const p = new URLSearchParams(qs);
    return c.rest_mode === "query"
      ? `${base}/?rest_route=${encodeURIComponent(route)}${p.size ? `&${p}` : ""}`
      : `${base}/wp-json${route}${p.size ? `?${p}` : ""}`;
  };
  async function call(route: string, init: { method?: string; json?: unknown; body?: Buffer; headers?: Record<string, string>; qs?: Record<string, string>; label: string; timeout?: number }): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url(route, init.qs), {
        method: init.method ?? (init.json || init.body ? "POST" : "GET"),
        headers: { authorization: auth, accept: "application/json", ...(init.json ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
        body: init.json ? JSON.stringify(init.json) : init.body ? new Uint8Array(init.body) : undefined,
        signal: AbortSignal.timeout(init.timeout ?? TIMEOUT),
      });
    } catch (e) {
      throw new ConnectorError("Transient", `${init.label}: không kết nối được website (${e instanceof Error ? e.message : e})`);
    }
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = undefined; }
    if (!res.ok) throw wpError(res.status, body, text, init.label);
    if (body === undefined) throw new ConnectorError("InvalidRequest", `${init.label}: website không trả JSON (REST API bị chặn hoặc sai địa chỉ)`);
    return body;
  }
  return { base, call };
}

/** Kiểm tra kết nối: đọc tên website + tài khoản, bắt buộc có quyền đăng bài và tải ảnh. Tự nhận permalink "Thuần" (?rest_route=). */
export async function wordpressTest(c: WordpressCreds): Promise<{ siteUrl: string; siteName: string; user: string; restMode: "pretty" | "query" }> {
  let restMode: "pretty" | "query" = c.rest_mode === "query" ? "query" : "pretty";
  let me: any;
  try {
    me = await client({ ...c, rest_mode: restMode }).call("/wp/v2/users/me", { qs: { context: "edit" }, label: "WordPress" });
  } catch (e) {
    if (!(e instanceof ConnectorError) || e.kind === "AuthError" || restMode === "query") throw e;
    restMode = "query"; // /wp-json/ không có (permalink Thuần / máy chủ chặn) → thử ?rest_route=
    me = await client({ ...c, rest_mode: restMode }).call("/wp/v2/users/me", { qs: { context: "edit" }, label: "WordPress" });
  }
  const caps = me?.capabilities ?? {};
  if (caps.publish_posts === false || (Object.keys(caps).length && !caps.publish_posts)) throw new ConnectorError("AuthError", `WordPress: tài khoản "${me?.name ?? c.username}" không có quyền đăng bài (cần vai trò Tác giả/Biên tập viên/Quản trị)`);
  if (Object.keys(caps).length && !caps.upload_files) throw new ConnectorError("AuthError", `WordPress: tài khoản "${me?.name ?? c.username}" không có quyền tải ảnh lên`);
  const { base, call } = client({ ...c, rest_mode: restMode });
  const site = await call("/", { label: "WordPress" }).catch(() => ({} as any));
  return { siteUrl: base, siteName: String(site?.name || new URL(base).host), user: String(me?.name ?? c.username), restMode };
}

export function wordpressConnector(c: WordpressCreds): Connector {
  const { base, call } = client(c);
  const status = ["draft", "pending", "private"].includes(String(c.post_status)) ? String(c.post_status) : "publish";
  const category = /^\d+$/.test(String(c.category_id ?? "").trim()) ? Number(c.category_id) : null;
  const readPost = (id: string) => call(`/wp/v2/posts/${encodeURIComponent(id)}`, { qs: { context: "edit" }, label: "WordPress" });
  type Uploaded = Record<string, { id: number; url: string }>;
  /** Tải ảnh trong bài lên Media (kèm alt), thay src trong HTML bằng link thật; ảnh đầu bài = ảnh đại diện. Ảnh đã tải (uploaded) không tải lại. */
  async function uploadImages(article: WebArticle, media: { path: string; mime: string } | undefined, done: Uploaded, onPending?: (s: Record<string, unknown>) => void) {
    const uploaded: Uploaded = { ...done };
    let html = article.html;
    const images = [...article.images];
    // Không có ảnh trong bài nhưng nội dung có ảnh đính kèm (ảnh bài viết) → dùng làm ảnh đại diện.
    if (!images.length && media && /^image\//.test(media.mime)) images.push({ src: "", path: media.path, name: media.path.split(/[\\/]/).pop() ?? "anh.jpg", mime: media.mime, alt: article.title });
    for (const img of images) {
      if (!uploaded[img.name]) {
        const m = await call("/wp/v2/media", {
          body: readFileSync(img.path), label: "WordPress (tải ảnh)", timeout: UPLOAD_TIMEOUT,
          headers: { "content-type": img.mime, "content-disposition": `attachment; filename="${asciiName(img.name)}"` },
        });
        uploaded[img.name] = { id: Number(m.id), url: String(m.source_url) };
        onPending?.({ wpMedia: uploaded });
        if (img.alt) await call(`/wp/v2/media/${m.id}`, { json: { alt_text: img.alt }, label: "WordPress (alt ảnh)" }).catch(() => undefined);
      }
      if (img.src) html = html.split(`src="${img.src}"`).join(`src="${uploaded[img.name].url}"`);
    }
    return { html, featured: images[0] ? uploaded[images[0].name]?.id : undefined };
  }
  return {
    platform: "cms", mode: "live", limits: { requestsPerMinute: 30, concurrency: 1 },
    async health() {
      const t = await wordpressTest(c);
      return { ok: true, detail: `${t.siteName} · ${t.user}` };
    },
    async publishPost(spec) {
      // Lần chạy trước đã tạo bài → chỉ đọc lại, không đăng trùng.
      const done = spec.resume?.wpPostId ? String(spec.resume.wpPostId) : null;
      if (done) {
        const p = await readPost(done);
        return { externalId: String(p.id), permalink: String(p.link ?? `${base}/?p=${p.id}`), ...draftInfo(p.status) };
      }
      const article: WebArticle = spec.article ?? textArticle(spec.text);
      const { html, featured } = await uploadImages(article, spec.media, (spec.resume?.wpMedia as Uploaded) ?? {}, spec.onPending);
      const post = await call("/wp/v2/posts", {
        label: "WordPress (đăng bài)",
        json: {
          title: article.title, content: html, excerpt: article.excerpt, slug: article.slug, status,
          ...(featured ? { featured_media: featured } : {}), ...(category ? { categories: [category] } : {}),
        },
      });
      spec.onPending?.({ wpPostId: post.id });
      // Trạng thái THẬT website trả về (plugin có thể ép "Chờ duyệt" dù cài đặt là công khai), không tin vào cài đặt.
      return { externalId: String(post.id), permalink: String(post.link ?? `${base}/?p=${post.id}`), ...draftInfo(post.status ?? status) };
    },
    /** Bài đang Bản nháp / Chờ duyệt / Riêng tư → công khai (đúng bài đó). Website vẫn không cho công khai → báo lỗi, không coi là đã đăng. */
    async publishDraftPost(externalId) {
      const post = await call(`/wp/v2/posts/${encodeURIComponent(externalId)}`, { label: "WordPress (xuất bản bài nháp)", json: { status: "publish" } });
      if (!["publish", "future"].includes(String(post.status))) throw new ConnectorError("PolicyRejected", `WordPress: bài vẫn ở trạng thái "${statusLabel(post.status)}" — tài khoản kết nối cần quyền xuất bản (Biên tập viên/Quản trị)`);
      return { externalId: String(post.id), permalink: String(post.link ?? `${base}/?p=${post.id}`) };
    },
    /** Cập nhật bài ĐÃ ĐĂNG (vd vừa tạo thêm ảnh): nội dung + mô tả ngắn + ảnh đại diện; giữ tiêu đề, đường dẫn, trạng thái. */
    async updatePost(spec) {
      const { html, featured } = await uploadImages(spec.article, spec.media, {});
      const post = await call(`/wp/v2/posts/${encodeURIComponent(spec.externalId)}`, {
        label: "WordPress (cập nhật bài)",
        json: { content: html, ...(spec.article.excerpt ? { excerpt: spec.article.excerpt } : {}), ...(featured ? { featured_media: featured } : {}) },
      });
      return { externalId: String(post.id), permalink: String(post.link ?? `${base}/?p=${post.id}`) };
    },
    async readPostState(externalId) {
      const p = await readPost(externalId);
      return { draft: Boolean(draftInfo(p.status).draft), permalink: String(p.link ?? `${base}/?p=${p.id}`) };
    },
    async verifyPost(externalId) {
      const p = await readPost(externalId);
      return ["publish", "future", "draft", "pending", "private"].includes(String(p.status));
    },
    async fetchPostMetrics() {
      throw new ConnectorError("NotFound", "WordPress không có số liệu tiếp cận theo bài");
    },
  };
}

const statusLabel = (s: unknown) => (s === "draft" ? "Bản nháp" : s === "pending" ? "Chờ duyệt" : s === "private" ? "Riêng tư" : String(s));
/** Bài chưa công khai trên website → draft + ghi chú cho Sếp (bài vẫn ở hàng đăng, bấm "Đăng ngay" để công khai). */
function draftInfo(s: unknown): { draft?: true; note?: string } {
  if (["publish", "future"].includes(String(s))) return {};
  return { draft: true, note: `Bài đang ở trạng thái "${statusLabel(s)}" trên website, CHƯA công khai — bấm "Đăng ngay" ở trang Đăng bài để xuất bản.` };
}
/** Tên tệp an toàn cho header (ảnh SEO đã đặt tên không dấu; phòng tên lạ). */
const asciiName = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^\w.\-]+/g, "-") || "anh.jpg";
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Nội dung không phải bài SEO (bài ngắn): dòng đầu = tiêu đề, các đoạn còn lại = <p>. */
export function textArticle(text: string): WebArticle {
  const lines = text.trim().split(/\n/);
  const title = (lines[0] ?? "").replace(/^#+\s*/, "").slice(0, 200) || "Bài viết";
  const html = text.trim().split(/\n{2,}/).map((p) => `<p>${escHtml(p).replace(/\n/g, "<br>")}</p>`).join("\n");
  return { title, html, excerpt: "", slug: "", images: [] };
}
