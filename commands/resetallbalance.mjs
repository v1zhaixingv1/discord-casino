import { resetAllBalances } from '../db.auto.mjs';

export default async function handleResetAllBalance(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  if (!(await ctx.isOwnerRole(interaction))) {
    return interaction.reply({ content: say('❌ Only the server owner may wipe the ledgers clean, Kitten.', '❌ You do not have permission. OWNER only.'), ephemeral: true });
  }
  try {
    const { usersBefore, usersUpdated, house } = resetAllBalances(interaction.guild?.id);
    const logLines = kittenMode
      ? [
          '🧹 **Reset All Balances**',
          `Users refreshed: **${usersUpdated}** (of ${usersBefore}) • House after: **${ctx.formatChips(house)}**`,
          'Defaults restored: chips=0, credits=100, house=0'
        ]
      : [
          '🧹 **Reset All Balances**',
          `Users affected: **${usersUpdated}** (of ${usersBefore}) • House after: **${ctx.formatChips(house)}**`,
          'Defaults: chips=0, credits=100, house=0'
        ];
    await ctx.postCashLog(interaction, logLines);
    return interaction.reply({ content: say(`✅ Reset complete. ${usersUpdated} of ${usersBefore} users refreshed. House now at **${ctx.formatChips(house)}**. Enjoy the clean slate, Kitten.`, `✅ Reset complete. Users updated: ${usersUpdated} (of ${usersBefore}). House: ${ctx.formatChips(house)}.`), ephemeral: true });
  } catch (e) {
    console.error('resetallbalance error:', e);
    return interaction.reply({ content: say('❌ I couldn’t reset the balances this time, Kitten.', '❌ Failed to reset balances.'), ephemeral: true });
  }
}
