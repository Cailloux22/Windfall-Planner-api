import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { DEVICE_TOKEN_BYTES } from '#constants/limits';

// RT_67 : jeton d'appareil — 256 bits aléatoires, encodés en base64url
// (43 caractères), renvoyé une seule fois au client.
export function generateDeviceToken(): string {
  return randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
}

// RT_67 : seul le SHA-256 du jeton est stocké. Sert aussi d'empreinte de
// corps pour l'idempotence (RT_68).
export function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

// RT_67 : mots de passe hachés en argon2id (format PHC, sel inclus).
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// RG_50 : un email inconnu coûte le même temps qu'un mot de passe erroné —
// on vérifie alors contre un hash factice, calculé une fois.
let dummyHash: Promise<string> | null = null;

export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
  return false;
}
