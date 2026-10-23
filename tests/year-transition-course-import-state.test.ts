import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AnnualCourse } from "../src/features/annual-courses/types.ts";
import type { SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import {
  buildYearTransitionCourseImportStates,
  emptyMeetingDayDraft,
  meetingDayDraftFromPlanDays,
  meetingDayPlanLabel,
  sameMeetingDayDraft,
  sameMeetingDayPlan,
  type AppliedTransitionRecord,
} from "../src/features/year-transition/index.ts";

const N = "year-n";
const N1 = "year-n1";

function schoolClass(id: string, schoolYearId: string): SchoolClassRecord {
  return {
    id,
    code: "MA1A",
    label: "MA 1A",
    sortOrder: 1,
    isActive: true,
    schoolYearId,
    schoolYearLabel: schoolYearId,
    professionId: "prf",
    trainingYear: 1,
    parallelCode: "A",
    isArchived: false,
    archivedAt: null,
  };
}

function annualCourse(id: string, classId: string, schoolYearId: string, contextId = "ctx-inj"): AnnualCourse {
  return {
    id,
    schoolYearId,
    classId,
    contextId,
    isArchived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const SOURCE_COURSE = annualCourse("ac-n", "class-n", N);
const TARGET_COURSE = annualCourse("ac-n1", "class-n1", N1);

function applied(
  transitionId: string,
  appliedAt: string,
  plans?: AppliedTransitionRecord["snapshot"]["targetMeetingDayPlans"],
): AppliedTransitionRecord {
  return {
    transitionId,
    appliedAt,
    snapshot: {
      classMappings: [{ sourceClassId: "class-n", targetClassId: "pending-class:class-n" }],
      sourceCourses: [SOURCE_COURSE],
      selectedSourceClassIds: ["class-n"],
      selectedSourceAnnualCourseIds: ["ac-n"],
      ...(plans ? { targetMeetingDayPlans: plans } : {}),
    },
  };
}

const MONDAY = [{ dayOfWeek: 1 as const, weekKind: "all" as const, role: "PRIMARY" as const }];
const TUESDAY_THURSDAY_B = [
  { dayOfWeek: 4 as const, weekKind: "B" as const, role: "ADDITIONAL" as const },
  { dayOfWeek: 2 as const, weekKind: "all" as const, role: "PRIMARY" as const },
];

function build(options: {
  applied: AppliedTransitionRecord[];
  withTargetClass?: boolean;
  targetDays?: typeof MONDAY | typeof TUESDAY_THURSDAY_B;
}) {
  const withTarget = options.withTargetClass ?? true;
  return buildYearTransitionCourseImportStates({
    sourceSchoolYearId: N,
    targetSchoolYearId: N1,
    applied: options.applied,
    classes: [schoolClass("class-n", N), ...(withTarget ? [schoolClass("class-n1", N1)] : [])],
    courses: [SOURCE_COURSE, ...(withTarget ? [TARGET_COURSE] : [])],
    meetingDays: (options.targetDays ?? []).map((day) => ({ ...day, annualCourseId: TARGET_COURSE.id })),
  });
}

test("aucun APPLY → aucun cours importé", () => {
  assert.deepEqual(build({ applied: [] }), []);
});

test("cours hors sélection d’un APPLY → non importé", () => {
  const record = applied("t1", "2027-03-01T08:00:00.000Z", [{ sourceAnnualCourseId: "ac-n", days: MONDAY }]);
  record.snapshot.selectedSourceAnnualCourseIds = ["ac-autre"];
  assert.deepEqual(build({ applied: [record] }), []);
});

test("plan actuel lu sur le cours N+1, historique trié du premier au dernier", () => {
  const [state] = build({
    applied: [
      applied("t2", "2027-04-01T08:00:00.000Z", [{ sourceAnnualCourseId: "ac-n", days: TUESDAY_THURSDAY_B }]),
      applied("t1", "2027-03-01T08:00:00.000Z", [{ sourceAnnualCourseId: "ac-n", days: MONDAY }]),
    ],
    targetDays: TUESDAY_THURSDAY_B,
  });
  assert.ok(state);
  assert.equal(state.targetAnnualCourseId, TARGET_COURSE.id);
  assert.equal(state.currentPlanOrigin, "target-course");
  assert.deepEqual(state.currentPlan, [
    { dayOfWeek: 2, weekKind: "all", role: "PRIMARY" },
    { dayOfWeek: 4, weekKind: "B", role: "ADDITIONAL" },
  ]);
  assert.equal(state.matchesLastPreparation, true);
  assert.deepEqual(state.preparations.map((entry) => entry.transitionId), ["t1", "t2"]);
  assert.deepEqual(state.preparations[0]!.days, MONDAY);
});

test("jours N+1 différents du dernier plan → signalé, le plan enregistré fait foi", () => {
  const [state] = build({
    applied: [applied("t1", "2027-03-01T08:00:00.000Z", [{ sourceAnnualCourseId: "ac-n", days: MONDAY }])],
    targetDays: TUESDAY_THURSDAY_B,
  });
  assert.equal(state!.matchesLastPreparation, false);
  assert.equal(state!.currentPlan![0]!.dayOfWeek, 2);
});

test("cours N+1 introuvable → plan de la dernière préparation", () => {
  const [state] = build({
    applied: [applied("t1", "2027-03-01T08:00:00.000Z", [{ sourceAnnualCourseId: "ac-n", days: MONDAY }])],
    withTargetClass: false,
  });
  assert.equal(state!.targetAnnualCourseId, null);
  assert.equal(state!.currentPlanOrigin, "last-preparation");
  assert.deepEqual(state!.currentPlan, MONDAY);
});

test("APPLY legacy sans plan explicite → importé, plan non renseigné", () => {
  const [state] = build({ applied: [applied("legacy", "2027-03-01T08:00:00.000Z")] });
  assert.equal(state!.currentPlan, null);
  assert.equal(state!.currentPlanOrigin, null);
  assert.equal(state!.preparations[0]!.days, null);
  assert.equal(meetingDayPlanLabel(state!.currentPlan), "Plan de jours non renseigné");
});

test("brouillon UI : préremplissage, comparaison et libellé du plan", () => {
  const draft = meetingDayDraftFromPlanDays(TUESDAY_THURSDAY_B);
  assert.deepEqual(draft, { primaryDay: 2, primaryWeekKind: "all", additionalDay: 4, additionalWeekKind: "B" });
  assert.equal(meetingDayPlanLabel(TUESDAY_THURSDAY_B), "Mardi, chaque semaine · Jeudi, semaine B");
  assert.equal(sameMeetingDayDraft(draft, { ...draft }), true);
  assert.equal(sameMeetingDayDraft(draft, { ...draft, primaryDay: 1 }), false);
  assert.equal(
    sameMeetingDayDraft(
      { ...emptyMeetingDayDraft(), primaryDay: 1, additionalWeekKind: "A" },
      meetingDayDraftFromPlanDays(MONDAY),
    ),
    true,
    "le rythme d’un deuxième jour absent est ignoré",
  );
  assert.equal(sameMeetingDayPlan(MONDAY, MONDAY), true);
  assert.equal(sameMeetingDayPlan(MONDAY, null), false);
});

test("écran Jours des cours N+1 : statut par cours, déjà importé décoché par défaut", async () => {
  const panel = await readFile(new URL("../web/app/components/year-transition-prepare-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, />Non importé</);
  assert.match(panel, /<strong>Déjà importé<\/strong>/);
  assert.match(panel, /Plan actuel : \{meetingDayPlanLabel\(state\.currentPlan\)\}/);
  assert.match(panel, /Première préparation/);
  assert.match(panel, /Dernière préparation/);
  assert.match(panel, /useState<string\[\]>\(\[\]\);\n/);
  assert.match(panel, /importByCourseId\.has\(courseId\)\s*\?\s*includedImportedCourseIds\.includes\(courseId\)/);
  assert.match(panel, /Plan actuel conservé : rien ne sera modifié pour ce cours\./);
  assert.match(panel, /Plan identique à la préparation actuelle\./);
  const route = await readFile(new URL("../web/app/api/admin/year-transition/prepare/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireAdminSession/);
});
