import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from '#shared/env/index';
import { API_PREFIX } from '#constants/server';
import { errorHandler } from '#errors/handler';
import { clientVersion } from '#middlewares/client-version';
import { corsMiddleware } from '#middlewares/cors';
import { logger } from '#middlewares/logger';
import accountRoutes from '#routes/account';
import authRoutes from '#routes/auth';
import healthRoutes from '#routes/health';

export function createApp(): Express {
  const app = express();

  // RT_69 : la limitation par IP lit l'adresse réelle derrière un proxy de
  // confiance seulement.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet());
  if (env.LOG_REQUESTS) app.use(logger);

  app.use('/health', healthRoutes);

  const v1 = express.Router();
  // RT_71 : CORS d'abord (les pré-vols OPTIONS s'y arrêtent), puis RT_69 :
  // version du client sur toutes les routes du contrat.
  app.use(API_PREFIX, corsMiddleware, clientVersion, v1);
  v1.use('/auth', authRoutes);
  v1.use('/account', accountRoutes);

  app.use((_req, res) => {
    res.status(404).end();
  });
  app.use(errorHandler);
  return app;
}
