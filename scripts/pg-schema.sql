-- Postgres schema for Discord Casino Bot
-- Multi-tenant by guild_id; amounts stored as BIGINT; timestamps as timestamptz.

CREATE TABLE IF NOT EXISTS mod_roles (
  guild_id TEXT NOT NULL,
  role_id  TEXT NOT NULL,
  PRIMARY KEY (guild_id, role_id)
);

CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  discord_id  TEXT UNIQUE NOT NULL,
  chips       BIGINT NOT NULL DEFAULT 0,
  credits     BIGINT NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);

CREATE TABLE IF NOT EXISTS transactions (
  id         BIGSERIAL PRIMARY KEY,
  account    TEXT NOT NULL,            -- 'HOUSE', 'BURN', 'ESCROW:<id>', 'POT:<id>', or a Discord user id
  delta      BIGINT NOT NULL,
  reason     TEXT,
  admin_id   TEXT,
  currency   TEXT NOT NULL DEFAULT 'CHIPS', -- 'CHIPS' or 'CREDITS'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_txn_account_time ON transactions(account, created_at DESC);

CREATE TABLE IF NOT EXISTS house (
  id         SMALLINT PRIMARY KEY,
  chips      BIGINT NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);
INSERT INTO house (id, chips)
  VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id              TEXT PRIMARY KEY,
  log_channel_id        TEXT,
  cash_log_channel_id   TEXT,
  request_channel_id    TEXT,
  request_cooldown_sec  INTEGER NOT NULL DEFAULT 0,
  logging_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  max_ridebus_bet       INTEGER NOT NULL DEFAULT 1000,
  casino_category_id    TEXT,
  holdem_rake_bps       INTEGER NOT NULL DEFAULT 0,
  holdem_rake_cap       INTEGER NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id      BIGSERIAL PRIMARY KEY,
  token   TEXT UNIQUE NOT NULL,
  guild_id TEXT NOT NULL,
  scopes  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS active_requests (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  message_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  amount     BIGINT NOT NULL,
  status     TEXT NOT NULL,             -- PENDING | TAKEN
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);

-- Track last /request time per guild+user (epoch seconds)
CREATE TABLE IF NOT EXISTS request_last (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  last_ts  BIGINT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- Hold’em: metadata, hands, escrow, commits
CREATE TABLE IF NOT EXISTS holdem_tables (
  table_id   TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  sb         BIGINT NOT NULL,
  bb         BIGINT NOT NULL,
  min        BIGINT NOT NULL,
  max        BIGINT NOT NULL,
  rake_bps   INTEGER NOT NULL DEFAULT 0,
  host_id    TEXT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_holdem_tables_guild_chan ON holdem_tables(guild_id, channel_id);

CREATE TABLE IF NOT EXISTS holdem_hands (
  hand_id     BIGSERIAL PRIMARY KEY,
  table_id    TEXT NOT NULL,
  hand_no     INTEGER NOT NULL,
  board       TEXT,
  winners_json TEXT,
  rake_paid   BIGINT NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_holdem_hands_table_no ON holdem_hands(table_id, hand_no);

CREATE TABLE IF NOT EXISTS holdem_escrow (
  table_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  balance  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (table_id, user_id)
);

CREATE TABLE IF NOT EXISTS holdem_commits (
  id        BIGSERIAL PRIMARY KEY,
  hand_id   BIGINT NOT NULL,
  user_id   TEXT NOT NULL,
  street    TEXT NOT NULL,
  amount    BIGINT NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
