import assert from "node:assert/strict";
import test from "node:test";

import {
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
