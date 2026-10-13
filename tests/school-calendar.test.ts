import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSchoolWeeks,
  findSchoolWeekForDate,
  formatCourseDayHeading,
  formatSchoolWeekLabel,
  resolveDisplayCourseDay,
  listPreviousCourseDays,
} from "../src/features/calendar/index.ts";

test("phase 1.1 — mardi semaine A affiche le lundi suivant", () => {
  const slot = resolveDisplayCourseDay(new Date(2026, 10, 10, 12));
  assert.equal(formatSchoolWeekLabel(slot), "Semaine 12-B");
  assert.equal(formatCourseDayHeading(slot), "Lundi 16 novembre");
});

test("phase 1.1 — mardi semaine B affiche le jeudi de la même semaine", () => {
  const slot = resolveDisplayCourseDay(new Date(2026, 10, 17, 12));
  assert.equal(formatSchoolWeekLabel(slot), "Semaine 12-B");
  assert.equal(formatCourseDayHeading(slot), "Jeudi 19 novembre");
});

test("phase 1.1 — lundi de cours affiche le jour courant", () => {
  const slot = resolveDisplayCourseDay(new Date(2026, 10, 16, 12));
  assert.equal(formatSchoolWeekLabel(slot), "Semaine 12-B");
  assert.equal(formatCourseDayHeading(slot), "Lundi 16 novembre");
});

test("phase 1.1 — historique des cours précédents", () => {
  const current = resolveDisplayCourseDay(new Date(2026, 10, 17, 12));
  const previous = listPreviousCourseDays(current.date, 4);
  assert.ok(previous.length >= 3);
  assert.match(formatSchoolWeekLabel(previous[0]), /Semaine 12-B/);
  assert.equal(formatCourseDayHeading(previous[0]), "Lundi 16 novembre");
});

test("régression 13 octobre 2026 — vacances d’automne → semaine 9-A, pas 38-B", () => {
  const weeks = buildSchoolWeeks();
  const week = findSchoolWeekForDate(new Date(2026, 9, 13, 12), weeks);
  assert.equal(week.number, 9);
  assert.equal(week.kind, "A");
  assert.notEqual(week.number, 38);
});

test("sélection automatique — 7 octobre 2026 → semaine 8-B", () => {
  const week = findSchoolWeekForDate(new Date(2026, 9, 7, 12));
  assert.equal(week.number, 8);
  assert.equal(week.kind, "B");
});

test("sélection automatique — 13 octobre 2026 → semaine 9-A", () => {
  const week = findSchoolWeekForDate(new Date(2026, 9, 13, 12));
  assert.equal(week.number, 9);
  assert.equal(week.kind, "A");
});

test("sélection automatique — avant le début de l’année → semaine 1", () => {
  const week = findSchoolWeekForDate(new Date(2026, 7, 1, 12));
  assert.equal(week.number, 1);
});

test("sélection automatique — après la fin de l’année → semaine 38", () => {
  const week = findSchoolWeekForDate(new Date(2027, 6, 1, 12));
  assert.equal(week.number, 38);
});

test("resolveDisplayCourseDay — vacances d’automne → premier jour réel après, pas juin 2027", () => {
  const slot = resolveDisplayCourseDay(new Date(2026, 9, 13, 12));
  assert.equal(formatSchoolWeekLabel(slot), "Semaine 09-A");
  assert.equal(formatCourseDayHeading(slot), "Lundi 26 octobre");
  assert.notEqual(slot.schoolWeekNumber, 38);
});
