import { audit, byId, emit, getAppSetting, insert, q, setAppSetting, update, type Row } from "@dotaka/db";
import { ConnectorError, type MessengerSyncMessage, type MessengerThread } from "@dotaka/connectors";
import { AppError, logger, nowIso, uuidv7 } from "@dotaka/shared";
import { connectorForChannel } from "./connections.ts";
import { enqueue, type Handler } from "./queue.ts";
import { queueChatMedia } from "./chat-media.ts";
import { chatVisionEnabled } from "@dotaka/chat-engine";

/**
 * Đồng bộ Messenger: kéo hội thoại/tin nhắn Messenger của Fanpage về trang Hội thoại — dùng được cả khi KHÔNG có
 * webhook công khai (Cloudflare Tunnel).
 *  - backfill: kéo lịch sử (mặc định 30 ngày) → CHỈ LƯU, không bao giờ để bot trả lời / chăm khách / lên đơn tin cũ.
 *  - incremental (mỗi 1 phút): tin mới từ con trỏ channel.meta.messengerSyncedAt. Tin khách MỚI (≤ 15 phút) mà webhook
 *    chưa nhận → đi ĐÚNG đường webhook (job chat.ingest) để bot trả lời + bắt SĐT; tin cũ hơn → lưu, đánh dấu chưa đọc.
 * Cùng khoá với webhook & chăm khách: hội thoại = (messenger, PSID); tin = external_id mid; chống trùng raw_event `meta:<mid>`.
 * Chỉ Fanpage THẬT (kết nối live có page token) — không có Trang mô phỏng: chưa kết nối thì báo rõ, không giả dữ liệu.
 */
export type MessengerSyncMode = "backfill" | "incremental";
export type MessengerSyncOptions = {
  mode?: MessengerSyncMode; days?: number; channelIds?: string[];
  now?: Date;
};
export type MessengerPageResult = { channelId: string; name: string; ok: boolean; conversations: number; newMessages: number; routed: number; error?: string };
export type MessengerSyncSummary = {
  mode: MessengerSyncMode; startedAt: string; finishedAt: string;
  channels: number; conversations: number; newMessages: number; routed: number; errors: string[]; transient: number;
  pages: MessengerPageResult[]; skipped?: string;
};

const FRESH_MS = 15 * 60_000;
const DAY_MS = 24 * 3600_000;
const LIMITS: Record<MessengerSyncMode, { threads: number; messages: number }> = { backfill: { threads: 200, messages: 50 }, incremental: { threads: 50, messages: 50 } };
export const SYNC_BUSY = "Đang đồng bộ Messenger — đợi lượt hiện tại xong";
const NO_PAGE = "Chưa có Fanpage thật kết nối";
/** Raw events keep no phone numbers in clear (the message itself is stored on the conversation). */
const maskPhonesInText = (t: string) => t.replace(/(?:\+?84|0)(?:[\s.-]?\d){8,10}/g, (m) => `${m.slice(0, 3)}***${m.slice(-2)}`);
const running = new Set<string>(); // chống 2 lượt đồng bộ cùng 1 doanh nghiệp chạy chồng (cùng tiến trình)
const statusKey = (bizId: string) => `messengerSync:${bizId}`;
/**
 * Bot tự trả lời khách thật trên Messenger: TẮT mặc định — Sếp bật ở trang Hội thoại. Tắt = chỉ lưu + chấm lead, người trả lời.
 * Ngoại lệ không gửi gì: sản phẩm có Kịch bản chốt đơn ở chế độ "Gợi ý cho nhân viên" → tin vẫn đi kèm `suggestOnly`,
 * bot soạn gợi ý ghim ở trang Hội thoại (nhân viên bấm gửi); không có kịch bản "Gợi ý" thì như `noReply` thường.
 */
const botKey = (bizId: string) => `messengerBot:${bizId}`;
export const messengerBotEnabled = (bizId: string) => Boolean(getAppSetting<{ enabled?: boolean }>(botKey(bizId))?.enabled);
export function setMessengerBot(bizId: string, enabled: boolean, actor: string) {
  setAppSetting(botKey(bizId), { enabled, at: nowIso(), by: actor });
  audit(bizId, actor, enabled ? "messenger.bot_on" : "messenger.bot_off", undefined, {});
  return { enabled };
}

