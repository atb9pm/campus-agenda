import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";
import * as esbuild from "../web/node_modules/esbuild/lib/main.js";

import {
  AGENDA_EMPTY_LABEL,
  AGENDA_ERROR_LABEL,
  AGENDA_LOADING_LABEL,
  AGENDA_RETRY_LABEL,
  agendaItemsFromLedger,
  agendaResultBelongsToSession,
  beginAgendaRefresh,
  commitAgendaLoadResults,
  emptyAgendaLedger,
  filterNotebookItemsForSubject,
  loadAgendaClassrooms,
  NOTES_COPY_LOCAL_LABEL,
  NOTES_COPY_UNVERIFIED_HINT,
  NOTES_EXPORT_ACK_HINT,
  NOTES_EXPORT_LOCAL_LABEL,
  NOTES_RECOVERY_ACK_LABEL,
  NOTES_RELOAD_CONFIRM_LABEL,
  NOTES_RELOAD_HINT,
  NOTES_RELOAD_SERVER_LABEL,
  NOTES_SYNC_INTERRUPTED_LABEL,
  acceptVerifiedNotebookNotes,
  acknowledgeNotebookNotesRecovery,
  emptyNotesConflictGuard,
  notebookNotesFingerprint,
  notebookPublicationPlaceholder,
  notesConflictGuardForDocument,
  offerNotebookNotesRecovery,
  requestServerNotesReload,
  serverNotesReloadConfirmed,
  unsavedNotebookNotesText,
} from "../src/features/class-notebook/index.ts";
import {
  createEmptyNotesDocument,
  formatCourseSessionCardSubtitle,
  formatCourseSessionCardWeekLabel,
  fromPlainText,
  itemsForCourseSession,
  listSessionNotes,
  setSessionRichNote,
} from "../src/features/class-notebook/index.ts";
import { computeCourseSessions } from "../src/features/course-sessions/index.ts";

const ARTIFACTS = "/opt/cursor/artifacts";
const CLASSROOM = "class-meca";
const OTHER = "class-elec";
const FAILED = "class-panne";
const COURSE = "ac-meca";
const TEACHER = "teacher-1";
const SUBJECT = "subject-meca";

const css = readFileSync(new URL("../web/app/globals.css", import.meta.url), "utf8")
  .replace('@import "tailwindcss";\n', "")
  .replace(/@import url\([^)]+\);\n/, "");

function launchOptions() {
  return {
    headless: true,
    ...(process.env.CAMPUS_PLAYWRIGHT_CHANNEL ? { channel: process.env.CAMPUS_PLAYWRIGHT_CHANNEL } : {}),
  };
}

