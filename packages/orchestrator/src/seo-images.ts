import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Dna } from "@dotaka/agents";
import { activeDna, audit, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { AppError, logger } from "@dotaka/shared";
import { enqueue } from "./queue.ts";
import { imageSize, publicTitle, toJpeg, type Frame } from "./post-image.ts";
import { postImageEngine, type ImageEngine } from "./image-engine.ts";
import { makeAiImage } from "./ai-image.ts";

/**
 * Ảnh trong bài SEO (kind "seo_article"). Quy tắc của Sếp: cứ 1000 chữ thì tối thiểu 4 ảnh, đặt ở vị trí tối ưu cho SEO.
 *
 *  - Số ảnh: ceil(số chữ × 4 / 1000), tối thiểu 4, tối đa 16.
 *  - Vị trí (planSlots): 1 ảnh đầu bài ngay sau đoạn mở đầu (trên màn hình đầu tiên, ảnh đại diện của bài); các ảnh còn lại chia
 *    đều theo số chữ, mỗi ảnh nằm SAU đoạn văn đầu tiên của một mục H2/H3 (tiêu đề luôn đi liền đoạn văn, ảnh minh hoạ đúng mục
 *    đó), không bao giờ nằm giữa danh sách / bảng / khối mã, không có 2 ảnh liền nhau và không có ảnh ở cuối bài.
 *  - Mỗi ảnh có alt text mô tả đúng mục (ảnh đầu bài luôn chứa từ khoá chính, ≤ 125 ký tự) và tên tệp theo từ khoá (không dấu).
 *  - Ảnh được chèn thẳng vào thân bài dưới dạng markdown `![alt](/v1/media/<id>)`: bản Sếp sửa / duyệt / xuất ra luôn khớp bài.
 *    Ảnh đầu bài cũng được gắn vào content_item.asset_id (ảnh đại diện — lượt đăng đính kèm tự nhiên).
 *  - Idempotent: chạy lại chỉ tạo phần còn thiếu (so với số chữ hiện tại), lấp vào khoảng trống lớn nhất.
 * Tạo ảnh lỗi không làm hỏng bài: bài vẫn vào hộp Duyệt kèm lý do, Sếp bấm "Tạo ảnh còn thiếu".
 */
export const SEO_IMAGE: Frame = { width: 1200, height: 675 }; // 16:9 — cũng dùng được làm og:image
export const SEO_WORDS_PER_IMAGE = 250; // 1000 chữ → 4 ảnh
export const SEO_MIN_IMAGES = 4;
export const SEO_MAX_IMAGES = 16;
const POOL = 2; // số ảnh tạo song song (Claude/ChatGPT CLI đã tự giới hạn đồng thời)
const ATTEMPTS = 2; // thử lại 1 lần mỗi ảnh
const ALT_MAX = 125;

export const isSeoArticle = (ci: Row | undefined | null) => ci?.kind === "seo_article";
/** Bài đã đăng lên website WordPress đang kết nối (cập nhật được): permalink, không thì null. */
export function liveWebsitePost(ci: Row): string | null {
  const p = q.get<Row>(`SELECT p.permalink FROM post p JOIN channel ch ON ch.id = p.channel_id JOIN connection c ON c.id = ch.connection_id
    WHERE p.content_item_id = ? AND ch.platform = 'website' AND p.simulated = 0 AND c.platform = 'wordpress' AND c.mode = 'live' AND c.status != 'revoked'
    ORDER BY p.published_at DESC LIMIT 1`, ci.id);
  return p ? String(p.permalink ?? "") || "website" : null;
}
/** Khoá đổi ảnh: bài đã lên lịch, hoặc đã đăng mà KHÔNG cập nhật được. Bài SEO đã lên WordPress vẫn thêm ảnh được (tự cập nhật bài). */
const isLocked = (ci: Row) => ci.status === "scheduled" || (ci.status === "published" && !liveWebsitePost(ci));

// ---------------- Phân tích bài markdown ----------------
export type SeoBlock = { kind: "heading" | "para" | "list" | "table" | "quote" | "code" | "image" | "other"; text: string; words: number };
const HEADER_RE = /^Meta:[^\n]*\nTừ khóa:[^\n]*\n+/;
const IMG_RE = /^!\[([^\]]*)\]\(\/v1\/media\/([\w-]+)\)\s*$/;

