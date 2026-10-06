import RecordsRepository from '#repositories/records';
import { runInTransaction } from '#repositories/transaction';
import { ConflictStaleError, UnauthenticatedError, ValidationError } from '#errors/app-error';
import type { AuthContext } from '#middlewares/auth';
import type { IdempotencyContext } from '#middlewares/idempotency';
import { toWire, type ResourceType, type StoredRecord } from '#models/record';
import { formatRevision } from '#models/revision.rules';
import type { ResolutionResult } from '#models/sync';
import { isResolutionStale } from '#models/sync.rules';
import type { Deployment } from '#schemas/sync/records.schema';
import type { ResolveBody } from '#schemas/sync/conflicts.schema';
import { withIdempotency, type HttpOutcome } from '#usecases/idempotency';
import { storedContent } from '#usecases/push-operations';
import { RecordSession, type GroupRef } from '#usecases/record-groups';

type Outcome = HttpOutcome<ResolutionResult | ReturnType<ConflictStaleError['toBody']>>;

function result(resourceType: ResourceType, id: string, retained: StoredRecord | null): ResolutionResult {
  if (!retained || retained.deleted) {
    return { resourceType, id, deleted: true, relatedRecords: [], relatedDeletions: [] };
  }
  return {
    resourceType,
    id,
    deleted: false,
    record: toWire(retained),
    versionToken: formatRevision(retained.revision),
    relatedRecords: [],
    relatedDeletions: [],
  };
}

function related(record: StoredRecord) {
  return { resourceType: record.resourceType, record: toWire(record), versionToken: formatRevision(record.revision) };
}

function invalid(field: string, message: string): never {
  throw new ValidationError([{ field, message }]);
}

export default class ConflictsUsecases {
  private readonly records = new RecordsRepository();

  // RG_11/RG_54/RT_68 : le joueur a désigné la version qui prime. La
  // résolution s'exécute sous le verrou du compte, comme une poussée.
  async resolve(auth: AuthContext, body: ResolveBody, idempotency: IdempotencyContext | undefined): Promise<Outcome> {
    return runInTransaction(async (tx) => {
      const account = await this.records.lockAccount(tx, auth.userId);
      if (!account) throw new UnauthenticatedError();
      return withIdempotency<ResolutionResult | ReturnType<ConflictStaleError['toBody']>>(tx, auth.userId, idempotency, async () => {
        const session = new RecordSession(
          tx,
          auth.userId,
          { id: auth.deviceId, name: auth.deviceName, platform: auth.devicePlatform },
          account.revision,
        );
        // RT_68 « Résolution périmée » (point 11) : le groupe a changé depuis
        // la version présentée au joueur → 409, le client tire puis
        // représente le conflit. Rien n'est écrit.
        const group = await this.groupOf(session, body);
        if (isResolutionStale(BigInt(body.serverVersionToken), await session.groupToken(group))) {
          return { status: 409, body: new ConflictStaleError().toBody() };
        }
        const outcome = body.resolution === 'keepLocal'
          ? await this.keepLocal(session, body)
          : await this.keepServer(session, body);
        await session.commitRevision();
        return { status: 200, body: outcome };
      });
    });
  }

  private async groupOf(session: RecordSession, body: ResolveBody): Promise<GroupRef> {
    if (body.resourceType === 'list') return { type: 'list', listId: body.id };
    if (body.kind === 'duplicateDeployment') {
      return { type: 'deployment', deploymentId: body.duplicateServerDeploymentId!, listId: null };
    }
    const server = await session.find('deployment', body.id);
    const listId = server?.listId ?? (body.localRecord as Deployment | undefined)?.listId ?? body.localList?.id ?? null;
    // Écart du contrat signalé : pour un déploiement jamais écrit sur le
    // serveur, seule la version locale désigne sa liste.
    if (!listId && body.kind === 'listDeletedOnServer') {
      invalid('localRecord', 'Requis pour identifier la liste de ce déploiement.');
    }
    return { type: 'deployment', deploymentId: body.id, listId };
  }

