import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPublication } from "../src/features/agenda/publications.ts";
import {
  defaultStudentVisibleForCreate,
  isStudentVisible,
  isVisibleToStudent,
} from "../src/features/agenda/visibility.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { weekCarnetVisibility } from "../src/features/class-notebook/rich-agenda.ts";
import { duplicateItemsFromArchivedYear } from "../src/features/library/templates.ts";
import { getStudentAgendaItems } from "../src/features/student/agenda.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

function item(patch: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title" | "type">): PrototypeAgendaItem {
  return {
    classroomId: "classe-a",
    subjectId: "sub-1",
    authorTeacherId: "teacher-1",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 5,
    detail: "",
    ...patch,
  };
}

test("2.55.0 — brouillon / publié Carnet, migration 0030", async () => {
  assert.equal(APP_VERSION, "2.55.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0030_agenda_student_visible.sql");
  const migration = await readFile(new URL("../migrations/0030_agenda_student_visible.sql", import.meta.url), "utf8");
  assert.match(migration, /student_visible/);
  assert.match(migration, /DEFAULT 1/);

  const [panel, agendaGet, library] = await Promise.all([
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/pedagogical-library-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /Publier aux élèves/);
  assert.match(panel, /Repasser en brouillon/);
  assert.match(panel, /Visible aux élèves/);
  assert.match(panel, /Brouillon/);
  assert.match(panel, /Enregistrer et publier/);
  assert.match(panel, /Reprendre \{formatWeekColumnLabel/);
  assert.doesNotMatch(panel, /Copier depuis la semaine précédente/);
  assert.match(agendaGet, /isVisibleToStudent/);
  assert.match(agendaGet, /session\?\.kind === "student"/);
  assert.match(library, /brouillon/);
});

test("visibilité — lignes existantes visibles, Carnet nouveau en brouillon", () => {
  assert.equal(isStudentVisible({}), true);
  assert.equal(isStudentVisible({ studentVisible: true }), true);
  assert.equal(isStudentVisible({ studentVisible: false }), false);

  assert.equal(defaultStudentVisibleForCreate({ type: "HOMEWORK" }), false);
  assert.equal(defaultStudentVisibleForCreate({ type: "INFORMATION" }), false);
  assert.equal(defaultStudentVisibleForCreate({ type: "TEST" }), true);
  assert.equal(
    defaultStudentVisibleForCreate({
      type: "HOMEWORK",
      annualCourseId: "ac-1",
      courseSessionKey: "year|ac-1|2026-08-17",
    }),
    true,
  );
  assert.equal(defaultStudentVisibleForCreate({ type: "HOMEWORK", studentVisible: true }), true);
});

test("visibilité — l’élève ne voit pas un brouillon, voit un contrôle", () => {
  const homework = item({ id: 1, type: "HOMEWORK", title: "Réviser", studentVisible: false });
  const published = item({ id: 2, type: "HOMEWORK", title: "Poly", studentVisible: true });
  const legacy = item({ id: 3, type: "INFORMATION", title: "Ancien" });
  const testItem = item({ id: 4, type: "TEST", title: "Contrôle 1", studentVisible: false });

  assert.equal(isVisibleToStudent(homework), false);
  assert.equal(isVisibleToStudent(published), true);
  assert.equal(isVisibleToStudent(legacy), true);
  assert.equal(isVisibleToStudent(testItem), true);

  const visible = getStudentAgendaItems([homework, published, legacy, testItem], "classe-a");
  assert.deepEqual(
    visible.map((entry) => entry.id),
    [2, 3, 4],
  );
});

test("visibilité — colonne Carnet brouillon / publié / vide", () => {
  assert.equal(weekCarnetVisibility([]), "empty");
  assert.equal(
    weekCarnetVisibility([item({ id: 1, type: "HOMEWORK", title: "A", studentVisible: false })]),
    "draft",
  );
  assert.equal(
    weekCarnetVisibility([item({ id: 1, type: "HOMEWORK", title: "A", studentVisible: true })]),
    "published",
  );
  assert.equal(
    weekCarnetVisibility([item({ id: 8, type: "TEST", title: "Contrôle" })]),
    "empty",
  );
});

test("visibilité — reprise d’année : devoirs en brouillon, contrôles visibles", () => {
  const source: PrototypeAgendaItem[] = [
    item({ id: 10, type: "HOMEWORK", title: "Devoir N-1", schoolYearId: "year-old", studentVisible: true }),
    item({ id: 11, type: "TEST", title: "Contrôle N-1", schoolYearId: "year-old", studentVisible: true }),
  ];
  const result = duplicateItemsFromArchivedYear(
    source,
    [],
    { archivedSchoolYearId: "year-old", classroomId: "classe-a", alsoCreateTemplates: false },
    "teacher-1",
    "year-new",
    100,
    () => "tpl",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const homework = result.created.find((entry) => entry.type === "HOMEWORK");
  const control = result.created.find((entry) => entry.type === "TEST");
  assert.equal(homework?.studentVisible, false);
  assert.equal(control?.studentVisible, true);
  assert.equal(isVisibleToStudent(homework!), false);
});

test("visibilité — createPublication Carnet vs Mes cours", () => {
  const carnet = createPublication([], {
    id: 1,
    classroomId: "classe-a",
    subjectId: "sub-1",
    authorTeacherId: "teacher-1",
    day: 0,
    hour: 8,
    schoolWeekNumber: 4,
    type: "HOMEWORK",
    title: "Carnet",
    detail: "x",
  });
  assert.equal(carnet[0]?.studentVisible, false);

  const structured = createPublication([], {
    id: 2,
    classroomId: "classe-a",
    subjectId: "sub-1",
    authorTeacherId: "teacher-1",
    day: 0,
    hour: 8,
    schoolWeekNumber: 4,
    type: "HOMEWORK",
    title: "Mes cours",
    detail: "x",
    annualCourseId: "ac-1",
    courseSessionKey: "year|ac-1|2026-08-17",
  });
  assert.equal(structured[0]?.studentVisible, true);
});
