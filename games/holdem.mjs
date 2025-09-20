import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import crypto from 'node:crypto';
import { postGameLogByIds } from './logging.mjs';
import { getGuildSettings, ensureHoldemTable, createHoldemHand, escrowAdd, escrowReturn, escrowCommit, escrowCreditMany, settleRake, finalizeHoldemHand, getEscrowBalance, getModRoles, getUserBalances } from '../db.auto.mjs';

// In-memory Table state; escrow/payouts are enforced via DB helpers.

export const holdemTables = new Map(); // key: `${guildId}:${channelId}` -> state

function syncKittenPersona(state, ctx) {
  if (!state || !ctx) return;
  try {
    if (typeof ctx.kittenModeEnabled === 'boolean') state.kittenMode = ctx.kittenModeEnabled;
    if (typeof ctx.kittenizeText === 'function') state.kittenizeText = ctx.kittenizeText;
    if (typeof ctx.kittenizePayload === 'function') state.kittenizePayload = ctx.kittenizePayload;
  } catch {}
}

function applyKittenPayload(state, payload) {
  if (!state || typeof state?.kittenizePayload !== 'function') return payload;
  try {
    return state.kittenizePayload(payload);
  } catch { return payload; }
}

function applyKittenText(state, text) {
  if (!state || typeof state?.kittenizeText !== 'function') return text;
  try {
    return state.kittenizeText(text);
  } catch { return text; }
}

export function tableKey(guildId, channelId) { return `${guildId}:${channelId}`; }

export function ensureTableInChannel(guildId, channelId) {
  const k = tableKey(guildId, channelId);
  return holdemTables.get(k) || null;
}

export function emptySeat(userId, stack = 0) {
  return { userId, stack, inHand: false, committed: 0, betRound: 0, folded: false, allIn: false, hole: [] };
}

function embedColorForPhase(phase) {
  switch (phase) {
    case 'PREFLOP': return 0x2b2d31; // dark
    case 'FLOP':    return 0x3BA55D; // subtle green
    case 'TURN':    return 0x1E90FF; // subtle blue
    case 'RIVER':   return 0xFEE75C; // subtle yellow
    case 'SHOWDOWN':return 0xEB459E; // fuchsia
    default:        return 0x5865F2; // blurple fallback
  }
}

export function buildTableEmbed(state) {
  const e = new EmbedBuilder()
    .setTitle('♠♥♦♣ Texas Hold’em')
    .setColor(embedColorForPhase(state.phase));

  // Prominent board at the top, with placeholders per street when a hand is active
  let boardLine = '—';
  if (state?.handNo) {
    const board = Array.isArray(state.board) ? state.board : [];
    const shown = board.map(formatCard);
    const placeholders = Array.from({ length: Math.max(0, 5 - shown.length) }, () => '🂠');
    boardLine = [...shown, ...placeholders].join('   ');
  }
  e.setDescription(`🎴 **Board**\n\n${boardLine}`);

  e.addFields(
    { name: 'Blinds', value: `SB **${state.sb}** • BB **${state.bb}**`, inline: true },
    { name: 'Buy-in', value: `Min **${state.min}** • Max **${state.max}**`, inline: true },
    { name: 'Phase', value: `${state.phase || 'LOBBY'}`, inline: true }
  );
  if (state.rakeBps) e.addFields({ name: 'Rake', value: `${(state.rakeBps||0)/100}%`, inline: true });
  const cap = Number(state.cap || 0) > 0 ? ` • Cap **${state.cap}**` : '';
  e.addFields({ name: 'Seats', value: `Players **${state.seats.length}**${cap}` , inline: true });
  const seated = state.seats.map((s, i) => {
    const tags = [ state.buttonIndex===i ? '🔘' : null, s.sitOut ? '(sit‑out)' : null ].filter(Boolean).join(' ');
    return `Seat ${i+1}: <@${s.userId}> — **${s.stack}** ${tags}`.trim();
    // return `Seat ${i+1}: My velvet Kitten <@${s.userId}> — **${s.stack}** ${tags}`.trim();
  });
  e.addFields({ name: 'Players', value: seated.length ? seated.join('\n') : '_No players yet_' });
  if (state.handNo) {
    e.addFields({ name: 'Hand', value: `#${state.handNo} • Pot: **${state.pot || 0}**` });
    try {
      const lines = state.seats.map((s,i)=>`Seat ${i+1}${state.buttonIndex===i?' 🔘':''}: <@${s.userId}> — Stack **${s.stack}** • Bet **${s.betRound||0}**${s.folded?' (folded)':''}${s.allIn?' (all-in)':''}`);
      // const lines = state.seats.map((s,i)=>`Seat ${i+1}${state.buttonIndex===i?' 🔘':''}: My velvet Kitten <@${s.userId}> — Stack **${s.stack}** • Bet **${s.betRound||0}**${s.folded?' (folded)':''}${s.allIn?' (all-in)':''}`);
      e.addFields({ name: 'Bets', value: lines.join('\n') });
    } catch {}
    // Action/Timer details are posted as a separate notice message, not in the embed
  }
  // Table timeout hint (only in lobby)
  try {
    if (state.phase === 'LOBBY' && state.closeDeadline) {
      const ts = Math.floor(state.closeDeadline / 1000);
      e.addFields({ name: '⏳ Table Timeout', value: `<t:${ts}:R>` });
    }
  } catch {}
  e.setFooter({ text: 'Note: Escrow/payouts not yet wired to chips.' });
  return e;
}

export function tableButtons(state) {
  const canStart = state.seats.length >= 2 && state.hostId;
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder().setCustomId('hold|join').setLabel('Join').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('hold|leave').setLabel('Leave').setStyle(ButtonStyle.Secondary)
  );
  const activeHand = ['PREFLOP','FLOP','TURN','RIVER'].includes(state.phase);
  if (!activeHand) {
    // Only show Start Hand in lobby to stay within the 5-button limit per row
    row.addComponents(new ButtonBuilder().setCustomId(`hold|start|${state.hostId||''}`).setLabel('Start Hand').setStyle(ButtonStyle.Primary).setDisabled(!canStart));
  } else {
    // During an active hand, show Peek Hand instead of Start Hand
    row.addComponents(new ButtonBuilder().setCustomId('hold|peek').setLabel('Peek Hand').setStyle(ButtonStyle.Secondary));
  }
  // Sit-out / Sit-in toggles (will validate per user on click)
  row.addComponents(new ButtonBuilder().setCustomId('hold|sitout').setLabel('Sit-out').setStyle(ButtonStyle.Secondary));
  row.addComponents(new ButtonBuilder().setCustomId('hold|sitin').setLabel('Sit-in').setStyle(ButtonStyle.Secondary));
  return row;
}

function suitEmoji(s) {
  return s === '♥' ? '♥️' : s === '♦' ? '♦️' : s === '♣' ? '♣️' : '♠️';
}
function formatCard(card) {
  if (!card) return '??';
  const suit = card[card.length - 1];
  const rank = card[0];
  return `${rank}${suitEmoji(suit)}`;
}

function buildTablePayload(state, content = null) {
  const embed = buildTableEmbed(state);
  const rows = [tableButtons(state)];
  const actRow = actionButtonsFor(state); if (actRow) rows.push(actRow);
  const payload = { embeds: [embed], components: rows };
  if (content) payload.content = content;
  return payload;
}

async function updateTableCard(client, state, payload = null) {
  try {
    if (!state.msgId) return false;
    const chId = state.msgChannelId || state.channelId;
    const ch = await client.channels.fetch(chId);
    if (!ch || !ch.isTextBased()) return false;
    const msg = await ch.messages.fetch(state.msgId);
    const data = payload || buildTablePayload(state);
    const personaPayload = applyKittenPayload(state, data);
    await msg.edit(personaPayload);
    return true;
  } catch { return false; }
}

export async function setTableRake(interaction, percent, cap = null) {
  const state = ensureTableInChannel(interaction.guild.id, interaction.channelId);
  if (!state) return interaction.reply({ content: '❌ No Hold’em table in this channel.', ephemeral: true });
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const bps = Math.floor(pct * 100);
  // Cap is always the table's Max buy-in
  state.rakeBps = bps;
  state.rakeCap = Math.max(0, Number(state.max) || 0);
  try { await updateTableCard(interaction.client, state); } catch {}
  const fmt = new Intl.NumberFormat('en-US');
  return interaction.reply({ content: `✅ Rake set to **${pct.toFixed(2)}%** (cap = table max buy‑in **${fmt.format(state.max)}**).`, ephemeral: true });
}

function getTableChannel(client, state) {
  return (async () => {
    try {
      const chId = state.msgChannelId || state.channelId;
      const ch = await client.channels.fetch(chId);
      return (ch && ch.isTextBased()) ? ch : null;
    } catch { return null; }
  })();
}

async function postOrEditNotice(client, state, content) {
  try {
    const ch = await getTableChannel(client, state);
    if (!ch) return;
    if (state.noticeMsgId) {
      try {
        const msg = await ch.messages.fetch(state.noticeMsgId);
        const payload = applyKittenPayload(state, { content });
        await msg.edit(payload);
        return;
      } catch {}
    }
    const sent = await ch.send(applyKittenPayload(state, { content }));
    state.noticeMsgId = sent.id;
  } catch {}
}

async function deleteNotice(client, state) {
  try {
    if (!state.noticeMsgId) return;
    const ch = await getTableChannel(client, state);
    if (!ch) return;
    const msg = await ch.messages.fetch(state.noticeMsgId).catch(() => null);
    if (msg) await msg.delete().catch(()=>{});
  } catch {}
  try { state.noticeMsgId = null; } catch {}
}

function touchHostActivity(client, state) {
  try { if (!state?.hostId) return; scheduleHostKick(client, state, 10 * 60 * 1000); } catch {}
}

async function announce(client, state, text) {
  try {
    const ch = await getTableChannel(client, state);
    if (ch) {
      const personaText = applyKittenText(state, text);
      await ch.send({ content: personaText });
    }
  } catch {}
}

function assignNewHost(state) {
  try {
    const next = state.seats?.[0]?.userId || null;
    state.hostId = next;
  } catch { state.hostId = null; }
}

