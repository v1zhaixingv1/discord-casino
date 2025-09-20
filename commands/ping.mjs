export default async function handlePing(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const message = kittenMode ? 'Pong, Kitten 🏓' : 'Pong 🏓';
  return interaction.reply({ content: message, ephemeral: true });
}
