require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'prestamos-app',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      // The JSON state and concurrent document/transaction requests can exceed
      // 512 MB temporarily. Keep a bounded margin on the 8 GB production VPS.
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || '1536M',
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 4000,
        CHROMIUM_EXECUTABLE_PATH: '/usr/bin/google-chrome-stable',
      },
      error_file: './logs/prestamos-app-error.log',
      out_file: './logs/prestamos-app-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
