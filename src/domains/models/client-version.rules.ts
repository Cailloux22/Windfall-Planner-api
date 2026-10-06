// RT_69/RG_47 : version de l'application `MAJEUR.MINEUR.CORRECTIF`.
export const CLIENT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export type Version = readonly [bigint, bigint, bigint];

export function parseVersion(value: string): Version | null {
  if (!CLIENT_VERSION_PATTERN.test(value)) return null;
  const [major, minor, patch] = value.split('.').map((part) => BigInt(part));
  return [major!, minor!, patch!];
}

// Comparaison numérique composante par composante (0.0.10 > 0.0.9).
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

// RT_69 : un en-tête absent signifie « compatible » ; seul un client
// strictement inférieur au minimum est refusé.
export function isClientTooOld(clientVersion: string | undefined, minimum: string): boolean {
  if (clientVersion === undefined) return false;
  const client = parseVersion(clientVersion);
  const min = parseVersion(minimum);
  if (!client || !min) return false;
  return compareVersions(client, min) < 0;
}
