import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bindPrivateNotesOwner,
  buildTargetMeetingDayPlans,
  emptyMeetingDayDraft,
  mappingIssueMessages,
  parseYearTransitionClassMappings,
  parseYearTransitionPreviewRequest,
  presentYearTransitionPreview,
  previewHasBlockingEntries,
  validateMeetingDayDraft,
  yearTransitionConfigSignature,
  YEAR_TRANSITION_ADDITIONAL_SAME_DAY,
  YEAR_TRANSITION_PRIMARY_DAY_REQUIRED,
  YEAR_TRANSITION_RECLASSIFY_HUMAN_EXPLANATION,
  YEAR_TRANSITION_TRANSFER_CAPABILITIES,
  YEAR_TRANSITION_WEEK_KIND_UI_LABELS,
} from "../src/features/year-transition/index.ts";
import type { MeetingDayDraft } from "../src/features/year-transition/meeting-day-draft.ts";
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
  assert.equal(notes?.defaultEnabled, true);
  assert.equal(notes?.ownerBound, false);
  assert.match(notes?.summary ?? "", /automatiquement/);
  assert.equal(YEAR_TRANSITION_WEEK_KIND_UI_LABELS.all, "Chaque semaine");
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
    "web/app/api/admin/year-transition/reclassify/route.ts",
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
  assert.match(panel, /selectedSourceClassIds/);
  assert.match(panel, /selectedSourceAnnualCourseIds/);
  assert.match(panel, /targetMeetingDayPlans/);
  assert.match(panel, /reprendre/);
  assert.match(panel, /Jour principal/);
  assert.match(panel, /Deuxième jour/);
  assert.match(panel, /YEAR_TRANSITION_WEEK_KIND_OPTIONS/);
  assert.match(panel, /Choisissez le jour principal/);
  const meetingDayDraft = await readFile(
    new URL("../src/features/year-transition/meeting-day-draft.ts", import.meta.url),
    "utf8",
  );
  assert.match(meetingDayDraft, /Chaque semaine/);
  assert.match(meetingDayDraft, /Semaine A/);
  assert.match(meetingDayDraft, /Semaine B/);
  assert.doesNotMatch(meetingDayDraft, /Toutes les semaines/);
  assert.match(panel, /La configuration a changé/);
  assert.match(panel, /Actualisez l’aperçu/);
  assert.match(panel, /élément perdu/);
  assert.match(panel, /À reclasser/);
  assert.match(panel, /Reclasser les/);
  assert.match(panel, /Tous les éléments transférés sont positionnés/);
  assert.match(panel, /YearTransitionReclassifyPanel/);
  assert.match(panel, /queueMicrotask/);
  assert.match(panel, /Attributions des cours/);
  assert.match(panel, /Horaire des classes/);
  assert.match(panel, /Consulter l’année préparée/);
  assert.match(panel, /Cinq étapes/);
  assert.doesNotMatch(panel, /Quatre étapes/);
  assert.match(panel, /includePrivateNotes: true/);
  assert.doesNotMatch(panel, /Inclure mes notes privées/);
  assert.doesNotMatch(panel, /notes privées du professeur/);
  assert.doesNotMatch(panel, /Copier mes notes/);
  assert.doesNotMatch(panel, /Pas de continuation/);
  assert.doesNotMatch(panel, /ClassAttendanceDay/);
  assert.doesNotMatch(panel, /\bP1\b/);
  assert.doesNotMatch(panel, /\bP2\b/);
  assert.doesNotMatch(panel, /identique à l’année précédente|reprendre l’horaire|conserver les jours/);
  assert.doesNotMatch(panel, /<option[^>]*>all<\/option>/);
  assert.doesNotMatch(panel, /SOURCE_SESSION_UNRESOLVED|PATH_ABSENT|TO_RECLASSIFY/);
  assert.doesNotMatch(panel, /"options"/);
  assert.match(panel, /"days"/);
  const admin = await readFile(new URL("../web/app/components/administration-panel.tsx", import.meta.url), "utf8");
  assert.match(admin, /Préparer l’année suivante/);
  assert.match(admin, /onOpenAdminTab/);
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

