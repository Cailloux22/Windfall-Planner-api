// RG_50 : l'adresse est normalisée (espaces retirés, minuscules) avant tout
// contrôle — unicité, connexion, limitation de débit.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
