import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { audit, bizSettings, bus, byId, insert, q, update, type Row } from "@dotaka/db";
import { AppError, logger, nowIso, uuidv7 } from "@dotaka/shared";

/**
 * Agentic Brain (vault) — the company's second brain: plain Markdown files in folders (opens in Obsidian as-is), indexed
 * here for search (FTS5, accent-insensitive), [[wikilinks]] + backlinks, the knowledge graph, and for the agents:
 * notes under "10. Tri thức" feed the same retrieval the Chat/Content agents already use.
 * The files are the source of truth; the index is rebuilt from them at any time (scan) and kept fresh by a watcher.
 */
export const BRAIN_ROOT = resolve(process.env.BRAIN_ROOT ?? "data/brain");

/**
 * Folder names — the ONE place they are defined. The layout follows the Agentic AI loop:
 * DNA → thị trường → chiến dịch → nội dung / video → review → đăng & quảng cáo → bán hàng → số liệu → feedback loop.
 */
export const F = {
  overview: "1. Tổng quan", inbox: "2. Hộp thư", logs: "3. Nhật ký vận hành", plan: "4. Mục tiêu & kế hoạch", brand: "5. Thương hiệu & DNA",
  market: "6. Khách hàng & thị trường", campaigns: "7. Chiến dịch", content: "8. Nội dung", video: "9. Video", ads: "10. Quảng cáo",
  sales: "11. Bán hàng & chăm sóc", review: "12. Review & kiểm duyệt", feedback: "13. Feedback loop", metrics: "14. Số liệu & báo cáo",
  knowledge: "15. Tri thức", playbook: "16. Sổ tay quy trình", team: "17. Đội AI", ideas: "18. Ý tưởng & hội thoại", archive: "19. Lưu trữ",
  files: "20. Tệp & hình ảnh",
  // sub-folders the system writes to
  daily: "3. Nhật ký vận hành/Ngày", weekly: "3. Nhật ký vận hành/Tuần", monthly: "3. Nhật ký vận hành/Tháng", reminders: "4. Mục tiêu & kế hoạch/Nhắc việc",
} as const;
export const DASHBOARD_NOTE = `${F.overview}/Bảng điều hành.md`;
/** Top-level folders of a new Agentic Brain (+ sub-folders created up front), with what each is for. */
export const VAULT_FOLDERS: { name: string; about: string; subs?: string[] }[] = [
  { name: F.overview, about: "Bảng điều hành, tiến độ mục tiêu năm, việc chờ Sếp quyết. Hệ thống tự cập nhật." },
  { name: F.inbox, about: "Hộp thư: mọi thứ kéo/dán vào nằm ở đây trước, phân loại sau." },
  { name: F.logs, about: "Nhật ký vận hành: Ngày (tự ghi việc các agent đã làm) · Tuần · Tháng (tự tổng kết).", subs: ["Ngày", "Tuần", "Tháng"] },
  { name: F.plan, about: "Mục tiêu & kế hoạch: OKR, kế hoạch tháng/quý, ngân sách, nhắc việc (ghi chú có `due:` được nhắc đúng giờ).", subs: ["Nhắc việc"] },
  { name: F.brand, about: "Thương hiệu & DNA: định vị, sản phẩm, ưu đãi, giọng nói, claim bị cấm." },
  { name: F.market, about: "Khách hàng & thị trường: chân dung khách, insight & nỗi đau, hồ sơ đối thủ, nghiên cứu thị trường.", subs: ["Chân dung khách hàng", "Đối thủ", "Nghiên cứu"] },
  { name: F.campaigns, about: "Chiến dịch: mỗi chiến dịch một thư mục — brief → nghiên cứu → chiến lược → kết quả." },
  { name: F.content, about: "Nội dung: bài viết đa kênh, bài SEO, lịch đăng, thư viện bài thắng.", subs: ["Bài viết", "SEO", "Thư viện bài thắng"] },
  { name: F.video, about: "Video: kịch bản → video Flow → bản hoàn thiện + caption; kho hook, video viral tham khảo, video thắng.", subs: ["Kịch bản", "Video Flow", "Video tự động", "Ảnh cử động", "Kho hook", "Thư viện video thắng"] },
  { name: F.ads, about: "Quảng cáo: báo cáo Ads, quyết định scale/tắt & lý do, mẫu quảng cáo.", subs: ["Báo cáo", "Quyết định"] },
  { name: F.sales, about: "Bán hàng & chăm sóc: lead nóng, hội thoại đáng chú ý, follow-up Zalo, kịch bản chốt, xử lý từ chối.", subs: ["Kịch bản chốt"] },
  { name: F.review, about: "Review & kiểm duyệt: mục bị chặn & lý do, lỗi hay gặp, bộ tiêu chí chấm.", subs: ["Bị chặn"] },
  { name: F.feedback, about: "Feedback loop: bài học hệ thống rút ra, lý do Sếp từ chối, đề xuất thay đổi, thử nghiệm A/B, góp ý cho Ngân Nguyệt — các agent đọc trước khi làm việc.", subs: ["Bài học", "Sếp từ chối", "Đề xuất thay đổi", "Thử nghiệm"] },
  { name: F.metrics, about: "Số liệu & báo cáo: KPI, phễu bài → quảng cáo → hội thoại → đơn, dữ liệu thô.", subs: ["Dữ liệu thô"] },
  { name: F.knowledge, about: "Tri thức: sản phẩm, chính sách, FAQ — Chat Agent dùng để trả lời khách, Content Agent dùng để viết." },
  { name: F.playbook, about: "Sổ tay quy trình: kỹ năng (skill) của từng nhân viên AI, SOP, thuật ngữ, mẫu ghi chú.", subs: ["Mẫu ghi chú"] },
  { name: F.team, about: "Đội AI: hồ sơ từng agent và Ngân Nguyệt — vai trò, quyền, việc gần đây (tự cập nhật)." },
  { name: F.ideas, about: "Ý tưởng của Sếp và hội thoại với Ngân Nguyệt." },
  { name: F.archive, about: "Lưu trữ: những gì đã xong / không dùng nữa." },
  { name: F.files, about: "Tệp & hình ảnh kéo/dán vào, logo, tài nguyên thương hiệu." },
];
/** Earlier layouts → current folders, applied in order to existing vaults (notes and their ids are kept). */
const LEGACY: [string, string][] = [
  // first layout (00 - Dashboard …)
  ["00 - Dashboard", F.overview], ["01 - Inbox", F.inbox], ["01 - Daily Log", F.daily], ["02 - Weekly Log", F.weekly], ["03 - Monthly Log", F.monthly],
  ["04 - Future Log", F.reminders], ["02 - Identity", F.brand], ["03 - Work", F.campaigns], ["04 - Marketing Engine/Nội dung", `${F.content}/Bài viết`],
  ["04 - Marketing Engine/Video", `${F.video}/Video Flow`], ["04 - Marketing Engine/Quảng cáo", `${F.ads}/Báo cáo`], ["04 - Marketing Engine", F.ideas],
  ["05 - Knowledge", F.knowledge], ["05 - Data Cache", `${F.metrics}/Dữ liệu thô`], ["07 - Learning/Bài học", `${F.feedback}/Bài học`], ["07 - Learning", F.feedback],
  ["08 - Thinking", F.ideas], ["10 - Wiki/Skills", `${F.playbook}/Kỹ năng`], ["10 - Wiki", F.playbook], ["agents", F.team], ["06 - Life", `${F.archive}/Đời sống`],
  ["09 - Archive", F.archive], ["attachments", F.files], ["assets", F.files],
  // second layout (1. Tổng quan … 18. Tệp & hình ảnh)
  ["3. Nhật ký ngày", F.daily], ["4. Tổng kết tuần", F.weekly], ["5. Tổng kết tháng", F.monthly], ["6. Kế hoạch & nhắc việc", F.reminders],
  ["7. Thương hiệu", F.brand], ["8. Dự án", F.campaigns], ["9. Cỗ máy marketing/Nội dung", `${F.content}/Bài viết`], ["9. Cỗ máy marketing/Video", `${F.video}/Video Flow`],
  ["9. Cỗ máy marketing/Quảng cáo", `${F.ads}/Báo cáo`], ["9. Cỗ máy marketing", F.ideas], ["10. Tri thức", F.knowledge], ["11. Dữ liệu", `${F.metrics}/Dữ liệu thô`],
  ["12. Bài học/Từ kết quả", `${F.feedback}/Bài học`], ["12. Bài học", F.feedback], ["13. Ý tưởng & hội thoại", F.ideas], ["14. Sổ tay quy trình", F.playbook],
  ["15. Đội AI", F.team], ["16. Đời sống", `${F.archive}/Đời sống`], ["17. Lưu trữ", F.archive], ["18. Tệp & hình ảnh", F.files],
];
const reEsc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Notes in this folder feed the agents' knowledge retrieval (also what Chat Agent may tell customers — so internal
 *  playbook / skills / brand notes are deliberately NOT included). */
