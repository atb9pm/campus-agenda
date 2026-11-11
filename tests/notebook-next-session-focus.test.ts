import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  msUntilNextSchoolMidnight,
  notebookAutoFollowAllowed,
  notebookOpeningFollowMode,
  notebookReferenceButtonLabel,
  notebookReferenceSession,
  notebookReferenceTag,
  notebookSchoolTodayIso,
  notebookTodayUpdate,
  orderedCourseSessions,
  resolveNotebookStartSession,
  shiftCourseSession,
  visibleCourseSessions,
} from "../src/features/class-notebook/index.ts";
import type { CourseScheduleSlot, CourseWeekKind, CourseWeekday } from "../src/features/course-schedule/types.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import type { CourseSession } from "../src/features/course-sessions/types.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";

const YEAR = "SY-2026-27";
const INJECTION = { id: "ac-injection", classId: "class-mecauto3a", contextId: "ctx-injection" };
const CHASSIS = { id: "ac-chassis", classId: "class-mecauto3a", contextId: "ctx-chassis" };

function slot(courseId: string, id: string, dayOfWeek: CourseWeekday, weekKind: CourseWeekKind): CourseScheduleSlot {
  return {
    id,
    annualCourseId: courseId,
    dayOfWeek,
    periodStart: 2,
    periodEnd: 3,
    weekKind,
    validFrom: null,
    validTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const NOVEMBER_WEEKS: SchoolWeekEntry[] = [
  { number: 10, kind: "B", monday: "2026-11-02" },
  { number: 11, kind: "A", monday: "2026-11-09" },
  { number: 12, kind: "B", monday: "2026-11-16" },
  { number: 13, kind: "A", monday: "2026-11-23" },
];

function sessionsFor(input: {
  course?: typeof INJECTION;
  slots: CourseScheduleSlot[];
  weeks?: SchoolWeekEntry[];
  holidays?: { date: string; label: string }[];
}): CourseSession[] {
  return orderedCourseSessions(
    computeCourseSessions({
      schoolYearId: YEAR,
      courses: [input.course ?? INJECTION],
      slots: input.slots,
      weeks: input.weeks ?? NOVEMBER_WEEKS,
      holidays: input.holidays ?? [],
      exceptions: [],
    }),
  );
}

/** MECAUTO3A — CP VL Injection – Dépollution : lundi et jeudi chaque semaine. */
function injectionSessions(): CourseSession[] {
  return sessionsFor({
    slots: [slot(INJECTION.id, "inj-mon", 1, "all"), slot(INJECTION.id, "inj-thu", 4, "all")],
  });
}

function referenceDate(sessions: readonly CourseSession[], todayIso: string): string | undefined {
  return notebookReferenceSession(sessions, todayIso)?.session.date;
}

function autoStart(sessions: readonly CourseSession[], todayIso: string): string | undefined {
  return resolveNotebookStartSession({
    sessions,
    followMode: "auto",
    todayIso,
    centerSessionKey: null,
    centerWeekNumber: 11,
  })?.date;
}

test("1 — le lundi 9 novembre reste sélectionné toute la journée (heure de Zurich)", () => {
  const sessions = injectionSessions();
  for (const instant of ["2026-11-08T23:00:00.000Z", "2026-11-09T06:30:00.000Z", "2026-11-09T22:59:59.000Z"]) {
    const today = notebookSchoolTodayIso(new Date(instant));
    assert.equal(today, "2026-11-09", instant);
    assert.equal(autoStart(sessions, today), "2026-11-09", instant);
    assert.equal(notebookReferenceSession(sessions, today)?.relation, "today");
  }
});

test("2 — dès 00 h 00 le mardi 10 novembre, la référence passe au jeudi 12 novembre", () => {
  const sessions = injectionSessions();
  const today = notebookSchoolTodayIso(new Date("2026-11-09T23:00:00.000Z"));
  assert.equal(today, "2026-11-10");
  assert.equal(autoStart(sessions, today), "2026-11-12");
  assert.equal(notebookReferenceSession(sessions, today)?.relation, "next");
});

test("3 — le mercredi 11 novembre conserve le jeudi 12 novembre ; le jeudi le reste toute la journée", () => {
  const sessions = injectionSessions();
  assert.equal(autoStart(sessions, "2026-11-11"), "2026-11-12");
  assert.equal(autoStart(sessions, "2026-11-12"), "2026-11-12");
  assert.equal(notebookReferenceSession(sessions, "2026-11-12")?.relation, "today");
});

test("4 — tableau de référence : vendredi 13 → lundi 16, mardi 17 → jeudi 19", () => {
  const sessions = injectionSessions();
  const expected: Record<string, string> = {
    "2026-11-09": "2026-11-09",
    "2026-11-10": "2026-11-12",
    "2026-11-11": "2026-11-12",
    "2026-11-12": "2026-11-12",
    "2026-11-13": "2026-11-16",
    "2026-11-14": "2026-11-16",
    "2026-11-15": "2026-11-16",
    "2026-11-17": "2026-11-19",
  };
  for (const [today, session] of Object.entries(expected)) {
    assert.equal(autoStart(sessions, today), session, today);
  }
});

test("5 — alternance de 14 jours : jeudi 5 novembre puis jeudi 19 novembre, sans séance intermédiaire", () => {
  const weeks: SchoolWeekEntry[] = [
    { number: 10, kind: "A", monday: "2026-11-02" },
    { number: 11, kind: "B", monday: "2026-11-09" },
    { number: 12, kind: "A", monday: "2026-11-16" },
  ];
  const sessions = sessionsFor({ slots: [slot(INJECTION.id, "thu-a", 4, "A")], weeks });
  assert.deepEqual(sessions.map((session) => session.date), ["2026-11-05", "2026-11-19"]);
  assert.equal(autoStart(sessions, "2026-11-05"), "2026-11-05");
  for (const today of ["2026-11-06", "2026-11-09", "2026-11-12", "2026-11-18"]) {
    assert.equal(autoStart(sessions, today), "2026-11-19", today);
  }
  assert.ok(sessions.every((session) => session.annualCourseId === INJECTION.id && session.weekKind === "A"));
});

test("6 — vacances et jours fériés : aucune séance fictive", () => {
  const weeks: SchoolWeekEntry[] = [
    { number: 14, kind: "B", monday: "2026-12-14" },
    { number: 15, kind: "A", monday: "2027-01-04" },
  ];
  const winter = sessionsFor({ slots: [slot(INJECTION.id, "mon", 1, "all")], weeks });
  assert.deepEqual(winter.map((session) => session.date), ["2026-12-14", "2027-01-04"]);
  for (const today of ["2026-12-15", "2026-12-21", "2026-12-28", "2027-01-01"]) {
    assert.equal(autoStart(winter, today), "2027-01-04", today);
  }

  const withHoliday = sessionsFor({
    slots: [slot(INJECTION.id, "inj-mon", 1, "all"), slot(INJECTION.id, "inj-thu", 4, "all")],
    holidays: [{ date: "2026-11-16", label: "Jour férié" }],
  });
  assert.equal(withHoliday.some((session) => session.date === "2026-11-16"), false);
  assert.equal(autoStart(withHoliday, "2026-11-13"), "2026-11-19");
});

test("7 — la navigation manuelle reste prioritaire, même après un enregistrement", () => {
  const sessions = injectionSessions();
  const monday9 = sessions.find((session) => session.date === "2026-11-09")!;
  const manual = {
    sessions,
    followMode: "manual" as const,
    todayIso: "2026-11-11",
    centerSessionKey: monday9.key,
    centerWeekNumber: 11,
  };
  assert.equal(resolveNotebookStartSession(manual)?.date, "2026-11-09");
  assert.equal(resolveNotebookStartSession({ ...manual, todayIso: "2026-11-13" })?.date, "2026-11-09");
  assert.equal(resolveNotebookStartSession({ ...manual })?.key, monday9.key);

  const thursday12 = sessions.find((session) => session.date === "2026-11-12")!;
  assert.equal(shiftCourseSession(sessions, thursday12.key, 1)?.date, "2026-11-16");
  assert.equal(shiftCourseSession(sessions, thursday12.key, -1)?.date, "2026-11-09");
});

test("8 — le bouton « Prochain cours » rétablit le suivi automatique", () => {
  const sessions = injectionSessions();
  const monday16 = sessions.find((session) => session.date === "2026-11-16")!;
  const afterButton = resolveNotebookStartSession({
    sessions,
    followMode: "auto",
    todayIso: "2026-11-11",
    centerSessionKey: monday16.key,
    centerWeekNumber: 12,
  });
  assert.equal(afterButton?.date, "2026-11-12");
  assert.equal(notebookReferenceButtonLabel(notebookReferenceSession(sessions, "2026-11-11")), "Prochain cours");
  assert.equal(notebookReferenceButtonLabel(notebookReferenceSession(sessions, "2026-11-12")), "Aujourd’hui");

  const reference = notebookReferenceSession(sessions, "2026-11-11");
  const thursday12 = sessions.find((session) => session.date === "2026-11-12")!;
  assert.equal(notebookReferenceTag(thursday12, reference), "Prochain cours");
  assert.equal(notebookReferenceTag(monday16, reference), null);
  assert.equal(notebookReferenceTag(thursday12, notebookReferenceSession(sessions, "2026-11-12")), "Aujourd’hui");
});

test("9 — smartphone : la séance sélectionnée est la colonne visible et active", async () => {
  const sessions = injectionSessions();
  const start = resolveNotebookStartSession({
    sessions,
    followMode: "auto",
    todayIso: "2026-11-13",
    centerSessionKey: null,
    centerWeekNumber: 11,
  })!;
  assert.deepEqual(visibleCourseSessions(sessions, start.key, 1).map((session) => session.date), ["2026-11-16"]);
  const desktop = visibleCourseSessions(sessions, start.key, 3);
  assert.equal(desktop.length, 3);
  assert.ok(desktop.some((session) => session.key === start.key));

  const [panel, css] = await Promise.all([
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /const isActive = card\.id === \(displayStartSession\?\.key \?\? `week:\$\{displayStartWeek\}`\);/);
  assert.match(panel, /visibleCourseSessions\(\s*orderedSessions,\s*displayStartSession\?\.key \?\? null,/);
  assert.match(css, /\.class-notebook-grid > \.class-notebook-column:not\(\.active\) \{ display: none; \}/);
  assert.match(css, /\.class-notebook-column\.active \{\n  border-color: #85a9e8;/);
});

test("10 — changement de cours : aucune ancienne sélection réutilisée", async () => {
  const injection = injectionSessions();
  const chassis = sessionsFor({ course: CHASSIS, slots: [slot(CHASSIS.id, "cha-tue", 2, "all")] });
  const oldKey = injection.find((session) => session.date === "2026-11-12")!.key;

  const auto = resolveNotebookStartSession({
    sessions: chassis,
    followMode: "auto",
    todayIso: "2026-11-11",
    centerSessionKey: oldKey,
    centerWeekNumber: 11,
  });
  assert.equal(auto?.annualCourseId, CHASSIS.id);
  assert.equal(auto?.date, "2026-11-17");

  const manual = resolveNotebookStartSession({
    sessions: chassis,
    followMode: "manual",
    todayIso: "2026-11-11",
    centerSessionKey: oldKey,
    centerWeekNumber: 11,
  });
  assert.equal(manual?.annualCourseId, CHASSIS.id);

  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /key=\{`\$\{openNotebookCourse\.annualCourseId\}:\$\{notebookOpening\.id\}`\}/);
  assert.match(page, /setNotebookOpening\(\(previous\) => \(\{ id: previous\.id \+ 1, followMode, sessionKey: null \}\)\)/);
});

test("11 — années archivées et DRAFT : pas de repositionnement sur la date réelle", async () => {
  assert.equal(notebookAutoFollowAllowed("archived"), false);
  assert.equal(notebookAutoFollowAllowed("draft"), false);
  assert.equal(notebookAutoFollowAllowed("active"), true);
  assert.equal(notebookAutoFollowAllowed(null), true);
  for (const schoolYearStatus of ["archived", "draft"] as const) {
    for (const source of ["mes-cours", "ma-semaine"] as const) {
      assert.equal(
        notebookOpeningFollowMode({ source, schoolYearStatus, selectedSchoolWeekNumber: 11, todaySchoolWeekNumber: 11 }),
        "manual",
        `${schoolYearStatus} ${source}`,
      );
    }
  }

  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /const autoFollowAllowed = structuredCourse && notebookAutoFollowAllowed\(schoolYearStatus\);/);
  assert.match(panel, /followMode: autoFollowAllowed \? followMode : "manual"/);
  assert.match(panel, /\{autoFollowAllowed \? \(\s*<button\s*type="button"\s*className="class-notebook-today"/);
});

test("ouverture : Mes cours suit la date ; Ma semaine aussi, sauf sur une autre semaine choisie", () => {
  const base = { schoolYearStatus: null, todaySchoolWeekNumber: 11 } as const;
  assert.equal(notebookOpeningFollowMode({ ...base, source: "mes-cours", selectedSchoolWeekNumber: 14 }), "auto");
  assert.equal(notebookOpeningFollowMode({ ...base, source: "ma-semaine", selectedSchoolWeekNumber: 11 }), "auto");
  assert.equal(notebookOpeningFollowMode({ ...base, source: "ma-semaine", selectedSchoolWeekNumber: 14 }), "manual");
  assert.equal(
    notebookOpeningFollowMode({ source: "ma-semaine", schoolYearStatus: null, selectedSchoolWeekNumber: 11, todaySchoolWeekNumber: null }),
    "manual",
  );
});

test("fin d’année et cours sans séance : repli cohérent, jamais une autre année", () => {
  const sessions = injectionSessions();
  const last = sessions[sessions.length - 1]!;
  const afterYear = notebookReferenceSession(sessions, "2027-07-15");
  assert.equal(afterYear?.session.key, last.key);
  assert.equal(afterYear?.relation, "last");
  assert.equal(notebookReferenceTag(last, afterYear), null);
  assert.equal(autoStart(sessions, "2027-07-15"), last.date);
  assert.ok(sessions.every((session) => session.schoolYearId === YEAR));

  assert.equal(notebookReferenceSession([], "2026-11-11"), null);
  assert.equal(
    resolveNotebookStartSession({ sessions: [], followMode: "auto", todayIso: "2026-11-11", centerSessionKey: null, centerWeekNumber: 11 }),
    null,
  );
  assert.equal(referenceDate(sessions, "2026-01-01"), sessions[0]!.date);
});

test("12 — changement de jour et retour de focus : jamais pendant une édition", async () => {
  assert.equal(notebookTodayUpdate("2026-11-09", "2026-11-09", false), "unchanged");
  assert.equal(notebookTodayUpdate("2026-11-09", "2026-11-10", false), "apply");
  assert.equal(notebookTodayUpdate("2026-11-09", "2026-11-10", true), "defer");

  assert.equal(msUntilNextSchoolMidnight(new Date("2026-11-09T22:59:00.000Z")), 61_000);
  assert.equal(msUntilNextSchoolMidnight(new Date("2026-11-09T23:00:00.000Z")), 24 * 60 * 60 * 1000 + 1_000);

  const panel = await readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /const editingInProgress = editor != null \|\| controlEditor != null \|\| dragPayload != null;/);
  assert.match(panel, /notebookTodayUpdate\(todayIso, observedTodayIso, editingInProgress\) === "apply"/);
  assert.match(panel, /window\.addEventListener\("focus", sync\)/);
  assert.match(panel, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(panel, /msUntilNextSchoolMidnight\(new Date\(\)\)/);
  assert.doesNotMatch(panel, /setInterval\(/);

  const setCenterCalls = panel.match(/setCenterSessionKey\(/g) ?? [];
  assert.equal(setCenterCalls.length, 2, "seuls le choix manuel et le bouton déplacent la sélection");
});
