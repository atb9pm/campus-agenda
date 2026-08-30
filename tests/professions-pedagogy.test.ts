import assert from "node:assert/strict";
import test from "node:test";

import {
  canReduceProfessionDuration,
  evaluateAgendaBranchForClass,
  formatAdminCode,
  isBranchAllowedForClass,
  listBranchesForClass,
  validateClassProfessionAttachment,
} from "../src/features/school-catalog/index.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";

function freshMemory() {
  resetMemorySchoolCatalogStore();
  return getMemorySchoolCatalogStore();
}

test("professions — création et ID permanent PRF", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({
    label: "Mécatronicien d'automobiles",
    durationYears: 4,
  });
  assert.equal(profession.adminCode, "PRF-0001");
  assert.equal(profession.durationYears, 4);
  assert.equal(formatAdminCode("PRF", 1), "PRF-0001");
});

test("professions — renommage sans changement d'ID", async () => {
  const store = freshMemory();
  const created = await store.createProfession({ label: "Mécano", durationYears: 3 });
  const renamed = await store.updateProfession(created.id, { label: "Mécanicien en maintenance" });
  assert.equal(renamed.ok, true);
  if (!renamed.ok) return;
  assert.equal(renamed.value.adminCode, created.adminCode);
  assert.equal(renamed.value.label, "Mécanicien en maintenance");
});

test("professions — durée et augmentation", async () => {
  const store = freshMemory();
  const created = await store.createProfession({ label: "Conducteur", durationYears: 3 });
  const expanded = await store.updateProfession(created.id, { durationYears: 4 });
  assert.equal(expanded.ok, true);
  if (!expanded.ok) return;
  assert.equal(expanded.value.durationYears, 4);
});

test("professions — réduction autorisée sans dépendances", async () => {
  const store = freshMemory();
  const created = await store.createProfession({ label: "Assistant", durationYears: 4 });
  const reduced = await store.updateProfession(created.id, { durationYears: 2 });
  assert.equal(reduced.ok, true);
  if (!reduced.ok) return;
  assert.equal(reduced.value.durationYears, 2);
});

test("professions — réduction bloquée avec dépendances", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const [branch] = await store.listBranches();
  assert.ok(branch);
  const ctx = await store.createContext({
    professionId: profession.id,
    trainingYear: 4,
    branchId: branch.id,
  });
  assert.equal(ctx.ok, true);

  const blocked = await store.updateProfession(profession.id, { durationYears: 3 });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.match(blocked.reason, /réduire/i);

  const ruleCheck = canReduceProfessionDuration({
    profession,
    nextDurationYears: 3,
    contexts: await store.listContexts(),
    classes: await store.listClasses(),
  });
  assert.equal(ruleCheck.ok, false);
});

test("branches — création, ID permanent BR, renommage", async () => {
  const store = freshMemory();
  const branch = await store.createBranch({ code: "CLIM", label: "Climatisation" });
  assert.equal(branch.adminCode, "BR-0005");
  const renamed = await store.updateBranch(branch.id, { label: "Clim. habitacle", code: "CLIM_HAB" });
  assert.ok(renamed);
  assert.equal(renamed.adminCode, "BR-0005");
  assert.equal(renamed.label, "Clim. habitacle");
});

test("branches — archivage / désarchivage", async () => {
  const store = freshMemory();
  const [branch] = await store.listBranches();
  assert.ok(branch);
  const archived = await store.updateBranch(branch.id, { isArchived: true });
  assert.ok(archived?.isArchived);
  const restored = await store.updateBranch(branch.id, { isArchived: false });
  assert.equal(restored?.isArchived, false);
});

