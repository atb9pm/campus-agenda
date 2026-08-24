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
pnpm.cmd run preview:node
```

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

- Compte : `teacher-demo-current`
- Mot de passe : `campus-demo`

## Si ça ne démarre pas

| Message / symptôme | Action |
|---|---|
| Port déjà utilisé | Ctrl+C partout, ou `$env:PORT="5180"; pnpm.cmd run preview:node` |
| Build manquant | `pnpm.cmd run build` dans `web/` |
| Page blanche avec `localhost` | Remplacez par `http://127.0.0.1:5173` |
| Ancien écran « Chargement… » | Cache Cursor — ouvrez Edge sur 127.0.0.1 |

## Arrêter

**Ctrl + C** dans la fenêtre PowerShell du serveur.
