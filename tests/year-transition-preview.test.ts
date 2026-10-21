import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
import { STRUCTURED_AGENDA_COMPAT_HOUR } from "../src/features/course-publications/index.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import type { ReferencePedagogicalPath, ReferenceSession } from "../src/features/pedagogical-path/types.ts";
import {
  YEAR_TRANSITION_AGENDA_COMPAT_HOUR,
  YEAR_TRANSITION_PREVIEW_REASONS,
  buildYearTransitionPreview,
  type YearTransitionPreviewInput,
} from "../src/features/year-transition/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";

const SOURCE_YEAR = "year-n";
const TARGET_YEAR = "year-n1";
const SOURCE_CLASS = "class-ma1a-n";
const TARGET_CLASS = "class-ma2a-n1";
const SOURCE_COURSE = "ac-source";
const TARGET_COURSE = "ac-target";
const CTX = "ctx-moteur-y1";
const ITEM_X = "item-X";
const SESS_P = "session-p";

function course(
  id: string,
  classId: string,
  schoolYearId: string,
  contextId = CTX,
  archived = false,
): AnnualCourse {
  return {
    id,
    schoolYearId,
    classId,
    contextId,
    isArchived: archived,
    archivedAt: archived ? "2027-08-01T00:00:00.000Z" : null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function session(patch: Partial<CourseSession> & Pick<CourseSession, "sequenceNumber" | "date" | "schoolWeekNumber">): CourseSession {
  const annualCourseId = patch.annualCourseId ?? TARGET_COURSE;
  const schoolYearId = patch.schoolYearId ?? TARGET_YEAR;
  const date = patch.date;
  return {
    key: patch.key ?? `${schoolYearId}|${annualCourseId}|${date}`,
    schoolYearId,
    annualCourseId,
    classId: patch.classId ?? TARGET_CLASS,
    contextId: patch.contextId ?? CTX,
    date,
    schoolWeekNumber: patch.schoolWeekNumber,
    weekKind: patch.weekKind ?? "A",
    dayOfWeek: patch.dayOfWeek ?? 1,
    sequenceNumber: patch.sequenceNumber,
    segments: patch.segments ?? [{ scheduleSlotId: "slot-1", periodStart: 2, periodEnd: 3 }],
  };
}

function pathFor(sessions: ReferenceSession[], contextId = CTX): ReferencePedagogicalPath {
  return {
    id: "path-1",
    contextId,
    sessions,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function refSession(
  id: string,
  position: number,
  items: Array<{ id: string; title?: string }>,
): ReferenceSession {
  return {
    id,
    position,
    label: `Séance ${position}`,
    items: items.map((item, index) => ({
      id: item.id,
      type: "HOMEWORK" as const,
      title: item.title ?? "Travail",
      detail: "Contenu",
      position: index + 1,
    })),
  };
}

function sourceItem(patch: Partial<PrototypeAgendaItem> = {}): PrototypeAgendaItem {
  return {
    id: patch.id ?? 10,
    classroomId: patch.classroomId ?? "classroom-n",
    subjectId: patch.subjectId ?? "subject-n",
    authorTeacherId: patch.authorTeacherId ?? "teacher-1",
    day: patch.day ?? 0,
    hour: patch.hour ?? 9,
    weekOffset: patch.weekOffset ?? 0,
    schoolWeekNumber: patch.schoolWeekNumber ?? 8,
    type: patch.type ?? "HOMEWORK",
    title: patch.title ?? "Travail historique",
    detail: patch.detail ?? "N",
    schoolYearId: patch.schoolYearId ?? SOURCE_YEAR,
    annualCourseId: patch.annualCourseId === undefined ? SOURCE_COURSE : patch.annualCourseId,
    courseSessionKey: patch.courseSessionKey ?? `${SOURCE_YEAR}|${SOURCE_COURSE}|2026-10-12`,
    courseSessionDate: patch.courseSessionDate ?? "2026-10-12",
    referenceSessionId: patch.referenceSessionId === undefined ? SESS_P : patch.referenceSessionId,
    referenceItemId: patch.referenceItemId === undefined ? ITEM_X : patch.referenceItemId,
    studentVisible: patch.studentVisible,
    templateId: patch.templateId ?? null,
  };
}

function baseInput(patch: Partial<YearTransitionPreviewInput> = {}): YearTransitionPreviewInput {
  return {
    sourceSchoolYearId: SOURCE_YEAR,
    targetSchoolYearId: TARGET_YEAR,
    classMappings: patch.classMappings ?? [{ sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS }],
    sourceCourses: patch.sourceCourses ?? [course(SOURCE_COURSE, SOURCE_CLASS, SOURCE_YEAR)],
    targetCourses: patch.targetCourses ?? [course(TARGET_COURSE, TARGET_CLASS, TARGET_YEAR)],
    sourceItems: patch.sourceItems ?? [sourceItem()],
    targetItems: patch.targetItems ?? [],
    pathSnapshots: patch.pathSnapshots ?? [
      pathFor([
        refSession("session-other", 1, [{ id: "item-other" }]),
        refSession(SESS_P, 2, [{ id: ITEM_X }]),
      ]),
    ],
    targetCourseSessions: patch.targetCourseSessions ?? [
      session({ sequenceNumber: 1, date: "2027-08-23", schoolWeekNumber: 1 }),
      session({ sequenceNumber: 2, date: "2027-09-27", schoolWeekNumber: 6 }),
    ],
    sourceCourseSessions: patch.sourceCourseSessions,
  };
}

function congruentTargetItem(patch: Partial<PrototypeAgendaItem> = {}): PrototypeAgendaItem {
  return sourceItem({
    id: 99,
    schoolYearId: TARGET_YEAR,
    annualCourseId: TARGET_COURSE,
    referenceItemId: ITEM_X,
    referenceSessionId: SESS_P,
    courseSessionKey: `${TARGET_YEAR}|${TARGET_COURSE}|2027-09-27`,
    courseSessionDate: "2027-09-27",
    schoolWeekNumber: 6,
    day: 0,
    hour: 8,
    ...patch,
  });
}

function projectable(input: YearTransitionPreviewInput = baseInput()) {
  const preview = buildYearTransitionPreview(input);
  assert.equal(preview.entries.length, 1);
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
  return preview.entries[0]!;
}

test("APP_VERSION inchangée — moteur PREVIEW 2.62.0", () => {
  assert.equal(APP_VERSION, "2.62.0");
  assert.equal(YEAR_TRANSITION_AGENDA_COMPAT_HOUR, STRUCTURED_AGENDA_COMPAT_HOUR);
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("PROJECTABLE"));
});

test("1 — placement N+1 dérivé uniquement de la CourseSession cible", () => {
  const entry = projectable();
  assert.equal(entry.proposedPlacement?.schoolWeekNumber, 6);
  assert.equal(entry.proposedPlacement?.courseSessionDate, "2027-09-27");
  assert.equal(entry.proposedPlacement?.courseSessionKey, `${TARGET_YEAR}|${TARGET_COURSE}|2027-09-27`);
  assert.equal(entry.proposedPlacement?.day, 0);
  assert.equal(entry.proposedPlacement?.hour, YEAR_TRANSITION_AGENDA_COMPAT_HOUR);
  assert.equal(entry.proposedPlacement?.sequenceNumber, 2);
  assert.equal(entry.proposedPlacement?.annualCourseId, TARGET_COURSE);
  assert.equal(entry.pedagogicalPosition, 2);
  assert.equal(entry.resolvedReferenceSessionId, SESS_P);
  assert.equal(entry.targetCourseSession?.schoolWeekNumber, 6);
  assert.notEqual(entry.proposedPlacement?.schoolWeekNumber, entry.sourceTemporal.schoolWeekNumber);
});

test("2 — semaine 8 en N → semaine 6 en N+1", () => {
  const entry = projectable();
  assert.equal(entry.sourceTemporal.schoolWeekNumber, 8);
  assert.equal(entry.proposedPlacement?.schoolWeekNumber, 6);
});

test("3 — modifier les champs temporels source sans changer les refs → même cible", () => {
  const original = projectable();
  const mutated = projectable(
    baseInput({
      sourceItems: [
        sourceItem({
          schoolWeekNumber: 38,
          day: 3,
          hour: 16,
          weekOffset: 2,
          courseSessionDate: "2026-01-01",
          courseSessionKey: "forged",
        }),
      ],
    }),
  );
  assert.deepEqual(mutated.proposedPlacement, original.proposedPlacement);
  assert.equal(mutated.proposedPlacement?.schoolWeekNumber, 6);
  assert.equal(mutated.sourceTemporal.schoolWeekNumber, 38);
});

test("hasard semaine 8 en N+1 : la valeur vient de la CourseSession, pas de la source", () => {
  const entry = projectable(
    baseInput({
      sourceItems: [sourceItem({ schoolWeekNumber: 3, day: 3, hour: 11 })],
      targetCourseSessions: [
        session({ sequenceNumber: 1, date: "2027-08-23", schoolWeekNumber: 1 }),
        session({ sequenceNumber: 2, date: "2027-10-18", schoolWeekNumber: 8, dayOfWeek: 3 }),
      ],
    }),
  );
  assert.equal(entry.sourceTemporal.schoolWeekNumber, 3);
  assert.equal(entry.proposedPlacement?.schoolWeekNumber, 8);
  assert.equal(entry.proposedPlacement?.courseSessionDate, "2027-10-18");
  assert.equal(entry.proposedPlacement?.day, 2);
  assert.notEqual(entry.proposedPlacement?.schoolWeekNumber, entry.sourceTemporal.schoolWeekNumber);
  assert.notEqual(entry.proposedPlacement?.day, entry.sourceTemporal.day);
});

test("4 — referenceSessionId seul rattache la publication à la position CTX", () => {
  const preview = buildYearTransitionPreview(
    baseInput({ sourceItems: [sourceItem({ referenceItemId: null, referenceSessionId: SESS_P })] }),
  );
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
  assert.equal(preview.entries[0]?.pedagogicalPosition, 2);
  assert.equal(preview.entries[0]?.resolvedReferenceSessionId, SESS_P);
});

test("5 — referenceItemId mort → orphelin", () => {
  const preview = buildYearTransitionPreview(
    baseInput({ sourceItems: [sourceItem({ referenceItemId: "item-gone" })] }),
  );
  assert.equal(preview.entries[0]?.reason, "ORPHAN_DEAD_REFERENCE_ITEM");
});

test("6 — référence valide mais pas de séance réelle N+1 → UNSCHEDULED", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      pathSnapshots: [pathFor([refSession(SESS_P, 9, [{ id: ITEM_X }])])],
      targetCourseSessions: [session({ sequenceNumber: 1, date: "2027-08-23", schoolWeekNumber: 1 })],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "UNSCHEDULED_REFERENCE_SESSION");
  assert.equal(preview.entries[0]?.pedagogicalPosition, 9);
  assert.equal(preview.entries[0]?.proposedPlacement, null);
});

test("7 — mapping classe absent → aucune inférence par code/label", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      classMappings: [],
      sourceCourses: [course(SOURCE_COURSE, SOURCE_CLASS, SOURCE_YEAR)],
      targetCourses: [course(TARGET_COURSE, "class-ma1a-n1", TARGET_YEAR)],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "CLASS_MAPPING_MISSING");
  assert.equal(preview.entries[0]?.targetClassId, null);
});

