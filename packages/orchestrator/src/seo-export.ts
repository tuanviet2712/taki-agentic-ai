import { crc32 } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { byId, type Row } from "@dotaka/db";
import { AppError } from "@dotaka/shared";
import { publicTitle } from "./post-image.ts";
import { isSeoArticle, keywordOf, seoSlug, splitSeoBody } from "./seo-images.ts";

/**
 * Xuất bài SEO + ảnh thành 1 tệp .zip để đưa lên website (WordPress, Haravan, trang tĩnh…):
 *   <slug>.html   bài hoàn chỉnh: <title>, meta description, <h1>, ảnh trong <figure> có alt + chú thích, width/height (không nhảy bố cục),
 *                 loading="lazy" (trừ ảnh đầu bài — tải ưu tiên), ảnh trỏ tới images/<tên tệp theo từ khoá>
 *   <slug>.md     cùng nội dung dạng markdown (ảnh trỏ tới images/…)
 *   images/       các ảnh JPG/PNG đã đặt tên tệp theo từ khoá (không dấu)
 * Ảnh KHÔNG nhúng base64 vì Google không lập chỉ mục ảnh nhúng — tải thư mục images/ lên website rồi giữ nguyên đường dẫn.
 */
const IMG_LINE = /!\[([^\]]*)\]\(\/v1\/media\/([\w-]+)\)/g;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function dosDateTime(d: Date) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
/** Tệp .zip không nén (ảnh JPG đã nén sẵn), tên tệp UTF-8. */
export function buildZip(files: { name: string; data: Buffer }[]): Buffer {
  const out: Buffer[] = [];
  const central: Buffer[] = [];
  const { time, date } = dosDateTime(new Date());
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26);
    out.push(local, name, f.data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(f.data.length, 20); cen.writeUInt32LE(f.data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, ...central, end]);
}

/** Ảnh của bài SEO đã gom: src = "images/<tên tệp theo từ khoá>" trong md/html, path = tệp trên máy. */
export type SeoImage = { src: string; name: string; path: string; mime: string; alt: string; width: number | null; height: number | null; first: boolean };
export type SeoArticle = { title: string; meta: string; slug: string; keyword: string; md: string; images: SeoImage[] };

/** Tách bài SEO thành phần dùng để xuất / đăng website: tiêu đề, meta, slug, markdown (ảnh trỏ images/<tên>), danh sách ảnh. */
export function seoArticleParts(ci: Row): SeoArticle {
  if (!isSeoArticle(ci)) throw new AppError("NOT_FOUND", "Không thấy bài SEO", 404);
  const { md } = splitSeoBody(String(ci.body ?? ""));
  const meta = /^Meta:\s*(.*)$/m.exec(String(ci.body ?? ""))?.[1]?.trim() ?? "";
  const title = publicTitle(ci.title);
  const keyword = keywordOf(ci);
  const slug = seoSlug(keyword || title, 60) || "bai-seo";
  const images: SeoImage[] = [];
  const used = new Set<string>();
  const mdOut = md.replace(IMG_LINE, (whole, alt: string, id: string) => {
    const a = byId<Row>("creative_asset", id);
    if (!a?.path || !existsSync(a.path)) return ""; // ảnh đã mất tệp: bỏ khỏi bản xuất / bài đăng
    let name = String(a.meta?.filename ?? basename(a.path));
    for (let k = 2; used.has(name); k++) name = name.replace(/(-v\d+)?(\.[^.]+)$/, `-v${k}$2`);
    used.add(name);
    const mime = a.mime ?? (/\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg");
    images.push({ src: `images/${name}`, name, path: a.path, mime, alt, width: a.width ?? null, height: a.height ?? null, first: images.length === 0 });
    return `![${alt}](images/${name})`;
  }).replace(/\n{3,}/g, "\n\n");
  return { title, meta, slug, keyword, md: mdOut, images };
}

/** Thân bài HTML (không <html>/<h1>): ảnh đứng riêng → <figure> có alt, chú thích, width/height, lazy (trừ ảnh đầu). */
export async function seoBodyHtml(md: string, images: SeoImage[]): Promise<string> {
  const info = new Map(images.map((i) => [i.src, i]));
  const [{ createElement: h }, { renderToStaticMarkup }, { default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import("react"), import("react-dom/server"), import("react-markdown"), import("remark-gfm"),
  ]);
  return renderToStaticMarkup(h(ReactMarkdown, {
    remarkPlugins: [remarkGfm],
    urlTransform: (u: string) => u,
    components: {
      // Ảnh đứng một mình trong đoạn → <figure> (không lồng <figure> trong <p>).
      p: ({ node, children }: any) => (node?.children?.length === 1 && node.children[0].tagName === "img" ? children : h("p", null, children)),
      img: ({ src, alt }: any) => {
        const i = info.get(String(src));
        return h("figure", null,
          h("img", { src, alt, ...(i?.width && i?.height ? { width: i.width, height: i.height } : {}), decoding: "async", ...(i?.first ? { fetchPriority: "high" } : { loading: "lazy" }) }),
          h("figcaption", null, alt));
      },
    },
  }, md));
}

export async function buildSeoExport(contentItemId: string): Promise<{ filename: string; zip: Buffer; images: number }> {
  const ci = byId<Row>("content_item", contentItemId);
  if (!ci || !isSeoArticle(ci)) throw new AppError("NOT_FOUND", "Không thấy bài SEO", 404);
  const { title, meta, slug, md: mdOut, images } = seoArticleParts(ci);
  const files: { name: string; data: Buffer }[] = images.map((i) => ({ name: i.src, data: readFileSync(i.path) }));
  const body = await seoBodyHtml(mdOut, images);
  const html = `<!doctype html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<meta name="description" content="${esc(meta)}">\n<style>body{font-family:"Segoe UI",Arial,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.75;color:#1f2937}img{max-width:100%;height:auto;border-radius:8px}figure{margin:1.75rem 0}figcaption{font-size:.85rem;color:#6b7280;text-align:center;margin-top:.4rem}table{border-collapse:collapse}td,th{border:1px solid #d1d5db;padding:.4rem .7rem}</style>\n</head>\n<body>\n<article>\n<h1>${esc(title)}</h1>\n${body}\n</article>\n</body>\n</html>\n`;
  files.unshift({ name: `${slug}.md`, data: Buffer.from(`# ${title}\n\n${mdOut}\n`, "utf8") });
  files.unshift({ name: `${slug}.html`, data: Buffer.from(html, "utf8") });
  return { filename: `${slug}.zip`, zip: buildZip(files), images: images.length };
}
