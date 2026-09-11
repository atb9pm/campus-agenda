import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { authenticateStudentAccessCode } from "../src/features/student-access/authenticate.ts";
import {
  ADMIN_WORKING_YEAR_STORAGE_KEY,
  MISSING_END_REASON,
  MISSING_START_REASON,
  formatSchoolYearLabelFr,
  groupOfficialEventsByMonth,
  parseOfficialPlanFromLines,
  parseOfficialPlanPdf,
  resolveAdminWorkingYearId,
  schoolYearAlreadyExistsMessage,
  schoolYearStatusesAfterAdminWorkingYearChange,
  writeAdminWorkingYearId,
} from "../src/features/school-year/index.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { SQL_MIGRATION_FILES, applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlSchoolYearStore } from "../src/lib/persistence/sql/sql-school-year-store.ts";
import { resetStoreFactory } from "../src/lib/persistence/store-factory.ts";
import { resetActiveSchoolWeekEntries } from "../src/features/calendar/index.ts";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/Plan-scolarite-2028-2029.pdf",
);

const EXPECTED_EVENTS = [
  { label: "VACANCES D’AUTOMNE", startsOn: "2028-10-13", endsOn: "2028-10-30", kind: "VACATION" },
  { label: "LA TOUSSAINT", startsOn: "2028-11-01", endsOn: "2028-11-01", kind: "PUBLIC_HOLIDAY" },
  { label: "IMMACULEE CONCEPTION", startsOn: "2028-12-08", endsOn: "2028-12-08", kind: "PUBLIC_HOLIDAY" },
  { label: "VACANCES DE NOËL", startsOn: "2028-12-22", endsOn: "2029-01-08", kind: "VACATION" },
  { label: "VACANCES D’HIVER", startsOn: "2029-02-09", endsOn: "2029-02-19", kind: "VACATION" },
  { label: "SAINT-JOSEPH", startsOn: "2029-03-19", endsOn: "2029-03-19", kind: "PUBLIC_HOLIDAY" },
  { label: "VACANCES DE PÂQUES", startsOn: "2029-03-29", endsOn: "2029-04-09", kind: "VACATION" },
  { label: "ASCENSION", startsOn: "2029-05-09", endsOn: "2029-05-14", kind: "SCHOOL_CLOSED" },
  { label: "PENTECOTE", startsOn: "2029-05-21", endsOn: "2029-05-21", kind: "PUBLIC_HOLIDAY" },
  { label: "FÊTE-DIEU", startsOn: "2029-05-31", endsOn: "2029-05-31", kind: "PUBLIC_HOLIDAY" },
] as const;

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPlainTextPdf(lines: string[]): Uint8Array {
  const ops = ["BT", "/F1 11 Tf", "50 800 Td", "14 TL"];
  for (const line of lines) {
    ops.push(`(${escapePdfText(line)}) Tj`, "T*");
  }
  ops.push("ET");
  const stream = ops.join("\n");
  const encoder = new TextEncoder();
  const parts: string[] = ["%PDF-1.4\n"];
  const offsets = [0];
  function addObject(body: string): void {
    offsets.push(Buffer.byteLength(parts.join(""), "latin1"));
    parts.push(body.endsWith("\n") ? body : `${body}\n`);
  }
  addObject("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  addObject("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj");
  addObject(
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
  );
  addObject(`4 0 obj << /Length ${Buffer.byteLength(stream, "latin1")} >> stream\n${stream}\nendstream\nendobj`);
  addObject("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj");
  const xrefOffset = Buffer.byteLength(parts.join(""), "latin1");
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  parts.push(xref);
  parts.push(`trailer << /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return encoder.encode(parts.join(""));
}

const OFFICIAL_LINES_2028 = [
  "Plan de scolarite 2028 - 2029",
  "DEBUT DES COURS",
  "Lundi 21.08.2028 matin",
  "VACANCES D'AUTOMNE",
  "Vendredi 13.10.2028 soir",
  "Lundi 30.10.2028 matin",
  "LA TOUSSAINT",
  "Mercredi 01.11.2028",
  "IMMACULEE CONCEPTION",
  "Vendredi 08.12.2028",
  "VACANCES DE NOEL",
  "Vendredi 22.12.2028 soir",
  "Lundi 08.01.2029 matin",
  "VACANCES D'HIVER",
  "Vendredi 09.02.2029 soir",
  "Lundi 19.02.2029 matin",
  "SAINT-JOSEPH",
  "Lundi 19.03.2029",
  "VACANCES DE PAQUES",
  "Jeudi 29.03.2029 soir",
  "Lundi 09.04.2029 matin",
  "ASCENSION",
  "Mercredi 09.05.2029 soir",
  "Lundi 14.05.2029 matin",
  "PENTECOTE",
  "Lundi 21.05.2029",
  "FETE-DIEU",
  "Jeudi 31.05.2029",
  "FIN DES COURS",
  "Vendredi 22.06.2029 soir",
  "Total jours de cours : 183 jours",
  "Total semaines de cours : 38",
];

async function sqliteStore() {
  resetStoreFactory();
  resetActiveSchoolWeekEntries();
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  return { db, store: new SqlSchoolYearStore(db) };
}

function normalizeEventLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’'`]/g, "'")
    .toUpperCase();
}

