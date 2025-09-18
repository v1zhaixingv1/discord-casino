import { addToHouse } from '../db.auto.mjs';

export default async function handleHouseAdd(interaction, ctx) {
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  const amount = interaction.options.getInteger('amount');
  const reason = interaction.options.getString('reason') || null;
  if (!Number.isInteger(amount) || amount <= 0) {
    return interaction.reply({ content: 'Amount must be a positive integer.', ephemeral: true });
  }
  const newBal = await addToHouse(amount, reason, interaction.user.id);
  await ctx.postCashLog(interaction, [
    `🏦 **House Add**`,
    `Amount: **${ctx.chipsAmount(amount)}**${reason ? ` • Reason: ${reason}` : ''}`,
    `New House Balance: **${ctx.chipsAmount(newBal)}**`
  ]);
  return interaction.reply({
    content: `✅ Added **${ctx.chipsAmount(amount)}** to the house${reason ? ` (${reason})` : ''}. New house balance: **${ctx.chipsAmount(newBal)}**.`,
    ephemeral: true
  });
}
