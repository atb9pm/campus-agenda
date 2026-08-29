import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword } from "../src/lib/auth/password.ts";
import { exportAgendaSnapshot, restoreAgendaSnapshot } from "../src/lib/persistence/backup.ts";
import { resetMemoryAgendaStore, getMemoryAgendaStore } from "../src/lib/persistence/memory-store.ts";
import {
  getMemoryTeacherAccountStore,
  resetMemoryTeacherAccountStore,
} from "../src/lib/persistence/memory-teacher-account-store.ts";
import {
  getMemoryTeacherSetupStore,
  resetMemoryTeacherSetupStore,
} from "../src/lib/persistence/memory-teacher-setup-store.ts";
import {
  getMemoryTeacherNotesStore,
  resetMemoryTeacherNotesStore,
} from "../src/lib/persistence/memory-teacher-notes-store.ts";
import { DEMO_PROTOTYPE_ITEMS } from "../src/features/agenda/demo-items.ts";
import { DEMO_CURRENT_TEACHER_ID } from "../src/features/classes/index.ts";

function backupDeps() {
  return {
    agenda: getMemoryAgendaStore(),
    teacherSetups: getMemoryTeacherSetupStore(),
    teacherNotes: getMemoryTeacherNotesStore(),
    teacherAccounts: getMemoryTeacherAccountStore(),
  };
}

function resetAll() {
  resetMemoryAgendaStore([...DEMO_PROTOTYPE_ITEMS]);
  resetMemoryTeacherSetupStore();
  resetMemoryTeacherNotesStore();
  resetMemoryTeacherAccountStore();
}

test("backup v3 — export puis restauration agenda + setup + notes + comptes", async () => {
  resetAll();

  const deps = backupDeps();
  const passwordHash = await hashPassword("Sauvegarde-Test-2026!");
  await deps.teacherAccounts.replaceAllAccounts([
    {
      id: DEMO_CURRENT_TEACHER_ID,
      displayName: "Enseignant Demo",
      initials: "ED",
      isAdmin: true,
      isActive: true,
      mustChangePassword: false,
      passwordHash,
      createdAt: "2026-01-01T00:00:00.000Z",
      passwordUpdatedAt: "2026-01-02T00:00:00.000Z",
    },
  ]);
  await deps.teacherSetups.saveSetup(DEMO_CURRENT_TEACHER_ID, {
    version: 1,
    classes: [
      {
        id: "classe-setup-1",
        name: "2A",
        programLabel: "TMA",
        dayOfWeek: 1,
        branchNames: ["Moteur"],
        icon: "wrench",
      },
    ],
  });
  await deps.teacherNotes.saveNotes(DEMO_CURRENT_TEACHER_ID, {
    version: 1,
    weeks: {
      "classe-setup-1:12": [{ id: "note-1", text: "Rappeler les EPI" }],
    },
  });

  const snapshot = await exportAgendaSnapshot(deps);
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.itemCount, DEMO_PROTOTYPE_ITEMS.length);
  assert.equal(snapshot.teacherSetupCount, 1);
  assert.equal(snapshot.teacherNotesCount, 1);
  assert.ok(snapshot.teacherAccountCount >= 1);
  assert.equal(snapshot.teacherSetups[0]?.teacherId, DEMO_CURRENT_TEACHER_ID);
  assert.equal(snapshot.teacherNotes[0]?.document.weeks["classe-setup-1:12"]?.[0]?.text, "Rappeler les EPI");
  const exportedAccount = snapshot.teacherAccounts.find((entry) => entry.id === DEMO_CURRENT_TEACHER_ID);
  assert.equal(exportedAccount?.passwordHash, passwordHash);
  assert.equal(exportedAccount?.initials, "ED");

  await deps.agenda.createAgendaItem({
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
  await deps.teacherSetups.saveSetup(DEMO_CURRENT_TEACHER_ID, {
    version: 1,
    classes: [],
  });
  await deps.teacherNotes.saveNotes(DEMO_CURRENT_TEACHER_ID, { version: 1, weeks: {} });
  await deps.teacherAccounts.setPassword(DEMO_CURRENT_TEACHER_ID, "Autre-MotDePasse-999!", true);
  assert.ok((await deps.agenda.exportAllItems()).length > snapshot.itemCount);

  const restored = await restoreAgendaSnapshot(deps, snapshot);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.itemCount, snapshot.itemCount);
  assert.equal(restored.teacherSetupCount, 1);
  assert.equal(restored.teacherNotesCount, 1);
  assert.equal(restored.restoredTeacherData, true);
  assert.equal(restored.restoredTeacherAccounts, true);
  assert.equal((await deps.agenda.exportAllItems()).length, snapshot.itemCount);

  const setup = await deps.teacherSetups.getSetup(DEMO_CURRENT_TEACHER_ID);
  assert.equal(setup?.classes[0]?.name, "2A");
  const notes = await deps.teacherNotes.getNotes(DEMO_CURRENT_TEACHER_ID);
  assert.equal(notes?.weeks["classe-setup-1:12"]?.[0]?.text, "Rappeler les EPI");

  const auth = await deps.teacherAccounts.authenticate("ED", "Sauvegarde-Test-2026!");
  assert.equal(auth.ok, true);
  assert.equal(auth.mustChangePassword, false);
});