test("version 2.48.0 — plan de scolarité, aucune migration", () => {
  assert.equal(APP_VERSION, "2.48.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0027_teacher_author_nullable.sql");
});

test("A — PDF officiel 2028-2029 : année, début, fin", async () => {
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.preview.label, "2028-2029");
  assert.equal(parsed.preview.startsOn, "2028-08-21");
  assert.equal(parsed.preview.endsOn, "2029-06-22");
  assert.equal(parsed.preview.totalCourseDays, 183);
  assert.equal(parsed.preview.totalCourseWeeks, 38);
});

test("B — événements explicites extraits avec les bonnes dates", async () => {
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.preview.events.length, EXPECTED_EVENTS.length);
  for (const expected of EXPECTED_EVENTS) {
    const found = parsed.preview.events.find(
      (event) =>
        normalizeEventLabel(event.label) === normalizeEventLabel(expected.label) &&
        event.startsOn === expected.startsOn &&
        event.endsOn === expected.endsOn,
    );
    assert.ok(found, `Événement manquant : ${expected.label}`);
    assert.equal(found?.kind, expected.kind, expected.label);
  }

  const october = groupOfficialEventsByMonth(parsed.preview.events, 2028).find((group) =>
    group.title.startsWith("Octobre"),
  );
  assert.ok(october);
  assert.equal(october?.events.length, 1);
  assert.match(october?.events[0]?.label ?? "", /AUTOMNE/i);
});

test("C/D/E — import DRAFT sans semaines A/B, 2026-2027 reste ACTIVE", async () => {
  const { db, store } = await sqliteStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  assert.ok(active);
  assert.equal(active?.label, "2026-2027");
  assert.equal(active?.status, "active");
  assert.equal(active?.weeks.length, 38);

  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const imported = await store.importOfficialCalendarDraft(parsed.preview, "Plan-scolarite-2028-2029.pdf");
  assert.equal(imported.year.label, "2028-2029");
  assert.equal(imported.year.status, "draft");
  assert.equal(imported.year.startsOn, "2028-08-21");
  assert.equal(imported.year.endsOn, "2029-06-22");
  assert.equal(imported.year.weeks.length, 0);
  assert.equal(imported.eventCount, EXPECTED_EVENTS.length);

  const stillActive = await store.getActiveSchoolYear();
  assert.equal(stillActive?.id, active?.id);
  assert.equal(stillActive?.label, "2026-2027");
  assert.equal(stillActive?.status, "active");
  assert.equal(stillActive?.weeks.length, 38);

  const years = await store.listSchoolYears();
  assert.equal(years.length, 2);
  assert.equal(years.filter((year) => year.status === "active").length, 1);
  assert.equal(years.filter((year) => year.status === "draft").length, 1);

  const exceptions = await store.listDayExceptions(imported.year.id);
  assert.ok(exceptions.length > 0);
  assert.ok(exceptions.every((entry) => entry.state === "holiday"));
  assert.ok(exceptions.some((entry) => entry.date === "2028-10-13"));
  assert.ok(exceptions.some((entry) => entry.date === "2028-10-30"));
  assert.ok(exceptions.some((entry) => entry.date === "2029-01-08"));

  db.close();
});

test("F — PDF sans date de début : refus clair", async () => {
  const lines = OFFICIAL_LINES_2028.filter((line) => !/DEBUT DES COURS|21\.08\.2028/.test(line));
  const parsed = await parseOfficialPlanPdf(buildPlainTextPdf(lines));
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.ok(parsed.errors.includes(MISSING_START_REASON));
});

test("G — PDF sans date de fin : refus clair", async () => {
  const lines = OFFICIAL_LINES_2028.filter((line) => !/FIN DES COURS|22\.06\.2029/.test(line));
  const parsed = await parseOfficialPlanPdf(buildPlainTextPdf(lines));
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.ok(parsed.errors.includes(MISSING_END_REASON));
});

