import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import 'dotenv/config';

const db = new Database(process.env.DB_PATH || './casino.db');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

const DEFAULT_GUILD_ID = process.env.PRIMARY_GUILD_ID || process.env.GUILD_ID || 'global';

// --- SCHEMA & MIGRATIONS ---
db.exec(`
-- Legacy: admin_roles has been renamed to mod_roles. Keep migration below.
CREATE TABLE IF NOT EXISTS mod_roles (
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, role_id)
);
CREATE TABLE IF NOT EXISTS users (
  guild_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  chips INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, discord_id)
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  guild_id TEXT NOT NULL,
  account TEXT NOT NULL,             -- 'HOUSE', 'BURN', a Discord user id
  delta INTEGER NOT NULL,
  reason TEXT,
  admin_id TEXT,
  currency TEXT NOT NULL DEFAULT 'CHIPS', -- 'CHIPS' or 'CREDITS'
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS guild_house (
  guild_id TEXT PRIMARY KEY,
  chips INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  log_channel_id TEXT,               -- used as GAME log channel
  cash_log_channel_id TEXT,          -- channel for non-game chip/credit transactions
  request_channel_id TEXT,           -- channel where buyin/cashout requests are posted
  request_cooldown_sec INTEGER NOT NULL DEFAULT 0,
  logging_enabled INTEGER NOT NULL DEFAULT 0,
  max_ridebus_bet INTEGER NOT NULL DEFAULT 1000,
  holdem_rake_bps INTEGER NOT NULL DEFAULT 0,      -- rake percent in basis points (e.g., 250 = 2.50%)
  holdem_rake_cap INTEGER NOT NULL DEFAULT 0,      -- optional rake cap in chips
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  guild_id TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '' -- comma-separated list of scopes
);
CREATE TABLE IF NOT EXISTS active_requests (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL, -- PENDING | TAKEN
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id)
);
-- Hold'em: metadata, hands, escrow, commits
CREATE TABLE IF NOT EXISTS holdem_tables (
  table_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  sb INTEGER NOT NULL,
  bb INTEGER NOT NULL,
  min INTEGER NOT NULL,
  max INTEGER NOT NULL,
  rake_bps INTEGER NOT NULL DEFAULT 0,
  host_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS holdem_hands (
  hand_id INTEGER PRIMARY KEY,
  table_id TEXT NOT NULL,
  hand_no INTEGER NOT NULL,
  board TEXT,
  winners_json TEXT,
  rake_paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS holdem_escrow (
  table_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (table_id, user_id)
);
CREATE TABLE IF NOT EXISTS holdem_commits (
  id INTEGER PRIMARY KEY,
  hand_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  street TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Migration: add credits column if missing
try { db.prepare(`SELECT credits FROM users LIMIT 1`).get(); } catch {
  db.exec(`ALTER TABLE users ADD COLUMN credits INTEGER NOT NULL DEFAULT 0`);
}
// Migration: add currency column if missing
try { db.prepare(`SELECT currency FROM transactions LIMIT 1`).get(); } catch {
  db.exec(`ALTER TABLE transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'CHIPS'`);
}
// Migration: add max_ridebus_bet to guild_settings if missing (for existing DBs)
try { db.prepare(`SELECT max_ridebus_bet FROM guild_settings LIMIT 1`).get(); } catch {
  db.exec(`ALTER TABLE guild_settings ADD COLUMN max_ridebus_bet INTEGER NOT NULL DEFAULT 1000`);
}
// Migration: add cash_log_channel_id to guild_settings if missing
try { db.prepare(`SELECT cash_log_channel_id FROM guild_settings LIMIT 1`).get(); } catch {
  db.exec(`ALTER TABLE guild_settings ADD COLUMN cash_log_channel_id TEXT`);
}
// Migration: add request_channel_id to guild_settings if missing
try { db.prepare(`SELECT request_channel_id FROM guild_settings LIMIT 1`).get(); } catch {
  db.exec(`ALTER TABLE guild_settings ADD COLUMN request_channel_id TEXT`);
}
// Migration: add request_cooldown_sec to guild_settings if missing
try { db.prepare(`SELECT request_cooldown_sec FROM guild_settings LIMIT 1`).get(); } catch {
  db.exec(`ALTER TABLE guild_settings ADD COLUMN request_cooldown_sec INTEGER NOT NULL DEFAULT 0`);
}
// Migration: add casino_category_id to guild_settings if missing
try { db.prepare(`SELECT casino_category_id FROM guild_settings LIMIT 1`).get(); } catch {
  db.exec(`ALTER TABLE guild_settings ADD COLUMN casino_category_id TEXT`);
}
// Migration: add holdem_rake_bps to guild_settings if missing
try { db.prepare(`SELECT holdem_rake_bps FROM guild_settings LIMIT 1`).get(); } catch {
  db.exec(`ALTER TABLE guild_settings ADD COLUMN holdem_rake_bps INTEGER NOT NULL DEFAULT 0`);
}
// Migration: add holdem_rake_cap to guild_settings if missing
try { db.prepare(`SELECT holdem_rake_cap FROM guild_settings LIMIT 1`).get(); } catch {
  db.exec(`ALTER TABLE guild_settings ADD COLUMN holdem_rake_cap INTEGER NOT NULL DEFAULT 0`);
}


function migrateUsersToGuildScoped() {
  const info = db.prepare("PRAGMA table_info(users)").all();
  if (!info.length) return;
  const hasGuildId = info.some(r => r.name === 'guild_id');
  const hasLegacyId = info.some(r => r.name === 'id');
  const pkOrder = info.filter(r => r.pk > 0).map(r => r.name).sort().join(',');
  const hasCompositePk = pkOrder === 'discord_id,guild_id';
  if (hasGuildId && !hasLegacyId && hasCompositePk) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS users_tmp (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      chips INTEGER NOT NULL DEFAULT 0,
      credits INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, discord_id)
    );
  `);
  const insertLegacy = db.prepare(`
    INSERT INTO users_tmp (guild_id, discord_id, chips, credits, created_at, updated_at)
    SELECT @guild, discord_id, chips, credits, created_at, updated_at FROM users
  `);
  const migrate = db.transaction(() => {
    insertLegacy.run({ guild: DEFAULT_GUILD_ID });
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_tmp RENAME TO users');
  });
  migrate();
}

