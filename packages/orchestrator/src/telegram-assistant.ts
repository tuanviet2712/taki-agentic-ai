import { randomInt } from "node:crypto";
import { audit, byId, defaultBizId, getAppSetting, q, setAppSetting, update, type Row } from "@dotaka/db";
import { AppError, logger, nowIso, sleep } from "@dotaka/shared";
import { assistantBusy, createThread, sendAssistantMessage, stopAssistant } from "./assistant.ts";
import { credsOf } from "./connections.ts";

/**
 * Ngân Nguyệt trên Telegram: Sếp nhắn bot → cùng trợ lý như trên web (Claude CLI + công cụ hệ thống) → trả lời trong Telegram.
 *  - Long polling getUpdates (không cần webhook công khai). Token bot lấy từ kết nối Telegram ở Trung tâm tích hợp.
 *  - Bot ai cũng nhắn được → CHỈ chat đã ghép nối (mã 6 số / link t.me/<bot>?start=<mã>, hết hạn 15 phút) mới được trả lời.
 *  - Thẻ cần xác nhận → nút ✅ / ❌ ngay trong Telegram, đi qua đúng API xác nhận của Ngân Nguyệt.
 */
type Chat = { id: string; name: string; at: string; threadId?: string | null };
type State = { chats: Chat[]; pair?: { code: string; until: string } | null; offset?: number; bot?: { username: string; name: string } | null; error?: string | null; lastPollAt?: string | null };
const KEY = (bizId: string) => `telegramAssistant:${bizId}`;
const API_URL = `http://127.0.0.1:${process.env.API_PORT ?? 8787}`;
const state = (bizId: string): State => ({ chats: [], ...(getAppSetting<State>(KEY(bizId)) ?? {}) });
const save = (bizId: string, patch: Partial<State>) => setAppSetting(KEY(bizId), { ...state(bizId), ...patch });

function telegramConn(bizId: string): { conn: Row; token: string } | null {
  const c = q.get<Row>("SELECT * FROM connection WHERE biz_id = ? AND platform = 'telegram' AND mode = 'live' AND status != 'revoked' ORDER BY updated_at DESC LIMIT 1", bizId);
  const token = c ? credsOf(c).bot_token : null;
  return c && token ? { conn: c, token } : null;
}

async function tg(token: string, method: string, body: Row = {}, timeoutMs = 20_000): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string; error_code?: number };
  if (!j.ok) throw Object.assign(new Error(`Telegram ${method}: ${j.description ?? res.status}`), { code: j.error_code ?? res.status });
  return j.result;
}

/** Markdown của Ngân Nguyệt → HTML Telegram (đậm, code); Telegram từ chối định dạng thì gửi chữ thường. */
const toHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
async function send(token: string, chatId: string, text: string, extra: Row = {}) {
  const body = text.trim() || "(trống)";
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += 3800) parts.push(body.slice(i, i + 3800));
  let last: any = null;
  for (const [i, p] of parts.entries()) {
    const ex = i === parts.length - 1 ? extra : {};
    try { last = await tg(token, "sendMessage", { chat_id: chatId, text: toHtml(p), parse_mode: "HTML", disable_web_page_preview: true, ...ex }); }
    catch { last = await tg(token, "sendMessage", { chat_id: chatId, text: p, disable_web_page_preview: true, ...ex }); }
  }
  return last;
}

// ---------------- Ghép nối (web) ----------------
export async function telegramAssistantStatus(bizId: string) {
  const t = telegramConn(bizId);
  const s = state(bizId);
  let bot = s.bot ?? null;
  if (t && !bot) { try { const me = await tg(t.token, "getMe"); bot = { username: me.username, name: me.first_name }; save(bizId, { bot }); } catch { /* shown via error */ } }
  return {
    connected: !!t, bot, running: loopRunning, error: s.error ?? null, lastPollAt: s.lastPollAt ?? null,
    chats: s.chats.map((c) => ({ id: c.id, name: c.name, at: c.at, hasThread: !!c.threadId })),
    pair: s.pair && Date.parse(s.pair.until) > Date.now() ? { ...s.pair, link: bot ? `https://t.me/${bot.username}?start=${s.pair.code}` : null } : null,
    alertsChatId: t?.conn.config?.chat_id ?? null,
  };
}
export async function createTelegramPairCode(bizId: string, actor: string) {
  if (!telegramConn(bizId)) throw new AppError("NO_TELEGRAM", "Chưa kết nối Telegram — vào Quảng cáo → Trung tâm tích hợp → Telegram, dán Bot token");
  const code = String(randomInt(100000, 999999));
  save(bizId, { pair: { code, until: new Date(Date.now() + 15 * 60_000).toISOString() } });
  audit(bizId, actor, "telegram.pair_code", undefined, {});
  return telegramAssistantStatus(bizId);
}
export function removeTelegramChat(bizId: string, chatId: string, actor: string) {
  const s = state(bizId);
  save(bizId, { chats: s.chats.filter((c) => c.id !== chatId) });
  audit(bizId, actor, "telegram.chat_removed", undefined, { chatId });
  return { ok: true };
}

