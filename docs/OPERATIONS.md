# Exploitation — Campus Agenda

Guide opérationnel pour la version **1.0.2**.

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
| `CAMPUS_DISABLE_RATE_LIMIT` | Désactive le rate limit (tests uniquement) |
| `CAMPUS_AUTH_RATE_LIMIT_TEACHER` | Limite personnalisée connexion enseignant (défaut : 10/min) |
| `CAMPUS_AUTH_RATE_LIMIT_STUDENT` | Limite personnalisée connexion élève (défaut : 20/min) |

## Rate limiting

Les tentatives de connexion (`POST /api/auth/teacher`, `POST /api/auth/student`) sont limitées par adresse IP (`cf-connecting-ip`).

| Environnement | Mécanisme | Limite |
|---|---|---|
| Production Cloudflare | Binding `AUTH_RATE_LIMITER` (wrangler) | 10 req / 60 s par clé |
| Dev / tests | Compteur mémoire par processus | 10 enseignant, 20 élève / min |

Réponse en cas de dépassement :

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{"ok":false,"reason":"Trop de tentatives. Réessayez dans une minute."}
```

Le binding est déclaré dans `web/wrangler.jsonc`. Aucune configuration dashboard supplémentaire n'est requise.

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

## Mise en service Infomaniak (Node.js + SQLite)

Pour un hébergement **Infomaniak** (sans Cloudflare), suivre le guide dédié :

→ **`docs/infomaniak-deploy.md`**

Résumé : dossier d'exécution `web`, build `npm install && npm run build`, lancement `AUTH_SECRET=… CAMPUS_STORE=sqlite npm run start:infomaniak` (pas de corepack/pnpm — EROFS sur Infomaniak).

## Vérifications

1. `pnpm test`
2. `pnpm lint`
3. `GET /api/health`
4. Aucun secret ni donnée réelle dans les journaux ou exports
