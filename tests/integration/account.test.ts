import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prismaClient } from '#shared/prisma/index';
import {
  app,
  bearer,
  expectConformant,
  login,
  newDevice,
  PASSWORD,
  register,
  request,
  uniqueEmail,
} from '../helpers/api.js';

describe('PUT /account/password (RG_52, RG_53)', () => {
  it('exige le mot de passe courant', async () => {
    const session = await register();
    const res = await request(app)
      .put('/v1/account/password')
      .set(bearer(session))
      .send({ currentPassword: 'pas le bon', newPassword: 'nouveau mot de passe' });
    expectConformant(res, 'PUT', '/account/password');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('change le mot de passe sans déconnecter aucun appareil', async () => {
    const session = await register();
    const other = await login(session.email, newDevice('Pixel 8', 'android'));
    const res = await request(app)
      .put('/v1/account/password')
      .set(bearer(session))
      .send({ currentPassword: PASSWORD, newPassword: 'nouveau mot de passe' });
    expectConformant(res, 'PUT', '/account/password');
    expect(res.status).toBe(204);

    expect((await request(app).get('/v1/account').set(bearer(session))).status).toBe(200);
    expect((await request(app).get('/v1/account').set(bearer(other))).status).toBe(200);
    await expect(login(session.email, newDevice())).rejects.toThrow(/401/);
    await login(session.email, newDevice(), 'nouveau mot de passe');
  });
});

describe('PUT /account/email (RG_52, RG_50)', () => {
  it('normalise la nouvelle adresse et garde les appareils connectés', async () => {
    const session = await register();
    const newEmail = uniqueEmail('nouvelle');
    const res = await request(app)
      .put('/v1/account/email')
      .set(bearer(session))
      .send({ newEmail: ` ${newEmail.toUpperCase()}`, password: PASSWORD });
    expectConformant(res, 'PUT', '/account/email');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(newEmail);
    expect((await request(app).get('/v1/account').set(bearer(session))).body.email).toBe(newEmail);
  });

  it('refuse une adresse déjà prise (409 EMAIL_TAKEN)', async () => {
    const taken = await register();
    const session = await register();
    const res = await request(app)
      .put('/v1/account/email')
      .set(bearer(session))
      .send({ newEmail: taken.email, password: PASSWORD });
    expectConformant(res, 'PUT', '/account/email');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('exige le mot de passe', async () => {
    const session = await register();
    const res = await request(app)
      .put('/v1/account/email')
      .set(bearer(session))
      .send({ newEmail: uniqueEmail(), password: 'mauvais' });
    expectConformant(res, 'PUT', '/account/email');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('POST /account/delete (RG_52, RT_70)', () => {
  async function countRows(userId: string) {
    const [users, tokens, records, keys] = await Promise.all([
      prismaClient.user.count({ where: { id: userId } }),
      prismaClient.deviceToken.count({ where: { userId } }),
      prismaClient.record.count({ where: { userId } }),
      prismaClient.idempotencyKey.count({ where: { userId } }),
    ]);
    return { users, tokens, records, keys };
  }

  it('exige le mot de passe', async () => {
    const session = await register();
    const res = await request(app).post('/v1/account/delete').set(bearer(session)).send({ password: 'mauvais' });
    expectConformant(res, 'POST', '/account/delete');
    expect(res.status).toBe(401);
    expect((await countRows(session.userId)).users).toBe(1);
  });

  it('supprime toutes les données du compte dans les quatre tables', async () => {
    const session = await register();
    const other = await login(session.email, newDevice('Pixel 8', 'android'));
    // Données du compte écrites directement : un enregistrement vivant, une
    // trace de suppression, une clé d'idempotence.
    await prismaClient.record.createMany({
      data: [
        {
          userId: session.userId, resourceType: 'list', id: 'list_a', revision: 1n,
          content: { id: 'list_a' }, authorDeviceId: session.device.id,
          authorDeviceName: session.device.name, authorDevicePlatform: 'web',
        },
        {
          userId: session.userId, resourceType: 'list', id: 'list_b', revision: 2n, deleted: true,
          deletedAt: new Date(), authorDeviceId: session.device.id,
          authorDeviceName: session.device.name, authorDevicePlatform: 'web',
        },
      ],
    });
    await prismaClient.user.update({ where: { id: session.userId }, data: { revision: 2n } });
    await prismaClient.idempotencyKey.create({
      data: {
        userId: session.userId, key: randomUUID(), requestHash: new Uint8Array(32),
        responseStatus: 200, responseBody: {},
      },
    });
    expect(await countRows(session.userId)).toEqual({ users: 1, tokens: 2, records: 2, keys: 1 });

    const res = await request(app).post('/v1/account/delete').set(bearer(session)).send({ password: PASSWORD });
    expectConformant(res, 'POST', '/account/delete');
    expect(res.status).toBe(204);
    expect(await countRows(session.userId)).toEqual({ users: 0, tokens: 0, records: 0, keys: 0 });

    // RG_53 : les autres appareils reçoivent 401 à leur prochain appel.
    expect((await request(app).get('/v1/account').set(bearer(other))).status).toBe(401);
    // L'adresse est libérée.
    await register(session.email);
  });
});