async function kickHostForInactivity(client, state) {
  try {
    const hostId = state.hostId; if (!hostId) return;
    const idx = state.seats.findIndex(s => s.userId === hostId);
    if (idx === -1) return;
    // If host is to act, auto-fold them first
    try {
      if (Number.isInteger(state.toAct) && state.seats[state.toAct]?.userId === hostId) {
        await doFold(state);
      }
    } catch {}
    // Refund any remaining escrow to host
    try {
      const bal = Number(await getEscrowBalance(state.channelId, hostId) || 0);
      if (bal > 0) await escrowReturn(state.channelId, hostId, bal);
    } catch {}
    // Remove the seat
    state.seats.splice(idx, 1);
    // Reassign host if possible
    assignNewHost(state);
    // Advance game if needed
    const result = afterActionMaybeAdvance(state);
    if (state.phase === 'COMPLETE' && result) {
      try { await updateTableCard(client, state, buildResultPayload(state, result)); } catch {}
      scheduleNextHand(client, state, result, 10000).catch(() => {});
    } else {
      // If no players left, go to lobby and schedule empty close
      if (state.seats.length === 0) {
        state.phase = 'LOBBY'; state.board = []; state.pot = 0; state.toAct = null;
        await updateTableCard(client, state, buildTablePayload(state, '🪑 Waiting for players…'));
        scheduleEmptyClose(client, state);
      } else {
        try { armActionTimer(client, state, 30000); } catch {}
        await updateTableCard(client, state);
      }
    }
    await announce(client, state, `🚫 Host <@${hostId}> removed due to 10 minutes of inactivity.${state.hostId ? ` New host: <@${state.hostId}>.` : ''}`);
    // await announce(client, state, `🚫 My vigilant Kitten <@${hostId}> was whisked away after 10 minutes.${state.hostId ? ` Another Kitten <@${state.hostId}> now hosts.` : ''}`);
    // Schedule kick timer for new host (if any)
    scheduleHostKick(client, state, 10 * 60 * 1000);
  } catch {}
}

function scheduleHostKick(client, state, ms = 10 * 60 * 1000) {
  try { if (state.hostKickTimer) { clearTimeout(state.hostKickTimer); state.hostKickTimer = null; } } catch {}
  if (!state?.hostId) return;
  state.hostKickDeadline = Date.now() + ms;
  state.hostKickTimer = setTimeout(() => { kickHostForInactivity(client, state).catch(()=>{}); }, ms);
}

function removeUnderBBSeats(state) {
  try {
    const bb = Number(state.bb) || 0;
    const removed = [];
    const kept = [];
    for (const s of state.seats) {
      if (s.stack < bb) removed.push({ userId: s.userId, stack: s.stack }); else kept.push(s);
    }
    if (removed.length) {
      state.seats = kept;
      state.buttonIndex = 0;
      state.toAct = null;
    }
    return removed;
  } catch { return []; }
}

async function notifyAutoKick(client, state, removed) {
  try {
    if (!removed?.length) return;
    const bb = Number(state.bb) || 0;
    for (const r of removed) {
      try {
        const user = await client.users.fetch(r.userId);
        const msg = applyKittenText(state, `🚫 You were removed from the Hold’em table — insufficient chips to cover the big blind (${bb}).`);
        await user.send(msg);
      } catch {}
    }
  } catch {}
}

function buildClosedPayload(mode = 'empty') {
  const desc = mode === 'idle'
    ? 'Table idle for 10 minutes without a hand.'
    : 'No players for 2 minutes.';
  const e = new EmbedBuilder().setTitle('🛑 Table closed').setColor(0x2b2d31).setDescription(desc);
  return { content: '', embeds: [e], components: [] };
}

async function closeTable(client, state, mode = 'empty') {
  try {
    // Stop timers
    try { if (state.closeTimer) clearTimeout(state.closeTimer); } catch {}
    try { if (state.actionTimer) clearTimeout(state.actionTimer); } catch {}
    try { if (state.warningTimer) clearTimeout(state.warningTimer); } catch {}
    try { if (state.nextHandTimer) clearTimeout(state.nextHandTimer); } catch {}
    try { if (state.nextHandInterval) clearInterval(state.nextHandInterval); } catch {}
    state.closeTimer = state.actionTimer = state.warningTimer = state.nextHandTimer = state.nextHandInterval = null;
    state.closeDeadline = null; state.closeMode = null;
    // If this was a temporary channel, delete it; otherwise update UI
    if (state.tempChannel) {
      try {
        const chId = state.msgChannelId || state.channelId;
        const ch = await client.channels.fetch(chId).catch(() => null);
        if (ch && ch.deletable) await ch.delete(`Hold'em table closed (${mode})`);
      } catch {}
    } else {
      try { await updateTableCard(client, state, buildClosedPayload(mode)); } catch {}
    }
  } catch {}
  // Also delete the original "table created" summary message, if we know it
  try {
    if (state.originMsgChannelId && state.originMsgId) {
      const och = await client.channels.fetch(state.originMsgChannelId).catch(() => null);
      if (och && och.isTextBased && och.isTextBased()) {
        const om = await och.messages.fetch(state.originMsgId).catch(() => null);
        if (om) await om.delete().catch(() => {});
      }
    }
  } catch {}
  try {
    // Remove from registry so new tables can be created
    holdemTables.delete(tableKey(state.guildId, state.channelId));
  } catch {}
}

function scheduleEmptyClose(client, state, ms = 2 * 60 * 1000) {
  try { if (state.closeTimer) { clearTimeout(state.closeTimer); state.closeTimer = null; } } catch {}
  if (!state || state.seats.length > 0) return;
  state.closeMode = 'empty';
  state.closeDeadline = Date.now() + ms;
  state.closeTimer = setTimeout(() => {
    try { if (state.seats.length === 0) closeTable(client, state, 'empty'); } catch {}
    try { state.closeTimer = null; } catch {}
  }, ms);
}

function scheduleLobbyClose(client, state, ms = 10 * 60 * 1000) {
  try { if (state.closeTimer) { clearTimeout(state.closeTimer); state.closeTimer = null; } } catch {}
  if (!state || state.seats.length === 0) return; // use empty close instead
  if (state.phase !== 'LOBBY') return; // only when waiting to start
  state.closeMode = 'lobby';
  state.closeDeadline = Date.now() + ms;
  state.closeTimer = setTimeout(() => {
    try { if (state.phase === 'LOBBY' && state.seats.length >= 1) closeTable(client, state, 'idle'); } catch {}
    try { state.closeTimer = null; } catch {}
  }, ms);
}
function actionButtonsFor(state) {
  if (!Number.isInteger(state.toAct)) return null;
  const idx = state.toAct; const seat = state.seats[idx];
  if (!seat || seat.folded || !seat.inHand) return null;
  const callAmt = Math.max(0, (state.currentBet||0) - (seat.betRound||0));
  const canBetOrRaise = seat.stack > callAmt; // has chips beyond a call (or any chips if check spot)
  const cannotCoverCall = callAmt > 0 && seat.stack < callAmt;
  const row = new ActionRowBuilder();
  row.addComponents(new ButtonBuilder().setCustomId(`hold|act|fold|${seat.userId}`).setLabel('Fold').setStyle(ButtonStyle.Danger));
  if (cannotCoverCall) {
    // Only All-in or Fold are valid options
    if (seat.stack > 0) {
      row.addComponents(new ButtonBuilder().setCustomId(`hold|act|allin|${seat.userId}`).setLabel(`All-in (${seat.stack})`).setStyle(ButtonStyle.Success));
    }
  } else {
    if (callAmt > 0) {
      row.addComponents(new ButtonBuilder().setCustomId(`hold|act|call|${seat.userId}`).setLabel(`Call ${callAmt}`).setStyle(ButtonStyle.Secondary));
    } else {
      row.addComponents(new ButtonBuilder().setCustomId(`hold|act|check|${seat.userId}`).setLabel('Check').setStyle(ButtonStyle.Secondary));
    }
    if (canBetOrRaise) {
      // Unified label for opening/raising action
      row.addComponents(new ButtonBuilder().setCustomId(`hold|act|raise|${seat.userId}`).setLabel('Bet/Raise').setStyle(ButtonStyle.Primary));
    }
    if (seat.stack > 0) {
      row.addComponents(new ButtonBuilder().setCustomId(`hold|act|allin|${seat.userId}`).setLabel('All-in').setStyle(ButtonStyle.Success));
    }
  }
  return row;
}

function firstActiveAfter(state, startIdx) {
  const n = state.seats.length; if (!n) return null;
  for (let i = 1; i <= n; i++) { const idx = (startIdx + i) % n; const s = state.seats[idx]; if (s && s.inHand && !s.folded && !s.allIn) return idx; }
  return null;
}

function activeInHand(state) { return state.seats.filter(s => s.inHand && !s.folded); }

function resetRoundFlags(state) {
  for (const s of state.seats) { if (s.inHand && !s.folded) { s.betRound = s.betRound || 0; s.actedRound = false; } }
}

function computeNeeders(state) {
  const need = [];
  const cb = state.currentBet || 0;
  state.seats.forEach((s, i) => {
    if (!s.inHand || s.folded || s.allIn) return;
    if (!s.actedRound) { need.push(i); return; }
    if ((s.betRound || 0) < cb) need.push(i);
  });
  return need;
}

function roundIsDone(state) { return computeNeeders(state).length === 0; }

function setToActForStreet(state, street) {
  if (street === 'PREFLOP') {
    // Already set in startHand to seat after BB
    return;
  }
  const afterBtn = firstActiveAfter(state, state.buttonIndex ?? 0);
  state.toAct = afterBtn ?? null;
}

function burnAndDeal(state, count) {
  try {
    state.burned = Array.isArray(state.burned) ? state.burned : [];
    const burn = state.deck.pop();
    if (burn) state.burned.push(burn);
  } catch {}
  for (let i = 0; i < count; i++) state.board.push(state.deck.pop());
}

async function advanceStreet(state) {
  if (state.phase === 'PREFLOP') { state.phase = 'FLOP'; state.board = []; burnAndDeal(state, 3); }
  else if (state.phase === 'FLOP') { state.phase = 'TURN'; burnAndDeal(state, 1); }
  else if (state.phase === 'TURN') { state.phase = 'RIVER'; burnAndDeal(state, 1); }
  else { state.phase = 'SHOWDOWN'; }
  // Reset betting for new street (except SHOWDOWN)
  if (state.phase !== 'SHOWDOWN') {
    state.currentBet = 0;
    state.minRaise = state.bb;
    for (const s of state.seats) { if (s.inHand && !s.folded) { s.betRound = 0; s.actedRound = false; } }
    setToActForStreet(state, state.phase);
  }
}

