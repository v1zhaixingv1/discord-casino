import { PermissionFlagsBits } from 'discord.js';
import { setTableRake, ensureTableInChannel, buildTableEmbed, tableButtons } from '../games/holdem.mjs';
import { setDefaultHoldemRake } from '../db.auto.mjs';

export default async function handleSetRake(interaction, ctx) {
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Discord Administrator permission required.', ephemeral: true });
  }
  const percent = interaction.options.getNumber ? interaction.options.getNumber('percent') : interaction.options.getInteger('percent');
  if (percent === null || percent === undefined) {
    return interaction.reply({ content: '❌ Percent is required.', ephemeral: true });
  }
  // Update guild default (future tables). Cap always equals table max; only store percent.
  const bps = Math.floor(Math.max(0, Number(percent) || 0) * 100);
  const settings = await setDefaultHoldemRake(interaction.guild.id, bps, 0);

  // Try to update the active table in this channel (if any) without double-reply
  let updatedCurrent = false;
  try {
    const state = ensureTableInChannel(interaction.guild.id, interaction.channelId);
    if (state) {
      state.rakeBps = settings.holdem_rake_bps;
      state.rakeCap = Math.max(0, Number(state.max) || 0);
      try {
        const chId = state.msgChannelId || state.channelId;
        const ch = await interaction.client.channels.fetch(chId);
        const msg = await ch.messages.fetch(state.msgId);
        await msg.edit({ embeds: [buildTableEmbed(state)], components: [tableButtons(state)] });
        updatedCurrent = true;
      } catch {}
    }
  } catch {}

  const pct = (settings.holdem_rake_bps || 0) / 100;
  const note = updatedCurrent ? ' Current table updated (cap = table max buy‑in).' : ' No active table in this channel.';
  return interaction.reply({ content: `✅ Default Hold’em rake set to **${pct.toFixed(2)}%**. Cap is always the table max buy‑in.${note}`, ephemeral: true });
}
