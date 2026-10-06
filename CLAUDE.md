# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The **sync server of Windfall Planner** (`RT_09`): accounts with permanent per-device tokens and delta synchronisation of army lists and deployments between a player's devices. The client app lives in the sibling repository `../40K-deployment-planner` (Angular/Ionic/Capacitor, offline-first).

## Specification — the source of truth is the app repository

- `../40K-deployment-planner/specification/spec.md` — rules `EX_06`, `RG_10`, `RG_11`, `RG_19`, `RG_50`–`RG_54`, `RT_09`, `RT_10`, `RT_15`, `RT_21`, `RT_67`–`RT_72`, plus `RT_07`, `RG_14`, `RG_21`. The implementation decisions taken at server init are listed under `RT_68` (« Précisions d'implémentation »).
- `specification/openapi.yml` and `specification/schema.sql` here are **copies** of the app repo's files. Edit them there first, then copy here. `tests/helpers/contract.ts` validates every integration-test response against `specification/openapi.yml`.

**Traceability rule (same as the app):** tag code with `// RG_XX : …` / `// RT_XX : …` (in French) at the exact point each rule is applied. Untraced behaviour means a missing rule: add it to spec.md (after committing spec.md's current state on its own, per the app's CLAUDE.md) or ask.

**Version rule (`RT_72`):** the server's version is `version` in this `package.json`, independent of the app's. Every commit that changes server code or config bumps the patch (`npm version patch --no-git-tag-version`, stage `package.json` + `package-lock.json`); spec/doc-only commits don't. Never touch the app's version from here. `/health` reports it.

## Commands

Node 24 LTS (`.nvmrc`), Docker for PostgreSQL 18.

```bash
npm run setup        # env:init (.env from .env.example) + db:up + db:migrate
npm run dev          # tsx watch, http://localhost:3000/v1
npm run build && npm start
npm run typecheck
npm run lint
npm test             # vitest: unit + integration (needs `npm run db:up`)
npx vitest run tests/integration/push.test.ts   # one file
npm run db:drift     # prisma migrate diff DB → schema.prisma must be empty; CHECKs/partial indexes present
npm run purge        # RT_70 purges (dist); purge:dev with tsx
bash scripts/e2e-scenario.sh   # curl scenario against a running server
```

Docker services: `db` (dev, port 5432, volume) and `db-test` (port 5433, tmpfs). Integration tests migrate `DATABASE_URL_TEST` once (`tests/integration/global-setup.ts`), truncate `users` before each file, reset rate-limit counters before each test, and run files sequentially.

## Architecture

Layered, one file per resource and per layer, same name everywhere; classes instantiated by the layer above (no DI container):

```
src/main/{index,app}.ts            listen + graceful shutdown; middleware order, /v1 mounting, error handler last
src/routes/*.ts                    Express routers: rate limit → body parser (per-route limit) → validate → idempotency → controller
src/adapter/controllers/*.ts       thin HTTP layer, arrow functions
src/adapter/usecases/*.ts          business orchestration (RG_/RT_), opens transactions via repositories/transaction.ts
src/adapter/repositories/*.ts      the ONLY layer that talks to Prisma; methods take an optional `tx`
src/domains/models/*.rules.ts      pure decisions, unit-tested (sync.rules.ts = RT_68 conflict cases, push order, group token)
src/domains/{errors,constants}     AppError(code, status, French message, details) + handler; RT_69/RT_70 limits
src/interfaces/http/**.schema.ts   Zod schemas mirroring openapi.yml
src/middlewares/                   auth (device token), client-version (426), cors, rate-limit, idempotency, json-body, logger
src/shared/{env,prisma,zod,crypto} env parsed by Zod (fail-fast), Prisma singleton (pg adapter), validate(), tokens/argon2
src/jobs/purge.ts                  RT_70 maintenance
```

Path aliases are Node **subpath imports** (`"imports"` in package.json): `#routes/*`, `#controllers/*`, `#usecases/*`, `#repositories/*`, `#models/*`, `#errors/*`, `#constants/*`, `#schemas/*`, `#middlewares/*`, `#shared/*`, `#generated/*`, `#main/*`. Each maps to `./src/…/*.ts` under the `development` condition (tsx `--conditions=development`, vitest `resolve.conditions`, tsconfig `customConditions`) and to `./dist/…/*.js` otherwise (plain `node` in production). Import them **without extension** (`#usecases/sync`). There is no other alias mechanism.

Prisma 7: `prisma.config.ts` holds the datasource URL; the client is generated into `src/generated/prisma` (git-ignored, `postinstall`/`build` regenerate it) and needs the `@prisma/adapter-pg` adapter. CHECK constraints and partial indexes exist only in `prisma/migrations/*_init/migration.sql` (copied from `schema.sql`) — Prisma can't express them; `npm run db:drift` checks they are present.

### Sync mechanics worth knowing before editing

- **Revisions** (`RT_70`): per-account counter in `users.revision`; push/resolve lock it with `SELECT … FOR UPDATE` (`RecordsRepository.lockAccount`), allocate revisions in memory (`RecordSession`), write `users.revision` once at the end. `bigint` in DB, strings on the wire (`revision.rules.ts`), never `Number()`.
- **Push** (`usecases/sync.ts`): ops ordered by `orderOperations` (list writes → deployment writes → deployment deletions → list deletions); each op decided by a pure `decide*` function; conflicts carry a **group token** (max revision of list + its deployments, or deployment + its list) computed on the final state; a resolution is stale iff that token changed.
- **Idempotency**: the middleware replays stored responses; new keys are recorded by `withIdempotency` *inside* the locked transaction, together with the writes.
- **Pull** runs in REPEATABLE READ; a full pull (no `since`) skips deletions and its last page returns the account revision as `nextToken`.
- **Rate limits** use an in-memory store: correct for a single instance only.
- **Logs** never contain email, token, `Authorization` or record content; Prisma errors are logged by name/code only.
