import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prismaClient } from '#shared/prisma/index';
import { app, bearer, expectConformant, login, newDevice, register, request } from '../helpers/api.js';
import { armyList, deployment, deploymentId, listId } from '../helpers/fixtures.js';
import { pullAll, push, pushOk, withToken } from '../helpers/sync.js';

async function twoDevices() {
  const desktop = await register(undefined, newDevice('Chrome — Windows', 'web'));
  const phone = await login(desktop.email, newDevice('Pixel 8', 'android'));
  return { desktop, phone };
}

describe('POST /sync/changes — acceptation (RT_68)', () => {
  it('accepte des créations et renvoie la révision de chacune', async () => {
    const { desktop } = await twoDevices();
    const l = listId();
    const d = deploymentId();
    const res = await push(desktop, { lists: [armyList(l)], deployments: [deployment(l, d)] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accepted: [
        { resourceType: 'list', id: l, deleted: false, versionToken: '1' },
        { resourceType: 'deployment', id: d, deleted: false, versionToken: '2' },
      ],
      conflicts: [],
      rejected: [],
    });
  });

  it('traite les listes avant les déploiements : un déploiement peut référencer une liste de la même poussée', async () => {
    const { desktop } = await twoDevices();
    const l = listId();
    const d = deploymentId();
    // Ordre des tableaux dans le JSON indifférent : la phase décide.
    const res = await push(desktop, { deployments: [deployment(l, d)], lists: [armyList(l)] });
    expect(res.body.rejected).toEqual([]);
    expect(res.body.accepted.map((a: { id: string }) => a.id)).toEqual([l, d]);
  });

  it('accepte une modification portant le jeton courant, et l’autre appareil la reçoit', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const tokens = await pushOk(desktop, { lists: [armyList(l)] });
    const updated = await pushOk(desktop, { lists: [withToken(armyList(l, { name: 'v2' }), tokens[l])] });
    expect(updated[l]).toBe('2');
    const pulled = await pullAll(phone, '1');
    expect(pulled.lists).toEqual([expect.objectContaining({ id: l, name: 'v2', versionToken: '2' })]);
  });

  it('conserve createdAt/updatedAt tels quels et la note par défaut', async () => {
    const { desktop } = await twoDevices();
    const l = listId();
    const d = deployment(l, deploymentId(), { updatedAt: '2026-10-06T23:59:59+05:00' });
    const { note: _note, ...withoutNote } = d;
    await pushOk(desktop, { lists: [armyList(l)], deployments: [withoutNote] });
    const pulled = await pullAll(desktop);
    expect(pulled.deployments[0]).toMatchObject({ updatedAt: '2026-10-06T23:59:59+05:00', note: '' });
  });

  it('ne stocke que les champs du contrat', async () => {
    const { desktop } = await twoDevices();
    const l = listId();
    await pushOk(desktop, { lists: [{ ...armyList(l), secret: 'x', versionToken: null }] });
    const pulled = await pullAll(desktop);
    expect(pulled.lists[0]).not.toHaveProperty('secret');
  });

  it('accepte sans effet la suppression d’un enregistrement jamais synchronisé ou déjà supprimé', async () => {
    const { desktop } = await twoDevices();
    const l = listId();
    const tokens = await pushOk(desktop, { lists: [armyList(l)] });
    await pushOk(desktop, { deletions: [{ resourceType: 'list', id: l, versionToken: tokens[l] }] });
    const res = await push(desktop, {
      deletions: [
        { resourceType: 'list', id: listId() },
        { resourceType: 'list', id: l, versionToken: tokens[l] },
      ],
    });
    expect(res.body.accepted).toEqual([
      expect.objectContaining({ deleted: true }),
      expect.objectContaining({ id: l, deleted: true }),
    ]);
    const account = await prismaClient.user.findUnique({ where: { id: desktop.userId } });
    expect(account!.revision).toBe(2n);
  });

  it('fige l’auteur de chaque révision (RG_54)', async () => {
    const { desktop } = await twoDevices();
    const l = listId();
    await pushOk(desktop, { lists: [armyList(l)] });
    const row = await prismaClient.record.findFirst({ where: { userId: desktop.userId, id: l } });
    expect(row).toMatchObject({ authorDeviceId: desktop.device.id, authorDeviceName: 'Chrome — Windows', authorDevicePlatform: 'web' });
    // L'appareil se reconnecte sous un autre nom : la révision garde l'ancien.
    await login(desktop.email, { ...desktop.device, name: 'Firefox — Linux' });
    const again = await prismaClient.record.findFirst({ where: { userId: desktop.userId, id: l } });
    expect(again!.authorDeviceName).toBe('Chrome — Windows');
  });
});

