import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import crypto from 'node:crypto';
import { getUserBalances, getHouseBalance, takeFromUserToHouse, transferFromHouseToUser, burnCredits } from '../db.auto.mjs';
import { chipsAmount } from './format.mjs';
import { sessionLineFor, setActiveSession, recordSessionGame, buildTimeoutField, sendGameMessage } from './session.mjs';

// Symbols & pays (per 3/4/5 on a payline)
export const SLOTS_SYMBOLS = {
  W: { id: 'W', type: 'wild', pay: [0, 50, 500], substitutes: ['A','K','Q','J','T','N','H1','H2'] },
  S: { id: 'S', type: 'scatter', scatterPay: { 3: 40, 4: 200, 5: 1000 } },
  H1: { id: 'H1', type: 'regular', pay: [20, 100, 500] },
  H2: { id: 'H2', type: 'regular', pay: [15, 80, 400] },
  A: { id: 'A', type: 'regular', pay: [10, 50, 200] },
  K: { id: 'K', type: 'regular', pay: [8, 40, 150] },
  Q: { id: 'Q', type: 'regular', pay: [6, 30, 120] },
  J: { id: 'J', type: 'regular', pay: [5, 25, 100] },
  T: { id: 'T', type: 'regular', pay: [4, 20, 80] },
  N: { id: 'N', type: 'regular', pay: [3, 15, 60] },
  X: { id: 'X', type: 'blank' }
};

// Reels (symbol strips)
const SLOTS_STRIPS = [
  ['A','X','H1','Q','X','W','K','X','S','J','X','H2','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','N','X','H1','X','S','X','J','X','H2','X','K','X','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','N','X','T','X'],
  ['Q','X','H2','A','X','K','X','S','X','J','X','W','N','X','T','X','K','X','A','X','Q','X','N','X','T','X','H1','X','S','X','J','X','H2','X','K','X','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','N','X'],
  ['K','X','A','X','Q','X','N','X','W','T','X','H1','X','S','X','J','X','H2','X','K','X','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','S','X','N','X','T','X','K','X','A','X','Q','X','N','X','T','X'],
  ['A','X','Q','X','N','X','T','X','K','X','A','X','S','X','Q','X','W','N','X','T','X','H1','X','J','X','H2','X','K','X','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','N','X','T','X','S','X'],
  ['N','X','T','X','K','X','A','X','Q','X','N','X','T','X','K','X','A','X','Q','X','H1','X','S','X','J','X','H2','X','K','X','A','X','Q','X','N','X','T','X','W','K','X','A','X','Q','X','N','X','T','X']
];

// 20 fixed paylines (row indices per column)
export const SLOTS_LINES = [
  [0,0,0,0,0], [1,1,1,1,1], [2,2,2,2,2],
  [0,1,2,1,0], [2,1,0,1,2],
  [0,0,1,0,0], [1,1,2,1,1], [2,2,1,2,2],
  [1,0,0,0,1], [1,2,2,2,1],
  [0,1,1,1,0], [2,1,1,1,2],
  [0,2,0,2,0], [2,0,2,0,2],
  [1,0,1,2,1], [1,2,1,0,1],
  [0,1,0,1,0], [2,1,2,1,2],
  [0,2,2,2,0], [2,0,0,0,2]
];

export const SLOT_EMOJI = { W:'🃏', S:'⭐', H1:'💎', H2:'🔔', A:'🅰️', K:'👑', Q:'👸', J:'♟️', T:'🔟', N:'9️⃣', X:'🔲' };
const SLOT_FILL_SYMBOLS = ['A','K','Q','J','T','N'];

// RNG helper
function rngInt(max) { return crypto.randomInt(0, max); }

// Render 3x5 grid to text with emojis
export function renderSlotsGrid(grid) {
  const rows = grid.map(row => row.map(s => SLOT_EMOJI[s] || s).join(' '));
  return rows.join('\n');
}