test("8 — continuité explicitement définie → projection possible", () => {
  const entry = projectable();
  assert.equal(entry.targetClassId, TARGET_CLASS);
  assert.equal(entry.targetAnnualCourseId, TARGET_COURSE);
  assert.equal(entry.reason, "PROJECTABLE");
});

test("9 — absence explicite de continuation → aucune projection", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      classMappings: [{ sourceClassId: SOURCE_CLASS, targetClassId: null }],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "CLASS_CONTINUATION_ABSENT");
  assert.equal(preview.entries[0]?.proposedPlacement, null);
  assert.deepEqual(preview.mappingSummary.noContinuation, [SOURCE_CLASS]);
});

test("0→1 nouvelle classe : aucun import automatique", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      classMappings: [
        { sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS },
        { sourceClassId: null, targetClassId: "class-new" },
      ],
    }),
  );
  assert.deepEqual(preview.mappingSummary.targetOnly, ["class-new"]);
  assert.equal(preview.entries.length, 1);
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
});

test("10 — split 1→2 → non supporté", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      classMappings: [
        { sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS },
        { sourceClassId: SOURCE_CLASS, targetClassId: "class-other" },
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "UNSUPPORTED_CLASS_MAPPING_CARDINALITY");
});

test("11 — merge 2→1 → non supporté", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      classMappings: [
        { sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS },
        { sourceClassId: "class-other-n", targetClassId: TARGET_CLASS },
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "UNSUPPORTED_CLASS_MAPPING_CARDINALITY");
});