describe('POST /sync/changes — les cinq cas de conflit (RT_68, RG_54)', () => {
  it('cas 1a — jeton de base périmé sur une écriture : bothModified', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const t1 = (await pushOk(desktop, { lists: [armyList(l)] }))[l];
    await pushOk(desktop, { lists: [withToken(armyList(l, { name: 'bureau', updatedAt: '2026-10-06T11:00:00.000Z' }), t1)] });
    const res = await push(phone, { lists: [withToken(armyList(l, { name: 'téléphone' }), t1)] });
    expect(res.body.accepted).toEqual([]);
    expect(res.body.conflicts).toEqual([
      {
        resourceType: 'list',
        id: l,
        kind: 'bothModified',
        serverRecord: expect.objectContaining({ id: l, name: 'bureau', versionToken: '2' }),
        serverVersionToken: '2',
        serverUpdatedAt: '2026-10-06T11:00:00.000Z',
        serverDevice: desktop.device,
      },
    ]);
  });

  it('cas 1b — suppression avec un jeton périmé : deletedLocally ; sans jeton aussi (point 7)', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const d = deploymentId();
    const t = await pushOk(desktop, { lists: [armyList(l)], deployments: [deployment(l, d)] });
    await pushOk(desktop, { deployments: [withToken(deployment(l, d, { name: 'modifié' }), t[d])] });
    const res = await push(phone, {
      deletions: [{ resourceType: 'deployment', id: d, versionToken: t[d] }],
    });
    expect(res.body.conflicts).toEqual([
      expect.objectContaining({ id: d, kind: 'deletedLocally', serverRecord: expect.objectContaining({ name: 'modifié' }) }),
    ]);
    const noToken = await push(phone, { deletions: [{ resourceType: 'deployment', id: d }] });
    expect(noToken.body.conflicts[0].kind).toBe('deletedLocally');
  });

  it('cas 2 — modifié ici, supprimé ailleurs : deletedOnServer, avec la date de suppression de l’appareil', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const d = deploymentId();
    const t = await pushOk(desktop, { lists: [armyList(l)], deployments: [deployment(l, d)] });
    await pushOk(desktop, {
      deletions: [{ resourceType: 'deployment', id: d, versionToken: t[d], deletedAt: '2026-10-06T15:00:00.000Z' }],
    });
    const res = await push(phone, { deployments: [withToken(deployment(l, d, { name: 'téléphone' }), t[d])] });
    expect(res.body.conflicts).toEqual([
      {
        resourceType: 'deployment',
        id: d,
        kind: 'deletedOnServer',
        serverRecord: null,
        serverVersionToken: '3',
        serverUpdatedAt: '2026-10-06T15:00:00.000Z',
        serverDevice: desktop.device,
      },
    ]);
  });

  it('cas 3 — liste supprimée ici alors qu’un autre appareil a un déploiement : listDeletedLocally', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const known = deploymentId();
    const t = await pushOk(desktop, { lists: [armyList(l)], deployments: [deployment(l, known)] });
    // Le téléphone crée un déploiement que le bureau n'a pas vu.
    const unseen = deploymentId();
    await pushOk(phone, { since: '2', deployments: [deployment(l, unseen, { boardId: 'board-2' })] });
    const res = await push(desktop, {
      deletions: [
        { resourceType: 'list', id: l, versionToken: t[l] },
        { resourceType: 'deployment', id: known, versionToken: t[known] },
      ],
    });
    // La suppression du déploiement connu est acceptée ; la liste est en conflit.
    expect(res.body.accepted).toEqual([{ resourceType: 'deployment', id: known, deleted: true }]);
    expect(res.body.conflicts).toEqual([
      expect.objectContaining({
        resourceType: 'list',
        id: l,
        kind: 'listDeletedLocally',
        serverRecord: expect.objectContaining({ id: l }),
        relatedServerRecords: [expect.objectContaining({ id: unseen })],
        serverDevice: phone.device,
        serverVersionToken: '4',
      }),
    ]);
  });

  it('cas 4 — déploiement créé ou modifié ici, liste supprimée ailleurs : listDeletedOnServer', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const d = deploymentId();
    const t = await pushOk(desktop, { lists: [armyList(l)], deployments: [deployment(l, d)] });
    await pushOk(desktop, {
      deletions: [
        { resourceType: 'list', id: l, versionToken: t[l] },
        { resourceType: 'deployment', id: d, versionToken: t[d] },
      ],
    });
    const created = deploymentId();
    const res = await push(phone, {
      since: '2',
      deployments: [withToken(deployment(l, d, { name: 'modifié' }), t[d]), deployment(l, created, { boardId: 'board-9' })],
    });
    expect(res.body.conflicts.map((c: { id: string; kind: string; serverRecord: unknown }) => [c.id, c.kind, c.serverRecord])).toEqual([
      [d, 'listDeletedOnServer', null],
      [created, 'listDeletedOnServer', null],
    ]);
    expect(res.body.conflicts[0].serverDevice).toEqual(desktop.device);
  });

  it('cas 5 — même plateau créé deux fois sans avoir vu l’autre : duplicateDeployment', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    await pushOk(desktop, { lists: [armyList(l)] });
    // Les deux appareils ont vu la liste (since = 1).
    const fromDesktop = deploymentId();
    await pushOk(desktop, { since: '1', deployments: [deployment(l, fromDesktop)] });
    const fromPhone = deploymentId();
    const res = await push(phone, { since: '1', deployments: [deployment(l, fromPhone)] });
    expect(res.body.conflicts).toEqual([
      expect.objectContaining({
        resourceType: 'deployment',
        id: fromPhone,
        kind: 'duplicateDeployment',
        serverRecord: expect.objectContaining({ id: fromDesktop }),
        serverVersionToken: '2',
        serverDevice: desktop.device,
      }),
    ]);
  });

  it('cas 5 — pas de doublon pour un appareil qui avait vu le déploiement (« sous un nouveau nom »)', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    await pushOk(desktop, { lists: [armyList(l)], deployments: [deployment(l)] });
    // Le téléphone a tiré jusqu'à la révision 2 : il connaît le déploiement.
    await pushOk(phone, { since: '2', deployments: [deployment(l, deploymentId(), { name: 'Plan B' })] });
    // Le bureau a tiré Plan B (révision 3) puis enregistre Plan C (révision 4).
    await pushOk(desktop, { since: '3', deployments: [deployment(l, deploymentId(), { name: 'Plan C' })] });
    // Sans avoir tiré, le bureau ne se voit pas opposer sa propre écriture.
    await pushOk(desktop, { since: '3', deployments: [deployment(l, deploymentId(), { name: 'Plan D' })] });
    // Deux créations du même triplet dans la même poussée : pas de conflit.
    await pushOk(phone, { since: '5', deployments: [deployment(l), deployment(l)] });
  });
});

