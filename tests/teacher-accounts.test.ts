import assert from "node:assert/strict";
import test from "node:test";

// PBKDF2 réduit : les tests hachent plusieurs mots de passe par cas.
process.env.CAMPUS_PBKDF2_ITERATIONS ??= "10000";

import {
  buildTeacherId,
  checkAccountInput,
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
  normalizeInitials,
  formatLastLoginAt,
  sortAccounts,
  wouldRemoveLastAdmin,
  type TeacherAccountRecord,
} from "../src/features/teacher-accounts/index.ts";
import {
  demoPasswordAllowed,
  DEMO_TEACHER_PASSWORD,
  generateTemporaryPassword,
  hashPassword,
  isLegacyDemoHash,
  isUsablePasswordHash,
  legacyDemoPasswordHash,
  verifyPassword,
} from "../src/lib/auth/password.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import {
  describeBootstrapOutcome,
  ensureTeacherAccountBootstrap,
} from "../src/lib/persistence/teacher-account-bootstrap.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { SqlTeacherAccountStore } from "../src/lib/persistence/sql/sql-teacher-account-store.ts";
import { TEACHER_CHF_ID } from "../src/features/classes/index.ts";

function freshStore() {
  resetMemoryTeacherAccountStore();
  return getMemoryTeacherAccountStore();
}

test("mots de passe — hachage PBKDF2 salé et vérifiable", async () => {
  const hash = await hashPassword("Moteur-2027-ok");
  assert.ok(hash.startsWith("pbkdf2-sha256$"));
  assert.equal(isUsablePasswordHash(hash), true);
  assert.equal(hash.includes("Moteur-2027-ok"), false);
  assert.equal(await verifyPassword("Moteur-2027-ok", hash), true);
  assert.equal(await verifyPassword("moteur-2027-ok", hash), false);

  // Deux empreintes du même mot de passe diffèrent : le sel est aléatoire.
  assert.notEqual(hash, await hashPassword("Moteur-2027-ok"));
});

test("mots de passe — empreinte démo refusée sans autorisation explicite", async () => {
  const legacy = legacyDemoPasswordHash();
  assert.equal(isLegacyDemoHash(legacy), true);
  assert.equal(isUsablePasswordHash(legacy), false);

  const previous = process.env.CAMPUS_ALLOW_DEMO_PASSWORD;
  try {
    process.env.CAMPUS_ALLOW_DEMO_PASSWORD = "1";
    assert.equal(demoPasswordAllowed(), true);
    assert.equal(await verifyPassword(DEMO_TEACHER_PASSWORD, legacy), true);

    delete process.env.CAMPUS_ALLOW_DEMO_PASSWORD;
    assert.equal(demoPasswordAllowed(), false);
    assert.equal(await verifyPassword(DEMO_TEACHER_PASSWORD, legacy), false);

    process.env.NODE_ENV = "production";
    process.env.CAMPUS_ALLOW_DEMO_PASSWORD = "0";
    assert.equal(demoPasswordAllowed(), false);
    assert.equal(await verifyPassword(DEMO_TEACHER_PASSWORD, legacy), false);
  } finally {
    delete process.env.NODE_ENV;
    if (previous === undefined) delete process.env.CAMPUS_ALLOW_DEMO_PASSWORD;
    else process.env.CAMPUS_ALLOW_DEMO_PASSWORD = previous;
  }
});

