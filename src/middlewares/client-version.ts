import type { NextFunction, Request, Response } from 'express';
import { ClientTooOldError, ValidationError } from '#errors/app-error';
import { CLIENT_VERSION_PATTERN, isClientTooOld } from '#models/client-version.rules';
import { env } from '#shared/env/index';

// RT_69 : en-tête X-Client-Version — absent : compatible ; mal formé : 400 ;
// inférieur à MIN_CLIENT_VERSION : 426 CLIENT_TOO_OLD. Appliqué à toutes les
// routes /v1 (point 4 du plan, y compris celles dont le contrat omet le 426).
export function clientVersion(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get('X-Client-Version');
  if (header !== undefined && (header.length > 32 || !CLIENT_VERSION_PATTERN.test(header))) {
    next(new ValidationError([
      { field: 'headers.X-Client-Version', message: 'Format attendu : MAJEUR.MINEUR.CORRECTIF.' },
    ]));
    return;
  }
  if (isClientTooOld(header, env.MIN_CLIENT_VERSION)) {
    next(new ClientTooOldError());
    return;
  }
  next();
}
