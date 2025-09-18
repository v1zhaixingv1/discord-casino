module.exports = {
  apps: [
    {
      name: 'cloud-sql-proxy',
      script: 'node',
      args: 'scripts/sql-proxy.mjs',
      cwd: __dirname,
      env: {
        // Set these in .env; dotenv is loaded by the script itself
        // INSTANCE_CONNECTION_NAME: 'project:region:instance',
        // PROXY_CREDENTIALS_FILE: './sql-proxy.json',
        // SQL_PROXY_ADDRESS: '127.0.0.1',
        // SQL_PROXY_PORT: '5432'
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};

