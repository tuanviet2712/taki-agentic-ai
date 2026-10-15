// Chép từ auto-funnel core/ket-noi-domain.ts (chỉ phần email cần): chuẩn hoá hostname + tên miền gốc (zone Cloudflare).
const DUOI_HAI_TANG = new Set(["com.vn", "net.vn", "org.vn", "edu.vn", "gov.vn", "info.vn", "biz.vn", "name.vn", "pro.vn", "health.vn", "co.uk", "com.au", "co.jp", "com.sg"]);

export function chuanHostname(nhap: string): { ok: true; host: string } | { ok: false; loi: string } {
  let s = String(nhap ?? "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!s) return { ok: false, loi: "Nhập domain, ví dụ mail.tenmien.vn" };
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s)) return { ok: false, loi: `«${s}» không phải domain hợp lệ (cần dạng mail.tenmien.vn)` };
  if (s === "localhost" || s.endsWith(".local")) return { ok: false, loi: "Domain phải là tên miền thật, không phải localhost" };
  return { ok: true, host: s };
}

/** Tên miền gốc (zone Cloudflare) của một host: mail.tenmien.vn → tenmien.vn; mail.abc.com.vn → abc.com.vn. */
export function tenMienGoc(host: string): string {
  const nhan = host.toLowerCase().split(".");
  const giu = DUOI_HAI_TANG.has(nhan.slice(-2).join(".")) ? 3 : 2;
  return nhan.slice(-giu).join(".");
}
