import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import 'dotenv/config';

let Pool;
try { ({ Pool } = await import('pg')); } catch {
  throw new Error('Missing dependency: pg. Run `npm install pg`');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: buildSslConfig(),
  max: Math.max(1, Number(process.env.PGPOOL_MAX || 20)),
  idleTimeoutMillis: Math.max(1_000, Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30_000)),
  connectionTimeoutMillis: Math.max(1_000, Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS || 10_000))
});

function buildSslConfig() {
  const mode = (process.env.PGSSLMODE || '').toLowerCase();
  if (!mode || mode === 'disable') return undefined;

  const inlineCert = process.env.DATABASE_CA_CERT;
  if (inlineCert) {
    return { ca: inlineCert.replace(/\\n/g, '\n') };
  }

  const certPath = process.env.DATABASE_CA_CERT_PATH || process.env.PGSSLROOTCERT;
  if (certPath && existsSync(certPath)) {
    return { ca: readFileSync(certPath, 'utf8') };
  }

  if (mode === 'verify-full' || mode === 'verify-ca') {
    throw new Error(`PGSSLMODE=${mode} requires a CA certificate. Set DATABASE_CA_CERT, DATABASE_CA_CERT_PATH, or PGSSLROOTCERT.`);
  }

  return { rejectUnauthorized: false };
}

const DEFAULT_GUILD_ID = process.env.PRIMARY_GUILD_ID || process.env.GUILD_ID || 'global';
const ECONOMY_GUILD_ID = process.env.GLOBAL_ECONOMY_ID || DEFAULT_GUILD_ID;
const MG_PER_GRAM = 1000;
const CARTEL_DEFAULT_BASE_RATE_GRAMS_PER_HOUR = Math.max(1, Number(process.env.CARTEL_BASE_RATE_GRAMS_PER_HOUR || 180));
const CARTEL_DEFAULT_BASE_RATE_MG_PER_HOUR = Math.round(CARTEL_DEFAULT_BASE_RATE_GRAMS_PER_HOUR * MG_PER_GRAM);
const CARTEL_DEFAULT_SHARE_RATE_GRAMS_PER_HOUR = Math.max(0.001, Number(process.env.CARTEL_SHARE_RATE_GRAMS_PER_HOUR || 0.10));
const CARTEL_DEFAULT_SHARE_RATE_MG_PER_HOUR = Math.round(CARTEL_DEFAULT_SHARE_RATE_GRAMS_PER_HOUR * MG_PER_GRAM);
const CARTEL_DEFAULT_XP_PER_GRAM_SOLD = Math.max(0, Number(process.env.CARTEL_XP_PER_GRAM_SOLD || 2));
const CARTEL_DEFAULT_SHARE_PRICE = Math.max(1, Math.floor(Number(process.env.CARTEL_SHARE_PRICE || 100)));

async function q(text, params = []) {
  const { rows } = await pool.query(text, params);
  return rows;
}
async function q1(text, params = []) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function tableHasColumn(table, column) {
  const row = await q1(
    'SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2',
    [table, column]
  );
  return !!row;
}

async function tableExists(table) {
  const row = await q1(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
    [table]
  );
  return !!row;
}

async function getColumnType(table, column) {
  const row = await q1(
    "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
    [table, column]
  );
  return row?.data_type || null;
}

async function ensureTimestampColumn(table, column, defaultExpr = 'NOW()') {
  const type = await getColumnType(table, column);
  if (!type) return;
  const normalized = type.toLowerCase();
  if (normalized.includes('timestamp')) {
    await q(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defaultExpr}`);
    return;
  }
  if (normalized !== 'bigint') return;
  await q(`ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT`);
  await q(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE TIMESTAMPTZ USING TO_TIMESTAMP(${column})`);
  await q(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defaultExpr}`);
}

async function migrateUsersToGuildScoped() {
  if (await tableHasColumn('users', 'guild_id')) return;
  await tx(async c => {
    await c.query('ALTER TABLE users RENAME TO users_legacy');
    await c.query(`
      CREATE TABLE users (
        guild_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        chips BIGINT NOT NULL DEFAULT 0,
        credits BIGINT NOT NULL DEFAULT 0,
        first_game_win_at BIGINT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, discord_id)
      )
    `);
    await c.query(
      'INSERT INTO users (guild_id, discord_id, chips, credits, first_game_win_at, created_at, updated_at) SELECT $1, discord_id, chips, credits, NULL, created_at, updated_at FROM users_legacy',
      [ECONOMY_GUILD_ID]
    );
    await c.query('DROP TABLE users_legacy');
  });
  await q('CREATE INDEX IF NOT EXISTS idx_users_guild_discord ON users (guild_id, discord_id)');
  await q('CREATE INDEX IF NOT EXISTS idx_users_guild_chips_created ON users (guild_id, chips DESC, created_at ASC)');
}

async function migrateTransactionsToGuildScoped() {
  if (await tableHasColumn('transactions', 'guild_id')) return;
  await tx(async c => {
    await c.query('ALTER TABLE transactions RENAME TO transactions_legacy');
    await c.query(`
      CREATE TABLE transactions (
        id SERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        account TEXT NOT NULL,
        delta BIGINT NOT NULL,
        reason TEXT,
        admin_id TEXT,
        currency TEXT NOT NULL DEFAULT 'CHIPS',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await c.query(
      'INSERT INTO transactions (id, guild_id, account, delta, reason, admin_id, currency, created_at) SELECT id, $1, account, delta, reason, admin_id, currency, created_at FROM transactions_legacy',
      [ECONOMY_GUILD_ID]
    );
    await c.query('DROP TABLE transactions_legacy');
    const seqRes = await c.query(`SELECT pg_get_serial_sequence('transactions','id') AS seq`);
    const seqName = seqRes.rows?.[0]?.seq;
    if (seqName) {
      await c.query(`SELECT setval($1::regclass, COALESCE((SELECT MAX(id) FROM transactions), 1))`, [seqName]);
    }
  });
  await q('CREATE INDEX IF NOT EXISTS idx_transactions_guild_created ON transactions (guild_id, created_at)');
}

