# Prévisualiser sur Windows (PowerShell)

## Commandes

```powershell
cd "C:\Users\François Cheseaux\campus-agenda"
git pull

cd web
$env:CAMPUS_STORE="memory"
$env:AUTH_SECRET="dev-secret"
pnpm.cmd run build
pnpm.cmd run preview:node
```

Le serveur écoute par défaut sur **http://127.0.0.1:5180** (port 5180 pour éviter les conflits avec 5173).

## Test obligatoire (avant le navigateur)

Dans **une autre fenêtre PowerShell**, pendant que le serveur tourne :

```powershell
Invoke-WebRequest http://127.0.0.1:5180/ping
```

Vous devez voir : **`pong 2.3.0`**

- Si ça **bloque ou échoue** → le serveur ne répond pas (port occupé, mauvais terminal fermé, pare-feu).
- Si **`pong` OK** → ouvrez Edge :

```
http://127.0.0.1:5180/preview-login.html
```

Utilisez **127.0.0.1** (pas `localhost`) si la page rame.

## Connexion démo

- Compte : `teacher-demo-current`
- Mot de passe : `campus-demo`

## Problèmes fréquents

| Symptôme | Solution |
|----------|----------|
| Page blanche qui charge indéfiniment | Testez `/ping` dans PowerShell. Gardez la fenêtre du serveur **ouverte**. |
| Port déjà utilisé | `$env:PORT="5190"; pnpm.cmd run preview:node` |
| Ancien écran « Chargement… » | N'utilisez pas l'aperçu Cursor — utilisez **Edge** avec **127.0.0.1** |
| Build manquant | `pnpm.cmd run build` dans `web/` |

## Arrêter

**Ctrl + C** dans la fenêtre PowerShell où le serveur tourne.
