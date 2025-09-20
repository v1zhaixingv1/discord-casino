import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getGuildSettings, getUserBalances, getHouseBalance, takeFromUserToHouse, burnCredits } from '../db.auto.mjs';
import { makeDeck, show, color, val } from './cards.mjs';
import { chipsAmount } from './format.mjs';
import { buildPlayerBalanceField, sendGameMessage, setActiveSession, buildTimeoutField } from './session.mjs';

export const ridebusGames = new Map(); // key = `${guildId}:${userId}` -> state

const PAYOUT = { 1: 2, 2: 3, 3: 4, 4: 10 };
const wagerAt = (state, s) => state.bet * PAYOUT[s];

// Format a list of cards
export function cardList(cards) { return (!cards?.length) ? '—' : cards.map(show).join('  '); }

// Build the main game embed for current state
export async function embedForState(state, opts = {}) {
  const { title = '🎴 Ride the Bus', description = '', color: clr = 0x5865F2 } = opts;
  const e = new EmbedBuilder().setTitle(title).setColor(clr).setDescription(description)
    .addFields(
      { name: 'Player', value: `<@${state.userId}>`, inline: true },
      // { name: 'Player', value: `Thank you Kitten! <@${state.userId}>`, inline: true },
      { name: 'Bet', value: `**${chipsAmount(state.bet)}**`, inline: true },
      { name: 'Max Payout', value: `**${chipsAmount(state.bet * 10)}**`, inline: true },
    );
  e.addFields({ name: 'Cards Dealt', value: cardList(state.cards) });
  try { e.addFields(await buildPlayerBalanceField(state.guildId, state.userId)); } catch {}
  try { e.addFields(buildTimeoutField(state.guildId, state.userId)); } catch {}
  return e;
}

// Build a row of generic buttons for this game
export function rowButtons(ids) {
  return new ActionRowBuilder().addComponents(
    ...ids.map(({ id, label, style }) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style))
  );
}

// Start a new Ride the Bus session
export async function startRideBus(interaction, bet) {
  const guildId = interaction.guild?.id;
  const { max_ridebus_bet = 1000 } = await getGuildSettings(guildId) || {};
  if (bet > max_ridebus_bet) return interaction.reply({ content: `❌ Max bet for Ride the Bus is **${chipsAmount(max_ridebus_bet)}**.`, ephemeral: true });
  const { chips, credits } = await getUserBalances(guildId, interaction.user.id);
  const total = chips + credits;
  if (total < bet) {
    const fmt = new Intl.NumberFormat('en-US');
    return interaction.reply({ content: `❌ You don’t have enough funds for that bet. Credits: **${fmt.format(credits)}**, Chips: **${chipsAmount(chips)}**. Need: **${chipsAmount(bet)}**.`, ephemeral: true });
  }
  const cover = await getHouseBalance(guildId);
  const maxPayout = bet * PAYOUT[4];
  if (cover < maxPayout) return interaction.reply({ content: `❌ House cannot cover a max payout of **${chipsAmount(maxPayout)}**. Try a smaller bet.`, ephemeral: true });

  // Credits-first staking
  const creditStake = Math.min(bet, credits);
  const chipStake = bet - creditStake;
  if (chipStake > 0) {
    try { await takeFromUserToHouse(guildId, interaction.user.id, chipStake, 'ridebus buy-in (chips)', interaction.user.id); }
    catch { return interaction.reply({ content: '❌ Could not process buy-in.', ephemeral: true }); }
  }

  const state = {
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    bet,
    deck: makeDeck(),
    cards: [],
    step: 1,
    startedAt: Date.now(),
    creditsStake: creditStake,
    chipsStake: chipStake
  };
  ridebusGames.set(`${interaction.guild.id}:${interaction.user.id}`, state);
  setActiveSession(interaction.guild.id, interaction.user.id, 'ridebus', 'Ride the Bus');

  const q1Row = rowButtons([
    { id: `rb|q1|red`, label: 'Red ♥♦', style: ButtonStyle.Danger },
    { id: `rb|q1|black`, label: 'Black ♠♣', style: ButtonStyle.Primary }
  ]);
  const desc = `**Q1 (2×):** Pick a color — **Red (♥♦)** or **Black (♠♣)**.\n` +
    `_Wrong at any step ends the hand. Clear all 4 to win **${chipsAmount(maxPayout)}**._`;
  return sendGameMessage(interaction, { embeds: [await embedForState(state, { description: desc })], components: [q1Row] });
}

export function playAgainRow(bet, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rb|again|${bet}|${userId}`).setLabel(`Play Again (${chipsAmount(bet)})`).setStyle(ButtonStyle.Secondary)
// Game: Ride the Bus — step-based card game with Credits-first staking and cash-out.
  );
}

export { PAYOUT, wagerAt };
