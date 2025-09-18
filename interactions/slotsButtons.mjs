export default async function onSlotsButtons(interaction, ctx) {
  const parts = interaction.customId.split('|');
  const action = parts[1];
  if (ctx.hasActiveExpired(interaction.guild.id, interaction.user.id, 'slots') || !ctx.getActiveSession(interaction.guild.id, interaction.user.id)) {
    try { await ctx.endActiveSessionForUser(interaction, 'expired_button'); } catch {}
    return interaction.reply({ content: '⌛ This slots session expired. Use `/slots` to start a new one.', ephemeral: true });
  }
  ctx.touchActiveSession(interaction.guild.id, interaction.user.id, 'slots');
  if (action === 'again') {
    const bet = Number(parts[2]) || ctx.SLOTS_LINES.length;
    const owner = parts[3];
    if (owner && owner !== interaction.user.id) return interaction.reply({ content: '❌ Only the original player can spin again from this message.', ephemeral: true });
    const key = ctx.keyFor(interaction);
    return ctx.runSlotsSpin(interaction, bet, key);
  }
  if (action === 'paytable') {
    const owner = parts[2];
    if (owner && owner !== interaction.user.id) return interaction.reply({ content: '❌ Only the original player can view this.', ephemeral: true });
    const e = ctx.buildSlotsPaytableEmbed();
    return interaction.reply({ embeds: [e], ephemeral: true });
  }
  return interaction.reply({ content: '❌ Unknown action.', ephemeral: true });
}
// Interaction: Slots buttons (Spin Again, Pay Table)
