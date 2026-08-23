# Feuille de route

## Phases livrées

### 0.1 — Socle du projet

Structure, architecture, règles de contribution et protection des données.

### 0.2 — Classes et branches

Modèle de classe partagée, rattachement des enseignants et gestion des branches.

### 0.3 — Espace enseignant

Navigation par classe et vue par défaut « Mes éléments ».

### 0.4 — Publications

Création, modification et suppression des seuls types validés : Devoir, Contrôle et Information.

### 0.5 — Agenda mutualisé

Vue « Toute la classe », filtres et lecture globale de la charge de travail.

### 0.6 — Vue élève

Consultation anonyme de l'agenda complet de la classe.

### 0.7 — Persistance et authentification

Base de données, comptes enseignants, contrôles d'accès et gestion sécurisée des secrets.

### 0.8 — Préparation production

Tests de bout en bout, accessibilité renforcée, sauvegardes de démonstration, observabilité et documentation d'exploitation.

### 1.0 — Première version utilisable

Persistance SQLite / D1, store factory, migrations, déploiement et parcours complet de démonstration.

### 1.1 — Vue élève jour de cours (semaines A/B)

Calendrier scolaire 38 semaines A/B, page élève par jour de cours (lundi ; jeudi en semaine B), contenu groupé par branche, menu « Cours précédents », résolution automatique du prochain jour de cours.

### 1.2 — Publication enseignant par semaine scolaire

Choix de la semaine scolaire (1–38) et du jour de cours à la publication, navigation enseignant par semaine A/B, persistance `school_week_number`.

---

## Vision pérennité (à partir de la phase 2)

Objectifs métier validés :

1. **Réutiliser** devoirs, consignes et informations d'une année sur l'autre (bibliothèque pédagogique).
2. **Préparer chaque année scolaire** en début d'année : plan des semaines A/B, jours de cours, sans modifier le code source.
3. **Importer la grille horaire du secteur** pour créer classes, branches et affectations enseignants en masse.
4. **Conserver une saisie manuelle** pour les changements en cours d'année (remplacement, déplacement, nouvelle branche).

Principes directeurs :

- **Automatisation forte** là où le volume le justifie (import, duplication annuelle).
- **Édition manuelle ciblée** pour les exceptions — jamais une resaisie complète.
- **Séparation des couches** : référentiel stable → configuration annuelle → contenu pédagogique.
- **Une seule année active** à la fois ; les années passées sont archivées (lecture seule).

---

## 2.0 — Année scolaire configurable

**Problème actuel :** les 38 semaines A/B et leurs dates sont codées en dur (`school-week-dates.ts`). Chaque nouvelle année impose une modification du code.

**Livrables :**

- Entité `SchoolYear` en base (ex. « 2026-2027 ») : dates de début/fin, statut (`brouillon` → `active` → `archivée`).
- Entité `SchoolWeek` : numéro (1–38), type A/B, date du lundi de référence.
- Règles de jours de cours par filière (ex. TMA : lundi ; jeudi en semaine B) rattachées à l'année ou au programme.
- Écran admin : créer une année, importer ou copier le plan A/B (CSV), prévisualiser, activer.
- Application runtime : calendrier, vues enseignant et élève lues depuis l'année **active** (plus depuis le code).

**Critère de succès :** en août, un responsable prépare l'année suivante dans l'interface sans intervention développeur.

**Hors scope immédiat :** jours fériés et vacances (report phase ultérieure si besoin).

---

## 2.1 — Bibliothèque pédagogique réutilisable

**Problème actuel :** chaque publication est une instance unique ; aucun modèle réutilisable d'une année à l'autre.

**Livrables :**

- Entité `PublicationTemplate` (bibliothèque) : titre, consigne, type, branche de référence, éventuellement semaine/jour par défaut.
- Distinction **modèle** (réutilisable) / **instance** (`AgendaItem` dans une année donnée).
- Action « Enregistrer dans la bibliothèque » depuis une publication existante.
- Assistant « Déployer sur l'année » : sélection de modèles → placement sur semaines/jours/branches (manuel ou semi-automatique).
- Action « Dupliquer depuis l'année précédente » : reprendre les instances ou les modèles de l'année archivée.

