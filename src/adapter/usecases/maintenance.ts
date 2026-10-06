import MaintenanceRepository from '#repositories/maintenance';
import { DELETION_TRACE_RETENTION_DAYS, IDEMPOTENCY_RETENTION_HOURS } from '#constants/limits';

export interface PurgeReport {
  deletionTraces: number;
  idempotencyKeys: number;
}

export default class MaintenanceUsecases {
  private readonly repository = new MaintenanceRepository();

  // RT_70 : traces de suppression conservées 90 jours, clés d'idempotence
  // 24 heures.
  async purge(): Promise<PurgeReport> {
    const deletionTraces = await this.repository.purgeDeletionTraces(DELETION_TRACE_RETENTION_DAYS);
    const idempotencyKeys = await this.repository.purgeIdempotencyKeys(IDEMPOTENCY_RETENTION_HOURS);
    return { deletionTraces, idempotencyKeys };
  }
}
