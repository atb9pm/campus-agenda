# Campus Agenda

Application web d'agenda scolaire pensée pour plusieurs enseignants et plusieurs classes.

## Principes du produit

- La classe est l'espace partagé central.
- Un enseignant peut intervenir dans plusieurs classes et plusieurs branches.
- L'élève consulte l'agenda global de sa classe, toutes branches confondues.
- L'enseignant voit par défaut ses propres publications et peut afficher toute la classe.
- Le menu d'ajout contient uniquement : **Devoir**, **Contrôle** et **Information**.
- Seul l'auteur d'un élément peut le modifier ou le supprimer ; les autres enseignants le consultent.

## État du projet

Le dépôt contient le socle documentaire ainsi qu'un premier prototype web interactif. Aucun jeu de données réel, aucun compte d'élève et aucun secret ne doivent être enregistrés dans GitHub.

## Structure

```text
docs/            Architecture, sécurité et feuille de route
src/
  app/           Initialisation et navigation de l'application
  components/    Composants d'interface partagés
  features/      Fonctionnalités métier
  lib/           Services et utilitaires communs
  types/         Types du domaine
tests/           Tests automatisés
data/            Documentation locale uniquement ; contenu ignoré par Git
web/             Prototype web interactif et configuration d'hébergement
```

## Démarrage du développement

1. Choisir et documenter la pile technique avant d'ajouter ses dépendances.
2. Copier `.env.example` vers `.env.local` et ne jamais versionner ce dernier.
3. Utiliser uniquement des données fictives et manifestement synthétiques pour les tests.
4. Créer un commit par changement cohérent et tenir `CHANGELOG.md` à jour pour les versions.

## Documentation

- [Architecture fonctionnelle](docs/ARCHITECTURE.md)
- [Sécurité et données](docs/SECURITY.md)
- [Feuille de route](docs/ROADMAP.md)
- [Exploitation](docs/OPERATIONS.md)
- [Gestion des versions](docs/VERSIONING.md)
- [Guide de contribution](CONTRIBUTING.md)
