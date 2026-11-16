import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import {
  AGENDA_EMPTY_LABEL,
  AGENDA_ERROR_LABEL,
  AGENDA_LOADING_LABEL,
  AGENDA_RETRY_LABEL,
  agendaItemsFromLedger,
  beginAgendaRefresh,
  classroomAgendaPhase,
  commitAgendaLoadResults,
  emptyAgendaLedger,
  filterNotebookItemsForSubject,
  loadAgendaClassrooms,
  createEmptyNotesDocument,
  fromPlainText,
  itemsForCourseSession,
  listSessionNotes,
  migrateClassNotesToSessions,
  notebookDiagnosticFields,
  notebookPublicationPlaceholder,
  projectAgendaMutations,
  setSessionRichNote,
  type AgendaLoadLedger,
} from "../src/features/class-notebook/index.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";
import { NotebookConflictError } from "../src/lib/persistence/teacher-notes-types.ts";
import { getStudentAgendaItems, publicationsForBranchPreview } from "../src/features/student/agenda.ts";
import { NotebookAutosave, shouldPersistNotebookNotes } from "../web/lib/notebook-autosave.ts";

const CLASSROOM = "class-meca";
const OTHER = "class-elec";
const FAILED = "class-panne";
const COURSE = "ac-meca";
const TEACHER = "teacher-1";
const SUBJECT = "subject-meca";

