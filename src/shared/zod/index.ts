import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { ErrorDetail } from '#errors/app-error';
import { ValidationError } from '#errors/app-error';

// RT_69 : messages d'erreur de validation en français.
z.config(z.locales.fr());

type Part = 'body' | 'params' | 'query' | 'headers';
type Schemas = Partial<Record<Part, z.ZodType>>;

export interface Validated {
  body?: unknown;
  params?: unknown;
  query?: unknown;
  headers?: unknown;
}

// Chemin d'un champ au format du contrat : `deployments[3].listId`.
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out.length === 0 ? String(key) : `.${String(key)}`;
  }
  return out;
}

export function zodDetails(error: z.ZodError, prefix: readonly PropertyKey[] = []): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: formatPath([...prefix, ...issue.path]) || '(corps)',
    message: issue.message,
  }));
}

// RT_69 : validation de chaque partie de la requête (corps, paramètres,
// requête, en-têtes). Toute erreur — Zod ou non — part au gestionnaire
// d'erreurs : la requête n'est jamais laissée en suspens.
export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated: Validated = { ...(res.locals.validated as Validated | undefined) };
      const details: ErrorDetail[] = [];
      for (const part of ['headers', 'params', 'query', 'body'] as const) {
        const schema = schemas[part];
        if (!schema) continue;
        const result = schema.safeParse(req[part] ?? (part === 'body' ? undefined : {}));
        if (result.success) validated[part] = result.data;
        else details.push(...zodDetails(result.error, part === 'body' ? [] : [part]));
      }
      if (details.length > 0) throw new ValidationError(details);
      res.locals.validated = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validated<T>(res: Response, part: Part): T {
  return (res.locals.validated as Validated)[part] as T;
}
