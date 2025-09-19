import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

export default async function handleHelp(interaction, ctx) {
  const isMod = await ctx.isAdmin(interaction);
  const sections = [];

  sections.push({
    id: 'player',
    label: '🎮 Player',
    groups: [
      { label: '🌟 General', items: [
        { emoji: '🆘', cmd: '/help', desc: 'Show this help.' },
        { emoji: '📡', cmd: '/ping', desc: 'Check if the bot is alive.' },
        { emoji: '💰', cmd: '/balance [user]', desc: 'Check your balance (moderators can check others).' },
        { emoji: '🏆', cmd: '/leaderboard [limit]', desc: 'Show top chip holders.' },
        { emoji: '🔄', cmd: 'Staking', desc: 'All games except Hold’em use Credits‑first staking (Credits burn on losses; Chips are used only if Credits are insufficient).' }
      ]},
      { label: '🎲 Games', items: [
        { emoji: '🚌', cmd: '/ridebus bet:<int>', desc: 'Ride the Bus — clear Q1–Q4 to win; cash out after Q3.' },
        { emoji: '🃏', cmd: '/blackjack table:<High|Low> bet:<int>', desc: 'Blackjack vs. house (High=min 100, H17; Low=max 99, S17).' },
        { emoji: '🎰', cmd: '/slots bet:<int>', desc: '5×3 slot with 20 lines; Credits‑first staking.' },
        { emoji: '🎡', cmd: '/roulette', desc: 'American Roulette: add bets, then confirm.' },
        { emoji: '⚔️', cmd: '/dicewar bet:<int>', desc: 'Dice War: 2d6 vs house; any doubles double the pot on a win (ties go to house).' },
        { emoji: '♠️', cmd: '/holdem', desc: 'Texas Hold’em: presets or Custom (enter SB, Min, Max).' },
        { emoji: '📨', cmd: '/request type:<Buy In|Cash Out> amount:<int>', desc: 'Request a chip buy‑in or cash‑out.' }
      ]},
      { label: '♣️ Texas Hold’em', items: [
        { emoji: '🧾', cmd: '/holdem tables', desc: 'Creates a temporary channel (#holdem-table-N) under the casino category; auto‑deletes on timeout.' },
        { emoji: '💼', cmd: 'Chips‑only buy‑ins', desc: 'Buy‑ins use Chips (no Credits). Chips go to table escrow; action commits move escrow to the pot; payouts+rake settle to players and the house.' },
        { emoji: '⚙️', cmd: 'Custom tables', desc: 'Choose Custom to enter SB, Min, Max (BB auto = 2×SB); creation message summarizes host, channel, blinds, buy‑ins, rake.' }
      ]}
    ]
  });

  if (isMod) {
    sections.push({
      id: 'moderator',
      label: '🛡️ Moderator',
      groups: [
        { label: '✉️ Requests', items: [ { emoji: '⏱️', cmd: '/requesttimer seconds:<int>', desc: 'Set cooldown between /request submissions.' } ] },
        { label: '🏦 House & Chips', items: [
          { emoji: '📊', cmd: '/housebalance', desc: 'View house chip balance.' },
          { emoji: '➕', cmd: '/houseadd amount:<int> [reason]', desc: 'Add chips to the house.' },
          { emoji: '➖', cmd: '/houseremove amount:<int> [reason]', desc: 'Remove chips from the house.' },
          { emoji: '🎁', cmd: '/givechips user:<@> amount:<int> [reason]', desc: 'Give chips from house to player.' },
          { emoji: '🪙', cmd: '/buyin user:<@> amount:<int> [reason]', desc: 'Mint chips to a player.' },
          { emoji: '🏛️', cmd: '/takechips user:<@> amount:<int> [reason]', desc: 'Take chips to the house.' },
          { emoji: '🔥', cmd: '/cashout user:<@> amount:<int> [reason]', desc: 'Burn chips from a player.' }
        ]},
        { label: '💳 Credits', items: [
          { emoji: '🎟️', cmd: '/givecredits user:<@> amount:<int> [reason]', desc: 'Grant Credits to a player.' },
          { emoji: '🧾', cmd: '/takecredits user:<@> amount:<int> [reason]', desc: 'Burn a player’s Credits.' }
        ]}
      ]
    });

    sections.push({
      id: 'admin',
      label: '⚙️ Admin',
      groups: [
        { label: '🏗️ Setup & Channels', items: [
          { emoji: '🗂️', cmd: '/setcasinocategory category:<#Category>', desc: 'Set the casino category. (Admin only)' },
          { emoji: '📜', cmd: '/setgamelogchannel channel:<#channel>', desc: 'Set game log channel. (Admin only)' },
          { emoji: '💼', cmd: '/setcashlog channel:<#channel>', desc: 'Set cash log channel. (Admin only)' },
          { emoji: '📬', cmd: '/setrequestchannel channel:<#channel>', desc: 'Set requests channel. (Admin only)' }
        ]},
        { label: '👥 Roles', items: [
          { emoji: '➕', cmd: '/addmodrole role:<@Role>', desc: 'Add a moderator role. (Admin only)' },
          { emoji: '➖', cmd: '/removemodrole role:<@Role>', desc: 'Remove a moderator role. (Admin only)' }
        ]},
        { label: '📊 Limits', items: [
          { emoji: '🎚️', cmd: '/setmaxbet game:<choice> amount:<int>', desc: 'Set a game’s max bet. (Admin only)' },
          { emoji: '💱', cmd: '/setrake percent:<number>', desc: 'Hold’em rake percent (cap = table max). (Admin only)' }
        ]}
      ]
    });

    sections.push({ id: 'owner', label: '👑 Owner', groups: [ { label: '🧹 Maintenance', items: [ { emoji: '♻️', cmd: '/resetallbalance', desc: 'Reset all balances to defaults. (Owner only)' } ] } ] });
  }

  const makeEmbed = (sectionId) => {
    const s = sections.find(x => x.id === sectionId) || sections[0];
    const cleanLabel = s.label.replace(/^\p{Extended_Pictographic}\s*/u, '').trim();
    const e = new EmbedBuilder()
      .setTitle(`${s.label} Commands`)
      .setDescription('Select another category from the menu to explore more tools. Need quick help? Try `/help` again or ping a moderator.')
      .setColor(0x5865F2);
    const groups = s.groups || [];
    for (const g of groups) {
      const lines = (g.items || []).map(it => {
        const decorated = it.emoji ? `${it.emoji} ${it.cmd}` : it.cmd;
        return `${decorated} — ${it.desc}`;
      }).join('\n\n');
      e.addFields({ name: g.label, value: lines || '_none_' });
    }
    return e;
  };

  const menu = new StringSelectMenuBuilder()
    .setCustomId('help|section')
    .setPlaceholder('Choose a help section')
    .addOptions(sections.map(s => ({ label: s.label, value: s.id })));
  const row = new ActionRowBuilder().addComponents(menu);
  return interaction.reply({ embeds: [makeEmbed(sections[0].id)], components: [row], ephemeral: true });
}
// Slash Command: /help — interactive help menu (player/mod/admin sections)
