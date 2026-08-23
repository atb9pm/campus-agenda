# Import grille horaire secteur MA (phase 2.2)

## Document source

Un **PDF officiel par an** couvre tout le secteur mécanique automobile (MA, MMA, AMA, MAG, COND, PAI…).

Exemple testé : `tests/fixtures/Horaire_MA_2026_2027_Vdef.pdf`

## Règles d'interprétation

| Élément | Règle |
|---------|-------|
| **SPS-A / SPS-B** | Sport Prévention Santé — **exclu** de Campus Agenda |
| **BG** | Branche générale (langue et société) — **inclus** dans l'agenda partagé |
| **BG / SPS-A** | Semaine A = gym (ignoré), semaine B = BG |
| **BG */ SPS-A** | Semaine A = BG (remplace la gym), semaine B = gym |
| **T.Ph / SPS-B** | Semaine A = T.Ph, semaine B = gym |
| **Codes prof** | 2–3 lettres (`DuP`, `CPE`…) — pas de nom complet |

## Cas de référence

### COND1 — lundi
- **P6–P8** : BG fixes (3 périodes) chaque semaine
- **P3–P4** : T.Ph en semaine A (alternance avec gym semaine B)

### MMA1A — lundi
- **P9–P10** : BG toutes les semaines
- **P7–P8** : BG supplémentaire en semaine A (à la place de la gym)

## API

- `POST /api/admin/timetable/parse` — prévisualisation
- `POST /api/admin/timetable/import` — import + activation
- `GET /api/admin/timetable` — historique
- `GET /api/timetable/branches` — branches du prof pour un jour de cours

## Interface

Paramètres → section **Import annuel** sous l'année scolaire.
