import { EmbedBuilder } from 'discord.js';

export default async function onRouletteButtons(interaction, ctx) {
  const key = ctx.keyFor(interaction);
  const state = ctx.rouletteSessions.get(key);
  const parts = interaction.customId.split('|');
  const action = parts[1];
  if (action !== 'again') {
    if (ctx.hasActiveExpired(interaction.guild.id, interaction.user.id, 'roulette') || !ctx.getActiveSession(interaction.guild.id, interaction.user.id)) {
      ctx.rouletteSessions.delete(key);
      return interaction.update({ content: '⌛ This roulette session expired. Use `/roulette` to start a new one.', embeds: [], components: [] });
    }
    ctx.touchActiveSession(interaction.guild.id, interaction.user.id, 'roulette');
  }
  if (action === 'confirm') {
    if (!state || !state.bets?.length) return interaction.reply({ content: '❌ No bets to confirm.', ephemeral: true });
    const { chips, credits } = await ctx.getUserBalances(interaction.user.id);
    const total = state.bets.reduce((s,b)=>s+b.amount,0);
    if (chips + credits < total) return interaction.reply({ content: '❌ Not enough funds.', ephemeral: true });
    // credits-first allocation
    let remH = chips, remC = credits;
    for (const b of state.bets) {
      b.creditPart = Math.min(b.amount, remC);
      remC -= b.creditPart;
      b.chipPart = b.amount - b.creditPart;
      remH -= b.chipPart;
      b.payoutMult = ctx.roulettePayoutMult(b.type);
    }
    const chipStake = state.bets.reduce((s,b)=>s+b.chipPart,0);
    const neededCover = chipStake + state.bets.reduce((s,b)=>s + (b.amount * b.payoutMult),0);
    if (await ctx.getHouseBalance() < neededCover) return interaction.reply({ content: `❌ House cannot cover potential payout. Needed: **${ctx.chipsAmount(neededCover)}**.`, ephemeral: true });
    if (chipStake>0) try { await ctx.takeFromUserToHouse(interaction.user.id, chipStake, 'roulette buy-in (chips)', interaction.user.id); } catch { return interaction.reply({ content: '❌ Could not process buy-in.', ephemeral: true }); }
    const spin = ctx.spinRoulette();
    const colorEmoji = spin.color === 'RED' ? '🟥' : spin.color === 'BLACK' ? '⬛' : '🟩';
    const pocketLabel = spin.label;
    let winnings = 0;
    const wins = [];
    for (const b of state.bets) {
      const won = ctx.rouletteWins(b.type, b.pocket, spin);
      if (won) { const w = b.amount * b.payoutMult; winnings += w; wins.push(b); }
      else { try { if (b.creditPart>0) await ctx.burnCredits(interaction.user.id, b.creditPart, `roulette loss (${b.type})`, null); } catch {} }
    }
    const returnStake = wins.reduce((s,b)=>s+b.chipPart,0);
    const payout = winnings + returnStake;
    if (payout>0) { try { await ctx.transferFromHouseToUser(interaction.user.id, payout, 'roulette payout', null); } catch { return interaction.reply({ content:'⚠️ Payout failed.', ephemeral:true }); } }
    const lines = [`🎡 Roulette Result: ${colorEmoji} **${pocketLabel}**`, ...state.bets.map(b=>`${wins.includes(b)?'✅ Win':'❌ Lose'}: ${b.type}${b.pocket!==undefined?` ${b.pocket}`:''} — **${ctx.chipsAmount(b.amount)}**`), `Total won: **${ctx.chipsAmount(winnings)}**`];
    ctx.addHouseNet(interaction.guild.id, interaction.user.id, 'roulette', chipStake - payout);
    try { ctx.recordSessionGame(interaction.guild.id, interaction.user.id, payout - chipStake); } catch {}
    ctx.rouletteSessions.delete(key);
    const resultEmbed = new EmbedBuilder()
      .setTitle('🎡 Roulette')
      .setColor(winnings > 0 ? 0x57F287 : 0xED4245)
      .setDescription(lines.join('\n'));
    try {
      const { chips, credits } = await ctx.getUserBalances(interaction.user.id);
      const fmt = new Intl.NumberFormat('en-US');
      const sess = ctx.getActiveSession(interaction.guild.id, interaction.user.id);
      const sessLine = sess ? `Session: Games **${sess.games||0}** • Net **${(sess.playerNet||0)>=0?'+':'-'}${Math.abs(sess.playerNet||0).toLocaleString()} Chips**` : null;
      const val = [
        `Chips: **${ctx.chipsAmount(chips)}**`,
        `Credits: **${fmt.format(credits)}**`,
        sessLine
      ].filter(Boolean).join('\n');
      resultEmbed.addFields({ name: 'Player Balance', value: val });
      try { resultEmbed.addFields(ctx.buildTimeoutField(interaction.guild.id, interaction.user.id)); } catch {}
    } catch {}
    return ctx.sendGameMessage(interaction, { embeds: [resultEmbed], components: [ctx.rowButtons([{ id: `rou|again|${interaction.user.id}`, label: 'Play Again', style: 2 }])] }, 'update');
  }
  if (action === 'cancel') {
    try {
      await ctx.endActiveSessionForUser(interaction, 'cancel');
    } catch {}
    return interaction.reply({ content: '❌ Roulette session ended.', ephemeral: true });
  }
  if (action === 'again') {
    const ownerId = parts[2];
    if (ownerId && ownerId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Only the original player can start again from this message.', ephemeral: true });
    }
    ctx.rouletteSessions.delete(key);
    ctx.rouletteSessions.set(key, { guildId: interaction.guild.id, userId: interaction.user.id, bets: [] });
    ctx.setActiveSession(interaction.guild.id, interaction.user.id, 'roulette', 'Roulette');
    return ctx.startRouletteSession(interaction);
  }
  return interaction.reply({ content: '❌ Unknown action.', ephemeral: true });
}
// Interaction: Roulette buttons (confirm/cancel/again)
