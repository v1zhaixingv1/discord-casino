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
    if (!catId || catId !== casino_category_id) return { ok: false, reason: '❌ This command can only be used inside the configured casino category.' };
    return { ok: true };
  } catch { return { ok: false, reason: '❌ Unable to verify channel category.' }; }
}

export default async function handleBlackjack(interaction, ctx) {
  const loc = await inCasinoCategory(interaction);
  if (!loc.ok) return interaction.reply({ content: loc.reason, ephemeral: true });
  const table = interaction.options.getString('table');
  const bet = interaction.options.getInteger('bet');
  return ctx.startBlackjack(interaction, table, bet);
}
