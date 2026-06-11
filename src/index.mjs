import { Client, GatewayIntentBits, Events, EmbedBuilder, MessageFlags, AuditLogEvent, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
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
  mintChips,
  getHouseBalance,
  getModerators,
  getAdmins,
  takeFromUserToHouse,
  burnCredits,
  getUserOnboardingStatus,
  grantUserOnboardingBonus,
  markUserOnboardingAcknowledged,
  recordUserInteraction,
  markUserInteractionReviewPrompt,
  pruneUserInteractionEvents,
  getGlobalPlayerCount,
  setBotStatusSnapshot,
  touchUserActivityLifecycle,
  reactivateUserWithComebackBonus,
  markVoteRewardDmStatus,
  getUserNewsSettings,
  markUserNewsDelivered
} from './db/db.auto.mjs';
import { formatChips, chipsAmount } from './games/format.mjs';
import {
  autoRedeemPendingVoteRewards,
  describeBreakdown
} from './services/votes.mjs';
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
import { getGuildSettings, listEscrowForTable, escrowReturn } from './db/db.auto.mjs';
import { holdemTables } from './games/holdem.mjs';
import { bjHandValue as bjHandValueMod, cardValueForSplit as cardValueForSplitMod, canAffordExtra as canAffordExtraMod } from './games/blackjack.mjs';
import { kittenizeTextContent, kittenizeReplyArg } from './services/persona.mjs';
import { BOT_VERSION, pushUpdateAnnouncement } from './services/updates.mjs';
import { getActiveNews, newsDigest } from './services/news.mjs';
import { startLeaderboardChampionWatcher, claimChampionNotice } from './services/championRole.mjs';
import { startInactivitySweep } from './services/inactivity.mjs';
import { emoji } from './lib/emojis.mjs';
import { startCartelWorker as startCartelWorkerMod } from './cartel/service.mjs';
import { startDiscordForgeStatsPoster } from './services/discordforge.mjs';
import { startTopggStatsPoster } from './services/topgg.mjs';

// Slash command handlers (modularized)
import cmdPing from './commands/ping.mjs';
import cmdStatus from './commands/status.mjs';
import cmdBalance from './commands/balance.mjs';
import cmdGiveChip from './commands/givechip.mjs';
import cmdJob from './commands/job.mjs';
import cmdHouseBalance from './commands/housebalance.mjs';
import cmdHouseAdd from './commands/houseadd.mjs';
import cmdMintChip from './commands/mintchip.mjs';
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
import cmdSetUpdateChannel from './commands/setupdatech.mjs';
import cmdSetAutoBan from './commands/setautoban.mjs';
import cmdRequestTimer from './commands/requesttimer.mjs';
import cmdRequest from './commands/request.mjs';
import cmdHelp from './commands/help.mjs';
import cmdAddMod from './commands/addmod.mjs';
import cmdRemoveMod from './commands/removemod.mjs';
import cmdAddAdmin from './commands/addadmin.mjs';
import cmdRemoveAdmin from './commands/removeadmin.mjs';
import cmdStaffList from './commands/stafflist.mjs';
import cmdDailySpin from './commands/dailyspin.mjs';
import cmdRideBus from './commands/ridebus.mjs';
import cmdBlackjack from './commands/blackjack.mjs';
import cmdSlots from './commands/slots.mjs';
import cmdRoulette from './commands/roulette.mjs';
import cmdHoldem from './commands/holdem.mjs';
import cmdDiceWar from './commands/dicewar.mjs';
import cmdHorseRace from './commands/horserace.mjs';
import cmdSetRake from './commands/setrake.mjs';
import cmdSetMaxBet from './commands/setmaxbet.mjs';
import cmdResetAllBalance from './commands/resetallbalance.mjs';
import cmdSetCasinoCategory from './commands/setcasinocategory.mjs';
import cmdKittenMode from './commands/kittenmode.mjs';
import cmdVote from './commands/vote.mjs';
import cmdNews from './commands/news.mjs';
import cmdBeg from './commands/beg.mjs';
import cmdEightBall from './commands/eightball.mjs';
import cmdDebugVote from './commands/debugvote.mjs';
import cmdDebugDspin from './commands/debugdspin.mjs';
import cmdCartel, {
  handleCartelOverviewRefresh,
  handleCartelRankTable,
  handleCartelGuide,
  handleCartelWarehouseView,
  handleCartelWarehouseBurnPrompt,
  handleCartelWarehouseBurnConfirm,
  handleCartelWarehouseBurnCancel,
  handleCartelWarehouseBurnModal,
  handleCartelWarehouseExport,
  handleCartelWarehouseExportModal,
  handleCartelSharesView,
  handleCartelDealersView,
  handleCartelDealerHireTier,
  handleCartelDealerUpkeep,
  handleCartelDealerManageSelect,
  handleCartelDealerManageAction,
  handleCartelDealerPause,
  handleCartelDealerPauseAll,
  handleCartelDealerFire,
  handleCartelDealerFireAll,
  handleCartelDealerUpkeepModal,
  handleCartelShareOrderPrompt,
  handleCartelShareOrderModal,
  handleCartelShareOrderSelect,
  handleCartelShareOrderCancel,
  handleCartelMarketSelect,
  handleCartelMarketConfirm,
  handleCartelMarketModal,
  handleCartelSellPrompt,
  handleCartelSellModal,
  handleCartelSellMiniGameMove,
  handleCartelCollectPrompt,
  handleCartelCollectModal,
  handleCartelDealerCollect
} from './commands/cartel.mjs';
import cmdSetCartelShare from './commands/setcartelshare.mjs';
import cmdCartelReset from './commands/cartelreset.mjs';
import cmdCartelRaidDebug from './commands/cartelraiddebug.mjs';
import cmdCartelWarehouseDebug from './commands/cartelwarehousedebug.mjs';
import cmdSetCartelRate from './commands/setcartelrate.mjs';
import cmdSetCartelXp from './commands/setcartelxp.mjs';

// Interaction handlers
import onHelpSelect from './interactions/helpSelect.mjs';
import onHelpPageButtons from './interactions/helpPageButtons.mjs';
import onRequestButtons from './interactions/requestButtons.mjs';
import onRequestRejectModal from './interactions/requestRejectModal.mjs';
import onJobStatusButtons from './interactions/jobs/statusButtons.mjs';
import onJobShiftButtons from './interactions/jobs/shiftButtons.mjs';
import onRideBusButtons from './interactions/ridebusButtons.mjs';
import onBlackjackButtons from './interactions/blackjackButtons.mjs';
import onSlotsButtons from './interactions/slotsButtons.mjs';
import onDiceWarButtons from './interactions/diceWarButtons.mjs';
import onRouletteButtons from './interactions/rouletteButtons.mjs';
import onHorseRaceButtons from './interactions/horseRaceButtons.mjs';
import onHoldemButtons from './interactions/holdemButtons.mjs';
import onLeaderboardButtons from './interactions/leaderboardButtons.mjs';
import onDailySpinButtons from './interactions/dailyspinButtons.mjs';
import onRouletteTypeSelect from './interactions/rouletteTypeSelect.mjs';
import onBlackjackBetModal from './interactions/blackjackBetModal.mjs';
import onRouletteModal from './interactions/rouletteModal.mjs';
import onHoldemBetModal from './interactions/holdemBetModal.mjs';
import onHoldemJoinModal from './interactions/holdemJoinModal.mjs';
import onHoldemCustomModal from './interactions/holdemCustomModal.mjs';
import onHorseRaceBetModal from './interactions/horseRaceBetModal.mjs';

