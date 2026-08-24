# Prévisualiser sur Windows (PowerShell)

## ⚠ Important : quel navigateur utiliser

**N'utilisez pas l'aperçu navigateur intégré à Cursor** — il garde en cache une ancienne version de l'app (« Chargement de la session… ») même quand le serveur fonctionne.

Ouvrez **Chrome** ou **Microsoft Edge** et utilisez l'URL affichée par le serveur :

```
http://localhost:5173/preview-login.html
```

## Commandes (copier-coller)

```powershell
cd "C:\Users\François Cheseaux\campus-agenda\web"
$env:CAMPUS_STORE="memory"
$env:AUTH_SECRET="dev-secret"
pnpm.cmd run build
pnpm.cmd run preview:node
```

Le terminal affiche :

```
Connexion (Chrome/Edge) : http://localhost:5173/preview-login.html
```

**Copiez cette URL dans Chrome ou Edge** (pas dans Cursor).

**Important :** les chemins avec espace (`François Cheseaux`) doivent être entre **guillemets**.

## Vérifier que l'API fonctionne

Dans **Chrome ou Edge** :

| URL | Résultat attendu |
|-----|------------------|
| http://localhost:5173/api/preview-info | JSON avec `"version":"2.3.0"` |
| http://localhost:5173/api/health | JSON avec `"ok":true` |
| http://localhost:5173/preview-login.html | Formulaire **Connexion** (page statique) |

Si `/api/preview-info` affiche l'écran « Chargement… » au lieu du JSON → mauvais navigateur ou cache. Utilisez Chrome/Edge.

## Si le cache bloque encore

Changez de port pour contourner le cache de localhost:5173 :

```powershell
$env:PORT="5180"
pnpm.cmd run preview:node
```

Puis ouvrez : **http://localhost:5180/preview-login.html**

## Erreur build « pdfjs-dist/legacy/build/pdf.mjs »

Mettez à jour le code (`git pull`) — un alias Vite corrige ce problème.

Sinon, à la racine du projet :
```powershell
cd "C:\Users\François Cheseaux\campus-agenda"
npm install
cd web
pnpm.cmd run build
```

## Mode Node (recommandé sous Windows)

Après le build :

```powershell
cd "C:\Users\François Cheseaux\campus-agenda\web"
$env:CAMPUS_STORE="memory"
$env:AUTH_SECRET="dev-secret"
pnpm.cmd run build
pnpm.cmd run preview:node
```

## Connexion démo

- Compte : `teacher-demo-current`
- Mot de passe : `campus-demo`

## Arrêter

**Ctrl + C** dans la fenêtre PowerShell où le serveur tourne.
