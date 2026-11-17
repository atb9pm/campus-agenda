import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import {
  agendaItemsFromLedger,
  beginAgendaRefresh,
  classroomAgendaPhase,
  commitAgendaLoadResults,
  emptyAgendaLedger,
  refreshableAgendaClassroomIds,
  rememberAgendaItem,
  TEACHER_WORKSPACE_REFRESH_MIN_GAP_MS,
  teacherWorkspaceRefreshDue,
  type AgendaLoadLedger,
} from "../src/features/class-notebook/agenda-load.ts";
import type { ClassNotesDocument } from "../src/features/class-notebook/types.ts";
import { NotebookAutosave } from "../web/lib/notebook-autosave.ts";

const CLASSROOM = "classe-a";

function publication(id: number, title: string): PrototypeAgendaItem {
  return {
    id,
    classroomId: CLASSROOM,
    subjectId: "subject-a",
    authorTeacherId: "teacher-a",
    day: 1,
    hour: 1,
    weekOffset: 0,
    schoolWeekNumber: 13,
    type: "HOMEWORK",
    title,
    detail: "",
  } as PrototypeAgendaItem;
}

function load(ledger: AgendaLoadLedger, items: PrototypeAgendaItem[] | null, options: { quiet?: boolean } = {}) {
  const begun = beginAgendaRefresh(ledger, [CLASSROOM], null, { joinInFlight: false, quiet: options.quiet });
  return {
    during: begun.ledger,
    finish: (current: AgendaLoadLedger) =>
      commitAgendaLoadResults(current, begun.started, [
        items
          ? { classroomId: CLASSROOM, schoolYearId: null, ok: true, items, error: null }
          : { classroomId: CLASSROOM, schoolYearId: null, ok: false, items: [], error: "réseau" },
      ]),
  };
}

function readyLedger(items: PrototypeAgendaItem[]): AgendaLoadLedger {
  const first = load(emptyAgendaLedger(), items);
  return first.finish(first.during);
}

test("relecture discrète : la classe reste affichée pendant la lecture et reçoit le contenu d’un autre appareil", () => {
  const ledger = readyLedger([publication(1, "Devoir 1")]);
  const quiet = load(ledger, [publication(1, "Devoir 1"), publication(2, "Écrit sur l’autre appareil")], { quiet: true });
  assert.equal(classroomAgendaPhase(quiet.during, CLASSROOM), "ready");
  assert.deepEqual(agendaItemsFromLedger(quiet.during).map((item) => item.id), [1]);
  const after = quiet.finish(quiet.during);
  assert.equal(classroomAgendaPhase(after, CLASSROOM), "ready");
  assert.deepEqual(agendaItemsFromLedger(after).map((item) => item.title), ["Devoir 1", "Écrit sur l’autre appareil"]);
});

test("relecture discrète : un échec ne met pas le Carnet en erreur et ne vide rien", () => {
  const ledger = readyLedger([publication(1, "Devoir 1")]);
  const quiet = load(ledger, null, { quiet: true });
  const after = quiet.finish(quiet.during);
  assert.equal(classroomAgendaPhase(after, CLASSROOM), "ready");
  assert.deepEqual(agendaItemsFromLedger(after).map((item) => item.id), [1]);
});

test("relecture discrète : une publication créée pendant la lecture n’est pas effacée par la réponse", () => {
  const ledger = readyLedger([publication(1, "Devoir 1")]);
  const quiet = load(ledger, [publication(1, "Devoir 1")], { quiet: true });
  const withLocal = rememberAgendaItem(quiet.during, publication(3, "Créée pendant la lecture"));
  const after = quiet.finish(withLocal);
  assert.deepEqual(agendaItemsFromLedger(after).map((item) => item.id), [1, 3]);
});

test("une lecture ordinaire garde l’état de chargement et d’erreur existant", () => {
  const ledger = readyLedger([publication(1, "Devoir 1")]);
  const loud = load(ledger, null);
  assert.equal(classroomAgendaPhase(loud.during, CLASSROOM), "loading");
  assert.equal(classroomAgendaPhase(loud.finish(loud.during), CLASSROOM), "error");
  assert.deepEqual(agendaItemsFromLedger(loud.finish(loud.during)).map((item) => item.id), [1]);
});

test("seules les classes déjà lues de l’année affichée sont relues, avec un écart minimal", () => {
  const ready = readyLedger([publication(1, "Devoir 1")]);
  const pending = beginAgendaRefresh(ready, ["classe-b"], null).ledger;
  const otherYear = beginAgendaRefresh(pending, ["classe-c"], "annee-2025").ledger;
  assert.deepEqual(refreshableAgendaClassroomIds(otherYear, null), [CLASSROOM]);
  assert.equal(teacherWorkspaceRefreshDue(0, TEACHER_WORKSPACE_REFRESH_MIN_GAP_MS - 1), false);
  assert.equal(teacherWorkspaceRefreshDue(0, TEACHER_WORKSPACE_REFRESH_MIN_GAP_MS), true);
});

const empty: ClassNotesDocument = { version: 2, sessions: {} };

test("notes : la version du serveur n’est reprise que si l’écran n’a rien de non enregistré", async () => {
  const autosave = new NotebookAutosave();
  autosave.reset("rev-1");
  assert.equal(autosave.adoptServerIfIdle(autosave.epoch(), "rev-1", () => true), "unchanged");
  assert.equal(autosave.adoptServerIfIdle(autosave.epoch(), "rev-2", () => false), "busy");
  assert.equal(autosave.adoptServerIfIdle(autosave.epoch(), "rev-2", () => true), "applied");

  const seen = autosave.epoch();
  const sent: string[] = [];
  await autosave.save(empty, async (_notes, revision) => {
    sent.push(revision ?? "");
    return { notes: empty, revision: "rev-3" };
  });
  assert.deepEqual(sent, ["rev-2"]);
  let applied = false;
  assert.equal(autosave.adoptServerIfIdle(seen, "rev-other", () => (applied = true)), "busy");
  assert.equal(applied, false, "une lecture partie avant un enregistrement ne remplace pas l’écran");

  let release: (() => void) | null = null;
  const inFlight = autosave.save(empty, (_notes, revision) => new Promise((resolve) => {
    release = () => resolve({ notes: empty, revision: `${revision}-next` });
  }));
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(autosave.adoptServerIfIdle(autosave.epoch(), "rev-other", () => true), "busy");
  (release as () => void)();
  await inFlight;
});

test("page.tsx relit au retour sur l’onglet sans écraser une saisie en cours", async () => {
  const [page, panel, route, client] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-notebook-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/api/agenda/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/lib/api-client.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /document\.addEventListener\("visibilitychange", refresh\)/);
  assert.match(page, /window\.setInterval\(refresh, TEACHER_WORKSPACE_REFRESH_INTERVAL_MS\)/);
  assert.match(page, /refreshTeacherAgendaRef\.current\(classroomIds, null, \{ force: true, quiet: true \}\)/);
  assert.match(page, /notesSyncedKeyRef\.current === notesContentKey\(classNotesDocumentRef\.current\)/);
  assert.match(page, /!notesRetryPendingRef\.current/);
  assert.match(page, /!notebookEditingRef\.current/);
  assert.match(page, /onEditingChange=\{\(editing\) => \{ notebookEditingRef\.current = editing; \}\}/);
  assert.match(panel, /onEditingChangeRef\.current\?\.\(editingInProgress\)/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(client, /\/api\/agenda\?\$\{params\.toString\(\)\}`, \{\n\s+credentials: "include",\n\s+cache: "no-store"/);
});
