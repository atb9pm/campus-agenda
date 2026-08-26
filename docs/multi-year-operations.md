# Exploitation multi-années (phase 2.3)

## Fonctionnalités

- **Années archivées en lecture seule** : les publications rattachées à une année `archived` ne peuvent plus être modifiées ni supprimées.
- **Consultation** : `GET /api/agenda?classroomId=…&schoolYearId=…` renvoie `{ items, readOnly }`.
- **Export annuel** : `GET /api/admin/school-year/{id}/export?format=json|csv`.
- **Statistiques** : `GET /api/admin/school-year/{id}/stats?classroomId=…`.
- **Affectations temporelles** : colonnes `valid_from` / `valid_to` sur `memberships`.
- **Remplacement enseignant** (admin) : `POST /api/admin/memberships/replace`.

## Remplacement en cours d'année

1. L'administrateur sélectionne classe, enseignant sortant, remplaçant et branches.
2. Les affectations actives correspondantes sont clôturées (`valid_to`).
3. Une nouvelle affectation ouvre les branches pour le remplaçant (`valid_from`).
4. Les publications existantes conservent `author_teacher_id` ; seules les **nouvelles** publications portent le remplaçant.

## Passage N → N+1

1. Importer et activer la nouvelle année (phase 2.0) — l'année précédente passe automatiquement en `archived`.
2. Dupliquer depuis la bibliothèque (phase 2.1) si souhaité.
3. Exporter l'année archivée en JSON/CSV pour archivage institutionnel.

## Interface

Paramètres → **Archives et transitions** : consultation, export, remplacement enseignant (admin).
