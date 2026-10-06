import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { app, bearer, expectConformant, login, newDevice, register, request, type Session } from '../helpers/api.js';
import { armyList, deployment, deploymentId, listId } from '../helpers/fixtures.js';
import { pullAll, push, pushOk, withToken } from '../helpers/sync.js';

async function resolve(session: Session, body: Record<string, unknown>, key: string = randomUUID()) {
  const res = await request(app)
    .post('/v1/sync/conflicts/resolve')
    .set(bearer(session))
    .set('Idempotency-Key', key)
    .send(body);
  expectConformant(res, 'POST', '/sync/conflicts/resolve');
  return res;
}

async function twoDevices() {
  const desktop = await register(undefined, newDevice('Chrome — Windows', 'web'));
  const phone = await login(desktop.email, newDevice('Pixel 8', 'android'));
  return { desktop, phone };
}

// Prépare un conflit « modifié des deux côtés » sur une liste.
async function bothModifiedList() {
  const { desktop, phone } = await twoDevices();
  const l = listId();
  const t1 = (await pushOk(desktop, { lists: [armyList(l)] }))[l];
  await pushOk(desktop, { lists: [withToken(armyList(l, { name: 'bureau' }), t1)] });
  const local = armyList(l, { name: 'téléphone' });
  const res = await push(phone, { lists: [withToken(local, t1)] });
  const conflict = res.body.conflicts[0];
  expect(conflict.kind).toBe('bothModified');
  return { desktop, phone, l, local, conflict };
}

