# Gestion des versions

Campus Agenda suit une numérotation `MAJEURE.MINEURE.CORRECTIF`.

- **MAJEURE** : changement incompatible ou refonte importante.
- **MINEURE** : nouvelle fonctionnalité compatible.
- **CORRECTIF** : correction compatible.

Chaque version publiée doit :

1. correspondre à un état vérifié de la branche `main` ;
2. être résumée dans `CHANGELOG.md` ;
3. recevoir une étiquette Git annotée, par exemple `v0.1.0` ;
4. ne contenir aucun secret ni aucune donnée scolaire réelle.

Les versions `0.x` représentent le développement progressif avant la première version utilisable `1.0.0`.