test("H — événement ambigu : avertissement, aucune date inventée", () => {
  const parsed = parseOfficialPlanFromLines([
    ...OFFICIAL_LINES_2028.slice(0, 3),
    "VACANCES DE PRINTEMPS",
    ...OFFICIAL_LINES_2028.slice(3),
  ]);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.preview.startsOn, "2028-08-21");
  assert.equal(parsed.preview.endsOn, "2029-06-22");
  assert.equal(
    parsed.preview.events.some((event) => /PRINTEMPS/i.test(event.label)),
    false,
  );
  assert.ok(parsed.preview.warnings.some((warning) => /PRINTEMPS/i.test(warning.message)));
  assert.ok(parsed.preview.warnings.some((warning) => /n’ont pas pu être interprétés automatiquement|n’a pas pu être interprété automatiquement/.test(warning.message)));
});

test("I — année déjà existante : pas de doublon", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  await store.importOfficialCalendarDraft(parsed.preview, "Plan-scolarite-2028-2029.pdf");
  await assert.rejects(
    () => store.importOfficialCalendarDraft(parsed.preview, "Plan-scolarite-2028-2029.pdf"),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message, schoolYearAlreadyExistsMessage("2028-2029"));
      assert.equal((error as Error).message, "L’année scolaire 2028–2029 existe déjà.");
      return true;
    },
  );
  const years = await store.listSchoolYears();
  assert.equal(years.filter((year) => year.label === "2028-2029").length, 1);

  const replaced = await store.importOfficialCalendarDraft(parsed.preview, "Plan-scolarite-2028-2029.pdf", {
    replaceDraft: true,
  });
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.year.status, "draft");
  assert.equal((await store.listSchoolYears()).filter((year) => year.label === "2028-2029").length, 1);
  db.close();
});

test("J — changer l’année de travail admin ne modifie aucun SchoolYear.status", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const draft = await store.importOfficialCalendarDraft(parsed.preview);
  const before = await store.listSchoolYears();
  const storage = new Map<string, string>();
  writeAdminWorkingYearId(
    {
      setItem: (key, value) => storage.set(key, value),
    },
    draft.year.id,
  );
  const after = await store.listSchoolYears();
  assert.deepEqual(
    after.map((year) => [year.id, year.status]),
    before.map((year) => [year.id, year.status]),
  );
  assert.equal(storage.get(ADMIN_WORKING_YEAR_STORAGE_KEY), draft.year.id);
  assert.equal(resolveAdminWorkingYearId(after, draft.year.id), draft.year.id);
  assert.deepEqual(
    schoolYearStatusesAfterAdminWorkingYearChange(after, draft.year.id),
    after.map((year) => year.status),
  );
  db.close();
});

test("K — enseignant : année opérationnelle 2026-2027 inchangée", async () => {
  const { db, store } = await sqliteStore();
  await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  await store.importOfficialCalendarDraft(parsed.preview);
  const operational = await store.getActiveSchoolYear();
  assert.equal(operational?.label, "2026-2027");
  assert.equal(operational?.status, "active");
  assert.equal(operational?.weeks.length, 38);
  db.close();
});

test("L — élève : année DRAFT inaccessible", async () => {
  const { db, store } = await sqliteStore();
  const active = await store.seedDefaultActiveYearIfEmpty();
  const parsed = await parseOfficialPlanPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const draft = await store.importOfficialCalendarDraft(parsed.preview);

  const login = await authenticateStudentAccessCode("MA1-AAAA-BBBB", {
    getActiveSchoolYear: () => store.getActiveSchoolYear(),
    listClasses: async () => [
      {
        id: "class-draft",
        code: "MA1",
        label: "MA1 DRAFT",
        sortOrder: 1,
        isActive: true,
        schoolYearId: draft.year.id,
        schoolYearLabel: draft.year.label,
        professionId: null,
        trainingYear: 1,
        parallelCode: "A",
        isArchived: false,
        archivedAt: null,
      },
    ],
    getAccessBySchoolClassId: async () => null,
    findClassroomBySchoolClassId: async () => null,
  });
  assert.equal(login.ok, false);
  assert.equal((await store.getActiveSchoolYear())?.id, active?.id);
  db.close();
});

test("libellé français 2028–2029", () => {
  assert.equal(formatSchoolYearLabelFr("2028-2029"), "2028–2029");
});