function onlyOneActive(state) {
  let idx = -1; let count = 0;
  for (let i = 0; i < state.seats.length; i++) { const s = state.seats[i]; if (s.inHand && !s.folded) { idx = i; count++; if (count > 1) break; } }
  return count === 1 ? idx : -1;
}

function nextToAct(state) {
  if (!Number.isInteger(state.toAct)) return null;
  const n = state.seats.length; if (!n) return null;
  for (let step = 1; step <= n; step++) {
    const idx = (state.toAct + step) % n; const s = state.seats[idx];
    if (!s || !s.inHand || s.folded || s.allIn) continue;
    // Needs action per our rules
    if (!s.actedRound) return idx;
    if ((s.betRound || 0) < (state.currentBet || 0)) return idx;
  }
  return null;
}

function clearActionTimer(state) {
  try { if (state.actionTimer) { clearTimeout(state.actionTimer); state.actionTimer = null; } } catch {}
  try { if (state.warningTimer) { clearTimeout(state.warningTimer); state.warningTimer = null; } } catch {}
  state.actionUserId = null; state.actionDeadline = null;
}

function armActionTimer(client, state, ms = 30000) {
  try { if (!Number.isInteger(state.toAct)) { clearActionTimer(state); return; } } catch {}
  const seat = state.seats[state.toAct];
  if (!seat || seat.folded || !seat.inHand) { clearActionTimer(state); return; }
  state.actionUserId = seat.userId;
  state.actionDeadline = Date.now() + ms;
  try { if (state.actionTimer) clearTimeout(state.actionTimer); } catch {}
  // Send immediate turn notice in the table channel (single message reused)
  (async () => {
    try {
      const ts = Math.floor(state.actionDeadline / 1000);
      await postOrEditNotice(client, state, `⏰ <@${state.actionUserId}>, it's your turn to act • <t:${ts}:R>`);
      // await postOrEditNotice(client, state, `⏰ Glide forward, Kitten <@${state.actionUserId}> — it's your turn • <t:${ts}:R>`);
    } catch {}
  })();
  // Schedule 10-second warning
  try { if (state.warningTimer) clearTimeout(state.warningTimer); } catch {}
  state.warningTimer = setTimeout(async () => {
    try {
      if (!state || !Number.isInteger(state.toAct)) return;
      const cur = state.seats[state.toAct];
      if (!cur || cur.userId !== state.actionUserId) return;
      const ts = Math.floor(state.actionDeadline / 1000);
      await postOrEditNotice(client, state, `⏳ <@${state.actionUserId}> 10 seconds left to act • <t:${ts}:R>`);
      // await postOrEditNotice(client, state, `⏳ Only ten seconds remain, precious Kitten <@${state.actionUserId}> • <t:${ts}:R>`);
    } catch {}
  }, Math.max(0, ms - 10000));
  state.actionTimer = setTimeout(async () => {
    try {
      if (!state || !Number.isInteger(state.toAct)) return;
      const cur = state.seats[state.toAct];
      if (!cur || cur.userId !== state.actionUserId) return;
      await doFold(state);
      const result = afterActionMaybeAdvance(state);
      if (state.phase === 'COMPLETE' && result) {
        try { await updateTableCard(client, state, buildResultPayload(state, result)); } catch {}
        scheduleNextHand(client, state, result, 10000).catch(() => {});
      } else {
        try { armActionTimer(client, state, 30000); } catch {}
        try { await updateTableCard(client, state); } catch {}
      }
    } catch {}
  }, ms);
}

function endHandToWinner(state, winnerIdx, note = 'Everyone else folded') {
  const w = state.seats[winnerIdx];
  const amount = state.pot || 0;
  w.stack += amount; state.pot = 0; state.phase = 'COMPLETE';
  return { winners: [winnerIdx], label: `Hand ends — ${note}`, payouts: [{ idx: winnerIdx, amount }] };
}

// --- Simple 7-card evaluator ---
const RANK_ORDER = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };

function ranksSorted(cards) { return cards.map(c=>RANK_ORDER[c[0]]).sort((a,b)=>b-a); }

function findStraight(vals) {
  // vals: unique, sorted desc
  const u = Array.from(new Set(vals)).sort((a,b)=>b-a);
  // Ace-low straight: treat Ace as 1
  if (u[0] === 14) u.push(1);
  let run = 1; let bestHigh = -1;
  for (let i=1;i<u.length;i++) {
    if (u[i] === u[i-1]-1) { run++; if (run>=5) { bestHigh = u[i-4] === 14 && u[i] === 10 ? 14 : u[i-4]; } }
    else run = 1;
  }
  if (bestHigh === -1) return null;
  // Build straight ranks list descending from high
  const seq = [bestHigh, bestHigh-1, bestHigh-2, bestHigh-3, bestHigh-4].map(v=>v===1?14:v);
  return seq;
}

function evaluate7(cards) {
  // cards like 'A♠'
  const bySuit = new Map();
  for (const c of cards) { const s = c[c.length-1]; if (!bySuit.has(s)) bySuit.set(s, []); bySuit.get(s).push(c); }
  const flushSuit = Array.from(bySuit.entries()).find(([s, arr]) => arr.length >= 5)?.[0] || null;
  let flushCards = flushSuit ? bySuit.get(flushSuit) : [];
  const valsAll = ranksSorted(cards);
  const counts = new Map();
  for (const c of cards) { const r = c[0]; counts.set(r, (counts.get(r)||0)+1); }
  const groups = Array.from(counts.entries()).map(([r,c])=>({r, c, v:RANK_ORDER[r]})).sort((a,b)=> b.c - a.c || b.v - a.v);

  // Straight flush
  if (flushSuit) {
    const sfVals = ranksSorted(flushCards);
    const sf = findStraight(sfVals);
    if (sf) return { cat:8, ranks: sf, label: `Straight Flush (${rankName(sf[0])}-high)` };
  }
  // Four of a kind
  if (groups[0]?.c === 4) {
    const quad = groups[0].v; const kick = valsAll.find(v => v !== quad) || 0;
    return { cat:7, ranks: [quad, kick], label: `Four of a Kind (${rankName(quad)})` };
  }
  // Full house (3+2)
  const trips = groups.filter(g=>g.c===3).map(g=>g.v);
  const pairs = groups.filter(g=>g.c===2).map(g=>g.v);
  if (trips.length>=1 && (pairs.length>=1 || trips.length>=2)) {
    const t = trips[0]; const p = pairs.length ? pairs[0] : trips[1];
    return { cat:6, ranks: [t,p], label: `Full House (${rankName(t)} over ${rankName(p)})` };
  }
  // Flush
  if (flushSuit) {
    const top5 = ranksSorted(flushCards).slice(0,5);
    return { cat:5, ranks: top5, label: `Flush (${rankName(top5[0])}-high)` };
  }
  // Straight
  const st = findStraight(valsAll);
  if (st) return { cat:4, ranks: st, label: `Straight (${rankName(st[0])}-high)` };
  // Trips
  if (trips.length>=1) {
    const t = trips[0];
    const kickers = valsAll.filter(v=>v!==t).slice(0,2);
    return { cat:3, ranks: [t, ...kickers], label: `Three of a Kind (${rankName(t)})` };
  }
  // Two pair
  if (pairs.length>=2) {
    const [p1,p2] = pairs.slice(0,2);
    const kick = valsAll.find(v=>v!==p1 && v!==p2) || 0;
    return { cat:2, ranks: [p1,p2,kick], label: `Two Pair (${rankName(p1)} & ${rankName(p2)})` };
  }
  // One pair
  if (pairs.length>=1) {
    const p = pairs[0];
    const kickers = valsAll.filter(v=>v!==p).slice(0,3);
    return { cat:1, ranks: [p, ...kickers], label: `Pair of ${rankName(p)}s` };
  }
  // High card
  const top = valsAll.slice(0,5);
  return { cat:0, ranks: top, label: `${rankName(top[0])}-high` };
}

function rankName(v) {
  const map = {11:'Jack',12:'Queen',13:'King',14:'Ace'};
  if (v>=2 && v<=10) return String(v);
  return map[v] || String(v);
}

function compareHands(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const len = Math.max(a.ranks.length, b.ranks.length);
  for (let i=0;i<len;i++) { const av=a.ranks[i]||0, bv=b.ranks[i]||0; if (av!==bv) return av - bv; }
  return 0;
}