  // keepLocal : la version de cet appareil est écrite sur le serveur.
  private async keepLocal(session: RecordSession, body: ResolveBody): Promise<ResolutionResult> {
    switch (body.kind) {
      case 'bothModified':
      case 'deletedOnServer':
        return result(body.resourceType, body.id, await this.writeLocal(session, body));

      // Suppression locale : l'enregistrement — et, pour une liste, tous ses
      // déploiements serveur (RG_21) — est supprimé.
      case 'deletedLocally':
      case 'listDeletedLocally': {
        const server = await session.find(body.resourceType, body.id);
        if (server && !server.deleted) {
          if (body.resourceType === 'list') await session.deleteListWithCascade(body.id, null);
          else await session.markDeleted('deployment', body.id, null);
        }
        return result(body.resourceType, body.id, null);
      }

      // RG_54 : garder le déploiement conserve aussi sa liste, restaurée.
      case 'listDeletedOnServer': {
        const list = await session.writeList(storedContent(body.localList!));
        const written = await this.writeLocal(session, body);
        return { ...result('deployment', body.id, written), relatedRecords: [related(list)] };
      }

      // RG_54 : le joueur garde ce déploiement ; celui de l'autre appareil
      // est supprimé.
      case 'duplicateDeployment': {
        const duplicate = await session.find('deployment', body.duplicateServerDeploymentId!);
        const local = body.localRecord as Deployment;
        if (duplicate && duplicate.listId !== local.listId) {
          invalid('localRecord.listId', 'Le déploiement en double porte sur une autre liste.');
        }
        if (duplicate && !duplicate.deleted) await session.markDeleted('deployment', duplicate.id, null);
        return result('deployment', body.id, await this.writeLocal(session, body));
      }
    }
  }

  private async writeLocal(session: RecordSession, body: ResolveBody): Promise<StoredRecord> {
    const local = body.localRecord!;
    if (body.resourceType === 'list') return session.writeList(storedContent(local));
    const deployment = local as Deployment;
    const existing = await session.find('deployment', deployment.id);
    // RT_07 : la liaison liste ↔ déploiement reste immuable.
    if (existing && existing.listId !== deployment.listId) {
      invalid('localRecord.listId', 'Un déploiement ne peut pas changer de liste.');
    }
    const list = await session.find('list', deployment.listId);
    if (!list || list.deleted) invalid('localRecord.listId', 'La liste de ce déploiement n’existe pas sur le compte.');
    return session.writeDeployment(storedContent(deployment));
  }

  // keepServer : rien n'est écrit ; la version serveur et les
  // enregistrements liés sont renvoyés pour être appliqués localement.
  private async keepServer(session: RecordSession, body: ResolveBody): Promise<ResolutionResult> {
    switch (body.kind) {
      case 'bothModified':
      case 'deletedOnServer':
      case 'deletedLocally':
        return result(body.resourceType, body.id, await session.find(body.resourceType, body.id));

      // La suppression de la liste est abandonnée : ses déploiements serveur
      // reviennent avec elle.
      case 'listDeletedLocally': {
        const list = await session.find('list', body.id);
        const deployments = list && !list.deleted ? await session.liveDeploymentsOfList(body.id) : [];
        return { ...result('list', body.id, list), relatedRecords: deployments.map(related) };
      }

      // Point 12 : le déploiement est supprimé localement, avec sa liste et
      // les déploiements de cette liste connus du serveur.
      case 'listDeletedOnServer': {
        const group = await this.groupOf(session, body);
        const listId = group.type === 'deployment' ? group.listId! : body.id;
        const others = (await session.deploymentsOfList(listId)).filter((d) => d.id !== body.id);
        return {
          ...result('deployment', body.id, null),
          relatedDeletions: [
            { resourceType: 'list', id: listId },
            ...others.map((d) => ({ resourceType: 'deployment' as const, id: d.id })),
          ],
        };
      }

      // Point 13 : le déploiement local est écarté ; celui de l'autre
      // appareil est à écrire localement.
      case 'duplicateDeployment': {
        const duplicate = await session.find('deployment', body.duplicateServerDeploymentId!);
        return {
          ...result('deployment', body.id, null),
          relatedRecords: duplicate && !duplicate.deleted ? [related(duplicate)] : [],
        };
      }
    }
  }
}
