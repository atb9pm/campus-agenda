# Historique des versions

Toutes les évolutions importantes de Campus Agenda sont consignées ici.

## [Unreleased] — Phase 2.3 (exploitation multi-années)

### Ajouté

- **Archivage lecture seule** : publications d'une année `archived` non modifiables (403).
- **Consultation agenda archivé** : filtre `schoolYearId` sur `GET /api/agenda`.
- **Export annuel** JSON/CSV : `GET /api/admin/school-year/{id}/export`.
- **Statistiques charge par classe** : `GET /api/admin/school-year/{id}/stats`.
- **Affectations temporelles** : `valid_from` / `valid_to` sur `memberships` (migration `0007`).
- **Remplacement enseignant** (admin) : `POST /api/admin/memberships/replace` — historique auteur intact.
- Écran Paramètres · **Archives et transitions**.
- Documentation : `docs/multi-year-operations.md`.

### Corrigé

- **Prévisualisation Windows** : `preview:node` lance le serveur officiel vinext (`startProdServer`) sur `127.0.0.1` — HTML, `/_next/static/` et API. `localhost` (IPv6) provoquait une page blanche dans Edge.
- **Écran de connexion** : affiché immédiatement (plus d'écran « Chargement de la session… » bloquant).
- Test HTTP `tests/preview-smoke.test.mjs` : HTML + chunks JS + login enseignant.

## [Unreleased] — Phase 2.0 (fondations)

### Ajouté

- **Année scolaire en base** : tables `school_years` / `school_weeks`, statuts brouillon → active → archivée.
- **Import PDF du plan des semaines A/B** (format secrétariat : calendrier Août–Juin, titre « Année scolaire YYYY-YYYY »).
- **Écran Paramètres · Année scolaire** : déposer le PDF, prévisualiser les 38 semaines, enregistrer en brouillon, activer.
- API : `GET /api/school-year/calendar`, `POST /api/admin/school-year/parse`, `POST /api/admin/school-year/import`, `POST /api/admin/school-year/activate`.
- Calendrier runtime lu depuis l'année **active** en base (repli sur le référentiel codé 2026-2027).

### Phase 2.4 — Coordination des contrôles (en cours)

- **Alerte au 3ᵉ contrôle** le même jour de cours / même classe (sans blocage, « Publier quand même »).
- Vues enseignant **Contrôles · classe** et **Mes contrôles**.
- Panneau élève **Contrôles à venir** (8 max, chronologique).
- Mise en évidence charge globale jours avec plusieurs contrôles.
- Colonne `is_admin` sur les enseignants (fondation rôle admin).

## [1.2.0] - 2026-08-18

### Ajouté

- **Publication enseignant par semaine scolaire A/B** : choix de la semaine (1–38) et du jour de cours (lundi ou jeudi semaine B).
- Navigation enseignant par **semaine scolaire** avec libellé `Semaine XX-A/B` et plage de dates.
- Filtrage de l'agenda partagé et de la synthèse de charge par **numéro de semaine scolaire**.
- Migration SQL `0002_school_week` : colonne `school_week_number` sur les publications.

## [1.1.0] - 2026-08-18

### Ajouté

- **Calendrier scolaire 38 semaines A/B** (année 2026-2027) aligné sur le plan des semaines.
- **Vue élève épurée** : une page par jour de cours, sans grille horaire.
- Affichage automatique du **prochain jour de cours** (lundi ou jeudi semaine B).
- Menu **Cours précédents** pour consulter l'historique.
- Contenu groupé **par branche** (Devoir, Contrôle, Information).

## [1.0.2] - 2026-08-17

### Sécurité

- **Rate limiting sur l'authentification** : protection des routes `POST /api/auth/teacher` et `POST /api/auth/student`.
- Limite par défaut : 10 tentatives / minute (enseignant), 20 / minute (élève) en mémoire locale ; binding Cloudflare `AUTH_RATE_LIMITER` en production.
- Réponse `429` avec en-tête `Retry-After: 60` et message explicite.

## [1.0.1] - 2026-08-17

### Sécurité

- **Retrait du mot de passe enseignant du bundle client** : plus d’auto-connexion ni de secret compilé dans le JavaScript.
- **Écran de connexion enseignant** : saisie du mot de passe côté utilisateur, vérification serveur via `POST /api/auth/teacher`.
- Déconnexion et sortie du mode élève ramènent à l’écran de connexion (l’aperçu enseignant conserve la session sans re-login).

## [1.0.0] - 2026-08-17

### Ajouté

- **Première version utilisable** : persistance SQLite locale et Cloudflare D1 (`CAMPUS_DB`).
- Factory de store (`memory` / `sqlite` / `d1`) avec migrations et seed automatique.
- Interface `AgendaStore` entièrement asynchrone.
- Script `pnpm db:local` pour initialiser une base SQLite de développement.
- Configuration Wrangler (`web/wrangler.jsonc`) et guide de déploiement mis à jour.
- Tests SQLite et documentation d'exploitation enrichie.

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
