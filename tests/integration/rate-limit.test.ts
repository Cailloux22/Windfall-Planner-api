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

// RT_69 : seuils de limitation de débit, 429 RATE_LIMITED + Retry-After.
describe('limitation de débit (RT_69)', () => {
  it('inscription : 5 par heure et par adresse IP', async () => {
    for (let i = 0; i < 5; i++) await register();
    const res = await request(app)
      .post('/v1/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD, device: newDevice() });
    expectConformant(res, 'POST', '/auth/register');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(3000);
  });

  it('connexion échouée : 5 par 15 minutes et par email, puis refus même avec le bon mot de passe', async () => {
    const session = await register();
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/v1/auth/login')
        .send({ email: session.email, password: 'mauvais', device: newDevice() });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app)
      .post('/v1/auth/login')
      .send({ email: ` ${session.email.toUpperCase()}`, password: PASSWORD, device: newDevice() });
    expectConformant(blocked, 'POST', '/auth/login');
    expect(blocked.status).toBe(429);
    // RG_50 : le message indique le délai d'attente.
    expect(blocked.body.message).toMatch(/minute/);
  });

  it('connexion réussie : ne compte pas dans les échecs par email', async () => {
    const session = await register();
    for (let i = 0; i < 6; i++) await login(session.email, newDevice());
  });

  it('connexion : 20 par 15 minutes et par adresse IP', async () => {
    const session = await register();
    for (let i = 0; i < 20; i++) await login(session.email, newDevice());
    const res = await request(app)
      .post('/v1/auth/login')
      .send({ email: session.email, password: PASSWORD, device: newDevice() });
    expectConformant(res, 'POST', '/auth/login');
    expect(res.status).toBe(429);
  });

  it('mot de passe erroné sur une action de compte : 5 par 15 minutes et par compte', async () => {
    const session = await register();
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .put('/v1/account/email')
        .set(bearer(session))
        .send({ newEmail: uniqueEmail(), password: 'mauvais' });
      expect(res.status).toBe(401);
    }
    const res = await request(app)
      .post('/v1/account/delete')
      .set(bearer(session))
      .send({ password: PASSWORD });
    expectConformant(res, 'POST', '/account/delete');
    expect(res.status).toBe(429);
  });

  it('toute autre requête : 120 par minute et par jeton d’appareil', async () => {
    const session = await register();
    for (let i = 0; i < 120; i++) {
      expect((await request(app).get('/v1/account').set(bearer(session))).status).toBe(200);
    }
    const res = await request(app).get('/v1/account').set(bearer(session));
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });
});
