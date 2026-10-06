import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '#generated/prisma/client';
import { env } from '#shared/env/index';

export { Prisma, PrismaClient };

// Client d'une transaction interactive : les repositories l'acceptent en
// paramètre optionnel pour participer à la transaction ouverte par un usecase,
// sans que celui-ci ne manipule Prisma directement.
export type TransactionClient = Prisma.TransactionClient;
export type DbClient = PrismaClient | TransactionClient;

export const prismaClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

// Prisma attend des octets sur un ArrayBuffer non partagé.
export function bytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}
