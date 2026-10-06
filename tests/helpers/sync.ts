import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { app, bearer, expectConformant, request, type Session } from './api.js';

export interface PushPayload {
  since?: string;
  lists?: unknown[];
  deployments?: unknown[];
  deletions?: unknown[];
}

export async function push(session: Session, payload: PushPayload, key: string = randomUUID()) {
  const res = await request(app)
    .post('/v1/sync/changes')
    .set(bearer(session))
    .set('Idempotency-Key', key)
    .send({ since: '', ...payload });
  expectConformant(res, 'POST', '/sync/changes');
  return res;
}

// Poussée attendue sans conflit ni rejet ; renvoie les jetons acceptés par id.
export async function pushOk(session: Session, payload: PushPayload): Promise<Record<string, string>> {
  const res = await push(session, payload);
  expect(res.status).toBe(200);
  expect(res.body.conflicts).toEqual([]);
  expect(res.body.rejected).toEqual([]);
  return Object.fromEntries(
    (res.body.accepted as { id: string; versionToken?: string }[]).map((a) => [a.id, a.versionToken ?? 'deleted']),
  );
}

export async function pullAll(session: Session, since?: string) {
  const res = await request(app)
    .get('/v1/sync/changes')
    .query(since === undefined ? {} : { since })
    .set(bearer(session));
  expectConformant(res, 'GET', '/sync/changes');
  expect(res.status).toBe(200);
  return res.body as {
    lists: { id: string; versionToken: string }[];
    deployments: { id: string; versionToken: string }[];
    deletedListIds: string[];
    deletedDeploymentIds: string[];
    nextToken: string;
    hasMore: boolean;
  };
}

export function withToken<T extends object>(record: T, versionToken: string | undefined): T & { versionToken?: string } {
  return { ...record, versionToken };
}
