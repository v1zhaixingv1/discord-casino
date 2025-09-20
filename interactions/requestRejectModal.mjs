import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { clearActiveRequest } from '../db.auto.mjs';

export default async function handleRequestRejectModal(interaction) {
  const parts = interaction.customId.split('|');
  const messageId = parts[2];
  const targetId = parts[3];
  const type = parts[4];
  const amount = Number(parts[5]);
  const reason = interaction.fields.getTextInputValue('reason');
  try {
    const ch = interaction.channel;
    const msg = await ch.messages.fetch(messageId);
    const orig = msg.embeds?.[0];
    const embed = orig ? EmbedBuilder.from(orig) : new EmbedBuilder();
    const fields = Array.isArray(orig?.fields) ? orig.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline })) : [];
    const idx = fields.findIndex(f => f.name === 'Status');
    const statusText = `Rejected by <@${interaction.user.id}> — Reason: ${reason}`;
    if (idx >= 0) fields[idx].value = statusText; else fields.push({ name: 'Status', value: statusText });
    embed.setFields(fields);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`req|take|${targetId}|${type}|${amount}`).setLabel('Take Request').setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`req|done|${targetId}|${type}|${amount}`).setLabel('Request Complete').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId(`req|reject|${targetId}|${type}|${amount}`).setLabel('Reject Request').setStyle(ButtonStyle.Danger).setDisabled(true)
    );
    await msg.edit({ embeds: [embed], components: [row] });
  try { await clearActiveRequest(interaction.guild.id, targetId); } catch {}
    try {
      const user = await interaction.client.users.fetch(targetId);
      await user.send(`❌ Your request (${type === 'buyin' ? 'Buy In' : 'Cash Out'} ${amount.toLocaleString()} Chips) was rejected by <@${interaction.user.id}>. Reason: ${reason}`);
    } catch {}
    return interaction.reply({ content: '✅ Request rejected and user notified.', ephemeral: true });
  } catch (e) {
    console.error('reject modal error:', e);
    return interaction.reply({ content: '❌ Failed to reject request.', ephemeral: true });
  }
}
// Interaction: Request rejection modal submit (collect reason)
