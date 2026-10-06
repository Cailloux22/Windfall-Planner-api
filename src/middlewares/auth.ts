import type { NextFunction, Request, Response } from 'express';
import DeviceTokensRepository from '#repositories/device-tokens';
import { UnauthenticatedError } from '#errors/app-error';
import type { DevicePlatform } from '#models/device';
import { sha256 } from '#shared/crypto/index';

export interface AuthContext {
  userId: string;
  deviceId: string;
  deviceName: string;
  devicePlatform: DevicePlatform;
  tokenHash: Buffer;
}

const repository = new DeviceTokensRepository();

// Jeton base64url de 256 bits : 43 caractères ; borne large par sécurité.
const BEARER = /^Bearer ([A-Za-z0-9_-]{1,128})$/;

// RT_67 : `Authorization: Bearer <jeton>` → SHA-256 → device_tokens. Le
// jeton n'expire pas (RG_53) ; inconnu (déconnecté, compte supprimé) → 401.
export async function auth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const match = BEARER.exec(req.get('Authorization') ?? '');
  if (!match) throw new UnauthenticatedError();
  const tokenHash = sha256(match[1]!);
  const row = await repository.findByHash(tokenHash);
  if (!row) throw new UnauthenticatedError();
  const context: AuthContext = {
    userId: row.userId,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    devicePlatform: row.devicePlatform,
    tokenHash,
  };
  res.locals.auth = context;
  next();
}

export function authOf(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}
