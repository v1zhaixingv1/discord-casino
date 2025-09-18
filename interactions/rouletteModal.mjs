import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export default async function onRouletteModal(interaction, ctx) {
  const key = ctx.keyFor(interaction);
  const state = ctx.rouletteSessions.get(key);
  if (!state) return interaction.reply({ content: '❌ No active roulette session.', ephemeral: true });
  if (ctx.hasActiveExpired(interaction.guild.id, interaction.user.id, 'roulette') || !ctx.getActiveSession(interaction.guild.id, interaction.user.id)) {
    ctx.rouletteSessions.delete(key);
    return interaction.reply({ content: '⌛ Your roulette session expired. Use `/roulette` to start a new one.', ephemeral: true });
  }
  ctx.touchActiveSession(interaction.guild.id, interaction.user.id, 'roulette');
  const type = state.pendingType;
  if (!type) return interaction.reply({ content: '❌ No bet type selected.', ephemeral: true });
  const amountStr = interaction.fields.getTextInputValue('amount');
  const amount = Number(amountStr);
  if (!Number.isInteger(amount) || amount < 5) return interaction.reply({ content: '❌ Amount must be an integer of at least 5.', ephemeral: true });
  let pocket;
  if (type === 'straight') {
    const p = (interaction.fields.getTextInputValue('pocket') || '').trim();
    if (p === '00') pocket = '00'; else if (p === '0') pocket = 0; else if (/^\d+$/.test(p) && Number(p)>=1 && Number(p)<=36) pocket = Number(p); else return interaction.reply({ content: '❌ Invalid pocket.', ephemeral: true });
  }
  state.bets.push({ type, pocket, amount });
  state.pendingType = null;
  const embed = await ctx.rouletteSummaryEmbed(state);
  const rowType = ctx.rouletteTypeSelectRow();
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rou|confirm').setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rou|cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
  return ctx.sendGameMessage(interaction, { embeds: [embed], components: [rowType, controls] }, 'update');
}
// Interaction: Roulette custom bet modal (parses form to bet entries)
