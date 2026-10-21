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
import type { AnnualCourseNote } from "../src/features/pedagogical-path/annual-notes.ts";
import {
  YEAR_TRANSITION_AGENDA_COMPAT_HOUR,
  YEAR_TRANSITION_PREVIEW_REASONS,
  buildYearTransitionPreview,
  previewPrivateNotes,
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
          courseSessionKey: "",
          courseSessionDate: "",
          title: "Travail",
          detail: "Contenu",
          type: "HOMEWORK",
          schoolWeekNumber: 99,
          day: 4,
        }),
      ],
    }),
  );
  assert.equal(orphanSameTitle.entries[0]?.reason, "ORPHAN_NO_REFERENCE_ITEM");
  assert.equal(orphanSameTitle.entries[0]?.proposedPlacement, null);

  const staleKey = buildYearTransitionPreview(
    baseInput({
      sourceItems: [
        sourceItem({
          referenceItemId: null,
          referenceSessionId: null,
          courseSessionKey: `${SOURCE_YEAR}|${SOURCE_COURSE}|2026-10-12`,
          title: "Travail",
        }),
      ],
    }),
  );
  assert.equal(staleKey.entries[0]?.reason, "SOURCE_SESSION_UNRESOLVED");
  assert.equal(staleKey.entries[0]?.proposedPlacement, null);

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
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("SOURCE_SESSION_UNRESOLVED"));
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("PATH_ABSENT"));
  assert.ok(YEAR_TRANSITION_PREVIEW_REASONS.includes("PATH_POSITION_UNRESOLVED"));
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

function isoOnWeek(weekNumber: number, start: string): string {
  const [year, month, day] = start.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + (weekNumber - 1) * 7));
  return date.toISOString().slice(0, 10);
}

function annualSessions(
  schoolYearId: string,
  annualCourseId: string,
  classId: string,
  count: number,
  start: string,
): CourseSession[] {
  return Array.from({ length: count }, (_, index) => {
    const week = index + 1;
    const date = isoOnWeek(week, start);
    return session({
      schoolYearId,
      annualCourseId,
      classId,
      sequenceNumber: week,
      date,
      schoolWeekNumber: week,
      key: `${schoolYearId}|${annualCourseId}|${date}`,
    });
  });
}

function carnetItem(id: number, week: number, date: string): PrototypeAgendaItem {
  return sourceItem({
    id,
    referenceItemId: null,
    referenceSessionId: null,
    courseSessionKey: `${SOURCE_YEAR}|${SOURCE_COURSE}|${date}`,
    courseSessionDate: date,
    schoolWeekNumber: week,
  });
}

function privateNote(id: string, date: string, extras: Partial<AnnualCourseNote> = {}): AnnualCourseNote {
  return {
    id,
    schoolYearId: SOURCE_YEAR,
    classId: SOURCE_CLASS,
    contextId: CTX,
    referenceSessionId: null,
    authorTeacherId: "teacher-1",
    ownerTeacherId: "teacher-1",
    text: `Note ${id}`,
    body: null,
    courseSessionKey: `${SOURCE_YEAR}|${SOURCE_COURSE}|${date}`,
    legacyNoteId: null,
    notebookPosition: 0,
    sourceNoteId: null,
    sourceSchoolYearId: null,
    inheritedAt: null,
    annualCourseId: SOURCE_COURSE,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...extras,
  };
}

function partialYearInput(pathSessions: ReferenceSession[]) {
  const sourceSessions = annualSessions(SOURCE_YEAR, SOURCE_COURSE, SOURCE_CLASS, 36, "2026-08-17");
  const targetSessions = annualSessions(TARGET_YEAR, TARGET_COURSE, TARGET_CLASS, 36, "2027-08-23");
  const prepared = sourceSessions.slice(0, 10);
  return {
    sourceSessions,
    targetSessions,
    prepared,
    input: baseInput({
      sourceItems: prepared.map((entry, index) => carnetItem(index + 1, entry.sequenceNumber, entry.date)),
      sourceCourseSessions: sourceSessions,
      targetCourseSessions: targetSessions,
      pathSnapshots: pathSessions.length ? [pathFor(pathSessions)] : [],
    }),
  };
}

test("année partielle : 10 semaines préparées, parcours CTX partiel → éléments résolubles transférés", () => {
  const ctx = Array.from({ length: 8 }, (_, index) =>
    refSession(`sess-${index + 1}`, index + 1, [{ id: `item-${index + 1}` }]),
  );
  const { input, prepared, targetSessions } = partialYearInput(ctx);
  const preview = buildYearTransitionPreview(input);
  assert.equal(preview.entries.length, 10);
  assert.equal(preview.entries.every((entry) => entry.reason === "PROJECTABLE"), true);
  assert.equal(preview.entries.filter((entry) => entry.resolvedReferenceSessionId).length, 8);
  assert.equal(preview.entries[8]?.resolvedReferenceSessionId, null);
  assert.equal(preview.entries[9]?.resolvedReferenceSessionId, null);
  assert.equal(preview.entries[0]?.pedagogicalPosition, 1);
  assert.equal(preview.entries[9]?.pedagogicalPosition, 10);
  assert.equal(preview.entries[0]?.proposedPlacement?.courseSessionDate, targetSessions[0]?.date);
  assert.notEqual(preview.entries[0]?.proposedPlacement?.courseSessionDate, prepared[0]?.date);
  assert.equal(preview.entries[9]?.proposedPlacement?.sequenceNumber, 10);
});

