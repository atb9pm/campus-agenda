import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

import { formatCourseDayHeading } from "../src/features/calendar/course-days.ts";
import {
  notebookBranchPreviewTarget,
  notebookVisibleColumns,
  selectNotebookColumn,
} from "../src/features/class-notebook/notebook-focus.ts";
import {
  formatCourseSessionCardSubtitle,
  formatCourseSessionCardWeekLabel,
} from "../src/features/class-notebook/session-window.ts";
import {
  BRANCH_PREVIEW_DRAFT_LABEL,
  BRANCH_PREVIEW_EMPTY_LABEL,
  getStudentAgendaItems,
  publicationsForBranchPreview,
} from "../src/features/student/index.ts";

const ARTIFACTS = "/opt/cursor/artifacts";
const TODAY = "2026-11-16";
const COURSE = "ac-injection";
const CLASSROOM = "class-mecauto3a";
const YEAR = "SY-2026-27";
const NOTE = "Note prof du 23 : ne pas projeter";

const css = readFileSync(new URL("../web/app/globals.css", import.meta.url), "utf8")
  .replace('@import "tailwindcss";\n', "")
  .replace(/@import url\([^)]+\);\n/, "");

function session(date, week, kind, day, sequence) {
  return {
    key: `${YEAR}|${COURSE}|${date}`,
    schoolYearId: YEAR,
    annualCourseId: COURSE,
    classId: CLASSROOM,
    contextId: "ctx-injection",
    date,
    schoolWeekNumber: week,
    weekKind: kind,
    dayOfWeek: day,
    sequenceNumber: sequence,
    segments: [{ scheduleSlotId: "slot", periodStart: 2, periodEnd: 3 }],
  };
}

const SESSIONS = [
  session("2026-11-16", 12, "B", 1, 1),
  session("2026-11-23", 13, "A", 1, 2),
  session("2026-11-26", 13, "A", 4, 3),
];

function publication(id, sessionEntry, title, detail, studentVisible) {
  return {
    id,
    classroomId: CLASSROOM,
    subjectId: "subject-injection",
    annualCourseId: COURSE,
    authorTeacherId: "teacher-1",
    day: sessionEntry.dayOfWeek - 1,
    hour: 8,
    weekOffset: 0,
    schoolWeekNumber: sessionEntry.schoolWeekNumber,
    type: "HOMEWORK",
    title,
    detail,
    studentVisible,
    courseSessionKey: sessionEntry.key,
    courseSessionDate: sessionEntry.date,
  };
}

const ITEMS = [
  publication(16, SESSIONS[0], "Exercice du 16 novembre", "Feuille déjà publiée aux élèves.", true),
  publication(
    23,
    SESSIONS[1],
    "Injection essence",
    "ME-Motronic, N°17+17a, feuilles à compléter, à terminer. Débitmètre à fil chauffant N°18, légende et texte à copier sur feuille, à terminer.",
    false,
  ),
  publication(24, SESSIONS[1], "Dépollution", "EGR & Insufflation N°7, feuille à compléter, à terminer.", false),
  publication(26, SESSIONS[2], "Travail du 26 novembre", "Publication de la séance suivante.", false),
];

const COLUMN_TEXT = {
  [SESSIONS[0].key]: { publication: "Exercice du 16 novembre", note: "Note du 16" },
  [SESSIONS[1].key]: { publication: "Injection essence — brouillon", note: NOTE },
  [SESSIONS[2].key]: { publication: "Travail du 26 novembre", note: "Note du 26" },
};

function heading(sessionEntry) {
  const [year, month, day] = sessionEntry.date.split("-").map(Number);
  return formatCourseDayHeading({
    schoolWeekNumber: sessionEntry.schoolWeekNumber,
    weekKind: sessionEntry.weekKind,
    date: new Date(year, month - 1, day, 12),
    dayIndex: sessionEntry.dayOfWeek - 1,
  });
}