test("CTX — affectation profession + année + branche et unicité", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const branches = await store.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur")!;
  const elec = branches.find((entry) => entry.label === "Électricité")!;

  const year1 = await store.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(year1.ok, true);
  if (!year1.ok) return;
  assert.equal(year1.value.adminCode, "CTX-0001");

  const year2 = await store.createContext({
    professionId: profession.id,
    trainingYear: 2,
    branchId: moteur.id,
  });
  assert.equal(year2.ok, true);
  if (!year2.ok) return;
  assert.equal(year2.value.adminCode, "CTX-0002");
  assert.equal(year2.value.branchId, year1.value.branchId);

  const otherProfession = await store.createProfession({ label: "Conducteur", durationYears: 3 });
  const shared = await store.createContext({
    professionId: otherProfession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(shared.ok, true);

  const withElec = await store.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: elec.id,
  });
  assert.equal(withElec.ok, true);

  const duplicate = await store.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: moteur.id,
  });
  assert.equal(duplicate.ok, false);
});

test("classes — rattachement et filtrage des branches", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const branches = await store.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur")!;
  const transmission = branches.find((entry) => entry.label === "Transmission")!;

  await store.createContext({
    professionId: profession.id,
    trainingYear: 3,
    branchId: moteur.id,
  });
  await store.createContext({
    professionId: profession.id,
    trainingYear: 3,
    branchId: transmission.id,
  });

  const [schoolClass] = await store.listClasses();
  assert.ok(schoolClass);
  const linked = await store.updateClass(schoolClass.id, {
    professionId: profession.id,
    trainingYear: 3,
  });
  assert.ok(linked);

  const filtered = listBranchesForClass({
    schoolClass: linked,
    branches: await store.listBranches(),
    contexts: await store.listContexts(),
  });
  assert.equal(filtered.length, 2);
  assert.equal(
    isBranchAllowedForClass({
      schoolClass: linked,
      branch: moteur,
      contexts: await store.listContexts(),
    }),
    true,
  );
  const chassis = branches.find((entry) => entry.label === "Châssis")!;
  assert.equal(
    isBranchAllowedForClass({
      schoolClass: linked,
      branch: chassis,
      contexts: await store.listContexts(),
    }),
    false,
  );
});

test("classes — legacy sans rattachement : toutes les branches actives", async () => {
  const store = freshMemory();
  const [schoolClass] = await store.listClasses();
  assert.ok(schoolClass);
  assert.equal(schoolClass.professionId, null);
  const filtered = listBranchesForClass({
    schoolClass,
    branches: await store.listBranches(),
    contexts: await store.listContexts(),
  });
  assert.equal(
    filtered.length,
    (await store.listBranches()).filter((entry) => entry.isActive && !entry.isArchived).length,
  );
});

test("suppression — inutilisée OK, dépendances bloquées", async () => {
  const store = freshMemory();
  const unused = await store.createProfession({ label: "Doublon erreur", durationYears: 2 });
  const deleted = await store.deleteProfession(unused.id);
  assert.equal(deleted.ok, true);

  const profession = await store.createProfession({ label: "Utilisée", durationYears: 3 });
  const [branch] = await store.listBranches();
  assert.ok(branch);
  const ctx = await store.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: branch.id,
  });
  assert.equal(ctx.ok, true);

  assert.equal((await store.deleteProfession(profession.id)).ok, false);
  assert.equal((await store.deleteBranch(branch.id)).ok, false);

  if (ctx.ok) {
    assert.equal((await store.deleteContext(ctx.value.id)).ok, true);
  }
  assert.equal((await store.deleteProfession(profession.id)).ok, true);
});