const KNOWLEDGE_RE = new RegExp(`^${reEsc(F.knowledge)}/`);
const IGNORE_DIR = /^(\.|node_modules$)/;

// ---------------- Vaults ----------------
export function listVaults(bizId: string) {
  return q.all<Row>("SELECT * FROM brain_vault WHERE biz_id = ? ORDER BY created_at", bizId).map((v) => ({
    ...v, notes: q.scalar<number>("SELECT COUNT(*) FROM brain_note WHERE vault_id = ?", v.id) ?? 0, exists: existsSync(v.path),
  }));
}
export function activeVault(bizId: string): Row {
  const id = (bizSettings(bizId) as any).brain?.activeVault;
  const v = (id && byId<Row>("brain_vault", id)) || q.get<Row>("SELECT * FROM brain_vault WHERE biz_id = ? ORDER BY created_at LIMIT 1", bizId);
  if (!v) throw new AppError("NO_VAULT", "Chưa có bộ não nào", 404);
  return v;
}
export function setActiveVault(bizId: string, vaultId: string) {
  vaultOf(bizId, vaultId);
  const s = bizSettings(bizId) as any;
  update("biz", bizId, { settings: { ...s, brain: { ...(s.brain ?? {}), activeVault: vaultId } } });
}
export function vaultOf(bizId: string, id: string): Row {
  const v = id === "active" ? activeVault(bizId) : byId<Row>("brain_vault", id);
  if (!v || v.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy bộ não", 404);
  return v;
}
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vault";

/** New managed vault in data/brain/<slug> with the full folder layout, or register an existing folder (e.g. an Obsidian vault). */
export function createVault(bizId: string, p: { name: string; path?: string; scaffold?: boolean }, actor: string) {
  const managed = !p.path;
  const path = p.path ? resolve(p.path) : join(BRAIN_ROOT, slug(p.name));
  if (q.get("SELECT id FROM brain_vault WHERE biz_id = ? AND path = ?", bizId, path)) throw new AppError("EXISTS", "Thư mục này đã là một bộ não");
  if (!managed && !existsSync(path)) throw new AppError("NO_DIR", "Không thấy thư mục này trên máy");
  mkdirSync(path, { recursive: true });
  const v = insert("brain_vault", { biz_id: bizId, name: p.name, path, managed: managed ? 1 : 0 });
  if (managed || p.scaffold) scaffold(path);
  audit(bizId, actor, "brain.vault_created", { type: "brain_vault", id: v.id }, { name: p.name, path, managed });
  scanVault(v.id);
  watchVault(v.id);
  return v;
}
/** Unregister (files are always kept on disk — deleting a whole brain is never automatic). */
export function removeVault(bizId: string, id: string, actor: string) {
  const v = vaultOf(bizId, id);
  watchers.get(v.id)?.close();
  watchers.delete(v.id);
  q.run("DELETE FROM brain_fts WHERE vault_id = ?", v.id);
  q.run("DELETE FROM brain_note WHERE vault_id = ?", v.id);
  q.run("DELETE FROM knowledge_chunk WHERE doc_id IN (SELECT id FROM knowledge_doc WHERE source LIKE ?)", `brain:${v.id}:%`);
  q.run("DELETE FROM knowledge_doc WHERE source LIKE ?", `brain:${v.id}:%`);
  q.run("DELETE FROM brain_vault WHERE id = ?", v.id);
  audit(bizId, actor, "brain.vault_removed", { type: "brain_vault", id: v.id }, { name: v.name, path: v.path, filesKept: true });
}
export function openVaultFolder(bizId: string, id: string, rel = "") {
  const v = vaultOf(bizId, id);
  const target = rel ? safePath(v, rel) : v.path;
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  const p = spawn(opener, [existsSync(target) && statSync(target).isFile() ? dirname(target) : target], { detached: true, stdio: "ignore" });
  p.on("error", () => {});
  p.unref();
}

const guideName = (folder: string) => `Giới thiệu ${folder.replace(/^\d+\.\s*/, "")}.md`;
function writeObsidianConfig(root: string) {
  const obs = join(root, ".obsidian");
  mkdirSync(obs, { recursive: true });
  writeFileSync(join(obs, "app.json"), JSON.stringify({ attachmentFolderPath: F.files, newFileLocation: "folder", newFileFolderPath: F.inbox, useMarkdownLinks: false }, null, 2));
  writeFileSync(join(obs, "daily-notes.json"), JSON.stringify({ folder: F.daily, format: "YYYY-MM-DD" }, null, 2));
}
function scaffold(root: string) {
  for (const f of VAULT_FOLDERS) {
    mkdirSync(join(root, f.name), { recursive: true });
    for (const sub of f.subs ?? []) mkdirSync(join(root, f.name, sub), { recursive: true });
    const readme = join(root, f.name, guideName(f.name));
    if (!existsSync(readme) && f.name !== F.files) {
      writeFileSync(readme, `---\ntype: guide\n---\n# ${f.name.replace(/^\d+\.\s*/, "")}\n\n${f.about}\n\nVề [[Bảng điều hành]]\n`);
    }
  }
  const welcome = join(root, DASHBOARD_NOTE);
  if (!existsSync(welcome)) writeFileSync(welcome, `---\ntype: dashboard\n---\n# Bảng điều hành\n\nAgentic Brain — trí nhớ của doanh nghiệp. Hệ thống tự cập nhật phần giữa hai dấu \`taki:auto\`; Sếp viết thêm bất cứ đâu.\n\n<!-- taki:auto -->\n_(đang tạo…)_\n<!-- /taki:auto -->\n`);
  if (!existsSync(join(root, ".obsidian", "app.json"))) writeObsidianConfig(root);
}

/** Move an existing vault from an earlier layout to the current one — notes and their ids are kept; only system-written
 *  guides / duplicate logs go to .trash. Runs at start-up and is a no-op once nothing old is left. */
function migrateLayout(v: Row) {
  if (!LEGACY.some(([from]) => existsSync(join(v.path, from)))) return false;
  const trash = join(v.path, ".trash", `bo-cuc-cu-${Date.now()}`);
  mkdirSync(trash, { recursive: true });
  const generated = (file: string) => { try { return /^---\ntype: (daily|weekly|monthly|dashboard|guide|agent)\n/.test(readFileSync(file, "utf8")); } catch { return false; } };
  const move = (from: string, to: string) => {
    const a = join(v.path, from), b = join(v.path, to);
    if (!existsSync(a) || a === b) return;
    if (!existsSync(b)) { mkdirSync(dirname(b), { recursive: true }); renameSync(a, b); return; }
    for (const e of readdirSync(a)) { // merge into the existing folder
      const src = join(a, e);
      let dst = join(b, e);
      if (existsSync(dst) && e.endsWith(".md") && generated(src)) { renameSync(src, join(trash, `${from.replace(/\//g, "_")}-${e}`)); continue; }
      if (existsSync(dst) && statSync(src).isDirectory() && statSync(dst).isDirectory()) { move(relOf(v, src), relOf(v, dst)); continue; }
      for (let i = 2; existsSync(dst); i++) dst = join(b, e.replace(/(\.[^.]+)?$/, ` ${i}$1`));
      renameSync(src, dst);
    }
    try { if (!readdirSync(a).length) rmSync(a, { recursive: true }); } catch { /* keep */ }
  };
  for (const [from, to] of LEGACY) move(from, to);
  // Old system guides (any folder) → trash; fresh ones are written by scaffold below. Nothing the CEO wrote is touched.
  const sweep = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { sweep(p); continue; }
      if ((/ — Hướng dẫn\.md$/.test(e.name) || /^Giới thiệu .+\.md$/.test(e.name) || e.name === "Dashboard.md") && /^---\ntype: (guide|dashboard)\n/.test(readFileSync(p, "utf8"))) {
        const top = relOf(v, dir).split("/")[0];
        if (dir === join(v.path, top) && e.name === guideName(top)) continue; // already the current guide
        renameSync(p, join(trash, `${relOf(v, dir).replace(/\//g, "_")}-${e.name}`));
      }
    }
  };
  sweep(v.path);
  const prune = (dir: string) => { // empty leftover folders of the old layout
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith(".")) prune(join(dir, e.name));
    const rel = relOf(v, dir);
    const keep = VAULT_FOLDERS.some((f) => f.name === rel || (f.subs ?? []).some((s) => `${f.name}/${s}` === rel));
    if (dir !== v.path && !keep && !readdirSync(dir).length) rmSync(dir, { recursive: true });
  };
  prune(v.path);
  scaffold(v.path);
  writeObsidianConfig(v.path);
  if (/^Bộ não\s/.test(v.name)) update("brain_vault", v.id, { name: v.name.replace(/^Bộ não\s/, "Agentic Brain · ") });
  logger.info("brain.layout_migrated", { vault: v.id });
  return true;
}