async function seedGuildHouseFromLegacy() {
  if (!(await tableExists('guild_house'))) {
    await q(`
      CREATE TABLE guild_house (
        guild_id TEXT PRIMARY KEY,
        chips BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }
  const existing = await q1('SELECT 1 FROM guild_house LIMIT 1');
  if (!existing) {
    let legacy = 0;
    if (await tableExists('house')) {
      const row = await q1('SELECT chips FROM house WHERE id = 1');
      if (row && Number.isFinite(Number(row.chips))) legacy = Number(row.chips);
    }
    await q('INSERT INTO guild_house (guild_id, chips) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ECONOMY_GUILD_ID, legacy]);
  }
  await q('INSERT INTO guild_house (guild_id, chips) VALUES ($1, 0) ON CONFLICT DO NOTHING', [ECONOMY_GUILD_ID]);
}

async function ensureAccessControlTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS mod_users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await q('CREATE INDEX IF NOT EXISTS idx_mod_users_guild_user ON mod_users (guild_id, user_id)');
  await q(`
    CREATE TABLE IF NOT EXISTS admin_users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await q('CREATE INDEX IF NOT EXISTS idx_admin_users_guild_user ON admin_users (guild_id, user_id)');
  await q(`
    CREATE TABLE IF NOT EXISTS daily_spin_last (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_ts BIGINT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
}

async function ensureJobTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS job_profiles (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      rank INTEGER NOT NULL DEFAULT 1,
      total_xp BIGINT NOT NULL DEFAULT 0,
      xp_to_next BIGINT NOT NULL DEFAULT 100,
      last_shift_at BIGINT,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()))::BIGINT,
      updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()))::BIGINT,
      PRIMARY KEY (guild_id, user_id, job_id)
    )
  `);
  await q('CREATE INDEX IF NOT EXISTS idx_job_profiles_user ON job_profiles (guild_id, user_id)');
  await q('CREATE INDEX IF NOT EXISTS idx_job_profiles_job ON job_profiles (job_id, guild_id)');

  await q(`
    CREATE TABLE IF NOT EXISTS job_status (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      active_job TEXT NOT NULL DEFAULT 'none',
      job_switch_available_at BIGINT NOT NULL DEFAULT 0,
      cooldown_reason TEXT,
      daily_earning_cap BIGINT,
      earned_today BIGINT NOT NULL DEFAULT 0,
      cap_reset_at BIGINT,
      shift_streak_count BIGINT NOT NULL DEFAULT 0,
      shift_cooldown_expires_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()))::BIGINT,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await q('CREATE INDEX IF NOT EXISTS idx_job_status_guild_switch ON job_status (guild_id, job_switch_available_at)');
  if (!(await tableHasColumn('job_status', 'shift_streak_count'))) {
    await q('ALTER TABLE job_status ADD COLUMN shift_streak_count BIGINT NOT NULL DEFAULT 0');
  }
  if (!(await tableHasColumn('job_status', 'shift_cooldown_expires_at'))) {
    await q('ALTER TABLE job_status ADD COLUMN shift_cooldown_expires_at BIGINT NOT NULL DEFAULT 0');
  }

  await q(`
    CREATE TABLE IF NOT EXISTS job_shifts (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      started_at BIGINT NOT NULL,
      completed_at BIGINT,
      performance_score INTEGER NOT NULL DEFAULT 0,
      base_pay BIGINT NOT NULL DEFAULT 0,
      tip_percent INTEGER NOT NULL DEFAULT 0,
      tip_amount BIGINT NOT NULL DEFAULT 0,
      total_payout BIGINT NOT NULL DEFAULT 0,
      result_state TEXT NOT NULL DEFAULT 'PENDING',
      metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB
    )
  `);
  await q('CREATE INDEX IF NOT EXISTS idx_job_shifts_user_started ON job_shifts (guild_id, user_id, started_at)');
}

async function ensureOnboardingTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS user_onboarding (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      acknowledged_at BIGINT,
      chips_granted BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await q('CREATE INDEX IF NOT EXISTS idx_user_onboarding_ack ON user_onboarding (guild_id, acknowledged_at)');
}

async function ensureInteractionTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS user_interaction_stats (
      user_id TEXT PRIMARY KEY,
      total_interactions BIGINT NOT NULL DEFAULT 0,
      first_interaction_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_interaction_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_guild_id TEXT,
      last_channel_id TEXT,
      last_type TEXT,
      last_key TEXT,
      last_locale TEXT,
      last_metadata_json TEXT,
      review_prompt_attempted_at TIMESTAMP,
      review_prompt_sent_at TIMESTAMP,
      review_prompt_status TEXT,
      review_prompt_last_error TEXT
    )
  `);
  await q(`
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
    )
  `);
  await q('CREATE INDEX IF NOT EXISTS idx_user_interaction_events_user ON user_interaction_events (user_id, created_at DESC)');
  await q('CREATE INDEX IF NOT EXISTS idx_user_interaction_events_created ON user_interaction_events (created_at ASC)');
}

async function ensureUserActivityLifecycleTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS user_activity_lifecycle (
      discord_user_id TEXT PRIMARY KEY,
      last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_inactive BOOLEAN NOT NULL DEFAULT FALSE,
      inactive_since TIMESTAMPTZ,
      inactive_dm_sent_at TIMESTAMPTZ,
      inactive_dm_fail_count INTEGER NOT NULL DEFAULT 0,
      reactivated_at TIMESTAMPTZ,
      comeback_bonus_granted_at TIMESTAMPTZ,
      comeback_bonus_amount BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS user_activity_lifecycle_events (
      id BIGSERIAL PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await q('CREATE INDEX IF NOT EXISTS idx_user_activity_last_interaction ON user_activity_lifecycle (last_interaction_at)');
  await q('CREATE INDEX IF NOT EXISTS idx_user_activity_inactive ON user_activity_lifecycle (is_inactive, inactive_since)');
  await q('CREATE INDEX IF NOT EXISTS idx_user_activity_events_user_time ON user_activity_lifecycle_events (discord_user_id, created_at DESC)');
}

async function ensureNewsSettingsTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS user_news_settings (
      user_id TEXT PRIMARY KEY,
      news_opt_in BOOLEAN NOT NULL DEFAULT true,
      last_delivered_at BIGINT,
      last_digest TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureCartelTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS cartel_pool (
      guild_id TEXT PRIMARY KEY,
      total_shares BIGINT NOT NULL DEFAULT 0,
      base_rate_mg_per_hour BIGINT NOT NULL DEFAULT 180000,
      share_price BIGINT NOT NULL DEFAULT ${CARTEL_DEFAULT_SHARE_PRICE},
      share_rate_mg_per_hour BIGINT NOT NULL DEFAULT ${CARTEL_DEFAULT_SHARE_RATE_MG_PER_HOUR},
      xp_per_gram_sold BIGINT NOT NULL DEFAULT ${CARTEL_DEFAULT_XP_PER_GRAM_SOLD},
      carryover_mg BIGINT NOT NULL DEFAULT 0,
      last_tick_at BIGINT,
      event_state TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS cartel_investors (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      shares BIGINT NOT NULL DEFAULT 0,
      stash_mg BIGINT NOT NULL DEFAULT 0,
      warehouse_mg BIGINT NOT NULL DEFAULT 0,
      rank INTEGER NOT NULL DEFAULT 1,
      rank_xp BIGINT NOT NULL DEFAULT 0,
      auto_sell_rule TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id),
      CHECK (shares >= 0),
      CHECK (stash_mg >= 0),
      CHECK (warehouse_mg >= 0)
    )
  `);
  await q('CREATE INDEX IF NOT EXISTS idx_cartel_investors_guild ON cartel_investors (guild_id)');
  await q('CREATE INDEX IF NOT EXISTS idx_cartel_investors_guild_shares ON cartel_investors (guild_id, shares DESC)');
  await q(`
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
      paused_upkeep_remaining_seconds INTEGER NOT NULL DEFAULT 0,
      bust_until BIGINT,
      last_sold_at BIGINT,
      lifetime_sold_mg BIGINT NOT NULL DEFAULT 0,
      pending_chips BIGINT NOT NULL DEFAULT 0,
      pending_mg BIGINT NOT NULL DEFAULT 0,
      chip_remainder_units BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS cartel_transactions (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT,
      type TEXT NOT NULL,
      amount_chips BIGINT NOT NULL DEFAULT 0,
      amount_mg BIGINT NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await q(`
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
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS cartel_order_snapshots (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      updated_at BIGINT NOT NULL DEFAULT (extract(EPOCH FROM now()))::BIGINT,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await q('CREATE INDEX IF NOT EXISTS idx_cartel_investors_guild ON cartel_investors (guild_id)');
  await q('CREATE INDEX IF NOT EXISTS idx_cartel_tx_guild_time ON cartel_transactions (guild_id, created_at DESC)');
  await q('CREATE INDEX IF NOT EXISTS idx_cartel_market_orders_guild_side ON cartel_market_orders (guild_id, side, created_at DESC)');
  await q('CREATE INDEX IF NOT EXISTS idx_cartel_market_orders_guild_user ON cartel_market_orders (guild_id, user_id, created_at DESC)');
  await q('CREATE INDEX IF NOT EXISTS idx_cartel_dealers_guild ON cartel_dealers (guild_id)');
  await q('CREATE INDEX IF NOT EXISTS idx_cartel_dealers_user ON cartel_dealers (guild_id, user_id)');

  await ensureTimestampColumn('cartel_pool', 'created_at');
  await ensureTimestampColumn('cartel_pool', 'updated_at');
  await ensureTimestampColumn('cartel_investors', 'created_at');
  await ensureTimestampColumn('cartel_investors', 'updated_at');
  await ensureTimestampColumn('cartel_dealers', 'created_at');
  await ensureTimestampColumn('cartel_dealers', 'updated_at');
  if (!(await tableHasColumn('cartel_dealers', 'display_name'))) {
    await q('ALTER TABLE cartel_dealers ADD COLUMN display_name TEXT');
  }
  if (!(await tableHasColumn('cartel_pool', 'share_price'))) {
    await q(`ALTER TABLE cartel_pool ADD COLUMN share_price BIGINT NOT NULL DEFAULT ${CARTEL_DEFAULT_SHARE_PRICE}`);
  }
  if (!(await tableHasColumn('cartel_pool', 'share_rate_mg_per_hour'))) {
    await q(`ALTER TABLE cartel_pool ADD COLUMN share_rate_mg_per_hour BIGINT NOT NULL DEFAULT ${CARTEL_DEFAULT_SHARE_RATE_MG_PER_HOUR}`);
  }
  if (!(await tableHasColumn('cartel_pool', 'xp_per_gram_sold'))) {
    await q(`ALTER TABLE cartel_pool ADD COLUMN xp_per_gram_sold BIGINT NOT NULL DEFAULT ${CARTEL_DEFAULT_XP_PER_GRAM_SOLD}`);
  }
  if (!(await tableHasColumn('cartel_dealers', 'pending_chips'))) {
    await q('ALTER TABLE cartel_dealers ADD COLUMN pending_chips BIGINT NOT NULL DEFAULT 0');
  }
  if (!(await tableHasColumn('cartel_dealers', 'pending_mg'))) {
    await q('ALTER TABLE cartel_dealers ADD COLUMN pending_mg BIGINT NOT NULL DEFAULT 0');
  }
  if (!(await tableHasColumn('cartel_dealers', 'chip_remainder_units'))) {
    await q('ALTER TABLE cartel_dealers ADD COLUMN chip_remainder_units BIGINT NOT NULL DEFAULT 0');
  }
  if (!(await tableHasColumn('cartel_dealers', 'paused_upkeep_remaining_seconds'))) {
    await q('ALTER TABLE cartel_dealers ADD COLUMN paused_upkeep_remaining_seconds INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await tableHasColumn('cartel_investors', 'sale_multiplier_bps'))) {
    await q('ALTER TABLE cartel_investors ADD COLUMN sale_multiplier_bps BIGINT NOT NULL DEFAULT 0');
  }
}

async function ensureBotStatusTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS bot_status_snapshots (
      id TEXT PRIMARY KEY,
      guild_count INTEGER NOT NULL DEFAULT 0,
      player_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureHoldemTableNumberState() {
  await q(`
    CREATE TABLE IF NOT EXISTS holdem_table_number_state (
      guild_id TEXT PRIMARY KEY,
      next_table_number BIGINT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function mergeEconomyToGlobalScope() {
  const gid = ECONOMY_GUILD_ID;

  const needsUserMerge = await q1('SELECT 1 FROM users WHERE guild_id <> $1 LIMIT 1', [gid]);
  if (needsUserMerge) {
    const aggregates = await q(`
      SELECT discord_id,
             COALESCE(SUM(chips), 0) AS chips,
             COALESCE(SUM(credits), 0) AS credits,
             MIN(created_at) AS created_at,
             MAX(updated_at) AS updated_at
      FROM users
      GROUP BY discord_id
    `);
    await tx(async c => {
      await c.query('DELETE FROM users');
      for (const row of aggregates) {
        const chips = Number(row?.chips || 0);
        const credits = Number(row?.credits || 0);
        const createdAt = row?.created_at || new Date();
        const updatedAt = row?.updated_at || createdAt;
        await c.query(
          'INSERT INTO users (guild_id, discord_id, chips, credits, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)',
          [gid, row.discord_id, chips, credits, createdAt, updatedAt]
        );
      }
    });
  } else {
    await q('UPDATE users SET guild_id = $1 WHERE guild_id <> $1', [gid]);
  }

  await q('UPDATE transactions SET guild_id = $1 WHERE guild_id <> $1', [gid]);

  const needsHouseMerge = await q1('SELECT 1 FROM guild_house WHERE guild_id <> $1 LIMIT 1', [gid]);
  if (needsHouseMerge) {
    const totalRow = await q1('SELECT COALESCE(SUM(chips), 0) AS total FROM guild_house');
    const total = Number(totalRow?.total || 0);
    await tx(async c => {
      await c.query('DELETE FROM guild_house');
      await c.query(
        'INSERT INTO guild_house (guild_id, chips) VALUES ($1,$2) ON CONFLICT (guild_id) DO UPDATE SET chips = EXCLUDED.chips, updated_at = NOW()',
        [gid, total]
      );
    });
  } else {
    await q('INSERT INTO guild_house (guild_id, chips) VALUES ($1, 0) ON CONFLICT (guild_id) DO NOTHING', [gid]);
  }
}

await migrateUsersToGuildScoped();
await migrateTransactionsToGuildScoped();
await seedGuildHouseFromLegacy();
await mergeEconomyToGlobalScope();
await ensureAccessControlTables();
await ensureJobTables();
await ensureCartelTables();
await ensureOnboardingTable();
await ensureInteractionTables();
await ensureUserActivityLifecycleTables();
await ensureBotStatusTable();
await ensureNewsSettingsTable();
await ensureHoldemTableNumberState();

try {
  if (await tableExists('guild_settings') && !(await tableHasColumn('guild_settings', 'kitten_mode_enabled'))) {
    await q('ALTER TABLE guild_settings ADD COLUMN kitten_mode_enabled BOOLEAN NOT NULL DEFAULT false');
  }
} catch (err) {
  console.error('Failed to ensure kitten_mode_enabled column on guild_settings:', err);
}

try {
  if (await tableExists('guild_settings') && !(await tableHasColumn('guild_settings', 'update_channel_id'))) {
    await q('ALTER TABLE guild_settings ADD COLUMN update_channel_id TEXT');
  }
} catch (err) {
  console.error('Failed to ensure update_channel_id column on guild_settings:', err);
}

try {
  if (await tableExists('guild_settings') && !(await tableHasColumn('guild_settings', 'auto_ban_channel_id'))) {
    await q('ALTER TABLE guild_settings ADD COLUMN auto_ban_channel_id TEXT');
  }
} catch (err) {
  console.error('Failed to ensure auto_ban_channel_id column on guild_settings:', err);
}

try {
  if (await tableExists('vote_rewards') && !(await tableHasColumn('vote_rewards', 'external_id'))) {
    await q('ALTER TABLE vote_rewards ADD COLUMN external_id TEXT');
  }
} catch (err) {
  console.error('Failed to ensure external_id column on vote_rewards:', err);
}

try {
  if (await tableExists('vote_rewards') && !(await tableHasColumn('vote_rewards', 'dm_attempted_at'))) {
    await q('ALTER TABLE vote_rewards ADD COLUMN dm_attempted_at BIGINT');
  }
} catch (err) {
  console.error('Failed to ensure dm_attempted_at column on vote_rewards:', err);
}

try {
  if (await tableExists('vote_rewards') && !(await tableHasColumn('vote_rewards', 'dm_sent_at'))) {
    await q('ALTER TABLE vote_rewards ADD COLUMN dm_sent_at BIGINT');
  }
} catch (err) {
  console.error('Failed to ensure dm_sent_at column on vote_rewards:', err);
}

try {
  if (await tableExists('vote_rewards') && !(await tableHasColumn('vote_rewards', 'dm_failed_at'))) {
    await q('ALTER TABLE vote_rewards ADD COLUMN dm_failed_at BIGINT');
  }
} catch (err) {
  console.error('Failed to ensure dm_failed_at column on vote_rewards:', err);
}

try {
  if (await tableExists('vote_rewards') && !(await tableHasColumn('vote_rewards', 'dm_failure_reason'))) {
    await q('ALTER TABLE vote_rewards ADD COLUMN dm_failure_reason TEXT');
  }
} catch (err) {
  console.error('Failed to ensure dm_failure_reason column on vote_rewards:', err);
}

try {
  if (await tableExists('vote_rewards')) {
    await q('CREATE UNIQUE INDEX IF NOT EXISTS idx_vote_rewards_source_external ON vote_rewards(source, external_id) WHERE external_id IS NOT NULL');
  }
} catch (err) {
  console.error('Failed to ensure unique index on vote_rewards source/external_id:', err);
}

try {
  if (await tableExists('users') && !(await tableHasColumn('users', 'first_game_win_at'))) {
    await q('ALTER TABLE users ADD COLUMN first_game_win_at BIGINT');
  }
} catch (err) {
  console.error('Failed to ensure first_game_win_at column on users:', err);
}

function resolveGuildId() {
  return ECONOMY_GUILD_ID;
}

async function ensureGuildUser(guildId, discordId) {
  await q('INSERT INTO users (guild_id, discord_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, discordId]);
}

async function ensureGuildHouse(guildId) {
  await q('INSERT INTO guild_house (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);
}

async function houseRow(guildId) {
  const row = await q1('SELECT chips FROM guild_house WHERE guild_id = $1', [guildId]);
  return { chips: Number(row?.chips || 0) };
}

function safeParseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapVoteRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    source: row.source,
    reward_amount: Number(row.reward_amount || 0),
    earned_at: Number(row.earned_at || 0),
    claimed_at: row.claimed_at == null ? null : Number(row.claimed_at),
    claim_guild_id: row.claim_guild_id || null,
    dm_attempted_at: row.dm_attempted_at == null ? null : Number(row.dm_attempted_at),
    dm_sent_at: row.dm_sent_at == null ? null : Number(row.dm_sent_at),
    dm_failed_at: row.dm_failed_at == null ? null : Number(row.dm_failed_at),
    dm_failure_reason: row.dm_failure_reason || null,
    metadata: safeParseJson(row.metadata_json)
  };
}

const INSERT_INTERACTION_EVENT_SQL = `
  INSERT INTO user_interaction_events (
    user_id,
    interaction_type,
    interaction_key,
    guild_id,
    channel_id,
    locale,
    metadata_json,
    created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
`;

const UPSERT_INTERACTION_STAT_SQL = `
  INSERT INTO user_interaction_stats (
    user_id,
    total_interactions,
    first_interaction_at,
    last_interaction_at,
    last_guild_id,
    last_channel_id,
    last_type,
    last_key,
    last_locale,
    last_metadata_json
  ) VALUES ($1, 1, NOW(), NOW(), $2, $3, $4, $5, $6, $7)
  ON CONFLICT (user_id) DO UPDATE SET
    total_interactions = user_interaction_stats.total_interactions + 1,
    last_interaction_at = NOW(),
    last_guild_id = COALESCE(EXCLUDED.last_guild_id, user_interaction_stats.last_guild_id),
    last_channel_id = COALESCE(EXCLUDED.last_channel_id, user_interaction_stats.last_channel_id),
    last_type = EXCLUDED.last_type,
    last_key = EXCLUDED.last_key,
    last_locale = COALESCE(EXCLUDED.last_locale, user_interaction_stats.last_locale),
    last_metadata_json = EXCLUDED.last_metadata_json
  RETURNING
    user_id,
    total_interactions,
    EXTRACT(EPOCH FROM first_interaction_at) AS first_interaction_at,
    EXTRACT(EPOCH FROM last_interaction_at) AS last_interaction_at,
    last_guild_id,
    last_channel_id,
    last_type,
    last_key,
    last_locale,
    last_metadata_json,
    EXTRACT(EPOCH FROM review_prompt_attempted_at) AS review_prompt_attempted_at,
    EXTRACT(EPOCH FROM review_prompt_sent_at) AS review_prompt_sent_at,
    review_prompt_status,
    review_prompt_last_error
`;

const SELECT_INTERACTION_STAT_SQL = `
  SELECT
    user_id,
    total_interactions,
    EXTRACT(EPOCH FROM first_interaction_at) AS first_interaction_at,
    EXTRACT(EPOCH FROM last_interaction_at) AS last_interaction_at,
    last_guild_id,
    last_channel_id,
    last_type,
    last_key,
    last_locale,
    last_metadata_json,
    EXTRACT(EPOCH FROM review_prompt_attempted_at) AS review_prompt_attempted_at,
    EXTRACT(EPOCH FROM review_prompt_sent_at) AS review_prompt_sent_at,
    review_prompt_status,
    review_prompt_last_error
  FROM user_interaction_stats
  WHERE user_id = $1
`;

const MARK_REVIEW_PROMPT_SQL = `
  UPDATE user_interaction_stats
  SET review_prompt_attempted_at = TO_TIMESTAMP($2),
      review_prompt_status = $3,
      review_prompt_sent_at = CASE WHEN $3 = 'sent' THEN TO_TIMESTAMP($2) ELSE review_prompt_sent_at END,
      review_prompt_last_error = $4
  WHERE user_id = $1
  RETURNING
    user_id,
    total_interactions,
    EXTRACT(EPOCH FROM first_interaction_at) AS first_interaction_at,
    EXTRACT(EPOCH FROM last_interaction_at) AS last_interaction_at,
    last_guild_id,
    last_channel_id,
    last_type,
    last_key,
    last_locale,
    last_metadata_json,
    EXTRACT(EPOCH FROM review_prompt_attempted_at) AS review_prompt_attempted_at,
    EXTRACT(EPOCH FROM review_prompt_sent_at) AS review_prompt_sent_at,
    review_prompt_status,
    review_prompt_last_error
`;

function normalizeInteractionStats(row) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    total_interactions: Number(row.total_interactions || 0),
    first_interaction_at: row.first_interaction_at != null ? Number(row.first_interaction_at) : null,
    last_interaction_at: row.last_interaction_at != null ? Number(row.last_interaction_at) : null,
    last_guild_id: row.last_guild_id || null,
    last_channel_id: row.last_channel_id || null,
    last_type: row.last_type || null,
    last_key: row.last_key || null,
    last_locale: row.last_locale || null,
    last_metadata_json: row.last_metadata_json || null,
    review_prompt_attempted_at: row.review_prompt_attempted_at != null ? Number(row.review_prompt_attempted_at) : null,
    review_prompt_sent_at: row.review_prompt_sent_at != null ? Number(row.review_prompt_sent_at) : null,
    review_prompt_status: row.review_prompt_status || null,
    review_prompt_last_error: row.review_prompt_last_error || null
  };
}

export async function recordUserInteraction(details = {}) {
  if (!details || !details.userId) return null;
  const userId = String(details.userId);
  const guildId = details.guildId ? String(details.guildId) : null;
  const channelId = details.channelId ? String(details.channelId) : null;
  const interactionType = details.interactionType || null;
  const interactionKey = details.interactionKey || null;
  const locale = details.locale || null;
  const metadataRaw = details.metadata;
  const metadata = metadataRaw == null ? null : (typeof metadataRaw === 'string' ? metadataRaw : JSON.stringify(metadataRaw));

  const row = await tx(async c => {
    await c.query(INSERT_INTERACTION_EVENT_SQL, [userId, interactionType, interactionKey, guildId, channelId, locale, metadata]);
    const { rows } = await c.query(UPSERT_INTERACTION_STAT_SQL, [userId, guildId, channelId, interactionType, interactionKey, locale, metadata]);
    return rows[0] || null;
  });

  return normalizeInteractionStats(row);
}

export async function pruneUserInteractionEvents(retentionDays = 90, batchSize = 10_000) {
  const days = Math.max(1, Math.trunc(Number(retentionDays) || 90));
  const n = Math.max(100, Math.min(100_000, Math.trunc(Number(batchSize) || 10_000)));
  const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  const result = await pool.query(
    `WITH doomed AS (
       SELECT ctid
       FROM user_interaction_events
       WHERE created_at < $1
       ORDER BY created_at ASC
       LIMIT $2
     )
     DELETE FROM user_interaction_events e
     USING doomed
     WHERE e.ctid = doomed.ctid
     RETURNING 1`,
    [cutoff, n]
  );
  return Number(result?.rowCount || 0);
}

export async function getUserInteractionStats(userId) {
  if (!userId) return null;
  const row = await q1(SELECT_INTERACTION_STAT_SQL, [String(userId)]);
  return normalizeInteractionStats(row);
}

export async function markUserInteractionReviewPrompt(userId, { status = 'sent', error = null, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  if (!userId) return null;
  const ts = Number.isFinite(timestamp) ? Math.floor(timestamp) : Math.floor(Date.now() / 1000);
  const row = await q1(MARK_REVIEW_PROMPT_SQL, [String(userId), ts, status || null, error || null]);
  return normalizeInteractionStats(row);
}

function normalizeUserActivityLifecycle(row) {
  if (!row) return null;
  return {
    discord_user_id: row.discord_user_id,
    last_interaction_at: toEpochSeconds(row.last_interaction_at),
    is_inactive: !!row.is_inactive,
    inactive_since: toEpochSeconds(row.inactive_since),
    inactive_dm_sent_at: toEpochSeconds(row.inactive_dm_sent_at),
    inactive_dm_fail_count: Math.max(0, Number(row.inactive_dm_fail_count || 0)),
    reactivated_at: toEpochSeconds(row.reactivated_at),
    comeback_bonus_granted_at: toEpochSeconds(row.comeback_bonus_granted_at),
    comeback_bonus_amount: Math.max(0, Number(row.comeback_bonus_amount || 0)),
    created_at: toEpochSeconds(row.created_at),
    updated_at: toEpochSeconds(row.updated_at)
  };
}

export async function recordUserActivityLifecycleEvent(discordUserId, eventType, metadata = null) {
  const uid = String(discordUserId || '').trim();
  const type = String(eventType || '').trim();
  if (!uid || !type) return;
  const payload = metadata == null
    ? null
    : (typeof metadata === 'string' ? metadata : JSON.stringify(metadata));
  await q(
    `INSERT INTO user_activity_lifecycle_events (discord_user_id, event_type, metadata_json)
     VALUES ($1, $2, $3)`,
    [uid, type, payload]
  );
}

export async function touchUserActivityLifecycle(discordUserId, interactionAt = Math.floor(Date.now() / 1000)) {
  const uid = String(discordUserId || '').trim();
  if (!uid) return null;
  const at = Number.isFinite(Number(interactionAt)) ? Math.floor(Number(interactionAt)) : Math.floor(Date.now() / 1000);
  const row = await q1(
    `INSERT INTO user_activity_lifecycle (discord_user_id, last_interaction_at, updated_at)
     VALUES ($1, TO_TIMESTAMP($2), NOW())
     ON CONFLICT (discord_user_id) DO UPDATE SET
       last_interaction_at = TO_TIMESTAMP($2),
       updated_at = NOW()
     RETURNING
       discord_user_id,
       last_interaction_at,
       is_inactive,
       inactive_since,
       inactive_dm_sent_at,
       inactive_dm_fail_count,
       reactivated_at,
       comeback_bonus_granted_at,
       comeback_bonus_amount,
       created_at,
       updated_at`,
    [uid, at]
  );
  return normalizeUserActivityLifecycle(row);
}

export async function listUsersToMarkInactive(thresholdDays = 30, limit = 500) {
  const days = Math.max(1, Math.trunc(Number(thresholdDays) || 30));
  const n = Math.max(1, Math.min(10_000, Math.trunc(Number(limit) || 500)));
  const rows = await q(
    `SELECT discord_user_id, last_interaction_at
     FROM user_activity_lifecycle
     WHERE is_inactive = FALSE
       AND last_interaction_at < NOW() - ($1 * INTERVAL '1 day')
     ORDER BY last_interaction_at ASC
     LIMIT $2`,
    [days, n]
  );
  return rows.map(row => ({
    discord_user_id: row.discord_user_id,
    last_interaction_at: toEpochSeconds(row.last_interaction_at)
  }));
}

export async function markUsersInactive(discordUserIds = [], inactiveSince = Math.floor(Date.now() / 1000)) {
  const ids = Array.isArray(discordUserIds)
    ? Array.from(new Set(discordUserIds.map(id => String(id || '').trim()).filter(Boolean)))
    : [];
  if (!ids.length) return [];
  const since = Number.isFinite(Number(inactiveSince)) ? Math.floor(Number(inactiveSince)) : Math.floor(Date.now() / 1000);
  const rows = await q(
    `UPDATE user_activity_lifecycle
     SET is_inactive = TRUE,
         inactive_since = TO_TIMESTAMP($1),
         updated_at = NOW()
     WHERE discord_user_id = ANY($2::TEXT[])
       AND is_inactive = FALSE
     RETURNING
       discord_user_id,
       last_interaction_at,
       is_inactive,
       inactive_since,
       inactive_dm_sent_at,
       inactive_dm_fail_count,
       reactivated_at,
       comeback_bonus_granted_at,
       comeback_bonus_amount,
       created_at,
       updated_at`,
    [since, ids]
  );
  return rows.map(normalizeUserActivityLifecycle).filter(Boolean);
}

export async function getUserActivityLifecycle(discordUserId) {
  const uid = String(discordUserId || '').trim();
  if (!uid) return null;
  const row = await q1(
    `SELECT
       discord_user_id,
       last_interaction_at,
       is_inactive,
       inactive_since,
       inactive_dm_sent_at,
       inactive_dm_fail_count,
       reactivated_at,
       comeback_bonus_granted_at,
       comeback_bonus_amount,
       created_at,
       updated_at
     FROM user_activity_lifecycle
     WHERE discord_user_id = $1`,
    [uid]
  );
  return normalizeUserActivityLifecycle(row);
}

export async function markUserInactiveDmResult(discordUserId, { sent = false, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const uid = String(discordUserId || '').trim();
  if (!uid) return null;
  const ts = Number.isFinite(Number(timestamp)) ? Math.floor(Number(timestamp)) : Math.floor(Date.now() / 1000);
  const row = sent
    ? await q1(
      `UPDATE user_activity_lifecycle
       SET inactive_dm_sent_at = TO_TIMESTAMP($2),
           updated_at = NOW()
       WHERE discord_user_id = $1
       RETURNING
         discord_user_id,
         last_interaction_at,
         is_inactive,
         inactive_since,
         inactive_dm_sent_at,
         inactive_dm_fail_count,
         reactivated_at,
         comeback_bonus_granted_at,
         comeback_bonus_amount,
         created_at,
         updated_at`,
      [uid, ts]
    )
    : await q1(
      `UPDATE user_activity_lifecycle
       SET inactive_dm_fail_count = inactive_dm_fail_count + 1,
           updated_at = NOW()
       WHERE discord_user_id = $1
       RETURNING
         discord_user_id,
         last_interaction_at,
         is_inactive,
         inactive_since,
         inactive_dm_sent_at,
         inactive_dm_fail_count,
         reactivated_at,
         comeback_bonus_granted_at,
         comeback_bonus_amount,
         created_at,
         updated_at`,
      [uid]
    );
  return normalizeUserActivityLifecycle(row);
}

export async function reactivateUserWithComebackBonus(
  guildId,
  discordUserId,
  {
    bonusAmount = 0,
    reason = 'comeback bonus',
    adminId = 'comeback:auto',
    timestamp = Math.floor(Date.now() / 1000),
    triggerCommand = null
  } = {}
) {
  const gid = resolveGuildId(guildId);
  const uid = String(discordUserId || '').trim();
  if (!uid) throw new Error('LIFECYCLE_USER_REQUIRED');
  const ts = Number.isFinite(Number(timestamp)) ? Math.floor(Number(timestamp)) : Math.floor(Date.now() / 1000);
  const grant = Math.max(0, Math.floor(Number(bonusAmount || 0)));

  return tx(async c => {
    await c.query(
      `INSERT INTO user_activity_lifecycle (discord_user_id, last_interaction_at, updated_at)
       VALUES ($1, TO_TIMESTAMP($2), NOW())
       ON CONFLICT (discord_user_id) DO NOTHING`,
      [uid, ts]
    );

    const currentRes = await c.query(
      `SELECT
         discord_user_id,
         last_interaction_at,
         is_inactive,
         inactive_since,
         inactive_dm_sent_at,
         inactive_dm_fail_count,
         reactivated_at,
         comeback_bonus_granted_at,
         comeback_bonus_amount,
         created_at,
         updated_at
       FROM user_activity_lifecycle
       WHERE discord_user_id = $1
       FOR UPDATE`,
      [uid]
    );
    const current = currentRes.rows?.[0] || null;
    if (!current) {
      return {
        reactivated: false,
        bonusGranted: false,
        bonusAmount: 0,
        lifecycle: null
      };
    }

    const isInactive = !!current.is_inactive;
    if (!isInactive) {
      return {
        reactivated: false,
        bonusGranted: false,
        bonusAmount: 0,
        lifecycle: normalizeUserActivityLifecycle(current)
      };
    }

    const inactiveSinceEpoch = toEpochSeconds(current.inactive_since);
    const bonusGrantedAtEpoch = toEpochSeconds(current.comeback_bonus_granted_at);
    const eligibleByCycle = inactiveSinceEpoch != null && (bonusGrantedAtEpoch == null || bonusGrantedAtEpoch < inactiveSinceEpoch);
    const shouldGrantBonus = grant > 0 && eligibleByCycle;

    if (shouldGrantBonus) {
      await c.query('INSERT INTO users (guild_id, discord_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, uid]);
      await c.query('UPDATE users SET chips = chips + $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [grant, gid, uid]);
      await c.query(
        'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
        [gid, uid, grant, reason || 'comeback bonus', adminId || null, 'CHIPS']
      );
    }

    const updatedRes = await c.query(
      `UPDATE user_activity_lifecycle
       SET is_inactive = FALSE,
           last_interaction_at = TO_TIMESTAMP($2),
           reactivated_at = TO_TIMESTAMP($2),
           comeback_bonus_granted_at = CASE WHEN $3::BOOLEAN THEN TO_TIMESTAMP($2) ELSE comeback_bonus_granted_at END,
           comeback_bonus_amount = CASE WHEN $3::BOOLEAN THEN $4 ELSE comeback_bonus_amount END,
           updated_at = NOW()
       WHERE discord_user_id = $1
       RETURNING
         discord_user_id,
         last_interaction_at,
         is_inactive,
         inactive_since,
         inactive_dm_sent_at,
         inactive_dm_fail_count,
         reactivated_at,
         comeback_bonus_granted_at,
         comeback_bonus_amount,
         created_at,
         updated_at`,
      [uid, ts, shouldGrantBonus, grant]
    );

    const lifecycle = normalizeUserActivityLifecycle(updatedRes.rows?.[0] || null);

    await c.query(
      `INSERT INTO user_activity_lifecycle_events (discord_user_id, event_type, metadata_json)
       VALUES ($1, 'REACTIVATED', $2)`,
      [uid, JSON.stringify({ triggerCommand: triggerCommand || null, timestamp: ts })]
    );
    if (shouldGrantBonus) {
      await c.query(
        `INSERT INTO user_activity_lifecycle_events (discord_user_id, event_type, metadata_json)
         VALUES ($1, 'COMEBACK_BONUS_GRANTED', $2)`,
        [uid, JSON.stringify({ amount: grant, reason: reason || 'comeback bonus', triggerCommand: triggerCommand || null, timestamp: ts })]
      );
    }

    return {
      reactivated: true,
      bonusGranted: shouldGrantBonus,
      bonusAmount: shouldGrantBonus ? grant : 0,
      lifecycle
    };
  });
}

async function recordTxn(guildId, account, delta, reason, adminId, currency = 'CHIPS') {
  await q(
    'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
    [guildId, account, delta, reason || null, adminId || null, currency]
  );
}

// --- Roles ---
function canonicalGuildId(guildId) {
  return guildId ? String(guildId) : DEFAULT_GUILD_ID;
}

async function ensureCartelPoolRow(guildId) {
  await q(
    'INSERT INTO cartel_pool (guild_id, base_rate_mg_per_hour, share_price, share_rate_mg_per_hour, xp_per_gram_sold) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (guild_id) DO NOTHING',
    [guildId, CARTEL_DEFAULT_BASE_RATE_MG_PER_HOUR, CARTEL_DEFAULT_SHARE_PRICE, CARTEL_DEFAULT_SHARE_RATE_MG_PER_HOUR, CARTEL_DEFAULT_XP_PER_GRAM_SOLD]
  );
}

export async function ensureCartelInvestorRow(guildId, userId) {
  await ensureCartelPoolRow(guildId);
  await q(
    'INSERT INTO cartel_investors (guild_id, user_id) VALUES ($1,$2) ON CONFLICT (guild_id, user_id) DO NOTHING',
    [guildId, userId]
  );
}

function toEpochSeconds(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value) : null;
  }
  const str = String(value);
  if (!str) return null;
  const numeric = Number(str);
  if (!Number.isNaN(numeric)) return numeric;
  const parsed = Date.parse(str);
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  return null;
}

const CARTEL_MAX_SALE_MULTIPLIER_BPS = 50_000;

function normalizeCartelPool(row) {
  if (!row) return null;
  return {
    guild_id: row.guild_id,
    total_shares: Number(row.total_shares || 0),
    base_rate_mg_per_hour: Number(row.base_rate_mg_per_hour || CARTEL_DEFAULT_BASE_RATE_MG_PER_HOUR),
    share_price: Number(row.share_price || CARTEL_DEFAULT_SHARE_PRICE),
    share_rate_mg_per_hour: Number(row.share_rate_mg_per_hour || CARTEL_DEFAULT_SHARE_RATE_MG_PER_HOUR),
    xp_per_gram_sold: Number(row.xp_per_gram_sold || CARTEL_DEFAULT_XP_PER_GRAM_SOLD),
    carryover_mg: Number(row.carryover_mg || 0),
    last_tick_at: row.last_tick_at !== null && row.last_tick_at !== undefined ? Number(row.last_tick_at) : null,
    event_state: row.event_state ? safeParseJson(row.event_state) : null
  };
}

function normalizeCartelInvestor(row) {
  if (!row) return null;
  return {
    guild_id: row.guild_id,
    user_id: row.user_id,
    shares: Number(row.shares || 0),
    stash_mg: Number(row.stash_mg || 0),
    warehouse_mg: Number(row.warehouse_mg || 0),
    rank: Math.max(1, Number(row.rank || 1)),
    rank_xp: Math.max(0, Number(row.rank_xp || 0)),
    sale_multiplier_bps: Math.max(0, Math.min(CARTEL_MAX_SALE_MULTIPLIER_BPS, Number(row.sale_multiplier_bps || 0))),
    auto_sell_rule: row.auto_sell_rule ? safeParseJson(row.auto_sell_rule) : null,
    created_at: toEpochSeconds(row.created_at),
    updated_at: toEpochSeconds(row.updated_at)
  };
}

function normalizeCartelDealer(row) {
  if (!row) return null;
  return {
    dealer_id: row.dealer_id,
    guild_id: row.guild_id,
    user_id: row.user_id,
    tier: Number(row.tier ?? 1),
    trait: row.trait || null,
    display_name: row.display_name || null,
    status: row.status || 'ACTIVE',
    hourly_sell_cap_mg: Number(row.hourly_sell_cap_mg || 0),
    price_multiplier_bps: Number(row.price_multiplier_bps || 10000),
    upkeep_cost: Number(row.upkeep_cost || 0),
    upkeep_interval_seconds: Number(row.upkeep_interval_seconds || 3600),
    upkeep_due_at: row.upkeep_due_at !== null && row.upkeep_due_at !== undefined ? Number(row.upkeep_due_at) : null,
    paused_upkeep_remaining_seconds: Math.max(0, Number(row.paused_upkeep_remaining_seconds || 0)),
    bust_until: row.bust_until !== null && row.bust_until !== undefined ? Number(row.bust_until) : null,
    last_sold_at: row.last_sold_at !== null && row.last_sold_at !== undefined ? Number(row.last_sold_at) : null,
    lifetime_sold_mg: Number(row.lifetime_sold_mg || 0),
    pending_chips: Number(row.pending_chips || 0),
    pending_mg: Number(row.pending_mg || 0),
    chip_remainder_units: Number(row.chip_remainder_units || 0),
    created_at: toEpochSeconds(row.created_at),
    updated_at: toEpochSeconds(row.updated_at)
  };
}

function normalizeCartelMarketOrder(row) {
  if (!row) return null;
  return {
    order_id: row.order_id,
    guild_id: row.guild_id,
    user_id: row.user_id,
    side: row.side || 'SELL',
    shares: Number(row.shares || 0),
    price_per_share: Number(row.price_per_share || 0),
    status: row.status || 'OPEN',
    created_at: toEpochSeconds(row.created_at),
    updated_at: toEpochSeconds(row.updated_at)
  };
}

export async function getModerators(guildId) {
  const gid = canonicalGuildId(guildId);
  const rows = await q('SELECT DISTINCT user_id FROM mod_users WHERE guild_id = $1', [gid]);
  return rows.map(r => String(r.user_id));
}
export async function addModerator(guildId, userId) {
  const gid = canonicalGuildId(guildId);
  await q('INSERT INTO mod_users (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, String(userId)]);
  return getModerators(guildId);
}
export async function removeModerator(guildId, userId) {
  const gid = canonicalGuildId(guildId);
  await q('DELETE FROM mod_users WHERE guild_id = $1 AND user_id = $2', [gid, String(userId)]);
  return getModerators(guildId);
}

export async function getAdmins(guildId) {
  const gid = canonicalGuildId(guildId);
  const rows = await q('SELECT DISTINCT user_id FROM admin_users WHERE guild_id = $1', [gid]);
  return rows.map(r => String(r.user_id));
}
export async function addAdmin(guildId, userId) {
  const gid = canonicalGuildId(guildId);
  await q('INSERT INTO admin_users (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, String(userId)]);
  return getAdmins(guildId);
}
export async function removeAdmin(guildId, userId) {
  const gid = canonicalGuildId(guildId);
  await q('DELETE FROM admin_users WHERE guild_id = $1 AND user_id = $2', [gid, String(userId)]);
  return getAdmins(guildId);
}

export async function getLastDailySpinAt(guildId, userId) {
  const gid = canonicalGuildId(guildId);
  const row = await q1('SELECT last_ts FROM daily_spin_last WHERE guild_id = $1 AND user_id = $2', [gid, String(userId)]);
  return row ? Number(row.last_ts || 0) : 0;
}

export async function setLastDailySpinNow(guildId, userId, ts = Math.floor(Date.now() / 1000)) {
  const gid = canonicalGuildId(guildId);
  await q(
    'INSERT INTO daily_spin_last (guild_id, user_id, last_ts) VALUES ($1,$2,$3) ON CONFLICT (guild_id, user_id) DO UPDATE SET last_ts = EXCLUDED.last_ts',
    [gid, String(userId), Number(ts)]
  );
  return ts;
}

// --- Users & House ---
export async function markUserFirstGameWin(guildId, userId, occurredAt = Math.floor(Date.now() / 1000)) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('USER_REQUIRED');
  await ensureGuildUser(gid, uid);
  const ts = Math.trunc(Number(occurredAt) || Math.floor(Date.now() / 1000));
  const rows = await q(
    'UPDATE users SET first_game_win_at = COALESCE(first_game_win_at, $1), updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3 AND first_game_win_at IS NULL RETURNING first_game_win_at',
    [ts, gid, uid]
  );
  return rows.length > 0;
}

export async function getUserBalances(guildId, discordId) {
  const gid = resolveGuildId(guildId);
  const row = await q1('SELECT chips, credits FROM users WHERE guild_id = $1 AND discord_id = $2', [gid, discordId]);
  return { chips: Number(row?.chips || 0), credits: Number(row?.credits || 0) };
}

export async function getUserOnboardingStatus(guildId, userId) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const row = await q1('SELECT acknowledged_at, chips_granted FROM user_onboarding WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
  if (!row) return null;
  const acknowledgedAt = row.acknowledged_at !== null && row.acknowledged_at !== undefined
    ? Math.trunc(Number(row.acknowledged_at) || 0)
    : null;
  return {
    acknowledgedAt,
    chipsGranted: Math.trunc(Number(row.chips_granted) || 0)
  };
}

export async function grantUserOnboardingBonus(guildId, userId, amount, reason = 'welcome bonus') {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  const amt = Math.trunc(Number(amount) || 0);
  if (!uid) throw new Error('ONBOARD_USER_REQUIRED');
  if (!Number.isInteger(amt) || amt <= 0) {
    return { granted: false, status: await getUserOnboardingStatus(gid, uid) };
  }
  const result = await tx(async c => {
    await c.query('INSERT INTO users (guild_id, discord_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, uid]);
    await c.query('INSERT INTO user_onboarding (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, uid]);
    const current = await c.query('SELECT chips_granted FROM user_onboarding WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [gid, uid]);
    const prevGranted = Math.trunc(Number(current?.rows?.[0]?.chips_granted) || 0);
    if (prevGranted >= amt) {
      return { granted: false };
    }
    await c.query('UPDATE users SET chips = chips + $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [amt, gid, uid]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, uid, amt, reason || 'welcome bonus', null, 'CHIPS']
    );
    await c.query('UPDATE user_onboarding SET chips_granted = $1, updated_at = NOW() WHERE guild_id = $2 AND user_id = $3', [amt, gid, uid]);
    return { granted: true };
  });
  const status = await getUserOnboardingStatus(gid, uid);
  return {
    granted: result?.granted === true,
    status
  };
}

export async function markUserOnboardingAcknowledged(guildId, userId, acknowledgedAt = Math.floor(Date.now() / 1000)) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('ONBOARD_USER_REQUIRED');
  const ack = acknowledgedAt === null ? null : Math.trunc(Number(acknowledgedAt) || Math.floor(Date.now() / 1000));
  await q('INSERT INTO user_onboarding (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, uid]);
  const res = ack === null
    ? { rowCount: 0 }
    : await pool.query('UPDATE user_onboarding SET acknowledged_at = $1, updated_at = NOW() WHERE guild_id = $2 AND user_id = $3 AND acknowledged_at IS NULL', [ack, gid, uid]);
  const status = await getUserOnboardingStatus(gid, uid);
  return {
    acknowledged: (res?.rowCount || 0) > 0 && !!(status && status.acknowledgedAt !== null),
    status
  };
}

export async function getTopUsers(guildId, limit = 10) {
  const gid = resolveGuildId(guildId);
  const n = Math.max(1, Math.min(25, Number(limit) || 10));
  const rows = await q(
    `SELECT discord_id, chips
     FROM users
     WHERE guild_id = $1
       AND chips > 0
       AND NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.guild_id = users.guild_id AND a.user_id = users.discord_id)
       AND NOT EXISTS (SELECT 1 FROM mod_users m WHERE m.guild_id = users.guild_id AND m.user_id = users.discord_id)
     ORDER BY chips DESC, created_at ASC
     LIMIT $2`,
    [gid, n]
  );
  return rows.map(r => ({ discord_id: r.discord_id, chips: Number(r.chips || 0) }));
}

export async function getAdminChipTotal(guildId) {
  const gid = resolveGuildId(guildId);
  const row = await q1(
    `SELECT COALESCE(SUM(u.chips), 0) AS total
     FROM users u
     WHERE u.guild_id = $1
       AND EXISTS (
         SELECT 1
         FROM admin_users a
         WHERE a.guild_id = u.guild_id AND a.user_id = u.discord_id
       )`,
    [gid]
  );
  return Math.max(0, Number(row?.total || 0));
}

export async function getHouseBalance(guildId) {
  const gid = resolveGuildId(guildId);
  return (await houseRow(gid)).chips;
}

export async function getCasinoNetworth(guildId) {
  const gid = resolveGuildId(guildId);
  const house = await getHouseBalance(gid);
  const row = await q1('SELECT COALESCE(SUM(chips), 0) AS total FROM users WHERE guild_id = $1', [gid]);
  return house + Number(row?.total || 0);
}

export async function getGlobalPlayerCount() {
  const row = await q1('SELECT COUNT(DISTINCT discord_id) AS n FROM users');
  return Number(row?.n || 0);
}

export async function listAllUserIds() {
  const rows = await q('SELECT DISTINCT discord_id FROM users ORDER BY discord_id ASC');
  return rows.map(row => String(row.discord_id));
}

export async function listBroadcastEligibleUserIds() {
  const rows = await q(
    `SELECT DISTINCT u.discord_id
     FROM users u
     LEFT JOIN user_activity_lifecycle l
       ON l.discord_user_id = u.discord_id
     WHERE COALESCE(l.is_inactive, FALSE) = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM admin_users a
         WHERE a.guild_id = u.guild_id AND a.user_id = u.discord_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM mod_users m
         WHERE m.guild_id = u.guild_id AND m.user_id = u.discord_id
       )
     ORDER BY u.discord_id ASC`
  );
  return rows.map(row => String(row.discord_id));
}

export async function getUserNewsSettings(userId) {
  const uid = String(userId || '').trim();
  if (!uid) {
    return {
      userId: null,
      newsOptIn: true,
      lastDeliveredAt: null,
      lastDigest: null
    };
  }
  const row = await q1('SELECT news_opt_in, last_delivered_at, last_digest FROM user_news_settings WHERE user_id = $1', [uid]);
  if (!row) {
    return {
      userId: uid,
      newsOptIn: true,
      lastDeliveredAt: null,
      lastDigest: null
    };
  }
  let lastDeliveredAt = null;
  if (row.last_delivered_at !== null && row.last_delivered_at !== undefined) {
    const parsed = Number(row.last_delivered_at);
    lastDeliveredAt = Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  const newsOptIn = row.news_opt_in === null || row.news_opt_in === undefined
    ? true
    : (
      row.news_opt_in === true ||
      row.news_opt_in === 1 ||
      row.news_opt_in === '1' ||
      row.news_opt_in === 't' ||
      row.news_opt_in === 'true'
    );
  return {
    userId: uid,
    newsOptIn,
    lastDeliveredAt,
    lastDigest: row.last_digest || null
  };
}

export async function setUserNewsOptIn(userId, optIn) {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('NEWS_USER_REQUIRED');
  const flag = !!optIn;
  await q(
    `INSERT INTO user_news_settings (user_id, news_opt_in, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET news_opt_in = EXCLUDED.news_opt_in, updated_at = NOW()`,
    [uid, flag]
  );
  return getUserNewsSettings(uid);
}

export async function markUserNewsDelivered(userId, digest, deliveredAt = Math.floor(Date.now() / 1000)) {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('NEWS_USER_REQUIRED');
  const ts = Math.trunc(Number(deliveredAt) || Math.floor(Date.now() / 1000));
  const normalizedDigest = digest ? String(digest).slice(0, 255) : null;
  await q(
    `INSERT INTO user_news_settings (user_id, news_opt_in, last_delivered_at, last_digest, updated_at)
     VALUES ($1, true, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       last_delivered_at = EXCLUDED.last_delivered_at,
       last_digest = EXCLUDED.last_digest,
       updated_at = NOW()`,
    [uid, ts, normalizedDigest]
  );
  return getUserNewsSettings(uid);
}

export async function addToHouse(guildId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    await c.query('INSERT INTO guild_house (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [gid]);
    await c.query('UPDATE guild_house SET chips = chips + $1, updated_at = NOW() WHERE guild_id = $2', [amt, gid]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, 'HOUSE', amt, reason || 'house top-up', adminId || null, 'CHIPS']
    );
  });
  return getHouseBalance(gid);
}

export async function removeFromHouse(guildId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    const row = await c.query('SELECT chips FROM guild_house WHERE guild_id = $1', [gid]);
    const chips = Number(row?.rows?.[0]?.chips || 0);
    if (chips < amt) throw new Error('INSUFFICIENT_HOUSE');
    await c.query('UPDATE guild_house SET chips = chips - $1, updated_at = NOW() WHERE guild_id = $2', [amt, gid]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, 'HOUSE', -amt, reason || 'house remove', adminId || null, 'CHIPS']
    );
  });
  return getHouseBalance(gid);
}

export async function transferFromHouseToUser(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    const row = await c.query('SELECT chips FROM guild_house WHERE guild_id = $1', [gid]);
    const chips = Number(row?.rows?.[0]?.chips || 0);
    if (chips < amt) throw new Error('INSUFFICIENT_HOUSE');
    await c.query('INSERT INTO users (guild_id, discord_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, discordId]);
    await c.query('UPDATE guild_house SET chips = chips - $1, updated_at = NOW() WHERE guild_id = $2', [amt, gid]);
    await c.query('UPDATE users SET chips = chips + $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [amt, gid, discordId]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, discordId, amt, reason || 'admin grant', adminId || null, 'CHIPS']
    );
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, 'HOUSE', -amt, `grant to ${discordId}${reason ? ': ' + reason : ''}`, adminId || null, 'CHIPS']
    );
  });
  const bal = await getUserBalances(gid, discordId);
  return { ...bal, house: await getHouseBalance(gid) };
}

export async function takeFromUserToHouse(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    const row = await c.query('SELECT chips FROM users WHERE guild_id = $1 AND discord_id = $2', [gid, discordId]);
    const chips = Number(row?.rows?.[0]?.chips || 0);
    if (chips < amt) throw new Error('INSUFFICIENT_USER');
    await c.query('UPDATE users SET chips = chips - $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [amt, gid, discordId]);
    await c.query('INSERT INTO guild_house (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [gid]);
    await c.query('UPDATE guild_house SET chips = chips + $1, updated_at = NOW() WHERE guild_id = $2', [amt, gid]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, discordId, -amt, reason || 'game stake', adminId || null, 'CHIPS']
    );
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, 'HOUSE', amt, `stake from ${discordId}${reason ? ': ' + reason : ''}`, adminId || null, 'CHIPS']
    );
  });
  const bal = await getUserBalances(gid, discordId);
  return { ...bal, house: await getHouseBalance(gid) };
}

export async function burnFromUser(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    const row = await c.query('SELECT chips FROM users WHERE guild_id = $1 AND discord_id = $2', [gid, discordId]);
    const chips = Number(row?.rows?.[0]?.chips || 0);
    if (chips < amt) throw new Error('INSUFFICIENT_USER');
    await c.query('UPDATE users SET chips = chips - $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [amt, gid, discordId]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, discordId, -amt, reason || 'admin burn chips', adminId || null, 'CHIPS']
    );
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, 'BURN', amt, `burn chips from ${discordId}${reason ? ': ' + reason : ''}`, adminId || null, 'CHIPS']
    );
  });
  return getUserBalances(gid, discordId);
}