test("mots de passe — politique et provisoires lisibles", () => {
  assert.equal(checkPasswordStrength("court1").ok, false);
  assert.equal(checkPasswordStrength(DEMO_TEACHER_PASSWORD).ok, false);
  assert.equal(checkPasswordStrength("sanschiffres").ok, false);
  assert.equal(checkPasswordStrength("Atelier-2027").ok, true);

  const temporary = generateTemporaryPassword();
  assert.match(temporary, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.notEqual(temporary, generateTemporaryPassword());
  assert.ok(temporary.replace(/-/g, "").length >= MIN_PASSWORD_LENGTH);
});

test("comptes — règles d'initiales et d'identifiant", () => {
  assert.equal(normalizeInitials(" ch-f 2 "), "chf");
  assert.equal(checkAccountInput("A", "ChF").ok, false);
  assert.equal(checkAccountInput("François Cheseaux", "C").ok, false);
  assert.equal(checkAccountInput("François Cheseaux", "ChF").ok, true);
  assert.equal(buildTeacherId("DuM", []), "teacher-dum");
  assert.equal(buildTeacherId("DuM", ["teacher-dum"]), "teacher-dum-2");
});

test("comptes — création avec mot de passe provisoire à usage unique", async () => {
  const store = freshStore();
  const created = await store.createAccount({ displayName: "Marie Dupont", initials: "DuM" });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  assert.equal(created.account.initials, "DuM");
  assert.equal(created.account.mustChangePassword, true);
  assert.equal(created.account.hasPassword, true);
  assert.ok(created.temporaryPassword.length >= MIN_PASSWORD_LENGTH);

  const login = await store.authenticate("dum", created.temporaryPassword);
  assert.equal(login.ok, true);
  assert.equal(login.mustChangePassword, true);
  assert.equal(await store.mustChangePassword(created.account.id), true);

  // Les mêmes initiales ne peuvent pas être réattribuées.
  const duplicate = await store.createAccount({ displayName: "Marc Dumas", initials: "dum" });
  assert.equal(duplicate.ok, false);
});

test("comptes — changement de mot de passe par l'enseignant", async () => {
  const store = freshStore();
  const created = await store.createAccount({ displayName: "Marie Dupont", initials: "DuM" });
  assert.ok(created.ok);
  if (!created.ok) return;

  const wrongCurrent = await store.changeOwnPassword(created.account.id, "FAUX-FAUX", "Atelier-2027");
  assert.equal(wrongCurrent.ok, false);

  const weak = await store.changeOwnPassword(created.account.id, created.temporaryPassword, "court");
  assert.equal(weak.ok, false);

  const changed = await store.changeOwnPassword(
    created.account.id,
    created.temporaryPassword,
    "Atelier-2027",
  );
  assert.equal(changed.ok, true);
  assert.equal(await store.mustChangePassword(created.account.id), false);
  assert.equal((await store.authenticate("DuM", "Atelier-2027")).ok, true);
  assert.equal((await store.authenticate("DuM", created.temporaryPassword)).ok, false);
});

test("comptes — réinitialisation administrateur et désactivation", async () => {
  const store = freshStore();
  const created = await store.createAccount({ displayName: "Marie Dupont", initials: "DuM" });
  assert.ok(created.ok);
  if (!created.ok) return;
  await store.changeOwnPassword(created.account.id, created.temporaryPassword, "Atelier-2027");

  const reset = await store.resetPassword(created.account.id);
  assert.ok(reset.ok);
  if (!reset.ok) return;
  assert.notEqual(reset.temporaryPassword, created.temporaryPassword);
  assert.equal((await store.authenticate("DuM", "Atelier-2027")).ok, false);
  assert.equal((await store.authenticate("DuM", reset.temporaryPassword)).ok, true);

  const disabled = await store.updateAccount(created.account.id, { isActive: false });
  assert.equal(disabled.ok, true);
  const blocked = await store.authenticate("DuM", reset.temporaryPassword);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason ?? "", /désactivé/);
});

test("comptes — un administrateur actif doit toujours rester", async () => {
  const store = freshStore();
  const accounts = await store.listAccounts();
  const admin = accounts.find((account) => account.isAdmin);
  assert.ok(admin);
  assert.equal(admin.id, TEACHER_CHF_ID);

  const removed = await store.updateAccount(admin.id, { isAdmin: false });
  assert.equal(removed.ok, false);

  const records: TeacherAccountRecord[] = [
    { ...admin, isAdmin: true, isActive: true },
    { ...admin, id: "teacher-autre", isAdmin: false, isActive: true },
  ];
  assert.equal(wouldRemoveLastAdmin(records, admin.id, { isAdmin: false }), true);
  assert.equal(wouldRemoveLastAdmin(records, "teacher-autre", { isActive: false }), false);
});

test("comptes — tri : actifs d'abord puis ordre alphabétique", () => {
  const base: TeacherAccountRecord = {
    id: "a",
    displayName: "Zoé",
    initials: "ZZ",
    isAdmin: false,
    isActive: true,
    isArchived: false,
    archivedAt: null,
    lastLoginAt: null,
    mustChangePassword: false,
    hasPassword: true,
    createdAt: null,
    passwordUpdatedAt: null,
  };
  const sorted = sortAccounts([
    { ...base, id: "c", displayName: "Inactif", isActive: false },
    base,
    { ...base, id: "b", displayName: "Alice" },
  ]);
  assert.deepEqual(sorted.map((entry) => entry.displayName), ["Alice", "Zoé", "Inactif"]);
});

test("comptes SQLite — migration, création et vérification des identifiants", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const accounts = new SqlTeacherAccountStore(db);
  const agenda = new SqlAgendaStore(db);

  const seeded = await accounts.listAccounts();
  assert.ok(seeded.some((account) => account.id === TEACHER_CHF_ID && account.isAdmin));
  assert.equal(seeded.every((account) => account.isActive), true);
  // Les comptes de démonstration n'ont pas encore de mot de passe personnel.
  assert.equal(seeded.every((account) => account.hasPassword === false), true);

  const created = await accounts.createAccount({
    displayName: "Marie Dupont",
    initials: "DuM",
    isAdmin: false,
  });
  assert.ok(created.ok);
  if (!created.ok) return;

  const login = await accounts.authenticate("dum", created.temporaryPassword);
  assert.equal(login.ok, true);
  assert.equal(login.mustChangePassword, true);
  assert.equal(await agenda.verifyTeacherCredentials(created.account.id, created.temporaryPassword), true);
  assert.equal(await agenda.findTeacherIdByInitials("DuM"), created.account.id);

  const changed = await accounts.changeOwnPassword(
    created.account.id,
    created.temporaryPassword,
    "Atelier-2027",
  );
  assert.equal(changed.ok, true);
  assert.equal(await accounts.mustChangePassword(created.account.id), false);
  assert.equal((await accounts.findAccount(created.account.id))?.hasPassword, true);

  const disabled = await accounts.updateAccount(created.account.id, { isActive: false });
  assert.equal(disabled.ok, true);
  assert.equal(await agenda.verifyTeacherCredentials(created.account.id, "Atelier-2027"), false);

  db.close();
});