// UI: Pay table (ephemeral)
export function buildSlotsPaytableEmbed() {
  const e = new EmbedBuilder().setTitle('📜 Slots Pay Table').setColor(0x5865F2);
  const lineItems = [
    { k: 'H1', name: 'High 1 💎' },
    { k: 'H2', name: 'High 2 🔔' },
    { k: 'A', name: 'A 🅰️' },
    { k: 'K', name: 'K 👑' },
    { k: 'Q', name: 'Q 👸' },
    { k: 'J', name: 'J ♟️' },
    { k: 'T', name: '10 🔟' },
    { k: 'N', name: '9 9️⃣' },
    { k: 'W', name: 'Wild 🃏 (also substitutes)' }
  ];
  for (const it of lineItems) {
    const sym = SLOTS_SYMBOLS[it.k];
    const pays = sym?.pay ? sym.pay : [0,0,0];
    e.addFields({ name: it.name, value: `3️⃣ ${pays[0]} • 4️⃣ ${pays[1]} • 5️⃣ ${pays[2]}` });
  }
  const scat = SLOTS_SYMBOLS.S.scatterPay;
  e.addFields({ name: 'Scatter ⭐ (anywhere)', value: `3️⃣ ${scat[3]} • 4️⃣ ${scat[4]} • 5️⃣ ${scat[5]}` });
  const lines = SLOTS_LINES.length;
  e.addFields({ name: 'Rules', value: [
    `• ${lines} fixed lines; pays left→right on 3+ matching symbols.`,
    '• Wild 🃏 substitutes for regular symbols.',
    '• Scatter ⭐ pays anywhere and adds to line wins.',
    `• Line bet = total bet / ${lines}; each win is floored to whole credits.`
  ].join('\n') });
  return e;
}

// Per-user session state for house net tracking
export const slotSessions = new Map(); // key -> { lastBet, houseNet }

// Spin — build a 3x5 window from the strips
export function spinSlots() {
  const grid = Array.from({ length: 3 }, () => Array(5).fill('X'));
  for (let r = 0; r < 5; r++) {
    const strip = SLOTS_STRIPS[r];
    const start = rngInt(strip.length);
    for (let row = 0; row < 3; row++) {
      let s = strip[(start + row) % strip.length];
      if (s === 'X') s = SLOT_FILL_SYMBOLS[rngInt(SLOT_FILL_SYMBOLS.length)];
      grid[row][r] = s;
    }
  }
  return grid;
}

// Evaluate lines and scatter; return total win and details
export function evaluateSlots(grid, betTotal) {
  const lines = SLOTS_LINES.length;
  const lineBet = betTotal / lines;
  let lineWins = [];
  let total = 0;
  let scatters = 0;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) if (grid[row][col] === 'S') scatters++;
  const scatterPay = SLOTS_SYMBOLS.S.scatterPay[scatters] || 0;
  const scatterWin = Math.floor(scatterPay * lineBet);
  total += scatterWin;
  if (scatterPay) lineWins.push({ line: 'SCAT', count: scatters, win: scatterWin });
  for (let li = 0; li < lines; li++) {
    const rows = SLOTS_LINES[li];
    const seq = rows.map((row, col) => grid[row][col]);
    let base = null;
    for (const s of seq) { if (s !== 'W' && s !== 'S' && s !== 'X') { base = s; break; } }
    if (!base) base = 'H1';
    const sym = SLOTS_SYMBOLS[base];
    let match = 0;
    for (let i = 0; i < 5; i++) { const s = seq[i]; if (s === base || s === 'W') match++; else break; }
    if (match >= 3) {
      const tier = match - 3;
      const pay = (sym.pay && sym.pay[tier]) ? sym.pay[tier] : 0;
      const win = Math.floor(pay * lineBet);
      if (win > 0) { total += win; lineWins.push({ line: li + 1, symbol: base, count: match, win }); }
    }
  }
  return { total, lineBet, lineWins };
}

