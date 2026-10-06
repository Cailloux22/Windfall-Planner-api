import type { DeviceLabel } from '#models/device';
import { formatRevision } from '#models/revision.rules';

export const RESOURCE_TYPES = ['list', 'deployment'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

// Contenu d'un enregistrement tel que stocké (RT_70) : ArmyList ou
// Deployment d'openapi.yml, sans `versionToken` (réinjecté à la lecture).
export type RecordContent = Record<string, unknown> & { id: string; updatedAt: string };

// Ligne de `records`, telle que la manipulent les usecases.
export interface StoredRecord {
  resourceType: ResourceType;
  id: string;
  revision: bigint;
  deleted: boolean;
  content: RecordContent | null;
  listId: string | null;
  opponentDispositionId: string | null;
  boardId: string | null;
  // RG_54 : appareil auteur de cette révision.
  author: DeviceLabel;
  // RT_70 : date serveur de la suppression (purge).
  deletedAt: Date | null;
  // RT_68 : date de la suppression fixée par l'appareil.
  clientDeletedAt: Date | null;
}

// Écriture d'un enregistrement vivant.
export interface RecordWrite {
  resourceType: ResourceType;
  id: string;
  content: RecordContent;
  listId: string | null;
  opponentDispositionId: string | null;
  boardId: string | null;
}

// Version renvoyée au client : le contenu stocké et son `versionToken`
// courant (RT_15/RT_70).
export function toWire(record: StoredRecord): RecordContent & { versionToken: string } {
  if (!record.content) throw new Error(`enregistrement supprimé sans contenu : ${record.id}`);
  return { ...record.content, versionToken: formatRevision(record.revision) };
}

// RG_54 : date affichée de la version serveur — son `updatedAt`, ou la date
// de sa suppression (celle de l'appareil si transmise, sinon celle du serveur).
export function displayedDate(record: StoredRecord): string {
  if (!record.deleted && record.content) return record.content.updatedAt;
  return (record.clientDeletedAt ?? record.deletedAt ?? new Date(0)).toISOString();
}
