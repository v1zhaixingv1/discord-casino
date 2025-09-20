import { setRequestTimer } from '../db.auto.mjs';

export default async function handleRequestTimer(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: say('❌ Only my trusted staff may adjust the request timer, Kitten.', '❌ You do not have permission.'), ephemeral: true });
  }
  const seconds = interaction.options.getInteger('seconds');
  if (!Number.isInteger(seconds) || seconds < 0) {
    return interaction.reply({ content: say('❌ Give me a whole number at or above zero, Kitten.', '❌ Seconds must be an integer ≥ 0.'), ephemeral: true });
  }
  await setRequestTimer(interaction.guild.id, seconds);
  const msg = seconds === 0
    ? say('✅ Request cooldown disabled. Ask whenever you crave, Kitten.', '✅ Request cooldown disabled.')
    : say(`✅ Request cooldown set to ${seconds} seconds. Pace yourself, Kitten.`, `✅ Request cooldown set to ${seconds} seconds.`);
  return interaction.reply({ content: msg, ephemeral: true });
}
