import 'dotenv/config';

let Client;
try { ({ Client } = await import('pg')); }
catch { console.error('Missing dependency: pg. Run `npm install pg`'); process.exit(1); }

const original = process.env.DATABASE_URL;
if (!original) {
  console.error('DATABASE_URL is not set. Export it or add to .env');
  process.exit(1);
}

function buildAdminUrl(urlStr) {
  // Use WHATWG URL to swap the database name to 'postgres'
  const u = new URL(urlStr);
  // path is like '/dbname' (may be empty or '/'), normalize to '/postgres'
  u.pathname = '/postgres';
  return u.toString();
}

function dbNameFromUrl(urlStr) {
  const u = new URL(urlStr);
  const name = (u.pathname || '').replace(/^\//, '');
  return name || null;
}

function quoteIdent(ident) {
  return '"' + String(ident).replaceAll('"', '""') + '"';
}

const targetDb = dbNameFromUrl(original);
if (!targetDb) {
  console.error('Could not determine database name from DATABASE_URL');
  process.exit(1);
}

const adminUrl = buildAdminUrl(original);
const ssl = process.env.PGSSLMODE ? { rejectUnauthorized: false } : undefined;

const client = new Client({ connectionString: adminUrl, ssl });

async function main() {
  try {
    await client.connect();
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
    if (rows.length) {
      console.log(`Database ${targetDb} already exists.`);
      return;
    }
    await client.query(`CREATE DATABASE ${quoteIdent(targetDb)}`);
    console.log(`Database ${targetDb} created.`);
  } catch (e) {
    console.error('Create database failed:', e.message);
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }
}

main();