const OWNER_USER_IDS = Array.from(new Set([
  '94915805375889408',
  ...(process.env.OWNER_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
]));

const WELCOME_BONUS_AMOUNT = 200;
const WELCOME_ACK_CUSTOM_ID = 'welcome|ack';

const REVIEW_PROMPT_INTERACTION_THRESHOLD = 100;
const REVIEW_PROMPT_RETRY_SECONDS = 7 * 24 * 60 * 60;
const REVIEW_PROMPT_MESSAGE = [
  '🎉 You just hit 100 interactions with Semuta Casino Bot!',
  '',
  'Did you have fun with the app? If so, please write a review on Top.gg to help others discover the casino.',
  "If you're enjoying Semuta Casino Bot, please consider leaving a review on Top.gg!",
  'https://top.gg/bot/1415454565687492780#reviews'
].join('\n');
const REVIEW_PROMPT_SUPPORT_MESSAGE = [
  '🏠 Our support team and main game floor live in the Semuta hub.',
  'Join us anytime: discord.gg/semutaofdune'
].join('\n');

const NEWS_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;
const GUILD_SETTINGS_TTL_MS = Math.max(5_000, Number(process.env.GUILD_SETTINGS_CACHE_TTL_MS || 45_000));
const ACCESS_LIST_TTL_MS = Math.max(5_000, Number(process.env.ACCESS_LIST_CACHE_TTL_MS || 30_000));
const ACTIVE_NEWS_TTL_MS = Math.max(10_000, Number(process.env.ACTIVE_NEWS_CACHE_TTL_MS || 120_000));
const INTERACTION_EVENT_RETENTION_DAYS = Math.max(7, Number(process.env.INTERACTION_EVENT_RETENTION_DAYS || 90));
const INTERACTION_EVENT_PRUNE_BATCH_SIZE = Math.max(100, Number(process.env.INTERACTION_EVENT_PRUNE_BATCH_SIZE || 10_000));
const INTERACTION_EVENT_PRUNE_INTERVAL_MS = Math.max(60_000, Number(process.env.INTERACTION_EVENT_PRUNE_INTERVAL_MS || 15 * 60_000));
const ONBOARDING_ACK_CACHE_MAX = Math.max(1_000, Number(process.env.ONBOARDING_ACK_CACHE_MAX || 100_000));
const GUILD_SETTINGS_CACHE_MAX = Math.max(100, Number(process.env.GUILD_SETTINGS_CACHE_MAX || 5_000));
const ACCESS_LIST_CACHE_MAX = Math.max(100, Number(process.env.ACCESS_LIST_CACHE_MAX || 5_000));
const USER_NEWS_STATE_MAX = Math.max(500, Number(process.env.USER_NEWS_STATE_MAX || 100_000));
const VOTE_REWARD_DM_CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.VOTE_REWARD_DM_CONCURRENCY || 3)));
const HOLDEM_ORPHAN_SWEEP_START_DELAY_MS = Math.max(1_000, Number(process.env.HOLDEM_ORPHAN_SWEEP_START_DELAY_MS || 20_000));
const HOLDEM_ORPHAN_SWEEP_GUILD_BATCH_SIZE = Math.max(1, Math.min(10, Number(process.env.HOLDEM_ORPHAN_SWEEP_GUILD_BATCH_SIZE || 2)));
const HOLDEM_ORPHAN_SWEEP_BATCH_INTERVAL_MS = Math.max(100, Number(process.env.HOLDEM_ORPHAN_SWEEP_BATCH_INTERVAL_MS || 1_500));
function toMinInt(raw, fallback, min) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function toBool(raw, fallback = true) {
  if (raw == null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

const COMEBACK_BONUS_CHIPS = toMinInt(process.env.COMEBACK_BONUS_CHIPS, 10_000, 0);
const COMEBACK_BONUS_ENABLED = toBool(process.env.COMEBACK_BONUS_ENABLED, true);

const SETTINGS_MUTATION_COMMANDS = new Set([
  'setgamelogchannel',
  'setcashlog',
  'setrequestchannel',
  'setupdatech',
  'setautoban',
  'requesttimer',
  'setmaxbet',
  'setrake',
  'setcasinocategory',
  'kittenmode'
]);

const ACCESS_MUTATION_COMMANDS = new Set(['addmod', 'removemod', 'addadmin', 'removeadmin']);

let topggPoster = null;
let discordForgePoster = null;
const guildSettingsCache = new Map();
const accessListCache = new Map();
const onboardingAcknowledgedUsers = new Set();
const userNewsState = new Map();
let activeNewsCache = { value: null, digest: null, expiresAt: 0 };
let holdemOrphanSweepQueue = [];
let holdemOrphanSweepTimer = null;
let holdemOrphanSweepStarted = false;

function setTimedCache(map, key, value, ttlMs) {
  map.delete(key);
  map.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function enforceMapCapacity(map, maxSize) {
  const limit = Math.max(1, Number(maxSize) || 1);
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) break;
    map.delete(oldestKey);
  }
}

function getTimedCache(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    map.delete(key);
    return null;
  }
  // Touch hit so iteration order keeps least-recently-used entries first.
  map.delete(key);
  map.set(key, entry);
  return entry.value;
}

function accessCacheKey(guildId, roleType) {
  return `${guildId || 'global'}:${roleType}`;
}

async function getGuildSettingsCached(guildId) {
  if (!guildId) return null;
  const cached = getTimedCache(guildSettingsCache, guildId);
  if (cached) return cached;
  const settings = await getGuildSettings(guildId);
  setTimedCache(guildSettingsCache, guildId, settings, GUILD_SETTINGS_TTL_MS);
  enforceMapCapacity(guildSettingsCache, GUILD_SETTINGS_CACHE_MAX);
  return settings;
}

function invalidateGuildSettingsCache(guildId) {
  if (!guildId) return;
  guildSettingsCache.delete(guildId);
}

function invalidateAccessCache(guildId) {
  accessListCache.delete(accessCacheKey(guildId, 'admins'));
  accessListCache.delete(accessCacheKey(guildId, 'moderators'));
}

async function getAccessListCached(guildId, roleType, loader) {
  const key = accessCacheKey(guildId, roleType);
  const cached = getTimedCache(accessListCache, key);
  if (cached) return cached;
  const ids = await loader(guildId);
  const normalized = Array.from(new Set((ids || []).map(id => String(id))));
  setTimedCache(accessListCache, key, normalized, ACCESS_LIST_TTL_MS);
  enforceMapCapacity(accessListCache, ACCESS_LIST_CACHE_MAX);
  return normalized;
}

async function getActiveNewsCached() {
  if (Date.now() < activeNewsCache.expiresAt) {
    return activeNewsCache.value;
  }
  const active = await getActiveNews();
  activeNewsCache = {
    value: active,
    digest: newsDigest(active) || null,
    expiresAt: Date.now() + ACTIVE_NEWS_TTL_MS
  };
  return active;
}

function onboardingCacheKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function rememberOnboardingAcknowledged(guildId, userId) {
  const key = onboardingCacheKey(guildId, userId);
  if (onboardingAcknowledgedUsers.size >= ONBOARDING_ACK_CACHE_MAX) {
    const oldest = onboardingAcknowledgedUsers.values().next().value;
    if (oldest) onboardingAcknowledgedUsers.delete(oldest);
  }
  onboardingAcknowledgedUsers.add(key);
}

function clearUserNewsState(userId) {
  if (!userId) return;
  userNewsState.delete(String(userId));
}

function getUserNewsState(userId) {
  const key = String(userId || '').trim();
  if (!key) return null;
  const entry = userNewsState.get(key);
  if (!entry) return null;
  userNewsState.delete(key);
  userNewsState.set(key, entry);
  return entry;
}

function setUserNewsState(userId, state) {
  const key = String(userId || '').trim();
  if (!key) return;
  userNewsState.delete(key);
  userNewsState.set(key, state);
  enforceMapCapacity(userNewsState, USER_NEWS_STATE_MAX);
}

function triggerTopggStats(reason = 'manual') {
  if (topggPoster?.trigger) {
    topggPoster.trigger(reason).catch(() => {});
  }
}

function triggerDiscordForgeStats(reason = 'manual') {
  if (discordForgePoster?.trigger) {
    discordForgePoster.trigger(reason).catch(() => {});
  }
}

function collectActiveHoldemChannelIds() {
  return new Set(Array.from(holdemTables.values()).map(state => state?.channelId).filter(Boolean));
}

async function sweepOrphanHoldemChannelsForGuild(client, guildId) {
  try {
    const settings = await getGuildSettingsCached(guildId);
    const catId = settings?.casino_category_id;
    if (!catId) return;
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) return;
    const activeIds = collectActiveHoldemChannelIds();
    for (const ch of channels.values()) {
      if (!ch || !ch.isTextBased?.() || ch.parentId !== catId) continue;
      if (!/^holdem-table-\d+$/.test(ch.name)) continue;
      if (activeIds.has(ch.id)) continue;
      try {
        const escrows = await listEscrowForTable(ch.id) || [];
        for (const row of escrows) {
          try {
            if ((row.balance || 0) > 0) await escrowReturn(ch.id, row.user_id, row.balance || 0);
          } catch {}
        }
      } catch {}
      try {
        if (ch.deletable) await ch.delete('Cleanup orphan Hold\'em table');
      } catch {}
    }
  } catch {}
}

