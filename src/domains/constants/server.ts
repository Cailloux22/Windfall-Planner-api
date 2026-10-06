import { createRequire } from 'node:module';

// RT_72 : la version du serveur est le champ `version` de son package.json,
// indépendante de celle de l'application (RG_47/RT_63).
const require = createRequire(import.meta.url);
const pkg = require('../../../package.json') as { version: string };

export const SERVER_VERSION = pkg.version;

// RT_71 : toutes les routes du contrat sont servies sous ce préfixe.
export const API_PREFIX = '/v1';