// ---------------- Safe file access ----------------
export function safePath(v: Row, rel: string) {
  const clean = String(rel ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((s) => s === ".." || s === "")) throw new AppError("BAD_PATH", "Đường dẫn không hợp lệ");
  const root = resolve(v.path); // normalised: a vault typed as "D:/Notes" must compare equal to "D:\Notes\…" on Windows
  const abs = resolve(root, clean);
  if (abs !== root && !abs.startsWith(root + sep)) throw new AppError("BAD_PATH", "Đường dẫn nằm ngoài bộ não");
  return abs;
}
const relOf = (v: Row, abs: string) => relative(v.path, abs).split(sep).join("/");
const isNote = (p: string) => extname(p).toLowerCase() === ".md";
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Không tên";

// ---------------- Parsing ----------------
export function parseFrontmatter(text: string): { meta: Row; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta: Row = {};
  let listKey: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const li = line.match(/^\s*-\s+(.*)$/);
    if (li && listKey) { (meta[listKey] as unknown[]).push(unquote(li[1])); continue; }
    const kv = line.match(/^([\w\-.]+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, raw] = kv;
    listKey = null;
    if (raw === "") { meta[k] = []; listKey = k; continue; }
    if (/^\[.*\]$/.test(raw)) meta[k] = raw.slice(1, -1).split(",").map((x) => unquote(x.trim())).filter(Boolean);
    else if (raw === "true" || raw === "false") meta[k] = raw === "true";
    else if (/^-?\d+(\.\d+)?$/.test(raw)) meta[k] = Number(raw);
    else meta[k] = unquote(raw);
  }
  return { meta, body: text.slice(m[0].length) };
}
const unquote = (s: string) => s.replace(/^["'](.*)["']$/, "$1");
export function stringifyFrontmatter(meta: Row) {
  const lines = Object.entries(meta).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.map((x) => JSON.stringify(String(x))).join(", ")}]` : typeof v === "string" && /[:#\[\]{},]|^\s|\s$/.test(v) ? `${k}: ${JSON.stringify(v)}` : `${k}: ${v}`);
  return lines.length ? `---\n${lines.join("\n")}\n---\n` : "";
}
export function parseNote(text: string, rel: string) {
  const { meta, body } = parseFrontmatter(text);
  const noCode = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const h1 = noCode.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = String(meta.title ?? h1 ?? basename(rel, extname(rel))).slice(0, 200);
  const links = new Set<string>();
  for (const m of noCode.matchAll(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) links.add(m[1].trim());
  for (const m of noCode.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)) if (!/^https?:/.test(m[1])) links.add(decodeURIComponent(m[1]).replace(/\.md$/, ""));
  const tags = new Set<string>([...(Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [])].map((t) => String(t).replace(/^#/, "")));
  for (const m of noCode.matchAll(/(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu)) if (!/^\d+$/.test(m[1])) tags.add(m[1]);
  const words = (noCode.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  return { meta, body, title, links: [...links], tags: [...tags], words };
}

// ---------------- Index ----------------
function walk(dir: string, out: string[] = []) {
  let ents: import("node:fs").Dirent[] = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (IGNORE_DIR.test(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && isNote(e.name)) out.push(p);
  }
  return out;
}
function indexFile(v: Row, abs: string, mtime: string) {
  const rel = relOf(v, abs);
  const text = readFileSync(abs, "utf8");
  const n = parseNote(text, rel);
  const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const cur = q.get<Row>("SELECT id FROM brain_note WHERE vault_id = ? AND path = ?", v.id, rel);
  const row = { title: n.title, folder, tags: n.tags, meta: n.meta, refs: n.links, words: n.words, mtime };
  if (cur) update("brain_note", cur.id, row);
  else insert("brain_note", { biz_id: v.biz_id, vault_id: v.id, path: rel, ...row });
  q.run("DELETE FROM brain_fts WHERE vault_id = ? AND path = ?", v.id, rel);
  q.run("INSERT INTO brain_fts (vault_id, path, title, body) VALUES (?, ?, ?, ?)", v.id, rel, n.title, n.body);
  if (KNOWLEDGE_RE.test(rel) && !String(n.meta.source ?? "").startsWith("knowledge_doc:")) syncKnowledge(v, rel, n.title, n.body, n.tags);
}
function dropFromIndex(v: Row, rel: string) {
  q.run("DELETE FROM brain_note WHERE vault_id = ? AND path = ?", v.id, rel);
  q.run("DELETE FROM brain_fts WHERE vault_id = ? AND path = ?", v.id, rel);
  const doc = q.get<Row>("SELECT id FROM knowledge_doc WHERE source = ?", `brain:${v.id}:${rel}`);
  if (doc) { q.run("DELETE FROM knowledge_chunk WHERE doc_id = ?", doc.id); q.run("DELETE FROM knowledge_doc WHERE id = ?", doc.id); }
}
/** Knowledge/Wiki/Identity notes → knowledge_doc + chunks, so every agent's retrieval sees them. */
function syncKnowledge(v: Row, rel: string, title: string, body: string, tags: string[]) {
  const source = `brain:${v.id}:${rel}`;
  const clean = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1").trim();
  let doc = q.get<Row>("SELECT id, body FROM knowledge_doc WHERE source = ?", source);
  if (doc && doc.body === clean) return;
  if (doc) update("knowledge_doc", doc.id, { title, body: clean, tags });
  else doc = insert("knowledge_doc", { biz_id: v.biz_id, title, kind: "doc", source, tags, body: clean, status: "processed" });
  q.run("DELETE FROM knowledge_chunk WHERE doc_id = ?", doc.id);
  clean.split(/\n\s*\n|\n(?=#)/).map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t.length > 8).slice(0, 400)
    .forEach((text, idx) => insert("knowledge_chunk", { biz_id: v.biz_id, doc_id: doc!.id, idx, text: text.slice(0, 1200), source_ref: `${title.slice(0, 40)}#${idx}` }));
}

