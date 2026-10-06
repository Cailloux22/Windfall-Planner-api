import MaintenanceUsecases from '#usecases/maintenance';
import { prismaClient } from '#shared/prisma/index';

// RT_70 : purges périodiques, à planifier par l'hébergeur (une fois par jour
// suffit). `npm run purge` (build) ou `npm run purge:dev` (tsx).
async function main(): Promise<void> {
  try {
    const report = await new MaintenanceUsecases().purge();
    console.log(
      `Purge terminée : ${report.deletionTraces} trace(s) de suppression, ${report.idempotencyKeys} clé(s) d'idempotence.`,
    );
  } finally {
    await prismaClient.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Échec de la purge :', error instanceof Error ? error.name : typeof error);
  process.exitCode = 1;
});
