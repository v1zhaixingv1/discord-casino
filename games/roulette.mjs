import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { chipsAmount } from './format.mjs';
import { buildPlayerBalanceField, keyFor, setActiveSession, buildTimeoutField, sendGameMessage } from './session.mjs';

export const rouletteSessions = new Map();
export const ROULETTE_RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export const ROULETTE_TYPES = [
  { v: 'red', label: 'Red (1:1)' },
  { v: 'black', label: 'Black (1:1)' },
  { v: 'odd', label: 'Odd (1:1)' },
  { v: 'even', label: 'Even (1:1)' },
  { v: 'low', label: 'Low 1–18 (1:1)' },
  { v: 'high', label: 'High 19–36 (1:1)' },
  { v: 'dozen1', label: 'Dozen 1 (1–12) (2:1)' },
  { v: 'dozen2', label: 'Dozen 2 (13–24) (2:1)' },
  { v: 'dozen3', label: 'Dozen 3 (25–36) (2:1)' },
  { v: 'column1', label: 'Column 1 (2:1)' },
  { v: 'column2', label: 'Column 2 (2:1)' },
  { v: 'column3', label: 'Column 3 (2:1)' },
  { v: 'straight', label: 'Straight (single pocket) (35:1)' }
];

export function roulettePayoutMult(type) {
  return ({
    red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
    dozen1: 2, dozen2: 2, dozen3: 2,
    column1: 2, column2: 2, column3: 2,
    straight: 35
  })[type] || null;
}

export function spinRoulette() {
  const n = Math.floor(Math.random() * 38); // 0..37 (37 represents 00)
  const label = (n === 37) ? '00' : String(n);
  let color = 'GREEN';
  if (n >= 1 && n <= 36) color = ROULETTE_RED.has(n) ? 'RED' : 'BLACK';
  const dozen = (n >= 1 && n <= 36) ? Math.ceil(n / 12) : null; // 1..3
  const column = (n >= 1 && n <= 36) ? ((n % 3) || 3) : null;   // 1..3
  const parity = (n >= 1 && n <= 36) ? (n % 2 === 0 ? 'EVEN' : 'ODD') : null;
  const range = (n >= 1 && n <= 36) ? (n <= 18 ? 'LOW' : 'HIGH') : null;
  return { n, label, color, dozen, column, parity, range };
}

export function rouletteWins(type, pocket, spin) {
  switch (type) {
    case 'straight':
      if (pocket === '00') return spin.label === '00';
      if (pocket === 0) return spin.n === 0;
      return spin.n === Number(pocket);
    case 'red': return spin.color === 'RED';
    case 'black': return spin.color === 'BLACK';
    case 'odd': return spin.parity === 'ODD';
    case 'even': return spin.parity === 'EVEN';
    case 'low': return spin.range === 'LOW';
    case 'high': return spin.range === 'HIGH';
    case 'dozen1': return spin.dozen === 1;
    case 'dozen2': return spin.dozen === 2;
    case 'dozen3': return spin.dozen === 3;
    case 'column1': return spin.column === 1;
    case 'column2': return spin.column === 2;
    case 'column3': return spin.column === 3;
    default: return false;
  }
}

export async function rouletteSummaryEmbed(state) {
  const e = new EmbedBuilder().setTitle('🎡 Roulette Bets').setColor(0x2b2d31);
  const lines = state.bets.length
    ? state.bets.map((b,i)=>`#${i+1}. ${b.type}${b.pocket!==undefined?` ${b.pocket}`:''} — **${chipsAmount(b.amount)}**`).join('\n')
    : '_No bets yet_';
  e.setDescription(lines);
  try { e.addFields(await buildPlayerBalanceField(state.guildId, state.userId)); } catch {}
  try { e.addFields(buildTimeoutField(state.guildId, state.userId)); } catch {}
  return e;
}

export function rouletteTypeSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('rou|type')
    .setPlaceholder('Choose a bet type')
    .addOptions(ROULETTE_TYPES.slice(0,25).map(o=>({ label: o.label, value: o.v })));
  return new ActionRowBuilder().addComponents(menu);
}

export async function showRouletteTypePrompt(interaction) {
  const key = keyFor(interaction);
  const state = rouletteSessions.get(key) || { bets: [] };
  const embed = await rouletteSummaryEmbed(state);
  const row = rouletteTypeSelectRow();
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rou|confirm').setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rou|cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
  // Use shared helper to reply/update and remember message reference for session finalization
  return sendGameMessage(interaction, { embeds: [embed], components: [row, controls] });
}

export async function startRouletteSession(interaction) {
  const key = keyFor(interaction);
  rouletteSessions.set(key, { guildId: interaction.guild.id, userId: interaction.user.id, bets: [] });
  setActiveSession(interaction.guild.id, interaction.user.id, 'roulette', 'Roulette');
  return showRouletteTypePrompt(interaction);
}
// Game: Roulette — interactive betting flow, spin result, and settlement helpers.
