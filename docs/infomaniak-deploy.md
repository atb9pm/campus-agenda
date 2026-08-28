# Déployer Campus Agenda sur Infomaniak

Guide à jour pour un **site Node.js Infomaniak** avec persistance **SQLite**.

> **Attention** : Infomaniak a un système de fichiers en **lecture seule** hors de votre site.
> `corepack enable` et `pnpm` via corepack **échouent** (`EROFS: read-only file system`).
> Utilisez **npm** uniquement.

## Prérequis

- Hébergement Infomaniak **payant** avec site Node.js (pas Starter 10 Mo)
- Domaine : `campusagenda.ch`
- Dépôt GitHub public : `https://github.com/atb9pm/campus-agenda`
- Branche de production : `main` (après merge des PR)

## Paramètres Manager Infomaniak

**Avancé → Node.js** :

| Paramètre | Valeur exacte |
|---|---|
| **Dossier d'exécution** | `.` (racine du dépôt cloné) |
| **Version Node.js** | 22 LTS (ou 24) |
| **Commande de build** | `git fetch origin main && git reset --hard origin/main && bash scripts/infomaniak-build.sh` |
| **Commande de lancement** | voir ci-dessous |
| **Port** | `3000` (Infomaniak remplace via `PORT`) |

> Le dossier d'exécution est la **racine du dépôt** (pas `web`) pour que le script
> puisse récupérer le code. Le build et le lancement se font dans `web/`.

### Pourquoi un script plutôt qu'une longue commande

La commande se règle **une seule fois**. Le préfixe `git fetch … && git reset --hard …`
amorce la mise à jour (il fonctionne même si le serveur est encore sur un vieux commit
qui ne contient pas le script). Tout le reste du déploiement — installation, build,
empreinte de version — vit dans [`scripts/infomaniak-build.sh`](../scripts/infomaniak-build.sh)
et évolue donc par Pull Request, **sans jamais revenir dans le Manager**.

Le script :

1. se place à la racine du clone, refait `git fetch` + `git checkout -B main origin/main` + `git reset --hard` (sans effet si déjà à jour)
2. se **relance** dans un nouveau processus, pour appliquer la logique du code fraîchement récupéré
3. installe (`npm ci`, repli `npm install`) et construit dans `web/`
4. écrit `web/build-info.json` (commit, date) exposé par `/api/health`

Cycle courant, sans SSH ni PowerShell :

```
Pull Request → CI verte → Merge sur main → bouton « Build » → bouton « Redémarrer »
```

### Commande de lancement (avec secret)

Infomaniak **n'a pas** d'écran « Variables d'environnement » pour Node.js.
Le secret se met **dans la commande** :

```bash
cd web && AUTH_SECRET=REMPLACEZ_PAR_VOTRE_SECRET CAMPUS_STORE=sqlite npm run start:infomaniak
```

Générer un secret (PowerShell) :

```powershell
-join ((48..57 + 65..90 + 97..122 | Get-Random -Count 48 | ForEach-Object {[char]$_}))
```

Exemple (à personnaliser) :

```bash
cd web && AUTH_SECRET=K7mP2xQ9vL4nR8wT6yU3zA1bC5dE0fGHjKlMnPqRsTuVwXyZ CAMPUS_STORE=sqlite npm run start:infomaniak
```

## Déploiement manuel (première fois)

1. Branche Git du site = `main`
2. **Enregistrer** les paramètres Node.js
3. Désactiver la **maintenance** du site
4. **Build** → cocher « Oui » pour réinstaller `node_modules` au premier essai
5. Attendre la fin du build (2–5 min)
6. **Run**
7. SSL Let's Encrypt pour `campusagenda.ch`

## Déploiement automatique (CI/CD GitHub)

Après configuration, **chaque merge d'une PR sur `main`** déclenche le workflow
[`.github/workflows/deploy-infomaniak.yml`](../.github/workflows/deploy-infomaniak.yml) :

1. Connexion SSH à Infomaniak
2. `git pull` + `npm install` + `npm run build`
3. Redémarrage de l'app (API Manager)
4. Vérification de `https://campusagenda.ch/api/health`

