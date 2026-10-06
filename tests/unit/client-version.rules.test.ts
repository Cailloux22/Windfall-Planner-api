import { describe, expect, it } from 'vitest';
import { compareVersions, isClientTooOld, parseVersion } from '#models/client-version.rules';
import { normalizeEmail } from '#models/email.rules';

describe('RT_69 — version du client', () => {
  it('compare numériquement chaque composante', () => {
    expect(compareVersions(parseVersion('0.0.10')!, parseVersion('0.0.9')!)).toBe(1);
    expect(compareVersions(parseVersion('1.0.0')!, parseVersion('0.99.99')!)).toBe(1);
    expect(compareVersions(parseVersion('0.1.0')!, parseVersion('0.1.0')!)).toBe(0);
    expect(compareVersions(parseVersion('0.0.4')!, parseVersion('0.0.5')!)).toBe(-1);
  });

  it('refuse les formats autres que MAJEUR.MINEUR.CORRECTIF', () => {
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('1.2.3-beta')).toBeNull();
    expect(parseVersion('v1.2.3')).toBeNull();
  });

  it('tient un en-tête absent pour compatible', () => {
    expect(isClientTooOld(undefined, '9.9.9')).toBe(false);
  });

  it('ne refuse que strictement en dessous du minimum', () => {
    expect(isClientTooOld('0.0.4', '0.0.5')).toBe(true);
    expect(isClientTooOld('0.0.5', '0.0.5')).toBe(false);
    expect(isClientTooOld('0.1.0', '0.0.5')).toBe(false);
  });
});

describe('RG_50 — normalisation de l’email', () => {
  it('retire les espaces et passe en minuscules', () => {
    expect(normalizeEmail('  Joueur@Example.COM ')).toBe('joueur@example.com');
  });
});