test("12 — cours cible absent", () => {
  const preview = buildYearTransitionPreview(baseInput({ targetCourses: [] }));
  assert.equal(preview.entries[0]?.reason, "TARGET_COURSE_MISSING");
});

test("13 — cours cible ambigu", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      targetCourses: [
        course(TARGET_COURSE, TARGET_CLASS, TARGET_YEAR),
        course("ac-target-2", TARGET_CLASS, TARGET_YEAR),
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "TARGET_COURSE_AMBIGUOUS");
});

test("14 — élément déjà présent et conforme → ALREADY_PRESENT", () => {
  const preview = buildYearTransitionPreview(baseInput({ targetItems: [congruentTargetItem()] }));
  assert.equal(preview.entries[0]?.reason, "ALREADY_PRESENT");
  assert.equal(preview.entries[0]?.proposedPlacement, null);
  assert.equal(preview.entries[0]?.pedagogicalPosition, 2);
});

test("15 — doublon source de la même référence → conflit", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      sourceItems: [sourceItem({ id: 10 }), sourceItem({ id: 11, schoolWeekNumber: 9 })],
    }),
  );
  assert.equal(preview.entries.length, 2);
  assert.ok(preview.entries.every((entry) => entry.reason === "DUPLICATE_SOURCE_REFERENCE"));
});

