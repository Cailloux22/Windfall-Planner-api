import RecordsRepository from '#repositories/records';
import { runInTransaction } from '#repositories/transaction';
import { SyncTokenExpiredError, UnauthenticatedError } from '#errors/app-error';
import type { AuthContext } from '#middlewares/auth';
import type { IdempotencyContext } from '#middlewares/idempotency';
import { toWire, type StoredRecord } from '#models/record';
import {
  formatRevision,
  isSinceExpired,
  parseBaseToken,
  parsePullSince,
  parsePushSince,
} from '#models/revision.rules';
import type { AcceptedRecord, PullResult, PushResult, RejectedRecord, RejectionCode, SyncSummary } from '#models/sync';
import {
  decideDeploymentDeletion,
  decideDeploymentWrite,
  decideListDeletion,
  decideListWrite,
  orderOperations,
} from '#models/sync.rules';
import type { PushBody } from '#schemas/sync/sync.schema';
import { withIdempotency, type HttpOutcome } from '#usecases/idempotency';
import {
  storedContent,
  toOperations,
  type DeletionOperation,
  type DeploymentWriteOperation,
  type ListWriteOperation,
  type PushOperation,
} from '#usecases/push-operations';
import { finalizeConflict, RecordSession, type PendingConflict } from '#usecases/record-groups';

const REJECTION_MESSAGES: Record<RejectionCode, string> = {
  INVALID_RECORD: 'Enregistrement non conforme.',
  UNKNOWN_LIST: 'La liste de ce déploiement n’existe pas sur le compte.',
  LIST_MISMATCH: 'Un déploiement ne peut pas changer de liste.',
};

// Résultat d'une poussée en cours de construction.
class PushOutcome {
  readonly accepted: AcceptedRecord[] = [];
  readonly conflicts: PendingConflict[] = [];
  readonly rejected: RejectedRecord[] = [];

  accept(resourceType: AcceptedRecord['resourceType'], id: string, revision?: bigint): void {
    this.accepted.push(
      revision === undefined
        ? { resourceType, id, deleted: true }
        : { resourceType, id, deleted: false, versionToken: formatRevision(revision) },
    );
  }

  reject(op: PushOperation, code: RejectionCode, message = REJECTION_MESSAGES[code]): void {
    this.rejected.push({ resourceType: op.resourceType, id: op.rawId, code, message });
  }
}

export default class SyncUsecases {
  private readonly records = new RecordsRepository();

  // RG_51 : contenu actif du compte, avant le choix fusion / remplacement.
  async summary(userId: string): Promise<SyncSummary> {
    const counts = await this.records.counts(userId);
    return {
      listCount: counts.listCount,
      deploymentCount: counts.deploymentCount,
      lastChangeAt: counts.lastChangeAt ? counts.lastChangeAt.toISOString() : null,
    };
  }

