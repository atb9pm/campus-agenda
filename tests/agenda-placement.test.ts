import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGENDA_PLACEMENT_NO_DATE_REASON,
  AGENDA_PLACEMENT_NO_SESSION_REASON,
  buildAgendaItemUpdatePatch,
  isAgendaPlacementChange,
  isStructuredAgendaPublication,
  normalizeAgendaPlacement,
  structuredAgendaPatchGuard,
  type PublicationPatch,
} from "../src/features/agenda/index.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import { isoDateForSchoolWeekDay } from "../src/features/school-days/index.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";
import { MemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import type { AgendaStore } from "../src/lib/persistence/types.ts";
import {
  exportSchoolYearSnapshot,
  schoolYearExportToCsv,
} from "../src/lib/persistence/year-export.ts";

const TEACHER_ID = "teacher-placement";
const YEAR_ID = "year-2026";
const WEEKS = [
  { number: 6, monday: "2026-09-14" },
  { number: 8, monday: "2026-09-28" },
] as const;

const THURSDAY_S6 = isoDateForSchoolWeekDay(WEEKS, 6, 3);
const MONDAY_S6 = isoDateForSchoolWeekDay(WEEKS, 6, 0);
const MONDAY_S8 = isoDateForSchoolWeekDay(WEEKS, 8, 0);
const THURSDAY_S8 = isoDateForSchoolWeekDay(WEEKS, 8, 3);

function session(input: {
  key: string;
  date: string;
  schoolWeekNumber: number;
  dayOfWeek: 1 | 2 | 3 | 4 | 5;
  annualCourseId?: string;
}): CourseSession {
  return {
    key: input.key,
    schoolYearId: YEAR_ID,
    annualCourseId: input.annualCourseId ?? "ac-transmission",
    classId: "class-mecauto3a",
    contextId: "ctx-transmission",
    date: input.date,
    schoolWeekNumber: input.schoolWeekNumber,
    weekKind: "A",
    dayOfWeek: input.dayOfWeek,
    sequenceNumber: 1,
    segments: [],
  };
}

const SESSION_S6_THU = session({
  key: `${YEAR_ID}|ac-transmission|${THURSDAY_S6}`,
  date: THURSDAY_S6!,
  schoolWeekNumber: 6,
  dayOfWeek: 4,
});
const SESSION_S8_MON = session({
  key: `${YEAR_ID}|ac-transmission|${MONDAY_S8}`,
  date: MONDAY_S8!,
  schoolWeekNumber: 8,
  dayOfWeek: 1,
});

function unstructuredHomework(overrides: Partial<PrototypeAgendaItem> = {}): PrototypeAgendaItem {
  return {
    id: 501,
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: TEACHER_ID,
    day: 3,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 6,
    type: "HOMEWORK",
    title: "Devoir non structuré",
    detail: "",
    schoolYearId: YEAR_ID,
    annualCourseId: "ac-transmission",
    courseSessionKey: null,
    courseSessionDate: THURSDAY_S6,
    studentVisible: true,
    ...overrides,
  };
}

function structuredHomework(overrides: Partial<PrototypeAgendaItem> = {}): PrototypeAgendaItem {
  return unstructuredHomework({
    id: 502,
    title: "Devoir structuré",
    courseSessionKey: SESSION_S6_THU.key,
    courseSessionDate: SESSION_S6_THU.date,
    ...overrides,
  });
}

function structuredTest(overrides: Partial<PrototypeAgendaItem> = {}): PrototypeAgendaItem {
  return structuredHomework({
    id: 503,
    type: "TEST",
    title: "Contrôle structuré",
    ...overrides,
  });
}

async function persistPlacement(
  store: AgendaStore,
  item: PrototypeAgendaItem,
  patch: PublicationPatch,
  sessions?: readonly CourseSession[],
) {
  const built = buildAgendaItemUpdatePatch(item, patch, { weeks: [...WEEKS], sessions });
  if (!built.ok) return built;
  const mutated = await store.updateAgendaItem(item.id, item.authorTeacherId, built.patch);
  if (!mutated.ok) return mutated;
  const persisted = await store.findAgendaItem(item.id);
  return { ok: true as const, item: mutated.item, persisted };
}

test("placement — HOMEWORK non structuré jeudi S6 → lundi S8 met à jour la date", () => {
  assert.equal(THURSDAY_S6, "2026-09-17");
  assert.equal(MONDAY_S8, "2026-09-28");
  const item = unstructuredHomework();
  assert.equal(isStructuredAgendaPublication(item), false);
  const moved = normalizeAgendaPlacement(item, { schoolWeekNumber: 8, day: 0 }, { weeks: [...WEEKS] });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.equal(moved.placement.schoolWeekNumber, 8);
  assert.equal(moved.placement.day, 0);
  assert.equal(moved.placement.courseSessionDate, MONDAY_S8);
});

test("placement — jour seul ou semaine seule recalcule courseSessionDate", () => {
  const item = unstructuredHomework();
  const dayOnly = normalizeAgendaPlacement(item, { schoolWeekNumber: 6, day: 0 }, { weeks: [...WEEKS] });
  assert.equal(dayOnly.ok, true);
  if (dayOnly.ok) {
    assert.equal(dayOnly.placement.schoolWeekNumber, 6);
    assert.equal(dayOnly.placement.day, 0);
    assert.equal(dayOnly.placement.courseSessionDate, MONDAY_S6);
  }
  const weekOnly = normalizeAgendaPlacement(item, { schoolWeekNumber: 8, day: 3 }, { weeks: [...WEEKS] });
  assert.equal(weekOnly.ok, true);
  if (weekOnly.ok) {
    assert.equal(weekOnly.placement.schoolWeekNumber, 8);
    assert.equal(weekOnly.placement.day, 3);
    assert.equal(weekOnly.placement.courseSessionDate, THURSDAY_S8);
  }
});

test("placement — titre ou visibilité seuls ne changent pas la date", () => {
  const item = unstructuredHomework();
  assert.equal(isAgendaPlacementChange(item, { title: "Nouveau titre" }), false);
  assert.equal(isAgendaPlacementChange(item, { studentVisible: false }), false);
  const title = buildAgendaItemUpdatePatch(item, { title: "Nouveau titre" }, { weeks: [...WEEKS] });
  assert.equal(title.ok, true);
  if (title.ok) {
    assert.equal(title.patch.courseSessionDate, undefined);
    assert.equal(title.patch.day, undefined);
    assert.equal(title.patch.schoolWeekNumber, undefined);
  }
  const visibility = buildAgendaItemUpdatePatch(item, { studentVisible: false }, { weeks: [...WEEKS] });
  assert.equal(visibility.ok, true);
  if (visibility.ok) assert.equal(visibility.patch.courseSessionDate, undefined);
});

test("placement — structuré vers une vraie CourseSession met à jour clé et date ensemble", () => {
  const item = structuredHomework();
  assert.equal(isStructuredAgendaPublication(item), true);
  const moved = normalizeAgendaPlacement(
    item,
    { schoolWeekNumber: 8, day: 0 },
    { weeks: [...WEEKS], sessions: [SESSION_S6_THU, SESSION_S8_MON] },
  );
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.equal(moved.placement.courseSessionKey, SESSION_S8_MON.key);
  assert.equal(moved.placement.courseSessionDate, SESSION_S8_MON.date);
  assert.equal(moved.placement.schoolWeekNumber, 8);
  assert.equal(moved.placement.day, 0);
  assert.notEqual(moved.placement.courseSessionKey, item.courseSessionKey);
});

test("placement — structuré vers une séance inexistante est refusé, sans fallback calendaire", () => {
  const item = structuredHomework();
  const refused = normalizeAgendaPlacement(
    item,
    { schoolWeekNumber: 8, day: 0 },
    { weeks: [...WEEKS], sessions: [SESSION_S6_THU] },
  );
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.reason, AGENDA_PLACEMENT_NO_SESSION_REASON);
  assert.equal(isoDateForSchoolWeekDay(WEEKS, 8, 0), MONDAY_S8);
});

