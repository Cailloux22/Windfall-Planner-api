import type { Request, Response } from 'express';
import HealthUsecases from '#usecases/health';

export default class HealthController {
  private readonly usecase = new HealthUsecases();

  // Hors /v1 et non authentifié : sonde de l'hébergeur, 503 si la base ne
  // répond pas.
  check = async (_req: Request, res: Response) => {
    const report = await this.usecase.check();
    res.status(report.database === 'up' ? 200 : 503).json(report);
  };
}
