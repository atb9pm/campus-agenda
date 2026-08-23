import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SCHOOL_WEEK_MONDAYS } from "../src/features/calendar/school-week-dates.ts";
import { buildSchoolWeeks, setActiveSchoolWeekEntries, resetActiveSchoolWeekEntries } from "../src/features/calendar/index.ts";
import { isReceivableWeekPlan, parseWeekPlanPdf } from "../src/features/school-year/index.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlSchoolYearStore } from "../src/lib/persistence/sql/sql-school-year-store.ts";
import { resetStoreFactory } from "../src/lib/persistence/store-factory.ts";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/SemainesA-B26-27.pdf",
);

test("phase 2.0 — PDF officiel 2026-2027 recevable (38 semaines A/B)", async () => {
  const pdfBytes = new Uint8Array(readFileSync(fixturePath));
  const plan = await parseWeekPlanPdf(pdfBytes);

  assert.equal(plan.label, "2026-2027");
  assert.equal(plan.weeks.length, 38);
  assert.equal(isReceivableWeekPlan(plan), true);
  assert.equal(plan.warnings.length, 0);

  for (const entry of plan.weeks) {
    const expected = SCHOOL_WEEK_MONDAYS.find((week) => week.number === entry.number);
    assert.ok(expected, `Semaine ${entry.number} attendue dans le référentiel`);
    assert.equal(entry.monday, expected.monday, `Lundi semaine ${entry.number}`);
    assert.equal(entry.kind, expected.kind, `Type semaine ${entry.number}`);
  }
});

test("phase 2.0 — import et activation en base SQLite", async () => {
  resetStoreFactory();
  resetActiveSchoolWeekEntries();

  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);

  const store = new SqlSchoolYearStore(db);
  const pdfBytes = new Uint8Array(readFileSync(fixturePath));
  const plan = await parseWeekPlanPdf(pdfBytes);
  const draft = await store.importDraftFromPlan(plan, "SemainesA-B26-27.pdf");

  assert.equal(draft.status, "draft");
  assert.equal(draft.weeks.length, 38);

  const active = await store.activateSchoolYear(draft.id);
  assert.equal(active.status, "active");
  assert.equal(active.label, "2026-2027");

  setActiveSchoolWeekEntries(active.weeks);
  const weeks = buildSchoolWeeks();
  assert.equal(weeks.length, 38);
  assert.equal(weeks[0].number, 1);
  assert.equal(weeks[0].monday.toISOString().slice(0, 10), "2026-08-17");

  db.close();
});
