#!/usr/bin/env node
import crypto from 'node:crypto';
import 'dotenv/config';
import { createApiKey, deleteApiKey, listApiKeys } from './db.auto.mjs';

function usage() {
  console.log(`Usage:
  node api-cli.mjs create --guild <guildId> [--scopes <csv>] [--token <token>]
  node api-cli.mjs delete --token <token>
  node api-cli.mjs list [--guild <guildId>]

Scopes:
  comma-separated, e.g. chips:grant,settings:write
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return usage();

  try {
    if (cmd === 'create') {
      const guildId = args.guild || args.g;
      const scopes = args.scopes || '';
      const token = args.token || crypto.randomBytes(24).toString('base64url');
      if (!guildId) throw new Error('Missing --guild');
      const row = await createApiKey({ token, guildId, scopes });
      console.log('Created API key:', row);
      return;
    }

    if (cmd === 'delete') {
      const token = args.token;
      if (!token) throw new Error('Missing --token');
      const res = await deleteApiKey(token);
      const deleted = (res && typeof res === 'object' && 'deleted' in res)
        ? Number(res.deleted || 0)
        : (res ? 1 : 0);
      console.log(deleted ? 'Deleted API key.' : 'No matching API key.');
      return;
    }

    if (cmd === 'list') {
      const guildId = args.guild || null;
      const rows = await listApiKeys(guildId);
      console.table(rows);
      return;
    }

    usage();
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  }
}

main();
