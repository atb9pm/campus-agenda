import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { DEMO_CATALOG, TEACHER_DEMO_ID } from "../src/features/classes/index.ts";
import { replaceTeacherMemberships } from "../src/features/memberships/replacement.ts";
import { filterActiveMemberships, isMembershipActiveAt } from "../src/features/memberships/validity.ts";
import { computeClassYearStats } from "../src/features/memberships/year-stats.ts";
import {
  ARCHIVED_YEAR_READONLY_REASON,
  getArchivedYearIds,
  isArchivedYearItem,
} from "../src/features/school-year/archived-readonly.ts";
import { exportSchoolYearSnapshot, schoolYearExportToCsv } from "../src/lib/persistence/year-export.ts";
import { resetMemoryAgendaStore, getMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import {
  getMemoryMembershipsSnapshot,
  resetMemoryMembershipStore,
  setMemoryMemberships,
} from "../src/lib/persistence/memory-membership-store.ts";
import { teacherTeachesSubject } from "../src/features/classes/queries.ts";

const ARCHIVED_YEAR_ID = "year-archived-2025";
const ACTIVE_YEAR_ID = "year-active-2026";

test("phase 2.3 — une affectation inactive n'autorise plus la publication", () => {
  const memberships = getMemoryMembershipsSnapshot().map((membership) =>
    membership.teacherId === "teacher-demo-martin"
      ? { ...membership, validTo: "2026-01-15T00:00:00.000Z" }
      : membership,
  );
  setMemoryMemberships(memberships);

  const catalog = { ...DEMO_CATALOG, memberships: getMemoryMembershipsSnapshot() };
  assert.equal(
    isMembershipActiveAt(memberships.find((entry) => entry.teacherId === "teacher-demo-martin")!, "2026-02-01T00:00:00.000Z"),
    false,
  );
  assert.equal(
    teacherTeachesSubject(catalog, "teacher-demo-martin", "classe-demo-tma-2a", "subject-demo-moteur-2a"),
    false,
  );
  resetMemoryMembershipStore();
});

test("phase 2.3 — remplacement enseignant : historique intact, nouvelles branches au remplaçant", () => {
  const memberships = getMemoryMembershipsSnapshot();
  const martinMembership = memberships.find(
    (entry) => entry.teacherId === "teacher-demo-martin" && entry.classroomId === "classe-demo-tma-2a",
  )!;
  assert.ok(martinMembership.subjectIds.includes("subject-demo-moteur-2a"));

  const result = replaceTeacherMemberships(memberships, {
    classroomId: "classe-demo-tma-2a",
    outgoingTeacherId: "teacher-demo-martin",
    incomingTeacherId: "teacher-demo-dupont",
    subjectIds: ["subject-demo-moteur-2a"],
    effectiveAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal("ok" in result, false);
  if ("ok" in result) return;

  const closed = result.memberships.find((entry) => entry.id === martinMembership.id);
  assert.equal(closed?.validTo, "2026-09-01T00:00:00.000Z");

  const replacement = result.created;
  assert.equal(replacement.teacherId, "teacher-demo-dupont");
  assert.deepEqual(replacement.subjectIds, ["subject-demo-moteur-2a"]);

  const runtimeCatalog = { ...DEMO_CATALOG, memberships: result.memberships };
  const afterReplacement = "2026-10-01T00:00:00.000Z";
  assert.equal(
    teacherTeachesSubject(runtimeCatalog, "teacher-demo-dupont", "classe-demo-tma-2a", "subject-demo-moteur-2a", afterReplacement),
    true,
  );
  assert.equal(
    teacherTeachesSubject(runtimeCatalog, "teacher-demo-martin", "classe-demo-tma-2a", "subject-demo-moteur-2a", afterReplacement),
    false,
  );
});

test("phase 2.3 — publications archivées en lecture seule", () => {
  const archivedIds = getArchivedYearIds([
    {
      id: ARCHIVED_YEAR_ID,
      label: "2025-2026",
      status: "archived",
      startsOn: "2025-08-01",
      endsOn: "2026-07-31",
      sourceFilename: null,
      importedAt: null,
      activatedAt: "2025-08-01T00:00:00.000Z",
      createdAt: "2025-08-01T00:00:00.000Z",
    },
  ]);

  const archivedItem = { ...DEMO_PROTOTYPE_ITEMS[0], schoolYearId: ARCHIVED_YEAR_ID };
  assert.equal(isArchivedYearItem(archivedItem, archivedIds), true);
  assert.equal(ARCHIVED_YEAR_READONLY_REASON.includes("archivée"), true);
});

test("phase 2.3 — export annuel JSON et CSV", async () => {
  resetMemoryAgendaStore(
    DEMO_PROTOTYPE_ITEMS.map((item, index) => ({
      ...item,
      schoolYearId: index % 2 === 0 ? ARCHIVED_YEAR_ID : ACTIVE_YEAR_ID,
    })),
  );
  const store = getMemoryAgendaStore();
  const snapshot = await exportSchoolYearSnapshot(store, ARCHIVED_YEAR_ID, "2025-2026");
  assert.ok(snapshot.itemCount > 0);
  assert.ok(snapshot.items.every((item) => item.schoolYearId === ARCHIVED_YEAR_ID));

  const csv = schoolYearExportToCsv(snapshot);
  assert.match(csv, /^id,classroomId/);
  assert.match(csv, /\n/);
});

test("phase 2.3 — statistiques de charge par classe et année", () => {
  const items = DEMO_PROTOTYPE_ITEMS.map((item) => ({ ...item, schoolYearId: ACTIVE_YEAR_ID }));
  const stats = computeClassYearStats(items, "classe-demo-tma-2a", ACTIVE_YEAR_ID);
  assert.ok(stats.totalItems >= 0);
  assert.equal(stats.classroomId, "classe-demo-tma-2a");
  assert.equal(stats.schoolYearId, ACTIVE_YEAR_ID);
  assert.ok(typeof stats.byType.TEST === "number");
});

test("phase 2.3 — nouvelle publication conserve l'auteur d'origine sur l'historique", async () => {
  resetMemoryAgendaStore([]);
  resetMemoryMembershipStore();
  const store = getMemoryAgendaStore();

  const historical = await store.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: "teacher-demo-martin",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 5,
    type: "HOMEWORK",
    title: "Travaux moteur",
    detail: "Avant remplacement",
    schoolYearId: ACTIVE_YEAR_ID,
  });

  const replacementOutcome = replaceTeacherMemberships(getMemoryMembershipsSnapshot(), {
    classroomId: "classe-demo-tma-2a",
    outgoingTeacherId: "teacher-demo-martin",
    incomingTeacherId: TEACHER_DEMO_ID,
    subjectIds: ["subject-demo-moteur-2a"],
    effectiveAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal("ok" in replacementOutcome, false);
  if ("ok" in replacementOutcome) return;
  setMemoryMemberships(replacementOutcome.memberships);

  const fresh = await store.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: TEACHER_DEMO_ID,
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 6,
    type: "HOMEWORK",
    title: "Après remplacement",
    detail: "Nouveau prof",
    schoolYearId: ACTIVE_YEAR_ID,
  });

  assert.equal(historical.authorTeacherId, "teacher-demo-martin");
  assert.equal(fresh.authorTeacherId, TEACHER_DEMO_ID);
  resetMemoryMembershipStore();
});
