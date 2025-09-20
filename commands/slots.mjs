import { getGuildSettings } from '../db.auto.mjs';

async function inCasinoCategory(interaction, kittenMode) {
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  try {
    const { casino_category_id } = await getGuildSettings(interaction.guild.id) || {};
    if (!casino_category_id) {
      return { ok: false, reason: say('❌ The casino category isn’t configured yet, Kitten. Ask an admin to use /setcasinocategory.', '❌ Casino category is not configured. Admins: use /setcasinocategory.') };
    }
    const ch = interaction.channel;
    let catId = null;
    try {
      if (typeof ch?.isThread === 'function' && ch.isThread()) catId = ch.parent?.parentId || null;
      else catId = ch?.parentId || null;
    } catch {}
    if (!catId || catId !== casino_category_id) {
      return { ok: false, reason: say('❌ Bring me into the casino category before we spin, Kitten.', '❌ This command can only be used inside the configured casino category.') };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: say('❌ I couldn’t verify the casino category, Kitten.', '❌ Unable to verify channel category.') };
  }
}

export default async function handleSlots(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const loc = await inCasinoCategory(interaction, kittenMode);
  if (!loc.ok) return interaction.reply({ content: loc.reason, ephemeral: true });
  const bet = interaction.options.getInteger('bet');
  const key = `${interaction.guild.id}:${interaction.user.id}`;
  return ctx.runSlotsSpin(interaction, bet, key);
}
