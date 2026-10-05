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
-- Chăm khách từ bình luận (comment → trả lời công khai → inbox Private Reply → xin SĐT → kết bạn Zalo → follow-up).
-- 1 dòng = 1 người bình luận dưới 1 bài. SĐT lưu MÃ HOÁ (phone_cipher) + bản che (phone_masked) để hiển thị/nhật ký.
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
`;