/** Fanpage THẬT còn dùng được: kết nối live, có page token, chưa bị thu hồi / hết hạn. */
function liveChannels(bizId: string): Row[] {
  return q.all<Row>(`SELECT ch.* FROM channel ch JOIN connection c ON c.id = ch.connection_id
    WHERE ch.biz_id = ? AND ch.platform = 'facebook' AND ch.enabled = 1 AND ch.secret_ciphertext IS NOT NULL
      AND c.mode = 'live' AND c.status NOT IN ('revoked','expired') ORDER BY ch.created_at`, bizId);
}

function blank(mode: MessengerSyncMode, startedAt: string, skipped?: string): MessengerSyncSummary {
  return { mode, startedAt, finishedAt: nowIso(), channels: 0, conversations: 0, newMessages: 0, routed: 0, errors: [], transient: 0, pages: [], ...(skipped ? { skipped } : {}) };
}

export async function syncMessenger(bizId: string, opts: MessengerSyncOptions = {}): Promise<MessengerSyncSummary> {
  const mode: MessengerSyncMode = opts.mode === "backfill" ? "backfill" : "incremental";
  const now = opts.now ?? new Date();
  const startedAt = now.toISOString();
  let channels = liveChannels(bizId);
  if (opts.channelIds?.length) channels = channels.filter((c) => opts.channelIds!.includes(c.id));
  if (!channels.length) return blank(mode, startedAt, NO_PAGE); // không có Trang thật → không gọi Facebook, không ghi gì
  if (running.has(bizId)) return blank(mode, startedAt, SYNC_BUSY);
  running.add(bizId);
  const out = blank(mode, startedAt);
  try {
    for (const ch of channels) {
      const r = await syncChannel(bizId, ch, mode, opts, now).catch((e) => channelFailed(bizId, ch, e, out));
      out.pages.push(r);
      out.channels++;
      out.conversations += r.conversations;
      out.newMessages += r.newMessages;
      out.routed += r.routed;
    }
  } finally {
    running.delete(bizId);
  }
  out.finishedAt = nowIso();
  setAppSetting(statusKey(bizId), out);
  if (out.newMessages || out.routed) emit(bizId, "conversation.message_in", { source: "messenger_sync" });
  emit(bizId, "messenger.synced", { mode, channels: out.channels, newMessages: out.newMessages, routed: out.routed, errors: out.errors.length });
  if (mode === "backfill") audit(bizId, "messenger_sync", "messenger.backfill", undefined, { channels: out.channels, conversations: out.conversations, newMessages: out.newMessages, errors: out.errors });
  return out;
}

