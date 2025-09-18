import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getUserBalances, getHouseBalance, transferFromHouseToUser, takeFromUserToHouse, burnCredits } from '../db.auto.mjs';
import { makeDeck, show } from './cards.mjs';
import { chipsAmount, formatChips } from './format.mjs';
import { setActiveSession, buildPlayerBalanceField, addHouseNet, recordSessionGame, sendGameMessage, buildTimeoutField } from './session.mjs';

export const blackjackGames = new Map();

// Compute hand total; treat Aces as 11 then reduce to avoid busting
export function bjHandValue(cards) {
  let total = 0; let aces = 0;
  for (const c of cards) { if (c.r === 'A') { aces++; total += 11; } else if (['K','Q','J','10'].includes(c.r)) total += 10; else total += Number(c.r); }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  const soft = aces > 0;
  return { total, soft };
}
// Format a hand for display
export function bjShowHand(cards) { return cards.map(show).join(' '); }
// Helper: normalized value for split checks
export function cardValueForSplit(card) { if (card.r === 'A') return 11; if (['10','J','Q','K'].includes(card.r)) return 10; return Number(card.r); }
// Check if user can afford an additional stake
export async function canAffordExtra(userId, amount) { const { credits, chips } = await getUserBalances(userId); return (credits + chips) >= amount; }

// Build the current Blackjack UI embed
export async function bjEmbed(state, opts = {}) {
  const { title = '🂡 Blackjack', color = 0x2b2d31, footer } = opts;
  const e = new EmbedBuilder().setTitle(title).setColor(color);
  const dUp = state.dealer[0];
  const dHidden = state.revealed ? bjShowHand(state.dealer) : `${show(dUp)} ❓`;
  e.addFields(
    { name: '🎰 Table', value: `${state.table}`, inline: true },
    { name: '🪙 Bet', value: `**${chipsAmount(state.bet)}**`, inline: true },
    { name: '📜 Rule', value: state.table === 'HIGH' ? 'H17 (Dealer hits soft 17)' : 'S17 (Dealer stands on soft 17)', inline: false }
  );
  if (state.split && Array.isArray(state.hands)) {
    const a = bjHandValue(state.hands[0].cards); const b = bjHandValue(state.hands[1].cards);
    e.addFields(
      { name: `🃏 Your Hand A${state.active===0?' (active)':''}`, value: `${bjShowHand(state.hands[0].cards)} • **${a.total}**${a.soft?' (soft)':''}` },
      { name: `🃏 Your Hand B${state.active===1?' (active)':''}`, value: `${bjShowHand(state.hands[1].cards)} • **${b.total}**${b.soft?' (soft)':''}` }
    );
  } else {
    const p = bjHandValue(state.player); const pHand = bjShowHand(state.player);
    e.addFields({ name: '🃏 Your Hand', value: `${pHand} • **${p.total}**${p.soft ? ' (soft)' : ''}` });
  }
  e.addFields({ name: '🤵 Dealer', value: state.revealed ? `${dHidden} • **${bjHandValue(state.dealer).total}**` : dHidden });
  try { e.addFields(await buildPlayerBalanceField(state.guildId, state.userId)); } catch {}
  try { e.addFields(buildTimeoutField(state.guildId, state.userId)); } catch {}
  if (footer) e.setFooter({ text: footer });
  return e;
}