test("amorçage — CAMPUS_ADMIN_PASSWORD n'écrase jamais un mot de passe choisi", async () => {
  const store = freshStore();
  const previousPassword = process.env.CAMPUS_ADMIN_PASSWORD;
  const previousInitials = process.env.CAMPUS_ADMIN_INITIALS;
  process.env.CAMPUS_ADMIN_PASSWORD = "Direction-2027";
  process.env.CAMPUS_ADMIN_INITIALS = "ChF";
  try {
    const first = await ensureTeacherAccountBootstrap(store);
    assert.equal(first.action, "env-password");
    assert.ok(describeBootstrapOutcome(first));
    assert.equal((await store.authenticate("ChF", "Direction-2027")).ok, true);
    assert.equal(await store.mustChangePassword(TEACHER_CHF_ID), true);

    await store.changeOwnPassword(TEACHER_CHF_ID, "Direction-2027", "Atelier-2027");
    const second = await ensureTeacherAccountBootstrap(store);
    assert.equal(second.action, "none");
    assert.equal((await store.authenticate("ChF", "Atelier-2027")).ok, true);
  } finally {
    if (previousPassword === undefined) delete process.env.CAMPUS_ADMIN_PASSWORD;
    else process.env.CAMPUS_ADMIN_PASSWORD = previousPassword;
    if (previousInitials === undefined) delete process.env.CAMPUS_ADMIN_INITIALS;
    else process.env.CAMPUS_ADMIN_INITIALS = previousInitials;
  }
});

test("amorçage — sans variable : mot de passe provisoire journalisé", async () => {
  const store = freshStore();
  const previousDemo = process.env.CAMPUS_ALLOW_DEMO_PASSWORD;
  const previousPassword = process.env.CAMPUS_ADMIN_PASSWORD;
  delete process.env.CAMPUS_ADMIN_PASSWORD;
  delete process.env.CAMPUS_ALLOW_DEMO_PASSWORD;
  try {
    // Avant amorçage, seul l'ancien mot de passe démo existe : il est refusé.
    assert.equal((await store.authenticate("ChF", DEMO_TEACHER_PASSWORD)).ok, false);

    const outcome = await ensureTeacherAccountBootstrap(store);
    assert.equal(outcome.action, "generated");
    if (outcome.action !== "generated") return;
    assert.match(describeBootstrapOutcome(outcome) ?? "", /ACCÈS ADMINISTRATEUR/);

    const login = await store.authenticate("ChF", outcome.temporaryPassword);
    assert.equal(login.ok, true);
    assert.equal(login.mustChangePassword, true);
  } finally {
    if (previousDemo === undefined) delete process.env.CAMPUS_ALLOW_DEMO_PASSWORD;
    else process.env.CAMPUS_ALLOW_DEMO_PASSWORD = previousDemo;
    if (previousPassword !== undefined) process.env.CAMPUS_ADMIN_PASSWORD = previousPassword;
  }
});


test("comptes — archivage refuse la connexion et dernier login est enregistré", async () => {
  const store = freshStore();
  const created = await store.createAccount({ displayName: "Paul Archive", initials: "ArP" });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const before = await store.authenticate("ArP", created.temporaryPassword);
  assert.equal(before.ok, true);
  const afterLogin = await store.findAccount(created.account.id);
  assert.ok(afterLogin?.lastLoginAt);

  const archived = await store.updateAccount(created.account.id, { isArchived: true });
  assert.equal(archived.ok, true);
  assert.equal(archived.ok && archived.account.isArchived, true);
  assert.equal(archived.ok && archived.account.isActive, false);

  const blocked = await store.authenticate("ArP", created.temporaryPassword);
  assert.equal(blocked.ok, false);

  const restored = await store.updateAccount(created.account.id, { isArchived: false, isActive: true });
  assert.equal(restored.ok, true);
  assert.equal((await store.authenticate("ArP", created.temporaryPassword)).ok, true);
});

test("comptes — impossible d'archiver le dernier administrateur actif", async () => {
  const store = freshStore();
  const accounts = await store.listAccounts();
  const admin = accounts.find((account) => account.isAdmin && account.isActive && !account.isArchived);
  assert.ok(admin);
  const result = await store.updateAccount(admin!.id, { isArchived: true });
  assert.equal(result.ok, false);
});

test("formatLastLoginAt — jamais connecté ou date locale", () => {
  assert.equal(formatLastLoginAt(null), "Jamais connecté");
  assert.match(formatLastLoginAt("2026-08-29T10:15:00.000Z"), /\d{2}\.\d{2}\.\d{2}.+\d{2}:\d{2}/);
});
