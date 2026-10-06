import { z } from 'zod';
import { chars } from '#schemas/common.schema';
import { CONFLICT_KINDS } from '#models/sync';
import { armyListSchema, deploymentSchema, type ArmyList, type Deployment } from '#schemas/sync/records.schema';

const recordId = chars(1, 100);

// RG_54 : cas qui ne portent que sur un déploiement, ou une liste.
const DEPLOYMENT_KINDS = new Set(['listDeletedOnServer', 'duplicateDeployment']);
const LIST_KINDS = new Set(['listDeletedLocally']);
// keepLocal d'une suppression locale : pas de version locale à écrire.
const LOCAL_DELETION_KINDS = new Set(['deletedLocally', 'listDeletedLocally']);

const envelope = z.object({
  resourceType: z.enum(['list', 'deployment']),
  id: recordId,
  kind: z.enum(CONFLICT_KINDS),
  resolution: z.enum(['keepLocal', 'keepServer']),
  serverVersionToken: z.string().max(20).regex(/^\d+$/, { message: 'Révision attendue (chiffres).' }),
  localRecord: z.unknown().optional(),
  localList: armyListSchema.optional(),
  duplicateServerDeploymentId: recordId.optional(),
});

// openapi.yml : ConflictResolution, avec les exigences croisées décrites par
// le contrat (RT_68). Toute non-conformité de la requête reçoit 400.
export const resolveBodySchema = envelope.transform((value, ctx) => {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message });
    return z.NEVER;
  };
  if (DEPLOYMENT_KINDS.has(value.kind) && value.resourceType !== 'deployment') {
    return issue(['kind'], 'Ce cas de conflit porte sur un déploiement.');
  }
  if (LIST_KINDS.has(value.kind) && value.resourceType !== 'list') {
    return issue(['kind'], 'Ce cas de conflit porte sur une liste.');
  }

  let localRecord: ArmyList | Deployment | undefined;
  if (value.localRecord !== undefined) {
    const schema = value.resourceType === 'list' ? armyListSchema : deploymentSchema;
    const parsed = schema.safeParse(value.localRecord);
    if (!parsed.success) {
      for (const sub of parsed.error.issues) ctx.addIssue({ code: 'custom', path: ['localRecord', ...sub.path.map(String)], message: sub.message });
      return z.NEVER;
    }
    localRecord = parsed.data;
    if (localRecord.id !== value.id) return issue(['localRecord', 'id'], 'Doit être l’identifiant du conflit.');
  }

  if (value.resolution === 'keepLocal' && !LOCAL_DELETION_KINDS.has(value.kind) && !localRecord) {
    return issue(['localRecord'], 'Requis pour garder la version locale.');
  }
  if (value.kind === 'listDeletedOnServer' && value.resolution === 'keepLocal') {
    if (!value.localList) return issue(['localList'], 'Requis pour restaurer la liste avec le déploiement.');
    if (value.localList.id !== (localRecord as Deployment).listId) {
      return issue(['localList', 'id'], 'Doit être la liste du déploiement.');
    }
  }
  if (value.kind === 'duplicateDeployment' && !value.duplicateServerDeploymentId) {
    return issue(['duplicateServerDeploymentId'], 'Requis pour un déploiement en double.');
  }
  return { ...value, localRecord };
});

export type ResolveBody = z.output<typeof resolveBodySchema>;
