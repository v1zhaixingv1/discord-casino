import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

export default async function handleHelp(interaction, ctx) {
  const isMod = await ctx.isAdmin(interaction);
  const kittenMode = typeof ctx?.isKittenModeEnabled === 'function' ? await ctx.isKittenModeEnabled() : false;

  const sections = [];

  if (kittenMode) {
    sections.push({
      id: 'player',
      label: '😼 Kitten’s Playground',
      groups: [
        { label: '💋 Essentials', items: [
          { emoji: '🆘', cmd: '/help', desc: 'Summon my guidance whenever you need a whisper, Kitten.' },
          { emoji: '📡', cmd: '/ping', desc: 'Confirm your mistress is listening.' },
          { emoji: '💰', cmd: '/balance [user]', desc: 'Peek at your riches — mods may peek for other Kittens too.' },
          { emoji: '🏆', cmd: '/leaderboard [limit]', desc: 'Admire which Kittens are dripping in chips.' },
          { emoji: '🔄', cmd: 'Staking', desc: 'Every game but Hold’em burns Credits first; Chips only leap in when Credits fall short.' }
        ]},
        { label: '🎲 Games of Temptation', items: [
          { emoji: '🚌', cmd: '/ridebus bet:<int>', desc: 'Ride the Bus — flirt through Q1‑Q4, or cash out after Q3.' },
          { emoji: '🃏', cmd: '/blackjack table:<High|Low> bet:<int>', desc: 'High table for bold Kittens, Low table for something softer.' },
          { emoji: '🎰', cmd: '/slots bet:<int>', desc: 'Spin 20 shimmering lines — Credits first, always.' },
          { emoji: '🎡', cmd: '/roulette', desc: 'Lay your bets and let the wheel tease you.' },
          { emoji: '⚔️', cmd: '/dicewar bet:<int>', desc: 'Two dice, double the heat when doubles land.' },
          { emoji: '♠️', cmd: '/holdem', desc: 'Summon a Hold’em lounge — presets or something custom for me.' },
          { emoji: '📨', cmd: '/request type:<Buy In|Cash Out> amount:<int>', desc: 'Ask politely for a buy-in or cash-out.' }
        ]},
        { label: '♣️ Hold’em Lounge Notes', items: [
          { emoji: '🧾', cmd: '/holdem tables', desc: 'Creates a private table channel that fades once the thrill is gone.' },
          { emoji: '💼', cmd: 'Chips-only Buy-ins', desc: 'Escrow seduces your chips and pays them out — Credits never touch the felt.' },
          { emoji: '⚙️', cmd: 'Custom Tables', desc: 'Pick SB, Min, Max (BB auto = 2×SB); I’ll recap every detail for your players.' }
        ]}
      ]
    });
  } else {
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
          { emoji: '💼', cmd: 'Chips-only buy-ins', desc: 'Buy-ins use Chips (no Credits). Chips go to escrow; action commits move escrow to the pot; payouts+rake settle to players and the house.' },
          { emoji: '⚙️', cmd: 'Custom tables', desc: 'Choose Custom to enter SB, Min, Max (BB auto = 2×SB); creation message summarizes host, channel, blinds, buy-ins, rake.' }
        ]}
      ]
    });
  }

  if (isMod) {
    if (kittenMode) {
      sections.push({
        id: 'moderator',
        label: '🛡️ House Kittens',
        groups: [
          { label: '✉️ Requests', items: [ { emoji: '⏱️', cmd: '/requesttimer seconds:<int>', desc: 'Set how long eager Kittens wait between /request pleas.' } ] },
          { label: '🏦 House & Chips', items: [
            { emoji: '📊', cmd: '/housebalance', desc: 'Check the vault — the house keeps score.' },
            { emoji: '➕', cmd: '/houseadd amount:<int> [reason]', desc: 'Slip fresh chips into the house coffers.' },
            { emoji: '➖', cmd: '/houseremove amount:<int> [reason]', desc: 'Pull chips out for something special.' },
            { emoji: '🎁', cmd: '/givechips user:<@> amount:<int> [reason]', desc: 'Gift chips to a deserving Kitten.' },
            { emoji: '🪙', cmd: '/buyin user:<@> amount:<int> [reason]', desc: 'Mint chips straight into a Kitten’s paws.' },
            { emoji: '🏛️', cmd: '/takechips user:<@> amount:<int> [reason]', desc: 'Collect chips back for the house.' },
            { emoji: '🔥', cmd: '/cashout user:<@> amount:<int> [reason]', desc: 'Burn chips when a Kitten cashes out.' }
          ]},
          { label: '💳 Credits', items: [
            { emoji: '🎟️', cmd: '/givecredits user:<@> amount:<int> [reason]', desc: 'Shower Credits on a playful Kitten.' },
            { emoji: '🧾', cmd: '/takecredits user:<@> amount:<int> [reason]', desc: 'Burn Credits when discipline is needed.' }
          ]}
        ]
      });
      sections.push({
        id: 'admin',
        label: '⚙️ Headmistress',
        groups: [
          { label: '🏗️ Salon Setup', items: [
            { emoji: '🗂️', cmd: '/setcasinocategory category:<#Category>', desc: 'Choose where my casino lounges live. (Admin only)' },
            { emoji: '📜', cmd: '/setgamelogchannel channel:<#channel>', desc: 'Point game logs to the proper parlor. (Admin only)' },
            { emoji: '💼', cmd: '/setcashlog channel:<#channel>', desc: 'Decide where chip and credit ledgers are whispered. (Admin only)' },
            { emoji: '📬', cmd: '/setrequestchannel channel:<#channel>', desc: 'Pick the room where requests arrive. (Admin only)' }
          ]},
          { label: '🎭 Persona', items: [
            { emoji: '💋', cmd: '/kittenmode enabled:<bool>', desc: 'Invite or dismiss my sultry persona. (Admin only)' }
          ]},
          { label: '👥 Roles', items: [
            { emoji: '➕', cmd: '/addmodrole role:<@Role>', desc: 'Crown a new house Kitten with moderator powers. (Admin only)' },
            { emoji: '➖', cmd: '/removemodrole role:<@Role>', desc: 'Revoke those powers with a snap. (Admin only)' }
          ]},
          { label: '📊 Limits', items: [
            { emoji: '🎚️', cmd: '/setmaxbet game:<choice> amount:<int>', desc: 'Set how daring bets may be. (Admin only)' },
            { emoji: '💱', cmd: '/setrake percent:<number>', desc: 'Adjust Hold’em rake to keep the house pampered. (Admin only)' }
          ]}
        ]
      });
      sections.push({ id: 'owner', label: '👑 Proprietor', groups: [ { label: '🧹 Maintenance', items: [ { emoji: '♻️', cmd: '/resetallbalance', desc: 'Wipe every balance clean when you crave a fresh start. (Owner only)' } ] } ] });
    } else {
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
          { label: '🎭 Personality', items: [
            { emoji: '💋', cmd: '/kittenmode enabled:<bool>', desc: 'Toggle the Kitten persona for this server. (Admin only)' }
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
  }

  const makeEmbed = (sectionId) => {
    const s = sections.find(x => x.id === sectionId) || sections[0];
    const description = kittenMode
      ? 'Select another delicious category, Kitten. Whisper `/help` again or flag a moderator if you crave more.'
      : 'Select another category from the menu to explore more tools. Need quick help? Try `/help` again or ping a moderator.';
    const e = new EmbedBuilder()
      .setTitle(`${s.label} Commands`)
      .setDescription(description)
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
    .setPlaceholder(kittenMode ? 'Choose your tease, Kitten' : 'Choose a help section')
    .addOptions(sections.map(s => ({ label: s.label, value: s.id })));
  const row = new ActionRowBuilder().addComponents(menu);
  return interaction.reply({ embeds: [makeEmbed(sections[0].id)], components: [row], ephemeral: true });
}
// Slash Command: /help — interactive help menu (player/mod/admin sections)
