// Runs Cloud SQL Auth Proxy using values from .env
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const instance = process.env.INSTANCE_CONNECTION_NAME || process.env.CSQL_PROXY_INSTANCE_CONNECTION_NAME;
const creds = process.env.PROXY_CREDENTIALS_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS || resolve(dirname(__dirname), 'sql-proxy.json');
const addr = process.env.SQL_PROXY_ADDRESS || '127.0.0.1';
const port = process.env.SQL_PROXY_PORT || '5432';

if (!instance) {
  console.error('Missing INSTANCE_CONNECTION_NAME. Add it to .env, e.g.:');
  console.error('  INSTANCE_CONNECTION_NAME=project:region:instance');
  process.exit(1);
}

const proxyPath = resolve(dirname(__dirname), 'cloud-sql-proxy');
const args = [
  `--credentials-file=${creds}`,
  `--address=${addr}`,
  `--port=${port}`,
  instance
];

console.log(`Starting Cloud SQL Proxy on ${addr}:${port} for ${instance}`);
const child = spawn(proxyPath, args, { stdio: 'inherit' });
child.on('exit', (code, sig) => {
  if (sig) console.log(`Proxy exited due to signal ${sig}`);
  else console.log(`Proxy exited with code ${code}`);
});

