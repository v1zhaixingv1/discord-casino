import { getTopUsers } from '../db.auto.mjs';

export default async function handleLeaderboard(interaction) {
  const limit = interaction.options.getInteger('limit') ?? 10;
  const rows = await getTopUsers(interaction.guild?.id, limit);
  if (!rows.length) {
    return interaction.reply({ content: '📉 No players with chips yet. Be the first to earn some!' });
  }
  const medals = ['🥇', '🥈', '🥉'];
  const fmt = new Intl.NumberFormat('en-US');
  const lines = rows.map((r, i) => {
    const rank = i < 3 ? medals[i] : `#${i + 1}`;
    return `${rank} <@${r.discord_id}> — **${fmt.format(Number(r.chips || 0))}**`;
    // return `${rank} My radiant Kitten <@${r.discord_id}> — **${fmt.format(Number(r.chips || 0))}**`;
  });
  const title = `🏆 Chip Leaderboard (Top ${rows.length})`;
  return interaction.reply({ content: `**${title}**\n${lines.join('\n')}` });
}