function processHoldemOrphanSweepBatch(client) {
  if (!holdemOrphanSweepQueue.length) {
    if (holdemOrphanSweepTimer) clearTimeout(holdemOrphanSweepTimer);
    holdemOrphanSweepTimer = null;
    return;
  }
  const guildIds = holdemOrphanSweepQueue.splice(0, HOLDEM_ORPHAN_SWEEP_GUILD_BATCH_SIZE);
  Promise.all(guildIds.map(guildId => sweepOrphanHoldemChannelsForGuild(client, guildId)))
    .catch(() => {})
    .finally(() => {
      if (!holdemOrphanSweepQueue.length) {
        if (holdemOrphanSweepTimer) clearTimeout(holdemOrphanSweepTimer);
        holdemOrphanSweepTimer = null;
        return;
      }
      holdemOrphanSweepTimer = setTimeout(() => {
        processHoldemOrphanSweepBatch(client);
      }, HOLDEM_ORPHAN_SWEEP_BATCH_INTERVAL_MS);
      if (typeof holdemOrphanSweepTimer?.unref === 'function') holdemOrphanSweepTimer.unref();
    });
}

function scheduleStartupHoldemOrphanSweep(client) {
  if (holdemOrphanSweepStarted) return;
  holdemOrphanSweepStarted = true;
  holdemOrphanSweepQueue = Array.from(client.guilds.cache.keys());
  holdemOrphanSweepTimer = setTimeout(() => {
    processHoldemOrphanSweepBatch(client);
  }, HOLDEM_ORPHAN_SWEEP_START_DELAY_MS);
  if (typeof holdemOrphanSweepTimer?.unref === 'function') holdemOrphanSweepTimer.unref();
}

async function sendVoteRewardDm(client, entry) {
  const user = await client.users.fetch(entry.userId);
  const amount = chipsAmount(entry.claimedTotal || 0);
  const breakdownText = describeBreakdown(entry.breakdown || []);
  const sources = breakdownText || 'your recent votes';
  const message = `${emoji('partyPopper')} Thanks for voting (${sources})! I just credited **${amount}** to your chips.`;
  await user.send(message);
}

async function updateVoteRewardDmDeliveryStatus(entry, { sent, error = null } = {}) {
  const voteRewardIds = Array.isArray(entry?.claimedRewards)
    ? entry.claimedRewards
        .map(reward => Number(reward?.id))
        .filter(id => Number.isInteger(id) && id > 0)
    : [];
  if (!voteRewardIds.length) return;
  try {
    await markVoteRewardDmStatus(voteRewardIds, {
      sent,
      timestamp: Math.floor(Date.now() / 1000),
      error: error?.message || error || null,
    });
  } catch (statusErr) {
    console.error('Failed to persist vote reward DM delivery status', entry?.userId, statusErr);
  }
}

async function deliverVoteRewardDms(client, entries, concurrency = VOTE_REWARD_DM_CONCURRENCY) {
  const queue = Array.isArray(entries) ? entries : [];
  if (!queue.length) return;
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), queue.length);
  let cursor = 0;
  const nextEntry = () => {
    if (cursor >= queue.length) return null;
    const current = queue[cursor];
    cursor += 1;
    return current;
  };

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const entry = nextEntry();
      if (!entry) return;
      try {
        await sendVoteRewardDm(client, entry);
        await updateVoteRewardDmDeliveryStatus(entry, { sent: true });
      } catch (err) {
        await updateVoteRewardDmDeliveryStatus(entry, { sent: false, error: err });
        console.error('Failed to DM vote reward notice', entry.userId, err);
      }
    }
  });

  await Promise.all(workers);
}

function buildWelcomePromptEmbed({ status = null, bonusJustGranted = false, bonusError = null } = {}) {
  const chipsText = chipsAmount(WELCOME_BONUS_AMOUNT);
  const hasBonus = (status?.chipsGranted ?? 0) >= WELCOME_BONUS_AMOUNT;
  let statusLine;
  if (bonusError) {
    statusLine = `⚠️ I tried to add **${chipsText}** to your chips but hit a snag. Please ping a moderator so we can fix it right away.`;
  } else if (bonusJustGranted) {
    statusLine = `✅ I just added **${chipsText}** to your balance to get you started.`;
  } else if (hasBonus) {
    statusLine = `✅ You already have **${chipsText}** waiting in your pocket—nice!`;
  } else {
    statusLine = `✅ I’ll add **${chipsText}** as soon as this welcome message sticks.`;
  }
  return new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('Welcome to Casino Bot')
    .setDescription([
      'Casino Bot shares a single chip balance across every server, so what you earn here travels with you.',
      '',
      statusLine,
      '',
      'Here are two quick ways to dive in:'
    ].join('\n'))
    .addFields(
      {
        name: 'ℹ️ Quick Commands',
        value: 'Use `/help` for the full guide and `/balance` to check your chips any time.'
      },
      {
        name: '🎰 Casino Games',
        value: 'Spin `/slots`, challenge `/blackjack`, or bet big in `/roulette` for instant thrills.'
      },
      {
        name: '💼 Job System',
        value: 'Run `/job` to choose a career, clock shifts with your stamina, and build reliable income alongside your wagers.'
      }
    )
    .setFooter({ text: 'Hit Okay when you’re ready to jump in.' });
}

function buildWelcomePromptComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(WELCOME_ACK_CUSTOM_ID)
        .setLabel('Okay')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function buildWelcomeAcknowledgedEmbed({ status, alreadyClaimed }) {
  const chipsText = chipsAmount(WELCOME_BONUS_AMOUNT);
  const hasBonus = (status?.chipsGranted ?? 0) >= WELCOME_BONUS_AMOUNT;
  if (alreadyClaimed) {
    return new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Welcome back!')
      .setDescription('You already claimed the welcome bonus—good luck out there!');
  }
  if (hasBonus) {
    return new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('All set!')
      .setDescription(`You’re stocked with **${chipsText}** to start. Try \`/help\` for tips or \`/balance\` to see your chips any time.`);
  }
  return new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('Heads up!')
    .setDescription('I still owe you the welcome chips—let a moderator know so we can sort it out for you.');
}

async function maybePromptNewPlayer(interaction) {
  const guildId = interaction.guild?.id || null;
  const userId = interaction.user?.id || null;
  if (!guildId || !userId) return false;
  if (onboardingAcknowledgedUsers.has(onboardingCacheKey(guildId, userId))) return false;
  let status = null;
  try {
    status = await getUserOnboardingStatus(guildId, userId);
    if (status?.acknowledgedAt) {
      rememberOnboardingAcknowledged(guildId, userId);
      return false;
    }
  } catch (err) {
    console.error(`Failed to read onboarding status for ${userId} in ${guildId}`, err);
    return false;
  }

  let bonusJustGranted = false;
  let grantError = null;
  try {
    const alreadyGranted = (status?.chipsGranted ?? 0) >= WELCOME_BONUS_AMOUNT;
    if (!alreadyGranted) {
      const result = await grantUserOnboardingBonus(guildId, userId, WELCOME_BONUS_AMOUNT, 'welcome bonus');
      bonusJustGranted = result?.granted === true;
      status = result?.status || await getUserOnboardingStatus(guildId, userId);
    }
  } catch (err) {
    grantError = err;
    console.error(`Failed to grant welcome bonus for ${userId} in ${guildId}`, err);
    try {
      status = status || await getUserOnboardingStatus(guildId, userId);
    } catch {}
  }

  if (status?.acknowledgedAt) return false;

  const payload = {
    embeds: [buildWelcomePromptEmbed({ status, bonusJustGranted, bonusError: grantError })],
    components: buildWelcomePromptComponents(),
    ephemeral: true
  };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
    return true;
  } catch (err) {
    console.error(`Failed to send welcome prompt for ${userId} in ${guildId}`, err);
    return false;
  }
}


// Session tracking (in-memory per bot runtime)
// NOTE: We surface current session stats from activeSessions (below).
const sessionStats = new Map(); // key: `${guildId}:${userId}` -> { games: number, net: number }

function sessionKey(guildId, userId) { return `${guildId}:${userId}`; }
function getSessionStats(guildId, userId) {
  const k = sessionKey(guildId, userId);
  if (!sessionStats.has(k)) sessionStats.set(k, { games: 0, net: 0 });
  return sessionStats.get(k);
}

const RESPONSE_PATCHED = Symbol('responsePatched');
let voteRewardProcessing = false;

process.on('unhandledRejection', (reason) => {
  if (reason && typeof reason === 'object' && 'code' in reason && Number(reason.code) === 10062) {
    console.warn('Ignored expired interaction (code 10062)');
    return;
  }
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  if (err && typeof err === 'object' && 'code' in err && Number(err.code) === 10062) {
    console.warn('Ignored expired interaction (code 10062)');
    return;
  }
  console.error('Uncaught exception:', err);
});

