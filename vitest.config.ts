import 'dotenv/config';
import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

const testDatabaseUrl =
  process.env.DATABASE_URL_TEST
  ?? 'postgresql://windfall:windfall@localhost:5433/windfall_test?schema=public';

// Les alias `#…` de package.json pointent vers src/ sous la condition
// « development » (tsx, vitest) et vers dist/ sinon (node en production).
const conditions = ['development', ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      LOG_REQUESTS: 'false',
      CORS_ORIGINS: 'http://localhost:4200,https://localhost',
      MIN_CLIENT_VERSION: '0.0.5',
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          // Une seule base de test partagée : les fichiers s'exécutent l'un
          // après l'autre, la base est vidée avant chacun.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