async function syncChannel(bizId: string, ch: Row, mode: MessengerSyncMode, opts: MessengerSyncOptions, now: Date): Promise<MessengerPageResult> {
  const conn = connectorForChannel(ch);
  const res: MessengerPageResult = { channelId: ch.id, name: ch.name, ok: true, conversations: 0, newMessages: 0, routed: 0 };
  if (conn.mode !== "live" || !conn.listConversations) return { ...res, ok: false, error: "Kênh này chưa hỗ trợ đồng bộ Messenger" };
  const meta: Row = ch.meta ?? {};
  // Trang thật kết nối từ trước khi có tính năng này → kéo lịch sử 1 lần (khoá theo kênh, trùng khoá lúc kết nối).
  if (mode === "incremental" && !meta.messengerBackfillAt) {
    enqueue("chat", "messenger.sync", { bizId, mode: "backfill", days: 30, channelIds: [ch.id] }, { bizId, idempotencyKey: `messenger:backfill:${ch.id}`, lockKey: `messenger:sync:${bizId}`, maxAttempts: 5 });
  }
  const days = Math.min(90, Math.max(1, Math.round(opts.days ?? 30)));
  const cursor = meta.messengerSyncedAt as string | undefined;
  // Lùi 2 phút so với con trỏ: tin đến sát lúc chạy lượt trước không bị sót (đã có thì bỏ qua theo mid).
  const since = new Date(mode === "backfill" ? now.getTime() - days * DAY_MS : cursor ? new Date(cursor).getTime() - 2 * 60_000 : now.getTime() - DAY_MS).toISOString();
  const lim = LIMITS[mode];
  const pageId = String(ch.external_id);
  const threads = await conn.listConversations({ pageId, since, limit: lim.threads });
  for (const t of threads) {
    let msgs = t.messages;
    const oldest = msgs.at(-1)?.createdTime;
    // Thread còn tin cũ hơn mà vẫn trong khoảng cần lấy → đọc thêm (tối đa lim.messages tin).
    if (t.hasMoreMessages && msgs.length < lim.messages && conn.listConversationMessages && (!oldest || oldest >= since)) {
      try {
        msgs = await conn.listConversationMessages(t.threadId, { pageId, since, limit: lim.messages });
      } catch (e) {
        if (e instanceof ConnectorError && (e.kind === "AuthError" || e.kind === "PolicyRejected")) throw e;
        logger.warn("messenger_sync.thread_messages_failed", { channel: ch.id, error: e instanceof Error ? e.message : String(e) }); // dùng tạm tin kèm theo
      }
    }
    const asc = msgs.filter((m) => m.createdTime >= since).slice(0, lim.messages).reverse(); // Graph trả mới trước
    const r = storeThread(bizId, ch, t, asc, mode, now);
    if (r.touched) res.conversations++;
    res.newMessages += r.newMessages;
    res.routed += r.routed;
  }
  update("channel", ch.id, {
    meta: {
      ...metaOf(ch.id),
      messengerSyncedAt: !cursor || now.toISOString() > cursor ? now.toISOString() : cursor,
      ...(mode === "backfill" ? { messengerBackfillAt: now.toISOString() } : {}),
      messengerSync: { status: "ok", at: nowIso(), error: null, threads: threads.length },
    },
  });
  return res;
}

/** Lỗi của 1 Trang: token hết hạn / thiếu quyền → đánh dấu Trang (và kết nối khi hết hạn) + báo 1 lần; lỗi tạm → lượt sau thử lại. */
function channelFailed(bizId: string, ch: Row, e: unknown, out: MessengerSyncSummary): MessengerPageResult {
  const kind = e instanceof ConnectorError ? e.kind : "Unknown";
  const permanent = kind === "AuthError" || kind === "PolicyRejected";
  const msg = kind === "PolicyRejected"
    ? "Facebook chưa cho đọc tin nhắn của Trang (thiếu quyền pages_messaging) — tạo lại token Trang có quyền pages_messaging rồi dán vào Trung tâm tích hợp → Facebook"
    : kind === "AuthError" ? (e as Error).message
      : `Tạm thời không đọc được tin nhắn (${e instanceof Error ? e.message : String(e)}) — sẽ tự thử lại lượt sau`;
  const meta = metaOf(ch.id);
  const prev = meta.messengerSync?.status;
  update("channel", ch.id, { meta: { ...meta, messengerSync: { status: permanent ? "error" : "retrying", at: nowIso(), error: msg } } });
  if (ch.connection_id && permanent) {
    update("connection", ch.connection_id, { last_error: msg, last_health_at: nowIso(), ...(kind === "AuthError" ? { status: "expired" } : {}) });
  }
  if (permanent && prev !== "error") {
    emit(bizId, "alert.raised", { level: "warning", text: `Đồng bộ Messenger của Trang "${ch.name}" bị dừng: ${msg}` });
    audit(bizId, "messenger_sync", "messenger.sync_failed", { type: "channel", id: ch.id }, { error: msg });
  }
  if (!permanent) out.transient++;
  logger.warn("messenger_sync.failed", { channel: ch.id, kind, error: e instanceof Error ? e.message : String(e) });
  out.errors.push(`${ch.name}: ${msg}`);
  return { channelId: ch.id, name: ch.name, ok: false, conversations: 0, newMessages: 0, routed: 0, error: msg };
}

/** Đọc lại meta của kênh ngay trước khi ghi (chỗ khác có thể vừa sửa: cách đăng, trình duyệt…). */
const metaOf = (channelId: string): Row => (byId<Row>("channel", channelId)?.meta ?? {}) as Row;

