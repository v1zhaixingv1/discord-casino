# Discord Casino Bot

Discord bot for a lightweight casino economy with two currencies and multiple mini‑games.

- Chips: backed by a shared House bank and used for all payouts.
- Credits: personal, non‑house currency; burned on losses when used to stake.

Includes slash commands for balances, leaderboards, admin operations, cash/request workflows, logging, and the following games: Ride the Bus, Blackjack, Slots, Roulette, Dice War, and a Texas Hold’em table.

## Games

All games except Texas Hold’em use Credits‑first staking: your bet draws from your Credits balance first, with any remainder automatically covered by Chips. On loss, the Credits portion is burned; if Chips were used, that portion is transferred to the House. Winnings are always paid in Chips from the House.

### Casino Category & Channel Policy
- Configure a dedicated category via `/setcasinocategory category:<#Category>`.
- Game slash commands (RideBus, Blackjack, Slots, Roulette, Hold’em) only run inside channels/threads under this category. Interactions for an already-started game continue to work where they began.
- Hold’em creates a temporary per‑table text channel under this category and removes it automatically when the table idles out.

### Ride the Bus
- Clear Q1–Q4 to win up to 10×; can cash out after Q3 (pays the Q3 pot).
- House cover check ensures the House can pay a max win before starting.
- Per‑guild max bet (default 1000) via `/setmaxbet game:<Ride the Bus> amount:<int>`.

### Blackjack
- Two tables: `HIGH` (min 100, H17) and `LOW` (max 99, S17).
- Supports hit/stand/double; split when allowed and affordable.
- House cover check for max exposure (stake + potential 2× payout).

### Slots
- 5×3 video slot with 20 fixed lines, wilds and scatter.
- Total bet is split evenly per line; results floored to whole credits.
- Interactive “Spin Again” and “Pay Table” buttons.

### Roulette (American)
- Add multiple bets interactively, then confirm to spin.
- Supports Red/Black, Odd/Even, Low/High, Dozens, Columns, Straight (35:1).

### Dice War
- Simple 2d6 vs the House: if you roll any doubles and beat the House, your win is doubled (ties go to the House).
- Credits‑first staking with house cover check.
- “Play Again” button repeats the same bet.
- Session timeout: expires after 2 minutes of inactivity; any interaction (e.g., Play Again) resets the timer. On expiry, the session ends and a summary replaces the last message.

### Texas Hold’em
- Multi‑player table with host/seat/start, betting actions, and ephemerally peeking your hole cards.
- Automatic turn timers with warnings, host inactivity auto‑kick (10 min), and table auto‑close when empty/idle.
- Side pots, all‑in handling, proper betting flow, and hand evaluation.
- Rake: set default percent per guild via `/setrake percent:<number>` (admin). Cap is always the table’s Max buy‑in. New tables use this default; the creation summary shows it and results display rake taken.
- Per‑table channels: when a preset is chosen, the bot creates `#holdem-table-N` under the casino category (next available number), posts the table card with the host’s mention above it, and deletes the channel once the table times out.
- Presets & Custom: choose a preset (1/2, 5/10, 20/40) or pick Custom to enter Small Blind (BB auto‑set to 2×SB), Min buy‑in, and Max buy‑in. The options message is edited to summarize who created the table, where, and the configuration.
- Results UX: winners list includes the winning hand and relevant kickers; a Leave button appears so players can exit before the next hand.
- Betting UI nuance: preflop, players who did not post a blind see “Bet”; SB/BB (and all post‑flop streets) show “Raise”.
- Chips-only buy-ins use per-table escrow; hand commits move escrow to the pot; payouts and rake settle to players and the house.

## Requests & Logging

- Requests: users can submit `/request type:<Buy In|Cash Out> amount:<int>`; posts to a configured channel with admin buttons to Take/Complete/Reject. Optional cooldown via `/requesttimer seconds:<int>`.
- Log channels:
  - Game logs (e.g., session end) via `/setgamelogchannel channel:<#>`.
  - Cash logs (admin and request settlements) via `/setcashlog channel:<#>`.