function weekBadge(sessionEntry) {
  const padded = String(sessionEntry.schoolWeekNumber).padStart(2, "0");
  return `Sem ${padded}-${sessionEntry.weekKind}`;
}

function columnModel(focus) {
  return notebookVisibleColumns({
    sessions: SESSIONS,
    followMode: focus.followMode,
    todayIso: TODAY,
    windowStartKey: focus.windowStartKey,
    selectedSessionKey: focus.selectedSessionKey,
    centerWeekNumber: 12,
    count: 3,
  }).map((column) => {
    const sessionEntry = SESSIONS.find((entry) => entry.key === column.key);
    const [, month, day] = column.date.split("-");
    const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    return {
      ...column,
      dateLabel: `${Number(day)} ${months[Number(month) - 1]}`,
      subtitle: `${formatCourseSessionCardWeekLabel(sessionEntry)} · ${formatCourseSessionCardSubtitle(sessionEntry)}`,
      publication: COLUMN_TEXT[column.key].publication,
      note: COLUMN_TEXT[column.key].note,
    };
  });
}

function previewModel(focus) {
  const target = notebookBranchPreviewTarget({
    annualCourseId: COURSE,
    sessions: SESSIONS,
    followMode: focus.followMode,
    windowStartKey: focus.windowStartKey,
    selectedSessionKey: focus.selectedSessionKey,
  });
  const sessionEntry = SESSIONS.find((entry) => entry.key === target.courseSessionKey) ?? null;
  const publications = publicationsForBranchPreview({
    items: ITEMS,
    classroomId: CLASSROOM,
    annualCourseId: COURSE,
    courseSessionKey: target.courseSessionKey,
  }).map((entry) => ({
    title: entry.title,
    detail: entry.detail,
    draft: entry.studentVisible === false,
  }));
  return {
    heading: sessionEntry ? heading(sessionEntry) : "Séance introuvable",
    week: sessionEntry ? weekBadge(sessionEntry) : "",
    className: "MECAUTO3A",
    branch: "CP VL Injection – Dépollution",
    empty: BRANCH_PREVIEW_EMPTY_LABEL,
    draftLabel: BRANCH_PREVIEW_DRAFT_LABEL,
    publications,
  };
}

function launchOptions() {
  return {
    headless: true,
    ...(process.env.CAMPUS_PLAYWRIGHT_CHANNEL ? { channel: process.env.CAMPUS_PLAYWRIGHT_CHANNEL } : {}),
  };
}

