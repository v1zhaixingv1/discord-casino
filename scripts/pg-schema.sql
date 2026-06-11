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
  first_game_win_at BIGINT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);
CREATE INDEX IF NOT EXISTS idx_users_guild_chips_created ON users(guild_id, chips DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS user_onboarding (
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  acknowledged_at BIGINT,
  chips_granted   BIGINT NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_onboarding_guild_ack ON user_onboarding(guild_id, acknowledged_at);

CREATE TABLE IF NOT EXISTS mod_users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mod_users_guild_user ON mod_users(guild_id, user_id);

CREATE TABLE IF NOT EXISTS admin_users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_users_guild_user ON admin_users(guild_id, user_id);

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
  auto_ban_channel_id   TEXT,
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

CREATE TABLE IF NOT EXISTS vote_rewards (
  id               BIGSERIAL PRIMARY KEY,
  discord_user_id  TEXT NOT NULL,
  source           TEXT NOT NULL,
  reward_amount    BIGINT NOT NULL,
  metadata_json    TEXT,
  earned_at        BIGINT NOT NULL,
  external_id      TEXT,
  claimed_at       BIGINT,
  claim_guild_id   TEXT,
  dm_attempted_at  BIGINT,
  dm_sent_at       BIGINT,
  dm_failed_at     BIGINT,
  dm_failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_vote_rewards_user_claimed ON vote_rewards(discord_user_id, claimed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vote_rewards_source_external ON vote_rewards(source, external_id) WHERE external_id IS NOT NULL;

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

-- Cartel passive income system
CREATE TABLE IF NOT EXISTS cartel_pool (
  guild_id TEXT PRIMARY KEY,
  total_shares BIGINT NOT NULL DEFAULT 0,
  base_rate_mg_per_hour BIGINT NOT NULL DEFAULT 180000,
  share_price BIGINT NOT NULL DEFAULT 100,
  share_rate_mg_per_hour BIGINT NOT NULL DEFAULT 100,
  xp_per_gram_sold BIGINT NOT NULL DEFAULT 2,
  carryover_mg BIGINT NOT NULL DEFAULT 0,
  last_tick_at BIGINT,
  event_state TEXT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holdem_table_number_state (
  guild_id TEXT PRIMARY KEY,
  next_table_number BIGINT NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cartel_investors (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  shares BIGINT NOT NULL DEFAULT 0,
  stash_mg BIGINT NOT NULL DEFAULT 0,
  warehouse_mg BIGINT NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL DEFAULT 1,
  rank_xp BIGINT NOT NULL DEFAULT 0,
  auto_sell_rule TEXT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id),
  CHECK (shares >= 0),
  CHECK (stash_mg >= 0),
  CHECK (warehouse_mg >= 0)
);
CREATE INDEX IF NOT EXISTS idx_cartel_investors_guild ON cartel_investors(guild_id);
CREATE INDEX IF NOT EXISTS idx_cartel_investors_guild_shares ON cartel_investors(guild_id, shares DESC);

CREATE TABLE IF NOT EXISTS cartel_transactions (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT,
  type TEXT NOT NULL,
  amount_chips BIGINT NOT NULL DEFAULT 0,
  amount_mg BIGINT NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cartel_market_orders (
  order_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  side TEXT NOT NULL,
  shares BIGINT NOT NULL,
  price_per_share BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at BIGINT NOT NULL DEFAULT (extract(EPOCH FROM now()))::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (extract(EPOCH FROM now()))::BIGINT
);
CREATE TABLE IF NOT EXISTS cartel_order_snapshots (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL DEFAULT (extract(EPOCH FROM now()))::BIGINT,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cartel_market_orders_guild_side ON cartel_market_orders(guild_id, side, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cartel_market_orders_guild_user ON cartel_market_orders(guild_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cartel_tx_guild_time ON cartel_transactions(guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cartel_dealers (
  dealer_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tier INTEGER NOT NULL,
  trait TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  hourly_sell_cap_mg BIGINT NOT NULL,
  price_multiplier_bps INTEGER NOT NULL,
  upkeep_cost BIGINT NOT NULL,
  upkeep_interval_seconds INTEGER NOT NULL DEFAULT 3600,
  upkeep_due_at BIGINT NOT NULL,
  bust_until BIGINT,
  last_sold_at BIGINT,
  lifetime_sold_mg BIGINT NOT NULL DEFAULT 0,
  pending_chips BIGINT NOT NULL DEFAULT 0,
  pending_mg BIGINT NOT NULL DEFAULT 0,
  chip_remainder_units BIGINT NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cartel_dealers_guild ON cartel_dealers(guild_id);
CREATE INDEX IF NOT EXISTS idx_cartel_dealers_user ON cartel_dealers(guild_id, user_id);
ALTER TABLE cartel_dealers
  ADD COLUMN IF NOT EXISTS chip_remainder_units BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_interaction_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  interaction_type TEXT,
  interaction_key TEXT,
  guild_id TEXT,
  channel_id TEXT,
  locale TEXT,
  metadata_json TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_interaction_events_user ON user_interaction_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_interaction_events_created ON user_interaction_events(created_at ASC);