- Leaderboard: `/leaderboard [limit]` lists top chip holders.

## Command Catalogue

Player
- `/help`, `/ping`, `/balance [user]`, `/leaderboard [limit]`
- `/ridebus bet:<int>`, `/blackjack table:<High|Low> bet:<int>`, `/slots bet:<int>`, `/roulette`, `/holdem`

Moderator (requires Discord Admin or moderator perms/roles)
- House & chips: `/housebalance`, `/houseadd`, `/houseremove`, `/givechips`, `/takechips`, `/buyin`, `/cashout`
- Credits: `/givecredits`, `/takecredits`
- Logging: `/setgamelogchannel`, `/setcashlog`
- Requests: `/setrequestchannel`, `/requesttimer`
- Game limits: `/setmaxbet game:<Ride the Bus> amount:<int>`
- Roles: `/addmodrole role:<Role>`, `/removemodrole role:<Role>`
- Maintenance (OWNER): `/resetallbalance`
- Hold’em table (admin): `/setrake percent:<number> [cap:<int>]`
 - Setup: `/setcasinocategory category:<#Category>`

## Sessions & Timeouts

- Active sessions expire after 2 minutes of inactivity; the last session message is replaced with a summary card. Game logs are posted to the configured channel.
- Roulette/Slots/Blackjack/RideBus/Dice War sessions track games played and net; RideBus/Blackjack burn any Credits stake on expiration.

Tip: Dice War “Play Again” is only available to the original player and only while the session is active (within 2 minutes of the last action).

## Requirements
- Node.js 18+
- A Discord application and bot token
- A test guild (server) where you can register commands
 - Discord permissions: the bot needs, at minimum
   - Manage Channels (to create/delete Hold’em table channels)
   - View Channel and Send Messages (in game/log/cash/request channels)
   - Read Message History and Embed Links recommended

## Setup
1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies: `npm install`
3. Register slash commands globally: `npm run deploy`
4. Start the bot: `npm start`
5. As an admin, set the casino category: `/setcasinocategory category:<#Category>` and ensure the bot has the permissions above in that category.

## Environment
See `.env.example` for all variables.

Required
- `DISCORD_TOKEN` – Your bot token
- `CLIENT_ID` – Application (client) ID
- `GUILD_ID` – Primary guild ID for database defaults and API helpers

Optional
- `DB_PATH` – SQLite file path (default `./casino.db`)
- `MOD_ROLE_IDS` – Comma‑separated role IDs that count as moderators; `ADMIN_ROLE_IDS` is supported as a legacy fallback
- `OWNER_USER_IDS` – Comma‑separated user IDs with OWNER override for maintenance commands

Tip: verify env parsing with `npm run env`.

## Permissions & Roles

- Moderator check order: Guild Owner → Discord Moderator perms (Moderate/Kick/Ban/Manage Messages) → IDs in `MOD_ROLE_IDS` (or legacy `ADMIN_ROLE_IDS`) → roles stored in DB (via `/addmodrole`).
- OWNER override: guild owner, IDs in `OWNER_USER_IDS`, or a role named `OWNER` (case‑insensitive) for certain maintenance commands.

## Scripts
- `npm start` – Run the bot (`index.mjs`)
- `npm run deploy` – Register global slash commands
- `npm run env` – Print a redacted snapshot of env values
- `npm run api:keys` – Manage HTTP API keys (create/list/delete)
- `npm run restart` – Re‑deploy commands and restart a managed process (systemd/PM2)

## Updating Commands
- After changing slash commands in `deploy-commands.mjs`, run `npm run deploy` to push updates globally.
- Restart the bot only if you changed runtime logic (e.g., `index.mjs`).
- Discord may take up to an hour to propagate global updates.

## Restarting for Updates
- Shortcut: `npm run restart` (uses systemd service `discord-casino` by default; override with `npm run restart -- my-service` or `SERVICE_NAME=my-service npm run restart`).
- Local/dev: stop the running process (Ctrl+C) and run `npm start` again.
- PM2: `pm2 restart discord-casino` (or `pm2 start npm --name "discord-casino" -- run start`).
- systemd: `sudo systemctl restart discord-casino` (service name may vary).
- Docker: rebuild the image and recreate the container (e.g., `docker compose up -d --build`).

