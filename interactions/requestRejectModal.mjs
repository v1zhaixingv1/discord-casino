import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { clearActiveRequest } from '../db.auto.mjs';

export default async function handleRequestRejectModal(interaction, ctx) {
  const parts = interaction.customId.split('|');
  const messageId = parts[2];
  const targetId = parts[3];
  const type = parts[4];
  const amount = Number(parts[5]);
  const reason = interaction.fields.getTextInputValue('reason');
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  try {
    const ch = interaction.channel;
    const msg = await ch.messages.fetch(messageId);
    const orig = msg.embeds?.[0];
    const embed = orig ? EmbedBuilder.from(orig) : new EmbedBuilder();
    const fields = Array.isArray(orig?.fields) ? orig.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline })) : [];
    const idx = fields.findIndex(f => f.name === 'Status');
    const statusText = say(`Mmm, my steadfast Kitten <@${interaction.user.id}> had to refuse — reason: ${reason}`, `Rejected by <@${interaction.user.id}> — Reason: ${reason}`);
    if (idx >= 0) fields[idx].value = statusText; else fields.push({ name: 'Status', value: statusText });
    embed.setFields(fields);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`req|take|${targetId}|${type}|${amount}`).setLabel('Take Request').setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`req|done|${targetId}|${type}|${amount}`).setLabel('Request Complete').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId(`req|reject|${targetId}|${type}|${amount}`).setLabel('Reject Request').setStyle(ButtonStyle.Danger).setDisabled(true)
    );
    const payload = ctx?.kittenizePayload ? ctx.kittenizePayload({ embeds: [embed], components: [row] }) : { embeds: [embed], components: [row] };
    await msg.edit(payload);
  try { await clearActiveRequest(interaction.guild.id, targetId); } catch {}
    try {
      const user = await interaction.client.users.fetch(targetId);
      const message = say(
        `❌ My sweet Kitten <@${interaction.user.id}> had to decline your request (${type === 'buyin' ? 'Buy In' : 'Cash Out'} ${amount.toLocaleString()} Chips). Reason: ${reason}`,
        `❌ Your request (${type === 'buyin' ? 'Buy In' : 'Cash Out'} ${amount.toLocaleString()} Chips) was rejected by ${interaction.user.tag}. Reason: ${reason}`
      );
      await user.send(message);
    } catch {}
    return interaction.reply({ content: say('✅ Request rejected and the Kitten has been notified. Thank you for keeping things tidy.', '✅ Request rejected and user notified.'), ephemeral: true });
  } catch (e) {
    console.error('reject modal error:', e);
    return interaction.reply({ content: say('❌ I couldn’t send that rejection, Kitten.', '❌ Failed to reject request.'), ephemeral: true });
  }
}
// Interaction: Request rejection modal submit (collect reason)
