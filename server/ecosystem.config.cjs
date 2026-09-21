/**
 * PM2 — un proceso por modulo, igual que el resto de la plataforma.
 *   pm2 start ecosystem.config.cjs
 *
 * Las credenciales van en el entorno del servidor, nunca aqui.
 */
module.exports = {
  apps: [
    {
      name: 'flo',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        FLO_PUERTO: 3005,
      },
    },
  ],
};
