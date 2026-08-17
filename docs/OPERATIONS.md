# Exploitation — Campus Agenda

Guide opérationnel pour la version **1.0.0**.

## Modes de persistance

| Mode | Variable | Usage |
|---|---|---|
| Mémoire | `CAMPUS_STORE=memory` | Tests, démo éphémère |
| SQLite local | `CAMPUS_STORE=sqlite` + `CAMPUS_SQLITE_PATH` | Développement hors Cloudflare |
| D1 Cloudflare | binding `CAMPUS_DB` | Production sur Workers |

Initialiser une base SQLite locale :

```bash
cd web && pnpm db:local
CAMPUS_STORE=sqlite pnpm dev
```

Appliquer le schéma D1 en production :

```bash
cd web
npx wrangler d1 migrations apply campus-agenda-db --remote
```

## Santé du service

```http
GET /api/health
```

Réponse attendue :

```json
{
  "ok": true,
  "service": "campus-agenda",
  "version": "1.0.0",
  "store": "d1",
  "uptimeSeconds": 42
}
```

Le champ `store` indique le backend actif : `memory`, `sqlite` ou `d1`.

Chaque réponse API instrumentée inclut un en-tête `x-request-id`.

## Observabilité

Journaux JSON sur la sortie standard, sans contenu scolaire :

- `requestId`, `route`, `method`, `status`, `durationMs`

| Variable | Rôle |
|---|---|
| `AUTH_SECRET` | Signature des cookies (obligatoire en production) |
| `CAMPUS_STORE` | Backend de persistance |
| `CAMPUS_SQLITE_PATH` | Fichier SQLite local |
| `APP_ENV` | Contexte d'exécution |

## Sauvegardes

Réservées aux enseignants authentifiés. Fonctionnent avec tous les backends.

```http
GET /api/admin/backup
POST /api/admin/restore
```

> Ne jamais versionner les exports dans Git.

## Mise en service Cloudflare

1. Créer la base D1 `campus-agenda-db` dans le dashboard Cloudflare.
2. Mettre à jour `database_id` dans `web/wrangler.jsonc`.
3. Appliquer `migrations/0001_initial.sql` via Wrangler.
4. Définir `AUTH_SECRET` comme secret Worker.
5. Déployer : `cd web && pnpm build && npx wrangler deploy`.
6. Vérifier `GET /api/health` → `ok: true`, `store: "d1"`.

## Vérifications

1. `pnpm test`
2. `pnpm lint`
3. `GET /api/health`
4. Aucun secret ni donnée réelle dans les journaux ou exports