test("parcours CTX totalement absent : les publications Carnet restent transférables", () => {
  const { input } = partialYearInput([]);
  const preview = buildYearTransitionPreview(input);
  assert.equal(preview.entries.every((entry) => entry.reason === "PROJECTABLE"), true);
  assert.equal(preview.entries.every((entry) => entry.resolvedReferenceSessionId == null), true);
  assert.equal(preview.entries[3]?.pedagogicalPosition, 4);
});

test("un élément dont la référence manque n’exclut pas les autres", () => {
  const ctx = Array.from({ length: 8 }, (_, index) =>
    refSession(`sess-${index + 1}`, index + 1, [{ id: `item-${index + 1}` }]),
  );
  const { input, sourceSessions, targetSessions } = partialYearInput(ctx);
  const preview = buildYearTransitionPreview(
    baseInput({
      ...input,
      sourceItems: [
        ...input.sourceItems,
        sourceItem({
          id: 50,
          referenceItemId: "item-disparu",
          referenceSessionId: "sess-disparu",
        }),
        carnetItem(51, 11, sourceSessions[10]!.date),
        sourceItem({
          id: 52,
          referenceItemId: null,
          referenceSessionId: null,
          courseSessionKey: `${SOURCE_YEAR}|${SOURCE_COURSE}|1999-01-01`,
          courseSessionDate: "1999-01-01",
          schoolWeekNumber: 99,
          day: 4,
        }),
        sourceItem({
          id: 53,
          referenceItemId: null,
          referenceSessionId: null,
          courseSessionKey: "",
          courseSessionDate: "",
          schoolWeekNumber: 99,
          day: 4,
        }),
      ],
      sourceCourseSessions: sourceSessions,
      targetCourseSessions: targetSessions,
    }),
  );
  const byId = new Map(preview.entries.map((entry) => [entry.sourceAgendaItemId, entry.reason]));
  assert.equal(byId.get(1), "PROJECTABLE");
  assert.equal(byId.get(10), "PROJECTABLE");
  assert.equal(byId.get(50), "ORPHAN_DEAD_REFERENCE_ITEM");
  assert.equal(byId.get(51), "PROJECTABLE");
  assert.equal(byId.get(52), "SOURCE_SESSION_UNRESOLVED");
  assert.equal(byId.get(53), "ORPHAN_NO_REFERENCE_ITEM");
});

test("publication structurée : parcours CTX absent ≠ position manquante", () => {
  const absent = buildYearTransitionPreview(
    baseInput({
      pathSnapshots: [],
      sourceItems: [sourceItem({ referenceItemId: ITEM_X })],
    }),
  );
  assert.equal(absent.entries[0]?.reason, "PATH_ABSENT");

  const missingPosition = buildYearTransitionPreview(
    baseInput({
      pathSnapshots: [pathFor([refSession("session-other", 1, [{ id: "item-other" }])])],
      sourceItems: [sourceItem({ referenceItemId: null, referenceSessionId: "sess-unknown" })],
    }),
  );
  assert.equal(missingPosition.entries[0]?.reason, "PATH_POSITION_UNRESOLVED");
});

