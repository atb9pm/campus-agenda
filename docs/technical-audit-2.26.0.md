# Audit technique Campus Agenda 2.26.0

Date : 2026-08-31  
Base : `main` `88fcfea3729c0b82bd0baeffc0ab6cde2951757f` (PR54 mergée)  
Version précédente : 2.25.2  
Dernière migration historique : `0023_class_attendance_days.sql`  
Périmètre : audit + stabilisation. **Pas** de CourseOccurrence, dates réelles, ni nouvelle fonctionnalité métier.

Fichiers inspectés (ordre de grandeur) : `src/features/**`, `src/lib/**`, `web/app/**`, `web/lib/**`, `migrations/**`, `scripts/**`, `tests/**`, `.github/workflows/**`, `package.json`, `web/package.json`, `tsconfig`.

| Compteur | Valeur |
| --- | --- |
| Fichiers `src/**/*.ts` audités | 181 |
| Routes `web/app/api/**/route.ts` | 41 |
| Routes `web/app/api/admin/**` | 23 |
| Migrations `0001`→`0023` | 23 (inchangées) |

**Aucun P0/P1 restant BLOCKER** (après les corrections de merge : typecheck/lint globaux réels, backup v4 strict, présence ≠ cours). Tous les P0/P1 identifiés sont corrigés dans cette PR, ou classés P2 lorsqu’ils ne créent pas d’erreur produit immédiate.

---

## Architecture réellement utilisée

```
UI (web/app/page.tsx + panels)
  → API (web/app/api/**)  ← source de vérité des autorisations
    → services features (annual-courses, course-schedule, school-catalog, agenda)
      → persistence Memory | SQLite | D1 (même contrat)
```

Sources de vérité **structurées** (prioritaires) :

| Concept | Source |
| --- | --- |
| Qui enseigne | `TeacherCourseAssignment` |
| Segment horaire (pas une séance) | `CourseScheduleSlot` |
| Présence de classe | `ClassAttendanceDay` |
| Semaines A/B | `SchoolYear.weeks[].kind` |
| Catalogue | `SchoolClass`, `Profession`, `Branch`, `CTX`, `AnnualCourse` |

**LEGACY ADAPTER** (fallback seulement si aucune donnée structurée fiable) :

- `classrooms` / `subjects` / `memberships` / `student_accesses`
- `DEMO_CATALOG` (seed, tests, filet UI)
- `getCourseDaysForWeek` / `DEFAULT_TMA_SCHEDULE` (lundi + jeudi B)
- `legacyTmaPublicationDayAllowed`
- import PDF `timetable_*`

Le legacy ne doit jamais écraser une donnée structurée.

---

## Routes API

41 fichiers `route.ts`. Surfaces principales :

- Auth : `/api/auth/teacher`, `/password`, `/student`, `/session`
- Agenda : `GET/POST /api/agenda`, `PATCH/DELETE /api/agenda/[id]`
- Enseignant : `/api/teacher/classrooms`, `/courses`, `/setup`, `/notes`
- Admin : catalogue, cours annuels, horaire, memberships, timetable, school-year, teachers, backup, restore, pedagogical-path
- Bibliothèque, calendrier scolaire, health

---

## Matrice d’autorisations

| Route | Anonyme | Enseignant | Admin |
| --- | --- | --- | --- |
| `/api/admin/backup` GET | 401 | 403 | 200 |
| `/api/admin/restore` POST | 401 | 403 | 200/400 |
| `/api/admin/memberships` | 401 | 403 | 200 |
| `/api/admin/timetable` + import/parse | 401 | 403 | selon payload |
| `/api/admin/school-year` + import/activate | 401 | 403 | selon payload |
| `/api/admin/annual-courses` | 401 | 403 | 200 |
| `/api/admin/course-schedule` | 401 | 403 | 200 |
| `/api/admin/catalog` | 401 | 403 | 200 |
| `/api/admin/catalog?active=1` | 401 | 200 | 200 |

**Exception architecturale explicite** : `GET /api/admin/catalog?active=1` utilise `requireTeacherSession` pour alimenter la Configuration enseignant. Mutations et liste complète : `requireAdminSession`.

Contrôle **serveur** uniquement. L’UI n’est pas une autorité.

---

## Persistence et tables SQL (0001→0023)

Tables mutables incluses dans **backup v4** (`CAMPUS_BACKUP_INSERT_ORDER`) :

