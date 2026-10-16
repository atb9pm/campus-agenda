import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { SchoolWeek } from "../src/features/calendar/types.ts";
import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import {
  assignOrphanedSessionNotes,
  assignPendingWeekNotes,
  classNotesTouchCatalog,
  formatCourseSessionCardSubtitle,
  isClassNotesPayload,
  itemsForCourseSession,
  listOrphanedSessionNotes,
  listPendingWeekNotes,
  listSessionNotes,
  migrateClassNotesToSessions,
  orderedCourseSessions,
  pendingWeekNotesWithoutSession,
  shiftCourseSession,
  snapToCourseSession,
  stripClassNotesForCatalog,
  visibleCourseSessions,
  weekNotesKey,
} from "../src/features/class-notebook/index.ts";
import { resolveAgendaItemSession } from "../src/features/notebook-export/session-match.ts";
import type { CourseScheduleSlot, CourseWeekKind, CourseWeekday } from "../src/features/course-schedule/types.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";

const YEAR = "SY-2026-27";
const COURSE = { id: "ac-electro", classId: "class-mecauto3a", contextId: "ctx-electro" };

function schoolWeeksFromEntries(entries: SchoolWeekEntry[]): SchoolWeek[] {
  return entries.map((entry) => {
    const [year, month, day] = entry.monday.split("-").map(Number);
    return {
      number: entry.number,
      kind: entry.kind,
      monday: new Date(year, month - 1, day, 12),
    };
  });
}

function slot(patch: {
  id: string;
  dayOfWeek: CourseWeekday;
  weekKind: CourseWeekKind;
  periodStart: number;
  periodEnd: number;
}): CourseScheduleSlot {
  return {
    id: patch.id,
    annualCourseId: COURSE.id,
    dayOfWeek: patch.dayOfWeek,
    periodStart: patch.periodStart,
    periodEnd: patch.periodEnd,
    weekKind: patch.weekKind,
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function electroWeeks(): SchoolWeekEntry[] {
  return [
    { number: 9, kind: "A", monday: "2026-10-26" },
    { number: 10, kind: "B", monday: "2026-11-02" },
    { number: 11, kind: "A", monday: "2026-11-09" },
  ];
}

function electroSessions() {
  return computeCourseSessions({
    schoolYearId: YEAR,
    courses: [COURSE],
    slots: [
      slot({ id: "a-mon", dayOfWeek: 1, weekKind: "A", periodStart: 7, periodEnd: 8 }),
      slot({ id: "a-thu", dayOfWeek: 4, weekKind: "A", periodStart: 8, periodEnd: 9 }),
      slot({ id: "b-mon", dayOfWeek: 1, weekKind: "B", periodStart: 7, periodEnd: 8 }),
    ],
    weeks: electroWeeks(),
    holidays: [],
    exceptions: [],
  });
}

test("carnet — une carte par CourseSession, pas par semaine", () => {
  const sessions = orderedCourseSessions(electroSessions());
  assert.equal(sessions.length, 5);
  assert.deepEqual(
    sessions.map((session) => `${session.schoolWeekNumber}-${session.dayOfWeek}`),
    ["9-1", "9-4", "10-1", "11-1", "11-4"],
  );
  const four = visibleCourseSessions(sessions, sessions[0]!.key, 4);
  assert.equal(four.length, 4);
  assert.equal(four[0]!.schoolWeekNumber, 9);
  assert.equal(four[0]!.dayOfWeek, 1);
  assert.equal(four[1]!.schoolWeekNumber, 9);
  assert.equal(four[1]!.dayOfWeek, 4);
  assert.equal(four[2]!.schoolWeekNumber, 10);
  assert.equal(four[2]!.dayOfWeek, 1);
  assert.equal(four[3]!.schoolWeekNumber, 11);
  assert.equal(four[3]!.dayOfWeek, 1);
  assert.notEqual(four[0]!.key, four[1]!.key);
});

test("carnet — sous-titre de carte = un jour + périodes", () => {
  const sessions = orderedCourseSessions(electroSessions());
  const monday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 1)!;
  const thursday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 4)!;
  assert.match(formatCourseSessionCardSubtitle(monday), /Lundi 26\.10/);
  assert.match(formatCourseSessionCardSubtitle(monday), /P7-P8/);
  assert.match(formatCourseSessionCardSubtitle(thursday), /Jeudi 29\.10/);
  assert.match(formatCourseSessionCardSubtitle(thursday), /P8-P9/);
  assert.doesNotMatch(formatCourseSessionCardSubtitle(monday), /JEU/);
});

