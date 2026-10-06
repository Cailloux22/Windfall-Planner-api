import { prismaClient, type DbClient } from '#shared/prisma/index';

export default class HealthRepository {
  constructor(private readonly prisma: DbClient = prismaClient) {}

  async ping(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
