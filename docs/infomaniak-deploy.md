# Déployer Campus Agenda sur Infomaniak

Guide pour reprendre (ou finaliser) la mise en ligne sur un **site Node.js Infomaniak**, avec persistance **SQLite** et le compte enseignant **ChF**.

> **Alternative** : Cloudflare Workers + D1 — voir `docs/OPERATIONS.md`.

## Prérequis

- Hébergement Infomaniak avec **site Node.js** (Web ou Serveur Cloud managé)
- Dépôt GitHub : `https://github.com/atb9pm/campus-agenda`
- Branche recommandée : `cursor/chf-personal-calendar-9156` (ou `main` après fusion)
- Node.js **22 LTS** (minimum 22.13 dans `web/package.json`)

## 1. Créer ou rouvrir le site Node.js

Dans le [Manager Infomaniak](https://manager.infomaniak.com/) :

1. **Hébergement Web** → votre hébergement → **Ajouter un site**
2. Choisir **Node.js** → méthode **Personnalisée**
3. Source Git : dépôt `atb9pm/campus-agenda`
4. Branche : `cursor/chf-personal-calendar-9156`

## 2. Paramètres Node.js (Manager)

Onglet **Node.js** → **Gérer les paramètres avancés** :

| Paramètre | Valeur |
|---|---|
| **Dossier d'exécution** | `web` |
| **Version Node.js** | 22 LTS |
| **Commande de build** | `corepack enable && pnpm install && pnpm run build` |
| **Commande de lancement** | `pnpm run start:infomaniak` |

> Infomaniak transmet le **port** via la variable `PORT`. Ne le fixez pas en dur dans le code.

### Variables d'environnement (Manager)

| Variable | Valeur | Obligatoire |
|---|---|---|
| `AUTH_SECRET` | Chaîne aléatoire longue (32+ caractères) | **Oui** |
| `CAMPUS_STORE` | `sqlite` | Recommandé |
| `CAMPUS_SQLITE_PATH` | `.data/campus-agenda.sqlite` | Optionnel |
| `APP_ENV` | `production` | Optionnel |

Générer un secret (PowerShell local) :

```powershell
-join ((48..57 + 65..90 + 97..122 | Get-Random -Count 48 | ForEach-Object {[char]$_}))
```

**Ne jamais** committer `AUTH_SECRET` dans Git.

## 3. Domaine et SSL

1. Associer votre domaine (ex. `agenda.votre-ecole.ch`) au site Node.js
2. Activer le certificat **SSL Let's Encrypt** dans le Manager
3. Attendre la propagation DNS (souvent quelques minutes)

## 4. Premier déploiement

1. Lancer **Build** depuis le Manager (ou push Git si déploiement auto)
2. **Redémarrer** l'application
3. Vérifier : `https://votre-domaine/api/health`

Réponse attendue :

```json
{
  "ok": true,
  "service": "campus-agenda",
  "version": "2.3.0",
  "store": "sqlite"
}
```

## 5. Connexion enseignant

- Compte : **François Cheseaux (ChF)** — `teacher-chf`
- Mot de passe démo : **`campus-demo`**

La base SQLite est créée et initialisée automatiquement au premier démarrage (schéma + données ChF).

## 6. Mises à jour

À chaque évolution du code :

1. `git push` sur la branche suivie par Infomaniak
2. Relancer **Build** dans le Manager
3. **Redémarrer** l'application

Commande build (identique à la config initiale) :

```bash
corepack enable && pnpm install && pnpm run build
```

## Dépannage

| Symptôme | Action |
|---|---|
| Build échoue (`pnpm` introuvable) | Vérifier `corepack enable` en tête de la commande build |
| Crash au démarrage « AUTH_SECRET requis » | Ajouter `AUTH_SECRET` dans les variables d'environnement |
| `store: "memory"` dans `/api/health` | Définir `CAMPUS_STORE=sqlite` + redémarrer |
| Page blanche | Consulter la **console d'exécution** Node.js dans le Manager |
| Port / crash au démarrage | Vérifier que la commande de lancement est `pnpm run start:infomaniak` |

## Sauvegardes

Exports via l'API (enseignant connecté) :

```http
GET /api/admin/backup
```

Le fichier SQLite (`.data/campus-agenda.sqlite`) peut aussi être sauvegardé via SFTP depuis le dossier `web/.data/` — **ne pas** le versionner dans Git.

## Différences Cloudflare vs Infomaniak

| | Cloudflare Workers | Infomaniak Node.js |
|---|---|---|
| Base de données | D1 | SQLite (fichier) |
| Commande | `wrangler deploy` | Git + build Manager |
| Rate limit IP | Binding natif | Compteur mémoire par processus |
| Coût | Gratuit / Workers | Hébergement Web Infomaniak |