test("16 — referenceSessionId historique changé → résolution par l’item + warning", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      sourceItems: [sourceItem({ referenceSessionId: "session-ancienne" })],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
  assert.deepEqual(preview.entries[0]?.warnings, ["REFERENCE_SESSION_CHANGED"]);
  assert.equal(preview.entries[0]?.resolvedReferenceSessionId, SESS_P);
  assert.equal(preview.entries[0]?.proposedPlacement?.schoolWeekNumber, 6);
});

test("item présent deux fois dans le snapshot → SNAPSHOT_REFERENCE_CONFLICT", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      pathSnapshots: [
        pathFor([
          refSession("sess-a", 1, [{ id: ITEM_X }]),
          refSession("sess-b", 2, [{ id: ITEM_X }]),
        ]),
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "SNAPSHOT_REFERENCE_CONFLICT");
  assert.equal(preview.entries[0]?.proposedPlacement, null);
});

test("position de séance invalide → INVALID_REFERENCE_SESSION_POSITION", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      pathSnapshots: [pathFor([refSession(SESS_P, 0, [{ id: ITEM_X }])])],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "INVALID_REFERENCE_SESSION_POSITION");
  assert.equal(preview.entries[0]?.proposedPlacement, null);
});

test("zéro CourseSession cible → UNSCHEDULED_REFERENCE_SESSION", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      pathSnapshots: [pathFor([refSession(SESS_P, 2, [{ id: ITEM_X }])])],
      targetCourseSessions: [session({ sequenceNumber: 1, date: "2027-08-23", schoolWeekNumber: 1 })],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "UNSCHEDULED_REFERENCE_SESSION");
});

test("plusieurs CourseSession cibles même sequenceNumber → TARGET_SESSION_AMBIGUOUS", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      targetCourseSessions: [
        session({ sequenceNumber: 2, date: "2027-09-27", schoolWeekNumber: 6, key: `${TARGET_YEAR}|${TARGET_COURSE}|2027-09-27` }),
        session({ sequenceNumber: 2, date: "2027-09-28", schoolWeekNumber: 6, key: `${TARGET_YEAR}|${TARGET_COURSE}|2027-09-28` }),
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "TARGET_SESSION_AMBIGUOUS");
  assert.equal(preview.entries[0]?.proposedPlacement, null);
  assert.equal(preview.entries[0]?.pedagogicalPosition, 2);
});

test("conflit de référence déjà en cible", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      targetItems: [
        sourceItem({ id: 80, schoolYearId: TARGET_YEAR, annualCourseId: TARGET_COURSE }),
        sourceItem({ id: 81, schoolYearId: TARGET_YEAR, annualCourseId: TARGET_COURSE }),
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "TARGET_REFERENCE_CONFLICT");
});

test("17 — deux exécutions avec les mêmes entrées → deepEqual", () => {
  const input = baseInput();
  assert.deepEqual(buildYearTransitionPreview(input), buildYearTransitionPreview(input));
});

test("18 — entrées non mutées", () => {
  const input = baseInput();
  const before = structuredClone(input);
  Object.freeze(input.classMappings);
  Object.freeze(input.sourceCourses);
  Object.freeze(input.targetCourses);
  Object.freeze(input.sourceItems);
  Object.freeze(input.pathSnapshots);
  Object.freeze(input.targetCourseSessions);
  buildYearTransitionPreview(input);
  assert.deepEqual(input, before);
});