/** Giữ chỗ chống trùng giống webhook (raw_event.dedupe_key UNIQUE). true = lượt này giữ được. */
function claimMid(mid: string, pageId: string, psid: string, text: string): boolean {
  const at = nowIso();
  const payload = JSON.stringify({ messageId: mid, pageId, psid: psid.slice(-6), text: maskPhonesInText(text.slice(0, 200)), source: "messenger_sync" });
  const r = q.run("INSERT OR IGNORE INTO raw_event (id, platform, received_at, signature_ok, payload, dedupe_key, created_at, updated_at) VALUES (?, 'meta', ?, 1, ?, ?, ?, ?)", uuidv7(), at, payload, `meta:${mid}`, at, at);
  return Number(r.changes) === 1;
}
/** Webhook đã nhận tin này và job chat.ingest của nó chưa chạy xong → để job đó lưu + trả lời (không chen). */
function ingestPending(mid: string): boolean {
  return Boolean(q.get("SELECT id FROM job WHERE idempotency_key = ? AND status IN ('queued','running')", `ingest:messenger:${mid}`));
}
const GENERIC_NAME = /^Khách FB /;

function storeThread(bizId: string, ch: Row, t: MessengerThread, asc: MessengerSyncMessage[], mode: MessengerSyncMode, now: Date) {
  const psid = t.customer.psid;
  const pageId = String(ch.external_id);
  let conv = q.get<Row>("SELECT * FROM conversation WHERE biz_id = ? AND channel = 'messenger' AND external_id = ?", bizId, psid);
  let touched = false;
  if (!conv) {
    if (!asc.length) return { touched, newMessages: 0, routed: 0 }; // không tạo hội thoại rỗng
    conv = insert("conversation", {
      biz_id: bizId, channel: "messenger", external_id: psid, customer_ref: `cust_${psid}`, customer_name: t.customer.name ?? `Khách FB ${psid.slice(-6)}`,
      state: "new", tags: [], unread: 0, ext: { pageId, threadId: t.threadId },
    });
    touched = true;
  } else {
    // Hội thoại do webhook / chăm khách tạo trước: gắn thêm thread id + Trang, thay tên chung chung bằng tên thật.
    const ext: Row = conv.ext ?? {};
    const patch: Row = {};
    if (ext.threadId !== t.threadId || !ext.pageId) patch.ext = { ...ext, pageId: ext.pageId ?? pageId, threadId: t.threadId };
    if (t.customer.name && (!conv.customer_name || GENERIC_NAME.test(conv.customer_name))) patch.customer_name = t.customer.name;
    if (Object.keys(patch).length) { update("conversation", conv.id, patch); Object.assign(conv, patch); }
  }
  const lastPageAt = asc.filter((m) => m.fromPage).map((m) => m.createdTime).sort().at(-1);
  let newMessages = 0, routed = 0, unreadAdd = 0;
  let lastAt: string | null = conv.last_message_at ?? null;
  let preview: string | null = null;
  let lastCustomer: string | null = conv.last_customer_at ?? null;
  const bump = (m: MessengerSyncMessage) => { if (!lastAt || m.createdTime >= lastAt) { lastAt = m.createdTime; preview = m.text.slice(0, 140); } };

  for (const m of asc) {
    if (q.get("SELECT id FROM message WHERE conversation_id = ? AND external_id = ?", conv.id, m.mid)) continue;
    if (m.fromPage) {
      // Tin của Trang: bot/nhân viên gửi từ app đã lưu theo message_id; dự phòng: cùng nội dung trong ±10 phút → là tin đó.
      const t0 = new Date(m.createdTime).getTime();
      const same = q.get<Row>(`SELECT id, external_id FROM message WHERE conversation_id = ? AND direction = 'out' AND json_extract(body, '$.text') = ? AND sent_at BETWEEN ? AND ?`,
        conv.id, m.text, new Date(t0 - 10 * 60_000).toISOString(), new Date(t0 + 10 * 60_000).toISOString());
      if (same) { if (!same.external_id) update("message", same.id, { external_id: m.mid }); continue; }
      // Trả lời gõ ở Meta Business Suite / hộp thư Trang (không qua app).
      const out = insert("message", { biz_id: bizId, conversation_id: conv.id, direction: "out", sender: "page", body: { text: m.text }, external_id: m.mid, meta: { source: "messenger_sync", via: "facebook", attachment: m.hasAttachment || undefined, ...(m.attachments?.length ? { attachments: m.attachments } : {}) }, sent_at: m.createdTime });
      if (m.attachments?.length) queueChatMedia(bizId, out.id);
      newMessages++; touched = true; bump(m);
      continue;
    }
    const fresh = mode === "incremental" && now.getTime() - new Date(m.createdTime).getTime() <= FRESH_MS && (!lastPageAt || m.createdTime > lastPageAt);
    // Tin chỉ có tệp/video (hoặc tắt "bot xem ảnh" / tắt bot Messenger): chỉ lưu cho nhân viên. Chỉ có ẢNH + bật xem ảnh + bật bot
    // → đi đường webhook (bot xem ảnh rồi trả lời). Có chữ kèm ảnh → bot đọc phần chữ (+ mô tả ảnh nếu được phép).
    const imageOnlyForBot = Boolean(m.attachmentOnly && m.attachments?.some((a) => a.type === "image" || a.type === "sticker") && messengerBotEnabled(bizId) && chatVisionEnabled(bizId));
    if (fresh && (!m.attachmentOnly || imageOnlyForBot)) {
      if (claimMid(m.mid, pageId, psid, m.text)) {
        // Tin khách mới mà webhook chưa nhận → ĐÚNG đường webhook: bot trả lời, bắt SĐT, chăm khách, kill switch, trạng thái hội thoại.
        enqueue("chat", "chat.ingest", {
          bizId, msg: { channel: "messenger", externalConversationId: psid, customerName: conv.customer_name, text: m.text.slice(0, 4000), messageId: m.mid, pageExternalId: pageId, sentAt: m.createdTime, ...(m.attachments?.length ? { attachments: m.attachments } : {}), ...(m.attachmentOnly ? { attachmentOnly: true } : {}), ...(messengerBotEnabled(bizId) ? {} : { noReply: true, suggestOnly: true }) },
        }, { bizId, idempotencyKey: `ingest:messenger:${m.mid}`, lockKey: `conv:messenger:${psid}`, maxAttempts: 3 });
        routed++; touched = true;
        continue;
      }
      if (ingestPending(m.mid)) continue;
    } else if (!claimMid(m.mid, pageId, psid, m.text) && ingestPending(m.mid)) {
      continue; // webhook đang xử lý tin này
    }
    // Lịch sử (backfill) / tin cũ hơn 15 phút / ảnh-tệp: CHỈ LƯU — không bot, không chăm khách, không lên đơn.
    const saved = insert("message", { biz_id: bizId, conversation_id: conv.id, direction: "in", sender: "customer", body: { text: m.text }, external_id: m.mid, meta: { source: "messenger_sync", ...(m.hasAttachment ? { attachment: true } : {}), ...(m.attachments?.length ? { attachments: m.attachments } : {}) }, sent_at: m.createdTime });
    if (m.attachments?.length) queueChatMedia(bizId, saved.id);
    newMessages++; touched = true; bump(m);
    if (!lastCustomer || m.createdTime > lastCustomer) lastCustomer = m.createdTime;
    if (mode === "incremental") unreadAdd++;
  }
  const patch: Row = {};
  if (preview !== null) { patch.last_message_at = lastAt; patch.last_preview = preview; }
  if (lastCustomer !== (conv.last_customer_at ?? null)) patch.last_customer_at = lastCustomer;
  if (unreadAdd) patch.unread = (conv.unread ?? 0) + unreadAdd;
  if (Object.keys(patch).length) update("conversation", conv.id, patch);
  return { touched, newMessages, routed };
}

