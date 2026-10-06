import type { Request, Response } from 'express';
import SyncUsecases from '#usecases/sync';
import { authOf } from '#middlewares/auth';
import { validated } from '#shared/zod/index';
import type { PullQuery } from '#schemas/sync/sync.schema';

export default class SyncController {
  private readonly usecase = new SyncUsecases();

  summary = async (_req: Request, res: Response) => {
    res.status(200).json(await this.usecase.summary(authOf(res).userId));
  };

  pull = async (_req: Request, res: Response) => {
    const { since, limit } = validated<PullQuery>(res, 'query');
    res.status(200).json(await this.usecase.pull(authOf(res).userId, since, limit));
  };
}
