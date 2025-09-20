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
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  let title = '♠♥♦♣ Texas Hold’em — Create Table';
  let description = 'Choose a preset to create a table in this channel:';
  let optionFields = [
    { name: 'Option 1', value: 'SB/BB: **1/2** • Min/Max: **10/100**' },
    { name: 'Option 2', value: 'SB/BB: **5/10** • Min/Max: **50/500**' },
    { name: 'Option 3', value: 'SB/BB: **20/40** • Min/Max: **200/2000**' }
  ];
  if (kittenMode) {
    title = '♠♥♦♣ Mistress Kitten’s Hold’em Lounge';
    description = 'Choose a table that delights me, Kitten. Pick a preset or tempt me with something custom.';
    optionFields = [
      { name: 'Velvet Table', value: 'SB/BB: **1/2** • Min/Max: **10/100** — a gentle warm-up, Kitten.' },
      { name: 'Crimson Table', value: 'SB/BB: **5/10** • Min/Max: **50/500** — a purrfect mid-stakes tease.' },
      { name: 'Obsidian Table', value: 'SB/BB: **20/40** • Min/Max: **200/2000** — only for my boldest Kitten.' }
    ];
  }
  const e = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x5865F2)
    .setDescription(description)
    .addFields(optionFields);
  const buttonConfigs = kittenMode
    ? [
        { id: 'p1', label: 'Velvet Table', style: ButtonStyle.Primary },
        { id: 'p2', label: 'Crimson Table', style: ButtonStyle.Secondary },
        { id: 'p3', label: 'Obsidian Table', style: ButtonStyle.Success },
        { id: 'custom', label: 'Custom Fantasy', style: ButtonStyle.Secondary }
      ]
    : [
        { id: 'p1', label: 'Option 1', style: ButtonStyle.Primary },
        { id: 'p2', label: 'Option 2', style: ButtonStyle.Secondary },
        { id: 'p3', label: 'Option 3', style: ButtonStyle.Success },
        { id: 'custom', label: 'Custom', style: ButtonStyle.Secondary }
      ];
  const row = new ActionRowBuilder().addComponents(
    ...buttonConfigs.map(cfg => new ButtonBuilder()
      .setCustomId(`hold|create|${cfg.id}|${interaction.user.id}`)
      .setLabel(cfg.label)
      .setStyle(cfg.style))
  );
  return interaction.reply({ embeds: [e], components: [row] });
}
