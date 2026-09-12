import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { ARCHIVED_YEAR_MUTATION_REASON } from "../src/features/school-catalog/school-year-attachment.ts";
import { DRAFT_YEAR_ASSIGNMENT_REASON } from "../src/features/annual-courses/index.ts";
import {
  buildSchoolDayPlan,
  countClassDays,
  listHolidayDays,
  valaisHolidaysForSchoolYear,
} from "../src/features/school-days/index.ts";
import {
  ADMIN_WORKING_YEAR_STORAGE_KEY,
  applyDefaultPedagogicalWeekKinds,
  ensurePedagogicalWeekKinds,
  expandOfficialEventsToExceptions,
  generateOfficialCourseWeeks,
  parseOfficialPlanPdf,
  pedagogicalWeekKind,
  preserveExistingPedagogicalWeekKinds,
  schoolWeeksHaveLocalChanges,
  schoolYearStatusesAfterAdminWorkingYearChange,
  writeAdminWorkingYearId,
} from "../src/features/school-year/index.ts";
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";
import { SQL_MIGRATION_FILES, applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { SqlSchoolYearStore } from "../src/lib/persistence/sql/sql-school-year-store.ts";
import { resetStoreFactory } from "../src/lib/persistence/store-factory.ts";
import { resetActiveSchoolWeekEntries } from "../src/features/calendar/index.ts";
import { CAMPUS_BACKUP_COLUMNS } from "../src/lib/persistence/campus-backup-tables.ts";
import {
  canonicalizeCampusDump,
  dumpCampusTables,
  restoreCampusTables,
  validateCampusTables,
} from "../src/lib/persistence/sql/sql-campus-backup.ts";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/Plan-scolarite-2028-2029.pdf",
);

async function sqliteStore() {
  resetStoreFactory();
  resetActiveSchoolWeekEntries();
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  return { db, store: new SqlSchoolYearStore(db) };
}

