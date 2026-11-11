process.env.CAMPUS_STORE ??= "memory";
process.env.CAMPUS_PBKDF2_ITERATIONS ??= "1000";
process.env.AUTH_SECRET ??= "test-secret-student-usage-2444";
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TEACHER_DEMO_ID } from "../src/features/classes/demo-data.ts";
import {
  authenticateStudentAccessCode,
  generateStudentAccess,
} from "../src/features/student-access/index.ts";
import {
  STUDENT_USAGE_DISCLAIMER,
  STUDENT_VISIT_PENDING_MS,
  addIsoDays,
  buildStudentUsageDashboard,
  decideStudentVisit,
  parseStudentVisitRecord,
  readStudentVisitRecord,
  resetStudentUsagePurgeClock,
  schoolCalendarDateIso,
  studentUsageRetentionCutoff,
  writeStudentVisitRecord,
  type StudentVisitRecord,
} from "../src/features/student-usage/index.ts";
import { createSessionToken } from "../src/lib/auth/session.ts";
import {
  CAMPUS_BACKUP_EXCLUDED_OPERATIONAL_TABLES,
  CAMPUS_BACKUP_INSERT_ORDER,
} from "../src/lib/persistence/campus-backup-tables.ts";
import { resetMemoryStudentUsageStore } from "../src/lib/persistence/memory-student-usage-store.ts";
import { getMemoryRuntimeAgendaAdapterStore } from "../src/lib/persistence/memory-runtime-adapter-store.ts";
import { getMemoryStudentAccessStore } from "../src/lib/persistence/memory-student-access-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { dumpCampusTables, restoreCampusTables, validateCampusTables } from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { SqlStudentUsageStore } from "../src/lib/persistence/sql/sql-student-usage-store.ts";
import {
  getSchoolCatalogStore,
  getSchoolYearStore,
  getStudentUsageStore,
  resetStoreFactory,
} from "../src/lib/persistence/store-factory.ts";
import { GET as getStudentUsage } from "../web/app/api/admin/student-usage/route.ts";
import { POST as postUsageVisit } from "../web/app/api/student/usage-visit/route.ts";

const COUNTED: StudentVisitRecord = {
  date: "2026-11-11",
  schoolYearId: "year-1",
  schoolClassId: "class-a",
  state: "counted",
  at: 1_700_000_000_000,
};

function cookie(token: string): string {
  return `campus_session=${encodeURIComponent(token)}`;
}

function visitRequest(token: string | null, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set("cookie", cookie(token));
  return new Request("https://campus.test/api/student/usage-visit", { method: "POST", ...init, headers });
}

async function studentToken(): Promise<{ token: string; schoolClassId: string; schoolYearId: string }> {
  resetStoreFactory();
  resetMemoryStudentUsageStore();
  resetStudentUsagePurgeClock();
  const catalog = await getSchoolCatalogStore();
  const years = await getSchoolYearStore();
  const accesses = getMemoryStudentAccessStore();
  const adapters = getMemoryRuntimeAgendaAdapterStore();
  const schoolClass = (await catalog.listClasses()).find((entry) => entry.code === "MA2" && entry.schoolYearId);
  assert.ok(schoolClass?.schoolYearId);
  const deps = {
    accesses,
    adapters,
    catalog,
    years,
    getSchoolClassById: async (id: string) => (await catalog.listClasses()).find((entry) => entry.id === id) ?? null,
    getSchoolYearById: (id: string) => years.getSchoolYearById(id),
    listClasses: () => catalog.listClasses(),
    listYears: () => years.listSchoolYears(),
  };
  const generated = await generateStudentAccess(deps, schoolClass.id);
  assert.equal(generated.ok, true);
  if (!generated.ok) throw new Error(generated.reason);
  const login = await authenticateStudentAccessCode(generated.code, {
    getActiveSchoolYear: () => years.getActiveSchoolYear(),
    listClasses: () => catalog.listClasses(),
    getAccessBySchoolClassId: (id) => accesses.getBySchoolClassId(id),
    findClassroomBySchoolClassId: (id) => adapters.findClassroomBySchoolClassId(id),
  });
  assert.equal(login.ok, true);
  if (!login.ok) throw new Error("connexion");
  return {
    token: await createSessionToken(login.session, true),
    schoolClassId: login.session.schoolClassId,
    schoolYearId: login.session.schoolYearId,
  };
}

