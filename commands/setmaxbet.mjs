import { PermissionFlagsBits } from 'discord.js';
import { setMaxRidebusBet } from '../db.auto.mjs';

export default async function handleSetMaxBet(interaction, ctx) {
  try {
    const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
    const say = (kitten, normal) => (kittenMode ? kitten : normal);
    const perms = interaction.memberPermissions ?? interaction.member?.permissions;
    if (!perms?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: say('❌ Only a Discord Administrator may leash the max bet, Kitten.', '❌ Discord Administrator permission required.'), ephemeral: true });
    }
    const gameRaw = interaction.options.getString('game');
    const game = (gameRaw || '').toLowerCase().replace(/\s+/g, '');
    const amount = interaction.options.getInteger('amount');
    if (!interaction.guild?.id) {
      return interaction.reply({ content: say('❌ We can only set limits inside a server, Kitten.', '❌ This command can only be used in a server.'), ephemeral: true });
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return interaction.reply({ content: say('❌ Offer me a positive amount if you want a new limit, Kitten.', 'Amount must be a positive integer.'), ephemeral: true });
    }
    if (game === 'ridebus' || game === 'ridethebus') {
      const settings = await setMaxRidebusBet(interaction.guild.id, amount);
      return interaction.reply({ content: say(`✅ Max bet for Ride the Bus set to **${ctx.formatChips(settings.max_ridebus_bet)}**. Keep those thrills measured, Kitten.`, `✅ Max bet for Ride the Bus set to **${ctx.formatChips(settings.max_ridebus_bet)}**.`), ephemeral: true });
    }
    return interaction.reply({ content: say('❌ I don’t recognize that game, Kitten. Choose from the list in the command.', '❌ Unknown game. Choose from the list in the command.'), ephemeral: true });
  } catch (e) {
    console.error('[setmaxbet] error', e);
    throw e;
  }
}
