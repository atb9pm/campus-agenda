import assert from "node:assert/strict";
import test from "node:test";

import { SCHOOL_WEEK_MONDAYS } from "../src/features/calendar/school-week-dates.ts";
import {
  buildSchoolDayPlan,
  checkWeekPlanConsistency,
  countClassDays,
  easterSunday,
  listHolidayDays,
  valaisHolidaysForSchoolYear,
} from "../src/features/school-days/index.ts";
import type { SchoolDayWeekRow } from "../src/features/school-days/index.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import { getActiveSchoolWeeks } from "../src/features/calendar/active-calendar.ts";
import {
  MemorySchoolYearStore,
  resetMemorySchoolYearStore,
} from "../src/lib/persistence/memory-school-year-store.ts";

const ACTIVE_WEEKS: SchoolWeekEntry[] = SCHOOL_WEEK_MONDAYS.map((entry) => ({
  number: entry.number,
  kind: entry.kind,
  monday: entry.monday,
}));

function weekRow(rows: ReturnType<typeof buildSchoolDayPlan>, number: number): SchoolDayWeekRow {
  const row = rows.find((entry) => entry.kind === "week" && entry.number === number);
  assert.ok(row && row.kind === "week", `semaine ${number} absente du plan`);
  return row;
}

test("fêtes — Pâques et fêtes mobiles 2027", () => {
  assert.equal(easterSunday(2027).toISOString().slice(0, 10), "2027-03-28");

  const holidays = valaisHolidaysForSchoolYear("2026-2027");
  const byLabel = new Map(holidays.map((entry) => [entry.label, entry.date]));

  assert.equal(byLabel.get("Lundi de Pâques"), "2027-03-29");
  assert.equal(byLabel.get("Ascension"), "2027-05-06");
  assert.equal(byLabel.get("Lundi de Pentecôte"), "2027-05-17");
  assert.equal(byLabel.get("Fête-Dieu"), "2027-05-27");
});

test("fêtes — la liste valaisanne couvre les deux années civiles", () => {
  const holidays = valaisHolidaysForSchoolYear("2026-2027");
  assert.ok(holidays.some((entry) => entry.date === "2026-11-01" && entry.label === "Toussaint"));
  assert.ok(holidays.some((entry) => entry.date === "2026-12-08"));
  assert.ok(holidays.some((entry) => entry.date === "2027-01-01"));
  assert.deepEqual([...holidays].sort((a, b) => a.date.localeCompare(b.date)), holidays);
});

test("plan par jour — cinq jours par semaine et coupures de vacances", () => {
  const rows = buildSchoolDayPlan(ACTIVE_WEEKS);

  const first = weekRow(rows, 1);
  assert.equal(first.days.length, 5);
  assert.deepEqual(
    first.days.map((day) => day.date),
    ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"],
  );

  // Semaine 8 le 5 octobre, semaine 9 le 26 octobre : deux semaines de vacances.
  const autumnBreak = rows.find((row) => row.kind === "break" && row.afterWeekNumber === 8);
  assert.ok(autumnBreak && autumnBreak.kind === "break");
  assert.equal(autumnBreak.weekCount, 2);
  assert.equal(autumnBreak.fromMonday, "2026-10-12");

  const weekRows = rows.filter((row) => row.kind === "week");
  assert.equal(weekRows.length, 38);
});

test("plan par jour — le Lundi de Pentecôte tombe sur un jour de cours", () => {
  const rows = buildSchoolDayPlan(ACTIVE_WEEKS, valaisHolidaysForSchoolYear("2026-2027"));

  const pentecost = weekRow(rows, 34).days[0];
  assert.equal(pentecost.date, "2027-05-17");
  assert.equal(pentecost.state, "holiday");
  assert.equal(pentecost.label, "Lundi de Pentecôte");
  assert.equal(pentecost.isManual, false);

  const corpusChristi = weekRow(rows, 35).days[3];
  assert.equal(corpusChristi.date, "2027-05-27");
  assert.equal(corpusChristi.state, "holiday");
  assert.equal(corpusChristi.label, "Fête-Dieu");

  assert.ok(listHolidayDays(rows).length >= 5);
  assert.equal(countClassDays(rows) + listHolidayDays(rows).length, 38 * 5);
});

test("plan par jour — une correction manuelle l'emporte sur le calcul", () => {
  const holidays = valaisHolidaysForSchoolYear("2026-2027");

  const reopened = buildSchoolDayPlan(ACTIVE_WEEKS, holidays, [
    { date: "2027-05-17", state: "class", label: null },
  ]);
  const monday = weekRow(reopened, 34).days[0];
  assert.equal(monday.state, "class");
  assert.equal(monday.isManual, true);

  const closed = buildSchoolDayPlan(ACTIVE_WEEKS, holidays, [
    { date: "2026-08-18", state: "holiday", label: "Journée sportive" },
  ]);
  const tuesday = weekRow(closed, 1).days[1];
  assert.equal(tuesday.state, "holiday");
  assert.equal(tuesday.label, "Journée sportive");
  assert.equal(tuesday.isManual, true);
});

test("store mémoire — corriger une semaine et une exception de jour", async () => {
  resetMemorySchoolYearStore();
  const store = new MemorySchoolYearStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  assert.ok(active);

  const corrected = active.weeks.map((week) =>
    week.number === 34 ? { ...week, monday: "2027-05-18" as string } : week,
  );
  const updated = await store.replaceSchoolYearWeeks(active.id, corrected);
  assert.equal(updated.weeks.find((week) => week.number === 34)?.monday, "2027-05-18");
  assert.equal(getActiveSchoolWeeks().find((week) => week.number === 34)?.monday.getDate(), 18);

  const withException = await store.setDayException(active.id, "2027-05-27", {
    state: "holiday",
    label: "Fête-Dieu",
  });
  assert.deepEqual(withException, [{ date: "2027-05-27", state: "holiday", label: "Fête-Dieu" }]);

  const cleared = await store.setDayException(active.id, "2027-05-27", null);
  assert.deepEqual(cleared, []);
});

test("plan des semaines — contrôles non bloquants", () => {
  assert.deepEqual(checkWeekPlanConsistency(ACTIVE_WEEKS), []);

  const broken: SchoolWeekEntry[] = [
    { number: 1, kind: "A", monday: "2026-08-17" },
    { number: 2, kind: "A", monday: "2026-08-19" },
    { number: 3, kind: "B", monday: "2026-08-19" },
  ];
  const warnings = checkWeekPlanConsistency(broken);

  assert.ok(warnings.some((warning) => warning.includes("n'est pas un lundi")));
  assert.ok(warnings.some((warning) => warning.includes("Alternance A/B rompue")));
  assert.ok(warnings.some((warning) => warning.includes("partagent le lundi")));
});
