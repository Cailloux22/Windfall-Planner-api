import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AppError,
  RateLimitedError,
  ValidationError,
} from '#errors/app-error';
import { formatPath, zodDetails } from '#shared/zod/index';

describe('AppError', () => {
  it('conserve la sous-classe et son prototype', () => {
    const error = new RateLimitedError(0.2);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('RateLimitedError');
    expect(error.status).toBe(429);
    // RT_69 : Retry-After d'au moins une seconde.
    expect(error.retryAfterSeconds).toBe(1);
  });

  it('produit le corps Error du contrat', () => {
    const error = new ValidationError([{ field: 'password', message: 'trop court' }]);
    expect(error.toBody()).toEqual({
      code: 'VALIDATION_FAILED',
      message: expect.any(String) as string,
      details: [{ field: 'password', message: 'trop court' }],
    });
  });

  it('borne details à 50 éléments', () => {
    const details = Array.from({ length: 80 }, (_, i) => ({ field: `f${i}`, message: 'x' }));
    expect(new ValidationError(details).details).toHaveLength(50);
  });
});

describe('formatPath', () => {
  it('écrit les chemins au format du contrat', () => {
    expect(formatPath(['deployments', 3, 'listId'])).toBe('deployments[3].listId');
    expect(formatPath(['password'])).toBe('password');
    expect(formatPath([])).toBe('');
  });

  it('traduit les erreurs Zod en détails', () => {
    const result = z.object({ a: z.array(z.string()) }).safeParse({ a: ['x', 1] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodDetails(result.error, ['query'])[0]?.field).toBe('query.a[1]');
    }
  });
});
