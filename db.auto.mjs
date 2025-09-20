// Environment-driven DB selector: Postgres (Cloud SQL) or SQLite
import 'dotenv/config';

const usePg = (process.env.DB_DRIVER || '').toLowerCase() === 'pg' || !!process.env.DATABASE_URL;
const impl = usePg
  ? await import('./db.pg.mjs')
  : await import('./db.mjs'); // SQLite default

// Utility to map function names safely (fallbacks for minor naming drifts)
function pick(name, ...alts) {
  for (const k of [name, ...alts]) {
    if (impl[k]) return impl[k];
  }
  return undefined;
}

// --- Common exports used across the app ---
export const getModRoles = pick('getModRoles');
export const addModRole = pick('addModRole');
export const removeModRole = pick('removeModRole');

export const getGuildSettings = pick('getGuildSettings');
export const setGameLogChannel = pick('setGameLogChannel');
export const setCashLogChannel = pick('setCashLogChannel');
export const setRequestChannel = pick('setRequestChannel');
export const setRequestTimer = pick('setRequestTimer');
export const setMaxRidebusBet = pick('setMaxRidebusBet');
export const setDefaultHoldemRake = pick('setDefaultHoldemRake');
export const setCasinoCategory = pick('setCasinoCategory');
export const setKittenMode = pick('setKittenMode');
export const isKittenModeEnabled = pick('isKittenModeEnabled');

// API keys: normalize naming differences between adapters
const _lookupApiKey = pick('lookupApiKey', 'getApiKey');
export async function lookupApiKey(token) { return _lookupApiKey(token); }
const _createApiKey = pick('createApiKey', 'insertApiKey');
export async function createApiKey({ token, guildId, scopes }) { return _createApiKey.length === 3 ? _createApiKey(token, guildId, scopes || '') : _createApiKey({ token, guildId, scopes }); }
export const deleteApiKey = pick('deleteApiKey');
export const listApiKeys = pick('listApiKeys');

// Active requests
export const getActiveRequest = pick('getActiveRequest');
export const createActiveRequest = pick('createActiveRequest');
export const updateActiveRequestStatus = pick('updateActiveRequestStatus');
export const clearActiveRequest = pick('clearActiveRequest');
export const getLastRequestAt = pick('getLastRequestAt');
export const setLastRequestNow = pick('setLastRequestNow');

// Users & house
export const getUserBalances = pick('getUserBalances');
export const getTopUsers = pick('getTopUsers');
export const getHouseBalance = pick('getHouseBalance');
export const getCasinoNetworth = pick('getCasinoNetworth');
export const addToHouse = pick('addToHouse');
export const removeFromHouse = pick('removeFromHouse');
export const transferFromHouseToUser = pick('transferFromHouseToUser');
export const takeFromUserToHouse = pick('takeFromUserToHouse');
export const burnFromUser = pick('burnFromUser');
export const mintChips = pick('mintChips');
export const grantCredits = pick('grantCredits');
export const burnCredits = pick('burnCredits');
export const gameLoseWithCredits = pick('gameLoseWithCredits');
export const gameWinWithCredits = pick('gameWinWithCredits');

// Hold'em escrow and hands
export const ensureHoldemTable = pick('ensureHoldemTable');
export const createHoldemHand = pick('createHoldemHand');
export const getEscrowBalance = pick('getEscrowBalance');
export const escrowAdd = pick('escrowAdd');
export const escrowReturn = pick('escrowReturn');
export const escrowCommit = pick('escrowCommit');
export const settleRake = pick('settleRake');
export const finalizeHoldemHand = pick('finalizeHoldemHand');
export const listEscrowForTable = pick('listEscrowForTable');

// In SQLite, escrowCreditMany is an alias of escrowPayoutMany; normalize here
const _escrowCreditMany = pick('escrowCreditMany', 'escrowPayoutMany');
export async function escrowCreditMany(tableId, payouts) { return _escrowCreditMany(tableId, payouts); }

// Maintenance
export const resetAllBalances = pick('resetAllBalances');

// Helpful to know what backend is active
export const __DB_DRIVER = usePg ? 'pg' : 'sqlite';