test("placement — semaine inconnue refuse la mutation non structurée", () => {
  const item = unstructuredHomework();
  const refused = normalizeAgendaPlacement(item, { schoolWeekNumber: 99, day: 0 }, { weeks: [...WEEKS] });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.reason, AGENDA_PLACEMENT_NO_DATE_REASON);
});

test("TEST structuré — PATCH jour/semaine toujours refusé, moteur /move inchangé", async () => {
  const item = structuredTest();
  assert.equal(structuredAgendaPatchGuard(item, { day: 2 }).ok, false);
  assert.equal(structuredAgendaPatchGuard(item, { schoolWeekNumber: 8 }).ok, false);
  assert.equal(structuredAgendaPatchGuard(item, { title: "Nouveau" }).ok, true);

  const store = new MemoryAgendaStore([item]);
  const moved = await store.moveStructuredControlPlacement(item.id, TEACHER_ID, {
    classroomId: item.classroomId,
    subjectId: item.subjectId,
    schoolYearId: YEAR_ID,
    annualCourseId: "ac-transmission",
    courseSessionKey: SESSION_S8_MON.key,
    courseSessionDate: SESSION_S8_MON.date,
    schoolWeekNumber: 8,
    day: 0,
    hour: 8,
  });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.equal(moved.item.courseSessionKey, SESSION_S8_MON.key);
  assert.equal(moved.item.courseSessionDate, SESSION_S8_MON.date);
  const persisted = await store.findAgendaItem(item.id);
  assert.equal(persisted?.courseSessionKey, SESSION_S8_MON.key);
  assert.equal(persisted?.courseSessionDate, SESSION_S8_MON.date);

  const [moveRoute, patchRoute, service] = await Promise.all([
    readFile(new URL("../web/app/api/teacher/controls/[agendaItemId]/move/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-publications/service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(moveRoute, /moveStructuredControlToCourseSession/);
  assert.doesNotMatch(patchRoute, /moveStructuredControlPlacement/);
  assert.match(patchRoute, /buildAgendaItemUpdatePatch/);
  assert.match(service, /moveStructuredControlPlacement/);
});

test("store mémoire — relecture réelle de courseSessionDate et courseSessionKey", async () => {
  const unstructured = unstructuredHomework();
  const structured = structuredHomework({ id: 602, authorTeacherId: TEACHER_ID });
  const store = new MemoryAgendaStore([unstructured, structured]);

  const movedUnstructured = await persistPlacement(store, unstructured, { schoolWeekNumber: 8, day: 0 });
  assert.equal(movedUnstructured.ok, true);
  if (!movedUnstructured.ok) return;
  assert.equal(movedUnstructured.persisted?.courseSessionDate, MONDAY_S8);
  assert.equal(movedUnstructured.persisted?.schoolWeekNumber, 8);
  assert.equal(movedUnstructured.persisted?.day, 0);

  const dayOnly = await persistPlacement(store, movedUnstructured.persisted!, { day: 3 });
  assert.equal(dayOnly.ok, true);
  if (dayOnly.ok) assert.equal(dayOnly.persisted?.courseSessionDate, THURSDAY_S8);

  const weekOnly = await persistPlacement(store, dayOnly.ok ? dayOnly.persisted! : unstructured, {
    schoolWeekNumber: 6,
  });
  assert.equal(weekOnly.ok, true);
  if (weekOnly.ok) {
    assert.equal(weekOnly.persisted?.schoolWeekNumber, 6);
    assert.equal(weekOnly.persisted?.day, 3);
    assert.equal(weekOnly.persisted?.courseSessionDate, THURSDAY_S6);
  }

  const titleOnly = await persistPlacement(store, weekOnly.ok ? weekOnly.persisted! : unstructured, {
    title: "Titre seul",
    studentVisible: false,
  });
  assert.equal(titleOnly.ok, true);
  if (titleOnly.ok) {
    assert.equal(titleOnly.persisted?.title, "Titre seul");
    assert.equal(titleOnly.persisted?.studentVisible, false);
    assert.equal(titleOnly.persisted?.courseSessionDate, THURSDAY_S6);
    assert.equal(titleOnly.persisted?.schoolWeekNumber, 6);
    assert.equal(titleOnly.persisted?.day, 3);
  }

  const movedStructured = await persistPlacement(
    store,
    structured,
    { schoolWeekNumber: 8, day: 0 },
    [SESSION_S6_THU, SESSION_S8_MON],
  );
  assert.equal(movedStructured.ok, true);
  if (!movedStructured.ok) return;
  assert.equal(movedStructured.persisted?.courseSessionKey, SESSION_S8_MON.key);
  assert.equal(movedStructured.persisted?.courseSessionDate, SESSION_S8_MON.date);

  const missing = buildAgendaItemUpdatePatch(
    structuredHomework({ id: 603 }),
    { schoolWeekNumber: 8, day: 0 },
    { weeks: [...WEEKS], sessions: [SESSION_S6_THU] },
  );
  assert.equal(missing.ok, false);
});

test("store SQL — relecture réelle de courseSessionDate et courseSessionKey", async () => {
  process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  await db.exec(
    `INSERT OR IGNORE INTO school_years (id, label, status, starts_on, ends_on, created_at)
     VALUES ('year-2026', '2026-2027', 'active', '2026-08-01', '2027-07-31', datetime('now'))`,
  );
  const store = new SqlAgendaStore(db);

  const created = await store.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 3,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 6,
    type: "HOMEWORK",
    title: "Devoir SQL",
    detail: "",
    schoolYearId: YEAR_ID,
    annualCourseId: "ac-transmission",
    courseSessionDate: THURSDAY_S6,
  });
  const moved = await persistPlacement(
    store,
    { ...created, authorTeacherId: DEMO_CURRENT_TEACHER_ID },
    { schoolWeekNumber: 8, day: 0 },
  );
  assert.equal(moved.ok, true, moved.ok ? "" : moved.reason);
  if (!moved.ok) {
    db.close();
    return;
  }

  const reloaded = new SqlAgendaStore(db);
  const persisted = await reloaded.findAgendaItem(created.id);
  assert.equal(persisted?.courseSessionDate, MONDAY_S8);
  assert.equal(persisted?.schoolWeekNumber, 8);
  assert.equal(persisted?.day, 0);

  const structuredCreated = await store.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 3,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 6,
    type: "HOMEWORK",
    title: "Devoir SQL structuré",
    detail: "",
    schoolYearId: YEAR_ID,
    annualCourseId: "ac-transmission",
    courseSessionKey: SESSION_S6_THU.key,
    courseSessionDate: SESSION_S6_THU.date,
  });
  assert.equal(isStructuredAgendaPublication(structuredCreated), true);
  const structuredMoved = await persistPlacement(
    store,
    { ...structuredCreated, authorTeacherId: DEMO_CURRENT_TEACHER_ID },
    { schoolWeekNumber: 8, day: 0 },
    [SESSION_S6_THU, SESSION_S8_MON],
  );
  assert.equal(structuredMoved.ok, true, structuredMoved.ok ? "" : structuredMoved.reason);
  if (structuredMoved.ok) {
    const structuredPersisted = await reloaded.findAgendaItem(structuredCreated.id);
    assert.equal(structuredPersisted?.courseSessionKey, SESSION_S8_MON.key);
    assert.equal(structuredPersisted?.courseSessionDate, SESSION_S8_MON.date);
  }

  db.close();
});

