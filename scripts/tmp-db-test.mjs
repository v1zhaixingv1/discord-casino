import * as db from '../db.auto.mjs';
function assert(cond, msg) { if (!cond) { console.error('ASSERT FAIL:', msg); process.exit(1); } }

const uid = 'test-user-123';
let bal = db.getUserBalances(uid);
console.log('initial', bal);
assert(bal.chips === 0 && bal.credits === 0, 'initial balances should be 0');

// House starts 0
assert(db.getHouseBalance() === 0, 'initial house 0');

// Add to house, then grant to user, then check
let house = db.addToHouse(1000, 'seed');
assert(house === 1000, 'house add 1000');

let afterGrant = db.transferFromHouseToUser(uid, 250, 'grant');
assert(afterGrant.chips === 250, 'user chips 250');
assert(afterGrant.house === 750, 'house 750 left');

// Burn from user
bal = db.burnFromUser(uid, 50, 'burn');
assert(bal.chips === 200, 'chips after burn 200');

// Take from user to house
let mov = db.takeFromUserToHouse(uid, 100, 'stake');
assert(mov.chips === 100 && mov.house === 850, 'stake moved to house');

// Credits grant and burn
bal = db.grantCredits(uid, 80, 'grant credits');
assert(bal.credits === 80, 'credits 80');

bal = db.gameLoseWithCredits(uid, 30, 'lose with credits');
assert(bal.credits === 50, 'credits after loss 50');

let win = db.gameWinWithCredits(uid, 200, 'win with credits');
assert(win.chips === 300, 'chips after win 300');

// Guild settings upserts
let gs = db.getGuildSettings('guild-1');
assert(gs.max_ridebus_bet === 1000, 'default max bet');

let gs2 = db.setMaxRidebusBet('guild-1', 5000);
assert(gs2.max_ridebus_bet === 5000, 'updated max bet');

let gs3 = db.setGameLogChannel('guild-1', 'channel-abc');
assert(gs3.log_channel_id === 'channel-abc', 'set log channel');

let gs4 = db.setCashLogChannel('guild-1', 'channel-cash');
assert(gs4.cash_log_channel_id === 'channel-cash', 'set cash log channel');

let gs5 = db.setRequestChannel('guild-1', 'channel-req');
assert(gs5.request_channel_id === 'channel-req', 'set request channel');

let gs6 = db.setRequestTimer('guild-1', 120);
assert(gs6.request_cooldown_sec === 120, 'request cooldown set');

// Request last timestamps
let last = db.getLastRequestAt('guild-1', uid);
assert(last === 0, 'initial last request 0');
let now = db.setLastRequestNow('guild-1', uid, 12345);
assert(now === 12345, 'set last ts explicit');
assert(db.getLastRequestAt('guild-1', uid) === 12345, 'read back ts');

// API keys
let key = db.createApiKey({ guildId: 'guild-1', scopes: ['chips:grant','settings:write'] });
assert(key.token && key.guildId === 'guild-1', 'created api key');
let key2 = db.lookupApiKey(key.token);
assert(key2 && key2.guildId === 'guild-1' && key2.scopes.includes('chips:grant'), 'lookup api key');
let list = db.listApiKeys('guild-1');
assert(list.length >= 1, 'list api keys by guild');
let del = db.deleteApiKey(key.token);
assert(del.deleted === 1, 'deleted api key');

// Active requests
let ar = db.getActiveRequest('guild-1', uid);
assert(ar === null, 'no active request');
let created = db.createActiveRequest('guild-1', uid, 'msg-1', 'BUYIN', 123);
assert(created && created.status === 'PENDING', 'created active request');
let upd = db.updateActiveRequestStatus('guild-1', uid, 'TAKEN');
assert(upd.status === 'TAKEN', 'updated status');
let cleared = db.clearActiveRequest('guild-1', uid);
assert(cleared === true, 'cleared');

console.log('All DB checks passed.');
