# Interface web Campus Agenda

Prototype interactif de l'agenda scolaire partagé.

## Fonctions démontrées

- vue enseignant « Mes éléments » ;
- vue mutualisée « Toute la classe » ;
- aperçu de la consultation élève ;
- filtres par branche et par type ;
- ajout local d'un Devoir, d'un Contrôle ou d'une Information ;
- navigation entre les semaines.

Toutes les données affichées sont fictives. L'authentification et la persistance mémoire sont disponibles en démonstration ; voir `docs/OPERATIONS.md` pour l'exploitation.

## Développement

```bash
pnpm install
pnpm dev
```

Le projet est construit avec React et vinext pour un déploiement compatible Cloudflare Workers.