/** Bài lưu dạng "Meta: …\nTừ khóa: …\n\n<markdown>" (agents/toContent). Tách phần đầu ra để chỉ xử lý thân bài. */
export function splitSeoBody(body: string): { header: string; md: string } {
  const m = HEADER_RE.exec(body);
  return m ? { header: `${m[0].replace(/\n+$/, "")}\n\n`, md: body.slice(m[0].length) } : { header: "", md: body };
}
export function keywordOf(ci: Row): string {
  const m = /^Từ khóa:\s*(.+)$/m.exec(String(ci.body ?? ""));
  return (m?.[1] ?? "").trim() || publicTitle(ci.title);
}
const countWords = (t: string) => (t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\]\([^)]*\)/g, "]").replace(/[#>*_`|~]+/g, " ").match(/[\p{L}\p{N}]+/gu) ?? []).length;

function classify(text: string): SeoBlock {
  const first = text.split("\n")[0];
  const b = (kind: SeoBlock["kind"], words = countWords(text)): SeoBlock => ({ kind, text, words });
  if (text.startsWith("```")) return b("code", 0);
  if (/^#{1,6}\s/.test(first)) return b("heading");
  if (IMG_RE.test(text.trim())) return b("image", 0);
  if (/^\s*([-*+]|\d+[.)])\s/.test(first)) return b("list");
  if (/^\s*\|/.test(first)) return b("table");
  if (/^\s*>/.test(first)) return b("quote");
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(first)) return b("other", 0);
  return b("para");
}
/** Markdown → danh sách khối (tiêu đề / đoạn / danh sách / bảng / trích dẫn / khối mã / ảnh). Mỗi tiêu đề và mỗi ảnh là 1 khối riêng. */
export function parseBlocks(md: string): SeoBlock[] {
  const out: SeoBlock[] = [];
  let cur: string[] = [];
  let fence = false;
  const flush = () => {
    const text = cur.join("\n").replace(/\s+$/, "");
    cur = [];
    if (text.trim()) out.push(classify(text));
  };
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) {
      if (!fence) flush();
      cur.push(line); fence = !fence;
      if (!fence) flush();
      continue;
    }
    if (fence) { cur.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    if (/^#{1,6}\s/.test(line) || IMG_RE.test(line.trim())) { flush(); cur.push(line.trim()); flush(); continue; }
    cur.push(line);
  }
  flush();
  return out;
}
const render = (blocks: SeoBlock[]) => blocks.map((b) => b.text).join("\n\n");
const headingText = (b: SeoBlock) => b.text.replace(/^#+\s*/, "").replace(/[*_`]/g, "").trim();

/** Số ảnh tối thiểu cho bài có `words` chữ: 4 ảnh / 1000 chữ, tối thiểu 4, tối đa 16. */
export function requiredImages(words: number): number {
  return Math.min(SEO_MAX_IMAGES, Math.max(SEO_MIN_IMAGES, Math.ceil((Math.max(0, words) * 4) / 1000)));
}

// ---------------- Vị trí đặt ảnh ----------------
export type SeoSlot = { after: number; role: "hero" | "section"; heading: string; context: string; offset: number };

/**
 * Chọn `count` vị trí đặt ảnh trong `blocks` (ảnh đã có trong bài được coi là đã chiếm chỗ). Trả vị trí theo thứ tự trong bài;
 * ít hơn `count` nếu bài quá ít đoạn để đặt mà không dồn ảnh.
 */
export function planSlots(blocks: SeoBlock[], count: number, title: string): SeoSlot[] {
  if (count <= 0) return [];
  const cum: number[] = [];
  let acc = 0;
  blocks.forEach((b, i) => { acc += b.words; cum[i] = acc; });
  const total = acc;
  const headingOf: string[] = [];
  const firstOfSection: boolean[] = [];
  let h = "";
  let fresh = true;
  blocks.forEach((b, i) => {
    if (b.kind === "heading") { h = headingText(b); fresh = true; headingOf[i] = h; firstOfSection[i] = false; return; }
    headingOf[i] = h;
    firstOfSection[i] = fresh && b.kind === "para";
    if (b.kind === "para") fresh = false;
  });
  let lastContent = -1;
  blocks.forEach((b, i) => { if (b.kind !== "image") lastContent = i; });
  const nextIsImage = (i: number) => blocks[i + 1]?.kind === "image";
  const tier1 = (i: number) => blocks[i].kind === "para" && blocks[i].words >= 20 && i < lastContent && !nextIsImage(i);
  const tier2 = (i: number) => ["para", "list", "table", "quote"].includes(blocks[i].kind) && i < lastContent && !nextIsImage(i);

  const points: number[] = []; // vị trí (theo số chữ) của mọi ảnh đã có / đã chọn
  blocks.forEach((b, i) => { if (b.kind === "image") points.push(cum[i]); });
  const chosen: { i: number; role: SeoSlot["role"] }[] = [];
  const near = (i: number) => chosen.some((c) => Math.abs(c.i - i) < 2);
  const minGap = Math.max(60, Math.floor(total / (2.5 * (points.length + count))));

  const pick = (target: number, gap: number): number | null => {
    let best: number | null = null;
    let bestScore = Infinity;
    for (const tier of [tier1, tier2]) {
      for (let i = 0; i < blocks.length; i++) {
        if (!tier(i) || near(i) || points.some((p) => Math.abs(p - cum[i]) < gap)) continue;
        const score = Math.abs(cum[i] - target) - (firstOfSection[i] ? 45 : 0);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best !== null) return best; // đoạn văn đủ dài luôn được ưu tiên hơn danh sách / bảng / đoạn ngắn
    }
    return null;
  };

  let left = count;
  // Ảnh đầu bài: ngay sau đoạn mở đầu, nếu phần đầu bài (≈20% đầu, ít nhất 150 chữ) chưa có ảnh.
  if (!points.some((p) => p <= Math.max(150, total * 0.2))) {
    for (const tier of [tier1, tier2]) {
      const i = blocks.findIndex((_, k) => tier(k) && !near(k));
      if (i >= 0) { chosen.push({ i, role: "hero" }); points.push(cum[i]); left--; break; }
    }
  }
  // Các ảnh còn lại: lấp khoảng trống lớn nhất (theo số chữ) bằng đoạn văn gần giữa khoảng đó nhất, ưu tiên đoạn đầu mục.
  while (left > 0) {
    const edges = [0, ...points.sort((a, b) => a - b), total];
    const gaps = edges.slice(1).map((e, k) => ({ size: e - edges[k], mid: (e + edges[k]) / 2 })).sort((a, b) => b.size - a.size);
    let done = false;
    for (const g of gaps) {
      const i = pick(g.mid, minGap) ?? pick(g.mid, 0);
      if (i !== null) { chosen.push({ i, role: "section" }); points.push(cum[i]); left--; done = true; break; }
    }
    if (!done) break;
  }
  return chosen.sort((a, b) => a.i - b.i).map(({ i, role }) => {
    const next = blocks[i + 1];
    const ctx = [blocks[i].text, next && ["para", "list"].includes(next.kind) ? next.text : ""].filter(Boolean).join("\n\n").replace(/[#*_`>|]+/g, " ").replace(/\s+/g, " ").trim();
    return { after: i, role, heading: role === "hero" ? title : headingOf[i] || title, context: ctx.slice(0, 900), offset: cum[i] };
  });
}

// ---------------- Alt text, tên tệp ----------------
export function seoSlug(s: string, max = 60): string {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
}
const plain = (s: string) => seoSlug(s, 200).replace(/-/g, " ");
/** Alt text: 1 câu mô tả đúng ảnh, ≤ 125 ký tự; ảnh đầu bài luôn chứa từ khoá chính (các ảnh khác mô tả mục của mình, không nhồi từ khoá). */
export function seoAlt(raw: string, slot: Pick<SeoSlot, "role" | "heading">, keyword: string): string {
  let alt = String(raw ?? "").replace(/[\[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!alt) alt = `Minh họa ${slot.heading}`;
  if (slot.role === "hero" && keyword && !plain(alt).includes(plain(keyword))) alt = `${keyword}: ${alt}`;
  if (alt.length > ALT_MAX) alt = alt.slice(0, ALT_MAX - 1).replace(/\s+\S*$/, "").replace(/[,:;\-–]+$/, "") + "…";
  return alt;
}

// ---------------- Ảnh đang có trong bài ----------------
const assetOf = (id: string): Row | undefined => {
  const a = byId<Row>("creative_asset", id);
  return a && a.kind === "image" && a.path && existsSync(a.path) ? a : undefined;
};
/** Bỏ ảnh hỏng (tệp đã mất) — và mọi ảnh /v1/media nếu `replaceAll`. */
function prepare(body: string, replaceAll: boolean) {
  const { header, md } = splitSeoBody(body);
  const blocks = parseBlocks(md).filter((b) => {
    if (b.kind !== "image") return true;
    const m = IMG_RE.exec(b.text.trim());
    return !replaceAll && !!m && !!assetOf(m[2]);
  });
  return { header, blocks };
}
export type SeoImageRef = { id: string; alt: string; heading: string; afterWords: number };
export function seoImageStatus(ci: Row) {
  const { blocks } = prepare(String(ci.body ?? ""), false);
  const words = blocks.reduce((a, b) => a + b.words, 0);
  const required = requiredImages(words);
  const images: SeoImageRef[] = [];
  let h = "";
  let acc = 0;
  for (const b of blocks) {
    acc += b.words;
    if (b.kind === "heading") h = headingText(b);
    if (b.kind === "image") { const m = IMG_RE.exec(b.text.trim())!; images.push({ id: m[2], alt: m[1], heading: h, afterWords: acc }); }
  }
  return { words, required, have: images.length, missing: Math.max(0, required - images.length), images };
}
/** Ảnh đại diện của bài = ảnh đầu tiên trong thân bài (khớp bản Sếp đã sửa). */
export function syncSeoFeatured(contentItemId: string) {
  const ci = byId<Row>("content_item", contentItemId);
  if (!isSeoArticle(ci)) return;
  const first = seoImageStatus(ci!).images[0]?.id ?? null;
  if ((ci!.asset_id ?? null) !== first) update("content_item", ci!.id, { asset_id: first });
}

// ---------------- Tạo ảnh ----------------
const PALETTES = [
  "xanh navy #0F3D6E, xanh ngọc #1BA6A0, vàng #F6B93B, nền trắng ngà #F7F5EF",
  "tím than #2D2A6E, cam san hô #FF7A59, hồng nhạt #FFD6CC, nền kem #FBF6EE",
  "xanh lá đậm #14532D, xanh mint #6EE7B7, vàng nghệ #F59E0B, nền trắng #F8FAF7",
  "xanh dương #1D4ED8, xanh trời nhạt #BFDBFE, cam #FB923C, nền xám nhạt #F3F4F6",
];
const paletteOf = (id: string) => PALETTES[createHash("sha256").update(id).digest()[0] % PALETTES.length];
const dataDir = () => resolve(process.cwd(), "data");
const articleDir = (bizId: string, ciId: string) => join(dataDir(), "creative", "seo-images", bizId.replace(/[^a-z0-9_-]/gi, "_"), ciId.replace(/[^a-z0-9_-]/gi, "_"));

type Gen = { bizId: string; ci: Row; dna: Dna | undefined; keyword: string; title: string; engine: ImageEngine; total: number; palette: string; dir: string; taskRunId?: string; note?: string };
async function makeOne(g: Gen, slot: SeoSlot, n: number): Promise<{ assetId: string; alt: string }> {
  const pseudo = { id: g.ci.id, biz_id: g.bizId, title: slot.role === "hero" ? g.title : slot.heading, body: slot.context, channel: "website" } as Row;
  const extra = [
    `ĐÂY LÀ ẢNH MINH HOẠ TRONG BÀI BLOG CHUẨN SEO của website (không phải bài mạng xã hội). Chủ đề bài: "${g.title}". Từ khoá chính: "${g.keyword}".`,
    slot.role === "hero" ? "Đây là ẢNH ĐẦU BÀI (ảnh đại diện): phải nói lên chủ đề của cả bài." : `Ảnh này nằm dưới mục "${slot.heading}": phải minh hoạ đúng ý của mục đó, không lặp lại ảnh đầu bài.`,
    `Cả ${g.total} ảnh trong bài dùng CÙNG một phong cách minh hoạ phẳng và bảng màu: ${g.palette}.`,
  ];
  let base = `${seoSlug(g.keyword, 40) || "bai-seo"}-${slot.role === "hero" ? "anh-dau-bai" : seoSlug(slot.heading, 40) || "minh-hoa"}-${n}`;
  for (let k = 2; existsSync(join(g.dir, `${base}.jpg`)) || existsSync(join(g.dir, `${base}.png`)); k++) base = `${base.replace(/-v\d+$/, "")}-v${k}`;
  const png = join(g.dir, `${base}.png`);
  // Cùng công cụ với ảnh bài viết (Cài đặt → Tạo ảnh bằng): Claude thiết kế / ChatGPT vẽ / Gemini trên Flow, có dự phòng.
  const made = await makeAiImage({ bizId: g.bizId, ci: pseudo, dna: g.dna, note: g.note, frame: SEO_IMAGE, extra, png, taskRunId: g.taskRunId });
  if (!existsSync(png) || statSync(png).size < 2000) throw new AppError("RENDER_FAILED", "Không xuất được tệp ảnh", 502);
  const file = toJpeg(png);
  const alt = seoAlt(made.alt ?? "", slot, g.keyword);
  const size = imageSize(file.path);
  const asset = insert("creative_asset", {
    biz_id: g.bizId, job_id: null, kind: "image", path: file.path, mime: file.mime, width: size?.width ?? null, height: size?.height ?? null, size: statSync(file.path).size,
    meta: { source: "ai", seo: true, engine: made.engine, model: made.model, ...(made.fallbackFrom ? { fallbackFrom: made.fallbackFrom, fallbackError: made.fallbackError } : {}), role: slot.role, heading: slot.heading, alt, filename: basename(file.path), contentItemId: g.ci.id },
  });
  return { assetId: asset.id, alt };
}

const progress = new Map<string, { done: number; total: number }>();
export type SeoImageResult = { words: number; required: number; have: number; made: number; failed: number; skipped?: "kind" | "no_ai"; errors: string[] };

/**
 * Bảo đảm bài SEO đủ ảnh (4 ảnh / 1000 chữ). Chỉ tạo phần còn thiếu; `replaceAll` bỏ ảnh cũ và tạo lại toàn bộ.
 * Ném lỗi khi bài đã lên lịch / đã đăng hoặc không có kết nối AI; lỗi từng ảnh chỉ được gom vào `errors`.
 */
export async function ensureSeoImages(bizId: string, contentItemId: string, opts: { taskRunId?: string; actor?: string; replaceAll?: boolean; note?: string } = {}): Promise<SeoImageResult> {
  const ci = byId<Row>("content_item", contentItemId);
  if (!ci || ci.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
  if (!isSeoArticle(ci)) return { words: 0, required: 0, have: 0, made: 0, failed: 0, skipped: "kind", errors: [] };
  if (isLocked(ci)) throw new AppError("INVALID_STATE", "Bài đã lên lịch / đã đăng — không đổi ảnh được nữa", 409);
  if (progress.has(ci.id)) throw new AppError("BUSY", "Bài này đang được tạo ảnh — chờ xong rồi thử lại", 409);
  const { engine, reason } = postImageEngine(bizId);
  const startBody = String(ci.body ?? "");
  const { blocks } = prepare(startBody, !!opts.replaceAll);
  const words = blocks.reduce((a, b) => a + b.words, 0);
  const required = requiredImages(words);
  const existing = blocks.filter((b) => b.kind === "image").length;
  if (!engine) {
    if (opts.actor) throw new AppError("IMAGE_AI_OFF", reason ?? "Chưa có kết nối AI để tạo ảnh", 400);
    return { words, required, have: existing, made: 0, failed: 0, skipped: "no_ai", errors: [] };
  }
  const title = publicTitle(ci.title);
  const keyword = keywordOf(ci);
  const slots = planSlots(blocks, required - existing, title);
  if (!slots.length) return { words, required, have: existing, made: 0, failed: 0, errors: required > existing ? ["Bài quá ít đoạn để đặt thêm ảnh mà không dồn ảnh — viết thêm nội dung rồi tạo ảnh còn thiếu"] : [] };

  const dir = articleDir(bizId, ci.id);
  mkdirSync(dir, { recursive: true });
  const g: Gen = { bizId, ci, dna: activeDna(bizId)?.data as Dna | undefined, keyword, title, engine, total: required, palette: paletteOf(ci.id), dir, taskRunId: opts.taskRunId, note: opts.note };
  const done: ({ assetId: string; alt: string } | null)[] = slots.map(() => null);
  const errors: string[] = [];
  let finished = 0;
  let aborted = false;
  progress.set(ci.id, { done: 0, total: slots.length });
  emit(bizId, "content.image_progress", { contentItemId: ci.id, done: 0, total: slots.length });
  try {
    let next = 0;
    const worker = async () => {
      for (;;) {
        const k = next++;
        if (k >= slots.length || aborted) return;
        for (let attempt = 1; attempt <= ATTEMPTS && !aborted; attempt++) {
          try { done[k] = await makeOne(g, slots[k], existing + k + 1); break; }
          catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn("seo_image.failed", { contentItemId: ci.id, slot: k, attempt, error: msg.slice(0, 300) });
            if (attempt === ATTEMPTS) errors.push(msg.slice(0, 300));
          }
        }
        finished++;
        progress.set(ci.id, { done: finished, total: slots.length });
        emit(bizId, "content.image_progress", { contentItemId: ci.id, done: finished, total: slots.length });
        // 2 ảnh đầu đều hỏng hẳn → kết nối AI đang có vấn đề, dừng sớm thay vì lặp lại lỗi cho từng ảnh.
        if (finished >= 2 && done.every((d) => d === null)) aborted = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(POOL, slots.length) }, worker));
  } finally { progress.delete(ci.id); }

  // Chèn ảnh vào bản MỚI NHẤT của bài (Sếp có thể vừa sửa chữ trong lúc tạo ảnh): bài đổi thì lập lại vị trí trên bản mới.
  const made = done.filter((d): d is { assetId: string; alt: string } => d !== null);
  if (made.length) {
    const fresh = byId<Row>("content_item", ci.id) ?? ci;
    const prep = prepare(String(fresh.body ?? ""), !!opts.replaceAll);
    const places = String(fresh.body ?? "") === startBody ? slots.filter((_, k) => done[k]).map((s) => s.after) : planSlots(prep.blocks, made.length, title).map((s) => s.after);
    const out: SeoBlock[] = [];
    prep.blocks.forEach((b, i) => {
      out.push(b);
      const k = places.indexOf(i);
      if (k >= 0 && made[k]) out.push({ kind: "image", text: `![${made[k].alt}](/v1/media/${made[k].assetId})`, words: 0 });
    });
    update("content_item", ci.id, { body: prep.header + render(out) });
    syncSeoFeatured(ci.id);
    audit(bizId, opts.actor ?? "content", "content.seo_images_created", { type: "content_item", id: ci.id }, { made: made.length, failed: slots.length - made.length, required, words, engine, replaceAll: !!opts.replaceAll });
    // Bài đã đăng lên WordPress → cập nhật luôn bài trên website (thêm ảnh, ảnh đại diện), không tạo bài mới.
    if (ci.status === "published" && liveWebsitePost(ci)) {
      try {
        const { updateWebsitePost } = await import("./publishing.ts"); // nạp muộn: publishing.ts dùng lại seo-images
        await updateWebsitePost(ci.id, opts.actor ?? "content");
      } catch (e) {
        errors.push(`Đã tạo ảnh nhưng chưa cập nhật được bài trên website: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
        emit(bizId, "alert.raised", { level: "warning", text: `Bài SEO "${ci.title}": ${errors.at(-1)}`, category: "publish", key: `webupd:${ci.id}`, href: `/content?id=${ci.id}` });
      }
    }
  }
  const after = seoImageStatus(byId<Row>("content_item", ci.id) ?? ci);
  emit(bizId, "content.image", { contentItemId: ci.id, assetId: byId<Row>("content_item", ci.id)?.asset_id ?? null, title: ci.title });
  if (after.missing > 0) emit(bizId, "alert.raised", { level: "warning", text: `Bài SEO "${ci.title}" mới có ${after.have}/${after.required} ảnh${errors[0] ? ` — ${errors[0]}` : ""}`, category: "content", key: `seo-images:${ci.id}`, href: `/content?id=${ci.id}` });
  return { words: after.words, required: after.required, have: after.have, made: made.length, failed: slots.length - made.length, errors };
}

/**
 * Bài website lọt thành "bài mạng xã hội" (bản cũ: agent viết bài giao kênh website → social_post, chỉ 1 ảnh) → chuyển thành bài
 * SEO (bỏ dòng hashtag, thêm Meta + Từ khóa) và xếp tạo bù ảnh theo quy tắc 4 ảnh / 1000 chữ (tối thiểu 4). Bài đã lên
 * WordPress cũng làm (tạo ảnh xong tự cập nhật bài trên website). Bài đã đăng nơi khác / đã huỷ thì để nguyên. Chạy lúc khởi
 * động + bộ canh 5 phút; chạy lại an toàn (chỉ xét social_post kênh website).
 */
export function upgradeWebsitePosts(): number {
  let n = 0;
  for (const ci of q.all<Row>("SELECT * FROM content_item WHERE kind = 'social_post' AND channel = 'website' AND status IN ('in_review','awaiting_approval','approved','manual_publish','published')")) {
    if (ci.status === "published" && !liveWebsitePost(ci)) continue;
    const lines = String(ci.body ?? "").trim().split("\n");
    while (lines.length && /^(\s*#[\p{L}\p{N}_]+\s*)+$/u.test(lines.at(-1)!)) lines.pop(); // dòng hashtag cuối bài
    const text = lines.join("\n").trim();
    const meta = text.replace(/\s+/g, " ").slice(0, 155);
    update("content_item", ci.id, { kind: "seo_article", body: `Meta: ${meta}\nTừ khóa: ${publicTitle(ci.title).slice(0, 120)}\n\n${text}` });
    audit(ci.biz_id, "content", "content.upgraded_to_seo", { type: "content_item", id: ci.id }, { from: "social_post", status: ci.status });
    n++;
    // Đang chờ duyệt / đã duyệt / đã lên website → tạo bù ảnh ngay (ưu tiên). Còn đang chấm thì bước hoàn thiện tự tạo đủ ảnh.
    if (ci.status !== "in_review") {
      try { queueSeoImages(ci.biz_id, ci.id, { actor: "system" }); }
      catch (e) { logger.warn("seo.upgrade_images_failed", { contentItemId: ci.id, error: String(e).slice(0, 200) }); }
    }
  }
  return n;
}

/** Bài SEO còn thiếu ảnh so với quy tắc (4 ảnh / 1000 chữ, tối thiểu 4) → lý do để chặn duyệt; đủ thì null. */
export function seoImagesShortReason(ci: Row | undefined | null): string | null {
  if (!ci || !isSeoArticle(ci)) return null;
  const st = seoImageStatus(ci);
  return st.missing > 0 ? `Bài SEO mới có ${st.have}/${st.required} ảnh (quy tắc 4 ảnh / 1000 chữ, tối thiểu ${SEO_MIN_IMAGES}) — bấm "Tạo ảnh còn thiếu" rồi duyệt` : null;
}

/** Xếp việc tạo ảnh còn thiếu / tạo lại toàn bộ chạy nền (mất vài phút) — giao diện nhận tiến độ qua sự kiện content.image_progress. */
export function queueSeoImages(bizId: string, contentItemId: string, opts: { replaceAll?: boolean; note?: string; actor?: string } = {}) {
  const ci = byId<Row>("content_item", contentItemId);
  if (!ci || ci.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy nội dung", 404);
  if (!isSeoArticle(ci)) throw new AppError("NOT_SUPPORTED", "Chỉ bài SEO mới có bộ ảnh theo số chữ", 400);
  if (isLocked(ci)) throw new AppError("INVALID_STATE", "Bài đã lên lịch / đã đăng — không đổi ảnh được nữa", 409);
  const { engine, reason } = postImageEngine(bizId);
  if (!engine) throw new AppError("IMAGE_AI_OFF", reason ?? "Chưa có kết nối AI để tạo ảnh", 400);
  if (progress.has(ci.id) || q.get("SELECT id FROM job WHERE name = 'seo.images' AND status IN ('queued','running') AND json_extract(payload, '$.contentItemId') = ?", ci.id)) throw new AppError("BUSY", "Bài này đang được tạo ảnh — chờ xong rồi thử lại", 409);
  // Sếp bấm → hàng đợi ẢNH (không chờ sau các agent viết bài) và được ưu tiên chạy trước việc tạo ảnh tự động.
  enqueue("image", "seo.images", { contentItemId: ci.id, replaceAll: !!opts.replaceAll, note: opts.note ?? null, actor: opts.actor ?? "ceo" }, { bizId, idempotencyKey: `seo-images:${ci.id}:${Date.now()}`, lockKey: `seo-images:${ci.id}`, maxAttempts: 1, priority: true });
  emit(bizId, "content.image_progress", { contentItemId: ci.id, done: 0, total: 0 });
  return { queued: true };
}

/** Thông tin bộ ảnh của bài SEO cho giao diện (mục Duyệt, trang Nội dung). */
export function seoImagesView(ci: Row | undefined | null) {
  if (!ci || !isSeoArticle(ci)) return null;
  const st = seoImageStatus(ci);
  const eng = postImageEngine(ci.biz_id);
  const prog = progress.get(ci.id);
  const queued = q.get("SELECT id FROM job WHERE name = 'seo.images' AND status IN ('queued','running') AND json_extract(payload, '$.contentItemId') = ?", ci.id);
  return {
    supported: true, words: st.words, required: st.required, have: st.have, missing: st.missing, wordsPerImage: SEO_WORDS_PER_IMAGE, minImages: SEO_MIN_IMAGES,
    engine: eng.engine, engineReason: eng.reason ?? null, locked: isLocked(ci), liveUrl: ci.status === "published" ? liveWebsitePost(ci) : null, busy: Boolean(prog || queued), progress: prog ?? null,
    images: st.images.map((x) => { const a = assetOf(x.id)!; return { id: x.id, alt: x.alt, heading: x.heading, afterWords: x.afterWords, width: a.width, height: a.height, filename: a.meta?.filename ?? basename(a.path), role: a.meta?.role ?? null, source: a.meta?.source ?? "ai" }; }),
  };
}
