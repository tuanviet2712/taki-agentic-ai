import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CATALOG } from "@dotaka/agents";
import { activeDna, audit, bizSettings, bus, byId, emit, insert, ownerProfile, q, update, type Row } from "@dotaka/db";
import { effectiveProvider, modelFor, modelMatchesProvider, runCodexAgent, selectedAiAccount, tokensUsedToday, withAiAccount, type Provider } from "@dotaka/llm-gateway";
import { AppError, logger, nowIso } from "@dotaka/shared";
import { enqueue } from "./queue.ts";

/**
 * Ngân Nguyệt — the CEO's command assistant. One chat box that sees every part of TAKI Agentic AI and can act
 * on it: dispatch work to the other agents right away, follow and intervene in tasks, answer with live numbers.
 *
 * How: each CEO message runs `claude -p` (the CEO's Claude account) resuming the thread's Claude session, with
 * ONE tool server — bin/taki-mcp.mjs — whose tools call this API (signed "Ngân Nguyệt" in the audit log).
 * Reading and starting work that still passes review/approval happen immediately. Anything that changes the
 * outside world (approve & publish, reply to a customer, ads changes, spend Flow credits, switch flows/agents,
 * kill switch) becomes a confirm card the CEO clicks in the chat — unless the CEO turned on "tự thực hiện".
 */
export const ASSISTANT = { key: "assistant", name: "Ngân Nguyệt", actor: "Ngân Nguyệt (trợ lý)" } as const;
const RUN_DIR = resolve(process.cwd(), "data", "assistant");
const MCP_SERVER = join(import.meta.dirname, "..", "bin", "taki-mcp.mjs");
const API_URL = `http://127.0.0.1:${process.env.API_PORT ?? 8787}`;
const BIN = process.env.CLAUDE_CLI_PATH ?? "claude";
const TIMEOUT_MS = 10 * 60_000;

export function assistantSettings(bizId: string) {
  return { model: null as string | null, autoConfirm: false, ...((bizSettings(bizId) as any).assistant ?? {}) };
}
export function saveAssistantSettings(bizId: string, patch: { model?: string | null; autoConfirm?: boolean }, actor: string) {
  const s = bizSettings(bizId) as any;
  const next = { ...assistantSettings(bizId), ...patch };
  update("biz", bizId, { settings: { ...s, assistant: next } });
  audit(bizId, actor, "assistant.settings_changed", { type: "biz", id: bizId }, patch);
  return next;
}
const modelOf = (bizId: string) => {
  const model = assistantSettings(bizId).model;
  return model && modelMatchesProvider(model, effectiveProvider(bizId).provider) ? model : modelFor(bizId, ASSISTANT.key, "medium");
};

