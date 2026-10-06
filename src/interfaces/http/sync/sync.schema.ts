import { z } from 'zod';
import { PULL_DEFAULT_LIMIT, PULL_MAX_LIMIT } from '#constants/limits';

const sinceSchema = z.string().max(20).regex(/^\d*$/, { message: 'Révision attendue (chiffres).' });

// openapi.yml : paramètres de GET /sync/changes.
export const pullQuerySchema = z.object({
  since: sinceSchema.optional(),
  limit: z.coerce.number().int().min(1).max(PULL_MAX_LIMIT).default(PULL_DEFAULT_LIMIT),
});
export type PullQuery = z.infer<typeof pullQuerySchema>;

// openapi.yml : SyncPushRequest — enveloppe seulement. Chaque enregistrement
// est validé à part : un enregistrement hors bornes est rejeté
// (INVALID_RECORD) sans faire échouer la requête (RT_69).
export const pushBodySchema = z.object({
  since: sinceSchema,
  lists: z.array(z.unknown()).optional(),
  deployments: z.array(z.unknown()).optional(),
  deletions: z.array(z.unknown()).optional(),
});
export type PushBody = z.infer<typeof pushBodySchema>;
