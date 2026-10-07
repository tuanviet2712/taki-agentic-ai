import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError, logger } from "@dotaka/shared";

/**
 * Đọc website doanh nghiệp cho "AI điền giúp" (Nạp DNA): tải trang chủ + vài trang quan trọng cùng tên miền (giới thiệu,
 * khóa học / sản phẩm / dịch vụ, bảng giá, liên hệ), bóc chữ khỏi HTML → nguồn cho DNA Agent (dna-intake.ts).
 * Trước đây chỉ gửi CHUỖI URL cho AI (AI không có công cụ lướt web) nên luôn ra "không có nội dung nguồn".
 * An toàn: chỉ http/https, chặn địa chỉ nội bộ (localhost, mạng LAN, metadata), giới hạn dung lượng & thời gian.
 */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const MAX_BYTES = 3_000_000;
const PAGE_CHARS = 5_000;
const TOTAL_CHARS = 20_000;
const MAX_SUBPAGES = 5;
const KEY_PATHS = /(gioi-?thieu|about|ve-chung-toi|khoa-?hoc|course|chuong-?trinh|dao-?tao|san-?pham|product|dich-?vu|service|bang-?gia|pricing|hoc-?phi|lien-?he|contact|founder|nha-?sang-?lap|cau-?chuyen|story)/i;

export type WebPage = { url: string; title: string; text: string };

function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
async function assertPublic(u: URL) {
  if (!["http:", "https:"].includes(u.protocol)) throw new AppError("BAD_URL", "Chỉ đọc được địa chỉ http/https");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new AppError("BAD_URL", "Không đọc địa chỉ nội bộ");
  const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new AppError("BAD_URL", `Không tìm thấy tên miền ${u.hostname}`);
  if (addrs.some((a) => privateIp(a.address))) throw new AppError("BAD_URL", "Không đọc địa chỉ nội bộ");
}

export function normalizeSiteUrl(raw: string): URL {
  const s = raw.trim();
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { throw new AppError("BAD_URL", `Địa chỉ website không hợp lệ: ${s}`); }
}

const decode = (s: string) => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

/** HTML → tiêu đề, mô tả, chữ đọc được (giữ xuống dòng ở tiêu đề / đoạn / mục). */
export function htmlToText(html: string): { title: string; description: string; text: string } {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const meta = (name: string) => decode(html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"))?.[1] ?? "").trim();
  const description = meta("description") || meta("og:description");
  const body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = decode(body).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 1);
  const seen = new Set<string>();
  const text = lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true))).join("\n");
  return { title, description, text };
}

async function fetchHtml(u: URL): Promise<{ url: URL; html: string }> {
  let cur = u;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(cur);
    const res = await fetch(cur, {
      redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "accept-language": "vi-VN,vi;q=0.9,en;q=0.8" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { cur = new URL(res.headers.get("location")!, cur); continue; }
    if (!res.ok) throw new AppError("WEB_BLOCKED", `${cur.hostname} trả lỗi ${res.status}${res.status === 403 ? " (website chặn đọc tự động)" : ""}`);
    if (!/html|xml|text/i.test(res.headers.get("content-type") ?? "text/html")) throw new AppError("WEB_NOT_HTML", "Trang không phải HTML");
    const buf = new Uint8Array(await res.arrayBuffer());
    return { url: cur, html: new TextDecoder("utf-8").decode(buf.subarray(0, MAX_BYTES)) };
  }
  throw new AppError("WEB_REDIRECT", "Website chuyển hướng quá nhiều lần");
}

/** Trang chủ + tối đa 5 trang con quan trọng cùng tên miền. Lỗi trang con bỏ qua; lỗi trang chủ → báo rõ. */
export async function readWebsite(raw: string): Promise<{ pages: WebPage[]; skipped: string[] }> {
  const start = normalizeSiteUrl(raw);
  const home = await fetchHtml(start);
  const host = home.url.hostname.replace(/^www\./, "");
  const h = htmlToText(home.html);
  const pages: WebPage[] = [{ url: home.url.href, title: h.title, text: [h.description, h.text].filter(Boolean).join("\n").slice(0, PAGE_CHARS + 2_000) }];
  const links = new Map<string, number>();
  for (const m of home.html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try { u = new URL(decode(m[1]), home.url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
    if (/\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|mp3)$/i.test(u.pathname) || /\/(wp-admin|wp-login|cart|gio-hang|checkout|tag|author|feed)\b/i.test(u.pathname)) continue;
    u.search = ""; u.hash = "";
    const key = u.href.replace(/\/$/, "");
    if (key === home.url.href.replace(/\/$/, "")) continue;
    const label = m[2].replace(/<[^>]+>/g, " ");
    const score = (KEY_PATHS.test(u.pathname) ? 2 : 0) + (KEY_PATHS.test(label) ? 1 : 0) - u.pathname.split("/").filter(Boolean).length * 0.1;
    if (score > 0) links.set(key, Math.max(links.get(key) ?? -9, score));
  }
  const picked = [...links.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_SUBPAGES).map(([u]) => u);
  const skipped: string[] = [];
  const subs = await Promise.all(picked.map(async (u) => {
    try {
      const r = await fetchHtml(new URL(u));
      const t = htmlToText(r.html);
      return { url: r.url.href, title: t.title, text: t.text.slice(0, PAGE_CHARS) } as WebPage;
    } catch (e) { skipped.push(`${u} (${e instanceof Error ? e.message : String(e)})`); return null; }
  }));
  let total = pages[0].text.length;
  for (const p of subs) {
    if (!p || !p.text.trim() || total >= TOTAL_CHARS) continue;
    p.text = p.text.slice(0, TOTAL_CHARS - total);
    total += p.text.length;
    pages.push(p);
  }
  logger.info("web_read.done", { host, pages: pages.length, chars: total, skipped: skipped.length });
  return { pages, skipped };
}