/** Bring the index in line with the files (new / changed / deleted). Cheap: only changed mtimes are re-read. */
export function scanVault(vaultId: string) {
  const v = byId<Row>("brain_vault", vaultId);
  if (!v || !existsSync(v.path)) return { added: 0, changed: 0, removed: 0 };
  const known = new Map(q.all<Row>("SELECT path, mtime FROM brain_note WHERE vault_id = ?", v.id).map((r) => [r.path as string, r.mtime as string]));
  let added = 0, changed = 0, removed = 0;
  for (const abs of walk(v.path)) {
    const rel = relOf(v, abs);
    const mtime = statSync(abs).mtime.toISOString();
    const was = known.get(rel);
    known.delete(rel);
    if (was === mtime) continue;
    try { indexFile(v, abs, mtime); was ? changed++ : added++; } catch (e) { logger.warn("brain.index_failed", { rel, error: String(e) }); }
  }
  for (const rel of known.keys()) { dropFromIndex(v, rel); removed++; }
  update("brain_vault", v.id, { scanned_at: nowIso() });
  if (added || changed || removed) bus.emit("event", { id: uuidv7(), bizId: v.biz_id, type: "brain.updated", payload: { vaultId: v.id, added, changed, removed }, at: nowIso() });
  return { added, changed, removed };
}

