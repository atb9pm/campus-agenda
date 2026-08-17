import assert from "node:assert/strict";
import test from "node:test";

import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";
import { DEMO_TEACHER_PASSWORD } from "../src/lib/auth/config.ts";

test("phase 1.0 — store SQLite persiste l'agenda de démonstration", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const store = new SqlAgendaStore(db);

  const items = await store.listAgendaItems("classe-demo-tma-2a");
  assert.ok(items.length >= 5);
  assert.equal(await store.verifyTeacherCredentials(DEMO_CURRENT_TEACHER_ID, DEMO_TEACHER_PASSWORD), true);

  const created = await store.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 2,
    hour: 16,
    weekOffset: 0,
    type: "TEST",
    title: "Contrôle SQLite",
    detail: "Persisté en base",
  });
  assert.equal(created.title, "Contrôle SQLite");

  const reloaded = new SqlAgendaStore(db);
  const persisted = await reloaded.findAgendaItem(created.id);
  assert.equal(persisted?.title, "Contrôle SQLite");

  db.close();
});

test("phase 1.0 — accès élève résolu depuis SQLite", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const store = new SqlAgendaStore(db);
  const access = await store.resolveStudentAccess("eleve-test-001");
  assert.ok(access);
  assert.equal(access.classroomId, "classe-demo-tma-2a");
  db.close();
});