export async function mintChips(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    await c.query('INSERT INTO users (guild_id, discord_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, discordId]);
    await c.query('UPDATE users SET chips = chips + $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [amt, gid, discordId]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, discordId, amt, reason || 'admin mint chips', adminId || null, 'CHIPS']
    );
  });
  return getUserBalances(gid, discordId);
}

export async function recordVoteReward(discordId, source, amount, metadata = {}, earnedAt = Math.floor(Date.now() / 1000), externalId = null) {
  const userId = String(discordId || '').trim();
  const src = String(source || '').trim();
  if (!userId) throw new Error('VOTE_REWARD_USER_REQUIRED');
  if (!src) throw new Error('VOTE_REWARD_SOURCE_REQUIRED');
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('VOTE_REWARD_AMOUNT_POSITIVE');
  const ts = Number.isInteger(earnedAt) && earnedAt > 0 ? earnedAt : Math.floor(Date.now() / 1000);
  const meta = metadata && Object.keys(metadata).length ? JSON.stringify(metadata) : null;
  const extId = externalId ? String(externalId).trim() || null : null;
  try {
    await q(
      'INSERT INTO vote_rewards (discord_user_id, source, reward_amount, metadata_json, earned_at, external_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, src, amt, meta, ts, extId]
    );
    return true;
  } catch (err) {
    if (err?.code === '23505') return false;
    throw err;
  }
}