function normalizeEphemeralOption(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (!Object.prototype.hasOwnProperty.call(payload, 'ephemeral')) return payload;

  const cloned = { ...payload };
  const { ephemeral } = cloned;
  delete cloned.ephemeral;

  if (ephemeral) {
    const currentFlags = typeof cloned.flags === 'number' ? cloned.flags : 0;
    cloned.flags = currentFlags | MessageFlags.Ephemeral;
  }
  return cloned;
}

function patchInteractionResponseMethods(interaction) {
  if (!interaction || interaction[RESPONSE_PATCHED]) return;
  const methods = ['reply', 'editReply', 'followUp', 'update', 'deferReply', 'deferUpdate'];
  for (const method of methods) {
    if (typeof interaction[method] !== 'function') continue;
    const original = interaction[method].bind(interaction);
    interaction[method] = (...args) => {
      if (args.length > 0) {
        const next = normalizeEphemeralOption(args[0]);
        if (next !== args[0]) args[0] = next;
      }
      return original(...args);
    };
  }
  interaction[RESPONSE_PATCHED] = true;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages]
});
client.botVersion = BOT_VERSION;
client.pushUpdateAnnouncement = (guildId, details = {}) => pushUpdateAnnouncement(client, guildId, details);

async function pushBotStatusSnapshot(reason = 'manual') {
  if (!client?.isReady?.()) return;
  try {
    const guildCount = client.guilds.cache.size;
    const playerCount = await getGlobalPlayerCount();
    await setBotStatusSnapshot({ guildCount, playerCount });
  } catch (err) {
    console.error('[metrics] failed to update bot status snapshot', reason, err);
  }
}

const OWNER_USER_SET = new Set(OWNER_USER_IDS);
const GUILD_WELCOME_WINDOW_MS = 5 * 60 * 1000;
const guildWelcomeSent = new Set();
const pendingGuildWelcome = new Set();

async function findBotInviter(guild) {
  if (!guild || !guild.client?.user) return null;
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
    const entry = logs.entries.find(logEntry => logEntry.action === AuditLogEvent.BotAdd && logEntry.target?.id === guild.client.user.id);
    if (entry?.executor) {
      try {
        return await guild.client.users.fetch(entry.executor.id);
      } catch {
        return entry.executor;
      }
    }
  } catch (err) {
    console.warn(`Could not resolve bot inviter for guild ${guild?.id}`, err);
  }
  if (guild?.ownerId) {
    try {
      return await guild.client.users.fetch(guild.ownerId);
    } catch {
      return guild.client.users.resolve(guild.ownerId) || null;
    }
  }
  return null;
}

function buildGuildWelcomeMessage(inviter, guild) {
  const displayName = inviter?.globalName || inviter?.username || 'there';
  const guildName = guild?.name ? ` to ${guild.name}` : '';
  return [
    `Hey ${displayName}! Thanks for inviting Casino Bot${guildName}.`,
    '',
    'Casino Bot runs a single global economy shared across every server, so balances, jobs, and ledgers follow players everywhere.',
    '',
    'Quick setup checklist:',
    '1. Run `/setcasinocategory category:<#Category>` so all games live in a dedicated channel group.',
    '2. Confirm the bot can Send Messages, Embed Links, Manage Channels, Use External Emojis, and Read Message History in that category.',
    '3. (Optional) Point the log channels if you want detailed embeds elsewhere:',
    '   - `/setgamelogchannel channel:<#channel>` for game summaries',
    '   - `/setcashlog channel:<#channel>` for chip and cash ledger updates',
    '   - `/setrequestchannel channel:<#channel>` for buy-in and cash-out tickets',
    '   - `/setupdatech channel:<#channel>` for release announcements',
    '4. Moderator and admin access is managed by the development team to protect the shared economy—reach out if you need roster changes.',
    '5. Use `/help` any time for the full command list and extra guidance.',
    '',
    'Once those are set, your players can jump straight into `/slots`, `/blackjack`, `/roulette`, and more. Have fun!',
    '',
    'Need a hand or spot an issue? Hop into our support hub: https://discord.gg/semutaofdune'
  ].join('\n');
}

async function sendGuildWelcomeDm(guild, { inviter, source } = {}) {
  if (!guild) return;
  if (guildWelcomeSent.has(guild.id) || pendingGuildWelcome.has(guild.id)) return;
  pendingGuildWelcome.add(guild.id);
  let resolvedInviter = inviter;
  if (!resolvedInviter) resolvedInviter = await findBotInviter(guild);
  if (!resolvedInviter) {
    console.warn(`Skipping welcome DM: no inviter found for guild ${guild?.id} (${source || 'unknown'})`);
    pendingGuildWelcome.delete(guild.id);
    return;
  }
  try {
    const message = buildGuildWelcomeMessage(resolvedInviter, guild);
    await resolvedInviter.send({ content: message });
    const identifier = resolvedInviter.tag || resolvedInviter.username || resolvedInviter.id;
    console.log(`Sent setup DM to ${identifier} for guild ${guild?.id} (${source || 'unknown'})`);
  } catch (err) {
    console.error(`Failed to send welcome DM for guild ${guild?.id} (${source || 'unknown'})`, err);
  }
  guildWelcomeSent.add(guild.id);
  pendingGuildWelcome.delete(guild.id);
}

function hasOwnerOverride(userId) {
  return !!(userId && OWNER_USER_SET.has(String(userId)));
}

async function adminsForGuild(guildId) {
  return getAccessListCached(guildId, 'admins', getAdmins);
}

async function moderatorsForGuild(guildId) {
  return getAccessListCached(guildId, 'moderators', getModerators);
}

async function hasAdminAccess(guildId, userId) {
  if (!userId) return false;
  if (hasOwnerOverride(userId)) return true;
  const admins = await adminsForGuild(guildId);
  return admins.includes(String(userId));
}

async function hasModeratorAccess(guildId, userId) {
  if (!userId) return false;
  if (hasOwnerOverride(userId)) return true;
  const [admins, moderators] = await Promise.all([
    adminsForGuild(guildId),
    moderatorsForGuild(guildId)
  ]);
  if (admins.includes(String(userId))) return true;
  return moderators.includes(String(userId));
}

async function isAdmin(interaction) {
  try {
    const guildId = interaction.guild?.id || null;
    const userId = interaction.user?.id || null;
    return await hasAdminAccess(guildId, userId);
  } catch {
    return false;
  }
}

async function isModerator(interaction) {
  try {
    const guildId = interaction.guild?.id || null;
    const userId = interaction.user?.id || null;
    return await hasModeratorAccess(guildId, userId);
  } catch {
    return false;
  }
}

client.once(Events.ClientReady, c => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
  pushBotStatusSnapshot('ready').catch(() => {});
  const botStatusIntervalMs = Math.max(30_000, Number(process.env.BOT_STATUS_SNAPSHOT_INTERVAL_MS || 120_000));
  setInterval(() => {
    pushBotStatusSnapshot('interval').catch(() => {});
  }, botStatusIntervalMs);
  // Periodically sweep inactive game sessions and finalize them
  setInterval(() => { sweepExpiredSessionsMod(client).catch(() => {}); }, 15 * 1000);
  scheduleStartupHoldemOrphanSweep(client);

  const intervalMs = Math.max(5_000, Number(process.env.VOTE_REWARD_AUTO_INTERVAL_MS || 15_000));
  const sweepVoteRewards = async () => {
    if (voteRewardProcessing) return;
    voteRewardProcessing = true;
    try {
      const results = await autoRedeemPendingVoteRewards();
      const dmEntries = [];
      for (const entry of results) {
        if (!entry || entry.error || !(entry.claimedTotal > 0)) {
          if (entry?.error) {
            console.error('Auto vote reward redeem failed for', entry.userId, entry.error);
          }
          continue;
        }
        dmEntries.push(entry);
      }
      await deliverVoteRewardDms(client, dmEntries);
    } catch (err) {
      console.error('Failed to auto redeem vote rewards', err);
    } finally {
      voteRewardProcessing = false;
    }
  };

  sweepVoteRewards().catch(() => {});
  setInterval(() => { sweepVoteRewards().catch(() => {}); }, intervalMs);

  setInterval(() => {
    pruneUserInteractionEvents(INTERACTION_EVENT_RETENTION_DAYS, INTERACTION_EVENT_PRUNE_BATCH_SIZE)
      .catch(err => {
        console.error('Failed to prune user_interaction_events', err);
      });
  }, INTERACTION_EVENT_PRUNE_INTERVAL_MS);

  startLeaderboardChampionWatcher(client);
  try {
    startInactivitySweep(client);
  } catch (err) {
    console.error('Failed to start inactivity sweep', err);
  }
  try {
    const timer = startCartelWorkerMod();
    if (typeof timer?.unref === 'function') timer.unref();
  } catch (err) {
    console.error('Failed to start cartel worker', err);
  }
  try {
    topggPoster = startTopggStatsPoster(client);
  } catch (err) {
    console.error('Failed to start top.gg stats poster', err);
  }
  try {
    discordForgePoster = startDiscordForgeStatsPoster(client);
  } catch (err) {
    console.error('Failed to start DiscordForge stats poster', err);
  }

});