`teachers`, `classrooms`, `school_years`, `school_weeks`, `school_day_exceptions`, `subjects`, `memberships`, `membership_subjects`, `student_accesses`, `publication_templates`, `agenda_items`, `timetable_imports`, `timetable_slots`, `timetable_class_mappings`, `timetable_teacher_codes`, `school_branches`, `school_professions`, `pedagogical_contexts`, `admin_code_counters`, `school_classes`, `pedagogical_paths`, `annual_courses`, `teacher_course_assignments`, `teacher_course_assignment_events`, `annual_course_notes`, `course_schedule_slots`, `class_attendance_days`, `teacher_setups`, `teacher_notes`.

Memory : dump/restore des **29 tables**, y compris `publication_templates` et `timetable_*` (singletons Memory). SQLite/D1 : `SELECT *` de chaque table. Une table peut être `[]` ; elle ne peut pas être absente.

---

## Données demo / legacy runtime

| Usage | Statut |
| --- | --- |
| `sql/seed.ts`, tests, `DEMO_PROTOTYPE_ITEMS` | autorisé |
| `memory-legacy-school.ts` seedé depuis DEMO puis **mutable** | LEGACY ADAPTER |
| Login élève / session | plus de gate DEMO_CATALOG |
| Login enseignant | `displayName` depuis le compte, pas DEMO |
| `page.tsx` classes enseignant | API `/api/teacher/classrooms` prioritaire |
| `page.tsx` jours élève | `ClassAttendanceDay` si présents |
| Notebook / setup fallback / aperçu élève démo | DEMO_CATALOG **filet** documenté |

---

## Problèmes

### P0 CRITIQUE — corrigés

| # | Fichier | Cause | Conséquence | Correction | Tests |
| --- | --- | --- | --- | --- | --- |
| P0-1 | `web/app/api/admin/{backup,restore,memberships,timetable,school-year}/**` | `requireTeacherSession` | enseignant non admin : backup/restore/import | `requireAdminSession` | `admin-auth-matrix.test.ts` |
| P0-2 | `web/lib/server/api.ts` | session signée suffisait | compte désactivé/archivé ou accès élève révoqué restait utilisable | `revalidateLiveSession` | `admin-auth-matrix.test.ts` |
| P0-3 | `src/lib/auth/session.ts` | `JSON.parse` / base64 sans try | cookie corrompu → 500 | `parseSessionToken` → `null` | `admin-auth-matrix.test.ts` |
| P0-4 | `backup.ts` v3 | ~10 % des tables | restauration incomplète | backup v4 + validation + batch | `campus-backup-v4.test.ts` |
| P0-5 | `sql-agenda-store.ts` | `Math.max(ids)+1` | collision concurrente | `INSERT` sans id + `last_row_id` | `agenda-concurrency.test.ts` |
| P0-6 | `page.tsx`, login élève | DEMO_CATALOG comme vérité | classe hors démo cassée | catalogues runtime + accès mutable | `dynamic-schedule.test.ts` |

### P1 IMPORTANT — corrigés

| # | Fichier | Cause | Conséquence | Correction | Tests |
| --- | --- | --- | --- | --- | --- |
| P1-1 | `agenda/route.ts` vs `[id]` | POST 1..38 et day 0\|3 ; PATCH plus large | incohérence | `validateAgendaScheduleTarget` commun | `dynamic-schedule.test.ts` |
| P1-2 | `course-days.ts` | lundi + jeudi B | classe Mardi/Vendredi fausse | `ClassAttendanceDay` + slots | `dynamic-schedule.test.ts` |
| P1-3 | CI | `npm test` seul | types/lint absents | typecheck + lint + `npm ci` | workflow |
| P1-4 | publications | semaine 5 valide si 1..38 | semaines absentes du plan | comparaison à `year.weeks` | `dynamic-schedule.test.ts` |
| P1-5 | contrôles à venir élève | `listAllCourseDays` TMA | tests hors lun/jeu invisibles | créneau depuis semaine+dayIndex | `evaluations-coordination.test.ts` |
| P1-6 | `schedule-target.ts` | `ClassAttendanceDay` suffisait | publication sans `CourseScheduleSlot` | AnnualCourse résolu ⇒ slot obligatoire ; TMA seulement sans cours structuré | `dynamic-schedule.test.ts` A–E |

### P2 AMÉLIORATION — documentés, hors refonte

