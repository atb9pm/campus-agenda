# Historique des versions

Toutes les évolutions importantes de Campus Agenda sont consignées ici.

## [0.11.0] - 2026-08-17

### Ajouté

- **Préparation production** : observabilité (journaux JSON, `x-request-id`), endpoint `GET /api/health`.
- **Sauvegardes de démonstration** : export / restauration de l'agenda en mémoire (`/api/admin/backup`, `/api/admin/restore`).
- **Tests E2E API** contre le worker compilé (parcours enseignant → élève).
- **Accessibilité** : lien d'évitement, fermeture des modales avec Échap, rôles ARIA sur le menu d'ajout.
- Documentation d'exploitation : `docs/OPERATIONS.md`.

## [0.10.0] - 2026-08-17

### Ajouté

- **Persistance et authentification** : sessions signées (cookie `campus_session`) et store mémoire côté serveur.
- Routes API : connexion enseignant / élève, session, CRUD agenda avec contrôle des droits auteur.
- Schéma SQL initial (`migrations/0001_initial.sql`) prêt pour D1 / SQLite.
- Prototype web branché sur l'API (chargement, création, modification, suppression).
- Mot de passe de démonstration documenté : `campus-demo`.
- Tests automatisés auth, persistance et routes API.

## [0.9.0] - 2026-08-17

### Ajouté

- **Vue élève** : consultation anonyme de l'agenda complet de la classe.
- Connexion par identifiant fictif (`eleve-test-001`, `eleve-test-002`).
- Espace élève dédié en lecture seule, sans noms d'enseignants.
- Résumé hebdomadaire et filtres branche / type / jour pour l'élève.
- Aperçu enseignant et bouton « Espace élève » dans la barre latérale.
- Tests automatisés de l'accès et de l'anonymisation.

## [0.8.0] - 2026-08-17

### Ajouté

- **Agenda mutualisé** : vue « Toute la classe » enrichie avec synthèse de charge hebdomadaire.
- Filtres avancés : branche, type, enseignant, jour et semaine affichée.
- Panneau « Charge globale » et barre de répartition par jour.
- Accès direct à la vue mutualisée depuis le tableau de bord et Mes classes.
- Tests automatisés des filtres et de la charge de travail.

## [0.7.0] - 2026-08-17

### Ajouté

- **Publications** : création, modification et suppression des types Devoir, Contrôle et Information.
- Module `src/features/agenda/publications.ts` avec contrôle « seul l'auteur peut modifier ou supprimer ».
- Boutons modifier / supprimer sur les événements de l'enseignant connecté dans le calendrier.
- Tests automatisés des règles de publication.

## [0.6.0] - 2026-08-17

### Ajouté

- **Espace enseignant** : tableau de bord, navigation par section et vue par défaut « Mes éléments ».
- Module `src/features/teacher/` : navigation, état de workspace et requêtes de synthèse par classe.
- Cartes de classes avec statistiques (mes publications, total, branches enseignées).
- Tests automatisés de l'espace enseignant.

## [0.5.0] - 2026-08-17

### Ajouté

- Modèle de domaine **Classes et branches** : `Classroom`, `Subject`, `Teacher`, `Membership` et `StudentAccess`.
- Données de démonstration fictives pour deux classes TMA et leurs rattachements enseignants.
- Requêtes de consultation : classes par enseignant, branches par classe, vérification enseignant ↔ branche.
- Sélecteur de classe dans le prototype web et filtres de branches issus du modèle.
- Tests automatisés du modèle classes/branches.

## [0.4.0] - 2026-08-11

### Modifié

- L’illustration mécanique validée est maintenant affichée en pleine lumière dans un espace dédié.
- Le véritable emblème piston, engrenage et disque de frein remplace le symbole approximatif.
- Le calendrier est séparé de l’illustration afin que les dessins techniques restent entièrement visibles.
- La composition s’adapte aux écrans d’ordinateur et de téléphone sans masquer l’identité graphique.

## [0.3.0] - 2026-08-11

### Modifié

- Réalignement complet sur la charte graphique automobile validée.
- Palette blanc, bleu marine et bleu électrique.
- Calendrier technique, fonds quadrillés et identité mécanique piston/pignon/freinage.
- Mise en page rapprochée de la maquette de référence sur ordinateur et mobile.

## [0.2.0] - 2026-08-11

### Ajouté

- Premier prototype web responsive de l'agenda partagé.
- Vues « Mes éléments », « Toute la classe » et aperçu élève.
- Filtres par branche et par type de publication.
- Ajout interactif limité à Devoir, Contrôle et Information.
- Données de démonstration explicitement fictives.

## [0.1.0] - 2026-08-11

### Ajouté

- Structure initiale du dépôt.
- Architecture fonctionnelle multi-professeurs et multi-classes.
- Domaine limité aux types Devoir, Contrôle et Information.
- Règles de sécurité empêchant le versionnement de données réelles et de secrets.
- Feuille de route de développement progressif.