// Handler: execute a spin, settle, and render result
export async function runSlotsSpin(interaction, bet, key) {
  const lines = SLOTS_LINES.length;
  if (!Number.isInteger(bet) || bet < 5) {
    return interaction.reply({ content: `❌ Bet must be an integer of at least 5 (total across ${lines} lines).`, ephemeral: true });
  }
  const { chips, credits } = await getUserBalances(interaction.user.id);
  if (chips + credits < bet) {
    const fmt = new Intl.NumberFormat('en-US');
    return interaction.reply({ content: `❌ Not enough funds. Credits: **${fmt.format(credits)}**, Chips: **${chipsAmount(chips)}**. Need: **${chipsAmount(bet)}**.`, ephemeral: true });
  }
  const grid = spinSlots();
  const { total: win } = evaluateSlots(grid, bet);
  // Credits-first staking: allocate from Credits, then Chips
  const creditStake = Math.min(bet, credits);
  const chipStake = bet - creditStake;
  const cover = await getHouseBalance();
  const neededCover = chipStake + win;
  if (cover < neededCover) {
    return interaction.reply({ content: `❌ House cannot cover potential payout. Needed: **${chipsAmount(neededCover)}**.`, ephemeral: true });
  }
  if (chipStake > 0) {
    try { await takeFromUserToHouse(interaction.user.id, chipStake, 'slots spin (chips)', interaction.user.id); } catch { return interaction.reply({ content: '❌ Could not process bet.', ephemeral: true }); }
  }
  let footer;
  if (win > 0) {
    const payout = chipStake + win;
    try { await transferFromHouseToUser(interaction.user.id, payout, 'slots win', null); footer = `Win: ${chipsAmount(win)} • Returned stake: ${chipsAmount(chipStake)}`; }
    catch { return interaction.reply({ content: '⚠️ Payout failed.', ephemeral: true }); }
  } else {
    try { if (creditStake > 0) await burnCredits(interaction.user.id, creditStake, 'slots loss', null); } catch {}
    footer = 'No win.';
  }
  const e = new EmbedBuilder()
    .setTitle('🎰 Slots')
    .setColor(win > 0 ? 0x57F287 : 0xED4245)
    .addFields({ name: 'Bet', value: `**${chipsAmount(bet)}** (${lines} lines)`, inline: true }, { name: 'Win', value: `**${chipsAmount(win)}**`, inline: true })
    .setDescription('```' + '\n' + renderSlotsGrid(grid) + '\n' + '```')
    .setFooter({ text: footer });
  try {
    const { chips: chipsBal, credits: creditsBal } = await getUserBalances(interaction.user.id);
    const fmt = new Intl.NumberFormat('en-US');
    const sess = sessionLineFor(interaction.guild.id, interaction.user.id);
    const val = [
      `Chips: **${chipsAmount(chipsBal)}**`,
      `Credits: **${fmt.format(creditsBal)}**`,
      sess ? sess : null
    ].filter(Boolean).join('\n');
    e.addFields({ name: 'Player Balance', value: val });
    try { e.addFields(buildTimeoutField(interaction.guild.id, interaction.user.id)); } catch {}
  } catch {}
  try {
    const payout = (win > 0) ? (chipStake + win) : 0;
    const houseDelta = chipStake - payout;
    const cur = slotSessions.get(key) || { lastBet: 0, houseNet: 0 };
    cur.lastBet = bet;
    cur.houseNet = (cur.houseNet || 0) + houseDelta;
    slotSessions.set(key, cur);
    try { recordSessionGame(interaction.guild.id, interaction.user.id, win > 0 ? win : -chipStake); } catch {}
// Game: Slots — spin, evaluate lines, settle payouts (Credits-first), and render result UI.
  } catch {}
  const again = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`slots|again|${bet}|${interaction.user.id}`).setLabel('Spin Again').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`slots|paytable|${interaction.user.id}`).setLabel('Pay Table').setEmoji('📜').setStyle(ButtonStyle.Primary)
  );
  const response = { embeds: [e], components: [again] };
  // Ensure we track the message reference for session finalization on expiry
  setActiveSession(interaction.guild.id, interaction.user.id, 'slots', 'Slots');
  return sendGameMessage(interaction, response, 'auto');
}
