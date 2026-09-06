-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email      VARCHAR(255) NOT NULL UNIQUE,
  name       VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  google_id  VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(512) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- ============================================================
-- SLACK CONNECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS slack_connections (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  access_token TEXT         NOT NULL,
  team_id      VARCHAR(255) NOT NULL,
  team_name    VARCHAR(255),
  webhook_url  TEXT,
  channel      VARCHAR(255),
  bot_user_id  VARCHAR(255),
  scope        TEXT,
  connected_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slack_connections_user_id ON slack_connections(user_id);

-- ============================================================
-- SENDER ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS sender_accounts (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  smtp_host    VARCHAR(255) NOT NULL,
  smtp_port    INTEGER      NOT NULL DEFAULT 587,
  smtp_user    VARCHAR(255) NOT NULL,
  smtp_pass    TEXT         NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_sender_accounts_user_id ON sender_accounts(user_id);

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_account_id UUID        NOT NULL REFERENCES sender_accounts(id),
  subject           TEXT        NOT NULL,
  body              TEXT        NOT NULL,
  total_recipients  INTEGER     NOT NULL DEFAULT 0,
  scheduled_start   TIMESTAMPTZ NOT NULL,
  delay_between_ms  INTEGER     NOT NULL DEFAULT 1000,
  hourly_limit      INTEGER     NOT NULL DEFAULT 50,
  status            VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status  ON campaigns(status);

-- ============================================================
-- EMAIL JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS email_jobs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID         NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_name  VARCHAR(255),
  bullmq_job_id   VARCHAR(512),
  scheduled_at    TIMESTAMPTZ  NOT NULL,
  sent_at         TIMESTAMPTZ,
  status          VARCHAR(50)  NOT NULL DEFAULT 'scheduled',
  error_message   TEXT,
  attempt_count   INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Idempotency: one row per recipient per campaign
  UNIQUE (campaign_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_email_jobs_campaign_id   ON email_jobs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_jobs_status        ON email_jobs(status);
CREATE INDEX IF NOT EXISTS idx_email_jobs_scheduled_at  ON email_jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_email_jobs_bullmq_job_id ON email_jobs(bullmq_job_id);
