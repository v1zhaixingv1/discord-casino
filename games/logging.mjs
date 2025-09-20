import { getGuildSettings, getUserBalances, getHouseBalance } from '../db.auto.mjs';
import { chipsAmount, chipsAmountSigned } from './format.mjs';
import { buildSessionEndEmbed, activeSessions, ACTIVE_TIMEOUT_MS, burnUpToCredits } from './session.mjs';
import { ridebusGames } from './ridebus.mjs';
import { blackjackGames } from './blackjack.mjs';
import { rouletteSessions } from './roulette.mjs';
import { slotSessions } from './slots.mjs';

export async function postGameLog(interaction, lines) {
  try {
    const guildId = interaction.guild?.id;
    if (!guildId) return;
    const settings = await getGuildSettings(guildId);
    const { log_channel_id } = settings || {};
    if (!log_channel_id) return;
    const ch = await interaction.client.channels.fetch(log_channel_id).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    const header = `🎮 **Game Log** • <t:${Math.floor(Date.now() / 1000)}:f>`;
    const context = `Server: **${interaction.guild.name}** • Player: <@${interaction.user.id}>`;
    const body = Array.isArray(lines) ? lines.join('\n') : String(lines);
    await ch.send(`${header}\n${context}\n${body}`);
  } catch (e) { console.error('postGameLog error:', e); }
}

export async function postGameSessionEnd(interaction, { game, userId, houseNet }) {
  try {
    const uid = userId || interaction.user?.id;
    const guildId = interaction.guild?.id;
    const { chips } = await getUserBalances(guildId, uid);
    const house = await getHouseBalance(guildId);
    const lines = [
      '🎮 **Game Session End**',
      `Game: **${game}**`,
      `Player: <@${uid}>`,
      `Player Balance: **${chipsAmount(chips)}**`,
      `House Balance: **${chipsAmount(house)}**`,
      `House Net: **${chipsAmountSigned(houseNet || 0)}**`
    ];
    await postGameLog(interaction, lines);
  } catch (e) { console.error('postGameSessionEnd error:', e); }
}

export async function postGameLogByIds(client, guildId, userId, lines) {
  try {
    if (!guildId) return;
    const settings = await getGuildSettings(guildId);
    const { log_channel_id } = settings || {};
    if (!log_channel_id) return;
    const ch = await client.channels.fetch(log_channel_id).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    let guildName = guildId;
    try { const g = await client.guilds.fetch(guildId); guildName = g?.name || guildName; } catch {}
    const header = `🎮 **Game Log** • <t:${Math.floor(Date.now() / 1000)}:f>`;
    const context = `Server: **${guildName}** • Player: <@${userId}>`;
    const body = Array.isArray(lines) ? lines.join('\n') : String(lines);
    await ch.send(`${header}\n${context}\n${body}`);
  } catch (e) { console.error('postGameLogByIds error:', e); }
}

export async function postGameSessionEndByIds(client, guildId, userId, { game, houseNet }) {
  try {
    const { chips } = await getUserBalances(guildId, userId);
    const house = await getHouseBalance(guildId);
    const lines = [
      '🎮 **Game Session End**',
      `Game: **${game}**`,
      `Player: <@${userId}>`,
      `Player Balance: **${chipsAmount(chips)}**`,
      `House Balance: **${chipsAmount(house)}**`,
      `House Net: **${chipsAmountSigned(houseNet || 0)}**`
    ];
    await postGameLogByIds(client, guildId, userId, lines);
  } catch (e) { console.error('postGameSessionEndByIds error:', e); }
}

export async function finalizeSessionUIByIds(client, guildId, userId) {
  try {
    const s = activeSessions.get(`${guildId}:${userId}`);
    if (!s?.msgChannelId || !s?.msgId) return;
    const ch = await client.channels.fetch(s.msgChannelId).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    const msg = await ch.messages.fetch(s.msgId).catch(() => null);
    if (!msg) return;
    const emb = await buildSessionEndEmbed(guildId, userId);
    await msg.edit({ embeds: [emb], components: [] }).catch(() => {});
  } catch (e) { console.error('finalizeSessionUIByIds error:', e); }
}

function parseKey(key) {
  const idx = key.indexOf(':');
  return idx > 0 ? [key.slice(0, idx), key.slice(idx + 1)] : [null, null];
}

export async function sweepExpiredSessions(client) {
  try {
    const now = Date.now();
    for (const [key, s] of Array.from(activeSessions.entries())) {
      if (now - (s.lastAt || 0) <= ACTIVE_TIMEOUT_MS) continue;
      const [guildId, userId] = parseKey(key);
      if (!guildId || !userId) { activeSessions.delete(key); continue; }
      try {
        await finalizeSessionUIByIds(client, guildId, userId);
        if (s.type === 'ridebus') {
          const st = ridebusGames.get(key);
          const chipsStake = st?.chipsStake || 0;
          if (st) { try { await burnUpToCredits(guildId, userId, Number(st.creditsStake) || 0, 'ridebus expired (timer)'); } catch {} }
          ridebusGames.delete(key);
          await postGameSessionEndByIds(client, guildId, userId, { game: 'Ride the Bus', houseNet: (s.houseNet || 0) + chipsStake });
        } else if (s.type === 'blackjack') {
          const st = blackjackGames.get(key);
          let chipsStake = 0;
          if (st) {
            if (st.split && Array.isArray(st.hands)) chipsStake = (st.hands?.[0]?.chipsStake || 0) + (st.hands?.[1]?.chipsStake || 0);
            else chipsStake = st.chipsStake || 0;
            try { await burnUpToCredits(guildId, userId, Number(st.creditsStake) || 0, 'blackjack expired (timer)'); } catch {}
          }
          blackjackGames.delete(key);
          await postGameSessionEndByIds(client, guildId, userId, { game: 'Blackjack', houseNet: (s.houseNet || 0) + chipsStake });
        } else if (s.type === 'roulette') {
          rouletteSessions.delete(key);
          await postGameSessionEndByIds(client, guildId, userId, { game: 'Roulette', houseNet: (s.houseNet || 0) });
        } else if (s.type === 'slots') {
          const ss = slotSessions.get(key);
          const houseNet = (ss && Number.isFinite(ss.houseNet)) ? ss.houseNet : 0;
          slotSessions.delete(key);
          await postGameSessionEndByIds(client, guildId, userId, { game: 'Slots', houseNet });
        } else if (s.type === 'dicewar') {
          await postGameSessionEndByIds(client, guildId, userId, { game: 'Dice War', houseNet: (s.houseNet || 0) });
        }
      } catch (e) { console.error('sweep end error:', e); }
      activeSessions.delete(key);
    }
  } catch (e) { console.error('sweepExpiredSessions error:', e); }
}

export async function postCashLog(interaction, lines) {
  try {
    const guildId = interaction.guild?.id;
    if (!guildId) return;
    const settings = await getGuildSettings(guildId);
    const { cash_log_channel_id } = settings || {};
    if (!cash_log_channel_id) return;
    const ch = await interaction.client.channels.fetch(cash_log_channel_id).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    const header = `💵 **Cash Log** • <t:${Math.floor(Date.now() / 1000)}:f>`;
    const context = `Server: **${interaction.guild.name}** • Actor: <@${interaction.user.id}>`;
    const body = Array.isArray(lines) ? lines.join('\n') : String(lines);
    await ch.send(`${header}\n${context}\n${body}`);
  } catch (e) { console.error('postCashLog error:', e); }
}
// Shared: Logging — posts game and cash events, finalizes expired sessions, and sweeps.
