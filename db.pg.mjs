// Postgres adapter (sketch): provides the same exported functions as db.mjs
// Enable by importing this module instead of db.mjs, or by wiring a dispatcher.

import 'dotenv/config';

let Pool;
try { ({ Pool } = await import('pg')); } catch {
  throw new Error('Missing dependency: pg. Run `npm install pg`');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE ? { rejectUnauthorized: false } : undefined });

async function q(text, params = []) { const { rows } = await pool.query(text, params); return rows; }
async function q1(text, params = []) { const r = await pool.query(text, params); return r.rows[0] || null; }
async function tx(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const res = await fn(client); await client.query('COMMIT'); return res; }
  catch (e) { try { await client.query('ROLLBACK'); } catch {} throw e; }
  finally { client.release(); }
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
async function ensureUser(discordId) {
  await q('INSERT INTO users (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO NOTHING', [discordId]);
}
export async function getUserBalances(discordId) {
  await ensureUser(discordId);
  const row = await q1('SELECT chips, credits FROM users WHERE discord_id=$1', [discordId]);
  return { chips: Number(row?.chips || 0), credits: Number(row?.credits || 0) };
}
export async function getTopUsers(limit = 10) {
  const n = Math.max(1, Math.min(25, Number(limit) || 10));
  const rows = await q('SELECT discord_id, chips FROM users WHERE chips > 0 ORDER BY chips DESC, created_at ASC LIMIT $1', [n]);
  return rows;
}
export async function getHouseBalance() {
  const row = await q1('SELECT chips FROM house WHERE id = 1');
  return Number(row?.chips || 0);
}
export async function getCasinoNetworth() {
  const h = await getHouseBalance();
  const row = await q1('SELECT COALESCE(SUM(chips),0) AS total FROM users');
  return h + Number(row?.total || 0);
}
export async function addToHouse(amount, reason, adminId) {
  const amt = Number(amount) | 0; if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    await c.query('UPDATE house SET chips = chips + $1, updated_at = now() WHERE id = 1', [amt]);
    await c.query('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', ['HOUSE', amt, reason || 'house top-up', adminId || null, 'CHIPS']);
  });
  return getHouseBalance();
}
export async function removeFromHouse(amount, reason, adminId) {
  const amt = Number(amount) | 0; if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    const { rows } = await c.query('SELECT chips FROM house WHERE id=1');
    if ((rows?.[0]?.chips || 0) < amt) throw new Error('INSUFFICIENT_HOUSE');
    await c.query('UPDATE house SET chips = chips - $1, updated_at = now() WHERE id = 1', [amt]);
    await c.query('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', ['HOUSE', -amt, reason || 'house remove', adminId || null, 'CHIPS']);
  });
  return getHouseBalance();
}
export async function transferFromHouseToUser(discordId, amount, reason, adminId) {
  const amt = Number(amount) | 0; if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    const { rows } = await c.query('SELECT chips FROM house WHERE id=1');
    if ((rows?.[0]?.chips || 0) < amt) throw new Error('INSUFFICIENT_HOUSE');
    await ensureUser(discordId);
    await c.query('UPDATE house SET chips = chips - $1, updated_at = now() WHERE id = 1', [amt]);
    await c.query('UPDATE users SET chips = chips + $1, updated_at = now() WHERE discord_id = $2', [amt, discordId]);
    await c.query('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', [discordId, amt, reason || 'admin grant', adminId || null, 'CHIPS']);
    await c.query('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', ['HOUSE', -amt, `grant to ${discordId}${reason ? ': ' + reason : ''}`, adminId || null, 'CHIPS']);
  });
  const bal = await getUserBalances(discordId); return { ...bal, house: await getHouseBalance() };
}
export async function takeFromUserToHouse(discordId, amount, reason, adminId) {
  const amt = Number(amount) | 0; if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    await ensureUser(discordId);
    const row = await q1('SELECT chips FROM users WHERE discord_id=$1', [discordId]);
    if ((row?.chips || 0) < amt) throw new Error('INSUFFICIENT_USER');
    await c.query('UPDATE users SET chips = chips - $1, updated_at = now() WHERE discord_id=$2', [amt, discordId]);
    await c.query('UPDATE house SET chips = chips + $1, updated_at = now() WHERE id=1', [amt]);
    await c.query('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', [discordId, -amt, reason || 'game stake', adminId || null, 'CHIPS']);
    await c.query('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', ['HOUSE', amt, `stake from ${discordId}${reason ? ': ' + reason : ''}`, adminId || null, 'CHIPS']);
  });
  const bal = await getUserBalances(discordId); return { ...bal, house: await getHouseBalance() };
}
export async function mintChips(discordId, amount, reason, adminId) {
  const amt = Number(amount) | 0; if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await ensureUser(discordId);
  await q('UPDATE users SET chips = chips + $1, updated_at = now() WHERE discord_id=$2', [amt, discordId]);
  await q('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', [discordId, amt, reason || 'admin mint chips', adminId || null, 'CHIPS']);
  return getUserBalances(discordId);
}
export async function burnFromUser(discordId, amount, reason, adminId) {
  const amt = Number(amount) | 0; if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    await ensureUser(discordId);
    const row = await q1('SELECT chips FROM users WHERE discord_id=$1', [discordId]);
    if ((row?.chips || 0) < amt) throw new Error('INSUFFICIENT_USER');
    await c.query('UPDATE users SET chips = chips - $1, updated_at = now() WHERE discord_id=$2', [amt, discordId]);
    await c.query('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', [discordId, -amt, reason || 'admin burn chips', adminId || null, 'CHIPS']);
    await c.query('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', ['BURN', amt, `burn chips from ${discordId}${reason ? ': ' + reason : ''}`, adminId || null, 'CHIPS']);
  });
  return getUserBalances(discordId);
}

