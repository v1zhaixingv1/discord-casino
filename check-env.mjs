import 'dotenv/config';
console.log({
  DISCORD_TOKEN: (process.env.DISCORD_TOKEN||'').slice(0,10) + '…',
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID
});