// ---------------- Chạy tay (API) + trạng thái ----------------
function backfillJob(bizId: string): Row | undefined {
  return q.get<Row>("SELECT id, status FROM job WHERE biz_id = ? AND name = 'messenger.sync' AND status IN ('queued','running') AND json_extract(payload, '$.mode') = 'backfill' LIMIT 1", bizId);
}

/** Sếp bấm "Đồng bộ Messenger": tin mới → chạy ngay, trả tóm tắt; kéo tin cũ → xếp job (có thể vài phút). */
export async function runMessengerSyncNow(bizId: string, input: { mode?: MessengerSyncMode; days?: number } = {}) {
  const mode = input.mode === "backfill" ? "backfill" : "incremental";
  const pages = liveChannels(bizId).length;
  if (!pages) throw new AppError("NO_PAGE", "Chưa có Fanpage thật kết nối — vào Quảng cáo → Trung tâm tích hợp → Facebook để kết nối Trang (cần quyền pages_messaging)", 400);
  if (mode === "backfill") {
    const ex = backfillJob(bizId);
    if (ex) return { queued: true, jobId: ex.id, already: true, channels: 0, conversations: 0, newMessages: 0, errors: [] as string[] };
    const days = Math.min(90, Math.max(1, Math.round(input.days ?? 30)));
    const jobId = enqueue("chat", "messenger.sync", { bizId, mode: "backfill", days, manual: true }, { bizId, lockKey: `messenger:sync:${bizId}`, maxAttempts: 5 });
    return { queued: true, jobId, channels: pages, conversations: 0, newMessages: 0, errors: [] as string[] };
  }
  const r = await syncMessenger(bizId, { mode: "incremental" });
  if (r.skipped === SYNC_BUSY) throw new AppError("BUSY", SYNC_BUSY, 409);
  return { queued: false, channels: r.channels, conversations: r.conversations, newMessages: r.newMessages, routed: r.routed, errors: r.errors };
}

