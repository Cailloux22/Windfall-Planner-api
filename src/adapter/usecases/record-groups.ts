import RecordsRepository from '#repositories/records';
import type { TransactionClient } from '#repositories/transaction';
import type { DeviceLabel } from '#models/device';
import { displayedDate, toWire, type RecordContent, type ResourceType, type StoredRecord } from '#models/record';
import { formatRevision } from '#models/revision.rules';
import type { Conflict, ConflictKind } from '#models/sync';
import { groupToken, isUnseenDuplicate } from '#models/sync.rules';

// Accès aux enregistrements d'une transaction de poussée ou de résolution,
// partagé par les deux usecases : groupes d'enregistrements liés (point 11),
// écritures numérotées par le compteur du compte, cascade (RG_21).

// Groupe d'un conflit : une liste et ses déploiements, ou un déploiement et
// sa liste.
export type GroupRef =
  | { type: 'list'; listId: string }
  | { type: 'deployment'; deploymentId: string; listId: string | null };

export class RecordSession {
  private readonly records = new RecordsRepository();
  revision: bigint;
  readonly revisionAtLock: bigint;

  constructor(
    readonly tx: TransactionClient,
    readonly userId: string,
    readonly author: DeviceLabel,
    revisionAtLock: bigint,
  ) {
    this.revision = revisionAtLock;
    this.revisionAtLock = revisionAtLock;
  }

  get changed(): boolean {
    return this.revision !== this.revisionAtLock;
  }

  // RT_70 : chaque écriture prend la révision suivante du compte.
  private nextRevision(): bigint {
    this.revision += 1n;
    return this.revision;
  }

  find(resourceType: ResourceType, id: string): Promise<StoredRecord | null> {
    return this.records.find(this.userId, resourceType, id, this.tx);
  }

  deploymentsOfList(listId: string): Promise<StoredRecord[]> {
    return this.records.findDeploymentsOfList(this.userId, listId, this.tx);
  }

  async liveDeploymentsOfList(listId: string): Promise<StoredRecord[]> {
    return (await this.deploymentsOfList(listId)).filter((record) => !record.deleted);
  }

  // RG_54 point 10 : le doublon le plus récent que l'appareil n'a pas vu —
  // écrit après son `since` et avant cette poussée, par un autre appareil.
  async findUnseenDuplicate(
    triplet: { listId: string; opponentDispositionId: string; boardId: string },
    since: bigint,
    excludeId: string,
  ): Promise<StoredRecord | null> {
    const candidates = await this.records.findTripletDeployments(this.tx, this.userId, triplet, since);
    return (
      candidates.find(
        (candidate) =>
          candidate.id !== excludeId
          && isUnseenDuplicate(
            { revision: candidate.revision, authorDeviceId: candidate.author.id },
            since,
            this.revisionAtLock,
            this.author.id,
          ),
      ) ?? null
    );
  }

  writeList(content: RecordContent): Promise<StoredRecord> {
    return this.records.write(
      this.tx,
      this.userId,
      { resourceType: 'list', id: content.id, content, listId: null, opponentDispositionId: null, boardId: null },
      this.nextRevision(),
      this.author,
    );
  }

  // RG_14/RT_68 : la liste et le triplet sont extraits en colonnes.
  writeDeployment(content: RecordContent & { listId: string; opponentDispositionId: string; boardId: string }): Promise<StoredRecord> {
    return this.records.write(
      this.tx,
      this.userId,
      {
        resourceType: 'deployment',
        id: content.id,
        content,
        listId: content.listId,
        opponentDispositionId: content.opponentDispositionId,
        boardId: content.boardId,
      },
      this.nextRevision(),
      this.author,
    );
  }

  markDeleted(resourceType: ResourceType, id: string, clientDeletedAt: Date | null): Promise<StoredRecord> {
    return this.records.markDeleted(this.tx, this.userId, resourceType, id, this.nextRevision(), this.author, clientDeletedAt);
  }

  // RG_21 : suppression d'une liste et, d'abord, de ses déploiements
  // restants — chacun sa révision et sa trace, reçues par les autres
  // appareils au pull suivant.
  async deleteListWithCascade(listId: string, clientDeletedAt: Date | null): Promise<string[]> {
    const cascaded: string[] = [];
    for (const deployment of await this.liveDeploymentsOfList(listId)) {
      await this.markDeleted('deployment', deployment.id, clientDeletedAt);
      cascaded.push(deployment.id);
    }
    await this.markDeleted('list', listId, clientDeletedAt);
    return cascaded;
  }

  async groupMembers(ref: GroupRef): Promise<StoredRecord[]> {
    if (ref.type === 'list') {
      const list = await this.find('list', ref.listId);
      return [...(list ? [list] : []), ...(await this.deploymentsOfList(ref.listId))];
    }
    const deployment = await this.find('deployment', ref.deploymentId);
    const listId = deployment?.listId ?? ref.listId;
    const list = listId ? await this.find('list', listId) : null;
    return [deployment, list].filter((record): record is StoredRecord => record !== null);
  }

  async groupToken(ref: GroupRef): Promise<bigint> {
    return groupToken((await this.groupMembers(ref)).map((record) => record.revision));
  }

  async commitRevision(): Promise<void> {
    if (this.changed) await this.records.setAccountRevision(this.tx, this.userId, this.revision);
  }
}

// RG_54 : conflit présenté au joueur — la version serveur (ou `null` pour
// une suppression), sa date et son appareil. Le jeton est calculé à la fin
// de la poussée, sur l'état final du groupe.
export interface PendingConflict {
  resourceType: ResourceType;
  id: string;
  kind: ConflictKind;
  shown: StoredRecord;
  serverRecord: StoredRecord | null;
  related?: StoredRecord[];
  group: GroupRef;
}

export async function finalizeConflict(session: RecordSession, pending: PendingConflict): Promise<Conflict> {
  const conflict: Conflict = {
    resourceType: pending.resourceType,
    id: pending.id,
    kind: pending.kind,
    serverRecord: pending.serverRecord ? toWire(pending.serverRecord) : null,
    serverVersionToken: formatRevision(await session.groupToken(pending.group)),
    serverUpdatedAt: displayedDate(pending.shown),
    serverDevice: pending.shown.author,
  };
  if (pending.related) conflict.relatedServerRecords = pending.related.map(toWire);
  return conflict;
}
