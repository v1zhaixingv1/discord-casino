import { PermissionFlagsBits } from 'discord.js';
import { removeModRole } from '../db.auto.mjs';

export default async function handleRemoveModRole(interaction, ctx) {
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Discord Administrator permission required.', ephemeral: true });
  }
  const role = interaction.options.getRole('role');
  if (!role) return interaction.reply({ content: '❌ Invalid role.', ephemeral: true });
  const roles = await removeModRole(interaction.guild.id, role.id);
  return interaction.reply({ content: `✅ Removed <@&${role.id}> from moderator roles.\nCurrent moderator roles: ${roles.map(r => `<@&${r}>`).join(', ') || 'none'}`, ephemeral: true });
}
