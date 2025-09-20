import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getGuildSettings, getActiveRequest, getLastRequestAt, getModRoles, getUserBalances, createActiveRequest, setLastRequestNow } from '../db.auto.mjs';

export default async function handleRequest(interaction, ctx) {
  const type = interaction.options.getString('type'); // 'buyin' | 'cashout'
  const amount = interaction.options.getInteger('amount');
  if (!Number.isInteger(amount) || amount <= 0) {
    return interaction.reply({ content: '❌ Amount must be a positive integer.', ephemeral: true });
  }
  const settings = await getGuildSettings(interaction.guild.id);
  try {
    const active = await getActiveRequest(interaction.guild.id, interaction.user.id);
    if (active) return interaction.reply({ content: '⏳ You already have an active request. Please wait until it is completed or rejected.', ephemeral: true });
  } catch {}
  const cooldown = Number(settings.request_cooldown_sec || 0);
  if (cooldown > 0) {
    const now = Math.floor(Date.now() / 1000);
    const last = await getLastRequestAt(interaction.guild.id, interaction.user.id);
    const elapsed = now - (last || 0);
    if (last && elapsed < cooldown) {
      const remain = cooldown - elapsed;
      return interaction.reply({ content: `⏳ You can submit another request in ${remain} seconds.`, ephemeral: true });
    }
  }
  const reqChannelId = settings.request_channel_id;
  if (!reqChannelId) return interaction.reply({ content: '❌ Requests channel is not configured. Please contact an admin.', ephemeral: true });
  const reqChannel = await interaction.client.channels.fetch(reqChannelId).catch(() => null);
  if (!reqChannel || !reqChannel.isTextBased()) return interaction.reply({ content: '❌ Requests channel is invalid or inaccessible.', ephemeral: true });

  const adminRoleIds = Array.from(new Set([...(ctx.MOD_ROLE_IDS||[]), ...(await getModRoles(interaction.guild.id))]));
  const mentions = adminRoleIds.length ? adminRoleIds.map(id => `<@&${id}>`).join(' ') : '';

  let balText = '';
  try {
    const { chips: reqChips, credits: reqCredits } = await getUserBalances(interaction.guild?.id, interaction.user.id);
    const fmt = new Intl.NumberFormat('en-US');
    balText = `Chips: **${ctx.chipsAmount(reqChips)}**\nCredits: **${fmt.format(reqCredits)}**`;
  } catch {}

  const e = new EmbedBuilder()
    .setTitle('📝 Chip Request')
    .setColor(type === 'buyin' ? 0x57F287 : 0xED4245)
    .addFields(
      { name: 'Requester', value: `<@${interaction.user.id}>`, inline: true },
      // { name: 'Requester', value: `Thank you Kitten! <@${interaction.user.id}>`, inline: true },
      { name: 'Type', value: type === 'buyin' ? 'Buy In' : 'Cash Out', inline: true },
      { name: 'Amount', value: `**${ctx.chipsAmount(amount)}**`, inline: true },
    )
    .addFields({ name: 'Requester Balance', value: balText || '_unavailable_' })
    .addFields({ name: 'Status', value: 'Pending' })
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`req|take|${interaction.user.id}|${type}|${amount}`).setLabel('Take Request').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`req|done|${interaction.user.id}|${type}|${amount}`).setLabel('Request Complete').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`req|reject|${interaction.user.id}|${type}|${amount}`).setLabel('Reject Request').setStyle(ButtonStyle.Danger)
  );

  const sent = await reqChannel.send({ content: mentions || undefined, embeds: [e], components: [row] });
  try { await createActiveRequest(interaction.guild.id, interaction.user.id, sent.id, type, amount); } catch {}
  try { await setLastRequestNow(interaction.guild.id, interaction.user.id); } catch {}
  return interaction.reply({ content: '✅ Your request has been submitted.', ephemeral: true });
}
