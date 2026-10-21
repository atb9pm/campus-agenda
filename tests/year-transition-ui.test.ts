import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bindPrivateNotesOwner,
  mappingIssueMessages,
  parseYearTransitionClassMappings,
  parseYearTransitionPreviewRequest,
  presentYearTransitionPreview,
  previewHasBlockingEntries,
  YEAR_TRANSITION_TRANSFER_CAPABILITIES,
} from "../src/features/year-transition/index.ts";
import type { YearTransitionPreviewResult } from "../src/features/year-transition/types.ts";
import type { YearTransitionCatalogLookups } from "../src/features/year-transition/presentation.ts";

const SOURCE_YEAR = {
  id: "year-n",
  label: "2026-2027",
  status: "active" as const,
  startsOn: "2026-08-17",
  endsOn: "2027-07-02",
  sourceFilename: null,
  importedAt: null,
  activatedAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const TARGET_YEAR = {
  ...SOURCE_YEAR,
  id: "year-n1",
  label: "2027-2028",
  status: "draft" as const,
  activatedAt: null,
};

test("les capacités affichées correspondent au moteur réel", () => {
  assert.equal(YEAR_TRANSITION_TRANSFER_CAPABILITIES.every((entry) => entry.available), true);
  const notes = YEAR_TRANSITION_TRANSFER_CAPABILITIES.find((entry) => entry.id === "privateNotes");
  assert.equal(notes?.defaultEnabled, false);
  assert.equal(notes?.ownerBound, true);
});

test("le propriétaire des notes privées vient de la session, jamais du corps", () => {
  const bound = bindPrivateNotesOwner({
    sessionTeacherId: "teacher-a",
    includePrivateNotes: true,
  });
  assert.deepEqual(bound, { includePrivateNotes: true, privateNotesOwnerTeacherId: "teacher-a" });
  assert.throws(
    () => bindPrivateNotesOwner({
      sessionTeacherId: "teacher-a",
      includePrivateNotes: true,
      requestedOwnerTeacherId: "teacher-b",
    }),
    /session connectée/,
  );
  assert.equal(
    bindPrivateNotesOwner({ sessionTeacherId: "teacher-a", includePrivateNotes: false }).includePrivateNotes,
    false,
  );
});

test("une requête d’aperçu refuse un propriétaire étranger même si les notes sont désactivées", () => {
  assert.throws(
    () => parseYearTransitionPreviewRequest({
      sourceSchoolYearId: "year-n",
      targetSchoolYearId: "year-n1",
      classMappings: [],
      includePrivateNotes: false,
      privateNotesOwnerTeacherId: "someone-else",
    }, "teacher-a"),
    /session connectée/,
  );
});

test("les correspondances manquantes ou contradictoires sont signalées sans invention", () => {
  const issues = mappingIssueMessages(
    [
      { sourceClassId: "class-a", targetClassId: "class-x" },
      { sourceClassId: "class-b", targetClassId: "class-x" },
    ],
    ["class-a", "class-b", "class-c"],
    (id) => id,
  );
  assert.ok(issues.some((issue) => issue.includes("class-c")));
  assert.ok(issues.some((issue) => issue.includes("non prise en charge") || issue.includes("contradictoire")));
});

test("parseYearTransitionClassMappings refuse une invention implicite", () => {
  assert.deepEqual(
    parseYearTransitionClassMappings([{ sourceClassId: "a", targetClassId: null }]),
    [{ sourceClassId: "a", targetClassId: null }],
  );
  assert.throws(() => parseYearTransitionClassMappings("auto"));
});

test("l’aperçu présenté n’expose pas le contenu des notes et classe les motifs", () => {
  const preview: YearTransitionPreviewResult = {
    sourceSchoolYearId: SOURCE_YEAR.id,
    targetSchoolYearId: TARGET_YEAR.id,
    fingerprint: "abc",
    mappingSummary: {
      oneToOne: [{ sourceClassId: "class-a", targetClassId: "class-b" }],
      noContinuation: [],
      targetOnly: [],
      conflicts: [],
      unsupported: [],
    },
    entries: [
      {
        reason: "PROJECTABLE",
        warnings: [],
        sourceAgendaItemId: 1,
        sourceAnnualCourseId: "ac-n",
        sourceClassId: "class-a",
        targetClassId: "class-b",
        targetAnnualCourseId: "ac-n1",
        referenceItemId: "ref-1",
        sourceReferenceSessionId: "sess",
        resolvedReferenceSessionId: "sess",
        pedagogicalPosition: 1,
        targetCourseSession: null,
        proposedPlacement: {
          schoolYearId: TARGET_YEAR.id,
          annualCourseId: "ac-n1",
          courseSessionKey: "k",
          courseSessionDate: "2027-08-23",
          schoolWeekNumber: 1,
          day: 1,
          hour: 8,
          sequenceNumber: 1,
        },
        sourceTemporal: {
          schoolWeekNumber: 1,
          day: 1,
          hour: 8,
          weekOffset: 0,
          courseSessionDate: "2026-08-24",
          courseSessionKey: "old",
        },
      },
      {
        reason: "ORPHAN_NO_REFERENCE_ITEM",
        warnings: [],
        sourceAgendaItemId: 2,
        sourceAnnualCourseId: "ac-n",
        sourceClassId: "class-a",
        targetClassId: "class-b",
        targetAnnualCourseId: null,
        referenceItemId: null,
        sourceReferenceSessionId: null,
        resolvedReferenceSessionId: null,
        pedagogicalPosition: null,
        targetCourseSession: null,
        proposedPlacement: null,
        sourceTemporal: {
          schoolWeekNumber: 2,
          day: 1,
          hour: 8,
          weekOffset: 0,
          courseSessionDate: null,
          courseSessionKey: null,
        },
      },
      {
        reason: "CLASS_MAPPING_CONFLICT",
        warnings: [],
        sourceAgendaItemId: 3,
        sourceAnnualCourseId: "ac-n",
        sourceClassId: "class-a",
        targetClassId: null,
        targetAnnualCourseId: null,
        referenceItemId: "ref-1",
        sourceReferenceSessionId: "sess",
        resolvedReferenceSessionId: null,
        pedagogicalPosition: null,
        targetCourseSession: null,
        proposedPlacement: null,
        sourceTemporal: {
          schoolWeekNumber: 1,
          day: 1,
          hour: 8,
          weekOffset: 0,
          courseSessionDate: null,
          courseSessionKey: null,
        },
      },
    ],
    privateNotes: [
      {
        sourceNoteId: "note-secret",
        sourceClassId: "class-a",
        reason: "NO_REFERENCE",
        targetAnnualCourseId: null,
        targetClassId: null,
        referenceSessionId: null,
        courseSessionKey: null,
      },
    ],
  };
  const lookups: YearTransitionCatalogLookups = {
    years: [SOURCE_YEAR, TARGET_YEAR],
    classes: [
      {
        id: "class-a",
        code: "MA1A",
        label: "Mécanicien 1A",
        schoolYearId: SOURCE_YEAR.id,
        schoolYearLabel: SOURCE_YEAR.label,
        professionId: null,
        trainingYear: 1,
        parallelCode: "A",
        sortOrder: 1,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
      {
        id: "class-b",
        code: "MA2A",
        label: "Mécanicien 2A",
        schoolYearId: TARGET_YEAR.id,
        schoolYearLabel: TARGET_YEAR.label,
        professionId: null,
        trainingYear: 2,
        parallelCode: "A",
        sortOrder: 1,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
    ],
    professions: [],
    contexts: [],
    branches: [],
    courses: [],
    items: [
      {
        id: 1,
        classroomId: "c",
        subjectId: "s",
        authorTeacherId: "t",
        day: 1,
        hour: 8,
        weekOffset: 0,
        schoolWeekNumber: 1,
        type: "HOMEWORK",
        title: "Série 12",
        detail: "Ne doit pas fuiter depuis une note",
      },
    ],
  };
  const presented = presentYearTransitionPreview(preview, lookups, [
    { sourceClassId: "class-a", targetClassId: "class-b" },
  ]);
  assert.equal(presented.publications.projectable.length, 1);
  assert.match(presented.publications.projectable[0]!.title, /Série 12/);
  assert.equal(presented.publications.excluded.length, 1);
  assert.equal(presented.publications.blocking.length, 1);
  assert.equal(presented.blocking, true);
  assert.equal(presented.notes?.excluded[0]?.title, "Note privée");
  assert.doesNotMatch(JSON.stringify(presented), /note-secret-body|Ne doit pas fuiter depuis une note/);
  assert.match(presented.notes?.excluded[0]?.explanation ?? "", /référence pédagogique/);
  assert.equal(previewHasBlockingEntries(preview), true);
});

test("l’aperçu affiche le jour ISO de la séance cible, pas l’index agenda", () => {
  const emptySummary: YearTransitionPreviewResult["mappingSummary"] = {
    oneToOne: [],
    noContinuation: [],
    targetOnly: [],
    conflicts: [],
    unsupported: [],
  };
  function projectable(id: number, day: number, date: string, sequenceNumber: number): YearTransitionPreviewResult["entries"][number] {
    return {
      reason: "PROJECTABLE",
      warnings: [],
      sourceAgendaItemId: id,
      sourceAnnualCourseId: "ac-n",
      sourceClassId: "class-a",
      targetClassId: "class-b",
      targetAnnualCourseId: "ac-n1",
      referenceItemId: null,
      sourceReferenceSessionId: null,
      resolvedReferenceSessionId: null,
      pedagogicalPosition: sequenceNumber,
      targetCourseSession: null,
      proposedPlacement: {
        schoolYearId: TARGET_YEAR.id,
        annualCourseId: "ac-n1",
        courseSessionKey: `k-${date}`,
        courseSessionDate: date,
        schoolWeekNumber: sequenceNumber,
        day,
        hour: 8,
        sequenceNumber,
      },
      sourceTemporal: {
        schoolWeekNumber: sequenceNumber,
        day,
        hour: 8,
        weekOffset: 0,
        courseSessionDate: date,
        courseSessionKey: `old-${date}`,
      },
    };
  }
  const presented = presentYearTransitionPreview(
    {
      sourceSchoolYearId: SOURCE_YEAR.id,
      targetSchoolYearId: TARGET_YEAR.id,
      fingerprint: "days",
      mappingSummary: emptySummary,
      entries: [
        projectable(1, 0, "2027-10-04", 7),
        projectable(2, 3, "2027-09-23", 6),
        projectable(3, 4, "2027-09-24", 8),
      ],
    },
    {
      years: [SOURCE_YEAR, TARGET_YEAR],
      classes: [],
      professions: [],
      contexts: [],
      branches: [],
      courses: [],
      items: [],
    },
  );
  const labels = presented.publications.projectable.map((row) => row.sessionLabel);
  assert.equal(labels[0], "Séance cible n° 7 · lundi 04.10.2027");
  assert.equal(labels[1], "Séance cible n° 6 · jeudi 23.09.2027");
  assert.equal(labels[2], "Séance cible n° 8 · vendredi 24.09.2027");
  assert.equal(labels.some((label) => label?.includes("jour 0")), false);
});

test("apply refuse l’absence de confirmation et les routes exigent une session admin", async () => {
  const { applyAuthorizedYearTransition } = await import("../src/features/year-transition/prepare.ts");
  await assert.rejects(
    applyAuthorizedYearTransition({ transitionId: "t1" }, "teacher-a", {} as never),
    /confirmation explicite/,
  );
  const files = [
    "web/app/api/admin/year-transition/prepare/route.ts",
    "web/app/api/admin/year-transition/preview/route.ts",
    "web/app/api/admin/year-transition/apply/route.ts",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /requireAdminSession/, file);
    assert.doesNotMatch(source, /privateNotesOwnerTeacherId:\s*body/);
  }
  const previewRoute = await readFile(new URL("../web/app/api/admin/year-transition/preview/route.ts", import.meta.url), "utf8");
  assert.match(previewRoute, /createAuthorizedYearTransitionPreview/);
  const applyRoute = await readFile(new URL("../web/app/api/admin/year-transition/apply/route.ts", import.meta.url), "utf8");
  assert.match(applyRoute, /applyAuthorizedYearTransition/);
  const panel = await readFile(new URL("../web/app/components/year-transition-prepare-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /ConfirmDialog/);
  assert.match(panel, /includePrivateNotes/);
  assert.match(panel, /selectedSourceClassIds/);
  assert.match(panel, /reprendre/);
  assert.match(panel, /Consulter l’année préparée/);
  assert.doesNotMatch(panel, /Pas de continuation/);
  const admin = await readFile(new URL("../web/app/components/administration-panel.tsx", import.meta.url), "utf8");
  assert.match(admin, /Préparer l’année suivante/);
  const schoolYearAdmin = await readFile(
    new URL("../web/app/components/school-year-admin-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(schoolYearAdmin, /Consulter les cours de cette année/);
  assert.match(schoolYearAdmin, /Activer /);
  assert.match(schoolYearAdmin, /Réactiver /);
  assert.match(schoolYearAdmin, /Année active actuelle/);
  assert.match(schoolYearAdmin, /schoolYearActivationWeekIssue/);
  const activateRoute = await readFile(
    new URL("../web/app/api/admin/school-year/activate/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(activateRoute, /confirm !== true/);
  const coursesRoute = await readFile(new URL("../web/app/api/teacher/courses/route.ts", import.meta.url), "utf8");
  assert.match(coursesRoute, /consult/);
  assert.match(coursesRoute, /adminConsult/);
});
