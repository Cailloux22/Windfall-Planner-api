import { prismaClient, Prisma, type TransactionClient } from '#shared/prisma/index';

export type { TransactionClient };

export interface TransactionOptions {
  isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  timeoutMs?: number;
}

// Ouverture d'une transaction interactive pour un usecase : le usecase
// orchestre, les repositories reçoivent le client de transaction (`tx`).
export function runInTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return prismaClient.$transaction(fn, {
    isolationLevel: options.isolationLevel
      ? Prisma.TransactionIsolationLevel[options.isolationLevel]
      : Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: options.timeoutMs ?? 30_000,
    maxWait: 10_000,
  });
}
