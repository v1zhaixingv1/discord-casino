import { removeFromHouse } from '../db.auto.mjs';

export default async function handleHouseRemove(interaction, ctx) {
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  const amount = interaction.options.getInteger('amount');
  const reason = interaction.options.getString('reason') || null;
  if (!Number.isInteger(amount) || amount <= 0) {
    return interaction.reply({ content: 'Amount must be a positive integer.', ephemeral: true });
  }
  try {
  const guildId = interaction.guild?.id;
  const newBal = await removeFromHouse(guildId, amount, reason, interaction.user.id);
    await ctx.postCashLog(interaction, [
      `🏦 **House Remove**`,
      `Amount: **${ctx.chipsAmount(amount)}**${reason ? ` • Reason: ${reason}` : ''}`,
      `New House Balance: **${ctx.chipsAmount(newBal)}**`
    ]);
    return interaction.reply({ content: `✅ Removed **${ctx.chipsAmount(amount)}** from the house${reason ? ` (${reason})` : ''}. New house balance: **${ctx.chipsAmount(newBal)}**.`, ephemeral: true });
  } catch (err) {
    if (err.message === 'INSUFFICIENT_HOUSE') {
      return interaction.reply({ content: '❌ The house does not have enough chips.', ephemeral: true });
    }
    console.error(err);
    return interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
  }
}
