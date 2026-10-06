import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '#main/app';
import { expectConformant } from './contract.js';

export const app: Express = createApp();

export interface Device {
  id: string;
  name: string;
  platform: 'android' | 'ios' | 'web';
}

export function newDevice(name = 'Chrome — Windows', platform: Device['platform'] = 'web'): Device {
  return { id: randomUUID(), name, platform };
}

let counter = 0;
export function uniqueEmail(prefix = 'joueur'): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.com`;
}

export const PASSWORD = 'correct horse battery';

export interface Session {
  token: string;
  userId: string;
  email: string;
  device: Device;
}

export async function register(email = uniqueEmail(), device = newDevice()): Promise<Session> {
  const res = await request(app).post('/v1/auth/register').send({ email, password: PASSWORD, device });
  expectConformant(res, 'POST', '/auth/register');
  if (res.status !== 201) throw new Error(`inscription : ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.deviceToken, userId: res.body.user.id, email, device };
}

export async function login(email: string, device: Device, password = PASSWORD): Promise<Session> {
  const res = await request(app).post('/v1/auth/login').send({ email, password, device });
  expectConformant(res, 'POST', '/auth/login');
  if (res.status !== 200) throw new Error(`connexion : ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.deviceToken, userId: res.body.user.id, email, device };
}

export function bearer(session: Session): { Authorization: string } {
  return { Authorization: `Bearer ${session.token}` };
}

export { expectConformant, request };
