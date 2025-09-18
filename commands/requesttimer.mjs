import { setRequestTimer } from '../db.auto.mjs';

export default async function handleRequestTimer(interaction, ctx) {
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
  }
  const seconds = interaction.options.getInteger('seconds');
  if (!Number.isInteger(seconds) || seconds < 0) {
    return interaction.reply({ content: '❌ Seconds must be an integer ≥ 0.', ephemeral: true });
  }
  await setRequestTimer(interaction.guild.id, seconds);
  const msg = seconds === 0 ? '✅ Request cooldown disabled.' : `✅ Request cooldown set to ${seconds} seconds.`;
  return interaction.reply({ content: msg, ephemeral: true });
}
