import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { prisma } from './db.js';
import { attachSocket } from './sockets/index.js';
import { startSchedulers } from './jobs/scheduler.js';
import { getOrCreateOrgSettings } from './services/orgService.js';

// Safety net: never let a single bad request or a transient DB hiccup crash
// the whole API (which would take the entire team offline with 502 errors).
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

async function bootstrap() {
  await prisma.$connect();
  await getOrCreateOrgSettings();

  const app = createApp();
  const server = createServer(app);
  attachSocket(server, app);

  startSchedulers(app);

  server.listen(config.port, () => {
    console.log(`PulseTrack API on http://localhost:${config.port}`);
  });
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
