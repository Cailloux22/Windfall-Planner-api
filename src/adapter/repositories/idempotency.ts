import { bytes, prismaClient, type DbClient, type Prisma } from '#shared/prisma/index';

export interface StoredResponse {
  requestHash: Buffer;
  status: number;
  body: unknown;
}

export default class IdempotencyRepository {
  constructor(private readonly prisma: DbClient = prismaClient) {}

  async find(userId: string, key: string, tx?: DbClient): Promise<StoredResponse | null> {
    const row = await (tx ?? this.prisma).idempotencyKey.findUnique({
      where: { userId_key: { userId, key } },
    });
    if (!row) return null;
    return { requestHash: Buffer.from(row.requestHash), status: row.responseStatus, body: row.responseBody };
  }

  async create(userId: string, key: string, stored: StoredResponse, tx?: DbClient): Promise<void> {
    await (tx ?? this.prisma).idempotencyKey.create({
      data: {
        userId,
        key,
        requestHash: bytes(stored.requestHash),
        responseStatus: stored.status,
        responseBody: stored.body as Prisma.InputJsonValue,
      },
    });
  }
}
