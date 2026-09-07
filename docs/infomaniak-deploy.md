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

Cycle courant, sans SSH depuis GitHub :

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

### Premier mot de passe administrateur

Le mot de passe de démonstration `campus-demo` est **refusé** en production : aucun
compte ne peut s'en servir. Deux façons d'obtenir le premier accès administrateur.

**Choisir soi-même le mot de passe** — ajouter `CAMPUS_ADMIN_PASSWORD` (et au besoin
`CAMPUS_ADMIN_INITIALS`, `ChF` par défaut) à la commande de lancement :

```bash
cd web && AUTH_SECRET=… CAMPUS_STORE=sqlite CAMPUS_ADMIN_INITIALS=ChF CAMPUS_ADMIN_PASSWORD=Direction-2027 npm run start:infomaniak
```

Il n'est appliqué que si le compte n'a **pas encore** de mot de passe personnel :
un mot de passe choisi dans l'application n'est jamais écrasé au redémarrage.
Retirez la variable de la commande une fois le mot de passe défini dans l'application.

**Laisser le serveur en tirer un** — sans variable, un mot de passe provisoire est
généré au démarrage et inscrit dans les journaux Node.js du Manager :

```
==================== CAMPUS AGENDA — ACCÈS ADMINISTRATEUR ====================
  Initiales        : ChF
  Mot de passe     : K7QP-M3ZR-T9WD
```

Dans les deux cas, l'application impose un changement de mot de passe à la première
connexion, puis les comptes suivants se créent depuis **Administration → Gestion des
enseignants** (mot de passe provisoire affiché à l'écran, à transmettre de vive voix).

| Variable | Rôle |
|---|---|
| `AUTH_SECRET` | Signature des sessions (obligatoire) |
| `CAMPUS_STORE=sqlite` | Persistance sur disque |
| `CAMPUS_ADMIN_INITIALS` | Compte administrateur visé par l'amorçage (`ChF` par défaut) |
| `CAMPUS_ADMIN_PASSWORD` | Mot de passe d'amorçage, appliqué une seule fois |
| `CAMPUS_ALLOW_DEMO_PASSWORD` | **À ne pas définir en production** : rouvrirait `campus-demo` |

## Déploiement manuel (première fois)

1. Branche Git du site = `main`
2. **Enregistrer** les paramètres Node.js
3. Désactiver la **maintenance** du site
4. **Build** → cocher « Oui » pour réinstaller `node_modules` au premier essai
5. Attendre la fin du build (2–5 min)
6. **Run**
7. SSL Let's Encrypt pour `campusagenda.ch`

## Après un merge : Build Infomaniak, pas GitHub SSH

Infomaniak Node.js **n’expose pas encore** de secret SSH utilisable depuis GitHub Actions
(« L'authentification par clé privée n'est pas encore disponible »). Un `sshpass`
depuis Actions restait bloqué plusieurs heures. **Le déploiement ne passe plus par SSH.**

```
Branche → Pull Request → CI (tests) → Merge sur main
  → Manager Infomaniak : Build puis Redémarrer
  → GitHub : vérifie https://campusagenda.ch/api/health
```

Les PR sont testées par [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
Après un push sur `main`, [`.github/workflows/deploy-infomaniak.yml`](../.github/workflows/deploy-infomaniak.yml)
contrôle seulement que le site répond (`ok: true`). Si le `commit` de `/api/health`
n’est pas encore celui de `main`, c’est un rappel de lancer **Build** dans le Manager,
pas un échec.

Pour attendre le nouveau commit (après un Build) : **Actions → Deploy Infomaniak →
Run workflow**, case « Attendre que /api/health serve le commit ».

Aucun secret GitHub n’est requis pour ce contrôle.

## Vérification

```
https://campusagenda.ch/api/health
```

Attendu :

```json
{
  "ok": true,
  "version": "2.43.1",
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

Page d'entrée unique, onglet **Élève** par défaut : code de classe (ex. `eleve-ma2`).

Onglet **Enseignant** : initiales (ex. `ChF`) + mot de passe personnel (voir
« Premier mot de passe administrateur »). L'accès administrateur n'est pas une porte
séparée : le menu Administration apparaît automatiquement pour un compte marqué
administrateur.

## Erreurs courantes

| Erreur | Cause | Correctif |
|---|---|---|
| `EROFS … corepack … /usr/local/bin/pnpm` | `corepack enable` interdit | Build/lancement **sans** corepack, avec **npm** |
| `pnpm: command not found` | pnpm non installé globalement | Utiliser `npm` |
| `AUTH_SECRET requis` | Secret absent | Mettre `AUTH_SECRET=…` dans la commande de lancement |
| « Initiales ou mot de passe incorrect » avec `campus-demo` | Comportement voulu : le mot de passe démo est refusé en production | Utiliser le mot de passe d'amorçage (voir « Premier mot de passe administrateur ») |
| Site en maintenance | Mode maintenance ON | **Gérer** → désactiver maintenance |
| Build OK mais Run échoue | Ancienne commande avec corepack | Remplacer la commande de lancement |
| GitHub « Santé injoignable » | Site down ou maintenance | Désactiver la maintenance, vérifier Run Infomaniak |
| GitHub notice « Main est … » | Build Infomaniak pas encore lancé | **Build** puis **Redémarrer** dans le Manager |
| Build OK mais `/api/health` garde l'ancien `commit` | Build sans récupération Git | Commande de build = `bash scripts/infomaniak-build.sh` |
| `n'est pas un dépôt Git` | Dossier d'exécution ≠ racine du clone | Mettre `.` comme dossier d'exécution |

## Ne plus utiliser

```bash
# ❌ NE PAS utiliser sur Infomaniak
corepack enable && pnpm install && pnpm run build
pnpm run start:infomaniak
```