test("19 — aucune valeur temporelle source n’est un fallback de placement", () => {
  const entry = projectable(
    baseInput({
      sourceItems: [
        sourceItem({
          schoolWeekNumber: 8,
          day: 3,
          hour: 15,
          weekOffset: 4,
          courseSessionDate: "2026-10-12",
          courseSessionKey: `${SOURCE_YEAR}|${SOURCE_COURSE}|2026-10-12`,
        }),
      ],
    }),
  );
  const proposed = entry.proposedPlacement!;
  assert.notEqual(proposed.schoolWeekNumber, 8);
  assert.notEqual(proposed.day, 3);
  assert.notEqual(proposed.hour, 15);
  assert.notEqual(proposed.courseSessionDate, "2026-10-12");
  assert.notEqual(proposed.courseSessionKey, `${SOURCE_YEAR}|${SOURCE_COURSE}|2026-10-12`);
  assert.equal(proposed.schoolWeekNumber, entry.targetCourseSession?.schoolWeekNumber);
  assert.equal(proposed.courseSessionDate, entry.targetCourseSession?.date);
  assert.equal(proposed.courseSessionKey, entry.targetCourseSession?.key);
});

test("20 — le moteur PREVIEW n’importe pas la duplication annuelle", async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = [
    "src/features/year-transition/preview.ts",
    "src/features/year-transition/types.ts",
    "src/features/year-transition/class-mapping.ts",
    "src/features/year-transition/fingerprint.ts",
    "src/features/year-transition/index.ts",
    "src/features/year-transition/reasons.ts",
  ];
  for (const file of files) {
    const source = await readFile(join(root, file), "utf8");
    assert.equal(source.includes("library/templates"), false, file);
    assert.equal(source.includes("DuplicatePreviousYear"), false, file);
  }
});

test("fingerprint déterministe et sensible au planning cible", () => {
  const first = buildYearTransitionPreview(baseInput());
  const again = buildYearTransitionPreview(baseInput());
  assert.equal(first.fingerprint, again.fingerprint);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  const shifted = buildYearTransitionPreview(
    baseInput({
      targetCourseSessions: [
        session({ sequenceNumber: 1, date: "2027-08-23", schoolWeekNumber: 1 }),
        session({ sequenceNumber: 2, date: "2027-10-04", schoolWeekNumber: 7 }),
      ],
    }),
  );
  assert.notEqual(shifted.fingerprint, first.fingerprint);
  assert.equal(shifted.entries[0]?.proposedPlacement?.schoolWeekNumber, 7);
});

test("publication hors année source ignorée", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      sourceItems: [sourceItem(), sourceItem({ id: 50, schoolYearId: TARGET_YEAR })],
    }),
  );
  assert.equal(preview.entries.length, 1);
  assert.equal(preview.entries[0]?.sourceAgendaItemId, 10);
});

function reverse<T>(items: readonly T[]): T[] {
  return [...items].reverse();
}

test("fingerprint et PREVIEW indépendants de l’ordre d’entrée", () => {
  const canonical = baseInput({
    sourceItems: [sourceItem({ id: 10 }), sourceItem({ id: 20, referenceItemId: "item-other" })],
    pathSnapshots: [
      pathFor([
        refSession("session-other", 1, [{ id: "item-other" }]),
        refSession(SESS_P, 2, [{ id: ITEM_X }]),
      ]),
      pathFor([refSession("session-ctx-other", 1, [{ id: "item-ctx-other" }])], "ctx-other"),
    ],
    classMappings: [
      { sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS },
      { sourceClassId: null, targetClassId: "class-new" },
    ],
    sourceCourses: [
      course(SOURCE_COURSE, SOURCE_CLASS, SOURCE_YEAR),
      course("ac-other-source", "class-other", SOURCE_YEAR, "ctx-other"),
    ],
    targetCourses: [
      course(TARGET_COURSE, TARGET_CLASS, TARGET_YEAR),
      course("ac-new", "class-new", TARGET_YEAR, "ctx-other"),
    ],
    targetItems: [
      sourceItem({ id: 70, schoolYearId: TARGET_YEAR, annualCourseId: "ac-new", referenceItemId: "item-z" }),
    ],
  });
  const shuffled: YearTransitionPreviewInput = {
    ...canonical,
    classMappings: reverse(canonical.classMappings),
    sourceCourses: reverse(canonical.sourceCourses),
    targetCourses: reverse(canonical.targetCourses),
    sourceItems: reverse(canonical.sourceItems),
    targetItems: reverse(canonical.targetItems),
    pathSnapshots: reverse(canonical.pathSnapshots),
    targetCourseSessions: reverse(canonical.targetCourseSessions),
  };
  const left = buildYearTransitionPreview(canonical);
  const right = buildYearTransitionPreview(shuffled);
  assert.equal(left.fingerprint, right.fingerprint);
  assert.deepEqual(left.entries, right.entries);
  assert.deepEqual(left.mappingSummary, right.mappingSummary);
  assert.deepEqual(left, right);
});

