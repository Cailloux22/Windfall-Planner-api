import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '#shared/prisma/index';
import { zodDetails } from '#shared/zod/index';
import {
  AppError,
  EmailTakenError,
  InternalError,
  RateLimitedError,
  ValidationError,
} from '#errors/app-error';

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return error instanceof Error && typeof (error as BodyParserError).type === 'string'
    && typeof (error as BodyParserError).status === 'number';
}

function toAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) return new ValidationError(zodDetails(error));
  if (isBodyParserError(error)) {
    // JSON mal formé, corps trop gros hors poussée (point 5 du plan),
    // encodage non géré : la requête est non conforme.
    if (error.type === 'entity.parse.failed') {
      return new ValidationError([{ field: '(corps)', message: 'JSON mal formé.' }]);
    }
    if (error.type === 'entity.too.large') {
      return new ValidationError([{ field: '(corps)', message: 'Corps de requête trop volumineux.' }]);
    }
    return new ValidationError([{ field: '(corps)', message: 'Corps de requête illisible.' }]);
  }
  // RG_50 : contrainte d'unicité de l'email violée (inscription ou
  // changement d'adresse concurrents).
  if (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === 'P2002'
    && JSON.stringify(error.meta ?? {}).includes('email')
  ) {
    return new EmailTakenError();
  }
  return null;
}

// RT_67/RT_70 : rien de sensible dans les journaux. Les erreurs Prisma
// recopient les arguments de la requête (email, contenu) dans leur message :
// seuls leur nom, leur code et la pile sont journalisés.
function logUnexpected(error: unknown): void {
  if (error instanceof Error) {
    const isPrisma = error.name.startsWith('PrismaClient');
    const code = (error as { code?: unknown }).code;
    const frames = (error.stack ?? '').split('\n').filter((line) => line.trimStart().startsWith('at '));
    const suffix = typeof code === 'string' ? ` [${code}]` : '';
    const head = isPrisma ? `${error.name}${suffix}` : `${error.name}: ${error.message}`;
    console.error([head, ...frames].join('\n'));
  } else {
    console.error('Erreur non standard levée :', typeof error);
  }
}

// Monté en dernier dans app.ts.
export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  let appError = toAppError(error);
  if (!appError) {
    logUnexpected(error);
    appError = new InternalError();
  }
  if (appError instanceof RateLimitedError) {
    // RT_69 : délai d'attente en secondes.
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }
  res.status(appError.status).json(appError.toBody());
}
