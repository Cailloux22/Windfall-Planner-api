import { env } from '#shared/env/index';
import { prismaClient } from '#shared/prisma/index';
import { createApp } from '#main/app';
import HealthUsecases from '#usecases/health';
import { DB_CONNECT_TIMEOUT_MS } from '#constants/limits';

// RT_70 « Démarrage » : sans base joignable, le serveur s'arrête avant
// d'écouter. Seul le code d'erreur est journalisé : le message de Prisma ou
// de pg peut contenir l'adresse de connexion.
try {
  await new HealthUsecases().assertDatabaseReachable();
} catch (error) {
  // pg signale le délai dépassé par une Error sans code.
  const code = (error as { code?: unknown }).code;
  const timedOut = error instanceof Error && /connection timeout/.test(error.message);
  const cause = typeof code === 'string'
    ? code
    : timedOut
      ? `aucune connexion en ${DB_CONNECT_TIMEOUT_MS / 1000} s`
      : error instanceof Error ? error.name : typeof error;
  console.error(`Base de données injoignable (${cause}) : arrêt du serveur.`);
  await prismaClient.$disconnect().catch(() => undefined);
  process.exit(1);
}

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
