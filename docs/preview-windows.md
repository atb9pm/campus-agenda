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
```

Vous devez voir du JSON (`"ok":true`). Sinon le serveur ne répond pas correctement.

## Si « Chargement de la session… » ne finit pas

1. **Ctrl + C** dans PowerShell pour arrêter le serveur
2. Mettre à jour le code : `git pull` (à la racine du projet)
3. Rebuild + start (commandes ci-dessus)
4. **Navigation privée** ou supprimer les cookies de `localhost:5173`
5. Retester `/api/health` puis `http://localhost:5173`

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
