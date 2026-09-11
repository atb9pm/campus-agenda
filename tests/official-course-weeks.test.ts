import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";
import {
  expandOfficialEventsToExceptions,
  formatPedagogicalWeekLabel,
  generateOfficialCourseWeeks,
  officialCourseWeekCountMismatchMessage,
  parseOfficialPlanPdf,
} from "../src/features/school-year/index.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
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
import type { SchoolWeekEntry } from "../src/features/school-year/types.ts";

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

function holidaySet(exceptions: { date: string }[]): Set<string> {
  return new Set(exceptions.map((entry) => entry.date));
}

function weekHasOpenSchoolDay(
  week: SchoolWeekEntry,
  startsOn: string,
  endsOn: string,
  holidays: Set<string>,
): boolean {
  for (let offset = 0; offset < 5; offset += 1) {
    const date = new Date(`${week.monday}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    const iso = date.toISOString().slice(0, 10);
    if (iso < startsOn || iso > endsOn) continue;
    if (!holidays.has(iso)) return true;
  }
  return false;
}

test("version 2.49.0", () => {
  assert.equal(APP_VERSION, "2.52.2");
});

test("2028-2029 : exactement 38 semaines A/B pédagogiques, 1→38", async () => {
  const { db, store } = await sqliteStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const imported = await store.importOfficialCalendarDraft(parsed.preview, "Plan-scolarite-2028-2029.pdf");
  assert.equal(imported.year.label, "2028-2029");
  assert.equal(imported.year.status, "draft");
  assert.equal(imported.year.startsOn, "2028-08-21");
  assert.equal(imported.year.endsOn, "2029-06-22");
  assert.equal(imported.year.weeks.length, 38);
  assert.deepEqual(
    imported.year.weeks.map((week) => week.number),
    Array.from({ length: 38 }, (_, index) => index + 1),
  );
  assert.ok(imported.year.weeks.every((week) => week.kind === "A" || week.kind === "B"));
  assert.equal(imported.year.weeks[0]?.kind, "A");
  assert.equal(imported.year.weeks[37]?.kind, "B");
  assert.equal(imported.year.weeks[0]?.monday, "2028-08-21");
  assert.equal(imported.year.weeks[37]?.monday, "2029-06-18");

  const exceptions = await store.listDayExceptions(imported.year.id);
  const holidays = holidaySet(exceptions);
  for (const week of imported.year.weeks) {
    assert.ok(
      weekHasOpenSchoolDay(week, imported.year.startsOn, imported.year.endsOn, holidays),
      `semaine ${week.number} (${week.monday}) sans jour de cours`,
    );
  }

  const generated = generateOfficialCourseWeeks({
    startsOn: parsed.preview.startsOn,
    endsOn: parsed.preview.endsOn,
    exceptions,
  });
  assert.equal(generated.weeks.length, 38);
  assert.equal(generated.examinedCalendarWeekCount, 44);
  assert.equal(generated.excludedFullyClosedWeekCount, 6);
  assert.equal(parsed.preview.totalCourseWeeks, 38);

  assert.equal(active?.status, "active");
  assert.equal(active?.weeks.length, 38);
  assert.ok(active?.weeks.every((week) => week.kind === "A" || week.kind === "B"));
  assert.equal((await store.getActiveSchoolYear())?.id, active?.id);
  db.close();
});

test("vacances : semaine partielle conservée, semaine fermée exclue, reprise conservée", async () => {
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const exceptions = expandOfficialEventsToExceptions(parsed.preview.events);
  const generated = generateOfficialCourseWeeks({
    startsOn: parsed.preview.startsOn,
    endsOn: parsed.preview.endsOn,
    exceptions,
  });
  const mondays = new Set(generated.weeks.map((week) => week.monday));

  assert.ok(mondays.has("2028-10-09"), "semaine du vendredi soir de départ en vacances");
  assert.equal(mondays.has("2028-10-16"), false, "semaine entièrement dans les vacances d’automne");
  assert.equal(mondays.has("2028-10-23"), false, "semaine entièrement dans les vacances d’automne");
  assert.ok(mondays.has("2028-10-30"), "semaine de reprise lundi matin");

  assert.ok(mondays.has("2028-12-18"), "semaine contenant le vendredi soir de Noël");
  assert.equal(mondays.has("2028-12-25"), false);
  assert.equal(mondays.has("2029-01-01"), false);
  assert.ok(mondays.has("2029-01-08"), "reprise de Noël");

  assert.ok(mondays.has("2029-02-05"));
  assert.equal(mondays.has("2029-02-12"), false, "semaine entièrement dans les vacances d’hiver");
  assert.ok(mondays.has("2029-02-19"));

  assert.ok(mondays.has("2029-03-26"));
  assert.equal(mondays.has("2029-04-02"), false, "semaine entièrement dans les vacances de Pâques");
  assert.ok(mondays.has("2029-04-09"));

  assert.ok(mondays.has("2028-10-30"), "Toussaint : semaine avec férié conservée");
  assert.ok(mondays.has("2029-05-07"), "Ascension : semaine partielle conservée");
});

test("total officiel 38 vs génération 37 : refus, aucune semaine artificielle", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const truncated = generateOfficialCourseWeeks({
    startsOn: parsed.preview.startsOn,
    endsOn: "2029-06-15",
    exceptions: expandOfficialEventsToExceptions(parsed.preview.events),
  });
  assert.equal(truncated.weeks.length, 37);

  await assert.rejects(
    () =>
      store.importOfficialCalendarDraft(
        { ...parsed.preview, endsOn: "2029-06-15", totalCourseWeeks: 38 },
        "Plan-scolarite-2028-2029.pdf",
      ),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message, officialCourseWeekCountMismatchMessage(37, 38));
      return true;
    },
  );
  assert.equal((await store.listSchoolYears()).some((year) => year.label === "2028-2029"), false);
  db.close();
});

test("non-régression A/B : 2026-2027 conserve A puis B", async () => {
  const { db, store } = await sqliteStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  assert.equal(active?.weeks[0]?.kind, "A");
  assert.equal(active?.weeks[1]?.kind, "B");
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  await store.importOfficialCalendarDraft(parsed.preview);
  const still = await store.getActiveSchoolYear();
  assert.equal(still?.id, active?.id);
  assert.equal(still?.weeks[0]?.kind, "A");
  assert.equal(still?.weeks[1]?.kind, "B");
  assert.deepEqual(
    still?.weeks.map((week) => [week.number, week.kind, week.monday]),
    active?.weeks.map((week) => [week.number, week.kind, week.monday]),
  );
  db.close();
});

test("replaceDraft recalcule 38 semaines sans duplication", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const first = await store.importOfficialCalendarDraft(parsed.preview);
  assert.equal(first.year.weeks.length, 38);
  const second = await store.importOfficialCalendarDraft(parsed.preview, "retry.pdf", { replaceDraft: true });
  assert.equal(second.replaced, true);
  assert.equal(second.year.weeks.length, 38);
  assert.equal(second.year.id, first.year.id);
  const loaded = await store.getSchoolYearById(first.year.id);
  assert.equal(loaded?.weeks.length, 38);
  db.close();
});

test("multi-années : ACTIVE A/B isolée du DRAFT A/B généré", async () => {
  const { db, store } = await sqliteStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const draft = await store.importOfficialCalendarDraft(parsed.preview);
  const years = await store.listSchoolYears();
  assert.equal(years.filter((year) => year.status === "active").length, 1);
  assert.equal((await store.getActiveSchoolYear())?.id, active?.id);

  const activeWeeks = (await store.getSchoolYearById(active!.id))!.weeks;
  const draftWeeks = (await store.getSchoolYearById(draft.year.id))!.weeks;
  assert.equal(activeWeeks.length, 38);
  assert.equal(draftWeeks.length, 38);
  assert.ok(activeWeeks.every((week) => week.kind === "A" || week.kind === "B"));
  assert.ok(draftWeeks.every((week) => week.kind === "A" || week.kind === "B"));
  assert.equal(draftWeeks[0]?.kind, "A");
  assert.equal(draftWeeks[37]?.kind, "B");
  assert.ok(activeWeeks.every((week) => week.monday.startsWith("2026") || week.monday.startsWith("2027")));
  assert.ok(draftWeeks.every((week) => week.monday.startsWith("2028") || week.monday.startsWith("2029")));
  db.close();
});

test("libellé : Semaine 01 sans A/B, Semaine 01-A avec A/B", () => {
  assert.equal(formatPedagogicalWeekLabel({ number: 1, kind: null }), "Semaine 01");
  assert.equal(formatPedagogicalWeekLabel({ number: 1, kind: "A" }), "Semaine 01-A");
  assert.equal(formatPedagogicalWeekLabel({ number: 2, kind: "B" }), "Semaine 02-B");
});

test("année DRAFT sans horaires : aucune CourseSession artificielle", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const imported = await store.importOfficialCalendarDraft(parsed.preview);
  const sessions = computeCourseSessions({
    schoolYearId: imported.year.id,
    courses: [],
    slots: [],
    weeks: imported.year.weeks,
    exceptions: await store.listDayExceptions(imported.year.id),
  });
  assert.equal(sessions.length, 0);
  db.close();
});

test("backup v4 : week_kind null round-trip et A/B historique", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  await store.importOfficialCalendarDraft(parsed.preview);

  const weekKindSpec = CAMPUS_BACKUP_COLUMNS.school_weeks.find((column) => column.name === "week_kind");
  assert.equal(weekKindSpec?.required, undefined);

  const dump = await dumpCampusTables(db);
  const nullKind = dump.school_weeks?.filter((row) => row.week_kind == null) ?? [];
  const abKind = dump.school_weeks?.filter((row) => row.week_kind === "A" || row.week_kind === "B") ?? [];
  assert.equal(nullKind.length, 0);
  assert.equal(abKind.length, 76);

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
  const restoredNull = again.school_weeks?.filter((row) => row.week_kind == null) ?? [];
  const restoredAb = again.school_weeks?.filter((row) => row.week_kind === "A" || row.week_kind === "B") ?? [];
  assert.equal(restoredNull.length, 0);
  assert.equal(restoredAb.length, 76);
  assert.deepEqual(canonicalizeCampusDump(again).school_weeks, canonicalizeCampusDump(dump).school_weeks);

  const store2 = new SqlSchoolYearStore(db2);
  const years = await store2.listSchoolYears();
  const draft = years.find((year) => year.label === "2028-2029");
  const active = years.find((year) => year.label === "2026-2027");
  assert.equal((await store2.getSchoolYearById(draft!.id))?.weeks[0]?.kind, "A");
  assert.equal((await store2.getSchoolYearById(draft!.id))?.weeks[37]?.kind, "B");
  assert.equal((await store2.getSchoolYearById(active!.id))?.weeks[0]?.kind, "A");
  db.close();
  db2.close();
});