**Critère de succès :** ~80–90 % du contenu récurrent est repris sans resaisie ; les nouveautés restent éditables à la main.

**Règles :**

- Modifier une **instance** n'altère pas le modèle (sauf action explicite « mettre à jour le modèle »).
- Les publications passées conservent l'auteur et la date d'origine.

---

## 2.2 — Import grille horaire secteur

**Problème actuel :** classes, branches et memberships enseignants sont des données de démonstration statiques.

**Livrables :**

- Format d'import documenté (CSV / Excel normalisé) : classe, branche, enseignant, jour, créneau, pattern de semaine si applicable.
- Import en masse : création ou mise à jour des `Classroom`, `Subject`, `Membership`, `TimetableSlot`.
- Écran de **prévisualisation** avant validation (détection doublons, profs inconnus, lignes rejetées).
- Écran de **correction manuelle** : réaffecter un prof, ajouter une branche, corriger un créneau.
- Lien avec l'agenda : à la publication, les branches proposées correspondent aux memberships importés.

**Critère de succès :** préparation de toutes les classes TMA en une importation + corrections ponctuelles (pas de saisie ligne par ligne).

**Prérequis métier (à fournir par l'établissement) :**

- Exemple réel de grille horaire secteur (anonymisé).
- Liste des classes et filières concernées.
- Confirmation des règles jours de cours par filière.

**Limite assumée :** l'import dépend de la stabilité du format source ; des cas particuliers restent manuels.

---

## 2.3 — Exploitation multi-années

**Livrables :**

- Archivage d'une année terminée (lecture seule, consultable par les enseignants autorisés).
- Gestion des changements en cours d'année : membership avec `valid_from` / `valid_to`, historique des affectations.
- Remplacement enseignant : nouvelles publications = nouveau prof ; l'historique reste intact.
- Export / sauvegarde annuelle (JSON ou CSV) pour conformité et archivage institutionnel.
- (Optionnel) Statistiques par classe : charge de travail sur l'année, par branche.

**Critère de succès :** passage N → N+1 reproductible ; aucune perte de contenu utile ; corrections mid-year sans rupture.

---

## Modèle de données cible (schéma simplifié)

```text
SchoolYear (active | archivée)
  └── SchoolWeek[] (1..38, A|B, lundi)
  └── CourseDayRule[] (ex. TMA : lun + jeu si B)

Classroom
  └── Subject (branche)
  └── Membership (Teacher ↔ Subject, valid_from?, valid_to?)

TimetableSlot (grille importée)
  └── classroom, subject, teacher, day, hour, week_pattern?

PublicationTemplate (bibliothèque, multi-années)
  └── title, detail, type, subject_ref, defaults?

AgendaItem (instance, rattachée à school_year_id)
  └── school_week_number, course_day, template_id?, author, …
```

---

## Ordre de réalisation recommandé

| Ordre | Phase | Pourquoi en premier |
|------:|-------|---------------------|
| 1 | **2.0** | Sans année configurable, rien d'autre n'est pérenne |
| 2 | **2.1** | Réutilisation du contenu — gain métier immédiat |
| 3 | **2.2** | Import grille — dépend du modèle année + classes en base |
| 4 | **2.3** | Archivage et mid-year — une fois le cycle complet en place |

La saisie manuelle unitaire (publication, modification, suppression) reste disponible **à chaque phase** en parallèle des imports et assistants.

---

## Déploiement et données

- Hébergement cible : **Infomaniak** (Node.js + SQLite), données en Suisse.
- Aucune donnée élève nominative requise pour les phases 2.x si l'accès reste par code anonyme.
- Chaque phase majeure : migration SQL, tests, entrée `CHANGELOG.md`, version semver (2.0.0, 2.1.0, …).
