import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import IdempotencyRepository from '#repositories/idempotency';
import { IdempotencyKeyReusedError, ValidationError } from '#errors/app-error';
import { authOf } from '#middlewares/auth';
import { sha256 } from '#shared/crypto/index';

export interface IdempotencyContext {
  key: string;
  requestHash: Buffer;
}

const repository = new IdempotencyRepository();
const keySchema = z.uuid();

// RT_68 : en-tête Idempotency-Key sur la poussée et la résolution.
//  - même clé, même corps : la réponse initiale est rejouée telle quelle ;
//  - même clé, autre corps : 422 IDEMPOTENCY_KEY_REUSED ;
//  - clé nouvelle : le usecase enregistre sa réponse dans la transaction même
//    qui écrit les enregistrements (et revérifie la clé sous le verrou du
//    compte, pour deux tentatives concurrentes).
export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.get('Idempotency-Key');
  if (header === undefined) {
    next();
    return;
  }
  const parsed = keySchema.safeParse(header);
  if (!parsed.success) {
    throw new ValidationError([{ field: 'headers.Idempotency-Key', message: 'UUID attendu.' }]);
  }
  const key = parsed.data.toLowerCase();
  const requestHash = requestFingerprint(req.body);
  const stored = await repository.find(authOf(res).userId, key);
  if (stored) {
    if (!stored.requestHash.equals(requestHash)) throw new IdempotencyKeyReusedError();
    res.status(stored.status).json(stored.body);
    return;
  }
  const context: IdempotencyContext = { key, requestHash };
  res.locals.idempotency = context;
  next();
}

// Empreinte SHA-256 du corps analysé : la même requête JSON, quelle que soit
// sa mise en forme, a la même empreinte.
export function requestFingerprint(body: unknown): Buffer {
  return sha256(JSON.stringify(body ?? null));
}

export function idempotencyOf(res: Response): IdempotencyContext | undefined {
  return res.locals.idempotency as IdempotencyContext | undefined;
}
