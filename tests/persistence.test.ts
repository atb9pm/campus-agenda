import assert from "node:assert/strict";
import test from "node:test";

import { resetMemoryAgendaStore, getMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";

test("phase 0.7 — le store persiste les modifications en mémoire", async () => {
  resetMemoryAgendaStore([...DEMO_PROTOTYPE_ITEMS]);
  const store = getMemoryAgendaStore();
  const initialCount = (await store.listAgendaItems("classe-demo-tma-2a")).length;

  const item = await store.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-electricite-2a",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 1,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "INFORMATION",
    title: "Consigne persistée",
    detail: "Test",
  });

  assert.equal((await store.listAgendaItems("classe-demo-tma-2a")).length, initialCount + 1);

  const updated = await store.updateAgendaItem(item.id, DEMO_CURRENT_TEACHER_ID, { title: "Consigne modifiée" });
  assert.equal(updated.ok, true);
  if (updated.ok) assert.equal(updated.item.title, "Consigne modifiée");

  const deleted = await store.deleteAgendaItem(item.id, DEMO_CURRENT_TEACHER_ID);
  assert.equal(deleted.ok, true);
  assert.equal((await store.listAgendaItems("classe-demo-tma-2a")).length, initialCount);
});

test("phase 0.7 — accès élève résolu côté store", async () => {
  resetMemoryAgendaStore();
  const store = getMemoryAgendaStore();
  const access = await store.resolveStudentAccess("eleve-test-002");
  assert.ok(access);
  assert.equal(access.classroomId, "classe-demo-tma-1a");
});