test("publication Carnet : clé obsolète mais date encore valide → séance source", () => {
  const date = "2026-10-12";
  const preview = buildYearTransitionPreview(
    baseInput({
      sourceItems: [
        sourceItem({
          referenceItemId: null,
          referenceSessionId: null,
          courseSessionKey: "cle-obsolete",
          courseSessionDate: date,
        }),
      ],
      sourceCourseSessions: [
        session({
          schoolYearId: SOURCE_YEAR,
          annualCourseId: SOURCE_COURSE,
          classId: SOURCE_CLASS,
          sequenceNumber: 2,
          date,
          schoolWeekNumber: 8,
          key: `${SOURCE_YEAR}|${SOURCE_COURSE}|${date}`,
        }),
      ],
      pathSnapshots: [],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "PROJECTABLE");
  assert.equal(preview.entries[0]?.resolvedReferenceSessionId, null);
  assert.equal(preview.entries[0]?.pedagogicalPosition, 2);
  assert.equal(preview.entries[0]?.proposedPlacement?.courseSessionDate, "2027-09-27");
});

test("notes privées : année partielle et parcours CTX partiel", () => {
  const { input, sourceSessions, targetSessions } = partialYearInput(
    Array.from({ length: 8 }, (_, index) => refSession(`sess-${index + 1}`, index + 1, [{ id: `item-${index + 1}` }])),
  );
  const notes = sourceSessions.slice(0, 10).map((entry, index) => privateNote(`note-${index + 1}`, entry.date));
  const preview = previewPrivateNotes({
    ...input,
    includePrivateNotes: true,
    privateNotesOwnerTeacherId: "teacher-1",
    sourceNotes: [
      ...notes,
      privateNote("note-stale", "1999-01-01"),
      privateNote("note-orphan", "", { courseSessionKey: null }),
      privateNote("note-dead-ctx", sourceSessions[0]!.date, {
        id: "note-dead-ctx",
        courseSessionKey: null,
        referenceSessionId: "sess-inconnu",
      }),
    ],
    targetNotes: [],
  });
  const byId = new Map(preview.map((entry) => [entry.sourceNoteId, entry]));
  for (let index = 1; index <= 10; index += 1) {
    assert.equal(byId.get(`note-${index}`)?.reason, "PROJECTABLE");
    assert.equal(byId.get(`note-${index}`)?.courseSessionKey, targetSessions[index - 1]?.key);
  }
  assert.equal(byId.get("note-1")?.referenceSessionId, "sess-1");
  assert.equal(byId.get("note-9")?.referenceSessionId, null);
  assert.equal(byId.get("note-stale")?.reason, "SOURCE_SESSION_UNRESOLVED");
  assert.equal(byId.get("note-orphan")?.reason, "NO_REFERENCE");
  assert.equal(byId.get("note-dead-ctx")?.reason, "PATH_POSITION_UNRESOLVED");
});

test("notes privées : parcours CTX totalement absent, clé de séance suffisante", () => {
  const { input, sourceSessions, targetSessions } = partialYearInput([]);
  const preview = previewPrivateNotes({
    ...input,
    includePrivateNotes: true,
    privateNotesOwnerTeacherId: "teacher-1",
    sourceNotes: [
      ...sourceSessions.slice(0, 10).map((entry, index) => privateNote(`note-${index + 1}`, entry.date)),
      privateNote("note-ctx-only", "", {
        courseSessionKey: null,
        referenceSessionId: SESS_P,
      }),
    ],
    targetNotes: [],
  });
  const byId = new Map(preview.map((entry) => [entry.sourceNoteId, entry.reason]));
  assert.equal(preview.filter((entry) => entry.sourceNoteId.startsWith("note-") && entry.sourceNoteId !== "note-ctx-only")
    .every((entry) => entry.reason === "PROJECTABLE"), true);
  assert.equal(byId.get("note-1"), "PROJECTABLE");
  assert.equal(byId.get("note-ctx-only"), "PATH_ABSENT");
  assert.equal(preview.find((entry) => entry.sourceNoteId === "note-1")?.referenceSessionId, null);
  assert.equal(preview.find((entry) => entry.sourceNoteId === "note-1")?.courseSessionKey, targetSessions[0]?.key);
});

test("notes privées : déjà présente et source conservée conceptuellement", () => {
  const { input, sourceSessions, targetSessions } = partialYearInput([]);
  const source = privateNote("note-1", sourceSessions[0]!.date);
  const copy: AnnualCourseNote = {
    ...source,
    id: "copy-1",
    schoolYearId: TARGET_YEAR,
    classId: TARGET_CLASS,
    annualCourseId: TARGET_COURSE,
    courseSessionKey: targetSessions[0]!.key,
    sourceNoteId: "note-1",
    sourceSchoolYearId: SOURCE_YEAR,
    inheritedAt: "2027-03-01T00:00:00.000Z",
  };
  const preview = previewPrivateNotes({
    ...input,
    includePrivateNotes: true,
    privateNotesOwnerTeacherId: "teacher-1",
    sourceNotes: [source],
    targetNotes: [copy],
  });
  assert.equal(preview[0]?.reason, "ALREADY_PRESENT");
});

test("publication Carnet déjà présente sur la séance cible → ALREADY_PRESENT", () => {
  const sourceKey = `${SOURCE_YEAR}|${SOURCE_COURSE}|2026-10-12`;
  const preview = buildYearTransitionPreview(
    baseInput({
      sourceItems: [
        sourceItem({
          id: 10,
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
      pathSnapshots: [],
      targetItems: [
        {
          ...sourceItem({
            id: 99,
            schoolYearId: TARGET_YEAR,
            annualCourseId: TARGET_COURSE,
            referenceItemId: null,
            referenceSessionId: null,
            courseSessionKey: `${TARGET_YEAR}|${TARGET_COURSE}|2027-09-27`,
            courseSessionDate: "2027-09-27",
          }),
          sourceAgendaItemId: 10,
        },
      ],
    }),
  );
  assert.equal(preview.entries[0]?.reason, "ALREADY_PRESENT");
  assert.equal(preview.entries[0]?.proposedPlacement, null);
});

