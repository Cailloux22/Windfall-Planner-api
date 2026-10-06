import { Router } from 'express';
import ConflictsController from '#controllers/conflicts';
import SyncController from '#controllers/sync';
import { PUSH_MAX_BODY, RESOLVE_MAX_BODY } from '#constants/limits';
import { auth } from '#middlewares/auth';
import { idempotency } from '#middlewares/idempotency';
import { jsonBody } from '#middlewares/json-body';
import { perDeviceToken } from '#middlewares/rate-limit';
import { resolveBodySchema } from '#schemas/sync/conflicts.schema';
import { pullQuerySchema, pushBodySchema } from '#schemas/sync/sync.schema';
import { validate } from '#shared/zod/index';

const controller = new SyncController();
const conflicts = new ConflictsController();
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

// RG_11/RG_54/RT_68 : résolution d'un conflit, idempotente.
routes.post(
  '/conflicts/resolve',
  jsonBody(RESOLVE_MAX_BODY),
  validate({ body: resolveBodySchema }),
  idempotency,
  conflicts.resolve,
);

export default routes;
