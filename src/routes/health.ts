import { Router } from 'express';
import HealthController from '#controllers/health';

const controller = new HealthController();
const routes = Router();

routes.get('/', controller.check);

export default routes;
