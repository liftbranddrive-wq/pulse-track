/** PM2 config — always run from backend folder so .env loads */
module.exports = {
  apps: [
    {
      name: 'pulsetrack-api',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
