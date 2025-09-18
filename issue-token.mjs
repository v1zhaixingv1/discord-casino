import 'dotenv/config';
import { createApiKey } from './db.auto.mjs';
const key = createApiKey({
  name: 'PartnerA',
  guildId: process.env.GUILD_ID, // the guild your bot manages for them
  scopes: ['chips:grant','chips:burn','credit:grant','credit:burn','settings:write'] // tailor as needed
});
console.log('Give this token to partner:', key.token);
