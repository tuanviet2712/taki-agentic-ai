import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { nowIso, uuidv7 } from "@dotaka/shared";
import { SCHEMA } from "./schema.ts";

// Columns stored as JSON text; parsed on read, stringified on write.
const JSON_COLS = new Set([
  "settings", "config", "options", "last_result", "ext", "scopes", "data", "tags", "input", "output", "depends_on", "error", "limits", "tools", "preview",
  "payload", "metrics", "components", "reasons", "definition", "skipped", "summary", "params", "before", "after",
  "meta", "analysis", "evidence", "applies_when", "diff", "lesson_ids", "report", "permissions", "result",
  "state", "questions", "answers", "decision", "refs", "skills", "log", "history", "decode",
  "platform_state",
]);

let _db: DatabaseSync | null = null;

export function openDb(path = process.env.DB_PATH ?? "data/dotaka.db"): DatabaseSync {
  if (_db) return _db;
  const file = path === ":memory:" ? path : resolve(process.cwd(), path);
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  _db = new DatabaseSync(file);
  _db.exec(SCHEMA);
  migrate(_db);
  return _db;
}
/** Forward-only column additions for databases created by an earlier version (expand, never contract). */
const MIGRATIONS: [table: string, column: string, ddl: string][] = [
  ["assistant_thread", "ai_provider", "TEXT"],
  ["assistant_thread", "ai_account_id", "TEXT"],
  ["task_run", "skills", "TEXT"],
  ["publish_job", "mode", "TEXT NOT NULL DEFAULT 'publish'"],
  ["publish_job", "asset_id", "TEXT"],
  ["publish_job", "draft_url", "TEXT"],
  // Trạng thái nền tảng của lượt đăng (mã thật đã nhận, số lần thử lại khi bị giới hạn tần suất…) — xoá khi "Đăng lại".
  ["publish_job", "platform_state", "TEXT NOT NULL DEFAULT '{}'"],
  ["content_item", "asset_id", "TEXT"],
  // Connections hub (live platform accounts, whitelist, automation configs)
  ["connection", "config", "TEXT NOT NULL DEFAULT '{}'"],
  ["connection", "last_error", "TEXT"],
  ["ad_account", "whitelisted", "INTEGER NOT NULL DEFAULT 1"],
  ["ad_account", "status", "TEXT NOT NULL DEFAULT 'active'"],
  ["ad_account", "meta", "TEXT NOT NULL DEFAULT '{}'"],
  ["channel", "whitelisted", "INTEGER NOT NULL DEFAULT 1"],
  ["channel", "secret_ciphertext", "TEXT"],
  ["channel", "meta", "TEXT NOT NULL DEFAULT '{}'"],
  ["campaign", "meta", "TEXT NOT NULL DEFAULT '{}'"],
  ["ad", "meta", "TEXT NOT NULL DEFAULT '{}'"],
  ["ad_candidate", "ad_account_id", "TEXT"],
  ["ad_candidate", "options", "TEXT NOT NULL DEFAULT '{}'"],
  // External thread info (ZL-CRM conversation id, Zalo nick, thread id) for sending replies/follow-ups
  ["conversation", "ext", "TEXT NOT NULL DEFAULT '{}'"],
  ["follow_up_plan", "meta", "TEXT NOT NULL DEFAULT '{}'"],
  // CEO feedback on Ngân Nguyệt answers (👍/👎 + note) — "Phản hồi" tab
  ["assistant_message", "feedback", "TEXT"],
  ["assistant_message", "feedback_note", "TEXT"],
  // 1 = went through a sandbox publisher: nothing reached the real page/channel (shown as "Mô phỏng" everywhere)
  ["publish_job", "simulated", "INTEGER NOT NULL DEFAULT 0"],
  ["post", "simulated", "INTEGER NOT NULL DEFAULT 0"],
  // Last customer message time (Messenger 24h reply window, set by Messenger sync)
  ["conversation", "last_customer_at", "TEXT"],
  // Chăm khách từ bình luận: bình luận thật trên Facebook (id, người viết, giờ viết) + giữ chỗ gửi (chống nhắn trùng)
  ["post_comment", "external_id", "TEXT"],
  ["post_comment", "author_external_id", "TEXT"],
  ["post_comment", "parent_external_id", "TEXT"],
  ["post_comment", "source", "TEXT"],
  ["post_comment", "replied_at", "TEXT"],
  ["post_comment", "dm_sent_at", "TEXT"],
  ["post_comment", "external_created_at", "TEXT"],
  ["post", "meta", "TEXT NOT NULL DEFAULT '{}'"],
  // Lái tự động: khóa chống trùng + nền tảng/khóa học/ý tưởng Trinh sát của chiến dịch tự tạo
  ["goal", "params", "TEXT NOT NULL DEFAULT '{}'"],
  // Đơn chốt từ chat: thông tin giao hàng (SĐT mã hoá) + trạng thái đẩy sang Pancake POS (meta.shipping / meta.pancake / meta.approvalId);
  // external_id = "pancake:<mã đơn Pancake>"; product_key = key sản phẩm trong DNA
  ["orders", "meta", "TEXT NOT NULL DEFAULT '{}'"],
  ["orders", "external_id", "TEXT"],
  ["orders", "product_key", "TEXT"],
];
function migrate(d: DatabaseSync) {
  for (const [table, column, ddl] of MIGRATIONS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      // Backfill: before this column existed every publish went through the sandbox publisher.
      if (column === "simulated" && table === "publish_job") d.exec("UPDATE publish_job SET simulated = 1 WHERE status IN ('done','draft_uploaded') OR draft_url LIKE 'https://sandbox.taki.vn/%'");
      if (column === "simulated" && table === "post") d.exec("UPDATE post SET simulated = 1 WHERE permalink LIKE 'https://sandbox.taki.vn/%' OR permalink IS NULL");
    }
  }
  d.exec("CREATE UNIQUE INDEX IF NOT EXISTS post_comment_external ON post_comment (post_id, external_id) WHERE external_id IS NOT NULL");
  // Một đơn Pancake chỉ ứng với một đơn nội bộ (NULL không bao giờ coi là trùng).
  d.exec("CREATE UNIQUE INDEX IF NOT EXISTS orders_pancake_external ON orders (biz_id, external_id) WHERE external_id IS NOT NULL");
}