function showdown(state) {
  // Build side pots from total committed amounts
  const players = state.seats.map((s, i) => ({ i, s, committed: Math.max(0, s.committed || 0), folded: !!s.folded, inHand: !!s.inHand }));
  const remaining = players.map(p => ({ i: p.i, amt: p.committed }));
  const pots = [];
  // Create layered pots (main pot first, then side pots)
  while (true) {
    const contributors = remaining.filter(r => r.amt > 0);
    if (contributors.length === 0) break;
    const minAmt = Math.min(...contributors.map(r => r.amt));
    const amount = contributors.reduce((sum, r) => sum + minAmt, 0);
    const eligibles = contributors.map(r => r.i).filter(i => players[i].inHand && !players[i].folded);
    pots.push({ amount, eligibles });
    for (const r of contributors) r.amt -= minAmt;
  }
  // Apply rake (from total pot) before distribution
  let totalPot = pots.reduce((s,p)=>s+(p.amount||0),0);
  let rake = 0;
  try {
    const bps = Math.max(0, Number(state.rakeBps||0));
    const cap = Math.max(0, Number(state.rakeCap||0));
    if (bps > 0 && totalPot > 0) {
      rake = Math.floor(totalPot * bps / 10000);
      if (cap > 0) rake = Math.min(rake, cap);
      let remaining = rake;
      for (let i=0;i<pots.length && remaining>0;i++) { const take = Math.min(pots[i].amount, remaining); pots[i].amount -= take; remaining -= take; }
      totalPot -= rake;
    }
  } catch {}
  // Evaluate hands cache
  const evalCache = new Map();
  const evalFor = (i) => {
    if (evalCache.has(i)) return evalCache.get(i);
    const res = evaluate7([...(state.seats[i].hole || []), ...(state.board || [])]);
    evalCache.set(i, res);
    return res;
  };
  // Distribute each pot and capture per-pot winners
  const payoutMap = new Map(); // idx -> amount
  const potResults = [];
  for (let pi = 0; pi < pots.length; pi++) {
    const pot = pots[pi];
    const elig = pot.eligibles;
    if (!elig || elig.length === 0) continue;
    let bestIdx = []; let bestRes = null;
    for (const i of elig) {
      const r = evalFor(i);
      if (!bestRes || compareHands(r, bestRes) > 0) { bestRes = r; bestIdx = [i]; }
      else if (compareHands(r, bestRes) === 0) { bestIdx.push(i); }
    }
    const share = Math.floor(pot.amount / bestIdx.length);
    let remainder = pot.amount - share * bestIdx.length;
    const winnersArr = [];
    let oddIdx = bestIdx[0];
    try {
      const set = new Set(bestIdx);
      const n = state.seats.length;
      const start = (state.buttonIndex ?? -1) + 1;
      for (let step = 0; step < n; step++) { const idx = (start + step) % n; if (set.has(idx)) { oddIdx = idx; break; } }
    } catch {}
    bestIdx.forEach((i) => {
      const add = share + (remainder > 0 && i === oddIdx ? 1 : 0);
      if (remainder > 0 && i === oddIdx) remainder -= 1;
      payoutMap.set(i, (payoutMap.get(i) || 0) + add);
      winnersArr.push({ idx: i, amount: add });
    });
    potResults.push({ amount: pot.amount, winners: winnersArr });
  }
  // Apply payouts to stacks
  const payouts = [];
  for (const [idx, amt] of payoutMap.entries()) {
    state.seats[idx].stack = (state.seats[idx].stack || 0) + amt;
    payouts.push({ idx, amount: amt });
  }
  // Overall best for label readability
  const activeIdx = players.filter(p => p.inHand && !p.folded).map(p => p.i);
  const overall = activeIdx.map(i => ({ idx: i, res: evalFor(i) })).sort((A,B)=>compareHands(A.res,B.res)).reverse();
  const bestOverall = overall[0]?.res;
  const topIdx = overall.filter(x => compareHands(x.res, bestOverall) === 0).map(x => x.idx);
  const labels = topIdx.map(i => `<@${state.seats[i].userId}>`).join(', ');
  // const labels = topIdx.map(i => `Gorgeous Kitten <@${state.seats[i].userId}>`).join(', ');
  const label = `Showdown — ${labels}${topIdx.length>1?' (split)':''}`;
  state.pot = 0; state.phase = 'COMPLETE';
  return { winners: topIdx, label: bestOverall ? `${label} • ${bestOverall.label}` : label, payouts, pots: potResults, rake };
}

function afterActionMaybeAdvance(state) {
  // Check early win by folds
  const lone = onlyOneActive(state);
  if (lone !== -1) return endHandToWinner(state, lone);
  // If all remaining are all-in, run out board to showdown
  const actives = activeInHand(state);
  if (actives.length>0 && actives.every(s=>s.allIn)) {
    if (state.phase === 'PREFLOP') { state.board = []; burnAndDeal(state, 3); }
    if (state.phase === 'PREFLOP' || state.phase === 'FLOP') burnAndDeal(state, 1);
    if (state.phase === 'TURN') burnAndDeal(state, 1);
    state.phase = 'SHOWDOWN';
    return showdown(state);
  }
  // If round complete, advance to next street or showdown
  if (roundIsDone(state)) {
    // Return any uncalled portion of the highest bet back to its bettor
    try { refundUncalledBet(state); } catch {}
    if (state.phase === 'RIVER') { state.phase = 'SHOWDOWN'; return showdown(state); }
    advanceStreet(state);
    // After advancing, if only one player can act for the rest of the hand,
    // immediately run out remaining streets to showdown.
    const auto = maybeAutoRunToShowdownIfOnlyOneCanAct(state);
    if (auto) return auto;
  }
  // Set next toAct if still in betting
  if (state.phase !== 'COMPLETE' && state.phase !== 'SHOWDOWN') {
    const nxt = nextToAct(state); if (nxt !== null) state.toAct = nxt;
  }
  return null;
}

function maybeAutoRunToShowdownIfOnlyOneCanAct(state) {
  try {
    const actives = activeInHand(state);
    if (actives.length < 2) return null; // covered by lone-win case elsewhere
    const canAct = actives.filter(s => !s.allIn);
    if (canAct.length <= 1) {
      // Run out remaining streets to showdown
      if (state.phase === 'PREFLOP') { state.board = []; burnAndDeal(state, 3); burnAndDeal(state, 1); burnAndDeal(state, 1); }
      else if (state.phase === 'FLOP') { burnAndDeal(state, 1); burnAndDeal(state, 1); }
      else if (state.phase === 'TURN') { burnAndDeal(state, 1); }
      state.phase = 'SHOWDOWN';
      return showdown(state);
    }
  } catch {}
  return null;
}

// --- Player actions ---
function refundUncalledBet(state) {
  try {
    // Consider only active (in-hand, not folded) players
    const actives = state.seats
      .map((s, i) => ({ i, s }))
      .filter(x => x.s && x.s.inHand && !x.s.folded);
    if (actives.length === 0) return 0;
    // Find leader by current round contribution
    let leader = actives[0];
    for (const x of actives) { if ((x.s.betRound || 0) > (leader.s.betRound || 0)) leader = x; }
    const leaderAmt = leader.s.betRound || 0;
    if (leaderAmt <= 0) return 0;
    // Highest matched amount among other actives
    let otherMax = 0;
    for (const x of actives) { if (x.i === leader.i) continue; otherMax = Math.max(otherMax, x.s.betRound || 0); }
    if (otherMax >= leaderAmt) return 0;
    const refund = leaderAmt - otherMax;
    // Apply refund: reduce pot, return to stack, lower displayed betRound to matched
    leader.s.betRound = otherMax;
    state.pot = Math.max(0, (state.pot || 0) - refund);
    leader.s.stack = (leader.s.stack || 0) + refund;
    leader.s.committed = Math.max(0, (leader.s.committed || 0) - refund);
    // Also adjust currentBet down to matched amount
    state.currentBet = otherMax;
    return refund;
  } catch { return 0; }
}
async function doFold(state) {
  const i = state.toAct; const s = state.seats[i]; if (!s) return;
  s.folded = true; s.inHand = true; s.actedRound = true;
}

async function doCheck(state) {
  const i = state.toAct; const s = state.seats[i]; if (!s) return;
  // Allowed only if matched currentBet
  const need = Math.max(0, (state.currentBet||0) - (s.betRound||0));
  if (need > 0) return; // invalid but we just ignore in this prototype
  s.actedRound = true;
}

async function doCall(state) {
  const i = state.toAct; const s = state.seats[i]; if (!s) return;
  const need = Math.max(0, (state.currentBet||0) - (s.betRound||0));
  const pay = Math.min(need, s.stack);
  s.stack -= pay; s.betRound = (s.betRound||0) + pay; s.committed += pay; state.pot += pay; s.actedRound = true;
  if (s.stack === 0) s.allIn = true;
}

async function doAllIn(state) {
  const i = state.toAct; const s = state.seats[i]; if (!s) return;
  const maxPut = s.stack; if (maxPut <= 0) return;
  let target = (s.betRound||0) + maxPut;
  const newRaise = target - (state.currentBet||0);
  s.stack = 0; s.betRound = target; s.committed += maxPut; state.pot += maxPut; s.allIn = true; s.actedRound = true;
  if (newRaise > 0) {
    // Treat as raise (may be a partial raise; we keep minRaise unchanged if partial)
    if (state.currentBet === 0) state.minRaise = maxPut; else state.minRaise = Math.max(state.minRaise, newRaise);
    state.currentBet = target;
  }
}

async function doBetOrRaise(state, amount) {
  const i = state.toAct; const s = state.seats[i]; if (!s) return false;
  if (!Number.isInteger(amount) || amount <= 0) return false;
  if (amount >= s.stack) { await doAllIn(state); return true; }
  const target = (s.betRound||0) + amount;
  if ((state.currentBet||0) === 0) {
    // Bet
    if (amount < state.bb) return false; // min open = BB
    s.stack -= amount; s.betRound = target; s.committed += amount; state.pot += amount; s.actedRound = true;
    state.currentBet = target; state.minRaise = amount;
    return true;
  } else {
    // Raise
    const needed = (state.currentBet||0) - (s.betRound||0);
    if (amount <= needed) return false; // must exceed a call
    const raiseSize = target - (state.currentBet||0);
    if (raiseSize < state.minRaise) return false; // not a full raise
    s.stack -= amount; s.betRound = target; s.committed += amount; state.pot += amount; s.actedRound = true;
    state.currentBet = target; state.minRaise = raiseSize;
    return true;
  }
}

