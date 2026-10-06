// RT_69 : un corps d'erreur unique pour toutes les routes — `code` énuméré,
// sur lequel le client décide, et `message` en français, affichable tel quel.
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'BATCH_TOO_LARGE',
  'SYNC_TOKEN_EXPIRED',
  'CONFLICT_STALE',
  'IDEMPOTENCY_KEY_REUSED',
  'CLIENT_TOO_OLD',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, status: number, message: string, details?: ErrorDetail[]) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toBody(): ErrorBody {
    return this.details
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

export class ValidationError extends AppError {
  constructor(details: ErrorDetail[], message = 'La requête contient des données invalides.') {
    super('VALIDATION_FAILED', 400, message, details.slice(0, 50));
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Adresse email ou mot de passe incorrect.') {
    super('INVALID_CREDENTIALS', 401, message);
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super('UNAUTHENTICATED', 401, 'Cet appareil n’est plus connecté au compte.');
  }
}

export class EmailTakenError extends AppError {
  constructor() {
    super('EMAIL_TAKEN', 409, 'Un compte existe déjà pour cette adresse email.');
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
    super('RATE_LIMITED', 429, `Trop de tentatives. Réessayez dans ${formatDelay(seconds)}.`);
    this.retryAfterSeconds = seconds;
  }
}

export class BatchTooLargeError extends AppError {
  constructor() {
    super(
      'BATCH_TOO_LARGE',
      413,
      'La synchronisation envoie trop de données à la fois (200 enregistrements ou 5 Mo au plus).',
    );
  }
}

export class SyncTokenExpiredError extends AppError {
  constructor() {
    super(
      'SYNC_TOKEN_EXPIRED',
      410,
      'La dernière synchronisation de cet appareil est trop ancienne : une synchronisation complète est nécessaire.',
    );
  }
}

export class ConflictStaleError extends AppError {
  constructor() {
    super(
      'CONFLICT_STALE',
      409,
      'Cet enregistrement a de nouveau changé sur un autre appareil : le conflit doit être présenté à nouveau.',
    );
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super(
      'IDEMPOTENCY_KEY_REUSED',
      422,
      'Cette clé d’idempotence a déjà servi pour une autre requête.',
    );
  }
}

export class ClientTooOldError extends AppError {
  constructor() {
    super(
      'CLIENT_TOO_OLD',
      426,
      'Cette version de l’application ne peut plus se synchroniser : mettez-la à jour.',
    );
  }
}

export class InternalError extends AppError {
  constructor() {
    super('INTERNAL_ERROR', 500, 'Une erreur inattendue est survenue sur le serveur.');
  }
}

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} seconde${seconds > 1 ? 's' : ''}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes > 1 ? 's' : ''}`;
}
