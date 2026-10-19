// SQLite dialect of the spec §4 schema. Same tables/columns as the Postgres sketch so the
// migration to Postgres+pgvector is mechanical: TEXT(json) -> jsonb, TEXT ts -> timestamptz.
// Append-only tables: metric_snapshot, post_metric_snapshot, audit_log, message, raw_event, jev_judgment, model_usage.
export const SCHEMA = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS biz (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  currency TEXT NOT NULL DEFAULT 'VND', settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_account (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', last_active_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS connection (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, platform TEXT NOT NULL, external_account_id TEXT NOT NULL,
  display_name TEXT, token_ciphertext TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'sandbox', expires_at TEXT, last_health_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (biz_id, platform, external_account_id)
);

-- Knowledge & DNA
-- Named ChatGPT login profiles; OAuth credentials stay in their isolated CLI home, never in API responses.
CREATE TABLE IF NOT EXISTS ai_account (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, provider TEXT NOT NULL, name TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_account_biz ON ai_account (biz_id, provider);

CREATE TABLE IF NOT EXISTS dna_profile (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
  data TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_doc (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]', body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'processed',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_chunk (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, doc_id TEXT NOT NULL, idx INTEGER NOT NULL, text TEXT NOT NULL,
  source_ref TEXT NOT NULL, valid_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Planning
CREATE TABLE IF NOT EXISTS goal (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, template TEXT NOT NULL,
  budget_ads INTEGER NOT NULL DEFAULT 0, due_date TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_item (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, goal_id TEXT, task_id TEXT, agent_key TEXT NOT NULL, kind TEXT NOT NULL,
  channel TEXT, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, variant_of TEXT, scheduled_at TEXT,
  review_score_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_score (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  rubric_key TEXT NOT NULL, rubric_version INTEGER NOT NULL, total REAL NOT NULL, verdict TEXT NOT NULL,
  result TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Orchestration
CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, goal_id TEXT, parent_id TEXT, agent_key TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL, input TEXT NOT NULL DEFAULT '{}', output TEXT, depends_on TEXT NOT NULL DEFAULT '[]',
  revisions INTEGER NOT NULL DEFAULT 0, progress REAL NOT NULL DEFAULT 0, step TEXT, dry_run INTEGER NOT NULL DEFAULT 0,
  error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_status ON task (biz_id, status);
CREATE TABLE IF NOT EXISTS task_run (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, task_id TEXT NOT NULL, attempt INTEGER NOT NULL, prompt_version_id TEXT NOT NULL,
  status TEXT NOT NULL, output TEXT, error TEXT, model TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
  tokens_cached INTEGER DEFAULT 0, cost_micros INTEGER DEFAULT 0, skills TEXT, started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approval (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, title TEXT NOT NULL,
  agent_key TEXT, risk TEXT NOT NULL DEFAULT 'low', status TEXT NOT NULL, review_score_id TEXT, preview TEXT NOT NULL DEFAULT '{}',
  decided_by TEXT, decision_note TEXT, decided_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS approval_status ON approval (biz_id, status);
CREATE TABLE IF NOT EXISTS agent_config (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, agent_key TEXT NOT NULL, autonomy TEXT NOT NULL, enabled INTEGER NOT NULL,
  tools TEXT NOT NULL, token_budget_run INTEGER, token_budget_day INTEGER, limits TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (biz_id, agent_key)
);
CREATE TABLE IF NOT EXISTS prompt_version (
  id TEXT PRIMARY KEY, agent_key TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, rubric_version INTEGER,
  status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (agent_key, version)
);
CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY, biz_id TEXT, queue TEXT NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL, run_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
  idempotency_key TEXT UNIQUE, lock_key TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_ready ON job (queue, status, run_at);
CREATE TABLE IF NOT EXISTS schedule (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, name TEXT NOT NULL, queue TEXT NOT NULL, every_minutes INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, label TEXT NOT NULL, last_run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (biz_id, name)
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, biz_id TEXT, type TEXT NOT NULL, payload TEXT NOT NULL, dispatched_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL,
  ref_type TEXT, ref_id TEXT, data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log (biz_id, at DESC);
CREATE TABLE IF NOT EXISTS model_usage (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, task_run_id TEXT, agent_key TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  tokens_in INTEGER, tokens_out INTEGER, tokens_cached INTEGER, cost_micros INTEGER, latency_ms INTEGER, at TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jev_judgment (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, purpose TEXT NOT NULL, subject_type TEXT, subject_id TEXT, source TEXT NOT NULL,
  model TEXT NOT NULL, state TEXT NOT NULL, questions TEXT NOT NULL, answers TEXT NOT NULL, decision TEXT,
  tokens_in INTEGER DEFAULT 0, latency_ms INTEGER DEFAULT 0, cost_micros INTEGER DEFAULT 0, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jev_recent ON jev_judgment (biz_id, created_at DESC);

-- Channels, posts, scoring
CREATE TABLE IF NOT EXISTS channel (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, platform TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
  external_id TEXT NOT NULL, connection_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publish_job (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, content_item_id TEXT NOT NULL, channel_id TEXT NOT NULL, scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, post_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS post (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, channel_id TEXT NOT NULL, external_id TEXT NOT NULL, content_item_id TEXT,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, published_at TEXT NOT NULL, permalink TEXT,
  ad_status TEXT NOT NULL DEFAULT 'none', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (channel_id, external_id)
);
CREATE TABLE IF NOT EXISTS post_metric_snapshot (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, post_id TEXT NOT NULL, mark TEXT NOT NULL, metrics TEXT NOT NULL,
  captured_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS post_comment (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, post_id TEXT NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL,
  label TEXT, label_source TEXT, label_confidence REAL, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Link đo click dưới bình luận (bài nào ra click): /r/<code> ghi click (IP đã băm, KHÔNG lưu IP thô) rồi 302 kèm UTM.
-- is_bot = 1: trình thu thập xem trước link (Facebook / Zalo…) — vẫn chuyển hướng nhưng không tính là click của khách.
CREATE TABLE IF NOT EXISTS track_link (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE, post_id TEXT, content_item_id TEXT, goal_id TEXT,
  product_key TEXT, channel TEXT, target_url TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS track_link_ci ON track_link (content_item_id);
CREATE INDEX IF NOT EXISTS track_link_post ON track_link (post_id);
CREATE TABLE IF NOT EXISTS track_click (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, link_id TEXT NOT NULL, at TEXT NOT NULL, ip_hash TEXT, ua TEXT, referer TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS track_click_link ON track_click (link_id, at);
-- Chăm khách từ bình luận (comment → trả lời công khai → inbox Private Reply → xin SĐT → kết bạn Zalo → follow-up).
-- 1 dòng = 1 người bình luận dưới 1 bài. SĐT lưu MÃ HOÁ (phone_cipher) + bản che (phone_masked) để hiển thị/nhật ký.
-- Research đối thủ (Radar xu hướng): kênh Sếp thêm tay (đối thủ + kênh của mình) và video quét được từ trang công khai.
CREATE TABLE IF NOT EXISTS research_channel (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, platform TEXT NOT NULL, url TEXT NOT NULL, handle TEXT, name TEXT NOT NULL,
  owner TEXT NOT NULL, group_name TEXT NOT NULL, notes TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  followers INTEGER, median_views INTEGER, video_count INTEGER NOT NULL DEFAULT 0,
  last_scan_at TEXT, last_error TEXT, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (biz_id, url)
);
CREATE TABLE IF NOT EXISTS research_video (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, research_channel_id TEXT NOT NULL, platform TEXT NOT NULL, external_id TEXT NOT NULL,
  url TEXT NOT NULL, title TEXT, views INTEGER NOT NULL DEFAULT 0, likes INTEGER, comments INTEGER, shares INTEGER,
  posted_at TEXT, duration_sec INTEGER, cover_text TEXT, pinned INTEGER NOT NULL DEFAULT 0, multiple REAL,
  history TEXT NOT NULL DEFAULT '[]', decode TEXT, decode_at TEXT, clone_task_id TEXT, clone_group TEXT,
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (research_channel_id, external_id)
);
CREATE INDEX IF NOT EXISTS research_video_hot ON research_video (biz_id, multiple, posted_at);
CREATE TABLE IF NOT EXISTS nurture_lead (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, post_id TEXT NOT NULL, comment_id TEXT NOT NULL UNIQUE, channel_id TEXT NOT NULL,
  author_name TEXT NOT NULL, author_external_id TEXT, comment_text TEXT, label TEXT, stage TEXT NOT NULL,
  conversation_id TEXT, psid TEXT, zalo_conversation_id TEXT, phone_cipher TEXT, phone_masked TEXT,
  zalo_account_id TEXT, zalo_uid TEXT,
  public_replied_at TEXT, dm_sent_at TEXT, customer_replied_at TEXT, reminder_sent_at TEXT, phone_at TEXT,
  friend_requested_at TEXT, friend_accepted_at TEXT, followup_at TEXT, ordered_at TEXT,
  reply_claimed_at TEXT, dm_claimed_at TEXT, friend_attempts INTEGER NOT NULL DEFAULT 0,
  next_check_at TEXT, last_error TEXT, log TEXT NOT NULL DEFAULT '[]', meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS nurture_lead_stage ON nurture_lead (biz_id, stage, next_check_at);
CREATE INDEX IF NOT EXISTS nurture_lead_conv ON nurture_lead (conversation_id);
-- Khách không nhận tin (opt-out): mọi lượt gửi TỰ ĐỘNG (bot/follow-up) đều kiểm bảng này.
-- channel: facebook (id người bình luận) · messenger (PSID) · zalo (mã hội thoại) · phone (external_id = phone_hash).
-- SĐT chỉ lưu dạng băm (phone_hash) + bản che (phone_masked) — không lưu số thật.
CREATE TABLE IF NOT EXISTS contact_optout (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, channel TEXT NOT NULL, external_id TEXT NOT NULL,
  phone_hash TEXT, phone_masked TEXT, name TEXT, reason TEXT, source TEXT NOT NULL, conversation_id TEXT,
  created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (biz_id, channel, external_id)
);
CREATE INDEX IF NOT EXISTS contact_optout_phone ON contact_optout (biz_id, phone_hash);
-- Kịch bản chốt đơn (Messenger + Zalo) theo từng sản phẩm trong DNA: 7 bước, băn khoăn thường gặp, tin nhắc lại.
CREATE TABLE IF NOT EXISTS sales_flow (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, product_key TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  source TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (biz_id, product_key)
);
-- Vòng lặp Thấu hiểu khách: 7 bước Lắng nghe → Sàng lọc → Nối dữ liệu → Phân nhóm → Thấu hiểu → Tối ưu → Feedback (data = kết quả từng bước + số liệu).
CREATE TABLE IF NOT EXISTS chat_insight (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_insight_recent ON chat_insight (biz_id, created_at DESC);
CREATE TABLE IF NOT EXISTS post_score (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, post_id TEXT NOT NULL, formula_version INTEGER NOT NULL, score REAL NOT NULL,
  low_data INTEGER NOT NULL DEFAULT 0, components TEXT NOT NULL, reasons TEXT NOT NULL, computed_at TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Ads
CREATE TABLE IF NOT EXISTS ad_account (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, platform TEXT NOT NULL, external_id TEXT NOT NULL, name TEXT NOT NULL,
  connection_id TEXT, currency TEXT NOT NULL DEFAULT 'VND', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaign (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, ad_account_id TEXT NOT NULL, platform TEXT NOT NULL, external_id TEXT NOT NULL,
  name TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL, daily_budget INTEGER, target_cpa INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ad (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, ad_account_id TEXT NOT NULL, platform TEXT NOT NULL, external_id TEXT NOT NULL,
  campaign_id TEXT, name TEXT NOT NULL, status TEXT NOT NULL, daily_budget INTEGER, currency TEXT NOT NULL DEFAULT 'VND',
  post_id TEXT, cooldown_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (ad_account_id, external_id)
);
CREATE TABLE IF NOT EXISTS metric_snapshot (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, day TEXT NOT NULL,
  metrics TEXT NOT NULL, source TEXT NOT NULL, captured_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS metric_lookup ON metric_snapshot (biz_id, entity_type, entity_id, day, captured_at DESC);
CREATE TABLE IF NOT EXISTS ad_template (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL, definition TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ad_candidate (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, post_id TEXT NOT NULL, platform TEXT NOT NULL, ad_template_id TEXT,
  daily_budget INTEGER NOT NULL, score REAL NOT NULL, reasons TEXT NOT NULL, status TEXT NOT NULL, decision_note TEXT,
  ad_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS post_ad_link (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, post_id TEXT NOT NULL, ad_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rule (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', definition TEXT NOT NULL,
  mode TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 100,
  consecutive_errors INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rule_run (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL, mode TEXT NOT NULL,
  evaluated INTEGER NOT NULL, matched INTEGER NOT NULL, skipped TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS action (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, rule_run_id TEXT, task_run_id TEXT, actor TEXT NOT NULL, type TEXT NOT NULL,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL, params TEXT NOT NULL, before TEXT, after TEXT, status TEXT NOT NULL,
  reason TEXT, reversible INTEGER NOT NULL DEFAULT 0, reverts_action_id TEXT, idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (biz_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS action_status ON action (biz_id, status, target_id);

-- Chat
CREATE TABLE IF NOT EXISTS conversation (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, channel TEXT NOT NULL, external_id TEXT NOT NULL, customer_ref TEXT NOT NULL,
  customer_name TEXT NOT NULL, state TEXT NOT NULL, lead_grade TEXT, lead_score REAL, intent TEXT, tags TEXT NOT NULL DEFAULT '[]',
  assigned_to TEXT, unread INTEGER NOT NULL DEFAULT 0, last_message_at TEXT, last_preview TEXT, analysis TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (biz_id, channel, external_id)
);
CREATE INDEX IF NOT EXISTS conv_recent ON conversation (biz_id, last_message_at DESC);
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, conversation_id TEXT NOT NULL, direction TEXT NOT NULL, sender TEXT NOT NULL,
  body TEXT NOT NULL, external_id TEXT, meta TEXT NOT NULL DEFAULT '{}', sent_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS msg_conv ON message (conversation_id, sent_at);
CREATE TABLE IF NOT EXISTS attribution_link (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, conversation_id TEXT NOT NULL, ad_id TEXT, post_id TEXT, source TEXT,
  method TEXT NOT NULL, confidence REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lead (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, conversation_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT,
  grade TEXT NOT NULL, score REAL NOT NULL, reasons TEXT NOT NULL DEFAULT '[]', product_interest TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, conversation_id TEXT, customer_name TEXT NOT NULL, product TEXT NOT NULL,
  total INTEGER NOT NULL, status TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS follow_up_plan (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, conversation_id TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0,
  next_at TEXT, status TEXT NOT NULL, template TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS raw_event (
  id TEXT PRIMARY KEY, platform TEXT NOT NULL, received_at TEXT NOT NULL, signature_ok INTEGER NOT NULL,
  payload TEXT NOT NULL, processed_at TEXT, dedupe_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Learning
CREATE TABLE IF NOT EXISTS lesson (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, agent_key TEXT, statement TEXT NOT NULL, evidence TEXT NOT NULL,
  applies_when TEXT, review_at TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exemplar (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, agent_key TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
  outcome TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_proposal (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, title TEXT NOT NULL, diff TEXT NOT NULL,
  rationale TEXT NOT NULL, lesson_ids TEXT NOT NULL DEFAULT '[]', risk TEXT, status TEXT NOT NULL,
  auto_apply_allowed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_run (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, agent_key TEXT NOT NULL, cases INTEGER NOT NULL, passed INTEGER NOT NULL,
  avg_score REAL NOT NULL, report TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Skill library (imported from ~/.claude/skills and ~/.claude/agents, versioned by content hash)
CREATE TABLE IF NOT EXISTS skill (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT NOT NULL, body TEXT NOT NULL, refs TEXT NOT NULL DEFAULT '[]', source_path TEXT NOT NULL,
  hash TEXT NOT NULL, version INTEGER NOT NULL, size INTEGER NOT NULL, grp TEXT, status TEXT NOT NULL DEFAULT 'active',
  synced_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (biz_id, key)
);
CREATE TABLE IF NOT EXISTS agent_skill (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, agent_key TEXT NOT NULL, skill_key TEXT NOT NULL, role TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (biz_id, agent_key, skill_key)
);

-- Creative: video production jobs (Google Flow via Claude in Chrome) and produced assets
CREATE TABLE IF NOT EXISTS creative_job (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, tool TEXT NOT NULL, title TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL,
  step TEXT, log TEXT NOT NULL DEFAULT '[]', workdir TEXT, result TEXT, error TEXT, asset_id TEXT, content_item_id TEXT,
  source_content_id TEXT, model TEXT, cost_micros INTEGER DEFAULT 0, started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS creative_asset (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, job_id TEXT, kind TEXT NOT NULL, path TEXT NOT NULL, mime TEXT NOT NULL,
  duration REAL, width INTEGER, height INTEGER, size INTEGER, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Automation configs (ads.done-style): metrics pull to Sheets, auto-off, budget, auto-run.
-- auto_off/budget own a rule row (same engine, dry-run first); the others run in automations.tick.
CREATE TABLE IF NOT EXISTS automation (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active', rule_id TEXT, last_run_at TEXT, next_run_at TEXT, last_result TEXT,
  run_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_run (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, automation_id TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS automation_run_recent ON automation_run (automation_id, created_at DESC);

-- Ngân Nguyệt: the CEO's command assistant (chat threads, dispatched work, confirm-before-act cards)
CREATE TABLE IF NOT EXISTS assistant_thread (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, title TEXT NOT NULL, session_id TEXT NOT NULL, model TEXT,
  started INTEGER NOT NULL DEFAULT 0, last_message_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_message (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, thread_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done', log TEXT NOT NULL DEFAULT '[]', model TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_message_thread ON assistant_message (thread_id, created_at);
CREATE TABLE IF NOT EXISTS assistant_dispatch (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, thread_id TEXT, kind TEXT NOT NULL, ref_type TEXT NOT NULL, ref_id TEXT NOT NULL,
  title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_action (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, thread_id TEXT, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
  params TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT, decided_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Bộ não (vault): Markdown files on disk (Obsidian-compatible) + an index for search, graph and agents
CREATE TABLE IF NOT EXISTS brain_vault (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL, managed INTEGER NOT NULL DEFAULT 1,
  scanned_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brain_note (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, vault_id TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, folder TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]', meta TEXT NOT NULL DEFAULT '{}', refs TEXT NOT NULL DEFAULT '[]', words INTEGER NOT NULL DEFAULT 0,
  mtime TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (vault_id, path)
);
CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(vault_id UNINDEXED, path UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');

-- MCP
CREATE TABLE IF NOT EXISTS mcp_key (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_last4 TEXT NOT NULL,
  permissions TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_call (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, key_id TEXT NOT NULL, tool TEXT NOT NULL, params TEXT NOT NULL, result TEXT,
  at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Settings shared by every business (owner profile, …): JSON values.
CREATE TABLE IF NOT EXISTS app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);

-- Kênh Email (chép mô hình auto-funnel, gửi qua Resend). Mọi thư đi qua 1 cổng (orchestrator email/send.ts).
-- Sổ liên hệ email: email thô chỉ nằm ở đây; log / opt-out / loại trừ dùng email_hash (sha256 chữ thường).
CREATE TABLE IF NOT EXISTS email_contact (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, email TEXT NOT NULL, email_hash TEXT NOT NULL, name TEXT,
  status TEXT NOT NULL DEFAULT 'active', consent TEXT NOT NULL DEFAULT 'unknown', source TEXT NOT NULL DEFAULT 'manual',
  conversation_id TEXT, lead_id TEXT, purchased INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]', data TEXT NOT NULL DEFAULT '{}',
  last_sent_at TEXT, last_open_at TEXT, last_click_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (biz_id, email_hash)
);
CREATE INDEX IF NOT EXISTS email_contact_conv ON email_contact (conversation_id);
-- Mỗi lượt gửi + sự kiện của nó (giống tin_nhan bên auto-funnel). status: queued|sent|failed|skipped|delivered|opened|clicked|bounced|complained
CREATE TABLE IF NOT EXISTS email_message (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, contact_id TEXT, to_hash TEXT NOT NULL, to_masked TEXT NOT NULL, subject TEXT NOT NULL,
  html TEXT, source_kind TEXT NOT NULL, source_id TEXT, step INTEGER, status TEXT NOT NULL, reason TEXT, provider_id TEXT,
  transactional INTEGER NOT NULL DEFAULT 0, sent_at TEXT, delivered_at TEXT, opened_at TEXT, clicked_at TEXT, bounced_at TEXT,
  revenue INTEGER NOT NULL DEFAULT 0, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_message_provider ON email_message (provider_id);
CREATE INDEX IF NOT EXISTS email_message_source ON email_message (biz_id, source_kind, source_id);
CREATE INDEX IF NOT EXISTS email_message_contact ON email_message (contact_id, created_at);
CREATE INDEX IF NOT EXISTS email_message_day ON email_message (biz_id, created_at);
-- Loại trừ cứng (bounce cứng / complaint / thêm tay): không bao giờ gửi tới nữa.
CREATE TABLE IF NOT EXISTS email_suppression (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, email_hash TEXT NOT NULL, email_masked TEXT, reason TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (biz_id, email_hash)
);
-- Mẫu email: mode text (văn bản + URL) | blocks (maily.to, JSON Tiptap) | dnd (kéo thả waypoint). system = mẫu hệ thống.
CREATE TABLE IF NOT EXISTS email_template (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, code TEXT, name TEXT NOT NULL, grp TEXT NOT NULL DEFAULT 'khac', subject TEXT NOT NULL,
  preheader TEXT, mode TEXT NOT NULL DEFAULT 'text', body TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}', system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_segment (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, name TEXT NOT NULL, definition TEXT NOT NULL DEFAULT '{}', member_count INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Chiến dịch (broadcast). status: draft|awaiting_approval|scheduled|sending|sent|cancelled. parent_id = bản gửi lại cho người chưa mở.
CREATE TABLE IF NOT EXISTS email_campaign (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, name TEXT NOT NULL, segment_id TEXT, subject TEXT NOT NULL DEFAULT '', subject_b TEXT, ab_pct INTEGER NOT NULL DEFAULT 0,
  preheader TEXT, mode TEXT NOT NULL DEFAULT 'text', body TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT, sent_at TEXT, resend_after_hours INTEGER, resend_subject TEXT, resent_at TEXT, parent_id TEXT, approval_id TEXT,
  summary TEXT NOT NULL DEFAULT '{}', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Chuỗi email tự động. kind = loại mẫu (LOAI_CHUOI) hoặc custom. config = { trigger, goal }. result = điểm chấm 2 tầng.
CREATE TABLE IF NOT EXISTS email_sequence (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'custom', status TEXT NOT NULL DEFAULT 'draft',
  product_key TEXT, config TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}', approval_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_sequence_step (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, sequence_id TEXT NOT NULL, position INTEGER NOT NULL, role TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
  delay_days REAL NOT NULL DEFAULT 1, subject TEXT NOT NULL DEFAULT '', options TEXT NOT NULL DEFAULT '[]', preheader TEXT, mode TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}', no_hard_sell INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
  last_error TEXT, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_step_seq ON email_sequence_step (sequence_id, position);
-- Ghi danh: con trỏ riêng từng người. status: active|done|stopped|goal_met
CREATE TABLE IF NOT EXISTS email_enrollment (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, sequence_id TEXT NOT NULL, contact_id TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0,
  next_at TEXT, status TEXT NOT NULL DEFAULT 'active', stop_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (sequence_id, contact_id)
);
CREATE INDEX IF NOT EXISTS email_enrollment_due ON email_enrollment (status, next_at);

-- Hội đồng Agent Đa Model (Multi-Agent Cross-CLI Dialogue): các Agent chọn các CLI model khác nhau (Claude CLI, Grok CLI, Codex CLI, Gemini CLI) trao đổi, chấm điểm & sửa bài trực tiếp
CREATE TABLE IF NOT EXISTS agent_dialogue (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, title TEXT NOT NULL, scenario TEXT NOT NULL DEFAULT 'content_review',
  topic TEXT NOT NULL DEFAULT '', channel TEXT DEFAULT 'facebook', status TEXT NOT NULL DEFAULT 'idle',
  max_rounds INTEGER NOT NULL DEFAULT 3, current_round INTEGER NOT NULL DEFAULT 0, pass_threshold INTEGER NOT NULL DEFAULT 80,
  config TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}', content_item_id TEXT, approval_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_dialogue_biz ON agent_dialogue (biz_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS agent_dialogue_msg (
  id TEXT PRIMARY KEY, biz_id TEXT NOT NULL, dialogue_id TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL, agent_key TEXT NOT NULL, agent_label TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done', text TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '{}',
  log TEXT NOT NULL DEFAULT '[]', meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_dialogue_msg_thread ON agent_dialogue_msg (dialogue_id, created_at);
`;

