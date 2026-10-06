import { prismaClient, type DbClient } from '#shared/prisma/index';

export default class MaintenanceRepository {
  constructor(private readonly prisma: DbClient = prismaClient) {}

  // RT_70 : purge des traces de suppression plus anciennes que `days` jours,
  // en retenant par compte la plus haute révision purgée (un `since`
  // inférieur reçoit 410). Requête de specification/schema.sql.
  async purgeDeletionTraces(days: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ purged: bigint }[]>`
      WITH purged AS (
        DELETE FROM records
        WHERE deleted AND deleted_at < now() - make_interval(days => ${days}::int)
        RETURNING user_id, revision
      ),
      bumped AS (
        UPDATE users u
        SET purged_revision = GREATEST(u.purged_revision, p.max_revision)
        FROM (SELECT user_id, max(revision) AS max_revision FROM purged GROUP BY user_id) p
        WHERE u.id = p.user_id
      )
      SELECT count(*) AS purged FROM purged`;
    return Number(rows[0]?.purged ?? 0n);
  }

  // RT_70 : purge des clés d'idempotence plus anciennes que `hours` heures.
  async purgeIdempotencyKeys(hours: number): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(hours => ${hours}::int)`;
  }
}
