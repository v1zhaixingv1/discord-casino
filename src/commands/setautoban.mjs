import { ChannelType, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { setAutoBanChannel } from '../db/db.auto.mjs';

export default async function handleSetAutoBan(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);

  if (!interaction.guild) {
    return interaction.reply({ content: say('❌ I can only lock this down inside a server, Kitten.', '❌ This command can only be used inside a server.'), ephemeral: true });
  }

  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const hasDiscordAdmin = perms?.has?.(PermissionFlagsBits.Administrator);
  if (!(hasDiscordAdmin || await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: say('❌ Only my trusted admins may arm auto-ban, Kitten.', '❌ Casino admin access required.'), ephemeral: true });
  }

  const channel = interaction.options.getChannel('channel');
  const isTextish = channel && (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
  if (!isTextish) {
    return interaction.reply({ content: say('❌ Choose a text-capable channel for this lockdown, Kitten.', '❌ Please choose a text channel.'), ephemeral: true });
  }

  const me = await interaction.guild.members.fetchMe();
  const botPerms = channel.permissionsFor(me);
  if (
    !botPerms?.has(PermissionFlagsBits.ViewChannel) ||
    !botPerms?.has(PermissionFlagsBits.SendMessages) ||
    !botPerms?.has(PermissionFlagsBits.BanMembers)
  ) {
    return interaction.reply({
      content: say(
        `❌ I need **View Channel**, **Send Messages**, and **Ban Members** in <#${channel.id}> before I can enforce this, Kitten.`,
        `❌ I need **View Channel**, **Send Messages**, and **Ban Members** permissions for <#${channel.id}>.`
      ),
      ephemeral: true
    });
  }

  await setAutoBanChannel(interaction.guild.id, channel.id);

  const warningEmbed = new EmbedBuilder()
    .setColor(0xC62828)
    .setTitle('AUTO-BAN WARNING')
    .setDescription('## STOP\nIf you post **ANY** message in this channel, you will be **permanently banned** from the server.\n\nOnly server administrators are exempt from this enforcement.')
    .setFooter({ text: 'Enforced automatically by Casino Bot' })
    .setTimestamp();

  try {
    await channel.send({ embeds: [warningEmbed] });
  } catch (err) {
    console.error('setautoban warning post failed:', err);
    return interaction.reply({
      content: say('⚠️ I saved the auto-ban channel, but I failed to post the warning embed, Kitten.', '⚠️ Auto-ban channel saved, but posting the warning embed failed.'),
      ephemeral: true
    });
  }

  return interaction.reply({
    content: say(`✅ Auto-ban is armed in <#${channel.id}>. I posted the warning and will permanently ban non-admin users who speak there, Kitten.`, `✅ Auto-ban channel set to <#${channel.id}>. Non-admin users posting there will be permanently banned and their last 24h of messages will be deleted.`),
    ephemeral: true
  });
}
