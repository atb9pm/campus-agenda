# Campus Agenda

Application web d’agenda scolaire pour enseignants et classes.

## Production

- Hébergement **Infomaniak** (`campusagenda.ch`)
- Persistance **SQLite**
- Authentification enseignant, consultation élève par code

## Espace enseignant

- **Ma semaine** : vue d’entrée, cours attribués (AnnualCourse)
- **Mes cours** : liste des cours de l’année
- **Carnet** : publications d’un cours annuel
- **Contrôles** : planification des tests
- **Administration** : année scolaire, classes, comptes, accès élèves

L’enseignant travaille sur un **AnnualCourse**, jamais uniquement sur une classe.

## Vue élève

Consultation de l’agenda de la classe, toutes branches confondues, via un code d’accès.

## Développement

```bash
cp .env.example .env.local
cd web && pnpm install && pnpm dev
```

Données de démonstration (`DEMO_CATALOG`) : tests, fixtures et seed locaux uniquement. Jamais une liste de production.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Sécurité](docs/SECURITY.md)
- [Feuille de route](docs/ROADMAP.md)
- [Exploitation](docs/OPERATIONS.md)
- [Déploiement Infomaniak](docs/infomaniak-deploy.md)
