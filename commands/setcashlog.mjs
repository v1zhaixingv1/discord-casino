import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { setCashLogChannel } from '../db.auto.mjs';

export default async function handleSetCashLog(interaction, ctx) {
  await interaction.deferReply({ ephemeral: true });
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.editReply(say('❌ Only a Discord Administrator may set my cash log channel, Kitten.', '❌ Discord Administrator permission required.'));
  }
  const channel = interaction.options.getChannel('channel');
  const isTextish = channel && (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
  if (!isTextish) return interaction.editReply(say('❌ Choose a text-capable channel for me, Kitten.', '❌ Please choose a text channel.'));
  const me = await interaction.guild.members.fetchMe();
  const botPerms = channel.permissionsFor(me);
  if (!botPerms?.has(PermissionFlagsBits.ViewChannel) || !botPerms?.has(PermissionFlagsBits.SendMessages)) {
    return interaction.editReply(say(`❌ I need **View Channel** and **Send Messages** in <#${channel.id}>, Kitten.`, `❌ I need **View Channel** and **Send Messages** in <#${channel.id}>.`));
  }
  try {
    await setCashLogChannel(interaction.guild.id, channel.id);
    return interaction.editReply(say(`✅ Cash log channel set to <#${channel.id}>. I’ll whisper every credit there for you, Kitten.`, `✅ Cash log channel set to <#${channel.id}>.`));
  } catch (e) {
    console.error('setCashLogChannel failed:', e);
    return interaction.editReply(say('⚠️ I couldn’t save that cash log channel, Kitten. Try again soon.', '⚠️ Failed to save the cash log channel. Please try again.'));
  }
}