describe('POST /sync/conflicts/resolve — modifié des deux côtés (RG_54)', () => {
  it('keepLocal : la version locale est écrite et l’autre appareil la reçoit', async () => {
    const { desktop, phone, l, local, conflict } = await bothModifiedList();
    const res = await resolve(phone, {
      resourceType: 'list', id: l, kind: 'bothModified', resolution: 'keepLocal',
      serverVersionToken: conflict.serverVersionToken, localRecord: local,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      resourceType: 'list', id: l, deleted: false,
      record: expect.objectContaining({ name: 'téléphone', versionToken: '3' }),
      versionToken: '3', relatedRecords: [], relatedDeletions: [],
    });
    const pulled = await pullAll(desktop, '2');
    expect(pulled.lists).toEqual([expect.objectContaining({ id: l, name: 'téléphone' })]);
  });

  it('keepServer : rien n’est écrit, la version serveur est renvoyée', async () => {
    const { phone, l, conflict } = await bothModifiedList();
    const res = await resolve(phone, {
      resourceType: 'list', id: l, kind: 'bothModified', resolution: 'keepServer',
      serverVersionToken: conflict.serverVersionToken,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deleted: false, record: { name: 'bureau' }, versionToken: '2' });
    expect((await pullAll(phone, '2')).lists).toEqual([]);
  });

  it('résolution périmée : 409 CONFLICT_STALE si le serveur a changé depuis', async () => {
    const { desktop, phone, l, local, conflict } = await bothModifiedList();
    await pushOk(desktop, { lists: [withToken(armyList(l, { name: 'bureau 2' }), conflict.serverVersionToken)] });
    const res = await resolve(phone, {
      resourceType: 'list', id: l, kind: 'bothModified', resolution: 'keepLocal',
      serverVersionToken: conflict.serverVersionToken, localRecord: local,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT_STALE');
    // Rien n'a été écrit.
    expect((await pullAll(desktop, '3')).lists).toEqual([]);
  });

  it('rejoue la réponse initiale avec la même clé d’idempotence', async () => {
    const { phone, l, local, conflict } = await bothModifiedList();
    const key = randomUUID();
    const body = {
      resourceType: 'list', id: l, kind: 'bothModified', resolution: 'keepLocal',
      serverVersionToken: conflict.serverVersionToken, localRecord: local,
    };
    const first = await resolve(phone, body, key);
    const replay = await resolve(phone, body, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
  });

  it('exige localRecord pour keepLocal (400)', async () => {
    const { phone, l, conflict } = await bothModifiedList();
    const res = await resolve(phone, {
      resourceType: 'list', id: l, kind: 'bothModified', resolution: 'keepLocal',
      serverVersionToken: conflict.serverVersionToken,
    });
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('localRecord');
  });
});

describe('POST /sync/conflicts/resolve — suppressions (RG_54)', () => {
  it('deletedOnServer + keepLocal : l’enregistrement est rétabli', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const d = deploymentId();
    const t = await pushOk(desktop, { lists: [armyList(l)], deployments: [deployment(l, d)] });
    await pushOk(desktop, { deletions: [{ resourceType: 'deployment', id: d, versionToken: t[d] }] });
    const local = deployment(l, d, { name: 'gardé' });
    const conflict = (await push(phone, { deployments: [withToken(local, t[d])] })).body.conflicts[0];
    expect(conflict.kind).toBe('deletedOnServer');
    const res = await resolve(phone, {
      resourceType: 'deployment', id: d, kind: 'deletedOnServer', resolution: 'keepLocal',
      serverVersionToken: conflict.serverVersionToken, localRecord: local,
    });
    expect(res.body).toMatchObject({ deleted: false, record: { name: 'gardé' }, versionToken: '4' });
  });

  it('deletedLocally + keepLocal : supprimé ; keepServer : la version serveur revient', async () => {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const d = deploymentId();
    const t = await pushOk(desktop, { lists: [armyList(l)], deployments: [deployment(l, d)] });
    await pushOk(desktop, { deployments: [withToken(deployment(l, d, { name: 'modifié' }), t[d])] });
    const conflict = (await push(phone, { deletions: [{ resourceType: 'deployment', id: d, versionToken: t[d] }] })).body.conflicts[0];
    expect(conflict.kind).toBe('deletedLocally');

    const server = await resolve(phone, {
      resourceType: 'deployment', id: d, kind: 'deletedLocally', resolution: 'keepServer',
      serverVersionToken: conflict.serverVersionToken,
    });
    expect(server.body).toMatchObject({ deleted: false, record: { name: 'modifié' } });

    const local = await resolve(phone, {
      resourceType: 'deployment', id: d, kind: 'deletedLocally', resolution: 'keepLocal',
      serverVersionToken: conflict.serverVersionToken,
    });
    expect(local.body).toEqual({ resourceType: 'deployment', id: d, deleted: true, relatedRecords: [], relatedDeletions: [] });
    expect((await pullAll(desktop, '3')).deletedDeploymentIds).toEqual([d]);
  });
});

describe('POST /sync/conflicts/resolve — liste supprimée, déploiement modifié (RG_54)', () => {
  async function listDeletedOnServer() {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const d = deploymentId();
    const t = await pushOk(desktop, { lists: [armyList(l)], deployments: [deployment(l, d)] });
    await pushOk(desktop, {
      deletions: [
        { resourceType: 'deployment', id: d, versionToken: t[d] },
        { resourceType: 'list', id: l, versionToken: t[l] },
      ],
    });
    const created = deploymentId();
    const local = deployment(l, created, { boardId: 'board-7' });
    const conflict = (await push(phone, { since: '2', deployments: [local] })).body.conflicts[0];
    expect(conflict.kind).toBe('listDeletedOnServer');
    return { desktop, phone, l, d, created, local, conflict };
  }

  it('keepLocal : la liste est restaurée avec le déploiement', async () => {
    const { desktop, phone, l, created, local, conflict } = await listDeletedOnServer();
    const res = await resolve(phone, {
      resourceType: 'deployment', id: created, kind: 'listDeletedOnServer', resolution: 'keepLocal',
      serverVersionToken: conflict.serverVersionToken, localRecord: local, localList: armyList(l),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      deleted: false,
      record: { id: created },
      relatedRecords: [{ resourceType: 'list', record: { id: l }, versionToken: '5' }],
      relatedDeletions: [],
    });
    const pulled = await pullAll(desktop, '4');
    expect(pulled.lists.map((x) => x.id)).toEqual([l]);
    expect(pulled.deployments.map((x) => x.id)).toEqual([created]);
  });

  it('keepServer : le déploiement, sa liste et ses déploiements connus sont à supprimer localement', async () => {
    const { phone, l, d, created, local, conflict } = await listDeletedOnServer();
    const res = await resolve(phone, {
      resourceType: 'deployment', id: created, kind: 'listDeletedOnServer', resolution: 'keepServer',
      serverVersionToken: conflict.serverVersionToken, localRecord: local,
    });
    expect(res.body).toEqual({
      resourceType: 'deployment', id: created, deleted: true, relatedRecords: [],
      relatedDeletions: [{ resourceType: 'list', id: l }, { resourceType: 'deployment', id: d }],
    });
  });

  async function listDeletedLocally() {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    const t = await pushOk(desktop, { lists: [armyList(l)] });
    const unseen = deploymentId();
    await pushOk(phone, { since: '1', deployments: [deployment(l, unseen)] });
    const conflict = (await push(desktop, { deletions: [{ resourceType: 'list', id: l, versionToken: t[l] }] })).body.conflicts[0];
    expect(conflict.kind).toBe('listDeletedLocally');
    return { desktop, phone, l, unseen, conflict };
  }

  it('listDeletedLocally + keepLocal : la liste et tous ses déploiements serveur sont supprimés (RG_21)', async () => {
    const { desktop, phone, l, unseen, conflict } = await listDeletedLocally();
    const res = await resolve(desktop, {
      resourceType: 'list', id: l, kind: 'listDeletedLocally', resolution: 'keepLocal',
      serverVersionToken: conflict.serverVersionToken,
    });
    expect(res.body).toMatchObject({ deleted: true });
    const pulled = await pullAll(phone, '2');
    expect(pulled.deletedListIds).toEqual([l]);
    expect(pulled.deletedDeploymentIds).toEqual([unseen]);
  });

  it('listDeletedLocally + keepServer : la liste et ses déploiements reviennent', async () => {
    const { desktop, l, unseen, conflict } = await listDeletedLocally();
    const res = await resolve(desktop, {
      resourceType: 'list', id: l, kind: 'listDeletedLocally', resolution: 'keepServer',
      serverVersionToken: conflict.serverVersionToken,
    });
    expect(res.body).toMatchObject({
      deleted: false,
      record: { id: l },
      relatedRecords: [{ resourceType: 'deployment', record: { id: unseen }, versionToken: '2' }],
    });
  });

  it('listDeletedLocally : périmé si un nouveau déploiement apparaît', async () => {
    const { desktop, phone, l, conflict } = await listDeletedLocally();
    await pushOk(phone, { since: '2', deployments: [deployment(l, deploymentId(), { boardId: 'board-3' })] });
    const res = await resolve(desktop, {
      resourceType: 'list', id: l, kind: 'listDeletedLocally', resolution: 'keepLocal',
      serverVersionToken: conflict.serverVersionToken,
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /sync/conflicts/resolve — même plateau créé deux fois (RG_54)', () => {
  async function duplicate() {
    const { desktop, phone } = await twoDevices();
    const l = listId();
    await pushOk(desktop, { lists: [armyList(l)] });
    const serverId = deploymentId();
    await pushOk(desktop, { since: '1', deployments: [deployment(l, serverId)] });
    const localId = deploymentId();
    const local = deployment(l, localId, { name: 'téléphone' });
    const conflict = (await push(phone, { since: '1', deployments: [local] })).body.conflicts[0];
    expect(conflict.kind).toBe('duplicateDeployment');
    return { desktop, phone, serverId, localId, local, conflict };
  }

  it('keepLocal : le déploiement serveur est supprimé, le local écrit', async () => {
    const { desktop, phone, serverId, localId, local, conflict } = await duplicate();
    const res = await resolve(phone, {
      resourceType: 'deployment', id: localId, kind: 'duplicateDeployment', resolution: 'keepLocal',
      serverVersionToken: conflict.serverVersionToken, localRecord: local, duplicateServerDeploymentId: serverId,
    });
    expect(res.body).toMatchObject({ deleted: false, record: { id: localId }, relatedRecords: [], relatedDeletions: [] });
    const pulled = await pullAll(desktop, '2');
    expect(pulled.deletedDeploymentIds).toEqual([serverId]);
    expect(pulled.deployments.map((x) => x.id)).toEqual([localId]);
  });

  it('keepServer : le déploiement local est écarté, celui de l’autre appareil renvoyé (point 13)', async () => {
    const { phone, serverId, localId, conflict } = await duplicate();
    const res = await resolve(phone, {
      resourceType: 'deployment', id: localId, kind: 'duplicateDeployment', resolution: 'keepServer',
      serverVersionToken: conflict.serverVersionToken, duplicateServerDeploymentId: serverId,
    });
    expect(res.body).toEqual({
      resourceType: 'deployment', id: localId, deleted: true,
      relatedRecords: [expect.objectContaining({ resourceType: 'deployment', record: expect.objectContaining({ id: serverId }) })],
      relatedDeletions: [],
    });
  });

  it('exige duplicateServerDeploymentId (400)', async () => {
    const { phone, localId, conflict } = await duplicate();
    const res = await resolve(phone, {
      resourceType: 'deployment', id: localId, kind: 'duplicateDeployment', resolution: 'keepServer',
      serverVersionToken: conflict.serverVersionToken,
    });
    expect(res.status).toBe(400);
  });
});