async function startHandAuto(client, state) {
  try {
    if (!state) return;
    // Auto-kick players who cannot cover the BB before starting a new hand
    const removed = removeUnderBBSeats(state);
    if (removed.length) { await notifyAutoKick(client, state, removed); await updateTableCard(client, state); }
    if (state.seats.length < 2) {
      state.phase = 'LOBBY';
      state.board = [];
      state.pot = 0;
      state.toAct = null;
      if (state?.seats?.length === 1) state.hostId = state.seats[0].userId;
      await updateTableCard(client, state, buildTablePayload(state, '🪑 Waiting for players…'));
      if (state?.seats?.length === 0) { try { scheduleEmptyClose(client, state); } catch {} }
      return;
    }
    // Clear any lobby close timers
    try { if (state.closeTimer) { clearTimeout(state.closeTimer); state.closeTimer = null; } } catch {}
    state.closeDeadline = null; state.closeMode = null;
    state.handNo = (state.handNo || 0) + 1;
    state.board = [];
    state.burned = [];
    state.pot = 0;
    try { state.handDbId = await createHoldemHand(state.channelId, state.handNo, '', '[]', 0); } catch {}
    state.deck = makeDeck();
    state.phase = 'PREFLOP';
    // Rotate button
    state.buttonIndex = state.seats.length ? firstActiveAfter(state, (state.buttonIndex ?? -1)) ?? ((state.buttonIndex ?? -1) + 1) % state.seats.length : 0;
    // Reset seats
    for (const s of state.seats) { s.inHand = true; s.committed = 0; s.betRound = 0; s.folded = false; s.allIn = false; }
    // Post blinds
    const sbIndex = firstActiveAfter(state, state.buttonIndex ?? 0) ?? 0;
    const bbIndex = firstActiveAfter(state, sbIndex) ?? 0;
    // Enforce wait-for-BB sitout until BB
    state.seats.forEach((s, i) => { if (s.waitForBB && i !== bbIndex) { s.inHand = false; s.actedRound = true; } });
    // Apply sit-out: do not deal, and count missed BBs; auto-leave after two missed BBs
    const toRemove = [];
    state.seats.forEach((s, i) => {
      if (s.sitOut) {
        s.inHand = false; s.actedRound = true;
        if (i === bbIndex) {
          s.missedBlinds = (s.missedBlinds || 0) + 1;
          if (s.missedBlinds >= 2) toRemove.push(i);
        }
      }
    });
    if (toRemove.length) {
      // Remove from highest index to lowest to avoid reindex issues
      const sorted = [...toRemove].sort((a, b) => b - a);
      for (const i of sorted) {
        try {
          const removed = state.seats[i];
          if (removed?.userId) {
            try {
              const bal = Number(await getEscrowBalance(state.channelId, removed.userId) || 0);
              if (bal > 0) await escrowReturn(state.channelId, removed.userId, bal);
            } catch {}
          }
          const seat = state.seats.splice(i, 1)[0];
          if (seat) announce(interaction.client, state, `🚫 <@${seat.userId}> removed after missing two big blinds.`);
          // if (seat) announce(interaction.client, state, `🚫 Naughty Kitten <@${seat.userId}> slipped away after missing two big blinds.`);
        } catch {}
      }
    }
    if (state.seats[bbIndex]?.waitForBB) { try { state.seats[bbIndex].waitForBB = false; } catch {} }
    const post = async (i, amt, label) => {
      const seat = state.seats[i];
      if (!seat?.inHand) return null;
      const pay = Math.min(amt, seat.stack);
      seat.stack -= pay;
      seat.committed += pay;
      seat.betRound += pay;
      state.pot += pay;
      try { await escrowCommit(state.channelId, seat.userId, state.handDbId, 'PREFLOP', pay); } catch {}
      if (pay < amt) seat.allIn = true;
      return `${label} <@${seat.userId}> ${pay}`;
    };
    const postLines = (await Promise.all([
      post(sbIndex, state.sb, 'SB'),
      post(bbIndex, state.bb, 'BB')
    ])).filter(Boolean);
    // Deal
    for (let i = 0; i < state.seats.length; i++) { const seat = state.seats[i]; if (!seat.inHand) continue; const c1 = state.deck.pop(); const c2 = state.deck.pop(); seat.hole = [c1, c2]; }
  // Action order
  state.toAct = firstActiveAfter(state, bbIndex);
  state.currentBet = state.bb; state.minRaise = state.bb; state.needAction = state.seats.map((_,i)=>i).filter(i=>state.seats[i].inHand && !state.seats[i].folded);
  try { armActionTimer(client, state, 30000); } catch {}
  const toPing = state.seats[state.toAct]?.userId;
    const payload = buildTablePayload(state, `▶️ Hand #${state.handNo} started. ${postLines.join(' • ')}. <@${toPing}> to act.\n• Use "Peek Hand" to view your cards (ephemeral).`);
    await updateTableCard(client, state, payload);
  } catch (e) { /* noop */ }
}

function rankAbbrev(v) {
  if (v >= 2 && v <= 10) return String(v);
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[v] || String(v);
}

function kickerTextFor(res) {
  try {
    if (!res || !Array.isArray(res.ranks)) return null;
    const r = res.ranks;
    // Category codes: 8 SF, 7 Quads [quad, kick], 6 FH [trips, pair], 5 Flush [r1..r5], 4 Straight [r1..r5], 3 Trips [t, k1, k2], 2 TwoPair [p1,p2,k], 1 Pair [p, k1,k2,k3], 0 High [r1..r5]
    let ks = [];
    if (res.cat === 7) ks = [r[1]]; // one kicker
    else if (res.cat === 3) ks = r.slice(1, 3);
    else if (res.cat === 2) ks = [r[2]];
    else if (res.cat === 1) ks = r.slice(1, 4);
    else if (res.cat === 0 || res.cat === 5) ks = r.slice(1); // show remaining high cards for clarity
    else ks = [];
    if (!ks.length) return null;
    const parts = ks.map(rankAbbrev).join(', ');
    return ks.length === 1 ? `Kicker: ${parts}` : `Kickers: ${parts}`;
  } catch { return null; }
}

function buildResultEmbed(state, result) {
  const e = new EmbedBuilder().setTitle('🏁 Hand Result').setColor(0xEB459E);
  const boardLine = (state.board && state.board.length) ? state.board.map(formatCard).join('   ') : '—';
  e.setDescription(`🎴 **Board**\n\n${boardLine}`);
  // Winners + amounts
  try {
    const fmt = new Intl.NumberFormat('en-US');
    if (Number.isFinite(result?.rake) && result.rake > 0) {
      const capTxt = Number.isFinite(state.rakeCap) && state.rakeCap > 0 ? ` (cap ${fmt.format(state.rakeCap)})` : '';
      const pctTxt = Number.isFinite(state.rakeBps) && state.rakeBps > 0 ? ` at ${(state.rakeBps / 100).toFixed(2)}%` : '';
      e.addFields({ name: 'Rake', value: `**${fmt.format(result.rake)}**${pctTxt}${capTxt}` });
    }
    const lines = (result?.payouts || []).map(p => {
      const seat = state.seats[p.idx];
      const userId = seat?.userId;
      const cards = Array.isArray(seat?.hole) ? seat.hole.map(formatCard).join(' ') : '—';
      // Evaluate this player's best to show kicker details if relevant
      let best = null; try { best = evaluate7([...(seat?.hole||[]), ...(state.board||[])]); } catch {}
      const kick = kickerTextFor(best);
      const bestLabel = best?.label ? ` • ${best.label}${kick ? ` — ${kick}` : ''}` : '';
      return `• <@${userId}> — **+${fmt.format(p.amount)}** — Hand: **${cards}**${bestLabel}`;
    });
    if (lines.length) e.addFields({ name: 'Winners', value: lines.join('\n') });
    // Side pot breakdown (per pot)
    if (Array.isArray(result?.pots) && result.pots.length) {
      result.pots.forEach((pot, i) => {
        const title = i === 0 ? 'Main Pot' : `Side Pot ${i}`;
        const potFmt = fmt.format(pot.amount || 0);
        const winners = (pot.winners || []).map(w => ` <@${state.seats[w.idx]?.userId}> +${fmt.format(w.amount)}`).join('\n') || '_no eligible winners_';
        e.addFields({ name: `${title} — ${potFmt}`, value: winners });
      });
    }
  } catch {}
  if (result?.label) e.addFields({ name: 'Hand', value: result.label });
  return e;
}

function buildResultPayload(state, result) {
  // Provide a Leave button at results so players can exit before next hand
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hold|leave').setLabel('Leave').setStyle(ButtonStyle.Secondary)
  );
  return { content: '', embeds: [buildResultEmbed(state, result)], components: [row] };
}

async function scheduleNextHand(client, state, result, ms = 10000) {
  try { if (state.nextHandTimer) { clearTimeout(state.nextHandTimer); state.nextHandTimer = null; } } catch {}
  // Show result-only embed for ms milliseconds
  try { updateTableCard(client, state, buildResultPayload(state, result)); } catch {}
  // Log rake if present
  try {
    if (Number.isFinite(result?.rake) && result.rake > 0) {
      const fmt = new Intl.NumberFormat('en-US');
      const anyUser = (state.seats.find(s => s?.userId)?.userId) || state.hostId || '0';
      postGameLogByIds(client, state.guildId, anyUser, [
        `♣ Holdem Rake: **${fmt.format(result.rake)}**`,
        `Table: <#${state.msgChannelId || state.channelId}>`
      ]);
    }
  } catch {}
  // Apply payouts and rake to DB (escrow credit -> winners, rake -> house)
  try {
    const payouts = (result?.payouts || []).map(p => ({ userId: state.seats[p.idx]?.userId, amount: Number(p.amount)||0 })).filter(x => x.userId && x.amount>0);
    if (payouts.length) await escrowCreditMany(state.channelId, payouts);
    if (Number.isFinite(result?.rake) && result.rake > 0) await settleRake(state.channelId, Number(result.rake)||0);
    try {
      const boardStr = (state.board && state.board.length) ? state.board.join(',') : '';
      const winnersJson = JSON.stringify(payouts);
      await finalizeHoldemHand(state.handDbId || 0, { board: boardStr, winnersJson, rakePaid: Number(result?.rake||0) });
    } catch {}
  } catch {}
  state.nextHandTimer = setTimeout(() => {
    startHandAuto(client, state).finally(() => { try { state.nextHandTimer = null; } catch {} });
  }, ms);
}