test("carnet — navigation ◀ ▶ suit la timeline des séances", () => {
  const sessions = orderedCourseSessions(electroSessions());
  const monday = sessions[0]!;
  const thursday = shiftCourseSession(sessions, monday.key, 1);
  assert.equal(thursday?.dayOfWeek, 4);
  assert.equal(thursday?.schoolWeekNumber, 9);
  const week10 = shiftCourseSession(sessions, thursday!.key, 1);
  assert.equal(week10?.schoolWeekNumber, 10);
  assert.equal(week10?.dayOfWeek, 1);
  const snapped = snapToCourseSession(sessions, null, 10);
  assert.equal(snapped?.schoolWeekNumber, 10);
});

test("carnet — notes V1 une séance → migration automatique", () => {
  const sessions = electroSessions();
  const week10 = weekNotesKey("class-mecauto3a", 10);
  const v1 = {
    version: 1 as const,
    weeks: { [week10]: [{ id: "n1", text: "Prévoir multimètres" }] },
  };
  const migrated = migrateClassNotesToSessions(v1, sessions, "class-mecauto3a");
  assert.equal(migrated.changed, true);
  const session10 = sessions.find((session) => session.schoolWeekNumber === 10)!;
  assert.equal(listSessionNotes(migrated.document, session10.key)[0]?.text, "Prévoir multimètres");
  assert.equal(listPendingWeekNotes(migrated.document, week10).length, 0);
});

test("carnet — notes V1 deux séances → pas d’attribution silencieuse", () => {
  const sessions = electroSessions();
  const week9 = weekNotesKey("class-mecauto3a", 9);
  const v1 = {
    version: 1 as const,
    weeks: { [week9]: [{ id: "n9", text: "Note semaine 9" }] },
  };
  const migrated = migrateClassNotesToSessions(v1, sessions, "class-mecauto3a");
  const monday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 1)!;
  const thursday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 4)!;
  assert.equal(listSessionNotes(migrated.document, monday.key).length, 0);
  assert.equal(listSessionNotes(migrated.document, thursday.key).length, 0);
  assert.equal(listPendingWeekNotes(migrated.document, week9)[0]?.text, "Note semaine 9");
  const assigned = assignPendingWeekNotes(migrated.document, week9, thursday.key);
  assert.equal(listSessionNotes(assigned, thursday.key)[0]?.text, "Note semaine 9");
  assert.equal(listSessionNotes(assigned, monday.key).length, 0);
  assert.equal(listPendingWeekNotes(assigned, week9).length, 0);
});

test("carnet — payload notes V2 accepté, V1 conservé", () => {
  assert.equal(isClassNotesPayload({ version: 1, weeks: {} }), true);
  assert.equal(isClassNotesPayload({ version: 2, sessions: {} }), true);
  assert.equal(
    isClassNotesPayload({
      version: 2,
      sessions: { "y|ac|2026-10-26": [{ id: "n", text: "ok" }] },
      pendingWeeks: { "class:9": [{ id: "p", text: "héritée" }] },
    }),
    true,
  );
});

test("carnet — UI une carte = une CourseSession, Planifier sans picker", async () => {
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /visibleCards\.map/);
  assert.match(panel, /formatCourseSessionCardSubtitle/);
  assert.match(panel, /startPlanForSession/);
  assert.doesNotMatch(panel, /startPlanForWeek/);
  assert.doesNotMatch(panel, /data-control-session-picker/);
  assert.doesNotMatch(panel, /Choisir le cours/);
  assert.match(panel, /\{count\} séance/);
  assert.match(panel, /data-pending-week-notes/);
});

test("carnet — aucune table SQL CourseSession", () => {
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0030_agenda_student_visible.sql");
  assert.equal(
    SQL_MIGRATION_FILES.some((file) => file.toLowerCase().includes("course_session")),
    false,
  );
});

test("carnet — semaines scolaires restent une métadonnée", () => {
  const weeks = schoolWeeksFromEntries(electroWeeks());
  assert.equal(weeks.filter((week) => week.number === 9).length, 1);
});

function electroItem(patch: Partial<PrototypeAgendaItem> & Pick<PrototypeAgendaItem, "id" | "title">): PrototypeAgendaItem {
  return {
    classroomId: "rt-mecauto3a",
    subjectId: "rt-electro",
    authorTeacherId: "teacher-1",
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 9,
    type: "HOMEWORK",
    detail: "",
    annualCourseId: COURSE.id,
    courseSessionKey: null,
    courseSessionDate: null,
    ...patch,
  };
}

