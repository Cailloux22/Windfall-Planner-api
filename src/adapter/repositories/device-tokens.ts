import { bytes, prismaClient, type DbClient } from '#shared/prisma/index';
import type { DevicePlatform } from '#models/device';

export interface DeviceTokenRow {
  tokenHash: Buffer;
  userId: string;
  deviceId: string;
  deviceName: string;
  devicePlatform: DevicePlatform;
}

export interface DeviceInput {
  id: string;
  name: string;
  platform: DevicePlatform;
}

function toRow(row: {
  tokenHash: Uint8Array;
  userId: string;
  deviceId: string;
  deviceName: string;
  devicePlatform: string;
}): DeviceTokenRow {
  return {
    tokenHash: Buffer.from(row.tokenHash),
    userId: row.userId,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    devicePlatform: row.devicePlatform as DevicePlatform,
  };
}

export default class DeviceTokensRepository {
  constructor(private readonly prisma: DbClient = prismaClient) {}

  async findByHash(tokenHash: Buffer): Promise<DeviceTokenRow | null> {
    const row = await this.prisma.deviceToken.findUnique({ where: { tokenHash: bytes(tokenHash) } });
    return row ? toRow(row) : null;
  }

  // RT_67 : une nouvelle connexion du même appareil remplace son jeton
  // précédent (UPSERT sur (user_id, device_id)) ; libellé et plateforme
  // sont mis à jour au passage.
  async upsert(userId: string, device: DeviceInput, tokenHash: Buffer, tx?: DbClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.deviceToken.upsert({
      where: { userId_deviceId: { userId, deviceId: device.id } },
      create: {
        tokenHash: bytes(tokenHash),
        userId,
        deviceId: device.id,
        deviceName: device.name,
        devicePlatform: device.platform,
      },
      update: {
        tokenHash: bytes(tokenHash),
        deviceName: device.name,
        devicePlatform: device.platform,
        createdAt: new Date(),
      },
    });
  }

  // RT_67/RG_53 : la déconnexion supprime le seul jeton présenté.
  async deleteByHash(tokenHash: Buffer): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { tokenHash: bytes(tokenHash) } });
  }
}