  // RT_68/RT_70 : pull paginé par révision croissante. Lecture dans un
  // instantané (REPEATABLE READ) : la page et la révision du compte sont
  // cohérentes même si une poussée s'exécute en parallèle.
  async pull(userId: string, sinceParam: string | undefined, limit: number): Promise<PullResult> {
    const since = parsePullSince(sinceParam);
    return runInTransaction(
      async (tx) => {
        const account = await this.records.accountRevision(userId, tx);
        if (!account) throw new UnauthenticatedError();
        // RT_68 : traces de suppression purgées au-delà de `since` → 410.
        if (since !== null && isSinceExpired(since, account.purgedRevision)) {
          throw new SyncTokenExpiredError();
        }
        const rows = await this.records.page(tx, userId, since, limit + 1);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        return {
          ...splitPage(page),
          nextToken: formatRevision(nextToken(page, since, hasMore, account.revision)),
          hasMore,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  // RT_68 : poussée. Une transaction qui verrouille le compte (RT_70) ;
  // chaque enregistrement est accepté, en conflit ou rejeté, sans que l'un
  // n'empêche les autres ; idempotente par Idempotency-Key.
  async push(auth: AuthContext, body: PushBody, idempotency: IdempotencyContext | undefined): Promise<HttpOutcome<PushResult>> {
    const operations = orderOperations(toOperations(body));
    const since = parsePushSince(body.since);
    return runInTransaction(async (tx) => {
      const account = await this.records.lockAccount(tx, auth.userId);
      if (!account) throw new UnauthenticatedError();
      return withIdempotency(tx, auth.userId, idempotency, async () => {
        const session = new RecordSession(tx, auth.userId, deviceOf(auth), account.revision);
        const outcome = new PushOutcome();
        const seen = new Set<string>();
        for (const op of operations) {
          if (!op.record) {
            outcome.reject(op, 'INVALID_RECORD', op.invalid);
            continue;
          }
          // Un même enregistrement deux fois dans la même phase : seul le
          // premier est traité.
          const key = `${op.kind}:${op.resourceType}:${op.record.id}`;
          if (seen.has(key)) {
            outcome.reject(op, 'INVALID_RECORD', 'Enregistrement présent deux fois dans la poussée.');
            continue;
          }
          seen.add(key);
          if (op.kind === 'deletion') {
            if (op.resourceType === 'deployment') await this.pushDeploymentDeletion(session, op, outcome);
            else await this.pushListDeletion(session, op, outcome);
          } else if (op.resourceType === 'list') {
            await this.pushListWrite(session, op, outcome);
          } else {
            await this.pushDeploymentWrite(session, op, outcome, since);
          }
        }
        const conflicts = [];
        for (const pending of outcome.conflicts) conflicts.push(await finalizeConflict(session, pending));
        await session.commitRevision();
        return {
          status: 200,
          body: { accepted: outcome.accepted, conflicts, rejected: outcome.rejected },
        };
      });
    });
  }

  private async pushListWrite(session: RecordSession, op: ListWriteOperation, outcome: PushOutcome): Promise<void> {
    const list = op.record!;
    const server = await session.find('list', list.id);
    const decision = decideListWrite(server, parseBaseToken(list.versionToken));
    if (decision.action === 'write') {
      const written = await session.writeList(storedContent(list));
      outcome.accept('list', list.id, written.revision);
    } else if (decision.action === 'conflict') {
      outcome.conflicts.push({
        resourceType: 'list',
        id: list.id,
        kind: decision.kind,
        shown: server!,
        serverRecord: server!.deleted ? null : server,
        group: { type: 'list', listId: list.id },
      });
    }
  }

  private async pushDeploymentWrite(
    session: RecordSession,
    op: DeploymentWriteOperation,
    outcome: PushOutcome,
    since: bigint,
  ): Promise<void> {
    const deployment = op.record!;
    const server = await session.find('deployment', deployment.id);
    const list = await session.find('list', deployment.listId);
    // RG_54/RT_68 cas 5 : seulement pour une création, liste vivante.
    const duplicate = !server && list && !list.deleted
      ? await session.findUnseenDuplicate(deployment, since, deployment.id)
      : null;
    const decision = decideDeploymentWrite({
      server,
      base: parseBaseToken(deployment.versionToken),
      pushedListId: deployment.listId,
      list,
      duplicateExists: duplicate !== null,
    });
    switch (decision.action) {
      case 'write': {
        const written = await session.writeDeployment(storedContent(deployment));
        outcome.accept('deployment', deployment.id, written.revision);
        return;
      }
      case 'reject':
        outcome.reject(op, decision.code);
        return;
      case 'conflict': {
        const group = { type: 'deployment' as const, deploymentId: deployment.id, listId: deployment.listId };
        if (decision.kind === 'listDeletedOnServer') {
          // RG_54 : la version serveur est la suppression de la liste.
          outcome.conflicts.push({ resourceType: 'deployment', id: deployment.id, kind: decision.kind, shown: list!, serverRecord: null, group });
        } else if (decision.kind === 'duplicateDeployment') {
          // RG_54 : `serverRecord` est le déploiement de l'autre appareil,
          // avec son propre identifiant.
          outcome.conflicts.push({
            resourceType: 'deployment',
            id: deployment.id,
            kind: decision.kind,
            shown: duplicate!,
            serverRecord: duplicate,
            group: { type: 'deployment', deploymentId: duplicate!.id, listId: duplicate!.listId },
          });
        } else {
          outcome.conflicts.push({
            resourceType: 'deployment',
            id: deployment.id,
            kind: decision.kind,
            shown: server!,
            serverRecord: server!.deleted ? null : server,
            group,
          });
        }
        return;
      }
      default:
        return;
    }
  }

  private async pushDeploymentDeletion(session: RecordSession, op: DeletionOperation, outcome: PushOutcome): Promise<void> {
    const deletion = op.record!;
    const server = await session.find('deployment', deletion.id);
    const decision = decideDeploymentDeletion(server, parseBaseToken(deletion.versionToken));
    if (decision.action === 'noop') {
      outcome.accept('deployment', deletion.id);
    } else if (decision.action === 'delete') {
      await session.markDeleted('deployment', deletion.id, clientDate(deletion.deletedAt));
      outcome.accept('deployment', deletion.id);
    } else if (decision.action === 'conflict') {
      outcome.conflicts.push({
        resourceType: 'deployment',
        id: deletion.id,
        kind: decision.kind,
        shown: server!,
        serverRecord: server,
        group: { type: 'deployment', deploymentId: deletion.id, listId: server!.listId },
      });
    }
  }

  private async pushListDeletion(session: RecordSession, op: DeletionOperation, outcome: PushOutcome): Promise<void> {
    const deletion = op.record!;
    const server = await session.find('list', deletion.id);
    const live = server && !server.deleted ? await session.liveDeploymentsOfList(deletion.id) : [];
    const decision = decideListDeletion(server, parseBaseToken(deletion.versionToken), live.length);
    if (decision.action === 'noop') {
      outcome.accept('list', deletion.id);
    } else if (decision.action === 'delete') {
      // RG_21 : cascade sur les déploiements restants.
      await session.deleteListWithCascade(deletion.id, clientDate(deletion.deletedAt));
      outcome.accept('list', deletion.id);
    } else if (decision.action === 'conflict') {
      // RG_54 « Liste supprimée, déploiement modifié » : les déploiements
      // concernés sont listés ; la date et l'appareil affichés sont ceux du
      // changement serveur le plus récent du groupe.
      const shown = [server!, ...live].reduce((a, b) => (b.revision > a.revision ? b : a));
      outcome.conflicts.push({
        resourceType: 'list',
        id: deletion.id,
        kind: decision.kind,
        shown: decision.kind === 'listDeletedLocally' ? shown : server!,
        serverRecord: server,
        ...(decision.kind === 'listDeletedLocally' ? { related: live } : {}),
        group: { type: 'list', listId: deletion.id },
      });
    }
  }
}

function deviceOf(auth: AuthContext) {
  return { id: auth.deviceId, name: auth.deviceName, platform: auth.devicePlatform };
}

function clientDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

// RT_70 : `nextToken` = révision du dernier changement de la page. Page
// finale d'un pull complet : la révision du compte — tout ce qui la précède
// et n'a pas été renvoyé est une suppression, sans objet pour un appareil
// qui repart de zéro. Page vide d'un pull delta : `since` inchangé.
function nextToken(page: StoredRecord[], since: bigint | null, hasMore: boolean, accountRevision: bigint): bigint {
  const last = page.at(-1)?.revision;
  if (since === null && !hasMore) return accountRevision;
  return last ?? since ?? 0n;
}

// RG_21/RT_68 : un enregistrement modifié plusieurs fois n'apparaît qu'une
// fois (une ligne par enregistrement), dans son dernier état.
function splitPage(page: StoredRecord[]): Omit<PullResult, 'nextToken' | 'hasMore'> {
  const result: Omit<PullResult, 'nextToken' | 'hasMore'> = {
    lists: [],
    deployments: [],
    deletedListIds: [],
    deletedDeploymentIds: [],
  };
  for (const record of page) {
    if (record.resourceType === 'list') {
      if (record.deleted) result.deletedListIds.push(record.id);
      else result.lists.push(toWire(record));
    } else if (record.deleted) {
      result.deletedDeploymentIds.push(record.id);
    } else {
      result.deployments.push(toWire(record));
    }
  }
  return result;
}
