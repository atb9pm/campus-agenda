import assert from "node:assert/strict";
import test from "node:test";

import type { SchoolClassRecord } from "../src/features/school-catalog/types.ts";
import {
  resolveClassContinuations,
  presentYearTransitionPreview,
  parseYearTransitionPreviewRequest,
} from "../src/features/year-transition/index.ts";
import type { YearTransitionPreviewResult } from "../src/features/year-transition/types.ts";
import type { YearTransitionCatalogLookups } from "../src/features/year-transition/presentation.ts";

function schoolClass(
  patch: Partial<SchoolClassRecord> & Pick<SchoolClassRecord, "id" | "schoolYearId">,
): SchoolClassRecord {
  return {
    code: patch.code ?? patch.id.toUpperCase(),
    label: patch.label ?? patch.id,
    sortOrder: patch.sortOrder ?? 1,
    isActive: patch.isActive ?? true,
    schoolYearLabel: patch.schoolYearLabel ?? "2026-2027",
    professionId: patch.professionId ?? "prf-meca",
    trainingYear: patch.trainingYear ?? 1,
    parallelCode: patch.parallelCode ?? "A",
    isArchived: patch.isArchived ?? false,
    archivedAt: patch.archivedAt ?? null,
    ...patch,
  };
}

test("les classes cochées sont reprises par identité, les décochées ne sont pas une erreur", () => {
  const sourceA = schoolClass({ id: "src-a", schoolYearId: "year-n", parallelCode: "A" });
  const sourceB = schoolClass({ id: "src-b", schoolYearId: "year-n", parallelCode: "B" });
  const sourceC = schoolClass({ id: "src-c", schoolYearId: "year-n", parallelCode: "C" });
  const targetA = schoolClass({ id: "tgt-a", schoolYearId: "year-n1", parallelCode: "A" });
  const resolved = resolveClassContinuations({
    selectedSourceClassIds: ["src-a", "src-c"],
    sourceClasses: [sourceA, sourceB, sourceC],
    targetClasses: [targetA],
    sourceSchoolYearId: "year-n",
    targetSchoolYearId: "year-n1",
  });
  assert.equal(resolved.blocking, false);
  assert.equal(resolved.issues.length, 0);
  assert.equal(resolved.planned.find((row) => row.sourceClassId === "src-a")?.action, "reuse");
  assert.equal(resolved.planned.find((row) => row.sourceClassId === "src-b")?.action, "skip");
  assert.equal(resolved.planned.find((row) => row.sourceClassId === "src-c")?.action, "create");
  assert.equal(resolved.mappings.find((row) => row.sourceClassId === "src-b")?.targetClassId, null);
  assert.equal(
    resolved.mappings.find((row) => row.sourceClassId === "src-c")?.targetClassId,
    "pending-class:src-c",
  );
  assert.notEqual(resolved.mappings.find((row) => row.sourceClassId === "src-c")?.targetClassId, null);
});

test("une ambiguïté d’identité bloque, une ressemblance de nom n’est jamais une fusion", () => {
  const source = schoolClass({
    id: "src-a",
    schoolYearId: "year-n",
    code: "MA1A",
    label: "Mécanicien 1A",
  });
  const sameNameOtherIdentity = schoolClass({
    id: "tgt-other",
    schoolYearId: "year-n1",
    code: "MA1A",
    label: "Mécanicien 1A",
    professionId: "prf-other",
    parallelCode: "A",
  });
  const twin = schoolClass({ id: "tgt-a1", schoolYearId: "year-n1", parallelCode: "A" });
  const twin2 = schoolClass({ id: "tgt-a2", schoolYearId: "year-n1", parallelCode: "A" });
  const noMerge = resolveClassContinuations({
    selectedSourceClassIds: ["src-a"],
    sourceClasses: [source],
    targetClasses: [sameNameOtherIdentity],
    sourceSchoolYearId: "year-n",
    targetSchoolYearId: "year-n1",
  });
  assert.equal(noMerge.planned[0]?.action, "create");
  const conflict = resolveClassContinuations({
    selectedSourceClassIds: ["src-a"],
    sourceClasses: [source],
    targetClasses: [twin, twin2],
    sourceSchoolYearId: "year-n",
    targetSchoolYearId: "year-n1",
  });
  assert.equal(conflict.blocking, true);
  assert.equal(conflict.planned[0]?.action, "conflict");
});