/** Existing databases were seeded before Ngân Nguyệt existed: give her an agent_config row. */
export function ensureAssistantAgent(bizId: string) {
  if (q.get("SELECT id FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, ASSISTANT.key)) return;
  const c = CATALOG.find((x) => x.key === ASSISTANT.key)!;
  insert("agent_config", { biz_id: bizId, agent_key: c.key, autonomy: c.autonomy, enabled: 1, tools: c.tools, token_budget_run: 400_000, token_budget_day: c.tokenBudgetDay, limits: {} });
}

// ---------------- Threads ----------------
export function createThread(bizId: string, title = "Cuộc trò chuyện mới") {
  return insert("assistant_thread", { biz_id: bizId, title, session_id: randomUUID(), model: null, started: 0, last_message_at: null });
}
export function listThreads(bizId: string) {
  return q.all("SELECT t.*, (SELECT COUNT(*) FROM assistant_message m WHERE m.thread_id = t.id) messages FROM assistant_thread t WHERE t.biz_id = ? ORDER BY COALESCE(t.last_message_at, t.created_at) DESC LIMIT 100", bizId);
}
export function getThread(bizId: string, id: string) {
  const t = byId<Row>("assistant_thread", id);
  if (!t || t.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy cuộc trò chuyện", 404);
  return {
    ...t, running: running.has(id),
    messages: q.all("SELECT * FROM assistant_message WHERE thread_id = ? ORDER BY created_at", id),
    actions: q.all("SELECT * FROM assistant_action WHERE thread_id = ? ORDER BY created_at", id),
  };
}
export function deleteThread(bizId: string, id: string) {
  getThread(bizId, id);
  running.get(id)?.abort();
  q.run("DELETE FROM assistant_message WHERE thread_id = ?", id);
  q.run("DELETE FROM assistant_thread WHERE id = ?", id);
}

// ---------------- Live snapshot + findings ("Phát hiện") ----------------
export function assistantFindings(bizId: string) {
  const out: { level: "urgent" | "warning" | "info"; title: string; detail: string; link: string; ask: string }[] = [];
  const ks = (bizSettings(bizId) as any).killSwitch ?? {};
  const onKs = Object.entries(ks).filter(([, v]) => v).map(([k]) => k);
  if (onKs.length) out.push({ level: "urgent", title: `Kill switch đang BẬT: ${onKs.join(", ")}`, detail: "Các tác vụ ở khu vực này đang bị dừng.", link: "/settings", ask: "Kill switch đang bật ở đâu, vì sao, có nên tắt không?" });
  const failed = q.all<Row>("SELECT id, title, agent_key, status, error FROM task WHERE biz_id = ? AND status IN ('failed','blocked') AND updated_at > datetime('now','-3 day') ORDER BY updated_at DESC LIMIT 5", bizId);
  for (const t of failed) out.push({ level: "warning", title: `Tác vụ ${t.status === "failed" ? "lỗi" : "bị chặn"}: ${t.title}`, detail: `${t.agent_key} · ${t.error?.message ?? ""}`.slice(0, 160), link: "/agents", ask: `Tác vụ "${t.title}" (id ${t.id}) đang ${t.status}. Xem nguyên nhân và xử lý giúp tôi.` });
  const appr = q.get<Row>("SELECT COUNT(*) n, MIN(created_at) oldest FROM approval WHERE biz_id = ? AND status = 'pending'", bizId);
  if (appr?.n) out.push({ level: appr.n > 5 ? "warning" : "info", title: `${appr.n} mục đang chờ Sếp duyệt`, detail: `Mục cũ nhất từ ${String(appr.oldest).slice(0, 16).replace("T", " ")}`, link: "/approvals", ask: "Tóm tắt các mục đang chờ duyệt, mục nào nên duyệt trước?" });
  const vids = q.all<Row>("SELECT id, title, status, error FROM creative_job WHERE biz_id = ? AND status IN ('failed','blocked') AND updated_at > datetime('now','-3 day') ORDER BY updated_at DESC LIMIT 3", bizId);
  for (const v of vids) out.push({ level: "warning", title: `Video Flow chưa xong: ${v.title}`, detail: String(v.error ?? "").slice(0, 160), link: "/video-flow", ask: `Video "${v.title}" (job ${v.id}) bị ${v.status}. Vì sao và làm gì tiếp?` });
  const conns = q.all<Row>("SELECT display_name, platform, status FROM connection WHERE biz_id = ? AND status NOT IN ('active','connected','disconnected') LIMIT 3", bizId);
  for (const c of conns) out.push({ level: "warning", title: `Kết nối ${c.display_name ?? c.platform}: ${c.status}`, detail: "Dữ liệu/thao tác qua kênh này có thể dừng.", link: "/ads/integrations", ask: `Kết nối ${c.display_name ?? c.platform} đang ${c.status}, cần làm gì?` });
  const handoff = q.scalar<number>("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND state = 'handoff_pending'", bizId);
  if (handoff) out.push({ level: "warning", title: `${handoff} khách đang chờ người thật trả lời`, detail: "Chat Agent đã chuyển người.", link: "/chat", ask: "Những khách nào đang chờ người trả lời, ai gấp nhất?" });
  const autoFail = q.all<Row>("SELECT a.name FROM automation a WHERE a.biz_id = ? AND a.status = 'active' AND json_extract(a.last_result,'$.error') = 1 LIMIT 3", bizId);
  for (const a of autoFail) out.push({ level: "warning", title: `Luồng tự động lỗi lần chạy gần nhất: ${a.name}`, detail: "", link: "/ads/flows", ask: `Luồng "${a.name}" chạy lỗi, xem giúp tôi.` });
  return out;
}

function snapshot(bizId: string) {
  const n = (sql: string, ...a: unknown[]) => q.scalar<number>(sql, bizId, ...a) ?? 0;
  return [
    `Tác vụ đang chạy: ${n("SELECT COUNT(*) FROM task WHERE biz_id = ? AND status IN ('running','in_review','revising')")}`,
    `Chờ duyệt: ${n("SELECT COUNT(*) FROM approval WHERE biz_id = ? AND status = 'pending'")}`,
    `Tác vụ lỗi/bị chặn 3 ngày: ${n("SELECT COUNT(*) FROM task WHERE biz_id = ? AND status IN ('failed','blocked') AND updated_at > datetime('now','-3 day')")}`,
    `Video Flow đang chạy: ${n("SELECT COUNT(*) FROM creative_job WHERE biz_id = ? AND status IN ('queued','running')")}`,
    `Khách chờ người: ${n("SELECT COUNT(*) FROM conversation WHERE biz_id = ? AND state = 'handoff_pending'")}`,
  ].join(" · ");
}

function systemPrompt(bizId: string) {
  const dna = activeDna(bizId)?.data as any;
  const brand = dna?.company?.brand ?? dna?.company?.name ?? "TAKI";
  const agents = q.all<Row>("SELECT agent_key, enabled, autonomy FROM agent_config WHERE biz_id = ?", bizId);
  const roster = CATALOG.filter((c) => c.key !== ASSISTANT.key).map((c) => {
    const cfg = agents.find((a) => a.agent_key === c.key);
    return `- ${c.key} (${c.label}): ${c.description}${cfg && !cfg.enabled ? " [ĐANG TẮT]" : ""}`;
  }).join("\n");
  const now = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "full", timeStyle: "short" });
  // What the CEO said about earlier answers (👎 with a note = a rule to follow from now on).
  const fb = q.all<Row>("SELECT feedback, feedback_note, text FROM assistant_message WHERE biz_id = ? AND feedback IS NOT NULL AND feedback_note IS NOT NULL AND feedback_note != '' ORDER BY updated_at DESC LIMIT 8", bizId);
  const auto = assistantSettings(bizId).autoConfirm;
  return `# BẠN LÀ NGÂN NGUYỆT
Trợ lý tổng điều phối riêng của CEO ${brand} trong hệ thống TAKI Agentic AI. Xưng "em", gọi người dùng là "Sếp" (tên trong Tài khoản: ${ownerProfile().name}${ownerProfile().title ? `, ${ownerProfile().title}` : ""}). Tiếng Việt, ngắn gọn, đi thẳng vào việc, có số liệu thật.
Bây giờ: ${now} (giờ Việt Nam). Tình hình nhanh: ${snapshot(bizId)}.

# QUYỀN & CÁCH LÀM
- Sếp ra lệnh → em LÀM NGAY bằng tool mcp__taki__*, không hỏi lại nếu đủ thông tin; thiếu thông tin quan trọng thì tự chọn mặc định hợp lý và nói rõ.
- Mọi con số, trạng thái phải lấy từ tool (không bịa). Chưa có dữ liệu thì nói chưa có.
- Giao việc cho agent: giao_viec (bài viết / kịch bản / SEO, duyệt xong lên lịch đăng), giao_viec_rieng (giao 1 việc cho đúng 1 agent — brief / nghiên cứu / kế hoạch / bài / kịch bản / SEO — xong bước đó là DỪNG; dùng khi Sếp nói "chỉ nghiên cứu", "chỉ lập kế hoạch", "xong thì dừng"), tao_chien_dich (chuỗi brief → nghiên cứu → chiến lược → nội dung; có dung_sau để dừng sau 1 bước), chay_bao_cao_ads; VIDEO: tao_video_tu_dong (chạy trên máy, không tốn tín dụng — ưu tiên khi Sếp cần video nhanh), tao_video_tin_tuc (Sếp dán link bài báo → video tin tức Remotion, chạy trên máy, không tốn tín dụng), anh_cu_dong (ảnh chân dung cử động), long_tieng (giọng đọc .mp3 + .srt), tao_video_flow (Google Flow, tốn tín dụng — cần thẻ xác nhận)… Sau khi giao: báo đã giao cho ai, mã việc, việc sẽ đi qua review/duyệt thế nào.
- Can thiệp: xem/thử lại/hủy tác vụ, duyệt/từ chối, bật/tắt luồng & agent, kill switch, thao tác quảng cáo, trả lời khách. Không có tool riêng thì dùng goi_api (đọc ngay; ghi cần xác nhận).
- Thao tác NHẠY CẢM (duyệt đăng, trả lời khách, đổi quảng cáo, tốn tín dụng Flow, bật/tắt luồng/agent, kill switch, mọi lệnh ghi qua goi_api): ${auto ? "Sếp đã bật chế độ TỰ THỰC HIỆN — tool chạy luôn, em báo lại kết quả." : "tool sẽ tạo THẺ XÁC NHẬN trong khung chat; em nói rõ thẻ đó làm gì và chờ Sếp bấm Xác nhận. Em KHÔNG tự xác nhận thay Sếp."}
- AGENTIC BRAIN (trí nhớ công ty — ghi chú Markdown, mở được bằng Obsidian): trước khi trả lời về kế hoạch, quyết định cũ, dự án, kiến thức nội bộ → brain_tim / brain_doc. Sếp bảo "ghi lại", "lưu ý tưởng", "note giúp" → brain_ghi vào đúng ngăn theo vòng vận hành (ý tưởng → "18. Ý tưởng & hội thoại", đối thủ/khách hàng → "6. Khách hàng & thị trường", bài viết → "8. Nội dung", video/hook → "9. Video", quảng cáo → "10. Quảng cáo", kịch bản chốt → "11. Bán hàng & chăm sóc", bài học/thử nghiệm → "13. Feedback loop", tri thức sản phẩm → "15. Tri thức") hoặc brain_them (nhật ký hôm nay: "3. Nhật ký vận hành/Ngày/<YYYY-MM-DD>.md"). Khi phân tích chất lượng/kết quả, đọc "12. Review & kiểm duyệt/Lỗi hay gặp.md", "13. Feedback loop/Feedback loop — Bài học đang áp dụng.md", "14. Số liệu & báo cáo/Chỉ số KPI.md". Sếp bảo "nhắc tôi…" → tao_nhac_viec (giờ Việt Nam). Liên kết ghi chú bằng [[Tên ghi chú]]; trang: [Agentic Brain](/brain).
- Báo cáo: gọn, gạch đầu dòng, số quan trọng in đậm, kết thúc bằng 1-2 đề xuất hành động. Có thể dẫn link trang trong hệ thống dạng [Duyệt](/approvals), [Video Flow](/video-flow), [Agent](/agents), [Nội dung](/content), [Quảng cáo](/ads/stats), [Chat](/chat).
- Không đăng nhập hộ, không nhập/tiết lộ mật khẩu, khóa API, token. Không xóa dữ liệu.

# CÁC AGENT EM ĐIỀU PHỐI
${roster}${fb.length ? `

# SẾP ĐÃ GÓP Ý (làm theo)
${fb.map((f) => `- ${f.feedback === "down" ? "Không hài lòng" : "Hài lòng"}: ${f.feedback_note}`).join("\n")}` : ""}`;
}

// ---------------- Runner ----------------
/** Streaming updates go straight to the live event bus (SSE) — not the outbox, which keeps only real events. */
function live(bizId: string, payload: Row) {
  bus.emit("event", { id: randomUUID(), bizId, type: "assistant.updated", payload, at: nowIso() });
}
const running = new Map<string, AbortController>();
export const assistantBusy = (threadId: string) => running.has(threadId);

function describe(name: string, input: any): string {
  const t = name.replace(/^mcp__taki__/, "");
  const arg = input?.yeu_cau ?? input?.tieu_de ?? input?.id ?? input?.path ?? input?.query ?? input?.agent ?? "";
  return arg ? `${t} · ${String(arg).slice(0, 80)}` : t;
}

export async function sendAssistantMessage(bizId: string, threadId: string, text: string, opts: { model?: string } = {}) {
  const thread = byId<Row>("assistant_thread", threadId);
  if (!thread || thread.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy cuộc trò chuyện", 404);
  if (running.has(threadId)) throw new AppError("BUSY", "Ngân Nguyệt đang trả lời tin trước, Sếp chờ chút nhé", 409);
  const effective = effectiveProvider(bizId);
  if (effective.provider === "sandbox" || effective.ready === false) throw new AppError("NEED_CLI", effective.reason ?? "Ngân Nguyệt cần kết nối Claude hoặc ChatGPT — Kết nối AI", 400);
  const provider = effective.provider;
  const accountId = provider === "codex_cli" ? selectedAiAccount(bizId)!.id : null;
  if (opts.model && !modelMatchesProvider(opts.model, provider)) throw new AppError("BAD_MODEL", "Model không thuộc kết nối AI đang chọn", 400);
  const model = opts.model || (thread.model && modelMatchesProvider(thread.model, provider) ? thread.model : modelOf(bizId));
  if ((thread.ai_provider ?? "claude_cli") !== provider || (thread.ai_account_id ?? null) !== accountId) {
    thread.session_id = randomUUID(); thread.started = 0;
    update("assistant_thread", threadId, { session_id: thread.session_id, started: 0, ai_provider: provider, ai_account_id: accountId });
  }

  // Outcomes of confirm cards decided since the last turn, so Ngân Nguyệt knows what actually happened.
  const lastAt = q.scalar<string>("SELECT MAX(created_at) FROM assistant_message WHERE thread_id = ? AND role = 'assistant'", threadId) ?? "";
  const decided = q.all<Row>("SELECT title, status, result FROM assistant_action WHERE thread_id = ? AND decided_at > ?", threadId, lastAt);
  const note = decided.length ? `\n\n[Cập nhật hệ thống: ${decided.map((d) => `thẻ "${d.title}" → ${d.status === "done" ? "Sếp đã xác nhận, đã thực hiện" : d.status === "failed" ? `thực hiện lỗi: ${JSON.stringify(d.result).slice(0, 200)}` : "Sếp đã hủy"}`).join("; ")}]` : "";

  const userMsg = insert("assistant_message", { biz_id: bizId, thread_id: threadId, role: "user", text, status: "done" });
  const msg = insert("assistant_message", { biz_id: bizId, thread_id: threadId, role: "assistant", text: "", status: "streaming", model, log: [] });
  update("assistant_thread", threadId, { last_message_at: nowIso(), model, ...(thread.title === "Cuộc trò chuyện mới" ? { title: text.replace(/\s+/g, " ").slice(0, 60) } : {}) });
  live(bizId, { threadId, messageId: msg.id, status: "streaming" });

  const ctrl = new AbortController();
  running.set(threadId, ctrl);
  void runTurn(bizId, thread, msg.id, `${text}${note}`, model, ctrl, provider, accountId).catch((e) => logger.error("assistant.turn_failed", { threadId, error: String(e) }));
  return { userMessage: userMsg, message: byId("assistant_message", msg.id) };
}

export function stopAssistant(threadId: string) {
  running.get(threadId)?.abort();
}

async function runTurn(bizId: string, thread: Row, messageId: string, prompt: string, model: string, ctrl: AbortController, provider: Provider, accountId: string | null) {
  if (provider === "codex_cli") return runCodexTurn(bizId, thread, messageId, prompt, model, ctrl, accountId!);
  mkdirSync(RUN_DIR, { recursive: true });
  const mcpFile = join(RUN_DIR, `mcp-${thread.id}.json`);
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: { taki: { command: process.execPath, args: [MCP_SERVER], env: { TAKI_API: API_URL, TAKI_THREAD: thread.id, TAKI_ACTOR: ASSISTANT.actor, TAKI_BIZ: bizId } } } }));
  let bin = BIN;
  try { bin = execFileSync("/bin/sh", ["-lc", `command -v '${BIN.replace(/'/g, "")}'`], { encoding: "utf8" }).trim() || BIN; } catch { /* keep BIN */ }
  // The system prompt goes through a file: a Windows command line is capped at ~32 KB.
  const systemFile = join(RUN_DIR, `system-${thread.id}.md`);
  writeFileSync(systemFile, systemPrompt(bizId));
  // Prompt FIRST: --allowedTools / --tools are variadic and would swallow a trailing positional prompt.
  const args = [
    prompt, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model,
    "--permission-mode", "dontAsk", "--tools", "", "--mcp-config", mcpFile, "--strict-mcp-config", "--setting-sources", "", "--no-chrome",
    "--append-system-prompt-file", systemFile, "--allowedTools", "mcp__taki",
    ...(thread.started ? ["--resume", thread.session_id] : ["--session-id", thread.session_id]),
  ];
  const env = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT"]) delete env[k];
  const child = spawn(bin, args, { cwd: RUN_DIR, env, stdio: ["ignore", "pipe", "pipe"] });

  const parts: string[] = [];
  const log: Row[] = [];
  let streamed = false;
  let final: any = null;
  let err = "";
  let lastEmit = 0;
  let timer: NodeJS.Timeout | null = null;
  const show = () => parts.filter((p) => p.trim()).join("\n\n");
  const flush = (force = false) => {
    const write = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      lastEmit = Date.now();
      const text = show();
      update("assistant_message", messageId, { text, log });
      live(bizId, { threadId: thread.id, messageId, status: "streaming", text, log });
    };
    if (force || Date.now() - lastEmit > 250) write();
    else timer ??= setTimeout(write, 250);
  };

  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: any;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === "stream_event") {
        const e = ev.event;
        if (e?.type === "content_block_start" && e.content_block?.type === "text") { streamed = true; parts.push(""); }
        else if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
          if (!parts.length) parts.push("");
          parts[parts.length - 1] += e.delta.text;
          flush();
        }
      } else if (ev.type === "assistant") {
        for (const c of ev.message?.content ?? []) {
          if (c.type === "tool_use") { log.push({ at: nowIso(), kind: "tool", text: describe(c.name, c.input), id: c.id }); flush(); }
          else if (c.type === "text" && !streamed && c.text?.trim()) { parts.push(c.text); flush(); }
        }
      } else if (ev.type === "user") {
        for (const c of ev.message?.content ?? []) {
          if (c.type !== "tool_result") continue;
          const step = log.find((s) => s.id === c.tool_use_id);
          if (step) step.ok = !c.is_error;
        }
      } else if (ev.type === "result") final = ev;
    }
  });
  child.stderr.on("data", (d) => (err += d));
  const kill = () => { try { child.kill("SIGTERM"); } catch { /* gone */ } };
  ctrl.signal.addEventListener("abort", kill);
  const deadline = setTimeout(kill, TIMEOUT_MS);
  const code: number = await new Promise((r) => child.on("close", (c) => r(c ?? 0)));
  clearTimeout(deadline);
  running.delete(thread.id);
  if (timer) clearTimeout(timer);

  const ok = final && !final.is_error && final.subtype === "success";
  const rawErr = `${typeof final?.result === "string" ? final.result : ""} ${err}`;
  // Claude CLI trên máy bị đăng xuất / hết phiên → nói rõ cách sửa (Telegram + web), không trả nguyên lỗi tiếng Anh.
  const authLost = !ok && /Failed to authenticate|OAuth session expired|not logged in|Invalid API key|Please run \/login|authentication_error/i.test(rawErr);
  const text = authLost
    ? "Dạ Claude CLI trên máy chạy hệ thống đã hết phiên đăng nhập nên em chưa trả lời được. Sếp mở Terminal trên máy đó, gõ `claude` rồi gõ `/login` và đăng nhập lại tài khoản Claude; xong Sếp nhắn lại em nhé."
    : show() || (typeof final?.result === "string" ? final.result : "");
  if (final) update("assistant_thread", thread.id, { started: 1 }); // session exists from now on → --resume next time
  update("assistant_message", messageId, {
    text: ctrl.signal.aborted ? `${text}${text ? "\n\n" : ""}_(Sếp đã dừng)_` : text || (ok ? "" : "Em gặp lỗi khi xử lý, Sếp thử lại giúp em."),
    status: ctrl.signal.aborted ? "stopped" : ok ? "done" : "error", log,
    error: ok || ctrl.signal.aborted ? null : String(final?.result ?? err.slice(-400) ?? `code ${code}`).slice(0, 600),
  });
  if (final) {
    const u = final.usage ?? {};
    insert("model_usage", {
      biz_id: bizId, agent_key: ASSISTANT.key, provider: "claude_cli", model,
      tokens_in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), tokens_out: u.output_tokens ?? 0, tokens_cached: u.cache_read_input_tokens ?? 0,
      cost_micros: Math.round((final.total_cost_usd ?? 0) * 1e6), latency_ms: final.duration_ms ?? 0, at: nowIso(),
    });
  }
  emit(bizId, "assistant.updated", { threadId: thread.id, messageId, status: "done" });
}

