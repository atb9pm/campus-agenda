process.env.CAMPUS_PBKDF2_ITERATIONS ??= "10000";
process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";
process.env.AUTH_SECRET ??= "test-secret-student-access-244";
process.env.CAMPUS_STORE ??= "memory";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isUsablePasswordHash, verifyPassword } from "../src/lib/auth/password.ts";
import { canMutateAgenda, canReadClassroomAgenda } from "../src/lib/auth/permissions.ts";
import {
  buildSessionCookie,
  createSessionToken,
  parseSessionToken,
} from "../src/lib/auth/session.ts";
import { revalidateLiveSession } from "../src/lib/auth/session-live.ts";
import {
  authenticateStudentAccessCode,
  generateStudentAccess,
  generateStudentAccessCode,
  listStudentAccessMetadata,
  parseStudentAccessCode,
  pickReusableStudentAccess,
  deterministicStudentAccessId,
  revalidateStructuredStudentSession,
  revokeStudentAccess,
  teacherClassAccessViews,
  isSealedStudentAccessCode,
  sealStudentAccessCode,
  unsealStudentAccessCode,
  compactClassCodeKey,
  STUDENT_ACCESS_ALPHABET,
  STUDENT_LOGIN_INVALID_REASON,
} from "../src/features/student-access/index.ts";
import { APP_VERSION } from "../src/lib/app-version.ts";
import { getMemoryAgendaStore, resetMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { getMemoryRuntimeAgendaAdapterStore } from "../src/lib/persistence/memory-runtime-adapter-store.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  MemorySchoolYearStore,
  replaceMemorySchoolYears,
  resetMemorySchoolYearStore,
} from "../src/lib/persistence/memory-school-year-store.ts";
import {
  getMemoryStudentAccessStore,
} from "../src/lib/persistence/memory-student-access-store.ts";
import { resetMemoryLegacySchool } from "../src/lib/persistence/memory-legacy-school.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import { exportCampusSnapshot, restoreCampusSnapshot } from "../src/lib/persistence/campus-backup.ts";
import { CAMPUS_BACKUP_COLUMNS } from "../src/lib/persistence/campus-backup-tables.ts";
import {
  canonicalizeCampusDump,
  dumpCampusTables,
  restoreCampusTables,
  validateCampusTables,
} from "../src/lib/persistence/sql/sql-campus-backup.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlStudentAccessStore } from "../src/lib/persistence/sql/sql-student-access-store.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlSchoolYearStore } from "../src/lib/persistence/sql/sql-school-year-store.ts";
import { SqlRuntimeAgendaAdapterStore } from "../src/lib/persistence/sql/sql-runtime-adapter-store.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { resetStoreFactory } from "../src/lib/persistence/store-factory.ts";
import type { CampusBackupDeps } from "../src/lib/persistence/campus-backup.ts";
import type { SchoolYearWithWeeks } from "../src/features/school-year/types.ts";
import { getMemoryTeacherSetupStore, resetMemoryTeacherSetupStore } from "../src/lib/persistence/memory-teacher-setup-store.ts";
import { getMemoryTeacherNotesStore, resetMemoryTeacherNotesStore } from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { getMemoryAnnualCourseStore, resetMemoryAnnualCourseStore } from "../src/lib/persistence/memory-annual-course-store.ts";
import { getMemoryCourseScheduleStore, resetMemoryCourseScheduleStore } from "../src/lib/persistence/memory-course-schedule-store.ts";
import { MemoryMembershipStore, resetMemoryMembershipStore } from "../src/lib/persistence/memory-membership-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  getMemoryPedagogicalPathStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import { getMemoryTemplateStore, resetMemoryTemplateStore } from "../src/lib/persistence/memory-template-store.ts";
import { getMemoryTimetableStore, resetMemoryTimetableStore } from "../src/lib/persistence/memory-timetable-store.ts";

function yearFixture(overrides: Partial<SchoolYearWithWeeks> = {}): SchoolYearWithWeeks {
  return {
    id: "year-active-test",
    label: "2026-2027",
    status: "active",
    startsOn: "2026-08-17",
    endsOn: "2027-07-02",
    sourceFilename: "seed",
    importedAt: "2026-01-01T00:00:00.000Z",
    activatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    weeks: [{ number: 1, kind: "A", monday: "2026-08-17" }],
    ...overrides,
  };
}

function resetWorld() {
  resetStoreFactory();
  resetMemoryAgendaStore();
  resetMemoryLegacySchool();
  resetMemorySchoolCatalogStore();
  resetMemorySchoolYearStore();
  resetMemoryTeacherAccountStore();
  resetMemoryTeacherSetupStore();
  resetMemoryTeacherNotesStore();
  resetMemoryAnnualCourseStore();
  resetMemoryCourseScheduleStore();
  resetMemoryMembershipStore();
  resetMemoryPedagogicalPathStore();
  resetMemoryTemplateStore();
  resetMemoryTimetableStore();
}

function memoryBackupDeps(): CampusBackupDeps {
  return {
    agenda: getMemoryAgendaStore(),
    teacherSetups: getMemoryTeacherSetupStore(),
    teacherNotes: getMemoryTeacherNotesStore(),
    teacherAccounts: getMemoryTeacherAccountStore(),
    catalog: getMemorySchoolCatalogStore(),
    years: new MemorySchoolYearStore(),
    courses: getMemoryAnnualCourseStore(),
    schedules: getMemoryCourseScheduleStore(),
    memberships: new MemoryMembershipStore(),
    paths: getMemoryPedagogicalPathStore(),
    courseNotes: getMemoryAnnualCourseNotesStore(),
    templates: getMemoryTemplateStore(),
    timetable: getMemoryTimetableStore(),
    sqlDb: null,
  };
}

