/** PM2 process definition — see DEPLOYMENT.md. */
module.exports = {
  apps: [
    {
      name: 'tradeitx-api',
      script: 'node_modules/.bin/tsx',
      args: 'server/index.ts',
      cwd: __dirname,
      instances: 1,               // >1 requires a Socket.io Redis adapter
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      error_file: '/var/log/tradeitx/api-error.log',
      out_file: '/var/log/tradeitx/api-out.log',
      time: true,
    },
    {
      name: 'tradeitx-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '768M',
      env: { NODE_ENV: 'production' },
      error_file: '/var/log/tradeitx/web-error.log',
      out_file: '/var/log/tradeitx/web-out.log',
      time: true,
    },
  ],
};