// --- Credits ---
export async function grantCredits(discordId, amount, reason, adminId) {
  const amt = Number(amount) | 0; if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await ensureUser(discordId);
  await q('UPDATE users SET credits = credits + $1, updated_at = now() WHERE discord_id=$2', [amt, discordId]);
  await q('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', [discordId, amt, reason || 'admin grant credits', adminId || null, 'CREDITS']);
  return getUserBalances(discordId);
}
export async function burnCredits(discordId, amount, reason, adminId) {
  const amt = Number(amount) | 0; if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    await ensureUser(discordId);
    const row = await q1('SELECT credits FROM users WHERE discord_id=$1', [discordId]);
    if ((row?.credits || 0) < amt) throw new Error('INSUFFICIENT_USER_CREDITS');
    await c.query('UPDATE users SET credits = credits - $1, updated_at = now() WHERE discord_id=$2', [amt, discordId]);
    await c.query('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', [discordId, -amt, reason || 'admin burn credits', adminId || null, 'CREDITS']);
    await c.query('INSERT INTO transactions (account, delta, reason, admin_id, currency) VALUES ($1,$2,$3,$4,$5)', ['BURN', amt, `burn credits from ${discordId}${reason ? ': ' + reason : ''}`, adminId || null, 'CREDITS']);
  });
  return getUserBalances(discordId);
}
export async function gameLoseWithCredits(discordId, amount, detail) {
  return burnCredits(discordId, amount, `game loss (credits)${detail ? ': ' + detail : ''}`, null);
}
export async function gameWinWithCredits(discordId, amount, detail) {
  return transferFromHouseToUser(discordId, amount, `game win (credits)${detail ? ': ' + detail : ''}`, null);
}