function referenceSessions() {
  return computeCourseSessions({
    schoolYearId: "2026-2027",
    courses: [{ id: COURSE, classId: CLASSROOM, contextId: "ctx-meca" }],
    slots: [
      {
        id: "lundi",
        annualCourseId: COURSE,
        dayOfWeek: 1,
        periodStart: 1,
        periodEnd: 2,
        weekKind: "all",
        validFrom: null,
        validTo: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "jeudi",
        annualCourseId: COURSE,
        dayOfWeek: 4,
        periodStart: 3,
        periodEnd: 4,
        weekKind: "all",
        validFrom: null,
        validTo: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    weeks: [
      { number: 11, kind: "A", monday: "2026-11-09" },
      { number: 12, kind: "B", monday: "2026-11-16" },
    ],
    holidays: [],
    exceptions: [],
  }).sort((left, right) => left.date.localeCompare(right.date));
}

function agendaItem(input: {
  id: number;
  classroomId: string;
  title: string;
  type: PrototypeAgendaItem["type"];
  date: string;
  sessionKey: string;
  schoolWeekNumber: number;
  day: number;
  studentVisible?: boolean;
}): PrototypeAgendaItem {
  return {
    id: input.id,
    classroomId: input.classroomId,
    subjectId: SUBJECT,
    authorTeacherId: TEACHER,
    day: input.day,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: input.schoolWeekNumber,
    type: input.type,
    title: input.title,
    detail: "",
    annualCourseId: COURSE,
    courseSessionKey: input.sessionKey,
    courseSessionDate: input.date,
    studentVisible: input.studentVisible,
    schoolYearId: null,
  };
}

function storedPublications() {
  const sessions = referenceSessions();
  const byDate = new Map(sessions.map((session) => [session.date, session]));
  const on = (date: string) => {
    const session = byDate.get(date);
    if (!session) throw new Error(date);
    return session;
  };
  const nov9 = on("2026-11-09");
  const nov16 = on("2026-11-16");
  const nov19 = on("2026-11-19");
  return [
    agendaItem({
      id: 9,
      classroomId: CLASSROOM,
      title: "Publication du 9 novembre",
      type: "HOMEWORK",
      date: nov9.date,
      sessionKey: nov9.key,
      schoolWeekNumber: nov9.schoolWeekNumber,
      day: nov9.dayOfWeek - 1,
    }),
    agendaItem({
      id: 16,
      classroomId: CLASSROOM,
      title: "Publication du 16 novembre",
      type: "HOMEWORK",
      date: nov16.date,
      sessionKey: nov16.key,
      schoolWeekNumber: nov16.schoolWeekNumber,
      day: nov16.dayOfWeek - 1,
    }),
    agendaItem({
      id: 160,
      classroomId: CLASSROOM,
      title: "Contrôle du 16 novembre",
      type: "TEST",
      date: nov16.date,
      sessionKey: nov16.key,
      schoolWeekNumber: nov16.schoolWeekNumber,
      day: nov16.dayOfWeek - 1,
    }),
    agendaItem({
      id: 161,
      classroomId: CLASSROOM,
      title: "Brouillon du 16 novembre",
      type: "INFORMATION",
      date: nov16.date,
      sessionKey: nov16.key,
      schoolWeekNumber: nov16.schoolWeekNumber,
      day: nov16.dayOfWeek - 1,
      studentVisible: false,
    }),
    agendaItem({
      id: 19,
      classroomId: CLASSROOM,
      title: "Publication du 19 novembre",
      type: "INFORMATION",
      date: nov19.date,
      sessionKey: nov19.key,
      schoolWeekNumber: nov19.schoolWeekNumber,
      day: nov19.dayOfWeek - 1,
    }),
    agendaItem({
      id: 42,
      classroomId: OTHER,
      title: "Publication électricité",
      type: "HOMEWORK",
      date: nov16.date,
      sessionKey: nov16.key,
      schoolWeekNumber: nov16.schoolWeekNumber,
      day: nov16.dayOfWeek - 1,
    }),
  ];
}

function titlesFor(items: readonly PrototypeAgendaItem[], date: string) {
  const sessions = referenceSessions();
  const session = sessions.find((entry) => entry.date === date);
  if (!session) return [];
  const visible = filterNotebookItemsForSubject(items, {
    classroomId: CLASSROOM,
    teacherId: TEACHER,
    subjectId: SUBJECT,
    annualCourseId: COURSE,
    restrictToSubject: true,
  });
  return itemsForCourseSession(visible, session, sessions).map((item) => item.title).sort();
}

async function loadAll(
  classroomIds: readonly string[],
  fetchItems: (classroomId: string) => Promise<PrototypeAgendaItem[]>,
  ledger: AgendaLoadLedger = emptyAgendaLedger(),
) {
  const begun = beginAgendaRefresh(ledger, classroomIds, null, { replaceScope: true });
  const results = await loadAgendaClassrooms(
    begun.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    (classroomId) => fetchItems(classroomId),
  );
  return { begun, results, ledger: commitAgendaLoadResults(begun.ledger, begun.started, results) };
}

test("A — la première ouverture retrouve publications, contrôles et notes sans l’agenda élève", async () => {
  const stored = storedPublications();
  const loaded = await loadAll([CLASSROOM, OTHER], async (classroomId) => stored.filter((item) => item.classroomId === classroomId));
  const items = agendaItemsFromLedger(loaded.ledger);
  assert.deepEqual(titlesFor(items, "2026-11-09"), ["Publication du 9 novembre"]);
  assert.deepEqual(titlesFor(items, "2026-11-16"), ["Brouillon du 16 novembre", "Contrôle du 16 novembre", "Publication du 16 novembre"]);
  assert.deepEqual(titlesFor(items, "2026-11-19"), ["Publication du 19 novembre"]);
  assert.equal(classroomAgendaPhase(loaded.ledger, CLASSROOM), "ready");
  assert.equal(items.some((item) => item.classroomId === OTHER), true);

  const session = referenceSessions().find((entry) => entry.date === "2026-11-16");
  const notes = setSessionRichNote(createEmptyNotesDocument(), session!.key, fromPlainText("Note prof du 16 novembre"));
  assert.equal(listSessionNotes(notes, session!.key)[0]?.text, "Note prof du 16 novembre");

  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const preview = page.slice(page.indexOf("function openTeacherStudentView"), page.indexOf("function enterTeacherPreview"));
  assert.equal(preview.includes("setItems"), false);
  assert.match(preview, /applyAgendaLoadResult/);
});

test("B — l’échec d’une classe conserve les autres et ne confirme pas une liste vide", async () => {
  const stored = storedPublications();
  const diagnostics: string[] = [];
  const begun = beginAgendaRefresh(emptyAgendaLedger(), [CLASSROOM, FAILED, OTHER], null, { replaceScope: true });
  const results = await loadAgendaClassrooms(
    begun.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async (classroomId) => {
      if (classroomId === FAILED) throw new Error("HTTP 503");
      return stored.filter((item) => item.classroomId === classroomId);
    },
  );
  const ledger = commitAgendaLoadResults(begun.ledger, begun.started, results, (event) => {
    diagnostics.push(event.kind);
  });
  assert.equal(classroomAgendaPhase(ledger, CLASSROOM), "ready");
  assert.equal(classroomAgendaPhase(ledger, OTHER), "ready");
  assert.equal(classroomAgendaPhase(ledger, FAILED), "error");
  assert.equal(ledger.slots[FAILED]?.confirmed, false);
  assert.deepEqual(ledger.slots[FAILED]?.items, []);
  assert.equal(notebookPublicationPlaceholder({ phase: "error", visibleCount: 0 }), "error");
  assert.equal(diagnostics.includes("load-failed"), true);
  assert.equal(agendaItemsFromLedger(ledger).some((item) => item.title === "Publication du 9 novembre"), true);

  const retry = beginAgendaRefresh(ledger, [FAILED], null);
  const retried = await loadAgendaClassrooms(
    retry.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => [{ ...stored[0]!, id: 90, classroomId: FAILED, title: "Publication récupérée" }],
  );
  const recovered = commitAgendaLoadResults(retry.ledger, retry.started, retried);
  assert.equal(classroomAgendaPhase(recovered, FAILED), "ready");
  assert.equal(recovered.slots[FAILED]?.items[0]?.title, "Publication récupérée");
  assert.equal(classroomAgendaPhase(recovered, CLASSROOM), "ready");
});

test("un échec plus récent ne masque pas la réussite d’un chargement déjà parti", async () => {
  const stored = storedPublications().filter((item) => item.classroomId === CLASSROOM);
  const first = beginAgendaRefresh(emptyAgendaLedger(), [CLASSROOM], null);
  const second = beginAgendaRefresh(first.ledger, [CLASSROOM], null);
  assert.equal(second.started[0]?.generation, (first.started[0]?.generation ?? 0) + 1);
  const failed = await loadAgendaClassrooms(
    second.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => { throw new Error("HTTP 503"); },
  );
  const afterFailure = commitAgendaLoadResults(second.ledger, second.started, failed);
  assert.equal(classroomAgendaPhase(afterFailure, CLASSROOM), "error");
  const succeeded = await loadAgendaClassrooms(
    first.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => stored,
  );
  const afterSuccess = commitAgendaLoadResults(afterFailure, first.started, succeeded);
  assert.equal(classroomAgendaPhase(afterSuccess, CLASSROOM), "ready");
  assert.equal(afterSuccess.slots[CLASSROOM]?.items.some((item) => item.id === 9), true);
  assert.equal(afterSuccess.slots[CLASSROOM]?.items.some((item) => item.id === 16), true);
  assert.equal(afterSuccess.slots[CLASSROOM]?.items.some((item) => item.id === 19), true);

  const loading = beginAgendaRefresh(emptyAgendaLedger(), [CLASSROOM], null);
  const newer = beginAgendaRefresh(loading.ledger, [CLASSROOM], null);
  const earlySuccess = await loadAgendaClassrooms(
    loading.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => stored,
  );
  const ready = commitAgendaLoadResults(newer.ledger, loading.started, earlySuccess);
  assert.equal(classroomAgendaPhase(ready, CLASSROOM), "ready");
  const lateFailure = await loadAgendaClassrooms(
    newer.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => { throw new Error("HTTP 503"); },
  );
  const stillReady = commitAgendaLoadResults(ready, newer.started, lateFailure);
  assert.equal(classroomAgendaPhase(stillReady, CLASSROOM), "ready");
  assert.equal(stillReady.slots[CLASSROOM]?.items.some((item) => item.id === 16), true);
});

test("un chargement déjà en cours est rejoint, un réessai force une nouvelle lecture", async () => {
  const first = beginAgendaRefresh(emptyAgendaLedger(), [CLASSROOM], null, { joinInFlight: true });
  const joined = beginAgendaRefresh(first.ledger, [CLASSROOM], null, { joinInFlight: true });
  assert.equal(joined.started[0]?.joined, true);
  assert.equal(joined.started[0]?.generation, first.started[0]?.generation);
  assert.equal(joined.ledger, first.ledger);
  const forced = beginAgendaRefresh(first.ledger, [CLASSROOM], null, { joinInFlight: false });
  assert.equal(forced.started[0]?.joined, false);
  assert.equal(forced.started[0]?.generation, (first.started[0]?.generation ?? 0) + 1);

  const stored = storedPublications().filter((item) => item.classroomId === CLASSROOM);
  const succeeded = await loadAgendaClassrooms(
    first.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => stored,
  );
  const ready = commitAgendaLoadResults(first.ledger, first.started, succeeded);
  const duplicateFailure = await loadAgendaClassrooms(
    first.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => { throw new Error("HTTP 503"); },
  );
  const kept = commitAgendaLoadResults(ready, first.started, duplicateFailure);
  assert.equal(classroomAgendaPhase(kept, CLASSROOM), "ready");
  assert.equal(kept.slots[CLASSROOM]?.items.length, stored.length);
});

test("C — une réponse plus ancienne ne remplace pas une réponse plus récente", async () => {
  const stored = storedPublications();
  const first = beginAgendaRefresh(emptyAgendaLedger(), [CLASSROOM], null, { replaceScope: true });
  const second = beginAgendaRefresh(first.ledger, [CLASSROOM], null);
  const newer = await loadAgendaClassrooms(
    second.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => stored.filter((item) => item.classroomId === CLASSROOM),
  );
  const withNewer = commitAgendaLoadResults(second.ledger, second.started, newer);
  const older = await loadAgendaClassrooms(
    first.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => [],
  );
  const diagnostics: string[] = [];
  const afterOlder = commitAgendaLoadResults(withNewer, first.started, older, (event) => diagnostics.push(event.kind));
  assert.deepEqual(afterOlder, withNewer);
  assert.deepEqual(diagnostics, ["stale-response"]);
  assert.equal(agendaItemsFromLedger(afterOlder).some((item) => item.id === 16), true);
});

test("D — l’aller-retour vers l’agenda élève fusionne la classe sans effacer les autres", async () => {
  const stored = storedPublications();
  const initial = await loadAll([CLASSROOM, OTHER], async (classroomId) => stored.filter((item) => item.classroomId === classroomId));
  const preview = beginAgendaRefresh(initial.ledger, [CLASSROOM], null);
  const previewResults = await loadAgendaClassrooms(
    preview.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => stored.filter((item) => item.classroomId === CLASSROOM),
  );
  const returned = commitAgendaLoadResults(preview.ledger, preview.started, previewResults);
  const items = agendaItemsFromLedger(returned);
  assert.deepEqual(titlesFor(items, "2026-11-09"), ["Publication du 9 novembre"]);
  assert.deepEqual(titlesFor(items, "2026-11-19"), ["Publication du 19 novembre"]);
  assert.equal(items.some((item) => item.classroomId === OTHER && item.title === "Publication électricité"), true);
});

test("E et I — chargement en cours, vide confirmé, échec : trois états distincts", () => {
  assert.equal(AGENDA_LOADING_LABEL, "Chargement des publications…");
  assert.equal(AGENDA_EMPTY_LABEL, "Aucune publication pour cette séance.");
  assert.equal(AGENDA_ERROR_LABEL, "Impossible de charger les publications de cette classe.");
  assert.equal(AGENDA_RETRY_LABEL, "Réessayer");
  assert.equal(notebookPublicationPlaceholder({ phase: "loading", visibleCount: 0 }), "loading");
  assert.equal(notebookPublicationPlaceholder({ phase: "unknown", visibleCount: 0 }), "loading");
  assert.equal(notebookPublicationPlaceholder({ phase: "ready", visibleCount: 0 }), "content");
  assert.equal(notebookPublicationPlaceholder({ phase: "error", visibleCount: 0 }), "error");
  assert.equal(notebookPublicationPlaceholder({ phase: "error", visibleCount: 2 }), "content");

  let ledger = beginAgendaRefresh(emptyAgendaLedger(), [CLASSROOM], null).ledger;
  assert.equal(classroomAgendaPhase(ledger, CLASSROOM), "loading");
  const begun = beginAgendaRefresh(emptyAgendaLedger(), [CLASSROOM], null);
  ledger = commitAgendaLoadResults(begun.ledger, begun.started, [{
    classroomId: CLASSROOM,
    schoolYearId: null,
    ok: true,
    items: [],
    error: null,
  }]);
  assert.equal(ledger.slots[CLASSROOM]?.confirmed, true);
  assert.equal(notebookPublicationPlaceholder({ phase: ledger.slots[CLASSROOM]!.phase, visibleCount: 0 }), "content");
});

test("F et H — conflit de notes : la version locale reste, la révision serveur n’est pas écrasée", async () => {
  assert.equal(
    new NotebookConflictError().message,
    "Les notes ont changé depuis leur chargement. Rechargez le Carnet avant de réessayer.",
  );
  const queue = new NotebookAutosave();
  queue.reset("r0");
  const seen = queue.epoch();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const local = setSessionRichNote(createEmptyNotesDocument(), "session-16", fromPlainText("Texte encore à l’écran"));
  const first = queue.save(local, async (notes, revision) => {
    assert.equal(revision, "r0");
    await gate;
    return { notes, revision: "r1" };
  });
  queue.adoptIfCurrent(seen, "r-ancienne-lecture");
  release();
  await first;
  let sentRevision = "";
  await queue.save(local, async (notes, revision) => {
    sentRevision = revision ?? "";
    return { notes, revision: "r2" };
  });
  assert.equal(sentRevision, "r1");

  const server = { revision: "r1", text: "Version enregistrée" };
  const otherTab = { revision: "r1", text: "Modification de l’autre onglet" };
  function persist(expected: string, text: string) {
    if (server.revision !== expected) throw new NotebookConflictError();
    server.revision = "r2";
    server.text = text;
  }
  persist(otherTab.revision, otherTab.text);
  assert.throws(() => persist("r1", "cette écriture ne doit pas passer"), NotebookConflictError);
  assert.equal(server.text, "Modification de l’autre onglet");
  assert.equal(local.version === 2 && local.sessions["session-16"]?.[0]?.text, "Texte encore à l’écran");
  assert.equal(shouldPersistNotebookNotes({ hydrated: true, conflict: true, adminConsult: false }), false);

  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const load = page.slice(page.indexOf("const remote = await fetchTeacherNotesApi"), page.indexOf("notesHydratedRef.current = true"));
  assert.match(load, /if \(notesConflictRef\.current\)/);
  assert.equal(load.includes("setClassNotesDocument"), false);
  assert.match(page, /Vos modifications restent à l’écran et ne sont pas envoyées/);
});

test("G — la migration n’enregistre rien tant que les notes ne sont pas lues", () => {
  const sessions = referenceSessions();
  const session = sessions.find((entry) => entry.date === "2026-11-16")!;
  const legacy = {
    version: 1 as const,
    weeks: { [`setup:${session.schoolWeekNumber}`]: [{ id: "n16", text: "Note à migrer" }] },
  };
  const migrated = migrateClassNotesToSessions(legacy, sessions, "setup", {
    annualCourseId: COURSE,
    classAnnualCourseIds: [COURSE],
  });
  assert.equal(migrated.changed, true);
  assert.equal(shouldPersistNotebookNotes({ hydrated: false, conflict: false, adminConsult: false }), false);
  assert.equal(shouldPersistNotebookNotes({ hydrated: true, conflict: false, adminConsult: true }), false);
  const text = JSON.stringify(migrated.document);
  assert.equal(text.includes("Note à migrer"), true);
});

test("J — brouillons, contrôles et agenda élève restent distincts", () => {
  const stored = storedPublications();
  const classroom = stored.filter((item) => item.classroomId === CLASSROOM);
  const student = getStudentAgendaItems(classroom, CLASSROOM).map((item) => item.title).sort();
  assert.deepEqual(student, ["Contrôle du 16 novembre", "Publication du 16 novembre", "Publication du 19 novembre", "Publication du 9 novembre"]);
  const session = referenceSessions().find((entry) => entry.date === "2026-11-16")!;
  const preview = publicationsForBranchPreview({
    items: classroom,
    classroomId: CLASSROOM,
    annualCourseId: COURSE,
    courseSessionKey: session.key,
  }).map((item) => item.title).sort();
  assert.deepEqual(preview, ["Brouillon du 16 novembre", "Publication du 16 novembre"]);
});

test("une publication créée pendant le chargement survit à la réponse partie avant elle", async () => {
  const stored = storedPublications().filter((item) => item.classroomId === CLASSROOM && item.id === 9);
  const begun = beginAgendaRefresh(emptyAgendaLedger(), [CLASSROOM], null);
  const created = storedPublications().find((item) => item.id === 16)!;
  const withLocal = projectAgendaMutations(begun.ledger, [], [created]);
  const results = await loadAgendaClassrooms(
    begun.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => stored,
  );
  const ledger = commitAgendaLoadResults(withLocal, begun.started, results);
  const ids = agendaItemsFromLedger(ledger).map((item) => item.id).sort((left, right) => left - right);
  assert.deepEqual(ids, [9, 16]);
});

test("une suppression locale n’est pas réintroduite par une réponse ancienne", async () => {
  const stored = storedPublications().filter((item) => item.classroomId === CLASSROOM && (item.id === 9 || item.id === 16));
  const seeded = await loadAll([CLASSROOM], async () => stored);
  const begun = beginAgendaRefresh(seeded.ledger, [CLASSROOM], null);
  const without = agendaItemsFromLedger(begun.ledger).filter((item) => item.id !== 16);
  const withLocal = projectAgendaMutations(begun.ledger, agendaItemsFromLedger(begun.ledger), without);
  const results = await loadAgendaClassrooms(
    begun.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
    async () => stored,
  );
  const ledger = commitAgendaLoadResults(withLocal, begun.started, results);
  assert.deepEqual(agendaItemsFromLedger(ledger).map((item) => item.id), [9]);
});

test("le diagnostic ne contient ni publication ni note", () => {
  const fields = notebookDiagnosticFields({ kind: "load-failed", classroomId: CLASSROOM });
  assert.deepEqual(fields, { message: "notebook_diagnostic", kind: "load-failed", classroomId: CLASSROOM });
  assert.equal(JSON.stringify(fields).includes("Publication"), false);
  assert.equal(JSON.stringify(fields).includes("Note"), false);
});

test("le chargement initial ne marque plus une classe avant la réponse et sépare les échecs", async () => {
  const [page, agendaLoad, autosave] = await Promise.all([
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/class-notebook/agenda-load.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/lib/notebook-autosave.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(page.includes("loadedAgendaClassroomIdsRef"), false);
  assert.equal(page.includes("Promise.all("), false);
  assert.match(agendaLoad, /Promise\.allSettled/);
  assert.match(page, /Chargement du calendrier scolaire impossible\./);
  assert.match(page, /Chargement des classes impossible\./);
  assert.match(page, /shouldPersistNotebookNotes/);
  assert.match(autosave, /adoptIfCurrent/);
  assert.match(page, /phase === "ready" \|\| phase === "loading" \|\| phase === "error"/);
  const notesCatch = page.slice(page.indexOf("Notes du Carnet non chargées"), page.indexOf("void loadClassNotes"));
  assert.equal(notesCatch.includes("saveTeacherNotesApi"), false);
});
