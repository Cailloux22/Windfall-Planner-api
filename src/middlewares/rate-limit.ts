import type { NextFunction, Request, Response } from 'express';
import { ipKeyGenerator, MemoryStore, rateLimit, type Options } from 'express-rate-limit';
import { RATE_LIMITS } from '#constants/limits';
import { RateLimitedError } from '#errors/app-error';
import { normalizeEmail } from '#models/email.rules';
import type { AuthContext } from '#middlewares/auth';

// RT_69 : limitation de débit, réponse 429 RATE_LIMITED + Retry-After.
//
// Store mémoire : les compteurs vivent dans le processus. C'est exact pour
// une instance unique ; avec plusieurs instances derrière un répartiteur,
// chaque instance compterait de son côté (seuils multipliés) — il faudrait
// alors un store partagé (Redis, PostgreSQL…).

const stores: MemoryStore[] = [];

interface LimiterConfig {
  limit: number;
  windowMs: number;
}

function limiter(config: LimiterConfig, options: Partial<Options>) {
  const store = new MemoryStore();
  stores.push(store);
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    store,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (req: Request, _res: Response, next: NextFunction) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const seconds = resetTime ? (resetTime.getTime() - Date.now()) / 1000 : config.windowMs / 1000;
      next(new RateLimitedError(seconds));
    },
    ...options,
  });
}

function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? 'inconnue');
}

function authOf(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}

// RT_69 : connexion, par adresse IP — 20 par 15 minutes, toutes tentatives.
export const loginPerIp = limiter(RATE_LIMITS.loginPerIp, {
  keyGenerator: (req) => `login-ip:${clientIp(req)}`,
});

// RT_69/RG_50 : connexion échouée, par adresse email — 5 par 15 minutes.
// Seuls les échecs (401) comptent ; au-delà, toute tentative pour cette
// adresse est refusée, même avec le bon mot de passe.
export const loginFailedPerEmail = limiter(RATE_LIMITS.loginFailedPerEmail, {
  keyGenerator: (req) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return `login-email:${typeof email === 'string' ? normalizeEmail(email) : ''}`;
  },
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
});

// RT_69 : inscription, par adresse IP — 5 par heure.
export const registerPerIp = limiter(RATE_LIMITS.registerPerIp, {
  keyGenerator: (req) => `register-ip:${clientIp(req)}`,
});

// RT_69/RG_52 : mot de passe erroné sur une action de compte, par compte —
// 5 par 15 minutes, compteur commun aux trois actions.
export const accountWrongPassword = limiter(RATE_LIMITS.accountWrongPasswordPerUser, {
  keyGenerator: (_req, res) => `account:${authOf(res).userId}`,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
});

// RT_69 : toute autre requête, par jeton d'appareil — 120 par minute. La clé
// est le hash du jeton, jamais le jeton lui-même.
export const perDeviceToken = limiter(RATE_LIMITS.perDeviceToken, {
  keyGenerator: (_req, res) => `token:${authOf(res).tokenHash.toString('hex')}`,
});

// Tests : remet tous les compteurs à zéro.
export async function resetRateLimits(): Promise<void> {
  await Promise.all(stores.map((store) => store.resetAll()));
}
