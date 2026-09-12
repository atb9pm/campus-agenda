# Exploitation — Campus Agenda

Guide opérationnel, **septembre 2026**. Version applicative : voir `APP_VERSION` (`2.54.0` et suivantes).

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
| `CAMPUS_AUTH_RATE_LIMIT_TEACHER_MFA` | Limite personnalisée codes TOTP / récupération (défaut : 8/min) |
| `CAMPUS_MFA_ENCRYPTION_KEY` | Clé AES-256-GCM du secret TOTP administrateur (**obligatoire en production**) |

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

Le format **v4** est le format courant **complet**. La liste des tables est la source de vérité `CAMPUS_BACKUP_INSERT_ORDER` (années, semaines, exceptions, classes, professions, branches, contextes, cours annuels, attributions, événements d’attribution, horaires, jours de présence, comptes, configurations, notes, memberships, agenda, modèles, parcours, notes annuelles, timetable, `teacher_mfa`, etc.).

Les formats **v1 / v2 / v3** restent restaurables pour compatibilité historique uniquement. Ils **ne** contiennent **pas** l’intégralité des données modernes.

Le fichier JSON est **sensible** (empreintes / hashes de mots de passe, secret TOTP **chiffré**, jamais le mot de passe ni le secret TOTP en clair). Ne jamais l’envoyer sur GitHub. Le conserver dans un emplacement privé (ordinateur local, espace Infomaniak). Une restauration MFA n’est utilisable qu’avec **la même** `CAMPUS_MFA_ENCRYPTION_KEY` que lors de la sauvegarde.

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

## Double authentification administrateur

La 2FA TOTP est **obligatoire** pour tout compte administrateur. Les enseignants standards ne sont pas concernés.

### 1. Variable `CAMPUS_MFA_ENCRYPTION_KEY`

Clé de 32 octets pour le chiffrement AES-256-GCM du secret TOTP. Format accepté : **64 caractères hexadécimaux** ou **base64 de 32 octets**.

En production (`NODE_ENV=production`), l’absence ou l’invalidité de cette clé **ferme** l’accès administrateur (aucun contournement).

### 2. Génération sécurisée

Sur le serveur ou un poste de confiance :

```bash
openssl rand -hex 32
```

ou :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Ne jamais committer cette valeur. Ne jamais l’écrire dans les journaux.

### 3. Installation sur Infomaniak

Infomaniak n’a pas d’écran de variables : la clé se place **dans la commande de lancement**, avec `AUTH_SECRET` :

```bash
cd web && AUTH_SECRET=… CAMPUS_MFA_ENCRYPTION_KEY=… CAMPUS_STORE=sqlite npm run start:infomaniak
```

### 4. Redémarrage

Après ajout ou rotation de la clé : **Build** si besoin, puis **Redémarrer**. Une rotation sans ré-enrôlement rend l’ancien secret illisible : utiliser alors `pnpm admin:reset-2fa`.

### 5. Activation initiale

1. Connexion administrateur (mot de passe).
2. L’accès admin n’est **pas** ouvert.
3. QR `otpauth://` + saisie du premier code à 6 chiffres.
4. 8 codes de récupération affichés **une seule fois**.
5. Session administrateur complète.

### 6. Codes de récupération

- Usage unique, stockés uniquement sous forme d’empreinte.
- Administration → Sécurité affiche seulement le nombre restant.
- « Régénérer les codes de récupération » exige mot de passe + TOTP actuel, puis confirmation.

### 7. Administration → Sécurité — trois parcours

L’écran principal n’affiche aucun formulaire. Trois actions :

1. **Changement volontaire de téléphone** — mot de passe + TOTP actuel. Un secret en attente est créé. L’ancienne configuration reste valable tant que le nouveau TOTP n’est pas confirmé. Après confirmation : nouveau secret, 8 nouveaux recovery, anciens recovery invalidés.