client.on(Events.GuildCreate, async (guild) => {
  try {
    const joinedTimestamp = Number(
      guild?.joinedTimestamp ??
      guild?.members?.me?.joinedTimestamp ??
      guild?.joinedAt?.getTime?.()
    );
    if (Number.isFinite(joinedTimestamp)) {
      const age = Date.now() - joinedTimestamp;
      if (age > GUILD_WELCOME_WINDOW_MS) return;
    }
    await sendGuildWelcomeDm(guild, { source: 'guildCreate' });
  } catch (err) {
    console.error(`Failed to process guildCreate welcome for guild ${guild?.id}`, err);
  }
  pushBotStatusSnapshot('guild_create').catch(() => {});
  triggerTopggStats('guild_create');
  triggerDiscordForgeStats('guild_create');
});

client.on(Events.GuildDelete, (guild) => {
  pushBotStatusSnapshot('guild_delete').catch(() => {});
  triggerTopggStats('guild_delete');
  triggerDiscordForgeStats('guild_delete');
});

client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
  try {
    if (!guild || !entry || entry.action !== AuditLogEvent.BotAdd) return;
    if (entry.target?.id !== guild.client?.user?.id) return;
    const executor = entry.executor
      ? await guild.client.users.fetch(entry.executor.id).catch(() => entry.executor)
      : null;
    await sendGuildWelcomeDm(guild, { inviter: executor, source: 'auditLog' });
  } catch (err) {
    console.error(`Failed to process audit log welcome for guild ${guild?.id}`, err);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message?.guild || !message?.author || message.author.bot) return;

    const guildId = message.guild.id;
    const settings = await getGuildSettingsCached(guildId);
    const autoBanChannelId = settings?.auto_ban_channel_id || null;
    if (!autoBanChannelId || message.channelId !== autoBanChannelId) return;

    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;
    if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return;

    const me = message.guild.members.me || await message.guild.members.fetchMe().catch(() => null);
    if (!me?.permissions?.has?.(PermissionFlagsBits.BanMembers)) {
      console.warn(`Auto-ban skipped in guild ${guildId}: bot lacks Ban Members permission.`);
      return;
    }

    if (!member.bannable) {
      console.warn(`Auto-ban skipped in guild ${guildId}: user ${member.id} is not bannable.`);
      return;
    }

    await member.ban({
      deleteMessageSeconds: 24 * 60 * 60,
      reason: `Auto-ban channel violation in #${message.channel?.name || message.channelId}`
    });
    console.log(`Auto-banned user ${member.id} in guild ${guildId} for posting in configured auto-ban channel ${autoBanChannelId}.`);
  } catch (err) {
    console.error('Auto-ban enforcement failed:', err);
  }
});

// Command registry and context for modular handlers
const KITTEN_PATCHED = Symbol('kittenModePatched');

function applyKittenModeToInteraction(interaction) {
  if (!interaction || interaction[KITTEN_PATCHED]) return;
  const methods = ['reply', 'editReply', 'followUp', 'update'];
  for (const method of methods) {
    if (typeof interaction[method] !== 'function') continue;
    const original = interaction[method].bind(interaction);
    interaction[method] = (...args) => {
      if (args.length > 0) {
        args[0] = kittenizeReplyArg(args[0]);
      }
      return original(...args);
    };
  }
  interaction[KITTEN_PATCHED] = true;
}

function buildCommandContext(interaction, extras = {}) {
  const guildId = interaction?.guild?.id || null;
  let kittenModeFlag = typeof extras.kittenMode === 'boolean' ? extras.kittenMode : null;
  const sessionCleanupPromise = extras?.sessionCleanupPromise || null;
  const waitForSessionCleanup = async () => {
    if (!sessionCleanupPromise) return;
    await sessionCleanupPromise;
  };

  const ensureKittenMode = async () => {
    if (typeof kittenModeFlag === 'boolean') return kittenModeFlag;
    if (!guildId) return false;
    try {
      const settings = await getGuildSettingsCached(guildId);
      kittenModeFlag = !!(settings && settings.kitten_mode_enabled);
      return kittenModeFlag;
    } catch {
      return false;
    }
  };

  const kittenizeIfNeeded = (value) => {
    if (kittenModeFlag === true) return kittenizeTextContent(value);
    return value;
  };

  const kittenizePayloadIfNeeded = (payload) => {
    if (kittenModeFlag === true) return kittenizeReplyArg(payload);
    return payload;
  };

  const kittenizeLines = (lines) => {
    if (!kittenModeFlag) return lines;
    if (Array.isArray(lines)) return lines.map(item => kittenizeReplyArg(item));
    return kittenizeReplyArg(lines);
  };

  const wrappedPostCashLog = async (interaction, lines) => {
    const ensure = await ensureKittenMode();
    const payload = ensure ? kittenizeLines(lines) : lines;
    return postCashLogMod(interaction, payload);
  };

  const wrappedSendGameMessage = async (interaction, payload, mode = 'auto') => {
    const ensure = await ensureKittenMode();
    const transformed = ensure ? kittenizePayloadIfNeeded(payload) : payload;
    return sendGameMessage(interaction, transformed, mode);
  };

  return {
    isModerator,
    isAdmin,
    listModerators: () => moderatorsForGuild(guildId),
    listAdmins: () => adminsForGuild(guildId),
    hasOwnerOverride,
    ownerUserIds: OWNER_USER_IDS,
    chipsAmount,
    formatChips,
    postCashLog: wrappedPostCashLog,
    // DB helpers
    getUserBalances: (userId) => getUserBalances(guildId, userId),
    burnCredits: (userId, amount, reason, adminId) => burnCredits(guildId, userId, amount, reason, adminId),
    getHouseBalance: () => getHouseBalance(guildId),
    mintChips: (userId, amount, reason, adminId) => mintChips(guildId, userId, amount, reason, adminId),
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
    sendGameMessage: wrappedSendGameMessage,
    // Shared UI builders
    rowButtons: (ids, opts = {}) => rowButtonsMod(ids, { ...opts, kittenMode: (opts?.kittenMode ?? kittenModeFlag) === true }),
    embedForState: async (state, opts = {}) => {
      const km = (opts?.kittenMode !== undefined)
        ? opts.kittenMode
        : (state?.kittenMode !== undefined
            ? state.kittenMode
            : await ensureKittenMode());
      return embedForStateMod(state, { ...opts, kittenMode: km === true });
    },
    playAgainRow: (bet, userId, opts = {}) => playAgainRowMod(bet, userId, { ...opts, kittenMode: (opts?.kittenMode ?? kittenModeFlag) === true }),
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
    awaitSessionCleanup: waitForSessionCleanup,
    startRideBus: async (interaction, bet) => {
      return startRideBusMod(interaction, bet, {
        kittenMode: await ensureKittenMode(),
        kittenizeText: kittenizeIfNeeded,
        kittenizePayload: kittenizePayloadIfNeeded
      });
    },
    startBlackjack: async (interaction, table, bet) => {
      return startBlackjackMod(interaction, table, bet);
    },
    runSlotsSpin: async (interaction, bet, key) => {
      return runSlotsSpinMod(interaction, bet, key);
    },
    startRouletteSession: async (interaction) => {
      return startRouletteSessionMod(interaction);
    },
    guildId,
    kittenModeEnabled: kittenModeFlag,
    isKittenModeEnabled: ensureKittenMode,
    kittenizeText: kittenizeIfNeeded,
    kittenizePayload: kittenizePayloadIfNeeded,
    pushUpdateAnnouncement: (details = {}) => {
      if (!guildId) throw new Error('UPDATE_PUSH_REQUIRES_GUILD');
      return pushUpdateAnnouncement(client, guildId, details);
    },
    botVersion: BOT_VERSION
  };
}

