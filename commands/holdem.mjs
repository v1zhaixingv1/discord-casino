import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getGuildSettings } from '../db.auto.mjs';

async function inCasinoCategory(interaction) {
  try {
    const { casino_category_id } = await getGuildSettings(interaction.guild.id) || {};
    if (!casino_category_id) return { ok: false, reason: '❌ Casino category is not configured. Admins: use /setcasinocategory.' };
    const ch = interaction.channel;
    let catId = null;
    try {
      if (typeof ch?.isThread === 'function' && ch.isThread()) catId = ch.parent?.parentId || null;
      else catId = ch?.parentId || null;
    } catch {}
    if (!catId || catId !== casino_category_id) {
      return { ok: false, reason: '❌ This command can only be used inside the configured casino category.' };
    }
    return { ok: true };
  } catch { return { ok: false, reason: '❌ Unable to verify channel category.' }; }
}

export default async function handleHoldem(interaction, ctx) {
  const loc = await inCasinoCategory(interaction);
  if (!loc.ok) return interaction.reply({ content: loc.reason, ephemeral: true });
  const e = new EmbedBuilder()
    .setTitle('♠♥♦♣ Texas Hold’em — Create Table')
    .setColor(0x5865F2)
    .setDescription('Choose a preset to create a table in this channel:')
    .addFields(
      { name: 'Option 1', value: 'SB/BB: **1/2** • Min/Max: **10/100**' },
      { name: 'Option 2', value: 'SB/BB: **5/10** • Min/Max: **50/500**' },
      { name: 'Option 3', value: 'SB/BB: **20/40** • Min/Max: **200/2000**' }
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hold|create|p1|${interaction.user.id}`).setLabel('Option 1').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`hold|create|p2|${interaction.user.id}`).setLabel('Option 2').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hold|create|p3|${interaction.user.id}`).setLabel('Option 3').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`hold|create|custom|${interaction.user.id}`).setLabel('Custom').setStyle(ButtonStyle.Secondary)
  );
  return interaction.reply({ embeds: [e], components: [row] });
}
