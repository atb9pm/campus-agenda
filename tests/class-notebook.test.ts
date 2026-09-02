import assert from "node:assert/strict";
import test from "node:test";

import { buildSchoolWeeks } from "../src/features/calendar/index.ts";
import {
  appendWeekNote,
  clampWeekDisplayCount,
  isClassNotesPayload,
  moveWeekNote,
  normalizeClassNotes,
  visibleSchoolWeeks,
  weekdayToCourseDayIndex,
  weekNotesKey,
} from "../src/features/class-notebook/index.ts";
import { TEACHER_CHF_ID } from "../src/features/classes/index.ts";
import {
  getMemoryTeacherNotesStore,
  resetMemoryTeacherNotesStore,
} from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlTeacherNotesStore } from "../src/lib/persistence/sql/sql-teacher-notes-store.ts";

test("class notebook — weekdayToCourseDayIndex ISO 1→0 … 5→4", () => {
  assert.equal(weekdayToCourseDayIndex(1), 0);
  assert.equal(weekdayToCourseDayIndex(2), 1);
  assert.equal(weekdayToCourseDayIndex(3), 2);
  assert.equal(weekdayToCourseDayIndex(4), 3);
  assert.equal(weekdayToCourseDayIndex(5), 4);
});

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

test("class notebook — validation et normalisation de payload HTTP", () => {
  assert.equal(isClassNotesPayload(null), false);
  assert.equal(isClassNotesPayload({ version: 1, weeks: {} }), true);
  assert.equal(
    isClassNotesPayload({
      version: 1,
      weeks: { "classe-a:1": [{ id: "n1", text: "ok" }] },
    }),
    true,
  );
  assert.equal(
    isClassNotesPayload({
      version: 1,
      weeks: { "classe-a:1": [{ id: "n1", text: 42 }] },
    }),
    false,
  );

  const normalized = normalizeClassNotes({
    version: 1,
    weeks: {
      "classe-a:1": [
        { id: "n1", text: "  Garder  " },
        { id: "n2", text: "   " },
      ],
    },
  });
  assert.deepEqual(normalized.weeks["classe-a:1"], [{ id: "n1", text: "Garder" }]);
});

test("class notebook — store mémoire get/save", async () => {
  resetMemoryTeacherNotesStore();
  const store = getMemoryTeacherNotesStore();
  assert.equal(await store.getNotes(TEACHER_CHF_ID), null);

  const document = appendWeekNote({ version: 1, weeks: {} }, "classe-chf-ma2:12", "Révision");
  const saved = await store.saveNotes(TEACHER_CHF_ID, document);
  assert.equal(saved.weeks["classe-chf-ma2:12"]?.[0]?.text, "Révision");
  assert.deepEqual(await store.getNotes(TEACHER_CHF_ID), saved);
});

test("class notebook — store SQLite migration et persistance", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const store = new SqlTeacherNotesStore(db);

  assert.equal(await store.getNotes(TEACHER_CHF_ID), null);

  const document = appendWeekNote({ version: 1, weeks: {} }, "classe-chf-ma2:3", "Atelier freins");
  const saved = await store.saveNotes(TEACHER_CHF_ID, document);
  assert.deepEqual(await store.getNotes(TEACHER_CHF_ID), saved);

  await store.saveNotes(TEACHER_CHF_ID, {
    version: 1,
    weeks: {
      "classe-chf-ma2:3": [{ id: "note-1", text: "  Mis à jour  " }],
      "classe-chf-ma2:4": [{ id: "note-2", text: "" }],
    },
  });
  const again = await store.getNotes(TEACHER_CHF_ID);
  assert.deepEqual(again?.weeks["classe-chf-ma2:3"], [{ id: "note-1", text: "Mis à jour" }]);
  assert.equal(again?.weeks["classe-chf-ma2:4"], undefined);

  db.close();
});
