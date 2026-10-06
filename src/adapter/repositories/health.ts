import { prismaClient, type DbClient } from '#shared/prisma/index';

export default class HealthRepository {
  constructor(private readonly prisma: DbClient = prismaClient) {}

  // Lève l'erreur de connexion telle quelle (démarrage, RT_70).
  async assertReachable(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async ping(): Promise<boolean> {
    try {
      await this.assertReachable();
      return true;
    } catch {
      return false;
    }
  }
}
