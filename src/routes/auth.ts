import { Router } from 'express';
import AccountController from '#controllers/account';
import AuthController from '#controllers/auth';
import { DEFAULT_MAX_BODY } from '#constants/limits';
import { auth } from '#middlewares/auth';
import { jsonBody } from '#middlewares/json-body';
import { loginFailedPerEmail, loginPerIp, perDeviceToken, registerPerIp } from '#middlewares/rate-limit';
import { loginBodySchema, registerBodySchema } from '#schemas/auth/auth.schema';
import { validate } from '#shared/zod/index';

const controller = new AuthController();
const accountController = new AccountController();
const routes = Router();

// RG_50/RT_67/RT_69 : inscription, limitée par IP.
routes.post(
  '/register',
  registerPerIp,
  jsonBody(DEFAULT_MAX_BODY),
  validate({ body: registerBodySchema }),
  controller.register,
);

// RG_50/RT_67/RT_69 : connexion, limitée par IP puis, pour les échecs, par email.
routes.post(
  '/login',
  loginPerIp,
  jsonBody(DEFAULT_MAX_BODY),
  loginFailedPerEmail,
  validate({ body: loginBodySchema }),
  controller.login,
);

// RG_53/RT_67 : déconnexion de cet appareil.
routes.post('/logout', auth, perDeviceToken, controller.logout);

// Alias déprécié de GET /account (contrat v0.1).
routes.get('/me', auth, perDeviceToken, accountController.get);

export default routes;
