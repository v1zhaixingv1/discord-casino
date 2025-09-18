import { EmbedBuilder } from 'discord.js';
import { getUserBalances, burnCredits } from '../db.auto.mjs';
import { chipsAmount, chipsAmountSigned } from './format.mjs';
import { finalizeSessionUIByIds, postGameSessionEndByIds } from './logging.mjs';
import { ridebusGames } from './ridebus.mjs';
import { blackjackGames } from './blackjack.mjs';
import { rouletteSessions } from './roulette.mjs';
import { slotSessions } from './slots.mjs';

export const ACTIVE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
export const activeSessions = new Map(); // key: `${guildId}:${userId}` -> state

// Key helpers
export function activeKey(guildId, userId) { return `${guildId}:${userId}`; }
export function keyFor(interaction) { return `${interaction.guild.id}:${interaction.user.id}`; }
export function getActiveSession(guildId, userId) { return activeSessions.get(activeKey(guildId, userId)) || null; }
export function setActiveSession(guildId, userId, type, gameLabel, opts = {}) {
  const now = Date.now();
  const k = activeKey(guildId, userId);
  const cur = activeSessions.get(k);
  const reset = !!opts.reset;
  if (cur && cur.type === type && !reset) {
    cur.lastAt = now;
    if (gameLabel) cur.gameLabel = gameLabel;
    return;
  }
  activeSessions.set(k, { type, lastAt: now, startedAt: now, houseNet: 0, playerNet: 0, games: 0, gameLabel: gameLabel || type });
}
export function touchActiveSession(guildId, userId, type) {
  const k = activeKey(guildId, userId);
  const s = activeSessions.get(k);
  if (!s || s.type !== type) return false;
  s.lastAt = Date.now();
  return true;
}
export function addHouseNet(guildId, userId, type, delta) {
  try {
    if (!Number.isFinite(delta) || delta === 0) return;
    const k = activeKey(guildId, userId);
    const s = activeSessions.get(k);
    if (!s || s.type !== type) return;
    s.houseNet = (s.houseNet || 0) + Math.trunc(delta);
  } catch {}
}
export function addPlayerNetAndGame(guildId, userId, delta) {
  try {
    const k = activeKey(guildId, userId);
    const s = activeSessions.get(k);
    if (!s) return;
    s.games = (s.games || 0) + 1;
    if (Number.isFinite(delta)) s.playerNet = (s.playerNet || 0) + Math.trunc(delta);
  } catch {}
}
export function recordSessionGame(guildId, userId, deltaChips) {
  try {
    addPlayerNetAndGame(guildId, userId, deltaChips);
  } catch {}
}
export function setActiveMessageRef(guildId, userId, channelId, messageId) {
  try {
    const s = getActiveSession(guildId, userId);
    if (!s) return;
    s.msgChannelId = channelId;
    s.msgId = messageId;
  } catch {}
}
// Send/Update a game message and remember its channel/message id
export async function sendGameMessage(interaction, payload, mode = 'auto') {
  if (mode === 'update' || (mode === 'auto' && interaction.isButton && interaction.isButton())) {
    const res = await interaction.update(payload);
    try { setActiveMessageRef(interaction.guild.id, interaction.user.id, interaction.channelId, interaction.message.id); } catch {}
    return res;
  }
  if (mode === 'followUp') {
    const msg = await interaction.followUp(payload);
    try { setActiveMessageRef(interaction.guild.id, interaction.user.id, msg.channelId, msg.id); } catch {}
    return msg;
  }
  await interaction.reply(payload);
  try {
    const msg = await interaction.fetchReply();
    setActiveMessageRef(interaction.guild.id, interaction.user.id, msg.channelId, msg.id);
    return msg;
  } catch {}
}

// Format a one-line session summary (games and net)
export function sessionLineFor(guildId, userId) {
  try {
    const s = getActiveSession(guildId, userId);
    if (!s) return null;
    const games = Number(s.games || 0);
    const net = Number(s.playerNet || 0);
    return `Session: Games **${games}** • Net **${chipsAmountSigned(net)}**`;
  } catch { return null; }
}

// UI helper: show current balances and session line
export async function buildPlayerBalanceField(guildId, userId, name = 'Player Balance') {
  const fmt = new Intl.NumberFormat('en-US');
  const { chips, credits } = await getUserBalances(userId);
  const sess = sessionLineFor(guildId, userId);
  const val = [
    `Chips: **${chipsAmount(chips)}**`,
    `Credits: **${fmt.format(credits)}**`,
    sess ? sess : null
  ].filter(Boolean).join('\n');
  return { name, value: val };
}

export function clearActiveSession(guildId, userId) { activeSessions.delete(activeKey(guildId, userId)); }
// Check if a user’s session for a type exceeded the inactivity timeout
export function hasActiveExpired(guildId, userId, type) {
  const s = getActiveSession(guildId, userId);
  if (!s || s.type !== type) return true;
  return (Date.now() - s.lastAt) > ACTIVE_TIMEOUT_MS;
}

