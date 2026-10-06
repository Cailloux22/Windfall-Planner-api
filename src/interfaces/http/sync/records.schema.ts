import { z } from 'zod';
import { chars } from '#schemas/common.schema';

// RT_69 : bornes de toutes les données, calquées sur openapi.yml. Les objets
// ne gardent que les champs du contrat (point 16 du plan) ; `versionToken`
// est lu puis retiré du contenu stocké.

const recordId = chars(1, 100);
const referentialId = chars(1, 100);
const name = chars(0, 200);
// ClientTimestamp (RT_68) : RFC 3339 avec fuseau, conservé tel quel.
const clientTimestamp = z.iso.datetime({ offset: true });

export const versionTokenSchema = z
  .string()
  .max(20)
  .regex(/^\d+$/, { message: 'Révision attendue (chiffres).' })
  .nullable()
  .optional();

const placementSchema = z.object({
  idUnite: recordId,
  idModele: chars(1, 150),
  x: z.number().min(0).max(10_000),
  y: z.number().min(0).max(10_000),
  rotation: z.number().min(-3600).max(3600),
});

const unitModelGroupSchema = z.object({
  id: recordId,
  name,
  count: z.int().min(1).max(500),
  baseShapeId: chars(0, 100).nullable().optional(),
  customRectangleMm: z
    .object({
      widthMm: z.number().gt(0).max(1000),
      lengthMm: z.number().gt(0).max(1000),
    })
    .optional(),
});

const unitAttachmentSchema = z.object({
  bodyguardUnitId: recordId,
  role: z.enum(['leader', 'support']),
});

const armyUnitSchema = z.object({
  id: recordId,
  name,
  modelCount: z.int().min(1).max(500),
  modelGroups: z.array(unitModelGroupSchema).min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  attachment: unitAttachmentSchema.optional(),
});

// openapi.yml : ArmyList.
export const armyListSchema = z.object({
  id: recordId,
  name,
  forceDispositionId: referentialId,
  units: z.array(armyUnitSchema).max(300),
  importedAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: clientTimestamp,
  versionToken: versionTokenSchema,
});
export type ArmyList = z.infer<typeof armyListSchema>;

// openapi.yml : Deployment. Point 2 du plan : `note` absente = chaîne vide.
export const deploymentSchema = z.object({
  id: recordId,
  name,
  listId: recordId,
  opponentDispositionId: referentialId,
  boardId: referentialId,
  placements: z.array(placementSchema).max(2000),
  reservedUnitIds: z.array(recordId).max(300),
  note: chars(0, 4000).default(''),
  createdAt: clientTimestamp.optional(),
  updatedAt: clientTimestamp,
  versionToken: versionTokenSchema,
});
export type Deployment = z.infer<typeof deploymentSchema>;

// openapi.yml : Deletion.
export const deletionSchema = z.object({
  resourceType: z.enum(['list', 'deployment']),
  id: recordId,
  versionToken: versionTokenSchema,
  deletedAt: clientTimestamp.optional(),
});
export type Deletion = z.infer<typeof deletionSchema>;
