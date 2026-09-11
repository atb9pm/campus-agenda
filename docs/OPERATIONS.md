# Exploitation — Campus Agenda

Guide opérationnel, **septembre 2026**. Version applicative : voir `APP_VERSION` (`2.52.1` et suivantes).

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
  "version": "2.46.0",
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
| `CAMPUS_ADMIN_INITIALS` | Initiales de l’administrateur bootstrap (`ChF` par défaut) |
| `CAMPUS_ADMIN_DISPLAY_NAME` | Nom affiché du premier admin (sinon les initiales ou « Administrateur ») |
| `CAMPUS_ADMIN_PASSWORD` | Mot de passe du premier admin — **obligatoire** si la base SQLite est totalement vide |
| `CAMPUS_DEMO_SEED` | Seed de démonstration hors production uniquement (`false` pour le désactiver). **Ignoré en production.** |
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

**Le merge de cette version ne réinitialise pas la base existante.** Tant que `CAMPUS_SQLITE_PATH` pointe vers le fichier actuel, les données métier restent intactes. Une base vierge n’est créée que si l’on pointe explicitement vers un **nouveau** fichier SQLite (voir ci-dessous).

## Réinitialisation contrôlée vers une base de production vierge

Cette procédure est **manuelle**. Elle n’est déclenchée ni par le merge, ni par le Build Infomaniak, ni par un redémarrage sur l’ancien chemin SQLite.

1. Télécharger un backup v4 complet depuis Administration → **Sauvegarde des données**.
2. Noter le commit / la version actuellement déployée (`GET /api/health`).
3. Conserver l’ancien fichier SQLite **intact** (ne pas l’écraser, ne pas le supprimer).
4. Déployer la version Clean Production Bootstrap (`2.45.0` ou suivante) : `main` → **Build** → **Redémarrer**.
5. Configurer les variables d’environnement :
   - `CAMPUS_ADMIN_INITIALS` (défaut `ChF`)
   - `CAMPUS_ADMIN_DISPLAY_NAME` si souhaité
   - `CAMPUS_ADMIN_PASSWORD` (**obligatoire** pour une base totalement vide)
6. Choisir un **nouveau** chemin `CAMPUS_SQLITE_PATH` (fichier inexistant ou vide).
7. Redémarrer l’application.
8. Les migrations créent le schéma dans la nouvelle base.
9. Seul le compte administrateur bootstrap est créé. Aucune classe, année, horaire ni donnée démo.
10. Vérifier l’état vierge (Administration : « Aucune année scolaire configurée. », catalogue vide).
11. Commencer la configuration réelle depuis Administration (import du calendrier scolaire, puis professions / classes).
12. **Ne pas** restaurer l’ancien backup dans la nouvelle base.
13. Conserver l’ancien backup et l’ancien fichier SQLite comme archive / rollback.

### Rollback

1. Remettre l’ancien `CAMPUS_SQLITE_PATH`.
2. Redémarrer.
3. L’ancienne base redevient utilisable immédiatement.

Ne jamais :

- exécuter un `DELETE` métier sur la base actuelle ;
- ajouter une migration du type `0027_delete_demo_data.sql` ;
- laisser `CAMPUS_DEMO_SEED=true` en production (la variable est ignorée, mais elle n’a rien à y faire).

## Suppression définitive (Administration)

Depuis **2.46.0**, un administrateur peut supprimer définitivement une classe, une profession, une branche ou un CTX.

- Aperçu des dépendances côté serveur, puis saisie exacte du code / libellé / code CTX.
- Cascade transactionnelle : tout est retiré, ou rien.
- **Archiver** conserve l’historique. **Supprimer** est irréversible.
- Le merge de cette version **ne supprime aucune donnée** existante. MA2 (ou toute autre classe) n’est retirée que si un administrateur le confirme dans l’interface.

Depuis **2.47.0**, un administrateur peut supprimer définitivement un **compte professeur**.

- Confirmation par initiales (validée côté serveur).
- Supprimé : compte, accès, sessions, affectations, memberships, notes privées, configuration personnelle, modèles de bibliothèque.
- **Conservé** : HOMEWORK, TEST, INFORMATION, historique de classe, AnnualCourse, branche, CTX.
- Impossible de supprimer le dernier administrateur.

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
