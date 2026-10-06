# Windfall Planner — serveur de synchronisation

Serveur de synchronisation de Windfall Planner (`RT_09`) : comptes avec jetons d'appareil permanents et synchronisation par différence des listes d'armée et des déploiements entre les appareils d'un joueur.

- Client : dépôt voisin `../40K-deployment-planner` (Angular/Ionic/Capacitor, hors-ligne d'abord).
- Spécification : `../40K-deployment-planner/specification/spec.md` (source de vérité) ; [specification/openapi.yml](specification/openapi.yml) et [specification/schema.sql](specification/schema.sql) en sont des copies.
- Stack : Node.js 24 LTS, Express 5, Prisma 7, PostgreSQL 18.

## Sommaire

1. [Prérequis](#prérequis)
2. [Installation et lancement en local](#installation-et-lancement-en-local)
3. [Configuration (`.env`)](#configuration-env)
4. [Commandes](#commandes)
5. [Tests](#tests)
6. [Déploiement sur un serveur](#déploiement-sur-un-serveur)

## Prérequis

- **Node.js 24 LTS** (version exacte dans [.nvmrc](.nvmrc) ; `nvm use` ou `fnm use`).
- **Docker** avec Docker Compose, pour PostgreSQL 18 en développement et pour les tests.
- **bash** et **curl** (facultatif), pour le scénario de bout en bout ([scripts/e2e-scenario.sh](scripts/e2e-scenario.sh)) ; sous Windows, Git Bash convient.

## Installation et lancement en local

```bash
npm install          # installe les dépendances et génère le client Prisma (postinstall)
npm run setup        # crée .env depuis .env.example, démarre PostgreSQL, applique les migrations
npm run dev          # http://localhost:3000/v1, rechargement à chaud
```

Vérification :

```bash
curl http://localhost:3000/health
```

réponse attendue : `{"status":"ok","version":"0.1.1","database":"up"}` (`503` et `"database":"down"` si la base ne répond pas).

`npm run setup` lance deux conteneurs ([docker-compose.yml](docker-compose.yml)) :

| Service | Port | Base | Données |
|---|---|---|---|
| `db` | 5432 | `windfall` (développement) | volume `db-data`, persistant |
| `db-test` | 5433 | `windfall_test` (tests) | en mémoire (tmpfs), perdues à l'arrêt |

Identifiants : `windfall` / `windfall`. Arrêt : `npm run db:down`.

Pour lancer la version compilée plutôt que le mode watch :

```bash
npm run build
npm start
```

### Lancer le client contre ce serveur

Le client vise `http://localhost:3000/v1` en développement (`RT_71`). Les origines autorisées par CORS dans `.env.example` couvrent `ng serve` (4200), `ionic serve` (8100), `npm run serve:pwa` (8080) et l'APK Android (`https://localhost`). Sur un émulateur Android, le serveur est joignable par `http://10.0.2.2:3000/v1` ; sur un téléphone réel, par l'adresse IP locale de l'ordinateur.

## Configuration (`.env`)

Deux modèles : [.env.example](.env.example) pour le développement (copié par `npm run env:init`) et [.env.production.example](.env.production.example) pour un serveur. Toutes les variables sont validées au démarrage ([src/shared/env/index.ts](src/shared/env/index.ts)) : une valeur absente ou mal formée arrête le processus avec la liste des problèmes.

| Variable | Défaut | Rôle |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` ou `production`. |
| `PORT` | `3000` | Port d'écoute HTTP. |
| `DATABASE_URL` | — (obligatoire) | URL PostgreSQL (`postgresql://user:pass@hôte:port/base?schema=public`). Lue aussi par Prisma ([prisma.config.ts](prisma.config.ts)) pour les migrations. |
| `DATABASE_URL_TEST` | — | Base des tests d'intégration (`npm test` uniquement). |
| `CORS_ORIGINS` | vide | Origines autorisées, séparées par des virgules (`RT_71`). |
| `MIN_CLIENT_VERSION` | `0.0.0` | Version minimale de l'application acceptée ; en dessous, `426 CLIENT_TOO_OLD` (`RT_69`). |
| `TRUST_PROXY` | `false` | Réglage « trust proxy » d'Express : `false`, `true`, un nombre de sauts ou une liste d'adresses. Indispensable derrière un reverse proxy pour que la limitation de débit par IP voie l'adresse réelle (`RT_69`). |
| `LOG_REQUESTS` | `true` | Journal d'accès (méthode, chemin, statut, durée). Les journaux ne contiennent jamais d'email, de jeton ni de contenu d'enregistrement. |

## Commandes

| Commande | Effet |
|---|---|
| `npm run setup` | `env:init` + `db:up` + `db:migrate` |
| `npm run dev` | Serveur en mode watch (tsx) |
| `npm run build` | Génère le client Prisma et compile vers `dist/` |
| `npm start` | Lance `dist/main/index.js` |
| `npm run typecheck` / `npm run lint` | Vérification de types / ESLint |
| `npm test` | Tests unitaires et d'intégration (vitest) |
| `npm run db:up` / `npm run db:down` | Démarre / arrête les conteneurs PostgreSQL |
| `npm run db:migrate` | Applique et crée les migrations (développement) |
| `npm run db:deploy` | Applique les migrations existantes, sans en créer (production) |
| `npm run db:reset` | Recrée la base de développement (**efface les données**) |
| `npm run db:drift` | Vérifie que la base correspond à `schema.prisma` et que les contraintes CHECK et index partiels sont présents |
| `npm run purge` / `npm run purge:dev` | Purges de `RT_70` (version compilée / tsx) |

## Tests

```bash
npm run db:up
npm test
npx vitest run tests/integration/push.test.ts   # un seul fichier
```

Les tests d'intégration migrent la base `DATABASE_URL_TEST` une fois, vident `users` avant chaque fichier et valident chaque réponse contre [specification/openapi.yml](specification/openapi.yml).

Scénario de bout en bout contre un serveur lancé (inscription → poussée → pull → conflit → résolution → suppression du compte) :

```bash
bash scripts/e2e-scenario.sh
```

## Déploiement sur un serveur

L'adresse de production n'est pas encore tranchée (`RT_71`, « Suivi des décisions non tranchées » de la spécification). La procédure ci-dessous vaut pour un serveur Linux (VPS Debian/Ubuntu) avec un nom de domaine, par exemple `api.example.com`.

### Architecture cible

```
Internet ──HTTPS──▶ reverse proxy (Caddy ou nginx, TLS) ──HTTP──▶ Node :3000 (systemd) ──▶ PostgreSQL 18
```

> **Une seule instance.** La limitation de débit (`RT_69`) garde ses compteurs en mémoire : elle n'est exacte qu'avec un seul processus Node. Pas de cluster, pas de réplicas derrière un répartiteur de charge.

### 1. Préparer la machine

```bash
# Node.js 24 LTS (via nvm, ou le dépôt NodeSource)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 24

# Utilisateur système dédié
sudo useradd --system --create-home --home-dir /opt/windfall --shell /usr/sbin/nologin windfall
```

### 2. PostgreSQL 18

Au choix : paquet PostgreSQL 18 de la distribution (dépôt `apt.postgresql.org`), base managée chez l'hébergeur, ou conteneur Docker. Dans tous les cas, créer un utilisateur et une base dédiés avec un mot de passe fort — **pas** les identifiants `windfall`/`windfall` du développement :

```sql
CREATE USER windfall WITH PASSWORD '<mot-de-passe-fort>';
CREATE DATABASE windfall OWNER windfall;
```

Si PostgreSQL tourne dans Docker, ne publier le port que sur la boucle locale (`127.0.0.1:5432:5432`), jamais sur l'interface publique.

### 3. Installer et compiler l'application

```bash
sudo -u windfall -s
cd /opt/windfall
git clone <url-du-dépôt> app && cd app
npm ci          # dépendances complètes : le build et les migrations ont besoin de prisma et typescript
npm run build   # génère le client Prisma et compile vers dist/
```

`dist/` doit rester à côté de `package.json` : le serveur lit sa version (`RT_72`, renvoyée par `/health`) dans `package.json` et résout ses imports `#…` par son champ `imports`.

### 4. Configurer `.env`

Créer `/opt/windfall/app/.env` (droits `600`, propriétaire `windfall`) à partir de [.env.production.example](.env.production.example) :

```bash
cp .env.production.example .env && chmod 600 .env
```

puis remplacer les valeurs entre `<…>`. Résultat attendu :

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://windfall:<mot-de-passe-fort>@127.0.0.1:5432/windfall?schema=public

# RT_71 : origine de la version web + APK Android (Capacitor)
CORS_ORIGINS=https://app.example.com,https://localhost

# RT_69 : version minimale de l'application acceptée
MIN_CLIENT_VERSION=0.0.0

# Un reverse proxy sur la même machine : on fait confiance à la boucle locale
TRUST_PROXY=loopback

LOG_REQUESTS=true
```

`TRUST_PROXY` doit correspondre exactement à l'infrastructure : `loopback` (ou `1`) pour un proxy local unique ; sinon les adresses du proxy. Une valeur trop permissive (`true`) laisse un client falsifier `X-Forwarded-For` et contourner la limitation de débit.

### 5. Appliquer les migrations

```bash
npm run db:deploy
npm run db:drift    # facultatif : vérifie que le schéma, les CHECK et les index partiels sont en place
```

Ne jamais utiliser `db:migrate` ni `db:reset` en production.

### 6. Service systemd

`/etc/systemd/system/windfall-api.service` :

```ini
[Unit]
Description=Windfall Planner - serveur de synchronisation
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=windfall
WorkingDirectory=/opt/windfall/app
ExecStart=/opt/windfall/.nvm/versions/node/v24.21.0/bin/node dist/main/index.js
Restart=on-failure
RestartSec=5
# Arrêt propre : le serveur termine les requêtes en cours sur SIGTERM (10 s max)
KillSignal=SIGTERM
TimeoutStopSec=15
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/opt/windfall
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Adapter le chemin de `node` (`which node` sous l'utilisateur `windfall`). Le fichier `.env` est lu par l'application elle-même (dotenv), depuis le répertoire de travail.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now windfall-api
sudo journalctl -u windfall-api -f
curl http://127.0.0.1:3000/health
```

### 7. Reverse proxy et HTTPS

**Caddy** (certificat Let's Encrypt automatique), `/etc/caddy/Caddyfile` :

```caddy
api.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

**nginx** (certificat via `certbot --nginx`) :

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;
    # ssl_certificate / ssl_certificate_key gérés par certbot

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Le serveur applique ses propres limites par route (413) ; nginx ne doit pas couper avant.
        client_max_body_size 6m;
    }
}
```

Laisser la limite de taille des corps au serveur (fixée par route, jusqu'à 5 Mo pour la poussée et la résolution, voir [limits.ts](src/domains/constants/limits.ts)) : le proxy doit accepter au moins autant (le défaut de nginx, 1 Mo, est trop bas). Le pare-feu n'ouvre que 22, 80 et 443 ; le port 3000 reste sur la boucle locale.

La sonde de l'hébergeur ou du monitoring vise `GET /health` (hors `/v1`, sans authentification) : `200` si tout va bien, `503` si la base ne répond pas.

### 8. Purges planifiées (`RT_70`)

Les traces de suppression de plus de 90 jours et les clés d'idempotence de plus de 24 heures doivent être purgées ; rien ne le fait automatiquement. Une fois par jour suffit.

`/etc/systemd/system/windfall-purge.service` :

```ini
[Unit]
Description=Windfall Planner - purges RT_70

[Service]
Type=oneshot
User=windfall
WorkingDirectory=/opt/windfall/app
ExecStart=/opt/windfall/.nvm/versions/node/v24.21.0/bin/node dist/jobs/purge.js
```

`/etc/systemd/system/windfall-purge.timer` :

```ini
[Unit]
Description=Purge quotidienne de Windfall Planner

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now windfall-purge.timer
```

(À défaut, une ligne cron : `0 4 * * * cd /opt/windfall/app && node dist/jobs/purge.js`.)

### 9. Côté client

Renseigner l'adresse de production (`https://api.example.com/v1`) dans `syncApiBaseUrl` de `src/environments/environment.prod.ts` du dépôt client (`RT_71`), et vérifier que l'origine de la version web figure dans `CORS_ORIGINS`.

### Mise à jour

```bash
sudo -u windfall -s
cd /opt/windfall/app
git pull
npm ci
npm run build
npm run db:deploy
exit
sudo systemctl restart windfall-api
curl http://127.0.0.1:3000/health   # "version" doit afficher la nouvelle version (RT_72)
```

Pour forcer la mise à jour des applications trop anciennes, relever `MIN_CLIENT_VERSION` puis redémarrer le service.

### Sauvegardes

La base contient toutes les données des joueurs ; la sauvegarder régulièrement, par exemple chaque nuit :

```bash
pg_dump --format=custom --file=/var/backups/windfall/windfall-$(date +%F).dump "$DATABASE_URL"
```

Restauration : `pg_restore --clean --dbname="$DATABASE_URL" <fichier>.dump`. Conserver les sauvegardes hors de la machine, et chiffrées : elles contiennent les adresses email et les hachages de mots de passe.
