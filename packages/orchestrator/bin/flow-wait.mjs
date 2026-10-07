#!/usr/bin/env node
// taki-flow-wait — CHỜ Flow tạo xong ảnh / video trong 1 lệnh (thay cho vòng browser_wait_for 30s + snapshot /
// screenshot / evaluate lặp lại hàng trăm lần — mỗi vòng là 1 lượt AI đọc lại toàn bộ ngữ cảnh, rất chậm).
// Đọc thẳng trang qua CDP (Chrome Flow), không bấm gì, không tốn tín dụng.
//   taki-flow-wait --videos <N> [--max 8]      chờ tới khi trang (cả iframe Tool) có ≥ N video đã nạp xong
//   taki-flow-wait --images <N> [--max 8]      chờ ≥ N ảnh lớn (≥ 400px)
//   taki-flow-wait --text "<chữ>" [--max 8]    chờ tới khi chữ này xuất hiện (vd "4 / 4", "TẠO LẠI", "XONG")
//   taki-flow-wait --gone "<chữ>" [--max 8]    chờ tới khi chữ này biến mất (vd "Đang tạo", "Generating")
// Dừng sớm khi trang báo lỗi / hết tín dụng / chưa đăng nhập. In 1 dòng JSON ngắn: done, đếm hiện tại, tiến độ x/N
// đọc được trên trang, lỗi, số giây đã chờ. Hết --max phút (tối đa 9) mà chưa xong → done:false (gọi lại nếu cần).
import { chromium } from "playwright-core";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const wantVideos = Number(arg("--videos", "0")) || 0;
const wantImages = Number(arg("--images", "0")) || 0;
const text = arg("--text");
const gone = arg("--gone");
const maxMin = Math.min(9, Math.max(0.5, Number(arg("--max", "8")) || 8));
const every = Math.max(5, Number(arg("--every", "10")) || 10) * 1000;
const cdp = arg("--cdp", `http://127.0.0.1:${process.env.FLOW_CDP_PORT ?? 9333}`);
if (!wantVideos && !wantImages && !text && !gone) {
  console.error('Dùng: taki-flow-wait --videos N | --images N | --text "chữ" | --gone "chữ"  [--max phút]');
  process.exit(2);
}
const ERR = /(hết tín dụng|không đủ tín dụng|out of credits|insufficient credits|not enough credits|đăng nhập để tiếp tục|sign in to continue|quota|something went wrong|đã xảy ra lỗi|vi phạm chính sách|policy violation|couldn'?t generate|không thể tạo)/i;
const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

const t0 = Date.now();
const fatal = (e) => { console.log(JSON.stringify({ done: false, error: e instanceof Error ? e.message : String(e), waitedSec: Math.round((Date.now() - t0) / 1000) })); process.exit(1); };
const b = await chromium.connectOverCDP(cdp, { timeout: 15_000 }).catch((e) => fatal(new Error(`Không nối được Chrome Flow (${cdp}): ${e.message}`)));
let last = null;
try {
  const isFlow = (u) => u.includes("flow.google") || u.includes("labs.google/fx");
  const pickPage = () => {
    const pages = b.contexts().flatMap((c) => c.pages()).filter((p) => isFlow(p.url()));
    return pages.find((p) => p.url().includes("/tool/")) ?? pages.at(-1);
  };
  for (;;) {
    const page = pickPage();
    if (!page) throw new Error("Không thấy tab Flow trong Chrome Flow");
    let videos = 0, images = 0, body = "";
    for (const f of page.frames()) {
      const r = await f.evaluate(() => ({
        v: [...document.querySelectorAll("video")].filter((x) => (x.currentSrc || x.src || x.querySelector("source")?.src) && (x.readyState >= 1 || x.duration > 0)).length,
        i: [...document.querySelectorAll("img")].filter((x) => x.complete && x.naturalWidth >= 400 && x.naturalHeight >= 400).length,
        t: document.body?.innerText ?? "",
      })).catch(() => ({ v: 0, i: 0, t: "" }));
      videos += r.v; images += r.i; body += `\n${r.t}`;
    }
    const progress = [...new Set(body.match(/\b\d{1,2}\s*\/\s*\d{1,2}\b(?:\s*(?:clip|cảnh|video|xong))?/gi) ?? [])].slice(0, 4);
    const errLine = body.split("\n").find((l) => ERR.test(l) && l.length < 200)?.trim() ?? null;
    const ok = (!wantVideos || videos >= wantVideos) && (!wantImages || images >= wantImages)
      && (!text || norm(body).includes(norm(text))) && (!gone || !norm(body).includes(norm(gone)));
    last = { done: ok, videos, images, progress, error: errLine, waitedSec: Math.round((Date.now() - t0) / 1000) };
    if (ok || errLine || Date.now() - t0 + every > maxMin * 60_000) break;
    await new Promise((r) => setTimeout(r, every));
  }
} catch (e) {
  await b.close().catch(() => {});
  fatal(e);
} finally {
  await b.close().catch(() => {});
}
if (last && !last.done && !last.error) last.hint = "Chưa xong sau thời gian chờ — gọi lại taki-flow-wait (đừng chụp màn hình để theo dõi).";
console.log(JSON.stringify(last));