export function db(): DatabaseSync {
  return _db ?? openDb();
}
export function closeDb() {
  _db?.close();
  _db = null;
}

export type Row = Record<string, any>;

function decode(row: Row | undefined): Row | undefined {
  if (!row) return row;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    // `body` is JSON for messages but plain text elsewhere: only decode objects.
    if (typeof v === "string" && (JSON_COLS.has(k) || (k === "body" && v.startsWith("{")))) {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    } else out[k] = v;
  }
  return out;
}
function encode(v: unknown): SQLInputValue {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v as SQLInputValue;
}

export const q = {
  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return db().prepare(sql).all(...params.map(encode)).map((r) => decode(r as Row)) as T[];
  },
  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return decode(db().prepare(sql).get(...params.map(encode)) as Row | undefined) as T | undefined;
  },
  run(sql: string, ...params: unknown[]) {
    return db().prepare(sql).run(...params.map(encode));
  },
  scalar<T = number>(sql: string, ...params: unknown[]): T {
    const r = db().prepare(sql).get(...params.map(encode)) as Row | undefined;
    return (r ? Object.values(r)[0] : null) as T;
  },
};

export function insert<T extends Row>(table: string, data: T): T & Row & { id: string; created_at: string } {
  const now = nowIso();
  const row: Row = { id: uuidv7(), created_at: now, updated_at: now, ...data };
  const cols = Object.keys(row);
  db().prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => encode(row[c])));
  return row as T & Row & { id: string; created_at: string };
}

export function update(table: string, id: string, patch: Row) {
  const row: Row = { ...patch, updated_at: nowIso() };
  const cols = Object.keys(row);
  db().prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((c) => encode(row[c])), id);
}

/** Settings shared by every business (table app_setting, JSON values). */
export function getAppSetting<T>(key: string): T | undefined {
  const v = q.get<{ value: unknown }>("SELECT value FROM app_setting WHERE key = ?", key)?.value;
  if (v == null) return undefined;
  if (typeof v !== "string") return v as T;
  try { return JSON.parse(v) as T; } catch { return undefined; }
}
export function setAppSetting(key: string, value: unknown) {
  db().prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, JSON.stringify(value), nowIso());
}

/** Account of the person operating the system (top-right menu; Ngân Nguyệt addresses them by "addressAs"). */
export interface OwnerProfile { name: string; title: string; email: string; phone: string; addressAs: string; avatar: string | null }
export const DEFAULT_PROFILE: OwnerProfile = { name: "", title: "Chủ doanh nghiệp", email: "", phone: "", addressAs: "Sếp", avatar: null };
export function ownerProfile(): OwnerProfile {
  const saved = getAppSetting<Partial<OwnerProfile>>("profile") ?? {};
  const p: OwnerProfile = { ...DEFAULT_PROFILE, ...saved };
  if (!p.addressAs.trim()) p.addressAs = "Sếp";
  if (!p.name.trim()) p.name = p.addressAs;
  return p;
}

export function byId<T = Row>(table: string, id: string): T | undefined {
  return q.get<T>(`SELECT * FROM ${table} WHERE id = ?`, id);
}

let txDepth = 0;
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  txDepth++;
  db().exec("BEGIN");
  try {
    const r = fn();
    db().exec("COMMIT");
    return r;
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  } finally {
    txDepth--;
  }
}