const watchers = new Map<string, FSWatcher>();
export function watchVault(vaultId: string) {
  const v = byId<Row>("brain_vault", vaultId);
  if (!v || watchers.has(v.id) || !existsSync(v.path)) return;
  let t: NodeJS.Timeout | null = null;
  try {
    const w = watch(v.path, { recursive: true }, (_e, file) => {
      if (file && (String(file).split(/[\\/]/).some((s) => s.startsWith(".")) || !String(file).endsWith(".md"))) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { try { scanVault(v.id); } catch (e) { logger.warn("brain.scan_failed", { error: String(e) }); } }, 1200);
    });
    w.on("error", () => { watchers.delete(v.id); });
    watchers.set(v.id, w);
  } catch (e) { logger.warn("brain.watch_failed", { path: v.path, error: String(e) }); }
}
export function startBrain() {
  for (const v of q.all<Row>("SELECT * FROM brain_vault")) {
    try { if (v.managed && existsSync(v.path)) migrateLayout(v); scanVault(v.id); watchVault(v.id); } catch (e) { logger.warn("brain.start_failed", { error: String(e) }); }
  }
}

// ---------------- Notes ----------------
/** Write a note file and index it right away (the watcher would too, ~1s later). */
export function writeNoteFile(v: Row, rel: string, content: string) {
  if (!isNote(rel)) throw new AppError("BAD_PATH", "Ghi chú phải là file .md");
  const abs = safePath(v, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  indexFile(v, abs, statSync(abs).mtime.toISOString());
  bus.emit("event", { id: uuidv7(), bizId: v.biz_id, type: "brain.updated", payload: { vaultId: v.id, path: rel }, at: nowIso() });
  return rel;
}
export function readNoteFile(v: Row, rel: string) {
  const abs = safePath(v, rel);
  if (!existsSync(abs)) throw new AppError("NOT_FOUND", `Không thấy ghi chú ${rel}`, 404);
  return readFileSync(abs, "utf8");
}
export const noteExists = (v: Row, rel: string) => existsSync(safePath(v, rel));
/** A free path inside folder for title (adds " 2", " 3"… when taken). */
export function freePath(v: Row, folder: string, title: string) {
  const base = `${folder ? `${folder.replace(/\/+$/, "")}/` : ""}${safeName(title)}`;
  let rel = `${base}.md`;
  for (let i = 2; noteExists(v, rel); i++) rel = `${base} ${i}.md`;
  return rel;
}
export function createNote(v: Row, p: { folder?: string; title: string; content?: string; meta?: Row }) {
  const rel = freePath(v, p.folder ?? F.inbox, p.title);
  const body = p.content ?? "";
  const text = `${stringifyFrontmatter({ created: new Date().toISOString().slice(0, 10), ...(p.meta ?? {}) })}${/^#\s/m.test(body) ? "" : `# ${p.title}\n\n`}${body}\n`;
  return writeNoteFile(v, rel, text);
}
export function appendToNote(v: Row, rel: string, text: string) {
  const cur = noteExists(v, rel) ? readNoteFile(v, rel) : `# ${basename(rel, ".md")}\n`;
  return writeNoteFile(v, rel, `${cur.replace(/\s*$/, "")}\n\n${text.trim()}\n`);
}
/** Replace (or add) the auto-generated block between `<!-- taki:auto -->` markers; the CEO's own text is kept. */
export function upsertAutoBlock(v: Row, rel: string, block: string, header: () => string) {
  const START = "<!-- taki:auto -->", END = "<!-- /taki:auto -->";
  const cur = noteExists(v, rel) ? readNoteFile(v, rel) : header();
  const wrapped = `${START}\n${block.trim()}\n${END}`;
  const re = /<!-- taki:auto -->[\s\S]*?<!-- \/taki:auto -->/;
  const next = re.test(cur) ? cur.replace(re, wrapped) : `${cur.replace(/\s*$/, "")}\n\n${wrapped}\n`;
  if (next !== cur) writeNoteFile(v, rel, next);
  return rel;
}

/** Rename/move a note and rewrite [[links]] that pointed at its old name (like Obsidian). */
export function renameNote(v: Row, from: string, to: string, actor: string) {
  if (!isNote(to)) to = `${to}.md`;
  const a = safePath(v, from), b = safePath(v, to);
  if (!existsSync(a)) throw new AppError("NOT_FOUND", "Không thấy ghi chú", 404);
  if (existsSync(b)) throw new AppError("EXISTS", "Đã có ghi chú ở vị trí này");
  mkdirSync(dirname(b), { recursive: true });
  renameSync(a, b);
  dropFromIndex(v, from);
  indexFile(v, b, statSync(b).mtime.toISOString());
  const oldBase = basename(from, ".md"), newBase = basename(to, ".md");
  let relinked = 0;
  if (oldBase !== newBase) {
    const re = new RegExp(`\\[\\[(${oldBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})((?:[#^|][^\\]]*)?)\\]\\]`, "g");
    for (const n of q.all<Row>("SELECT path FROM brain_note WHERE vault_id = ? AND refs LIKE ?", v.id, `%${oldBase}%`)) {
      const text = readNoteFile(v, n.path);
      const next = text.replace(re, `[[${newBase}$2]]`);
      if (next !== text) { writeNoteFile(v, n.path, next); relinked++; }
    }
  }
  audit(v.biz_id, actor, "brain.note_renamed", { type: "brain_vault", id: v.id }, { from, to, relinked });
  return { path: relOf(v, b), relinked };
}
/** Delete = move into the vault's .trash folder (Obsidian convention) — recoverable, never permanent. */
export function trashNote(v: Row, rel: string, actor: string) {
  const a = safePath(v, rel);
  if (!existsSync(a)) throw new AppError("NOT_FOUND", "Không thấy ghi chú", 404);
  const dest = join(v.path, ".trash", `${Date.now()}-${basename(rel)}`);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(a, dest);
  dropFromIndex(v, rel);
  audit(v.biz_id, actor, "brain.note_trashed", { type: "brain_vault", id: v.id }, { path: rel, trash: relOf(v, dest) });
  bus.emit("event", { id: uuidv7(), bizId: v.biz_id, type: "brain.updated", payload: { vaultId: v.id, path: rel }, at: nowIso() });
}
export function createFolder(v: Row, rel: string) {
  mkdirSync(safePath(v, rel), { recursive: true });
  return rel;
}
export function saveAttachment(v: Row, name: string, data: Buffer) {
  if (data.length > 30 * 1024 * 1024) throw new AppError("TOO_BIG", "Tệp tối đa 30MB");
  const clean = safeName(basename(name).replace(/\.[^.]+$/, "")) + (extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "") || "");
  let rel = `${F.files}/${clean}`;
  for (let i = 2; existsSync(safePath(v, rel)); i++) rel = `${F.files}/${clean.replace(/(\.[^.]+)?$/, ` ${i}$1`)}`;
  mkdirSync(join(v.path, F.files), { recursive: true });
  writeFileSync(safePath(v, rel), data);
  return rel;
}

