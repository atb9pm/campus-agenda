import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultSchoolBranches,
  buildDefaultSchoolClasses,
  listActiveSchoolBranches,
  listActiveSchoolClasses,
  normalizeClassCode,
} from "../src/features/school-catalog/index.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import { teacherNavSectionsForRole, TEACHER_NAV_SECTIONS } from "../src/features/teacher/index.ts";

test("school catalog — seed initial classes et branches", () => {
  const classes = buildDefaultSchoolClasses();
  const branches = buildDefaultSchoolBranches();
  assert.deepEqual(
    classes.map((entry) => entry.code),
    ["MA1", "MA2", "MA3A", "MA3B", "MACAM2", "MACAM4", "MA4"],
  );
  assert.deepEqual(
    branches.map((entry) => entry.label),
    ["Moteur", "Électricité", "Transmission", "Châssis"],
  );
  assert.equal(normalizeClassCode(" ma2 "), "MA2");
});

test("school catalog — filtre actif seulement", () => {
  const classes = buildDefaultSchoolClasses();
  classes[0]!.isActive = false;
  const active = listActiveSchoolClasses(classes);
  assert.equal(active.length, classes.length - 1);
  assert.ok(active.every((entry) => entry.isActive));

  const branches = buildDefaultSchoolBranches();
  branches[1]!.isActive = false;
  assert.equal(listActiveSchoolBranches(branches).length, branches.length - 1);
});

test("school catalog — branche archivée exclue de la liste active", () => {
  const branches = buildDefaultSchoolBranches();
  branches[0]!.isArchived = true;
  branches[0]!.archivedAt = "2026-08-30T10:00:00.000Z";
  const active = listActiveSchoolBranches(branches);
  assert.equal(active.length, branches.length - 1);
  assert.ok(active.every((entry) => !entry.isArchived));
});

test("school catalog — store mémoire seed + soft deactivate", async () => {
  resetMemorySchoolCatalogStore();
  const store = getMemorySchoolCatalogStore();
  const classes = await store.listClasses();
  assert.ok(classes.length >= 7);

  const target = classes[0]!;
  const updated = await store.updateClass(target.id, { isActive: false });
  assert.ok(updated);
  assert.equal(updated.isActive, false);
  assert.equal((await store.listClasses()).find((entry) => entry.id === target.id)?.isActive, false);

  const created = await store.createBranch({ code: "DIAG", label: "Diagnostic" });
  assert.equal(created.label, "Diagnostic");
  assert.equal(created.isArchived, false);
  assert.equal(created.archivedAt, null);
  assert.ok((await store.listBranches()).some((entry) => entry.id === created.id));
});

test("school catalog — édition et archivage de branche", async () => {
  resetMemorySchoolCatalogStore();
  const store = getMemorySchoolCatalogStore();
  const [first] = await store.listBranches();
  assert.ok(first);

  const renamed = await store.updateBranch(first.id, { label: "Moteur thermique", code: "MOTEUR_THERMIQUE" });
  assert.ok(renamed);
  assert.equal(renamed.label, "Moteur thermique");
  assert.equal(renamed.code, "MOTEUR_THERMIQUE");

  const archived = await store.updateBranch(first.id, { isArchived: true });
  assert.ok(archived);
  assert.equal(archived.isArchived, true);
  assert.ok(archived.archivedAt);

  const active = listActiveSchoolBranches(await store.listBranches());
  assert.ok(!active.some((entry) => entry.id === first.id));

  const restored = await store.updateBranch(first.id, { isArchived: false });
  assert.ok(restored);
  assert.equal(restored.isArchived, false);
  assert.equal(restored.archivedAt, null);
});

test("navigation — Administration réservée aux admins", () => {
  assert.deepEqual([...TEACHER_NAV_SECTIONS], ["ma-semaine", "configuration", "administration"]);
  assert.deepEqual(teacherNavSectionsForRole(false), ["ma-semaine", "configuration"]);
  assert.deepEqual(teacherNavSectionsForRole(true), [
    "ma-semaine",
    "configuration",
    "administration",
  ]);
});