async function runCodexTurn(bizId: string, thread: Row, messageId: string, prompt: string, model: string, ctrl: AbortController, accountId: string) {
  const log: Row[] = [];
  let text = "";
  try {
    const budget = q.get<Row>("SELECT token_budget_day FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, ASSISTANT.key)?.token_budget_day;
    if (budget && tokensUsedToday(bizId, ASSISTANT.key) >= budget) throw new AppError("TOKEN_BUDGET_EXCEEDED", "Ngân Nguyệt đã đạt trần token hôm nay", 429);
    const history = q.all<Row>("SELECT role, text FROM assistant_message WHERE thread_id = ? AND id != ? AND id != (SELECT id FROM assistant_message WHERE thread_id = ? AND role = 'user' ORDER BY rowid DESC LIMIT 1) AND status = 'done' ORDER BY created_at DESC, rowid DESC LIMIT 24", thread.id, messageId, thread.id).reverse();
    const context = history.map((m) => `${m.role === "user" ? "Sếp" : "Ngân Nguyệt"}: ${m.text}`).join("\n\n").slice(-40_000);
    const result = await withAiAccount(bizId, accountId, (home, signal) => runCodexAgent({ home, signal, model, system: systemPrompt(bizId),
      prompt: `Lịch sử hội thoại (chỉ dùng làm ngữ cảnh):\n${context}\n\nYêu cầu hiện tại:\n${prompt}`, timeoutMs: TIMEOUT_MS,
      mcp: { taki: { command: process.execPath, args: [MCP_SERVER], env: { TAKI_API: API_URL, TAKI_THREAD: thread.id, TAKI_ACTOR: ASSISTANT.actor, TAKI_BIZ: bizId } } },
      onStep: (step) => { log.push(step); if (step.kind === "text") text = step.text; update("assistant_message", messageId, { text, log }); live(bizId, { threadId: thread.id, messageId, status: "streaming", text, log }); },
    }), ctrl.signal);
    text = result.text;
    insert("model_usage", { biz_id: bizId, agent_key: ASSISTANT.key, provider: "codex_cli", model: result.model,
      tokens_in: result.usage.input, tokens_out: result.usage.output, tokens_cached: result.usage.cached, cost_micros: 0, latency_ms: result.durationMs, at: nowIso() });
    update("assistant_message", messageId, { text, log, model: result.model, status: "done", error: null });
  } catch (e) {
    const message = e instanceof Error ? e.message : "ChatGPT chưa xử lý được yêu cầu";
    update("assistant_message", messageId, { text: ctrl.signal.aborted ? `${text}\n\n_(Sếp đã dừng)_` : text || message, log, status: ctrl.signal.aborted ? "stopped" : "error", error: ctrl.signal.aborted ? null : message });
  } finally {
    running.delete(thread.id);
    emit(bizId, "assistant.updated", { threadId: thread.id, messageId, status: "done" });
  }
}

// ---------------- "Việc giao": work Ngân Nguyệt dispatched, with live status ----------------
export function recordDispatch(bizId: string, d: { threadId?: string | null; kind: string; refType: string; refId: string; title: string }) {
  const row = insert("assistant_dispatch", { biz_id: bizId, thread_id: d.threadId ?? null, kind: d.kind, ref_type: d.refType, ref_id: d.refId, title: d.title });
  emit(bizId, "assistant.updated", { dispatchId: row.id });
  return row;
}
export function listDispatches(bizId: string) {
  return q.all<Row>("SELECT * FROM assistant_dispatch WHERE biz_id = ? ORDER BY created_at DESC LIMIT 60", bizId).map((d) => {
    let status = "?", step: string | null = null, link = "/agents";
    if (d.ref_type === "task") { const t = byId<Row>("task", d.ref_id); status = t?.status ?? "?"; step = t?.step ?? t?.error?.message ?? null; link = "/agents"; }
    else if (d.ref_type === "goal") {
      const g = byId<Row>("goal", d.ref_id);
      const open = q.scalar<number>("SELECT COUNT(*) FROM task WHERE goal_id = ? AND status NOT IN ('done','cancelled','rejected')", d.ref_id) ?? 0;
      status = g?.status === "done" ? "done" : "running"; step = `${open} tác vụ còn mở`; link = "/plan";
    } else if (d.ref_type === "creative_job") { const j = byId<Row>("creative_job", d.ref_id); status = j?.status ?? "?"; step = j?.step ?? j?.error ?? null; link = "/video-flow"; }
    else if (d.ref_type === "job") { const j = byId<Row>("job", d.ref_id); status = j?.status ?? "done"; step = j?.last_error ?? null; }
    return { ...d, status, step, link };
  });
}

/** Direct task for a content-type agent from a plain instruction (no goal needed). */
const DIRECT = { content: "Bài", video_script: "Kịch bản", seo_web: "Bài SEO" } as const;
export function dispatchAgentTask(bizId: string, p: { agent: keyof typeof DIRECT; instruction: string; channel?: string; format?: string; keyword?: string; funnel?: string; threadId?: string | null }, actor: string) {
  const cfg = q.get<Row>("SELECT enabled FROM agent_config WHERE biz_id = ? AND agent_key = ?", bizId, p.agent);
  if (!cfg?.enabled) throw new AppError("AGENT_DISABLED", `Agent ${p.agent} đang tắt (Agent & Tác vụ)`);
  const channel = p.channel ?? (p.agent === "seo_web" ? "website" : p.agent === "video_script" ? "tiktok" : "facebook");
  const format = p.format ?? (p.agent === "video_script" ? "reel" : p.agent === "seo_web" ? "article" : "text");
  const item = { channel, format, topic: p.instruction.slice(0, 300), angle: p.instruction, funnel: p.funnel ?? "tofu", yeuCauCuaCeo: p.instruction };
  const title = `${DIRECT[p.agent]} ${channel}: ${p.instruction.replace(/\s+/g, " ").slice(0, 70)}`;
  const task = insert("task", { biz_id: bizId, goal_id: null, agent_key: p.agent, title, status: "ready", input: { item, keyword: p.keyword ?? p.instruction.slice(0, 120), dispatchedBy: actor }, depends_on: [] });
  enqueue("agent", "agent.run", { taskId: task.id }, { bizId, idempotencyKey: `run:${task.id}:0` });
  audit(bizId, actor, "assistant.dispatched", { type: "task", id: task.id }, { agent: p.agent, instruction: p.instruction });
  emit(bizId, "task.updated", { taskId: task.id, status: "ready", agent: p.agent });
  recordDispatch(bizId, { threadId: p.threadId, kind: p.agent, refType: "task", refId: task.id, title });
  return { taskId: task.id, title, agent: p.agent, status: "ready" };
}

// ---------------- Confirm cards ----------------
export type ActionRequest = { method: "POST" | "PUT" | "DELETE"; path: string; body?: unknown };
export function checkActionPath(path: string) {
  if (!/^\/v1\/[\w\-/.:?=&%]+$/.test(path)) throw new AppError("BAD_PATH", "Đường dẫn API không hợp lệ");
  // Ngân Nguyệt can never confirm her own cards or change her own permissions / secrets.
  if (/^\/v1\/(assistant\/actions|assistant\/settings|mcp-keys|llm\b|connections\b.*\/(credentials|token))/.test(path)) throw new AppError("FORBIDDEN", "Thao tác này chỉ Sếp làm trực tiếp trên giao diện");
}
export function createAction(bizId: string, p: { threadId?: string | null; title: string; summary: string; request: ActionRequest }) {
  checkActionPath(p.request.path);
  const row = insert("assistant_action", { biz_id: bizId, thread_id: p.threadId ?? null, title: p.title.slice(0, 160), summary: p.summary.slice(0, 1000), params: p.request, status: "pending" });
  emit(bizId, "assistant.updated", { threadId: p.threadId, actionId: row.id });
  return row;
}
export function finishAction(bizId: string, id: string, status: "done" | "failed" | "cancelled", result: unknown, actor: string) {
  update("assistant_action", id, { status, result: result ?? null, decided_at: nowIso() });
  const a = byId<Row>("assistant_action", id)!;
  audit(bizId, actor, `assistant.action_${status}`, { type: "assistant_action", id }, { title: a.title, request: a.params });
  emit(bizId, "assistant.updated", { threadId: a.thread_id, actionId: id });
  return a;
}

// ---------------- "Phản hồi": CEO feedback on answers ----------------
export function setFeedback(bizId: string, messageId: string, p: { feedback: "up" | "down" | null; note?: string }) {
  const m = byId<Row>("assistant_message", messageId);
  if (!m || m.biz_id !== bizId || m.role !== "assistant") throw new AppError("NOT_FOUND", "Không thấy câu trả lời", 404);
  update("assistant_message", m.id, { feedback: p.feedback, feedback_note: p.note?.trim() || null });
  audit(bizId, "Phòng Marketing TAKI", "assistant.feedback", { type: "assistant_message", id: m.id }, p);
  emit(bizId, "assistant.updated", { threadId: m.thread_id, feedback: m.id });
  return byId("assistant_message", m.id);
}
export function listFeedback(bizId: string) {
  return q.all("SELECT m.id, m.thread_id, m.text, m.feedback, m.feedback_note, m.updated_at, t.title thread_title FROM assistant_message m JOIN assistant_thread t ON t.id = m.thread_id WHERE m.biz_id = ? AND m.feedback IS NOT NULL ORDER BY m.updated_at DESC LIMIT 100", bizId);
}