function sessions() {
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

function item(id, session, title, type, classroomId = CLASSROOM, studentVisible = true) {
  return {
    id,
    classroomId,
    subjectId: SUBJECT,
    authorTeacherId: TEACHER,
    day: session.dayOfWeek - 1,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: session.schoolWeekNumber,
    type,
    title,
    detail: "",
    annualCourseId: COURSE,
    courseSessionKey: session.key,
    courseSessionDate: session.date,
    studentVisible,
    schoolYearId: null,
  };
}

function catalog() {
  const list = sessions();
  const on = (date) => list.find((session) => session.date === date);
  const nov9 = on("2026-11-09");
  const nov12 = on("2026-11-12");
  const nov16 = on("2026-11-16");
  const nov19 = on("2026-11-19");
  return {
    list,
    nov16,
    stored: [
      item(9, nov9, "Publication du 9 novembre", "HOMEWORK"),
      item(16, nov16, "Publication du 16 novembre", "HOMEWORK"),
      item(160, nov16, "Contrôle du 16 novembre", "TEST"),
      item(161, nov16, "Brouillon du 16 novembre", "INFORMATION", CLASSROOM, false),
      item(19, nov19, "Publication du 19 novembre", "INFORMATION"),
      item(42, nov16, "Publication électricité", "HOMEWORK", OTHER),
      item(12, nov12, "Publication du 12 novembre", "HOMEWORK", FAILED),
    ],
  };
}

function columnModel(ledger, phase, notes) {
  const { list } = catalog();
  const items = filterNotebookItemsForSubject(agendaItemsFromLedger(ledger), {
    classroomId: CLASSROOM,
    teacherId: TEACHER,
    subjectId: SUBJECT,
    annualCourseId: COURSE,
    restrictToSubject: true,
  });
  return {
    phase,
    banner: phase === "error"
      ? "error"
      : notebookPublicationPlaceholder({ phase, visibleCount: items.length }),
    columns: list.map((session) => {
      const matched = itemsForCourseSession(items, session, list);
      const publications = matched.filter((entry) => entry.type !== "TEST").map((entry) => entry.title);
      const controls = matched.filter((entry) => entry.type === "TEST").map((entry) => entry.title);
      const note = listSessionNotes(notes, session.key)[0]?.text ?? "";
      const placeholder = notebookPublicationPlaceholder({ phase, visibleCount: publications.length });
      return {
        date: session.date,
        subtitle: `${formatCourseSessionCardWeekLabel(session)} · ${formatCourseSessionCardSubtitle(session)}`,
        publications,
        controls,
        note,
        placeholder,
      };
    }),
  };
}

test("navigateur — première ouverture, agenda élève, échec puis réessai", async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const { stored, nov16 } = catalog();
  const notes = setSessionRichNote(createEmptyNotesDocument(), nov16.key, fromPlainText("Note prof du 16 novembre"));
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let failedOnce = true;
    let ledger = emptyAgendaLedger();
    await page.exposeFunction("retryPublications", async () => {
      failedOnce = false;
      const begun = beginAgendaRefresh(ledger, [CLASSROOM], null);
      const results = await loadAgendaClassrooms(
        begun.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
        async (classroomId) => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return stored.filter((entry) => entry.classroomId === classroomId);
        },
      );
      ledger = commitAgendaLoadResults(begun.ledger, begun.started, results);
      return columnModel(ledger, "ready", notes);
    });
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
      ${css}
      body { margin: 0; background: #f4f7fb; }
      .demo { max-width: 1280px; margin: 0 auto; padding: 20px; }
      .class-notebook-column { min-height: 220px; }
      .class-notebook-zone h3 { margin: 0; color: #8793a9; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
      .class-notebook-zone p { margin: 6px 0; }
    </style></head><body><div class="demo"><section class="class-notebook" id="notebook"></section></div>
    <script>
      const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[char]);
      window.renderNotebook = (model) => {
        const root = document.querySelector("#notebook");
        root.setAttribute("data-publications-state", model.phase);
        const banner = model.banner === "loading"
          ? '<p class="class-notebook-empty" data-banner="loading">${AGENDA_LOADING_LABEL}</p>'
          : model.banner === "error"
            ? '<p class="class-notebook-warning" role="alert" data-banner="error">${AGENDA_ERROR_LABEL}<button type="button" class="workspace-action secondary" id="retry">${AGENDA_RETRY_LABEL}</button></p>'
            : "";
        const columns = model.columns.map((column) => {
          const publication = column.publications.length
            ? column.publications.map((title) => "<p>" + escapeHtml(title) + "</p>").join("")
            : (column.placeholder === "content" ? "<p>" + escapeHtml("${AGENDA_EMPTY_LABEL}") + "</p>" : "");
          const controls = column.controls.map((title) => "<p>" + escapeHtml(title) + "</p>").join("");
          return '<article class="class-notebook-column" data-column-date="' + column.date + '">'
            + '<header class="class-notebook-column-header"><strong>' + escapeHtml(String(Number(column.date.slice(8, 10))) + " " + ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"][Number(column.date.slice(5, 7)) - 1]) + "</strong><span>" + escapeHtml(column.subtitle) + "</span></header>"
            + '<section class="class-notebook-zone"><h3>Contrôle</h3>' + controls + "</section>"
            + '<section class="class-notebook-zone"><h3>Publication élèves</h3>' + publication + "</section>"
            + '<section class="class-notebook-zone"><h3>Notes prof</h3><p data-note="">' + escapeHtml(column.note) + "</p></section>"
            + "</article>";
        }).join("");
        root.innerHTML = banner + '<div class="class-notebook-grid class-notebook-grid-4">' + columns + "</div>";
        const retry = document.querySelector("#retry");
        if (retry) retry.addEventListener("click", async () => {
          window.renderNotebook(await window.retryPublications());
        });
      };
    </script></body></html>`);

    const slow = beginAgendaRefresh(emptyAgendaLedger(), [CLASSROOM, OTHER], null, { replaceScope: true });
    ledger = slow.ledger;
    await page.evaluate((model) => window.renderNotebook(model), columnModel(slow.ledger, "loading", notes));
    await page.screenshot({ path: `${ARTIFACTS}/carnet-chargement-en-cours.png` });
    assert.equal(await page.locator("[data-banner='loading']").innerText(), AGENDA_LOADING_LABEL);
    assert.equal(await page.getByText(AGENDA_EMPTY_LABEL).count(), 0);
    assert.equal(await page.getByText("Publication du 9 novembre").count(), 0);

    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const pending = loadAgendaClassrooms(
      slow.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
      async (classroomId) => {
        await gate;
        return stored.filter((entry) => entry.classroomId === classroomId);
      },
    );
    release();
    ledger = commitAgendaLoadResults(ledger, slow.started, await pending);
    await page.evaluate((model) => window.renderNotebook(model), columnModel(ledger, "ready", notes));
    await page.screenshot({ path: `${ARTIFACTS}/carnet-premiere-connexion.png` });
    for (const title of ["Publication du 9 novembre", "Publication du 16 novembre", "Publication du 19 novembre", "Contrôle du 16 novembre", "Brouillon du 16 novembre"]) {
      assert.equal(await page.getByText(title).count(), 1, title);
    }
    assert.equal(await page.locator("[data-column-date='2026-11-16'] [data-note]").innerText(), "Note prof du 16 novembre");
    assert.equal(await page.getByText(AGENDA_LOADING_LABEL).count(), 0);

    const preview = beginAgendaRefresh(ledger, [CLASSROOM], null);
    const previewResults = await loadAgendaClassrooms(
      preview.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
      async () => stored.filter((entry) => entry.classroomId === CLASSROOM),
    );
    ledger = commitAgendaLoadResults(preview.ledger, preview.started, previewResults);
    await page.evaluate((model) => window.renderNotebook(model), columnModel(ledger, "ready", notes));
    await page.screenshot({ path: `${ARTIFACTS}/carnet-apres-agenda-eleve.png` });
    assert.equal(await page.getByText("Publication du 9 novembre").count(), 1);
    assert.equal(await page.getByText("Publication du 19 novembre").count(), 1);
    assert.equal(agendaItemsFromLedger(ledger).some((entry) => entry.classroomId === OTHER), true);

    const failed = beginAgendaRefresh(emptyAgendaLedger(), [CLASSROOM], null, { replaceScope: true });
    const failedResults = await loadAgendaClassrooms(
      failed.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
      async () => {
        if (failedOnce) throw new Error("HTTP 503");
        return stored.filter((entry) => entry.classroomId === CLASSROOM);
      },
    );
    ledger = commitAgendaLoadResults(failed.ledger, failed.started, failedResults);
    await page.evaluate((model) => window.renderNotebook(model), columnModel(ledger, "error", notes));
    await page.screenshot({ path: `${ARTIFACTS}/carnet-echec-chargement.png` });
    assert.equal(await page.getByText(AGENDA_ERROR_LABEL).count(), 1);
    assert.equal(await page.getByRole("button", { name: AGENDA_RETRY_LABEL }).count(), 1);
    assert.equal(await page.getByText(AGENDA_EMPTY_LABEL).count(), 0);
    assert.equal(await page.getByText("Publication du 9 novembre").count(), 0);

    await page.getByRole("button", { name: AGENDA_RETRY_LABEL }).click();
    await page.waitForFunction(() => document.querySelector("#notebook")?.getAttribute("data-publications-state") === "ready");
    assert.equal(await page.getByText("Publication du 9 novembre").count(), 1);
    assert.equal(await page.getByText("Publication du 16 novembre").count(), 1);
    assert.equal(await page.getByText("Publication du 19 novembre").count(), 1);
    assert.equal(await page.getByText("Contrôle du 16 novembre").count(), 1);
    assert.equal(await page.locator("[data-column-date='2026-11-16'] [data-note]").innerText(), "Note prof du 16 novembre");
    await page.screenshot({ path: `${ARTIFACTS}/carnet-reessai-reussi.png` });
  } finally {
    await browser.close();
  }
});

test("navigateur — conflit de notes entre onglets, puis enseignant B sans les publications de A", async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const { stored, nov16 } = catalog();
  const localText = "Note locale non enregistrée";
  const serverText = "Version serveur de l’autre onglet";
  let guard = emptyNotesConflictGuard();
  let screen = setSessionRichNote(createEmptyNotesDocument(), nov16.key, fromPlainText(localText));
  let displayNote = localText;
  const align = () => {
    guard = notesConflictGuardForDocument(guard, notebookNotesFingerprint(screen));
    return guard.step;
  };
  let epoch = 1;
  const startedByA = epoch;
  const teacherA = stored.filter((entry) => entry.classroomId === CLASSROOM);
  const teacherB = stored.filter((entry) => entry.classroomId === OTHER);
  let ledger = emptyAgendaLedger();
  const loadedA = beginAgendaRefresh(ledger, [CLASSROOM], null, { replaceScope: true });
  ledger = commitAgendaLoadResults(
    loadedA.ledger,
    loadedA.started,
    await loadAgendaClassrooms(
      loadedA.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
      async () => teacherA,
    ),
  );

  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.exposeFunction("copyNotes", () => {
      guard = acceptVerifiedNotebookNotes(guard, notebookNotesFingerprint(screen));
      return align();
    });
    await page.exposeFunction("exportNotes", () => {
      guard = offerNotebookNotesRecovery(guard, notebookNotesFingerprint(screen));
      return { step: align(), hint: NOTES_COPY_UNVERIFIED_HINT };
    });
    await page.exposeFunction("acknowledgeNotes", () => {
      guard = acknowledgeNotebookNotesRecovery(guard, notebookNotesFingerprint(screen));
      return align();
    });
    let editCount = 0;
    await page.exposeFunction("editNote", () => {
      editCount += 1;
      displayNote = `Note modifiée ${editCount}`;
      screen = setSessionRichNote(createEmptyNotesDocument(), nov16.key, fromPlainText(displayNote));
      return { step: align(), note: displayNote };
    });
    await page.exposeFunction("askReload", () => {
      guard = requestServerNotesReload(guard, notebookNotesFingerprint(screen));
      return align();
    });
    await page.exposeFunction("confirmReload", () => {
      if (!serverNotesReloadConfirmed(guard, notebookNotesFingerprint(screen))) {
        return { replaced: false, note: displayNote };
      }
      displayNote = serverText;
      screen = setSessionRichNote(createEmptyNotesDocument(), nov16.key, fromPlainText(serverText));
      guard = emptyNotesConflictGuard();
      return { replaced: true, note: serverText };
    });
    await page.exposeFunction("switchTeacher", async () => {
      epoch += 1;
      if (!agendaResultBelongsToSession(startedByA, epoch)) ledger = emptyAgendaLedger();
      const begun = beginAgendaRefresh(ledger, [OTHER], null, { replaceScope: true });
      const results = await loadAgendaClassrooms(
        begun.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
        async () => teacherB,
      );
      if (agendaResultBelongsToSession(epoch, epoch)) {
        ledger = commitAgendaLoadResults(begun.ledger, begun.started, results);
      }
      return agendaItemsFromLedger(ledger).map((item) => item.title);
    });
    await page.exposeFunction("lateTeacherA", async () => {
      if (agendaResultBelongsToSession(startedByA, epoch)) {
        const begun = beginAgendaRefresh(ledger, [CLASSROOM], null);
        const results = await loadAgendaClassrooms(
          begun.started.map((entry) => ({ classroomId: entry.classroomId, schoolYearId: null })),
          async () => teacherA,
        );
        ledger = commitAgendaLoadResults(begun.ledger, begun.started, results);
      }
      return agendaItemsFromLedger(ledger).map((item) => item.title);
    });
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
      ${css}
      body { margin: 0; background: #f4f7fb; }
      .demo { max-width: 1100px; margin: 0 auto; padding: 20px; }
    </style></head><body><div class="demo">
      <section class="class-notebook" id="notebook"></section>
    </div><script>
      const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[char]);
      const render = (state) => {
        const root = document.querySelector("#notebook");
        const titles = state.titles.map((title) => "<li>" + escapeHtml(title) + "</li>").join("");
        const reloadEnabled = state.step === "secured" || state.step === "confirming";
        const banner = state.interrupted
          ? '<div class="class-notebook-warning" role="alert" data-notes-sync="interrupted"><p>${NOTES_SYNC_INTERRUPTED_LABEL}</p><p>${NOTES_RELOAD_HINT}</p><div class="class-notebook-warning-actions"><button type="button" id="copy">${NOTES_COPY_LOCAL_LABEL}</button><button type="button" id="export">${NOTES_EXPORT_LOCAL_LABEL}</button><button type="button" id="edit">Modifier la note</button><button type="button" id="reload" ' + (reloadEnabled ? "" : "disabled") + '>${NOTES_RELOAD_SERVER_LABEL}</button>' + (state.step === "confirming" ? '<button type="button" id="confirm">${NOTES_RELOAD_CONFIRM_LABEL}</button>' : "") + (state.step === "pending-acknowledgement" ? '<button type="button" id="ack">${NOTES_RECOVERY_ACK_LABEL}</button>' : "") + "</div></div>"
          : "";
        root.innerHTML = banner
          + '<p data-note="">' + escapeHtml(state.note) + "</p>"
          + "<ul>" + titles + "</ul>";
        const copy = document.querySelector("#copy");
        if (copy) copy.addEventListener("click", async () => {
          render({ ...state, step: await window.copyNotes() });
        });
        const exported = document.querySelector("#export");
        if (exported) exported.addEventListener("click", async () => {
          const result = await window.exportNotes();
          render({ ...state, step: result.step });
        });
        const edit = document.querySelector("#edit");
        if (edit) edit.addEventListener("click", async () => {
          const result = await window.editNote();
          render({ ...state, step: result.step, note: result.note });
        });
        const ack = document.querySelector("#ack");
        if (ack) ack.addEventListener("click", async () => {
          render({ ...state, step: await window.acknowledgeNotes() });
        });
        const reload = document.querySelector("#reload");
        if (reload) reload.addEventListener("click", async () => {
          render({ ...state, step: await window.askReload() });
        });
        const confirm = document.querySelector("#confirm");
        if (confirm) confirm.addEventListener("click", async () => {
          const result = await window.confirmReload();
          render({ ...state, interrupted: !result.replaced, step: "unsaved", note: result.note });
        });
      };
      window.renderRecovery = render;
    </script></body></html>`);

    const titlesA = agendaItemsFromLedger(ledger).map((item) => item.title);
    await page.evaluate((state) => window.renderRecovery(state), {
      interrupted: true,
      step: "unsaved",
      note: localText,
      titles: titlesA,
    });
    await page.screenshot({ path: `${ARTIFACTS}/carnet-conflit-notes.png` });
    assert.equal(await page.getByText(NOTES_SYNC_INTERRUPTED_LABEL).count(), 1);
    assert.equal(await page.getByText(NOTES_RELOAD_HINT).count(), 1);
    assert.equal(await page.locator("[data-note]").innerText(), localText);
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).isDisabled(), true);
    assert.equal(await page.getByText("Publication du 9 novembre").count(), 1);

    await page.getByRole("button", { name: NOTES_COPY_LOCAL_LABEL }).click();
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).isDisabled(), false);
    assert.equal(await page.locator("[data-note]").innerText(), localText);

    await page.getByRole("button", { name: "Modifier la note" }).click();
    assert.match(await page.locator("[data-note]").innerText(), /Note modifiée/);
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_CONFIRM_LABEL }).count(), 0);

    await page.getByRole("button", { name: NOTES_EXPORT_LOCAL_LABEL }).click();
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: NOTES_RECOVERY_ACK_LABEL }).count(), 1);
    await page.getByRole("button", { name: "Modifier la note" }).click();
    assert.equal(await page.getByRole("button", { name: NOTES_RECOVERY_ACK_LABEL }).count(), 0);
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).isDisabled(), true);

    await page.getByRole("button", { name: NOTES_COPY_LOCAL_LABEL }).click();
    await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).click();
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_CONFIRM_LABEL }).count(), 1);
    await page.getByRole("button", { name: "Modifier la note" }).click();
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_CONFIRM_LABEL }).count(), 0);
    assert.match(await page.locator("[data-note]").innerText(), /Note modifiée/);

    await page.getByRole("button", { name: NOTES_COPY_LOCAL_LABEL }).click();
    await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).click();

    await page.getByRole("button", { name: NOTES_RELOAD_CONFIRM_LABEL }).click();
    assert.equal(await page.locator("[data-notes-sync='interrupted']").count(), 0);
    assert.equal(await page.locator("[data-note]").innerText(), serverText);

    const titlesB = await page.evaluate(async () => window.switchTeacher());
    await page.evaluate((titles) => {
      document.querySelector("#notebook").innerHTML = "<ul>" + titles.map((title) => "<li>" + title + "</li>").join("") + "</ul>";
    }, titlesB);
    assert.deepEqual(titlesB, ["Publication électricité"]);
    assert.equal(await page.getByText("Publication du 9 novembre").count(), 0);
    assert.equal(await page.getByText("Publication électricité").count(), 1);

    const afterLate = await page.evaluate(async () => window.lateTeacherA());
    await page.evaluate((titles) => {
      document.querySelector("#notebook").innerHTML = "<ul>" + titles.map((title) => "<li>" + title + "</li>").join("") + "</ul>";
    }, afterLate);
    await page.screenshot({ path: `${ARTIFACTS}/carnet-isolation-enseignants.png` });
    assert.deepEqual(afterLate, ["Publication électricité"]);
    assert.equal(await page.getByText("Publication du 9 novembre").count(), 0);
    assert.equal(await page.getByText("Publication du 16 novembre").count(), 0);
  } finally {
    await browser.close();
  }
});

