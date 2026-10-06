import { afterAll, beforeAll, beforeEach } from 'vitest';
import { resetRateLimits } from '#middlewares/rate-limit';
import { prismaClient } from '#shared/prisma/index';

// Base de test réinitialisée avant chaque fichier : les ON DELETE CASCADE
// vident device_tokens, records et idempotency_keys avec users.
beforeAll(async () => {
  await prismaClient.$executeRawUnsafe('TRUNCATE users CASCADE');
});

// RT_69 : compteurs de limitation remis à zéro entre deux tests (même IP).
beforeEach(async () => {
  await resetRateLimits();
});

afterAll(async () => {
  await prismaClient.$disconnect();
});
