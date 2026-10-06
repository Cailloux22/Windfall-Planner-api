import type { Request, Response } from 'express';
import AccountUsecases from '#usecases/account';
import { authOf } from '#middlewares/auth';
import { validated } from '#shared/zod/index';
import type {
  ChangeEmailBody,
  ChangePasswordBody,
  DeleteAccountBody,
} from '#schemas/account/account.schema';

export default class AccountController {
  private readonly usecase = new AccountUsecases();

  get = async (_req: Request, res: Response) => {
    res.status(200).json(await this.usecase.get(authOf(res).userId));
  };

  changePassword = async (_req: Request, res: Response) => {
    const { currentPassword, newPassword } = validated<ChangePasswordBody>(res, 'body');
    await this.usecase.changePassword(authOf(res).userId, currentPassword, newPassword);
    res.status(204).end();
  };

  changeEmail = async (_req: Request, res: Response) => {
    const { newEmail, password } = validated<ChangeEmailBody>(res, 'body');
    res.status(200).json(await this.usecase.changeEmail(authOf(res).userId, newEmail, password));
  };

  delete = async (_req: Request, res: Response) => {
    const { password } = validated<DeleteAccountBody>(res, 'body');
    await this.usecase.delete(authOf(res).userId, password);
    res.status(204).end();
  };
}