function migrateTransactionsToGuildScoped() {
  try { db.prepare('SELECT guild_id FROM transactions LIMIT 1').get(); return; } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions_tmp (
      id INTEGER PRIMARY KEY,
      guild_id TEXT NOT NULL,
      account TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT,
      admin_id TEXT,
      currency TEXT NOT NULL DEFAULT 'CHIPS',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const insertLegacy = db.prepare(`
    INSERT INTO transactions_tmp (id, guild_id, account, delta, reason, admin_id, currency, created_at)
    SELECT id, @guild, account, delta, reason, admin_id, currency, created_at FROM transactions
  `);
  const migrate = db.transaction(() => {
    insertLegacy.run({ guild: DEFAULT_GUILD_ID });
    db.exec('DROP TABLE transactions');
    db.exec('ALTER TABLE transactions_tmp RENAME TO transactions');
  });
  migrate();
}

function seedGuildHouseFromLegacy() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM guild_house').get()?.n || 0;
  if (existing > 0) return;
  let legacy = 0;
  try {
    const row = db.prepare('SELECT chips FROM house WHERE id = 1').get();
    if (row && Number.isFinite(row.chips)) legacy = row.chips;
  } catch {}
  db.prepare('INSERT OR IGNORE INTO guild_house (guild_id, chips) VALUES (?, ?)').run(DEFAULT_GUILD_ID, legacy);
}

migrateUsersToGuildScoped();
migrateTransactionsToGuildScoped();
seedGuildHouseFromLegacy();
db.prepare('INSERT OR IGNORE INTO guild_house (guild_id, chips) VALUES (?, 0)').run(DEFAULT_GUILD_ID);
db.exec('CREATE INDEX IF NOT EXISTS idx_users_guild_discord ON users (guild_id, discord_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_guild_created ON transactions (guild_id, created_at)');


// --- PREPARED STATEMENTS ---
// --- MIGRATION: move admin_roles -> mod_roles (idempotent) ---
try {
  const hasOld = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_roles'").get();
  if (hasOld) {
    db.exec('INSERT OR IGNORE INTO mod_roles (guild_id, role_id) SELECT guild_id, role_id FROM admin_roles');
    db.exec('DROP TABLE IF EXISTS admin_roles');
  }
} catch {}

const getModRolesStmt = db.prepare('SELECT role_id FROM mod_roles WHERE guild_id = ?');
const insertModRoleStmt = db.prepare('INSERT OR IGNORE INTO mod_roles (guild_id, role_id) VALUES (?, ?)');
const removeModRoleStmt = db.prepare('DELETE FROM mod_roles WHERE guild_id = ? AND role_id = ?');

const ensureUserStmt = db.prepare('INSERT OR IGNORE INTO users (guild_id, discord_id) VALUES (?, ?)');
const getUserStmt = db.prepare('SELECT chips, credits FROM users WHERE guild_id = ? AND discord_id = ?');
const addChipsStmt = db.prepare('UPDATE users SET chips = chips + ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND discord_id = ?');
const addCreditsStmt = db.prepare('UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND discord_id = ?');

