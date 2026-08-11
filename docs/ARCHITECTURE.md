# Architecture fonctionnelle

## Modèle central

La **classe** est l'espace partagé. Chaque élément d'agenda est rattaché à une classe, une branche et un enseignant auteur.

```text
Classe
├── Enseignants (plusieurs)
│   └── Branches enseignées
├── Élèves anonymisés (consultation)
└── Agenda partagé
    ├── Devoir
    ├── Contrôle
    └── Information
```

## Vues

### Enseignant

- **Mes éléments**, vue par défaut : publications dont l'enseignant est l'auteur.
- **Toute la classe** : publications de tous les enseignants de la classe, en lecture seule hors éléments personnels.
- Filtres possibles : classe, branche, type et période.

### Élève

- Agenda global de sa classe, toutes branches confondues.
- Consultation uniquement.
- Accès par identifiant anonyme ou code géré hors du dépôt.

## Entités prévues

- `Teacher` : compte authentifié d'un enseignant.
- `Classroom` : espace partagé d'une classe.
- `Subject` : branche enseignée dans une classe.
- `Membership` : rattachement d'un enseignant à une classe et à ses branches.
- `StudentAccess` : accès anonyme et limité à une classe.
- `AgendaItem` : publication typée `HOMEWORK`, `TEST` ou `INFORMATION`.

## Autorisations

| Action | Élève | Enseignant rattaché | Auteur |
|---|---:|---:|---:|
| Consulter l'agenda de la classe | Oui | Oui | Oui |
| Ajouter un élément | Non | Oui | Oui |
| Modifier ou supprimer l'élément d'un autre | Non | Non | — |
| Modifier ou supprimer son élément | Non | — | Oui |

Les autorisations devront être vérifiées côté serveur pour chaque opération.

