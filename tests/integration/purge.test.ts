import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import MaintenanceUsecases from '#usecases/maintenance';
import { prismaClient } from '#shared/prisma/index';
import { app, bearer, expectConformant, register, request } from '../helpers/api.js';
import { armyList, listId } from '../helpers/fixtures.js';
import { pushOk } from '../helpers/sync.js';

const DAY = 24 * 3600 * 1000;

describe('purge RT_70', () => {
  it('purge les traces de plus de 90 jours, retient la révision purgée, puis 410', async () => {
    const session = await register();
    const ids = [listId(), listId(), listId()];
    const t = await pushOk(session, { lists: ids.map((id) => armyList(id)) });
    await pushOk(session, {
      deletions: ids.slice(0, 2).map((id) => ({ resourceType: 'list', id, versionToken: t[id] })),
    });
    // Révisions 4 et 5 : deux traces ; la première vieillie de 91 jours,
    // la seconde de 89.
    await prismaClient.record.update({
      where: { userId_resourceType_id: { userId: session.userId, resourceType: 'list', id: ids[0]! } },
      data: { deletedAt: new Date(Date.now() - 91 * DAY) },
    });
    await prismaClient.record.update({
      where: { userId_resourceType_id: { userId: session.userId, resourceType: 'list', id: ids[1]! } },
      data: { deletedAt: new Date(Date.now() - 89 * DAY) },
    });

    const report = await new MaintenanceUsecases().purge();
    expect(report.deletionTraces).toBe(1);
    const account = await prismaClient.user.findUnique({ where: { id: session.userId } });
    expect(account!.purgedRevision).toBe(4n);
    expect(await prismaClient.record.count({ where: { userId: session.userId } })).toBe(2);

    const expired = await request(app).get('/v1/sync/changes').query({ since: '3' }).set(bearer(session));
    expectConformant(expired, 'GET', '/sync/changes');
    expect(expired.status).toBe(410);
    const ok = await request(app).get('/v1/sync/changes').query({ since: '4' }).set(bearer(session));
    expect(ok.status).toBe(200);
    expect(ok.body.deletedListIds).toEqual([ids[1]]);
  });

  it('purge les clés d’idempotence de plus de 24 heures', async () => {
    const session = await register();
    const old = randomUUID();
    const recent = randomUUID();
    for (const [key, age] of [[old, 25], [recent, 23]] as const) {
      await prismaClient.idempotencyKey.create({
        data: {
          userId: session.userId, key, requestHash: new Uint8Array(32), responseStatus: 200,
          responseBody: {}, createdAt: new Date(Date.now() - age * 3600 * 1000),
        },
      });
    }
    const report = await new MaintenanceUsecases().purge();
    expect(report.idempotencyKeys).toBeGreaterThanOrEqual(1);
    const keys = await prismaClient.idempotencyKey.findMany({ where: { userId: session.userId } });
    expect(keys.map((k) => k.key)).toEqual([recent]);
  });
});