export function bjPlayAgainRow(table, bet, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bj|again|${table}|${bet}|${userId}`).setLabel(`Play Again (${formatChips(bet)})`).setEmoji('🔁').setStyle(ButtonStyle.Secondary)
  );
}

export async function startBlackjack(interaction, table, bet) {
  const k = `${interaction.guild.id}:${interaction.user.id}`;
  if (blackjackGames.has(k)) return interaction.reply({ content: '❌ You already have an active Blackjack hand. Finish it first.', ephemeral: true });
  if (table === 'HIGH') { if (bet < 100) return interaction.reply({ content: '❌ High table minimum is 100.', ephemeral: true }); }
  else if (table === 'LOW') { if (bet > 99) return interaction.reply({ content: '❌ Low table maximum is 99.', ephemeral: true }); }
  else return interaction.reply({ content: '❌ Invalid table.', ephemeral: true });

  const { chips, credits } = await getUserBalances(interaction.user.id);
  const total = chips + credits; if (total < bet) { const fmt = new Intl.NumberFormat('en-US'); return interaction.reply({ content: `❌ Not enough funds. Credits: **${fmt.format(credits)}**, Chips: **${fmt.format(chips)}**. Need: **${fmt.format(bet)}**.`, ephemeral: true }); }
  const cover = await getHouseBalance();
  // Credits-first staking
  const creditStake = Math.min(bet, credits); const chipStake = bet - creditStake; const neededCover = chipStake + (bet * 2);
  if (cover < neededCover) return interaction.reply({ content: `❌ House cannot cover potential payout. Needed cover: **${formatChips(neededCover)}**.`, ephemeral: true });
  if (chipStake > 0) { try { await takeFromUserToHouse(interaction.user.id, chipStake, 'blackjack buy-in (chips)', interaction.user.id); } catch { return interaction.reply({ content: '❌ Could not process buy-in.', ephemeral: true }); } }

  const deck = makeDeck();
  const state = { guildId: interaction.guild.id, userId: interaction.user.id, table, bet, creditsStake: creditStake, chipsStake: chipStake, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], finished: false, revealed: false };
  blackjackGames.set(k, state);
  setActiveSession(interaction.guild.id, interaction.user.id, 'blackjack', 'Blackjack');

  const p = bjHandValue(state.player); const d = bjHandValue(state.dealer);
  const playerBJ = (p.total === 21 && state.player.length === 2); const dealerBJ = (d.total === 21 && state.dealer.length === 2);
  if (playerBJ || dealerBJ) {
    state.revealed = true; blackjackGames.delete(k);
    if (playerBJ && dealerBJ) {
      try { if (state.chipsStake > 0) { await transferFromHouseToUser(state.userId, state.chipsStake, 'blackjack push (both BJ)', null); } addHouseNet(state.guildId, state.userId, 'blackjack', 0); try { recordSessionGame(state.guildId, state.userId, 0); } catch {} const row = bjPlayAgainRow(state.table, state.bet, state.userId); return sendGameMessage(interaction, { embeds: [await bjEmbed(state, { footer: 'Push. Your stake was returned.', color: 0x2b2d31 })], components: [row] }); } catch { return interaction.reply({ content: '⚠️ Settlement failed.', ephemeral: true }); }
    }
    if (playerBJ) {
      const win = Math.floor(bet * 1.5);
      try { const payout = state.chipsStake + win; await transferFromHouseToUser(state.userId, payout, 'blackjack natural', null); addHouseNet(state.guildId, state.userId, 'blackjack', -win); try { recordSessionGame(state.guildId, state.userId, win); } catch {} const row = bjPlayAgainRow(state.table, state.bet, state.userId); return sendGameMessage(interaction, { embeds: [await bjEmbed(state, { footer: `Natural! You win ${chipsAmount(win)}.`, color: 0x57F287 })], components: [row] }); } catch { return interaction.reply({ content: '⚠️ Payout failed.', ephemeral: true }); }
    }
    try { await burnCredits(state.userId, state.creditsStake, 'blackjack loss (dealer BJ)', null); addHouseNet(state.guildId, state.userId, 'blackjack', state.chipsStake); try { recordSessionGame(state.guildId, state.userId, -state.chipsStake); } catch {} const row = bjPlayAgainRow(state.table, state.bet, state.userId); return sendGameMessage(interaction, { embeds: [await bjEmbed(state, { footer: 'Dealer Blackjack. You lose.', color: 0xED4245 })], components: [row] }); } catch { return interaction.reply({ content: '⚠️ Settle failed.', ephemeral: true }); }
  }
  const firstDecision = state.player.length === 2;
  const actions = [ { id: 'bj|hit', label: 'Hit', style: ButtonStyle.Primary, emoji: '➕' }, { id: 'bj|stand', label: 'Stand', style: ButtonStyle.Secondary, emoji: '✋' } ];
// Game: Blackjack — stateful hand play, settlement, and UI (Credits-first).
  if (firstDecision && await canAffordExtra(state.userId, state.bet)) actions.push({ id: 'bj|double', label: 'Double', style: ButtonStyle.Success, emoji: '⏫' });
  if (firstDecision) { const v1 = cardValueForSplit(state.player[0]); const v2 = cardValueForSplit(state.player[1]); if (v1 === v2 && await canAffordExtra(state.userId, state.bet)) actions.push({ id: 'bj|split', label: 'Split', style: ButtonStyle.Secondary, emoji: '✂️' }); }
  const row = new ActionRowBuilder().addComponents(...actions.map(({ id, label, style }) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style)));
  return sendGameMessage(interaction, { embeds: [await bjEmbed(state)], components: [row] } );
}
