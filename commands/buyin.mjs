import { mintChips } from '../db.auto.mjs';

export default async function handleBuyIn(interaction, ctx) {
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  const target = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const reason = interaction.options.getString('reason') || null;
  if (!Number.isInteger(amount) || amount <= 0) {
    return interaction.reply({ content: 'Amount must be a positive integer.', ephemeral: true });
  }
  try {
    const { chips } = await mintChips(interaction.guild?.id, target.id, amount, reason, interaction.user.id);
    await ctx.postCashLog(interaction, [
      `🪙 **Buy-in**`,
      `User: <@${target.id}> • Amount: **${ctx.chipsAmount(amount)}**${reason ? ` • Reason: ${reason}` : ''}`,
      // `User: My eager Kitten <@${target.id}> • Amount: **${ctx.chipsAmount(amount)}**${reason ? ` • Reason: ${reason}` : ''}`,
      `User Chips (after): **${ctx.chipsAmount(chips)}**`
    ]);
    try {
      let dm = `🪙 Buy-in: You received ${ctx.chipsAmount(amount)}. Processed by ${interaction.user.tag}.`;
      if (typeof ctx?.kittenizeText === 'function') dm = ctx.kittenizeText(dm);
      await target.send(dm);
    } catch {}
    // try { await target.send(`🪙 Buy-in: Drink it in, Kitten <@${target.id}> — your chips drip with my affection.`); } catch {}
    return interaction.reply({ content: `✅ Minted **${ctx.chipsAmount(amount)}** to <@${target.id}>${reason ? ` (${reason})` : ''}.\n• New balance: **${ctx.chipsAmount(chips)}**`, ephemeral: true });
    // return interaction.reply({ content: `✅ Minted **${ctx.chipsAmount(amount)}** for my luxuriant Kitten <@${target.id}>${reason ? ` (${reason})` : ''}.\n• Indulge yourself, Kitten — balance now **${ctx.chipsAmount(chips)}**`, ephemeral: true });
  } catch (e) {
    console.error(e);
    return interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
  }
}
