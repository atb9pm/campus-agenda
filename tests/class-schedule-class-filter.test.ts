import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assignmentDisplayLabel,
  assignmentDisplayStatus,
  type TeacherCourseAssignment,
} from "../src/features/annual-courses/index.ts";
import {
  CLASS_SCHEDULE_ARCHIVED_MUTATION_REASON,
  CLASS_SCHEDULE_ARCHIVED_READ_ONLY_BANNER,
  CLASS_SCHEDULE_EMPTY_ACTIVE_MESSAGE,
  CLASS_SCHEDULE_HISTORY_CHECKBOX_LABEL,
  CLASS_SCHEDULE_INACTIVE_MUTATION_REASON,
  CLASS_SCHEDULE_INACTIVE_READ_ONLY_BANNER,
  DEFAULT_SHOW_INACTIVE_OR_ARCHIVED_CLASSES,
  classScheduleEmptyClassesMessage,
  classScheduleOptionLabel,
  classScheduleReadOnlyBanner,
  isClassScheduleWritable,
  listScheduleEditorClasses,
  resolveScheduleEditorClassId,
  scheduleEditorClassIdAfterYearChange,
  scheduleEditorStateAfterYearChange,
} from "../src/features/course-schedule/index.ts";
import {
  classLifecycleLabel,
  classLifecycleStatus,
  isOperationalSchoolClass,
} from "../src/features/school-catalog/class-lifecycle.ts";
import type { SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

const YEAR_ID = "year-2026";
const PREV_YEAR_ID = "year-2025";

function schoolClass(
  id: string,
  code: string,
  patch: Partial<SchoolClassRecord> = {},
): SchoolClassRecord {
  return {
    id,
    code,
    label: code,
    sortOrder: 10,
    isActive: true,
    schoolYearId: YEAR_ID,
    schoolYearLabel: "2026-2027",
    professionId: "prof-mma",
    trainingYear: 3,
    parallelCode: "A",
    isArchived: false,
    archivedAt: null,
    ...patch,
  };
}

const MA2 = schoolClass("sc-ma2", "MA2", {
  sortOrder: 2,
  isActive: false,
  isArchived: true,
  archivedAt: "2026-08-01T00:00:00.000Z",
});
const MA3A = schoolClass("sc-ma3a", "MA3A", { sortOrder: 3 });
const MA3B = schoolClass("sc-ma3b", "MA3B", { sortOrder: 4, isActive: false });
const MECAUTO3A = schoolClass("sc-mecauto3a", "MECAUTO3A", { sortOrder: 5 });
const MMA1A = schoolClass("sc-mma1a", "MMA1A", { sortOrder: 1, trainingYear: 1 });
const OTHER_YEAR = schoolClass("sc-other", "MA1A", {
  schoolYearId: PREV_YEAR_ID,
  schoolYearLabel: "2025-2026",
  sortOrder: 1,
});

const YEAR_CLASSES = [MA2, MA3A, MA3B, MECAUTO3A, MMA1A, OTHER_YEAR];

function visibleCodes(includeInactiveOrArchived: boolean, schoolYearId = YEAR_ID): string[] {
  return listScheduleEditorClasses({
    classes: YEAR_CLASSES,
    schoolYearId,
    includeInactiveOrArchived,
  }).map((entry) => entry.code);
}

test("version 2.39.0 — horaire : classes actives par défaut, pas de migration", async () => {
  assert.equal(APP_VERSION, "2.43.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  const [panel, helper, lifecycle, service] = await Promise.all([
    readFile(new URL("../web/app/components/class-schedule-admin-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-schedule/class-filter.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/school-catalog/class-lifecycle.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-schedule/service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /showInactiveOrArchivedClasses/);
  assert.match(panel, /DEFAULT_SHOW_INACTIVE_OR_ARCHIVED_CLASSES/);
  assert.match(panel, /listScheduleEditorClasses/);
  assert.match(panel, /classScheduleOptionLabel/);
  assert.match(panel, /classScheduleReadOnlyBanner/);
  assert.match(panel, /CLASS_SCHEDULE_HISTORY_CHECKBOX_LABEL/);
  assert.match(panel, /visibleClassIds/);
  assert.match(panel, /classScheduleEmptyClassesMessage/);
  assert.doesNotMatch(panel, /\(inactive\)/);
  assert.doesNotMatch(panel, /Classe inactive/);
  assert.doesNotMatch(panel, /isActive:\s*true/);
  assert.match(helper, /isOperationalSchoolClass/);
  assert.match(helper, /classLifecycleStatus/);
  assert.match(helper, /classLifecycleLabel/);
  assert.doesNotMatch(helper, /deleteClass|archiveClass|updateClass/);
  assert.match(lifecycle, /isOperationalSchoolClass/);
  assert.match(service, /CLASS_SCHEDULE_ARCHIVED_MUTATION_REASON/);
  assert.match(service, /CLASS_SCHEDULE_INACTIVE_MUTATION_REASON/);
  assert.match(service, /isOperationalSchoolClass/);
  assert.equal(DEFAULT_SHOW_INACTIVE_OR_ARCHIVED_CLASSES, false);
  assert.equal(CLASS_SCHEDULE_HISTORY_CHECKBOX_LABEL, "Afficher les classes inactives / archivées");
  assert.equal(CLASS_SCHEDULE_EMPTY_ACTIVE_MESSAGE, "Aucune classe active pour cette année scolaire.");
  assert.equal(CLASS_SCHEDULE_ARCHIVED_READ_ONLY_BANNER, "Classe archivée — lecture seule.");
  assert.equal(CLASS_SCHEDULE_INACTIVE_READ_ONLY_BANNER, "Classe désactivée — lecture seule.");
});

test("1 — classe active année sélectionnée → visible par défaut", () => {
  const codes = visibleCodes(false);
  assert.ok(codes.includes("MA3A"));
  assert.ok(codes.includes("MECAUTO3A"));
  assert.ok(codes.includes("MMA1A"));
  assert.equal(isOperationalSchoolClass(MA3A, YEAR_ID), true);
});

test("2 — classe désactivée → invisible par défaut", () => {
  assert.equal(isOperationalSchoolClass(MA3B, YEAR_ID), false);
  assert.equal(visibleCodes(false).includes("MA3B"), false);
});

test("3 — classe archivée → invisible par défaut", () => {
  assert.equal(isOperationalSchoolClass(MA2, YEAR_ID), false);
  assert.equal(visibleCodes(false).includes("MA2"), false);
});

test("4 — classe autre année → invisible", () => {
  assert.equal(visibleCodes(false).includes("MA1A"), false);
  assert.equal(visibleCodes(true).includes("MA1A"), false);
  assert.equal(isOperationalSchoolClass(OTHER_YEAR, YEAR_ID), false);
});

test("5 — historique décoché par défaut", () => {
  assert.equal(DEFAULT_SHOW_INACTIVE_OR_ARCHIVED_CLASSES, false);
});

test("6 — historique coché → classe désactivée visible", () => {
  assert.ok(visibleCodes(true).includes("MA3B"));
});

test("7 — historique coché → classe archivée visible", () => {
  assert.ok(visibleCodes(true).includes("MA2"));
});

test("8 — classe archivée affichée avec libellé français archivée", () => {
  assert.equal(classLifecycleStatus(MA2), "archived");
  assert.equal(classLifecycleLabel("archived"), "Archivée");
  assert.equal(classScheduleOptionLabel(MA2), "MA2 · archivée");
  assert.doesNotMatch(classScheduleOptionLabel(MA2), /désactivée/);
});

test("9 — classe désactivée affichée avec libellé français désactivée", () => {
  assert.equal(classLifecycleStatus(MA3B), "inactive");
  assert.equal(classLifecycleLabel("inactive"), "Désactivée");
  assert.equal(classScheduleOptionLabel(MA3B), "MA3B · désactivée");
});

test("10 — ne pas afficher inactive", () => {
  for (const entry of YEAR_CLASSES) {
    assert.doesNotMatch(classScheduleOptionLabel(entry), /inactive/);
  }
  assert.doesNotMatch(CLASS_SCHEDULE_INACTIVE_READ_ONLY_BANNER, /inactive/i);
  assert.equal(classScheduleOptionLabel(MA3A), "MA3A");
});

test("11 — classe archivée → lecture seule", () => {
  assert.equal(
    isClassScheduleWritable({
      classIsActive: MA2.isActive,
      classIsArchived: MA2.isArchived,
      yearStatus: "active",
    }),
    false,
  );
  assert.equal(
    classScheduleReadOnlyBanner({ yearStatus: "active", schoolClass: MA2 }),
    CLASS_SCHEDULE_ARCHIVED_READ_ONLY_BANNER,
  );
});

test("12 — classe désactivée → lecture seule", () => {
  assert.equal(
    isClassScheduleWritable({
      classIsActive: MA3B.isActive,
      classIsArchived: MA3B.isArchived,
      yearStatus: "active",
    }),
    false,
  );
  assert.equal(
    classScheduleReadOnlyBanner({ yearStatus: "active", schoolClass: MA3B }),
    CLASS_SCHEDULE_INACTIVE_READ_ONLY_BANNER,
  );
});

test("13 — classe active → horaire toujours modifiable", () => {
  assert.equal(
    isClassScheduleWritable({
      classIsActive: MA3A.isActive,
      classIsArchived: MA3A.isArchived,
      yearStatus: "active",
    }),
    true,
  );
  assert.equal(classScheduleReadOnlyBanner({ yearStatus: "active", schoolClass: MA3A }), null);
});

test("14 — changement d’année → ancienne sélection nettoyée", () => {
  const editor = scheduleEditorStateAfterYearChange(PREV_YEAR_ID);
  assert.equal(editor.selectedYearId, PREV_YEAR_ID);
  assert.equal(editor.selectedClassId, "");
  const nextId = scheduleEditorClassIdAfterYearChange({
    classes: YEAR_CLASSES,
    nextYearId: PREV_YEAR_ID,
    includeInactiveOrArchived: false,
  });
  assert.equal(nextId, OTHER_YEAR.id);
  assert.notEqual(nextId, MA3A.id);
});

test("15 — aucune classe active → état vide correct", () => {
  const onlyHistorical = [MA2, MA3B];
  const visible = listScheduleEditorClasses({
    classes: onlyHistorical,
    schoolYearId: YEAR_ID,
    includeInactiveOrArchived: false,
  });
  assert.deepEqual(visible, []);
  assert.equal(
    resolveScheduleEditorClassId({
      visibleClasses: visible,
      selectedClassId: MA3A.id,
      schoolYearId: YEAR_ID,
    }),
    "",
  );
  assert.equal(classScheduleEmptyClassesMessage(false), CLASS_SCHEDULE_EMPTY_ACTIVE_MESSAGE);
});

test("16 — serveur refuse toujours la modification d’une classe archivée", async () => {
  assert.equal(CLASS_SCHEDULE_ARCHIVED_MUTATION_REASON, "Cette classe est archivée (lecture seule).");
  const service = await readFile(
    new URL("../src/features/course-schedule/service.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /CLASS_SCHEDULE_ARCHIVED_MUTATION_REASON/);
  assert.equal(
    isClassScheduleWritable({
      classIsActive: false,
      classIsArchived: true,
      yearStatus: "active",
    }),
    false,
  );
});

test("17 — serveur refuse toujours la modification d’une classe désactivée", async () => {
  assert.equal(
    CLASS_SCHEDULE_INACTIVE_MUTATION_REASON,
    "Cette classe est désactivée. Aucun nouveau créneau opérationnel.",
  );
  const service = await readFile(
    new URL("../src/features/course-schedule/service.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /CLASS_SCHEDULE_INACTIVE_MUTATION_REASON/);
  assert.equal(
    isClassScheduleWritable({
      classIsActive: false,
      classIsArchived: false,
      yearStatus: "active",
    }),
    false,
  );
});

test("18 — PR67 non régressée", () => {
  const tca: TeacherCourseAssignment = {
    id: "tca-1",
    annualCourseId: "ac-1",
    teacherId: "teacher-1",
    role: "PRIMARY",
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
    createdByAdminId: "admin-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    endedAt: null,
    overrideReason: null,
    overrideByAdminId: null,
  };
  const archivedStatus = assignmentDisplayStatus(tca, {
    schoolClass: MA2,
    courseSchoolYearId: YEAR_ID,
    at: "2026-09-15T12:00:00.000Z",
  });
  assert.equal(assignmentDisplayLabel(archivedStatus), "Classe archivée");
  assert.notEqual(assignmentDisplayLabel(archivedStatus), "Active");
  assert.equal(isOperationalSchoolClass(MA2, YEAR_ID), false);
  assert.equal(isOperationalSchoolClass(MA3A, YEAR_ID), true);
});

test("19 — aucune donnée historique supprimée", async () => {
  const helper = await readFile(
    new URL("../src/features/course-schedule/class-filter.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(helper, /DELETE |drop table|archiveAnnualCourse|deleteClass/i);
  const withHistory = listScheduleEditorClasses({
    classes: YEAR_CLASSES,
    schoolYearId: YEAR_ID,
    includeInactiveOrArchived: true,
  });
  assert.equal(withHistory.length, 5);
  assert.ok(withHistory.some((entry) => entry.id === MA2.id));
  assert.ok(withHistory.some((entry) => entry.id === MA3B.id));
});

test("20 — aucune migration SQL", () => {
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0024_structured_agenda_bridge.sql");
  assert.equal(SQL_MIGRATION_FILES.includes("0025_class_schedule_filter.sql" as never), false);
});

test("cas réel 2026-2027 — défaut vs historique", () => {
  assert.deepEqual(visibleCodes(false), ["MMA1A", "MA3A", "MECAUTO3A"]);
  const historical = visibleCodes(true);
  assert.deepEqual(historical, ["MMA1A", "MA2", "MA3A", "MA3B", "MECAUTO3A"]);
  assert.equal(classScheduleOptionLabel(MA3B), "MA3B · désactivée");
  assert.equal(classScheduleOptionLabel(MA2), "MA2 · archivée");
});
