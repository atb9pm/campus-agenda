import assert from "node:assert/strict";
import test from "node:test";

process.env.CAMPUS_PBKDF2_ITERATIONS ??= "10000";

import {
  CTX_IN_USE_DELETE_REASON,
  listBranchesForClass,
  listPlannedBranchesForClass,
  trainingYearsForDuration,
  validateAdminClassCreate,
  validateClassProfessionAttachment,
} from "../src/features/school-catalog/index.ts";
import { ensurePathForContext } from "../src/features/pedagogical-path/path-service.ts";
import {
  BRANCH_TEACHING_TYPE_LABELS,
  isTeachingType,
  requireTeachingType,
  TEACHER_TEACHING_TYPE_LABELS,
} from "../src/features/teaching-types/index.ts";
import { TEACHER_CHF_ID } from "../src/features/classes/index.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  getMemoryAnnualCourseNotesStore,
  getMemoryPedagogicalPathStore,
  resetMemoryPedagogicalPathStore,
} from "../src/lib/persistence/memory-pedagogical-path-store.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import { ensureTeacherAccountBootstrap } from "../src/lib/persistence/teacher-account-bootstrap.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations, splitSqlStatements } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import {
  SqlAnnualCourseNotesStore,
  SqlPedagogicalPathStore,
} from "../src/lib/persistence/sql/sql-pedagogical-path-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";

function freshCatalog() {
  resetMemorySchoolCatalogStore();
  resetMemoryPedagogicalPathStore();
  return getMemorySchoolCatalogStore();
}

function freshTeachers() {
  resetMemoryTeacherAccountStore();
  return getMemoryTeacherAccountStore();
}

const YEARS = [
  { id: "sy-2026", label: "2026-2027", status: "active" as const },
  { id: "sy-2027", label: "2027-2028", status: "draft" as const },
];

test("teaching types — uniquement TECHNICAL et GENERAL", () => {
  assert.equal(isTeachingType("TECHNICAL"), true);
  assert.equal(isTeachingType("GENERAL"), true);
  assert.equal(isTeachingType("MIXTE"), false);
  assert.equal(isTeachingType("BOTH"), false);
  assert.equal(isTeachingType(null), false);
  assert.equal(requireTeachingType("TECHNICAL").ok, true);
  assert.equal(requireTeachingType("GENERAL").ok, true);
  assert.equal(requireTeachingType("MIXTE").ok, false);
  assert.equal(requireTeachingType(null).ok, false);
  assert.equal(BRANCH_TEACHING_TYPE_LABELS.TECHNICAL, "Technique");
  assert.equal(BRANCH_TEACHING_TYPE_LABELS.GENERAL, "Branche générale");
  assert.equal(TEACHER_TEACHING_TYPE_LABELS.TECHNICAL, "Professeur technique");
  assert.equal(TEACHER_TEACHING_TYPE_LABELS.GENERAL, "Professeur de branche générale");
});

test("branches — TECHNICAL / GENERAL acceptés, autre valeur refusée, legacy null, ID stable", async () => {
  const store = freshCatalog();
  const technical = await store.createBranch({
    code: "MOTEUR",
    label: "Moteur",
    teachingType: "TECHNICAL",
  });
  assert.equal(technical.teachingType, "TECHNICAL");
  assert.match(technical.adminCode, /^BR-\d{4}$/);
  const stableId = technical.id;
  const stableCode = technical.adminCode;

  const general = await store.createBranch({
    code: "FRANCAIS",
    label: "Français",
    teachingType: "GENERAL",
  });
  assert.equal(general.teachingType, "GENERAL");

  await assert.rejects(
    () => store.createBranch({ code: "MIX", label: "Mixte", teachingType: "MIXTE" as "TECHNICAL" }),
    /TECHNICAL ou GENERAL/,
  );

  const legacy = await store.createBranch({ code: "CHASSIS", label: "Châssis" });
  assert.equal(legacy.teachingType, null);

  const renamed = await store.updateBranch(technical.id, { label: "Moteurs thermiques" });
  assert.ok(renamed);
  assert.equal(renamed.id, stableId);
  assert.equal(renamed.adminCode, stableCode);
  assert.equal(renamed.label, "Moteurs thermiques");
});

test("admin branche — type obligatoire via requireTeachingType", () => {
  assert.equal(requireTeachingType(undefined).ok, false);
  assert.equal(requireTeachingType("").ok, false);
});