test("navigateur — l’aperçu branche projette le 23 novembre, pas les séances voisines", async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  let focus = { followMode: "auto", windowStartKey: SESSIONS[0].key, selectedSessionKey: null };
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.exposeFunction("notebookAction", async (action, key) => {
      if (action === "select") {
        focus = selectNotebookColumn(SESSIONS[0].key, key);
        return { mode: "notebook", columns: columnModel(focus) };
      }
      if (action === "preview") return { mode: "preview", preview: previewModel(focus), columns: columnModel(focus) };
      if (action === "quit") return { mode: "notebook", columns: columnModel(focus) };
      if (action === "student") {
        return {
          mode: "student",
          titles: getStudentAgendaItems(ITEMS, CLASSROOM).map((entry) => entry.title),
        };
      }
      return { mode: "notebook", columns: columnModel(focus) };
    });
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
      ${css}
      body { margin: 0; background: #f4f7fb; }
      .demo { max-width: 1180px; margin: 0 auto; padding: 20px 16px 40px; }
      .class-notebook-shift { margin-bottom: 12px; }
      .class-notebook-shift button { width: auto; height: auto; padding: 8px 12px; }
      .class-notebook-column { min-height: 220px; }
      .class-notebook-zone h3 { margin: 0; color: #8793a9; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
      .class-notebook-zone p { margin: 4px 0 12px; color: #06183d; }
      .preview-host, .student-host { display: none; }
      .preview-host.is-open, .student-host.is-open { display: block; }
      .student-host { margin-top: 24px; background: white; border: 1px solid #e3ebf5; border-radius: 16px; padding: 16px; }
    </style></head><body>
      <div class="demo">
        <div id="notebook-host"></div>
        <div id="preview-host" class="preview-host"></div>
        <div id="student-host" class="student-host"></div>
      </div>
    </body></html>`);
    await page.evaluate((initialColumns) => {
      const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[char]);
      const renderNotebook = (columns) => {
        document.querySelector("#preview-host").classList.remove("is-open");
        document.querySelector("#student-host").classList.remove("is-open");
        const cards = columns.map((column) => `
          <article class="class-notebook-column${column.selected ? " active" : ""}" data-column-date="${column.date}">
            <header class="class-notebook-column-header">
              <button type="button" data-action="select" data-key="${column.key}" aria-pressed="${column.selected ? "true" : "false"}">
                ${column.referenceTag ? `<em class="class-notebook-reference-tag">${escapeHtml(column.referenceTag)}</em>` : ""}
                <strong>${escapeHtml(column.dateLabel)}</strong>
                <span>${escapeHtml(column.subtitle)}</span>
              </button>
            </header>
            <section class="class-notebook-zone">
              <h3>Publications élèves</h3>
              <p>${escapeHtml(column.publication)}</p>
              <h3>Notes prof</h3>
              <p>${escapeHtml(column.note)}</p>
            </section>
          </article>`).join("");
        document.querySelector("#notebook-host").innerHTML = `
          <div class="class-notebook">
            <div class="class-notebook-shift">
              <button type="button" class="workspace-action secondary" data-action="preview">Aperçu branche</button>
              <button type="button" class="workspace-action secondary" data-action="student">Agenda élève</button>
            </div>
            <div class="class-notebook-grid class-notebook-grid-3" style="grid-template-columns: repeat(3, minmax(0, 1fr))">${cards}</div>
          </div>`;
      };
      const renderPreview = (preview) => {
        const body = preview.publications.length
          ? preview.publications.map((entry) => `
              <div class="student-branch-item" data-draft="${entry.draft ? "" : "published"}">
                ${entry.draft ? `<p class="branch-preview-draft">${escapeHtml(preview.draftLabel)}</p>` : ""}
                <div class="student-pub-legacy"><strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.detail)}</p></div>
              </div>`).join("")
          : `<p class="student-panel-empty">${escapeHtml(preview.empty)}</p>`;
        document.querySelector("#notebook-host").innerHTML = "";
        document.querySelector("#preview-host").classList.add("is-open");
        document.querySelector("#preview-host").innerHTML = `
          <div class="student-course-day-app branch-preview" data-branch-preview="">
            <header class="branch-preview-head">
              <div class="branch-preview-identity">
                <h1>${escapeHtml(preview.heading)}</h1>
                <div class="branch-preview-meta">
                  <span class="branch-preview-pill is-class">${escapeHtml(preview.className)}</span>
                  <span class="branch-preview-pill is-branch">${escapeHtml(preview.branch)}</span>
                  <span class="branch-preview-pill is-week">${escapeHtml(preview.week)}</span>
                </div>
              </div>
              <button type="button" class="branch-preview-quit" data-action="quit">Quitter l’aperçu</button>
            </header>
            <article class="branch-preview-card" id="cours-du-jour">
              <div class="branch-preview-banner"><h2>Cours du jour</h2></div>
              <div class="branch-preview-body">${body}</div>
            </article>
          </div>`;
      };
      document.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const result = await window.notebookAction(button.dataset.action, button.dataset.key || "");
        if (result.mode === "preview") renderPreview(result.preview);
        if (result.mode === "notebook") renderNotebook(result.columns);
        if (result.mode === "student") {
          document.querySelector("#student-host").classList.add("is-open");
          document.querySelector("#student-host").innerHTML = `
            <h2>Agenda élève</h2>
            <ul>${result.titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul>`;
        }
      });
      renderNotebook(initialColumns);
    }, columnModel(focus));

    const before = await page.locator(".class-notebook-column").evaluateAll((nodes) => nodes.map((node) => ({
      date: node.getAttribute("data-column-date"),
      x: Math.round(node.getBoundingClientRect().x),
      active: node.classList.contains("active"),
    })));
    assert.deepEqual(before.map((column) => column.date), ["2026-11-16", "2026-11-23", "2026-11-26"]);

    await page.locator('[data-column-date="2026-11-23"] button').click();
    await page.waitForFunction(() => document.querySelector('[data-column-date="2026-11-23"]')?.classList.contains("active"));
    const selected = await page.locator(".class-notebook-column").evaluateAll((nodes) => nodes.map((node) => ({
      date: node.getAttribute("data-column-date"),
      x: Math.round(node.getBoundingClientRect().x),
      active: node.classList.contains("active"),
    })));
    assert.deepEqual(selected.map((column) => column.date), before.map((column) => column.date));
    assert.deepEqual(selected.map((column) => column.x), before.map((column) => column.x));
    assert.equal(selected[1].active, true);
    assert.equal(selected[0].active, false);
    await page.screenshot({ path: `${ARTIFACTS}/apercu-carnet-23-novembre.png` });

    await page.getByRole("button", { name: "Aperçu branche" }).click();
    await page.waitForSelector("#cours-du-jour");
    const previewText = await page.locator("#cours-du-jour").innerText();
    const headingText = await page.locator("h1").innerText();
    const weekText = await page.locator(".is-week").innerText();
    const branchText = await page.locator(".is-branch").innerText();
    assert.match(headingText, /23/);
    assert.match(headingText, /novembre/i);
    assert.equal(weekText, "Sem 13-A");
    assert.equal(branchText, "CP VL Injection – Dépollution");
    assert.match(previewText, /Injection essence/);
    assert.match(previewText, /ME-Motronic/);
    assert.match(previewText, /Dépollution/);
    assert.match(previewText, /EGR & Insufflation/);
    assert.equal(await page.locator(".branch-preview-draft").count(), 2);
    assert.match(previewText, /Brouillon — non publié aux élèves/);
    assert.doesNotMatch(previewText, /Exercice du 16 novembre/);
    assert.doesNotMatch(previewText, /Travail du 26 novembre/);
    assert.doesNotMatch(previewText, /Note prof/);
    await page.screenshot({ path: `${ARTIFACTS}/apercu-branche-23-novembre.png` });

    await page.getByRole("button", { name: "Quitter l’aperçu" }).click();
    await page.waitForSelector('[data-column-date="2026-11-23"]');
    const restored = await page.locator(".class-notebook-column").evaluateAll((nodes) => nodes.map((node) => ({
      date: node.getAttribute("data-column-date"),
      x: Math.round(node.getBoundingClientRect().x),
      active: node.classList.contains("active"),
    })));
    assert.deepEqual(restored.map((column) => column.date), before.map((column) => column.date));
    assert.deepEqual(restored.map((column) => column.x), before.map((column) => column.x));
    assert.equal(restored[1].active, true);

    await page.getByRole("button", { name: "Agenda élève" }).click();
    await page.waitForSelector("#student-host.is-open");
    const studentText = await page.locator("#student-host").innerText();
    assert.match(studentText, /Exercice du 16 novembre/);
    assert.doesNotMatch(studentText, /Injection essence/);
    assert.doesNotMatch(studentText, /Dépollution/);
    assert.doesNotMatch(studentText, /Travail du 26 novembre/);
    assert.doesNotMatch(studentText, /Note prof/);
    await page.screenshot({ path: `${ARTIFACTS}/apercu-agenda-eleve-sans-brouillon.png` });
  } finally {
    await browser.close();
  }
});
