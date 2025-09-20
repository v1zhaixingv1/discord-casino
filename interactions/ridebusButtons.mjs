export default async function onRideBusButtons(interaction, ctx) {
  const parts = interaction.customId.split('|'); // rb|<step>|<arg>[|ownerId]
  const step = parts[1];
  const arg = parts[2];

  const flavor = (kittenMode, text) => (ctx.kittenizeText && kittenMode) ? ctx.kittenizeText(text) : text;
  const wrap = (kittenMode, kittenText, normalText) => kittenMode ? kittenText : normalText;

  if (step === 'again') {
    const bet = Number(arg) || 1;
    const ownerId = parts[3];
    if (ownerId && ownerId !== interaction.user.id) {
      const msg = flavor(false, '❌ Only the original player can start another hand from this message.');
      return interaction.reply({ content: msg, ephemeral: true });
    }
    const k = `${interaction.guild.id}:${interaction.user.id}`;
    ctx.ridebusGames.delete(k);
    return ctx.startRideBus(interaction, bet);
  }

  const k = ctx.keyFor(interaction);
  const state = ctx.ridebusGames.get(k);
  if (!state) {
    const msg = ctx.kittenizeText ? ctx.kittenizeText('⌛ This session cooled off. Use `/ridebus` to tempt fate again, Kitten.') : '⌛ This session expired. Use `/ridebus` to start a new one.';
    return interaction.update({ content: msg, components: [] });
  }

  const kittenMode = !!state.kittenMode;
  const say = (kittenText, normalText) => wrap(kittenMode, kittenText, normalText);
  const speak = (kittenText, normalText) => flavor(kittenMode, say(kittenText, normalText));

  if (interaction.user.id !== state.userId) {
    const msg = speak('❌ Hands off, Kitten. Only the player who started this ride may press these buttons.', '❌ Only the original player can use these buttons.');
    return interaction.reply({ content: msg, ephemeral: true });
  }

  const burnStakeCredits = async (detail) => {
    try {
      const stake = Number(state.creditsStake) || 0;
      if (stake <= 0) return 0;
      const { credits } = await ctx.getUserBalances(state.userId);
      const toBurn = Math.min(stake, credits);
      if (toBurn > 0) await ctx.burnCredits(state.userId, toBurn, detail, null);
      return toBurn;
    } catch {
      return 0;
    }
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
    const msg = speak('⌛ Our little ride fizzled out, Kitten. Use `/ridebus` when you crave another rush.', '⌛ This session expired. Use `/ridebus` to start a new one.');
    return interaction.update({ content: msg, components: [] });
  }

  ctx.touchActiveSession(interaction.guild.id, interaction.user.id, 'ridebus');
  const draw = () => state.deck.pop();

  if (step === 'cash') {
    const requestedStep = Number(arg);
    if (state.step !== 4 || requestedStep !== 3) {
      const msg = speak('❌ Patience, Kitten—cash outs unlock only after Q3.', '❌ Cash out is only available at the final screen (after Q3).');
      return interaction.reply({ content: msg, ephemeral: true });
    }
    const payout = ctx.wagerAt(state, 3);
    try {
      const { chips } = await ctx.transferFromHouseToUser(state.userId, payout, 'ridebus cashout q3', null);
      ctx.ridebusGames.delete(k);
      try { ctx.recordSessionGame(state.guildId, state.userId, payout - (state.chipsStake || 0)); } catch {}
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0) - payout);
      const description = say(
        `💰 **Cash Out!** You slipped away with **${ctx.formatChips(payout)}** at Q3, my clever Kitten.\nYour balance now purrs at **${ctx.formatChips(chips)}**`,
        `💰 **CASH OUT!** You took **${ctx.formatChips(payout)}** at Q3.\nYour balance: **${ctx.formatChips(chips)}**`
      );
      const doneEmbed = await ctx.embedForState(state, { description, color: 0x57F287, kittenMode });
      return interaction.update({ embeds: [doneEmbed], components: [ctx.playAgainRow(state.bet, state.userId, { kittenMode })] });
    } catch {
      const errEmbed = await ctx.embedForState(state, {
        description: say('❌ Cash out faltered, Kitten. The house didn’t accept the tease.', '❌ Cash out failed.'),
        color: 0xED4245,
        kittenMode
      });
      return interaction.update({ embeds: [errEmbed], components: [ctx.playAgainRow(state.bet, state.userId, { kittenMode })] });
    }
  }

  if (step === 'q1' && state.step === 1) {
    const c1 = draw(); state.cards[0] = c1;
    const guessRed = (arg === 'red');
    const correct = (guessRed && ctx.color(c1) === 'RED') || (!guessRed && ctx.color(c1) === 'BLACK');
    if (!correct) {
      ctx.ridebusGames.delete(k);
      await burnStakeCredits('ridebus loss (Q1)');
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0));
      try { ctx.recordSessionGame(state.guildId, state.userId, -(state.chipsStake || 0)); } catch {}
      const lossEmbed = await ctx.embedForState(state, {
        description: say(`❌ Wrong move, Kitten. Card was **${ctx.show(c1)}** (${ctx.color(c1)}). The house keeps your wager.`, `❌ **Wrong!** Card was **${ctx.show(c1)}** (${ctx.color(c1)}). House keeps your bet.`),
        color: 0xED4245,
        kittenMode
      });
      return ctx.sendGameMessage(interaction, { embeds: [lossEmbed], components: [ctx.playAgainRow(state.bet, state.userId, { kittenMode })] });
    }
    state.step = 2;
    const q2Row = ctx.rowButtons([
      { id: `rb|q2|higher`, label: say('Higher — chase the thrill', 'Higher'), style: 3 },
      { id: `rb|q2|lower`, label: say('Lower — play it coy', 'Lower'), style: 4 }
    ], { kittenMode });
    const emb = await ctx.embedForState(state, {
      description: say(
        `✅ Delicious! First card **${ctx.show(c1)}** and the pot now purrs at **${ctx.formatChips(ctx.wagerAt(state, 1))}**.\n**Q2:** Do you dare go Higher or Lower? (Tie still stings.)` ,
        `✅ Correct! First card: **${ctx.show(c1)}** • **Pot = ${ctx.formatChips(ctx.wagerAt(state, 1))}**\n**Q2:** Will the next card be Higher or Lower? (Tie loses)`
      ),
      kittenMode
    });
    return ctx.sendGameMessage(interaction, { embeds: [emb], components: [q2Row] });
  }

  if (step === 'q2' && state.step === 2) {
    const c1 = state.cards[0];
    const c2 = draw(); state.cards[1] = c2;
    const correct = (arg === 'higher') ? (ctx.val(c2) > ctx.val(c1)) : (ctx.val(c2) < ctx.val(c1));
    if (!correct) {
      ctx.ridebusGames.delete(k);
      await burnStakeCredits('ridebus loss (Q2)');
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0));
      try { ctx.recordSessionGame(state.guildId, state.userId, -(state.chipsStake || 0)); } catch {}
      const lossEmbed = await ctx.embedForState(state, {
        description: say(`❌ Not this time, Kitten. ${ctx.show(c1)} → ${ctx.show(c2)} and the house clings to the pot.`, `❌ **Wrong!** ${ctx.show(c1)} → ${ctx.show(c2)}. House keeps pot.`),
        color: 0xED4245,
        kittenMode
      });
      return ctx.sendGameMessage(interaction, { embeds: [lossEmbed], components: [ctx.playAgainRow(state.bet, state.userId, { kittenMode })] });
    }
    state.step = 3;
    const isPair = ctx.val(c1) === ctx.val(c2);
    const baseButtons = isPair
      ? [{ id: `rb|q3|outside`, label: say('Outside — pair rules', 'Outside (pair rule)'), style: 1 }]
      : [
          { id: `rb|q3|inside`, label: say('Inside — snug between', 'Inside'), style: 1 },
          { id: `rb|q3|outside`, label: say('Outside — tease the edges', 'Outside'), style: 2 }
        ];
    const q3Row = ctx.rowButtons(baseButtons, { kittenMode });
    const emb = await ctx.embedForState(state, {
      description: say(
        `✅ Lovely! ${ctx.show(c1)} → ${ctx.show(c2)} and the pot hums at **${ctx.formatChips(ctx.wagerAt(state, 2))}**.\n**Q3:** ${isPair ? 'Pair spotted—only Outside is allowed, Kitten.' : 'Inside or Outside? Choose the embrace you crave.'}`,
        `✅ Correct! ${ctx.show(c1)} → ${ctx.show(c2)} • **Pot = ${ctx.formatChips(ctx.wagerAt(state, 2))}**\n**Q3:** ${isPair ? 'Pair! Only Outside allowed.' : 'Inside or Outside?'}`
      ),
      kittenMode
    });
    return ctx.sendGameMessage(interaction, { embeds: [emb], components: [q3Row] });
  }

  if (step === 'q3' && state.step === 3) {
    const [c1, c2] = state.cards;
    const c3 = draw(); state.cards[2] = c3;
    const low = Math.min(ctx.val(c1), ctx.val(c2));
    const high = Math.max(ctx.val(c1), ctx.val(c2));
    const isPair = (low === high);
    const inside = ctx.val(c3) > low && ctx.val(c3) < high;
    const outside = ctx.val(c3) < low || ctx.val(c3) > high;
    const correct = arg === 'inside' ? inside : outside;

    if (isPair && arg === 'inside') {
      ctx.ridebusGames.delete(k);
      const burned = await burnStakeCredits('ridebus loss (Q3 - pair rule)');
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0));
      try { ctx.recordSessionGame(state.guildId, state.userId, -(state.chipsStake || 0)); } catch {}
      const lossEmbed = await ctx.embedForState(state, {
        description: say(
          `❌ Naughty! Pair rule meant Outside only, Kitten. Draw was ${ctx.show(c3)}, so the house devours the pot.\nCredits burned: **${ctx.formatChips(burned)}**`,
          `❌ Loss. Pair rule: only Outside allowed. Draw: ${ctx.show(c3)}.\nCredits burned: **${ctx.formatChips(burned)}**`
        ),
        color: 0xED4245,
        kittenMode
      });
      return ctx.sendGameMessage(interaction, { embeds: [lossEmbed], components: [ctx.playAgainRow(state.bet, state.userId, { kittenMode })] });
    }

    if (!correct) {
      ctx.ridebusGames.delete(k);
      const burned = await burnStakeCredits('ridebus loss (Q3)');
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0));
      try { ctx.recordSessionGame(state.guildId, state.userId, -(state.chipsStake || 0)); } catch {}
      const lossEmbed = await ctx.embedForState(state, {
        description: say(
          `❌ Missed it, Kitten. Draw was ${ctx.show(c3)} and the house clings to the pot.\nCredits burned: **${ctx.formatChips(burned)}**`,
          `❌ Wrong! Draw was ${ctx.show(c3)}. House keeps pot.\nCredits burned: **${ctx.formatChips(burned)}**`
        ),
        color: 0xED4245,
        kittenMode
      });
      return interaction.update({ embeds: [lossEmbed], components: [ctx.playAgainRow(state.bet, state.userId, { kittenMode })] });
    }

    state.step = 4;
    const q4Row = ctx.rowButtons([
      { id: `rb|q4|S`, label: say('♠ Spades — sharp & daring', '♠ Spades'), style: 2 },
      { id: `rb|q4|H`, label: say('♥ Hearts — warm & wicked', '♥ Hearts'), style: 4 },
      { id: `rb|q4|D`, label: say('♦ Diamonds — glitter & tease', '♦ Diamonds'), style: 4 },
      { id: `rb|q4|C`, label: say('♣ Clubs — bold & rooted', '♣ Clubs'), style: 2 },
      { id: `rb|cash|3`, label: say(`Cash Out, Kitten (${ctx.formatChips(ctx.wagerAt(state, 3))})`, `Cash Out (${ctx.formatChips(ctx.wagerAt(state, 3))})`), style: 2 }
    ], { kittenMode });
    const emb = await ctx.embedForState(state, {
      description: say(
        `✅ Lovely choice! Card ${ctx.show(c3)} pushes the pot to **${ctx.formatChips(ctx.wagerAt(state, 3))}**.\n**Q4:** Pick a suit and I’ll pay **${ctx.formatChips(ctx.wagerAt(state, 4))}** if you thrill me.`,
        `✅ Correct! Card: ${ctx.show(c3)} • **Pot = ${ctx.formatChips(ctx.wagerAt(state, 3))}**\n**Q4:** Pick a suit to win **${ctx.formatChips(ctx.wagerAt(state, 4))}**`
      ),
      kittenMode
    });
    return ctx.sendGameMessage(interaction, { embeds: [emb], components: [q4Row] });
  }

  if (step === 'q4' && state.step === 4) {
    const c4 = draw(); state.cards[3] = c4;
    const win = (c4.s === arg);
    ctx.ridebusGames.delete(k);

    if (!win) {
      const burned = await burnStakeCredits('ridebus loss (Q4)');
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0));
      try { ctx.recordSessionGame(state.guildId, state.userId, -(state.chipsStake || 0)); } catch {}
      const lossEmbed = await ctx.embedForState(state, {
        description: say(
          `❌ Wrong suit, Kitten. Final card ${ctx.show(c4)} keeps the spoils in my hands.\nCredits burned: **${ctx.formatChips(burned)}**`,
          `❌ Wrong suit. Final card: ${ctx.show(c4)}. House keeps pot.\nCredits burned: **${ctx.formatChips(burned)}**`
        ),
        color: 0xED4245,
        kittenMode
      });
      return interaction.update({ embeds: [lossEmbed], components: [ctx.playAgainRow(state.bet, state.userId, { kittenMode })] });
    }

    const payout = ctx.wagerAt(state, 4);
    try {
      const { chips } = await ctx.transferFromHouseToUser(state.userId, payout, 'ridebus win', null);
      ctx.addHouseNet(state.guildId, state.userId, 'ridebus', (state.chipsStake || 0) - payout);
      const winEmbed = await ctx.embedForState(state, {
        description: say(
          `🏆 **Win!** Final card ${ctx.show(c4)} obeyed your command, Kitten. Enjoy **${ctx.formatChips(payout)}** chips—balance now **${ctx.formatChips(chips)}**.`,
          `🏆 **WIN!** Final card ${ctx.show(c4)} matched. You are paid **${ctx.formatChips(payout)}** chips.\nYour balance: **${ctx.formatChips(chips)}**`
        ),
        color: 0x57F287,
        kittenMode
      });
      try { ctx.recordSessionGame(state.guildId, state.userId, payout - (state.chipsStake || 0)); } catch {}
      return ctx.sendGameMessage(interaction, { embeds: [winEmbed], components: [ctx.playAgainRow(state.bet, state.userId, { kittenMode })] });
    } catch {
      const errEmbed = await ctx.embedForState(state, {
        description: say('⚠️ The house fumbled the purse, Kitten. No payout this time.', '⚠️ House could not pay out.'),
        color: 0xFEE75C,
        kittenMode
      });
      return interaction.update({ embeds: [errEmbed], components: [ctx.playAgainRow(state.bet, state.userId, { kittenMode })] });
    }
  }

  const msg = speak('❌ Naughty Kitten, that button no longer works.', '❌ Invalid or stale button.');
  return interaction.reply({ content: msg, ephemeral: true });
}