export async function getPendingVoteRewards(discordId) {
  const userId = String(discordId || '').trim();
  if (!userId) return [];
  const rows = await q(
    `SELECT id, source, reward_amount, earned_at, metadata_json,
            claimed_at, claim_guild_id, dm_attempted_at, dm_sent_at, dm_failed_at, dm_failure_reason
       FROM vote_rewards
      WHERE discord_user_id = $1 AND claimed_at IS NULL
      ORDER BY earned_at ASC, id ASC`,
    [userId]
  );
  return rows.map(mapVoteRow).filter(Boolean);
}

export async function getRecentClaimedVoteRewards(discordId, limit = 5) {
  const userId = String(discordId || '').trim();
  if (!userId) return [];
  const n = Math.max(1, Math.min(20, Number(limit) || 5));
  const rows = await q(
    `SELECT id, source, reward_amount, earned_at, metadata_json,
            claimed_at, claim_guild_id, dm_attempted_at, dm_sent_at, dm_failed_at, dm_failure_reason
       FROM vote_rewards
      WHERE discord_user_id = $1 AND claimed_at IS NOT NULL
      ORDER BY claimed_at DESC, id DESC
      LIMIT $2`,
    [userId, n]
  );
  return rows.map(mapVoteRow).filter(Boolean);
}

export async function redeemVoteRewards(_guildId, discordId, options = {}) {
  const userId = String(discordId || '').trim();
  if (!userId) throw new Error('VOTE_REWARD_USER_REQUIRED');
  const gid = resolveGuildId();
  const reason = options?.reason ? String(options.reason) : 'vote reward';
  const adminId = options?.adminId ? String(options.adminId) : null;
  const limit = Number.isInteger(options?.limit) && options.limit > 0 ? options.limit : null;

  return tx(async c => {
    await c.query('INSERT INTO users (guild_id, discord_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, userId]);
    const pendingRes = await c.query(
      `SELECT id, source, reward_amount, earned_at, metadata_json,
              claimed_at, claim_guild_id, dm_attempted_at, dm_sent_at, dm_failed_at, dm_failure_reason
         FROM vote_rewards
        WHERE discord_user_id = $1 AND claimed_at IS NULL
        ORDER BY earned_at ASC, id ASC`,
      [userId]
    );
    const pendingRows = pendingRes.rows || [];
    const selected = limit ? pendingRows.slice(0, limit) : pendingRows;
    if (!selected.length) {
      const balRes = await c.query('SELECT chips, credits FROM users WHERE guild_id = $1 AND discord_id = $2', [gid, userId]);
      const balRow = balRes.rows?.[0] || { chips: 0, credits: 0 };
      return {
        claimedTotal: 0,
        claimedCount: 0,
        claimedRewards: [],
        balances: { chips: Number(balRow.chips || 0), credits: Number(balRow.credits || 0) },
        remaining: pendingRows.length
      };
    }

    let total = 0;
    for (const row of selected) total += Number(row.reward_amount || 0);
    if (!Number.isInteger(total) || total <= 0) {
      const balRes = await c.query('SELECT chips, credits FROM users WHERE guild_id = $1 AND discord_id = $2', [gid, userId]);
      const balRow = balRes.rows?.[0] || { chips: 0, credits: 0 };
      return {
        claimedTotal: 0,
        claimedCount: 0,
        claimedRewards: [],
        balances: { chips: Number(balRow.chips || 0), credits: Number(balRow.credits || 0) },
        remaining: pendingRows.length
      };
    }

    await c.query('UPDATE users SET chips = chips + $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [total, gid, userId]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, userId, total, reason || 'vote reward', adminId || null, 'CHIPS']
    );
    const now = Math.floor(Date.now() / 1000);
    for (const row of selected) {
      await c.query('UPDATE vote_rewards SET claimed_at = $1, claim_guild_id = $2 WHERE id = $3', [now, gid, row.id]);
    }
    const balRes = await c.query('SELECT chips, credits FROM users WHERE guild_id = $1 AND discord_id = $2', [gid, userId]);
    const balRow = balRes.rows?.[0] || { chips: 0, credits: 0 };
    return {
      claimedTotal: total,
      claimedCount: selected.length,
      claimedRewards: selected.map(mapVoteRow).filter(Boolean),
      balances: { chips: Number(balRow.chips || 0), credits: Number(balRow.credits || 0) },
      remaining: pendingRows.length - selected.length
    };
  });
}

export async function markVoteRewardDmStatus(voteRewardIds, options = {}) {
  const ids = Array.isArray(voteRewardIds)
    ? voteRewardIds
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0)
    : [];
  if (!ids.length) return 0;
  const ts = Number.isInteger(options?.timestamp) && options.timestamp > 0
    ? Number(options.timestamp)
    : Math.floor(Date.now() / 1000);
  const sent = options?.sent === true;
  const failureReason = sent
    ? null
    : String(options?.error || options?.reason || '')
        .trim()
        .slice(0, 300) || null;
  const result = await q(
    `UPDATE vote_rewards
        SET dm_attempted_at = $2,
            dm_sent_at = $3,
            dm_failed_at = $4,
            dm_failure_reason = $5
      WHERE id = ANY($1::bigint[])
        AND claimed_at IS NOT NULL`,
    [ids, ts, sent ? ts : null, sent ? null : ts, failureReason]
  );
  return Number(result?.rowCount || 0);
}

export async function listUsersWithPendingVoteRewards(limit = 50) {
  const n = Math.max(1, Math.min(500, Number(limit) || 50));
  const rows = await q(
    `SELECT discord_user_id
     FROM vote_rewards
     WHERE claimed_at IS NULL
     GROUP BY discord_user_id
     ORDER BY MIN(earned_at) ASC, MIN(id) ASC
     LIMIT $1`,
    [n]
  );
  return rows.map(row => row.discord_user_id);
}

