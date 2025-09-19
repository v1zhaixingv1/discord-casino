import { REST, Routes, PermissionFlagsBits } from 'discord.js';
import 'dotenv/config';

const ADMIN_PERMS = String(PermissionFlagsBits.Administrator);

const commands = [
  { name: 'ping', description: 'Replies with Pong!' },
  {
    name: 'balance',
    description: 'Check your chip & credit balance (moderators can check others).',
    options: [
      { name: 'user', description: 'User to check (admin only)', type: 6, required: false }
    ]
  },
  {
    name: 'dicewar',
    description: 'Dice War: 2d6 vs house; doubles double pot on win (ties house).',
    options: [
      { name: 'bet', description: 'Your wager in chips', type: 4, required: true, min_value: 1 }
    ]
  },
  {
    name: 'holdem',
    description: 'Texas Hold’em: create a table with presets.',
    options: []
  },
  {
    name: 'request',
    description: 'Request a buy-in or cash-out from admins.',
    options: [
      { name: 'type', description: 'Request type', type: 3, required: true, choices: [
        { name: 'Buy In', value: 'buyin' },
        { name: 'Cash Out', value: 'cashout' }
      ]},
      { name: 'amount', description: 'Amount of chips', type: 4, required: true, min_value: 1 }
    ]
  },
  {
    name: 'roulette',
    description: 'Play American Roulette (interactive betting).',
    options: []
  },
  {
    name: 'setrequestchannel',
    description: 'Set the channel where requests will be posted (admin only).',
    options: [
      { name: 'channel', description: 'Select a text channel', type: 7, channel_types: [0,5,10,11,12], required: true }
    ]
  },
  {
    name: 'requesttimer',
    description: 'Set the cooldown (seconds) between /request submissions (moderator only).',
    options: [
      { name: 'seconds', description: 'Cooldown seconds (0 disables)', type: 4, required: true, min_value: 0 }
    ]
  },
  {
    name: 'blackjack',
    description: 'Play Blackjack vs. the house (choose High/Low table).',
    options: [
      {
        name: 'table',
        description: 'Choose table stakes and rules',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'High (min 100, H17)', value: 'HIGH' },
          { name: 'Low (max 99, S17)', value: 'LOW' }
        ]
      },
      { name: 'bet', description: 'Your wager', type: 4, required: true, min_value: 1 }
    ]
  },
  {
    name: 'slots',
    description: 'Play a 5×3 video slot (20 lines, Credits-first staking).',
    options: [
      { name: 'bet', description: 'Total bet (across 20 lines)', type: 4, required: true, min_value: 5 }
    ]
  },
  {
    name: 'resetallbalance',
    description: 'OWNER only: reset all users and house balances to defaults.'
  },
  {
    name: 'setrake',
    description: 'Set Hold’em table rake (admin only).',
    options: [
      { name: 'percent', description: 'Rake percent (e.g., 2.5)', type: 10, required: true, min_value: 0 }
    ]
  },
  {
    name: 'setmaxbet',
    description: 'Set the max bet for a game (admin only).',
    options: [
      { name: 'game', description: 'Which game', type: 3, required: true, choices: [ { name: 'Ride the Bus', value: 'Ride the Bus' } ] },
      { name: 'amount', description: 'Maximum bet', type: 4, required: true, min_value: 1 }
    ]
  },

  {
    name: 'setcasinocategory',
    description: 'Set the Discord category for casino features (admin only).',
    options: [
      { name: 'category', description: 'Select a category', type: 7, channel_types: [4], required: true }
    ]
  },
  {
    name: 'housebalance',
    description: 'View the house chip balance (moderator only).'
  },
  {
    name: 'houseadd',
    description: 'Add chips to the house bank (moderator only).',
    options: [
      { name: 'amount', description: 'Amount to add', type: 4, required: true, min_value: 1 },
      { name: 'reason', description: 'Why?', type: 3, required: false }
    ]
  },
  {
    name: 'givechips',
    description: 'Give chips from the house to a user (moderator only).',
    options: [
      { name: 'user', description: 'Recipient', type: 6, required: true },
      { name: 'amount', description: 'Amount of chips', type: 4, required: true, min_value: 1 },
      { name: 'reason', description: 'Why?', type: 3, required: false }
    ]
  },
  {
    name: 'buyin',
    description: 'Mint chips directly to a user (moderator only).',
    options: [
      { name: 'user', description: 'Recipient', type: 6, required: true },
      { name: 'amount', description: 'Amount of chips', type: 4, required: true, min_value: 1 },
      { name: 'reason', description: 'Why?', type: 3, required: false }
    ]
  },
  {
    name: 'houseremove',
    description: 'Remove chips from the house bank (moderator only).',
    options: [
      { name: 'amount', description: 'Amount to remove', type: 4, required: true, min_value: 1 },
      { name: 'reason', description: 'Why?', type: 3, required: false }
    ]
  },
  {
    name: 'takechips',
    description: 'Take chips from a user to the house (moderator only).',
    options: [
      { name: 'user', description: 'Target user', type: 6, required: true },
      { name: 'amount', description: 'Amount of chips', type: 4, required: true, min_value: 1 },
      { name: 'reason', description: 'Why?', type: 3, required: false }
    ]
  },
  {
    name: 'cashout',
    description: 'Burn chips from a user (moderator only).',
    options: [
      { name: 'user', description: 'Target user', type: 6, required: true },
      { name: 'amount', description: 'Amount of chips to burn', type: 4, required: true, min_value: 1 },
      { name: 'reason', description: 'Why?', type: 3, required: false }
    ]
  },
  {
    name: 'leaderboard',
    description: 'Show the top chip balances.',
    options: [
      { name: 'limit', description: 'How many to show (max 25)', type: 4, required: false, min_value: 1, max_value: 25 }
    ]
  },
  {
    name: 'givecredits',
    description: 'Give Credits to a user (moderator only).',
    options: [
      { name: 'user', description: 'Recipient', type: 6, required: true },
      { name: 'amount', description: 'Amount of Credits', type: 4, required: true, min_value: 1 },
      { name: 'reason', description: 'Why?', type: 3, required: false }
    ]
  },
  {
    name: 'takecredits',
    description: 'Burn Credits from a user (moderator only).',
    options: [
      { name: 'user', description: 'Target user', type: 6, required: true },
      { name: 'amount', description: 'Amount of Credits to burn', type: 4, required: true, min_value: 1 },
      { name: 'reason', description: 'Why?', type: 3, required: false }
    ]
  },
  {
    name: 'help',
    description: 'List all available commands',
  },
  {
    name: 'setgamelogchannel',
    description: 'Set the channel for game transaction logs (admin only).',
    options: [
      {
        name: 'channel',
        description: 'Select a text channel',
        type: 7,
        channel_types: [0, 5, 10, 11, 12]
      }
    ]
  },
  {
    name: 'setcashlog',
    description: 'Set the channel for admin/user cash logs (non-game transactions) (admin only).',
    options: [
      {
        name: 'channel',
        description: 'Select a text channel',
        type: 7,
        channel_types: [0, 5, 10, 11, 12]
      }
    ]
  },
  {
    name: 'addmodrole',
    description: 'Add a role as casino moderator (admin only)',
    options: [
      {
        type: 8, // ROLE
        name: 'role',
        description: 'The role to grant moderator access',
        required: true
      }
    ]
  },
  {
    name: 'removemodrole',
    description: 'Remove a role from casino moderator (admin only)',
    options: [
      {
        type: 8,
        name: 'role',
        description: 'The role to revoke moderator access',
        required: true
      }
    ]
  },
  {
    name: 'ridebus',
    description: 'Play Ride the Bus (Credits first, then Chips).',
    options: [
      { name: 'bet', description: 'Your wager in chips', type: 4, required: true, min_value: 1 }
    ]
  }


];

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  throw new Error('Missing DISCORD_TOKEN or CLIENT_ID in environment.');
}

const rest = new REST({ version: '10' }).setToken(token);

// Allow comma-separated list (GUILD_IDS) or legacy single GUILD_ID for fast dev updates.
const guildIds = (process.env.GUILD_IDS || process.env.GUILD_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

await rest.put(
  Routes.applicationCommands(clientId),
  { body: commands }
);
console.log('Global slash commands registered. Allow up to 1 hour for propagation.');

for (const guildId of guildIds) {
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
  );
  console.log(`Guild override registered for ${guildId}.`);
}

if (guildIds.length) {
  console.log('Guild overrides deploy instantly; global commands cover every other server.');
}
// Script: Register guild slash commands via Discord REST API
