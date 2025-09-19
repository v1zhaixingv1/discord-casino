import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { setCasinoCategory } from '../db.auto.mjs';

export default async function handleSetCasinoCategory(interaction, ctx) {
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Discord Administrator permission required.', ephemeral: true });
  }
  const channel = interaction.options.getChannel('category');
  if (!channel || channel.type !== ChannelType.GuildCategory) {
    return interaction.reply({ content: '❌ Please choose a category.', ephemeral: true });
  }
  await setCasinoCategory(interaction.guild.id, channel.id);
  return interaction.reply({ content: `✅ Casino category set to **${channel.name}** (<#${channel.id}>).`, ephemeral: true });
}