Tip: add a sudoers rule to avoid password prompts for restarts (edit with `sudo visudo`):

```
bot ALL=NOPASSWD: /bin/systemctl restart discord-casino, /bin/systemctl start discord-casino, /bin/systemctl status discord-casino
```

Adjust the username and service as needed.

## Notes
- Commands are registered globally (see `deploy-commands.mjs`). Expect up to an hour for propagation.
- SQLite runs in WAL mode; the DB file is `casino.db` by default. Avoid committing `.env`, `casino.db*`, and any `*.bak` files.
- `/setcasinocategory` is the canonical casino category command.

### Security
- Treat `.env` (and any JSON credential files) as secrets: rotate your Discord bot token immediately if it’s ever checked into Git or shared.
- Run `npm run api:keys` to manage API tokens; rotate and delete unused tokens regularly.

### Keep Cloud SQL Proxy running
- Systemd (recommended on servers): copy `scripts/systemd/cloud-sql-proxy.service` to `/etc/systemd/system/`, then `sudo systemctl daemon-reload && sudo systemctl enable --now cloud-sql-proxy`.
- PM2 (no sudo; persists after you close the shell): `npx pm2 start ecosystem-proxy.config.js && npx pm2 save`. For boot persistence: `pm2 startup` (may require sudo) then re-run the displayed command.

### Run the bot as a systemd service
1) Copy the unit file and enable it:
   - `sudo cp scripts/systemd/discord-casino.service /etc/systemd/system/discord-casino.service`
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable --now discord-casino`
2) Check status and logs:
   - `systemctl status discord-casino`
   - `journalctl -u discord-casino -f`
3) Ensure your `.env` contains required vars (see `.env.example`):
   - `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, etc.
   - For Postgres: `DB_DRIVER=pg`, `DATABASE_URL=...`
   - Proxy should also be enabled via the separate `cloud-sql-proxy.service`.

## HTTP API

Optional Express API (`api.mjs`) for integrations (dashboards, partner tools). Uses bearer token auth, scopes, and basic hardening (helmet, CORS, rate limit).

Auth
- Header: `Authorization: Bearer <token>`
- Manage tokens with CLI: `npm run api:keys`
  - Create: `node api-cli.mjs create --guild <GUILD_ID> --scopes chips:grant,settings:write`
  - List: `node api-cli.mjs list [--guild <GUILD_ID>]`
  - Delete: `node api-cli.mjs delete --token <token>`

Scopes
- `chips:grant`, `chips:take`, `chips:burn`, `house:add`
- `credit:grant`, `credit:burn`
- `settings:write`

Endpoints (v1)
- `GET /api/v1/ping` – Health check
- `GET /api/v1/guilds/:guildId/users/:discordId/balance` – Get a user’s balances
- `POST /api/v1/guilds/:guildId/users/:discordId/chips/grant` – Grant chips (scope: `chips:grant`)
- `POST /api/v1/guilds/:guildId/users/:discordId/chips/take` – Take chips to house (scope: `chips:take`)
- `POST /api/v1/guilds/:guildId/users/:discordId/chips/burn` – Burn chips (scope: `chips:burn`)
- `POST /api/v1/guilds/:guildId/house/add` – Add chips to house (scope: `house:add`)
- `POST /api/v1/guilds/:guildId/users/:discordId/credits/grant` – Grant Credits (scope: `credit:grant`)
- `POST /api/v1/guilds/:guildId/users/:discordId/credits/burn` – Burn Credits (scope: `credit:burn`)
- `POST /api/v1/guilds/:guildId/ridebus/max-bet` – Set Ride the Bus max bet (scope: `settings:write`)

All write endpoints require the `:guildId` in the URL to match the API key’s guild.

Example

```
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"amount": 500, "reason": "welcome"}' \
  http://localhost:3000/api/v1/guilds/$GUILD_ID/users/123456789012345678/chips/grant
```

Run locally: `node api.mjs` (port `3000` by default; override with `PORT`).