export async function eraseUserData(discordId) {
  const userId = String(discordId || '').trim();
  if (!userId) throw new Error('ERASE_USER_ID_REQUIRED');
  return tx(async c => {
    const deleted = {};
    deleted.users = (await c.query('DELETE FROM users WHERE discord_id = $1', [userId])).rowCount;
    deleted.transactions = (await c.query('DELETE FROM transactions WHERE account = $1', [userId])).rowCount;
    deleted.dailySpin = (await c.query('DELETE FROM daily_spin_last WHERE user_id = $1', [userId])).rowCount;
    deleted.requestLast = (await c.query('DELETE FROM request_last WHERE user_id = $1', [userId])).rowCount;
    deleted.voteRewards = (await c.query('DELETE FROM vote_rewards WHERE discord_user_id = $1', [userId])).rowCount;
    deleted.jobProfiles = (await c.query('DELETE FROM job_profiles WHERE user_id = $1', [userId])).rowCount;
    deleted.jobStatus = (await c.query('DELETE FROM job_status WHERE user_id = $1', [userId])).rowCount;
    deleted.jobShifts = (await c.query('DELETE FROM job_shifts WHERE user_id = $1', [userId])).rowCount;
    deleted.activeRequests = (await c.query('DELETE FROM active_requests WHERE user_id = $1', [userId])).rowCount;
    deleted.holdemEscrow = (await c.query('DELETE FROM holdem_escrow WHERE user_id = $1', [userId])).rowCount;
    deleted.holdemCommits = (await c.query('DELETE FROM holdem_commits WHERE user_id = $1', [userId])).rowCount;
    deleted.modAssignments = (await c.query('DELETE FROM mod_users WHERE user_id = $1', [userId])).rowCount;
    deleted.adminAssignments = (await c.query('DELETE FROM admin_users WHERE user_id = $1', [userId])).rowCount;
    deleted.onboarding = (await c.query('DELETE FROM user_onboarding WHERE user_id = $1', [userId])).rowCount;
    const updated = {};
    updated.transactionsAdmin = (await c.query('UPDATE transactions SET admin_id = NULL WHERE admin_id = $1', [userId])).rowCount;
    updated.holdemTablesHost = (await c.query('UPDATE holdem_tables SET host_id = NULL WHERE host_id = $1', [userId])).rowCount;
    return { userId, deleted, updated };
  });
}

export async function grantCredits(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    await c.query('INSERT INTO users (guild_id, discord_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, discordId]);
    await c.query('UPDATE users SET credits = credits + $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [amt, gid, discordId]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, discordId, amt, reason || 'admin grant credits', adminId || null, 'CREDITS']
    );
  });
  return getUserBalances(gid, discordId);
}

export async function burnCredits(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    const row = await c.query('SELECT credits FROM users WHERE guild_id = $1 AND discord_id = $2', [gid, discordId]);
    const credits = Number(row?.rows?.[0]?.credits || 0);
    if (credits < amt) throw new Error('INSUFFICIENT_USER_CREDITS');
    await c.query('UPDATE users SET credits = credits - $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [amt, gid, discordId]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, discordId, -amt, reason || 'admin burn credits', adminId || null, 'CREDITS']
    );
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, 'BURN', amt, `burn credits from ${discordId}${reason ? ': ' + reason : ''}`, adminId || null, 'CREDITS']
    );
  });
  return getUserBalances(gid, discordId);
}

export async function gameLoseWithCredits(guildId, discordId, amount, detail) {
  const gid = resolveGuildId(guildId);
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    const row = await c.query('SELECT credits FROM users WHERE guild_id = $1 AND discord_id = $2', [gid, discordId]);
    const credits = Number(row?.rows?.[0]?.credits || 0);
    if (credits < amt) throw new Error('INSUFFICIENT_USER_CREDITS');
    await c.query('UPDATE users SET credits = credits - $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [amt, gid, discordId]);
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, discordId, -amt, `game loss (credits)${detail ? ': ' + detail : ''}`, null, 'CREDITS']
    );
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, 'BURN', amt, `game loss from ${discordId}${detail ? ': ' + detail : ''}`, null, 'CREDITS']
    );
  });
  return getUserBalances(gid, discordId);
}

export async function gameWinWithCredits(guildId, discordId, amount, detail) {
  return transferFromHouseToUser(guildId, discordId, amount, `game win (credits)${detail ? ': ' + detail : ''}`, null);
}

// --- Cartel Passive System ---
export async function getCartelPool(guildId) {
  const gid = resolveGuildId(guildId);
  const row = await q1('SELECT guild_id, total_shares, base_rate_mg_per_hour, share_price, share_rate_mg_per_hour, xp_per_gram_sold, carryover_mg, last_tick_at, event_state FROM cartel_pool WHERE guild_id = $1', [gid]);
  return normalizeCartelPool(row) || {
    guild_id: gid,
    total_shares: 0,
    base_rate_mg_per_hour: CARTEL_DEFAULT_BASE_RATE_MG_PER_HOUR,
    share_price: CARTEL_DEFAULT_SHARE_PRICE,
    share_rate_mg_per_hour: CARTEL_DEFAULT_SHARE_RATE_MG_PER_HOUR,
    xp_per_gram_sold: CARTEL_DEFAULT_XP_PER_GRAM_SOLD,
    carryover_mg: 0,
    last_tick_at: null,
    event_state: null
  };
}

export async function setCartelSharePrice(guildId, sharePrice) {
  const gid = resolveGuildId(guildId);
  const price = Math.max(1, Math.floor(Number(sharePrice || 0)));
  if (!Number.isInteger(price) || price <= 0) throw new Error('CARTEL_SHARE_PRICE_INVALID');
  await ensureCartelPoolRow(gid);
  await q('UPDATE cartel_pool SET share_price = $1, updated_at = NOW() WHERE guild_id = $2', [price, gid]);
  return getCartelPool(gid);
}

export async function setCartelShareRate(guildId, shareRateMgPerHour) {
  const gid = resolveGuildId(guildId);
  const rate = Math.max(1, Math.floor(Number(shareRateMgPerHour || 0)));
  await ensureCartelPoolRow(gid);
  await q('UPDATE cartel_pool SET share_rate_mg_per_hour = $1, updated_at = NOW() WHERE guild_id = $2', [rate, gid]);
  return getCartelPool(gid);
}

export async function setCartelXpPerGram(guildId, xpPerGram) {
  const gid = resolveGuildId(guildId);
  const rate = Math.max(0, Number(xpPerGram || 0));
  await ensureCartelPoolRow(gid);
  await q('UPDATE cartel_pool SET xp_per_gram_sold = $1, updated_at = NOW() WHERE guild_id = $2', [rate, gid]);
  return getCartelPool(gid);
}

export async function listCartelGuildIds() {
  const rows = await q(`
    SELECT guild_id FROM (
      SELECT DISTINCT guild_id FROM cartel_pool
      UNION
      SELECT DISTINCT guild_id FROM cartel_investors
      UNION
      SELECT DISTINCT guild_id FROM cartel_dealers
    ) g
  `);
  return rows
    .map(row => String(row?.guild_id || '').trim())
    .filter(Boolean);
}

export async function listCartelInvestors(guildId) {
  const gid = resolveGuildId(guildId);
  const rows = await q('SELECT guild_id, user_id, shares, stash_mg, warehouse_mg, rank, rank_xp, auto_sell_rule, sale_multiplier_bps, created_at, updated_at FROM cartel_investors WHERE guild_id = $1', [gid]);
  return rows.map(normalizeCartelInvestor).filter(Boolean);
}

export async function getCartelActiveInvestorStats(guildId) {
  const gid = resolveGuildId(guildId);
  const row = await q1(
    `SELECT
       COALESCE(SUM(shares), 0) AS total_shares,
       COUNT(*)::int AS active_investors
     FROM cartel_investors
     WHERE guild_id = $1 AND shares > 0`,
    [gid]
  );
  return {
    totalShares: Math.max(0, Number(row?.total_shares || 0)),
    activeInvestors: Math.max(0, Number(row?.active_investors || 0))
  };
}

export async function listCartelActiveInvestorsPage(guildId, limit = 500, offset = 0) {
  const gid = resolveGuildId(guildId);
  const pageSize = Math.max(1, Math.min(2_000, Math.floor(Number(limit || 500))));
  const pageOffset = Math.max(0, Math.floor(Number(offset || 0)));
  const rows = await q(
    `SELECT guild_id, user_id, shares, stash_mg, warehouse_mg, rank, rank_xp, auto_sell_rule, sale_multiplier_bps, created_at, updated_at
     FROM cartel_investors
     WHERE guild_id = $1 AND shares > 0
     ORDER BY user_id ASC
     LIMIT $2 OFFSET $3`,
    [gid, pageSize, pageOffset]
  );
  return rows.map(normalizeCartelInvestor).filter(Boolean);
}

export async function getCartelShareLeaders(guildId, limit = 10) {
  const gid = resolveGuildId(guildId);
  const n = Math.max(1, Math.min(100, Math.floor(Number(limit || 10))));
  const rows = await q(
    `SELECT guild_id, user_id, shares, stash_mg, warehouse_mg, rank, rank_xp, auto_sell_rule, sale_multiplier_bps, created_at, updated_at
     FROM cartel_investors
     WHERE guild_id = $1
       AND shares > 0
       AND NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.guild_id = cartel_investors.guild_id AND a.user_id = cartel_investors.user_id)
       AND NOT EXISTS (SELECT 1 FROM mod_users m WHERE m.guild_id = cartel_investors.guild_id AND m.user_id = cartel_investors.user_id)
     ORDER BY shares DESC, created_at ASC, user_id ASC
     LIMIT $2`,
    [gid, n]
  );
  return rows.map(normalizeCartelInvestor).filter(Boolean);
}

export async function getCartelStaffShareTotal(guildId) {
  const gid = resolveGuildId(guildId);
  const row = await q1(
    `SELECT COALESCE(SUM(ci.shares), 0) AS total
     FROM cartel_investors ci
     WHERE ci.guild_id = $1
       AND ci.shares > 0
       AND (
         EXISTS (SELECT 1 FROM admin_users a WHERE a.guild_id = ci.guild_id AND a.user_id = ci.user_id)
         OR EXISTS (SELECT 1 FROM mod_users m WHERE m.guild_id = ci.guild_id AND m.user_id = ci.user_id)
       )`,
    [gid]
  );
  return Math.max(0, Number(row?.total || 0));
}

export async function getCartelInvestor(guildId, userId) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const row = await q1('SELECT guild_id, user_id, shares, stash_mg, warehouse_mg, rank, rank_xp, auto_sell_rule, sale_multiplier_bps, created_at, updated_at FROM cartel_investors WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
  return normalizeCartelInvestor(row);
}

