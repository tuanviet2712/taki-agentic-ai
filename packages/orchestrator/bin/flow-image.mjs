#!/usr/bin/env node
// taki-flow-image — tạo 1 ảnh bằng Gemini (Nano Banana) trên Google Flow rồi tải bản gốc về máy. Không cần AI điều khiển:
// làm đúng thao tác của người dùng trong MỘT TAB RIÊNG của Chrome Flow (CDP) — mở dự án ảnh (hoặc tạo dự án mới), chuyển chế độ
// Image + tỉ lệ + model + x1, dán prompt, bấm tạo, chờ ảnh MỚI xuất hiện trên lưới, mở ảnh → "Download media" → "1K Original size".
//   taki-flow-image --prompt-file <tệp chữ> --out <tệp ảnh> [--aspect 16:9|4:3|1:1|3:4|9:16] [--model "Nano Banana 2.1"] [--project <link dự án>]
// In 1 dòng JSON: { file, projectUrl, model, aspect, ms } hoặc { error, projectUrl? } (mã thoát 1).
import { readFileSync, statSync } from "node:fs";
import { chromium } from "playwright-core";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const promptFile = arg("--prompt-file");
const out = arg("--out");
const aspect = arg("--aspect", "16:9");
const model = arg("--model", "");
let projectUrl = arg("--project", "") || null;
const cdp = arg("--cdp", `http://127.0.0.1:${process.env.FLOW_CDP_PORT ?? 9333}`);
const FLOW = "https://flow.google.com";
if (!promptFile || !out || !["16:9", "4:3", "1:1", "3:4", "9:16"].includes(aspect)) {
  console.error("Dùng: taki-flow-image --prompt-file <tệp> --out <ảnh> [--aspect 16:9|4:3|1:1|3:4|9:16] [--model \"Nano Banana 2.1\"] [--project <link>]");
  process.exit(2);
}
const prompt = readFileSync(promptFile, "utf8").trim();
const t0 = Date.now();
const fail = (error) => { console.log(JSON.stringify({ error: String(error).slice(0, 400), projectUrl })); process.exit(1); };
const ERR = /(couldn'?t generate|could not generate|violat|policy|something went wrong|đã xảy ra lỗi|không thể tạo|out of credits|not enough credits|hết tín dụng|quota|try again later)/i;

const b = await chromium.connectOverCDP(cdp, { timeout: 15_000 }).catch((e) => fail(`Không nối được Chrome Flow (${cdp}): ${e.message}`));
const tab = await b.contexts()[0].newPage();
try {
  const start = () => tab.getByRole("button", { name: "Start generation" });
  const overlay = () => tab.locator(".cdk-overlay-container");
  // 1. Dự án ảnh: mở dự án đã lưu; không mở được (đã xoá / mất quyền) → tạo dự án mới.
  if (projectUrl) {
    await tab.goto(projectUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const ok = await start().waitFor({ timeout: 45_000 }).then(() => /\/project\//.test(tab.url())).catch(() => false);
    if (!ok) projectUrl = null;
  }
  if (!projectUrl) {
    await tab.goto(FLOW, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await tab.getByRole("button", { name: /New project|Dự án mới/i }).first().click({ timeout: 45_000 });
    await tab.waitForURL(/\/project\//, { timeout: 45_000 });
    await start().waitFor({ timeout: 45_000 });
    projectUrl = tab.url().split("?")[0].replace(/\/(edit|tool)\/.*$/, "");
  }
  // 2. Cài đặt tạo: Image · tỉ lệ · model · x1.
  await tab.getByRole("button", { name: /Settings trigger/i }).first().click();
  await overlay().getByRole("radio", { name: /\bImage\b/ }).first().click({ timeout: 15_000 });
  await tab.waitForTimeout(500);
  await overlay().getByRole("radio", { name: new RegExp(`(^|\\s)${aspect}$`) }).first().click({ timeout: 10_000 });
  let usedModel = null;
  if (model) {
    const trigger = overlay().getByRole("button", { name: /Select model family/i }).first();
    const current = (await trigger.innerText().catch(() => "")).replace(/\s+/g, " ");
    if (current.includes(model)) usedModel = model; // đã đúng model
    else {
      await trigger.click({ timeout: 10_000 }).catch(() => {});
      await tab.waitForTimeout(500);
      // Menu model mở sau cùng trong lớp phủ → lấy mục KHỚP CUỐI CÙNG (mục đầu là chính nút đang hiện tên model).
      const opts = overlay().locator("button, [role=menuitem], [role=option], [role=menuitemradio]").filter({ hasText: model });
      const n = await opts.count();
      if (n) { await opts.nth(n - 1).click({ timeout: 10_000 }); usedModel = model; }
      else await tab.keyboard.press("Escape"); // model không có trong danh sách → giữ model đang chọn
      await tab.waitForTimeout(400);
    }
  }
  const x1 = overlay().getByRole("radio", { name: /^x1$/ }).first();
  if (await x1.isVisible().catch(() => false)) await x1.click();
  await tab.keyboard.press("Escape");
  await tab.waitForTimeout(400);
  const chip = (await tab.getByRole("button", { name: /Settings trigger/i }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
  // Chế độ ảnh: nút cài đặt hiện tên model ảnh (vd "🍌 Nano Banana 2.1 crop_16_9 x1"); chế độ video hiện "Video · 720p · 8s".
  if (/\bVideo\b|\b\d+s\b|720p|360p/i.test(chip)) throw new Error(`Không chuyển được sang chế độ tạo ảnh (đang: ${chip})`);
  // 3. Ảnh đã có trên lưới (để nhận ra ảnh MỚI) + chữ lỗi đang có sẵn trên trang.
  const tiles = () => tab.evaluate(() => [...document.querySelectorAll("flow-image-tile img")].filter((i) => i.complete && i.naturalWidth >= 200).map((i) => i.src.split("?")[0]));
  const before = new Set(await tiles());
  const baseErr = new Set((await tab.evaluate(() => document.body.innerText)).split("\n").filter((l) => ERR.test(l)));
  // 4. Dán prompt, bấm tạo.
  const box = tab.locator('[contenteditable="true"]').last();
  await box.click();
  await tab.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await tab.keyboard.press("Delete");
  await box.fill(prompt);
  await start().click();
  // 5. Chờ ảnh mới (tối đa 5 phút).
  let fresh = null;
  for (let i = 0; i < 100 && !fresh; i++) {
    await tab.waitForTimeout(3_000);
    fresh = (await tiles()).find((s) => !before.has(s)) ?? null;
    if (!fresh) {
      const errLine = (await tab.evaluate(() => document.body.innerText)).split("\n").find((l) => ERR.test(l) && !baseErr.has(l) && l.length < 240);
      if (errLine) throw new Error(`Flow báo lỗi: ${errLine.trim()}`);
    }
  }
  if (!fresh) throw new Error("Quá 5 phút Flow chưa tạo xong ảnh");
  // 6. Mở ảnh mới → tải bản gốc.
  await tab.locator(`flow-image-tile:has(img[src^="${fresh}"])`).first().click();
  await tab.waitForURL(/\/edit\//, { timeout: 20_000 });
  await tab.getByRole("button", { name: "Download media" }).first().click();
  const size = overlay().getByText(/Original size|Kích thước gốc|1K/i).first();
  await size.waitFor({ timeout: 10_000 });
  const [dl] = await Promise.all([tab.waitForEvent("download", { timeout: 120_000 }), size.click()]);
  await dl.saveAs(out);
  if (statSync(out).size < 2_000) throw new Error("Tệp ảnh tải về rỗng");
  console.log(JSON.stringify({ file: out, projectUrl, model: usedModel, aspect, ms: Date.now() - t0 }));
} catch (e) {
  await tab.close().catch(() => {});
  await b.close().catch(() => {});
  fail(e instanceof Error ? e.message : e);
}
await tab.close().catch(() => {});
await b.close().catch(() => {});
