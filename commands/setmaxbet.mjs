import { PermissionFlagsBits } from 'discord.js';
import { setMaxRidebusBet } from '../db.auto.mjs';

export default async function handleSetMaxBet(interaction, ctx) {
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Discord Administrator permission required.', ephemeral: true });
    }
    const gameRaw = interaction.options.getString('game');
    const game = (gameRaw || '').toLowerCase().replace(/\s+/g, '');
    const amount = interaction.options.getInteger('amount');
    if (!interaction.guild?.id) {
      return interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return interaction.reply({ content: 'Amount must be a positive integer.', ephemeral: true });
    }
    if (game === 'ridebus' || game === 'ridethebus') {
      const settings = await setMaxRidebusBet(interaction.guild.id, amount);
      return interaction.reply({ content: `✅ Max bet for Ride the Bus set to **${ctx.formatChips(settings.max_ridebus_bet)}**.`, ephemeral: true });
    }
    return interaction.reply({ content: '❌ Unknown game. Choose from the list in the command.', ephemeral: true });
  } catch (e) {
    console.error('[setmaxbet] error', e);
    throw e;
  }
}
