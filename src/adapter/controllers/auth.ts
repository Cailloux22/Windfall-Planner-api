import type { Request, Response } from 'express';
import AuthUsecases from '#usecases/auth';
import { authOf } from '#middlewares/auth';
import { validated } from '#shared/zod/index';
import type { LoginBody, RegisterBody } from '#schemas/auth/auth.schema';

export default class AuthController {
  private readonly usecase = new AuthUsecases();

  register = async (_req: Request, res: Response) => {
    const { email, password, device } = validated<RegisterBody>(res, 'body');
    res.status(201).json(await this.usecase.register(email, password, device));
  };

  login = async (_req: Request, res: Response) => {
    const { email, password, device } = validated<LoginBody>(res, 'body');
    res.status(200).json(await this.usecase.login(email, password, device));
  };

  logout = async (_req: Request, res: Response) => {
    await this.usecase.logout(authOf(res).tokenHash);
    res.status(204).end();
  };
}
