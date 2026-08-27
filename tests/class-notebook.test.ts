import assert from "node:assert/strict";
import test from "node:test";

import { buildSchoolWeeks } from "../src/features/calendar/index.ts";
import {
  appendWeekNote,
  clampWeekDisplayCount,
  moveWeekNote,
  visibleSchoolWeeks,
  weekNotesKey,
} from "../src/features/class-notebook/index.ts";

test("class notebook — affichage 3 semaines centré", () => {
  const weeks = buildSchoolWeeks();
  assert.ok(weeks.length >= 3);
  const center = weeks[10]?.number ?? weeks[0].number;
  const visible = visibleSchoolWeeks(weeks, center, 3);
  assert.equal(visible.length, 3);
  assert.equal(visible[1]?.number, center);
});

test("class notebook — sélecteur 1 à 4 semaines", () => {
  assert.equal(clampWeekDisplayCount(0), 1);
  assert.equal(clampWeekDisplayCount(3), 3);
  assert.equal(clampWeekDisplayCount(6), 4);
});

test("class notebook — notes prof déplaçables entre semaines", () => {
  const key10 = weekNotesKey("classe-chf-ma2", 10);
  const key11 = weekNotesKey("classe-chf-ma2", 11);
  let document = appendWeekNote({ version: 1, weeks: {} }, key10, "Prévoir démo");
  const noteId = document.weeks[key10]?.[0]?.id;
  assert.ok(noteId);
  document = moveWeekNote(document, key10, key11, noteId!);
  assert.equal(document.weeks[key10]?.length ?? 0, 0);
  assert.equal(document.weeks[key11]?.[0]?.text, "Prévoir démo");
});
