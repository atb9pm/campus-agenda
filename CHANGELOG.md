# Historique des versions

Toutes les évolutions importantes de Campus Agenda sont consignées ici.

## [2.16.0] — Branches : édition, archivage, couleurs actif/désactivé

### Ajouté

- **Édition** du nom d’une branche depuis Paramétrage des branches (le code est recalculé).
- **Archivage** des branches (hors liste courante et hors configuration enseignant), avec
  filtre Branches / Archives.
- Migration `0014_school_branch_archive` : colonne `archived_at` sur `school_branches`.

### Modifié

- Liste des branches plus lisible : cartes séparées, badge statut,
  **vert** si active, **rouge** si désactivée ou archivée.

## [2.15.1] — last_login_at SQLite en ISO 8601 UTC

### Corrigé

- `SqlTeacherAccountStore.authenticate()` enregistre `last_login_at` en **ISO 8601 UTC**
  (`…Z`), comme le store mémoire — plus de `datetime('now')` SQLite sans fuseau,
  mal interprété par `new Date()` côté front (`fr-CH`).

## [2.15.0] — Gestion des accès : lisibilité, édition, archivage, dernier login

### Ajouté

- **Édition** du nom affiché et des initiales depuis la gestion des enseignants / accès.
- **Archivage** des comptes enseignant (hors liste courante, connexion refusée), avec
  onglet Archives et garde-fou sur le dernier administrateur actif.
- **Dernière connexion** affichée sur chaque compte (enregistrée à chaque login réussi).
- Migration `0013_teacher_access_meta` : colonnes `archived_at` et `last_login_at`.

### Modifié

- Liste des accès plus lisible : cartes séparées, badges statut/rôle/mot de passe,
  **vert** si actif, **rouge** si désactivé ou archivé.

## [2.14.0] — Sauvegarde comptes enseignant (backup v3)

### Ajouté

- **Backup format v3** : l'export admin inclut aussi les **comptes enseignant**
  (métadonnées + empreintes de mots de passe PBKDF2 — jamais le mot de passe en clair).
- Restauration des comptes via `POST /api/admin/restore` (upsert, sans supprimer les
  enseignants absents du fichier pour respecter les contraintes FK).

### Modifié

- Les sauvegardes **v1** (agenda) et **v2** (agenda + configs + notes) restent acceptées :
  les comptes ne sont alors pas modifiés.
- Compteurs `teacherAccountCount` / `restoredTeacherAccounts` dans l'export et la réponse.

## [2.13.0] — Sauvegarde configs et notes enseignant

### Ajouté

- **Backup format v2** : l'export admin inclut aussi `teacher_setups` (configuration)
  et `teacher_notes` (notes de carnet), en plus des publications d'agenda.
- Restauration complète de ces trois ensembles via `POST /api/admin/restore`.

### Modifié

- Les sauvegardes **v1** (agenda seul) restent acceptées : à la restauration, les
  configs et notes déjà présentes ne sont pas touchées.
- Compteurs `teacherSetupCount` / `teacherNotesCount` dans l'export et la réponse
  de restauration.

## [2.12.0] — Navigation mobile enseignant et élève

### Ajouté

- **Barre d'onglets mobile** (largeur ≤ 760 px) pour l'espace enseignant : Ma semaine,
  Configuration, Administration (si admin), Espace élève, Déconnexion.
- **Navigation mobile élève** : Cours, Contrôles, Passés, Sortir — adaptée à l'usage
  smartphone (un panneau à la fois).
- Liste dédiée des cours précédents sur mobile (plus uniquement un menu desktop).

### Corrigé

- Sur téléphone, la barre latérale était masquée : un administrateur ne pouvait plus
  ouvrir Administration. La barre d'onglets rétablit cet accès.

## [2.11.0] — Notes de carnet persistées

### Ajouté

- **Notes de carnet enseignant en SQLite** : suivent le compte, plus le navigateur.
- Migration `0012_teacher_notes` : un document JSON par enseignant.
- API `GET` / `PUT /api/teacher/notes` (session enseignant requise).
- **Migration unique** depuis `localStorage` si le serveur est vide, puis effacement
  de la copie locale.

### Modifié

- Le carnet de classe charge et enregistre désormais via l'API (debounce ~400 ms).
- En cas d'indisponibilité réseau au chargement, repli temporaire sur la copie locale
  ou un document vide.

## [2.10.1] — Ménage dans la page principale

### Retiré

