import type { DeviceLabel } from '#models/device';
import type { RecordContent, ResourceType } from '#models/record';

export type WireRecord = RecordContent & { versionToken: string };

// openapi.yml : SyncSummary (RG_51).
export interface SyncSummary {
  listCount: number;
  deploymentCount: number;
  lastChangeAt: string | null;
}

// openapi.yml : SyncPullResult (RT_68).
export interface PullResult {
  lists: WireRecord[];
  deployments: WireRecord[];
  deletedListIds: string[];
  deletedDeploymentIds: string[];
  nextToken: string;
  hasMore: boolean;
}

// openapi.yml : AcceptedRecord.
export interface AcceptedRecord {
  resourceType: ResourceType;
  id: string;
  deleted: boolean;
  versionToken?: string;
}

// openapi.yml : RejectedRecord.
export type RejectionCode = 'INVALID_RECORD' | 'UNKNOWN_LIST' | 'LIST_MISMATCH';
export interface RejectedRecord {
  resourceType: ResourceType;
  id: string;
  code: RejectionCode;
  message: string;
}

// openapi.yml : Conflict (RG_54).
export const CONFLICT_KINDS = [
  'bothModified',
  'deletedOnServer',
  'deletedLocally',
  'listDeletedOnServer',
  'listDeletedLocally',
  'duplicateDeployment',
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

export interface Conflict {
  resourceType: ResourceType;
  id: string;
  kind: ConflictKind;
  serverRecord: WireRecord | null;
  serverVersionToken: string;
  serverUpdatedAt: string;
  serverDevice: DeviceLabel;
  relatedServerRecords?: WireRecord[];
}

// openapi.yml : SyncPushResult.
export interface PushResult {
  accepted: AcceptedRecord[];
  conflicts: Conflict[];
  rejected: RejectedRecord[];
}

// openapi.yml : ConflictResolutionResult.
export interface RelatedRecord {
  resourceType: ResourceType;
  record: WireRecord;
  versionToken: string;
}

export interface ResolutionResult {
  resourceType: ResourceType;
  id: string;
  deleted: boolean;
  record?: WireRecord;
  versionToken?: string;
  relatedRecords: RelatedRecord[];
  relatedDeletions: { resourceType: ResourceType; id: string }[];
}
