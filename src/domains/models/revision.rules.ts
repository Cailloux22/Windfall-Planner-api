// RT_70 : révisions — `bigint` en base, chaînes dans le contrat
// (`versionToken`, `since`, `nextToken`). Conversion explicite aux
// frontières, jamais par Number() (perte de précision au-delà de 2^53).

export const REVISION_PATTERN = /^\d+$/;

export function formatRevision(revision: bigint): string {
  return revision.toString(10);
}

// `since` d'un pull : vide ou absent = première synchronisation (null).
export function parsePullSince(since: string | undefined): bigint | null {
  if (since === undefined || since === '') return null;
  return BigInt(since);
}

// `since` d'une poussée : chaîne vide = l'appareil n'a jamais rien reçu (0).
export function parsePushSince(since: string): bigint {
  return since === '' ? 0n : BigInt(since);
}

// `versionToken` de base d'un enregistrement poussé : absent ou null pour
// une création.
export function parseBaseToken(token: string | null | undefined): bigint | null {
  if (token === undefined || token === null) return null;
  return BigInt(token);
}

export function maxRevision(revisions: Iterable<bigint>): bigint {
  let max = 0n;
  for (const revision of revisions) if (revision > max) max = revision;
  return max;
}

// RT_68/RT_70 : un `since` inférieur à la plus haute révision de trace
// purgée a pu manquer des suppressions — l'appareil doit refaire un pull
// complet (410).
export function isSinceExpired(since: bigint, purgedRevision: bigint): boolean {
  return since < purgedRevision;
}