function weekdayHolidays(monday: string, weekCount: number): Array<{ date: string; state: "holiday" }> {
  const holidays: Array<{ date: string; state: "holiday" }> = [];
  for (let week = 0; week < weekCount; week += 1) {
    for (let offset = 0; offset < 5; offset += 1) {
      const date = new Date(`${monday}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + week * 7 + offset);
      holidays.push({ date: date.toISOString().slice(0, 10), state: "holiday" });
    }
  }
  return holidays;
}

test("version 2.51.0 — plan complet année en préparation, sans migration", () => {
  assert.equal(APP_VERSION, "2.53.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0029_admin_mfa.sql");
});

test("règle A/B : 38 semaines pédagogiques impair A / pair B", () => {
  for (let number = 1; number <= 38; number += 1) {
    assert.equal(pedagogicalWeekKind(number), number % 2 === 1 ? "A" : "B", `S${String(number).padStart(2, "0")}`);
  }
});

test("vacances complètes : deux semaines civiles fermées n’avancent ni le numéro ni A/B", () => {
  const generated = generateOfficialCourseWeeks({
    startsOn: "2028-08-21",
    endsOn: "2028-11-10",
    exceptions: weekdayHolidays("2028-10-16", 2),
  });

  const week8 = generated.weeks.find((week) => week.monday === "2028-10-09");
  const week9 = generated.weeks.find((week) => week.monday === "2028-10-30");
  assert.equal(week8?.number, 8);
  assert.equal(week8?.kind, "B");
  assert.equal(week9?.number, 9);
  assert.equal(week9?.kind, "A");
  assert.equal(
    generated.weeks.some((week) => week.monday === "2028-10-16" || week.monday === "2028-10-23"),
    false,
  );
  assert.equal(generated.excludedFullyClosedWeekCount, 2);
});

test("semaine partiellement fermée : reste numérotée et participe à A/B", () => {
  const generated = generateOfficialCourseWeeks({
    startsOn: "2028-08-21",
    endsOn: "2028-11-10",
    exceptions: [
      ...weekdayHolidays("2028-10-16", 2),
      { date: "2028-10-11", state: "holiday" },
    ],
  });
  const partial = generated.weeks.find((week) => week.monday === "2028-10-09");
  assert.equal(partial?.number, 8);
  assert.equal(partial?.kind, "B");
});

test("fixture 2028-2029 : 38 semaines, S01=A 21.08.2028, S38=B 18.06.2029", async () => {
  const { db, store } = await sqliteStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const imported = await store.importOfficialCalendarDraft(parsed.preview, "Plan-scolarite-2028-2029.pdf");
  assert.equal(imported.year.label, "2028-2029");
  assert.equal(imported.year.status, "draft");
  assert.equal(imported.year.weeks.length, 38);
  assert.equal(imported.year.weeks[0]?.number, 1);
  assert.equal(imported.year.weeks[0]?.kind, "A");
  assert.equal(imported.year.weeks[0]?.monday, "2028-08-21");
  assert.equal(imported.year.weeks[37]?.number, 38);
  assert.equal(imported.year.weeks[37]?.kind, "B");
  assert.equal(imported.year.weeks[37]?.monday, "2029-06-18");
  assert.deepEqual(
    imported.year.weeks.map((week) => week.kind),
    Array.from({ length: 38 }, (_, index) => (index % 2 === 0 ? "A" : "B")),
  );

  const generated = generateOfficialCourseWeeks({
    startsOn: parsed.preview.startsOn,
    endsOn: parsed.preview.endsOn,
    exceptions: expandOfficialEventsToExceptions(parsed.preview.events),
  });
  assert.equal(generated.excludedFullyClosedWeekCount, 6);
  assert.equal(generated.weeks.length, 38);

  const autumn8 = generated.weeks.find((week) => week.monday === "2028-10-09");
  const autumn9 = generated.weeks.find((week) => week.monday === "2028-10-30");
  assert.equal(autumn8?.number, 8);
  assert.equal(autumn8?.kind, "B");
  assert.equal(autumn9?.number, 9);
  assert.equal(autumn9?.kind, "A");

  assert.equal(active?.status, "active");
  assert.equal(active?.label, "2026-2027");
  assert.equal((await store.getActiveSchoolYear())?.id, active?.id);
  db.close();
});

test("2026-2027 conserve ses A/B existants ; 2028-2029 reçoit la génération", async () => {
  const { db, store } = await sqliteStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  const activeKinds = active!.weeks.map((week) => [week.number, week.kind, week.monday]);
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  await store.importOfficialCalendarDraft(parsed.preview);
  const still = await store.getActiveSchoolYear();
  assert.deepEqual(
    still?.weeks.map((week) => [week.number, week.kind, week.monday]),
    activeKinds,
  );
  const draft = (await store.listSchoolYears()).find((year) => year.label === "2028-2029");
  const draftWeeks = (await store.getSchoolYearById(draft!.id))!.weeks;
  assert.equal(draftWeeks[0]?.kind, "A");
  assert.equal(draftWeeks[37]?.kind, "B");
  db.close();
});

test("correction manuelle A→B : persistée, locale, sans cascade ; annulation locale", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const imported = await store.importOfficialCalendarDraft(parsed.preview);
  const original = imported.year.weeks;
  assert.equal(original[0]?.kind, "A");
  assert.equal(original[11]?.kind, "B");

  const unsaved = original.map((week) => (week.number === 1 ? { ...week, kind: "B" as const } : week));
  assert.equal(schoolWeeksHaveLocalChanges(original, unsaved), true);
  const cancelled = original.map((week) => ({ ...week }));
  assert.equal(schoolWeeksHaveLocalChanges(original, cancelled), false);
  assert.equal((await store.getSchoolYearById(imported.year.id))?.weeks[0]?.kind, "A");

  const patched = original.map((week) => (week.number === 12 ? { ...week, kind: "A" as const } : week));
  await store.replaceSchoolYearWeeks(imported.year.id, patched);
  const reloaded = (await store.getSchoolYearById(imported.year.id))!.weeks;
  assert.equal(reloaded[11]?.kind, "A");
  assert.equal(reloaded[0]?.kind, "A");
  assert.equal(reloaded[12]?.kind, original[12]?.kind);
  assert.equal(reloaded[13]?.kind, original[13]?.kind);
  assert.deepEqual(
    reloaded.filter((week) => week.number !== 12).map((week) => [week.number, week.kind, week.monday]),
    original.filter((week) => week.number !== 12).map((week) => [week.number, week.kind, week.monday]),
  );
  db.close();
});

test("correction du lundi de référence persistée et isolée", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const imported = await store.importOfficialCalendarDraft(parsed.preview);
  const originalMonday = imported.year.weeks[11]?.monday;
  const patched = imported.year.weeks.map((week) =>
    week.number === 12 ? { ...week, monday: "2028-08-14" } : week,
  );
  await store.replaceSchoolYearWeeks(imported.year.id, patched);
  const reloaded = (await store.getSchoolYearById(imported.year.id))!.weeks;
  assert.equal(reloaded[11]?.monday, "2028-08-14");
  assert.notEqual(reloaded[11]?.monday, originalMonday);
  assert.equal(reloaded[10]?.monday, imported.year.weeks[10]?.monday);
  db.close();
});

test("correction d’un jour de classe / sans cours isolée par année", async () => {
  const { db, store } = await sqliteStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const draft = await store.importOfficialCalendarDraft(parsed.preview);
  const activeBefore = await store.listDayExceptions(active!.id);

  await store.setDayException(draft.year.id, "2028-08-22", {
    state: "holiday",
    label: "Journée sportive",
  });
  const draftExceptions = await store.listDayExceptions(draft.year.id);
  assert.ok(draftExceptions.some((entry) => entry.date === "2028-08-22" && entry.state === "holiday"));
  assert.deepEqual(await store.listDayExceptions(active!.id), activeBefore);

  const holidays = valaisHolidaysForSchoolYear(draft.year.label);
  const rows = buildSchoolDayPlan(draft.year.weeks, holidays, draftExceptions);
  const classDays = countClassDays(rows);
  const closedDays = listHolidayDays(rows);
  assert.ok(classDays > 0);
  assert.ok(closedDays.some((day) => day.date === "2028-08-22"));
  db.close();
});

test("réimport DRAFT : conserve A/B si le lundi est inchangé ; nouvelle semaine reçoit la règle", () => {
  const generated: SchoolWeekEntry[] = [
    { number: 1, kind: "A", monday: "2028-08-21" },
    { number: 2, kind: "B", monday: "2028-08-28" },
    { number: 3, kind: "A", monday: "2028-09-04" },
  ];
  const existing: SchoolWeekEntry[] = [
    { number: 1, kind: "B", monday: "2028-08-21" },
    { number: 2, kind: "B", monday: "2028-08-28" },
  ];
  const merged = preserveExistingPedagogicalWeekKinds(generated, existing);
  assert.equal(merged[0]?.kind, "B");
  assert.equal(merged[1]?.kind, "B");
  assert.equal(merged[2]?.kind, "A");
});

test("réimport SQLite : correction A/B conservée, 2026-2027 intact", async () => {
  const { db, store } = await sqliteStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const first = await store.importOfficialCalendarDraft(parsed.preview);
  const corrected = first.year.weeks.map((week) =>
    week.number === 1 ? { ...week, kind: "B" as const } : week,
  );
  await store.replaceSchoolYearWeeks(first.year.id, corrected);
  const replaced = await store.importOfficialCalendarDraft(parsed.preview, "retry.pdf", { replaceDraft: true });
  assert.equal(replaced.year.weeks[0]?.kind, "B");
  assert.equal(replaced.year.weeks[1]?.kind, "B");
  assert.equal(replaced.year.weeks[11]?.kind, "B");
  const stillActive = await store.getActiveSchoolYear();
  assert.equal(stillActive?.id, active?.id);
  assert.equal(stillActive?.weeks[0]?.kind, active?.weeks[0]?.kind);
  db.close();
});

test("kind null existant : initialisation impair=A / pair=B sans toucher aux A/B déjà posés", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const imported = await store.importOfficialCalendarDraft(parsed.preview);
  const withNulls = imported.year.weeks.map((week) =>
    week.number === 4 ? { ...week, kind: "A" as const } : { ...week, kind: null },
  );
  await store.replaceSchoolYearWeeks(imported.year.id, withNulls);
  const filled = await ensurePedagogicalWeekKinds(store, (await store.getSchoolYearById(imported.year.id))!);
  assert.equal(filled.weeks[0]?.kind, "A");
  assert.equal(filled.weeks[1]?.kind, "B");
  assert.equal(filled.weeks[3]?.kind, "A");
  const persisted = (await store.getSchoolYearById(imported.year.id))!.weeks;
  assert.equal(persisted[3]?.kind, "A");
  assert.equal(applyDefaultPedagogicalWeekKinds(withNulls)[3]?.kind, "A");
  db.close();
});

test("année ARCHIVED : refuse A/B et jours ; DRAFT et ACTIVE restent éditables", async () => {
  const { db, store } = await sqliteStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const draft = await store.importOfficialCalendarDraft(parsed.preview);

  await store.replaceSchoolYearWeeks(
    draft.year.id,
    draft.year.weeks.map((week) => (week.number === 2 ? { ...week, kind: "A" as const } : week)),
  );
  await store.setDayException(active!.id, "2026-08-18", { state: "holiday", label: "Test actif" });

  await db.prepare("UPDATE school_years SET status = 'archived' WHERE id = ?").bind(draft.year.id).run();
  const archived = await store.getSchoolYearById(draft.year.id);
  assert.equal(archived?.status, "archived");

  await assert.rejects(
    () => store.replaceSchoolYearWeeks(draft.year.id, archived!.weeks),
    (error: unknown) => {
      assert.equal((error as Error).message, ARCHIVED_YEAR_MUTATION_REASON);
      return true;
    },
  );
  await assert.rejects(
    () => store.setDayException(draft.year.id, "2028-08-22", { state: "holiday", label: "Refusé" }),
    (error: unknown) => {
      assert.equal((error as Error).message, ARCHIVED_YEAR_MUTATION_REASON);
      return true;
    },
  );

  const stillActive = await store.getActiveSchoolYear();
  assert.equal(stillActive?.status, "active");
  await store.replaceSchoolYearWeeks(stillActive!.id, stillActive!.weeks);
  db.close();
});

test("changer l’année de travail ne modifie aucun SchoolYear.status", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const draft = await store.importOfficialCalendarDraft(parsed.preview);
  const years = await store.listSchoolYears();
  const storage = new Map<string, string>();
  writeAdminWorkingYearId({ setItem: (key, value) => storage.set(key, value) }, draft.year.id);
  assert.equal(storage.get(ADMIN_WORKING_YEAR_STORAGE_KEY), draft.year.id);
  assert.deepEqual(schoolYearStatusesAfterAdminWorkingYearChange(years, draft.year.id), years.map((year) => year.status));
  const after = await store.listSchoolYears();
  assert.deepEqual(
    after.map((year) => [year.id, year.status]),
    years.map((year) => [year.id, year.status]),
  );
  db.close();
});

test("aucune affectation professeur n’est introduite par le plan DRAFT", () => {
  assert.match(DRAFT_YEAR_ASSIGNMENT_REASON, /DRAFT|brouillon|préparation|affectation/i);
});

test("backup v4 : A/B DRAFT restaurables, week_kind null toujours accepté", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  await store.importOfficialCalendarDraft(parsed.preview);

  const weekKindSpec = CAMPUS_BACKUP_COLUMNS.school_weeks.find((column) => column.name === "week_kind");
  assert.equal(weekKindSpec?.required, undefined);

  const dump = await dumpCampusTables(db);
  const abKind = dump.school_weeks?.filter((row) => row.week_kind === "A" || row.week_kind === "B") ?? [];
  assert.equal(abKind.length, 76);
  const draftWeek = dump.school_weeks?.find((row) => row.week_kind === "A" && String(row.monday).startsWith("2028"));
  assert.ok(draftWeek);
  draftWeek.week_kind = null;

  dump.teachers = [
    {
      id: "admin-1",
      display_name: "Admin",
      initials: "Ad",
      password_hash: "x",
      is_admin: 1,
      is_active: 1,
    },
  ];
  const validated = validateCampusTables(dump);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.reason);

  const db2 = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db2);
  await restoreCampusTables(db2, dump);
  const again = await dumpCampusTables(db2);
  assert.equal(
    again.school_weeks?.some((row) => row.week_kind == null && String(row.monday).startsWith("2028")),
    true,
  );
  assert.deepEqual(canonicalizeCampusDump(again).school_weeks, canonicalizeCampusDump(dump).school_weeks);

  const store2 = new SqlSchoolYearStore(db2);
  const years = await store2.listSchoolYears();
  const active = years.find((year) => year.label === "2026-2027");
  assert.equal((await store2.getSchoolYearById(active!.id))?.weeks[0]?.kind, "A");
  db.close();
  db2.close();
});
