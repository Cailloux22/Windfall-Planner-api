import { afterAll, beforeAll } from 'vitest';
import { prismaClient } from '#shared/prisma/index';

// Base de test réinitialisée avant chaque fichier : les ON DELETE CASCADE
// vident device_tokens, records et idempotency_keys avec users.
beforeAll(async () => {
  await prismaClient.$executeRawUnsafe('TRUNCATE users CASCADE');
});

afterAll(async () => {
  await prismaClient.$disconnect();
});