function describeInteractionForLogging(interaction) {
  const fallback = { type: 'unknown', key: null, metadata: null };
  if (!interaction || typeof interaction !== 'object') return fallback;

  try {
    if (typeof interaction.isChatInputCommand === 'function' && interaction.isChatInputCommand()) {
      const metadata = { commandName: interaction.commandName };
      try {
        const subGroup = interaction.options?.getSubcommandGroup?.(false);
        if (subGroup) metadata.subcommandGroup = subGroup;
      } catch {}
      try {
        const subCmd = interaction.options?.getSubcommand?.(false);
        if (subCmd) metadata.subcommand = subCmd;
      } catch {}
      return { type: 'chat_input', key: interaction.commandName, metadata };
    }
    if (typeof interaction.isUserContextMenuCommand === 'function' && interaction.isUserContextMenuCommand()) {
      return { type: 'user_context_menu', key: interaction.commandName, metadata: { commandName: interaction.commandName } };
    }
    if (typeof interaction.isMessageContextMenuCommand === 'function' && interaction.isMessageContextMenuCommand()) {
      return { type: 'message_context_menu', key: interaction.commandName, metadata: { commandName: interaction.commandName } };
    }
    if (typeof interaction.isButton === 'function' && interaction.isButton()) {
      return { type: 'button', key: interaction.customId, metadata: { customId: interaction.customId } };
    }
    if (typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu()) {
      return { type: 'string_select', key: interaction.customId, metadata: { customId: interaction.customId, values: Array.isArray(interaction.values) ? interaction.values : [] } };
    }
    const selectHelpers = [
      ['isUserSelectMenu', 'user_select'],
      ['isRoleSelectMenu', 'role_select'],
      ['isMentionableSelectMenu', 'mentionable_select'],
      ['isChannelSelectMenu', 'channel_select']
    ];
    for (const [fn, type] of selectHelpers) {
      if (typeof interaction[fn] === 'function' && interaction[fn]()) {
        return { type, key: interaction.customId, metadata: { customId: interaction.customId, values: Array.isArray(interaction.values) ? interaction.values : [] } };
      }
    }
    if (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit()) {
      const fieldCount = interaction.fields?.fields ? interaction.fields.fields.size ?? 0 : 0;
      return { type: 'modal_submit', key: interaction.customId, metadata: { customId: interaction.customId, fieldCount } };
    }
    if (typeof interaction.isAutocomplete === 'function' && interaction.isAutocomplete()) {
      return { type: 'autocomplete', key: interaction.commandName || null, metadata: { commandName: interaction.commandName || null } };
    }
  } catch (err) {
    console.error('describeInteractionForLogging failed', err);
  }

  return fallback;
}

async function maybeSendReviewPrompt(interaction, stats) {
  const userId = interaction?.user?.id;
  if (!userId) return;
  const total = Number(stats?.total_interactions || 0);
  if (!Number.isFinite(total) || total < REVIEW_PROMPT_INTERACTION_THRESHOLD) return;

  const sentAt = Number(stats?.review_prompt_sent_at || 0);
  if (sentAt) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const lastAttempt = Number(stats?.review_prompt_attempted_at || 0);
  if (lastAttempt && nowSec - lastAttempt < REVIEW_PROMPT_RETRY_SECONDS) return;

  try {
    await interaction.user.send(REVIEW_PROMPT_MESSAGE);
    try {
      await interaction.user.send(REVIEW_PROMPT_SUPPORT_MESSAGE);
    } catch (supportErr) {
      console.error(`Failed to send review prompt support link to ${userId}`, supportErr);
    }
    try {
      await markUserInteractionReviewPrompt(userId, { status: 'sent', timestamp: nowSec });
    } catch (markErr) {
      console.error(`Failed to record successful review prompt for ${userId}`, markErr);
    }
  } catch (err) {
    console.error(`Failed to send review prompt DM to ${userId}`, err);
    const message = err?.message ? String(err.message).slice(0, 512) : 'unknown_error';
    try {
      await markUserInteractionReviewPrompt(userId, { status: 'failed', error: message, timestamp: nowSec });
    } catch (markErr) {
      console.error(`Failed to record failed review prompt for ${userId}`, markErr);
    }
  }
}

function queueInteractionLogging(interaction) {
  (async () => {
    const userId = interaction?.user?.id;
    if (!userId) return;
    const { type, key, metadata } = describeInteractionForLogging(interaction);
    try {
      const stats = await recordUserInteraction({
        userId,
        guildId: interaction?.guild?.id || null,
        channelId: interaction?.channelId || null,
        interactionType: type,
        interactionKey: key,
        locale: typeof interaction?.locale === 'string' ? interaction.locale : null,
        metadata
      });
      if (stats) {
        await maybeSendReviewPrompt(interaction, stats);
      }
    } catch (err) {
      console.error('Interaction logging failed', err);
    }
  })();
}

async function maybeSendNewsReminder(interaction) {
  try {
    if (!interaction || typeof interaction.isChatInputCommand !== 'function') return;
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'news') return;
    if (typeof interaction.inGuild === 'function' && !interaction.inGuild()) return;
    const userId = interaction.user?.id;
    if (!userId) return;
    const active = await getActiveNewsCached();
    if (!active || !active.body) return;
    const digest = activeNewsCache.digest || newsDigest(active) || null;
    const nowSec = Math.floor(Date.now() / 1000);
    const cachedState = getUserNewsState(userId);
    if (cachedState?.optOut) return;
    if (cachedState && cachedState.skipUntilSec > nowSec && cachedState.digest === digest) return;

    const settings = await getUserNewsSettings(userId);
    if (settings?.newsOptIn === false) {
      setUserNewsState(userId, { optOut: true, digest: null, skipUntilSec: 0 });
      return;
    }
    const lastSentRaw = settings?.lastDeliveredAt;
    const lastSentSec = Number.isFinite(Number(lastSentRaw))
      ? Math.trunc(Number(lastSentRaw))
      : 0;
    const lastDigest = settings?.lastDigest || null;
    const seenRecently = lastSentSec > 0 && (nowSec - lastSentSec) < NEWS_COOLDOWN_SECONDS;
    if (seenRecently && (!digest || lastDigest === digest)) {
      setUserNewsState(userId, {
        optOut: false,
        digest,
        skipUntilSec: lastSentSec + NEWS_COOLDOWN_SECONDS
      });
      return;
    }
    if (!(interaction.deferred || interaction.replied)) return;
    if (interaction.deferred && !interaction.replied) {
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    const rangeLabel = active.endDate
      ? `${active.startDate} → ${active.endDate}`
      : active.startDate;
    const header = active.title ? `📰 **${active.title}**` : '📰 **Casino News**';
    const lines = [
      header,
      rangeLabel ? `Dates: ${rangeLabel}` : null,
      '',
      active.body,
      '',
      'Use `/news enabled:false` to pause these updates.'
    ].filter(Boolean);

    let delivered = false;
    try {
      await interaction.followUp({
        content: lines.join('\n'),
        ephemeral: true
      });
      delivered = true;
    } catch (err) {
      if (err?.code !== 40060) throw err;
    }

    if (delivered) {
      await markUserNewsDelivered(userId, digest, nowSec);
      setUserNewsState(userId, {
        optOut: false,
        digest,
        skipUntilSec: nowSec + NEWS_COOLDOWN_SECONDS
      });
    }
  } catch (err) {
    console.error('Failed to send news reminder', err);
  }
}

async function maybeSendChampionNotice(interaction) {
  try {
    if (!interaction?.user?.id) return;
    const notice = claimChampionNotice(interaction.user.id);
    if (!notice) return;
    let content = '';
    if (notice.type === 'gained') {
      const amount = chipsAmount(Math.max(0, Number(notice.chips || 0)));
      content = `${emoji('trophy')} You just claimed the #1 leaderboard spot with **${amount}** chips! Keep the streak going.`;
    } else if (notice.type === 'lost') {
      const dethronedBy = notice.dethronedBy ? ` by <@${notice.dethronedBy}>` : '';
      content = `${emoji('chartDown')} You lost the #1 leaderboard spot${dethronedBy}. Time to win it back!`;
    } else {
      return;
    }

    if (typeof interaction.isRepliable === 'function' && interaction.isRepliable()) {
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content, ephemeral: true });
          return;
        }
      } catch (err) {
        console.warn('Champion notice follow-up failed', err);
      }
    }

    try {
      await interaction.user.send(content);
    } catch (err) {
      console.warn(`Champion notice DM failed for ${interaction.user.id}`, err);
    }
  } catch (err) {
    console.error('maybeSendChampionNotice failed', err);
  }
}

