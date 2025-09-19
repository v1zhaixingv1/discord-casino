import { getUserBalances } from '../db.auto.mjs';

export default async function handleBalance(interaction, ctx) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  if (target.id !== interaction.user.id && !(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: '❌ Only moderators can view other users’ balances.', ephemeral: true });
  }
  const { chips, credits } = await getUserBalances(interaction.guild?.id, target.id);
  const fmt = new Intl.NumberFormat('en-US');
  const header = target.id === interaction.user.id ? 'Your balance' : `Balance for <@${target.id}>`;
  // const header = target.id === interaction.user.id ? 'Your balance' : `Balance for Kitten`;
  return interaction.reply({
    content: `🧾 **${header}**\n💳 Credits: **${fmt.format(credits)}**\n🎟️ Chips: **${ctx.chipsAmount(chips)}**`,
    ephemeral: true
  });
}
