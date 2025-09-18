import { burnFromUser } from '../db.auto.mjs';

export default async function handleCashOut(interaction, ctx) {
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
    const { chips } = await burnFromUser(target.id, amount, reason, interaction.user.id);
    await ctx.postCashLog(interaction, [
      `💸 **Cash Out**`,
      `User: <@${target.id}> • Amount: **${ctx.chipsAmount(amount)}**${reason ? ` • Reason: ${reason}` : ''}`,
      `User Chips (after): **${ctx.chipsAmount(chips)}**`
    ]);
    return interaction.reply({ content: `✅ Burned **${ctx.chipsAmount(amount)}** from <@${target.id}>${reason ? ` (${reason})` : ''}.`, ephemeral: true });
  } catch (e) {
    console.error(e);
    return interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
  }
}
