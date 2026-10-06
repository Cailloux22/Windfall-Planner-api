import { Prisma, prismaClient, type DbClient } from '#shared/prisma/index';
import type { DeviceLabel, DevicePlatform } from '#models/device';
import type { RecordContent, RecordWrite, ResourceType, StoredRecord } from '#models/record';

interface RecordModel {
  resourceType: string;
  id: string;
  revision: bigint;
  deleted: boolean;
  content: Prisma.JsonValue | null;
  listId: string | null;
  opponentDispositionId: string | null;
  boardId: string | null;
  authorDeviceId: string;
  authorDeviceName: string;
  authorDevicePlatform: string;
  deletedAt: Date | null;
  clientDeletedAt: Date | null;
}

function toStored(row: RecordModel): StoredRecord {
  return {
    resourceType: row.resourceType as ResourceType,
    id: row.id,
    revision: row.revision,
    deleted: row.deleted,
    content: row.content as RecordContent | null,
    listId: row.listId,
    opponentDispositionId: row.opponentDispositionId,
    boardId: row.boardId,
    author: {
      id: row.authorDeviceId,
      name: row.authorDeviceName,
      platform: row.authorDevicePlatform as DevicePlatform,
    },
    deletedAt: row.deletedAt,
    clientDeletedAt: row.clientDeletedAt,
  };
}

export interface AccountRevision {
  revision: bigint;
  purgedRevision: bigint;
}

export interface SyncCounts {
  listCount: number;
  deploymentCount: number;
  lastChangeAt: Date | null;
}

export default class RecordsRepository {
  constructor(private readonly prisma: DbClient = prismaClient) {}

  // RT_70 « Concurrence » : verrou de la ligne du compte pour la durée de la
  // transaction — deux poussées ou résolutions du même compte ne
  // s'entrelacent jamais. `null` si le compte n'existe plus.
  async lockAccount(tx: DbClient, userId: string): Promise<AccountRevision | null> {
    const rows = await tx.$queryRaw<{ revision: bigint; purged_revision: bigint }[]>`
      SELECT revision, purged_revision FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const row = rows[0];
    return row ? { revision: row.revision, purgedRevision: row.purged_revision } : null;
  }

  async accountRevision(userId: string, tx?: DbClient): Promise<AccountRevision | null> {
    const row = await (tx ?? this.prisma).user.findUnique({
      where: { id: userId },
      select: { revision: true, purgedRevision: true },
    });
    return row;
  }

  // RT_70 : le compteur du compte prend la dernière révision attribuée.
  async setAccountRevision(tx: DbClient, userId: string, revision: bigint): Promise<void> {
    await tx.user.update({ where: { id: userId }, data: { revision, updatedAt: new Date() } });
  }

  async find(userId: string, resourceType: ResourceType, id: string, tx?: DbClient): Promise<StoredRecord | null> {
    const row = await (tx ?? this.prisma).record.findUnique({
      where: { userId_resourceType_id: { userId, resourceType, id } },
    });
    return row ? toStored(row) : null;
  }

  // RG_21/RT_68 : déploiements d'une liste, vivants et supprimés.
  async findDeploymentsOfList(userId: string, listId: string, tx?: DbClient): Promise<StoredRecord[]> {
    const rows = await (tx ?? this.prisma).record.findMany({
      where: { userId, resourceType: 'deployment', listId },
      orderBy: { revision: 'asc' },
    });
    return rows.map(toStored);
  }

  // RG_54/RT_68 « même plateau créé deux fois » : déploiement vivant du même
  // triplet écrit dans l'intervalle (since, upTo], hors appareil `excludeDevice`
  // et hors `excludeId` ; le plus récent.
  async findTripletDeployment(
    tx: DbClient,
    userId: string,
    triplet: { listId: string; opponentDispositionId: string; boardId: string },
    range: { since: bigint; upTo: bigint },
    exclude: { deviceId: string; id: string },
  ): Promise<StoredRecord | null> {
    const row = await tx.record.findFirst({
      where: {
        userId,
        resourceType: 'deployment',
        deleted: false,
        listId: triplet.listId,
        opponentDispositionId: triplet.opponentDispositionId,
        boardId: triplet.boardId,
        revision: { gt: range.since, lte: range.upTo },
        authorDeviceId: { not: exclude.deviceId },
        id: { not: exclude.id },
      },
      orderBy: { revision: 'desc' },
    });
    return row ? toStored(row) : null;
  }

  // RT_70 : écriture d'un enregistrement vivant à la révision donnée ;
  // auteur figé sur la révision (RG_54).
  async write(tx: DbClient, userId: string, record: RecordWrite, revision: bigint, author: DeviceLabel): Promise<StoredRecord> {
    const data = {
      revision,
      deleted: false,
      content: record.content as Prisma.InputJsonValue,
      listId: record.listId,
      opponentDispositionId: record.opponentDispositionId,
      boardId: record.boardId,
      authorDeviceId: author.id,
      authorDeviceName: author.name,
      authorDevicePlatform: author.platform,
      deletedAt: null,
      clientDeletedAt: null,
    };
    const row = await tx.record.upsert({
      where: { userId_resourceType_id: { userId, resourceType: record.resourceType, id: record.id } },
      create: { userId, resourceType: record.resourceType, id: record.id, ...data },
      update: data,
    });
    return toStored(row);
  }

  // RT_70 : une suppression ne retire pas la ligne — contenu vidé, nouvelle
  // révision, date de suppression (trace transmise au pull, purgée à 90 jours).
  async markDeleted(
    tx: DbClient,
    userId: string,
    resourceType: ResourceType,
    id: string,
    revision: bigint,
    author: DeviceLabel,
    clientDeletedAt: Date | null,
  ): Promise<StoredRecord> {
    const row = await tx.record.update({
      where: { userId_resourceType_id: { userId, resourceType, id } },
      data: {
        revision,
        deleted: true,
        content: Prisma.DbNull,
        authorDeviceId: author.id,
        authorDeviceName: author.name,
        authorDevicePlatform: author.platform,
        deletedAt: new Date(),
        clientDeletedAt,
      },
    });
    return toStored(row);
  }

  // RT_70 : une page du pull, par révision croissante. `since` null : pull
  // complet, enregistrements vivants seulement.
  async page(tx: DbClient, userId: string, since: bigint | null, take: number): Promise<StoredRecord[]> {
    const rows = await tx.record.findMany({
      where: since === null ? { userId, deleted: false } : { userId, revision: { gt: since } },
      orderBy: { revision: 'asc' },
      take,
    });
    return rows.map(toStored);
  }

  // RG_51 : contenu actif du compte ; date de dernière modification = le
  // plus récent `updatedAt` (heure de l'appareil) des enregistrements actifs
  // (point 14 du plan).
  async counts(userId: string): Promise<SyncCounts> {
    const rows = await this.prisma.$queryRaw<{ lists: bigint; deployments: bigint; last: Date | null }[]>`
      SELECT
        count(*) FILTER (WHERE resource_type = 'list')       AS lists,
        count(*) FILTER (WHERE resource_type = 'deployment') AS deployments,
        max((content->>'updatedAt')::timestamptz)           AS last
      FROM records
      WHERE user_id = ${userId}::uuid AND NOT deleted`;
    const row = rows[0]!;
    return { listCount: Number(row.lists), deploymentCount: Number(row.deployments), lastChangeAt: row.last };
  }
}