test("navigateur — le Carnet React réel refuse le rechargement après une modification", async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  await esbuild.build({
    entryPoints: [new URL("./notebook-notes-conflict-harness.tsx", import.meta.url).pathname],
    bundle: true,
    format: "iife",
    outfile: "/tmp/notes-conflict-harness.js",
    jsx: "automatic",
    alias: {
      "@campus": "/workspace/src",
      "node:crypto": new URL("./browser-crypto-shim.js", import.meta.url).pathname,
      react: "/workspace/web/node_modules/react/index.js",
      "react/jsx-runtime": "/workspace/web/node_modules/react/jsx-runtime.js",
      "react-dom/client": "/workspace/web/node_modules/react-dom/client.js",
    },
  });
  writeFileSync("/tmp/notes-conflict.css", css);
  writeFileSync("/tmp/notes-conflict.html", `<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="/notes-conflict.css"></head><body><div id="root"></div><script src="/notes-conflict-harness.js"></script></body></html>`);
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    const file = path === "/" ? "/tmp/notes-conflict.html" : `/tmp${path}`;
    const body = readFileSync(file);
    const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
    response.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await context.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByText(NOTES_SYNC_INTERRUPTED_LABEL).waitFor();
    await page.screenshot({ path: `${ARTIFACTS}/carnet-conflit-react.png` });
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).isDisabled(), true);

    await page.getByRole("button", { name: NOTES_COPY_LOCAL_LABEL }).click();
    await page.waitForFunction(() => navigator.clipboard.readText().then((value) => value.includes("FIN-COMPOSANT")).catch(() => false));
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied.includes("DEBUT-COMPOSANT"), true);
    assert.equal(copied.includes("FIN-COMPOSANT"), true);
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).isDisabled(), false);

    await page.getByRole("button", { name: "Changer la note" }).click();
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_CONFIRM_LABEL }).count(), 0);

    await page.getByRole("button", { name: NOTES_EXPORT_LOCAL_LABEL }).click();
    await page.getByText(NOTES_EXPORT_ACK_HINT).waitFor();
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).isDisabled(), true);
    const offered = await page.locator("textarea").inputValue();
    assert.equal(offered.includes("Note changée 1"), true);
    await page.getByRole("button", { name: "Changer la note" }).click();
    assert.equal(await page.getByRole("button", { name: NOTES_RECOVERY_ACK_LABEL }).count(), 0);
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).isDisabled(), true);

    await page.getByRole("button", { name: NOTES_COPY_LOCAL_LABEL }).click();
    await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).click();
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_CONFIRM_LABEL }).count(), 1);
    await page.getByRole("button", { name: "Changer la note" }).click();
    assert.equal(await page.getByRole("button", { name: NOTES_RELOAD_CONFIRM_LABEL }).count(), 0);
    assert.equal(await page.locator("[data-replaced]").getAttribute("data-replaced"), "no");

    await page.getByRole("button", { name: NOTES_COPY_LOCAL_LABEL }).click();
    await page.getByRole("button", { name: NOTES_RELOAD_SERVER_LABEL }).click();
    await page.getByRole("button", { name: NOTES_RELOAD_CONFIRM_LABEL }).click();
    await page.waitForFunction(() => document.querySelector("[data-replaced]")?.getAttribute("data-replaced") === "yes");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
