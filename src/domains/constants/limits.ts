// RT_69 : seuils de limitation de débit.
const MINUTE = 60_000;

export const RATE_LIMITS = {
  // Connexion échouée, par adresse email : 5 par 15 minutes.
  loginFailedPerEmail: { limit: 5, windowMs: 15 * MINUTE },
  // Connexion, par adresse IP : 20 par 15 minutes.
  loginPerIp: { limit: 20, windowMs: 15 * MINUTE },
  // Inscription, par adresse IP : 5 par heure.
  registerPerIp: { limit: 5, windowMs: 60 * MINUTE },
  // Mot de passe erroné sur une action de RG_52, par compte : 5 par 15 minutes.
  accountWrongPasswordPerUser: { limit: 5, windowMs: 15 * MINUTE },
  // Toute autre requête, par jeton d'appareil : 120 par minute.
  perDeviceToken: { limit: 120, windowMs: MINUTE },
} as const;

// RT_69 / RT_68 : une poussée compte au plus 200 enregistrements (listes,
// déploiements et suppressions confondus) et 5 Mo.
export const PUSH_MAX_RECORDS = 200;
export const PUSH_MAX_BODY = '5mb';
// Point 5 du plan : corps des autres routes (identifiants, résolution).
export const DEFAULT_MAX_BODY = '64kb';
// La résolution porte une liste et un déploiement complets : même plafond
// que la poussée.
export const RESOLVE_MAX_BODY = '5mb';

// RT_68 : pull paginé, 200 enregistrements par défaut, 500 au plus.
export const PULL_DEFAULT_LIMIT = 200;
export const PULL_MAX_LIMIT = 500;

// RT_70 : traces de suppression conservées 90 jours, clés d'idempotence 24 heures.
export const DELETION_TRACE_RETENTION_DAYS = 90;
export const IDEMPOTENCY_RETENTION_HOURS = 24;

// RT_67 : jeton d'appareil de 256 bits.
export const DEVICE_TOKEN_BYTES = 32;
