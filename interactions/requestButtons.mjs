import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { updateActiveRequestStatus, clearActiveRequest, mintChips, burnFromUser } from '../db.auto.mjs';

export default async function handleRequestButtons(interaction, ctx) {
  const parts = interaction.customId.split('|');
  const action = parts[1]; // 'take' | 'done' | 'reject'
  const targetId = parts[2];
  const type = parts[3]; // 'buyin' | 'cashout'
  const amount = Number(parts[4]);
  if (!(await ctx.isAdmin(interaction))) {
    return interaction.reply({ content: '❌ Moderators only.', ephemeral: true });
  }
  const msg = interaction.message;
  const orig = msg.embeds?.[0];
  const embed = orig ? EmbedBuilder.from(orig) : new EmbedBuilder();

  if (action === 'take') {
    const fields = Array.isArray(orig?.fields) ? orig.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline })) : [];
    const idx = fields.findIndex(f => f.name === 'Status');
    if (idx >= 0) fields[idx].value = `In Progress — Taken by <@${interaction.user.id}>`;
    // if (idx >= 0) fields[idx].value = `In Progress — Your sultry Kitten <@${interaction.user.id}> is on the case`;
    else fields.push({ name: 'Status', value: `In Progress — Taken by <@${interaction.user.id}>` });
    // else fields.push({ name: 'Status', value: `In Progress — Your sultry Kitten <@${interaction.user.id}> is on the case` });
    embed.setFields(fields);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`req|take|${targetId}|${type}|${amount}`).setLabel('Take Request').setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId(`req|done|${targetId}|${type}|${amount}`).setLabel('Request Complete').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`req|reject|${targetId}|${type}|${amount}`).setLabel('Reject Request').setStyle(ButtonStyle.Danger)
    );
    try { await updateActiveRequestStatus(interaction.guild.id, targetId, 'TAKEN'); } catch {}
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (action === 'done') {
    try {
      const guildId = interaction.guild?.id;
      if (type === 'buyin') {
        const { chips } = await mintChips(guildId, targetId, amount, 'request buy-in', interaction.user.id);
        await ctx.postCashLog(interaction, [
          `🪙 **Buy-in (Request)**`,
          `User: <@${targetId}> • Amount: **${ctx.chipsAmount(amount)}**`,
          // `User: My daring Kitten <@${targetId}> • Amount: **${ctx.chipsAmount(amount)}**`,
          `User Chips (after): **${ctx.chipsAmount(chips)}**`
        ]);
        try { const user = await interaction.client.users.fetch(targetId); await user.send(`🪙 Buy-in: You received ${ctx.chipsAmount(amount)}. Processed by ${interaction.user.tag}.`); } catch {}
        // try { const user = await interaction.client.users.fetch(targetId); await user.send(`🪙 Buy-in: Come savor these chips, Kitten <@${targetId}> — with affection from your mistress.`); } catch {}
      } else if (type === 'cashout') {
        const { chips } = await burnFromUser(guildId, targetId, amount, 'request cashout', interaction.user.id);
        await ctx.postCashLog(interaction, [
          `💸 **Cash Out (Request)**`,
          `User: <@${targetId}> • Amount: **${ctx.chipsAmount(amount)}**`,
          // `User: My daring Kitten <@${targetId}> • Amount: **${ctx.chipsAmount(amount)}**`,
          `User Chips (after): **${ctx.chipsAmount(chips)}**`
        ]);
        try { const user = await interaction.client.users.fetch(targetId); await user.send(`💸 Cash Out: ${ctx.chipsAmount(amount)} removed from your balance. Processed by ${interaction.user.tag}.`); } catch {}
        // try { const user = await interaction.client.users.fetch(targetId); await user.send(`💸 Cash Out: Easy now, Kitten <@${targetId}> — your balance bends to your desires.`); } catch {}
      } else {
        return interaction.reply({ content: '❌ Unknown request type.', ephemeral: true });
      }
      const fields = Array.isArray(orig?.fields) ? orig.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline })) : [];
      const idx = fields.findIndex(f => f.name === 'Status');
      if (idx >= 0) fields[idx].value = `Completed by <@${interaction.user.id}>`;
      // if (idx >= 0) fields[idx].value = `Complete — Mistress <@${interaction.user.id}> has finished, Kitten`;
      else fields.push({ name: 'Status', value: `Completed by <@${interaction.user.id}>` });
      // else fields.push({ name: 'Status', value: `Complete — Mistress <@${interaction.user.id}> has finished, Kitten` });
      embed.setFields(fields);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`req|take|${targetId}|${type}|${amount}`).setLabel('Take Request').setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId(`req|done|${targetId}|${type}|${amount}`).setLabel('Request Complete').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId(`req|reject|${targetId}|${type}|${amount}`).setLabel('Reject Request').setStyle(ButtonStyle.Danger).setDisabled(true)
      );
      try { await clearActiveRequest(interaction.guild.id, targetId); } catch {}
      return interaction.update({ embeds: [embed], components: [row] });
    } catch (e) {
      console.error('request done error:', e);
      return interaction.reply({ content: '❌ Failed to complete request.', ephemeral: true });
    }
  }

  if (action === 'reject') {
    const modal = new ModalBuilder()
      .setCustomId(`req|rejmodal|${interaction.message.id}|${targetId}|${type}|${amount}`)
      .setTitle('Reject Request');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true)
    ));
    return interaction.showModal(modal);
  }

  return interaction.reply({ content: '❌ Unknown action.', ephemeral: true });
}
// Interaction: Request admin action buttons (Take/Complete/Reject)