// ---------- Events: transactional outbox + in-process bus (spec §14) ----------
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emit(bizId: string | null, type: string, payload: Row = {}) {
  const row = insert("outbox", { biz_id: bizId, type, payload });
  // Dispatch after the current tick so a surrounding transaction commits first.
  setImmediate(() => {
    update("outbox", row.id, { dispatched_at: nowIso() });
    bus.emit("event", { id: row.id, bizId, type, payload, at: row.created_at });
    bus.emit(type, { bizId, ...payload });
  });
}

export function audit(bizId: string, actor: string, event: string, ref?: { type: string; id: string }, data: Row = {}) {
  insert("audit_log", { biz_id: bizId, at: nowIso(), actor, event, ref_type: ref?.type ?? null, ref_id: ref?.id ?? null, data });
}

// ---------- Biz settings (kill switches, autonomy defaults, caps) ----------
export interface BizSettings {
  killSwitch: { publish: boolean; ads: boolean; chat: boolean; all: boolean };
  caps: { maxTotalDailyAdBudget: number; maxAdsCreatedPerDay: number; maxPostsPerDayPerChannel: number };
  quietHours: [number, number];
  explorationPct: number;
  approvalExpiryHours: number;
  postScoreThreshold: number;
  attributionMinConfidence: number;
  backupPerson?: string;
  /** Bot chat: vision = bot xem ảnh khách gửi (mặc định bật; tắt → ảnh chỉ lưu cho nhân viên). Cần thêm bot Messenger đang bật. */
  /** Bài viết: autoImage = tự tạo ảnh đi kèm mỗi bài (mặc định bật; ảnh do kết nối AI đang chọn tạo: Claude thiết kế / ChatGPT tạo ảnh). */
  content?: { autoImage?: boolean };
  chat?: { vision?: boolean; /** Bot tự chốt đơn: khách rõ ý mua + có SĐT -> đơn nháp [ĐỎ] chờ Sếp duyệt (mặc định bật; false = chuyển người như cũ). */ closeOrders?: boolean };
  /**
   * Tự động phê duyệt (trang Duyệt & Phê duyệt): Sếp bật tay; bài / kịch bản / bài SEO / video mới vào hộp Duyệt mà review "Đạt" và điểm ≥ minScore
   * thì được duyệt luôn và đi xuống phần đăng bài. Mặc định TẮT. Không bao giờ áp cho ads / ngân sách / tin gửi khách / đơn hàng / đề xuất học.
   */
  autoApprove?: { enabled: boolean; minScore: number };
}
export const DEFAULT_SETTINGS: BizSettings = {
  killSwitch: { publish: false, ads: false, chat: false, all: false },
  caps: { maxTotalDailyAdBudget: 80_000_000, maxAdsCreatedPerDay: 5, maxPostsPerDayPerChannel: 3 },
  quietHours: [22, 7],
  explorationPct: 15,
  approvalExpiryHours: 72,
  postScoreThreshold: 70,
  attributionMinConfidence: 0.6,
};
export function bizSettings(bizId: string): BizSettings {
  const b = q.get<{ settings: Partial<BizSettings> }>("SELECT settings FROM biz WHERE id = ?", bizId);
  return { ...DEFAULT_SETTINGS, ...(b?.settings ?? {}), killSwitch: { ...DEFAULT_SETTINGS.killSwitch, ...(b?.settings?.killSwitch ?? {}) } };
}
export function isKilled(bizId: string, area: "publish" | "ads" | "chat"): boolean {
  const k = bizSettings(bizId).killSwitch;
  return k.all || k[area];
}

export function activeDna(bizId: string): Row | undefined {
  return q.get("SELECT * FROM dna_profile WHERE biz_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1", bizId);
}

/** Doanh nghiệp đã lưu trữ (settings.archived): ẩn khỏi bộ chọn, dừng lịch nền — dữ liệu giữ nguyên. */
export const NOT_ARCHIVED = "COALESCE(json_extract(settings, '$.archived'), 0) = 0";
export function isActiveBiz(id: string | null | undefined): boolean {
  return Boolean(id && q.get(`SELECT id FROM biz WHERE id = ? AND ${NOT_ARCHIVED}`, id));
}
/** Mọi doanh nghiệp đang hoạt động (cho việc nền: lịch, đảm bảo cấu hình). */
export function activeBizIds(): string[] {
  return q.all<{ id: string }>(`SELECT id FROM biz WHERE ${NOT_ARCHIVED} ORDER BY created_at`).map((b) => b.id);
}

export function defaultBizId(): string {
  const b = q.get<{ id: string }>(`SELECT id FROM biz WHERE ${NOT_ARCHIVED} ORDER BY created_at LIMIT 1`)
    ?? q.get<{ id: string }>("SELECT id FROM biz ORDER BY created_at LIMIT 1");
  if (!b) throw new Error("No biz found. Run `pnpm seed` first.");
  return b.id;
}
