import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { setGameLogChannel } from '../db.auto.mjs';

export default async function handleSetGameLogChannel(interaction, ctx) {
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Discord Administrator permission required.', ephemeral: true });
  }
  const channel = interaction.options.getChannel('channel');
  const isTextish = channel && (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
  if (!isTextish) return interaction.reply({ content: '❌ Please choose a text channel.', ephemeral: true });
  const me = await interaction.guild.members.fetchMe();
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
    return interaction.reply({ content: `❌ I need **View Channel** and **Send Messages** in <#${channel.id}>.`, ephemeral: true });
  }
  await setGameLogChannel(interaction.guild.id, channel.id);
  return interaction.reply({ content: `✅ Game log channel set to <#${channel.id}>.`, ephemeral: true });
}
