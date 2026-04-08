module.exports = {
  apps: [
    {
      name: 'golden-crm',
      cwd: __dirname,
      script: './node_modules/tsx/dist/cli.mjs',
      args: './packages/api/index.ts',
      interpreter: 'node',

      // Load production secrets from the system env file.
      // Populate /etc/golden-crm/production.env before first start.
      // See docs/SERVER-DEPLOY.md for the required variables.
      env_file: '/etc/golden-crm/production.env',

      // Static env overrides applied on top of env_file:
      env: {
        NODE_ENV: 'production',
      },

      // Restart only on crash, not on memory bloat signals.
      max_restarts: 10,
      restart_delay: 2000,
      autorestart: true,

      // Never watch files — file-watch restarts are unsafe in production.
      watch: false,

      // Write logs to predictable paths.
      out_file: '/var/log/golden-crm/out.log',
      error_file: '/var/log/golden-crm/error.log',
      merge_logs: true,
    },
  ],
};
