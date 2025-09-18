import { burnCredits } from '../db.auto.mjs';

export default async function handleTakeCredits(interaction, ctx) {
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
    const { credits } = await burnCredits(target.id, amount, reason, interaction.user.id);
    await ctx.postCashLog(interaction, [
      `🔥 **Burn Credits**`,
      `User: <@${target.id}> • Amount: **${new Intl.NumberFormat('en-US').format(amount)}** credits${reason ? ` • Reason: ${reason}` : ''}`,
      `User Credits (after): **${new Intl.NumberFormat('en-US').format(credits)}**`
    ]);
    const fmt = new Intl.NumberFormat('en-US');
    return interaction.reply({ content: `🔥 Burned **${fmt.format(amount)}** Credits from <@${target.id}>${reason ? ` (${reason})` : ''}.\n• <@${target.id}>'s Credits: **${fmt.format(credits)}**`, ephemeral: true });
  } catch (err) {
    if (err.message === 'INSUFFICIENT_USER_CREDITS') {
      return interaction.reply({ content: '❌ That user does not have enough Credits.', ephemeral: true });
    }
    console.error(err);
    return interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
  }
}
