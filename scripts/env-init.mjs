// Copie .env.example vers .env s'il n'existe pas encore.
import { copyFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env existe déjà : inchangé.');
} else {
  copyFileSync('.env.example', '.env');
  console.log('.env créé à partir de .env.example.');
}
