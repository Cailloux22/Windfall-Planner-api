import type { NextFunction, Request, Response } from 'express';

// RT_67/RT_70 : journal d'accès réduit à la méthode, au chemin (sans la
// chaîne de requête), au statut et à la durée. Jamais d'email, de jeton,
// d'en-tête Authorization ni de contenu d'enregistrement.
export function logger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const path = `${req.baseUrl}${req.path}`;
    console.log(`${req.method} ${path} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
  });
  next();
}
