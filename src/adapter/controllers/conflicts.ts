import type { Request, Response } from 'express';
import ConflictsUsecases from '#usecases/conflicts';
import { authOf } from '#middlewares/auth';
import { idempotencyOf } from '#middlewares/idempotency';
import { validated } from '#shared/zod/index';
import type { ResolveBody } from '#schemas/sync/conflicts.schema';

export default class ConflictsController {
  private readonly usecase = new ConflictsUsecases();

  // 200 avec les changements à appliquer, ou 409 CONFLICT_STALE.
  resolve = async (_req: Request, res: Response) => {
    const body = validated<ResolveBody>(res, 'body');
    const outcome = await this.usecase.resolve(authOf(res), body, idempotencyOf(res));
    res.status(outcome.status).json(outcome.body);
  };
}