const ensureHouseStmt = db.prepare('INSERT OR IGNORE INTO guild_house (guild_id) VALUES (?)');
const getHouseStmt = db.prepare('SELECT chips FROM guild_house WHERE guild_id = ?');
const updateHouseStmt = db.prepare('UPDATE guild_house SET chips = chips + ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?');
const sumUserChipsStmt = db.prepare('SELECT COALESCE(SUM(chips), 0) AS total FROM users WHERE guild_id = ?');

const insertTxnStmt = db.prepare('INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES (?, ?, ?, ?, ?, ?)');

const topUsersStmt = db.prepare(`
  SELECT discord_id, chips
  FROM users
  WHERE guild_id = ? AND chips > 0
  ORDER BY chips DESC, created_at ASC
  LIMIT ?
`);

const countUsersStmt = db.prepare('SELECT COUNT(*) AS n FROM users WHERE guild_id = ?');
const resetUsersStmt = db.prepare('UPDATE users SET chips = 0, credits = 100, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?');
const resetHouseExactStmt = db.prepare('UPDATE guild_house SET chips = 0, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?');

function resolveGuildId(guildId) {
  return guildId || DEFAULT_GUILD_ID;
}

function ensureGuildUser(guildId, userId) {
  ensureUserStmt.run(guildId, userId);
}

function ensureGuildHouse(guildId) {
  ensureHouseStmt.run(guildId);
}

function houseRow(guildId) {
  ensureGuildHouse(guildId);
  return getHouseStmt.get(guildId) || { chips: 0 };
}

