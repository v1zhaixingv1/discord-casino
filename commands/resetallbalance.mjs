import { resetAllBalances } from '../db.auto.mjs';

export default async function handleResetAllBalance(interaction, ctx) {
  if (!(await ctx.isOwnerRole(interaction))) {
    return interaction.reply({ content: '❌ You do not have permission. OWNER only.', ephemeral: true });
  }
  try {
    const { usersBefore, usersUpdated, house } = resetAllBalances(interaction.guild?.id);
    await ctx.postCashLog(interaction, [
      '🧹 **Reset All Balances**',
      `Users affected: **${usersUpdated}** (of ${usersBefore}) • House after: **${ctx.formatChips(house)}**`,
      'Defaults: chips=0, credits=100, house=0'
    ]);
    return interaction.reply({ content: `✅ Reset complete. Users updated: ${usersUpdated} (of ${usersBefore}). House: ${ctx.formatChips(house)}.`, ephemeral: true });
  } catch (e) {
    console.error('resetallbalance error:', e);
    return interaction.reply({ content: '❌ Failed to reset balances.', ephemeral: true });
  }
}
