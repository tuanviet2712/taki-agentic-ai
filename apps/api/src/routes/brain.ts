import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { z } from "zod";
import { CATALOG } from "@dotaka/agents";
import { audit, defaultBizId, q, type Row } from "@dotaka/db";
import {
  F, VAULT_FOLDERS, activeVault, appendToNote, brainTick, createFolder, createNote, createReminder, createVault, listVaults, noteExists, noteLinks, openVaultFolder,
  parseFrontmatter, readNoteFile, recentNotes, removeVault, renameNote, safeName, safePath, saveAttachment, scanVault, searchNotes, setActiveVault, setNoteMeta,
  trashNote, upcomingReminders, vaultGraph, vaultOf, vaultTree, vnDate, writeDaily, writeMonthly, writeNoteFile, writeWeekly,
} from "@dotaka/orchestrator";
import { AppError } from "@dotaka/shared";
import { currentBizId, routes } from "../http.ts";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

/** Agentic Brain (vault) API. `:v` is a vault id or "active". */
export function brainRoutes(app: FastifyInstance) {
  const r = routes(app);
  const V = (bizId: string, id: string) => vaultOf(bizId, id);

  r.get("/v1/brain/vaults", ({ bizId }) => {
    let active: string | null = null;
    try { active = activeVault(bizId).id; } catch { /* none yet */ }
    return { vaults: listVaults(bizId), active, folders: VAULT_FOLDERS };
  });
  r.post("/v1/brain/vaults", ({ bizId, body, actor }) => {
    const p = z.object({ name: z.string().min(2).max(80), path: z.string().optional(), scaffold: z.boolean().optional() }).parse(body);
    const v = createVault(bizId, p, actor);
    setActiveVault(bizId, v.id);
    return v;
  });
  r.post("/v1/brain/vaults/:v/activate", ({ bizId, params }) => { setActiveVault(bizId, V(bizId, params.v).id); return { ok: true }; });
  r.del("/v1/brain/vaults/:v", ({ bizId, params, actor }) => { removeVault(bizId, params.v, actor); return { ok: true, filesKept: true }; });
  r.post("/v1/brain/vaults/:v/open", ({ bizId, params, body }) => { openVaultFolder(bizId, params.v, body?.path ?? ""); return { ok: true }; });
  r.post("/v1/brain/vaults/:v/rescan", async ({ bizId, params }) => {
    const v = V(bizId, params.v);
    const res = scanVault(v.id);
    void brainTick(bizId, { full: true });
    return res;
  });

  r.get("/v1/brain/:v/tree", ({ bizId, params }) => vaultTree(V(bizId, params.v)));
  r.get("/v1/brain/:v/graph", ({ bizId, params }) => vaultGraph(V(bizId, params.v)));
  r.get("/v1/brain/:v/stats", ({ bizId, params }) => {
    const v = V(bizId, params.v);
    const g = vaultGraph(v);
    return {
      notes: g.notes, links: g.edges,
      agents: q.scalar<number>("SELECT COUNT(*) FROM agent_config WHERE biz_id = ? AND enabled = 1", bizId) ?? CATALOG.length,
      skills: q.scalar<number>("SELECT COUNT(*) FROM skill WHERE biz_id = ? AND status = 'active'", bizId) ?? 0,
      workflows: (q.scalar<number>("SELECT COUNT(*) FROM automation WHERE biz_id = ? AND status = 'active'", bizId) ?? 0) + (q.scalar<number>("SELECT COUNT(*) FROM schedule WHERE biz_id = ? AND enabled = 1", bizId) ?? 0),
      scannedAt: v.scanned_at,
    };
  });
  r.get("/v1/brain/:v/note", ({ bizId, params, query }) => {
    const v = V(bizId, params.v);
    const path = String(query.path ?? "");
    const content = readNoteFile(v, path);
    const { meta } = parseFrontmatter(content);
    const row = q.get<Row>("SELECT title, tags, words, mtime FROM brain_note WHERE vault_id = ? AND path = ?", v.id, path);
    return { path, content, meta, title: row?.title ?? path, tags: row?.tags ?? [], words: row?.words ?? 0, mtime: row?.mtime ?? statSync(safePath(v, path)).mtime.toISOString(), ...noteLinks(v, path) };
  });
  r.put("/v1/brain/:v/note", ({ bizId, params, body }) => {
    const p = z.object({ path: z.string().min(4), content: z.string().max(2_000_000) }).parse(body);
    const v = V(bizId, params.v);
    return { path: writeNoteFile(v, p.path, p.content) };
  });
  r.post("/v1/brain/:v/note", ({ bizId, params, body, actor }) => {
    const p = z.object({ folder: z.string().optional(), title: z.string().min(1).max(160), content: z.string().max(2_000_000).optional(), meta: z.record(z.string(), z.unknown()).optional() }).parse(body);
    const v = V(bizId, params.v);
    const path = createNote(v, p);
    audit(bizId, actor, "brain.note_created", { type: "brain_vault", id: v.id }, { path });
    return { path };
  });
  r.post("/v1/brain/:v/append", ({ bizId, params, body, actor }) => {
    const p = z.object({ path: z.string().min(4), text: z.string().min(1).max(200_000) }).parse(body);
    const v = V(bizId, params.v);
    const path = appendToNote(v, p.path, p.text);
    audit(bizId, actor, "brain.note_appended", { type: "brain_vault", id: v.id }, { path });
    return { path };
  });
  r.post("/v1/brain/:v/rename", ({ bizId, params, body, actor }) => {
    const p = z.object({ from: z.string().min(4), to: z.string().min(1) }).parse(body);
    return renameNote(V(bizId, params.v), p.from, p.to, actor);
  });
  r.del("/v1/brain/:v/note", ({ bizId, params, query, actor }) => { trashNote(V(bizId, params.v), String(query.path ?? ""), actor); return { ok: true, trash: true }; });
  r.post("/v1/brain/:v/folder", ({ bizId, params, body }) => ({ path: createFolder(V(bizId, params.v), z.object({ path: z.string().min(1) }).parse(body).path) }));
  r.get("/v1/brain/:v/search", ({ bizId, params, query }) => searchNotes(V(bizId, params.v), String(query.q ?? ""), query.mode === "name" ? "name" : "content", Math.min(Number(query.limit ?? 30), 100)));
  r.get("/v1/brain/:v/recent", ({ bizId, params, query }) => recentNotes(V(bizId, params.v), Math.min(Number(query.limit ?? 30), 100)));

  // Logs: open (or create) today's daily note; regenerate week/month on demand
  r.post("/v1/brain/:v/daily", ({ bizId, body }) => ({ path: writeDaily(bizId, body?.date ?? vnDate()) }));
  r.post("/v1/brain/:v/rollup", async ({ bizId, body }) => {
    const p = z.object({ kind: z.enum(["week", "month"]), date: z.string().optional() }).parse(body);
    const d = p.date ?? vnDate();
    return { path: p.kind === "week" ? await writeWeekly(bizId, d) : await writeMonthly(bizId, d.slice(0, 7)) };
  });

  // Drop files into the brain: text/markdown become notes in Inbox; anything else is attached + linked from an Inbox note
  app.post("/v1/brain/:v/upload", { bodyLimit: 45 * 1024 * 1024 }, async (req) => {
    const bizId = currentBizId(req), actor = "Phòng Marketing TAKI";
    const v = vaultOf(bizId, (req.params as Row).v);
    const p = z.object({ name: z.string().min(1).max(200), data: z.string().min(1), folder: z.string().optional() }).parse(req.body);
    const buf = Buffer.from(p.data.replace(/^data:[^;]+;base64,/, ""), "base64");
    const ext = extname(p.name).toLowerCase();
    const title = safeName(p.name.replace(/\.[^.]+$/, ""));
    let path: string;
    if ([".md", ".txt", ".markdown"].includes(ext)) path = createNote(v, { folder: p.folder ?? F.inbox, title, content: buf.toString("utf8"), meta: { source: `upload:${p.name}` } });
    else {
      const file = saveAttachment(v, p.name, buf);
      const embed = /\.(png|jpe?g|gif|webp|svg)$/i.test(file) ? `![[${file.split("/").pop()}]]` : `[[${file.split("/").pop()}]]`;
      path = createNote(v, { folder: p.folder ?? F.inbox, title, content: `Tệp đính kèm: ${embed}\n\nĐường dẫn: \`${file}\``, meta: { attachment: file } });
    }
    audit(bizId, actor, "brain.uploaded", { type: "brain_vault", id: v.id }, { name: p.name, path });
    return { path };
  });
  // Serve attachments (images in previews)
  app.get("/v1/brain/:v/file", async (req, reply) => {
    const v = vaultOf(currentBizId(req), (req.params as Row).v);
    let rel = String((req.query as Row).path ?? "");
    if (!rel.includes("/") && !noteExists(v, rel)) rel = `${F.files}/${rel}`;
    const abs = safePath(v, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) return reply.status(404).send({ code: "NOT_FOUND", message: "Không thấy tệp" });
    reply.type(MIME[extname(abs).toLowerCase()] ?? "application/octet-stream").header("cache-control", "max-age=300");
    return reply.send(createReadStream(abs));
  });

  // Reminders ("Kế hoạch & nhắc việc") — shown in Ngân Nguyệt "Lịch & nhắc", fired by brain.tick
  r.get("/v1/brain/reminders", ({ bizId, query }) => {
    try { return upcomingReminders(activeVault(bizId), 100, query.all === "1"); } catch { return []; }
  });
  r.post("/v1/brain/reminders", ({ bizId, body, actor }) => {
    const p = z.object({ title: z.string().min(2).max(160), due: z.string().min(10), note: z.string().max(4000).optional() }).parse(body);
    const out = createReminder(bizId, { ...p, by: actor });
    audit(bizId, actor, "brain.reminder_created", { type: "brain_vault", id: activeVault(bizId).id }, out);
    return out;
  });
  r.post("/v1/brain/reminders/done", ({ bizId, body }) => {
    const p = z.object({ path: z.string().min(4), done: z.boolean().default(true) }).parse(body);
    const v = activeVault(bizId);
    if (!noteExists(v, p.path)) throw new AppError("NOT_FOUND", "Không thấy nhắc việc", 404);
    setNoteMeta(v, p.path, { done: p.done });
    return { ok: true };
  });
}