test("carnet — publications et contrôles restent sur leur CourseSession", () => {
  const sessions = orderedCourseSessions(electroSessions());
  const monday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 1)!;
  const thursday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 4)!;
  const items: PrototypeAgendaItem[] = [
    electroItem({
      id: 1,
      title: "Exercice électrotechnique",
      day: 0,
      courseSessionKey: monday.key,
      courseSessionDate: monday.date,
    }),
    electroItem({
      id: 2,
      title: "Mesures au multimètre",
      day: 3,
      courseSessionKey: thursday.key,
      courseSessionDate: thursday.date,
    }),
    electroItem({
      id: 3,
      title: "Contrôle Lundi",
      type: "TEST",
      day: 0,
      courseSessionKey: monday.key,
      courseSessionDate: monday.date,
    }),
    electroItem({
      id: 4,
      title: "Contrôle Jeudi",
      type: "TEST",
      day: 3,
      courseSessionKey: thursday.key,
      courseSessionDate: thursday.date,
    }),
  ];
  assert.deepEqual(
    itemsForCourseSession(items, monday, sessions).map((item) => item.title),
    ["Exercice électrotechnique", "Contrôle Lundi"],
  );
  assert.deepEqual(
    itemsForCourseSession(items, thursday, sessions).map((item) => item.title),
    ["Mesures au multimètre", "Contrôle Jeudi"],
  );
});

test("carnet — publication historique sans clé : semaine+jour unique → séance", () => {
  const sessions = orderedCourseSessions(electroSessions());
  const monday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 1)!;
  const legacy = electroItem({
    id: 10,
    title: "Ancien exo",
    day: 0,
    schoolWeekNumber: 9,
    courseSessionKey: null,
    courseSessionDate: null,
  });
  const resolved = resolveAgendaItemSession(legacy, sessions);
  assert.equal(resolved.kind, "MATCH_WEEK_DAY");
  assert.equal(resolved.kind === "UNMATCHED" ? null : resolved.session.key, monday.key);
});

test("carnet — notes V2 indexées par séance, pas par semaine", () => {
  const sessions = electroSessions();
  const monday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 1)!;
  const thursday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 4)!;
  const document = {
    version: 2 as const,
    sessions: {
      [monday.key]: [{ id: "n-mon", text: "Prévoir multimètres" }],
      [thursday.key]: [{ id: "n-thu", text: "Corriger exercice 4" }],
    },
  };
  assert.equal(listSessionNotes(document, monday.key)[0]?.text, "Prévoir multimètres");
  assert.equal(listSessionNotes(document, thursday.key)[0]?.text, "Corriger exercice 4");
  assert.notEqual(monday.key, thursday.key);
});

test("carnet — affichage séances et pas publicationDayIndexForCourseWeek dans le panel", async () => {
  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /publicationDayIndexForCourseWeek/);
  assert.match(panel, /Séances précédentes/);
  assert.match(panel, /Séances suivantes/);
  assert.match(panel, /moveMenuCardId/);
  assert.doesNotMatch(panel, /moveMenuWeek/);
  assert.match(panel, /dropSlot\.sessionKey === session\.key/);
  assert.match(panel, /data-orphaned-session-notes/);
});

test("carnet — migration V1 incrémentale par classe", () => {
  const sessions = electroSessions();
  const weekA = weekNotesKey("class-a", 9);
  const weekB = weekNotesKey("class-b", 10);
  const v1 = {
    version: 1 as const,
    weeks: {
      [weekA]: [{ id: "na", text: "Note classe A" }],
      [weekB]: [{ id: "nb", text: "Note classe B" }],
    },
  };
  const afterA = migrateClassNotesToSessions(v1, sessions, "class-a");
  assert.equal(afterA.document.version, 2);
  assert.equal(listPendingWeekNotes(afterA.document, weekA)[0]?.text, "Note classe A");
  assert.equal(listPendingWeekNotes(afterA.document, weekB)[0]?.text, "Note classe B");
  const session10 = sessions.find((session) => session.schoolWeekNumber === 10)!;
  assert.equal(listSessionNotes(afterA.document, session10.key).length, 0);

  const afterB = migrateClassNotesToSessions(afterA.document, sessions, "class-b");
  assert.equal(listSessionNotes(afterB.document, session10.key)[0]?.text, "Note classe B");
  assert.equal(listPendingWeekNotes(afterB.document, weekB).length, 0);
  assert.equal(listPendingWeekNotes(afterB.document, weekA)[0]?.text, "Note classe A");
});