function buildComebackWelcomeEmbed(interaction, result) {
  const amount = Math.max(0, Number(result?.bonusAmount || 0));
  const commandName = interaction?.commandName ? `/${interaction.commandName}` : 'Unknown';
  const ts = Math.floor(Date.now() / 1000);
  const fields = [
    { name: 'Bonus Granted', value: amount > 0 ? chipsAmount(amount) : 'No bonus this cycle', inline: true },
    { name: 'Triggered By', value: commandName, inline: true },
    { name: 'Time', value: `<t:${ts}:F>`, inline: false }
  ];
  return new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('Welcome Back to Semuta Casino')
    .setDescription('Your inactivity status has been cleared and your comeback flow is complete.')
    .addFields(fields);
}

async function maybeHandleInactivityLifecycle(interaction) {
  try {
    if (!interaction || typeof interaction.isChatInputCommand !== 'function' || !interaction.isChatInputCommand()) return null;
    const userId = interaction.user?.id;
    if (!userId) return null;
    const guildId = interaction.guild?.id || null;
    if (await hasModeratorAccess(guildId, userId)) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    const touched = await touchUserActivityLifecycle(userId, nowSec);
    if (!touched?.is_inactive) return null;

    const result = await reactivateUserWithComebackBonus(guildId, userId, {
      bonusAmount: COMEBACK_BONUS_ENABLED ? COMEBACK_BONUS_CHIPS : 0,
      reason: 'comeback bonus',
      adminId: 'comeback:auto',
      timestamp: nowSec,
      triggerCommand: interaction.commandName || null
    });
    if (!result?.reactivated) return null;
    return result;
  } catch (err) {
    console.error('Inactivity lifecycle handling failed', err);
    return null;
  }
}

async function maybeSendComebackWelcomeDm(interaction, result) {
  try {
    if (!result?.reactivated) return;
    const embed = buildComebackWelcomeEmbed(interaction, result);
    await interaction.user.send({ embeds: [embed] });
  } catch (err) {
    console.warn(`Failed to send comeback welcome DM to ${interaction?.user?.id || 'unknown'}`, err);
  }
}

const commandHandlers = {
  ping: cmdPing,
  status: cmdStatus,
  balance: cmdBalance,
  beg: cmdBeg,
  job: cmdJob,
  givechip: cmdGiveChip,
  housebalance: cmdHouseBalance,
  houseadd: cmdHouseAdd,
  mintchip: cmdMintChip,
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
  setupdatech: cmdSetUpdateChannel,
  setautoban: cmdSetAutoBan,
  requesttimer: cmdRequestTimer,
  request: cmdRequest,
  help: cmdHelp,
  addmod: cmdAddMod,
  removemod: cmdRemoveMod,
  addadmin: cmdAddAdmin,
  removeadmin: cmdRemoveAdmin,
  dailyspin: cmdDailySpin,
  stafflist: cmdStaffList,
  ridebus: cmdRideBus,
  blackjack: cmdBlackjack,
  slots: cmdSlots,
  roulette: cmdRoulette,
  holdem: cmdHoldem,
  dicewar: cmdDiceWar,
  horserace: cmdHorseRace,
  setrake: cmdSetRake,
  setmaxbet: cmdSetMaxBet,
  setcartelshare: cmdSetCartelShare,
  setcartelxp: cmdSetCartelXp,
  setcartelrate: cmdSetCartelRate,
  resetallbalance: cmdResetAllBalance,
  setcasinocategory: cmdSetCasinoCategory,
  cartelreset: cmdCartelReset,
  cartelraiddebug: cmdCartelRaidDebug,
  cartelwarehousedebug: cmdCartelWarehouseDebug,
  kittenmode: cmdKittenMode,
  vote: cmdVote,
  debugvote: cmdDebugVote,
  debugdspin: cmdDebugDspin,
  news: cmdNews,
  cartel: cmdCartel,
  '8ball': cmdEightBall
};