test("fingerprint — changements matériels", () => {
  const base = buildYearTransitionPreview(baseInput());
  const mutations: Array<[string, YearTransitionPreviewInput]> = [
    ["referenceItemId", baseInput({ sourceItems: [sourceItem({ referenceItemId: "item-other" })] })],
    ["title source", baseInput({ sourceItems: [sourceItem({ title: "Titre révisé" })] })],
    ["type source", baseInput({ sourceItems: [sourceItem({ type: "TEST" })] })],
    ["detail source", baseInput({ sourceItems: [sourceItem({ detail: "Autre détail" })] })],
    [
      "mapping classe",
      baseInput({
        classMappings: [{ sourceClassId: SOURCE_CLASS, targetClassId: "class-other-n1" }],
        targetCourses: [course(TARGET_COURSE, "class-other-n1", TARGET_YEAR)],
      }),
    ],
    ["AnnualCourse cible", baseInput({ targetCourses: [course("ac-other-target", TARGET_CLASS, TARGET_YEAR)] })],
    [
      "snapshot path",
      baseInput({
        pathSnapshots: [pathFor([refSession(SESS_P, 2, [{ id: ITEM_X, title: "Libellé parcours changé" }])])],
      }),
    ],
    [
      "position pédagogique",
      baseInput({
        pathSnapshots: [pathFor([refSession(SESS_P, 1, [{ id: ITEM_X }])])],
      }),
    ],
    [
      "planning cible",
      baseInput({
        targetCourseSessions: [
          session({ sequenceNumber: 1, date: "2027-08-23", schoolWeekNumber: 1 }),
          session({ sequenceNumber: 2, date: "2027-10-04", schoolWeekNumber: 7 }),
        ],
      }),
    ],
    [
      "item déjà en cible",
      baseInput({
        targetItems: [congruentTargetItem()],
      }),
    ],
  ];
  for (const [label, input] of mutations) {
    const mutated = buildYearTransitionPreview(input);
    assert.notEqual(mutated.fingerprint, base.fingerprint, label);
  }
});

test("fingerprint — champs temporels N exclus (diagnostics seulement)", () => {
  const base = buildYearTransitionPreview(baseInput());
  const temporal = buildYearTransitionPreview(
    baseInput({
      sourceItems: [
        sourceItem({
          schoolWeekNumber: 38,
          day: 3,
          hour: 16,
          weekOffset: 2,
          courseSessionDate: "2026-01-01",
        }),
      ],
    }),
  );
  assert.equal(temporal.fingerprint, base.fingerprint);
  assert.deepEqual(temporal.entries[0]?.proposedPlacement, base.entries[0]?.proposedPlacement);
  assert.equal(temporal.entries[0]?.reason, "PROJECTABLE");
});

test("aucun fallback heuristique si la référence structurée échoue", () => {
  const similarButUnmapped = buildYearTransitionPreview(
    baseInput({
      classMappings: [],
      sourceCourses: [course(SOURCE_COURSE, SOURCE_CLASS, SOURCE_YEAR)],
      targetCourses: [course(TARGET_COURSE, "class-same-code", TARGET_YEAR)],
      sourceItems: [
        sourceItem({
          title: "Travail",
          detail: "Contenu",
          type: "HOMEWORK",
          schoolWeekNumber: 6,
          day: 0,
        }),
      ],
    }),
  );
  assert.equal(similarButUnmapped.entries[0]?.reason, "CLASS_MAPPING_MISSING");
  assert.equal(similarButUnmapped.entries[0]?.proposedPlacement, null);

  const orphanSameTitle = buildYearTransitionPreview(
    baseInput({
      sourceItems: [
        sourceItem({
          referenceItemId: null,
          referenceSessionId: null,
          title: "Travail",
          detail: "Contenu",
          type: "HOMEWORK",
          schoolWeekNumber: 6,
        }),
      ],
    }),
  );
  assert.equal(orphanSameTitle.entries[0]?.reason, "ORPHAN_NO_REFERENCE_ITEM");
  assert.equal(orphanSameTitle.entries[0]?.proposedPlacement, null);

  const deadRefSameWeek = buildYearTransitionPreview(
    baseInput({
      sourceItems: [
        sourceItem({
          referenceItemId: "item-inconnu",
          title: "Travail",
          schoolWeekNumber: 6,
          day: 0,
        }),
      ],
    }),
  );
  assert.equal(deadRefSameWeek.entries[0]?.reason, "ORPHAN_DEAD_REFERENCE_ITEM");
  assert.equal(deadRefSameWeek.entries[0]?.proposedPlacement, null);
});

