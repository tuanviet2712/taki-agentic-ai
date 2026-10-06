#!/usr/bin/env node
// taki-flow-save — save the clips a Flow Tool is showing straight from the page (Chrome Flow, via CDP).
// Flow custom Tools run in an iframe sandboxed WITHOUT allow-downloads, so their "TẢI VỀ" buttons are blocked
// by Chrome; the clips are already in the page as <video> elements (data:/blob:/https URLs). Saved in on-page
// order (= scene order in the SẢN XUẤT step) as scene_01.mp4, scene_02.mp4…
//   taki-flow-save --out <dir> [--prefix scene_] [--cdp http://127.0.0.1:9333]
//   taki-flow-save --one <file.mp4>  → trình tạo video THƯỜNG của Flow (không Tool): lưu ĐÚNG 1 clip đang mở/lớn nhất trên
//     trang dự án vào file chỉ định (mở thẻ cảnh k rồi chạy với scene_0k.mp4). Video nằm ở máy chủ Google (khác nguồn):
//     tải bằng phiên đăng nhập của Chrome Flow (context.request), không bị CORS chặn.
//   taki-flow-save --images <n> --out <dir> [--prefix image_]   → up to n large images (≥ 400px) currently shown on
//     the Flow tab, top-to-bottom, as image_01.png … — e.g. a KOC / background image just generated on the project
//     page, so it can be uploaded into a Tool's file input. The page also shows decorative images: Read the files
//     and pick the right one.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const one = arg("--one");
const out = arg("--out");
const images = Number(arg("--images", "0")) || 0;
const prefix = arg("--prefix", images ? "image_" : "scene_");
const cdp = arg("--cdp", `http://127.0.0.1:${process.env.FLOW_CDP_PORT ?? 9333}`);
if (!out && !one) { console.error("Dùng: taki-flow-save --out <thư mục> [--prefix scene_]  |  taki-flow-save --one <file.mp4>"); process.exit(2); }

const b = await chromium.connectOverCDP(cdp, { timeout: 15_000 });
try {
  const pages = b.contexts().flatMap((c) => c.pages());
  const isFlow = (u) => u.includes("flow.google") || u.includes("labs.google/fx");
  const page = one
    ? pages.filter((p) => isFlow(p.url()) && !p.url().includes("/tool/")).at(-1) ?? pages.find((p) => isFlow(p.url()))
    : pages.find((p) => p.url().includes("/tool/")) ?? pages.find((p) => isFlow(p.url()));
  if (!page) throw new Error("Không thấy tab Flow trong Chrome Flow");
  /** Tải 1 URL video: trong trang (data:/blob:/cùng nguồn) — không được thì qua phiên đăng nhập của trình duyệt. */
  const fetchVideo = async (frame, src) => {
    const inPage = await frame.evaluate(async (u) => {
      try {
        if (u.startsWith("data:")) return u.slice(u.indexOf(",") + 1);
        const buf = new Uint8Array(await (await fetch(u)).arrayBuffer());
        let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      } catch { return null; }
    }, src).catch(() => null);
    if (inPage) return Buffer.from(inPage, "base64");
    if (!/^https?:/.test(src)) return null;
    const r = await page.context().request.get(src, { timeout: 120_000 });
    return r.ok() ? Buffer.from(await r.body()) : null;
  };
  if (one) {
    // Clip lớn nhất đang hiển thị (thẻ cảnh vừa mở / trình phát) — đúng cảnh agent đang xem.
    let best = null;
    for (const f of page.frames()) {
      const vids = await f.evaluate(() => [...document.querySelectorAll("video")].map((v) => {
        const r = v.getBoundingClientRect();
        return { src: v.currentSrc || v.src || v.querySelector("source")?.src || "", area: Math.max(0, r.width) * Math.max(0, r.height), dur: v.duration || 0 };
      })).catch(() => []);
      for (const v of vids) if (v.src && (!best || v.area > best.area)) best = { ...v, frame: f };
    }
    if (!best) throw new Error("Trang chưa có video nào đang hiển thị — mở thẻ cảnh cần lưu trước");
    const buf = await fetchVideo(best.frame, best.src);
    if (!buf?.length) throw new Error(`Không tải được video (${best.src.slice(0, 60)}…) — thử menu ⋮ → Tải xuống 720p`);
    mkdirSync(dirname(one), { recursive: true });
    writeFileSync(one, buf);
    console.log(JSON.stringify({ file: one, bytes: buf.length, durationOnPage: best.dur }, null, 2));
    process.exit(0);
  }
  if (images) {
    const got = [];
    for (const f of page.frames()) {
      got.push(...(await f.evaluate(async () => {
        const toB64 = (buf) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
        const out = [];
        for (const img of document.querySelectorAll("img")) {
          if (img.naturalWidth < 400 || img.naturalHeight < 400 || !img.currentSrc) continue;
          try {
            const src = img.currentSrc;
            const b64 = src.startsWith("data:") ? src.slice(src.indexOf(",") + 1) : toB64(await (await fetch(src)).arrayBuffer());
            out.push({ src: src.slice(0, 80), b64, w: img.naturalWidth, h: img.naturalHeight });
          } catch (e) { /* cross-origin without CORS: skip */ }
        }
        return out;
      }).catch(() => [])));
    }
    mkdirSync(out, { recursive: true });
    const seen = new Set(), saved = [];
    for (const g of got) {
      const key = `${g.b64.length}:${g.b64.slice(-64)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const file = join(out, `${prefix}${String(seen.size).padStart(2, "0")}.png`);
      writeFileSync(file, Buffer.from(g.b64, "base64"));
      saved.push({ file, width: g.w, height: g.h });
      if (saved.length >= images) break;
    }
    console.log(JSON.stringify({ count: saved.length, images: saved }, null, 2));
    process.exit(saved.length ? 0 : 1);
  }
  const clips = [];
  for (const f of page.frames()) {
    // Read each video as base64 inside the page (works for data:, blob: and same-origin URLs).
    const got = await f.evaluate(async () => {
      const toB64 = (buf) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
      const out = [];
      for (const v of document.querySelectorAll("video")) {
        const src = v.currentSrc || v.src || v.querySelector("source")?.src || "";
        if (!src) continue;
        try {
          if (src.startsWith("data:")) out.push({ src: src.slice(0, 40), b64: src.slice(src.indexOf(",") + 1) });
          else out.push({ src: src.slice(0, 80), b64: toB64(await (await fetch(src)).arrayBuffer()) });
        } catch (e) { out.push({ src: src.slice(0, 80), error: String(e) }); }
      }
      return out;
    }).catch(() => []);
    clips.push(...got);
  }
  if (!clips.length) throw new Error("Trang Tool chưa có video nào (đã ở bước SẢN XUẤT và các cảnh đã xong chưa?)");
  mkdirSync(out, { recursive: true });
  const saved = [];
  const seen = new Set();
  for (const c of clips) {
    if (c.error) { saved.push({ error: c.error, src: c.src }); continue; }
    const key = `${c.b64.length}:${c.b64.slice(-64)}`;
    if (seen.has(key)) continue; // same clip rendered twice (preview + list)
    seen.add(key);
    const file = join(out, `${prefix}${String(seen.size).padStart(2, "0")}.mp4`);
    const buf = Buffer.from(c.b64, "base64");
    writeFileSync(file, buf);
    saved.push({ file, bytes: buf.length });
  }
  console.log(JSON.stringify({ count: saved.filter((s) => s.file).length, clips: saved }, null, 2));
} finally {
  await b.close().catch(() => {});
}
