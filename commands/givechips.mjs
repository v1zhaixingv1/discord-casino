import { transferFromHouseToUser } from '../db.auto.mjs';

export default async function handleGiveChips(interaction, ctx) {
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
    const { chips, house } = await transferFromHouseToUser(interaction.guild?.id, target.id, amount, reason, interaction.user.id);
    await ctx.postCashLog(interaction, [
      `🎁 **Give Chips**`,
      `To: <@${target.id}> • Amount: **${ctx.chipsAmount(amount)}**${reason ? ` • Reason: ${reason}` : ''}`,
      `User Chips: **${ctx.chipsAmount(chips)}** • House: **${ctx.chipsAmount(house)}**`
    ]);
    return interaction.reply({
      content: `🎁 Gave **${ctx.chipsAmount(amount)}** to <@${target.id}>${reason ? ` (${reason})` : ''}.\n• <@${target.id}>'s new balance: **${ctx.chipsAmount(chips)}**\n• House balance: **${ctx.chipsAmount(house)}**`,
      ephemeral: true
    });
  } catch (err) {
    if (err.message === 'INSUFFICIENT_HOUSE') {
      return interaction.reply({ content: '❌ The house does not have enough chips.', ephemeral: true });
    }
    console.error(err);
    return interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
  }
}