test("backup — rejette une sauvegarde invalide", async () => {
  resetAll();
  const result = await restoreAgendaSnapshot(backupDeps(), { version: 99, items: [] });
  assert.equal(result.ok, false);
});

test("backup — restauration v1 (legacy) ne touche pas setup/notes/comptes", async () => {
  resetAll();
  const deps = backupDeps();

  await deps.teacherSetups.saveSetup(DEMO_CURRENT_TEACHER_ID, {
    version: 1,
    classes: [
      {
        id: "keep-me",
        name: "Conservée",
        programLabel: "TMA",
        dayOfWeek: 2,
        branchNames: [],
        icon: "book",
      },
    ],
  });
  await deps.teacherNotes.saveNotes(DEMO_CURRENT_TEACHER_ID, {
    version: 1,
    weeks: { "keep-me:1": [{ id: "n", text: "Reste" }] },
  });
  const beforeAccounts = await deps.teacherAccounts.exportAllAccounts();

  const legacy = {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    itemCount: DEMO_PROTOTYPE_ITEMS.length,
    items: DEMO_PROTOTYPE_ITEMS.map((item) => ({ ...item })),
  };

  await deps.agenda.createAgendaItem({
    classroomId: "classe-demo-tma-2a",
    subjectId: "subject-demo-moteur-2a",
    authorTeacherId: DEMO_CURRENT_TEACHER_ID,
    day: 0,
    hour: 9,
    weekOffset: 0,
    schoolWeekNumber: 12,
    type: "INFORMATION",
    title: "Avant legacy restore",
    detail: "Temporaire",
  });

  const restored = await restoreAgendaSnapshot(deps, legacy);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.restoredTeacherData, false);
  assert.equal(restored.restoredTeacherAccounts, false);
  assert.equal((await deps.agenda.exportAllItems()).length, DEMO_PROTOTYPE_ITEMS.length);

  const setup = await deps.teacherSetups.getSetup(DEMO_CURRENT_TEACHER_ID);
  assert.equal(setup?.classes[0]?.name, "Conservée");
  const notes = await deps.teacherNotes.getNotes(DEMO_CURRENT_TEACHER_ID);
  assert.equal(notes?.weeks["keep-me:1"]?.[0]?.text, "Reste");
  assert.deepEqual(await deps.teacherAccounts.exportAllAccounts(), beforeAccounts);
});

test("backup — restauration v2 ne touche pas les comptes", async () => {
  resetAll();
  const deps = backupDeps();
  const passwordHash = await hashPassword("Compte-Intact-2026!");
  await deps.teacherAccounts.replaceAllAccounts([
    {
      id: DEMO_CURRENT_TEACHER_ID,
      displayName: "Compte Intact",
      initials: "CI",
      isAdmin: true,
      isActive: true,
      mustChangePassword: false,
      passwordHash,
      createdAt: null,
      passwordUpdatedAt: null,
    },
  ]);

  const v2 = {
    version: 2 as const,
    exportedAt: new Date().toISOString(),
    itemCount: DEMO_PROTOTYPE_ITEMS.length,
    items: DEMO_PROTOTYPE_ITEMS.map((item) => ({ ...item })),
    teacherSetupCount: 0,
    teacherSetups: [],
    teacherNotesCount: 0,
    teacherNotes: [],
  };

  const restored = await restoreAgendaSnapshot(deps, v2);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.restoredTeacherData, true);
  assert.equal(restored.restoredTeacherAccounts, false);
  assert.equal(restored.teacherAccountCount, 0);

  const auth = await deps.teacherAccounts.authenticate("CI", "Compte-Intact-2026!");
  assert.equal(auth.ok, true);
});
