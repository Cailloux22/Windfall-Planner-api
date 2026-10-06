import 'dotenv/config';
import { z } from 'zod';

const SEMVER = /^\d+\.\d+\.\d+$/;

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

// Lecture unique de process.env, validée au démarrage : une variable absente
// ou mal formée arrête le processus avant toute écoute (fail-fast).
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // RT_71 : port 3000 par défaut (http://localhost:3000/v1).
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // RT_71 : origines autorisées par CORS, séparées par des virgules.
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  // RT_69 : version minimale de l'application acceptée (426 en dessous).
  MIN_CLIENT_VERSION: z.string().regex(SEMVER).default('0.0.0'),
  // RT_69 : la limitation par adresse IP n'est juste derrière un proxy que si
  // Express lui fait confiance (`false`, `true`, un nombre de sauts ou une
  // liste d'adresses, cf. « trust proxy »).
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((value): boolean | number | string => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      if (/^\d+$/.test(value)) return Number(value);
      return value;
    }),
  // RT_70 : journal d'accès (méthode, chemin, statut, durée).
  LOG_REQUESTS: booleanString.default(true),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`Configuration invalide :\n${problems}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