- **Code mort** dans `web/app/page.tsx` : restes de la grille d'agenda et du modal de
  publication remplacés par le carnet de classe en 2.5.0 (environ 400 lignes).
- Variables et fonctions inutilisées liées à l'ancienne grille (filtres, `showAgendaTools`,
  modal d'édition, charge de travail, etc.).
- Import `assertAgendaItemMutable` devenu inutile dans `POST /api/agenda`.

### Corrigé

- **Tests fantômes** : `rendered-html` exigeait des symboles morts et figeait le code mort
  en place. Les assertions portent désormais sur le carnet de classe et interdisent le
  retour des restes retirés.
- La vue élève affichait une version codée en dur ; elle utilise `APP_VERSION`.
- Plus aucune variable inutilisée signalée par ESLint dans `web/` pour ce chemin.

### Notes

- Aucun changement de comportement : le code retiré était inatteignable.
- La configuration enseignant reste persistée en SQLite (2.10.0).

## [2.10.0] — Configuration enseignant persistée

### Ajouté

- **Configuration personnelle enseignant en SQLite** (classes, jour, branches, icône) :
  suit le compte, plus le navigateur.
- Migration `0011_teacher_setups` : une ligne JSON par enseignant.
- API `GET` / `PUT /api/teacher/setup` (session enseignant requise).
- **Migration unique** depuis `localStorage` si le serveur est vide, puis effacement
  de la copie locale.

### Modifié

- L'onglet Configuration charge et enregistre désormais via l'API (debounce ~400 ms).
- En cas d'indisponibilité réseau au chargement, repli temporaire sur la copie locale
  ou les valeurs par défaut du catalogue.

### Notes

- Les notes de carnet restent en `localStorage` pour l'instant (passage serveur ultérieur).

## [2.9.0] — Comptes enseignant réels

### Ajouté

- **Mots de passe hachés (PBKDF2-SHA-256, 210 000 itérations, sel aléatoire)** : plus aucun
  mot de passe ni empreinte lisible en base.
- **Gestion des enseignants** dans Administration : création d'un compte (nom + initiales,
  administrateur ou non) avec **mot de passe provisoire affiché une seule fois à l'écran**,
  à transmettre de vive voix, et réinitialisation à la demande.
- **Gestion des accès** : rôle administrateur et activation/désactivation d'un compte.
  Un administrateur actif doit toujours rester, et personne ne peut se retirer son propre accès.
- **Changement de mot de passe obligatoire à la première connexion** : tant qu'un mot de passe
  provisoire est en place, seule cette page est accessible (garde-fou côté serveur également).
- **Amorçage de l'accès administrateur** : `CAMPUS_ADMIN_PASSWORD` (avec `CAMPUS_ADMIN_INITIALS`,
  `ChF` par défaut), sinon mot de passe provisoire tiré au hasard et inscrit dans les journaux
  du serveur. Un mot de passe déjà choisi n'est jamais écrasé.
- Migration `0010_teacher_accounts` : `is_active`, `must_change_password`, `password_updated_at`.
- API `GET/POST /api/admin/teachers`, `PATCH /api/admin/teachers/:id`,
  `POST /api/admin/teachers/:id/password` et `POST /api/auth/teacher/password`.

### Modifié

- **Le mot de passe de démonstration `campus-demo` est refusé par défaut**, y compris en
  production. Il faut `CAMPUS_ALLOW_DEMO_PASSWORD=1` (aperçu local et tests uniquement).
- La page de connexion **n'affiche plus aucun mot de passe** ; en cas d'oubli, l'administrateur
  génère un mot de passe provisoire.
- Politique de mot de passe : au moins 10 caractères, une lettre et un chiffre.
- Le nom affiché et les initiales viennent désormais de la base, plus du catalogue de démonstration.
- Limitation de débit dédiée au changement de mot de passe (10 tentatives par minute).

### Notes

- Les comptes de démonstration existants conservent leur empreinte héritée : en production ils
  ne peuvent plus se connecter tant qu'un administrateur ne leur a pas donné un mot de passe.
- Le mot de passe provisoire n'est **jamais** stocké en clair et n'est renvoyé qu'une seule fois,
  dans la réponse à la création ou à la réinitialisation.

## [2.8.0] — Porte d'entrée unique

### Ajouté

- **Page d'entrée à deux onglets** : **Élève** (par défaut) et **Enseignant**.
- **Connexion enseignant par initiales** (`ChF`) au lieu d'un compte unique codé en dur.
- **« Rester connecté sur cet appareil »** : session de 60 jours si la case est cochée,
  8 heures sinon (postes partagés).
