import assert from "node:assert/strict";
import test from "node:test";

import { exportAgendaSnapshot, restoreAgendaSnapshot } from "../src/lib/persistence/backup.ts";
import { resetMemoryAgendaStore, getMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";

test("phase 0.8 — export puis restauration d'une sauvegarde", async () => {
  resetMemoryAgendaStore([...DEMO_PROTOTYPE_ITEMS]);
  const store = getMemoryAgendaStore();

  const snapshot = await exportAgendaSnapshot(store);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.itemCount, DEMO_PROTOTYPE_ITEMS.length);

  await store.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 0,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "INFORMATION",
    title: "Temporaire",
    detail: "Sera effacé",
  });
  assert.ok((await store.exportAllItems()).length > snapshot.itemCount);

  const restored = await restoreAgendaSnapshot(store, snapshot);
  assert.equal(restored.ok, true);
  if (restored.ok) assert.equal(restored.itemCount, snapshot.itemCount);
  assert.equal((await store.exportAllItems()).length, snapshot.itemCount);
});

test("phase 0.8 — rejette une sauvegarde invalide", async () => {
  resetMemoryAgendaStore();
  const store = getMemoryAgendaStore();
  const result = await restoreAgendaSnapshot(store, { version: 99, items: [] });
  assert.equal(result.ok, false);
});