client.on(Events.InteractionCreate, async interaction => {
  try {
    patchInteractionResponseMethods(interaction);
    const guildId = interaction.guild?.id || null;
    let kittenModeEnabled = false;
    if (guildId) {
      try {
        const settings = await getGuildSettingsCached(guildId);
        kittenModeEnabled = !!(settings && settings.kitten_mode_enabled);
      } catch (err) {
        console.error('Failed to read kitten mode setting:', err);
      }
    }
    if (kittenModeEnabled) applyKittenModeToInteraction(interaction);
    const ctxExtras = { kittenMode: kittenModeEnabled };

    queueInteractionLogging(interaction);

    // ========== SLASH COMMANDS ==========
      if (interaction.isChatInputCommand()) {
      const gated = await maybePromptNewPlayer(interaction);
      if (gated) return;

      // End any existing active game session when a new command is run.
      // Capture the promise so game commands can await it before starting new sessions.
      const sessionCleanupPromise = endActiveSessionForUser(interaction, 'new_command').catch(err => {
        console.error('endActiveSessionForUser (command) error:', err);
      });

      const comebackResult = await maybeHandleInactivityLifecycle(interaction);

      // Modular command dispatch
      const handler = commandHandlers[interaction.commandName];
      if (typeof handler === 'function') {
        const ctx = buildCommandContext(interaction, { ...ctxExtras, sessionCleanupPromise });
        const result = await handler(interaction, ctx);
        if (SETTINGS_MUTATION_COMMANDS.has(interaction.commandName)) {
          invalidateGuildSettingsCache(guildId);
        }
        if (ACCESS_MUTATION_COMMANDS.has(interaction.commandName)) {
          invalidateAccessCache(guildId);
        }
        if (interaction.commandName === 'news') {
          clearUserNewsState(interaction.user?.id || null);
        }
        await maybeSendNewsReminder(interaction);
        await maybeSendComebackWelcomeDm(interaction, comebackResult);
        return result;
      }
      // Fallback if no handler registered
      await maybeSendComebackWelcomeDm(interaction, comebackResult);
      return interaction.reply({ content: '❌ Unknown command.', ephemeral: true });

      }
    // ========== BUTTONS ==========
    else if (interaction.isButton() && interaction.customId === WELCOME_ACK_CUSTOM_ID) {
      const guildId = interaction.guild?.id || null;
      const userId = interaction.user?.id || null;
      if (!guildId || !userId) {
        return interaction.reply({ content: '⚠️ This bonus is only available inside a server.', ephemeral: true }).catch(() => {});
      }
      try {
        const existingStatus = await getUserOnboardingStatus(guildId, userId);
        const alreadyClaimed = !!(existingStatus && existingStatus.acknowledgedAt);
        const ackResult = await markUserOnboardingAcknowledged(guildId, userId);
        let status = ackResult?.status || existingStatus;
        if (!status) {
          try { status = await getUserOnboardingStatus(guildId, userId); } catch {}
        }
        const acknowledgedNow = ackResult?.acknowledged === true;
        const embed = buildWelcomeAcknowledgedEmbed({
          status,
          alreadyClaimed: !acknowledgedNow && (alreadyClaimed || !!(status && status.acknowledgedAt))
        });
        if (acknowledgedNow || (status && status.acknowledgedAt)) {
          rememberOnboardingAcknowledged(guildId, userId);
        }
        try {
          await interaction.update({ embeds: [embed], components: [] });
        } catch (updateErr) {
          console.warn('welcome ack update failed, falling back to reply', updateErr);
          await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
        }
        return;
      } catch (err) {
        console.error(`Failed to acknowledge welcome bonus for ${userId} in ${guildId}`, err);
        return interaction.reply({ content: '❌ I hit an error while confirming that bonus. Please try again in a moment.', ephemeral: true }).catch(() => {});
      }
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|refresh') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelOverviewRefresh(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|ranks') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelRankTable(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|guide') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelGuide(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|shares|view') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelSharesView(interaction, ctx, 'splash');
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|shares|view|buy') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelSharesView(interaction, ctx, 'buy');
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|shares|view|buy|page|')) {
      const page = Number(interaction.customId.split('|').pop());
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelSharesView(interaction, ctx, 'buy', { page: Number.isFinite(page) ? page : 1 });
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|shares|view|sell') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelSharesView(interaction, ctx, 'sell');
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|shares|view|sell|page|')) {
      const page = Number(interaction.customId.split('|').pop());
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelSharesView(interaction, ctx, 'sell', { page: Number.isFinite(page) ? page : 1 });
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|shares|view|posts') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelSharesView(interaction, ctx, 'posts');
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|shares|order|sell') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelShareOrderPrompt(interaction, ctx, 'SELL');
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|shares|order|buy') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelShareOrderPrompt(interaction, ctx, 'BUY');
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|shares|order|cancel|')) {
      const orderId = interaction.customId.substring('cartel|shares|order|cancel|'.length);
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelShareOrderCancel(interaction, ctx, orderId);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|shares|market|buy|confirm|')) {
      const parts = interaction.customId.split('|');
      const orderId = parts.length > 5 ? parts[5] : '0';
      const page = parts.length > 6 ? Number(parts[6]) : 1;
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelMarketConfirm(interaction, ctx, 'buy', orderId, page);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|shares|market|sell|confirm|')) {
      const parts = interaction.customId.split('|');
      const orderId = parts.length > 5 ? parts[5] : '0';
      const page = parts.length > 6 ? Number(parts[6]) : 1;
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelMarketConfirm(interaction, ctx, 'sell', orderId, page);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|sell|prompt') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelSellPrompt(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|sell|minigame|move|')) {
      const parts = interaction.customId.split('|');
      const direction = parts[4];
      const sessionId = parts[5] || '';
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelSellMiniGameMove(interaction, ctx, direction, sessionId);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|collect|prompt') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelCollectPrompt(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|overview') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelOverviewRefresh(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|warehouse|view') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelWarehouseView(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|warehouse|burn') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelWarehouseBurnPrompt(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|warehouse|export') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelWarehouseExport(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|dealers|view|')) {
      const view = interaction.customId.split('|').pop();
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealersView(interaction, ctx, view);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|dealers|hire|tier|')) {
      const tierId = Number(interaction.customId.split('|').pop());
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerHireTier(interaction, ctx, tierId);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|dealers|upkeep|')) {
      const dealerId = interaction.customId.substring('cartel|dealers|upkeep|'.length);
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerUpkeep(interaction, ctx, dealerId);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|dealers|manage|fire') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerManageAction(interaction, ctx, 'fire');
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|dealers|manage|pause') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerManageAction(interaction, ctx, 'pause');
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|dealers|manage|unpause') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerManageAction(interaction, ctx, 'unpause');
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|dealers|pause_all') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerPauseAll(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|dealers|fire_all') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerFireAll(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId === 'cartel|dealers|collect') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerCollect(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|dealers|pause|dealer|')) {
      const dealerId = interaction.customId.substring('cartel|dealers|pause|dealer|'.length);
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerPause(interaction, ctx, dealerId);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('cartel|dealers|fire|dealer|')) {
      const dealerId = interaction.customId.substring('cartel|dealers|fire|dealer|'.length);
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerFire(interaction, ctx, dealerId);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('jobstatus|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onJobStatusButtons(interaction, ctx);
    }
    else if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('jobshift|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onJobShiftButtons(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('rb|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onRideBusButtons(interaction, ctx);
    }
    // Blackjack buttons
    else if (interaction.isButton() && interaction.customId.startsWith('bj|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onBlackjackButtons(interaction, ctx);
    }
    // Slots buttons
    else if (interaction.isButton() && interaction.customId.startsWith('slots|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onSlotsButtons(interaction, ctx);
    }
    // Dice War buttons
    else if (interaction.isButton() && interaction.customId.startsWith('dice|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onDiceWarButtons(interaction, ctx);
    }
    // Roulette buttons
    else if (interaction.isButton() && interaction.customId.startsWith('rou|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onRouletteButtons(interaction, ctx);
    }

    // Horse race buttons
    else if (interaction.isButton() && interaction.customId.startsWith('horse|')) {
      return onHorseRaceButtons(interaction);
    }

    // Hold'em buttons
    else if (interaction.isButton() && interaction.customId.startsWith('hold|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onHoldemButtons(interaction, ctx);
    }

    // Request buttons
    else if (interaction.isButton() && interaction.customId.startsWith('req|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onRequestButtons(interaction, ctx);
    }

    // Leaderboard buttons
    else if (interaction.isButton() && interaction.customId.startsWith('leader|')) {
      return onLeaderboardButtons(interaction);
    }

    // Daily spin buttons
    else if (interaction.isButton() && interaction.customId.startsWith('dailyspin|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onDailySpinButtons(interaction, ctx);
    }

    // Roulette select menus
    else if (interaction.isStringSelectMenu() && interaction.customId === 'rou|type') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onRouletteTypeSelect(interaction, ctx);
    }
    else if (interaction.isStringSelectMenu() && interaction.customId === 'cartel|shares|posts|select') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelShareOrderSelect(interaction, ctx);
    }
    else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('cartel|shares|market|buy|select|')) {
      const page = Number(interaction.customId.split('|').pop());
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelMarketSelect(interaction, ctx, 'buy', page);
    }
    else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('cartel|shares|market|sell|select|')) {
      const page = Number(interaction.customId.split('|').pop());
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelMarketSelect(interaction, ctx, 'sell', page);
    }
    else if (interaction.isStringSelectMenu() && interaction.customId === 'cartel|dealers|manage|select') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerManageSelect(interaction, ctx);
    }

    // Help select menu
    else if (interaction.isStringSelectMenu() && interaction.customId === 'help|section') {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onHelpSelect(interaction, ctx);
    }
    else if (interaction.isButton() && interaction.customId.startsWith('help|page|')) {
      if (interaction.customId === 'help|page|noop') return interaction.deferUpdate().catch(() => {});
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onHelpPageButtons(interaction, ctx);
    }

    // Request reject modal submits
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('cartel|warehouse|burn|modal|')) {
      const messageId = interaction.customId.substring('cartel|warehouse|burn|modal|'.length) || '0';
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelWarehouseBurnModal(interaction, ctx, messageId);
    }
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('cartel|warehouse|export|modal|')) {
      const messageId = interaction.customId.substring('cartel|warehouse|export|modal|'.length) || '0';
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelWarehouseExportModal(interaction, ctx, messageId);
    }
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('cartel|dealers|upkeep_modal|')) {
      const dealerId = interaction.customId.substring('cartel|dealers|upkeep_modal|'.length);
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelDealerUpkeepModal(interaction, ctx, dealerId);
    }
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('cartel|collect|modal|')) {
      const messageId = interaction.customId.substring('cartel|collect|modal|'.length);
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelCollectModal(interaction, ctx, messageId);
    }
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('cartel|sell|modal|')) {
      const messageId = interaction.customId.substring('cartel|sell|modal|'.length);
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelSellModal(interaction, ctx, messageId);
    }
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('cartel|shares|order|modal|')) {
      const parts = interaction.customId.split('|');
      const side = parts.length > 4 ? parts[4] : 'SELL';
      const messageId = parts.length > 5 ? parts[5] : '0';
      const viewToken = parts.length > 6 ? parts[6] : 'shares';
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelShareOrderModal(interaction, ctx, side, messageId, viewToken);
    }
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('cartel|shares|market|buy|modal|')) {
      const parts = interaction.customId.split('|');
      const orderId = parts.length > 5 ? parts[5] : '0';
      const page = parts.length > 6 ? parts[6] : '1';
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelMarketModal(interaction, ctx, 'buy', orderId, page);
    }
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('cartel|shares|market|sell|modal|')) {
      const parts = interaction.customId.split('|');
      const orderId = parts.length > 5 ? parts[5] : '0';
      const page = parts.length > 6 ? parts[6] : '1';
      const ctx = buildCommandContext(interaction, ctxExtras);
      return handleCartelMarketModal(interaction, ctx, 'sell', orderId, page);
    }
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('req|rejmodal|')) {
      if (!(await isModerator(interaction))) return interaction.reply({ content: '❌ Moderators only.', ephemeral: true });
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onRequestRejectModal(interaction, ctx);
    }
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('bj|betmodal|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onBlackjackBetModal(interaction, ctx);
    }

    // Roulette modal submits
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('rou|modal|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onRouletteModal(interaction, ctx);
    }

    // Hold'em bet modal submits
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('hold|bet|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onHoldemBetModal(interaction, ctx);
    }
    // Hold'em join modal submits
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('hold|join|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onHoldemJoinModal(interaction, ctx);
    }
    // Hold'em custom table modal submits
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('hold|custom|')) {
      const ctx = buildCommandContext(interaction, ctxExtras);
      return onHoldemCustomModal(interaction, ctx);
    }

    else if (interaction.isModalSubmit() && interaction.customId.startsWith('horse|betmodal|')) {
      return onHorseRaceBetModal(interaction);
    }

    // ignore other interaction types
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && Number(err.code) === 10062) {
      console.warn('Skipped error response for expired interaction (code 10062)');
      return;
    }
    console.error(err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: '❌ Unexpected error.', ephemeral: true }).catch(()=>{});
      } else {
        await interaction.reply({ content: '❌ Unexpected error.', ephemeral: true }).catch(()=>{});
      }
    } catch (followErr) {
      console.error('Failed to send error response:', followErr);
    }
  } finally {
    await maybeSendChampionNotice(interaction);
  }
});

client.login(process.env.DISCORD_TOKEN);
// Bot Entrypoint — registers handlers, builds context, sweeps sessions, and logs in.
