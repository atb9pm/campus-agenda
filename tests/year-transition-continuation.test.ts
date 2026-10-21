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
