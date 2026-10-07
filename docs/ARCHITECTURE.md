# Architecture fonctionnelle

Campus Agenda est une application web. L’autorité des mutations est l’**API serveur**. Les `CourseSession` sont **calculées**, jamais persistées en table SQL.

## Modèle vivant

```text
SchoolYear
  → SchoolClass
    → AnnualCourse
      → CourseScheduleSlot
        → CourseSession (calculée : année + cours + date)
          → agenda_items (devoirs, informations, contrôles)
```

- **AnnualCourse** : cours annuel (classe + CTX + année). L’enseignant travaille dessus.
- **CourseScheduleSlot** : créneau d’horaire du cours.
- **CourseSession** : séance réelle projetée sur le calendrier scolaire (A/B, vacances). Clé `schoolYearId|annualCourseId|date`. Pas de table SQL.
- **agenda_items** : publications et contrôles, éventuellement rattachés à une CourseSession (`courseSessionKey`, `courseSessionDate`).

## Vues actuelles

| Vue | Rôle |
|---|---|
| **Ma semaine** | Entrée enseignant. Cours attribués, ouverture d’un AnnualCourse. |
| **Mes cours** | Liste des AnnualCourse de l’année. |
| **Carnet** | Contexte d’un cours annuel : notes, devoirs, informations. |
| **Contrôles** | Planification et déplacement des tests vers une CourseSession. |
| **Élève** | Agenda de la classe, accès par code. |
| **Administration** | Année, classes, enseignants, accès élèves, sauvegardes. |

Ma semaine ouvre un **AnnualCourse** (jamais le premier cours d’une classe multi-cours par défaut).

## Autorisations

Les droits (auteur, attribution, admin, MFA) sont vérifiés côté serveur pour chaque mutation. Le client ne choisit pas une date ou une branche à la place du modèle métier.
