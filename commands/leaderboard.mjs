import { getTopUsers } from '../db.auto.mjs';

export default async function handleLeaderboard(interaction, ctx) {
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;
  const say = (kitten, normal) => (kittenMode ? kitten : normal);
  const limit = interaction.options.getInteger('limit') ?? 10;
  const rows = await getTopUsers(interaction.guild?.id, limit);
  if (!rows.length) {
    return interaction.reply({ content: say('📉 No Kittens have claimed any chips yet. Be the first to indulge!', '📉 No players with chips yet. Be the first to earn some!') });
  }
  const medals = ['🥇', '🥈', '🥉'];
  const fmt = new Intl.NumberFormat('en-US');
  const lines = rows.map((r, i) => {
    const rank = i < 3 ? medals[i] : `#${i + 1}`;
    return say(
      `${rank} My radiant Kitten <@${r.discord_id}> — **${fmt.format(Number(r.chips || 0))}**`,
      `${rank} <@${r.discord_id}> — **${fmt.format(Number(r.chips || 0))}**`
    );
  });
  const title = say(`🏆 Chip Leaderboard — My Top ${rows.length} Kittens`, `🏆 Chip Leaderboard (Top ${rows.length})`);
  return interaction.reply({ content: `**${title}**\n${lines.join('\n')}` });
}