export async function hostTable(interaction, ctx, { sb, bb, min, max, cap, rakeBps }) {
  // Require configured casino category to place the temp channel
  const { casino_category_id, holdem_rake_bps } = await getGuildSettings(interaction.guild.id) || {};
  if (!casino_category_id) {
    return interaction.reply({ content: '❌ Casino category is not configured. Admins: use /setcasinocategory.', ephemeral: true });
  }
  // Compute next table number within the category
  let tableNumber = 1;
  try {
    const all = await interaction.guild.channels.fetch();
    const used = new Set();
    for (const ch of all.values()) {
      if (!ch || ch.type !== ChannelType.GuildText) continue;
      if (ch.parentId !== casino_category_id) continue;
      const m = /^holdem-table-(\d+)$/.exec(ch.name);
      if (m) used.add(Number(m[1]));
    }
    while (used.has(tableNumber)) tableNumber++;
  } catch {}
  const name = `holdem-table-${tableNumber}`;
  // Create the channel
  let tableChannel = null;
  try {
    const everyoneId = interaction.guild.roles.everyone.id;
    const botId = interaction.client.user.id;
    const hostId = interaction.user.id;
    let modRoleIds = [];
    try { modRoleIds = Array.from(new Set([...(ctx.MOD_ROLE_IDS||[]), ...(await getModRoles(interaction.guild.id))])); } catch {}
    const overwrites = [
      { id: everyoneId, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
      { id: hostId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ...modRoleIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }))
    ];
    tableChannel = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: casino_category_id,
      reason: `Hold'em table by <@${interaction.user.id}>`,
      // reason: `Hold'em table by your commanding Kitten <@${interaction.user.id}>`,
      permissionOverwrites: overwrites
    });
  } catch (e) {
    console.error('holdem channel create (with overwrites) error:', e);
    try {
      tableChannel = await interaction.guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: casino_category_id,
        reason: `Hold'em table by <@${interaction.user.id}> (fallback without overwrites)`
        // reason: `Hold'em table by your commanding Kitten <@${interaction.user.id}> (fallback without overwrites)`
      });
    } catch (err) {
      console.error('holdem channel create fallback error:', err);
      return interaction.reply({ content: '❌ Failed to create table channel. I may be missing permissions.', ephemeral: true });
    }
  }

  // Initialize state and register
  const k = tableKey(interaction.guild.id, tableChannel.id);
  const state = {
    id: k,
    guildId: interaction.guild.id,
    channelId: tableChannel.id,
    hostId: interaction.user.id,
    sb, bb, min, max,
    cap: Number.isInteger(cap) && cap > 0 ? cap : 9,
    rakeBps: Number.isFinite(holdem_rake_bps) ? holdem_rake_bps : (rakeBps || 0),
    rakeCap: Math.max(0, Number(max) || 0),
    seats: [],
    buttonIndex: 0,
    handNo: 0,
    deck: [],
    board: [],
    pot: 0,
    toAct: null,
    phase: 'LOBBY',
    needAction: [],
    tempChannel: true
    ,originMsgId: null
    ,originMsgChannelId: null
  };
  syncKittenPersona(state, ctx);
  holdemTables.set(k, state);

  // Post table card in the new channel, with host mention above it
  const tableEmbed = buildTableEmbed(state);
  const row = tableButtons(state);
  let sent = null;
  try {
    const payload = applyKittenPayload(state, { content: `Host: <@${interaction.user.id}>`, embeds: [tableEmbed], components: [row] });
    sent = await tableChannel.send(payload);
    // sent = await tableChannel.send({ content: `Host: Enchanting Kitten <@${interaction.user.id}>`, embeds: [tableEmbed], components: [row] });
    state.msgId = sent.id;
    state.msgChannelId = sent.channelId;
  } catch (e) { console.error('send table card error:', e); }

  // Edit the preset message to show summary (creator, channel, config)
  try {
    const fmt = new Intl.NumberFormat('en-US');
    const pct = ((state.rakeBps || 0) / 100).toFixed(2);
    const capTxt = Number(state.rakeCap) > 0 ? ` (cap ${fmt.format(state.rakeCap)})` : '';
    const sum = new EmbedBuilder()
      .setTitle('♠♥♦♣ Hold’em Table Created')
      .setColor(0x57F287)
      .setDescription(`Host: <@${interaction.user.id}>\nChannel: <#${tableChannel.id}>`)
      // .setDescription(`Host: Enchanting Kitten <@${interaction.user.id}>\nChannel: <#${tableChannel.id}>`)
      .addFields(
        { name: 'Blinds', value: `SB **${sb}** • BB **${bb}**`, inline: true },
        { name: 'Buy‑in', value: `Min **${min}** • Max **${max}**`, inline: true },
        { name: 'Rake', value: `${pct}%${capTxt}`, inline: true },
        { name: 'Seats', value: `Cap **${state.cap}**`, inline: true }
      );
    if (interaction.isButton && interaction.isButton()) {
      await interaction.update({ embeds: [sum], components: [] });
      try { state.originMsgId = interaction.message?.id; state.originMsgChannelId = interaction.channelId; } catch {}
    } else if (interaction.isModalSubmit && interaction.isModalSubmit()) {
      // Caller (custom modal handler) will edit the options message; do not reply here
    } else {
      // Fallback (non-button); reply publicly
      await interaction.reply({ embeds: [sum], components: [] });
      try { const msg = await interaction.fetchReply(); state.originMsgId = msg?.id; state.originMsgChannelId = msg?.channelId; } catch {}
    }
  } catch {}

  // Schedule close if no players join in time (2 min)
  try { scheduleEmptyClose(interaction.client, state); } catch {}
  // Schedule host inactivity kick
  try { scheduleHostKick(interaction.client, state); } catch {}
  return state;
}

export async function listTables(interaction, ctx) {
  const lines = [];
  for (const st of holdemTables.values()) {
    if (st.guildId !== interaction.guild.id) continue;
    lines.push(`#${st.channelId === interaction.channelId ? '(here) ' : ''}${st.channelId} — Players: ${st.seats.length} — Blinds ${st.sb}/${st.bb}`);
  }
  return interaction.reply({ content: lines.length ? lines.join('\n') : 'No active Hold’em tables in this server.', ephemeral: true });
}

export async function joinTable(interaction, ctx, buyin) {
  const guildId = interaction.guild.id;
  const state = ensureTableInChannel(guildId, interaction.channelId);
  if (!state) return interaction.reply({ content: '❌ No Hold’em table in this channel. Use /holdem host.', ephemeral: true });
  syncKittenPersona(state, ctx);
  if (Number(state.cap||0) > 0 && state.seats.length >= Number(state.cap)) {
    return interaction.reply({ content: `❌ Table is full (cap **${state.cap}**).`, ephemeral: true });
  }
  if (state.seats.some(s => s.userId === interaction.user.id)) return interaction.reply({ content: '❌ You are already seated.', ephemeral: true });
  if (!Number.isInteger(buyin) || buyin < state.min || buyin > state.max) {
    return interaction.reply({ content: `❌ Buy-in must be between **${state.min}** and **${state.max}**.`, ephemeral: true });
  }
  // Chips-only buy-in to escrow, then seat the player with stack equal to buy-in.
  try {
    const { chips } = await getUserBalances(guildId, interaction.user.id);
    if ((chips||0) < buyin) return interaction.reply({ content: '❌ Not enough Chips for that buy-in.', ephemeral: true });
    await escrowAdd(state.channelId, interaction.user.id, buyin);
  } catch {
    return interaction.reply({ content: '❌ Could not process buy-in (insufficient Chips?).', ephemeral: true });
  }
  state.seats.push(emptySeat(interaction.user.id, buyin));
  try { if (state.closeTimer) { clearTimeout(state.closeTimer); state.closeTimer = null; } } catch {}
  if (state.phase === 'CLOSED') { state.phase = 'LOBBY'; }
  // Update main table card if we have it
  await updateTableCard(interaction.client, state);
  // Schedule 10-minute lobby close
  try { scheduleLobbyClose(interaction.client, state); } catch {}
  return interaction.reply({ content: `✅ Seated with **${buyin}**.`, ephemeral: true });
}

export async function leaveTable(interaction, ctx) {
  const guildId = interaction.guild.id;
  const state = ensureTableInChannel(guildId, interaction.channelId);
  if (!state) return interaction.reply({ content: '❌ No table here.', ephemeral: true });
  syncKittenPersona(state, ctx);
  const idx = state.seats.findIndex(s => s.userId === interaction.user.id);
  if (idx === -1) return interaction.reply({ content: '❌ You are not seated.', ephemeral: true });
  const seat = state.seats[idx];
  // Always refund any remaining escrow to the player and include it in the message
  let refunded = 0;
  try {
    const bal = Number(await getEscrowBalance(state.channelId, interaction.user.id) || 0);
    if (bal > 0) {
      await escrowReturn(state.channelId, interaction.user.id, bal);
      refunded = bal;
    }
  } catch {}
  state.seats.splice(idx, 1);
  // If <= 1 player left, go back to lobby UI and transfer ownership
  if (state.seats.length <= 1) {
    try { if (state.nextHandTimer) clearTimeout(state.nextHandTimer); if (state.nextHandInterval) clearInterval(state.nextHandInterval); } catch {}
    state.phase = 'LOBBY';
    state.board = [];
    state.pot = 0;
    state.toAct = null;
    state.currentBet = 0;
    state.minRaise = 0;
    state.resultLabel = null;
    state.countdownSec = null;
    if (state.seats.length === 1) state.hostId = state.seats[0].userId;
    const payload = buildTablePayload(state, '🪑 Waiting for players…');
    if (state.seats.length === 0) { try { scheduleEmptyClose(interaction.client, state); } catch {} }
    else { try { scheduleLobbyClose(interaction.client, state); } catch {} }
    const fmt = new Intl.NumberFormat('en-US');
    const msg = refunded > 0
      ? `👋 You left the table. Refunded **${fmt.format(refunded)}** Chips.`
      : '👋 You left the table.';
    if (interaction.isButton && interaction.isButton()) {
      await interaction.update(payload);
      return interaction.followUp({ content: msg, ephemeral: true });
    }
    await updateTableCard(interaction.client, state, payload);
    return interaction.reply({ content: msg, ephemeral: true });
  }
  // If no players, schedule close
  if (state.seats.length === 0) { try { scheduleEmptyClose(interaction.client, state); } catch {} }
  const payload = buildTablePayload(state);
  const fmt2 = new Intl.NumberFormat('en-US');
  const msg2 = refunded > 0
    ? `👋 You left the table. Refunded **${fmt2.format(refunded)}** Chips.`
    : '👋 You left the table.';
  if (interaction.isButton && interaction.isButton()) {
    await interaction.update(payload);
    return interaction.followUp({ content: msg2, ephemeral: true });
  }
  await updateTableCard(interaction.client, state, payload);
  return interaction.reply({ content: msg2, ephemeral: true });
}

