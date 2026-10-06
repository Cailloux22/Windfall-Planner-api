import RecordsRepository from '#repositories/records';
import { runInTransaction } from '#repositories/transaction';
import { SyncTokenExpiredError, UnauthenticatedError } from '#errors/app-error';
import { toWire, type StoredRecord } from '#models/record';
import { formatRevision, isSinceExpired, parsePullSince } from '#models/revision.rules';
import type { PullResult, SyncSummary } from '#models/sync';

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