test("persistence SQLite — migration professions + compteurs", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const store = new SqlSchoolCatalogStore(db);
  await store.ensureSeeded();

  const profession = await store.createProfession({
    label: "Mécatronicien d'automobiles",
    durationYears: 4,
  });
  assert.match(profession.adminCode, /^PRF-\d{4}$/);

  const branches = await store.listBranches();
  assert.ok(branches.every((entry) => /^BR-\d{4}$/.test(entry.adminCode)));

  const ctx = await store.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: branches[0]!.id,
  });
  assert.equal(ctx.ok, true);
  if (ctx.ok) assert.match(ctx.value.adminCode, /^CTX-\d{4}$/);

  const [schoolClass] = await store.listClasses();
  assert.ok(schoolClass);
  const linked = await store.updateClass(schoolClass.id, {
    professionId: profession.id,
    trainingYear: 1,
  });
  assert.equal(linked?.professionId, profession.id);

  const renamed = await store.updateProfession(profession.id, {
    label: "Mécatronicien automobiles",
  });
  assert.equal(renamed.ok, true);
  if (renamed.ok) assert.equal(renamed.value.adminCode, profession.adminCode);
});

test("consolidation — publication autorisée avec branche du CTX", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const branches = await store.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur")!;
  await store.createContext({
    professionId: profession.id,
    trainingYear: 2,
    branchId: moteur.id,
  });
  const schoolClass = await store.createClass({
    code: "MA2CTX",
    label: "MA2CTX",
    professionId: profession.id,
    trainingYear: 2,
  });
  const result = evaluateAgendaBranchForClass({
    classroomName: schoolClass.code,
    subjectName: "Moteur",
    classes: await store.listClasses(),
    branches: await store.listBranches(),
    contexts: await store.listContexts(),
  });
  assert.equal(result.ok, true);
});

test("consolidation — publication refusée hors CTX", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({ label: "Mécatronicien", durationYears: 4 });
  const branches = await store.listBranches();
  const moteur = branches.find((entry) => entry.label === "Moteur")!;
  const chassis = branches.find((entry) => entry.label === "Châssis")!;
  await store.createContext({
    professionId: profession.id,
    trainingYear: 2,
    branchId: moteur.id,
  });
  const schoolClass = await store.createClass({
    code: "MA2CTX2",
    label: "MA2CTX2",
    professionId: profession.id,
    trainingYear: 2,
  });
  const result = evaluateAgendaBranchForClass({
    classroomName: schoolClass.code,
    subjectName: chassis.label,
    classes: await store.listClasses(),
    branches: await store.listBranches(),
    contexts: await store.listContexts(),
  });
  assert.equal(result.ok, false);
});

test("consolidation — legacy sans profession/année autorise les branches actives", async () => {
  const store = freshMemory();
  const [schoolClass] = await store.listClasses();
  assert.ok(schoolClass);
  assert.equal(schoolClass.professionId, null);
  const result = evaluateAgendaBranchForClass({
    classroomName: schoolClass.code,
    subjectName: "Châssis",
    classes: await store.listClasses(),
    branches: await store.listBranches(),
    contexts: await store.listContexts(),
  });
  assert.equal(result.ok, true);
});

test("consolidation — classe profession+année valides", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({ label: "Conducteur", durationYears: 3 });
  const created = await store.createClass({
    code: "COND1",
    label: "COND1",
    professionId: profession.id,
    trainingYear: 3,
  });
  assert.equal(created.professionId, profession.id);
  assert.equal(created.trainingYear, 3);
  const check = validateClassProfessionAttachment({
    professionId: profession.id,
    trainingYear: 2,
    professions: await store.listProfessions(),
  });
  assert.equal(check.ok, true);
});

test("consolidation — refus année > durée profession", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({ label: "Assistant", durationYears: 3 });
  await assert.rejects(
    () =>
      store.createClass({
        code: "BADY",
        label: "BADY",
        professionId: profession.id,
        trainingYear: 4,
      }),
    /durée|dépasse|année/i,
  );
});

test("consolidation — refus états profession/année incohérents", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({ label: "Tech", durationYears: 2 });
  await assert.rejects(
    () =>
      store.createClass({
        code: "MIX1",
        label: "MIX1",
        professionId: null,
        trainingYear: 2,
      }),
    /ensemble|toutes deux/i,
  );
  await assert.rejects(
    () =>
      store.createClass({
        code: "MIX2",
        label: "MIX2",
        professionId: profession.id,
        trainingYear: null,
      }),
    /ensemble|toutes deux/i,
  );
  const missing = validateClassProfessionAttachment({
    professionId: "does-not-exist",
    trainingYear: 1,
    professions: await store.listProfessions(),
  });
  assert.equal(missing.ok, false);
});