export async function cartelAddShares(guildId, userId, deltaShares) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  const shares = Number(deltaShares || 0);
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');
  if (!Number.isInteger(shares) || shares <= 0) throw new Error('CARTEL_INVALID_SHARES');
  await tx(async c => {
    await c.query('INSERT INTO cartel_pool (guild_id, base_rate_mg_per_hour, share_price, share_rate_mg_per_hour) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [gid, CARTEL_DEFAULT_BASE_RATE_MG_PER_HOUR, CARTEL_DEFAULT_SHARE_PRICE, CARTEL_DEFAULT_SHARE_RATE_MG_PER_HOUR]);
    await c.query('INSERT INTO cartel_investors (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, uid]);
    await c.query(
      'UPDATE cartel_pool SET total_shares = total_shares + $1, updated_at = NOW() WHERE guild_id = $2',
      [shares, gid]
    );
    await c.query(
      'UPDATE cartel_investors SET shares = shares + $1, updated_at = NOW() WHERE guild_id = $2 AND user_id = $3',
      [shares, gid, uid]
    );
  });
  return getCartelInvestor(gid, uid);
}

export async function cartelRemoveShares(guildId, userId, deltaShares) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  const shares = Number(deltaShares || 0);
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');
  if (!Number.isInteger(shares) || shares <= 0) throw new Error('CARTEL_INVALID_SHARES');
  return tx(async c => {
    await c.query('INSERT INTO cartel_pool (guild_id, base_rate_mg_per_hour, share_price, share_rate_mg_per_hour) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [gid, CARTEL_DEFAULT_BASE_RATE_MG_PER_HOUR, CARTEL_DEFAULT_SHARE_PRICE, CARTEL_DEFAULT_SHARE_RATE_MG_PER_HOUR]);
    await c.query('INSERT INTO cartel_investors (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, uid]);
    const current = await c.query('SELECT shares FROM cartel_investors WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [gid, uid]);
    const owned = Number(current.rows?.[0]?.shares || 0);
    if (!Number.isFinite(owned) || owned < shares) {
      throw new Error('CARTEL_NOT_ENOUGH_SHARES');
    }
    await c.query(
      'UPDATE cartel_pool SET total_shares = GREATEST(total_shares - $1, 0), updated_at = NOW() WHERE guild_id = $2',
      [shares, gid]
    );
    await c.query(
      'UPDATE cartel_investors SET shares = shares - $1, updated_at = NOW() WHERE guild_id = $2 AND user_id = $3',
      [shares, gid, uid]
    );
    const next = await c.query('SELECT guild_id, user_id, shares, stash_mg, warehouse_mg, rank, rank_xp, auto_sell_rule, sale_multiplier_bps, created_at, updated_at FROM cartel_investors WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
    return normalizeCartelInvestor(next.rows[0]);
  });
}

export async function cartelSetHoldings(guildId, userId, stashMg, warehouseMg) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');
  const stash = Math.max(0, Math.floor(Number(stashMg || 0)));
  const warehouse = Math.max(0, Math.floor(Number(warehouseMg || 0)));
  await ensureCartelInvestorRow(gid, uid);
  await q(
    'UPDATE cartel_investors SET stash_mg = $1, warehouse_mg = $2, updated_at = NOW() WHERE guild_id = $3 AND user_id = $4',
    [stash, warehouse, gid, uid]
  );
  return getCartelInvestor(gid, uid);
}

export async function cartelApplyRaidOutcome(
  guildId,
  userId,
  {
    confiscatedWarehouseMg = 0,
    confiscatedStashMg = 0,
    finePerGram = 0,
    reason = 'cartel warehouse raid fine',
    metadata = null
  } = {}
) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');

  const requestedWarehouseMg = Math.max(0, Math.floor(Number(confiscatedWarehouseMg || 0)));
  const requestedStashMg = Math.max(0, Math.floor(Number(confiscatedStashMg || 0)));
  const finePerGramValue = Math.max(0, Number(finePerGram || 0));

  return tx(async c => {
    await c.query('INSERT INTO cartel_investors (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, uid]);
    await c.query('INSERT INTO users (guild_id, discord_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, uid]);
    await c.query('INSERT INTO guild_house (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [gid]);

    const investorRes = await c.query(
      'SELECT stash_mg, warehouse_mg FROM cartel_investors WHERE guild_id = $1 AND user_id = $2 FOR UPDATE',
      [gid, uid]
    );
    const investorRow = investorRes.rows?.[0] || {};
    const currentStashMg = Math.max(0, Math.floor(Number(investorRow.stash_mg || 0)));
    const currentWarehouseMg = Math.max(0, Math.floor(Number(investorRow.warehouse_mg || 0)));

    const confiscatedWarehouseMgActual = Math.min(currentWarehouseMg, requestedWarehouseMg);
    const confiscatedStashMgActual = Math.min(currentStashMg, requestedStashMg);
    const confiscatedTotalMg = Math.max(0, confiscatedWarehouseMgActual + confiscatedStashMgActual);

    if (confiscatedTotalMg > 0) {
      const nextStashMg = Math.max(0, currentStashMg - confiscatedStashMgActual);
      const nextWarehouseMg = Math.max(0, currentWarehouseMg - confiscatedWarehouseMgActual);
      await c.query(
        'UPDATE cartel_investors SET stash_mg = $1, warehouse_mg = $2, updated_at = NOW() WHERE guild_id = $3 AND user_id = $4',
        [nextStashMg, nextWarehouseMg, gid, uid]
      );
    }

    const confiscatedGrams = confiscatedTotalMg > 0 ? (confiscatedTotalMg / MG_PER_GRAM) : 0;
    const fineChipsCharged = confiscatedGrams > 0
      ? Math.max(0, Math.ceil(confiscatedGrams * finePerGramValue))
      : 0;

    let fineChipsPaid = 0;
    if (fineChipsCharged > 0) {
      const userRes = await c.query(
        'SELECT chips FROM users WHERE guild_id = $1 AND discord_id = $2 FOR UPDATE',
        [gid, uid]
      );
      const currentUserChips = Math.max(0, Math.floor(Number(userRes.rows?.[0]?.chips || 0)));
      fineChipsPaid = Math.min(currentUserChips, fineChipsCharged);
      if (fineChipsPaid > 0) {
        await c.query(
          'UPDATE users SET chips = chips - $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3',
          [fineChipsPaid, gid, uid]
        );
        await c.query(
          'UPDATE guild_house SET chips = chips + $1, updated_at = NOW() WHERE guild_id = $2',
          [fineChipsPaid, gid]
        );
        await c.query(
          'INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)',
          [gid, uid, -fineChipsPaid, reason, 'CHIPS']
        );
        await c.query(
          'INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)',
          [gid, 'HOUSE', fineChipsPaid, `raid fine from ${uid}${reason ? ': ' + reason : ''}`, 'CHIPS']
        );
      }
    }

    const metadataPayload = {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      confiscatedWarehouseMg: confiscatedWarehouseMgActual,
      confiscatedCollectedMg: confiscatedStashMgActual,
      fineChipsCharged,
      fineChipsPaid
    };
    const metadataJson = Object.keys(metadataPayload).length ? JSON.stringify(metadataPayload) : null;

    await c.query(
      'INSERT INTO cartel_transactions (guild_id, user_id, type, amount_chips, amount_mg, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)',
      [gid, uid, 'WAREHOUSE_RAID', fineChipsPaid, confiscatedTotalMg, metadataJson]
    );

    return {
      confiscatedWarehouseMg: confiscatedWarehouseMgActual,
      confiscatedCollectedMg: confiscatedStashMgActual,
      confiscatedTotalMg,
      fineChipsCharged,
      fineChipsPaid
    };
  });
}

export async function cartelSetRankAndXp(guildId, userId, rank, rankXp) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');
  const r = Math.max(1, Math.min(10, Number(rank || 1)));
  const xp = Math.max(0, Math.floor(Number(rankXp || 0)));
  await ensureCartelInvestorRow(gid, uid);
  await q(
    'UPDATE cartel_investors SET rank = $1, rank_xp = $2, updated_at = NOW() WHERE guild_id = $3 AND user_id = $4',
    [r, xp, gid, uid]
  );
  return getCartelInvestor(gid, uid);
}

export async function cartelSetSaleMultiplier(guildId, userId, multiplierBps) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');
  const bps = Math.max(0, Math.min(CARTEL_MAX_SALE_MULTIPLIER_BPS, Math.floor(Number(multiplierBps || 0))));
  await ensureCartelInvestorRow(gid, uid);
  await q(
    'UPDATE cartel_investors SET sale_multiplier_bps = $1, updated_at = NOW() WHERE guild_id = $2 AND user_id = $3',
    [bps, gid, uid]
  );
  return getCartelInvestor(gid, uid);
}

export async function cartelAdjustSaleMultiplier(guildId, userId, deltaBps) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');
  const delta = Math.floor(Number(deltaBps || 0));
  if (!Number.isFinite(delta)) throw new Error('CARTEL_MULTIPLIER_DELTA_INVALID');
  await ensureCartelInvestorRow(gid, uid);
  await q(
    'UPDATE cartel_investors SET sale_multiplier_bps = LEAST(GREATEST(sale_multiplier_bps + $1, 0), $2), updated_at = NOW() WHERE guild_id = $3 AND user_id = $4',
    [delta, CARTEL_MAX_SALE_MULTIPLIER_BPS, gid, uid]
  );
  return getCartelInvestor(gid, uid);
}

export async function cartelSetAutoSellRule(guildId, userId, rule) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');
  await ensureCartelInvestorRow(gid, uid);
  const payload = rule == null ? null : JSON.stringify(rule);
  await q(
    'UPDATE cartel_investors SET auto_sell_rule = $1, updated_at = NOW() WHERE guild_id = $2 AND user_id = $3',
    [payload, gid, uid]
  );
  return getCartelInvestor(gid, uid);
}

export async function cartelResetInvestor(guildId, userId) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');
  return tx(async c => {
    await c.query('INSERT INTO cartel_pool (guild_id, base_rate_mg_per_hour, share_price, share_rate_mg_per_hour) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [gid, CARTEL_DEFAULT_BASE_RATE_MG_PER_HOUR, CARTEL_DEFAULT_SHARE_PRICE, CARTEL_DEFAULT_SHARE_RATE_MG_PER_HOUR]);
    await c.query('INSERT INTO cartel_investors (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, uid]);
    const current = await c.query('SELECT shares FROM cartel_investors WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [gid, uid]);
    const shares = Number(current.rows?.[0]?.shares || 0);
    if (shares > 0) {
      await c.query('UPDATE cartel_pool SET total_shares = GREATEST(total_shares - $1, 0), updated_at = NOW() WHERE guild_id = $2', [shares, gid]);
    }
    await c.query(`
      UPDATE cartel_investors
      SET shares = 0,
          stash_mg = 0,
          warehouse_mg = 0,
          rank = 1,
          rank_xp = 0,
          sale_multiplier_bps = 0,
          auto_sell_rule = NULL,
          updated_at = NOW()
      WHERE guild_id = $1 AND user_id = $2
    `, [gid, uid]);
    await c.query('DELETE FROM cartel_dealers WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
    const next = await c.query('SELECT guild_id, user_id, shares, stash_mg, warehouse_mg, rank, rank_xp, auto_sell_rule, sale_multiplier_bps, created_at, updated_at FROM cartel_investors WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
    return normalizeCartelInvestor(next.rows[0]);
  });
}

export async function cartelApplyProduction(guildId, updates = [], { lastTickAt = null, carryoverMg = null } = {}) {
  const gid = resolveGuildId(guildId);
  const rows = Array.isArray(updates) ? updates : [];
  await tx(async c => {
    await c.query('INSERT INTO cartel_pool (guild_id, base_rate_mg_per_hour, share_price, share_rate_mg_per_hour) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [gid, CARTEL_DEFAULT_BASE_RATE_MG_PER_HOUR, CARTEL_DEFAULT_SHARE_PRICE, CARTEL_DEFAULT_SHARE_RATE_MG_PER_HOUR]);
    if (lastTickAt !== null || carryoverMg !== null) {
      const lt = lastTickAt !== null && lastTickAt !== undefined ? Number(lastTickAt) : null;
      const co = carryoverMg !== null && carryoverMg !== undefined ? Math.max(0, Math.floor(Number(carryoverMg))) : 0;
      await c.query(
        'UPDATE cartel_pool SET last_tick_at = $1, carryover_mg = $2, updated_at = NOW() WHERE guild_id = $3',
        [lt, co, gid]
      );
    }
    for (const entry of rows) {
      if (!entry || !entry.userId) continue;
      const uid = String(entry.userId);
      await c.query('INSERT INTO cartel_investors (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gid, uid]);
      const stash = Math.max(0, Math.floor(Number(entry.stashMg ?? entry.stash_mg ?? 0)));
      const warehouse = Math.max(0, Math.floor(Number(entry.warehouseMg ?? entry.warehouse_mg ?? 0)));
      const rank = Math.max(1, Math.min(10, Number(entry.rank ?? 1)));
      const rankXp = Math.max(0, Math.floor(Number(entry.rankXp ?? entry.rank_xp ?? 0)));
      await c.query(
        'UPDATE cartel_investors SET stash_mg = $1, warehouse_mg = $2, rank = $3, rank_xp = $4, updated_at = NOW() WHERE guild_id = $5 AND user_id = $6',
        [stash, warehouse, rank, rankXp, gid, uid]
      );
    }
  });
}

export async function cartelUpdatePoolTick(guildId, lastTickAt, carryoverMg = 0) {
  const gid = resolveGuildId(guildId);
  await ensureCartelPoolRow(gid);
  const lt = lastTickAt !== null && lastTickAt !== undefined ? Number(lastTickAt) : null;
  const co = Math.max(0, Math.floor(Number(carryoverMg || 0)));
  await q(
    'UPDATE cartel_pool SET last_tick_at = $1, carryover_mg = $2, updated_at = NOW() WHERE guild_id = $3',
    [lt, co, gid]
  );
  return getCartelPool(gid);
}

export async function recordCartelTransaction(guildId, userId, type, amountChips, amountMg, metadata = null) {
  const gid = resolveGuildId(guildId);
  const uid = userId ? String(userId) : null;
  const chips = Math.floor(Number(amountChips || 0));
  const mg = Math.floor(Number(amountMg || 0));
  const meta = metadata ? JSON.stringify(metadata) : null;
  await q(
    'INSERT INTO cartel_transactions (guild_id, user_id, type, amount_chips, amount_mg, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)',
    [gid, uid, String(type || 'UNKNOWN'), chips, mg, meta]
  );
}

export async function createCartelMarketOrder(guildId, userId, side, shareAmount, pricePerShare) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');
  const normalizedSide = String(side || 'SELL').toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
  const shares = Math.max(1, Math.floor(Number(shareAmount || 0)));
  const price = Math.max(1, Math.floor(Number(pricePerShare || 0)));
  const orderId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await q(
    `INSERT INTO cartel_market_orders (order_id, guild_id, user_id, side, shares, price_per_share, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$7)`,
    [orderId, gid, uid, normalizedSide, shares, price, now]
  );
  const row = await q1(
    'SELECT order_id, guild_id, user_id, side, shares, price_per_share, status, created_at, updated_at FROM cartel_market_orders WHERE order_id = $1',
    [orderId]
  );
  return normalizeCartelMarketOrder(row);
}

export async function listCartelMarketOrders(guildId, side, limit = 10) {
  const gid = resolveGuildId(guildId);
  const normalizedSide = String(side || 'SELL').toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
  const cappedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit || 10))));
  const rows = await q(
    `SELECT order_id, guild_id, user_id, side, shares, price_per_share, status, created_at, updated_at
     FROM cartel_market_orders
     WHERE guild_id = $1 AND side = $2 AND status = 'OPEN'
     ORDER BY created_at DESC
     LIMIT $3`,
    [gid, normalizedSide, cappedLimit]
  );
  return rows.map(normalizeCartelMarketOrder).filter(Boolean);
}

export async function listCartelMarketOrdersForUser(guildId, userId, limit = 25) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) return [];
  const cappedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit || 25))));
  const rows = await q(
    `SELECT order_id, guild_id, user_id, side, shares, price_per_share, status, created_at, updated_at
     FROM cartel_market_orders
     WHERE guild_id = $1 AND user_id = $2 AND status = 'OPEN'
     ORDER BY created_at DESC
     LIMIT $3`,
    [gid, uid, cappedLimit]
  );
  return rows.map(normalizeCartelMarketOrder).filter(Boolean);
}

export async function getCartelMarketOrder(orderId) {
  if (!orderId) return null;
  const row = await q1(
    'SELECT order_id, guild_id, user_id, side, shares, price_per_share, status, created_at, updated_at FROM cartel_market_orders WHERE order_id = $1',
    [String(orderId)]
  );
  return normalizeCartelMarketOrder(row);
}

export async function setCartelMarketOrderStatus(orderId, status) {
  if (!orderId) throw new Error('CARTEL_ORDER_REQUIRED');
  const now = Math.floor(Date.now() / 1000);
  await q(
    'UPDATE cartel_market_orders SET status = $2, updated_at = $3 WHERE order_id = $1',
    [String(orderId), String(status || 'OPEN'), now]
  );
  return getCartelMarketOrder(orderId);
}

export async function setCartelMarketOrderShares(orderId, shares, status = 'OPEN') {
  const oid = String(orderId || '').trim();
  if (!oid) throw new Error('CARTEL_ORDER_REQUIRED');
  const normalizedShares = Math.max(0, Math.floor(Number(shares || 0)));
  const now = Math.floor(Date.now() / 1000);
  await q(
    'UPDATE cartel_market_orders SET shares = $2, status = $3, updated_at = $4 WHERE order_id = $1',
    [oid, normalizedShares, String(status || 'OPEN'), now]
  );
  return getCartelMarketOrder(orderId);
}

export async function getCartelOrderSnapshot(guildId, userId) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!gid || !uid) return null;
  const row = await q1('SELECT snapshot_json FROM cartel_order_snapshots WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
  if (!row?.snapshot_json) return null;
  try {
    const parsed = JSON.parse(row.snapshot_json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function setCartelOrderSnapshot(guildId, userId, snapshot) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!gid || !uid) return null;
  const payload = snapshot && typeof snapshot === 'object' ? JSON.stringify(snapshot) : '{}';
  const now = Math.floor(Date.now() / 1000);
  await q(
    `INSERT INTO cartel_order_snapshots (guild_id, user_id, snapshot_json, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, updated_at = EXCLUDED.updated_at`,
    [gid, uid, payload, now]
  );
  return getCartelOrderSnapshot(gid, uid);
}

export async function deleteCartelOrderSnapshot(guildId, userId) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!gid || !uid) return;
  await q('DELETE FROM cartel_order_snapshots WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
}

export async function cartelCreateDealer(guildId, dealerId, userId, payload) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('CARTEL_USER_REQUIRED');
  await q(
    `INSERT INTO cartel_dealers (dealer_id, guild_id, user_id, tier, trait, display_name, status, hourly_sell_cap_mg, price_multiplier_bps, upkeep_cost, upkeep_interval_seconds, upkeep_due_at, bust_until, last_sold_at, lifetime_sold_mg, pending_chips, pending_mg, chip_remainder_units)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,0,0,0)`,
    [
      dealerId,
      gid,
      uid,
      Math.max(0, Number(payload?.tier ?? 0)),
      payload?.trait || null,
      payload?.display_name || null,
      payload?.status || 'ACTIVE',
      Math.max(0, Math.floor(Number(payload?.hourly_sell_cap_mg || 0))),
      Math.max(1, Math.floor(Number(payload?.price_multiplier_bps || 10000))),
      Math.max(0, Math.floor(Number(payload?.upkeep_cost || 0))),
      Math.max(60, Math.floor(Number(payload?.upkeep_interval_seconds || 3600))),
      Math.max(0, Math.floor(Number(payload?.upkeep_due_at || 0))),
      payload?.bust_until ? Math.floor(Number(payload?.bust_until)) : null,
      payload?.last_sold_at ? Math.floor(Number(payload?.last_sold_at)) : null
    ]
  );
  return getCartelDealer(gid, dealerId);
}

export async function cartelDeleteDealer(guildId, dealerId) {
  const gid = resolveGuildId(guildId);
  if (!dealerId) return 0;
  await q('DELETE FROM cartel_dealers WHERE guild_id = $1 AND dealer_id = $2', [gid, dealerId]);
  return 1;
}

export async function cartelDeleteDealersForUser(guildId, userId) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) return 0;
  await q('DELETE FROM cartel_dealers WHERE guild_id = $1 AND user_id = $2', [gid, uid]);
  return 1;
}

export async function listCartelDealers(guildId) {
  const gid = resolveGuildId(guildId);
  const rows = await q(
    'SELECT dealer_id, guild_id, user_id, tier, trait, display_name, status, hourly_sell_cap_mg, price_multiplier_bps, upkeep_cost, upkeep_interval_seconds, upkeep_due_at, paused_upkeep_remaining_seconds, bust_until, last_sold_at, lifetime_sold_mg, pending_chips, pending_mg, chip_remainder_units, created_at, updated_at FROM cartel_dealers WHERE guild_id = $1 ORDER BY created_at ASC',
    [gid]
  );
  return rows.map(normalizeCartelDealer).filter(Boolean);
}

export async function listCartelDealersForUser(guildId, userId) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) return [];
  const rows = await q(
    'SELECT dealer_id, guild_id, user_id, tier, trait, display_name, status, hourly_sell_cap_mg, price_multiplier_bps, upkeep_cost, upkeep_interval_seconds, upkeep_due_at, paused_upkeep_remaining_seconds, bust_until, last_sold_at, lifetime_sold_mg, pending_chips, pending_mg, chip_remainder_units, created_at, updated_at FROM cartel_dealers WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at ASC',
    [gid, uid]
  );
  return rows.map(normalizeCartelDealer).filter(Boolean);
}

export async function getCartelDealer(guildId, dealerId) {
  const gid = resolveGuildId(guildId);
  if (!dealerId) return null;
  const row = await q1(
    'SELECT dealer_id, guild_id, user_id, tier, trait, display_name, status, hourly_sell_cap_mg, price_multiplier_bps, upkeep_cost, upkeep_interval_seconds, upkeep_due_at, paused_upkeep_remaining_seconds, bust_until, last_sold_at, lifetime_sold_mg, pending_chips, pending_mg, chip_remainder_units, created_at, updated_at FROM cartel_dealers WHERE guild_id = $1 AND dealer_id = $2',
    [gid, dealerId]
  );
  return normalizeCartelDealer(row);
}

export async function cartelSetDealerStatus(guildId, dealerId, status) {
  const gid = resolveGuildId(guildId);
  if (!dealerId) throw new Error('CARTEL_DEALER_REQUIRED');
  await q('UPDATE cartel_dealers SET status = $1, updated_at = NOW() WHERE guild_id = $2 AND dealer_id = $3', [String(status || 'ACTIVE'), gid, dealerId]);
  return getCartelDealer(gid, dealerId);
}

export async function cartelSetDealerUpkeep(guildId, dealerId, upkeepDueAt, status = null) {
  const gid = resolveGuildId(guildId);
  if (!dealerId) throw new Error('CARTEL_DEALER_REQUIRED');
  const due = upkeepDueAt !== null && upkeepDueAt !== undefined ? Math.floor(Number(upkeepDueAt)) : 0;
  const state = status || 'ACTIVE';
  await q('UPDATE cartel_dealers SET upkeep_due_at = $1, status = $2, paused_upkeep_remaining_seconds = 0, updated_at = NOW() WHERE guild_id = $3 AND dealer_id = $4', [due, state, gid, dealerId]);
  return getCartelDealer(gid, dealerId);
}

