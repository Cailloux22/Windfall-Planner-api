import { Router } from 'express';
import AccountController from '#controllers/account';
import { DEFAULT_MAX_BODY } from '#constants/limits';
import { auth } from '#middlewares/auth';
import { jsonBody } from '#middlewares/json-body';
import { accountWrongPassword, perDeviceToken } from '#middlewares/rate-limit';
import {
  changeEmailBodySchema,
  changePasswordBodySchema,
  deleteAccountBodySchema,
} from '#schemas/account/account.schema';
import { validate } from '#shared/zod/index';

const controller = new AccountController();
const routes = Router();

routes.use(auth, perDeviceToken);

// RG_19 : profil du compte connecté.
routes.get('/', controller.get);

// RG_52 : actions soumises au mot de passe courant ; RT_69 : 5 mots de passe
// erronés par 15 minutes et par compte, toutes actions confondues.
routes.put(
  '/password',
  accountWrongPassword,
  jsonBody(DEFAULT_MAX_BODY),
  validate({ body: changePasswordBodySchema }),
  controller.changePassword,
);
routes.put(
  '/email',
  accountWrongPassword,
  jsonBody(DEFAULT_MAX_BODY),
  validate({ body: changeEmailBodySchema }),
  controller.changeEmail,
);
// POST plutôt que DELETE : le corps d'un DELETE n'est pas garanti.
routes.post(
  '/delete',
  accountWrongPassword,
  jsonBody(DEFAULT_MAX_BODY),
  validate({ body: deleteAccountBodySchema }),
  controller.delete,
);

export default routes;