// ---------------- Xử lý tin ----------------
const HELP = "Em là Ngân Nguyệt, trợ lý của hệ thống Agentic AI. Sếp nhắn yêu cầu như trên web (vd: \"báo cáo quảng cáo hôm nay\", \"viết bài Facebook về…\").\n/moi — cuộc trò chuyện mới\n/dung — dừng câu trả lời đang chạy\n/trogiup — hướng dẫn";
const lockedNotice = new Map<string, number>();

async function handleMessage(bizId: string, token: string, m: Row) {
  const chatId = String(m.chat.id);
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.chat.title || m.from?.username || chatId;
  const text = String(m.text ?? "").trim();
  const s = state(bizId);
  let chat = s.chats.find((c) => c.id === chatId);

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1] ?? "";
    if (chat) return send(token, chatId, `Dạ em chào ${name}, em đã sẵn sàng.\n\n${HELP}`);
    if (s.pair && code === s.pair.code && Date.parse(s.pair.until) > Date.now()) {
      chat = { id: chatId, name, at: nowIso(), threadId: null };
      save(bizId, { chats: [...s.chats, chat], pair: null });
      const t = telegramConn(bizId);
      // Chưa có chat nhận cảnh báo → dùng luôn chat vừa ghép nối.
      if (t && !t.conn.config?.chat_id) update("connection", t.conn.id, { config: { ...(t.conn.config ?? {}), chat_id: chatId } });
      audit(bizId, `Telegram · ${name}`, "telegram.paired", undefined, { chatId });
      return send(token, chatId, `Dạ em chào ${name}! Đã ghép nối Telegram này với hệ thống Agentic AI.\n\n${HELP}`);
    }
  }
  if (!chat) {
    if ((lockedNotice.get(chatId) ?? 0) > Date.now() - 3600_000) return;
    lockedNotice.set(chatId, Date.now());
    return send(token, chatId, "Đây là bot riêng của doanh nghiệp. Để dùng, mở Agentic AI → Cài đặt → Ngân Nguyệt trên Telegram → Tạo mã ghép nối, rồi gửi /start <mã> (hoặc bấm link ghép nối).");
  }
  if (!text) return send(token, chatId, "Dạ hiện em đọc được tin nhắn chữ thôi ạ — Sếp gõ yêu cầu giúp em nhé.");
  if (text === "/trogiup" || text === "/help") return send(token, chatId, HELP);
  if (text === "/moi" || text === "/new") {
    setChat(bizId, chatId, { threadId: null });
    return send(token, chatId, "Dạ em đã mở cuộc trò chuyện mới.");
  }
  if (text === "/dung" || text === "/stop") {
    if (chat.threadId) stopAssistant(chat.threadId);
    return send(token, chatId, "Dạ em dừng rồi ạ.");
  }

  let threadId = chat.threadId ?? null;
  if (!threadId || !byId<Row>("assistant_thread", threadId)) {
    threadId = (createThread(bizId, `Telegram · ${name}`) as Row).id as string;
    setChat(bizId, chatId, { threadId });
  }
  if (assistantBusy(threadId)) return send(token, chatId, "Dạ em đang trả lời tin trước, Sếp chờ em chút nhé (gõ /dung để dừng).");
  const started = nowIso();
  const typing = setInterval(() => void tg(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}), 4500);
  void tg(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  try {
    const r = await sendAssistantMessage(bizId, threadId, text);
    const msgId = (r.message as Row).id as string;
    const until = Date.now() + 15 * 60_000;
    let msg = byId<Row>("assistant_message", msgId);
    while (msg?.status === "streaming" && Date.now() < until) { await sleep(1500); msg = byId<Row>("assistant_message", msgId); }
    clearInterval(typing);
    const out = msg?.status === "streaming" ? "Dạ việc này lâu hơn dự kiến, em vẫn đang làm — Sếp xem kết quả trên web (Ngân Nguyệt) nhé." : String(msg?.text || msg?.error || "Em gặp lỗi khi xử lý, Sếp thử lại giúp em.");
    await send(token, chatId, out);
    for (const a of q.all<Row>("SELECT id, title, summary FROM assistant_action WHERE thread_id = ? AND status = 'pending' AND created_at >= ? ORDER BY created_at", threadId, started)) {
      await send(token, chatId, `🔔 Cần Sếp xác nhận: ${a.title}${a.summary ? `\n${a.summary}` : ""}`, {
        reply_markup: { inline_keyboard: [[{ text: "✅ Xác nhận", callback_data: `ok:${a.id}` }, { text: "❌ Huỷ", callback_data: `no:${a.id}` }]] },
      });
    }
  } catch (e) {
    clearInterval(typing);
    await send(token, chatId, `Dạ em chưa làm được: ${e instanceof Error ? e.message : String(e)}`);
  }
}
function setChat(bizId: string, chatId: string, patch: Partial<Chat>) {
  const s = state(bizId);
  save(bizId, { chats: s.chats.map((c) => (c.id === chatId ? { ...c, ...patch } : c)) });
}