Les PR sont testées par [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (lint + tests + build).

### Étape 1 — Compte SSH Infomaniak

1. Manager Infomaniak → **Hébergement Web** → votre hébergement
2. **FTP / SSH** → **Ajouter** un compte **FTP + SSH**
3. Choisir l'environnement **Node.js** (`campusagenda.ch`)
4. Noter : hôte SSH, utilisateur, mot de passe

### Étape 2 — Authentification SSH pour GitHub Actions

> **Infomaniak Node.js** affiche actuellement : *« L'authentification par clé privée
> n'est pas encore disponible »*. Utilisez donc le **mot de passe** du compte SSH
> (pas de champ clé publique dans le Manager).

1. Créez un compte **FTP + SSH** → environnement **Node.js**
2. Définissez un mot de passe fort (8 car., majuscule, minuscule, chiffre, caractère spécial)
3. Notez les infos de connexion (menu ⋮ → **Voir les informations de connexion SSH**) :
   - Hôte : ex. `57-115909.ssh.hosting-ik.com`
   - Utilisateur : ex. `KtVVAsNzFhW_atb_9pm`

Trouver le chemin du clone Git sur le serveur (via **Console SSH** Infomaniak ou terminal) :

```bash
ssh VOTRE_USER@VOTRE_HOST.infomaniak.com
pwd
ls
# Exemple : /home/clients/abc123/web/campusagenda.ch
```

### Étape 3 — Secrets GitHub

Dépôt → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** :

| Secret | Description |
|---|---|
| `INFOMANIAK_SSH_HOST` | Hôte SSH Node.js (ex. `57-115909.ssh.hosting-ik.com`) |
| `INFOMANIAK_SSH_USER` | Utilisateur SSH (ex. `KtVVAsNzFhW_atb_9pm`) |
| `INFOMANIAK_SSH_PASSWORD` | Mot de passe du compte SSH (**requis** sur Node.js Infomaniak) |
| `INFOMANIAK_SITE_DIR` | Chemin absolu du clone Git sur Infomaniak |
| `INFOMANIAK_SSH_KEY` | *(Optionnel)* Clé privée — quand Infomaniak l'activera |
| `INFOMANIAK_HOSTING_ID` | ID hébergement (Manager, URL ou API) |
| `INFOMANIAK_VHOST_ROUTE_ID` | ID route Node.js du site |
| `INFOMANIAK_SASESSION` | Cookie session Manager (voir ci-dessous) |
| `INFOMANIAK_MANAGER_XSRF` | Token CSRF Manager (voir ci-dessous) |

Les secrets SSH + `INFOMANIAK_SITE_DIR` suffisent pour le build ; les cookies Manager permettent le **redémarrage automatique**.

#### Obtenir les cookies Manager (redémarrage auto)

1. Connectez-vous à [manager.infomaniak.com](https://manager.infomaniak.com)
2. Ouvrez les **Outils de développement** (F12) → **Application** → **Cookies**
3. Copiez `SASESSION` → secret `INFOMANIAK_SASESSION`
4. Copiez `MANAGER-XSRF-TOKEN` (ou `XSRF-TOKEN`) → secret `INFOMANIAK_MANAGER_XSRF`

> Ces cookies **expirent** (session navigateur). Renouvelez-les si le déploiement échoue
> à l'étape « Redémarrer l'application ». En attendant, un **Build + Run** manuel dans le Manager suffit.

#### IDs hosting / vhost

Dans le Manager, ouvrez votre site Node.js : l'URL contient souvent des identifiants numériques.
Sinon, contactez le support ou inspectez les requêtes réseau (onglet Network) lors d'un clic sur **Build**.

### Étape 4 — Activer

1. Mergez cette branche dans `main`
2. Ajoutez les secrets GitHub
3. Poussez un commit sur `main` ou lancez **Actions → Deploy Infomaniak → Run workflow**

### Workflow utilisateur

```
Branche feature → Pull Request → CI (tests) → Merge sur main → Deploy automatique
```

## Vérification

```
https://campusagenda.ch/api/health
```

Attendu :

```json
{
  "ok": true,
  "version": "2.6.1",
  "store": "sqlite",
  "commit": "dc6b445",
  "builtAt": "2026-08-28T14:10:00.000Z"
}
```

- `commit` doit correspondre au dernier commit de `main` sur GitHub.
  S'il est plus ancien : le **Build** n'a pas été relancé.
- `commit` à jour mais site inchangé : le **Redémarrage** manque.
- `commit: null` : l'application tourne encore avec un build antérieur au script
  (relancer **Build** une fois).
- `store: "memory"` : la commande de **lancement** est incomplète — les données sont
  perdues à chaque redémarrage. Utiliser exactement la commande de la section
  « Commande de lancement ».

Connexion enseignant : mot de passe démo **`campus-demo`**

Verrou d’accueil du site : mot de passe **`campus-accueil`** (écran « Site verrouillé »).

## Erreurs courantes

| Erreur | Cause | Correctif |
|---|---|---|
| `EROFS … corepack … /usr/local/bin/pnpm` | `corepack enable` interdit | Build/lancement **sans** corepack, avec **npm** |
| `pnpm: command not found` | pnpm non installé globalement | Utiliser `npm` |
| `AUTH_SECRET requis` | Secret absent | Mettre `AUTH_SECRET=…` dans la commande de lancement |
| Site en maintenance | Mode maintenance ON | **Gérer** → désactiver maintenance |
| Build OK mais Run échoue | Ancienne commande avec corepack | Remplacer la commande de lancement |
| Deploy GitHub : SSH refused | Clé ou hôte incorrect | Vérifier secrets SSH |
| Deploy GitHub : build OK, site ancien | Redémarrage manquant | Mettre à jour cookies Manager ou **Run** manuel |
| Build OK mais `/api/health` garde l'ancien `commit` | Build sans récupération Git | Commande de build = `bash scripts/infomaniak-build.sh` |
| `n'est pas un dépôt Git` | Dossier d'exécution ≠ racine du clone | Mettre `.` comme dossier d'exécution |

## Ne plus utiliser

```bash
# ❌ NE PAS utiliser sur Infomaniak
corepack enable && pnpm install && pnpm run build
pnpm run start:infomaniak
```
