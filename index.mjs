import { Client, GatewayIntentBits, Events, PermissionFlagsBits } from 'discord.js';
import { slotSessions, buildSlotsPaytableEmbed as buildSlotsPaytableEmbedMod, runSlotsSpin as runSlotsSpinMod, SLOTS_LINES as SLOTS_LINESMod } from './games/slots.mjs';
import { rouletteSessions, rouletteSummaryEmbed as rouletteSummaryEmbedMod, rouletteTypeSelectRow as rouletteTypeSelectRowMod, startRouletteSession as startRouletteSessionMod, spinRoulette as spinRouletteMod, rouletteWins as rouletteWinsMod, roulettePayoutMult as roulettePayoutMultMod } from './games/roulette.mjs';
import { ridebusGames, startRideBus as startRideBusMod, wagerAt as wagerAtMod } from './games/ridebus.mjs';
import { embedForState as embedForStateMod, rowButtons as rowButtonsMod, playAgainRow as playAgainRowMod, cardList as cardListMod } from './games/ridebus.mjs';
import { show as showCard, color as colorCard, val as valCard } from './games/cards.mjs';
import { bjEmbed as bjEmbedMod, bjPlayAgainRow as bjPlayAgainRowMod, startBlackjack as startBlackjackMod } from './games/blackjack.mjs';
import { blackjackGames } from './games/blackjack.mjs';
import 'dotenv/config';
import {
  getUserBalances,
  transferFromHouseToUser,
  getHouseBalance,
  getModRoles,
  takeFromUserToHouse,
  burnCredits
} from './db.auto.mjs';
import { formatChips, chipsAmount } from './games/format.mjs';
import {
  activeSessions,
  getActiveSession,
  setActiveSession,
  touchActiveSession,
  addHouseNet,
  recordSessionGame,
  sendGameMessage,
  buildPlayerBalanceField,
  clearActiveSession,
  hasActiveExpired,
  keyFor,
  burnUpToCredits,
  endActiveSessionForUser,
  buildTimeoutField
} from './games/session.mjs';
import { postGameSessionEnd as postGameSessionEndMod, sweepExpiredSessions as sweepExpiredSessionsMod, postCashLog as postCashLogMod } from './games/logging.mjs';
import { getGuildSettings, listEscrowForTable, escrowReturn } from './db.auto.mjs';
import { holdemTables } from './games/holdem.mjs';
import { bjHandValue as bjHandValueMod, cardValueForSplit as cardValueForSplitMod, canAffordExtra as canAffordExtraMod } from './games/blackjack.mjs';

// Slash command handlers (modularized)
import cmdPing from './commands/ping.mjs';
import cmdBalance from './commands/balance.mjs';
import cmdHouseBalance from './commands/housebalance.mjs';
import cmdHouseAdd from './commands/houseadd.mjs';
import cmdGiveChips from './commands/givechips.mjs';
import cmdHouseRemove from './commands/houseremove.mjs';
import cmdBuyIn from './commands/buyin.mjs';
import cmdTakeChips from './commands/takechips.mjs';
import cmdCashOut from './commands/cashout.mjs';
import cmdLeaderboard from './commands/leaderboard.mjs';
import cmdGiveCredits from './commands/givecredits.mjs';
import cmdTakeCredits from './commands/takecredits.mjs';
import cmdSetGameLogChannel from './commands/setgamelogchannel.mjs';
import cmdSetCashLog from './commands/setcashlog.mjs';
import cmdSetRequestChannel from './commands/setrequestchannel.mjs';
import cmdRequestTimer from './commands/requesttimer.mjs';
import cmdRequest from './commands/request.mjs';
import cmdHelp from './commands/help.mjs';
import cmdAddModRole from './commands/addmodrole.mjs';
import cmdRemoveAdminRole from './commands/removemodrole.mjs';
import cmdRideBus from './commands/ridebus.mjs';
import cmdBlackjack from './commands/blackjack.mjs';
import cmdSlots from './commands/slots.mjs';
import cmdRoulette from './commands/roulette.mjs';
import cmdHoldem from './commands/holdem.mjs';
import cmdDiceWar from './commands/dicewar.mjs';
import cmdSetRake from './commands/setrake.mjs';
import cmdSetMaxBet from './commands/setmaxbet.mjs';
import cmdResetAllBalance from './commands/resetallbalance.mjs';
import cmdSetCasinoCategory from './commands/setcasinocategory.mjs';