async function handleCallback(bizId: string, token: string, cb: Row) {
  const chatId = String(cb.message?.chat?.id ?? "");
  const chat = state(bizId).chats.find((c) => c.id === chatId);
  const [kind, id] = String(cb.data ?? "").split(":");
  if (!chat || !id) return tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Chat này chưa được ghép nối" }).catch(() => {});
  const a = byId<Row>("assistant_action", id);
  let result: string;
  if (!a || a.biz_id !== bizId) result = "Thẻ không còn hiệu lực";
  else if (a.status !== "pending") result = "Thẻ này đã xử lý trước đó";
  else {
    // Cùng API Sếp bấm trên web (không gắn x-taki-actor = Sếp quyết định).
    const res = await fetch(`${API_URL}/v1/assistant/actions/${id}/${kind === "ok" ? "confirm" : "cancel"}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `tg-${cb.id}` }, body: "{}" }).catch((e) => e as Error);
    if (res instanceof Error) result = `Lỗi: ${res.message}`;
    else {
      const j = (await res.json().catch(() => ({}))) as Row;
      result = !res.ok ? `Lỗi: ${j.message ?? res.status}` : kind === "ok" ? (j.status === "failed" ? `Đã xác nhận nhưng thực hiện lỗi: ${JSON.stringify(j.result ?? "").slice(0, 200)}` : "✅ Đã xác nhận và thực hiện") : "❌ Đã huỷ";
    }
    audit(bizId, `Telegram · ${chat.name}`, kind === "ok" ? "telegram.action_confirmed" : "telegram.action_cancelled", { type: "assistant_action", id }, {});
  }
  await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: result.slice(0, 190) }).catch(() => {});
  await tg(token, "editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  await send(token, chatId, result);
}

// ---------------- Vòng nhận tin ----------------
let loopRunning = false;
let stopFlag = false;
const chatQueues = new Map<string, Promise<unknown>>();
/** Chạy trong tiến trình API. Không có kết nối Telegram thì ngủ, có thì long-poll. Trả hàm dừng. */
export function startTelegramAssistant(): () => void {
  if (loopRunning) return () => { stopFlag = true; };
  loopRunning = true; stopFlag = false;
  void (async () => {
    while (!stopFlag) {
      const bizId = defaultBizId();
      const t = telegramConn(bizId);
      if (!t) { await sleep(15_000); continue; }
      const s = state(bizId);
      try {
        const updates: Row[] = await tg(t.token, "getUpdates", { offset: s.offset ?? 0, timeout: 25, allowed_updates: ["message", "callback_query"] }, 35_000);
        save(bizId, { error: null, lastPollAt: nowIso() });
        for (const u of updates) {
          save(bizId, { offset: Number(u.update_id) + 1 });
          const chatKey = String(u.message?.chat?.id ?? u.callback_query?.message?.chat?.id ?? "");
          // Tuần tự trong 1 chat, song song giữa các chat.
          const prev = chatQueues.get(chatKey) ?? Promise.resolve();
          const job = prev.then(() => (u.callback_query ? handleCallback(bizId, t.token, u.callback_query) : u.message ? handleMessage(bizId, t.token, u.message) : null))
            .catch((e) => logger.warn("telegram_assistant.handle_failed", { error: e instanceof Error ? e.message : String(e) }));
          chatQueues.set(chatKey, job);
        }
      } catch (e) {
        const code = (e as { code?: number }).code;
        const msg = code === 409 ? "Bot đang bị hệ thống khác nhận tin (webhook hoặc một chương trình khác cũng đang chạy getUpdates với bot này) — tắt bên kia rồi thử lại" : e instanceof Error ? e.message : String(e);
        save(bizId, { error: msg });
        logger.warn("telegram_assistant.poll_failed", { error: msg });
        await sleep(code === 409 ? 30_000 : 5_000);
      }
    }
    loopRunning = false;
  })();
  return () => { stopFlag = true; };
}
