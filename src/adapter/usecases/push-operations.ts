import type { z } from 'zod';
import { BatchTooLargeError, ValidationError, type ErrorDetail } from '#errors/app-error';
import { PUSH_MAX_RECORDS } from '#constants/limits';
import type { RecordContent, ResourceType } from '#models/record';
import { RESOURCE_TYPES } from '#models/record';
import {
  armyListSchema,
  deletionSchema,
  deploymentSchema,
  type ArmyList,
  type Deletion,
  type Deployment,
} from '#schemas/sync/records.schema';
import type { PushBody } from '#schemas/sync/sync.schema';
import { formatPath } from '#shared/zod/index';

// Découpage d'une poussée en opérations (RT_68) : l'enveloppe de chaque
// enregistrement doit être exploitable (objet, identifiant en chaîne, type de
// ressource connu) sinon la requête entière reçoit 400 (point 15) ; le
// contenu, lui, est validé enregistrement par enregistrement (RT_69 :
// rejet INVALID_RECORD sans bloquer les autres).

interface BaseOperation {
  index: number;
  // Identifiant tel que reçu, tronqué à 200 caractères (RejectedRecord.id).
  rawId: string;
  invalid?: string;
}

export interface ListWriteOperation extends BaseOperation {
  kind: 'write';
  resourceType: 'list';
  record?: ArmyList;
}

export interface DeploymentWriteOperation extends BaseOperation {
  kind: 'write';
  resourceType: 'deployment';
  record?: Deployment;
}

export interface DeletionOperation extends BaseOperation {
  kind: 'deletion';
  resourceType: ResourceType;
  record?: Deletion;
}

export type PushOperation = ListWriteOperation | DeploymentWriteOperation | DeletionOperation;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]!;
  const path = formatPath(issue.path);
  return `Enregistrement non conforme${path ? ` (${path})` : ''} : ${issue.message}`;
}

function parseRecord<T>(schema: z.ZodType<T>, value: unknown): { record?: T; invalid?: string } {
  const result = schema.safeParse(value);
  return result.success ? { record: result.data } : { invalid: firstIssue(result.error) };
}

export function toOperations(body: PushBody): PushOperation[] {
  const lists = body.lists ?? [];
  const deployments = body.deployments ?? [];
  const deletions = body.deletions ?? [];
  // RT_68/RT_69 : 200 enregistrements par poussée, toutes sortes confondues.
  if (lists.length + deployments.length + deletions.length > PUSH_MAX_RECORDS) {
    throw new BatchTooLargeError();
  }

  const details: ErrorDetail[] = [];
  const operations: PushOperation[] = [];

  lists.forEach((value, index) => {
    if (!isObject(value) || typeof value.id !== 'string') {
      details.push({ field: `lists[${index}].id`, message: 'Identifiant attendu.' });
      return;
    }
    operations.push({ kind: 'write', resourceType: 'list', index, rawId: value.id.slice(0, 200), ...parseRecord(armyListSchema, value) });
  });

  deployments.forEach((value, index) => {
    if (!isObject(value) || typeof value.id !== 'string') {
      details.push({ field: `deployments[${index}].id`, message: 'Identifiant attendu.' });
      return;
    }
    operations.push({ kind: 'write', resourceType: 'deployment', index, rawId: value.id.slice(0, 200), ...parseRecord(deploymentSchema, value) });
  });

  deletions.forEach((value, index) => {
    if (!isObject(value) || typeof value.id !== 'string') {
      details.push({ field: `deletions[${index}].id`, message: 'Identifiant attendu.' });
      return;
    }
    if (!RESOURCE_TYPES.includes(value.resourceType as ResourceType)) {
      details.push({ field: `deletions[${index}].resourceType`, message: 'Type attendu : list ou deployment.' });
      return;
    }
    operations.push({
      kind: 'deletion',
      resourceType: value.resourceType as ResourceType,
      index,
      rawId: value.id.slice(0, 200),
      ...parseRecord(deletionSchema, value),
    });
  });

  if (details.length > 0) throw new ValidationError(details);
  return operations;
}

// RT_70 : le contenu stocké est l'enregistrement validé, sans son jeton de
// base (réinjecté à la lecture avec la révision courante).
export function storedContent<T extends { versionToken?: string | null }>(record: T): RecordContent & Omit<T, 'versionToken'> {
  const { versionToken: _ignored, ...content } = record;
  return content as unknown as RecordContent & Omit<T, 'versionToken'>;
}
