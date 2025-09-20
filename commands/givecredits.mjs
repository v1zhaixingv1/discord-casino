import { grantCredits } from '../db.auto.mjs';

export default async function handleGiveCredits(interaction, ctx) {
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  const target = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const reason = interaction.options.getString('reason') || null;
  if (!Number.isInteger(amount) || amount <= 0) {
    return interaction.reply({ content: 'Amount must be a positive integer.', ephemeral: true });
  }
  const { credits } = await grantCredits(interaction.guild?.id, target.id, amount, reason, interaction.user.id);
  await ctx.postCashLog(interaction, [
    `🎁 **Grant Credits**`,
    `To: <@${target.id}> • Amount: **${new Intl.NumberFormat('en-US').format(amount)}** credits${reason ? ` • Reason: ${reason}` : ''}`,
    // `To: My pampered Kitten <@${target.id}> • Amount: **${new Intl.NumberFormat('en-US').format(amount)}** credits${reason ? ` • Reason: ${reason}` : ''}`,
    `User Credits: **${new Intl.NumberFormat('en-US').format(credits)}**`
  ]);
  const fmt = new Intl.NumberFormat('en-US');
  return interaction.reply({ content: `✅ Gave **${fmt.format(amount)}** Credits to <@${target.id}>${reason ? ` (${reason})` : ''}.\n• <@${target.id}>'s Credits: **${fmt.format(credits)}**`, ephemeral: true });
  // return interaction.reply({ content: `✅ Showered **${fmt.format(amount)}** Credits on my cherished Kitten <@${target.id}>${reason ? ` (${reason})` : ''}.\n• Your gleaming balance, Kitten: **${fmt.format(credits)}**`, ephemeral: true });
}
