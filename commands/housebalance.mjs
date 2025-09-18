import { getHouseBalance, getCasinoNetworth } from '../db.auto.mjs';

export default async function handleHouseBalance(interaction, ctx) {
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  const h = await getHouseBalance();
  const net = await getCasinoNetworth();
  return interaction.reply({ content: `🏦 House balance: **${ctx.chipsAmount(h)}**\n💼 Net worth (all chips in circulation): **${ctx.chipsAmount(net)}**`, ephemeral: true });
}