test("POST /api/agenda conserve la date calendaire de la PR #133", async () => {
  const agendaApi = await readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8");
  assert.match(agendaApi, /isoDateForSchoolWeekDay\(activeYear\.weeks, schoolWeekNumber, day\)/);
  assert.match(agendaApi, /courseSessionDate: activeYear/);
});

test("export CSV/JSON après déplacement utilise la nouvelle date", async () => {
  const item = unstructuredHomework({ id: 701, authorTeacherId: TEACHER_ID });
  const store = new MemoryAgendaStore([item]);
  const moved = await persistPlacement(store, item, { schoolWeekNumber: 8, day: 0 });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  const snapshot = await exportSchoolYearSnapshot(store, YEAR_ID, "2026-2027", WEEKS);
  const exported = snapshot.items.find((entry) => entry.id === item.id);
  assert.equal(exported?.courseSessionDate, MONDAY_S8);
  const csv = schoolYearExportToCsv(snapshot);
  assert.match(csv, /courseSessionDate/);
  assert.match(csv, new RegExp(`${item.id},.*,8,0,${MONDAY_S8},`));
  assert.doesNotMatch(csv, new RegExp(`${item.id},.*,${THURSDAY_S6},`));
});

test("architecture — normalisation centralisée, stores persistants, Carnet inchangé", async () => {
  const [placement, publications, types, sql, memory, patchRoute, page, panel] = await Promise.all([
    readFile(new URL("../src/features/agenda/placement.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/agenda/publications.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/persistence/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/persistence/sql/sql-agenda-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/persistence/memory-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(placement, /export function normalizeAgendaPlacement/);
  assert.match(placement, /export function buildAgendaItemUpdatePatch/);
  assert.match(placement, /isoDateForSchoolWeekDay/);
  assert.match(placement, /isStructuredAgendaPublication/);
  assert.doesNotMatch(publications, /normalizeAgendaPlacement/);
  assert.match(types, /courseSessionDate/);
  assert.match(types, /courseSessionKey/);
  assert.match(sql, /course_session_key = \?, course_session_date = \?/);
  assert.match(memory, /courseSessionDate/);
  assert.match(patchRoute, /buildAgendaItemUpdatePatch/);
  assert.match(patchRoute, /listComputedCourseSessions/);
  assert.match(page, /notebookMovePublication\(itemId: number, schoolWeekNumber: number, day\?: number\)/);
  assert.match(panel, /onMovePublication/);
});
