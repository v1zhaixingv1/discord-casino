import { EmbedBuilder } from 'discord.js';
import { getGuildSettings, getUserBalances, getHouseBalance, takeFromUserToHouse, transferFromHouseToUser, burnCredits } from '../db.auto.mjs';
import { chipsAmount } from '../games/format.mjs';

async function inCasinoCategory(interaction) {
  try {
    const { casino_category_id } = await getGuildSettings(interaction.guild.id) || {};
    if (!casino_category_id) return { ok: false, reason: '❌ Casino category is not configured. Mods: use /setcasinocategory.' };
    const ch = interaction.channel;
    let catId = null;
    try {
      if (typeof ch?.isThread === 'function' && ch.isThread()) catId = ch.parent?.parentId || null;
      else catId = ch?.parentId || null;
    } catch {}
    if (!catId || catId !== casino_category_id) return { ok: false, reason: '❌ Use this in the configured casino category.' };
    return { ok: true };
  } catch { return { ok: false, reason: '❌ Unable to verify channel category.' }; }
}

export async function playDiceWar(interaction, ctx, bet) {
  const guildId = interaction.guild?.id;
  const loc = await inCasinoCategory(interaction);
  if (!loc.ok) return interaction.reply({ content: loc.reason, ephemeral: true });
  if (!Number.isInteger(bet) || bet <= 0) return interaction.reply({ content: '❌ Bet must be a positive integer.', ephemeral: true });

  // Require funds to cover the base bet only
  const { chips, credits } = await getUserBalances(guildId, interaction.user.id);
  const total = (chips || 0) + (credits || 0);
  if (total < bet) {
    return interaction.reply({ content: `❌ You need at least **${chipsAmount(bet)}** in Chips+Credits.`, ephemeral: true });
  }

  // Roll dice
  const rollDie = () => 1 + Math.floor(Math.random() * 6);
  const p1 = rollDie(), p2 = rollDie();
  const h1 = rollDie(), h2 = rollDie();
  const playerTotal = p1 + p2;
  const houseTotal = h1 + h2;
  const playerDoubles = (p1 === p2);

  // House cover check: must cover returning chipStake and winnings
  // Credits-first staking: cover from Credits first, then Chips
  const creditStake = Math.min(bet, credits);
  const chipStake = bet - creditStake;
  // Worst-case payout occurs when player wins and has doubles: requires house to return chipStake + 2×bet
  const coverNeeded = chipStake + (2 * bet);
  const cover = await getHouseBalance(guildId);
  if (cover < coverNeeded) {
    return interaction.reply({ content: `❌ House cannot cover potential payout. Needed cover: **${chipsAmount(coverNeeded)}**.`, ephemeral: true });
  }

  // Take chip stake from user to house
  if (chipStake > 0) {
    try { await takeFromUserToHouse(guildId, interaction.user.id, chipStake, 'dice war buy-in (chips)', interaction.user.id); }
    catch { return interaction.reply({ content: '❌ Could not process buy-in.', ephemeral: true }); }
  }

  let outcome = '';
  let payout = 0;
  const playerWins = playerTotal > houseTotal;
  const doubleWin = playerWins && playerDoubles; // doubles only double when the player wins
  if (playerWins) {
    const winAmount = bet * (doubleWin ? 2 : 1);
    payout = chipStake + winAmount; // return chipStake + winnings
    try { await transferFromHouseToUser(guildId, interaction.user.id, payout, 'dice war win', null); }
    catch { return interaction.reply({ content: '⚠️ Payout failed.', ephemeral: true }); }
    outcome = `✅ You win **${chipsAmount(winAmount)}**` + (doubleWin ? ' (doubles doubled pot)' : '');
  } else {
    // tie or house higher => house wins; burn credits portion if any
    if (creditStake > 0) try { await burnCredits(guildId, interaction.user.id, creditStake, 'dice war loss', null); } catch {}
    outcome = '❌ House wins';
  }

  const e = new EmbedBuilder()
    .setTitle('🎲 Dice War')
    .setColor(playerTotal > houseTotal ? 0x57F287 : 0xED4245)
    .addFields(
      { name: 'Your Roll', value: `🎲 ${p1} + ${p2} = **${playerTotal}**${playerDoubles ? ' (doubles)' : ''}`, inline: true },
      { name: 'House Roll', value: `🎲 ${h1} + ${h2} = **${houseTotal}**`, inline: true },
      { name: 'Bet', value: `**${chipsAmount(bet)}**`, inline: true },
      { name: 'Result', value: outcome, inline: false }
    );
  try { e.addFields(ctx.buildPlayerBalanceField(interaction.guild.id, interaction.user.id)); } catch {}
  try { e.addFields(ctx.buildTimeoutField(interaction.guild.id, interaction.user.id)); } catch {}

  // Session tracking
  try {
    ctx.setActiveSession(interaction.guild.id, interaction.user.id, 'dicewar', 'Dice War');
    const houseNet = playerWins ? -(bet * (doubleWin ? 2 : 1)) : chipStake;
    ctx.addHouseNet(interaction.guild.id, interaction.user.id, 'dicewar', houseNet);
    // Player net for record (doesn't include returning chip stake)
    ctx.recordSessionGame(interaction.guild.id, interaction.user.id, playerWins ? (bet * (doubleWin ? 2 : 1)) : -chipStake);
    ctx.touchActiveSession(interaction.guild.id, interaction.user.id, 'dicewar');
  } catch {}

  // Play again button
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
  const again = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dice|again|${bet}|${interaction.user.id}`).setLabel('Play Again').setEmoji('🎲').setStyle(ButtonStyle.Secondary)
  );

  return ctx.sendGameMessage(interaction, { embeds: [e], components: [again] });
}

export default async function handleDiceWar(interaction, ctx) {
  const bet = interaction.options.getInteger('bet');
  return playDiceWar(interaction, ctx, bet);
}
// Slash Command: /dicewar — roll 2d6 vs House with Credits-first staking
