import 'dotenv/config';

let Pool;
try { ({ Pool } = await import('pg')); } catch {
  throw new Error('Missing dependency: pg. Run `npm install pg`');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE ? { rejectUnauthorized: false } : undefined
});

const DEFAULT_GUILD_ID = process.env.PRIMARY_GUILD_ID || process.env.GUILD_ID || 'global';

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
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, discord_id)
      )
    `);
    await c.query(
      'INSERT INTO users (guild_id, discord_id, chips, credits, created_at, updated_at) SELECT $1, discord_id, chips, credits, created_at, updated_at FROM users_legacy',
      [DEFAULT_GUILD_ID]
    );
    await c.query('DROP TABLE users_legacy');
  });
  await q('CREATE INDEX IF NOT EXISTS idx_users_guild_discord ON users (guild_id, discord_id)');
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
      [DEFAULT_GUILD_ID]
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
    await q('INSERT INTO guild_house (guild_id, chips) VALUES ($1, $2) ON CONFLICT DO NOTHING', [DEFAULT_GUILD_ID, legacy]);
  }
  await q('INSERT INTO guild_house (guild_id, chips) VALUES ($1, 0) ON CONFLICT DO NOTHING', [DEFAULT_GUILD_ID]);
}

await migrateUsersToGuildScoped();
await migrateTransactionsToGuildScoped();
await seedGuildHouseFromLegacy();

try {
  if (await tableExists('guild_settings') && !(await tableHasColumn('guild_settings', 'kitten_mode_enabled'))) {
    await q('ALTER TABLE guild_settings ADD COLUMN kitten_mode_enabled BOOLEAN NOT NULL DEFAULT false');
  }
} catch (err) {
  console.error('Failed to ensure kitten_mode_enabled column on guild_settings:', err);
}

function resolveGuildId(guildId) {
  return guildId || DEFAULT_GUILD_ID;
}

async function ensureGuildUser(guildId, discordId) {
  await q('INSERT INTO users (guild_id, discord_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, discordId]);
}

async function ensureGuildHouse(guildId) {
  await q('INSERT INTO guild_house (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);
}

async function houseRow(guildId) {
  await ensureGuildHouse(guildId);
  const row = await q1('SELECT chips FROM guild_house WHERE guild_id = $1', [guildId]);
  return { chips: Number(row?.chips || 0) };
}

async function recordTxn(guildId, account, delta, reason, adminId, currency = 'CHIPS') {
  await q(
    'INSERT INTO transactions (guild_id, account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5,$6)',
    [guildId, account, delta, reason || null, adminId || null, currency]
  );
}

// --- Roles ---
export async function getModRoles(guildId) {
  const rows = await q('SELECT role_id FROM mod_roles WHERE guild_id = $1', [guildId]);
  return rows.map(r => r.role_id);
}
export async function addModRole(guildId, roleId) {
  await q('INSERT INTO mod_roles (guild_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [guildId, roleId]);
  return getModRoles(guildId);
}
export async function removeModRole(guildId, roleId) {
  await q('DELETE FROM mod_roles WHERE guild_id = $1 AND role_id = $2', [guildId, roleId]);
  return getModRoles(guildId);
}

// --- Users & House ---
export async function getUserBalances(guildId, discordId) {
  const gid = resolveGuildId(guildId);
  await ensureGuildUser(gid, discordId);
  const row = await q1('SELECT chips, credits FROM users WHERE guild_id = $1 AND discord_id = $2', [gid, discordId]);
  return { chips: Number(row?.chips || 0), credits: Number(row?.credits || 0) };
}

export async function getTopUsers(guildId, limit = 10) {
  const gid = resolveGuildId(guildId);
  const n = Math.max(1, Math.min(25, Number(limit) || 10));
  const rows = await q(
    'SELECT discord_id, chips FROM users WHERE guild_id = $1 AND chips > 0 ORDER BY chips DESC, created_at ASC LIMIT $2',
    [gid, n]
  );
  return rows.map(r => ({ discord_id: r.discord_id, chips: Number(r.chips || 0) }));
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

// --- Guild settings (unchanged structure) ---
function normalizeSettings(row) {
  if (!row) return { log_channel_id: null, cash_log_channel_id: null, request_channel_id: null, request_cooldown_sec: 0, logging_enabled: 0, max_ridebus_bet: 1000, casino_category_id: null, holdem_rake_bps: 0, holdem_rake_cap: 0 };
  return {
    log_channel_id: row.log_channel_id || null,
    cash_log_channel_id: row.cash_log_channel_id || null,
    request_channel_id: row.request_channel_id || null,
    request_cooldown_sec: Number(row.request_cooldown_sec || 0),
    logging_enabled: row.logging_enabled ? 1 : 0,
    max_ridebus_bet: Number(row.max_ridebus_bet || 1000),
    casino_category_id: row.casino_category_id || null,
    holdem_rake_bps: Number(row.holdem_rake_bps || 0),
    holdem_rake_cap: Number(row.holdem_rake_cap || 0)
  };
}

export async function getGuildSettings(guildId) {
  const row = await q1('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
  return normalizeSettings(row);
}

async function upsertGuildSettings(fields) {
  const keys = ['log_channel_id','cash_log_channel_id','request_channel_id','request_cooldown_sec','logging_enabled','max_ridebus_bet','casino_category_id','holdem_rake_bps','holdem_rake_cap'];
  const vals = keys.map(k => fields[k] ?? null);
  await q('INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING', [fields.guild_id]);
  const updates = keys.map((k, i) => `${k} = COALESCE($${i + 2}, ${k})`).join(', ');
  await q(`UPDATE guild_settings SET ${updates}, updated_at = NOW() WHERE guild_id = $1`, [fields.guild_id, ...vals]);
}

export async function setGameLogChannel(guildId, channelId) { await upsertGuildSettings({ guild_id: guildId, log_channel_id: channelId }); return getGuildSettings(guildId); }
export async function setCashLogChannel(guildId, channelId) { await upsertGuildSettings({ guild_id: guildId, cash_log_channel_id: channelId }); return getGuildSettings(guildId); }
export async function setRequestChannel(guildId, channelId) { await upsertGuildSettings({ guild_id: guildId, request_channel_id: channelId }); return getGuildSettings(guildId); }
export async function setRequestTimer(guildId, seconds) { await upsertGuildSettings({ guild_id: guildId, request_cooldown_sec: Math.max(0, Number(seconds) || 0) }); return getGuildSettings(guildId); }
export async function setLoggingEnabled(guildId, enabled) { await upsertGuildSettings({ guild_id: guildId, logging_enabled: !!enabled }); return getGuildSettings(guildId); }
export async function setMaxRidebusBet(guildId, amount) { await upsertGuildSettings({ guild_id: guildId, max_ridebus_bet: Math.max(1, Number(amount) || 1) }); return getGuildSettings(guildId); }
export async function setCasinoCategory(guildId, categoryId) { await upsertGuildSettings({ guild_id: guildId, casino_category_id: categoryId }); return getGuildSettings(guildId); }
export async function setDefaultHoldemRake(guildId, rakeBps, rakeCap = 0) { await upsertGuildSettings({ guild_id: guildId, holdem_rake_bps: Math.max(0, Number(rakeBps) || 0), holdem_rake_cap: Math.max(0, Number(rakeCap) || 0) }); return getGuildSettings(guildId); }

// --- Active Requests ---
export async function getActiveRequest(guildId, userId) {
  return (await q1('SELECT guild_id, user_id, message_id, type, amount, status FROM active_requests WHERE guild_id = $1 AND user_id = $2', [guildId, userId])) || null;
}
export async function createActiveRequest(guildId, userId, messageId, type, amount) {
  if (!guildId || !userId || !messageId) throw new Error('ACTIVE_REQ_PARAMS');
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt <= 0) throw new Error('ACTIVE_REQ_AMOUNT');
  if (await getActiveRequest(guildId, userId)) throw new Error('ACTIVE_REQ_EXISTS');
  await q('INSERT INTO active_requests (guild_id, user_id, message_id, type, amount, status) VALUES ($1,$2,$3,$4,$5,$6)', [guildId, userId, messageId, String(type || 'unknown'), amt, 'PENDING']);
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

// --- Hold’em helpers ---
async function guildForTable(tableId) {
  const row = await q1('SELECT guild_id FROM holdem_tables WHERE table_id = $1', [String(tableId)]);
  return row?.guild_id || DEFAULT_GUILD_ID;
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

export const __DB_DRIVER = 'pg';