// ---------------- Tree, search, links, graph ----------------
export function vaultTree(v: Row) {
  type Node = { name: string; path: string; type: "folder" | "note"; title?: string; count: number; children?: Node[] };
  const root: Node = { name: v.name, path: "", type: "folder", count: 0, children: [] };
  const folders = new Map<string, Node>([["", root]]);
  const folderNode = (rel: string): Node => {
    if (folders.has(rel)) return folders.get(rel)!;
    const parent = folderNode(rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
    const n: Node = { name: rel.split("/").pop()!, path: rel, type: "folder", count: 0, children: [] };
    parent.children!.push(n);
    folders.set(rel, n);
    return n;
  };
  const dirs = (dir: string) => {
    let ents: import("node:fs").Dirent[] = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) if (e.isDirectory() && !IGNORE_DIR.test(e.name)) { folderNode(relOf(v, join(dir, e.name))); dirs(join(dir, e.name)); }
  };
  dirs(v.path);
  for (const n of q.all<Row>("SELECT path, title, folder FROM brain_note WHERE vault_id = ?", v.id)) {
    const f = folderNode(n.folder);
    f.children!.push({ name: basename(n.path, ".md"), path: n.path, type: "note", title: n.title, count: 1 });
    let p: string = n.folder;
    while (true) {
      folders.get(p)!.count++;
      if (p === "") break;
      p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    }
  }
  const sort = (n: Node) => { n.children?.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, "vi", { numeric: true }) : a.type === "folder" ? -1 : 1)); n.children?.forEach(sort); };
  sort(root);
  return root;
}

