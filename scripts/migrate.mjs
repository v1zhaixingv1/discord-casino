import 'dotenv/config';
import { readFileSync } from 'node:fs';

let Client;
try { ({ Client } = await import('pg')); }
catch { console.error('Missing dependency: pg. Run `npm install pg`'); process.exit(1); }

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set. Export it or add to .env'); process.exit(1); }

const ssl = process.env.PGSSLMODE ? { rejectUnauthorized: false } : undefined;

const sqlPath = new URL('../scripts/pg-schema.sql', import.meta.url);
const sql = readFileSync(sqlPath, 'utf8');

const client = new Client({ connectionString: url, ssl });

async function main() {
  try {
    await client.connect();
    await client.query(sql);
    console.log('Migration applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }
}

main();