export async function rebuyAtTable(interaction, ctx, amount) {
  const state = ensureTableInChannel(interaction.guild.id, interaction.channelId);
  if (!state) return interaction.reply({ content: '❌ No table here.', ephemeral: true });
  syncKittenPersona(state, ctx);
  const seat = state.seats.find(s => s.userId === interaction.user.id);
  if (!seat) return interaction.reply({ content: '❌ You are not seated.', ephemeral: true });
  if (!Number.isInteger(amount) || amount <= 0) return interaction.reply({ content: '❌ Rebuy amount must be a positive integer.', ephemeral: true });
  if (amount < state.min) return interaction.reply({ content: `❌ Minimum rebuy is **${state.min}**.`, ephemeral: true });
  const newStack = seat.stack + amount;
  if (newStack > state.max) return interaction.reply({ content: `❌ Rebuy would exceed table max stack (**${state.max}**). Current: **${seat.stack}**.`, ephemeral: true });
  // For prototype: only allow rebuys when not mid-hand
  if (['PREFLOP','FLOP','TURN','RIVER'].includes(state.phase)) {
    return interaction.reply({ content: '❌ You can rebuy only between hands (not during an active hand).', ephemeral: true });
  }
  // Chips-only rebuy into escrow
  try { await escrowAdd(state.channelId, interaction.user.id, amount); } catch { return interaction.reply({ content: '❌ Could not process rebuy (insufficient Chips?).', ephemeral: true }); }
  seat.stack = newStack;
  const embed = buildTableEmbed(state);
  const row = tableButtons(state);
  return interaction.reply({ content: `✅ Rebuy added: **+${amount}**. New stack: **${seat.stack}**`, embeds: [embed], components: [row] });
}

// Deck helpers
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['♣','♦','♥','♠'];
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(`${r}${s}`);
  for (let i = d.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

function nextIndex(arr, i) { return (i + 1) % arr.length; }

export async function startHand(interaction, ctx) {
  const state = ensureTableInChannel(interaction.guild.id, interaction.channelId);
  if (!state) return interaction.reply({ content: '❌ No table here.', ephemeral: true });
  syncKittenPersona(state, ctx);
  if (interaction.user.id !== state.hostId) return interaction.reply({ content: '❌ Only the host can start hands for now.', ephemeral: true });
  // Acknowledge early to avoid timeouts if triggered by a button
  try {
    if (interaction.isButton && interaction.isButton() && !(interaction.deferred || interaction.replied)) {
      await interaction.deferUpdate();
    }
  } catch {}
  // Kick players who cannot cover the BB before starting (manual)
  const removed = removeUnderBBSeats(state);
  if (removed.length) {
    try {
      await notifyAutoKick(interaction.client, state, removed);
      await updateTableCard(interaction.client, state);
    } catch {}
  }
  if (state.seats.length < 2) return interaction.reply({ content: '❌ Need at least 2 players.', ephemeral: true });
  // Clear any lobby close timers
  try { if (state.closeTimer) { clearTimeout(state.closeTimer); state.closeTimer = null; } } catch {}
  state.closeDeadline = null; state.closeMode = null;
  state.handNo = (state.handNo || 0) + 1;
  state.board = [];
  state.burned = [];
  state.pot = 0;
  try { state.handDbId = await createHoldemHand(state.channelId, state.handNo, '', '[]', 0); } catch {}
  state.deck = makeDeck();
  state.phase = 'PREFLOP';
  // Rotate button
  state.buttonIndex = state.seats.length ? nextIndex(state.seats, state.buttonIndex) : 0;
  // Reset seats
  for (const s of state.seats) { s.inHand = true; s.committed = 0; s.betRound = 0; s.folded = false; s.allIn = false; }
  // Post blinds
  const sbIndex = nextIndex(state.seats, state.buttonIndex);
  const bbIndex = nextIndex(state.seats, sbIndex);
  // Enforce wait-for-BB: players marked waitForBB sit out until their BB
  state.seats.forEach((s, i) => { if (s.waitForBB && i !== bbIndex) { s.inHand = false; s.actedRound = true; } });
  // Apply sit-out: do not deal, and count missed BBs; auto-leave after two missed BBs
  const toRemove = [];
  state.seats.forEach((s, i) => {
    if (s.sitOut) {
      s.inHand = false; s.actedRound = true;
      if (i === bbIndex) {
        s.missedBlinds = (s.missedBlinds || 0) + 1;
        if (s.missedBlinds >= 2) toRemove.push(i);
      }
    }
  });
  if (toRemove.length) { toRemove.sort((a,b)=>b-a).forEach(i => { try { const r = state.seats.splice(i,1)[0]; if (r) announce(interaction.client, state, `🚫 <@${r.userId}> removed after missing two big blinds.`); } catch {} }); }
  if (state.seats[bbIndex]?.waitForBB) { try { state.seats[bbIndex].waitForBB = false; } catch {} }
  const post = async (i, amt, label) => {
    const seat = state.seats[i];
    if (!seat?.inHand) return null;
    const pay = Math.min(amt, seat.stack);
    seat.stack -= pay;
    seat.committed += pay;
    seat.betRound += pay;
    state.pot += pay;
    try { await escrowCommit(state.channelId, seat.userId, state.handDbId, 'PREFLOP', pay); } catch {}
    if (pay < amt) seat.allIn = true;
    return `${label} <@${seat.userId}> ${pay}`;
  };
  const postLines = (await Promise.all([
    post(sbIndex, state.sb, 'SB'),
    post(bbIndex, state.bb, 'BB')
  ])).filter(Boolean);
  // Deal 2 hole cards to each player (no DMs; players can use "Peek Hand")
  for (let i = 0; i < state.seats.length; i++) { const seat = state.seats[i]; if (!seat.inHand) continue; const c1 = state.deck.pop(); const c2 = state.deck.pop(); seat.hole = [c1, c2]; }
  // First to act preflop: seat after BB
  state.toAct = nextIndex(state.seats, bbIndex);
  state.currentBet = state.bb;
  state.minRaise = state.bb;
  // Everyone needs to act preflop
  state.needAction = state.seats.map((_,i)=>i).filter(i=>state.seats[i].inHand && !state.seats[i].folded);
  // Waiting for actions to complete this round
  // Arm action timer
  try { armActionTimer(interaction.client, state, 30000); } catch {}
  const toPing = state.seats[state.toAct]?.userId;
  const payload = buildTablePayload(state, `▶️ Hand #${state.handNo} started. ${postLines.join(' • ')}. <@${toPing}> to act.\n• Use "Peek Hand" to view your cards (ephemeral).`);
  if (interaction.isButton && interaction.isButton()) {
    if (interaction.deferred || interaction.replied) {
      try { return await interaction.editReply(payload); } catch {}
      try { await updateTableCard(interaction.client, state, payload); } catch {}
      return;
    } else {
      try { return await interaction.update(payload); } catch {}
      try { await updateTableCard(interaction.client, state, payload); } catch {}
      return;
    }
  }
  // Slash command path: edit main table card, then ack ephemerally
  await updateTableCard(interaction.client, state, payload);
  return interaction.reply({ content: '▶️ Hand started.', ephemeral: true });
}

// Button + modal handlers (wired via index):
export async function onHoldemButton(interaction, ctx) {
  const parts = interaction.customId.split('|');
  const action = parts[1];
  // Creation buttons do not require an existing state
  if (action === 'create') {
    const preset = parts[2];
    const owner = parts[3];
    if (owner && owner !== interaction.user.id) {
      return interaction.reply({ content: '❌ Only the requester can create this table.', ephemeral: true });
    }
    if (preset === 'custom') {
      // Show a modal collecting SB, Min, Max, Cap. BB will be 2×SB.
      const modal = new ModalBuilder().setCustomId(`hold|custom|${interaction.user.id}|${interaction.message.id}`).setTitle('Custom Hold’em Table');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('sb').setLabel('Small Blind (BB = 2×SB)').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('min').setLabel('Min Buy-in').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('max').setLabel('Max Buy-in').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('cap').setLabel('Seat Cap (2–10, default 9)').setStyle(TextInputStyle.Short).setRequired(false)
        )
      );
      return interaction.showModal(modal);
    }
    let cfg = null;
    if (preset === 'p1') cfg = { sb: 1, bb: 2, min: 10, max: 100, rakeBps: 500 };
    else if (preset === 'p2') cfg = { sb: 5, bb: 10, min: 50, max: 500, rakeBps: 500 };
    else if (preset === 'p3') cfg = { sb: 20, bb: 40, min: 200, max: 2000, rakeBps: 500 };
    else {
      return interaction.reply({ content: '❌ Unknown preset.', ephemeral: true });
    }
    return hostTable(interaction, ctx, cfg);
  }
  const state = ensureTableInChannel(interaction.guild.id, interaction.channelId);
  if (!state) return interaction.reply({ content: '❌ No table here.', ephemeral: true });
  if (action === 'join') {
    // Open a modal to collect buy-in amount, then seat and update the table card
    const modal = new ModalBuilder().setCustomId(`hold|join|${interaction.user.id}`).setTitle('Join Table');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('buyin').setLabel('Buy-in amount').setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }
  if (action === 'sitout') {
    const seat = state.seats.find(s => s.userId === interaction.user.id);
    if (!seat) return interaction.reply({ content: '❌ You are not seated.', ephemeral: true });
    seat.sitOut = true; seat.waitForBB = true; seat.missedBlinds = seat.missedBlinds || 0;
    try { await updateTableCard(interaction.client, state); } catch {}
    return interaction.reply({ content: '⏸️ You will sit out starting next hand. Use Sit-in to return (wait for BB).', ephemeral: true });
  }
  if (action === 'sitin') {
    const seat = state.seats.find(s => s.userId === interaction.user.id);
    if (!seat) return interaction.reply({ content: '❌ You are not seated.', ephemeral: true });
    seat.sitOut = false; seat.waitForBB = true; seat.missedBlinds = 0;
    try { await updateTableCard(interaction.client, state); } catch {}
    return interaction.reply({ content: '▶️ You will sit in (will be dealt after your BB).', ephemeral: true });
  }
  if (action === 'leave') {
    try { if (state.hostId && interaction.user.id === state.hostId) touchHostActivity(interaction.client, state); } catch {}
    return leaveTable(interaction, ctx);
  }
  if (action === 'start') {
    const hostId = parts[2];
    if (interaction.user.id !== hostId) return interaction.reply({ content: '❌ Only the host can start.', ephemeral: true });
    try { touchHostActivity(interaction.client, state); } catch {}
    return startHand(interaction, ctx);
  }
  if (action === 'act') {
    const sub = parts[2];
    const userId = parts[3];
    const who = state.seats[state.toAct]?.userId;
    if (!who || userId !== who || interaction.user.id !== who) return interaction.reply({ content: '❌ Not your turn.', ephemeral: true });
    try { if (state.hostId && interaction.user.id === state.hostId) touchHostActivity(interaction.client, state); } catch {}
    // Delete turn notice when the acting player makes a move
    try { if (state.actionUserId && interaction.user.id === state.actionUserId) await deleteNotice(interaction.client, state); } catch {}
    if (sub === 'fold') { await doFold(state); }
    else if (sub === 'check') { await doCheck(state); }
    else if (sub === 'call') { await doCall(state); }
    else if (sub === 'allin') { await doAllIn(state); }
    else if (sub === 'raise') {
      const modal = new ModalBuilder().setCustomId(`hold|bet|${who}`).setTitle('Bet/Raise');
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Amount to put in now').setStyle(TextInputStyle.Short).setRequired(true)));
      return interaction.showModal(modal);
    }
    const result = afterActionMaybeAdvance(state);
    if (state.phase === 'COMPLETE' && result) {
      const res = await interaction.update(buildResultPayload(state, result));
      scheduleNextHand(interaction.client, state, result, 10000).catch(() => {});
      return res;
    }
    try { armActionTimer(interaction.client, state, 30000); } catch {}
    const embed = buildTableEmbed(state);
    const rows = [tableButtons(state)];
    const act = actionButtonsFor(state); if (act) rows.push(act);
    const res = await interaction.update({ embeds: [embed], components: rows });
    return res;
  }
  if (action === 'peek') {
    // Show the clicking player's hole cards ephemerally
    const seat = state.seats.find(s => s.userId === interaction.user.id);
    if (!seat || !seat.inHand || !seat.hole || seat.hole.length < 2) {
      return interaction.reply({ content: '❌ No active hand or you are not seated.', ephemeral: true });
    }
    const c1 = formatCard(seat.hole[0]);
    const c2 = formatCard(seat.hole[1]);
    const e = new EmbedBuilder().setTitle('🃏 Your Hand').setColor(0x2b2d31)
      .setDescription(`**${c1} ${c2}**`);
    if (state.board && state.board.length) {
      const board = state.board.map(formatCard).join(' ');
      e.addFields({ name: 'Board', value: board });
      try { const best = evaluate7([...(seat.hole||[]), ...(state.board||[])]); if (best?.label) e.setFooter({ text: `Best with board: ${best.label}` }); } catch {}
    }
    return interaction.reply({ embeds: [e], ephemeral: true });
  }
  return interaction.reply({ content: '❌ Unknown action.', ephemeral: true });
}

