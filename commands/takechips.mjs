import { takeFromUserToHouse } from '../db.auto.mjs';

export default async function handleTakeChips(interaction, ctx) {
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
    const { chips, house } = await takeFromUserToHouse(interaction.guild?.id, target.id, amount, reason, interaction.user.id);
    await ctx.postCashLog(interaction, [
      `🏦 **Take Chips to House**`,
      `User: <@${target.id}> • Amount: **${ctx.chipsAmount(amount)}**${reason ? ` • Reason: ${reason}` : ''}`,
      `User Chips (after): **${ctx.chipsAmount(chips)}** • House (after): **${ctx.chipsAmount(house)}**`
    ]);
    return interaction.reply({ content: `✅ Took **${ctx.chipsAmount(amount)}** from <@${target.id}> to the house${reason ? ` (${reason})` : ''}.`, ephemeral: true });
  } catch (err) {
    if (err.message === 'INSUFFICIENT_USER') {
      return interaction.reply({ content: '❌ That user does not have enough chips.', ephemeral: true });
    }
    console.error(err);
    return interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
  }
}
