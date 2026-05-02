module.exports = {
  apps: [
    {
      name: 'golden-crm-staging',
      cwd: '/opt/golden-crm/apps/staging',
      script: './node_modules/tsx/dist/cli.mjs',
      args: './packages/api/index.ts',
      interpreter: 'node',

      env_file: '/etc/golden-crm/staging.env',

      env: {
        NODE_ENV: 'production',
      },

      max_restarts: 10,
      restart_delay: 2000,
      autorestart: true,
      watch: false,

      out_file: '/var/log/golden-crm/staging/staging-out.log',
      error_file: '/var/log/golden-crm/staging/staging-error.log',
      merge_logs: true,
    },
  ],
};
