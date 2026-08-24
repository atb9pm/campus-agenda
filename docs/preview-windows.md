# Prévisualiser sur Windows (PowerShell)

## Commandes (copier-coller)

```powershell
cd "C:\Users\François Cheseaux\campus-agenda\web"
$env:CAMPUS_STORE="memory"
$env:AUTH_SECRET="dev-secret"
pnpm.cmd run build
pnpm.cmd start --port 5173
```

**Important :** les chemins avec espace (`François Cheseaux`) doivent être entre **guillemets**.

## Vérifier que l'API fonctionne

Avant d'ouvrir l'app, testez dans le navigateur :

```
http://localhost:5173/api/health
http://localhost:5173/api/preview-info
```

- `/api/health` → `"ok":true`
- `/api/preview-info` → `"version":"2.3.0"` et `"loginScreen":"immediate"`

Si `/api/preview-info` renvoie une erreur ou une version ancienne, le serveur n'est pas à jour.

## Si « Chargement de la session… » ne finit pas

Cause la plus fréquente : le serveur tourne encore avec un **ancien build** (les fichiers JavaScript ne se chargent pas).

1. **Ctrl + C** dans PowerShell pour **arrêter complètement** le serveur
2. Mettre à jour le code : `git pull` (à la racine du projet)
3. Rebuild + preview Node (voir ci-dessous) — **pas** `pnpm.cmd start` sous Windows
4. **Navigation privée** ou supprimer les cookies de `localhost:5173`
5. Retester `/api/health` puis `http://localhost:5173`
6. Si besoin : **F12 → Console** — des erreurs 404 sur `/_next/static/...` indiquent qu'il faut refaire build + redémarrer le serveur
7. **Vider le cache** : **Ctrl+Shift+R** (ou navigation privée). L'ancienne page HTML peut rester en cache.
8. En bas de l'écran de connexion, vous devez voir **« PREVIEW NODE · CAMPUS AGENDA 2.3.0 »** — sinon le build n'est pas à jour.

## Erreur build « pdfjs-dist/legacy/build/pdf.mjs »

Mettez à jour le code (`git pull`) — un alias Vite corrige ce problème.

Sinon, à la racine du projet :
```powershell
cd "C:\Users\François Cheseaux\campus-agenda"
npm install
cd web
pnpm.cmd run build
```

## Mode Node (recommandé sous Windows si `start` bloque)

Après le build :

```powershell
cd "C:\Users\François Cheseaux\campus-agenda\web"
$env:CAMPUS_STORE="memory"
$env:AUTH_SECRET="dev-secret"
pnpm.cmd run build
pnpm.cmd run preview:node
```

Testez **http://localhost:5173/api/health** puis **http://localhost:5173**.

## Mode développement (alternative)

Si `start` pose problème, essayez :

```powershell
cd "C:\Users\François Cheseaux\campus-agenda\web"
$env:CAMPUS_STORE="memory"
$env:AUTH_SECRET="dev-secret"
pnpm.cmd dev --port 5173
```

## Connexion démo

- Compte : `teacher-demo-current`
- Mot de passe : `campus-demo`

## Arrêter

**Ctrl + C** dans la fenêtre PowerShell où le serveur tourne.
