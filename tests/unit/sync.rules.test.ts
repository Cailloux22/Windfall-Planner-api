import { describe, expect, it } from 'vitest';
import {
  decideDeploymentDeletion,
  decideDeploymentWrite,
  decideListDeletion,
  decideListWrite,
  groupToken,
  isResolutionStale,
  isUnseenDuplicate,
  orderOperations,
  type ServerState,
} from '#models/sync.rules';

const live = (revision: bigint, listId: string | null = null): ServerState => ({ revision, deleted: false, listId });
const gone = (revision: bigint, listId: string | null = null): ServerState => ({ revision, deleted: true, listId });

describe('RT_68 — ordre de traitement d’une poussée', () => {
  it('listes écrites, déploiements écrits, suppressions de déploiements, suppressions de listes', () => {
    const ops = [
      { kind: 'deletion', resourceType: 'list', n: 1 },
      { kind: 'deletion', resourceType: 'deployment', n: 2 },
      { kind: 'write', resourceType: 'deployment', n: 3 },
      { kind: 'write', resourceType: 'list', n: 4 },
      { kind: 'write', resourceType: 'deployment', n: 5 },
      { kind: 'write', resourceType: 'list', n: 6 },
    ] as const;
    expect(orderOperations(ops).map((op) => op.n)).toEqual([4, 6, 3, 5, 2, 1]);
  });
});

describe('RT_68 — écriture d’une liste', () => {
  it('création, ou trace purgée (point 8) : écrite', () => {
    expect(decideListWrite(null, null)).toEqual({ action: 'write' });
    expect(decideListWrite(null, 12n)).toEqual({ action: 'write' });
  });
  it('jeton courant : écrite ; périmé ou absent : bothModified', () => {
    expect(decideListWrite(live(5n), 5n)).toEqual({ action: 'write' });
    expect(decideListWrite(live(5n), 4n)).toEqual({ action: 'conflict', kind: 'bothModified' });
    expect(decideListWrite(live(5n), null)).toEqual({ action: 'conflict', kind: 'bothModified' });
  });
  it('supprimée sur le serveur : deletedOnServer', () => {
    expect(decideListWrite(gone(6n), 5n)).toEqual({ action: 'conflict', kind: 'deletedOnServer' });
  });
});

describe('RT_68 — écriture d’un déploiement', () => {
  const base = { base: null, pushedListId: 'L', list: live(1n), duplicateExists: false };
  it('création sur une liste vivante : écrite', () => {
    expect(decideDeploymentWrite({ ...base, server: null })).toEqual({ action: 'write' });
  });
  it('RT_07 : la liste ne change pas (LIST_MISMATCH), prioritaire', () => {
    expect(decideDeploymentWrite({ ...base, server: live(2n, 'M') })).toEqual({ action: 'reject', code: 'LIST_MISMATCH' });
  });
  it('liste jamais vue : UNKNOWN_LIST', () => {
    expect(decideDeploymentWrite({ ...base, server: null, list: null })).toEqual({ action: 'reject', code: 'UNKNOWN_LIST' });
  });
  it('liste supprimée : listDeletedOnServer, avant tout autre conflit', () => {
    expect(decideDeploymentWrite({ ...base, server: gone(3n, 'L'), list: gone(4n) })).toEqual({
      action: 'conflict',
      kind: 'listDeletedOnServer',
    });
  });
  it('création d’un triplet déjà porté et non vu : duplicateDeployment', () => {
    expect(decideDeploymentWrite({ ...base, server: null, duplicateExists: true })).toEqual({
      action: 'conflict',
      kind: 'duplicateDeployment',
    });
  });
  it('modification : jeton courant, périmé, supprimé', () => {
    expect(decideDeploymentWrite({ ...base, server: live(2n, 'L'), base: 2n })).toEqual({ action: 'write' });
    expect(decideDeploymentWrite({ ...base, server: live(3n, 'L'), base: 2n })).toEqual({ action: 'conflict', kind: 'bothModified' });
    expect(decideDeploymentWrite({ ...base, server: gone(3n, 'L'), base: 2n })).toEqual({ action: 'conflict', kind: 'deletedOnServer' });
  });
});

describe('RT_68 — suppressions', () => {
  it('jamais synchronisé ou déjà supprimé : acceptée sans effet (point 6)', () => {
    expect(decideDeploymentDeletion(null, null)).toEqual({ action: 'noop' });
    expect(decideDeploymentDeletion(gone(4n), 3n)).toEqual({ action: 'noop' });
    expect(decideListDeletion(null, null, 0)).toEqual({ action: 'noop' });
  });
  it('jeton courant : supprimé ; périmé ou absent : deletedLocally (point 7)', () => {
    expect(decideDeploymentDeletion(live(4n), 4n)).toEqual({ action: 'delete' });
    expect(decideDeploymentDeletion(live(4n), 3n)).toEqual({ action: 'conflict', kind: 'deletedLocally' });
    expect(decideDeploymentDeletion(live(4n), null)).toEqual({ action: 'conflict', kind: 'deletedLocally' });
    expect(decideListDeletion(live(4n), 3n, 0)).toEqual({ action: 'conflict', kind: 'deletedLocally' });
  });
  it('liste avec des déploiements restants : listDeletedLocally, prioritaire (point 9)', () => {
    expect(decideListDeletion(live(4n), 4n, 1)).toEqual({ action: 'conflict', kind: 'listDeletedLocally' });
    expect(decideListDeletion(live(4n), 3n, 2)).toEqual({ action: 'conflict', kind: 'listDeletedLocally' });
    expect(decideListDeletion(live(4n), 4n, 0)).toEqual({ action: 'delete' });
  });
});

describe('RG_54 — doublon non vu (point 10)', () => {
  it('écrit après since, avant le verrou, par un autre appareil', () => {
    expect(isUnseenDuplicate({ revision: 5n, authorDeviceId: 'B' }, 4n, 9n, 'A')).toBe(true);
    expect(isUnseenDuplicate({ revision: 4n, authorDeviceId: 'B' }, 4n, 9n, 'A')).toBe(false);
    expect(isUnseenDuplicate({ revision: 10n, authorDeviceId: 'B' }, 4n, 9n, 'A')).toBe(false);
    expect(isUnseenDuplicate({ revision: 5n, authorDeviceId: 'A' }, 4n, 9n, 'A')).toBe(false);
  });
});

describe('RG_54 — résolution périmée (point 11)', () => {
  it('jeton du groupe = plus haute révision ; périmé dès qu’il change', () => {
    expect(groupToken([3n, 8n, 5n])).toBe(8n);
    expect(isResolutionStale(8n, groupToken([3n, 8n, 5n]))).toBe(false);
    expect(isResolutionStale(8n, groupToken([3n, 8n, 5n, 9n]))).toBe(true);
  });
});