- **Lien direct par classe** : `?classe=eleve-ma2` ouvre l'agenda sans rien saisir (QR code possible).
- Code de classe et initiales **mémorisés sur l'appareil** pour éviter de les retaper.

### Retiré

- **Verrou d'accueil `campus-accueil`** : le code de classe et le mot de passe enseignant
  suffisent, plus besoin de deux mots de passe pour un élève.

### Notes

- L'administrateur n'est **pas** une porte séparée : c'est un compte enseignant marqué
  administrateur, dont le menu Administration apparaît après connexion.
- Les codes élèves restent **par classe** et anonymes : aucune donnée personnelle.

## [2.7.0] — Plan de l'année visible et corrigeable

### Ajouté

- **Plan complet de l'année active** dans Administration : les 38 semaines avec type A/B
  et lundi de référence, corrigeables à la main quand la lecture du PDF s'est trompée.
- **Grille des jours** (lundi–vendredi) avec état de chaque jour : jour de classe,
  sans cours, vacances. Clic sur un jour pour le corriger et le nommer.
- **Fêtes valaisannes calculées** : Lundi de Pâques, Ascension, Lundi de Pentecôte,
  Fête-Dieu, Assomption, Toussaint, Immaculée Conception, Saint-Joseph, Noël, Nouvel An.
  Proposition automatique, l'administrateur garde le dernier mot.
- Migration `0009_school_day_exceptions` : seules les corrections manuelles sont stockées.
- API `GET/PATCH /api/admin/school-year/active-plan` et `PATCH .../active-plan/days`.

### Notes

- Les publications restent attachées au **numéro** de semaine : corriger une date ou un
  type A/B ne déplace ni ne supprime aucune publication.
- Les contrôles de cohérence (date non lundi, alternance rompue, doublon) sont
  **signalés sans bloquer** l'enregistrement, les vacances cassant légitimement l'alternance.

## [2.6.1] — Déploiement Infomaniak en un clic

### Ajouté

- `scripts/infomaniak-build.sh` : commande de build **unique** à coller une seule fois
  (`bash scripts/infomaniak-build.sh`). Elle récupère `origin/main`, réinstalle et rebuild.
- Empreinte de déploiement `web/build-info.json` exposée par `/api/health`
  (`commit`, `builtAt`) pour vérifier le code réellement servi.

### Modifié

- `APP_VERSION` centralisée dans `src/lib/app-version.ts` (plus de version dupliquée
  entre l'API santé et le pied de page).

## [2.6.0] — Administration référentiel école

### Ajouté

- Zone **Administration** (admins uniquement) : classes, branches, plan A/B, placeholders enseignants/accès.
- Migration `0008_school_catalog` + seed (MA1…MA4, MACAM2/4 ; Moteur, Électricité, Transmission, Châssis).
- Soft-désactivation des classes/branches (jamais de suppression dure).

### Modifié

- **Configuration** enseignant : 3 listes déroulantes (classe / jour / branche) depuis le référentiel actif.
- Plan des semaines A/B déplacé hors Configuration vers Administration.

## [2.5.0] — Carnet de classe (maquette validée)

### Ajouté

- Clic sur une classe dans **Ma semaine** → **Carnet de classe**
- Colonnes par semaine (1 à 4 visibles, défaut 3) avec zones :
  - **Contrôle** (menu dédié, visible élève)
  - **Publication élèves** (1 ligne = 1 item, Entrée pour publier)
  - **Notes prof** (privées, localStorage)
- Glisser-déposer et Ctrl+X / Ctrl+V entre semaines
- Aperçu élève depuis le carnet

## [2.4.0] — Vue personnelle enseignant

### Ajouté

- Navigation réduite à **Ma semaine** et **Configuration**.
- Saisie manuelle des classes, jours de cours et branches (persistées localement).
- Affichage des classes triées par jour de la semaine avec icône et branches.
- Tableau de vérification du plan des semaines A et B.

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

## [Unreleased] — Espace ChF (calendrier personnel)

### Ajouté

- Compte enseignant **François Cheseaux (ChF)** — code grille horaire du PDF 2026-2027.
- **8 classes** : MA2, MA3B, MA3A-B, MMA1C, MMA2C, MMA3A, AMA2A, PAI.
- Branches **Con. Prof I**, **Con. Prof L**, **BG** selon la grille.
- Codes élève de test (`eleve-ma2`, `eleve-mma3a`, …) pour essayer la consultation par classe.

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
