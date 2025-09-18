import { PermissionFlagsBits } from 'discord.js';
import { addModRole } from '../db.auto.mjs';

export default async function handleAddModRole(interaction, ctx) {
  try {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Discord Administrator permission required.', ephemeral: true });
    }
    const role = interaction.options.getRole('role');
    if (!role) return interaction.reply({ content: '❌ Invalid role.', ephemeral: true });
    const roles = await addModRole(guild.id, role.id);
    return interaction.reply({ content: `✅ Added <@&${role.id}> as a moderator role.\nCurrent moderator roles: ${roles.map(r => `<@&${r}>`).join(', ') || 'none'}`, ephemeral: true });
  } catch (e) {
    return interaction.reply({ content: '❌ Failed to add moderator role.', ephemeral: true });
  }
}