test("APPLY : 0 perdu affiche ✓ ok, des pertes affichent ⚠ warn", async () => {
  const panel = await readFile(new URL("../web/app/components/year-transition-prepare-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /const lostCount = resultTotals\?\.lost \?\? 0/);
  assert.match(
    panel,
    /<li className=\{lostCount > 0 \? "warn" : "ok"\}>\s*\{lostCount > 0 \? "⚠ " : "✓ "\}\s*\{frenchCount\(lostCount, "élément perdu", "éléments perdus"\)\}/,
  );
  assert.doesNotMatch(panel, /frenchCount\(resultTotals\?\.lost \?\? 0, "élément perdu"/);
});

function draft(patch: Partial<MeetingDayDraft>): MeetingDayDraft {
  return { ...emptyMeetingDayDraft(), ...patch };
}

test("la saisie MeetingDays n’est jamais préremplie depuis N", () => {
  const blank = emptyMeetingDayDraft();
  assert.equal(blank.primaryDay, null);
  assert.equal(blank.additionalDay, null);
  assert.equal(blank.primaryWeekKind, "all");
  assert.deepEqual(validateMeetingDayDraft(blank), {
    ok: false,
    reason: YEAR_TRANSITION_PRIMARY_DAY_REQUIRED,
  });
});

test("jour principal obligatoire et rythmes all / A / B autorisés sur PRIMARY", () => {
  assert.equal(validateMeetingDayDraft(draft({ primaryDay: 1, primaryWeekKind: "all" })).ok, true);
  assert.equal(validateMeetingDayDraft(draft({ primaryDay: 4, primaryWeekKind: "B" })).ok, true);
  assert.equal(validateMeetingDayDraft(draft({ primaryDay: 2, primaryWeekKind: "A" })).ok, true);
});

test("deuxième jour facultatif, distinct, avec rythme propre", () => {
  const withSecond = draft({
    primaryDay: 1,
    primaryWeekKind: "all",
    additionalDay: 4,
    additionalWeekKind: "B",
  });
  assert.equal(validateMeetingDayDraft(withSecond).ok, true);
  assert.deepEqual(validateMeetingDayDraft(draft({ primaryDay: 1, additionalDay: 1 })), {
    ok: false,
    reason: YEAR_TRANSITION_ADDITIONAL_SAME_DAY,
  });
});

test("un cours non sélectionné n’envoie aucun plan ; deux cours d’une classe ont des plans indépendants", () => {
  const electro = "ac-cp1-electro";
  const transmission = "ac-cp2-trans";
  const chassis = "ac-cp3-chassis";
  const injection = "ac-cp-injection";
  const drafts: Record<string, MeetingDayDraft> = {
    [electro]: draft({ primaryDay: 1, primaryWeekKind: "all" }),
    [transmission]: draft({ primaryDay: 2, primaryWeekKind: "all" }),
    [chassis]: draft({ primaryDay: 4, primaryWeekKind: "B" }),
    [injection]: draft({
      primaryDay: 1,
      primaryWeekKind: "all",
      additionalDay: 4,
      additionalWeekKind: "B",
    }),
  };
  const omitted = buildTargetMeetingDayPlans([electro, chassis, injection], drafts);
  assert.equal(omitted.ok, true);
  if (!omitted.ok) return;
  assert.equal(omitted.plans.some((plan) => plan.sourceAnnualCourseId === transmission), false);
  assert.deepEqual(
    omitted.plans.map((plan) => plan.sourceAnnualCourseId).sort(),
    [electro, chassis, injection].sort(),
  );

  const four = buildTargetMeetingDayPlans([electro, transmission, chassis, injection], drafts);
  assert.equal(four.ok, true);
  if (!four.ok) return;
  assert.deepEqual(four.plans.find((plan) => plan.sourceAnnualCourseId === electro)?.days, [
    { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
  ]);
  assert.deepEqual(four.plans.find((plan) => plan.sourceAnnualCourseId === transmission)?.days, [
    { dayOfWeek: 2, weekKind: "all", role: "PRIMARY" },
  ]);
  assert.deepEqual(four.plans.find((plan) => plan.sourceAnnualCourseId === chassis)?.days, [
    { dayOfWeek: 4, weekKind: "B", role: "PRIMARY" },
  ]);
  assert.deepEqual(four.plans.find((plan) => plan.sourceAnnualCourseId === injection)?.days, [
    { dayOfWeek: 1, weekKind: "all", role: "PRIMARY" },
    { dayOfWeek: 4, weekKind: "B", role: "ADDITIONAL" },
  ]);
});

test("PREVIEW est refusé côté UI si un plan manque, et le payload porte les sourceAnnualCourseId", () => {
  const missing = buildTargetMeetingDayPlans(
    ["ac-1", "ac-2"],
    { "ac-1": draft({ primaryDay: 1 }) },
  );
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.errors["ac-2"], YEAR_TRANSITION_PRIMARY_DAY_REQUIRED);

  const parsed = parseYearTransitionPreviewRequest({
    sourceSchoolYearId: "year-n",
    targetSchoolYearId: "year-n1",
    selectedSourceClassIds: ["class-a"],
    selectedSourceAnnualCourseIds: ["ac-cp1-electro"],
    includePrivateNotes: false,
    targetMeetingDayPlans: [
      {
        sourceAnnualCourseId: "ac-cp1-electro",
        days: [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
      },
    ],
  }, "teacher-a");
  assert.equal(parsed.includePrivateNotes, true);
  assert.equal(parsed.privateNotesOwnerTeacherId, undefined);
  assert.deepEqual(parsed.selectedSourceAnnualCourseIds, ["ac-cp1-electro"]);
  assert.deepEqual(parsed.targetMeetingDayPlans, [
    {
      sourceAnnualCourseId: "ac-cp1-electro",
      days: [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
    },
  ]);

  const withoutTeacher = parseYearTransitionPreviewRequest({
    sourceSchoolYearId: "year-n",
    targetSchoolYearId: "year-n1",
    selectedSourceClassIds: ["class-a"],
    selectedSourceAnnualCourseIds: ["ac-cp1-electro"],
    targetMeetingDayPlans: [
      {
        sourceAnnualCourseId: "ac-cp1-electro",
        days: [{ dayOfWeek: 1, weekKind: "all", role: "PRIMARY" }],
      },
    ],
  }, "");
  assert.equal(withoutTeacher.includePrivateNotes, true);
  assert.equal(withoutTeacher.privateNotesOwnerTeacherId, undefined);

  assert.throws(
    () => parseYearTransitionPreviewRequest({
      sourceSchoolYearId: "year-n",
      targetSchoolYearId: "year-n1",
      classMappings: [],
      includePrivateNotes: true,
    }, ""),
    /Session enseignant requise/,
  );
});

test("une modification de jour invalide l’empreinte d’aperçu jusqu’au prochain calcul", () => {
  const first = yearTransitionConfigSignature({
    sourceSchoolYearId: "year-n",
    targetSchoolYearId: "year-n1",
    selectedSourceClassIds: ["class-a"],
    selectedSourceAnnualCourseIds: ["ac-1"],
    drafts: { "ac-1": draft({ primaryDay: 1, primaryWeekKind: "all" }) },
  });
  const changedDay = yearTransitionConfigSignature({
    sourceSchoolYearId: "year-n",
    targetSchoolYearId: "year-n1",
    selectedSourceClassIds: ["class-a"],
    selectedSourceAnnualCourseIds: ["ac-1"],
    drafts: { "ac-1": draft({ primaryDay: 4, primaryWeekKind: "B" }) },
  });
  const changedSelection = yearTransitionConfigSignature({
    sourceSchoolYearId: "year-n",
    targetSchoolYearId: "year-n1",
    selectedSourceClassIds: ["class-a"],
    selectedSourceAnnualCourseIds: [],
    drafts: { "ac-1": draft({ primaryDay: 1, primaryWeekKind: "all" }) },
  });
  assert.notEqual(first, changedDay);
  assert.notEqual(first, changedSelection);
  assert.equal(
    first,
    yearTransitionConfigSignature({
      sourceSchoolYearId: "year-n",
      targetSchoolYearId: "year-n1",
      selectedSourceClassIds: ["class-a"],
      selectedSourceAnnualCourseIds: ["ac-1"],
      drafts: { "ac-1": draft({ primaryDay: 1, primaryWeekKind: "all" }) },
    }),
  );
});

test("l’aperçu présente À reclasser comme avertissement humain, sans code technique ni texte de note", () => {
  const preview: YearTransitionPreviewResult = {
    sourceSchoolYearId: SOURCE_YEAR.id,
    targetSchoolYearId: TARGET_YEAR.id,
    fingerprint: "reclass",
    mappingSummary: {
      oneToOne: [{ sourceClassId: "class-a", targetClassId: "class-b" }],
      noContinuation: [],
      targetOnly: [],
      conflicts: [],
      unsupported: [],
    },
    entries: [
      {
        reason: "SOURCE_SESSION_UNRESOLVED",
        disposition: "TO_RECLASSIFY",
        warnings: [],
        sourceAgendaItemId: 1,
        sourceAnnualCourseId: "ac-n",
        sourceClassId: "class-a",
        targetClassId: "class-b",
        targetAnnualCourseId: "ac-n1",
        referenceItemId: null,
        sourceReferenceSessionId: null,
        resolvedReferenceSessionId: null,
        pedagogicalPosition: null,
        targetCourseSession: null,
        proposedPlacement: null,
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
        reason: "PROJECTABLE",
        warnings: [],
        sourceAgendaItemId: 2,
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
    ],
    privateNotes: [
      {
        sourceNoteId: "note-secret",
        sourceClassId: "class-a",
        reason: "TARGET_SESSION_UNRESOLVED",
        disposition: "TO_RECLASSIFY",
        targetAnnualCourseId: "ac-n1",
        targetClassId: "class-b",
        referenceSessionId: null,
        courseSessionKey: null,
      },
    ],
  };
  const presented = presentYearTransitionPreview(
    preview,
    {
      years: [SOURCE_YEAR, TARGET_YEAR],
      classes: [
        {
          id: "class-a",
          code: "MECAUTO3A",
          label: "Mécanicien 3A",
          schoolYearId: SOURCE_YEAR.id,
          schoolYearLabel: SOURCE_YEAR.label,
          professionId: "prof-meca",
          trainingYear: 3,
          parallelCode: "A",
          sortOrder: 1,
          isActive: true,
          isArchived: false,
          archivedAt: null,
        },
        {
          id: "class-b",
          code: "MECAUTO3A",
          label: "Mécanicien 3A",
          schoolYearId: TARGET_YEAR.id,
          schoolYearLabel: TARGET_YEAR.label,
          professionId: "prof-meca",
          trainingYear: 3,
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
          type: "TEST",
          title: "Contrôle châssis",
          detail: "Ne doit pas fuiter",
        },
        {
          id: 2,
          classroomId: "c",
          subjectId: "s",
          authorTeacherId: "t",
          day: 1,
          hour: 8,
          weekOffset: 0,
          schoolWeekNumber: 1,
          type: "HOMEWORK",
          title: "Série 1",
          detail: "ok",
        },
      ],
    },
    [{ sourceClassId: "class-a", targetClassId: "class-b" }],
    { selectedSourceClassIds: ["class-a"] },
  );
  assert.equal(presented.publications.projectable.length, 1);
  assert.equal(presented.publications.toReclassify.length, 1);
  assert.equal(presented.publications.toReclassify[0]?.reasonLabel, "À reclasser");
  assert.equal(presented.publications.toReclassify[0]?.explanation, YEAR_TRANSITION_RECLASSIFY_HUMAN_EXPLANATION);
  assert.doesNotMatch(presented.publications.toReclassify[0]?.reasonLabel ?? "", /SOURCE_SESSION_UNRESOLVED/);
  assert.equal(presented.notes?.toReclassify[0]?.title, "Note privée");
  assert.doesNotMatch(JSON.stringify(presented), /note-secret-body|Ne doit pas fuiter/);
  assert.equal(presented.blocking, false);
  assert.equal(previewHasBlockingEntries(preview), false);
});