| # | Fichier | Cause | Conséquence | Correction | Tests |
| --- | --- | --- | --- | --- | --- |
| P2-1 | dual catalogue | `classrooms.id` ≠ `school_classes.id` | mapping par nom | non (compatibilité) | existants |
| P2-2 | `Date.now()+Math.random()` IDs catalogue/cours | burst collision théorique | IDs non SQLite | non | — |
| P2-3 | `sql-template-store` `Math.max` | IDs provisoires avant persist | persistItem ignore l’id | non (P2) | — |
| P2-4 | `publication_templates.default_day` CHECK (0,3) | schéma historique | modèles hors lun/jeu | **MIGRATION_REQUIRED** si élargi | — |
| P2-5 | `school_weeks.week_number` CHECK 1..38 | schéma | années ≠ 38 semaines | **MIGRATION_REQUIRED** | — |
| P2-6 | `page.tsx` / library / multi-year | DEMO_CATALOG filet UI | affichage démo si API vide | filet isolé | — |
| P2-7 | `teacherCanAccessClassroom` | memberships only | cours structurés sans membership | Agenda publish utilise déjà assignments | — |
| P2-8 | `listUpcomingTestsForTeacher` | TMA | vue enseignant historique | LEGACY | — |
| P2-9 | *(annulé)* | Les 38 erreurs TypeScript historiques sont **corrigées**. `npm run typecheck` = `tsc --noEmit` sur tout `web/`. `npm run lint` = eslint global. **0 erreur.** | — | — |

### P3 DETTE — non touchée volontairement

- Memory `createAgendaItem` `max+1` (single-process).
- Gros panels React (logique horaire déjà extraite en 2.25.2).
- Parsers PDF timetable (import futur).
- `ON DELETE CASCADE` existant sur `school_weeks` (migration 0003, **non modifié**).

Aucun `ON DELETE CASCADE` ajouté dans cette PR.

---

## Backup / restore v4

- `BACKUP_FORMAT_VERSION = 4`
- Admin uniquement, `Cache-Control: no-store`
- Logs : version, comptes d’éléments, `adminId`, succès/échec — **jamais** `passwordHash` / `accessCodeHash` / snapshot
- Empreintes dans le fichier : **SENSIBLE**
- **29 tables obligatoires** (`CAMPUS_BACKUP_INSERT_ORDER`) : chacune doit être un tableau présent (`[]` autorisé, `undefined` = restore refusé, aucune écriture)
- **Colonnes whitelistées** (`CAMPUS_BACKUP_COLUMNS`) : colonne inconnue / mal nommée ⇒ refus ; les `INSERT` n’utilisent que les colonnes du schéma, jamais `Object.keys(row)`
- **Booléens** : uniquement `0` / `1` et booléens JS `true` / `false`. Jamais `Boolean(value)` (`Boolean("0") === true`)
- **FK avant mutation** : une FK non nulle doit exister dans le snapshot, **même si la table parent est vide**
- Dates `YYYY-MM-DD`, IDs agenda uniques, **≥ 1 admin actif non archivé**
- SQLite/D1 : `db.batch` (BEGIN/COMMIT ou D1 batch) ; échec → base précédente
- Memory : dump/restore des 29 tables (templates + timetable inclus) ; snapshot précédent + restore inverse
- Lecture v1/v2/v3 conservée (`restoreAgendaSnapshot`)

---

## Sessions

TTL inchangé (8 h / 60 j). Révocation = revalidation compte/accès à chaque requête.

---

## Cycle de vie

Règles existantes conservées : année/classe/cours archivés → lecture seule côté services. Suppressions destructrices explicites, pas de cascade ajoutée. Historique assignments/events non auto-supprimé.

---

## Dates

Helpers date-only (`parseLocalDate` midi local). Pas de `new Date("YYYY-MM-DD").toISOString()` ajouté.

---

## CI / npm audit

CI : `npm ci` (racine + web), `npm run typecheck` (`tsc --noEmit` **global**, aucune liste SURFACE), `npm run lint` (eslint **global**), `npm test` (unitaires + vinext build + rendu/API + smoke preview).

TypeScript global : **0 erreur**. Lint global : **0 erreur**. Les scripts `typecheck-ci.mjs` / `lint-ci.mjs` (filtre de surface) sont **supprimés**.

`npm audit` (sans `--force`) :

- racine : 0 vulnérabilité
- `web/` : 11 vulnérabilités (1 low, 10 high), toutes en chaîne **dev** (vite 8.0.13, wrangler, vinext, react-server-dom-webpack, miniflare/undici/ws/sharp/image-size). Correctifs disponibles via montées de versions d’outillage, hors périmètre de cette PR.

---

## Hors périmètre confirmé

CourseOccurrence, CourseSession, dates réelles, compteur de séances, coordination V2, copie d’année, salles, drag & drop, parser PDF, nouveau design.
