import UsersRepository, { type UserRow } from '#repositories/users';
import { runInTransaction } from '#repositories/transaction';
import { InvalidCredentialsError, UnauthenticatedError } from '#errors/app-error';
import { toUserDto, type UserDto } from '#models/user';
import { hashPassword, verifyPassword } from '#shared/crypto/index';

export default class AccountUsecases {
  private readonly users = new UsersRepository();

  async get(userId: string): Promise<UserDto> {
    return toUserDto(await this.requireUser(userId));
  }

  // RG_52 : mot de passe courant exigé ; RG_53 : aucun appareil n'est
  // déconnecté, celui-ci compris.
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    await this.verify(userId, currentPassword);
    await this.users.updatePassword(userId, await hashPassword(newPassword));
  }

  // RG_52/RG_50 : mot de passe exigé ; nouvelle adresse normalisée (par le
  // schéma), unique (409 EMAIL_TAKEN), non vérifiée ; appareils connectés.
  async changeEmail(userId: string, newEmail: string, password: string): Promise<UserDto> {
    await this.verify(userId, password);
    return toUserDto(await this.users.updateEmail(userId, newEmail));
  }

  // RG_52/RT_70 : mot de passe exigé, puis suppression immédiate et totale en
  // une transaction — compte, enregistrements, traces, clés d'idempotence et
  // jetons de tous les appareils (RG_53 : ils reçoivent 401 au prochain appel).
  async delete(userId: string, password: string): Promise<void> {
    await this.verify(userId, password);
    await runInTransaction((tx) => this.users.delete(userId, tx));
  }

  private async requireUser(userId: string): Promise<UserRow> {
    const user = await this.users.findById(userId);
    // Compte supprimé entre l'authentification et cette lecture.
    if (!user) throw new UnauthenticatedError();
    return user;
  }

  private async verify(userId: string, password: string): Promise<void> {
    const user = await this.requireUser(userId);
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new InvalidCredentialsError('Mot de passe incorrect.');
    }
  }
}
