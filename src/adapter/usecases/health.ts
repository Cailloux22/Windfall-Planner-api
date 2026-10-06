import HealthRepository from '#repositories/health';
import { SERVER_VERSION } from '#constants/server';

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  database: 'up' | 'down';
}

export default class HealthUsecases {
  private readonly repository = new HealthRepository();

  // RT_70 « Démarrage » : la base doit répondre avant que le serveur écoute.
  async assertDatabaseReachable(): Promise<void> {
    await this.repository.assertReachable();
  }

  async check(): Promise<HealthReport> {
    const up = await this.repository.ping();
    return { status: up ? 'ok' : 'degraded', version: SERVER_VERSION, database: up ? 'up' : 'down' };
  }
}
