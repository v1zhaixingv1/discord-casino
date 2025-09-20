import { PermissionFlagsBits } from 'discord.js';
import { removeModRole } from '../db.auto.mjs';

export default async function handleRemoveModRole(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: say('❌ Only a Discord Administrator may strip that authority, Kitten.', '❌ Discord Administrator permission required.'), ephemeral: true });
  }
  const role = interaction.options.getRole('role');
  if (!role) {
    return interaction.reply({ content: say('❌ That role won’t do, Kitten. Choose a valid one for me.', '❌ Invalid role.'), ephemeral: true });
  }
  const roles = await removeModRole(interaction.guild.id, role.id);
  const roster = roles.map(r => `<@&${r}>`).join(', ') || 'none';
  return interaction.reply({ content: say(`✅ I’ve lifted <@&${role.id}> from the house roster.\nRemaining moderator Kittens: ${roster}`, `✅ Removed <@&${role.id}> from moderator roles.\nCurrent moderator roles: ${roster}`), ephemeral: true });
}
