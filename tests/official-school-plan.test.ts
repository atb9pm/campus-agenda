import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { APP_VERSION } from "../src/lib/app-version.ts";
import { authenticateStudentAccessCode } from "../src/features/student-access/authenticate.ts";
import {
  ADMIN_WORKING_YEAR_STORAGE_KEY,
  MISSING_END_REASON,
  MISSING_START_REASON,
  closedDaysFromOfficialEvent,
  eachIsoDateInclusive,
  expandOfficialEventsToExceptions,
  formatSchoolYearLabelFr,
  groupOfficialEventsByMonth,
  parseOfficialPlanFromLines,
  parseOfficialPlanPdf,
  detectAndParseSchoolYearPdf,
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
import { resolvePdfWorkerPath } from "../src/lib/pdf/open-pdf-document.ts";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/Plan-scolarite-2028-2029.pdf",
);

const EXPECTED_EVENTS = [
  {
    label: "VACANCES D’AUTOMNE",
    startsOn: "2028-10-13",
    endsOn: "2028-10-30",
    startMarker: "soir",
    endMarker: "matin",
    kind: "VACATION",
  },
  {
    label: "LA TOUSSAINT",
    startsOn: "2028-11-01",
    endsOn: "2028-11-01",
    startMarker: null,
    endMarker: null,
    kind: "PUBLIC_HOLIDAY",
  },
  {
    label: "IMMACULEE CONCEPTION",
    startsOn: "2028-12-08",
    endsOn: "2028-12-08",
    startMarker: null,
    endMarker: null,
    kind: "PUBLIC_HOLIDAY",
  },
  {
    label: "VACANCES DE NOËL",
    startsOn: "2028-12-22",
    endsOn: "2029-01-08",
    startMarker: "soir",
    endMarker: "matin",
    kind: "VACATION",
  },
  {
    label: "VACANCES D’HIVER",
    startsOn: "2029-02-09",
    endsOn: "2029-02-19",
    startMarker: "soir",
    endMarker: "matin",
    kind: "VACATION",
  },
  {
    label: "SAINT-JOSEPH",
    startsOn: "2029-03-19",
    endsOn: "2029-03-19",
    startMarker: null,
    endMarker: null,
    kind: "PUBLIC_HOLIDAY",
  },
  {
    label: "VACANCES DE PÂQUES",
    startsOn: "2029-03-29",
    endsOn: "2029-04-09",
    startMarker: "soir",
    endMarker: "matin",
    kind: "VACATION",
  },
  {
    label: "ASCENSION",
    startsOn: "2029-05-09",
    endsOn: "2029-05-14",
    startMarker: "soir",
    endMarker: "matin",
    kind: "SCHOOL_CLOSED",
  },
  {
    label: "PENTECOTE",
    startsOn: "2029-05-21",
    endsOn: "2029-05-21",
    startMarker: null,
    endMarker: null,
    kind: "PUBLIC_HOLIDAY",
  },
  {
    label: "FÊTE-DIEU",
    startsOn: "2029-05-31",
    endsOn: "2029-05-31",
    startMarker: null,
    endMarker: null,
    kind: "PUBLIC_HOLIDAY",
  },
] as const;

/** Closed-day ranges for « X soir → Y matin » (both document bounds excluded). */
const SOIR_MATIN_CLOSED_RANGES = [
  { label: /AUTOMNE/i, documentStart: "2028-10-13", documentEnd: "2028-10-30", closedFrom: "2028-10-14", closedTo: "2028-10-29" },
  { label: /NOEL|NOËL/i, documentStart: "2028-12-22", documentEnd: "2029-01-08", closedFrom: "2028-12-23", closedTo: "2029-01-07" },
  { label: /HIVER/i, documentStart: "2029-02-09", documentEnd: "2029-02-19", closedFrom: "2029-02-10", closedTo: "2029-02-18" },
  { label: /PAQUES|PÂQUES/i, documentStart: "2029-03-29", documentEnd: "2029-04-09", closedFrom: "2029-03-30", closedTo: "2029-04-08" },
  { label: /ASCENSION/i, documentStart: "2029-05-09", documentEnd: "2029-05-14", closedFrom: "2029-05-10", closedTo: "2029-05-13" },
] as const;

const SINGLE_DAY_HOLIDAYS = ["2028-11-01", "2028-12-08", "2029-03-19", "2029-05-21", "2029-05-31"] as const;

function holidayDates(exceptions: { date: string }[]): Set<string> {
  return new Set(exceptions.map((entry) => entry.date));
}

function expectedClosedDayCount(): number {
  return (
    eachIsoDateInclusive("2028-10-14", "2028-10-29").length +
    eachIsoDateInclusive("2028-12-23", "2029-01-07").length +
    eachIsoDateInclusive("2029-02-10", "2029-02-18").length +
    eachIsoDateInclusive("2029-03-30", "2029-04-08").length +
    eachIsoDateInclusive("2029-05-10", "2029-05-13").length +
    SINGLE_DAY_HOLIDAYS.length
  );
}

function assertSoirMatinClosedDays(holidays: Set<string>): void {
  for (const period of SOIR_MATIN_CLOSED_RANGES) {
    assert.equal(
      holidays.has(period.documentStart),
      false,
      `${period.documentStart} n’est pas holiday (${period.label})`,
    );
    assert.equal(
      holidays.has(period.documentEnd),
      false,
      `${period.documentEnd} n’est pas holiday (${period.label})`,
    );
    for (const date of eachIsoDateInclusive(period.closedFrom, period.closedTo)) {
      assert.ok(holidays.has(date), `${date} doit être holiday (${period.label})`);
    }
  }
  for (const date of SINGLE_DAY_HOLIDAYS) {
    assert.ok(holidays.has(date), `${date} (fête simple) doit rester holiday`);
  }
}

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