export async function cartelPauseDealerWithFrozenUpkeep(guildId, dealerId, remainingSeconds = 0) {
  const gid = resolveGuildId(guildId);
  if (!dealerId) throw new Error('CARTEL_DEALER_REQUIRED');
  const remaining = Math.max(0, Math.floor(Number(remainingSeconds || 0)));
  await q(
    'UPDATE cartel_dealers SET status = $1, paused_upkeep_remaining_seconds = $2, updated_at = NOW() WHERE guild_id = $3 AND dealer_id = $4',
    ['PAUSED', remaining, gid, dealerId]
  );
  return getCartelDealer(gid, dealerId);
}

export async function cartelRecordDealerSale(guildId, dealerId, mgSold, soldAtSeconds, chipRemainderUnits = null) {
  const gid = resolveGuildId(guildId);
  if (!dealerId) throw new Error('CARTEL_DEALER_REQUIRED');
  const mg = Math.max(0, Math.floor(Number(mgSold || 0)));
  const ts = Math.floor(Number(soldAtSeconds || Date.now() / 1000));
  const remainder = chipRemainderUnits == null ? null : Math.max(0, Math.floor(Number(chipRemainderUnits)));
  await q('UPDATE cartel_dealers SET last_sold_at = $1, lifetime_sold_mg = lifetime_sold_mg + $2, chip_remainder_units = COALESCE($3, chip_remainder_units), updated_at = NOW() WHERE guild_id = $4 AND dealer_id = $5', [ts, mg, remainder, gid, dealerId]);
  return getCartelDealer(gid, dealerId);
}

export async function cartelAddDealerPending(guildId, dealerId, chipsDelta, mgDelta) {
  const gid = resolveGuildId(guildId);
  const did = String(dealerId || '').trim();
  if (!did) return;
  const chips = Math.floor(Number(chipsDelta || 0));
  const mg = Math.floor(Number(mgDelta || 0));
  if (!chips && !mg) return;
  await q(
    'UPDATE cartel_dealers SET pending_chips = pending_chips + $1, pending_mg = pending_mg + $2, updated_at = NOW() WHERE guild_id = $3 AND dealer_id = $4',
    [chips, mg, gid, did]
  );
}

export async function cartelClearDealerPending(guildId, entries = []) {
  const gid = resolveGuildId(guildId);
  for (const entry of entries) {
    const did = String(entry?.dealer_id || entry?.dealerId || '').trim();
    if (!did) continue;
    const chips = Math.max(0, Math.floor(Number(entry.pending_chips || entry.chips || 0)));
    const mg = Math.max(0, Math.floor(Number(entry.pending_mg || entry.mg || 0)));
    if (!chips && !mg) continue;
    await q(
      'UPDATE cartel_dealers SET pending_chips = GREATEST(0, pending_chips - $1), pending_mg = GREATEST(0, pending_mg - $2), updated_at = NOW() WHERE guild_id = $3 AND dealer_id = $4',
      [chips, mg, gid, did]
    );
  }
}

// --- Guild settings ---
function normalizeSettings(row) {
  if (!row) return { log_channel_id: null, cash_log_channel_id: null, request_channel_id: null, update_channel_id: null, auto_ban_channel_id: null, request_cooldown_sec: 0, logging_enabled: 0, max_ridebus_bet: 1000, casino_category_id: null, holdem_rake_bps: 0, holdem_rake_cap: 0, kitten_mode_enabled: 0 };
  return {
    log_channel_id: row.log_channel_id || null,
    cash_log_channel_id: row.cash_log_channel_id || null,
    request_channel_id: row.request_channel_id || null,
    update_channel_id: row.update_channel_id || null,
    auto_ban_channel_id: row.auto_ban_channel_id || null,
    request_cooldown_sec: Number(row.request_cooldown_sec || 0),
    logging_enabled: row.logging_enabled ? 1 : 0,
    max_ridebus_bet: Number(row.max_ridebus_bet || 1000),
    casino_category_id: row.casino_category_id || null,
    holdem_rake_bps: Number(row.holdem_rake_bps || 0),
    holdem_rake_cap: Number(row.holdem_rake_cap || 0),
    kitten_mode_enabled: row.kitten_mode_enabled ? 1 : 0
  };
}

export async function getGuildSettings(guildId) {
  const row = await q1('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
  return normalizeSettings(row);
}

async function upsertGuildSettings(fields) {
  const keys = ['log_channel_id','cash_log_channel_id','request_channel_id','update_channel_id','auto_ban_channel_id','request_cooldown_sec','logging_enabled','max_ridebus_bet','casino_category_id','holdem_rake_bps','holdem_rake_cap','kitten_mode_enabled'];
  const vals = keys.map(k => fields[k] ?? null);
  await q('INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING', [fields.guild_id]);
  const updates = keys.map((k, i) => `${k} = COALESCE($${i + 2}, ${k})`).join(', ');
  await q(`UPDATE guild_settings SET ${updates}, updated_at = NOW() WHERE guild_id = $1`, [fields.guild_id, ...vals]);
}

export async function setGameLogChannel(guildId, channelId) { await upsertGuildSettings({ guild_id: guildId, log_channel_id: channelId }); return getGuildSettings(guildId); }
export async function setCashLogChannel(guildId, channelId) { await upsertGuildSettings({ guild_id: guildId, cash_log_channel_id: channelId }); return getGuildSettings(guildId); }
export async function setRequestChannel(guildId, channelId) { await upsertGuildSettings({ guild_id: guildId, request_channel_id: channelId }); return getGuildSettings(guildId); }
export async function setUpdateChannel(guildId, channelId) { await upsertGuildSettings({ guild_id: guildId, update_channel_id: channelId }); return getGuildSettings(guildId); }
export async function setAutoBanChannel(guildId, channelId) { await upsertGuildSettings({ guild_id: guildId, auto_ban_channel_id: channelId }); return getGuildSettings(guildId); }
export async function setRequestTimer(guildId, seconds) { await upsertGuildSettings({ guild_id: guildId, request_cooldown_sec: Math.max(0, Number(seconds) || 0) }); return getGuildSettings(guildId); }
export async function setLoggingEnabled(guildId, enabled) { await upsertGuildSettings({ guild_id: guildId, logging_enabled: !!enabled }); return getGuildSettings(guildId); }
export async function setMaxRidebusBet(guildId, amount) { await upsertGuildSettings({ guild_id: guildId, max_ridebus_bet: Math.max(1, Number(amount) || 1) }); return getGuildSettings(guildId); }
export async function setCasinoCategory(guildId, categoryId) { await upsertGuildSettings({ guild_id: guildId, casino_category_id: categoryId }); return getGuildSettings(guildId); }
export async function setDefaultHoldemRake(guildId, rakeBps, rakeCap = 0) { await upsertGuildSettings({ guild_id: guildId, holdem_rake_bps: Math.max(0, Number(rakeBps) || 0), holdem_rake_cap: Math.max(0, Number(rakeCap) || 0) }); return getGuildSettings(guildId); }
export async function setKittenMode(guildId, enabled) { await upsertGuildSettings({ guild_id: guildId, kitten_mode_enabled: !!enabled }); return getGuildSettings(guildId); }
export async function isKittenModeEnabled(guildId) { const settings = await getGuildSettings(guildId); return !!(settings && settings.kitten_mode_enabled); }

// --- Active Requests ---
export async function getActiveRequest(guildId, userId) {
  return (await q1('SELECT guild_id, user_id, message_id, type, amount, status FROM active_requests WHERE guild_id = $1 AND user_id = $2', [guildId, userId])) || null;
}
export async function createActiveRequest(guildId, userId, messageId, type, amount) {
  if (!guildId || !userId || !messageId) throw new Error('ACTIVE_REQ_PARAMS');
  const normalizedType = String(type || 'unknown');
  let normalizedAmount = Number.isInteger(Number(amount)) ? Number(amount) : 0;
  if (normalizedType !== 'erase' && (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0)) throw new Error('ACTIVE_REQ_AMOUNT');
  if (normalizedType === 'erase') normalizedAmount = 0;
  if (await getActiveRequest(guildId, userId)) throw new Error('ACTIVE_REQ_EXISTS');
  await q('INSERT INTO active_requests (guild_id, user_id, message_id, type, amount, status) VALUES ($1,$2,$3,$4,$5,$6)', [guildId, userId, messageId, normalizedType, normalizedAmount, 'PENDING']);
  return getActiveRequest(guildId, userId);
}
export async function updateActiveRequestStatus(guildId, userId, status) {
  await q('UPDATE active_requests SET status = $1, updated_at = NOW() WHERE guild_id = $2 AND user_id = $3', [String(status || 'PENDING'), guildId, userId]);
  return getActiveRequest(guildId, userId);
}
export async function clearActiveRequest(guildId, userId) {
  await q('DELETE FROM active_requests WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return true;
}

function secondsNow() {
  return Math.floor(Date.now() / 1000);
}

function normalizeJobProfileRow(guildId, userId, jobId, row = {}) {
  return {
    guildId,
    userId,
    jobId,
    rank: Math.max(1, intValue(row?.rank, 1)),
    totalXp: Math.max(0, intValue(row?.total_xp, 0)),
    xpToNext: Math.max(0, intValue(row?.xp_to_next, 100)),
    lastShiftAt: row?.last_shift_at !== null && row?.last_shift_at !== undefined ? intValue(row.last_shift_at, null) : null,
    createdAt: intValue(row?.created_at, 0),
    updatedAt: intValue(row?.updated_at, 0)
  };
}

function normalizeJobShiftRow(row = null) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    jobId: row.job_id,
    startedAt: intValue(row.started_at, 0),
    completedAt: row.completed_at !== null && row.completed_at !== undefined ? intValue(row.completed_at, null) : null,
    performanceScore: intValue(row.performance_score, 0),
    basePay: intValue(row.base_pay, 0),
    tipPercent: intValue(row.tip_percent, 0),
    tipAmount: intValue(row.tip_amount, 0),
    totalPayout: intValue(row.total_payout, 0),
    resultState: row.result_state || 'PENDING',
    metadata: row.metadata_json ? row.metadata_json : {}
  };
}

async function ensureJobProfileRow(guildId, userId, jobId) {
  await q('INSERT INTO job_profiles (guild_id, user_id, job_id) VALUES ($1,$2,$3) ON CONFLICT (guild_id, user_id, job_id) DO NOTHING', [guildId, userId, jobId]);
}

export async function ensureJobProfile(guildId, userId, jobId) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  const jid = String(jobId || '').trim();
  if (!uid) throw new Error('JOB_PROFILE_USER_REQUIRED');
  if (!jid) throw new Error('JOB_PROFILE_JOB_REQUIRED');
  await ensureJobProfileRow(gid, uid, jid);
  const row = await q1('SELECT guild_id, user_id, job_id, rank, total_xp, xp_to_next, last_shift_at, created_at, updated_at FROM job_profiles WHERE guild_id = $1 AND user_id = $2 AND job_id = $3', [gid, uid, jid]);
  return normalizeJobProfileRow(gid, uid, jid, row || {});
}

export async function getJobProfile(guildId, userId, jobId) {
  return ensureJobProfile(guildId, userId, jobId);
}

export async function listJobProfilesForUser(guildId, userId) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('JOB_PROFILE_USER_REQUIRED');
  const rows = await q('SELECT guild_id, user_id, job_id, rank, total_xp, xp_to_next, last_shift_at, created_at, updated_at FROM job_profiles WHERE guild_id = $1 AND user_id = $2 ORDER BY job_id ASC', [gid, uid]);
  return rows.map(row => normalizeJobProfileRow(gid, uid, row.job_id, row));
}

export async function updateJobProfile(guildId, userId, jobId, patch = {}) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  const jid = String(jobId || '').trim();
  if (!uid) throw new Error('JOB_PROFILE_USER_REQUIRED');
  if (!jid) throw new Error('JOB_PROFILE_JOB_REQUIRED');
  await ensureJobProfileRow(gid, uid, jid);
  const current = await q1('SELECT rank, total_xp, xp_to_next, last_shift_at FROM job_profiles WHERE guild_id = $1 AND user_id = $2 AND job_id = $3', [gid, uid, jid]) || {};
  const nextRank = patch.rank !== undefined ? Math.max(1, intValue(patch.rank, current.rank || 1)) : Math.max(1, intValue(current.rank, 1));
  const nextTotal = patch.totalXp !== undefined ? Math.max(0, intValue(patch.totalXp, current.total_xp || 0)) : Math.max(0, intValue(current.total_xp, 0));
  const nextXpToNext = patch.xpToNext !== undefined ? Math.max(0, intValue(patch.xpToNext, current.xp_to_next || 0)) : Math.max(0, intValue(current.xp_to_next, 0));
  const nextLastShift = patch.lastShiftAt === undefined
    ? (current.last_shift_at !== undefined ? current.last_shift_at : null)
    : (patch.lastShiftAt === null ? null : intValue(patch.lastShiftAt, null));
  const updatedAt = patch.updatedAt !== undefined ? intValue(patch.updatedAt, secondsNow()) : secondsNow();
  await q(
    'UPDATE job_profiles SET rank = $1, total_xp = $2, xp_to_next = $3, last_shift_at = $4, updated_at = $5 WHERE guild_id = $6 AND user_id = $7 AND job_id = $8',
    [nextRank, nextTotal, nextXpToNext, nextLastShift, updatedAt, gid, uid, jid]
  );
  const row = await q1('SELECT guild_id, user_id, job_id, rank, total_xp, xp_to_next, last_shift_at, created_at, updated_at FROM job_profiles WHERE guild_id = $1 AND user_id = $2 AND job_id = $3', [gid, uid, jid]);
  return normalizeJobProfileRow(gid, uid, jid, row || {});
}

export async function createJobShift(guildId, userId, jobId, options = {}) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  const jid = String(jobId || '').trim();
  if (!uid) throw new Error('JOB_SHIFT_USER_REQUIRED');
  if (!jid) throw new Error('JOB_SHIFT_JOB_REQUIRED');
  await ensureJobProfileRow(gid, uid, jid);
  const id = options.shiftId ? String(options.shiftId) : crypto.randomUUID();
  const startedAt = options.startedAt !== undefined ? intValue(options.startedAt, secondsNow()) : secondsNow();
  const metadata = options.metadata !== undefined ? options.metadata : {};
  await q('INSERT INTO job_shifts (id, guild_id, user_id, job_id, started_at, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)', [id, gid, uid, jid, startedAt, metadata]);
  const row = await q1('SELECT id, guild_id, user_id, job_id, started_at, completed_at, performance_score, base_pay, tip_percent, tip_amount, total_payout, result_state, metadata_json FROM job_shifts WHERE id = $1', [id]);
  return normalizeJobShiftRow(row);
}

export async function completeJobShift(shiftId, updates = {}) {
  const id = String(shiftId || '').trim();
  if (!id) throw new Error('JOB_SHIFT_ID_REQUIRED');
  const existing = await q1('SELECT * FROM job_shifts WHERE id = $1', [id]);
  if (!existing) throw new Error('JOB_SHIFT_NOT_FOUND');
  const completedAt = updates.completedAt !== undefined ? intValue(updates.completedAt, secondsNow()) : secondsNow();
  const performance = updates.performanceScore !== undefined ? intValue(updates.performanceScore, existing.performance_score || 0) : intValue(existing.performance_score, 0);
  const basePay = updates.basePay !== undefined ? intValue(updates.basePay, existing.base_pay || 0) : intValue(existing.base_pay, 0);
  const tipPercent = updates.tipPercent !== undefined ? intValue(updates.tipPercent, existing.tip_percent || 0) : intValue(existing.tip_percent, 0);
  const tipAmount = updates.tipAmount !== undefined ? intValue(updates.tipAmount, existing.tip_amount || 0) : intValue(existing.tip_amount, 0);
  const totalPayoutRaw = updates.totalPayout !== undefined ? intValue(updates.totalPayout, existing.total_payout || 0) : (basePay + tipAmount);
  const totalPayout = intValue(totalPayoutRaw, basePay + tipAmount);
  const resultState = (updates.resultState || existing.result_state || 'PENDING').toUpperCase();
  const metadata = updates.metadata !== undefined ? updates.metadata : (existing.metadata_json || {});
  await q(
    'UPDATE job_shifts SET completed_at = $1, performance_score = $2, base_pay = $3, tip_percent = $4, tip_amount = $5, total_payout = $6, result_state = $7, metadata_json = $8 WHERE id = $9',
    [completedAt, performance, basePay, tipPercent, tipAmount, totalPayout, resultState, metadata, id]
  );
  const row = await q1('SELECT id, guild_id, user_id, job_id, started_at, completed_at, performance_score, base_pay, tip_percent, tip_amount, total_payout, result_state, metadata_json FROM job_shifts WHERE id = $1', [id]);
  return normalizeJobShiftRow(row);
}

export async function getJobShiftById(shiftId) {
  const id = String(shiftId || '').trim();
  if (!id) throw new Error('JOB_SHIFT_ID_REQUIRED');
  const row = await q1('SELECT id, guild_id, user_id, job_id, started_at, completed_at, performance_score, base_pay, tip_percent, tip_amount, total_payout, result_state, metadata_json FROM job_shifts WHERE id = $1', [id]);
  return normalizeJobShiftRow(row);
}

