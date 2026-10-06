import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { BatchTooLargeError } from '#errors/app-error';

// Analyse du corps JSON avec une limite propre à la route. Un dépassement
// devient `BATCH_TOO_LARGE` (413) sur la poussée (RT_68/RT_69) et
// `VALIDATION_FAILED` (400) ailleurs (point 5 du plan, via le gestionnaire).
export function jsonBody(limit: string, options: { tooLargeIsBatch?: boolean } = {}): RequestHandler {
  const parser = express.json({ limit, strict: true });
  return (req: Request, res: Response, next: NextFunction) => {
    parser(req, res, (error?: unknown) => {
      if (
        options.tooLargeIsBatch
        && error instanceof Error
        && (error as { type?: string }).type === 'entity.too.large'
      ) {
        next(new BatchTooLargeError());
        return;
      }
      next(error);
    });
  };
}
