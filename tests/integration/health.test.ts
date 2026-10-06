import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '#main/app';
import { prismaClient } from '#shared/prisma/index';

const app = createApp();

describe('GET /health', () => {
  it('répond 200 quand la base répond, hors /v1 et sans authentification', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up', version: expect.any(String) as string });
  });
});

describe('schéma de la base (RT_70)', () => {
  it('reprend les contraintes CHECK de schema.sql', async () => {
    // records_deleted_consistency : un enregistrement vivant a un contenu.
    const [user] = await prismaClient.$queryRaw<{ id: string }[]>`
      INSERT INTO users (email, password_hash) VALUES ('check@example.com', 'x') RETURNING id`;
    await expect(prismaClient.$executeRaw`
      INSERT INTO records (user_id, resource_type, id, revision, deleted, content,
        author_device_id, author_device_name, author_device_platform)
      VALUES (${user!.id}::uuid, 'list', 'l1', 1, false, NULL,
        gen_random_uuid(), 'test', 'web')`).rejects.toThrow();
    // users_email_normalized : l'email est stocké normalisé.
    await expect(prismaClient.$executeRaw`
      INSERT INTO users (email, password_hash) VALUES (' Upper@Example.com', 'x')`).rejects.toThrow();
  });
});