describe('POST /sync/changes — rejets (RT_68, RT_69, RT_07)', () => {
  it('rejette un enregistrement hors bornes sans bloquer les autres', async () => {
    const { desktop } = await twoDevices();
    const good = listId();
    const longId = `list_${'x'.repeat(300)}`;
    const res = await push(desktop, {
      lists: [armyList(good), armyList(listId(), { units: 'pas un tableau' }), { ...armyList(), id: longId }],
      deployments: [deployment(good, deploymentId(), { placements: [{ idUnite: 'u', idModele: 'm', x: 10_001, y: 0, rotation: 0 }] })],
    });
    expect(res.body.accepted).toEqual([expect.objectContaining({ id: good })]);
    expect(res.body.rejected).toHaveLength(3);
    expect(res.body.rejected.map((r: { code: string }) => r.code)).toEqual(['INVALID_RECORD', 'INVALID_RECORD', 'INVALID_RECORD']);
    expect(res.body.rejected[1].id).toHaveLength(200);
    expect(res.body.rejected[2].message).toMatch(/placements\[0\]\.x/);
  });

  it('rejette un déploiement dont la liste n’a jamais existé (UNKNOWN_LIST)', async () => {
    const { desktop } = await twoDevices();
    const res = await push(desktop, { deployments: [deployment(listId())] });
    expect(res.body.rejected).toEqual([expect.objectContaining({ code: 'UNKNOWN_LIST', resourceType: 'deployment' })]);
  });

  it('rejette un changement de liste d’un déploiement existant (LIST_MISMATCH)', async () => {
    const { desktop } = await twoDevices();
    const l1 = listId();
    const l2 = listId();
    const d = deploymentId();
    const t = await pushOk(desktop, { lists: [armyList(l1), armyList(l2)], deployments: [deployment(l1, d)] });
    const res = await push(desktop, { deployments: [withToken(deployment(l2, d), t[d])] });
    expect(res.body.rejected).toEqual([expect.objectContaining({ id: d, code: 'LIST_MISMATCH' })]);
  });

  it('répond 400 à une enveloppe inexploitable (point 15)', async () => {
    const { desktop } = await twoDevices();
    for (const payload of [
      { deletions: [{ resourceType: 'unit', id: 'x' }] },
      { lists: [{ name: 'sans id' }] },
      { lists: 'pas un tableau' },
    ]) {
      const res = await push(desktop, payload as never);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    const noSince = await request(app).post('/v1/sync/changes').set(bearer(desktop)).send({ lists: [] });
    expect(noSince.status).toBe(400);
  });

  it('répond 413 BATCH_TOO_LARGE au-delà de 200 enregistrements ou de 5 Mo', async () => {
    const { desktop } = await twoDevices();
    const many = await push(desktop, {
      lists: Array.from({ length: 150 }, () => armyList()),
      deletions: Array.from({ length: 51 }, () => ({ resourceType: 'list', id: listId() })),
    });
    expect(many.status).toBe(413);
    expect(many.body.code).toBe('BATCH_TOO_LARGE');

    const huge = await push(desktop, { lists: [armyList(listId(), { name: 'x'.repeat(6 * 1024 * 1024) })] });
    expect(huge.status).toBe(413);
    expect(huge.body.code).toBe('BATCH_TOO_LARGE');
  });
});

describe('POST /sync/changes — cascade (RG_21)', () => {
  it('une suppression de liste acceptée supprime ses déploiements ; l’autre appareil reçoit les suppressions', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const d1 = deploymentId();
    const d2 = deploymentId();
    const t = await pushOk(desktop, {
      lists: [armyList(l)],
      deployments: [deployment(l, d1), deployment(l, d2, { boardId: 'board-2' })],
    });
    expect((await pullAll(phone)).deployments).toHaveLength(2);
    const res = await pushOk(desktop, {
      deletions: [
        { resourceType: 'list', id: l, versionToken: t[l] },
        { resourceType: 'deployment', id: d1, versionToken: t[d1] },
        { resourceType: 'deployment', id: d2, versionToken: t[d2] },
      ],
    });
    expect(Object.keys(res)).toEqual([d1, d2, l]);
    const pulled = await pullAll(phone, '3');
    expect(pulled.deletedListIds).toEqual([l]);
    expect(pulled.deletedDeploymentIds.sort()).toEqual([d1, d2].sort());
  });
});