test("profession / CTX — durée, même branche plusieurs années et professions, doublon refusé", async () => {
  const store = freshCatalog();
  const profession = await store.createProfession({
    label: "Mécatronicien d’automobiles",
    durationYears: 4,
  });
  assert.equal(profession.durationYears, 4);
  assert.deepEqual(trainingYearsForDuration(4), [1, 2, 3, 4]);

  const other = await store.createProfession({ label: "Automaticien", durationYears: 3 });
  const moteur = await store.createBranch({
    code: "MOTEUR",
    label: "Moteur",
    teachingType: "TECHNICAL",
  });

  const year1 = await store.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(year1.ok, true);
  if (!year1.ok) return;
  assert.match(year1.value.adminCode, /^CTX-\d{4}$/);

  const year2 = await store.createContext({
    professionId: profession.id,
    trainingYear: 2,
    branchId: moteur.id,
  });
  assert.equal(year2.ok, true);

  const otherYear = await store.createContext({
    professionId: other.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(otherYear.ok, true);

  const duplicate = await store.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(duplicate.ok, false);
});

test("parcours PR46 — toujours accessible sur un CTX", async () => {
  const catalog = freshCatalog();
  const profession = await catalog.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const [branch] = await catalog.listBranches();
  assert.ok(branch);
  const created = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: branch.id,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const result = await ensurePathForContext({
    contextId: created.value.id,
    catalog,
    pathStore: getMemoryPedagogicalPathStore(),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.contextId, created.value.id);
});

test("suppression CTX — vide OK, parcours et notes bloquent, archivage possible", async () => {
  const catalog = freshCatalog();
  const profession = await catalog.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const branches = await catalog.listBranches();
  const empty = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: branches[0]!.id,
  });
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.equal((await catalog.deleteContext(empty.value.id)).ok, true);

  const withPath = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 2,
    branchId: branches[0]!.id,
  });
  assert.equal(withPath.ok, true);
  if (!withPath.ok) return;
  const path = await ensurePathForContext({
    contextId: withPath.value.id,
    catalog,
    pathStore: getMemoryPedagogicalPathStore(),
  });
  assert.equal(path.ok, true);
  const blockedPath = await catalog.deleteContext(withPath.value.id);
  assert.equal(blockedPath.ok, false);
  if (!blockedPath.ok) assert.equal(blockedPath.reason, CTX_IN_USE_DELETE_REASON);

  const archived = await catalog.updateContext(withPath.value.id, { isArchived: true });
  assert.equal(archived.ok, true);
  if (!archived.ok) return;
  assert.ok(archived.value.isArchived);

  const withNote = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 3,
    branchId: branches[1]!.id,
  });
  assert.equal(withNote.ok, true);
  if (!withNote.ok) return;
  await getMemoryAnnualCourseNotesStore().createNote("note-ctx-1", {
    schoolYearId: "sy-2026",
    classId: "class-1",
    contextId: withNote.value.id,
    authorTeacherId: TEACHER_CHF_ID,
    text: "Note de cours annuelle",
  });
  const blockedNote = await catalog.deleteContext(withNote.value.id);
  assert.equal(blockedNote.ok, false);
  if (!blockedNote.ok) assert.equal(blockedNote.reason, CTX_IN_USE_DELETE_REASON);
});

