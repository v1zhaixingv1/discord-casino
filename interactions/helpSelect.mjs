import { EmbedBuilder } from 'discord.js';

export default async function handleHelpSelect(interaction, ctx) {
  const val = interaction.values[0];
  const isMod = await ctx.isAdmin(interaction);
  const sections = [];

  sections.push({
    id: 'player',
    label: 'Player',
    groups: [
      { label: 'General', items: [
        { cmd: '/help', desc: 'Show this help.' },
        { cmd: '/ping', desc: 'Check if the bot is alive.' },
        { cmd: '/balance [user]', desc: 'Check your balance (moderators can check others).' },
        { cmd: '/leaderboard [limit]', desc: 'Show top chip holders.' },
        { cmd: 'Staking', desc: 'All games except Hold’em use Credits‑first staking (Credits burn on losses; Chips are used only if Credits are insufficient).' }
      ]},
      { label: 'Games', items: [
        { cmd: '/ridebus bet:<int>', desc: 'Ride the Bus — clear Q1–Q4 to win; cash out after Q3.' },
        { cmd: '/blackjack table:<High|Low> bet:<int>', desc: 'Blackjack vs. house (High=min 100, H17; Low=max 99, S17).' },
        { cmd: '/slots bet:<int>', desc: '5×3 slot with 20 lines; Credits‑first staking.' },
        { cmd: '/roulette', desc: 'American Roulette: add bets, then confirm.' },
        { cmd: '/dicewar bet:<int>', desc: 'Dice War: 2d6 vs house; any doubles double the pot on a win (ties go to house). Sessions expire after 2 minutes of inactivity; any interaction resets the timer. Use the Play Again button to continue.' },
        { cmd: '/holdem', desc: 'Texas Hold’em: presets or Custom (enter SB, Min, Max).' },
        { cmd: '/request type:<Buy In|Cash Out> amount:<int>', desc: 'Request a chip buy‑in or cash‑out.' }
      ]},
      { label: 'Texas Hold’em', items: [
        { cmd: '/holdem tables', desc: 'Creates a temporary channel (#holdem-table-N) under the casino category; auto‑deletes on timeout.' },
        { cmd: 'Chips‑only buy‑ins', desc: 'Buy‑ins use Chips (no Credits). Chips go to table escrow; action commits move escrow to the pot; payouts+rake settle to players and the house.' },
        { cmd: 'Custom tables', desc: 'Choose Custom to enter SB, Min, Max (BB auto = 2×SB); creation message summarizes host, channel, blinds, buy‑ins, rake.' }
      ]}
    ]
  });

  if (isMod) {
    sections.push({ id: 'moderator', label: 'Moderator', groups: [
      { label: 'Requests', items: [ { cmd: '/requesttimer seconds:<int>', desc: 'Set cooldown between /request submissions.' } ] },
      { label: 'House & Chips', items: [
        { cmd: '/housebalance', desc: 'View house chip balance.' },
        { cmd: '/houseadd amount:<int> [reason]', desc: 'Add chips to the house.' },
        { cmd: '/houseremove amount:<int> [reason]', desc: 'Remove chips from the house.' },
        { cmd: '/givechips user:<@> amount:<int> [reason]', desc: 'Give chips from house to player.' },
        { cmd: '/buyin user:<@> amount:<int> [reason]', desc: 'Mint chips to a player.' },
        { cmd: '/takechips user:<@> amount:<int> [reason]', desc: 'Take chips to the house.' },
        { cmd: '/cashout user:<@> amount:<int> [reason]', desc: 'Burn chips from a player.' }
      ]},
      { label: 'Credits', items: [
        { cmd: '/givecredits user:<@> amount:<int> [reason]', desc: 'Grant Credits to a player.' },
        { cmd: '/takecredits user:<@> amount:<int> [reason]', desc: 'Burn a player’s Credits.' }
      ]}
    ]});

    sections.push({ id: 'admin', label: 'Admin', groups: [
      { label: 'Setup & Channels', items: [
        { cmd: '/setcasinocategory category:<#Category>', desc: 'Set the casino category. (Admin only)' },
        { cmd: '/setgamelogchannel channel:<#channel>', desc: 'Set game log channel. (Admin only)' },
        { cmd: '/setcashlog channel:<#channel>', desc: 'Set cash log channel. (Admin only)' },
        { cmd: '/setrequestchannel channel:<#channel>', desc: 'Set requests channel. (Admin only)' }
      ]},
      { label: 'Roles', items: [
        { cmd: '/addmodrole role:<@Role>', desc: 'Add a moderator role. (Admin only)' },
        { cmd: '/removemodrole role:<@Role>', desc: 'Remove a moderator role. (Admin only)' }
      ]},
      { label: 'Limits', items: [
        { cmd: '/setmaxbet game:<choice> amount:<int>', desc: 'Set a game’s max bet. (Admin only)' },
        { cmd: '/setrake percent:<number>', desc: 'Hold’em rake percent (cap = table max). (Admin only)' }
      ]}
    ]});
    sections.push({ id: 'owner', label: 'Owner', groups: [ { label: 'Maintenance', items: [ { cmd: '/resetallbalance', desc: 'Reset all balances to defaults. (Owner only)' } ] } ] });
  }

  const s = sections.find(x => x.id === val) || sections[0];
  const e = new EmbedBuilder().setTitle(`📖 Help — ${s.label}`).setColor(0x5865F2);
  const groups = s.groups || [];
  for (const g of groups) {
    const lines = (g.items || []).map(it => `${it.cmd} — ${it.desc}`).join('\n\n');
    e.addFields({ name: g.label, value: lines || '_none_' });
  }
  return interaction.update({ embeds: [e] });
}
// Interaction: Help select menu (switch sections)