const ftsQuery = (s: string) => s.normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8).map((w) => `"${w.replace(/"/g, "")}"*`).join(" ");
export function searchNotes(v: Row, text: string, mode: "name" | "content" = "content", limit = 30) {
  const fq = ftsQuery(text);
  if (!fq) return [];
  const col = mode === "name" ? `{title} : (${fq})` : fq;
  try {
    return q.all<Row>(`SELECT path, title, snippet(brain_fts, 3, '«', '»', '…', 14) snippet FROM brain_fts WHERE vault_id = ? AND brain_fts MATCH ? ORDER BY rank LIMIT ?`, v.id, col, limit);
  } catch {
    return q.all<Row>("SELECT path, title, '' snippet FROM brain_note WHERE vault_id = ? AND (title LIKE ? OR path LIKE ?) LIMIT ?", v.id, `%${text}%`, `%${text}%`, limit);
  }
}

/** Link target → note path, Obsidian-style: full path, then file name (case-insensitive). */
function resolver(v: Row) {
  const rows = q.all<Row>("SELECT path, title, folder, meta, refs, tags, words, mtime FROM brain_note WHERE vault_id = ?", v.id);
  const byPath = new Map<string, string>(), byBase = new Map<string, string>();
  for (const r of rows) {
    const noExt = (r.path as string).replace(/\.md$/i, "").toLowerCase();
    byPath.set(noExt, r.path);
    const b = basename(noExt);
    if (!byBase.has(b)) byBase.set(b, r.path);
  }
  const resolveLink = (target: string) => {
    const t = target.replace(/\.md$/i, "").toLowerCase();
    return byPath.get(t) ?? byBase.get(basename(t)) ?? null;
  };
  return { rows, resolveLink };
}
export function noteLinks(v: Row, rel: string) {
  const { rows, resolveLink } = resolver(v);
  const me = rows.find((r) => r.path === rel);
  const out = (me?.refs ?? []).map((t: string) => ({ target: t, path: resolveLink(t) }));
  const backlinks = rows.filter((r) => r.path !== rel && (r.refs as string[]).some((t) => resolveLink(t) === rel)).map((r) => ({ path: r.path, title: r.title }));
  return { links: out, backlinks };
}

