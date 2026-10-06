import { Router } from 'express';
import SyncController from '#controllers/sync';
import { PUSH_MAX_BODY } from '#constants/limits';
import { auth } from '#middlewares/auth';
import { idempotency } from '#middlewares/idempotency';
import { jsonBody } from '#middlewares/json-body';
import { perDeviceToken } from '#middlewares/rate-limit';
import { pullQuerySchema, pushBodySchema } from '#schemas/sync/sync.schema';
import { validate } from '#shared/zod/index';

const controller = new SyncController();
const routes = Router();

routes.use(auth, perDeviceToken);

// RG_51 : résumé du compte pour la première connexion d'un appareil.
routes.get('/summary', controller.summary);

// RT_09/RT_68/RT_70 : pull paginé.
routes.get('/changes', validate({ query: pullQuerySchema }), controller.pull);

// RT_09/RT_68 : poussée — 5 Mo au plus (413 BATCH_TOO_LARGE), idempotente.
routes.post(
  '/changes',
  jsonBody(PUSH_MAX_BODY, { tooLargeIsBatch: true }),
  validate({ body: pushBodySchema }),
  idempotency,
  controller.push,
);

export default routes;