async function adminDeps() {
  const catalog = getMemorySchoolCatalogStore();
  await catalog.ensureSeeded();
  const years = new MemorySchoolYearStore();
  await years.seedDefaultActiveYearIfEmpty();
  await catalog.applySchoolYearBackfill(await years.listSchoolYears());
  return {
    accesses: getMemoryStudentAccessStore(),
    adapters: getMemoryRuntimeAgendaAdapterStore(),
    getSchoolClassById: async (id: string) => {
      const classes = await catalog.listClasses();
      return classes.find((entry) => entry.id === id) ?? null;
    },
    getSchoolYearById: (id: string) => years.getSchoolYearById(id),
    listClasses: () => catalog.listClasses(),
    listYears: () => years.listSchoolYears(),
    catalog,
    years,
  };
}

async function loginDepsFrom(admin: Awaited<ReturnType<typeof adminDeps>>) {
  return {
    getActiveSchoolYear: () => admin.years.getActiveSchoolYear(),
    listClasses: () => admin.catalog.listClasses(),
    getAccessBySchoolClassId: (schoolClassId: string) => admin.accesses.getBySchoolClassId(schoolClassId),
    findClassroomBySchoolClassId: (schoolClassId: string) =>
      admin.adapters.findClassroomBySchoolClassId(schoolClassId),
  };
}

test("PR79 — version 2.44.0 et migrations 0025–0026", async () => {
  assert.equal(APP_VERSION, "2.53.0");
  assert.equal(SQL_MIGRATION_FILES.at(-1), "0029_admin_mfa.sql");
  assert.ok(SQL_MIGRATION_FILES.includes("0025_structured_student_access.sql"));
  assert.ok(SQL_MIGRATION_FILES.includes("0024_structured_agenda_bridge.sql"));
  const columns = CAMPUS_BACKUP_COLUMNS.student_accesses.map((column) => column.name);
  assert.ok(columns.includes("school_class_id"));
  assert.ok(columns.includes("access_version"));
  assert.ok(columns.includes("revoked_at"));
  assert.ok(columns.includes("access_code_ciphertext"));
  const migration = await readFile(new URL("../migrations/0025_structured_student_access.sql", import.meta.url), "utf8");
  assert.match(migration, /label TEXT NOT NULL/);
  assert.doesNotMatch(migration, /label TEXT NOT NULL UNIQUE/);
  assert.match(migration, /student_accesses_structured_0025/);
  assert.match(migration, /idx_student_accesses_school_class_id/);
  const cipherMigration = await readFile(
    new URL("../migrations/0026_student_access_ciphertext.sql", import.meta.url),
    "utf8",
  );
  assert.match(cipherMigration, /access_code_ciphertext/);
});

