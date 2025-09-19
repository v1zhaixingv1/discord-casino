import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { setCashLogChannel } from '../db.auto.mjs';

export default async function handleSetCashLog(interaction, ctx) {
  await interaction.deferReply({ ephemeral: true });
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.editReply('❌ Discord Administrator permission required.');
  }
  const channel = interaction.options.getChannel('channel');
  const isTextish = channel && (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
  if (!isTextish) return interaction.editReply('❌ Please choose a text channel.');
  const me = await interaction.guild.members.fetchMe();
  const botPerms = channel.permissionsFor(me);
  if (!botPerms?.has(PermissionFlagsBits.ViewChannel) || !botPerms?.has(PermissionFlagsBits.SendMessages)) {
    return interaction.editReply(`❌ I need **View Channel** and **Send Messages** in <#${channel.id}>.`);
  }
  try {
    await setCashLogChannel(interaction.guild.id, channel.id);
    return interaction.editReply(`✅ Cash log channel set to <#${channel.id}>.`);
  } catch (e) {
    console.error('setCashLogChannel failed:', e);
    return interaction.editReply('⚠️ Failed to save the cash log channel. Please try again.');
  }
}
