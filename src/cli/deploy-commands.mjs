import { REST, Routes, PermissionFlagsBits } from 'discord.js';
import 'dotenv/config';
import { listJobs } from '../jobs/registry.mjs';

const ADMIN_PERMS = String(PermissionFlagsBits.Administrator);

const jobChoices = listJobs().map(job => ({ name: job.displayName, value: job.id }));

const commands = [
  { name: 'ping', description: 'Replies with Pong!' },
  { name: 'status', description: 'Show the bot version, gateway status, and global reach.' },
  {
    name: 'balance',
    description: 'Check your chip & credit balance (moderators can check others).',
    options: [
      { name: 'user', description: 'User to check (admin only)', type: 6, required: false }
    ]
  },
  {
    name: 'beg',
    description: 'Beg the narrator for a handful of chips.'
  },
  {
    name: 'debugvote',
    description: 'Simulate a Top.gg vote for a player (admin only).',
    options: [
      { name: 'player', description: 'Player to simulate a vote for', type: 6, required: true }
    ]
  },
  {
    name: 'debugdspin',
    description: 'Reset a player\'s daily spin cooldown (admin only).',
    options: [
      { name: 'player', description: 'Player to reset daily spin cooldown for', type: 6, required: true }
    ]
  },
  {
    name: 'job',
    description: 'Clock in for casino shifts, manage stamina, and oversee your role.',
    options: [
      {
        name: 'action',
        description: 'Choose a job system action (leave blank for status).',
        type: 3,
        required: false,
        choices: [
          { name: 'Start Shift', value: 'start' },
          { name: 'Cancel Active Shift', value: 'cancel' },
          { name: 'Inspect Player', value: 'stats' },
          { name: 'Reset Stamina (Admin)', value: 'reset' },
          { name: 'Reset Stats (Admin)', value: 'resetstats' },
          { name: 'Show Status', value: 'status' }
        ]
      },
      {
        name: 'job',
        description: 'Job to start when running a shift.',
        type: 3,
        required: false,
        choices: jobChoices
      },
      {
        name: 'user',
        description: 'Target user for inspect/reset actions.',
        type: 6,
        required: false
      }
    ]
  },
  {
    name: 'cartel',
    description: 'Show your cartel overview and navigate via buttons.'
  },
  {
    name: 'cartelreset',
    description: 'Reset a player\'s cartel holdings to zero (admin only).',
    options: [
      { name: 'user', description: 'Player to reset', type: 6, required: true }
    ]
  },
  {
    name: 'cartelraiddebug',
    description: 'Force a successful cartel raid against a player (admin only).',
    options: [
      { name: 'user', description: 'Target player', type: 6, required: true },
      {
        name: 'action',
        description: 'Raid scope action type',
        type: 3,
        required: false,
        choices: [
          { name: 'Collect', value: 'collect' },
          { name: 'Burn', value: 'burn' },
          { name: 'Export', value: 'export' }
        ]
      },
      {
        name: 'collected_grams',
        description: 'Collected Semuta grams to include in scope for collect action',
        type: 10,
        required: false,
        min_value: 0
      }
    ]
  },
  {
    name: 'cartelwarehousedebug',
    description: 'Add Semuta directly to your own warehouse for debugging (admin only).',
    options: [
      {
        name: 'grams',
        description: 'Semuta grams to add to your warehouse',
        type: 10,
        required: true,
        min_value: 0.01
      }
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
    name: 'horserace',
    description: 'Bet on a 5-horse race with staged progress.',
    options: []
  },
  {
    name: 'holdem',
    description: 'Texas Hold’em: create a table with presets.',
    options: []
  },
  {
    name: 'request',
    description: 'Request a buy-in, cash-out, or data erasure from admins.',
    options: [
      { name: 'type', description: 'Request type', type: 3, required: true, choices: [
        { name: 'Buy In', value: 'buyin' },
        { name: 'Cash Out', value: 'cashout' },
        { name: 'Erase Account Data', value: 'erase' }
      ]},
      { name: 'amount', description: 'Amount of chips (required for buy-in/cash-out)', type: 4, required: false, min_value: 1 },
      { name: 'notes', description: 'Context for staff (required for erase requests)', type: 3, required: false }
    ]
  },
  {
    name: 'givechip',
    description: 'Send chips from your balance to another user.',
    options: [
      { name: 'user', description: 'Recipient', type: 6, required: true },
      { name: 'amount', description: 'Amount of chips to send', type: 4, required: true, min_value: 1 }
    ]
  },
  {
    name: 'roulette',
    description: 'Play American Roulette (interactive betting).',
    options: []
  },
  {
    name: '8ball',
    description: 'Only the #1 High Roller can ask the 8-ball for guidance.',
    options: [
      { name: 'question', description: 'Ask your question (must end with a ?)', type: 3, required: true }
    ]
  },
  {
    name: 'setrequestchannel',
    description: 'Set the channel where requests will be posted (admin only).',
    options: [
      { name: 'channel', description: 'Select a text channel', type: 7, channel_types: [0,5,10,11,12], required: true }
    ]
  },
  {
    name: 'setupdatech',
    description: 'Set the channel for bot update announcements (admin only).',
    options: [
      { name: 'channel', description: 'Select a text channel', type: 7, channel_types: [0,5,10,11,12], required: true }
    ]
  },
  {
    name: 'setautoban',
    description: 'Set a channel where non-admin user messages trigger permanent bans (admin only).',
    default_member_permissions: ADMIN_PERMS,
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
          { name: 'High (min 1000, H17)', value: 'HIGH' },
          { name: 'Low (max 999, S17)', value: 'LOW' }
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
    name: 'setcartelshare',
    description: 'Set the cartel share price (admin only).',
    options: [
      { name: 'price', description: 'Share price in chips', type: 4, required: true, min_value: 1 }
    ]
  },
  {
    name: 'setcartelrate',
    description: 'Set the Semuta share production rate (grams of Semuta per share per hour, admin only).',
    options: [
      { name: 'grams', description: 'Grams of Semuta per share per hour', type: 10, required: true, min_value: 0.001 }
    ]
  },
  {
    name: 'setcartelxp',
    description: 'Set the cartel XP awarded per gram of Semuta sold (admin only).',
    options: [
      { name: 'xp', description: 'XP per gram of Semuta sold', type: 10, required: true, min_value: 0 }
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
    name: 'mintchip',
    description: 'Mint chips from the house to a user (moderator only).',
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
    name: 'kittenmode',
    description: 'Toggle the Kitten personality for this server (admin only).',
    default_member_permissions: ADMIN_PERMS,
    options: [
      {
        name: 'enabled',
        description: 'Enable the Kitten persona (true) or disable it (false).',
        type: 5,
        required: true
      }
    ]
  },
  {
    name: 'news',
    description: 'Review casino news and toggle personal alerts.',
    options: [
      {
        name: 'enabled',
        description: 'Turn news alerts on (true) or off (false).',
        type: 5,
        required: false
      }
    ]
  },
  {
    name: 'addmod',
    description: 'Add a user as casino moderator (admin only).',
    options: [
      {
        type: 6,
        name: 'user',
        description: 'The user to grant moderator access',
        required: true
      }
    ]
  },
  {
    name: 'removemod',
    description: 'Remove a user from casino moderator (admin only).',
    options: [
      {
        type: 6,
        name: 'user',
        description: 'The user to revoke moderator access',
        required: true
      }
    ]
  },
  {
    name: 'addadmin',
    description: 'Add a user as casino admin (admin only).',
    options: [
      {
        type: 6,
        name: 'user',
        description: 'The user to grant admin access',
        required: true
      }
    ]
  },
  {
    name: 'removeadmin',
    description: 'Remove a user from casino admin (admin only).',
    options: [
      {
        type: 6,
        name: 'user',
        description: 'The user to revoke admin access',
        required: true
      }
    ]
  },
  {
    name: 'stafflist',
    description: 'List current casino admins and moderators.',
    options: []
  },
  {
    name: 'dailyspin',
    description: 'Spin the reward wheel for a daily chip bonus.',
    options: []
  },
  {
    name: 'vote',
    description: 'Show vote links and claim chip rewards.',
    options: []
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

await rest.put(
  Routes.applicationCommands(clientId),
  { body: commands }
);
console.log('Global slash commands registered. Allow up to 1 hour for propagation.');

const guildIdsToClear = (process.env.CLEAR_GUILD_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

for (const guildId of guildIdsToClear) {
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: [] }
  );
  console.log(`Cleared guild command overrides for ${guildId}.`);
}
// Script: Register global slash commands via Discord REST API
