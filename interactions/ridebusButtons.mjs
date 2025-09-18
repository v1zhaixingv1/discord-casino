export default async function onRideBusButtons(interaction, ctx) {
  const parts = interaction.customId.split('|'); // rb|<step>|<arg>[|ownerId]
  const step = parts[1];
  const arg = parts[2];

  if (step === 'again') {
    const bet = Number(arg) || 1;
    const ownerId = parts[3];
    if (ownerId && ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Only the original player can start another hand from this message.', ephemeral: true });
    const k = `${interaction.guild.id}:${interaction.user.id}`;
    ctx.ridebusGames.delete(k);
    return ctx.startRideBus(interaction, bet);
  }

  const k = ctx.keyFor(interaction);
  const state = ctx.ridebusGames.get(k);
  if (!state) return interaction.update({ content: '⌛ This session expired. Use `/ridebus` to start a new one.', components: [] });
  if (interaction.user.id !== state.userId) return interaction.reply({ content: '❌ Only the original player can use these buttons.', ephemeral: true });
  const burnStakeCredits = async (detail) => {
    try {
      const stake = Number(state.creditsStake) || 0;
      if (stake <= 0) return 0;
      const { credits } = await ctx.getUserBalances(state.userId);
      const toBurn = Math.min(stake, credits);
      if (toBurn > 0) await ctx.burnCredits(state.userId, toBurn, detail, null);
      return toBurn;
    } catch { return 0; }
  };
  if (ctx.hasActiveExpired(interaction.guild.id, interaction.user.id, 'ridebus')) {
    ctx.ridebusGames.delete(k);
    await burnStakeCredits('ridebus expired');
    try {
      const sess = ctx.getActiveSession(interaction.guild.id, interaction.user.id) || { houseNet: 0 };
      const net = (sess.houseNet || 0) + (state.chipsStake || 0);
      await ctx.postGameSessionEnd(interaction, { game: 'Ride the Bus', userId: state.userId, houseNet: net });
    } catch {}
    ctx.clearActiveSession(interaction.guild.id, interaction.user.id);
    return interaction.update({ content: '⌛ This session expired. Use `/ridebus` to start a new one.', components: [] });
  }
  ctx.touchActiveSession(interaction.guild.id, interaction.user.id, 'ridebus');
  const draw = () => state.deck.pop();

  if (step === 'cash') {
    const requestedStep = Number(arg);
    if (state.step !== 4 || requestedStep !== 3) return interaction.reply({ content: '❌ Cash out is only available at the final screen (after Q3).', ephemeral: true });
    const payout = ctx.wagerAt(state, 3);
    try {
      const { chips } = await ctx.transferFromHouseToUser(state.userId, payout, `ridebus cashout q3`, null);
      ctx.ridebusGames.delete(k);
      try { ctx.recordSessionGame(state.guildId, state.userId, payout - (state.chipsStake || 0)); } catch {}
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0) - payout);
      const doneEmbed = await ctx.embedForState(state, { description: `💰 **CASH OUT!** You took **${ctx.formatChips(payout)}** at Q3.\nYour balance: **${ctx.formatChips(chips)}**`, color: 0x57F287 });
      return interaction.update({ embeds: [doneEmbed], components: [ctx.playAgainRow(state.bet, state.userId)] });
    } catch {
      const err = await ctx.embedForState(state, { description: '❌ Cash out failed.', color: 0xED4245 });
      return interaction.update({ embeds: [err], components: [ctx.playAgainRow(state.bet, state.userId)] });
    }
  }

  if (step === 'q1' && state.step === 1) {
    const c1 = draw(); state.cards[0] = c1;
    const guessRed = (arg === 'red');
    const correct = (guessRed && ctx.color(c1) === 'RED') || (!guessRed && ctx.color(c1) === 'BLACK');
    if (!correct) {
      ctx.ridebusGames.delete(k);
      burnStakeCredits('ridebus loss (Q1)');
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0));
      try { ctx.recordSessionGame(state.guildId, state.userId, - (state.chipsStake || 0)); } catch {}
      const lossEmbed = await ctx.embedForState(state, { description: `❌ **Wrong!** Card was **${ctx.show(c1)}** (${ctx.color(c1)}). House keeps your bet.`, color: 0xED4245 });
      return ctx.sendGameMessage(interaction, { embeds: [lossEmbed], components: [ctx.playAgainRow(state.bet, state.userId)] });
    }
    state.step = 2;
    const q2Row = ctx.rowButtons([{ id: `rb|q2|higher`, label: 'Higher', style: 3 }, { id: `rb|q2|lower`, label: 'Lower', style: 4 }]);
    const emb = await ctx.embedForState(state, { description: `✅ Correct! First card: **${ctx.show(c1)}** • **Pot = ${ctx.formatChips(ctx.wagerAt(state, 1))}**\n**Q2:** Will the next card be Higher or Lower? (Tie loses)\n\n**Cards:** ${ctx.cardList(state.cards)}` });
    return ctx.sendGameMessage(interaction, { embeds: [emb], components: [q2Row] });
  }

  if (step === 'q2' && state.step === 2) {
    const c1 = state.cards[0];
    const c2 = draw(); state.cards[1] = c2;
    const correct = (arg === 'higher') ? (ctx.val(c2) > ctx.val(c1)) : (ctx.val(c2) < ctx.val(c1));
    if (!correct) {
      ctx.ridebusGames.delete(k);
      burnStakeCredits('ridebus loss (Q2)');
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0));
      try { ctx.recordSessionGame(state.guildId, state.userId, - (state.chipsStake || 0)); } catch {}
      const lossEmbed = await ctx.embedForState(state, { description: `❌ **Wrong!** ${ctx.show(c1)} → ${ctx.show(c2)}. House keeps pot.\n\n**Cards:** ${ctx.cardList(state.cards)}`, color: 0xED4245 });
      return ctx.sendGameMessage(interaction, { embeds: [lossEmbed], components: [ctx.playAgainRow(state.bet, state.userId)] });
    }
    state.step = 3;
    const isPair = ctx.val(c1) === ctx.val(c2);
    const baseQ3 = isPair ? [{ id: `rb|q3|outside`, label: 'Outside (pair rule)', style: 1 }] : [{ id: `rb|q3|inside`, label: 'Inside', style: 1 }, { id: `rb|q3|outside`, label: 'Outside', style: 2 }];
    const q3Row = ctx.rowButtons([...baseQ3]);
    const emb = await ctx.embedForState(state, { description: `✅ Correct! ${ctx.show(c1)} → ${ctx.show(c2)} • **Pot = ${ctx.formatChips(ctx.wagerAt(state, 2))}**\n**Q3:** ${isPair ? 'Pair! Only Outside allowed.' : 'Inside or Outside?'}\n\n**Cards:** ${ctx.cardList(state.cards)}` });
    return ctx.sendGameMessage(interaction, { embeds: [emb], components: [q3Row] });
  }

  if (step === 'q3' && state.step === 3) {
    const [c1, c2] = state.cards;
    const c3 = draw(); state.cards[2] = c3;
    const low = Math.min(ctx.val(c1), ctx.val(c2)), high = Math.max(ctx.val(c1), ctx.val(c2));
    const isPair = (low === high);
    const inside = ctx.val(c3) > low && ctx.val(c3) < high;
    const outside = ctx.val(c3) < low || ctx.val(c3) > high;
    const correct = arg === 'inside' ? inside : outside;
    if (isPair && arg === 'inside') {
      ctx.ridebusGames.delete(k);
      const burned = burnStakeCredits('ridebus loss (Q3 - pair rule)');
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0));
      try { ctx.recordSessionGame(state.guildId, state.userId, - (state.chipsStake || 0)); } catch {}
      const lossEmbed = await ctx.embedForState(state, { description: `❌ Loss. Pair rule: only Outside allowed. Draw: ${ctx.show(c3)}.\n\n**Cards:** ${ctx.cardList(state.cards)}\nCredits burned: **${ctx.formatChips(burned)}**`, color: 0xED4245 });
      return ctx.sendGameMessage(interaction, { embeds: [lossEmbed], components: [ctx.playAgainRow(state.bet, state.userId)] });
    }
    if (!correct) {
      ctx.ridebusGames.delete(k);
      const burned = burnStakeCredits('ridebus loss (Q3)');
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0));
      try { ctx.recordSessionGame(state.guildId, state.userId, - (state.chipsStake || 0)); } catch {}
      const lossEmbed = await ctx.embedForState(state, { description: `❌ Wrong! Draw was ${ctx.show(c3)}. House keeps pot.\n\n**Cards:** ${ctx.cardList(state.cards)}\nCredits burned: **${ctx.formatChips(burned)}**`, color: 0xED4245 });
      return interaction.update({ embeds: [lossEmbed], components: [ctx.playAgainRow(state.bet, state.userId)] });
    }
    state.step = 4;
    const q4Row = ctx.rowButtons([
      { id: `rb|q4|S`, label: '♠ Spades', style: 2 },
      { id: `rb|q4|H`, label: '♥ Hearts', style: 4 },
      { id: `rb|q4|D`, label: '♦ Diamonds', style: 4 },
      { id: `rb|q4|C`, label: '♣ Clubs', style: 2 },
      { id: `rb|cash|3`, label: `Cash Out (${ctx.formatChips(ctx.wagerAt(state, 3))})`, style: 2 }
    ]);
    const emb = await ctx.embedForState(state, { description: `✅ Correct! Card: ${ctx.show(c3)} • **Pot = ${ctx.formatChips(ctx.wagerAt(state, 3))}**\n**Q4:** Pick a suit to win **${ctx.formatChips(ctx.wagerAt(state, 4))}**\n\n**Cards:** ${ctx.cardList(state.cards)}` });
    return ctx.sendGameMessage(interaction, { embeds: [emb], components: [q4Row] });
  }

  if (step === 'q4' && state.step === 4) {
    const c4 = draw(); state.cards[3] = c4;
    const win = (c4.s === arg);
    ctx.ridebusGames.delete(k);
    if (!win) {
      const burned = await burnStakeCredits('ridebus loss (Q4)');
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0));
      try { ctx.recordSessionGame(state.guildId, state.userId, - (state.chipsStake || 0)); } catch {}
      const lossEmbed = await ctx.embedForState(state, { description: `❌ Wrong suit. Final card: ${ctx.show(c4)}. House keeps pot.\n\n**Cards:** ${ctx.cardList(state.cards)}\nCredits burned: **${ctx.formatChips(burned)}**`, color: 0xED4245 });
      return interaction.update({ embeds: [lossEmbed], components: [ctx.playAgainRow(state.bet, state.userId)] });
    }
    const payout = ctx.wagerAt(state, 4);
    try {
      const { chips } = await ctx.transferFromHouseToUser(state.userId, payout, 'ridebus win', null);
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0) - payout);
      const winEmbed = await ctx.embedForState(state, { description: `🏆 **WIN!** Final card ${ctx.show(c4)} matched. You are paid **${ctx.formatChips(payout)}** chips.\nYour balance: **${ctx.formatChips(chips)}**\n\n**Cards:** ${ctx.cardList(state.cards)}`, color: 0x57F287 });
      try { ctx.recordSessionGame(state.guildId, state.userId, payout - (state.chipsStake || 0)); } catch {}
      return ctx.sendGameMessage(interaction, { embeds: [winEmbed], components: [ctx.playAgainRow(state.bet, state.userId)] });
    } catch {
      const err = await ctx.embedForState(state, { description: '⚠️ House could not pay out.', color: 0xFEE75C });
      return interaction.update({ embeds: [err], components: [ctx.playAgainRow(state.bet, state.userId)] });
    }
  }

  return interaction.reply({ content: '❌ Invalid or stale button.', ephemeral: true });
}
// Interaction: Ride the Bus buttons (Q1–Q4, cash out, again)