/** Map regions ("vùng trí nhớ") shown on the graph — by note `type:` first, else by top folder. */
const TYPE_CLUSTER: Record<string, string> = {
  project: "Chiến dịch", goal: "Chiến dịch", content: "Nội dung", video: "Video", video_script: "Video", hook: "Video", report: "Quảng cáo", ads: "Quảng cáo", ads_decision: "Quảng cáo",
  conversation: "Ý tưởng", wiki: "Quy trình", skill: "Quy trình", template: "Quy trình", fact: "Tri thức", knowledge: "Tri thức", agent: "Đội AI",
  daily: "Nhật ký", weekly: "Nhật ký", monthly: "Nhật ký", reminder: "Kế hoạch", identity: "Thương hiệu", dashboard: "Tổng quan",
  lesson: "Feedback loop", rejection: "Feedback loop", proposal: "Feedback loop", experiment: "Feedback loop", review: "Review", competitor: "Thị trường",
  persona: "Thị trường", research: "Thị trường", lead: "Bán hàng", sales: "Bán hàng", metrics: "Số liệu", winner: "Mẫu thắng",
};
const FOLDER_CLUSTER: Record<string, string> = {
  [F.overview]: "Tổng quan", [F.inbox]: "Hộp thư", [F.logs]: "Nhật ký", [F.plan]: "Kế hoạch", [F.brand]: "Thương hiệu", [F.market]: "Thị trường",
  [F.campaigns]: "Chiến dịch", [F.content]: "Nội dung", [F.video]: "Video", [F.ads]: "Quảng cáo", [F.sales]: "Bán hàng", [F.review]: "Review",
  [F.feedback]: "Feedback loop", [F.metrics]: "Số liệu", [F.knowledge]: "Tri thức", [F.playbook]: "Quy trình", [F.team]: "Đội AI", [F.ideas]: "Ý tưởng",
  [F.archive]: "Lưu trữ", [F.files]: "Tệp",
};
export function clusterOf(r: Row) {
  const t = String(r.meta?.type ?? "").toLowerCase();
  if (TYPE_CLUSTER[t]) return TYPE_CLUSTER[t];
  if (!String(r.path).includes("/")) return "Khác";
  const top = String(r.path).split("/")[0];
  return FOLDER_CLUSTER[top] ?? top.replace(/^\d+\.\s*/, "");
}
export function vaultGraph(v: Row) {
  const { rows, resolveLink } = resolver(v);
  const links: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  const deg = new Map<string, number>();
  for (const r of rows) for (const t of r.refs as string[]) {
    const to = resolveLink(t);
    if (!to || to === r.path) continue;
    const k = r.path < to ? `${r.path}|${to}` : `${to}|${r.path}`;
    if (seen.has(k)) continue;
    seen.add(k);
    links.push({ source: r.path, target: to });
    deg.set(r.path, (deg.get(r.path) ?? 0) + 1);
    deg.set(to, (deg.get(to) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  const nodes = rows.map((r) => { const c = clusterOf(r); counts.set(c, (counts.get(c) ?? 0) + 1); return { id: r.path, title: r.title, cluster: c, degree: deg.get(r.path) ?? 0, mtime: r.mtime }; });
  const total = rows.length || 1;
  const clusters = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count, pct: Math.max(1, Math.round((count / total) * 100)) }));
  return { nodes, links, clusters, notes: rows.length, edges: links.length };
}
export function recentNotes(v: Row, limit = 30) {
  return q.all<Row>("SELECT path, title, folder, mtime FROM brain_note WHERE vault_id = ? ORDER BY mtime DESC LIMIT ?", v.id, limit);
}
