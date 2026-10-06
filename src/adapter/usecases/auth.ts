import DeviceTokensRepository, { type DeviceInput } from '#repositories/device-tokens';
import UsersRepository from '#repositories/users';
import { runInTransaction } from '#repositories/transaction';
import { InvalidCredentialsError } from '#errors/app-error';
import { toUserDto, type AuthResult } from '#models/user';
import {
  generateDeviceToken,
  hashPassword,
  sha256,
  verifyAgainstDummy,
  verifyPassword,
} from '#shared/crypto/index';

export default class AuthUsecases {
  private readonly users = new UsersRepository();
  private readonly deviceTokens = new DeviceTokensRepository();

  // RG_50 : email déjà normalisé par le schéma ; un compte au plus par
  // adresse (contrainte unique → 409 EMAIL_TAKEN). Compte utilisable et
  // synchronisable aussitôt, sans vérification de l'adresse.
  async register(email: string, password: string, device: DeviceInput): Promise<AuthResult> {
    // RT_67 : hash argon2id calculé hors transaction (coûteux).
    const passwordHash = await hashPassword(password);
    const deviceToken = generateDeviceToken();
    const user = await runInTransaction(async (tx) => {
      const created = await this.users.create(email, passwordHash, tx);
      await this.deviceTokens.upsert(created.id, device, sha256(deviceToken), tx);
      return created;
    });
    // RT_67 : le jeton n'est renvoyé qu'ici ; seul son hash est conservé.
    return { deviceToken, user: toUserDto(user) };
  }

  // RG_50 : même réponse, et même coût, pour un email inconnu et un mot de
  // passe erroné. RT_67 : reconnexion du même appareil = jeton remplacé ; les
  // autres appareils ne sont pas touchés (RG_53).
  async login(email: string, password: string, device: DeviceInput): Promise<AuthResult> {
    const user = await this.users.findByEmail(email);
    const valid = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyAgainstDummy(password);
    if (!user || !valid) throw new InvalidCredentialsError();
    const deviceToken = generateDeviceToken();
    await this.deviceTokens.upsert(user.id, device, sha256(deviceToken));
    return { deviceToken, user: toUserDto(user) };
  }

  // RG_53/RT_67 : la déconnexion supprime le seul jeton présenté ; RG_19 :
  // aucune donnée n'est touchée.
  async logout(tokenHash: Buffer): Promise<void> {
    await this.deviceTokens.deleteByHash(tokenHash);
  }
}
