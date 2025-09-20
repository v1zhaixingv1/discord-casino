import { PermissionFlagsBits } from 'discord.js';
import { addModRole } from '../db.auto.mjs';

export default async function handleAddModRole(interaction, ctx) {
  try {
    const guild = interaction.guild;
    const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
    const say = (kitten, normal) => (kittenMode ? kitten : normal);
    if (!guild) {
      return interaction.reply({ content: say('❌ I can only crown moderators inside a server, Kitten.', '❌ This command can only be used in a server.'), ephemeral: true });
    }
    const perms = interaction.memberPermissions ?? interaction.member?.permissions;
    if (!perms?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: say('❌ Only a Discord Administrator may grant that authority, Kitten.', '❌ Discord Administrator permission required.'), ephemeral: true });
    }
    const role = interaction.options.getRole('role');
    if (!role) {
      return interaction.reply({ content: say('❌ That role won’t do, Kitten. Choose a valid one for me.', '❌ Invalid role.'), ephemeral: true });
    }
    const roles = await addModRole(guild.id, role.id);
    const roster = roles.map(r => `<@&${r}>`).join(', ') || 'none';
    return interaction.reply({
      content: say(
        `✅ I’ve anointed <@&${role.id}> as a house Kitten.\nCurrent moderator roster: ${roster}`,
        `✅ Added <@&${role.id}> as a moderator role.\nCurrent moderator roles: ${roster}`
      ),
      ephemeral: true
    });
  } catch (e) {
    return interaction.reply({ content: (typeof ctx?.kittenizeText === 'function') ? ctx.kittenizeText('❌ I couldn’t add that moderator role this time, Kitten.') : '❌ Failed to add moderator role.', ephemeral: true });
  }
}
