import { getHouseBalance, getCasinoNetworth } from '../db.auto.mjs';

export default async function handleHouseBalance(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: say('❌ Only my trusted staff may peek at the house ledger, Kitten.', '❌ You do not have permission.'), ephemeral: true });
  }
  const guildId = interaction.guild?.id;
  const h = await getHouseBalance(guildId);
  const net = await getCasinoNetworth(guildId);
  return interaction.reply({
    content: say(
      `🏦 House balance: **${ctx.chipsAmount(h)}**\n💼 Net worth of every tantalizing chip in play: **${ctx.chipsAmount(net)}**\nKeep it purring, Kitten.`,
      `🏦 House balance: **${ctx.chipsAmount(h)}**\n💼 Net worth (all chips in circulation): **${ctx.chipsAmount(net)}**`
    ),
    ephemeral: true
  });
}