export async function onHoldemBetModal(interaction, ctx) {
  const state = ensureTableInChannel(interaction.guild.id, interaction.channelId);
  if (!state) return interaction.reply({ content: '❌ No table here.', ephemeral: true });
  const userId = interaction.customId.split('|')[2];
  const who = state.seats[state.toAct]?.userId;
  if (!who || userId !== who || interaction.user.id !== who) return interaction.reply({ content: '❌ Not your turn.', ephemeral: true });
  try { if (state.hostId && interaction.user.id === state.hostId) touchHostActivity(interaction.client, state); } catch {}
  try { if (state.actionUserId && interaction.user.id === state.actionUserId) await deleteNotice(interaction.client, state); } catch {}
  const amtStr = interaction.fields.getTextInputValue('amount');
  const amt = Number(amtStr);
  if (!Number.isInteger(amt) || amt <= 0) return interaction.reply({ content: '❌ Amount must be a positive integer.', ephemeral: true });
  const ok = await doBetOrRaise(state, amt);
  if (!ok) return interaction.reply({ content: '❌ Invalid bet/raise amount for your stack or rules.', ephemeral: true });
  const result = afterActionMaybeAdvance(state);
  if (state.phase === 'COMPLETE' && result) {
    // Edit the existing table card; do not create a new message
    try { await updateTableCard(interaction.client, state, buildResultPayload(state, result)); } catch {}
    scheduleNextHand(interaction.client, state, result, 10000).catch(() => {});
    return interaction.reply({ content: '✅ Settled.', ephemeral: true });
  }
  // Not terminal: update the main table card and arm timer
  try { armActionTimer(interaction.client, state, 30000); } catch {}
  try { await updateTableCard(interaction.client, state, buildTablePayload(state)); } catch {}
  return interaction.reply({ content: '✅ Action applied.', ephemeral: true });
}

export async function onHoldemJoinModal(interaction, ctx) {
  const parts = interaction.customId.split('|');
  const requester = parts[2];
  const guildId = interaction.guild.id;
  const state = ensureTableInChannel(guildId, interaction.channelId);
  if (!state) return interaction.reply({ content: '❌ No table here.', ephemeral: true });
  if (interaction.user.id !== requester) return interaction.reply({ content: '❌ This join prompt is not for you.', ephemeral: true });
  const buyinStr = interaction.fields.getTextInputValue('buyin');
  const buyin = Number(buyinStr);
  if (!Number.isInteger(buyin) || buyin <= 0) return interaction.reply({ content: '❌ Buy-in must be a positive integer.', ephemeral: true });
  if (state.seats.some(s => s.userId === interaction.user.id)) return interaction.reply({ content: '❌ You are already seated.', ephemeral: true });
  if (buyin < state.min || buyin > state.max) {
    return interaction.reply({ content: `❌ Buy-in must be between **${state.min}** and **${state.max}**.`, ephemeral: true });
  }
  // Seat the player with escrowed Chips (pre-check balance)
  try {
    const { chips } = await getUserBalances(guildId, interaction.user.id);
    if ((chips||0) < buyin) return interaction.reply({ content: '❌ Not enough Chips for that buy-in.', ephemeral: true });
    await escrowAdd(state.channelId, interaction.user.id, buyin);
  } catch (e) {
    return interaction.reply({ content: '❌ Could not process buy-in (insufficient Chips?).', ephemeral: true });
  }
  state.seats.push(emptySeat(interaction.user.id, buyin));
  // Update the main table card
  await updateTableCard(interaction.client, state);
  return interaction.reply({ content: `✅ Seated with **${buyin}**.`, ephemeral: true });
}

export async function onHoldemCustomModal(interaction, ctx) {
  try {
    const parts = interaction.customId.split('|');
    const requester = parts[2];
    const sourceMsgId = parts[3];
    if (interaction.user.id !== requester) {
      return interaction.reply({ content: '❌ This custom setup prompt is not for you.', ephemeral: true });
    }
    // Acknowledge the modal without showing a user-visible message
    try { await interaction.deferReply({ ephemeral: true }); } catch {}
    const sb = Number(interaction.fields.getTextInputValue('sb'));
    const min = Number(interaction.fields.getTextInputValue('min'));
    const max = Number(interaction.fields.getTextInputValue('max'));
    const capStr = interaction.fields.getTextInputValue('cap');
    let cap = Number(capStr);
    if (!Number.isInteger(cap) || cap <= 0) cap = 9;
    if (cap < 2) cap = 2; if (cap > 10) cap = 10;
    if (!Number.isInteger(sb) || sb <= 0) return interaction.reply({ content: '❌ SB must be a positive integer.', ephemeral: true });
    if (!Number.isInteger(min) || min <= 0) return interaction.reply({ content: '❌ Min buy-in must be a positive integer.', ephemeral: true });
    if (!Number.isInteger(max) || max <= 0) return interaction.reply({ content: '❌ Max buy-in must be a positive integer.', ephemeral: true });
    if (max < min) return interaction.reply({ content: '❌ Max buy-in must be greater than or equal to Min.', ephemeral: true });
    const bb = sb * 2;
    // Create the table (hostTable replies ephemerally with summary and creates the new channel)
    const state = await hostTable(interaction, ctx, { sb, bb, min, max, cap, rakeBps: 0 });
    // Edit the original options message to show creation summary
    try {
      const fmt = new Intl.NumberFormat('en-US');
      const pct = ((state.rakeBps || 0) / 100).toFixed(2);
      const capTxt = Number(state.rakeCap) > 0 ? ` (cap ${fmt.format(state.rakeCap)})` : '';
      const sum = new EmbedBuilder()
        .setTitle('♠♥♦♣ Hold’em Table Created')
        .setColor(0x57F287)
        .setDescription(`Host: <@${interaction.user.id}>\nChannel: <#${state.msgChannelId || state.channelId}>`)
        .addFields(
          { name: 'Blinds', value: `SB **${sb}** • BB **${bb}**`, inline: true },
          { name: 'Buy‑in', value: `Min **${min}** • Max **${max}**`, inline: true },
          { name: 'Rake', value: `${pct}%${capTxt}`, inline: true },
          { name: 'Seats', value: `Cap **${state.cap || cap}**`, inline: true }
        );
      const ch = interaction.channel;
      const msg = await ch.messages.fetch(sourceMsgId).catch(() => null);
      if (msg) await msg.edit({ embeds: [sum], components: [] });
      try { state.originMsgId = sourceMsgId; state.originMsgChannelId = ch?.id || interaction.channelId; } catch {}
    } catch {}
    // Remove the deferred ephemeral reply so nothing is shown to the user
    try { await interaction.deleteReply().catch(()=>{}); } catch {}
  } catch (e) {
    console.error('onHoldemCustomModal error:', e);
    try { return interaction.reply({ content: '❌ Failed to create table from custom settings.', ephemeral: true }); } catch {}
  }
}

// DB outline (escrow/payouts):
// - Create tables:
//   holdem_tables (table_id, guild_id, channel_id, sb, bb, min, max, rake_bps, host_id, created_at)
//   holdem_hands (hand_id, table_id, hand_no, board, winners_json, rake_paid)
//   holdem_escrow (table_id, user_id, balance)
//   holdem_commits (hand_id, user_id, street, amount)
// - Helpers:
//   escrowAdd(tableId, userId, amount) — debit player chips and credit escrow
//   escrowReturn(tableId, userId, amount)
//   escrowPayoutMany(tableId, payouts[]) — distribute from escrow
//   recordCommit(handId, userId, street, amount)
//   settleRake(tableId, amount)
// Game: Texas Hold’em — per-table channels, seat/stacks (Chips-only), gameplay, timers, rake, and cleanup.
