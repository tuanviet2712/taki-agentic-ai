#!/usr/bin/env node
// taki-news-fetch — step 1 of the news-to-video skill, deterministic: download a news article and extract what the
// video needs, so the agent never has to run ad-hoc python/node to parse HTML.
//   taki-news-fetch <url> <outDir> [--images-dir <dir>] [--max-images 12]
// Writes <outDir>/article.html and <outDir>/article.json:
//   { url, site, title, description, published, author, paragraphs[], images[{file,url,caption,width,height}],
//     ogImage, colors[{hex,count}], logos[], fonts[] }
// Images are saved as img_01.jpg … (webp/avif → jpg via ffmpeg). The agent must still Read each image before using it
// (the first image is often the og cover, not the picture for section 1).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [url, outDir] = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (!url || !outDir) { console.error("Dùng: taki-news-fetch <url> <thư mục> [--images-dir <thư mục ảnh>] [--max-images 12]"); process.exit(2); }
const imagesDir = opt("--images-dir", outDir);
const maxImages = Number(opt("--max-images", "12"));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
mkdirSync(outDir, { recursive: true });
mkdirSync(imagesDir, { recursive: true });

const get = async (u, binary = false) => {
  const r = await fetch(u, { headers: { "user-agent": UA, accept: binary ? "image/*,*/*" : "text/html,text/css,*/*", referer: url }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`);
  return binary ? Buffer.from(await r.arrayBuffer()) : r.text();
};
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const strip = (s) => decode(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const meta = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") : "";
};
const abs = (u) => { try { return new URL(decode(u), url).href; } catch { return null; } };

const html = await get(url);
writeFileSync(join(outDir, "article.html"), html);
const host = new URL(url).hostname.replace(/^www\./, "");

// --- article region: known news-site containers first, then <article>, then the whole body ---
const REGION = [
  /<[^>]+id=["']article_body["'][^>]*>([\s\S]*?)<\/(?:div|article|section)>\s*(?:<div[^>]+(?:tag|share|related)|<\/article)/i,
  /<article[^>]*class=["'][^"']*fck_detail[^"']*["'][^>]*>([\s\S]*?)<\/article>/i,
  /<[^>]+class=["'][^"']*(?:fck_detail|detail-content|singular-content|article-content|article__body|post-content|entry-content|content-detail|detail__content|cms-body)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|section)>\s*<(?:div|footer|section)[^>]*(?:class=["'][^"']*(?:tag|share|related|author|footer)|id=["'](?:tag|share))/i,
  /<article[^>]*>([\s\S]*?)<\/article>/i,
  /<body[^>]*>([\s\S]*?)<\/body>/i,
];
let region = html, regionName = "body";
for (const [i, re] of REGION.entries()) {
  const m = html.match(re);
  if (m && strip(m[1]).length > 400) { region = m[1]; regionName = ["article_body", "fck_detail", "content-class", "article", "body"][i]; break; }
}

// --- text ---
const paragraphs = [];
for (const m of region.matchAll(/<(h1|h2|h3|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi)) {
  const t = strip(m[2]);
  const isHead = /^h/i.test(m[1]);
  if ((isHead && t.length > 3) || t.length > 30) if (!paragraphs.includes(t)) paragraphs.push(isHead ? `## ${t}` : t);
}

// --- images (figure + caption first, then loose <img>) ---
const seen = new Set();
const images = [];
const SKIP = /logo|icon|avatar|sprite|blank|placeholder|1x1|pixel|ads?[_-]|banner/i;
const SMALL = /[_/-](\d{2,3})x(\d{2,3})[._/-]/;
const pickSrc = (tag) => {
  for (const a of ["data-original", "data-src", "data-lazy-src", "data-srcset", "srcset", "src"]) {
    const v = tag.match(new RegExp(`${a}=["']([^"']+)["']`, "i"))?.[1];
    if (v) { const first = v.split(",").map((x) => x.trim().split(/\s+/)[0]).pop(); const u = abs(first); if (u && /^https?:/.test(u) && !u.startsWith("data:")) return u; }
  }
  return null;
};
const addImg = (src, caption) => {
  if (!src || seen.has(src) || SKIP.test(src)) return;
  const sm = src.match(SMALL); if (sm && (+sm[1] < 300 || +sm[2] < 200)) return;
  seen.add(src); images.push({ url: src, caption: caption || "" });
};
for (const f of region.matchAll(/<figure[\s\S]*?<\/figure>/gi)) {
  const img = f[0].match(/<img[^>]*>/i)?.[0];
  const cap = strip(f[0].match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? f[0].match(/<p[^>]*class=["'][^"']*(?:caption|chu_thich|Image|desc)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
  if (img) addImg(pickSrc(img), cap);
}
for (const m of region.matchAll(/<img[^>]*>/gi)) addImg(pickSrc(m[0]), strip(m[0].match(/alt=["']([^"']*)["']/i)?.[1] ?? ""));
const ogImage = abs(meta(html, "og:image")) || null;

// --- brand colours: hex frequency in inline + up to 3 site stylesheets (not guessed from memory) ---
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
const sheets = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)].map((m) => abs(m[0].match(/href=["']([^"']+)["']/i)?.[1] ?? "")).filter(Boolean).slice(0, 3);
for (const s of sheets) { try { css.push(await get(s)); } catch { /* blocked css: skip */ } }
const counts = new Map();
for (const c of css) for (const m of c.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
  let h = m[1].toLowerCase(); if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 24) continue; // greys, white, black: not brand colours
  counts.set(`#${h.toUpperCase()}`, (counts.get(`#${h.toUpperCase()}`) ?? 0) + 1);
}
const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([hex, count]) => ({ hex, count }));
const darks = [...css.join("\n").matchAll(/color\s*:\s*#([0-9a-f]{6})/gi)].map((m) => `#${m[1].toUpperCase()}`);
const textColor = darks.sort((a, b) => darks.filter((x) => x === b).length - darks.filter((x) => x === a).length)[0] ?? null;
const fonts = [...new Set([...css.join("\n").matchAll(/font-family\s*:\s*([^;}{]+)/gi)].map((m) => m[1].split(",")[0].replace(/["']/g, "").trim()).filter((f) => f && !/inherit|initial|icon|awesome|material/i.test(f)))].slice(0, 5);
const logos = [...new Set([
  ...[...html.matchAll(/<img[^>]+(?:class|alt|src)=["'][^"']*logo[^"']*["'][^>]*>/gi)].map((m) => pickSrc(m[0])),
  ...[...html.matchAll(/<link[^>]+rel=["'](?:apple-touch-icon|icon)["'][^>]*>/gi)].map((m) => abs(m[0].match(/href=["']([^"']+)["']/i)?.[1] ?? "")),
].filter(Boolean))].slice(0, 4);

// --- download images ---
const probe = (f) => { try { const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { encoding: "utf8" }).trim().split(","); return { width: +w, height: +h }; } catch { return { width: 0, height: 0 }; } };
const saved = [];
const list = [...images];
if (ogImage && !seen.has(ogImage)) list.push({ url: ogImage, caption: "(ảnh bìa og:image)" });
for (const im of list) {
  if (saved.length >= maxImages) break;
  try {
    const buf = await get(im.url, true);
    if (buf.length < 8_000) continue;
    const n = String(saved.length + 1).padStart(2, "0");
    const ext = (im.url.match(/\.(jpe?g|png|webp|avif|gif)(?:[?#]|$)/i)?.[1] ?? "jpg").toLowerCase();
    let file = join(imagesDir, `img_${n}.${ext === "jpeg" ? "jpg" : ext}`);
    writeFileSync(file, buf);
    if (["webp", "avif", "gif"].includes(ext)) {
      const jpg = join(imagesDir, `img_${n}.jpg`);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-i", file, "-frames:v", "1", "-q:v", "2", jpg]);
      unlinkSync(file); file = jpg;
    }
    const size = probe(file);
    if (size.width && size.width < 300) { unlinkSync(file); continue; }
    saved.push({ file, url: im.url, caption: im.caption, ...size });
  } catch (e) { /* skip unreachable image */ }
}

const out = {
  url, site: meta(html, "og:site_name") || host, host, title: meta(html, "og:title") || strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
  description: meta(html, "og:description") || meta(html, "description"), published: meta(html, "article:published_time") || meta(html, "pubdate") || meta(html, "datePublished"),
  author: meta(html, "author") || meta(html, "article:author"), region: regionName, paragraphs, images: saved, ogImage, colors, textColor, logos, fonts,
};
writeFileSync(join(outDir, "article.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  file: join(outDir, "article.json"), site: out.site, title: out.title, region: regionName, paragraphs: paragraphs.length,
  chars: paragraphs.join(" ").length, images: saved.map((s) => `${s.file} ${s.width}x${s.height} — ${s.caption.slice(0, 60)}`), colors: colors.slice(0, 5).map((c) => c.hex), fonts,
}, null, 2));
if (!paragraphs.length) { console.error("Không trích được đoạn văn nào — thử WebFetch hoặc Read article.html"); process.exit(1); }
