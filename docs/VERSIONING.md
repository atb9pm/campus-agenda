# Gestion des versions

Campus Agenda suit une numérotation SemVer `MAJEURE.MINEURE.CORRECTIF`.

- **MAJEURE** : changement incompatible ou refonte importante.
- **MINEURE** : nouvelle fonctionnalité compatible.
- **CORRECTIF** : correction compatible.

La version applicative courante est `APP_VERSION` (aujourd’hui **2.62.0**). Elle est indépendante des données d’un établissement. La première baseline d’installation officielle reste **v2.61.9**.

## Version publiée

Chaque version publiée doit :

1. correspondre à un état **vérifié** de la branche `main` ;
2. être résumée dans `CHANGELOG.md` ;
3. recevoir un tag Git **annoté** `vX.Y.Z` (exemple : `v2.61.9`) ;
4. ne contenir **aucun secret** ni **aucune donnée scolaire réelle** ;
5. pouvoir être **installée sur une base vierge** sans données de démonstration.

Le tag n’est créé **qu’après** validation et merge sur `main`. Une PR de documentation ne pose pas le tag.

Une version installable se valide selon [Baseline d’installation](INSTALLATION_BASELINE.md) (base vierge, puis éventuellement sauvegarde v4 de production restaurée sur TEST).
