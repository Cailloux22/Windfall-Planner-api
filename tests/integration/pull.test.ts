import { describe, expect, it } from 'vitest';
import { prismaClient } from '#shared/prisma/index';
import { app, bearer, expectConformant, register, request, type Session } from '../helpers/api.js';
import { armyList, deployment, listId } from '../helpers/fixtures.js';
import { seedDelete, seedWrite } from '../helpers/seed.js';

async function pull(session: Session, query: Record<string, string | undefined> = {}) {
  const res = await request(app).get('/v1/sync/changes').query(query).set(bearer(session));
  expectConformant(res, 'GET', '/sync/changes');
  return res;
}

describe('GET /sync/summary (RG_51)', () => {
  it('compte vide : zéro enregistrement, lastChangeAt null', async () => {
    const session = await register();
    const res = await request(app).get('/v1/sync/summary').set(bearer(session));
    expectConformant(res, 'GET', '/sync/summary');
    expect(res.body).toEqual({ listCount: 0, deploymentCount: 0, lastChangeAt: null });
  });

  it('compte les enregistrements actifs et date la dernière modification', async () => {
    const session = await register();
    const l1 = listId();
    await seedWrite(session, 'list', armyList(l1, { updatedAt: '2026-10-05T08:00:00.000Z' }));
    const l2 = listId();
    await seedWrite(session, 'list', armyList(l2));
    await seedWrite(session, 'deployment', deployment(l1, undefined, { updatedAt: '2026-10-06T12:30:00+02:00' }));
    await seedDelete(session, 'list', l2);
    const res = await request(app).get('/v1/sync/summary').set(bearer(session));
    expectConformant(res, 'GET', '/sync/summary');
    expect(res.body).toEqual({ listCount: 1, deploymentCount: 1, lastChangeAt: '2026-10-06T10:30:00.000Z' });
  });
});

describe('GET /sync/changes (RT_68, RT_70)', () => {
  it('compte vide : page vide, nextToken 0', async () => {
    const session = await register();
    const res = await pull(session);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      lists: [], deployments: [], deletedListIds: [], deletedDeploymentIds: [], nextToken: '0', hasMore: false,
    });
  });

  it('pull complet : enregistrements actifs seulement, avec leur versionToken', async () => {
    const session = await register();
    const kept = listId();
    const removed = listId();
    const keptList = armyList(kept);
    const r1 = await seedWrite(session, 'list', keptList);
    await seedWrite(session, 'list', armyList(removed));
    await seedDelete(session, 'list', removed);
    const res = await pull(session);
    expect(res.body.lists).toEqual([{ ...keptList, versionToken: r1.toString() }]);
    expect(res.body.deletedListIds).toEqual([]);
    expect(res.body.nextToken).toBe('3');
    expect(res.body.hasMore).toBe(false);
  });

  it('pagine par révision croissante et reprend à nextToken', async () => {
    const session = await register();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = listId();
      ids.push(id);
      await seedWrite(session, 'list', armyList(id));
    }
    const seen: string[] = [];
    let since: string | undefined = '0';
    let pages = 0;
    for (;;) {
      const res = await pull(session, { since: since!, limit: '2' });
      pages += 1;
      seen.push(...(res.body.lists as { id: string }[]).map((l) => l.id));
      since = res.body.nextToken;
      if (!res.body.hasMore) break;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(ids);
    expect(since).toBe('5');
  });

  it('delta : renvoie suppressions et dernier état, chaque enregistrement une fois', async () => {
    const session = await register();
    const l1 = listId();
    const l2 = listId();
    await seedWrite(session, 'list', armyList(l1));
    const d1 = deployment(l1);
    const base = await seedWrite(session, 'deployment', d1);
    await seedWrite(session, 'list', armyList(l2));
    await seedWrite(session, 'list', armyList(l1, { name: 'renommée une fois' }));
    const last = await seedWrite(session, 'list', armyList(l1, { name: 'renommée deux fois' }));
    await seedDelete(session, 'deployment', d1.id);

    const res = await pull(session, { since: base.toString() });
    expect((res.body.lists as { id: string }[]).map((l) => l.id)).toEqual([l2, l1]);
    expect(res.body.lists[1]).toMatchObject({ name: 'renommée deux fois', versionToken: last.toString() });
    expect(res.body.deletedDeploymentIds).toEqual([d1.id]);
    expect(res.body.nextToken).toBe('6');
  });

  it('delta sans changement : nextToken inchangé', async () => {
    const session = await register();
    await seedWrite(session, 'list', armyList());
    const res = await pull(session, { since: '1' });
    expect(res.body).toMatchObject({ lists: [], nextToken: '1', hasMore: false });
  });

  it('répond 410 SYNC_TOKEN_EXPIRED quand since précède des traces purgées', async () => {
    const session = await register();
    for (let i = 0; i < 4; i++) await seedWrite(session, 'list', armyList());
    await prismaClient.user.update({ where: { id: session.userId }, data: { purgedRevision: 3n } });
    const expired = await pull(session, { since: '2' });
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe('SYNC_TOKEN_EXPIRED');
    expect((await pull(session, { since: '3' })).status).toBe(200);
    // Pull complet : jamais de 410.
    expect((await pull(session)).status).toBe(200);
  });

  it('valide since et limit (400)', async () => {
    const session = await register();
    for (const query of [{ since: 'abc' }, { since: '1'.repeat(21) }, { limit: '0' }, { limit: '501' }, { limit: 'x' }]) {
      const res = await pull(session, query);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('ne renvoie jamais les enregistrements d’un autre compte', async () => {
    const mine = await register();
    const other = await register();
    await seedWrite(other, 'list', armyList());
    const res = await pull(mine);
    expect(res.body.lists).toEqual([]);
  });
});
