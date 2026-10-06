import type { ConflictKind, RejectionCode } from '#models/sync';
import { maxRevision } from '#models/revision.rules';

// Règles de décision de la poussée (RT_68, RG_54), sans base de données :
// chaque fonction reçoit l'état serveur utile et le jeton de base poussé.

// État serveur d'un enregistrement, réduit à ce qui décide.
export interface ServerState {
  revision: bigint;
  deleted: boolean;
  listId?: string | null;
}

export type Decision =
  | { action: 'write' }
  | { action: 'delete' }
  | { action: 'noop' }
  | { action: 'conflict'; kind: ConflictKind }
  | { action: 'reject'; code: RejectionCode };

const WRITE: Decision = { action: 'write' };
const DELETE: Decision = { action: 'delete' };
const NOOP: Decision = { action: 'noop' };
const conflict = (kind: ConflictKind): Decision => ({ action: 'conflict', kind });
const reject = (code: RejectionCode): Decision => ({ action: 'reject', code });

// RT_68 : le serveur écrit seulement si le jeton de base est encore le sien.
function baseMatches(base: bigint | null, server: ServerState): boolean {
  return base !== null && base === server.revision;
}

// Liste créée ou modifiée.
export function decideListWrite(server: ServerState | null, base: bigint | null): Decision {
  // Création — ou enregistrement dont la trace a été purgée (point 8) :
  // l'appareil revient d'un 410 avec une modification en attente.
  if (!server) return WRITE;
  // RT_68 cas 2 : modifié ici, supprimé ailleurs.
  if (server.deleted) return conflict('deletedOnServer');
  // RT_68 cas 1 : jeton de base périmé — modifié des deux côtés. Une
  // création dont l'identifiant existe déjà est traitée de même (point 7).
  return baseMatches(base, server) ? WRITE : conflict('bothModified');
}

export interface DeploymentWriteInput {
  server: ServerState | null;
  base: bigint | null;
  pushedListId: string;
  list: ServerState | null;
  // RT_68 cas 5 : un déploiement du même triplet, que l'appareil n'a pas vu,
  // existe sur le serveur (calculé par l'appelant, point 10).
  duplicateExists: boolean;
}

// Déploiement créé ou modifié.
export function decideDeploymentWrite(input: DeploymentWriteInput): Decision {
  const { server, base, pushedListId, list, duplicateExists } = input;
  // RT_07 : la liaison liste ↔ déploiement est immuable.
  if (server && server.listId !== pushedListId) return reject('LIST_MISMATCH');
  // Liste jamais vue sur le compte (ni créée par cette poussée, traitée
  // avant) — ou dont la trace a été purgée (point 8).
  if (!list) return reject('UNKNOWN_LIST');
  // RT_68 cas 4 : déploiement créé ou modifié ici, liste supprimée ailleurs.
  if (list.deleted) return conflict('listDeletedOnServer');
  if (!server) {
    // RT_68 cas 5 : même plateau créé deux fois (RG_54).
    return duplicateExists ? conflict('duplicateDeployment') : WRITE;
  }
  if (server.deleted) return conflict('deletedOnServer');
  return baseMatches(base, server) ? WRITE : conflict('bothModified');
}

// Suppression d'un déploiement.
export function decideDeploymentDeletion(server: ServerState | null, base: bigint | null): Decision {
  // RT_68 : suppression d'un enregistrement jamais synchronisé, ou déjà
  // supprimé sur le serveur (point 6) : acceptée sans effet.
  if (!server || server.deleted) return NOOP;
  // RT_68 cas 1 : supprimé ici, modifié ailleurs — y compris une
  // suppression sans jeton d'un enregistrement que le serveur porte (point 7).
  return baseMatches(base, server) ? DELETE : conflict('deletedLocally');
}

// Suppression d'une liste, une fois traitées les suppressions de ses
// déploiements de la même poussée.
export function decideListDeletion(server: ServerState | null, base: bigint | null, liveDeployments: number): Decision {
  if (!server || server.deleted) return NOOP;
  // RT_68 cas 3 : le serveur porte encore des déploiements de cette liste —
  // absents des suppressions de la poussée, ou modifiés depuis (leur
  // suppression vient d'être refusée). Prime sur le jeton périmé (point 9).
  if (liveDeployments > 0) return conflict('listDeletedLocally');
  return baseMatches(base, server) ? DELETE : conflict('deletedLocally');
}

// RT_68 « Ordre dans une poussée » : listes écrites, déploiements écrits,
// suppressions de déploiements, suppressions de listes. Un déploiement peut
// ainsi référencer une liste créée dans la même poussée, et une liste n'est
// supprimée qu'après ses déploiements.
export const PUSH_PHASES = ['listWrites', 'deploymentWrites', 'deploymentDeletions', 'listDeletions'] as const;
export type PushPhase = (typeof PUSH_PHASES)[number];

export function phaseOf(kind: 'write' | 'deletion', resourceType: 'list' | 'deployment'): PushPhase {
  if (kind === 'write') return resourceType === 'list' ? 'listWrites' : 'deploymentWrites';
  return resourceType === 'list' ? 'listDeletions' : 'deploymentDeletions';
}

export function orderOperations<T extends { kind: 'write' | 'deletion'; resourceType: 'list' | 'deployment' }>(
  operations: readonly T[],
): T[] {
  // Tri stable : l'ordre d'arrivée est conservé au sein d'une phase.
  return PUSH_PHASES.flatMap((phase) => operations.filter((op) => phaseOf(op.kind, op.resourceType) === phase));
}

// RG_54/RT_68 « Résolution périmée » (point 11) : le jeton présenté au joueur
// est la plus haute révision du groupe de l'enregistrement — une liste et
// tous ses déploiements, ou un déploiement et sa liste. Les révisions du
// compte étant croissantes, le groupe n'a pas changé tant que ce maximum est
// inchangé ; un membre apparu ou modifié l'augmente.
export function groupToken(revisions: Iterable<bigint>): bigint {
  return maxRevision(revisions);
}

export function isResolutionStale(presentedToken: bigint, currentGroupToken: bigint): boolean {
  return presentedToken !== currentGroupToken;
}

// RG_54 point 10 : un déploiement du même triplet n'est un doublon que s'il
// a été écrit après le `since` de l'appareil et avant cette poussée, par un
// autre appareil.
export function isUnseenDuplicate(
  candidate: { revision: bigint; authorDeviceId: string },
  since: bigint,
  revisionAtLock: bigint,
  pushingDeviceId: string,
): boolean {
  return candidate.revision > since && candidate.revision <= revisionAtLock && candidate.authorDeviceId !== pushingDeviceId;
}
