import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_CATALOG, TEACHER_CHF_ID } from "../src/features/classes/index.ts";
import {
  buildDefaultTeacherSetup,
  groupClassesByWeekday,
  isTeacherSetupPayload,
  normalizeTeacherSetup,
  sortClassesByWeekday,
} from "../src/features/teacher-setup/index.ts";
import {
  DEFAULT_TEACHER_NAV_SECTION,
  TEACHER_NAV_SECTIONS,
  teacherNavSectionsForRole,
  createDefaultWorkspace,
  openClassAgenda,
} from "../src/features/teacher/index.ts";
import {
  getMemoryTeacherSetupStore,
  resetMemoryTeacherSetupStore,
} from "../src/lib/persistence/memory-teacher-setup-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlTeacherSetupStore } from "../src/lib/persistence/sql/sql-teacher-setup-store.ts";

test("navigation — sections enseignant + administration admin", () => {
  assert.deepEqual([...TEACHER_NAV_SECTIONS], ["mes-cours", "controles", "ma-semaine", "configuration", "administration"]);
  assert.equal(DEFAULT_TEACHER_NAV_SECTION, "mes-cours");
  assert.deepEqual(teacherNavSectionsForRole(false), ["mes-cours", "controles", "ma-semaine", "configuration"]);
  assert.ok(teacherNavSectionsForRole(true).includes("administration"));
});

test("workspace — ouverture classe retourne sur Ma semaine", () => {
  const workspace = createDefaultWorkspace(TEACHER_CHF_ID, "classe-chf-ma2");
  assert.equal(workspace.activeSection, "mes-cours");

  const opened = openClassAgenda(workspace, "classe-chf-ma3b");
  assert.equal(opened.selectedClassroomId, "classe-chf-ma3b");
  assert.equal(opened.activeSection, "ma-semaine");
});

test("teacher setup — tri par jour de semaine", () => {
  const defaults = buildDefaultTeacherSetup(DEMO_CATALOG, TEACHER_CHF_ID);
  const sorted = sortClassesByWeekday(defaults.classes);
  assert.ok(sorted.length >= 8);

  for (let index = 1; index < sorted.length; index += 1) {
    assert.ok(sorted[index - 1].dayOfWeek <= sorted[index].dayOfWeek);
  }

  const grouped = groupClassesByWeekday(defaults.classes);
  assert.ok(grouped.length >= 1);
  assert.ok(grouped.every((group) => group.classes.length > 0));
});

test("teacher setup — normalisation des branches", () => {
  const normalized = normalizeTeacherSetup({
    version: 1,
    classes: [
      {
        id: "test",
        name: " MA2 ",
        programLabel: "MA",
        dayOfWeek: 1,
        branchNames: [" Con. Prof I ", ""],
        icon: "🔧",
      },
    ],
  });

  assert.equal(normalized.classes[0]?.name, "MA2");
  assert.deepEqual(normalized.classes[0]?.branchNames, ["Con. Prof I"]);
});

test("teacher setup — validation de payload HTTP", () => {
  assert.equal(isTeacherSetupPayload(null), false);
  assert.equal(isTeacherSetupPayload({ version: 1, classes: [] }), true);
  assert.equal(
    isTeacherSetupPayload({
      version: 1,
      classes: [{ id: "x", name: "MA2", programLabel: "MA", dayOfWeek: 1, branchNames: [], icon: "🔧" }],
    }),
    true,
  );
  assert.equal(
    isTeacherSetupPayload({
      version: 1,
      classes: [{ id: "x", name: "MA2", programLabel: "MA", dayOfWeek: 1, branchNames: "x", icon: "🔧" }],
    }),
    false,
  );
});

test("teacher setup — store mémoire get/save", async () => {
  resetMemoryTeacherSetupStore();
  const store = getMemoryTeacherSetupStore();
  assert.equal(await store.getSetup(TEACHER_CHF_ID), null);

  const config = buildDefaultTeacherSetup(DEMO_CATALOG, TEACHER_CHF_ID);
  const saved = await store.saveSetup(TEACHER_CHF_ID, config);
  assert.equal(saved.version, 1);
  assert.ok(saved.classes.length >= 1);

  const loaded = await store.getSetup(TEACHER_CHF_ID);
  assert.deepEqual(loaded, saved);

  const updated = await store.saveSetup(TEACHER_CHF_ID, {
    ...saved,
    classes: saved.classes.map((entry, index) =>
      index === 0 ? { ...entry, name: "  MA2-renommée  " } : entry,
    ),
  });
  assert.equal(updated.classes[0]?.name, "MA2-renommée");
});

test("teacher setup — store SQLite migration et persistance", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const store = new SqlTeacherSetupStore(db);

  assert.equal(await store.getSetup(TEACHER_CHF_ID), null);

  const config = buildDefaultTeacherSetup(DEMO_CATALOG, TEACHER_CHF_ID);
  const saved = await store.saveSetup(TEACHER_CHF_ID, config);
  const loaded = await store.getSetup(TEACHER_CHF_ID);
  assert.deepEqual(loaded, saved);

  await store.saveSetup(TEACHER_CHF_ID, {
    version: 1,
    classes: [
      {
        id: "classe-chf-ma2",
        name: "MA2",
        programLabel: "MA",
        dayOfWeek: 3,
        branchNames: ["Con. Prof I", "Math"],
        icon: "🔧",
      },
    ],
  });
  const again = await store.getSetup(TEACHER_CHF_ID);
  assert.equal(again?.classes[0]?.dayOfWeek, 3);
  assert.deepEqual(again?.classes[0]?.branchNames, ["Con. Prof I", "Math"]);

  db.close();
});
