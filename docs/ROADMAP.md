# Feuille de route

Les étapes 0.1 à 1.0 sont **réalisées**. Elles décrivent l’historique du socle, pas l’état cible actuel.

## Historique réalisé

### 0.1 — Socle du projet

Structure, architecture, règles de contribution et protection des données.

### 0.2 — Classes et branches

Modèle de classe partagée, rattachement des enseignants et gestion des branches.

### 0.3 — Espace enseignant

Navigation enseignant (aujourd’hui : **Ma semaine** en entrée).

### 0.4 — Publications

Devoir, Contrôle et Information.

### 0.5 — Agenda mutualisé

Charge de classe et coordination des contrôles.

### 0.6 — Vue élève

Consultation par code d’accès.

### 0.7 — Persistance et authentification

SQLite, comptes enseignants, contrôles d’accès.

### 0.8 — Préparation production

Tests, sauvegardes, observabilité, exploitation.

### 1.0 — Première version utilisable

Parcours enseignant / élève / admin prêt pour une mise en service.

## État actuel

- Exploitation scolaire réelle sur **Infomaniak**, persistance **SQLite**.
- Modèle **AnnualCourse** ; **CourseSession** calculées.
- **Carnet** par cours annuel.
- Vue d’entrée enseignant : **Ma semaine**.
