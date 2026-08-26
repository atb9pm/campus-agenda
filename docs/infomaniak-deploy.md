# Déployer Campus Agenda sur Infomaniak

Guide à jour pour un **site Node.js Infomaniak** avec persistance **SQLite**.

> **Attention** : Infomaniak a un système de fichiers en **lecture seule** hors de votre site.
> `corepack enable` et `pnpm` via corepack **échouent** (`EROFS: read-only file system`).
> Utilisez **npm** uniquement.

## Prérequis

- Hébergement Infomaniak **payant** avec site Node.js (pas Starter 10 Mo)
- Domaine : `campusagenda.ch`
- Dépôt GitHub public : `https://github.com/atb9pm/campus-agenda`
- Branche : `cursor/infomaniak-deploy-9156`

## Paramètres Manager Infomaniak

**Avancé → Node.js** :

| Paramètre | Valeur exacte |
|---|---|
| **Dossier d'exécution** | `web` |
| **Version Node.js** | 22 LTS (ou 24) |
| **Commande de build** | `npm install && npm run build` |
| **Commande de lancement** | voir ci-dessous |
| **Port** | `3000` (Infomaniak remplace via `PORT`) |

### Commande de lancement (avec secret)

Infomaniak **n'a pas** d'écran « Variables d'environnement » pour Node.js.
Le secret se met **dans la commande** :

```bash
AUTH_SECRET=REMPLACEZ_PAR_VOTRE_SECRET CAMPUS_STORE=sqlite npm run start:infomaniak
```

Générer un secret (PowerShell) :

```powershell
-join ((48..57 + 65..90 + 97..122 | Get-Random -Count 48 | ForEach-Object {[char]$_}))
```

Exemple (à personnaliser) :

```bash
AUTH_SECRET=K7mP2xQ9vL4nR8wT6yU3zA1bC5dE0fGHjKlMnPqRsTuVwXyZ CAMPUS_STORE=sqlite npm run start:infomaniak
```

## Déploiement

1. Branche Git du site = `cursor/infomaniak-deploy-9156` (ou pull après merge)
2. **Enregistrer** les paramètres Node.js
3. Désactiver la **maintenance** du site
4. **Build** → cocher « Oui » pour réinstaller `node_modules` au premier essai
5. Attendre la fin du build (2–5 min)
6. **Run**
7. SSL Let's Encrypt pour `campusagenda.ch`

## Vérification

```
https://campusagenda.ch/api/health
```

Attendu :

```json
{ "ok": true, "store": "sqlite" }
```

Connexion enseignant : mot de passe démo **`campus-demo`**

## Erreurs courantes

| Erreur | Cause | Correctif |
|---|---|---|
| `EROFS … corepack … /usr/local/bin/pnpm` | `corepack enable` interdit | Build/lancement **sans** corepack, avec **npm** |
| `pnpm: command not found` | pnpm non installé globalement | Utiliser `npm` |
| `AUTH_SECRET requis` | Secret absent | Mettre `AUTH_SECRET=…` dans la commande de lancement |
| Site en maintenance | Mode maintenance ON | **Gérer** → désactiver maintenance |
| Build OK mais Run échoue | Ancienne commande avec corepack | Remplacer la commande de lancement |

## Ne plus utiliser

```bash
# ❌ NE PAS utiliser sur Infomaniak
corepack enable && pnpm install && pnpm run build
pnpm run start:infomaniak
```
