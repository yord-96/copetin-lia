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
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 4000,
      },
      error_file: './logs/prestamos-app-error.log',
      out_file: './logs/prestamos-app-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
