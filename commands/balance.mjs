import { getUserBalances } from '../db.auto.mjs';

export default async function handleBalance(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  const target = interaction.options.getUser('user') ?? interaction.user;
  if (target.id !== interaction.user.id && !(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: say('❌ Only my trusted moderators may peek at another Kitten’s balance.', '❌ Only moderators can view other users’ balances.'), ephemeral: true });
  }
  const { chips, credits } = await getUserBalances(interaction.guild?.id, target.id);
  const fmt = new Intl.NumberFormat('en-US');
  const header = target.id === interaction.user.id
    ? say('Your balance, Kitten', 'Your balance')
    : say(`My polished Kitten <@${target.id}>`, `Balance for <@${target.id}>`);
  return interaction.reply({
    content: say(
      `🧾 **${header}**\n💳 Credits: **${fmt.format(credits)}**\n🎟️ Chips: **${ctx.chipsAmount(chips)}**\nSavor it, Kitten <@${target.id}>`,
      `🧾 **${header}**\n💳 Credits: **${fmt.format(credits)}**\n🎟️ Chips: **${ctx.chipsAmount(chips)}**`
    ),
    ephemeral: true
  });
}