export async function listJobShiftsForUser(guildId, userId, limit = 20) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('JOB_SHIFT_USER_REQUIRED');
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const rows = await q('SELECT id, guild_id, user_id, job_id, started_at, completed_at, performance_score, base_pay, tip_percent, tip_amount, total_payout, result_state, metadata_json FROM job_shifts WHERE guild_id = $1 AND user_id = $2 ORDER BY started_at DESC LIMIT $3', [gid, uid, lim]);
  return rows.map(normalizeJobShiftRow);
}

function intValue(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
}

function nullableInt(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

const DEFAULT_SHIFT_STREAK_COUNT = 5;

async function ensureJobStatusRow(guildId, userId) {
  await q('INSERT INTO job_status (guild_id, user_id, shift_streak_count) VALUES ($1, $2, $3) ON CONFLICT (guild_id, user_id) DO NOTHING', [guildId, userId, DEFAULT_SHIFT_STREAK_COUNT]);
}

function normalizeJobStatusRow(guildId, userId, row = {}) {
  return {
    guild_id: guildId,
    user_id: userId,
    active_job: row?.active_job || 'none',
    job_switch_available_at: intValue(row?.job_switch_available_at, 0),
    cooldown_reason: row?.cooldown_reason || null,
    daily_earning_cap: nullableInt(row?.daily_earning_cap),
    earned_today: intValue(row?.earned_today, 0),
    cap_reset_at: nullableInt(row?.cap_reset_at),
    shift_streak_count: intValue(row?.shift_streak_count ?? DEFAULT_SHIFT_STREAK_COUNT, DEFAULT_SHIFT_STREAK_COUNT),
    shift_cooldown_expires_at: intValue(row?.shift_cooldown_expires_at, 0),
    updated_at: intValue(row?.updated_at, 0)
  };
}

export async function getJobStatus(guildId, userId) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('JOB_STATUS_USER_REQUIRED');
  await ensureJobStatusRow(gid, uid);
  const row = await q1(
    'SELECT active_job, job_switch_available_at, cooldown_reason, daily_earning_cap, earned_today, cap_reset_at, shift_streak_count, shift_cooldown_expires_at, updated_at FROM job_status WHERE guild_id = $1 AND user_id = $2',
    [gid, uid]
  );
  return normalizeJobStatusRow(gid, uid, row || {});
}

export async function setJobStatus(guildId, userId, patch = {}) {
  const gid = resolveGuildId(guildId);
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('JOB_STATUS_USER_REQUIRED');
  await ensureJobStatusRow(gid, uid);
  const current = await q1(
    'SELECT active_job, job_switch_available_at, cooldown_reason, daily_earning_cap, earned_today, cap_reset_at, shift_streak_count, shift_cooldown_expires_at FROM job_status WHERE guild_id = $1 AND user_id = $2',
    [gid, uid]
  ) || {};
  const now = Math.floor(Date.now() / 1000);
  const next = {
    active_job: patch.active_job ?? current.active_job ?? 'none',
    job_switch_available_at: intValue(patch.job_switch_available_at ?? current.job_switch_available_at, 0),
    cooldown_reason: patch.cooldown_reason === undefined ? (current.cooldown_reason ?? null) : patch.cooldown_reason,
    daily_earning_cap: patch.daily_earning_cap === undefined ? (current.daily_earning_cap ?? null) : patch.daily_earning_cap,
    earned_today: intValue(patch.earned_today ?? current.earned_today, 0),
    cap_reset_at: patch.cap_reset_at === undefined ? (current.cap_reset_at ?? null) : patch.cap_reset_at,
    shift_streak_count: intValue(patch.shift_streak_count ?? current.shift_streak_count ?? DEFAULT_SHIFT_STREAK_COUNT, DEFAULT_SHIFT_STREAK_COUNT),
    shift_cooldown_expires_at: intValue(patch.shift_cooldown_expires_at ?? current.shift_cooldown_expires_at, 0)
  };
  await q(
    `UPDATE job_status
     SET active_job = $1,
         job_switch_available_at = $2,
         cooldown_reason = $3,
         daily_earning_cap = $4,
         earned_today = $5,
         cap_reset_at = $6,
         shift_streak_count = $7,
         shift_cooldown_expires_at = $8,
         updated_at = $9
     WHERE guild_id = $10 AND user_id = $11`,
    [
      next.active_job,
      intValue(next.job_switch_available_at, 0),
      next.cooldown_reason ?? null,
      nullableInt(next.daily_earning_cap),
      intValue(next.earned_today, 0),
      nullableInt(next.cap_reset_at),
      intValue(next.shift_streak_count, 0),
      intValue(next.shift_cooldown_expires_at, 0),
      now,
      gid,
      uid
    ]
  );
  return getJobStatus(gid, uid);
}

// --- Hold’em helpers ---
async function guildForTable(tableId) {
  const row = await q1('SELECT guild_id FROM holdem_tables WHERE table_id = $1', [String(tableId)]);
  return resolveGuildId(row?.guild_id);
}

export async function ensureHoldemTable(params) {
  const { tableId, guildId, channelId, sb, bb, min, max, rakeBps, hostId } = params;
  await q(
    `INSERT INTO holdem_tables (table_id, guild_id, channel_id, sb, bb, min, max, rake_bps, host_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (table_id) DO UPDATE SET guild_id = EXCLUDED.guild_id, channel_id = EXCLUDED.channel_id,
       sb = EXCLUDED.sb, bb = EXCLUDED.bb, min = EXCLUDED.min, max = EXCLUDED.max, rake_bps = EXCLUDED.rake_bps, host_id = EXCLUDED.host_id`,
    [String(tableId), String(guildId), String(channelId), Number(sb) || 0, Number(bb) || 0, Number(min) || 0, Number(max) || 0, Number(rakeBps) || 0, hostId ? String(hostId) : null]
  );
  return { tableId: String(tableId) };
}

export async function reserveHoldemTableNumber(guildId) {
  const gid = resolveGuildId(guildId);
  const row = await q1(
    `WITH state AS (
       INSERT INTO holdem_table_number_state (guild_id, next_table_number)
       VALUES ($1, 2)
       ON CONFLICT (guild_id)
       DO UPDATE SET
         next_table_number = holdem_table_number_state.next_table_number + 1,
         updated_at = NOW()
       RETURNING next_table_number
     )
     SELECT GREATEST(1, next_table_number - 1)::BIGINT AS table_number
     FROM state`,
    [gid]
  );
  return Math.max(1, Number(row?.table_number || 1));
}

export async function createHoldemHand(tableId, handNo, board = '', winnersJson = '[]', rakePaid = 0) {
  const row = await q1(
    'INSERT INTO holdem_hands (table_id, hand_no, board, winners_json, rake_paid) VALUES ($1,$2,$3,$4,$5) RETURNING hand_id',
    [String(tableId), Number(handNo) || 0, String(board || ''), String(winnersJson || '[]'), Number(rakePaid) || 0]
  );
  return Number(row?.hand_id || 0);
}

export async function getEscrowBalance(tableId, userId) {
  const row = await q1('SELECT balance FROM holdem_escrow WHERE table_id = $1 AND user_id = $2', [String(tableId), String(userId)]);
  return Number(row?.balance || 0);
}

export async function escrowAdd(tableId, userId, amount) {
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('ESCROW_POSITIVE');
  const gid = await guildForTable(tableId);
  await tx(async c => {
    const row = await c.query('SELECT chips FROM users WHERE guild_id = $1 AND discord_id = $2', [gid, String(userId)]);
    const chips = Number(row?.rows?.[0]?.chips || 0);
    if (chips < amt) throw new Error('INSUFFICIENT_USER');
    await c.query('UPDATE users SET chips = chips - $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [amt, gid, String(userId)]);
    await c.query(
      'INSERT INTO holdem_escrow (table_id, user_id, balance) VALUES ($1,$2,$3) ON CONFLICT (table_id, user_id) DO UPDATE SET balance = holdem_escrow.balance + EXCLUDED.balance',
      [String(tableId), String(userId), amt]
    );
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)',
      [gid, String(userId), -amt, `holdem buy-in escrow ${tableId}`, 'CHIPS']
    );
    await c.query(
      'INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)',
      [gid, `ESCROW:${tableId}`, amt, `holdem buy-in from ${userId}`, 'CHIPS']
    );
  });
  return { escrow: await getEscrowBalance(tableId, userId), user: (await getUserBalances(gid, userId)).chips };
}

export async function escrowReturn(tableId, userId, amount) {
  const amt = Number(amount);
  if (amt <= 0) return 0;
  const gid = await guildForTable(tableId);
  await tx(async c => {
    const row = await c.query('SELECT balance FROM holdem_escrow WHERE table_id = $1 AND user_id = $2', [String(tableId), String(userId)]);
    const bal = Number(row?.rows?.[0]?.balance || 0);
    const toReturn = Math.min(bal, amt);
    if (toReturn <= 0) return;
    await c.query('UPDATE holdem_escrow SET balance = balance - $1 WHERE table_id = $2 AND user_id = $3', [toReturn, String(tableId), String(userId)]);
    await c.query('UPDATE users SET chips = chips + $1, updated_at = NOW() WHERE guild_id = $2 AND discord_id = $3', [toReturn, gid, String(userId)]);
    await c.query('INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)', [gid, `ESCROW:${tableId}`, -toReturn, `holdem refund to ${userId}`, 'CHIPS']);
    await c.query('INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)', [gid, String(userId), toReturn, `holdem refund from escrow ${tableId}`, 'CHIPS']);
  });
  return getEscrowBalance(tableId, userId);
}

export async function escrowCommit(tableId, userId, handId, street, amount) {
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) return getEscrowBalance(tableId, userId);
  const gid = await guildForTable(tableId);
  await tx(async c => {
    const row = await c.query('SELECT balance FROM holdem_escrow WHERE table_id = $1 AND user_id = $2', [String(tableId), String(userId)]);
    const bal = Number(row?.rows?.[0]?.balance || 0);
    if (bal < amt) throw new Error('ESCROW_INSUFFICIENT');
    await c.query('UPDATE holdem_escrow SET balance = balance - $1 WHERE table_id = $2 AND user_id = $3', [amt, String(tableId), String(userId)]);
    await c.query('INSERT INTO holdem_commits (hand_id, user_id, street, amount) VALUES ($1,$2,$3,$4)', [Number(handId) || 0, String(userId), String(street || 'UNK'), amt]);
    await c.query('INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)', [gid, `ESCROW:${tableId}`, -amt, `holdem commit ${street} from ${userId}`, 'CHIPS']);
    await c.query('INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)', [gid, `POT:${tableId}`, amt, `holdem commit ${street} from ${userId}`, 'CHIPS']);
  });
  return getEscrowBalance(tableId, userId);
}

export async function escrowCreditMany(tableId, payouts) {
  if (!Array.isArray(payouts) || !payouts.length) return true;
  const gid = await guildForTable(tableId);
  await tx(async c => {
    for (const { userId, amount } of payouts) {
      const amt = Math.max(0, Number(amount) || 0);
      if (amt <= 0) continue;
      await c.query('INSERT INTO holdem_escrow (table_id, user_id, balance) VALUES ($1,$2,$3) ON CONFLICT (table_id,user_id) DO UPDATE SET balance = holdem_escrow.balance + EXCLUDED.balance', [String(tableId), String(userId), amt]);
      await c.query('INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)', [gid, `POT:${tableId}`, -amt, `holdem payout to escrow for ${userId}`, 'CHIPS']);
      await c.query('INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)', [gid, `ESCROW:${tableId}`, amt, `holdem payout to ${userId}`, 'CHIPS']);
    }
  });
  return true;
}

export async function settleRake(tableId, amount) {
  const amt = Math.max(0, Number(amount) || 0);
  if (amt <= 0) return 0;
  const gid = await guildForTable(tableId);
  await tx(async c => {
    await c.query('INSERT INTO guild_house (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [gid]);
    await c.query('UPDATE guild_house SET chips = chips + $1, updated_at = NOW() WHERE guild_id = $2', [amt, gid]);
    await c.query('INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)', [gid, 'HOUSE', amt, `holdem rake ${tableId}`, 'CHIPS']);
    await c.query('INSERT INTO transactions (guild_id, account, delta, reason, currency) VALUES ($1,$2,$3,$4,$5)', [gid, `POT:${tableId}`, -amt, `holdem rake ${tableId}`, 'CHIPS']);
  });
  return getHouseBalance(gid);
}

export async function finalizeHoldemHand(handId, { board, winnersJson, rakePaid }) {
  await q('UPDATE holdem_hands SET board = $1, winners_json = $2, rake_paid = $3 WHERE hand_id = $4', [String(board || ''), String(winnersJson || '[]'), Number(rakePaid) || 0, Number(handId) || 0]);
}

export async function listEscrowForTable(tableId) {
  const rows = await q('SELECT user_id, balance FROM holdem_escrow WHERE table_id = $1 AND balance > 0', [String(tableId)]);
  return rows.map(r => ({ user_id: r.user_id, balance: Number(r.balance || 0) }));
}

// --- Request throttling ---
export async function getLastRequestAt(guildId, userId) {
  const row = await q1('SELECT last_ts FROM request_last WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return row ? Number(row.last_ts) : 0;
}
export async function setLastRequestNow(guildId, userId, ts = null) {
  const t = ts ? Number(ts) : Math.floor(Date.now() / 1000);
  await q('INSERT INTO request_last (guild_id, user_id, last_ts) VALUES ($1,$2,$3) ON CONFLICT (guild_id,user_id) DO UPDATE SET last_ts = EXCLUDED.last_ts', [guildId, userId, t]);
  return t;
}

// --- API keys ---
export async function lookupApiKey(token) {
  if (!token) return null;
  const row = await q1('SELECT id, token, guild_id, scopes FROM api_keys WHERE token = $1', [token]);
  if (!row) return null;
  const scopes = String(row.scopes || '').split(',').map(s => s.trim()).filter(Boolean);
  return { id: row.id, guildId: row.guild_id, scopes };
}

export async function createApiKey({ token, guildId, scopes }) {
  if (!guildId) throw new Error('GUILD_ID_REQUIRED');
  let newToken = token;
  if (!newToken) {
    const { randomBytes } = await import('node:crypto');
    newToken = randomBytes(24).toString('base64url');
  }
  const scopeStr = Array.isArray(scopes) ? scopes.join(',') : (scopes || '');
  try {
    await q('INSERT INTO api_keys (token, guild_id, scopes) VALUES ($1,$2,$3)', [newToken, guildId, scopeStr]);
  } catch (e) {
    if (String(e?.message || '').includes('duplicate')) throw new Error('TOKEN_EXISTS');
    throw e;
  }
  const row = await q1('SELECT id, token, guild_id, scopes FROM api_keys WHERE token = $1', [newToken]);
  const parsedScopes = String(row.scopes || '').split(',').map(s => s.trim()).filter(Boolean);
  return { id: row.id, token: row.token, guildId: row.guild_id, scopes: parsedScopes };
}

export async function deleteApiKey(token) {
  if (!token) throw new Error('TOKEN_REQUIRED');
  const res = await q('DELETE FROM api_keys WHERE token = $1 RETURNING 1', [token]);
  return { deleted: res.length };
}

export async function listApiKeys(guildId = null) {
  const rows = guildId
    ? await q('SELECT id, token, guild_id, scopes FROM api_keys WHERE guild_id = $1 ORDER BY id DESC', [guildId])
    : await q('SELECT id, token, guild_id, scopes FROM api_keys ORDER BY id DESC');
  return rows.map(r => ({ id: r.id, token: r.token, guildId: r.guild_id, scopes: String(r.scopes || '').split(',').map(s => s.trim()).filter(Boolean) }));
}

// --- Reset balances ---
export async function resetAllBalances(guildId) {
  const gid = resolveGuildId(guildId);
  return tx(async c => {
    const usersBefore = await c.query('SELECT COUNT(*) AS n FROM users WHERE guild_id = $1', [gid]);
    const before = Number(usersBefore.rows[0].n || 0);
    const updated = await c.query('UPDATE users SET chips = 0, credits = 100, updated_at = NOW() WHERE guild_id = $1', [gid]);
    await c.query('UPDATE guild_house SET chips = 0, updated_at = NOW() WHERE guild_id = $1', [gid]);
    return { guildId: gid, usersBefore: before, usersUpdated: updated.rowCount || 0, house: 0 };
  });
}

export async function setBotStatusSnapshot({ guildCount, playerCount }) {
  const guilds = Number.isFinite(Number(guildCount)) ? Number(guildCount) : 0;
  const players = Number.isFinite(Number(playerCount)) ? Number(playerCount) : 0;
  await q(
    `INSERT INTO bot_status_snapshots (id, guild_count, player_count, updated_at)
     VALUES ('global', $1, $2, NOW())
     ON CONFLICT (id)
     DO UPDATE SET guild_count = EXCLUDED.guild_count, player_count = EXCLUDED.player_count, updated_at = NOW()`,
    [guilds, players]
  );
  return { guildCount: guilds, playerCount: players };
}

export async function getBotStatusSnapshot() {
  const row = await q1('SELECT guild_count, player_count, updated_at FROM bot_status_snapshots WHERE id = $1', ['global']);
  if (!row) return null;
  return {
    guildCount: Number(row.guild_count || 0),
    playerCount: Number(row.player_count || 0),
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

export const __DB_DRIVER = 'pg';
