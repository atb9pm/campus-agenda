import assert from "node:assert/strict";
import test from "node:test";

process.env.CAMPUS_ALLOW_DEMO_PASSWORD ??= "1";

import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { seedDemoDatabase } from "../src/lib/persistence/sql/seed.ts";
import { SqlAgendaStore } from "../src/lib/persistence/sql/sql-agenda-store.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";

test("concurrence SQLite — 20 publications, 20 IDs distincts", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await seedDemoDatabase(db);
  const store = new SqlAgendaStore(db);

  const created = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      store.createAgendaItem({
        classroomId: "classe-demo-tma-2a",
        subjectId: "subject-demo-moteur-2a",
        authorTeacherId: DEMO_CURRENT_TEACHER_ID,
        day: 0,
        hour: 8,
        weekOffset: 0,
        schoolWeekNumber: 12,
        type: "INFORMATION",
        title: `Concurrente ${index + 1}`,
        detail: "ID atomique",
      }),
    ),
  );

  const ids = created.map((item) => item.id);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
  const persisted = await store.exportAllItems();
  for (const id of ids) {
    assert.ok(persisted.some((item) => item.id === id));
  }
});
