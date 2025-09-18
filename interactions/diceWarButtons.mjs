import { playDiceWar } from '../commands/dicewar.mjs';

export default async function handleDiceWarButtons(interaction, ctx) {
  const [prefix, action, betStr, userId] = interaction.customId.split('|');
  if (prefix !== 'dice') return;
  if (action === 'again') {
    // Enforce inactivity timeout: if expired, finalize and end the session now
    if (
      ctx.hasActiveExpired(interaction.guild.id, interaction.user.id, 'dicewar') ||
      !ctx.getActiveSession(interaction.guild.id, interaction.user.id)
    ) {
      try { await ctx.endActiveSessionForUser(interaction, 'expired_button'); } catch {}
      return interaction.reply({ content: '⌛ Your Dice War session expired. Use `/dicewar` to start a new one.', ephemeral: true });
    }
    const bet = Number(betStr);
    if (!Number.isInteger(bet) || bet <= 0) {
      return interaction.reply({ content: '❌ Invalid bet.', ephemeral: true });
    }
    if (interaction.user.id !== userId) {
      return interaction.reply({ content: '❌ Only the original player can use this.', ephemeral: true });
    }
    // Any valid interaction restarts the inactivity timer
    try { ctx.touchActiveSession(interaction.guild.id, interaction.user.id, 'dicewar'); } catch {}
    return playDiceWar(interaction, ctx, bet);
  }
  return interaction.reply({ content: '❌ Unknown action.', ephemeral: true });
}
// Interaction: Dice War buttons (Play Again)
