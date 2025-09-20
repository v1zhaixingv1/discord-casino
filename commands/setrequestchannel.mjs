import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { setRequestChannel } from '../db.auto.mjs';

export default async function handleSetRequestChannel(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: say('❌ Only a Discord Administrator may decide where I take requests, Kitten.', '❌ Discord Administrator permission required.'), ephemeral: true });
  }
  const channel = interaction.options.getChannel('channel');
  const isTextish = channel && (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
  if (!isTextish) return interaction.reply({ content: say('❌ Choose a text-capable channel so I can hear the pleas, Kitten.', '❌ Please choose a text channel.'), ephemeral: true });
  const me = await interaction.guild.members.fetchMe();
  const botPerms = channel.permissionsFor(me);
  if (!botPerms?.has(PermissionFlagsBits.ViewChannel) || !botPerms?.has(PermissionFlagsBits.SendMessages)) {
    return interaction.reply({ content: say(`❌ I need **View Channel** and **Send Messages** in <#${channel.id}>, Kitten.`, `❌ I need **View Channel** and **Send Messages** in <#${channel.id}>.`), ephemeral: true });
  }
  await setRequestChannel(interaction.guild.id, channel.id);
  return interaction.reply({ content: say(`✅ Request channel set to <#${channel.id}>. Send your desires there, Kitten.`, `✅ Request channel set to <#${channel.id}>.`), ephemeral: true });
}
