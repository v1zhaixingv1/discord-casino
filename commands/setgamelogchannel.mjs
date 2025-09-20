import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { setGameLogChannel } from '../db.auto.mjs';

export default async function handleSetGameLogChannel(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: say('❌ Only a Discord Administrator may pick my game log channel, Kitten.', '❌ Discord Administrator permission required.'), ephemeral: true });
  }
  const channel = interaction.options.getChannel('channel');
  const isTextish = channel && (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
  if (!isTextish) return interaction.reply({ content: say('❌ Choose a text-capable channel so I can brag properly, Kitten.', '❌ Please choose a text channel.'), ephemeral: true });
  const me = await interaction.guild.members.fetchMe();
  const botPerms = channel.permissionsFor(me);
  if (!botPerms?.has(PermissionFlagsBits.ViewChannel) || !botPerms?.has(PermissionFlagsBits.SendMessages)) {
    return interaction.reply({ content: say(`❌ I need **View Channel** and **Send Messages** in <#${channel.id}>, Kitten.`, `❌ I need **View Channel** and **Send Messages** in <#${channel.id}>.`), ephemeral: true });
  }
  await setGameLogChannel(interaction.guild.id, channel.id);
  return interaction.reply({ content: say(`✅ Game log channel set to <#${channel.id}>. I’ll chronicle every thrill for you, Kitten.`, `✅ Game log channel set to <#${channel.id}>.`), ephemeral: true });
}
