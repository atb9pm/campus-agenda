# Prévisualiser Campus Agenda sur Windows

Le site n'est pas une appli Vite classique. C'est une app **vinext** (React + API Cloudflare Workers). En local, le serveur officiel est **`vinext start`** : il sert le HTML, les fichiers `/_next/static/` et les API.

## Une seule procédure

Dans **PowerShell** :

```powershell
cd "C:\Users\François Cheseaux\campus-agenda"
git pull

cd web
$env:CAMPUS_STORE="memory"
$env:AUTH_SECRET="dev-secret"
pnpm.cmd run build
pnpm.cmd run preview:fresh
```

`preview:fresh` libère d'abord le port 5173 s'il est encore pris, puis démarre le serveur.

Alternative sans libérer le port : `pnpm.cmd run preview:node` (choisit automatiquement 5174, 5175… si besoin).

Le terminal affiche :

```
Campus Agenda  →  http://127.0.0.1:5173
```

**Gardez cette fenêtre ouverte.**

## Ouvrir le site

Dans **Edge** ou **Chrome** (pas l'aperçu intégré de Cursor) :

```
http://127.0.0.1:5173
```

Utilisez **127.0.0.1**, pas `localhost`. Sous Windows, `localhost` passe souvent par IPv6 (`::1`) et la page reste blanche.

Test rapide : http://127.0.0.1:5173/api/health → `{"ok":true,...}`

## Connexion démo

- Initiales : `ChF` (François Cheseaux)
- Mot de passe : `campus-demo` (espaces avant/après acceptés)

Ce mot de passe hérité n'existe **que** pour la démonstration : il est refusé partout
sauf si `CAMPUS_ALLOW_DEMO_PASSWORD=1`, que le script d'aperçu local pose lui-même.
En production, l'accès administrateur passe par `CAMPUS_ADMIN_PASSWORD` ou par le mot
de passe provisoire inscrit dans les journaux du serveur.

Si la connexion échoue avec « Trop de tentatives », arrêtez le serveur (Ctrl+C), relancez `pnpm.cmd run preview:fresh` et réessayez. La prévisualisation locale désactive le rate limit automatiquement.

Si vous voyez encore « Professeur démo » avec un menu déroulant, faites `git pull` puis `pnpm.cmd run build` — vous n'avez pas la dernière version.

## Si ça ne démarre pas

| Message / symptôme | Action |
|---|---|
| Port déjà utilisé (`EADDRINUSE`) | `pnpm.cmd run preview:fresh` — ou `$env:PORT="5174"; pnpm.cmd run preview:node`. La dernière version ne plante plus : elle réessaie le port suivant. |
| Build manquant | `pnpm.cmd run build` dans `web/` |
| Page blanche avec `localhost` | Remplacez par `http://127.0.0.1:5173` |
| Ancien écran « Chargement… » | Cache Cursor — ouvrez Edge sur 127.0.0.1 |

## Arrêter

**Ctrl + C** dans la fenêtre PowerShell du serveur.

Pour forcer la libération du port :

```powershell
pnpm.cmd run preview:free-port
```