// --- Guild settings ---
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
  const row = await q1('SELECT guild_id, log_channel_id, cash_log_channel_id, request_channel_id, request_cooldown_sec, logging_enabled, max_ridebus_bet, casino_category_id, holdem_rake_bps, holdem_rake_cap FROM guild_settings WHERE guild_id=$1', [guildId]);
  return normalizeSettings(row);
}
async function upsertGuildSettings(fields) {
  const keys = ['log_channel_id','cash_log_channel_id','request_channel_id','request_cooldown_sec','logging_enabled','max_ridebus_bet','casino_category_id','holdem_rake_bps','holdem_rake_cap'];
  const vals = keys.map(k => fields[k] ?? null);
  // Ensure the row exists so we can UPDATE without violating NOT NULL defaults
  await q('INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING', [fields.guild_id]);
  // Update only provided keys; leave others unchanged
  const updates = keys.map((k,i)=> `${k}=COALESCE($${i+2}, ${k})`).join(', ');
  await q(`UPDATE guild_settings SET ${updates}, updated_at=now() WHERE guild_id=$1`, [fields.guild_id, ...vals]);
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
export async function getActiveRequest(guildId, userId) { return await q1('SELECT guild_id,user_id,message_id,type,amount,status FROM active_requests WHERE guild_id=$1 AND user_id=$2', [guildId, userId]) || null; }
export async function createActiveRequest(guildId, userId, messageId, type, amount) {
  if (!guildId || !userId || !messageId) throw new Error('ACTIVE_REQ_PARAMS');
  const amt = Number(amount) | 0; if (!Number.isInteger(amt) || amt <= 0) throw new Error('ACTIVE_REQ_AMOUNT');
  const existing = await getActiveRequest(guildId, userId); if (existing) throw new Error('ACTIVE_REQ_EXISTS');
  await q('INSERT INTO active_requests (guild_id, user_id, message_id, type, amount, status) VALUES ($1,$2,$3,$4,$5,$6)', [guildId, userId, messageId, String(type||'unknown'), amt, 'PENDING']);
  return getActiveRequest(guildId, userId);
}
export async function updateActiveRequestStatus(guildId, userId, status) { await q('UPDATE active_requests SET status=$1, updated_at=now() WHERE guild_id=$2 AND user_id=$3', [String(status||'PENDING'), guildId, userId]); return getActiveRequest(guildId, userId); }
export async function clearActiveRequest(guildId, userId) { await q('DELETE FROM active_requests WHERE guild_id=$1 AND user_id=$2', [guildId, userId]); return true; }

// --- Hold’em (TODO: full parity) ---
export async function ensureHoldemTable(tableId, guildId, channelId, sb, bb, min, max, rakeBps, hostId) {
  await q(
    `INSERT INTO holdem_tables (table_id, guild_id, channel_id, sb, bb, min, max, rake_bps, host_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (table_id) DO NOTHING`,
    [String(tableId), String(guildId), String(channelId), Number(sb)||0, Number(bb)||0, Number(min)||0, Number(max)||0, Number(rakeBps)||0, hostId ? String(hostId) : null]
  );
  return true;
}
export async function createHoldemHand(tableId, handNo, board, winnersJson, rakePaid) {
  const row = await q1(
    'INSERT INTO holdem_hands (table_id, hand_no, board, winners_json, rake_paid) VALUES ($1,$2,$3,$4,$5) RETURNING hand_id',
    [String(tableId), Number(handNo)||0, String(board||''), String(winnersJson||'[]'), Number(rakePaid)||0]
  );
  return Number(row?.hand_id || 0);
}
export async function getEscrowBalance(tableId, userId) {
  const row = await q1('SELECT balance FROM holdem_escrow WHERE table_id=$1 AND user_id=$2', [String(tableId), String(userId)]);
  return Number(row?.balance || 0);
}
export async function escrowAdd(tableId, userId, amount) {
  const amt = Number(amount) | 0; if (!Number.isInteger(amt) || amt <= 0) throw new Error('Amount must be a positive integer.');
  await tx(async c => {
    const row = await c.query('SELECT chips FROM users WHERE discord_id=$1', [String(userId)]);
    const chips = Number(row?.rows?.[0]?.chips || 0);
    if (chips < amt) throw new Error('INSUFFICIENT_USER');
    await c.query('UPDATE users SET chips = chips - $1, updated_at = now() WHERE discord_id=$2', [amt, String(userId)]);
    await c.query('INSERT INTO transactions (account, delta, reason, currency) VALUES ($1,$2,$3,$4)', [`${'ESCROW:' + tableId}`, amt, `holdem buy-in from ${userId}`, 'CHIPS']);
    await c.query('INSERT INTO holdem_escrow (table_id, user_id, balance) VALUES ($1,$2,$3) ON CONFLICT (table_id,user_id) DO UPDATE SET balance = holdem_escrow.balance + EXCLUDED.balance', [String(tableId), String(userId), amt]);
  });
  return { escrow: await getEscrowBalance(tableId, userId), user: (await getUserBalances(userId)).chips };
}
export async function escrowReturn(tableId, userId, amount) {
  const amt = Number(amount) | 0; if (amt <= 0) return 0;
  await tx(async c => {
    const row = await c.query('SELECT balance FROM holdem_escrow WHERE table_id=$1 AND user_id=$2', [String(tableId), String(userId)]);
    const bal = Number(row?.rows?.[0]?.balance || 0);
    const toReturn = Math.min(bal, amt);
    if (toReturn <= 0) return;
    await c.query('UPDATE holdem_escrow SET balance = balance - $1 WHERE table_id=$2 AND user_id=$3', [toReturn, String(tableId), String(userId)]);
    await c.query('UPDATE users SET chips = chips + $1, updated_at = now() WHERE discord_id=$2', [toReturn, String(userId)]);
    await c.query('INSERT INTO transactions (account, delta, reason, currency) VALUES ($1,$2,$3,$4)', [`ESCROW:${tableId}`, -toReturn, `holdem refund to ${userId}`, 'CHIPS']);
    await c.query('INSERT INTO transactions (account, delta, reason, currency) VALUES ($1,$2,$3,$4)', [String(userId), toReturn, `holdem refund from escrow ${tableId}`, 'CHIPS']);
  });
  return await getEscrowBalance(tableId, userId);
}
export async function escrowCommit(tableId, userId, handId, street, amount) {
  const amt = Number(amount) | 0; if (amt <= 0) return 0;
  await tx(async c => {
    await c.query('INSERT INTO holdem_commits (hand_id, user_id, street, amount) VALUES ($1,$2,$3,$4)', [Number(handId)||0, String(userId), String(street||'PREFLOP'), amt]);
    await c.query('UPDATE holdem_escrow SET balance = balance - $1 WHERE table_id=$2 AND user_id=$3', [amt, String(tableId), String(userId)]);
    await c.query('INSERT INTO transactions (account, delta, reason, currency) VALUES ($1,$2,$3,$4)', [`ESCROW:${tableId}`, -amt, `holdem commit ${street} from ${userId}`, 'CHIPS']);
    await c.query('INSERT INTO transactions (account, delta, reason, currency) VALUES ($1,$2,$3,$4)', [`POT:${tableId}`, amt, `holdem commit ${street} from ${userId}`, 'CHIPS']);
  });
  return amt;
}
export async function escrowPayoutMany(tableId, payouts) {
  await tx(async c => {
    for (const { userId, amount } of payouts) {
      const amt = Math.max(0, Number(amount)||0); if (amt <= 0) continue;
      await c.query('INSERT INTO transactions (account, delta, reason, currency) VALUES ($1,$2,$3,$4)', [`POT:${tableId}`, -amt, `holdem payout to escrow for ${userId}`, 'CHIPS']);
      await c.query('INSERT INTO transactions (account, delta, reason, currency) VALUES ($1,$2,$3,$4)', [`ESCROW:${tableId}`, amt, `holdem payout to ${userId}`, 'CHIPS']);
      await c.query('UPDATE holdem_escrow SET balance = balance + $1 WHERE table_id=$2 AND user_id=$3', [amt, String(tableId), String(userId)]);
    }
  });
  return true;
}
export async function settleRake(tableId, amount) {
  const amt = Math.max(0, Number(amount)||0); if (amt <= 0) return 0;
  await tx(async c => {
    await c.query('UPDATE house SET chips = chips + $1, updated_at = now() WHERE id=1', [amt]);
    await c.query('INSERT INTO transactions (account, delta, reason, currency) VALUES ($1,$2,$3,$4)', ['HOUSE', amt, `holdem rake ${tableId}`, 'CHIPS']);
    await c.query('INSERT INTO transactions (account, delta, reason, currency) VALUES ($1,$2,$3,$4)', [`POT:${tableId}`, -amt, `holdem rake ${tableId}`, 'CHIPS']);
  });
  return getHouseBalance();
}
export async function finalizeHoldemHand(handId, { board, winnersJson, rakePaid }) {
  await q('UPDATE holdem_hands SET board=$1, winners_json=$2, rake_paid=$3 WHERE hand_id=$4', [String(board||''), String(winnersJson||'[]'), Number(rakePaid)||0, Number(handId)||0]);
}
export async function listEscrowForTable(tableId) {
  const rows = await q('SELECT user_id, balance FROM holdem_escrow WHERE table_id=$1 AND balance > 0', [String(tableId)]);
  return rows.map(r => ({ user_id: r.user_id, balance: Number(r.balance||0) }));
}

// --- API keys ---
export async function getApiKey(token) { return await q1('SELECT id, guild_id, scopes FROM api_keys WHERE token=$1', [token]); }
export async function insertApiKey(token, guildId, scopes) { await q('INSERT INTO api_keys (token, guild_id, scopes) VALUES ($1,$2,$3)', [token, guildId, scopes||'']); return true; }
export async function deleteApiKey(token) { await q('DELETE FROM api_keys WHERE token=$1', [token]); return true; }
export async function listApiKeys() { return await q('SELECT id, token, guild_id, scopes FROM api_keys ORDER BY id DESC'); }

// Compatibility wrappers matching sqlite adapter API
export async function lookupApiKey(token) {
  if (!token) return null;
  const row = await getApiKey(token);
  if (!row) return null;
  const scopes = String(row.scopes || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return { id: row.id, guildId: row.guild_id, scopes };
}
export async function createApiKey({ token, guildId, scopes }) {
  if (!guildId) throw new Error('GUILD_ID_REQUIRED');
  const scopeStr = Array.isArray(scopes) ? scopes.join(',') : (scopes || '');
  if (!token) {
    // Lightweight random; callers can also provide token explicitly
    const { randomBytes } = await import('node:crypto');
    token = randomBytes(24).toString('base64url');
  }
  await insertApiKey(token, guildId, scopeStr);
  const row = await q1('SELECT id, token, guild_id, scopes FROM api_keys WHERE token=$1', [token]);
  return { id: row.id, token: row.token, guildId: row.guild_id, scopes: String(row.scopes || '').split(',').map(s => s.trim()).filter(Boolean) };
}
export async function listApiKeysByGuild(guildId = null) {
  const rows = guildId
    ? await q('SELECT id, token, guild_id, scopes FROM api_keys WHERE guild_id=$1 ORDER BY id DESC', [guildId])
    : await listApiKeys();
  return rows.map(r => ({ id: r.id, token: r.token, guildId: r.guild_id, scopes: String(r.scopes || '').split(',').map(s => s.trim()).filter(Boolean) }));
}

// --- Utility ---
export async function resetAllBalances() {
  const res = await tx(async c => {
    const { rows } = await c.query('SELECT COUNT(*) as n FROM users');
    const usersBefore = Number(rows?.[0]?.n || 0);
    await c.query('UPDATE users SET chips=0, credits=100, updated_at=now()');
    await c.query('UPDATE house SET chips=0, updated_at=now() WHERE id=1');
    return { usersBefore, usersUpdated: usersBefore, house: 0 };
  });
  return res;
}

// --- Request last (cooldown tracking) ---
export async function getLastRequestAt(guildId, userId) {
  const row = await q1('SELECT last_ts FROM request_last WHERE guild_id=$1 AND user_id=$2', [String(guildId), String(userId)]);
  return row ? Number(row.last_ts) : 0;
}
export async function setLastRequestNow(guildId, userId, ts = null) {
  const t = ts ? Number(ts) : Math.floor(Date.now() / 1000);
  await q(
    `INSERT INTO request_last (guild_id, user_id, last_ts) VALUES ($1,$2,$3)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET last_ts=EXCLUDED.last_ts`,
    [String(guildId), String(userId), t]
  );
  return t;
}

// Naming shim for Hold'em payout alias
export const escrowCreditMany = escrowPayoutMany;
