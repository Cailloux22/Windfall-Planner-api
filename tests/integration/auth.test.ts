import { describe, expect, it } from 'vitest';
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

describe('POST /auth/register (RG_50, RT_67)', () => {
  it('crée le compte, normalise l’email et renvoie un jeton d’appareil', async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: `  ${email.toUpperCase()} `, password: PASSWORD, device: newDevice() });
    expectConformant(res, 'POST', '/auth/register');
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    // RT_67 : 256 bits en base64url.
    expect(res.body.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('refuse un second compte pour la même adresse normalisée (409 EMAIL_TAKEN)', async () => {
    const email = uniqueEmail();
    await register(email);
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: email.toUpperCase(), password: PASSWORD, device: newDevice() });
    expectConformant(res, 'POST', '/auth/register');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('exige un mot de passe de 8 à 128 caractères (400 VALIDATION_FAILED)', async () => {
    for (const password of ['1234567', 'x'.repeat(129)]) {
      const res = await request(app)
        .post('/v1/auth/register')
        .send({ email: uniqueEmail(), password, device: newDevice() });
      expectConformant(res, 'POST', '/auth/register');
      expect(res.status).toBe(400);
      expect(res.body.details[0].field).toBe('password');
    }
    const ok = await request(app)
      .post('/v1/auth/register')
      .send({ email: uniqueEmail(), password: '12345678', device: newDevice() });
    expect(ok.status).toBe(201);
  });

  it('répond 400 à un JSON mal formé', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expectConformant(res, 'POST', '/auth/register');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /auth/login (RG_50, RG_53, RT_67)', () => {
  it('connecte un appareil existant', async () => {
    const session = await register();
    const other = await login(session.email.toUpperCase(), newDevice('Pixel 8', 'android'));
    expect(other.userId).toBe(session.userId);
    expect(other.token).not.toBe(session.token);
  });

  it('répond de façon indistinguable pour un email inconnu et un mot de passe erroné', async () => {
    const session = await register();
    const t0 = performance.now();
    const unknown = await request(app)
      .post('/v1/auth/login')
      .send({ email: uniqueEmail('inconnu'), password: PASSWORD, device: newDevice() });
    const t1 = performance.now();
    const wrong = await request(app)
      .post('/v1/auth/login')
      .send({ email: session.email, password: 'mauvais mot de passe', device: newDevice() });
    const t2 = performance.now();
    expectConformant(unknown, 'POST', '/auth/login');
    expectConformant(wrong, 'POST', '/auth/login');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
    // RG_50 : l'email inconnu est vérifié contre un hash factice — les deux
    // réponses coûtent un calcul argon2 (même ordre de grandeur).
    const unknownMs = t1 - t0;
    const wrongMs = t2 - t1;
    expect(unknownMs).toBeGreaterThan(wrongMs / 4);
    expect(wrongMs).toBeGreaterThan(unknownMs / 4);
  });

  it('remplace le jeton d’un appareil qui se reconnecte, sans toucher aux autres', async () => {
    const first = await register();
    const phone = newDevice('Pixel 8', 'android');
    const phoneOld = await login(first.email, phone);
    const phoneNew = await login(first.email, phone);

    const old = await request(app).get('/v1/account').set(bearer(phoneOld));
    expectConformant(old, 'GET', '/account');
    expect(old.status).toBe(401);
    expect(old.body.code).toBe('UNAUTHENTICATED');

    expect((await request(app).get('/v1/account').set(bearer(phoneNew))).status).toBe(200);
    // RG_53 : l'appareil d'origine reste connecté.
    expect((await request(app).get('/v1/account').set(bearer(first))).status).toBe(200);
  });
});

describe('authentification par jeton d’appareil (RT_67)', () => {
  it('répond 401 UNAUTHENTICATED à un jeton absent ou inconnu', async () => {
    for (const headers of [{}, { Authorization: 'Bearer inconnu' }, { Authorization: 'Basic abc' }]) {
      const res = await request(app).get('/v1/account').set(headers);
      expectConformant(res, 'GET', '/account');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    }
  });

  it('sert GET /auth/me comme alias déprécié de GET /account', async () => {
    const session = await register();
    const account = await request(app).get('/v1/account').set(bearer(session));
    const me = await request(app).get('/v1/auth/me').set(bearer(session));
    expectConformant(account, 'GET', '/account');
    expectConformant(me, 'GET', '/auth/me');
    expect(me.body).toEqual(account.body);
    expect(account.body).toEqual({ id: session.userId, email: session.email, createdAt: expect.any(String) });
  });

  it('POST /auth/logout ne supprime que le jeton présenté', async () => {
    const session = await register();
    const other = await login(session.email, newDevice('Pixel 8', 'android'));
    const res = await request(app).post('/v1/auth/logout').set(bearer(session));
    expectConformant(res, 'POST', '/auth/logout');
    expect(res.status).toBe(204);
    expect((await request(app).get('/v1/account').set(bearer(session))).status).toBe(401);
    expect((await request(app).get('/v1/account').set(bearer(other))).status).toBe(200);
  });
});