test("taxonomie — codes fail-closed", () => {
  assert.equal(
    (YEAR_TRANSITION_PREVIEW_REASONS as readonly string[]).includes("ORPHAN_DEAD_REFERENCE_SESSION"),
    false,
  );
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("SNAPSHOT_REFERENCE_CONFLICT"));
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("TARGET_SESSION_AMBIGUOUS"));
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("INVALID_REFERENCE_SESSION_POSITION"));
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("TARGET_EXISTING_DIVERGED"));
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("SOURCE_COURSE_MISSING"));
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("TARGET_COURSE_ARCHIVED"));
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("CLASS_MAPPING_CONFLICT"));
});

test("A — déjà présent sur la CourseSession attendue → ALREADY_PRESENT", () => {
  const preview = buildYearTransitionPreview(baseInput({ targetItems: [congruentTargetItem()] }));
  assert.equal(preview.entries[0]?.reason, "ALREADY_PRESENT");
});

test("B — déjà présent mais mauvaise CourseSession → TARGET_EXISTING_DIVERGED", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      targetItems: [
        congruentTargetItem({
          courseSessionKey: `${TARGET_YEAR}|${TARGET_COURSE}|2027-08-23`,
          courseSessionDate: "2027-08-23",
          schoolWeekNumber: 1,
        }),
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "TARGET_EXISTING_DIVERGED");
  assert.equal(preview.entries[0]?.proposedPlacement?.courseSessionDate, "2027-09-27");
  assert.equal(preview.entries[0]?.proposedPlacement?.schoolWeekNumber, 6);
});

test("C — déjà présent mais referenceItemId mort dans le snapshot → pas ALREADY_PRESENT", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      targetItems: [congruentTargetItem()],
      pathSnapshots: [pathFor([refSession("session-other", 1, [{ id: "item-other" }])])],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "ORPHAN_DEAD_REFERENCE_ITEM");
  assert.notEqual(preview.entries[0]?.reason, "ALREADY_PRESENT");
});

test("D — déjà présent, item déplacé vers une autre ReferenceSession → DIVERGED", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      targetItems: [congruentTargetItem()],
      pathSnapshots: [
        pathFor([
          refSession("session-moved", 1, [{ id: ITEM_X }]),
          refSession(SESS_P, 2, [{ id: "item-other" }]),
        ]),
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "TARGET_EXISTING_DIVERGED");
  assert.equal(preview.entries[0]?.resolvedReferenceSessionId, "session-moved");
  assert.equal(preview.entries[0]?.pedagogicalPosition, 1);
  assert.equal(preview.entries[0]?.proposedPlacement?.schoolWeekNumber, 1);
  assert.notEqual(preview.entries[0]?.reason, "ALREADY_PRESENT");
});

test("fingerprint — placement cible matériel", () => {
  const present = buildYearTransitionPreview(baseInput({ targetItems: [congruentTargetItem()] }));
  const movedKey = buildYearTransitionPreview(
    baseInput({
      targetItems: [
        congruentTargetItem({
          courseSessionKey: `${TARGET_YEAR}|${TARGET_COURSE}|2027-08-23`,
        }),
      ],
    }),
  );
  const movedDate = buildYearTransitionPreview(
    baseInput({
      targetItems: [congruentTargetItem({ courseSessionDate: "2027-08-23" })],
    }),
  );
  assert.notEqual(movedKey.fingerprint, present.fingerprint);
  assert.notEqual(movedDate.fingerprint, present.fingerprint);
});

