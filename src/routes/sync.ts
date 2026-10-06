import { Router } from 'express';
import SyncController from '#controllers/sync';
import { auth } from '#middlewares/auth';
import { perDeviceToken } from '#middlewares/rate-limit';
import { pullQuerySchema } from '#schemas/sync/sync.schema';
import { validate } from '#shared/zod/index';

const controller = new SyncController();
const routes = Router();

routes.use(auth, perDeviceToken);

// RG_51 : résumé du compte pour la première connexion d'un appareil.
routes.get('/summary', controller.summary);

// RT_09/RT_68/RT_70 : pull paginé.
routes.get('/changes', validate({ query: pullQuerySchema }), controller.pull);

export default routes;
