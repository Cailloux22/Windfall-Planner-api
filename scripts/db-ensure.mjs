// Avant `npm run dev` : si la base de DATABASE_URL ne répond pas et qu'elle
// est locale, démarre Docker Desktop au besoin, puis le service « db » de
// docker-compose.yml. Une base distante n'est jamais démarrée d'ici : le
// serveur refusera alors de démarrer (RT_70 « Démarrage »).
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { URL } from 'node:url';
import pg from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function reachable(connectionString) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function run(command) {
  return spawnSync(command, { stdio: 'inherit', shell: true }).status === 0;
}

function dockerRunning() {
  return spawnSync('docker info', { stdio: 'ignore', shell: true }).status === 0;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL absente : lancer `npm run env:init`.');
  process.exit(1);
}
if (await reachable(url)) process.exit(0);

if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  console.error('Base injoignable, et DATABASE_URL ne désigne pas une base locale : rien à démarrer.');
  process.exit(1);
}

if (!dockerRunning()) {
  console.log('Docker ne répond pas : démarrage de Docker Desktop…');
  if (!run('docker desktop start') || !dockerRunning()) {
    console.error('Docker Desktop n\'a pas pu être démarré : le lancer à la main, puis relancer `npm run dev`.');
    process.exit(1);
  }
}

console.log('Base injoignable : démarrage du conteneur « db »…');
if (!run('docker compose up -d --wait db')) {
  console.error('Le conteneur « db » n\'a pas démarré.');
  process.exit(1);
}
