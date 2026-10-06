import { env } from '#shared/env/index';
import { prismaClient } from '#shared/prisma/index';
import { createApp } from '#main/app';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Serveur de synchronisation à l'écoute sur http://localhost:${env.PORT}/v1`);
});

// Arrêt propre : on cesse d'accepter des connexions, on laisse finir celles
// en cours, puis on ferme le pool de la base.
let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} reçu, arrêt en cours…`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close(() => {
    prismaClient
      .$disconnect()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
