import cors from 'cors';
import { env } from '#shared/env/index';

// RT_71 : seules les origines du client sont autorisées (liste CORS_ORIGINS),
// avec les en-têtes du contrat, et Retry-After exposé (RT_69).
export const corsMiddleware = cors({
  origin: env.CORS_ORIGINS,
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Client-Version'],
  exposedHeaders: ['Retry-After'],
  maxAge: 600,
});
