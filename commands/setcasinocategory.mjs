import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { setCasinoCategory } from '../db.auto.mjs';

export default async function handleSetCasinoCategory(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: say('❌ Only a Discord Administrator may pick my casino lounge, Kitten.', '❌ Discord Administrator permission required.'), ephemeral: true });
  }
  const channel = interaction.options.getChannel('category');
  if (!channel || channel.type !== ChannelType.GuildCategory) {
    return interaction.reply({ content: say('❌ Choose a proper category for my casino, Kitten.', '❌ Please choose a category.'), ephemeral: true });
  }
  await setCasinoCategory(interaction.guild.id, channel.id);
  return interaction.reply({ content: say(`✅ Casino category set to **${channel.name}** (<#${channel.id}>). I’ll make it sparkle for you, Kitten.`, `✅ Casino category set to **${channel.name}** (<#${channel.id}>).`), ephemeral: true });
}