test("migration 0038 — compteurs agrégés, hors sauvegarde, sans donnée individuelle", async () => {
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0038_student_daily_visits.sql");
  const sql = await readFile(new URL("../migrations/0038_student_daily_visits.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_daily_visits/);
  assert.match(sql, /PRIMARY KEY \(visit_date, school_year_id, school_class_id\)/);
  assert.match(sql, /visit_count INTEGER NOT NULL/);
  assert.doesNotMatch(sql, /email|ip_address|fingerprint|cookie|token|access_code|user_agent|student_id|browser/i);
  assert.ok(!(CAMPUS_BACKUP_INSERT_ORDER as readonly string[]).includes("student_daily_visits"));
  assert.ok((CAMPUS_BACKUP_EXCLUDED_OPERATIONAL_TABLES as readonly string[]).includes("student_daily_visits"));
});

test("1, 2, 3, 5 — le navigateur ne recompte ni un rafraîchissement ni un envoi déjà lancé", () => {
  const context = { date: "2026-11-11", schoolYearId: "year-1", schoolClassId: "class-a" };
  assert.equal(decideStudentVisit(null, context, COUNTED.at), "post");
  assert.equal(decideStudentVisit(COUNTED, context, COUNTED.at + 60_000), "skip");
  assert.equal(decideStudentVisit(COUNTED, { ...context, date: "2026-11-12" }, COUNTED.at), "post");
  assert.equal(decideStudentVisit(COUNTED, { ...context, schoolClassId: "class-b" }, COUNTED.at), "post");
  assert.equal(decideStudentVisit(COUNTED, { ...context, schoolYearId: "year-2" }, COUNTED.at), "post");
  const pending: StudentVisitRecord = { ...context, state: "pending", at: 5_000 };
  assert.equal(decideStudentVisit(pending, context, 5_000 + STUDENT_VISIT_PENDING_MS - 1), "skip");
  assert.equal(decideStudentVisit(pending, context, 5_000 + STUDENT_VISIT_PENDING_MS), "post");
});

test("11 — stockage local indisponible : pas d’erreur, et l’échec réseau n’est pas mémorisé comme un succès", async () => {
  const broken = {
    getItem(): string | null {
      throw new Error("denied");
    },
    setItem(): void {
      throw new Error("denied");
    },
    removeItem(): void {
      throw new Error("denied");
    },
  };
  assert.equal(readStudentVisitRecord(broken), null);
  assert.doesNotThrow(() => writeStudentVisitRecord(broken, COUNTED));
  assert.equal(parseStudentVisitRecord("{"), null);
  assert.equal(parseStudentVisitRecord(JSON.stringify({ ...COUNTED, studentId: "secret" }))?.state, "counted");
  const serialized = JSON.parse(JSON.stringify(COUNTED)) as Record<string, unknown>;
  assert.equal("studentId" in serialized, false);

  const recorder = await readFile(new URL("../web/app/components/student-usage-recorder.tsx", import.meta.url), "utf8");
  assert.match(recorder, /if \(!response\.ok\) \{\s*writeStudentVisitRecord\(storage, null\);/);
  assert.match(recorder, /body: "\{\}"/);
  assert.match(recorder, /date: payload\.date/);
});

test("12 — minuit à Zurich, pas à UTC", () => {
  assert.equal(schoolCalendarDateIso(new Date("2026-11-11T22:59:00.000Z")), "2026-11-11");
  assert.equal(schoolCalendarDateIso(new Date("2026-11-11T23:00:00.000Z")), "2026-11-12");
  assert.equal(studentUsageRetentionCutoff("2026-11-11"), "2024-11-11");
  assert.equal(addIsoDays("2026-11-11", -6), "2026-11-05");
});

test("13, 14 — jours vides, périodes 7/30/90, comparaison et classes archivées", () => {
  const rows = [
    { date: "2026-11-09", schoolYearId: "y", schoolClassId: "a", count: 10 },
    { date: "2026-11-11", schoolYearId: "y", schoolClassId: "a", count: 4 },
    { date: "2026-11-11", schoolYearId: "y", schoolClassId: "b", count: 6 },
    { date: "2026-11-04", schoolYearId: "y", schoolClassId: "a", count: 8 },
    { date: "2026-10-01", schoolYearId: "old", schoolClassId: "archived", count: 3 },
  ];
  const classes = [
    { id: "a", code: "MECAUTO3A", isArchived: false, schoolYearLabel: "2026-2027" },
    { id: "b", code: "MECAUTO3B", isArchived: false, schoolYearLabel: "2026-2027" },
    { id: "archived", code: "MA4A", isArchived: true, schoolYearLabel: "2025-2026" },
  ];
  const week = buildStudentUsageDashboard({ rows, today: "2026-11-11", period: 7, schoolClassId: null, classes });
  assert.equal(week.series.length, 7);
  assert.equal(week.series.find((point) => point.date === "2026-11-10")?.count, 0);
  assert.equal(week.series.at(-1)?.count, 10);
  assert.equal(week.cards.today, 10);
  assert.equal(week.cards.last7, 20);
  assert.equal(week.cards.activeClasses, 2);
  assert.deepEqual(week.classes.map((entry) => [entry.label, entry.count]), [["MECAUTO3A", 14], ["MECAUTO3B", 6]]);
  assert.equal(week.comparison.current, 20);
  assert.equal(week.comparison.previous, 8);
  assert.equal(week.comparison.percent, 150);
  assert.equal(week.disclaimer, STUDENT_USAGE_DISCLAIMER);

  const onlyA = buildStudentUsageDashboard({ rows, today: "2026-11-11", period: 7, schoolClassId: "a", classes });
  assert.equal(onlyA.cards.today, 4);
  assert.equal(onlyA.cards.activeClasses, 1);
  assert.deepEqual(onlyA.series.map((point) => point.count), [0, 0, 0, 0, 10, 0, 4]);

  const month = buildStudentUsageDashboard({ rows, today: "2026-11-11", period: 30, schoolClassId: null, classes });
  assert.equal(month.series.length, 30);
  assert.equal(month.cards.activeClasses, 2);
  assert.equal(month.classes.some((entry) => entry.schoolClassId === "archived"), false);

  const quarter = buildStudentUsageDashboard({ rows, today: "2026-11-11", period: 90, schoolClassId: null, classes });
  assert.equal(quarter.series.length, 90);
  assert.equal(quarter.series[0]?.date, addIsoDays("2026-11-11", -89));
  assert.equal(quarter.cards.activeClasses, 3);
  assert.equal(quarter.classes.find((entry) => entry.schoolClassId === "archived")?.archived, true);

  const emptyPrevious = buildStudentUsageDashboard({
    rows: [{ date: "2026-11-11", schoolYearId: "y", schoolClassId: "a", count: 5 }],
    today: "2026-11-11",
    period: 7,
    schoolClassId: null,
    classes,
  });
  assert.equal(emptyPrevious.comparison.previous, 0);
  assert.equal(emptyPrevious.comparison.percent, null);
});

test("10 — incréments simultanés, une seule ligne, purge des compteurs anciens", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const store = new SqlStudentUsageStore(db);
  await Promise.all(Array.from({ length: 40 }, () => store.increment({
    date: "2026-11-11",
    schoolYearId: "year-1",
    schoolClassId: "class-a",
  })));
  await store.increment({ date: "2024-01-01", schoolYearId: "year-1", schoolClassId: "class-a" });
  const before = await store.listBetween("2020-01-01", "2026-11-11");
  assert.equal(before.find((row) => row.date === "2026-11-11")?.count, 40);
  assert.equal(before.length, 2);
  const removed = await store.purgeBefore("2024-11-11");
  assert.equal(removed, 1);
  assert.equal((await store.listBetween("2020-01-01", "2026-11-11")).length, 1);

  const dump = await dumpCampusTables(db);
  assert.equal("student_daily_visits" in dump, false);
  const validated = validateCampusTables({ ...dump, student_daily_visits: [{ visit_count: 999 }] });
  assert.equal(validated.ok, false);
  if (!validated.ok) assert.match(validated.reason, /administrateur/);
  await restoreCampusTables(db, dump);
  assert.equal((await store.listBetween("2026-11-11", "2026-11-11"))[0]?.count, 40);
});

test("6, 7, 8, 9 — anonyme, enseignant, aperçu et non-administrateur sont refusés", async () => {
  const anonymous = await postUsageVisit(visitRequest(null, { body: "{\"schoolClassId\":\"forged\",\"count\":99}" }));
  assert.equal(anonymous.status, 401);

  const crossSite = await postUsageVisit(visitRequest("irrelevant", {
    headers: { "sec-fetch-site": "cross-site" },
  }));
  assert.equal(crossSite.status, 403);

  const { token, schoolClassId } = await studentToken();
  const forged = await postUsageVisit(visitRequest(token, {
    body: JSON.stringify({ schoolClassId: "forged-class", count: 99 }),
    headers: { "content-type": "application/json" },
  }));
  assert.equal(forged.status, 200);
  const again = await postUsageVisit(visitRequest(token));
  assert.equal(again.status, 200);
  const rows = await (await getStudentUsageStore()).listBetween("2020-01-01", "2099-01-01");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.schoolClassId, schoolClassId);
  assert.equal(rows[0]?.count, 2);
  assert.equal(rows[0]?.date, schoolCalendarDateIso(new Date()));

  const teacherToken = await createSessionToken({
    kind: "teacher",
    teacherId: TEACHER_DEMO_ID,
    issuedAt: Date.now(),
  });
  const teacherVisit = await postUsageVisit(visitRequest(teacherToken));
  assert.equal(teacherVisit.status, 403);
  const teacherStats = await getStudentUsage(new Request("https://campus.test/api/admin/student-usage", {
    headers: { cookie: cookie(teacherToken) },
  }));
  assert.equal(teacherStats.status, 403);
  const noSession = await getStudentUsage(new Request("https://campus.test/api/admin/student-usage"));
  assert.equal(noSession.status, 401);

  const after = await (await getStudentUsageStore()).listBetween("2020-01-01", "2099-01-01");
  assert.equal(after[0]?.count, 2, "l’enseignant et l’anonyme n’incrémentent pas");

  const [page, recorder, login, notebook, activity, admin] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/student-usage-recorder.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/auth/student/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/admin/security/activity/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/administration-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /\{studentEntry === "code" \? <StudentUsageRecorder \/> : null\}/);
  assert.match(recorder, /\/api\/auth\/session/);
  assert.doesNotMatch(recorder, /\/api\/auth\/student/);
  assert.doesNotMatch(login, /student-usage|usage-visit/);
  assert.doesNotMatch(notebook, /student-usage|usage-visit/);
  assert.match(activity, /requireAdminSession/);
  assert.match(activity, /getSecurityEventStore/);
  assert.match(admin, /security: "Sécurité"/);
  assert.match(admin, /<SecurityActivityPanel \/>/);
  assert.match(admin, /statistics: "Statistiques"/);
  assert.match(admin, /\{tab === "statistics" \? <StudentUsagePanel \/> : null\}/);
});

test("4 — une session élève déjà ouverte suffit : le code n’est pas redemandé", async () => {
  const sessionRoute = await readFile(new URL("../web/app/api/auth/session/route.ts", import.meta.url), "utf8");
  assert.match(sessionRoute, /usageDate: schoolCalendarDateIso\(new Date\(\)\)/);
  assert.match(sessionRoute, /schoolClassId: session\.schoolClassId/);
  const { token } = await studentToken();
  const response = await postUsageVisit(visitRequest(token));
  assert.equal(response.status, 200);
  const payload = await response.json() as { ok: boolean; schoolClassId: string };
  assert.equal(payload.ok, true);
  assert.notEqual(payload.schoolClassId, "");
});