test("version 2.49.0 — semaines de cours, kind nullable", () => {
  assert.equal(APP_VERSION, "2.51.1");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0028_school_week_kind_nullable.sql");
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
    assert.equal(found?.startMarker, expected.startMarker, `${expected.label} startMarker`);
    assert.equal(found?.endMarker, expected.endMarker, `${expected.label} endMarker`);
  }

  const october = groupOfficialEventsByMonth(parsed.preview.events, 2028).find((group) =>
    group.title.startsWith("Octobre"),
  );
  assert.ok(october);
  assert.equal(october?.events.length, 1);
  assert.match(october?.events[0]?.label ?? "", /AUTOMNE/i);
});

test("bornes soir → matin : dates officielles conservées, jours limites exclus", () => {
  const parsed = parseOfficialPlanFromLines(OFFICIAL_LINES_2028);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const autumn = parsed.preview.events.find((event) => /AUTOMNE/i.test(event.label));
  assert.equal(autumn?.startsOn, "2028-10-13");
  assert.equal(autumn?.endsOn, "2028-10-30");
  assert.equal(autumn?.startMarker, "soir");
  assert.equal(autumn?.endMarker, "matin");
  const autumnClosed = closedDaysFromOfficialEvent(autumn!);
  assert.equal(autumnClosed.includes("2028-10-13"), false);
  assert.equal(autumnClosed[0], "2028-10-14");
  assert.equal(autumnClosed.at(-1), "2028-10-29");
  assert.equal(autumnClosed.includes("2028-10-30"), false);

  const ascension = parsed.preview.events.find((event) => /ASCENSION/i.test(event.label));
  assert.equal(ascension?.startsOn, "2029-05-09");
  assert.equal(ascension?.endsOn, "2029-05-14");
  const ascensionClosed = closedDaysFromOfficialEvent(ascension!);
  assert.equal(ascensionClosed.includes("2029-05-09"), false);
  assert.deepEqual(ascensionClosed, ["2029-05-10", "2029-05-11", "2029-05-12", "2029-05-13"]);
  assert.equal(ascensionClosed.includes("2029-05-14"), false);

  const toussaint = parsed.preview.events.find((event) => /TOUSSAINT/i.test(event.label));
  assert.deepEqual(closedDaysFromOfficialEvent(toussaint!), ["2028-11-01"]);

  const exceptions = expandOfficialEventsToExceptions(parsed.preview.events);
  assert.equal(exceptions.length, expectedClosedDayCount());
  assertSoirMatinClosedDays(holidayDates(exceptions));
});

test("C/D/E — import DRAFT avec A/B pédagogiques, 2026-2027 reste ACTIVE", async () => {
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
  assert.equal(imported.year.weeks.length, 38);
  assert.ok(imported.year.weeks.every((week) => week.kind === "A" || week.kind === "B"));
  assert.equal(imported.year.weeks[0]?.kind, "A");
  assert.equal(imported.year.weeks[37]?.kind, "B");
  assert.deepEqual(
    imported.year.weeks.map((week) => week.number),
    Array.from({ length: 38 }, (_, index) => index + 1),
  );
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
  const holidays = holidayDates(exceptions);
  const expectedCount = expectedClosedDayCount();
  assert.equal(exceptions.length, expectedCount);
  assert.equal(imported.exceptionDayCount, expectedCount);
  assert.ok(exceptions.every((entry) => entry.state === "holiday"));
  assertSoirMatinClosedDays(holidays);
  assert.equal(holidays.has("2028-10-13"), false, "13.10.2028 n’est pas holiday");
  assert.ok(holidays.has("2028-10-14"));
  assert.ok(holidays.has("2028-10-29"));
  assert.equal(holidays.has("2028-10-30"), false, "30.10.2028 n’est pas holiday");
  assert.equal(holidays.has("2029-05-09"), false, "09.05.2029 n’est pas holiday");
  assert.equal(holidays.has("2029-05-14"), false, "14.05.2029 n’est pas holiday");
  assert.equal(
    expandOfficialEventsToExceptions(parsed.preview.events).length,
    expectedCount,
  );

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
  assert.equal(replaced.year.weeks.length, 38);
  assert.ok(replaced.year.weeks.every((week) => week.kind === "A" || week.kind === "B"));
  assert.equal(replaced.year.weeks[0]?.kind, "A");
  assert.equal(replaced.year.weeks[37]?.kind, "B");
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

test("worker pdf.js résolu hors du bundle vinext", () => {
  const workerPath = resolvePdfWorkerPath();
  assert.ok(workerPath, "pdf.worker.mjs doit être trouvable");
  assert.equal(existsSync(workerPath), true);
  assert.match(workerPath, /pdf\.worker\.mjs$/);
});

test("PDF officiel détecté comme plan de scolarité, sans semaines A/B", async () => {
  const detected = await detectAndParseSchoolYearPdf(new Uint8Array(readFileSync(fixturePath)));
  assert.equal(detected.sourceKind, "official-plan");
  if (detected.sourceKind !== "official-plan") return;
  assert.equal(detected.official.ok, true);
  if (!detected.official.ok) return;
  assert.equal(detected.official.preview.label, "2028-2029");
  assert.equal(detected.official.preview.events.length, EXPECTED_EVENTS.length);
});

test("interface 2.48.0 : aucun import A/B exposé", () => {
  const panel = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/app/components/school-year-admin-panel.tsx"),
    "utf8",
  );
  assert.equal(panel.includes("PLAN A/B"), false);
  assert.equal(panel.includes("WeekPlanComplement"), false);
  assert.equal(panel.includes("Choisir le PDF des semaines A/B"), false);
  assert.equal(panel.includes("Enregistrer le plan A/B en brouillon"), false);
});