2. **Téléphone perdu + recovery code** — si l’administrateur vient de se connecter avec un recovery, la session signée le mémorise 10 minutes : Sécurité → téléphone perdu ne redemande que le mot de passe (un seul recovery pour toute la récupération). Sinon : mot de passe + un recovery. Le recovery n’est invalidé qu’à la confirmation du nouveau TOTP ; fermer la page avant cela ne le détruit pas.

3. **Perte totale (téléphone + recovery)** — aucun bouton web. Côté serveur : `pnpm admin:reset-2fa -- <id|initiales>` → état `reset_required` → nouvel enrôlement obligatoire à la connexion.

Le mot de passe administrateur perdu reste une opération distincte : `pnpm admin:reset-password` (2FA inchangée).

Il n’existe **aucun** bouton web « désactiver la 2FA » ni « mot de passe oublié ».

### 8. Commande `pnpm admin:reset-2fa`

Depuis `web/`, base SQLite de production :

```bash
CAMPUS_STORE=sqlite CAMPUS_SQLITE_PATH=/chemin/campus-agenda.sqlite pnpm admin:reset-2fa -- ChF
```

La commande affiche le compte ciblé et n’agit que si l’opérateur tape exactement `RESET-2FA`.

### 9. Après un reset serveur

L’ancien secret et les anciens recovery sont invalidés. État : `reset_required`. Prochaine connexion : mot de passe → configuration TOTP obligatoire → nouveaux recovery → session admin. La 2FA n’est **jamais** durablement désactivée.

### 10. Commande `pnpm admin:reset-password`

Si l’administrateur a oublié son mot de passe (téléphone encore disponible) :

```bash
CAMPUS_STORE=sqlite CAMPUS_SQLITE_PATH=/chemin/campus-agenda.sqlite pnpm admin:reset-password -- ChF
```

La commande affiche le compte ciblé et n’agit que si l’opérateur tape exactement `RESET-PASSWORD`.

- Un mot de passe temporaire cryptographique s’affiche **une seule fois** dans le terminal.
- Le changement de mot de passe est obligatoire à la prochaine connexion.
- La 2FA n’est **pas** touchée (secret TOTP et recovery codes inchangés).
- La commande ne crée **jamais** de session administrateur.

Les cookies de session déjà émis restent valides jusqu’à expiration (HMAC, pas de store de sessions serveur). Un reset mot de passe ne les révoque pas.

### 11. Restauration d’un backup et clé MFA

Le backup v4 conserve `teacher_mfa` (secret chiffré + empreintes de recovery). Restaurer ce backup sur un serveur dont `CAMPUS_MFA_ENCRYPTION_KEY` est différente rend les secrets illisibles (fail closed). Procédure :

1. Installer **la même** clé que celle utilisée lors de la sauvegarde.
2. Restaurer le fichier v4.
3. Redémarrer.
4. Si la clé est perdue : `pnpm admin:reset-2fa` puis nouvel enrôlement.

## Administrateur — accès perdu

Le reset mot de passe et le reset 2FA sont **indépendants**. Aucune commande ne désactive toute la sécurité.

1. **Téléphone perdu, mot de passe connu**  
   Sur l’écran TOTP : « Utiliser un code de récupération ».  
   Ou, côté serveur : `pnpm admin:reset-2fa` puis nouvel enrôlement TOTP.

2. **Mot de passe oublié, téléphone disponible**  
   `pnpm admin:reset-password` → mot de passe temporaire → changement obligatoire → TOTP actuel → accès admin.

3. **Mot de passe + téléphone + recovery codes perdus**  
   1. `pnpm admin:reset-password`  
   2. `pnpm admin:reset-2fa`  
   3. Connexion avec le mot de passe temporaire  
   4. Changement du mot de passe  
   5. Nouvel enrôlement MFA  
   6. Nouveaux recovery codes

## Build Infomaniak — dépendances

`scripts/infomaniak-build.sh` installe automatiquement :

1. les dépendances **racine** (`qrcode`, `otpauth`, `pdfjs-dist`, … utilisées depuis `src/`) ;
2. les dépendances **web** ;
3. puis lance `npm run build` dans `web/`.

Plus besoin d’un `npm ci` manuel à la racine avant le bouton Build.

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
