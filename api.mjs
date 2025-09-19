import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { lookupApiKey } from './db.auto.mjs';

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);
app.use(rateLimit({ windowMs: 60_000, max: 120 })); // 120 req/min per IP

// Auth middleware: Authorization: Bearer <token>
function auth(requiredScopes = []) {
    return async (req, res, next) => {
        const hdr = req.headers.authorization || '';
        const [, token] = hdr.split(' ');
        if (!token) return res.status(401).json({ error: 'missing_token' });

        const key = await lookupApiKey(token);
        if (!key) return res.status(401).json({ error: 'invalid_token' });

        // Scope check
        const ok = requiredScopes.every(s => key.scopes.includes(s));
        if (!ok) return res.status(403).json({ error: 'insufficient_scope' });

        req.apiKey = key; // { guildId, scopes, id }
        next();
    };
}

// --- Example endpoints ---

// 2.1 Health
app.get('/api/v1/ping', (req, res) => res.json({ pong: true }));

// 2.2 Get a user's balances (read-only)
import { getUserBalances } from './db.auto.mjs';
app.get('/api/v1/guilds/:guildId/users/:discordId/balance', auth([]), async (req, res) => {
    const { guildId, discordId } = req.params;
    if (req.apiKey.guildId !== guildId) return res.status(403).json({ error: 'guild_mismatch' });
    const bal = await getUserBalances(guildId, discordId);
    res.json(bal);
});

// 2.3 Grant chips (admin-like)
import { transferFromHouseToUser } from './db.auto.mjs';
import { addToHouse, takeFromUserToHouse } from './db.auto.mjs';
import { burnFromUser, grantCredits, burnCredits } from './db.auto.mjs';
app.post('/api/v1/guilds/:guildId/users/:discordId/chips/grant', auth(['chips:grant']), async (req, res) => {
    const { guildId, discordId } = req.params;
    const { amount, reason } = req.body || {};
    if (req.apiKey.guildId !== guildId) return res.status(403).json({ error: 'guild_mismatch' });
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'bad_amount' });

    try {
        const { chips, house } = await transferFromHouseToUser(guildId, discordId, amount, reason || 'api grant', `api:${req.apiKey.id}`);
        res.json({ chips, house });
    } catch (e) {
        if (e.message === 'INSUFFICIENT_HOUSE') return res.status(409).json({ error: 'insufficient_house' });
        res.status(500).json({ error: 'server_error' });
    }
});

// 2.3b Add chips to the house (top up)
app.post('/api/v1/guilds/:guildId/house/add', auth(['house:add']), async (req, res) => {
    const { guildId } = req.params;
    const { amount, reason } = req.body || {};
    if (req.apiKey.guildId !== guildId) return res.status(403).json({ error: 'guild_mismatch' });
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'bad_amount' });
    try {
        const house = await addToHouse(guildId, amount, reason || 'api house add', `api:${req.apiKey.id}`);
        res.json({ house });
    } catch (e) {
        res.status(500).json({ error: 'server_error' });
    }
});

// 2.3c Take chips from a user to the house (admin action)
app.post('/api/v1/guilds/:guildId/users/:discordId/chips/take', auth(['chips:take']), async (req, res) => {
    const { guildId, discordId } = req.params;
    const { amount, reason } = req.body || {};
    if (req.apiKey.guildId !== guildId) return res.status(403).json({ error: 'guild_mismatch' });
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'bad_amount' });
    try {
        const { chips, house } = await takeFromUserToHouse(guildId, discordId, amount, reason || 'api take to house', `api:${req.apiKey.id}`);
        res.json({ chips, house });
    } catch (e) {
        if (e.message === 'INSUFFICIENT_USER') return res.status(409).json({ error: 'insufficient_user' });
        res.status(500).json({ error: 'server_error' });
    }
});

// 2.3d Burn chips from a user (admin-like)
app.post('/api/v1/guilds/:guildId/users/:discordId/chips/burn', auth(['chips:burn']), async (req, res) => {
    const { guildId, discordId } = req.params;
    const { amount, reason } = req.body || {};
    if (req.apiKey.guildId !== guildId) return res.status(403).json({ error: 'guild_mismatch' });
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'bad_amount' });
    try {
        const { chips } = await burnFromUser(guildId, discordId, amount, reason || 'api burn chips', `api:${req.apiKey.id}`);
        res.json({ chips });
    } catch (e) {
        if (e.message === 'INSUFFICIENT_USER') return res.status(409).json({ error: 'insufficient_user' });
        res.status(500).json({ error: 'server_error' });
    }
});

// 2.4 Set RideBus max bet for the guild (settings write)
import { setMaxRidebusBet } from './db.auto.mjs';
app.post('/api/v1/guilds/:guildId/ridebus/max-bet', auth(['settings:write']), async (req, res) => {
    const { guildId } = req.params;
    const { amount } = req.body || {};
    if (req.apiKey.guildId !== guildId) return res.status(403).json({ error: 'guild_mismatch' });
    if (!Number.isInteger(amount) || amount < 1) return res.status(400).json({ error: 'bad_amount' });

    const settings = await setMaxRidebusBet(guildId, amount);
    res.json({ max_ridebus_bet: settings.max_ridebus_bet });
});

// 2.5 Credits: grant to user
app.post('/api/v1/guilds/:guildId/users/:discordId/credits/grant', auth(['credit:grant']), async (req, res) => {
    const { guildId, discordId } = req.params;
    const { amount, reason } = req.body || {};
    if (req.apiKey.guildId !== guildId) return res.status(403).json({ error: 'guild_mismatch' });
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'bad_amount' });
    try {
        const { credits } = await grantCredits(guildId, discordId, amount, reason || 'api grant credits', `api:${req.apiKey.id}`);
        res.json({ credits });
    } catch (e) {
        res.status(500).json({ error: 'server_error' });
    }
});

// 2.6 Credits: burn from user
app.post('/api/v1/guilds/:guildId/users/:discordId/credits/burn', auth(['credit:burn']), async (req, res) => {
    const { guildId, discordId } = req.params;
    const { amount, reason } = req.body || {};
    if (req.apiKey.guildId !== guildId) return res.status(403).json({ error: 'guild_mismatch' });
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'bad_amount' });
    try {
        const { credits } = await burnCredits(guildId, discordId, amount, reason || 'api burn credits', `api:${req.apiKey.id}`);
        res.json({ credits });
    } catch (e) {
        if (e.message === 'INSUFFICIENT_USER_CREDITS') return res.status(409).json({ error: 'insufficient_user_credits' });
        res.status(500).json({ error: 'server_error' });
    }
});

// Start the HTTP server (choose your port)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