test("classe admin — création complète, UI incomplète refusée, legacy lisible", async () => {
  const catalog = freshCatalog();
  const profession = await catalog.createProfession({
    label: "Mécatronicien d’automobiles",
    durationYears: 4,
  });

  const complete = validateAdminClassCreate({
    schoolYearId: "sy-2026",
    professionId: profession.id,
    trainingYear: 1,
    years: YEARS,
    professions: [profession],
  });
  assert.equal(complete.ok, true);
  if (!complete.ok) return;
  assert.equal(complete.value.schoolYearId, "sy-2026");
  assert.equal(complete.value.professionId, profession.id);
  assert.equal(complete.value.trainingYear, 1);

  const missingYear = validateAdminClassCreate({
    schoolYearId: "sy-2026",
    professionId: profession.id,
    trainingYear: null,
    years: YEARS,
    professions: [profession],
  });
  assert.equal(missingYear.ok, false);

  const missingSchoolYear = validateAdminClassCreate({
    schoolYearId: null,
    professionId: profession.id,
    trainingYear: 1,
    years: YEARS,
    professions: [profession],
  });
  assert.equal(missingSchoolYear.ok, false);

  const mixed = validateClassProfessionAttachment({
    professionId: profession.id,
    trainingYear: null,
    professions: [profession],
  });
  assert.equal(mixed.ok, false);

  const overDuration = validateClassProfessionAttachment({
    professionId: profession.id,
    trainingYear: 5,
    professions: [profession],
  });
  assert.equal(overDuration.ok, false);

  const created = await catalog.createClass({
    code: "MMA1A",
    label: "MMA1A",
    schoolYearId: complete.value.schoolYearId,
    schoolYearLabel: complete.value.schoolYearLabel,
    professionId: complete.value.professionId,
    trainingYear: complete.value.trainingYear,
  });
  assert.equal(created.schoolYearId, "sy-2026");
  assert.equal(created.professionId, profession.id);
  assert.equal(created.trainingYear, 1);

  const updated = await catalog.updateClass(created.id, {
    schoolYearId: "sy-2027",
    schoolYearLabel: "2027-2028",
    professionId: profession.id,
    trainingYear: 2,
  });
  assert.ok(updated);
  assert.equal(updated.schoolYearId, "sy-2027");
  assert.equal(updated.professionId, profession.id);
  assert.equal(updated.trainingYear, 2);

  const [legacy] = await catalog.listClasses();
  assert.ok(legacy);
  assert.equal(legacy.professionId, null);
  assert.equal(legacy.trainingYear, null);
  assert.ok(legacy.id);
});

test("classe — branches prévues déduites des CTX, aucun fallback silencieux", async () => {
  const catalog = freshCatalog();
  const profession = await catalog.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const moteur = await catalog.createBranch({
    code: "MOTEUR",
    label: "Moteur",
    teachingType: "TECHNICAL",
  });
  const transmission = await catalog.createBranch({
    code: "TRANS",
    label: "Transmission",
    teachingType: "TECHNICAL",
  });
  await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: transmission.id,
  });

  const schoolClass = await catalog.createClass({
    code: "MMA1A",
    label: "MMA1A",
    schoolYearId: "sy-2026",
    schoolYearLabel: "2026-2027",
    professionId: profession.id,
    trainingYear: 1,
  });
  const planned = listPlannedBranchesForClass({
    schoolClass,
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
  });
  assert.deepEqual(
    planned.map((entry) => entry.label).sort(),
    ["Moteur", "Transmission"],
  );

  const emptyProfession = await catalog.createProfession({ label: "Sans plan", durationYears: 3 });
  const emptyClass = await catalog.createClass({
    code: "EMP1",
    label: "EMP1",
    schoolYearId: "sy-2026",
    schoolYearLabel: "2026-2027",
    professionId: emptyProfession.id,
    trainingYear: 1,
  });
  const none = listPlannedBranchesForClass({
    schoolClass: emptyClass,
    branches: await catalog.listBranches(),
    contexts: await catalog.listContexts(),
  });
  assert.equal(none.length, 0);

  const [legacy] = (await catalog.listClasses()).filter((entry) => !entry.professionId);
  assert.ok(legacy);
  assert.equal(
    listPlannedBranchesForClass({
      schoolClass: legacy,
      branches: await catalog.listBranches(),
      contexts: await catalog.listContexts(),
    }).length,
    0,
  );
  assert.ok(
    listBranchesForClass({
      schoolClass: legacy,
      branches: await catalog.listBranches(),
      contexts: await catalog.listContexts(),
    }).length > 0,
  );
});

test("enseignants — TECHNICAL / GENERAL, pas de troisième type, legacy null, dernier admin", async () => {
  const store = freshTeachers();
  const technical = await store.createAccount({
    displayName: "François Dupont",
    initials: "FD",
    teachingType: "TECHNICAL",
  });
  assert.equal(technical.ok, true);
  if (!technical.ok) return;
  assert.equal(technical.account.teachingType, "TECHNICAL");

  const general = await store.createAccount({
    displayName: "Paul Martin",
    initials: "PM",
    teachingType: "GENERAL",
  });
  assert.equal(general.ok, true);
  if (!general.ok) return;
  assert.equal(general.account.teachingType, "GENERAL");

  const rejected = await store.createAccount({
    displayName: "Mixte",
    initials: "MX",
    teachingType: "MIXTE" as "TECHNICAL",
  });
  assert.equal(rejected.ok, false);

  const legacy = await store.createAccount({
    displayName: "Compte historique",
    initials: "LH",
  });
  assert.equal(legacy.ok, true);
  if (!legacy.ok) return;
  assert.equal(legacy.account.teachingType, null);

  const bootstrap = await ensureTeacherAccountBootstrap(store);
  assert.ok(bootstrap.action === "none" || bootstrap.action === "env-password" || bootstrap.action === "generated");
  const admin = (await store.listAccounts()).find((account) => account.id === TEACHER_CHF_ID);
  assert.ok(admin);
  assert.equal(admin.teachingType, null);
  assert.equal((await store.updateAccount(admin.id, { isAdmin: false })).ok, false);

  const disabled = await store.updateAccount(legacy.account.id, { isActive: false });
  assert.equal(disabled.ok, true);
  const archived = await store.updateAccount(legacy.account.id, { isArchived: true });
  assert.equal(archived.ok, true);
  if (!archived.ok) return;
  assert.equal(archived.account.isArchived, true);
});