describe('POST /sync/changes — idempotence (RT_68)', () => {
  it('rejoue la réponse initiale pour la même clé et le même corps, sans rien réécrire', async () => {
    const { desktop } = await twoDevices();
    const key = randomUUID();
    const payload = { lists: [armyList(listId())] };
    const first = await push(desktop, payload, key);
    const replay = await push(desktop, payload, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    const account = await prismaClient.user.findUnique({ where: { id: desktop.userId } });
    expect(account!.revision).toBe(1n);
  });

  it('répond 422 IDEMPOTENCY_KEY_REUSED pour la même clé et un autre corps', async () => {
    const { desktop } = await twoDevices();
    const key = randomUUID();
    await push(desktop, { lists: [armyList()] }, key);
    const res = await push(desktop, { lists: [armyList()] }, key);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('refuse une clé qui n’est pas un UUID (400)', async () => {
    const { desktop } = await twoDevices();
    const res = await push(desktop, { lists: [] }, 'pas-un-uuid');
    expect(res.status).toBe(400);
  });
});

describe('POST /sync/changes — concurrence (RT_70)', () => {
  it('deux poussées simultanées du même compte : ni trou ni doublon de révision', async () => {
    const { desktop, phone } = await twoDevices();
    const batch = () => Array.from({ length: 30 }, () => armyList());
    const [a, b, c] = await Promise.all([
      push(desktop, { lists: batch() }),
      push(phone, { lists: batch() }),
      push(desktop, { lists: batch() }),
    ]);
    for (const res of [a, b, c]) expect(res.body.accepted).toHaveLength(30);
    const tokens = [a, b, c]
      .flatMap((res) => (res.body.accepted as { versionToken: string }[]).map((x) => Number(x.versionToken)))
      .sort((x, y) => x - y);
    expect(tokens).toEqual(Array.from({ length: 90 }, (_, i) => i + 1));
    // Chaque poussée a reçu un bloc contigu (elles ne se sont pas entrelacées).
    for (const res of [a, b, c]) {
      const own = (res.body.accepted as { versionToken: string }[]).map((x) => Number(x.versionToken));
      expect(Math.max(...own) - Math.min(...own)).toBe(29);
    }
    const account = await prismaClient.user.findUnique({ where: { id: desktop.userId } });
    expect(account!.revision).toBe(90n);
  });
});

describe('suppression du compte après synchronisation (RG_52)', () => {
  it('ne laisse aucune ligne dans les quatre tables', async () => {
    const { desktop } = await twoDevices();
    const l = listId();
    const d = deploymentId();
    const t = await pushOk(desktop, { lists: [armyList(l), armyList()], deployments: [deployment(l, d)] });
    // Une trace de suppression et une clé d'idempotence en plus des lignes vivantes.
    await pushOk(desktop, {
      deletions: [
        { resourceType: 'list', id: l, versionToken: t[l] },
        { resourceType: 'deployment', id: d, versionToken: t[d] },
      ],
    });
    const res = await request(app).post('/v1/account/delete').set(bearer(desktop)).send({ password: 'correct horse battery' });
    expectConformant(res, 'POST', '/account/delete');
    expect(res.status).toBe(204);
    const counts = await Promise.all([
      prismaClient.user.count({ where: { id: desktop.userId } }),
      prismaClient.deviceToken.count({ where: { userId: desktop.userId } }),
      prismaClient.record.count({ where: { userId: desktop.userId } }),
      prismaClient.idempotencyKey.count({ where: { userId: desktop.userId } }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0]);
  });
});
