// KẾT NỐI EMAIL (THUẦN): Resend gửi thư, Cloudflare giữ DNS. Biến bản ghi Resend yêu cầu thành bản ghi
// Cloudflare, quyết định thêm / sửa / giữ nguyên so với cái đang có, và header hủy đăng ký một chạm.
// I/O ở services/ket-noi-email.ts.
import { chuanHostname, tenMienGoc } from "./ket-noi-domain.ts";

/** Bản ghi Resend trả về trong GET /domains/{id}. `name` có thể tương đối với zone hoặc với domain gửi. */
export type BanGhiResend = { record: string; name: string; type: string; value: string; priority?: number; status?: string; ttl?: string };
export type BanGhiCf = { id?: string; type: string; name: string; content: string; priority?: number };

/**
 * Tên đầy đủ của một bản ghi Resend. Resend ghi «send» (domain gửi là gốc) hoặc «send.mail» (tương đối với
 * zone khi domain gửi là subdomain) — thử ghép với zone trước, không thuộc domain gửi thì ghép với domain gửi.
 */
export function tenDayDu(ten: string, domainGui: string, zone: string): string {
  const t = ten.trim().toLowerCase().replace(/\.$/, "");
  const d = domainGui.toLowerCase();
  if (t === "@" || t === "") return d;
  if (t === d || t.endsWith(`.${d}`)) return t;
  const theoZone = `${t}.${zone}`;
  if (theoZone === d || theoZone.endsWith(`.${d}`)) return theoZone;
  return `${t}.${d}`;
}

/** Chuẩn nội dung để so: bỏ dấu nháy bao ngoài (Cloudflare trả TXT có nháy), chữ thường, bỏ dấu chấm cuối. */
const chuan = (s: string) => s.trim().replace(/^"(.*)"$/s, "$1").replace(/"\s*"/g, "").replace(/\.$/, "").toLowerCase();

export type ViecDns = { loai: "them" | "sua" | "giu"; banGhi: BanGhiCf; cuId?: string; ghiChu: string };

/**
 * So bản ghi cần có với bản ghi đang có trên Cloudflare (cùng tên + loại):
 *  - y hệt → giữ;
 *  - TXT cùng «loại» (SPF với SPF, DKIM với DKIM) nhưng khác giá trị → SỬA (nhà cung cấp đổi khoá, SPF cũ);
 *  - MX khác → thêm (một tên có nhiều MX là hợp lệ);
 *  - chưa có → thêm.
 */
export function soSanhDns(can: BanGhiCf, dangCo: BanGhiCf[]): ViecDns {
  const cung = dangCo.filter((x) => x.type === can.type && x.name.toLowerCase() === can.name.toLowerCase());
  if (cung.some((x) => chuan(x.content) === chuan(can.content) && (can.type !== "MX" || (x.priority ?? 0) === (can.priority ?? 0)))) {
    return { loai: "giu", banGhi: can, ghiChu: "đã có, giữ nguyên" };
  }
  if (can.type === "TXT") {
    const dau = chuan(can.content).split(/[;\s]/)[0];
    const cu = cung.find((x) => chuan(x.content).split(/[;\s]/)[0] === dau);
    if (cu) return { loai: "sua", banGhi: can, cuId: cu.id, ghiChu: `thay giá trị cũ (${chuan(cu.content).slice(0, 40)}…)` };
  }
  return { loai: "them", banGhi: can, ghiChu: "thêm mới" };
}

/** Bản ghi Resend → bản ghi Cloudflare (DNS only, không proxy). */
export function sangCf(r: BanGhiResend, domainGui: string, zone: string): BanGhiCf {
  return { type: r.type.toUpperCase(), name: tenDayDu(r.name, domainGui, zone), content: r.value.trim(), ...(r.type.toUpperCase() === "MX" ? { priority: r.priority ?? 10 } : {}) };
}

/**
 * DMARC cho domain gửi. Subdomain DÀNH RIÊNG cho gửi thư (chỉ Resend gửi, DKIM khớp) thì đặt thẳng
 * p=quarantine — vừa bảo vệ, vừa qua kiểm DNS của app. Domain gốc (có thể đang gửi thư từ Gmail/Workspace
 * chưa ký DKIM) thì chỉ p=none để không làm rơi thư hiện có.
 */
export function dmarcMacDinh(domainGui: string, zone: string): BanGhiCf {
  const rieng = domainGui !== zone;
  return {
    type: "TXT", name: `_dmarc.${domainGui}`,
    content: rieng ? "v=DMARC1; p=quarantine; adkim=r; aspf=r; pct=100" : "v=DMARC1; p=none; adkim=r; aspf=r",
  };
}

/** Domain gửi hợp lệ: tên miền thật, nằm trong zone Cloudflare của app (nếu đã biết zone). */
export function chuanDomainGui(nhap: string): { ok: true; domain: string; zone: string } | { ok: false; loi: string } {
  const h = chuanHostname(nhap);
  if (!h.ok) return h;
  return { ok: true, domain: h.host, zone: tenMienGoc(h.host) };
}

/** Gợi ý domain gửi từ host của app: app.certifiedai.net → mail.certifiedai.net. */
export const goiYDomainGui = (hostApp: string | null | undefined): string => (hostApp ? `mail.${tenMienGoc(hostApp)}` : "");

/** Địa chỉ gửi mặc định trên domain gửi. */
export function diaChiGuiMacDinh(tenHop: string, domainGui: string): string | null {
  const t = String(tenHop ?? "").trim().toLowerCase();
  return /^[a-z0-9._+-]{1,64}$/.test(t) ? `${t}@${domainGui}` : null;
}

/**
 * Header hủy đăng ký một chạm (RFC 8058) — Gmail/Yahoo bắt buộc với người gửi hàng loạt từ 2024.
 * Mail client gửi POST tới URL này kèm «List-Unsubscribe=One-Click».
 */
export function headerHuyDangKy(linkHuy: string): Record<string, string> {
  return { "List-Unsubscribe": `<${linkHuy}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

/** Bản ghi SPF của Resend nằm ở «send.<domain gửi>» (MAIL FROM), không ở gốc — nơi phải tra khi kiểm. */
export const tenSpfResend = (domainGui: string) => `send.${domainGui}`;