test("SQLite 0018 — colonnes teaching_type, trigger CTX, comptes existants", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);

  const branchInfo = await db
    .prepare("PRAGMA table_info(school_branches)")
    .bind()
    .all<{ name: string }>();
  assert.ok((branchInfo.results ?? []).some((row) => row.name === "teaching_type"));
  const teacherInfo = await db
    .prepare("PRAGMA table_info(teachers)")
    .bind()
    .all<{ name: string }>();
  assert.ok((teacherInfo.results ?? []).some((row) => row.name === "teaching_type"));

  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const seededBranches = await catalog.listBranches();
  assert.ok(seededBranches.every((entry) => entry.teachingType === null));

  const technical = await catalog.createBranch({
    code: "FR",
    label: "Français",
    teachingType: "GENERAL",
  });
  assert.equal(technical.teachingType, "GENERAL");

  await assert.rejects(
    () =>
      db
        .prepare("UPDATE school_branches SET teaching_type = ? WHERE id = ?")
        .bind("MIXTE", technical.id)
        .run(),
    /CHECK|constraint|teaching_type/i,
  );

  const profession = await catalog.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const ctx = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: technical.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) return;

  const paths = new SqlPedagogicalPathStore(db);
  const ensured = await ensurePathForContext({
    contextId: ctx.value.id,
    catalog,
    pathStore: paths,
  });
  assert.equal(ensured.ok, true);
  const blocked = await catalog.deleteContext(ctx.value.id);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, CTX_IN_USE_DELETE_REASON);

  const remaining = (await catalog.listContexts()).find((entry) => entry.id === ctx.value.id);
  assert.ok(remaining);

  await assert.rejects(
    () => db.prepare("DELETE FROM pedagogical_contexts WHERE id = ?").bind(ctx.value.id).run(),
    /CTX used|archive instead|ABORT/i,
  );
  const stillThere = (await catalog.listContexts()).find((entry) => entry.id === ctx.value.id);
  assert.ok(stillThere);
  const pathAfter = await paths.getPathByContextId(ctx.value.id);
  assert.ok(pathAfter);

  const notes = new SqlAnnualCourseNotesStore(db);
  const ctxNote = await catalog.createContext({
    professionId: profession.id,
    trainingYear: 2,
    branchId: technical.id,
  });
  assert.equal(ctxNote.ok, true);
  if (!ctxNote.ok) return;
  await notes.createNote("note-sql-1", {
    schoolYearId: "sy-2026",
    classId: "class-sql",
    contextId: ctxNote.value.id,
    authorTeacherId: TEACHER_CHF_ID,
    text: "Note persistée",
  });
  const blockedNote = await catalog.deleteContext(ctxNote.value.id);
  assert.equal(blockedNote.ok, false);

  const accounts = new SqlTeacherAccountStore(db);
  const seeded = await accounts.listAccounts();
  assert.ok(seeded.some((account) => account.id === TEACHER_CHF_ID));
  assert.ok(seeded.every((account) => account.teachingType === null));
  const created = await accounts.createAccount({
    displayName: "Nouveau",
    initials: "NV",
    teachingType: "TECHNICAL",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.account.teachingType, "TECHNICAL");

  const triggerSql = splitSqlStatements(`
CREATE TRIGGER IF NOT EXISTS pedagogical_contexts_delete_guard
BEFORE DELETE ON pedagogical_contexts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CTX used archive instead')
  WHERE EXISTS (SELECT 1 FROM pedagogical_paths WHERE context_id = OLD.id);
END;
`);
  assert.equal(triggerSql.length, 1);

  db.close();
});
