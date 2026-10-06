import type { Request, Response } from 'express';
import SyncUsecases from '#usecases/sync';
import { authOf } from '#middlewares/auth';
import { idempotencyOf } from '#middlewares/idempotency';
import { validated } from '#shared/zod/index';
import type { PullQuery, PushBody } from '#schemas/sync/sync.schema';

export default class SyncController {
  private readonly usecase = new SyncUsecases();

  summary = async (_req: Request, res: Response) => {
    res.status(200).json(await this.usecase.summary(authOf(res).userId));
  };

  pull = async (_req: Request, res: Response) => {
    const { since, limit } = validated<PullQuery>(res, 'query');
    res.status(200).json(await this.usecase.pull(authOf(res).userId, since, limit));
  };

  push = async (_req: Request, res: Response) => {
    const body = validated<PushBody>(res, 'body');
    const outcome = await this.usecase.push(authOf(res), body, idempotencyOf(res));
    res.status(outcome.status).json(outcome.body);
  };
}
