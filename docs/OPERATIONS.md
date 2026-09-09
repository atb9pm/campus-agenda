# Exploitation — Campus Agenda

Guide opérationnel, **septembre 2026**. Version applicative : voir `APP_VERSION` (`2.44.1` et suivantes).

## Production actuelle

| Élément | Valeur |
|---|---|
| Hébergement | **Infomaniak Node.js** (`campusagenda.ch`) |
| Persistance | **SQLite** (`CAMPUS_STORE=sqlite`) |
| Format de sauvegarde | **v4** (complet) |
| Déploiement | merge GitHub → Infomaniak **Build** → Infomaniak **Restart** |
| GitHub Actions | ne déploie **plus** par SSH ; vérifie `https://campusagenda.ch/api/health` |

Détail du cycle Infomaniak : **`docs/infomaniak-deploy.md`**.

Cloudflare Workers / D1 n’est **pas** le mode de production actuel. Les indications D1 restantes sont historiques (annexe).

## Modes de persistance

| Mode | Variable | Usage |
|---|---|---|
| SQLite | `CAMPUS_STORE=sqlite` + `CAMPUS_SQLITE_PATH` | **Production Infomaniak** et développement local |
| Mémoire | `CAMPUS_STORE=memory` | Tests, démo éphémère |
| D1 Cloudflare | binding `CAMPUS_DB` | Historique / optionnel, pas la production actuelle |

Initialiser une base SQLite locale :

```bash
cd web && pnpm db:local
CAMPUS_STORE=sqlite pnpm dev
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
  "version": "2.44.1",
  "store": "sqlite",
  "uptimeSeconds": 42
}
```

Le champ `store` indique le backend actif : `sqlite` en production, `memory` en tests, éventuellement `d1`.

Chaque réponse API instrumentée inclut un en-tête `x-request-id`.

## Observabilité

Journaux JSON sur la sortie standard, sans contenu scolaire :

- `requestId`, `route`, `method`, `status`, `durationMs`

| Variable | Rôle |
|---|---|
| `AUTH_SECRET` | Signature des cookies (obligatoire en production) |
| `CAMPUS_STORE` | Backend de persistance (`sqlite` en production) |
| `CAMPUS_SQLITE_PATH` | Fichier SQLite |
| `APP_ENV` | Contexte d'exécution |
| `CAMPUS_DISABLE_RATE_LIMIT` | Désactive le rate limit (tests uniquement) |
| `CAMPUS_AUTH_RATE_LIMIT_TEACHER` | Limite personnalisée connexion enseignant (défaut : 10/min) |
| `CAMPUS_AUTH_RATE_LIMIT_STUDENT` | Limite personnalisée connexion élève (défaut : 20/min) |

## Rate limiting

Les tentatives de connexion (`POST /api/auth/teacher`, `POST /api/auth/student`) sont limitées par adresse IP.

| Environnement | Mécanisme | Limite |
|---|---|---|
| Production Infomaniak | Compteur mémoire par processus Node.js | 10 enseignant, 20 élève / min |
| Tests / aperçu local | Idem, ou `CAMPUS_DISABLE_RATE_LIMIT=1` | — |

Réponse en cas de dépassement :

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{"ok":false,"reason":"Trop de tentatives. Réessayez dans une minute."}
```

## Sauvegardes et restauration

Fonction **critique de sécurité**. Réservée aux **administrateurs** (`requireAdminSession` + UI Administration).

Le format **v4** est le format courant **complet**. La liste des tables est la source de vérité `CAMPUS_BACKUP_INSERT_ORDER` (années, semaines, exceptions, classes, professions, branches, contextes, cours annuels, attributions, événements d’attribution, horaires, jours de présence, comptes, configurations, notes, memberships, agenda, modèles, parcours, notes annuelles, timetable, etc.).

Les formats **v1 / v2 / v3** restent restaurables pour compatibilité historique uniquement. Ils **ne** contiennent **pas** l’intégralité des données modernes.

Le fichier JSON est **sensible** (empreintes / hashes de mots de passe, jamais le mot de passe en clair). Ne jamais l’envoyer sur GitHub. Le conserver dans un emplacement privé (ordinateur local, espace Infomaniak).

> Ne jamais versionner les exports dans Git.

### Créer une sauvegarde

Administration → onglet **Sauvegarde des données** → **Télécharger une sauvegarde**

- API : `GET /api/admin/backup`
- Nom : `campus-agenda-backup-YYYY-MM-DD-HHmm.json` (heure UTC du snapshot)
- Format courant : **v4**

### Restaurer une sauvegarde

Administration → onglet **Restaurer une sauvegarde** → **Choisir un fichier de sauvegarde**

1. Choisir un fichier `.json`.
2. Contrôler les métadonnées affichées (nom, date, version, éventuellement nombre d’éléments). Le JSON complet n’est jamais affiché.
3. Si la version est v1/v2/v3, l’interface signale une **ancienne sauvegarde**.
4. Cliquer sur **Restaurer cette sauvegarde**.
5. Saisir exactement `RESTAURER`.
6. Confirmer avec **Restaurer maintenant**.
7. Campus Agenda crée automatiquement une sauvegarde de sécurité `campus-agenda-before-restore-YYYY-MM-DD-HHmm.json` (`GET /api/admin/backup`). Si cette étape échoue, **rien n’est restauré**.
8. Restauration : `POST /api/admin/restore` avec `{ "snapshot": snapshot }`.
9. Succès : message, puis rechargement complet de la page.

API : `POST /api/admin/restore`

En production SQLite, la restauration v4 est **atomique** (`BEGIN` → suppressions/inserts → `COMMIT` ; erreur → `ROLLBACK`). Aucune restauration partielle ne reste dans la base.

### Règle d’architecture — nouvelle table = backup + restore

Toute nouvelle donnée persistante ou nouvelle table ajoutée à Campus Agenda doit être intégrée au mécanisme de sauvegarde/restauration complète **dans la même PR** :

**nouvelle table = dump + restore + validation + tests obligatoires**

Source de vérité : `CAMPUS_BACKUP_INSERT_ORDER` (et colonnes associées). On ne doit jamais livrer une fonctionnalité qui ne puisse pas être restaurée (multi-années, préparation d’année, reprise de classes, attributions, parcours, projections, etc.).

## Déploiement Infomaniak

1. Merger la PR sur `main`.
2. Infomaniak Manager → **Build**.
3. Infomaniak Manager → **Restart**.
4. Vérifier `GET /api/health` (`ok: true`, `store: "sqlite"`, version attendue).

GitHub Actions ne pousse plus le code par SSH. Il vérifie uniquement la santé de production.

Guide complet : **`docs/infomaniak-deploy.md`**.

## Vérifications

1. `pnpm typecheck` (depuis `web/`)
2. `pnpm lint`
3. `pnpm test`
4. `GET /api/health`
5. Aucun secret ni donnée réelle dans les journaux ou dans Git

## Annexe — Cloudflare / D1 (historique)

Ces étapes concernent un hébergement Workers + D1, **pas** la production actuelle :

1. Créer la base D1 `campus-agenda-db`.
2. Mettre à jour `database_id` dans `web/wrangler.jsonc`.
3. Appliquer les migrations via Wrangler.
4. Définir `AUTH_SECRET` comme secret Worker.
5. Déployer : `cd web && pnpm build && npx wrangler deploy`.
