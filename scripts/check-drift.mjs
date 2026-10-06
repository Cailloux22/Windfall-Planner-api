// RT_70 : contrôle de dérive entre schema.prisma, la migration et la base.
//  1. `prisma migrate diff` base → schema.prisma doit être vide ;
//  2. les objets que Prisma ne voit pas (contraintes CHECK, index partiels et
//     index unique de révision) doivent exister dans la base, tels que
//     specification/schema.sql les déclare.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const diff = spawnSync(
  'npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code',
  { encoding: 'utf8', shell: true },
);
if (diff.status !== 0) {
  console.error(diff.stdout, diff.stderr);
  console.error(diff.status === 2 ? 'Dérive détectée entre la base et schema.prisma.' : 'prisma migrate diff a échoué.');
  process.exit(1);
}
console.log('prisma migrate diff : aucune dérive entre la base et schema.prisma.');

const expectedChecks = [
  'users_email_normalized',
  'users_revision_positive',
  'users_purged_revision_bounds',
  'device_tokens_hash_length',
  'device_tokens_name_not_empty',
  'device_tokens_platform',
  'records_resource_type',
  'records_id_not_empty',
  'records_revision_positive',
  'records_author_platform',
  'records_deleted_consistency',
  'records_deployment_columns',
  'idempotency_keys_hash_length',
];
const expectedIndexes = {
  records_user_revision_idx: /UNIQUE INDEX .* \(user_id, revision\)$/,
  records_user_list_idx: /\(user_id, list_id\) WHERE \(\(resource_type\)::text = 'deployment'::text\)$/,
  records_deleted_at_idx: /\(deleted_at\) WHERE deleted$/,
  idempotency_keys_created_at_idx: /\(created_at\)$/,
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const checks = await client.query(
    "SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace",
  );
  const presentChecks = new Set(checks.rows.map((row) => row.conname));
  const missingChecks = expectedChecks.filter((name) => !presentChecks.has(name));

  const indexes = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'");
  const defs = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]));
  const badIndexes = Object.entries(expectedIndexes)
    .filter(([name, pattern]) => !pattern.test(defs.get(name) ?? ''))
    .map(([name]) => `${name} : ${defs.get(name) ?? 'absent'}`);

  if (missingChecks.length > 0 || badIndexes.length > 0) {
    if (missingChecks.length > 0) console.error(`Contraintes CHECK absentes : ${missingChecks.join(', ')}`);
    for (const line of badIndexes) console.error(`Index non conforme — ${line}`);
    process.exitCode = 1;
  } else {
    console.log(`${expectedChecks.length} contraintes CHECK et ${Object.keys(expectedIndexes).length} index conformes à schema.sql.`);
  }
} finally {
  await client.end();
}
