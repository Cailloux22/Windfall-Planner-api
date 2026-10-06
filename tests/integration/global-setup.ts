import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from '../../vitest.config.js';

// Applique les migrations à la base de test une fois pour toute la suite. Le
// setup global tourne dans le processus principal, où `test.env` ne
// s'applique pas : l'adresse est passée explicitement.
export default function setup(): void {
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
