import { describe, expect, it } from 'vitest';
import {
  formatRevision,
  isSinceExpired,
  maxRevision,
  parseBaseToken,
  parsePullSince,
  parsePushSince,
} from '#models/revision.rules';

describe('RT_70 — révisions', () => {
  it('convertit sans perte au-delà de 2^53', () => {
    const big = '9007199254740993';
    expect(formatRevision(parsePullSince(big)!)).toBe(big);
    expect(formatRevision(parseBaseToken(big)!)).toBe(big);
  });

  it('since vide ou absent : pull complet ; poussée : 0', () => {
    expect(parsePullSince(undefined)).toBeNull();
    expect(parsePullSince('')).toBeNull();
    expect(parsePullSince('0')).toBe(0n);
    expect(parsePushSince('')).toBe(0n);
    expect(parsePushSince('42')).toBe(42n);
  });

  it('jeton de base absent ou null : création', () => {
    expect(parseBaseToken(undefined)).toBeNull();
    expect(parseBaseToken(null)).toBeNull();
  });

  it('410 strictement en dessous de la révision purgée', () => {
    expect(isSinceExpired(2n, 3n)).toBe(true);
    expect(isSinceExpired(3n, 3n)).toBe(false);
    expect(isSinceExpired(0n, 0n)).toBe(false);
  });

  it('maxRevision', () => {
    expect(maxRevision([])).toBe(0n);
    expect(maxRevision([3n, 10n, 7n])).toBe(10n);
  });
});