test("consolidation — IDs PRF/BR/CTX stables après modification", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({ label: "Init", durationYears: 3 });
  const branch = await store.createBranch({ code: "NEWB", label: "Nouvelle" });
  const ctx = await store.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: branch.id,
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) return;
  const renamedProfession = await store.updateProfession(profession.id, { label: "Renommée" });
  const renamedBranch = await store.updateBranch(branch.id, { label: "Branche renommée" });
  assert.equal(renamedProfession.ok, true);
  if (renamedProfession.ok) assert.equal(renamedProfession.value.adminCode, profession.adminCode);
  assert.equal(renamedBranch?.adminCode, branch.adminCode);
  assert.equal(ctx.value.adminCode, "CTX-0001");
});

test("consolidation — génération successive sans duplication (mémoire)", async () => {
  const store = freshMemory();
  const codes = [];
  for (let index = 0; index < 8; index += 1) {
    const profession = await store.createProfession({
      label: `Profession ${index}`,
      durationYears: 2,
    });
    codes.push(profession.adminCode);
  }
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(
    codes,
    Array.from({ length: 8 }, (_, index) => formatAdminCode("PRF", index + 1)),
  );
});

test("consolidation — génération successive sans duplication (SQLite)", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const store = new SqlSchoolCatalogStore(db);
  await store.ensureSeeded();

  const professions = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      store.createProfession({ label: `Concurrent ${index}`, durationYears: 2 }),
    ),
  );
  const codes = professions.map((entry) => entry.adminCode);
  assert.equal(new Set(codes).size, codes.length);
  const sequences = codes
    .map((code) => Number(code.split("-")[1]))
    .sort((left, right) => left - right);
  assert.deepEqual(sequences, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  // Monotonie du compteur après sync : pas de recyclage
  const more = await store.createProfession({ label: "Encore", durationYears: 2 });
  assert.equal(more.adminCode, "PRF-0011");
});

test("consolidation — persistence mémoire des rattachements", async () => {
  const store = freshMemory();
  const profession = await store.createProfession({ label: "Persist M", durationYears: 3 });
  const created = await store.createClass({
    code: "PM1",
    label: "PM1",
    professionId: profession.id,
    trainingYear: 1,
  });
  const listed = (await store.listClasses()).find((entry) => entry.id === created.id);
  assert.equal(listed?.professionId, profession.id);
  assert.equal(listed?.trainingYear, 1);
});

test("consolidation — persistence SQLite + migration base existante", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  // Rejouer les migrations (idempotence / base déjà migrée)
  await applyMigrations(db);
  const store = new SqlSchoolCatalogStore(db);
  await store.ensureSeeded();

  const beforeBranches = await store.listBranches();
  assert.ok(beforeBranches.length >= 4);
  const preserved = beforeBranches.map((entry) => entry.adminCode);

  const profession = await store.createProfession({ label: "Persist S", durationYears: 3 });
  const [branch] = beforeBranches;
  assert.ok(branch);
  const ctx = await store.createContext({
    professionId: profession.id,
    trainingYear: 1,
    branchId: branch.id,
  });
  assert.equal(ctx.ok, true);

  const linked = await store.updateClass((await store.listClasses())[0]!.id, {
    professionId: profession.id,
    trainingYear: 1,
  });
  assert.equal(linked?.professionId, profession.id);

  const afterBranches = await store.listBranches();
  assert.deepEqual(
    afterBranches.map((entry) => entry.adminCode),
    preserved,
  );
  assert.match(profession.adminCode, /^PRF-\d{4}$/);
  if (ctx.ok) assert.match(ctx.value.adminCode, /^CTX-\d{4}$/);
});
