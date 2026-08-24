# Interface web Campus Agenda

Prototype interactif de l'agenda scolaire partagé.

## Fonctions démontrées

- vue enseignant « Mes éléments » ;
- vue mutualisée « Toute la classe » ;
- aperçu de la consultation élève ;
- filtres par branche et par type ;
- ajout local d'un Devoir, d'un Contrôle ou d'une Information ;
- navigation entre les semaines.

Toutes les données affichées sont fictives. Version **1.0.0** avec persistance SQLite locale ou Cloudflare D1 — voir `docs/OPERATIONS.md`.

## Développement

```bash
pnpm install
pnpm dev
```

Le projet est construit avec React et vinext pour un déploiement compatible Cloudflare Workers.

Prévisualisation Windows : voir `docs/preview-windows.md` (`pnpm run preview:node` écoute sur `http://127.0.0.1:5173`).