test("carnet — pending V2 d’une semaine à une séance migrée, jamais disparue", () => {
  const sessions = electroSessions();
  const week10 = weekNotesKey("class-mecauto3a", 10);
  const week9 = weekNotesKey("class-mecauto3a", 9);
  const v2 = {
    version: 2 as const,
    sessions: {},
    pendingWeeks: {
      [week10]: [{ id: "p10", text: "héritée 10" }],
      [week9]: [{ id: "p9", text: "héritée 9" }],
    },
  };
  const migrated = migrateClassNotesToSessions(v2, sessions, "class-mecauto3a");
  const session10 = sessions.find((session) => session.schoolWeekNumber === 10)!;
  assert.equal(listSessionNotes(migrated.document, session10.key)[0]?.text, "héritée 10");
  assert.equal(listPendingWeekNotes(migrated.document, week10).length, 0);
  assert.equal(listPendingWeekNotes(migrated.document, week9)[0]?.text, "héritée 9");
});

test("carnet — pending sans séance reste visible", () => {
  const sessions = electroSessions().filter((session) => session.schoolWeekNumber !== 10);
  const week10 = weekNotesKey("class-mecauto3a", 10);
  const v2 = {
    version: 2 as const,
    sessions: {},
    pendingWeeks: { [week10]: [{ id: "p10", text: "sans séance" }] },
  };
  const migrated = migrateClassNotesToSessions(v2, sessions, "class-mecauto3a");
  assert.equal(listPendingWeekNotes(migrated.document, week10)[0]?.text, "sans séance");
  assert.equal(pendingWeekNotesWithoutSession(migrated.document, "class-mecauto3a", sessions).length, 1);
});

test("carnet — note d’une CourseSession disparue reste orpheline et réattribuable", () => {
  const sessions = electroSessions();
  const monday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 1)!;
  const thursday = sessions.find((session) => session.schoolWeekNumber === 9 && session.dayOfWeek === 4)!;
  const goneKey = `${YEAR}|${COURSE.id}|2020-01-01`;
  const v2 = {
    version: 2 as const,
    sessions: {
      [goneKey]: [{ id: "old", text: "Ancienne séance" }],
      [monday.key]: [{ id: "ok", text: "actuelle" }],
    },
  };
  const migrated = migrateClassNotesToSessions(v2, sessions, "class-mecauto3a");
  assert.equal(listSessionNotes(migrated.document, goneKey).length, 0);
  assert.equal(listOrphanedSessionNotes(migrated.document, goneKey)[0]?.text, "Ancienne séance");
  assert.equal(listSessionNotes(migrated.document, monday.key)[0]?.text, "actuelle");
  const assigned = assignOrphanedSessionNotes(migrated.document, goneKey, thursday.key);
  assert.equal(listSessionNotes(assigned, thursday.key)[0]?.text, "Ancienne séance");
  assert.equal(listOrphanedSessionNotes(assigned, goneKey).length, 0);
});

test("carnet — suppression catalogue retire les notes session du cours visé", () => {
  const keepKey = `${YEAR}|ac-keep|2026-10-26`;
  const dropKey = `${YEAR}|ac-drop|2026-10-26`;
  const document = {
    version: 2 as const,
    sessions: {
      [keepKey]: [{ id: "keep", text: "conserver" }],
      [dropKey]: [{ id: "drop", text: "supprimer" }],
    },
    pendingWeeks: { "class-drop:9": [{ id: "pend", text: "pending drop" }] },
    orphanedSessions: { [`${YEAR}|ac-drop|2019-01-01`]: [{ id: "orph", text: "orpheline drop" }] },
  };
  assert.equal(classNotesTouchCatalog(document, { annualCourseIds: ["ac-drop"] }), true);
  assert.equal(classNotesTouchCatalog(document, { annualCourseIds: ["ac-other"] }), false);
  const stripped = stripClassNotesForCatalog(document, {
    classroomIds: ["class-drop"],
    annualCourseIds: ["ac-drop"],
  });
  assert.equal(stripped.changed, true);
  assert.ok(stripped.document.version === 2);
  if (stripped.document.version !== 2) return;
  assert.equal(stripped.document.sessions[keepKey]?.[0]?.text, "conserver");
  assert.equal(stripped.document.sessions[dropKey], undefined);
  assert.equal(stripped.document.pendingWeeks?.["class-drop:9"], undefined);
  assert.equal(stripped.document.orphanedSessions?.[`${YEAR}|ac-drop|2019-01-01`], undefined);
});