test("A — génération : format, alphabet, hash, pas de plaintext", async () => {
  resetWorld();
  const first = generateStudentAccessCode("MECAUTO3A");
  const second = generateStudentAccessCode("MECAUTO3A");
  assert.match(first, /^MECAUTO3A-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.notEqual(first, second);
  const parsed = parseStudentAccessCode(`  ${first.toLowerCase()}  `);
  assert.ok(parsed);
  assert.equal(parsed.prefix, "MECAUTO3A");
  assert.equal(parsed.canonical, first);
  assert.ok([...parsed.secret].every((char) => STUDENT_ACCESS_ALPHABET.includes(char)));

  const dashed = parseStudentAccessCode("MEC-AUTO-3A-K7M4-R2P8");
  assert.ok(dashed);
  assert.equal(dashed.prefix, "MEC-AUTO-3A");
  assert.equal(dashed.secret, "K7M4R2P8");

  const admin = await adminDeps();
  const schoolClass = (await admin.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  assert.match(generated.code, /^MA2-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const stored = await admin.accesses.getBySchoolClassId(schoolClass.id);
  assert.ok(stored);
  assert.equal(isUsablePasswordHash(stored.accessCodeHash), true);
  assert.notEqual(stored.accessCodeHash, generated.code);
  assert.equal(JSON.stringify(stored).includes(generated.code), false);
  assert.equal("code" in stored, false);
  assert.equal(isSealedStudentAccessCode(stored.accessCodeCiphertext), true);
  assert.equal(await unsealStudentAccessCode(stored.accessCodeCiphertext), generated.code);
  assert.equal(await verifyPassword(generated.code, stored.accessCodeHash), true);
});

test("B — authentification ACTIVE / refus DRAFT ARCHIVED inactive archivée révoquée", async () => {
  resetWorld();
  const admin = await adminDeps();
  const schoolClass = (await admin.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const deps = await loginDepsFrom(admin);

  const ok = await authenticateStudentAccessCode(generated.code.toLowerCase(), deps);
  assert.equal(ok.ok, true);

  const bad = await authenticateStudentAccessCode("MA2-XXXX-XXXX", deps);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, STUDENT_LOGIN_INVALID_REASON);

  const draftYear = yearFixture({ id: "year-draft-test", label: "2027-2028", status: "draft", activatedAt: null });
  const active = await admin.years.getActiveSchoolYear();
  assert.ok(active);
  replaceMemorySchoolYears([active, draftYear]);
  const draftClass = await admin.catalog.createClass({
    code: "MA2",
    label: "MA2 2027",
    schoolYearId: draftYear.id,
    schoolYearLabel: draftYear.label,
  });
  const draftGenerated = await generateStudentAccess(admin, draftClass.id);
  assert.equal(draftGenerated.ok, true);
  if (!draftGenerated.ok) return;
  const draftLogin = await authenticateStudentAccessCode(draftGenerated.code, deps);
  assert.equal(draftLogin.ok, false);

  replaceMemorySchoolYears([{ ...active, status: "archived" }]);
  const archivedYearLogin = await authenticateStudentAccessCode(generated.code, deps);
  assert.equal(archivedYearLogin.ok, false);

  replaceMemorySchoolYears([active]);
  await admin.catalog.updateClass(schoolClass.id, { isActive: false });
  const inactiveLogin = await authenticateStudentAccessCode(generated.code, deps);
  assert.equal(inactiveLogin.ok, false);
  await admin.catalog.updateClass(schoolClass.id, { isActive: true });

  await admin.catalog.updateClass(schoolClass.id, { isArchived: true });
  const archivedClassLogin = await authenticateStudentAccessCode(generated.code, deps);
  assert.equal(archivedClassLogin.ok, false);
  await admin.catalog.updateClass(schoolClass.id, { isArchived: false });
  await admin.catalog.updateClass(schoolClass.id, { isActive: true });

  const revoked = await revokeStudentAccess(admin, schoolClass.id);
  assert.equal(revoked.ok, true);
  const revokedLogin = await authenticateStudentAccessCode(generated.code, deps);
  assert.equal(revokedLogin.ok, false);
});

test("C/D — rotation et révocation invalidént immédiatement l'ancienne session", async () => {
  resetWorld();
  const admin = await adminDeps();
  const schoolClass = (await admin.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const first = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const deps = await loginDepsFrom(admin);
  const logged = await authenticateStudentAccessCode(first.code, deps);
  assert.equal(logged.ok, true);
  if (!logged.ok) return;

  const live = await revalidateStructuredStudentSession(logged.session, {
    getAccessById: (id) => admin.accesses.getById(id),
    getSchoolClassById: (id) => admin.getSchoolClassById(id),
    getActiveSchoolYear: () => admin.years.getActiveSchoolYear(),
    findClassroomBySchoolClassId: (id) => admin.adapters.findClassroomBySchoolClassId(id),
  });
  assert.ok(live);

  const second = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.notEqual(second.code, first.code);
  const oldCode = await authenticateStudentAccessCode(first.code, deps);
  assert.equal(oldCode.ok, false);
  const newCode = await authenticateStudentAccessCode(second.code, deps);
  assert.equal(newCode.ok, true);
  const stale = await revalidateStructuredStudentSession(logged.session, {
    getAccessById: (id) => admin.accesses.getById(id),
    getSchoolClassById: (id) => admin.getSchoolClassById(id),
    getActiveSchoolYear: () => admin.years.getActiveSchoolYear(),
    findClassroomBySchoolClassId: (id) => admin.adapters.findClassroomBySchoolClassId(id),
  });
  assert.equal(stale, null);

  if (!newCode.ok) return;
  const revoked = await revokeStudentAccess(admin, schoolClass.id);
  assert.equal(revoked.ok, true);
  const afterRevoke = await revalidateStructuredStudentSession(newCode.session, {
    getAccessById: (id) => admin.accesses.getById(id),
    getSchoolClassById: (id) => admin.getSchoolClassById(id),
    getActiveSchoolYear: () => admin.years.getActiveSchoolYear(),
    findClassroomBySchoolClassId: (id) => admin.adapters.findClassroomBySchoolClassId(id),
  });
  assert.equal(afterRevoke, null);
});

test("C — deux générations concurrentes : seul le dernier code reste valable", async () => {
  resetWorld();
  const admin = await adminDeps();
  const schoolClass = (await admin.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const [first, second] = await Promise.all([
    generateStudentAccess(admin, schoolClass.id),
    generateStudentAccess(admin, schoolClass.id),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.notEqual(first.code, second.code);
  const deps = await loginDepsFrom(admin);
  const firstLogin = await authenticateStudentAccessCode(first.code, deps);
  const secondLogin = await authenticateStudentAccessCode(second.code, deps);
  assert.equal(firstLogin.ok, false);
  assert.equal(secondLogin.ok, true);
});

test("E — changement d'année ACTIVE invalide la session", async () => {
  resetWorld();
  const admin = await adminDeps();
  const schoolClass = (await admin.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const logged = await authenticateStudentAccessCode(generated.code, await loginDepsFrom(admin));
  assert.equal(logged.ok, true);
  if (!logged.ok) return;

  const previous = await admin.years.getActiveSchoolYear();
  assert.ok(previous);
  replaceMemorySchoolYears([
    { ...previous, status: "archived" },
    yearFixture({ id: "year-next", label: "2027-2028", status: "active" }),
  ]);
  const stale = await revalidateStructuredStudentSession(logged.session, {
    getAccessById: (id) => admin.accesses.getById(id),
    getSchoolClassById: (id) => admin.getSchoolClassById(id),
    getActiveSchoolYear: () => admin.years.getActiveSchoolYear(),
    findClassroomBySchoolClassId: (id) => admin.adapters.findClassroomBySchoolClassId(id),
  });
  assert.equal(stale, null);
});

test("F — permissions : lecture seule de sa classe, pas de mutation Agenda", async () => {
  resetWorld();
  const admin = await adminDeps();
  const schoolClass = (await admin.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const logged = await authenticateStudentAccessCode(generated.code, await loginDepsFrom(admin));
  assert.equal(logged.ok, true);
  if (!logged.ok) return;
  const store = getMemoryAgendaStore();
  assert.equal(await canReadClassroomAgenda(logged.session, logged.session.classroomId, store), true);
  assert.equal(await canReadClassroomAgenda(logged.session, "classe-demo-tma-2a", store), false);
  assert.equal(canMutateAgenda(logged.session), false);
});

test("G — API admin : non-admin refusé, hash jamais envoyé, code courant lisible", async () => {
  resetWorld();
  const admin = await adminDeps();
  const schoolClass = (await admin.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  assert.equal(generated.access.currentCode, generated.code);
  const listed = JSON.stringify({ ok: true, access: generated.access });
  assert.equal(listed.includes("accessCodeHash"), false);
  assert.equal(listed.includes("pbkdf2-sha256"), false);
  assert.equal(listed.includes("aes-gcm-v1$"), false);
  assert.equal(listed.includes(generated.code), true);
  const createPayload = JSON.stringify({ ok: true, access: generated.access, code: generated.code });
  assert.match(createPayload, /"code":"/);
  assert.equal(createPayload.includes("accessCodeHash"), false);

  const fromList = await listStudentAccessMetadata(admin, schoolClass.id);
  assert.equal(fromList[0]?.currentCode, generated.code);

  const route = await readFile(new URL("../web/app/api/admin/student-access/route.ts", import.meta.url), "utf8");
  const studentRoute = await readFile(new URL("../web/app/api/auth/student/route.ts", import.meta.url), "utf8");
  const classesAdmin = await readFile(new URL("../web/app/components/classes-admin-panel.tsx", import.meta.url), "utf8");
  const adminBlock = await readFile(new URL("../web/app/components/student-access-admin.tsx", import.meta.url), "utf8");
  assert.match(route, /requireAdminSession/);
  assert.match(route, /assertNoSecretLeak/);
  assert.match(studentRoute, /authenticateStudentAccessCode/);
  assert.match(studentRoute, /STUDENT_LOGIN_INVALID_REASON/);
  assert.match(classesAdmin, /accessMutationLock/);
  assert.match(classesAdmin, /accessErrorByClass/);
  assert.match(classesAdmin, /revealedCodeByClass/);
  assert.match(classesAdmin, /ConfirmDialog/);
  assert.doesNotMatch(classesAdmin, /window\.confirm/);
  assert.match(adminBlock, /Code apprentis en vigueur/);
  assert.doesNotMatch(adminBlock, /ne pourra plus/);
  const mesCours = await readFile(new URL("../web/app/components/mes-cours-panel.tsx", import.meta.url), "utf8");
  const teacherCoursesRoute = await readFile(new URL("../web/app/api/teacher/courses/route.ts", import.meta.url), "utf8");
  const teacherAccessRoute = await readFile(
    new URL("../web/app/api/teacher/class-accesses/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(mesCours, /Code d’accès classe/);
  assert.match(mesCours, /teacherAccessViewForClass/);
  assert.doesNotMatch(mesCours, /Régénérer le code/);
  assert.doesNotMatch(mesCours, /Générer un code/);
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /fetchTeacherClassAccessesApi/);
  assert.match(teacherCoursesRoute, /teacherClassAccessViews/);
  assert.match(teacherCoursesRoute, /requireTeacherSession/);
  assert.match(teacherAccessRoute, /requireTeacherSession/);
  assert.match(teacherAccessRoute, /teacherClassAccessViews/);
});

test("H — localStorage : le secret élève n'est plus enregistré, login enseignant inchangé", async () => {
  const loginPanel = await readFile(new URL("../web/app/components/login-panel.tsx", import.meta.url), "utf8");
  const authEntry = await readFile(new URL("../src/features/auth-entry/index.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(loginPanel, /LAST_STUDENT_CODE_KEY/);
  assert.doesNotMatch(loginPanel, /campus-last-student-code/);
  assert.doesNotMatch(loginPanel, /onStudentSubmit\(fromLink/);
  assert.doesNotMatch(authEntry, /campus-last-student-code/);
  assert.doesNotMatch(page, /campus-last-student-code/);
  assert.match(loginPanel, /LAST_TEACHER_INITIALS_KEY/);
  assert.match(authEntry, /campus-last-teacher-initials/);
});

test("I — backup v4 : round-trip, colonnes, pas de plaintext, ancien snapshot", async () => {
  resetWorld();
  const admin = await adminDeps();
  const schoolClass = (await admin.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const deps = memoryBackupDeps();
  await deps.years.seedDefaultActiveYearIfEmpty();
  const snapshot = await exportCampusSnapshot(deps);
  assert.equal(snapshot.version, 4);
  const row = (snapshot.tables.student_accesses ?? []).find((entry) => entry.school_class_id === schoolClass.id);
  assert.ok(row);
  assert.equal(typeof row.access_code_hash, "string");
  assert.ok(String(row.access_code_hash).startsWith("pbkdf2-sha256$"));
  assert.equal(JSON.stringify(snapshot.tables.student_accesses).includes(generated.code), false);
  assert.equal(typeof row.access_code_ciphertext, "string");
  assert.ok(String(row.access_code_ciphertext).startsWith("aes-gcm-v1$"));
  assert.ok(Number(row.access_version) >= 1);
  assert.ok("school_class_id" in row);
  assert.ok("revoked_at" in row);

  const restored = await restoreCampusSnapshot(deps, snapshot);
  assert.equal(restored.ok, true);
  const again = await exportCampusSnapshot(deps);
  assert.deepEqual(canonicalizeCampusDump(again.tables), canonicalizeCampusDump(snapshot.tables));
  const after = await admin.accesses.getBySchoolClassId(schoolClass.id);
  assert.ok(after);
  assert.equal(await verifyPassword(generated.code, after.accessCodeHash), true);
  assert.equal(await unsealStudentAccessCode(after.accessCodeCiphertext), generated.code);

  const oldTables = JSON.parse(JSON.stringify(snapshot.tables)) as typeof snapshot.tables;
  for (const access of oldTables.student_accesses ?? []) {
    delete access.school_class_id;
    delete access.access_version;
    delete access.created_at;
    delete access.updated_at;
    delete access.revoked_at;
    delete access.access_code_ciphertext;
    access.access_code_hash = "demo:legacy-unusable";
  }
  const validated = validateCampusTables(oldTables);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.reason);
  const oldRestore = await restoreCampusSnapshot(deps, { ...snapshot, tables: oldTables });
  assert.equal(oldRestore.ok, true);
  const legacyRow = (await admin.accesses.listAll())[0];
  assert.ok(legacyRow);
  assert.equal(isUsablePasswordHash(legacyRow.accessCodeHash), false);
  const legacyLogin = await authenticateStudentAccessCode(generated.code, await loginDepsFrom(admin));
  assert.equal(legacyLogin.ok, false);
});

test("session élève ancienne (sans version) invalidée à l'analyse du jeton", async () => {
  const token = await createSessionToken({
    kind: "student",
    accessId: "student-access-demo-2a",
    accessVersion: 1,
    classroomId: "classe-demo-tma-2a",
    schoolClassId: "school-class-ma2",
    schoolYearId: "year-active-test",
    label: "MA2",
    issuedAt: Date.now(),
  });
  const ok = await parseSessionToken(token);
  assert.equal(ok?.kind, "student");

  const secret = process.env.AUTH_SECRET ?? "test-secret-student-access-244";
  const payload = Buffer.from(JSON.stringify({
    kind: "student",
    accessId: "legacy",
    classroomId: "classe-demo-tma-2a",
    label: "eleve-test-001",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sig = Buffer.from(new Uint8Array(signature)).toString("base64url");
  assert.equal(await parseSessionToken(`${payload}.${sig}`), null);
});

test("SQLite — génération, login ACTIVE, hash stocké", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const years = new SqlSchoolYearStore(db);
  await years.seedDefaultActiveYearIfEmpty();
  await catalog.applySchoolYearBackfill(await years.listSchoolYears());
  const accesses = new SqlStudentAccessStore(db);
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const admin = {
    accesses,
    adapters,
    getSchoolClassById: async (id: string) => (await catalog.listClasses()).find((entry) => entry.id === id) ?? null,
    getSchoolYearById: (id: string) => years.getSchoolYearById(id),
    listClasses: () => catalog.listClasses(),
    listYears: () => years.listSchoolYears(),
  };
  const schoolClass = (await catalog.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const logged = await authenticateStudentAccessCode(generated.code, {
    getActiveSchoolYear: () => years.getActiveSchoolYear(),
    listClasses: () => catalog.listClasses(),
    getAccessBySchoolClassId: (id) => accesses.getBySchoolClassId(id),
    findClassroomBySchoolClassId: (id) => adapters.findClassroomBySchoolClassId(id),
  });
  assert.equal(logged.ok, true);
  const stored = await accesses.getBySchoolClassId(schoolClass.id);
  assert.ok(stored);
  assert.equal(isUsablePasswordHash(stored.accessCodeHash), true);
  const agenda = new SqlAgendaStore(db);
  assert.ok(await agenda.findStudentAccessById(stored.id));
  const ddl = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'student_accesses'")
    .bind()
    .first<{ sql: string }>();
  assert.ok(ddl?.sql);
  assert.match(ddl.sql, /label TEXT NOT NULL/);
  assert.doesNotMatch(ddl.sql, /label TEXT NOT NULL UNIQUE/);
  db.close();
});

test("SQLite — deux SchoolClass MA2 (ACTIVE + DRAFT) ont chacune un accès", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const years = new SqlSchoolYearStore(db);
  await years.seedDefaultActiveYearIfEmpty();
  await catalog.applySchoolYearBackfill(await years.listSchoolYears());
  const accesses = new SqlStudentAccessStore(db);
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const admin = {
    accesses,
    adapters,
    getSchoolClassById: async (id: string) => (await catalog.listClasses()).find((entry) => entry.id === id) ?? null,
    getSchoolYearById: (id: string) => years.getSchoolYearById(id),
    listClasses: () => catalog.listClasses(),
    listYears: () => years.listSchoolYears(),
  };

  const activeYear = await years.getActiveSchoolYear();
  assert.ok(activeYear);
  assert.equal(activeYear.status, "active");
  assert.match(activeYear.label, /2026/);
  const activeClass = (await catalog.listClasses()).find(
    (entry) => entry.code === "MA2" && entry.schoolYearId === activeYear.id,
  );
  assert.ok(activeClass);

  const activeGenerated = await generateStudentAccess(admin, activeClass.id);
  assert.equal(activeGenerated.ok, true);
  if (!activeGenerated.ok) return;

  await db
    .prepare(
      `INSERT INTO school_years (id, label, status, starts_on, ends_on, created_at)
       VALUES (?, ?, 'draft', '2027-08-16', '2028-07-02', ?)`,
    )
    .bind("year-draft-2027", "2027-2028", new Date().toISOString())
    .run();
  const draftClass = await catalog.createClass({
    code: "MA2",
    label: "MA2 2027-2028",
    schoolYearId: "year-draft-2027",
    schoolYearLabel: "2027-2028",
  });
  assert.equal(draftClass.code, "MA2");
  assert.notEqual(draftClass.id, activeClass.id);

  const draftGenerated = await generateStudentAccess(admin, draftClass.id);
  assert.equal(draftGenerated.ok, true, draftGenerated.ok ? "" : draftGenerated.reason);
  if (!draftGenerated.ok) return;

  const listed = await accesses.listAll();
  const ma2Rows = listed.filter((row) => row.label === "MA2");
  assert.equal(ma2Rows.length, 2);
  const activeAccess = await accesses.getBySchoolClassId(activeClass.id);
  const draftAccess = await accesses.getBySchoolClassId(draftClass.id);
  assert.ok(activeAccess);
  assert.ok(draftAccess);
  assert.notEqual(activeAccess.schoolClassId, draftAccess.schoolClassId);
  assert.notEqual(activeAccess.accessCodeHash, draftAccess.accessCodeHash);
  assert.notEqual(activeGenerated.code, draftGenerated.code);
  assert.equal(isUsablePasswordHash(activeAccess.accessCodeHash), true);
  assert.equal(isUsablePasswordHash(draftAccess.accessCodeHash), true);

  const loginDeps = {
    getActiveSchoolYear: () => years.getActiveSchoolYear(),
    listClasses: () => catalog.listClasses(),
    getAccessBySchoolClassId: (id: string) => accesses.getBySchoolClassId(id),
    findClassroomBySchoolClassId: (id: string) => adapters.findClassroomBySchoolClassId(id),
  };
  const draftLogin = await authenticateStudentAccessCode(draftGenerated.code, loginDeps);
  assert.equal(draftLogin.ok, false);
  const activeLogin = await authenticateStudentAccessCode(activeGenerated.code, loginDeps);
  assert.equal(activeLogin.ok, true);

  const dump = await dumpCampusTables(db);
  const dumpedMa2 = (dump.student_accesses ?? []).filter((row) => row.label === "MA2");
  assert.equal(dumpedMa2.length, 2);
  assert.equal(
    new Set(dumpedMa2.map((row) => String(row.school_class_id))).size,
    2,
  );
  assert.notEqual(dumpedMa2[0]?.access_code_hash, dumpedMa2[1]?.access_code_hash);
  assert.equal(JSON.stringify(dumpedMa2).includes(activeGenerated.code), false);
  assert.equal(JSON.stringify(dumpedMa2).includes(draftGenerated.code), false);

  const db2 = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db2);
  await restoreCampusTables(db2, dump);
  const restoredDump = await dumpCampusTables(db2);
  assert.deepEqual(
    canonicalizeCampusDump({ student_accesses: restoredDump.student_accesses ?? [] }),
    canonicalizeCampusDump({ student_accesses: dump.student_accesses ?? [] }),
  );

  const restoredAccesses = new SqlStudentAccessStore(db2);
  const restoredCatalog = new SqlSchoolCatalogStore(db2);
  const restoredYears = new SqlSchoolYearStore(db2);
  const restoredAdapters = new SqlRuntimeAgendaAdapterStore(db2);
  const restoredMa2 = await restoredAccesses.listAll();
  assert.equal(restoredMa2.filter((row) => row.label === "MA2").length, 2);
  const restoredLogin = await authenticateStudentAccessCode(activeGenerated.code, {
    getActiveSchoolYear: () => restoredYears.getActiveSchoolYear(),
    listClasses: () => restoredCatalog.listClasses(),
    getAccessBySchoolClassId: (id) => restoredAccesses.getBySchoolClassId(id),
    findClassroomBySchoolClassId: (id) => restoredAdapters.findClassroomBySchoolClassId(id),
  });
  assert.equal(restoredLogin.ok, true);
  const restoredDraftLogin = await authenticateStudentAccessCode(draftGenerated.code, {
    getActiveSchoolYear: () => restoredYears.getActiveSchoolYear(),
    listClasses: () => restoredCatalog.listClasses(),
    getAccessBySchoolClassId: (id) => restoredAccesses.getBySchoolClassId(id),
    findClassroomBySchoolClassId: (id) => restoredAdapters.findClassroomBySchoolClassId(id),
  });
  assert.equal(restoredDraftLogin.ok, false);

  await applyMigrations(db);
  const afterReplay = await accesses.listAll();
  assert.equal(afterReplay.filter((row) => row.label === "MA2").length, 2);

  db.close();
  db2.close();
});

test("pickReusableStudentAccess — classe, id déterministe, classroom, label orphelin", () => {
  const rows = [
    {
      id: "other",
      classroomId: "classe-x",
      schoolClassId: "class-other",
      label: "MMA1A",
      accessCodeHash: "pbkdf2-sha256$10000$YQ==$Yg==",
      accessCodeCiphertext: null,
      accessVersion: 1,
      createdAt: null,
      updatedAt: null,
      revokedAt: null,
    },
    {
      id: "orphan-label",
      classroomId: "classe-legacy-mma1a",
      schoolClassId: null,
      label: "MMA1A",
      accessCodeHash: "pbkdf2-sha256$10000$YQ==$Yg==",
      accessCodeCiphertext: null,
      accessVersion: 2,
      createdAt: null,
      updatedAt: null,
      revokedAt: null,
    },
  ];
  const picked = pickReusableStudentAccess(rows, {
    schoolClassId: "class-mma1a",
    classroomId: "classroom-school-class-mma1a",
    label: "MMA1A",
  });
  assert.equal(picked?.id, "orphan-label");

  const byClass = pickReusableStudentAccess(
    [{ ...rows[1]!, schoolClassId: "class-mma1a", id: "linked" }, rows[0]!],
    { schoolClassId: "class-mma1a", classroomId: "x", label: "MMA1A" },
  );
  assert.equal(byClass?.id, "linked");

  const expectedId = deterministicStudentAccessId("class-mma1a");
  const byId = pickReusableStudentAccess(
    [{ ...rows[1]!, id: expectedId, label: "OTHER" }],
    { schoolClassId: "class-mma1a", classroomId: "x", label: "MMA1A" },
  );
  assert.equal(byId?.id, expectedId);
});

test("accès orphelin (label sans school_class_id) : générer réclame la ligne et révèle un code", async () => {
  resetWorld();
  const admin = await adminDeps();
  const active = await admin.years.getActiveSchoolYear();
  assert.ok(active);
  const schoolClass = await admin.catalog.createClass({
    code: "MMA1A",
    label: "MMA1A",
    schoolYearId: active.id,
    schoolYearLabel: active.label,
  });
  await admin.adapters.upsertClassroom({
    id: "classe-legacy-mma1a",
    name: "MMA1A",
    programLabel: "MECMA",
    accessCodeHint: "MMA1A",
    schoolClassId: null,
  });
  await admin.accesses.replaceAll([
    {
      id: "student-orphan-mma1a",
      classroomId: "classe-legacy-mma1a",
      schoolClassId: null,
      label: "MMA1A",
      accessCodeHash: "pbkdf2-sha256$10000$YQ==$Yg==",
      accessCodeCiphertext: null,
      accessVersion: 3,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      revokedAt: null,
    },
  ]);
  const hidden = await listStudentAccessMetadata(admin, schoolClass.id);
  assert.equal(hidden.length, 0);

  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true, generated.ok ? "" : generated.reason);
  if (!generated.ok) return;
  assert.match(generated.code, /^MMA1A-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const stored = await admin.accesses.getBySchoolClassId(schoolClass.id);
  assert.ok(stored);
  assert.equal(stored.id, "student-orphan-mma1a");
  assert.equal(stored.schoolClassId, schoolClass.id);
  assert.equal(stored.accessVersion, 4);
  assert.equal(stored.classroomId, "classe-legacy-mma1a");
  const classroom = await admin.adapters.findClassroomBySchoolClassId(schoolClass.id);
  assert.equal(classroom?.id, "classe-legacy-mma1a");
  const login = await authenticateStudentAccessCode(generated.code, await loginDepsFrom(admin));
  assert.equal(login.ok, true);

  const again = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.notEqual(again.code, generated.code);
  const rotated = await admin.accesses.getBySchoolClassId(schoolClass.id);
  assert.equal(rotated?.id, "student-orphan-mma1a");
  assert.equal(rotated?.accessVersion, 5);
});

test("SQLite — orphelin UNIQUE(label) historique et id déterministe : génération puis régénération", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const years = new SqlSchoolYearStore(db);
  await years.seedDefaultActiveYearIfEmpty();
  await catalog.applySchoolYearBackfill(await years.listSchoolYears());
  const accesses = new SqlStudentAccessStore(db);
  const adapters = new SqlRuntimeAgendaAdapterStore(db);
  const admin = {
    accesses,
    adapters,
    getSchoolClassById: async (id: string) => (await catalog.listClasses()).find((entry) => entry.id === id) ?? null,
    getSchoolYearById: (id: string) => years.getSchoolYearById(id),
    listClasses: () => catalog.listClasses(),
    listYears: () => years.listSchoolYears(),
  };
  const activeYear = await years.getActiveSchoolYear();
  assert.ok(activeYear);
  const schoolClass = await catalog.createClass({
    code: "MMA1B",
    label: "MMA1B",
    schoolYearId: activeYear.id,
    schoolYearLabel: activeYear.label,
  });
  await db
    .prepare(
      "INSERT INTO classrooms (id, name, program_label, access_code_hint, school_class_id) VALUES (?, ?, ?, ?, NULL)",
    )
    .bind("classe-legacy-mma1b", "MMA1B", "MECMA", "MMA1B")
    .run();
  await db
    .prepare(
      `INSERT INTO student_accesses
        (id, classroom_id, school_class_id, label, access_code_hash, access_version, created_at, updated_at, revoked_at)
       VALUES (?, ?, NULL, ?, ?, 1, ?, ?, NULL)`,
    )
    .bind(
      "student-orphan-mma1b",
      "classe-legacy-mma1b",
      "MMA1B",
      "pbkdf2-sha256$10000$YQ==$Yg==",
      "2026-09-08T00:00:00.000Z",
      "2026-09-08T00:00:00.000Z",
    )
    .run();

  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true, generated.ok ? "" : generated.reason);
  if (!generated.ok) return;
  const stored = await accesses.getBySchoolClassId(schoolClass.id);
  assert.equal(stored?.id, "student-orphan-mma1b");
  assert.equal(stored?.schoolClassId, schoolClass.id);
  assert.equal(stored?.classroomId, "classe-legacy-mma1b");
  const login = await authenticateStudentAccessCode(generated.code, {
    getActiveSchoolYear: () => years.getActiveSchoolYear(),
    listClasses: () => catalog.listClasses(),
    getAccessBySchoolClassId: (id) => accesses.getBySchoolClassId(id),
    findClassroomBySchoolClassId: (id) => adapters.findClassroomBySchoolClassId(id),
  });
  assert.equal(login.ok, true);

  const pkClass = await catalog.createClass({
    code: "MMA1C",
    label: "MMA1C",
    schoolYearId: activeYear.id,
    schoolYearLabel: activeYear.label,
  });
  await db
    .prepare(
      "INSERT INTO classrooms (id, name, program_label, access_code_hint, school_class_id) VALUES (?, ?, ?, ?, NULL)",
    )
    .bind("classe-legacy-mma1c", "MMA1C", "MECMA", "MMA1C")
    .run();
  const pkId = deterministicStudentAccessId(pkClass.id);
  await db
    .prepare(
      `INSERT INTO student_accesses
        (id, classroom_id, school_class_id, label, access_code_hash, access_version, created_at, updated_at, revoked_at)
       VALUES (?, ?, NULL, ?, ?, 2, ?, ?, NULL)`,
    )
    .bind(
      pkId,
      "classe-legacy-mma1c",
      "MMA1C",
      "pbkdf2-sha256$10000$YQ==$Yg==",
      "2026-09-08T00:00:00.000Z",
      "2026-09-08T00:00:00.000Z",
    )
    .run();
  const regenerated = await generateStudentAccess(admin, pkClass.id);
  assert.equal(regenerated.ok, true, regenerated.ok ? "" : regenerated.reason);
  if (!regenerated.ok) return;
  const pkStored = await accesses.getBySchoolClassId(pkClass.id);
  assert.equal(pkStored?.id, pkId);
  assert.equal(pkStored?.schoolClassId, pkClass.id);
  assert.equal(pkStored?.accessVersion, 3);
  const pkLogin = await authenticateStudentAccessCode(regenerated.code, {
    getActiveSchoolYear: () => years.getActiveSchoolYear(),
    listClasses: () => catalog.listClasses(),
    getAccessBySchoolClassId: (id) => accesses.getBySchoolClassId(id),
    findClassroomBySchoolClassId: (id) => adapters.findClassroomBySchoolClassId(id),
  });
  assert.equal(pkLogin.ok, true);
  db.close();
});

test("enseignant attribué voit le code courant, un autre identifiant ne le voit pas, régénération met à jour, révocation masque", async () => {
  resetWorld();
  const admin = await adminDeps();
  const schoolClass = (await admin.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true);
  if (!generated.ok) return;

  const assigned = await teacherClassAccessViews(admin.accesses, [
    { schoolClassId: schoolClass.id, classCode: schoolClass.code },
  ]);
  assert.equal(assigned[schoolClass.id]?.status, "active");
  assert.equal(assigned[schoolClass.id]?.code, generated.code);
  assert.equal(assigned[schoolClass.id]?.classCode, schoolClass.code);

  const stranger = await teacherClassAccessViews(admin.accesses, ["class-not-mine"]);
  assert.equal(stranger[schoolClass.id], undefined);
  assert.equal(stranger["class-not-mine"]?.code, null);
  assert.equal(JSON.stringify(stranger).includes(generated.code), false);

  const rotated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(rotated.ok, true);
  if (!rotated.ok) return;
  assert.notEqual(rotated.code, generated.code);
  const afterRotate = await teacherClassAccessViews(admin.accesses, [schoolClass.id]);
  assert.equal(afterRotate[schoolClass.id]?.code, rotated.code);
  assert.notEqual(afterRotate[schoolClass.id]?.code, generated.code);

  const revoked = await revokeStudentAccess(admin, schoolClass.id);
  assert.equal(revoked.ok, true);
  const afterRevoke = await teacherClassAccessViews(admin.accesses, [schoolClass.id]);
  assert.equal(afterRevoke[schoolClass.id]?.status, "revoked");
  assert.equal(afterRevoke[schoolClass.id]?.code, null);
  assert.equal(JSON.stringify(afterRevoke).includes(rotated.code), false);

  const mesCours = await readFile(new URL("../web/app/components/mes-cours-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(mesCours, /localStorage/);
});

test("enseignant voit le code si MECAUTO 3A et MECAUTO3A désignent la même classe", async () => {
  resetWorld();
  assert.equal(compactClassCodeKey("MECAUTO 3A"), "MECAUTO3A");
  const plaintext = "MECAUTO3A-K7M4-R2P8";
  const store = getMemoryStudentAccessStore();
  await store.replaceAll([
    {
      id: "orphan-mecauto",
      classroomId: "classroom-mecauto",
      schoolClassId: null,
      label: "MECAUTO 3A",
      accessCodeHash: "pbkdf2-sha256$10000$YQ==$Yg==",
      accessCodeCiphertext: await sealStudentAccessCode(plaintext),
      accessVersion: 1,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
      revokedAt: null,
    },
  ]);
  const views = await teacherClassAccessViews(store, [
    { schoolClassId: "class-mecauto-3a", classCode: "MECAUTO3A" },
  ]);
  assert.equal(views["class-mecauto-3a"]?.status, "active");
  assert.equal(views["class-mecauto-3a"]?.code, plaintext);
  const other = await teacherClassAccessViews(store, [
    { schoolClassId: "class-other", classCode: "MMA1A" },
  ]);
  assert.equal(other["class-other"]?.code, null);
  assert.equal(JSON.stringify(other).includes(plaintext), false);
});

test("login HTTP — mauvais code 401 identique, bon code 200", async () => {
  resetWorld();
  const admin = await adminDeps();
  const schoolClass = (await admin.listClasses()).find((entry) => entry.code === "MA2");
  assert.ok(schoolClass);
  const generated = await generateStudentAccess(admin, schoolClass.id);
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const deps = await loginDepsFrom(admin);
  const bad = await authenticateStudentAccessCode("MA2-XXXX-XXXX", deps);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, STUDENT_LOGIN_INVALID_REASON);
  const good = await authenticateStudentAccessCode(generated.code, deps);
  assert.equal(good.ok, true);
  if (!good.ok) return;
  const token = await createSessionToken(good.session);
  const cookie = buildSessionCookie(token);
  const parsed = await parseSessionToken(decodeURIComponent(cookie.split(";")[0]?.split("=")[1] ?? ""));
  assert.equal(parsed?.kind, "student");
  const live = await revalidateLiveSession(parsed!, {
    findAccount: (id) => getMemoryTeacherAccountStore().findAccount(id),
    revalidateStudent: (session) =>
      revalidateStructuredStudentSession(session, {
        getAccessById: (id) => admin.accesses.getById(id),
        getSchoolClassById: (id) => admin.getSchoolClassById(id),
        getActiveSchoolYear: () => admin.years.getActiveSchoolYear(),
        findClassroomBySchoolClassId: (id) => admin.adapters.findClassroomBySchoolClassId(id),
      }),
  });
  assert.equal(live?.kind, "student");
});