export function messengerSyncStatus(bizId: string) {
  const last = getAppSetting<MessengerSyncSummary>(statusKey(bizId)) ?? null;
  const pages = q.all<Row>(`SELECT ch.id, ch.name, ch.external_id, ch.meta, ch.secret_ciphertext IS NOT NULL has_token, c.mode, c.status conn_status
    FROM channel ch LEFT JOIN connection c ON c.id = ch.connection_id WHERE ch.biz_id = ? AND ch.platform = 'facebook' AND ch.enabled = 1 ORDER BY ch.created_at`, bizId)
    .map((p) => {
      const live = Boolean(p.has_token) && p.mode === "live" && p.conn_status !== "revoked";
      const s = (p.meta ?? {}).messengerSync ?? {};
      return {
        channelId: p.id, name: p.name, pageId: p.external_id, live,
        syncedAt: p.meta?.messengerSyncedAt ?? null, backfillAt: p.meta?.messengerBackfillAt ?? null,
        status: live && p.conn_status === "expired" ? "error" : (s.status ?? (live ? "pending" : "not_connected")),
        error: live && p.conn_status === "expired" && !s.error ? "Kết nối Facebook đã hết hạn — bấm Kết nối lại" : live ? (s.error ?? null) : "Trang này chưa có liên kết API (page token) — không đọc được tin nhắn",
      };
    });
  return {
    lastRunAt: last?.finishedAt ?? null, lastResult: last, running: running.has(bizId), backfillQueued: Boolean(backfillJob(bizId)),
    livePages: pages.filter((p) => p.live).length, pages,
    botReply: messengerBotEnabled(bizId),
  };
}

export const MESSENGER_HANDLERS: Record<string, Handler> = {
  // Lịch nền mỗi 1 phút (incremental, chỉ Trang thật) + job kéo tin cũ (backfill) khi vừa kết nối Trang / Sếp bấm.
  "messenger.sync": async (p, job) => {
    const bizId = (p.bizId ?? job.biz_id) as string;
    const mode: MessengerSyncMode = p.mode === "backfill" ? "backfill" : "incremental";
    const r = await syncMessenger(bizId, { mode, days: p.days, channelIds: p.channelIds });
    if (mode !== "backfill") return; // incremental: lỗi đã ghi theo Trang, lượt 1 phút sau tự thử lại — không ném lỗi
    if (r.skipped === SYNC_BUSY) throw new Error(SYNC_BUSY); // hàng đợi thử lại sau
    if (r.transient > 0) throw new Error(`Kéo tin cũ chưa xong: ${r.errors.join("; ")}`); // lỗi tạm → thử lại (đã có thì bỏ qua theo mid)
  },
};
