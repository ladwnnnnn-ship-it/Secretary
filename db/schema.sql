CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  role TEXT NOT NULL DEFAULT 'owner',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app_users(id),
  title TEXT NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  timezone TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done', 'deferred')) DEFAULT 'todo',
  tags TEXT[] NOT NULL DEFAULT '{}',
  repeat_rule TEXT NOT NULL DEFAULT 'none',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'canceled')),
  dedupe_key TEXT UNIQUE,
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_users(id),
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES app_users(id),
  model_name TEXT NOT NULL,
  pipeline_stage TEXT NOT NULL CHECK (pipeline_stage IN ('parse', 'review', 'summarize')),
  prompt_version TEXT NOT NULL,
  input_text TEXT NOT NULL,
  raw_output JSONB,
  structured_output JSONB,
  confidence NUMERIC(4,3),
  is_accepted BOOLEAN,
  error_code TEXT,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app_users(id),
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  summary_markdown TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_user_id, period_type, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner_status ON tasks(owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_schedule_status ON reminders(scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_actor_created ON ai_audit_logs(actor_user_id, created_at DESC);