// Build the session end summary embed
export async function buildSessionEndEmbed(guildId, userId) {
  const s = getActiveSession(guildId, userId) || {};
  const game = s.gameLabel || (s.type ? String(s.type).toUpperCase() : 'Game');
  const e = new EmbedBuilder().setColor(0x2b2d31);
  try {
    const { chips, credits } = await getUserBalances(userId);
    const fmt = new Intl.NumberFormat('en-US');
    const lines = [
      `Game: ${game}`,
      'Player Balance',
      `Chips: ${fmt.format(chips)}`,
      `Credits: ${fmt.format(credits)}`,
      `Hands(Rounds) Played: ${fmt.format(s.games || 0)}`,
      `Net: ${(s.playerNet||0) >= 0 ? '+' : '-'}${fmt.format(Math.abs(s.playerNet||0))}`
    ];
    e.setDescription(lines.join('\n'));
  } catch {
    e.setDescription(`Game: ${game}`);
  }
  return e;
}

export function expireAtUnix(guildId, userId) {
  try {
    const s = getActiveSession(guildId, userId);
    const last = s?.lastAt || Date.now();
    return Math.floor((last + ACTIVE_TIMEOUT_MS) / 1000);
  } catch {
    return Math.floor((Date.now() + ACTIVE_TIMEOUT_MS) / 1000);
  }
}

// UI helper: relative time to automatic expiration
export function buildTimeoutField(guildId, userId, name = '⏳ Timeout') {
  const ts = expireAtUnix(guildId, userId);
  return { name, value: `<t:${ts}:R>` };
}

export async function burnUpToCredits(userId, stake, reason) {
  try {
    if (!Number.isInteger(stake) || stake <= 0) return 0;
    const { credits } = await getUserBalances(userId);
    const toBurn = Math.min(stake, credits);
    if (toBurn > 0) await burnCredits(userId, toBurn, reason, null);
    return toBurn;
  } catch {
    return 0;
  }
}

export async function endActiveSessionForUser(interaction, cause = 'new_command') {
  try {
    const guildId = interaction.guild?.id; if (!guildId) return;
    const userId = interaction.user?.id; if (!userId) return;
    const k = `${guildId}:${userId}`;
    const s = activeSessions.get(k);
    if (!s) return;
    // Update UI to session summary before logging
    await finalizeSessionUIByIds(interaction.client, guildId, userId);
    // Clean up per-game state; treat as loss where stakes already moved to house
    if (s.type === 'ridebus') {
      const st = ridebusGames.get(k);
      if (st) { try { await burnUpToCredits(userId, Number(st.creditsStake) || 0, `ridebus expired (${cause})`); } catch {} }
      const net = (s.houseNet || 0) + (st?.chipsStake || 0);
      try { await postGameSessionEndByIds(interaction.client, guildId, userId, { game: 'Ride the Bus', houseNet: net }); } catch {}
      ridebusGames.delete(k);
    } else if (s.type === 'blackjack') {
      const st = blackjackGames.get(k);
      if (st) { try { await burnUpToCredits(userId, Number(st.creditsStake) || 0, `blackjack expired (${cause})`); } catch {} }
      const chipsStake = st && st.split && Array.isArray(st.hands)
        ? (st.hands?.[0]?.chipsStake || 0) + (st.hands?.[1]?.chipsStake || 0)
        : (st?.chipsStake || 0);
      const net = (s.houseNet || 0) + chipsStake;
      try { await postGameSessionEndByIds(interaction.client, guildId, userId, { game: 'Blackjack', houseNet: net }); } catch {}
      blackjackGames.delete(k);
    } else if (s.type === 'roulette') {
      try { await postGameSessionEndByIds(interaction.client, guildId, userId, { game: 'Roulette', houseNet: (s.houseNet || 0) }); } catch {}
      rouletteSessions.delete(k);
    } else if (s.type === 'slots') {
      const ss = slotSessions.get(k);
      const houseNet = (ss && Number.isFinite(ss.houseNet)) ? ss.houseNet : (s.houseNet || 0);
      try { await postGameSessionEndByIds(interaction.client, guildId, userId, { game: 'Slots', houseNet }); } catch {}
      slotSessions.delete(k);
    } else if (s.type === 'dicewar') {
// Shared: Game sessions — track active sessions, UI message refs, timeouts, and summary embeds.
      try { await postGameSessionEndByIds(interaction.client, guildId, userId, { game: 'Dice War', houseNet: (s.houseNet || 0) }); } catch {}
    }
    clearActiveSession(guildId, userId);
  } catch (e) {
    console.error('endActiveSessionForUser error:', e);
  }
}