const getGuildSettingsStmt = db.prepare('SELECT log_channel_id, cash_log_channel_id, request_channel_id, request_cooldown_sec, logging_enabled, max_ridebus_bet, casino_category_id, holdem_rake_bps, holdem_rake_cap FROM guild_settings WHERE guild_id = ?');
const ensureGuildSettingsStmt = db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)');
const upsertGuildSettingsStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, log_channel_id, cash_log_channel_id, request_channel_id, request_cooldown_sec, logging_enabled, max_ridebus_bet, casino_category_id, holdem_rake_bps, holdem_rake_cap, updated_at)
  VALUES (
    @guild_id,
    @log_channel_id,
    @cash_log_channel_id,
    @request_channel_id,
    COALESCE(@request_cooldown_sec, 0),
    COALESCE(@logging_enabled, 0),
    COALESCE(@max_ridebus_bet, 1000),
    @casino_category_id,
    COALESCE(@holdem_rake_bps, 0),
    COALESCE(@holdem_rake_cap, 0),
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(guild_id) DO UPDATE SET
    log_channel_id = COALESCE(excluded.log_channel_id, guild_settings.log_channel_id),
    cash_log_channel_id = COALESCE(excluded.cash_log_channel_id, guild_settings.cash_log_channel_id),
    request_channel_id = COALESCE(excluded.request_channel_id, guild_settings.request_channel_id),
    request_cooldown_sec = COALESCE(excluded.request_cooldown_sec, guild_settings.request_cooldown_sec),
    logging_enabled = COALESCE(excluded.logging_enabled, guild_settings.logging_enabled),
    max_ridebus_bet = COALESCE(excluded.max_ridebus_bet, guild_settings.max_ridebus_bet),
    casino_category_id = COALESCE(excluded.casino_category_id, guild_settings.casino_category_id),
    holdem_rake_bps = COALESCE(excluded.holdem_rake_bps, guild_settings.holdem_rake_bps),
    holdem_rake_cap = COALESCE(excluded.holdem_rake_cap, guild_settings.holdem_rake_cap),
    updated_at = CURRENT_TIMESTAMP
`);

// API keys
const getApiKeyStmt = db.prepare('SELECT id, guild_id, scopes FROM api_keys WHERE token = ?');
const insertApiKeyStmt = db.prepare('INSERT INTO api_keys (token, guild_id, scopes) VALUES (?, ?, ?)');
const deleteApiKeyStmt = db.prepare('DELETE FROM api_keys WHERE token = ?');
const listApiKeysStmt = db.prepare('SELECT id, token, guild_id, scopes FROM api_keys ORDER BY id DESC');

// Active requests
const getActiveReqStmt = db.prepare('SELECT guild_id, user_id, message_id, type, amount, status FROM active_requests WHERE guild_id = ? AND user_id = ?');
const insertActiveReqStmt = db.prepare(`
  INSERT INTO active_requests (guild_id, user_id, message_id, type, amount, status)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const updateActiveReqStatusStmt = db.prepare(`
  UPDATE active_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ?
`);
const clearActiveReqStmt = db.prepare('DELETE FROM active_requests WHERE guild_id = ? AND user_id = ?');

export function getModRoles(guildId) {
  return getModRolesStmt.all(guildId).map(r => r.role_id);
}

export function addModRole(guildId, roleId) {
  insertModRoleStmt.run(guildId, roleId);
  return getModRoles(guildId);
}

export function removeModRole(guildId, roleId) {
  removeModRoleStmt.run(guildId, roleId);
  return getModRoles(guildId);
}

export function getGuildSettings(guildId) {
  return getGuildSettingsStmt.get(guildId) || { log_channel_id: null, cash_log_channel_id: null, request_channel_id: null, request_cooldown_sec: 0, logging_enabled: 0, max_ridebus_bet: 1000, casino_category_id: null, holdem_rake_bps: 0, holdem_rake_cap: 0 };
}

export function setGameLogChannel(guildId, channelId) {
  // Always resolve to 0/1 (never null)
  const current = getGuildSettings(guildId); // returns { log_channel_id, logging_enabled, max_ridebus_bet } or default
  const enabled = (current && typeof current.logging_enabled === 'number')
    ? (current.logging_enabled ? 1 : 0)
    : 0;

  // Ensure a row exists to preserve NOT NULL defaults
  ensureGuildSettingsStmt.run(guildId);
  upsertGuildSettingsStmt.run({
    guild_id: guildId,
    log_channel_id: channelId,
    cash_log_channel_id: null,
    request_channel_id: null,
    request_cooldown_sec: null,
    logging_enabled: enabled,
    max_ridebus_bet: null
  });
  return getGuildSettings(guildId);
}

export function setLoggingEnabled(guildId, enabled) {
  // Ensure a row exists to avoid NOT NULL insert issues
  ensureGuildSettingsStmt.run(guildId);
  upsertGuildSettingsStmt.run({ guild_id: guildId, log_channel_id: null, cash_log_channel_id: null, request_channel_id: null, request_cooldown_sec: null, logging_enabled: enabled ? 1 : 0, max_ridebus_bet: null });
  return getGuildSettings(guildId);
}

export function setMaxRidebusBet(guildId, amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('MAXBET_POSITIVE_INT');
  // Ensure a row exists; then update only the max bet
  ensureGuildSettingsStmt.run(guildId);
  upsertGuildSettingsStmt.run({ guild_id: guildId, log_channel_id: null, cash_log_channel_id: null, request_channel_id: null, request_cooldown_sec: null, logging_enabled: null, max_ridebus_bet: amount });
  return getGuildSettings(guildId);
}

export function setDefaultHoldemRake(guildId, rakeBps, rakeCap = 0) {
  const bps = Math.max(0, Number(rakeBps) || 0);
  const cap = Math.max(0, Number(rakeCap) || 0);
  ensureGuildSettingsStmt.run(guildId);
  upsertGuildSettingsStmt.run({
    guild_id: guildId,
    log_channel_id: null,
    cash_log_channel_id: null,
    request_channel_id: null,
    request_cooldown_sec: null,
    logging_enabled: null,
    max_ridebus_bet: null,
    casino_category_id: null,
    holdem_rake_bps: bps,
    holdem_rake_cap: cap
  });
  return getGuildSettings(guildId);
}

export function setCashLogChannel(guildId, channelId) {
  const current = getGuildSettings(guildId);
  const enabled = (current && typeof current.logging_enabled === 'number') ? (current.logging_enabled ? 1 : 0) : 0;
  ensureGuildSettingsStmt.run(guildId);
  upsertGuildSettingsStmt.run({
    guild_id: guildId,
    log_channel_id: null,
    cash_log_channel_id: channelId,
    request_channel_id: null,
    request_cooldown_sec: null,
    logging_enabled: enabled,
    max_ridebus_bet: null
  });
  return getGuildSettings(guildId);
}

export function setRequestChannel(guildId, channelId) {
  const current = getGuildSettings(guildId);
  const enabled = (current && typeof current.logging_enabled === 'number') ? (current.logging_enabled ? 1 : 0) : 0;
  ensureGuildSettingsStmt.run(guildId);
  upsertGuildSettingsStmt.run({
    guild_id: guildId,
    log_channel_id: null,
    cash_log_channel_id: null,
    request_channel_id: channelId,
    request_cooldown_sec: null,
    logging_enabled: enabled,
    max_ridebus_bet: null
  });
  return getGuildSettings(guildId);
}

export function setRequestTimer(guildId, seconds) {
  const secs = Math.max(0, Number(seconds) || 0);
  ensureGuildSettingsStmt.run(guildId);
  upsertGuildSettingsStmt.run({ guild_id: guildId, log_channel_id: null, cash_log_channel_id: null, request_channel_id: null, request_cooldown_sec: secs, logging_enabled: null, max_ridebus_bet: null });
  return getGuildSettings(guildId);
}

export function setCasinoCategory(guildId, categoryId) {
  ensureGuildSettingsStmt.run(guildId);
  upsertGuildSettingsStmt.run({
    guild_id: guildId,
    log_channel_id: null,
    cash_log_channel_id: null,
    request_channel_id: null,
    request_cooldown_sec: null,
    logging_enabled: null,
    max_ridebus_bet: null,
    casino_category_id: categoryId
  });
  return getGuildSettings(guildId);
}

// Track last /request time per guild+user (epoch seconds)
db.exec(`
CREATE TABLE IF NOT EXISTS request_last (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_ts INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
`);
const getLastReqStmt = db.prepare('SELECT last_ts FROM request_last WHERE guild_id = ? AND user_id = ?');
const upsertLastReqStmt = db.prepare(`
  INSERT INTO request_last (guild_id, user_id, last_ts) VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET last_ts = excluded.last_ts
`);
export function getLastRequestAt(guildId, userId) {
  const row = getLastReqStmt.get(guildId, userId);
  return row ? Number(row.last_ts) : 0;
}
export function setLastRequestNow(guildId, userId, ts = null) {
  const t = ts ? Number(ts) : Math.floor(Date.now() / 1000);
  upsertLastReqStmt.run(guildId, userId, t);
  return t;
}


// Lookup an API key by bearer token; returns { id, guildId, scopes }
export function lookupApiKey(token) {
  if (!token) return null;
  const row = getApiKeyStmt.get(token);
  if (!row) return null;
  const scopes = String(row.scopes || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return { id: row.id, guildId: row.guild_id, scopes };
}

export function createApiKey({ token, guildId, scopes }) {
  if (!guildId) throw new Error('GUILD_ID_REQUIRED');
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
  }
  const scopeStr = Array.isArray(scopes) ? scopes.join(',') : (scopes || '');
  try {
    insertApiKeyStmt.run(token, guildId, scopeStr);
  } catch (e) {
    if (String(e?.message || '').includes('UNIQUE')) throw new Error('TOKEN_EXISTS');
    throw e;
  }
  const row = db.prepare('SELECT id, token, guild_id, scopes FROM api_keys WHERE token = ?').get(token);
  return { id: row.id, token: row.token, guildId: row.guild_id, scopes: String(row.scopes || '').split(',').map(s => s.trim()).filter(Boolean) };
}

export function deleteApiKey(token) {
  if (!token) throw new Error('TOKEN_REQUIRED');
  const info = deleteApiKeyStmt.run(token);
  return { deleted: info.changes };
}

export function listApiKeys(guildId = null) {
  const rows = guildId
    ? db.prepare('SELECT id, token, guild_id, scopes FROM api_keys WHERE guild_id = ? ORDER BY id DESC').all(guildId)
    : listApiKeysStmt.all();
  return rows.map(r => ({ id: r.id, token: r.token, guildId: r.guild_id, scopes: String(r.scopes || '').split(',').map(s => s.trim()).filter(Boolean) }));
}

// ===== Hold'em helpers =====
const ensureTableStmt = db.prepare(`
  INSERT INTO holdem_tables (table_id, guild_id, channel_id, sb, bb, min, max, rake_bps, host_id)
  VALUES (@table_id, @guild_id, @channel_id, @sb, @bb, @min, @max, @rake_bps, @host_id)
  ON CONFLICT(table_id) DO UPDATE SET
    guild_id=excluded.guild_id,
    channel_id=excluded.channel_id,
    sb=excluded.sb,
    bb=excluded.bb,
    min=excluded.min,
    max=excluded.max,
    rake_bps=excluded.rake_bps,
    host_id=excluded.host_id
`);
const insertHandStmt = db.prepare('INSERT INTO holdem_hands (table_id, hand_no, board, winners_json, rake_paid) VALUES (?, ?, ?, ?, ?)');
const upsertEscrowStmt = db.prepare(`
  INSERT INTO holdem_escrow (table_id, user_id, balance) VALUES (?, ?, ?)
  ON CONFLICT(table_id, user_id) DO UPDATE SET balance = holdem_escrow.balance + excluded.balance
`);
const getEscrowStmt = db.prepare('SELECT balance FROM holdem_escrow WHERE table_id = ? AND user_id = ?');
const setEscrowExactStmt = db.prepare('UPDATE holdem_escrow SET balance = ? WHERE table_id = ? AND user_id = ?');
const insertCommitStmt = db.prepare('INSERT INTO holdem_commits (hand_id, user_id, street, amount) VALUES (?, ?, ?, ?)');
const listEscrowByTableStmt = db.prepare('SELECT user_id, balance FROM holdem_escrow WHERE table_id = ? AND balance > 0');
const getTableGuildStmt = db.prepare('SELECT guild_id FROM holdem_tables WHERE table_id = ?');

function guildForTable(tableId) {
  const row = getTableGuildStmt.get(String(tableId));
  return row?.guild_id || DEFAULT_GUILD_ID;
}

export function ensureHoldemTable({ tableId, guildId, channelId, sb, bb, min, max, rakeBps, hostId }) {
  ensureTableStmt.run({ table_id: String(tableId), guild_id: String(guildId), channel_id: String(channelId), sb: Number(sb)||0, bb: Number(bb)||0, min: Number(min)||0, max: Number(max)||0, rake_bps: Number(rakeBps)||0, host_id: hostId ? String(hostId) : null });
  return { tableId: String(tableId) };
}

export function createHoldemHand(tableId, handNo, board = '', winnersJson = '[]', rakePaid = 0) {
  const info = insertHandStmt.run(String(tableId), Number(handNo)||0, String(board||''), String(winnersJson||'[]'), Number(rakePaid)||0);
  return info.lastInsertRowid;
}

export function getEscrowBalance(tableId, userId) {
  const row = getEscrowStmt.get(String(tableId), String(userId));
  return row ? Number(row.balance) : 0;
}

export function escrowAdd(tableId, userId, amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('ESCROW_POSITIVE');
  const tx = db.transaction(() => {
    ensureUserStmt.run(userId);
    const row = getUserStmt.get(userId);
    if ((row?.chips || 0) < amount) throw new Error('INSUFFICIENT_USER');
    // user -> escrow
    addChipsStmt.run(-amount, userId);
    upsertEscrowStmt.run(String(tableId), String(userId), amount);
    insertTxnStmt.run(String(userId), -amount, `holdem buy-in escrow ${tableId}`, null, 'CHIPS');
    insertTxnStmt.run(`ESCROW:${tableId}`, amount, `holdem buy-in from ${userId}`, null, 'CHIPS');
  });
  tx();
  return { escrow: getEscrowBalance(tableId, userId), user: getUserBalances(userId).chips };
}

export function escrowReturn(tableId, userId, amount) {
  if (!Number.isInteger(amount) || amount <= 0) return 0;
  const tx = db.transaction(() => {
    const bal = getEscrowBalance(tableId, userId);
    const toReturn = Math.min(bal, amount);
    const newBal = bal - toReturn;
    setEscrowExactStmt.run(newBal, String(tableId), String(userId));
    addChipsStmt.run(toReturn, String(userId));
    insertTxnStmt.run(`ESCROW:${tableId}`, -toReturn, `holdem refund to ${userId}`, null, 'CHIPS');
    insertTxnStmt.run(String(userId), toReturn, `holdem refund from escrow ${tableId}`, null, 'CHIPS');
  });
  tx();
  return getEscrowBalance(tableId, userId);
}

export function escrowCommit(tableId, userId, handId, street, amount) {
  if (!Number.isInteger(amount) || amount <= 0) return getEscrowBalance(tableId, userId);
  const tx = db.transaction(() => {
    const bal = getEscrowBalance(tableId, userId);
    if (bal < amount) throw new Error('ESCROW_INSUFFICIENT');
    setEscrowExactStmt.run(bal - amount, String(tableId), String(userId));
    insertCommitStmt.run(Number(handId)||0, String(userId), String(street||'UNK'), amount);
    insertTxnStmt.run(`ESCROW:${tableId}`, -amount, `holdem commit ${street} from ${userId}`, null, 'CHIPS');
    insertTxnStmt.run(`POT:${tableId}`, amount, `holdem commit ${street} from ${userId}`, null, 'CHIPS');
  });
  tx();
  return getEscrowBalance(tableId, userId);
}

export function escrowPayoutMany(tableId, payouts) {
  if (!Array.isArray(payouts) || !payouts.length) return true;
  const tx = db.transaction(() => {
    for (const p of payouts) {
      const userId = String(p.userId);
      const amt = Math.max(0, Number(p.amount) || 0);
      if (amt <= 0) continue;
      // Credit back to table escrow (chips remain at the table, not wallet)
      upsertEscrowStmt.run(String(tableId), userId, amt);
      insertTxnStmt.run(`POT:${tableId}`, -amt, `holdem payout to escrow for ${userId}`, null, 'CHIPS');
      insertTxnStmt.run(`ESCROW:${tableId}`, amt, `holdem payout to ${userId}`, null, 'CHIPS');
    }
  });
  tx();
  return true;
}

// Alias for clarity in Hold'em engine
export const escrowCreditMany = escrowPayoutMany;

export function settleRake(tableId, amount) {
  const amt = Math.max(0, Number(amount) || 0);
  if (amt <= 0) return 0;
  const tx = db.transaction(() => {
    updateHouseStmt.run(amt);
    insertTxnStmt.run('HOUSE', amt, `holdem rake ${tableId}`, null, 'CHIPS');
    insertTxnStmt.run(`POT:${tableId}`, -amt, `holdem rake ${tableId}`, null, 'CHIPS');
  });
  tx();
  return getHouseStmt.get().chips;
}

export function finalizeHoldemHand(handId, { board, winnersJson, rakePaid }) {
  db.prepare('UPDATE holdem_hands SET board = ?, winners_json = ?, rake_paid = ? WHERE hand_id = ?')
    .run(String(board||''), String(winnersJson||'[]'), Number(rakePaid)||0, Number(handId)||0);
}

export function listEscrowForTable(tableId) {
  return listEscrowByTableStmt.all(String(tableId));
}

// ----- Active request helpers -----
export function getActiveRequest(guildId, userId) {
  return getActiveReqStmt.get(guildId, userId) || null;
}
export function createActiveRequest(guildId, userId, messageId, type, amount) {
  if (!guildId || !userId || !messageId) throw new Error('ACTIVE_REQ_PARAMS');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('ACTIVE_REQ_AMOUNT');
  // Ensure none exists already; caller should check, but double-guard
  const existing = getActiveRequest(guildId, userId);
  if (existing) throw new Error('ACTIVE_REQ_EXISTS');
  insertActiveReqStmt.run(guildId, userId, messageId, String(type || 'unknown'), amount, 'PENDING');
  return getActiveRequest(guildId, userId);
}
export function updateActiveRequestStatus(guildId, userId, status) {
  updateActiveReqStatusStmt.run(String(status || 'PENDING'), guildId, userId);
  return getActiveRequest(guildId, userId);
}
export function clearActiveRequest(guildId, userId) {
  clearActiveReqStmt.run(guildId, userId);
  return true;
}

export function resetAllBalances(guildId) {
  const gid = resolveGuildId(guildId);
  const run = db.transaction(() => {
    const usersBefore = countUsersStmt.get(gid)?.n || 0;
    const usersUpdated = resetUsersStmt.run(gid).changes;
    ensureGuildHouse(gid);
    resetHouseExactStmt.run(gid);
    return { guildId: gid, usersBefore, usersUpdated, house: houseRow(gid).chips };
  });
  return run();
}

export function getHouseBalance(guildId) {
  return houseRow(resolveGuildId(guildId)).chips;
}

export function getCasinoNetworth(guildId) {
  const gid = resolveGuildId(guildId);
  const house = houseRow(gid).chips;
  const row = sumUserChipsStmt.get(gid);
  const users = row ? Number(row.total || 0) : 0;
  return house + users;
}

export function getUserBalances(guildId, discordId) {
  const gid = resolveGuildId(guildId);
  ensureGuildUser(gid, discordId);
  const row = getUserStmt.get(gid, discordId) || { chips: 0, credits: 0 };
  return { chips: Number(row.chips || 0), credits: Number(row.credits || 0) };
}

export function getTopUsers(guildId, limit = 10) {
  const gid = resolveGuildId(guildId);
  const n = Math.max(1, Math.min(25, Number(limit) || 10));
  return topUsersStmt.all(gid, n);
}

function recordTxn(guildId, account, delta, reason, adminId, currency) {
  insertTxnStmt.run(guildId, account, delta, reason || null, adminId || null, currency);
}

export function addToHouse(guildId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');
  const run = db.transaction((amt) => {
    ensureGuildHouse(gid);
    updateHouseStmt.run(amt, gid);
    recordTxn(gid, 'HOUSE', amt, reason || 'house top-up', adminId, 'CHIPS');
  });
  run(amount);
  return getHouseBalance(gid);
}

export function transferFromHouseToUser(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');
  const run = db.transaction(() => {
    ensureGuildHouse(gid);
    const house = houseRow(gid);
    if (house.chips < amount) throw new Error('INSUFFICIENT_HOUSE');
    ensureGuildUser(gid, discordId);
    updateHouseStmt.run(-amount, gid);
    addChipsStmt.run(amount, gid, discordId);
    recordTxn(gid, discordId, amount, reason || 'admin grant', adminId, 'CHIPS');
    recordTxn(gid, 'HOUSE', -amount, `grant to ${discordId}${reason ? ': ' + reason : ''}`, adminId, 'CHIPS');
  });
  run();
  return { ...getUserBalances(gid, discordId), house: getHouseBalance(gid) };
}

export function removeFromHouse(guildId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');
  const run = db.transaction((amt) => {
    ensureGuildHouse(gid);
    const house = houseRow(gid);
    if (house.chips < amt) throw new Error('INSUFFICIENT_HOUSE');
    updateHouseStmt.run(-amt, gid);
    recordTxn(gid, 'HOUSE', -amt, reason || 'house remove', adminId, 'CHIPS');
  });
  run(amount);
  return getHouseBalance(gid);
}

export function burnFromUser(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');
  const run = db.transaction(() => {
    ensureGuildUser(gid, discordId);
    const row = getUserStmt.get(gid, discordId);
    if ((row?.chips || 0) < amount) throw new Error('INSUFFICIENT_USER');
    addChipsStmt.run(-amount, gid, discordId);
    recordTxn(gid, discordId, -amount, reason || 'admin burn chips', adminId, 'CHIPS');
    recordTxn(gid, 'BURN', amount, `burn chips from ${discordId}${reason ? ': ' + reason : ''}`, adminId, 'CHIPS');
  });
  run();
  return getUserBalances(gid, discordId);
}

export function mintChips(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');
  const run = db.transaction(() => {
    ensureGuildUser(gid, discordId);
    addChipsStmt.run(amount, gid, discordId);
    recordTxn(gid, discordId, amount, reason || 'admin mint chips', adminId, 'CHIPS');
  });
  run();
  return getUserBalances(gid, discordId);
}

export function takeFromUserToHouse(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');
  const run = db.transaction(() => {
    ensureGuildHouse(gid);
    ensureGuildUser(gid, discordId);
    const row = getUserStmt.get(gid, discordId);
    if ((row?.chips || 0) < amount) throw new Error('INSUFFICIENT_USER');
    addChipsStmt.run(-amount, gid, discordId);
    updateHouseStmt.run(amount, gid);
    recordTxn(gid, discordId, -amount, reason || 'game stake', adminId, 'CHIPS');
    recordTxn(gid, 'HOUSE', amount, `stake from ${discordId}${reason ? ': ' + reason : ''}`, adminId, 'CHIPS');
  });
  run();
  return { ...getUserBalances(gid, discordId), house: getHouseBalance(gid) };
}

export function grantCredits(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');
  const run = db.transaction(() => {
    ensureGuildUser(gid, discordId);
    addCreditsStmt.run(amount, gid, discordId);
    recordTxn(gid, discordId, amount, reason || 'admin grant credits', adminId, 'CREDITS');
  });
  run();
  return getUserBalances(gid, discordId);
}

export function burnCredits(guildId, discordId, amount, reason, adminId) {
  const gid = resolveGuildId(guildId);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');
  const run = db.transaction(() => {
    ensureGuildUser(gid, discordId);
    const row = getUserStmt.get(gid, discordId);
    if ((row?.credits || 0) < amount) throw new Error('INSUFFICIENT_USER_CREDITS');
    addCreditsStmt.run(-amount, gid, discordId);
    recordTxn(gid, discordId, -amount, reason || 'admin burn credits', adminId, 'CREDITS');
    recordTxn(gid, 'BURN', amount, `burn credits from ${discordId}${reason ? ': ' + reason : ''}`, adminId, 'CREDITS');
  });
  run();
  return getUserBalances(gid, discordId);
}

export function gameLoseWithCredits(guildId, discordId, amount, detail) {
  const gid = resolveGuildId(guildId);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');
  const run = db.transaction(() => {
    ensureGuildUser(gid, discordId);
    const row = getUserStmt.get(gid, discordId);
    if ((row?.credits || 0) < amount) throw new Error('INSUFFICIENT_USER_CREDITS');
    addCreditsStmt.run(-amount, gid, discordId);
    recordTxn(gid, discordId, -amount, `game loss (credits)${detail ? ': ' + detail : ''}`, null, 'CREDITS');
    recordTxn(gid, 'BURN', amount, `game loss from ${discordId}${detail ? ': ' + detail : ''}`, null, 'CREDITS');
  });
  run();
  return getUserBalances(gid, discordId);
}

export function gameWinWithCredits(guildId, discordId, amount, detail) {
  return transferFromHouseToUser(guildId, discordId, amount, `game win (credits)${detail ? ': ' + detail : ''}`, null);
}
