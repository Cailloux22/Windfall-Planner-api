import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '#main/app';

const app = createApp();

describe('RT_69 — X-Client-Version', () => {
  it('répond 426 CLIENT_TOO_OLD sous la version minimale (0.0.5 en test)', async () => {
    const res = await request(app).get('/v1/sync/summary').set('X-Client-Version', '0.0.4');
    expect(res.status).toBe(426);
    expect(res.body.code).toBe('CLIENT_TOO_OLD');
  });

  it('répond 400 VALIDATION_FAILED à un en-tête mal formé', async () => {
    const res = await request(app).get('/v1/sync/summary').set('X-Client-Version', 'beta');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details[0].field).toBe('headers.X-Client-Version');
  });
});

describe('RT_71 — CORS', () => {
  it('autorise une origine du client et les en-têtes du contrat', async () => {
    const res = await request(app)
      .options('/v1/sync/changes')
      .set('Origin', 'http://localhost:4200')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key,x-client-version');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(res.headers['access-control-allow-headers']).toBe(
      'Authorization,Content-Type,Idempotency-Key,X-Client-Version',
    );
  });

  it('expose Retry-After', async () => {
    const res = await request(app).get('/v1/inconnue').set('Origin', 'https://localhost');
    expect(res.headers['access-control-expose-headers']).toBe('Retry-After');
  });

  it('n’autorise pas une autre origine', async () => {
    const res = await request(app)
      .options('/v1/sync/changes')
      .set('Origin', 'https://malveillant.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
