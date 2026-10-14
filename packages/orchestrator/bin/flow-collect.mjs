#!/usr/bin/env node
// taki-flow-collect — tải TẤT CẢ clip của luồng "Làm thủ công trên Flow" từ dự án Flow về máy, đúng thứ tự cảnh, không cần AI.
// Lưới dự án Flow không có thẻ <video> (ảnh thu nhỏ + trình phát vẽ lên canvas) nên không lấy clip thẳng từ trang được: lệnh này
// làm đúng thao tác của người dùng trong MỘT TAB RIÊNG của Chrome Flow — mở từng video, đọc câu thoại trong prompt
// ("saying exactly: …") để biết video thuộc cảnh nào trong plan.json, bấm "Download media" → "720p Original size" và lưu
// thành scene_NN.mp4. Lưới xếp mới nhất trước → cảnh có nhiều bản (làm lại) lấy bản MỚI NHẤT. Không tạo gì, không tốn tín dụng.
//   taki-flow-collect --project <link dự án Flow> --plan <plan.json> --out <thư mục clips> [--only 2,5] [--cdp http://127.0.0.1:9333]
// In JSON: saved [{scene,file,bytes}], missing [số cảnh chưa có video], videos (số video trên lưới).
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const project = arg("--project");
const planPath = arg("--plan");
const out = arg("--out");
const only = (arg("--only", "") || "").split(",").map(Number).filter(Boolean);
const cdp = arg("--cdp", `http://127.0.0.1:${process.env.FLOW_CDP_PORT ?? 9333}`);
if (!project || !planPath || !out || !/^https:\/\/(flow\.google\.com|labs\.google)\/\S*project\//.test(project)) {
  console.error("Dùng: taki-flow-collect --project <https://flow.google.com/project/…> --plan <plan.json> --out <thư mục clips>");
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "");
const want = new Map(plan.scenes.filter((s) => !only.length || only.includes(s.n)).map((s) => [norm(s.voice), s.n]));
const fileFor = (n) => join(out, `scene_${String(n).padStart(2, "0")}.mp4`);
mkdirSync(out, { recursive: true });

const b = await chromium.connectOverCDP(cdp, { timeout: 15_000 }).catch((e) => { console.log(JSON.stringify({ error: `Không nối được Chrome Flow (${cdp}): ${e.message}` })); process.exit(1); });
const tab = await b.contexts()[0].newPage();
const saved = [], seen = [];
let videos = 0;
try {
  const openGrid = async () => {
    await tab.goto(project.replace(/\/(edit|tool)\/.*$/, ""), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await tab.locator("flow-video-tile").first().waitFor({ timeout: 45_000 });
    await tab.waitForTimeout(1500);
  };
  await openGrid();
  videos = await tab.locator("flow-video-tile").count();
  for (let i = 0; i < videos && want.size; i++) {
    if (i > 0) await openGrid();
    await tab.locator("flow-video-tile").nth(i).click();
    await tab.waitForURL(/\/edit\//, { timeout: 20_000 });
    const expand = tab.getByRole("button", { name: "Expand prompt" }).first();
    if (await expand.isVisible().catch(() => false)) await expand.click().catch(() => {});
    await tab.waitForTimeout(800);
    // Câu thoại hệ thống đã chèn: …saying exactly: "<lời>" No captions… — so sánh đã bỏ dấu câu/khoảng trắng.
    const text = await tab.evaluate(() => document.body.innerText);
    const m = /saying exactly:\s*([\s\S]*?)\s*No captions/i.exec(text);
    const said = norm(m?.[1] ?? "");
    const scene = said ? want.get(said) ?? [...want.entries()].find(([v]) => said.includes(v) || v.includes(said))?.[1] : undefined;
    seen.push({ tile: i + 1, scene: scene ?? null, said: (m?.[1] ?? "").slice(0, 60) });
    if (!scene) continue;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await tab.getByRole("button", { name: "Download media" }).first().click();
        const size = tab.locator(".cdk-overlay-container").getByText(/720p|Original size|Kích thước gốc/i).first();
        await size.waitFor({ timeout: 10_000 });
        const [dl] = await Promise.all([tab.waitForEvent("download", { timeout: 120_000 }), size.click()]);
        const file = fileFor(scene);
        await dl.saveAs(file);
        saved.push({ scene, file, bytes: statSync(file).size });
        for (const [v, n] of want) if (n === scene) want.delete(v);
        break;
      } catch (e) {
        await tab.keyboard.press("Escape").catch(() => {});
        if (attempt === 2) seen.at(-1).error = String(e).slice(0, 160);
      }
    }
  }
} catch (e) {
  console.log(JSON.stringify({ error: String(e).slice(0, 300), saved, seen }));
  await tab.close().catch(() => {});
  await b.close().catch(() => {});
  process.exit(1);
}
await tab.close().catch(() => {});
await b.close().catch(() => {});
const missing = [...want.values()].sort((a, b) => a - b);
console.log(JSON.stringify({ videos, saved: saved.sort((a, b) => a.scene - b.scene), missing, seen }, null, 1));
process.exit(missing.length ? 3 : 0);