test("annualCourseId source null → SOURCE_COURSE_MISSING", () => {
  const preview = buildYearTransitionPreview(
    baseInput({ sourceItems: [sourceItem({ annualCourseId: null })] }),
  );
  assert.equal(preview.entries[0]?.reason, "SOURCE_COURSE_MISSING");
});

test("annualCourseId source inconnu → SOURCE_COURSE_MISSING", () => {
  const preview = buildYearTransitionPreview(
    baseInput({ sourceItems: [sourceItem({ annualCourseId: "ac-inconnu" })] }),
  );
  assert.equal(preview.entries[0]?.reason, "SOURCE_COURSE_MISSING");
});

test("cours cible unique mais archivé → TARGET_COURSE_ARCHIVED", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      targetCourses: [course(TARGET_COURSE, TARGET_CLASS, TARGET_YEAR, CTX, true)],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "TARGET_COURSE_ARCHIVED");
  assert.equal(preview.entries[0]?.proposedPlacement, null);
});

test("mapping contradictoire 0→1 et 1→1 sur la même cible", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      classMappings: [
        { sourceClassId: null, targetClassId: TARGET_CLASS },
        { sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS },
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "CLASS_MAPPING_CONFLICT");
  assert.deepEqual(preview.mappingSummary.oneToOne, []);
  assert.deepEqual(preview.mappingSummary.targetOnly, []);
  assert.deepEqual(preview.mappingSummary.conflicts, [
    { targetClassId: TARGET_CLASS, sourceClassIds: [SOURCE_CLASS] },
  ]);
});

test("doublons identiques de mapping A→B normalisés sans conflit", () => {
  const preview = buildYearTransitionPreview(
    baseInput({
      classMappings: [
        { sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS },
        { sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS },
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
  assert.deepEqual(preview.mappingSummary.oneToOne, [
    { sourceClassId: SOURCE_CLASS, targetClassId: TARGET_CLASS },
  ]);
  assert.deepEqual(preview.mappingSummary.conflicts, []);
});

test("fingerprint — IDs de mapping trimés comme le moteur", () => {
  const plain = buildYearTransitionPreview(baseInput());
  const padded = buildYearTransitionPreview(
    baseInput({
      classMappings: [{ sourceClassId: ` ${SOURCE_CLASS} `, targetClassId: ` ${TARGET_CLASS} ` }],
    }),
  );
  assert.equal(padded.fingerprint, plain.fingerprint);
  assert.deepEqual(padded.entries, plain.entries);
});

test("classe à créer : mapping pending n’est pas une absence de continuation", () => {
  const pendingClass = "pending-class:class-ma1a-n";
  const pendingCourse = "pending-course:ac-source";
  const preview = buildYearTransitionPreview(
    baseInput({
      classMappings: [{ sourceClassId: SOURCE_CLASS, targetClassId: pendingClass }],
      targetCourses: [course(pendingCourse, pendingClass, TARGET_YEAR)],
      targetCourseSessions: [
        session({
          annualCourseId: pendingCourse,
          classId: pendingClass,
          sequenceNumber: 2,
          date: "2027-09-27",
          schoolWeekNumber: 6,
        }),
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
  assert.equal(preview.entries[0]?.targetClassId, pendingClass);
  assert.equal(preview.entries[0]?.targetAnnualCourseId, pendingCourse);
  assert.deepEqual(preview.mappingSummary.noContinuation, []);
});

test("publication Carnet : séance annuelle source → position CTX → séance cible", () => {
  const sourceKey = `${SOURCE_YEAR}|${SOURCE_COURSE}|2026-10-12`;
  const preview = buildYearTransitionPreview(
    baseInput({
      sourceItems: [
        sourceItem({
          referenceItemId: null,
          referenceSessionId: null,
          courseSessionKey: sourceKey,
        }),
      ],
      sourceCourseSessions: [
        session({
          schoolYearId: SOURCE_YEAR,
          annualCourseId: SOURCE_COURSE,
          classId: SOURCE_CLASS,
          sequenceNumber: 2,
          date: "2026-10-12",
          schoolWeekNumber: 8,
          key: sourceKey,
        }),
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
  assert.equal(preview.entries[0]?.sourceClassId, SOURCE_CLASS);
  assert.equal(preview.entries[0]?.referenceItemId, null);
  assert.equal(preview.entries[0]?.resolvedReferenceSessionId, SESS_P);
  assert.equal(preview.entries[0]?.pedagogicalPosition, 2);
  assert.equal(preview.entries[0]?.proposedPlacement?.courseSessionDate, "2027-09-27");
});
