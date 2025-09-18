export default async function onBlackjackButtons(interaction, ctx) {
  const parts = interaction.customId.split('|');
  let action = parts[1];
  const k = ctx.keyFor(interaction);
  const state = ctx.blackjackGames.get(k);
  if (action !== 'again') {
    if (!state) return interaction.update({ content: '⌛ This session expired. Use `/blackjack` to start a new one.', components: [] });
    if (interaction.user.id !== state.userId) return interaction.reply({ content: '❌ Only the original player can use these buttons.', ephemeral: true });
    if (state.finished) return interaction.reply({ content: '❌ Hand already finished.', ephemeral: true });
  }
  if (action !== 'again' && ctx.hasActiveExpired(interaction.guild.id, interaction.user.id, 'blackjack')) {
    if (state) {
      ctx.blackjackGames.delete(k);
      try { if (state.creditsStake > 0) await ctx.burnCredits(state.userId, state.creditsStake, 'blackjack expired', null); } catch {}
      const sess = ctx.getActiveSession(interaction.guild.id, interaction.user.id) || { houseNet: 0 };
      const chipsStake = state.split && Array.isArray(state.hands)
        ? (state.hands?.[0]?.chipsStake || 0) + (state.hands?.[1]?.chipsStake || 0)
        : (state.chipsStake || 0);
      const net = (sess.houseNet || 0) + chipsStake;
      await ctx.postGameSessionEnd(interaction, { game: 'Blackjack', userId: state.userId, houseNet: net });
      ctx.clearActiveSession(interaction.guild.id, interaction.user.id);
    }
    return interaction.update({ content: '⌛ This session expired. Use `/blackjack` to start a new one.', components: [] });
  }
  ctx.touchActiveSession(interaction.guild.id, interaction.user.id, 'blackjack');
  const draw = () => state.deck.pop();
  const settleLoss = async (reason) => {
    ctx.blackjackGames.delete(k);
    await ctx.burnUpToCredits(state.userId, state.creditsStake, reason);
    ctx.addHouseNet(state.guildId, state.userId, 'blackjack', state.chipsStake);
    try { ctx.recordSessionGame(state.guildId, state.userId, -state.chipsStake); } catch {}
    const emb = await ctx.bjEmbed(state, { footer: 'You bust. Dealer wins.', color: 0xED4245 });
    return interaction.update({ embeds: [emb], components: [ctx.bjPlayAgainRow(state.table, state.bet, state.userId)] });
  };
  if (action === 'again') {
    const table = parts[2];
    const bet = Number(parts[3]) || 1;
    const ownerId = parts[4];
    if (ownerId && ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Only the original player can start another hand from this message.', ephemeral: true });
    ctx.blackjackGames.delete(k);
    return ctx.startBlackjack(interaction, table, bet);
  }
  if (action === 'hit') {
    if (state.split) {
      const hand = state.hands[state.active];
      hand.cards.push(draw());
      const p = ctx.bjHandValue(hand.cards);
      if (p.total > 21) {
        try { if (hand.creditsStake > 0) await ctx.burnCredits(state.userId, hand.creditsStake, 'blackjack loss (bust split)', null); } catch {}
        hand.busted = true;
        hand.finished = true;
        if (state.active === 0) { state.active = 1; }
        else { action = 'stand'; }
      }
      if (action !== 'stand') {
        const row = ctx.rowButtons([{ id: 'bj|hit', label: 'Hit', style: 1 }, { id: 'bj|stand', label: 'Stand', style: 2 }]);
        return interaction.update({ embeds: [await ctx.bjEmbed(state)], components: [row] });
      }
    } else {
      state.player.push(draw());
      const p = ctx.bjHandValue(state.player);
      if (p.total > 21) { state.revealed = true; return settleLoss('blackjack loss (bust)'); }
      const row = ctx.rowButtons([{ id: 'bj|hit', label: 'Hit', style: 1 }, { id: 'bj|stand', label: 'Stand', style: 2 }]);
      return interaction.update({ embeds: [await ctx.bjEmbed(state)], components: [row] });
    }
  }
  if (action === 'double') {
    if (state.split) return interaction.reply({ content: '❌ Double after split is not supported in this version.', ephemeral: true });
    if (state.player.length !== 2 || state.doubled) return interaction.reply({ content: '❌ Double is only available on your first decision.', ephemeral: true });
    const addBet = state.bet;
    if (!(await ctx.canAffordExtra(state.userId, addBet))) return interaction.reply({ content: '❌ Not enough funds to double.', ephemeral: true });
    try {
      // Credits-first for the added stake
      const { credits, chips } = await ctx.getUserBalances(state.userId);
      const extraCredit = Math.min(addBet, credits);
      const extraChip = addBet - extraCredit;
      if (extraChip > 0) await ctx.takeFromUserToHouse(state.userId, extraChip, 'blackjack double (chips)', state.userId);
      state.bet += addBet; state.creditsStake += extraCredit; state.chipsStake += extraChip; state.doubled = true;
    } catch { return interaction.reply({ content: '❌ Could not process double. Check your funds.', ephemeral: true }); }
    state.player.push(draw()); state.revealed = true;
    const dealerPlay = () => { while (true) { const v = ctx.bjHandValue(state.dealer); if (v.total > 21) return; if (v.total < 17) { state.dealer.push(draw()); continue; } if (v.total === 17 && state.table === 'HIGH' && v.soft) { state.dealer.push(draw()); continue; } return; } };
    dealerPlay();
    const p = ctx.bjHandValue(state.player), d = ctx.bjHandValue(state.dealer);
    ctx.blackjackGames.delete(k);
    if (p.total > 21) { try { if (state.creditsStake > 0) await ctx.burnCredits(state.userId, state.creditsStake, 'blackjack loss (double bust)', null); } catch {}; ctx.addHouseNet(state.guildId, state.userId, 'blackjack', state.chipsStake); try { ctx.recordSessionGame(state.guildId, state.userId, -state.chipsStake); } catch {}; return interaction.update({ embeds: [await ctx.bjEmbed(state, { footer: 'You bust after doubling. Dealer wins.', color: 0xED4245 })], components: [ctx.bjPlayAgainRow(state.table, state.bet / 2, state.userId)] }); }
    if (d.total > 21) { const win = state.bet; try { const payout = state.chipsStake + win; await ctx.transferFromHouseToUser(state.userId, payout, 'blackjack win (double, dealer bust)', null); ctx.addHouseNet(state.guildId, state.userId, 'blackjack', -win); try { ctx.recordSessionGame(state.guildId, state.userId, win); } catch {}; return interaction.update({ embeds: [await ctx.bjEmbed(state, { footer: `Dealer busts. You win ${ctx.formatChips(win)}.`, color: 0x57F287 })], components: [ctx.bjPlayAgainRow(state.table, state.bet / 2, state.userId)] }); } catch { return interaction.update({ content: '⚠️ Payout failed.', components: [] }); } }
    if (p.total > d.total) { const win = state.bet; try { const payout = state.chipsStake + win; await ctx.transferFromHouseToUser(state.userId, payout, 'blackjack win (double)', null); ctx.addHouseNet(state.guildId, state.userId, 'blackjack', -win); try { ctx.recordSessionGame(state.guildId, state.userId, win); } catch {}; return interaction.update({ embeds: [await ctx.bjEmbed(state, { footer: `You win ${ctx.chipsAmount(win)}.`, color: 0x57F287 })], components: [ctx.bjPlayAgainRow(state.table, state.bet / 2, state.userId)] }); } catch { return interaction.update({ content: '⚠️ Payout failed.', components: [] }); } }
    if (p.total === d.total) { try { if (state.chipsStake > 0) await ctx.transferFromHouseToUser(state.userId, state.chipsStake, 'blackjack push (double)', null); ctx.addHouseNet(state.guildId, state.userId, 'blackjack', 0); try { ctx.recordSessionGame(state.guildId, state.userId, 0); } catch {}; return interaction.update({ embeds: [await ctx.bjEmbed(state, { footer: 'Push. Your stake was returned.', color: 0x2b2d31 })], components: [ctx.bjPlayAgainRow(state.table, state.bet / 2, state.userId)] }); } catch { return interaction.update({ content: '⚠️ Return failed.', components: [] }); } }
    try { if (state.creditsStake > 0) await ctx.burnCredits(state.userId, state.creditsStake, 'blackjack loss (double)', null); } catch {}
    ctx.addHouseNet(state.guildId, state.userId, 'blackjack', state.chipsStake); try { ctx.recordSessionGame(state.guildId, state.userId, -state.chipsStake); } catch {}
    return interaction.update({ embeds: [await ctx.bjEmbed(state, { footer: 'Dealer wins.', color: 0xED4245 })], components: [ctx.bjPlayAgainRow(state.table, state.bet / 2, state.userId)] });
  }
  if (action === 'split') {
    if (state.split) return interaction.reply({ content: '❌ Already split.', ephemeral: true });
    if (state.player.length !== 2) return interaction.reply({ content: '❌ Split only available on first decision.', ephemeral: true });
    const v1 = ctx.cardValueForSplit(state.player[0]);
    const v2 = ctx.cardValueForSplit(state.player[1]);
    if (v1 !== v2) return interaction.reply({ content: '❌ You can only split equal-value cards.', ephemeral: true });
    if (!(await ctx.canAffordExtra(state.userId, state.bet))) return interaction.reply({ content: '❌ Not enough funds to split.', ephemeral: true });
    const c1 = state.player[0], c2 = state.player[1];
    const { credits, chips } = await ctx.getUserBalances(state.userId);
    const extraCredit = Math.min(state.bet, credits);
    const extraChip = state.bet - extraCredit;
    if (extraChip > 0) { try { await ctx.takeFromUserToHouse(state.userId, extraChip, 'blackjack split (chips)', state.userId); } catch { return interaction.reply({ content: '❌ Could not process split.', ephemeral: true }); } }
    state.split = true; state.hands = [{ cards: [c1], bet: state.bet, creditsStake: state.creditsStake, chipsStake: state.chipsStake, finished: false }, { cards: [c2], bet: state.bet, creditsStake: extraCredit, chipsStake: extraChip, finished: false }]; state.active = 0; delete state.player; delete state.creditsStake; delete state.chipsStake;
    const row = ctx.rowButtons([{ id: 'bj|hit', label: 'Hit', style: 1 }, { id: 'bj|stand', label: 'Stand', style: 2 }]);
    return interaction.update({ embeds: [await ctx.bjEmbed(state)], components: [row] });
  }
  if (action === 'stand') {
    if (state.split && (!state.hands[0]?.finished || !state.hands[1]?.finished)) {
      if (state.hands[state.active]) state.hands[state.active].finished = true;
      if (state.active === 0) { state.active = 1; const row = ctx.rowButtons([{ id: 'bj|hit', label: 'Hit', style: 1 }, { id: 'bj|stand', label: 'Stand', style: 2 }]); return interaction.update({ embeds: [await ctx.bjEmbed(state)], components: [row] }); }
    }
    state.revealed = true;
    const dealerPlay = () => { while (true) { const v = ctx.bjHandValue(state.dealer); if (v.total > 21) return; if (v.total < 17) { state.dealer.push(draw()); continue; } if (v.total === 17) { if (state.table === 'HIGH' && v.soft) { state.dealer.push(draw()); continue; } } return; } };
    dealerPlay();
    const d = ctx.bjHandValue(state.dealer); ctx.blackjackGames.delete(k);
    if (state.split && Array.isArray(state.hands)) {
      let totalPayout = 0; let summary = [];
      for (let i = 0; i < 2; i++) { const h = state.hands[i]; const pv = ctx.bjHandValue(h.cards); if (h.busted) { summary.push(`Hand ${i===0?'A':'B'}: BUST`); continue; } if (d.total > 21 || pv.total > d.total) { totalPayout += h.chipsStake + h.bet; summary.push(`Hand ${i===0?'A':'B'}: WIN (+${ctx.formatChips(h.bet)})`); } else if (pv.total === d.total) { totalPayout += h.chipsStake; summary.push(`Hand ${i===0?'A':'B'}: PUSH`); } else { try { await ctx.burnCredits(state.userId, h.creditsStake, 'blackjack loss (split)'); } catch {}; summary.push(`Hand ${i===0?'A':'B'}: LOSS`); } }
      if (totalPayout > 0) { try { await ctx.transferFromHouseToUser(state.userId, totalPayout, 'blackjack settle (split)', null); } catch {} }
      try { const totalChipsStake = (state.hands?.[0]?.chipsStake || 0) + (state.hands?.[1]?.chipsStake || 0); ctx.recordSessionGame(state.guildId, state.userId, totalPayout - totalChipsStake); } catch {}
      try { const totalChipsStake = (state.hands?.[0]?.chipsStake || 0) + (state.hands?.[1]?.chipsStake || 0); ctx.addHouseNet(state.guildId, state.userId, 'blackjack', totalChipsStake - totalPayout); } catch {}
      { const tcs = (state.hands?.[0]?.chipsStake || 0) + (state.hands?.[1]?.chipsStake || 0); const resultColor = totalPayout > tcs ? 0x57F287 : totalPayout < tcs ? 0xED4245 : 0x2b2d31; return interaction.update({ embeds: [await ctx.bjEmbed(state, { footer: summary.join(' • '), color: resultColor })], components: [ctx.bjPlayAgainRow(state.table, state.bet, state.userId)] }); }
    }
    const p = ctx.bjHandValue(state.player);
    if (d.total > 21) { const win = state.bet; try { const payout = state.chipsStake + win; await ctx.transferFromHouseToUser(state.userId, payout, 'blackjack win (dealer bust)', null); ctx.addHouseNet(state.guildId, state.userId, 'blackjack', -win); try { ctx.recordSessionGame(state.guildId, state.userId, win); } catch {}; return interaction.update({ embeds: [await ctx.bjEmbed(state, { footer: `Dealer busts. You win ${ctx.chipsAmount(win)}.`, color: 0x57F287 })], components: [ctx.bjPlayAgainRow(state.table, state.bet, state.userId)] }); } catch { return interaction.update({ content: '⚠️ Payout failed.', components: [] }); } }
  if (p.total > d.total) { const win = state.bet; try { const payout = state.chipsStake + win; await ctx.transferFromHouseToUser(state.userId, payout, 'blackjack win', null); ctx.addHouseNet(state.guildId, state.userId, 'blackjack', -win); try { ctx.recordSessionGame(state.guildId, state.userId, win); } catch {}; return interaction.update({ embeds: [await ctx.bjEmbed(state, { footer: `You win ${ctx.chipsAmount(win)}.`, color: 0x57F287 })], components: [ctx.bjPlayAgainRow(state.table, state.bet, state.userId)] }); } catch { return interaction.update({ content: '⚠️ Payout failed.', components: [] }); } }
  if (p.total === d.total) { try { if (state.chipsStake > 0) await ctx.transferFromHouseToUser(state.userId, state.chipsStake, 'blackjack push', null); ctx.addHouseNet(state.guildId, state.userId, 'blackjack', 0); try { ctx.recordSessionGame(state.guildId, state.userId, 0); } catch {}; return interaction.update({ embeds: [await ctx.bjEmbed(state, { footer: 'Push. Your stake was returned.', color: 0x2b2d31 })], components: [ctx.bjPlayAgainRow(state.table, state.bet, state.userId)] }); } catch { return interaction.update({ content: '⚠️ Return failed.', components: [] }); } }
  try { if (state.creditsStake > 0) await ctx.burnCredits(state.userId, state.creditsStake, 'blackjack loss', null); } catch {}
    ctx.addHouseNet(state.guildId, state.userId, 'blackjack', state.chipsStake); try { ctx.recordSessionGame(state.guildId, state.userId, -state.chipsStake); } catch {}
    return interaction.update({ embeds: [await ctx.bjEmbed(state, { footer: 'Dealer wins.', color: 0xED4245 })], components: [ctx.bjPlayAgainRow(state.table, state.bet, state.userId)] });
  }
  return interaction.reply({ content: '❌ Unknown action.', ephemeral: true });
}
// Interaction: Blackjack buttons (Hit/Stand/Double/Split/Again)