// Interaction handlers
import onHelpSelect from './interactions/helpSelect.mjs';
import onRequestButtons from './interactions/requestButtons.mjs';
import onRequestRejectModal from './interactions/requestRejectModal.mjs';

const ADMIN_ROLE_IDS = (process.env.ADMIN_ROLE_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Preferred: MOD_ROLE_IDS; fallback to ADMIN_ROLE_IDS for backward compatibility
const MOD_ROLE_IDS = (process.env.MOD_ROLE_IDS || process.env.ADMIN_ROLE_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const OWNER_USER_IDS = (process.env.OWNER_USER_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);


// Session tracking (in-memory per bot runtime)
// NOTE: We surface current session stats from activeSessions (below).
const sessionStats = new Map(); // key: `${guildId}:${userId}` -> { games: number, net: number }

function sessionKey(guildId, userId) { return `${guildId}:${userId}`; }
function getSessionStats(guildId, userId) {
  const k = sessionKey(guildId, userId);
  if (!sessionStats.has(k)) sessionStats.set(k, { games: 0, net: 0 });
  return sessionStats.get(k);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// Moderator gate: treat configured roles and mod-like Discord perms as moderators.
function collectRoleIds(member) {
  const ids = new Set();
  if (!member) return ids;
  const roles = member.roles;
  if (roles?.cache) {
    for (const [id] of roles.cache) ids.add(id);
  } else if (Array.isArray(roles)) {
    for (const id of roles) ids.add(id);
  }
  return ids;
}

async function isAdmin(interaction) {
  try {
    const guild = interaction.guild;
    if (!guild) return false;

    const userId = interaction.user?.id;
    if (userId && guild.ownerId && userId === guild.ownerId) return true;

    const perms = interaction.memberPermissions ?? interaction.member?.permissions;
    if (perms) {
      try {
        if (
          perms.has(PermissionFlagsBits.Administrator) ||
          perms.has(PermissionFlagsBits.ManageGuild) ||
          perms.has(PermissionFlagsBits.ManageRoles) ||
          perms.has(PermissionFlagsBits.ManageChannels) ||
          perms.has(PermissionFlagsBits.ModerateMembers) ||
          perms.has(PermissionFlagsBits.KickMembers) ||
          perms.has(PermissionFlagsBits.BanMembers) ||
          perms.has(PermissionFlagsBits.ManageMessages)
        ) {
          return true;
        }
      } catch {}
    }

    let member = interaction.member;
    if (!member?.roles?.cache && !Array.isArray(member?.roles) && userId) {
      member = await guild.members.fetch(userId).catch(() => null);
    }

    const roleIds = collectRoleIds(member);

    if (MOD_ROLE_IDS.length && MOD_ROLE_IDS.some(id => roleIds.has(id))) {
      return true;
    }

    const dbRoles = await getModRoles(guild.id);
    if (dbRoles.length && dbRoles.some(id => roleIds.has(id))) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function isOwnerRole(interaction) {
  try {
    const guild = interaction.guild;
    if (!guild) return false;
    const userId = interaction.user?.id;
    if (userId && guild.ownerId && userId === guild.ownerId) return true;
    if (OWNER_USER_IDS.length && userId && OWNER_USER_IDS.includes(userId)) return true;

    let member = interaction.member;
    if (!member?.roles?.cache && !Array.isArray(member?.roles) && userId) {
      member = await guild.members.fetch(userId).catch(() => null);
    }

    if (!member) return false;

    if (member.roles?.cache) {
      for (const role of member.roles.cache.values()) {
        if (role?.name && role.name.toLowerCase() === 'owner') return true;
      }
      return false;
    }

    if (Array.isArray(member.roles)) {
      const guildRoles = guild.roles?.cache;
      if (!guildRoles) return false;
      for (const roleId of member.roles) {
        const role = guildRoles.get(roleId);
        if (role?.name && role.name.toLowerCase() === 'owner') return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

client.once(Events.ClientReady, c => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
  // Periodically sweep inactive game sessions and finalize them
  setInterval(() => { sweepExpiredSessionsMod(client).catch(() => {}); }, 15 * 1000);
  // On startup, sweep orphan Hold'em table channels under the casino category
  (async () => {
    try {
      for (const [guildId] of client.guilds.cache) {
        const settings = await getGuildSettings(guildId);
        const catId = settings?.casino_category_id;
        if (!catId) continue;
        const guild = await client.guilds.fetch(guildId).catch(()=>null);
        if (!guild) continue;
        const channels = await guild.channels.fetch().catch(()=>null);
        if (!channels) continue;
        const activeIds = new Set(Array.from(holdemTables.values()).map(st => st.channelId));
        for (const ch of channels.values()) {
          if (!ch || !ch.isTextBased?.() || ch.parentId !== catId) continue;
          if (!/^holdem-table-\d+$/.test(ch.name)) continue;
          if (activeIds.has(ch.id)) continue; // tracked table, skip
          try {
            const escrows = await listEscrowForTable(ch.id) || [];
            for (const row of escrows) {
              try { if ((row.balance||0) > 0) await escrowReturn(ch.id, row.user_id, row.balance||0); } catch {}
            }
          } catch {}
          try { if (ch.deletable) await ch.delete('Cleanup orphan Hold’em table'); } catch {}
        }
      }
    } catch {}
  })();
});

// Command registry and context for modular handlers
function buildCommandContext(interaction) {
  const guildId = interaction?.guild?.id || null;
  return {
    isAdmin,
    isOwnerRole,
    chipsAmount,
    formatChips,
    postCashLog: postCashLogMod,
    // DB helpers
    getUserBalances: (userId) => getUserBalances(guildId, userId),
    burnCredits: (userId, amount, reason, adminId) => burnCredits(guildId, userId, amount, reason, adminId),
    getHouseBalance: () => getHouseBalance(guildId),
    transferFromHouseToUser: (userId, amount, reason, adminId) => transferFromHouseToUser(guildId, userId, amount, reason, adminId),
    takeFromUserToHouse: (userId, amount, reason, adminId) => takeFromUserToHouse(guildId, userId, amount, reason, adminId),
    // Session helpers and state
    keyFor,
    getActiveSession,
    setActiveSession,
    touchActiveSession,
    hasActiveExpired,
    clearActiveSession,
    activeSessions,
    // Game state maps
    ridebusGames,
    blackjackGames,
    rouletteSessions,
    slotSessions,
    // Message helpers
    sendGameMessage,
    // Shared UI builders
    rowButtons: rowButtonsMod,
    embedForState: embedForStateMod,
    playAgainRow: playAgainRowMod,
    buildPlayerBalanceField,
    buildTimeoutField,
    bjEmbed: bjEmbedMod,
    bjPlayAgainRow: bjPlayAgainRowMod,
    bjHandValue: bjHandValueMod,
    cardValueForSplit: cardValueForSplitMod,
    canAffordExtra: (userId, amount) => canAffordExtraMod(guildId, userId, amount),
    rouletteSummaryEmbed: rouletteSummaryEmbedMod,
    rouletteTypeSelectRow: rouletteTypeSelectRowMod,
    buildSlotsPaytableEmbed: buildSlotsPaytableEmbedMod,
    // Game engines/helpers
    wagerAt: wagerAtMod,
    show: showCard,
    cardList: cardListMod,
    color: colorCard,
    val: valCard,
    spinRoulette: spinRouletteMod,
    rouletteWins: rouletteWinsMod,
    roulettePayoutMult: roulettePayoutMultMod,
    SLOTS_LINES: SLOTS_LINESMod,
    // Logging
    postGameSessionEnd: postGameSessionEndMod,
    addHouseNet,
    recordSessionGame,
    burnUpToCredits: (userId, stake, reason) => burnUpToCredits(guildId, userId, stake, reason),
    endActiveSessionForUser,
    startRideBus: (interaction, bet) => startRideBusMod(interaction, bet),
    startBlackjack: (interaction, table, bet) => startBlackjackMod(interaction, table, bet),
    runSlotsSpin: (interaction, bet, key) => runSlotsSpinMod(interaction, bet, key),
    startRouletteSession: async (interaction) => startRouletteSessionMod(interaction),
    MOD_ROLE_IDS,
    guildId
  };
}

const commandHandlers = {
  ping: cmdPing,
  balance: cmdBalance,
  housebalance: cmdHouseBalance,
  houseadd: cmdHouseAdd,
  givechips: cmdGiveChips,
  houseremove: cmdHouseRemove,
  buyin: cmdBuyIn,
  takechips: cmdTakeChips,
  cashout: cmdCashOut,
  leaderboard: cmdLeaderboard,
  givecredits: cmdGiveCredits,
  takecredits: cmdTakeCredits,
  setgamelogchannel: cmdSetGameLogChannel,
  setcashlog: cmdSetCashLog,
  setrequestchannel: cmdSetRequestChannel,
  requesttimer: cmdRequestTimer,
  request: cmdRequest,
  help: cmdHelp,
  addmodrole: cmdAddModRole,
  removemodrole: cmdRemoveAdminRole,
  ridebus: cmdRideBus,
  blackjack: cmdBlackjack,
  slots: cmdSlots,
  roulette: cmdRoulette,
  holdem: cmdHoldem,
  dicewar: cmdDiceWar,
  setrake: cmdSetRake,
  setmaxbet: cmdSetMaxBet,
  resetallbalance: cmdResetAllBalance,
  setcasinocategory: cmdSetCasinoCategory
};

client.on(Events.InteractionCreate, async interaction => {
  try {
    // ========== SLASH COMMANDS ==========
      if (interaction.isChatInputCommand()) {
      // End any existing active game session when a new command is run
      await endActiveSessionForUser(interaction, 'new_command');

      // Modular command dispatch
      const handler = commandHandlers[interaction.commandName];
      if (typeof handler === 'function') {
        const ctx = buildCommandContext(interaction);
        return handler(interaction, ctx);
      }
      // Fallback if no handler registered
      return interaction.reply({ content: '❌ Unknown command.', ephemeral: true });

      }
    // ========== BUTTONS ==========
    else if (interaction.isButton() && interaction.customId.startsWith('rb|')) {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/ridebusButtons.mjs');
      return mod.default(interaction, ctx);
    }
    // Blackjack buttons
    else if (interaction.isButton() && interaction.customId.startsWith('bj|')) {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/blackjackButtons.mjs');
      return mod.default(interaction, ctx);
    }
    // Slots buttons
    else if (interaction.isButton() && interaction.customId.startsWith('slots|')) {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/slotsButtons.mjs');
      return mod.default(interaction, ctx);
    }
    // Dice War buttons
    else if (interaction.isButton() && interaction.customId.startsWith('dice|')) {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/diceWarButtons.mjs');
      return mod.default(interaction, ctx);
    }
    // Roulette buttons
    else if (interaction.isButton() && interaction.customId.startsWith('rou|')) {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/rouletteButtons.mjs');
      return mod.default(interaction, ctx);
    }

    // Hold'em buttons
    else if (interaction.isButton() && interaction.customId.startsWith('hold|')) {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/holdemButtons.mjs');
      return mod.default(interaction, ctx);
    }

    // Request buttons
    else if (interaction.isButton() && interaction.customId.startsWith('req|')) {
      const ctx = buildCommandContext(interaction);
      return onRequestButtons(interaction, ctx);
    }

    // Roulette select menus
    else if (interaction.isStringSelectMenu() && interaction.customId === 'rou|type') {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/rouletteTypeSelect.mjs');
      return mod.default(interaction, ctx);
    }

    // Help select menu
    else if (interaction.isStringSelectMenu() && interaction.customId === 'help|section') {
      const ctx = buildCommandContext(interaction);
      return onHelpSelect(interaction, ctx);
    }

    // Request reject modal submits
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('req|rejmodal|')) {
      if (!(await isAdmin(interaction))) return interaction.reply({ content: '❌ Moderators only.', ephemeral: true });
      return onRequestRejectModal(interaction);
    }

    // Roulette modal submits
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('rou|modal|')) {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/rouletteModal.mjs');
      return mod.default(interaction, ctx);
    }

    // Hold'em bet modal submits
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('hold|bet|')) {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/holdemBetModal.mjs');
      return mod.default(interaction, ctx);
    }
    // Hold'em join modal submits
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('hold|join|')) {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/holdemJoinModal.mjs');
      return mod.default(interaction, ctx);
    }
    // Hold'em custom table modal submits
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('hold|custom|')) {
      const ctx = buildCommandContext(interaction);
      const mod = await import('./interactions/holdemCustomModal.mjs');
      return mod.default(interaction, ctx);
    }

    // ignore other interaction types
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: '❌ Unexpected error.', ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ Unexpected error.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
// Bot Entrypoint — registers handlers, builds context, sweeps sessions, and logs in.