test("l’aperçu présenté n’exige pas une correspondance pour une classe non cochée", () => {
  const preview: YearTransitionPreviewResult = {
    sourceSchoolYearId: "year-n",
    targetSchoolYearId: "year-n1",
    fingerprint: "fp",
    mappingSummary: {
      oneToOne: [],
      noContinuation: ["src-b"],
      targetOnly: [],
      conflicts: [],
      unsupported: [],
    },
    entries: [],
  };
  const lookups: YearTransitionCatalogLookups = {
    years: [
      {
        id: "year-n",
        label: "2026-2027",
        status: "active",
        startsOn: "2026-08-17",
        endsOn: "2027-07-02",
        sourceFilename: null,
        importedAt: null,
        activatedAt: "2026-08-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "year-n1",
        label: "2027-2028",
        status: "draft",
        startsOn: "2027-08-16",
        endsOn: "2028-07-01",
        sourceFilename: null,
        importedAt: null,
        activatedAt: null,
        createdAt: "2027-01-01T00:00:00.000Z",
      },
    ],
    classes: [
      schoolClass({ id: "src-a", schoolYearId: "year-n", parallelCode: "A" }),
      schoolClass({ id: "src-b", schoolYearId: "year-n", parallelCode: "B" }),
    ],
    professions: [
      {
        id: "prf-meca",
        adminCode: "PRF-0001",
        label: "Mécanicien maintenance",
        classCodePrefix: "MMA",
        durationYears: 4,
        sortOrder: 1,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
    ],
    contexts: [],
    branches: [],
    courses: [],
    items: [],
  };
  const presented = presentYearTransitionPreview(
    preview,
    lookups,
    [
      { sourceClassId: "src-a", targetClassId: null },
      { sourceClassId: "src-b", targetClassId: null },
    ],
    { selectedSourceClassIds: ["src-a"] },
  );
  assert.equal(presented.mappingIssues.length, 0);
  assert.equal(presented.classSummaries.length, 1);
  assert.equal(presented.classSummaries[0]?.sourceClassId, "src-a");
  assert.equal(presented.classSummaries[0]?.status, "create");
  assert.doesNotMatch(JSON.stringify(presented.mappingIssues), /src-b|manquante/);
});

test("le détail d’une classe ne reprend pas les publications d’une classe parallèle", () => {
  const preview: YearTransitionPreviewResult = {
    sourceSchoolYearId: "year-n",
    targetSchoolYearId: "year-n1",
    fingerprint: "fp",
    mappingSummary: {
      oneToOne: [],
      noContinuation: [],
      targetOnly: [],
      conflicts: [],
      unsupported: [],
    },
    entries: [
      {
        reason: "ORPHAN_NO_REFERENCE_ITEM",
        warnings: [],
        sourceAgendaItemId: 1,
        sourceAnnualCourseId: "ac-a",
        sourceClassId: "src-a",
        targetClassId: null,
        targetAnnualCourseId: null,
        referenceItemId: null,
        sourceReferenceSessionId: null,
        resolvedReferenceSessionId: null,
        pedagogicalPosition: null,
        targetCourseSession: null,
        proposedPlacement: null,
        sourceTemporal: {
          schoolWeekNumber: 1,
          day: 0,
          hour: 8,
          weekOffset: 0,
          courseSessionDate: null,
          courseSessionKey: null,
        },
      },
      {
        reason: "ORPHAN_NO_REFERENCE_ITEM",
        warnings: [],
        sourceAgendaItemId: 2,
        sourceAnnualCourseId: "ac-b",
        sourceClassId: "src-b",
        targetClassId: null,
        targetAnnualCourseId: null,
        referenceItemId: null,
        sourceReferenceSessionId: null,
        resolvedReferenceSessionId: null,
        pedagogicalPosition: null,
        targetCourseSession: null,
        proposedPlacement: null,
        sourceTemporal: {
          schoolWeekNumber: 1,
          day: 0,
          hour: 8,
          weekOffset: 0,
          courseSessionDate: null,
          courseSessionKey: null,
        },
      },
    ],
  };
  const lookups: YearTransitionCatalogLookups = {
    years: [
      {
        id: "year-n",
        label: "2026-2027",
        status: "active",
        startsOn: "2026-08-17",
        endsOn: "2027-07-02",
        sourceFilename: null,
        importedAt: null,
        activatedAt: "2026-08-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "year-n1",
        label: "2027-2028",
        status: "draft",
        startsOn: "2027-08-16",
        endsOn: "2028-07-01",
        sourceFilename: null,
        importedAt: null,
        activatedAt: null,
        createdAt: "2027-01-01T00:00:00.000Z",
      },
    ],
    classes: [
      schoolClass({ id: "src-a", schoolYearId: "year-n", parallelCode: "A", code: "MECAUTO3A", label: "MECAUTO3A" }),
      schoolClass({ id: "src-b", schoolYearId: "year-n", parallelCode: "B", code: "MECAUTO3B", label: "MECAUTO3B" }),
    ],
    professions: [
      {
        id: "prf-meca",
        adminCode: "PRF-0001",
        label: "Mécatronicien d’automobiles",
        classCodePrefix: "MECAUTO",
        durationYears: 4,
        sortOrder: 1,
        isActive: true,
        isArchived: false,
        archivedAt: null,
      },
    ],
    contexts: [],
    branches: [],
    courses: [],
    items: [
      {
        id: 1,
        classroomId: "c-a",
        subjectId: "s-a",
        authorTeacherId: "t",
        day: 0,
        hour: 8,
        weekOffset: 0,
        schoolWeekNumber: 1,
        type: "HOMEWORK",
        title: "Groupe A",
        detail: "",
      },
      {
        id: 2,
        classroomId: "c-b",
        subjectId: "s-b",
        authorTeacherId: "t",
        day: 0,
        hour: 8,
        weekOffset: 0,
        schoolWeekNumber: 1,
        type: "HOMEWORK",
        title: "CP Léger Injection, dépollution · MECAUTO3B",
        detail: "",
      },
    ],
  };
  const presented = presentYearTransitionPreview(preview, lookups, [], { selectedSourceClassIds: ["src-a"] });
  assert.equal(presented.classSummaries.length, 1);
  assert.equal(presented.classSummaries[0]?.publicationCount, 1);
  assert.equal(presented.classSummaries[0]?.rows.length, 1);
  assert.equal(presented.classSummaries[0]?.rows[0]?.sourceClassId, "src-a");
  assert.doesNotMatch(JSON.stringify(presented.classSummaries), /MECAUTO3B|groupe B/i);
});

test("la requête d’aperçu accepte selectedSourceClassIds sans classMappings", () => {
  const parsed = parseYearTransitionPreviewRequest(
    {
      sourceSchoolYearId: "year-n",
      targetSchoolYearId: "year-n1",
      selectedSourceClassIds: ["src-a", "src-a"],
      includePrivateNotes: false,
    },
    "teacher-a",
  );
  assert.deepEqual(parsed.selectedSourceClassIds, ["src-a"]);
  assert.equal(parsed.resolveContinuations, true);
  assert.deepEqual(parsed.classMappings, []);
});
